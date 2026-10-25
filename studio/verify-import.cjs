'use strict';
// Imports a real chart bundle and flop library through the app's own file input, then checks lookups and a reload.
//   node studio/build.cjs --web && node studio/verify-import.cjs <preflop-library.json.gz> [postflop-library.json.gz]
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const studio=__dirname,repo=path.dirname(studio),profile=path.join(repo,'import-check-'+process.pid),[charts,flops]=process.argv.slice(2).map(f=>f&&path.resolve(f));
if(!charts||!fs.existsSync(charts)||flops&&!fs.existsSync(flops))throw Error('Usage: node studio/verify-import.cjs <preflop-library.json.gz> [postflop-library.json.gz]');
function findChrome(){
 const env=process.env,local=env.LOCALAPPDATA||'',pw=env.PLAYWRIGHT_BROWSERS_PATH||'';
 const listed=[env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',local&&path.join(local,'Google/Chrome/Application/chrome.exe'),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',
  ...(pw&&fs.existsSync(pw)?fs.readdirSync(pw).filter(d=>/^chromium-\d+$/.test(d)).map(d=>path.join(pw,d,'chrome-linux/chrome')):[]),
  ...(env.PATH||'').split(path.delimiter).flatMap(d=>['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(n=>path.join(d,n)))];
 const found=listed.find(f=>f&&fs.existsSync(f));if(!found)throw Error('Chrome was not found. Install Chrome or set CHROME_PATH to its executable.');return found;
}
const browser=spawn(findChrome(),['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
let seq=0,buffer='',count=0;const pending=new Map(),errors=[];
browser.stderr.on('data',()=>{});browser.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!raw)continue;const m=JSON.parse(raw);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);}});
function cmd(method,params={},sessionId){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},120000);pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}})+'\0');});}
async function main(){try{
const {targetId}=await cmd('Target.createTarget',{url:'about:blank'}),{sessionId}=await cmd('Target.attachToTarget',{targetId,flatten:true});const c=(m,p={})=>cmd(m,p,sessionId);
async function ev(expression){const r=await c('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function wait(expression,ms=30000){const t=Date.now();while(Date.now()-t<ms){if(await ev(expression))return Date.now()-t;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out waiting for '+expression+'; '+errors.join('\n'));}
function pass(text){console.log('PASS '+text);count++;}
const ready='typeof studioInterface!=="undefined"&&studioInterface.ready&&state.autoAnalyzeReady';
const open=async()=>{await c('Page.navigate',{url:pathToFileURL(path.join(studio,'render-site/index.html')).href});await wait(ready,60000);await ev('state.autoAnalyze=false;$("autoAnalyze").checked=false;$("gradeEvery").checked=false;if(state.pending?.automatic)$("spotStop").onclick();dbPut("meta",{id:"autoAnalyze",value:false})');};
// The file goes through the real <input type=file> and its change handler, as when a user picks it.
const pick=async(file,done)=>{await ev('$("preflopImportStatus").textContent=""');const {root}=await c('DOM.getDocument'),{nodeId}=await c('DOM.querySelector',{nodeId:root.nodeId,selector:'#preflopFile'});const t=Date.now();await c('DOM.setFileInputFiles',{nodeId,files:[file]});await wait('/^Loaded|cannot|must|no charts|Expected|Invalid|error/i.test($("preflopImportStatus").textContent)',600000);const status=await ev('$("preflopImportStatus").textContent');assert.match(status,done,status);return{ms:Date.now()-t,status};};
await c('Runtime.enable');await c('Page.enable');await c('DOM.enable');
let t=Date.now();await open();console.log('App ready in '+(Date.now()-t)+' ms');
const bundle=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(charts)).toString()),names=bundle.packs.map(p=>p.name);
const a=await pick(charts,/^Loaded \d+ charts/);const n=await ev('preflopLibrary.packs.length');assert.equal(n,names.length,a.status);assert.equal(new Set(await ev('preflopLibrary.packs.map(p=>p.name)')).size,names.length);
pass(`Chart bundle imports through the file picker: ${n} charts in ${(a.ms/1000).toFixed(1)} s`);
// A second import of the same bundle replaces charts by name instead of adding copies.
const again=await pick(charts,/^Loaded \d+ charts/);assert.equal(await ev('preflopLibrary.packs.length'),names.length);pass(`Re-importing the bundle replaces charts by name (${(again.ms/1000).toFixed(1)} s)`);
// Lookups: a 6-max 100bb open, the deep 5-bet jam line where KK used to fold, a PLO open and a short-stack MTT spot.
const look=(cfg,acts,cards)=>ev(`(()=>{const h=new G.Hand(G.normalize(${JSON.stringify(cfg)}),{rng:G.rng(3)});for(const [kind,to] of ${JSON.stringify(acts)})h.act(kind==='raise'?{kind,target:G.units(to)}:{kind});h.holes[h.actor]=G.Core.cards(${JSON.stringify(cards)});const r=PokerPreflop.nearest(preflopLibrary.packs,h);return r&&PokerPreflop.isResult(r)?{name:r.referenceSource?.name||'',labels:r.actions.map(x=>x.label),freq:r.reference}:null})()`);
const six=n=>({variant:'NLH',seats:6,button:0,stacks:Array(6).fill(n)});
const open6=await look(six(100),[['fold'],['fold']],'AsAh');assert.ok(open6&&open6.freq[0]<.01,'No 6-max 100bb chart answer for AA in the CO: '+JSON.stringify(open6));
const kk=await look(six(200),[['fold'],['fold'],['raise',2.5],['fold'],['fold'],['raise',10],['raise',23],['raise',200]],'KsKh');assert.ok(kk,'No chart answer facing the 200bb 5-bet jam');const kkFold=kk.freq[kk.labels.findIndex(l=>/^Fold/.test(l))];assert.ok(kkFold<.1,'KK folds '+(100*kkFold).toFixed(1)+'% to the 200bb 5-bet jam: '+JSON.stringify(kk));
const plo=await look({variant:'PLO4',seats:6,button:0,stacks:Array(6).fill(100)},[['fold'],['fold']],'AsAhKsKh');assert.ok(plo&&plo.freq[0]<.01,'No PLO chart answer for AAKK: '+JSON.stringify(plo));
const mtt=await look({variant:'NLH',seats:9,button:0,stacks:Array(9).fill(20),mode:'icm',ante:1,anteMode:'bigblind',payouts:[50,30,20]},[],'7c2d');assert.ok(mtt&&mtt.freq[0]>.99,'No 9-handed 20bb MTT answer folding 72o UTG: '+JSON.stringify(mtt));
pass(`Imported charts answer: 6-max 100bb AA opens, KK calls the 200bb 5-bet jam (folds ${(100*kkFold).toFixed(1)}%), PLO AAKK opens, 9-handed 20bb MTT folds 72o`);
if(flops){
 const b=await pick(flops,/^Loaded .*flops/);const spots=await ev('postflopLibrary.libraries.flatMap(l=>l.spots).map(s=>({label:s.label,flops:Object.keys(s.flops).length}))');assert.ok(spots.length&&spots.every(s=>s.flops>0),JSON.stringify(spots));
 pass(`Flop library imports: ${spots.map(s=>s.flops+' '+s.label).join(', ')} (${(b.ms/1000).toFixed(1)} s)`);
 // BTN opens, BB calls, then a solved flop: the library (built on the 100bb cash charts) must answer BB's first decision.
 const flop=await ev(`(()=>{const spot=postflopLibrary.libraries.flatMap(l=>l.spots).find(s=>/BTN/.test(s.label)&&/BB/.test(s.label)&&!/3-?bet/i.test(s.label))||postflopLibrary.libraries[0].spots[0];const keys=Object.keys(spot.flops),out=[];for(const key of keys.slice(0,12))for(const cards of ['AhKd','QsJs','9c8c','7h7d','Ac5c','KdTd']){const board=G.Core.cards(key);if(G.Core.cards(cards).some(x=>board.includes(x)))continue;const h=new G.Hand(G.normalize({variant:'NLH',seats:6,button:0,stacks:Array(6).fill(100)}),{runout:board,rng:G.rng(2)});for(const a of [{kind:'fold'},{kind:'fold'},{kind:'fold'},{kind:'raise',target:G.units(2.5)},{kind:'fold'},{kind:'call'}])h.act(a);if(h.street!==1)return{error:'not on the flop',street:h.street};h.holes[h.actor]=G.Core.cards(cards);const r=postflopLibraryReference(h);if(r)out.push({key,cards,warning:(r.warning||'').slice(0,90)});}return{spot:spot.label,tried:Math.min(12,keys.length),answers:out.length,first:out[0]}})()`);
 assert.ok(flop.answers>0,'The flop library answers no BTN-vs-BB flop: '+JSON.stringify(flop));pass(`Flop library answers ${flop.answers} BTN-vs-BB flop decisions from the imported charts (${flop.spot}; e.g. ${flop.first.cards} on ${flop.first.key})`);
 // Flops outside the library: the nearest solved flop of the same texture answers, labelled as a stand-in.
 const near=await ev(`(()=>{const spot=postflopLibrary.libraries.flatMap(l=>l.spots).find(s=>/BTN/.test(s.label)&&/BB/.test(s.label)&&!/3-?bet/i.test(s.label))||postflopLibrary.libraries[0].spots[0],rng=G.rng(11);let tried=0,answers=0,labelled=0,first=null;for(let t=0;t<400&&tried<60;t++){const deck=[...Array(52).keys()].sort(()=>rng()-.5),board=deck.slice(0,3),cards=deck.slice(3,5);if(spot.flops[PokerPostflopLibrary.canonical(board).key])continue;tried++;const h=new G.Hand(G.normalize({variant:'NLH',seats:6,button:0,stacks:Array(6).fill(100)}),{runout:board,rng:G.rng(2)});for(const a of [{kind:'fold'},{kind:'fold'},{kind:'fold'},{kind:'raise',target:G.units(2.5)},{kind:'fold'},{kind:'call'}])h.act(a);h.holes[h.actor]=cards;const r=postflopLibraryReference(h);if(r){answers++;if(r.solve.library.standIn&&/^Stand-in/.test(r.solve.warning))labelled++;first=first||board.map(G.Core.cardName).join('')+' from '+r.solve.library.flop;}}return{tried,answers,labelled,first}})()`);
 assert.ok(near.answers>0&&near.labelled===near.answers,'Unsolved flops get no labelled stand-in: '+JSON.stringify(near));pass(`Unsolved flops are answered from the nearest solved flop of the same texture: ${near.answers} of ${near.tried} random flops and hands, all labelled as stand-ins (e.g. ${near.first})`);
}
// Reload: everything comes back from the browser's storage.
t=Date.now();await open();await wait('preflopLibrary.ready!==false&&preflopLibrary.packs.length>0',60000);const back={charts:await ev('preflopLibrary.packs.length'),libraries:await ev('postflopLibrary.libraries.length')};
assert.equal(back.charts,names.length);if(flops)assert.equal(back.libraries,1);pass(`After a reload ${back.charts} charts${flops?' and the flop library':''} are restored (${((Date.now()-t)/1000).toFixed(1)} s to ready)`);
const kk2=await look(six(200),[['fold'],['fold'],['raise',2.5],['fold'],['fold'],['raise',10],['raise',23],['raise',200]],'KsKh');assert.deepEqual(kk2,kk);pass('Restored charts give the same answers');
assert.deepEqual(errors,[]);console.log(count+' import checks passed.');
}finally{try{await cmd('Browser.close');}catch{}browser.kill();for(const p of pending.values())clearTimeout(p.timer);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}}
main().catch(error=>{console.error(error);process.exitCode=1;});
