'use strict';
// Shared code for the chart bots: loading a chart library the way the app does, rebuilding each
// chart's own payoff model (tools/preflop tree + realization model) and filling it with the
// chart's frequencies, so values and best responses are computed in the same game the chart
// was solved for. Nothing here solves anything: strategies are read, never updated.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=path.join(__dirname,'..','..');
const G=require(path.join(ROOT,'studio','game.js'));
const P=require(path.join(ROOT,'studio','preflop.js'));
const PL=require(path.join(ROOT,'studio','postflop-library.js'));
const {Solver,PLAY}=require(path.join(ROOT,'tools','preflop','solve.cjs'));
const E=require(path.join(ROOT,'tools','preflop','export.cjs'));
const DEFAULT_MANIFEST=path.join(ROOT,'studio','libraries','manifest.json');

// ---------- command line ----------
// --key value pairs; a flag with no value (or followed by another --flag) is true.
function parseArgs(argv,defaults={}){
 const out={...defaults};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(!a.startsWith('--'))throw Error('Unexpected argument '+a);
  const k=a.slice(2),v=argv[i+1];
  if(v===undefined||v.startsWith('--')){out[k]=true;continue;}
  out[k]=/^-?\d+(\.\d+)?$/.test(v)?Number(v):v;i++;
 }
 return out;
}
const list=v=>v===undefined||v===true||v===''?null:String(v).split(',').map(s=>s.trim()).filter(Boolean);
function range(v){if(v===undefined||v===true)return null;const out=new Set();for(const part of String(v).split(',')){const [a,b]=part.split('-').map(Number);for(let x=a;x<=(b??a);x++)out.add(x);}return out;}

// Seeded generator (mulberry32), separate from the app's dealing generator.
function rng(seed){let a=seed>>>0||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function sample(probs,u){let s=0;for(let i=0;i<probs.length;i++){s+=probs[i];if(u<s)return i;}return probs.length-1;}

const readJSON=f=>JSON.parse((/\.gz$/.test(f)?zlib.gunzipSync(fs.readFileSync(f)):fs.readFileSync(f)).toString('utf8'));

// ---------- library loading ----------
// spec: a manifest.json, a folder holding one (or packs/ and flops/ folders), or bundle files
// (range-lab-preflop-bundle-v1 / range-lab-postflop-library-v1), comma-separated.
function openLibrary(spec){
 spec=spec||DEFAULT_MANIFEST;
 const files=String(spec).split(',').map(s=>path.resolve(s));
 const lib={spec:files.join(','),version:null,packs:[],flops:[],cache:new Map()};
 for(let f of files){
  if(fs.statSync(f).isDirectory()){
   const m=path.join(f,'manifest.json');
   if(fs.existsSync(m))f=m;
   else{
    lib.version=lib.version||path.basename(f);
    for(const [dir,kind] of [['packs','pack'],['flops','flop']]){const d=path.join(f,dir);if(!fs.existsSync(d))continue;
     for(const name of fs.readdirSync(d).filter(x=>/\.json(\.gz)?$/.test(x)).sort())addFile(path.join(d,name),kind);}
    continue;
   }
  }
  const data=readJSON(f);
  if(Array.isArray(data.packs)&&data.packs.every(p=>p&&typeof p.file==='string')){
   const base=path.dirname(f);lib.version=lib.version||data.version||path.basename(base);
   for(const p of data.packs)lib.packs.push({...p,path:path.join(base,p.file)});
   for(const x of data.flops||[])lib.flops.push({...x,path:path.join(base,x.file)});
  }else if(data.format==='range-lab-preflop-bundle-v1'){lib.version=lib.version||path.basename(f).replace(/\.json(\.gz)?$/,'');for(const raw of data.packs)lib.packs.push(metaOf(raw,null,raw));}
  else if(data.format===P.FORMAT){lib.version=lib.version||path.basename(f);lib.packs.push(metaOf(data,f,data));}
  else if(data.format===PL.FORMAT){lib.version=lib.version||path.basename(f);for(const s of data.spots)lib.flops.push({library:data.name,id:s.id,label:s.label,chart:s.chart,path:f,inline:{...data,spots:[s]}});}
  else throw Error('Not a chart library: '+f);
 }
 function addFile(file,kind){
  const data=readJSON(file);
  if(kind==='pack'&&data.format===P.FORMAT)lib.packs.push(metaOf(data,file,data));
  else if(data.format===PL.FORMAT)for(const s of data.spots)lib.flops.push({library:data.name,id:s.id,label:s.label,chart:s.chart,path:file,inline:{...data,spots:[s]}});
 }
 lib.version=String(lib.version||'unknown').replace(/[^\w.-]+/g,'-');
 return lib;
}
function metaOf(raw,file,inline){const c=raw.config;return{name:raw.name,variant:c.variant,mode:c.mode,seats:c.seats,stack:Math.max(...c.stacks),path:file,inline,rake:c.rakePct||0};}
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const packId=m=>`${m.variant==='PLO4'?'plo':'nlh'}-${m.mode==='icm'?'mtt':'cash'}-${m.seats}max-${m.stack}bb${m.rake?'-rake'+m.rake:''}`;

// Filters: games (nlh,plo), modes (cash,mtt), seats (2-9), depths (100,200), packs (ids).
function selectPacks(lib,o={}){
 const games=list(o.games),modes=list(o.modes),seats=range(o.seats),depths=list(o.depths)?.map(Number),ids=list(o.packs);
 return lib.packs.filter(m=>(!games||games.includes(m.variant==='PLO4'?'plo':'nlh'))&&(!modes||modes.includes(m.mode==='icm'?'mtt':'cash'))&&(!seats||seats.has(m.seats))&&(!depths||depths.includes(m.stack))&&(!ids||ids.some(id=>packId(m)===id||m.name===id)));
}
// Raw JSON and the app's validated pack (PokerPreflop.validate, as the app loads it).
function loadPack(lib,meta){
 if(lib.cache.has(meta))return lib.cache.get(meta);
 const raw=meta.inline||readJSON(meta.path),pack=P.validate(raw),out={meta,raw,pack,id:packId(meta)};
 lib.cache.set(meta,out);return out;
}
// Flop libraries merged by name and validated, as references-ui.js loadBundledLibraries does.
function loadFlops(lib,filter=()=>true){
 const byName=new Map();
 for(const f of lib.flops.filter(filter)){const part=f.inline||readJSON(f.path);for(const s of part.spots){const l=byName.get(part.name);if(l)l.spots.push(s);else byName.set(part.name,{...part,spots:[s]});}}
 return[...byName.values()].map(l=>PL.validate(l));
}

// ---------- the chart's own payoff model ----------
// Rebuilds the tools/preflop game a pack was exported from: tree sizes and realization
// settings are read back from the pack's settings text (export.cjs writes them), so a v6
// library with other settings is modelled with its own. Per-class calibrated playability is
// not stored in packs: pass --calibration file.json, or the shape rule stands in (noted).
function modelOptions(raw,{calibration=null,override={}}={}){
 const c=raw.config,s=raw.source?.settings||'',notes=[];
 const spec={seats:c.seats,stack:Math.max(...c.stacks),format:c.mode==='icm'?'mtt':'cash',game:c.variant==='PLO4'?'plo':'nlh',rake:c.rakePct||0,rakeCap:c.rakeCap??3,limp:/small blind completing/.test(s)?1:0,calibration:c.variant==='PLO4'?null:calibration};
 const o=E.game(spec);const num=(re,f)=>{const m=s.match(re);if(m)f(m.map(Number),m);return!!m;};
 num(/open ([\d.]+)bb \(SB ([\d.]+)bb\), 3-bet ([\d.]+)x in position or ([\d.]+)x from the blinds plus ([\d.]+)x per caller, 4-bet ([\d.]+)x(?:, 5-bet ([\d.]+)x)?/,m=>{o.open=m[1];o.sbOpen=m[2];o.threeBetIP=m[3];o.threeBetOOP=m[4];o.squeezePerCaller=m[5];o.fourBet=m[6];if(m[7])o.fiveBet=m[7];});
 num(/raise to ([\d.]+)% of the stack or more is all-in/,m=>o.jamShare=m[1]/100);
 num(/raises to ([\d.]+)bb\)/,m=>o.isoRaise=m[1]);
 num(/a call that leaves under ([\d.]+)x the pot behind/,m=>o.callSPR=m[1]);
 num(/grew ([\d.]+)x by the river/,m=>o.rakeGrowth=m[1]);
 num(/stack-to-pot ratio falls from ([\d.]+) to ([\d.]+)/,m=>{o.flopSPR=m[1];o.allInSPR=m[2];});
 const main=s.match(/flop pots pay an equity-realization share \(odds to the power ([\d.]+), in position x([\d.]+), out of position x([\d.]+), last raiser x([\d.]+), playability (\{[^}]*\}|by hand shape|per hand class, calibrated to [^;)]*)/);
 if(main){o.sharpness=+main[1];o.realization=+(main[2]-1).toFixed(6);o.initiative=+(main[4]-1).toFixed(6);
  if(main[5].startsWith('{'))o.playability=JSON.parse(main[5]);
  else if(/calibrated/.test(main[5])&&!o.playTable)notes.push('Pack is calibrated per hand class, but the calibration file is not in the pack; pass --calibration to model it exactly. The shape playability rule stands in, so EVs and gains are approximate.');}
 else notes.push('Settings text has no realization clause; tools/preflop defaults assumed.');
 const re=s.match(/3-bet pots and bigger have their own fit \(odds to the power ([\d.]+), in position x([\d.]+), out of position x([\d.]+), last raiser x([\d.]+)/);
 if(re)o.reraised={...(o.reraised||{}),sharpness:+re[1],realization:+(re[2]-1).toFixed(6),initiative:+(re[4]-1).toFixed(6)};
 const nc=s.match(/NashConv ([\d.]+) bb\/hand/);
 return{options:{...o,...override},claimedNashConv:nc?+nc[1]:null,notes};
}
const hkey=h=>h.map(e=>e.seat+e.kind[0]+(e.kind==='raise'?e.to:'')).join('/');
// A Solver over the chart's game with every node's averaged strategy set to the chart's rows.
function buildModel(raw,opts={}){
 const {options,claimedNashConv,notes}=modelOptions(raw,opts),S=new Solver(options),K=S.K,byKey=new Map();
 for(const n of raw.nodes)byKey.set(hkey(n.history),n);
 const unmatched=[],used=new Set();
 for(const node of S.tree.nodes){
  const r=byKey.get(hkey(node.history));node.sum.fill(0);
  const same=r&&r.actions.length===node.actions.length&&r.actions.every((a,i)=>a.kind===node.actions[i].kind&&(a.kind!=='raise'||Math.abs(a.to-node.actions[i].to)<1e-6));
  if(!same){unmatched.push(hkey(node.history));node.sum.fill(1);continue;}
  used.add(r);const A=node.actions.length,labels=S.m.classes;
  for(let i=0;i<K;i++){
   const row=Array.isArray(r.strategy)?r.strategy[i]:r.strategy[labels[i]];
   if(Number.isInteger(row))node.sum[row*K+i]=1;else if(Array.isArray(row)){const t=row.reduce((a,b)=>a+b,0)||1;for(let a=0;a<A;a++)node.sum[a*K+i]=row[a]/t;}else for(let a=0;a<A;a++)node.sum[a*K+i]=1;
  }
  node.chartReach=r.reach;
 }
 const extra=raw.nodes.filter(n=>!used.has(n)).map(n=>hkey(n.history));
 if(unmatched.length)notes.push(`${unmatched.length} tree nodes have no matching chart node (played uniformly here); the rebuilt tree may differ from the chart's.`);
 if(extra.length)notes.push(`${extra.length} chart nodes are not in the rebuilt tree.`);
 S.byId=S.tree.nodes;return{solver:S,options,claimedNashConv,notes,unmatched,extra,K,classes:S.m.classes,weight:S.m.weight};
}
// A copy of a model with other realization settings (same tree, same chart rows).
function variantModel(base,override){
 const S=new Solver({...base.options,...override});
 S.tree.nodes.forEach((n,i)=>{n.sum.set(base.solver.tree.nodes[i].sum);n.chartReach=base.solver.tree.nodes[i].chartReach;});
 return{...base,solver:S,options:S.o};
}

// Payoffs of a terminal of the tree for every seat, given each live seat's class index:
// the same formulas as solve.cjs terminal(), for one dealt hand instead of whole ranges.
function payoffs(S,t,cls){
 const out=t.inv.map(x=>-x);
 if(t.type==='fold'){out[t.winner]+=t.pot;return out;}
 const [ip,oop]=t.players,K=S.K,x=cls[ip]*K+cls[oop],c=S.M.C[x],M=t.raises>=2?S.M3:S.M;
 let e;
 if(!(c>0))e=.5;
 else if(t.type==='allin')e=S.M.allin[x]/c;
 else{e=(t.aggressor===oop?M.ipCaller:M.ip)[x]/c;if(t.commit)e+=t.commit*(S.M.allin[x]/c-e);}
 const pot=t.net??t.pot;out[ip]+=pot*e;out[oop]+=pot*(1-e);
 return out;
}

// Records each decision's per-action counterfactual values (for the acting player) during a
// value walk: the one-spot best-response values with everything else held at the chart.
function actionValues(S){
 const q=new Map(),orig=S.walk;
 S.walk=function(node,p,reach,mode){
  if(mode!=='value'||node.type!=='decision'||node.actor!==p)return orig.call(this,node,p,reach,mode);
  const K=this.K,A=node.actions.length,sigma=this.strategy(node,true),values=[],out=new Float64Array(K);
  for(let k=0;k<A;k++)values.push(this.walk(node.children[k],p,reach,mode));
  for(let k=0;k<A;k++)for(let i=0;i<K;i++)out[i]+=sigma[k*K+i]*values[k][i];
  let opp=1;for(let k=0;k<this.n;k++)if(k!==p&&reach[k]!==this.ones)opp*=this.mass(reach[k]);
  q.set(node.id,{values,mix:out,sigma,opp});return out;
 };
 const ev=[];for(let p=0;p<S.n;p++)ev.push(S.mass(S.walk(S.tree.root,p,Array(S.n).fill(S.ones),'value')));
 S.walk=orig;
 // Own reach of every class at every node, and the node's overall reach.
 const own=new Map(),line=new Map();
 E.lineReach(S,(node,reach,l)=>{own.set(node.id,reach[node.actor].slice());line.set(node.id,l);});
 return{q,ev,own,line};
}

// ---------- app-side helpers ----------
const SEAT_NAMES={2:['BTN','BB'],3:['BTN','SB','BB'],4:['BTN','SB','BB','CO'],5:['BTN','SB','BB','UTG','CO'],6:['BTN','SB','BB','UTG','HJ','CO'],7:['BTN','SB','BB','UTG','LJ','HJ','CO'],8:['BTN','SB','BB','UTG','UTG+1','LJ','HJ','CO'],9:['BTN','SB','BB','UTG','UTG+1','UTG+2','LJ','HJ','CO']};
const seatName=(n,s)=>SEAT_NAMES[n][s];
// A readable line: "UTG f, HJ r2.5, CO f, BTN c".
function lineText(n,history){const h=history.filter(e=>!e.auto);if(!h.length)return'first in';return h.map(e=>seatName(n,e.seat)+' '+(e.kind==='raise'?'r'+e.to:e.kind[0])).join(', ');}
// A spot name for a decision: who acts, against what.
function spotName(n,node){const h=node.history.filter(e=>!e.auto),raises=h.filter(e=>e.kind==='raise'),me=seatName(n,node.actor),firstRaise=h.findIndex(e=>e.kind==='raise'),limp=h.find((e,i)=>e.kind==='call'&&(firstRaise<0||i<firstRaise));
 if(!raises.length)return limp?`${me} vs ${seatName(n,limp.seat)} limp`:`${me} first in`;
 const k=raises.length-(limp?0:1),tag=(limp?['','iso-raise','3-bet','4-bet','5-bet','6-bet']:['open','3-bet','4-bet','5-bet','6-bet'])[k]||k+'-bet',last=raises[raises.length-1],li=h.lastIndexOf(last),calls=h.slice(h.indexOf(raises[0])).filter(e=>e.kind==='call');
 return`${me} vs ${seatName(n,last.seat)} ${last.to}bb ${tag}${limp?' after '+seatName(n,limp.seat)+' limp':''}${calls.length?' ('+calls.map(c=>seatName(n,c.seat)).join(',')+' called)':''}`;}
function actionText(a){return a.kind==='raise'?'raise '+a.to:a.kind;}
function classOf(pack,cards){return pack.groups?pack.groups.of[P.ploClasses().classOf(cards)]:P.classes.indexOf(G.Core.handClass(cards));}
function newHand(config,seed,holes){return new G.Hand(config,{rng:G.rng(seed),...holes?{holes}:{}});}
// Cards for a class (NLH), avoiding used cards.
function cardsFor(cls,used=[]){
 const r='AKQJT98765432',a=r.indexOf(cls[0]),b=r.indexOf(cls[1]),rank=i=>12-i,suitsets=cls.length===2?[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]:cls[2]==='s'?[[0,0],[1,1],[2,2],[3,3]]:[[0,1],[1,0],[0,2],[2,0],[1,2],[2,1],[0,3],[3,0],[1,3],[3,1],[2,3],[3,2]];
 for(const [s,t] of suitsets){const x=rank(a)*4+s,y=rank(b)*4+t;if(!used.includes(x)&&!used.includes(y))return[x,y];}
 return null;
}
const comboWeight=c=>c.length===2?6:c[2]==='s'?4:12;

// ---------- output ----------
function ensureDir(d){fs.mkdirSync(d,{recursive:true});return d;}
function writeOut(dir,name,{json,md}){ensureDir(dir);if(json!==undefined)fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(json,null,1));if(md!==undefined)fs.writeFileSync(path.join(dir,name+'.md'),md);}
const f=(x,d=2)=>x===null||x===undefined||!Number.isFinite(x)?'–':(+x).toFixed(d);
const pct=(x,d=1)=>x===null||x===undefined||!Number.isFinite(x)?'–':(100*x).toFixed(d)+'%';
function mdTable(head,rows){return'| '+head.join(' | ')+' |\n|'+head.map(()=>'---').join('|')+'|\n'+rows.map(r=>'| '+r.join(' | ')+' |').join('\n')+'\n';}
function defaultOut(lib){return path.join(ROOT,'out','chart-bots',lib.version);}

// Runs fn over items in up to `jobs` child processes (each re-runs this script with --worker).
// Workers get their item list through an environment variable and print one JSON line each.
async function parallel(script,items,jobs,extraArgs=[]){
 const {spawn}=require('child_process');jobs=Math.max(1,Math.min(jobs,items.length));
 const chunks=Array.from({length:jobs},()=>[]);items.forEach((x,i)=>chunks[i%jobs].push(x));
 const results=await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,...extraArgs,'--worker','1'],{env:{...process.env,CHART_BOTS_ITEMS:JSON.stringify(chunk)},stdio:['ignore','pipe','inherit']});
  let out='';child.stdout.on('data',d=>out+=d);child.on('error',reject);
  child.on('close',code=>{if(code)return reject(Error(path.basename(script)+' worker exited '+code));resolve(out.split('\n').filter(Boolean).map(l=>JSON.parse(l)));});
 })));
 return results.flat();
}
const workerItems=()=>JSON.parse(process.env.CHART_BOTS_ITEMS||'[]');

module.exports={ROOT,G,P,PL,E,Solver,PLAY,DEFAULT_MANIFEST,parseArgs,list,range,rng,sample,readJSON,openLibrary,selectPacks,loadPack,loadFlops,packId,slug,modelOptions,buildModel,variantModel,payoffs,actionValues,seatName,lineText,spotName,actionText,classOf,newHand,cardsFor,comboWeight,ensureDir,writeOut,f,pct,mdTable,defaultOut,parallel,workerItems,hkey};
