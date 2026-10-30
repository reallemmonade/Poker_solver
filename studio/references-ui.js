'use strict';
// One action palette for the whole app (interface.css --act-*): fold, check or call, bets and raises in three shades
// from small to large, and all-in. Postflop, a bet's shade follows its size as a share of the pot (up to 45% small,
// up to 90% medium, larger large); preflop, and wherever no hand is given, raises shade by their order. A bet that
// covers every opponent is all-in, as the bet bar labels it.
function actionTones(actions,hand=null){
 const legal=(()=>{try{return hand&&!hand.done?hand.legal():null}catch{return null}})(),cover=legal?Math.min(legal.allInTo,Math.max(0,...hand.living().filter(i=>i!==hand.actor).map(i=>hand.streetPaid[i]+hand.stacks[i]))||legal.allInTo):0,jam=a=>/all-in/i.test(a.label||'')||!!a.allIn||!!(legal&&a.target>=cover);
 const sized=actions.map((a,i)=>({a,i})).filter(({a})=>(a.kind==='bet'||a.kind==='raise')&&!jam(a)).sort((x,y)=>(x.a.target||0)-(y.a.target||0)),tones=actions.map(a=>a.kind==='fold'?'fold':a.kind==='check'||a.kind==='call'?'passive':'allin');
 if(hand&&hand.street>0&&!hand.done){const paid=hand.streetPaid[hand.actor],owe=Math.max(0,(hand.currentBet||0)-paid),pot=Math.max(1,hand.pot+owe);for(const {a,i}of sized){const f=((a.target||0)-paid-owe)/pot;tones[i]=f<=.45?'bet1':f<=.9?'bet2':'bet3';}}
 else{const by={1:['bet2'],2:['bet1','bet3'],3:['bet1','bet2','bet3']}[sized.length];sized.forEach(({i},k)=>{tones[i]=by?by[k]:['bet1','bet2','bet3'][Math.min(2,Math.floor(3*k/sized.length))];});}
 return tones;
}
// An action's label in the all-in tone reads All-in, with its amount ("Bet 99 bb" → "All-in 99 bb").
function toneLabel(a,tone){return tone==='allin'&&!/all-in/i.test(a.label||'')?String(a.label||'').replace(/^(Bet|Raise to|Raise)\b/i,'All-in'):a.label;}
// A frequency mix as left-to-right color bands, for one range-grid cell.
function actionMixStyle(mix,tones){let at=0;const stops=[];mix.forEach((p,i)=>{if(!(p>0))return;const end=Math.min(100,at+p*100);stops.push('var(--act-'+tones[i]+') '+at.toFixed(1)+'% '+end.toFixed(1)+'%');at=end;});return stops.length?'background:linear-gradient(to right,'+stops.join(',')+')':'';}
function actionKeyHTML(actions,tones){return'<div class="action-key">'+actions.map((a,i)=>'<span><i style="background:var(--act-'+tones[i]+')"></i>'+esc(tones[i]==='allin'?'All-in':a.label.replace(/ · .*/,''))+'</span>').join('')+'</div>';}
const preflopLibrary={packs:[],preferred:null,captured:null,ready:false},postflopLibrary={libraries:[]};
const solvedPolicyRequests=new Map();let solvedPolicySequence=0;
function requestSolvedPolicy(hand){if(!state.worker)return Promise.resolve(null);return new Promise(resolve=>{const requestId=++solvedPolicySequence,timer=setTimeout(()=>{solvedPolicyRequests.delete(requestId);resolve(null)},3000);solvedPolicyRequests.set(requestId,{resolve,timer});state.worker.postMessage({type:'policyQuery',requestId,observed:observedData(hand)});});}
function receiveSolvedPolicy(message){if(message.type!=='continuationPolicy')return false;const request=solvedPolicyRequests.get(message.requestId);if(request){clearTimeout(request.timer);solvedPolicyRequests.delete(message.requestId);request.resolve(message.policy||null);}return true;}
function preflopReference(hand,actions=null,preferred=null){if(!hand||hand.done||hand.street!==0)return null;const chosen=preferred||(preflopLibrary.preferred?.family===hand.family?preflopLibrary.preferred:null);const controls=actions||G.modelActions(hand,state.abstraction);for(const pack of chosen?[chosen]:preflopLibrary.packs){const q=PokerPreflop.query(pack,hand,controls);if(q)return q;}return PokerPreflop.nearest(chosen?[chosen]:preflopLibrary.packs,hand,controls);}
// Postflop starting ranges from the imported preflop charts, used when nothing
// more specific is known (typed ranges, or a preceding exact solve). PLO ranges
// are a weighted sample of combos: up to 299 for the in-browser river solver,
// more when the computer's local solver takes the spot.
function chartPostflopRanges(hand,observed,opts){
 if(!hand||hand.street===0||!preflopLibrary.packs.length)return null;const preferred=preflopLibrary.preferred,packs=preferred?[preferred,...preflopLibrary.packs.filter(p=>p!==preferred)]:preflopLibrary.packs;
 let r=null;try{r=PokerPreflop.postflopRanges(packs,observed.config,observed.actions);}catch{return null;}if(!r)return null;
 const ranges=Array(hand.n).fill(''),heroClass=G.Core.handClass(observed.heroCards);
 for(const [seat,w]of Object.entries(r.seats)){const hero=+seat===observed.actor;
  if(r.game==='NLH'){const weights=Array.from(w),i=PokerPreflop.classes.indexOf(heroClass);if(hero&&i>=0)weights[i]=Math.max(weights[i],.01);ranges[seat]=PokerPreflop.classRangeText(weights);}
  else{const limit=opts.localSolver?[600,1200,2500][observed.board.length-3]:299,combos=PokerPreflop.ploCombos({pack:r.pack,weights:w},observed.board,{limit,include:hero?observed.heroCards:null,seed:1+(+seat)}),peak=Math.max(...combos.map(c=>c.weight));if(!combos.length||!(peak>0))return null;ranges[seat]=combos.map(c=>c.cards.map(G.Core.cardName).join('')+':'+Math.max(.01,Math.round(1000*c.weight/peak)/1000)).join(',');}
 }
 return{ranges,origin:'Imported preflop chart: '+r.name+(r.depthMatch?' (nearest depth '+fmt(r.depthMatch.chart)+' bb for '+fmt(r.depthMatch.actual)+' bb)':'')+(r.game==='NLH'?'':'; a weighted sample of combos')};
}
// Precomputed flop strategies (Library → Preflop solver references → Import).
// They answer a flop decision when its preflop line, chart and flop (up to
// suits) were solved; other bet sizes map to a solved one (approximate when far, tightened or widened).
function postflopLibraryReference(hand){
 if(!hand||hand.done||hand.street!==1||!postflopLibrary.libraries.length||!preflopLibrary.packs.length)return null;
 try{const range=PokerPreflop.postflopRanges(preflopLibrary.packs,hand.config,hand.actionLog),q=PokerPostflopLibrary.query(postflopLibrary.libraries,range,hand);if((!q||q.solve.library.standIn)&&typeof noteMissingFlop==='function')noteMissingFlop(hand);return q;}catch{return null;}
}
// Turn strategies (Library → Preflop solver references → Import a turn-<spot>.ctl file). Each spot's
// flops are kept apart in their own database, and one flop is unpacked only when a hand of that
// spot reaches its turn; the few last used stay in memory.
const turnLibrary={spots:[],cache:new Map()};
function turnDB(){if(turnLibrary.db)return turnLibrary.db;turnLibrary.db=new Promise((resolve,reject)=>{const r=indexedDB.open('citrus-turn-library',1);r.onupgradeneeded=()=>{for(const name of ['spots','flops'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return turnLibrary.db;}
async function turnStore(name,mode,work){const db=await turnDB();return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode),store=tx.objectStore(name);let out;Promise.resolve(work(store)).then(v=>{out=v;});tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('The turn library could not be saved.'));});}
const turnRequest=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function addTurnLibrary(bytes){
 const {header,flop}=PokerPostflopLibrary.readTurn(bytes),uid=header.spot.id+'|'+header.spot.chart.name+'|'+header.spot.chart.key,spot={...header.spot,flops:header.flops.map(({key,weight,iterations,exploitability})=>({key,weight,iterations,exploitability})),uid,name:header.name};
 await turnStore('flops','readwrite',store=>{for(const f of header.flops)store.put(flop(f).slice(),uid+'|'+f.key);});
 await turnStore('spots','readwrite',store=>{store.put(spot,uid);});
 turnLibrary.spots=turnLibrary.spots.filter(s=>s.uid!==uid).concat(spot);for(const k of [...turnLibrary.cache.keys()])if(k.startsWith(uid+'|'))turnLibrary.cache.delete(k);
 return spot;
}
async function restoreTurnLibrary(){try{turnLibrary.spots=await turnStore('spots','readonly',store=>turnRequest(store.getAll()))||[];}catch{turnLibrary.spots=[];}}
async function turnChunk(spot,key){
 const id=spot.uid+'|'+key;if(turnLibrary.cache.has(id)){const c=turnLibrary.cache.get(id);turnLibrary.cache.delete(id);turnLibrary.cache.set(id,c);return c;}
 const bytes=await turnStore('flops','readonly',store=>turnRequest(store.get(id)));if(!bytes)return null;
 const chunk=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 turnLibrary.cache.set(id,chunk);while(turnLibrary.cache.size>4)turnLibrary.cache.delete(turnLibrary.cache.keys().next().value);return chunk;
}
// The turn spot and flop chunk for a hand on the turn or river, or null.
async function turnContext(hand){
 if(!hand||hand.done||hand.street<2||!turnLibrary.spots.length||!preflopLibrary.packs.length||typeof DecompressionStream!=='function')return null;
 try{const range=PokerPreflop.postflopRanges(preflopLibrary.packs,hand.config,hand.actionLog),t=PokerPostflopLibrary.turnSpot(turnLibrary.spots,range,hand);if(!t)return null;const chunk=await turnChunk(t.spot,t.key);return chunk?{range,t,chunk}:null;}catch{return null;}
}
async function turnLibraryReference(hand){const c=hand?.street===2?await turnContext(hand):null;try{return c&&PokerPostflopLibrary.queryTurn(c.t,c.chunk,c.range,hand);}catch{return null;}}
// Both players' ranges on the turn or river, narrowed by their own flop and turn actions with the
// solved frequencies, as combo ranges for a live solve; null off the solved lines.
async function carriedPostflopRanges(hand){
 const c=await turnContext(hand);if(!c)return null;let w;try{w=PokerPostflopLibrary.carry(c.t,c.chunk,hand);}catch{return null;}if(!w)return null;
 const ranges=Array(hand.n).fill(''),hero=PokerPostflopLibrary.comboIndex(hand.holes[hand.actor]);
 for(const seat of [c.t.ip,c.t.oop]){const x=Array.from(w[seat]);if(seat===hand.actor)x[hero]=Math.max(x[hero],.01*Math.max(...x));const top=Math.max(...x);if(!(top>0))return null;
  ranges[seat]=PokerPostflopLibrary.COMBOS.map((cs,i)=>[cs,x[i]/top]).filter(([,v])=>v>=.001).map(([cs,v])=>cs.map(G.Core.cardName).join('')+(v>=.9995?'':':'+(Math.round(v*1000)/1000))).join(',');}
 return{ranges,origin:'Imported preflop chart: '+c.range.name+', narrowed by each player\'s flop'+(hand.street>=3?' and turn':'')+' actions with the solved frequencies ('+c.t.spot.label+')'};
}
const postflopRow=l=>({...l,spots:l.spots.map(s=>({...s,flops:Object.fromEntries(Object.entries(s.flops).map(([k,f])=>[k,{...f,nodes:f.nodes.map(({bytes,...n})=>n)}]))}))});
// merge: add the input's spots to a stored library of the same name instead of replacing it (single-spot downloads).
async function addPostflopLibrary(input,merge=false){const old=postflopLibrary.libraries.findIndex(l=>l.name===input?.name&&!memoryOnly.has(l));if(merge&&old>=0){const ids=new Set((input.spots||[]).map(s=>s.id));input={...input,spots:[...postflopRow(postflopLibrary.libraries[old]).spots.filter(s=>!ids.has(s.id)),...input.spots]};}const lib=PokerPostflopLibrary.validate(input);if(old>=0)postflopLibrary.libraries[old]=lib;else postflopLibrary.libraries.push(lib);await dbPut('meta',{id:'postflopLibraries-v1',value:postflopLibrary.libraries.filter(l=>!memoryOnly.has(l)).map(postflopRow)});spotUI.last=null;renderPostflopLibrary();return lib;}
function renderPostflopLibrary(){const el=$('postflopCoverage');if(!el)return;const spots=postflopLibrary.libraries.flatMap(l=>l.spots),select=$('postflopSpot');$('postflopReports').classList.toggle('hide',!spots.length);if(select){const old=select.value;select.innerHTML=spots.map((s,i)=>'<option value="'+i+'">'+esc(s.label)+'</option>').join('');if([...select.options].some(o=>o.value===old))select.value=old;select.onchange=$('postflopNode').onchange=renderPostflopReport;renderPostflopReport();}el.textContent=spots.length?'Precomputed flops: '+spots.map(s=>s.label+' ('+Object.keys(s.flops).length+' flops)').join('; ')+'. They need the matching preflop chart loaded.':'No precomputed flop library loaded.';}
function renderPostflopReport(){
 const spot=postflopLibrary.libraries.flatMap(l=>l.spots)[+$('postflopSpot').value],out=$('postflopReport');if(!spot||!out)return;const want=$('postflopNode').value,rows=[];
 for(const [key,flop]of Object.entries(spot.flops)){const node=flop.nodes.find(n=>want.endsWith('BET')?n.path.startsWith(want+' ')&&!n.path.slice(want.length+1).includes('/'):n.path===want);if(!node)continue;const a=PokerPostflopLibrary.aggregate(spot,flop,node.path);if(a)rows.push({key,weight:flop.weight||1,...a});}
 if(!rows.length){out.innerHTML='<p class="help">This line does not occur in the solved tree.</p>';return;}
 const actions=rows[0].actions,label=a=>{const [k,x]=a.split(' ');return k==='CHECK'?'Check':k==='CALL'?'Call':k==='FOLD'?'Fold':(k==='BET'?'Bet ':'Raise ')+fmt(+x/100,1)+' bb';},total=rows.reduce((s,r)=>s+r.weight,0),avg=actions.map((_,i)=>rows.reduce((s,r)=>s+r.weight*(r.freq[i]||0),0)/total),aggressive=actions.findIndex(a=>/^(BET|RAISE)/.test(a));
 rows.sort((p,q)=>aggressive<0?0:q.freq[aggressive]-p.freq[aggressive]);const cell=x=>'<td>'+fmt(100*x,1)+'%</td>';
 out.innerHTML='<p class="help">'+(rows[0].player==='ip'?'In position':'Out of position')+' · '+rows.length+' flops · pot '+fmt(spot.pot/100,1)+' bb, stacks '+fmt(spot.stack/100,1)+' bb.</p><div class="tableWrap"><table><thead><tr><th>Flop</th>'+actions.map(a=>'<th>'+esc(label(a))+'</th>').join('')+'</tr></thead><tbody><tr><td><strong>All flops</strong></td>'+avg.map(cell).join('')+'</tr>'+rows.map(r=>'<tr><td>'+esc(r.key.replace(/(..)(?=.)/g,'$1 '))+'</td>'+actions.map((_,i)=>cell(r.freq[i]||0)).join('')+'</tr>').join('')+'</tbody></table></div>';
}
function displayPolicyReady(query){return !!(query?.displayEligible&&query?.referenceOnly);}
function preflopFrequencyHTML(result){const tones=actionTones(result.actions,state.hand);return (result.offTree||result.chipEVStandIn||result.anteStandIn?'<p class="help">'+[result.offTree?'Approximate':'',result.chipEVStandIn?'Chip-EV chart · ICM not modelled':'',result.anteStandIn?'Chart ante differs':''].filter(Boolean).join(' · ')+'</p>':'')+'<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(toneLabel(a,tones[i]))+'</span><strong>'+(result.reference[i]===null?'Outside source tree':fmt(result.reference[i]*100,1)+'%')+'</strong></div>'+(result.reference[i]===null?'':'<div class="bar"><i style="width:'+result.reference[i]*100+'%;background:var(--act-'+tones[i]+')"></i></div>')+'</div>').join('')+'</div>';}
function preflopResultHTML(result,grade=null){return '<section class="spot-solution"><h3>Preflop source reference</h3>'+preflopFrequencyHTML(result)+spotRangesHTML(result)+(grade?'<p>Your choice '+(grade.referenceFrequency===null?'falls outside the source tree and is ungraded.':'has '+fmt(grade.referenceFrequency*100,1)+'% frequency in this source.')+'</p>':'')+'</section>';}
function referenceChoiceGrade(result,pending){const a=T.matchAction(result.actions,pending.action),h=pending.hand;if(a<0)return null;const frequency=result.reference[a],row={id:id('g'),createdAt:new Date().toISOString(),source:pending.kind,variant:h.config.variant,mode:h.config.mode,street:0,position:G.positions(h.n,h.button)[h.actor],hand:h.holes[h.actor].map(C.cardName).join(''),action:result.actions[a].label,loss:null,lossSE:null,estimatedLoss:null,estimatedLossSE:null,rated:false,referenceFrequency:frequency,referenceSource:result.referenceSource,...result.offTree?{approximate:true}:{},evidenceVersion:5,evidenceReasons:['Reference frequency only; no source EV values.'],units:result.units,config:h.config,actions:h.actionLog,hero:h.actor,board:''};state.grades.unshift(row);playGrade(row,pending);dbPut('grades',row).catch(()=>{});renderProgress();return row;}
async function persistPreflop(){await dbPut('meta',{id:'preflopReferences-v1',value:preflopLibrary.packs.filter(p=>!memoryOnly.has(p)).map(p=>PokerPreflop.serialize(p,true))});await dbPut('meta',{id:'preflopPreferred-v1',value:preflopLibrary.preferred?{name:preflopLibrary.preferred.name,family:preflopLibrary.preferred.family}:null});}
function renderPreflopLibrary(){const select=$('preflopCollection');if(!select)return;const old=select.value;select.innerHTML=preflopLibrary.packs.map((p,i)=>'<option value="'+i+'">'+esc(p.name)+' · '+p.config.seats+' seats · '+p.nodes.length+' spots</option>').join('');if(preflopLibrary.preferred&&preflopLibrary.packs.includes(preflopLibrary.preferred))select.value=String(preflopLibrary.packs.indexOf(preflopLibrary.preferred));else if([...select.options].some(o=>o.value===old))select.value=old;for(const id of ['usePreflop','removePreflop','exportPreflop'])$(id).disabled=!preflopLibrary.packs.length;$('preflopCoverage').textContent=preflopLibrary.packs.length?preflopLibrary.packs.reduce((s,p)=>s+p.nodes.length,0)+' source decision nodes loaded. Only exact matching games and betting lines receive reference frequencies.':'No sourced preflop references loaded. Included self-play blueprints are used by practice opponents and do not supply solver advice.';}
async function addPreflopPack(input,keepNewer=false){return(await addPreflopPacks([input],keepNewer))[0];}
// A bundle file holds many packs; they are validated first and saved together.
// keepNewer (file imports): a chart already loaded with a later source date is kept, so an old bundle cannot replace the built-in charts.
async function addPreflopPacks(inputs,keepNewer=false){const made=t=>Date.parse(t?.source?.createdAt)||0,packs=inputs.map(PokerPreflop.validate).filter(pack=>!keepNewer||!(made(preflopLibrary.packs.find(p=>p.name===pack.name&&p.family===pack.family))>made(pack)));if(!packs.length)return packs;for(const pack of packs){const old=preflopLibrary.packs.findIndex(p=>p.name===pack.name&&p.family===pack.family);if(old>=0)preflopLibrary.packs[old]=pack;else preflopLibrary.packs.unshift(pack);}preflopLibrary.preferred=packs.length===1?packs[0]:null;await persistPreflop();spotUI.last=null;renderPreflopLibrary();renderPlay();renderRanges();return packs;}
function restorePreflop(meta){try{const rows=meta.find(x=>x.id==='preflopReferences-v1')?.value||[];for(const row of rows)try{preflopLibrary.packs.push(PokerPreflop.validate(row,true))}catch{}const selected=meta.find(x=>x.id==='preflopPreferred-v1')?.value;preflopLibrary.preferred=preflopLibrary.packs.find(p=>p.name===selected?.name&&p.family===selected?.family)||null;preflopLibrary.ready=true;renderPreflopLibrary();}catch{}try{for(const row of meta.find(x=>x.id==='postflopLibraries-v1')?.value||[])postflopLibrary.libraries.push(PokerPostflopLibrary.validate(row));renderPostflopLibrary();}catch{}}
// The bundled libraries unpack to about 260 MB, which crashes a phone or tablet tab, so those devices skip them.
function smallMemoryDevice(){const n=navigator;return /iPhone|iPad|iPod|Android/i.test(n.userAgent)||(n.platform==='MacIntel'&&n.maxTouchPoints>1)||(n.deviceMemory>0&&n.deviceMemory<8);}
// Removes bundled libraries an earlier version stored, before they are restored: anything the bundle record lists (they are now fetched
// on each launch and kept in memory) and, on a small device, the whole 256-pack chart bundle.
function dropStoredBundle(meta){
 const row=id=>meta.find(x=>x?.id===id),record=row('bundledLibraries-v1')?.value,pre=row('preflopReferences-v1'),post=row('postflopLibraries-v1'),bundled=/\(Range Lab CFR\+ model(, approximate)?\)$/;
 const listed=new Set((record?.preflop||[]).map(p=>p.name)),looksBundled=smallMemoryDevice()&&(pre?.value||[]).filter(p=>bundled.test(p?.name)).length>=100;
 if(!record&&!looksBundled)return;const writes=[];
 if(pre?.value){const keep=pre.value.filter(p=>!listed.has(p?.name)&&!(looksBundled&&bundled.test(p?.name)));if(keep.length<pre.value.length){pre.value=keep;writes.push(pre);}}
 if(post?.value){const names=new Set(record?.postflop||['Range Lab postflop library','Range Lab PLO postflop library']),keep=post.value.filter(l=>!names.has(l?.name));if(keep.length<post.value.length){post.value=keep;writes.push(post);}}
 if(record)writes.push({id:'bundledLibraries-v1',value:null});for(const w of writes)dbPut('meta',w).catch(()=>{});
}
// The site serves the current chart and flop libraries (studio/libraries: one file per chart
// pack and per flop spot, listed in manifest.json; tools/split-libraries.cjs writes them).
// Desktops fetch them all on each launch, nearest the current game first, and keep them in memory only:
// the browser cache revalidates unchanged files, and nothing large is written to or read back from the database.
// Phones and tablets download single files instead.
const fetchLibraryFile=async file=>{const url='libraries/'+file.split('/').map(encodeURIComponent).join('/'),r=await fetch(url,{cache:'no-cache'}).catch(()=>fetch(url,{cache:'force-cache'}));if(!r.ok)throw Error('Missing '+file);return JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text());};
let bundleManifest=null,bundleLoading=false;
// True while the built-in charts are still arriving, so a missing chart is not yet a real answer.
function chartsLoading(){return bundleLoading||phoneFetches.size>0;}
async function loadBundledLibraries(){
 if(!/^https?:$/.test(location.protocol)||typeof DecompressionStream!=='function')return;
 bundleLoading=true;
 try{
  const manifest=await fetch('libraries/manifest.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(!manifest?.version||!Array.isArray(manifest.packs)||!Array.isArray(manifest.flops))return;
  if(smallMemoryDevice()){bundleManifest=manifest;renderBundleDownloads();return;}
  const c=state.config||{},stack=Math.max(...(c.stacks||[100])),mode=c.mode==='cash'?'cash':'icm',score=p=>(p.variant===c.variant?0:1e6)+(p.mode===mode?0:1e5)+(p.seats===c.seats?0:1e4)+Math.abs(Math.log(p.stack/stack));
  const order=manifest.packs.slice().sort((a,b)=>score(a)-score(b)),has=p=>preflopLibrary.packs.some(x=>x.name===p.name&&x.family===p.family);
  for(let i=0;i<order.length;i+=8){
   for(const input of await Promise.all(order.slice(i,i+8).map(p=>fetchLibraryFile(p.file).catch(()=>null))))try{const pack=PokerPreflop.validate(input);if(!has(pack)){memoryOnly.add(pack);preflopLibrary.packs.push(pack);}}catch{}
   if(!i){spotUI.last=null;renderPlay();}await new Promise(r=>setTimeout(r));
  }
  const libs=new Map();for(const part of await Promise.all(manifest.flops.map(f=>fetchLibraryFile(f.file).catch(()=>null))))if(part){const lib=libs.get(part.name);if(lib)lib.spots.push(...part.spots);else libs.set(part.name,part);}
  for(const input of libs.values())try{if(postflopLibrary.libraries.some(l=>l.name===input.name))continue;const lib=PokerPostflopLibrary.validate(input);memoryOnly.add(lib);postflopLibrary.libraries.push(lib);}catch{}
  renderPreflopLibrary();renderPostflopLibrary();renderRanges();
 }finally{bundleLoading=false;spotUI.last=null;renderPlay();}
}
// Phones and tablets fetch what the current hand needs instead: the chart for this game and, at the flop,
// the flop spot of this hand's preflop line (about 1 MB). Both stay in memory only, so nothing is written
// to the device, and the flop spot is dropped once its hand is over. At most two charts are kept.
const memoryOnly=new WeakSet(),phoneFetches=new Map();
function phoneFetch(file){if(!phoneFetches.has(file))phoneFetches.set(file,fetchLibraryFile(file).finally(()=>phoneFetches.delete(file)));return phoneFetches.get(file);}
async function ensurePhoneLibraries(hand){
 const m=bundleManifest;if(!m||!hand)return false;let changed=false;
 const before=postflopLibrary.libraries.length;postflopLibrary.libraries=postflopLibrary.libraries.filter(l=>!memoryOnly.has(l)||l.forHand===hand&&!hand.done);if(postflopLibrary.libraries.length<before)changed=true;
 if(hand.done)return changed;
 try{
  // The chart nearest the effective stack between you and the deepest other live player, as PokerPreflop.nearest picks it.
  const c=hand.config,mode=c.mode==='cash'||!(c.ante>0)?'cash':'icm',others=hand.living().filter(i=>i!==hand.actor).map(i=>hand.initial[i]),stack=G.bb(others.length?Math.min(hand.initial[hand.actor],Math.max(...others)):Math.max(...hand.initial));
  const fit=m.packs.filter(p=>p.variant===c.variant&&p.mode===mode&&p.seats===c.seats).sort((a,b)=>Math.abs(Math.log(a.stack/stack))-Math.abs(Math.log(b.stack/stack)))[0];
  if(fit&&!preflopLibrary.packs.some(p=>p.name===fit.name&&p.config.seats===fit.seats)){const pack=PokerPreflop.validate(await phoneFetch(fit.file));memoryOnly.add(pack);const old=preflopLibrary.packs.filter(p=>memoryOnly.has(p));if(old.length>=2)preflopLibrary.packs.splice(preflopLibrary.packs.indexOf(old[0]),1);preflopLibrary.packs.push(pack);changed=true;}
  if(hand.street===1&&hand.living().length===2){
   const range=PokerPreflop.postflopRanges(preflopLibrary.packs,c,hand.actionLog),same=(a,b)=>String(a).replace(/Citrus Poker/g,'Range Lab')===String(b).replace(/Citrus Poker/g,'Range Lab');
   const have=new Set(postflopLibrary.libraries.flatMap(l=>l.spots.map(s=>l.name+'\n'+s.id)));
   for(const f of range?m.flops.filter(f=>f.chart&&f.chart.key===range.key&&same(f.chart.name,range.name)&&!have.has(f.library+'\n'+f.id)):[]){const lib=PokerPostflopLibrary.validate(await phoneFetch(f.file));if(state.hand!==hand||hand.done)break;lib.forHand=hand;memoryOnly.add(lib);postflopLibrary.libraries.push(lib);changed=true;}
  }
 }catch{}
 if(changed){spotUI.last=null;renderPostflopLibrary();}
 return changed;
}
// Phone and tablet downloads: one chart pack or flop spot at a time, defaulting to the current game.
function renderBundleDownloads(){
 const box=$('bundleDownloads'),m=bundleManifest;if(!box||!m)return;box.classList.remove('hide');const size=b=>b<1048576?Math.max(1,Math.round(b/1024))+' KB':fmt(b/1048576,1)+' MB';
 const c=state.config||{},stack=Math.max(...(c.stacks||[100])),mode=c.mode==='cash'||!(c.ante>0)?'cash':'icm',have=new Set(preflopLibrary.packs.map(p=>p.name)),haveSpots=new Set(postflopLibrary.libraries.flatMap(l=>l.spots.map(s=>l.name+'\n'+s.id)));
 const fit=m.packs.map((p,i)=>({i,score:(p.variant===c.variant?0:1e6)+(p.mode===mode?0:1e5)+(p.seats===c.seats?0:1e4)+Math.abs(Math.log(p.stack/stack))})).sort((a,b)=>a.score-b.score)[0];
 const pack=$('bundlePack'),flop=$('bundleFlop'),oldPack=pack.value,oldFlop=flop.value;
 pack.innerHTML=m.packs.map((p,i)=>'<option value="'+i+'">'+esc(p.name.replace(/ \(.*\)$/,''))+(have.has(p.name)?' · downloaded':' · '+size(p.bytes))+'</option>').join('');pack.value=oldPack||String(fit?.i??0);
 flop.innerHTML=m.flops.map((f,i)=>'<option value="'+i+'">'+esc(f.label)+(haveSpots.has(f.library+'\n'+f.id)?' · downloaded':' · '+size(f.bytes))+'</option>').join('');if(oldFlop)flop.value=oldFlop;
}
async function downloadBundleFile(kind){
 const m=bundleManifest,status=$('bundleDownloadStatus');if(!m)return;const item=kind==='pack'?m.packs[+$('bundlePack').value]:m.flops[+$('bundleFlop').value];if(!item)return;
 for(const id of ['downloadBundlePack','downloadBundleFlop'])$(id).disabled=true;status.textContent='Downloading '+(item.label||item.name)+'…';
 try{const input=await fetchLibraryFile(item.file);if(kind==='pack'){const preferred=preflopLibrary.preferred;await addPreflopPacks([input]);preflopLibrary.preferred=preferred&&preflopLibrary.packs.includes(preferred)?preferred:null;await persistPreflop();}else await addPostflopLibrary(input,true);status.textContent='Downloaded '+(item.label||item.name)+'.';spotUI.last=null;renderPlay();renderRanges();}
 catch(error){status.textContent='Download failed: '+error.message;}
 finally{for(const id of ['downloadBundlePack','downloadBundleFlop'])$(id).disabled=false;renderBundleDownloads();}
}
function referenceQuizQuestion(filters){
 const candidates=[];for(const pack of preflopLibrary.packs)for(const node of pack.nodes){const config=pack.config,labels=G.positions(config.seats),hero=node.seat;if(!['any','NLH'].includes(filters.quizVariant)||!['any',config.mode].includes(filters.quizFormat)||filters.quizSeats!=='any'&&+filters.quizSeats!==config.seats||!quizPositionMatches(labels[hero],filters.quizPosition)||!quizStackMatches(quizEffective(config,hero),filters.quizStack)||filters.quizStart!=='full'&&!['any','0'].includes(filters.quizStreet)||filters.quizStart==='full'&&node.history.some(e=>e.seat===hero))continue;const h=new G.Hand(config);for(const e of node.history)h.act({kind:e.kind,target:e.to===undefined?undefined:G.units(e.to)});if(quizTopicMatches(h,filters.quizStart==='full'?'any':filters.quizTopic))candidates.push({pack,hand:h,hero});}
 if(!candidates.length)return null;const {pack,hand,hero}=candidates[Math.floor(Math.random()*candidates.length)],model=new T.Model(pack.config,state.abstraction);return{hand,hero,answered:false,model,snapshot:model.snapshot(),sourceName:pack.name,referencePack:pack,filters};
}
function exactStudyQuestion(filters=null){
 const config=G.normalize({variant:'NLH',seats:2,stacks:[100,100],mode:'cash'}),rangeTexts=['AsAh,KsKh,QcQh,AcKc','AdAc,KdKc,QdQs,AhKh'],ranges=rangeTexts.map(t=>t.split(',').map(C.cards));let holes;do{holes=ranges.map(rs=>rs[Math.floor(Math.random()*rs.length)]);}while(holes[0].some(c=>holes[1].includes(c)));
 const hand=new G.Hand(config,{holes,runout:'2c7dJh9s'});hand.act({kind:'raise',target:250});hand.act({kind:'call'});hand.act({kind:'check'});hand.act({kind:'check'});let hero=1;
 if(filters){if(!['any','NLH'].includes(filters.quizVariant)||!['any','cash'].includes(filters.quizFormat)||!['any','2'].includes(filters.quizSeats)||!quizStackMatches(100,filters.quizStack)||filters.quizStart==='full'||!['any','2','3'].includes(filters.quizStreet)||['firstin','vsopen','vs3bet'].includes(filters.quizTopic))return null;if(filters.quizStreet==='3'){hand.act({kind:'check'});hand.act({kind:'check'});}if(['BTN','SB'].includes(filters.quizPosition)||['vsbet','allin'].includes(filters.quizTopic)){hand.act(['vsbet','allin'].includes(filters.quizTopic)?{kind:'bet',target:filters.quizTopic==='allin'?hand.legal().allInTo:250}:{kind:'check'});hero=0;}if(!quizPositionMatches(G.positions(2)[hero],filters.quizPosition)||!quizTopicMatches(hand,filters.quizTopic))return null;}
 const abstraction={...state.abstraction,maxAggressions:1,...state.spotSizing},model=new T.Model(config,abstraction),solveOptions=PokerSpot.options({ranges:rangeTexts,iterations:50000,milliseconds:45000,maxInfos:150000,abstraction});return{hand,hero,answered:false,model,snapshot:model.snapshot(),sourceName:'Exact heads-up study · specified current ranges',filters:filters||quizFilters(),solveOptions,rangeAnchor:hand.actionLog.length};
}
function useExactStudy(){if(state.busy)return;const auto=state.autoAnalyze;state.autoAnalyze=false;const question=exactStudyQuestion();stopTableMotion();writeForm(question.hand.config,question.model.abstraction);state.hero=question.hero;$('hero').value=String(question.hero);$('heroCards').value='';markDirty();applySetup(false,false);state.hand=question.hand;state.config=question.hand.config;state.abstraction=question.model.abstraction;setModel(question.snapshot);state.handSaved=false;state.currentGrades=[];state.hero=question.hero;saveLiveSession();renderAll();for(let i=0;i<2;i++){const el=$('spotRange-'+i);el.value=question.solveOptions.ranges[i];spotUI.rangeValues[i]=el.value;}switchTab('play');analyzeSpot(state.hand,{kind:'inspect'});state.autoAnalyze=auto;}
function captureReferenceNode(){const h=state.hand;if(!h||h.done||h.street!==0)throw Error('Reach an open preflop decision at the table first.');const hand=h.clone(),baseline=hand.legal().check?'check':'fold',actions=G.modelActions(hand,state.abstraction);preflopLibrary.captured={hand,actions,baseline};$('referenceActionRanges').innerHTML=actions.map((a,i)=>a.kind===baseline?'':'<div class="field wide"><label><input type="checkbox" data-reference-include="'+i+'"> '+esc(a.label)+' is included in the source solve</label><textarea class="input" data-reference-range="'+i+'" placeholder="Paste the exported hand frequencies for this action"></textarea></div>').join('');$('referenceCaptureStatus').textContent=h.n+' seats · '+G.positions(h.n,h.button)[h.actor]+' · '+h.actionLog.length+' previous actions · '+hand.config.stacks.map(x=>fmt(x)+' bb').join(', ')+'. Remaining frequency goes to '+baseline+'.';$('saveReferenceNode').disabled=false;}
async function saveCapturedReference(){const capture=preflopLibrary.captured;if(!capture)throw Error('Capture a preflop decision first.');const h=capture.hand,n=h.n,relative=i=>(i-h.button+n)%n,config={...h.config,button:0,stacks:Array.from({length:n},(_,i)=>h.config.stacks[(h.button+i)%n]),bounties:Array.from({length:n},(_,i)=>h.config.bounties[(h.button+i)%n])},baseline=capture.actions.find(a=>a.kind===capture.baseline),actions=[baseline],ranges=[];
 for(const el of $('referenceActionRanges').querySelectorAll('[data-reference-include]'))if(el.checked){const i=+el.dataset.referenceInclude,a=capture.actions[i],input=$('referenceActionRanges').querySelector('[data-reference-range="'+i+'"]'),text=input.value.trim();if(!text)throw Error('Paste the source range for '+a.label+', or deselect that action.');const rows=PokerSpot.parseRange(text,h.rules,[]);if(!rows)throw Error('Use an explicit exported range, rather than an automatic range.');actions.push(a);ranges.push(new Map(rows.map(r=>[r.key,r.weight])));}
 if(actions.length<2)throw Error('Select and enter at least one source action range.');const strategy={};for(const cards of G.combinations(Array.from({length:52},(_,i)=>i),2)){const key=cards.slice().sort((a,b)=>a-b).join('.'),values=ranges.map(m=>m.get(key)||0),total=values.reduce((s,x)=>s+x,0);if(total>1+1e-6)throw Error('The imported actions exceed 100% for '+cards.map(C.cardName).join('')+'. Check that the source frequencies are conditional on reaching this node.');strategy[cards.map(C.cardName).join('')]=[Math.max(0,1-total),...values];}
 const source={name:$('referenceSourceName').value,url:$('referenceUrl').value,solver:$('referenceSolver').value,settings:$('referenceSettings').value,createdAt:$('referenceDate').value},name=$('referenceName').value,node={seat:relative(h.actor),history:h.actionLog.map(e=>({seat:relative(e.seat),kind:e.kind,...e.kind==='raise'||e.kind==='bet'?{to:G.bb(e.target)}:{}})),actions:actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:G.bb(a.target)}:{}})),strategy},existing=preflopLibrary.packs.find(p=>p.name===name&&p.family===G.familyId(config));const nodes=existing?PokerPreflop.serialize(existing).nodes.filter(x=>JSON.stringify(x.history)!==JSON.stringify(node.history)):[];nodes.push(node);return addPreflopPack({format:PokerPreflop.FORMAT,name,source,config,nodes});
}
function initPreflopReferences(){renderPreflopLibrary();$('downloadBundlePack').onclick=()=>downloadBundleFile('pack');$('downloadBundleFlop').onclick=()=>downloadBundleFile('flop');$('preflopCollection').onchange=()=>{preflopLibrary.preferred=preflopLibrary.packs[+$('preflopCollection').value]||null;persistPreflop().catch(()=>{});spotUI.last=null;renderPlay();renderRanges();};$('tryExactStudy').onclick=useExactStudy;$('quizExactStudy').onclick=()=>{if(state.busy)return;stopTableMotion();cancelQuizGeneration();clearQuizQuestion();for(const [id,value]of Object.entries({quizStart:'spot',quizEvidence:'matched',quizVariant:'NLH',quizFormat:'cash',quizSeats:'2',quizStack:'deep',quizPosition:'any',quizStreet:'2',quizTopic:'betcheck'}))$(id).value=value;saveQuizFilters();syncQuizFilters();state.quiz=exactStudyQuestion(quizFilters());prepareQuizSpot(state.quiz);};$('importPreflop').onclick=()=>$('preflopFile').click();$('preflopFile').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>200*1024*1024)throw Error('Reference files must be smaller than 200 MB.');if(/\.ctl$/i.test(file.name)){$('preflopImportStatus').textContent='Saving the turn library…';const spot=await addTurnLibrary(new Uint8Array(await file.arrayBuffer()));$('preflopImportStatus').textContent='Loaded turn strategies for '+spot.label+': '+spot.flops.length+' flops. Turn decisions on that line now come from it.';return;}const gz=/\.gz$/i.test(file.name);if(gz&&typeof DecompressionStream!=='function')throw Error('This browser cannot open .gz files; unzip it first.');const input=await(gz?new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text():file.text()).then(JSON.parse).catch(()=>{throw Error('This file is damaged or is not a chart file.')});if(input?.format===PokerPostflopLibrary.FORMAT){const lib=await addPostflopLibrary(input);$('preflopImportStatus').textContent='Loaded '+lib.name+': '+lib.spots.map(s=>Object.keys(s.flops).length+' flops for '+s.label).join('; ')+'.';}else if(input?.format==='range-lab-preflop-bundle-v1'){if(!Array.isArray(input.packs)||!input.packs.length||input.packs.length>500)throw Error('This chart bundle has no charts.');$('preflopImportStatus').textContent='Checking '+input.packs.length+' charts…';const packs=await addPreflopPacks(input.packs,true),kept=input.packs.length-packs.length;$('preflopImportStatus').textContent='Loaded '+packs.length+' charts from '+String(input.name||'the bundle')+'. '+(kept?'Kept '+kept+' newer charts already loaded.':'Each hand uses the chart for its game, table size and nearest stack depth.');}else{const pack=await addPreflopPack(input,true);$('preflopImportStatus').textContent=pack?'Loaded '+pack.name+' with '+pack.nodes.length+' decision nodes.':'A newer version of '+String(input.name)+' is already loaded.';}}catch(error){$('preflopImportStatus').textContent=error.message;}finally{event.target.value='';}};$('captureReference').onclick=()=>{try{captureReferenceNode()}catch(error){$('preflopImportStatus').textContent=error.message}};$('saveReferenceNode').onclick=async()=>{try{const p=await saveCapturedReference();$('preflopImportStatus').textContent='Saved '+p.name+'. Its source frequencies apply at exactly matching decisions.';}catch(error){$('preflopImportStatus').textContent=error.message}};$('exportPreflop').onclick=()=>{const p=preflopLibrary.packs[+$('preflopCollection').value];if(p)exportJSON(PokerPreflop.serialize(p),'preflop-reference.json')};$('usePreflop').onclick=()=>{if(state.busy)return;const p=preflopLibrary.packs[+$('preflopCollection').value];if(!p)return;preflopLibrary.preferred=p;persistPreflop().catch(()=>{});writeForm(p.config,state.abstraction);state.hero=0;$('heroCards').value='';markDirty();applySetup(false,true);switchTab('play');};$('removePreflop').onclick=async()=>{if(state.busy)return;const removed=preflopLibrary.packs.splice(+$('preflopCollection').value,1)[0];if(preflopLibrary.preferred===removed)preflopLibrary.preferred=null;await persistPreflop();spotUI.last=null;renderPreflopLibrary();renderPlay();renderRanges();};}
