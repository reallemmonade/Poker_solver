#!/usr/bin/env node
'use strict';
// Coverage report: which spots a user can reach in the app get an exact chart answer, a
// library answer, an approximate fallback, or nothing. Every lookup goes through the app's
// own code: PokerPreflop.query then PokerPreflop.nearest (as references-ui.js
// preflopReference does), and PokerPreflop.postflopRanges + PokerPostflopLibrary.query for
// flops.
//   exact        a chart node for this very game, depth and line (preflop)
//   library      a solved flop for this chart line, the same flop up to suits (postflop)
//   approximate  an answer with a stand-in: another depth, mapped raise sizes, a rake-free or
//                chip-EV chart (preflop); a stand-in flop of the same texture (postflop)
//   nothing      no chart or library answer; the app falls back to its live solver or bots
//   node tools/chart-bots/coverage.cjs [--library ...] [--seats 2-9] [--quick] [--jobs 4] [--out dir]
const path=require('path'),L=require('./lib.cjs');
const {G,P,PL}=L;

const DEPTHS=[10,15,20,25,30,40,50,60,75,100,125,150,200,250,300,400,500,750,1000,1500,2000];
const QUICK_DEPTHS=[20,30,100,300,2000];
const SIDE_DEPTHS=[10,20,30,50,100,200,300,1000];
const NLH_HANDS=['AA','AKs','KQs','TT','A5s','76s','KJo','55','Q9o','72o'];
const PLO_HANDS=['AsAhKsKh','KhQhJdTd','9s8s7d6d','AhKd7c2s','QsJh5d3c','7c7d7h2s'];
const TABLES={
 cash:n=>({mode:'cash'}),
 raked:n=>({mode:'cash',rakePct:5,rakeCap:3,noFlopNoDrop:true}),
 mtt:n=>({mode:'icm',ante:1,anteMode:'bigblind',payouts:n>=3?[50,30,20]:[65,35]}),
};
function config(variant,n,depth,kind){return G.normalize({variant,seats:n,stacks:Array(n).fill(depth),sb:.5,bb:1,button:0,...TABLES[kind](n)});}

// Preflop lines, as functions that drive a fresh hand to the decision being checked.
// Seats count from the button (0); order is first to act preflop.
function lineSpecs(n,variant){
 const [sb,bb]=n===2?[0,1]:[1,2],order=Array.from({length:n},(_,k)=>(bb+1+k)%n),plo=variant==='PLO4',out=[];
 const opens=plo?['pot']:[2,2.2,2.5,3],threes=plo?['pot']:[3,4,'jam'];
 const name=s=>L.seatName(n,s);
 for(let i=0;i<n-1;i++)out.push({type:'first in',label:`${name(order[i])} first in`,steps:[],actor:order[i]});
 if(order.includes(sb))out.push({type:'vs limp',label:`BB vs ${name(sb)} limp`,steps:[[sb,'call']],actor:bb});
 if(n>=4)out.push({type:'vs limp',label:`${name(order[1])} vs ${name(order[0])} open-limp`,steps:[[order[0],'call']],actor:order[1]});
 for(let i=0;i<n-1;i++){const o=order[i];
  for(let j=i+1;j<n;j++){const r=order[j];
   for(const s of opens)out.push({type:'vs open',size:s,label:`${name(r)} vs ${name(o)} ${s}${plo?'':'bb'} open`,steps:[[o,'raise',s]],actor:r});
   for(const t of threes)out.push({type:'vs 3-bet',size:t,label:`${name(o)} vs ${name(r)} ${t==='jam'?'all-in':t+'x'} 3-bet`,steps:[[o,'raise',plo?'pot':2.5],[r,'raise',plo?'pot':t==='jam'?'jam':{x:t}]],actor:o});
   if(!plo)out.push({type:'vs 4-bet',label:`${name(r)} vs ${name(o)} 4-bet`,steps:[[o,'raise',2.5],[r,'raise',{x:o===sb?4:r===sb||r===bb?4:3}],[o,'raise',{x:2.3}]],actor:r});
  }
  // A flat and a squeeze from the big blind, back to the opener.
  const c=order[i+1];if(c!==undefined&&c!==bb&&!plo)out.push({type:'vs squeeze',label:`${name(o)} vs BB squeeze (${name(c)} called)`,steps:[[o,'raise',2.5],[c,'call'],[bb,'raise',{x:5}]],actor:o});
  // An overcall spot: open, one flat, then the next player.
  if(c!==undefined&&order[i+2]!==undefined&&!plo)out.push({type:'vs open+call',label:`${name(order[i+2])} vs ${name(o)} open and ${name(c)} call`,steps:[[o,'raise',2.5],[c,'call']],actor:order[i+2]});
 }
 return out;
}
// Plays a spec on a hand: everyone not named folds (the big blind checks when it may).
function drive(hand,spec){
 const step=(seat,kind,size)=>{
  while(!hand.done&&hand.street===0&&hand.actor!==seat){const l=hand.legal();hand.act(l.check?{kind:'check'}:{kind:'fold'});}
  if(hand.done||hand.street!==0)throw Error('line ended early');
  if(kind!=='raise')return hand.act({kind:hand.legal().check?'check':kind});
  const l=hand.legal();let to;
  if(size==='pot')to=l.maxRaiseTo;else if(size==='jam')to=l.allInTo;else if(typeof size==='object')to=Math.round(hand.currentBet*size.x);else to=G.units(size);
  to=Math.max(l.minRaiseTo,Math.min(to,l.allInTo));hand.act({kind:'raise',target:to});
 };
 for(const [seat,kind,size] of spec.steps)step(seat,kind,size);
 while(!hand.done&&hand.street===0&&hand.actor!==spec.actor){const l=hand.legal();hand.act(l.check?{kind:'check'}:{kind:'fold'});}
 return !hand.done&&hand.street===0&&hand.actor===spec.actor;
}
// The app's preflop answer (references-ui.js preflopReference without a preferred chart).
function preflopStatus(packs,hand){
 for(const pack of packs){const q=P.query(pack,hand);if(q)return{status:'exact',chart:pack.name};}
 const r=P.nearest(packs,hand);if(!r)return{status:'nothing'};
 const flags=[];if(r.depthMatch?.depthDiffers)flags.push('depth '+r.depthMatch.chart+'bb');if(r.sizeMatch)flags.push('sizes '+r.sizeMatch.map(m=>m.actual+'→'+m.chart).join(','));if(r.rakeStandIn)flags.push('rake-free chart');if(r.chipEVStandIn)flags.push('chip-EV chart');if(r.anteStandIn)flags.push('ante differs');
 return{status:flags.length?'approximate':'exact',flags,chart:r.referenceSource?.packName};
}
function heroCards(variant,cls,avoid=[]){return variant==='PLO4'?G.Core.cards(cls):L.cardsFor(cls,avoid);}
function checkSpot(packs,variant,cfg,spec){
 const hand=new G.Hand(cfg,{rng:G.rng(7)});let ok;try{ok=drive(hand,spec);}catch{ok=false;}
 if(!ok)return{status:'unreachable'};
 let best=null;const rank={exact:3,approximate:2,nothing:1};
 for(const h of variant==='PLO4'?PLO_HANDS:NLH_HANDS){
  const x=hand.clone(),cards=heroCards(variant,h,[]);if(!cards)continue;
  // The hero's cards replace whatever was dealt; other seats' cards do not matter to a lookup.
  x.holes[spec.actor]=cards;let r;try{r=preflopStatus(packs,x);}catch(e){r={status:'nothing',error:e.message};}
  if(!best||rank[r.status]>rank[best.status])best={...r,hand:h};if(best.status==='exact')break;
 }
 if(best&&best.status==='nothing'){
  // Why: the same-game chart has the node but never plays the line (off path), or has no such node.
  const same=packs.find(p=>p.family===hand.family);if(same){const node=same.index.get(P.historyKey(hand));best.reason=node?(node.reach!==undefined&&node.reach<P.OFF_PATH?'off-path node':'hands unreached'):'not in the chart tree';}
  else{const depth=G.bb(Math.max(...hand.initial)),near=packs.filter(p=>p.config.variant===hand.config.variant).some(p=>Math.abs(Math.log(Math.max(...p.config.stacks)/depth))<=Math.log(1.6)+1e-9);best.reason=near?'line off the stand-in chart (off-path node, unmapped size or outside the tree)':'no chart within 1.6x of this depth';}
 }
 return best;
}

function preflopCoverage(lib,o,seats){
 const variants=L.list(o.games)?.map(g=>g==='plo'?'PLO4':'NLH')||['NLH','PLO4'];
 const metas=lib.packs.filter(m=>variants.includes(m.variant)),packs=metas.map(m=>L.loadPack(lib,m).pack);
 const depths=o.quick?QUICK_DEPTHS:DEPTHS,rows=[];
 for(const variant of variants)for(const n of seats){
  const specs=lineSpecs(n,variant);
  // Raked and tournament tables only change which chart stands in, so they get fewer depths.
  for(const kind of Object.keys(TABLES))for(const depth of kind==='cash'?depths:depths.filter(d=>SIDE_DEPTHS.includes(d))){
   const cfg=config(variant,n,depth,kind);
   for(const spec of specs){const r=checkSpot(packs,variant,cfg,spec);if(r.status==='unreachable')continue;rows.push({variant,seats:n,table:kind,depth,type:spec.type,line:spec.label,status:r.status,flags:r.flags||[],hand:r.hand,chart:r.chart,...r.reason?{reason:r.reason}:{}});}
  }
 }
 return rows;
}

// ---------- postflop ----------
function allFlops(){
 const map=new Map();
 for(let a=0;a<52;a++)for(let b=a+1;b<52;b++)for(let c=b+1;c<52;c++){const k=PL.canonical([a,b,c]).key;map.set(k,(map.get(k)||0)+1);}
 return map;
}
// Each library spot: its flops classified by the app's own rules (in the spot, a stand-in of the
// same texture, or none), weighted by how often each flop is dealt, and a sample checked
// end to end through postflopRanges + query.
function postflopCoverage(lib,o){
 const flopMeta=lib.flops,libs=L.loadFlops(lib),flops=allFlops(),total=[...flops.values()].reduce((a,b)=>a+b,0),r=L.rng(11),out=[];
 const preMetas=lib.packs,packsByName=new Map();
 const packsFor=name=>{if(!packsByName.has(name)){const ms=preMetas.filter(m=>m.name.replace(/Citrus Poker/g,'Range Lab')===String(name).replace(/Citrus Poker/g,'Range Lab'));packsByName.set(name,ms.map(m=>L.loadPack(lib,m).pack));}return packsByName.get(name);};
 for(const l of libs)for(const spot of l.spots){
  const counts={library:0,approximate:0,nothing:0},keys=[...flops.keys()];
  for(const [k,w] of flops){if(spot.flops[k])counts.library+=w;else if(PL.standIns(spot,PL.canonical(G.Core.cards(k)).cards).length)counts.approximate+=w;else counts.nothing+=w;}
  // End to end: replay the chart line on a real table and ask the app for the first flop decision.
  const packs=packsFor(spot.chart.name),pack=packs[0],e2e={tried:0,library:0,approximate:0,nothing:0,errors:[]};
  if(pack){
   const sampleKeys=Array.from({length:o.quick?6:24},()=>keys[Math.floor(r()*keys.length)]).concat(Object.keys(spot.flops).slice(0,o.quick?3:8));
   for(const k of sampleKeys){e2e.tried++;try{const res=flopQuery(packs,pack,spot,k,libs);e2e[res]++;}catch(err){e2e.nothing++;if(e2e.errors.length<3)e2e.errors.push(err.message);}}
  }
  const label=flopMeta.find(f=>f.id===spot.id&&f.library===l.name)?.label||spot.label;
  out.push({library:l.name,id:spot.id,label,chart:spot.chart.name,line:spot.chart.key,solvedFlops:Object.keys(spot.flops).length,flopShare:{library:counts.library/total,approximate:counts.approximate/total,nothing:counts.nothing/total},endToEnd:e2e,chartFound:!!pack,tree:spot.tree});
 }
 return{spots:out,libs};
}
// The first flop decision on canonical flop k for spot's chart line: 'library', 'approximate'
// (stand-in flop) or 'nothing'.
function flopQuery(packs,pack,spot,k,libs){
 const cfg=G.normalize({...pack.config}),steps=spot.chart.key.split('/').map(s=>{const [seat,kind,t]=s.split(':');return{seat:+seat,kind,target:+t};});
 const board=G.Core.cards(k),hand0=G.replay(cfg,[],{rng:G.rng(3),runout:board});
 const h=hand0;for(const s of steps){h.act({kind:s.kind,target:s.kind==='raise'?s.target:undefined});}
 if(h.street!==1||h.done)throw Error('line does not reach the flop');
 const range=P.postflopRanges(packs,cfg,h.actionLog);if(!range)return'nothing';
 // Hero: the first actor on the flop, with the most likely class in its range that fits the board.
 const seat=h.actor,w=range.seats[seat];if(!w)return'nothing';
 const order=P.classes.map((c,i)=>[c,w[i]]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
 for(const [c] of order.slice(0,10)){const cards=L.cardsFor(c,board);if(!cards)continue;const x=h.clone();x.holes[seat]=cards;const q=PL.query(libs,range,x);if(q)return q.solve.library.standIn?'approximate':'library';}
 return'nothing';
}

// Heads-up flop lines across tables: does any library spot answer them?
function postflopLines(lib,libs,o,seats){
 const metas=lib.packs.filter(m=>m.variant==='NLH'&&m.mode==='cash'),packs=metas.map(m=>L.loadPack(lib,m).pack),rows=[],board=G.Core.cards('Kd7s2c');
 const depths=o.quick?[100]:[50,100,200];
 for(const n of seats)for(const depth of depths){
  const cfg=config('NLH',n,depth,'cash'),[sb,bb]=n===2?[0,1]:[1,2],order=Array.from({length:n},(_,k)=>(bb+1+k)%n);
  for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){const a=order[i],b=order[j];
   for(const [type,steps] of [['single-raised',[[a,'raise',2.5],[b,'call']]],['3-bet pot',[[a,'raise',2.5],[b,'raise',{x:b===sb||b===bb?4:3}],[a,'call']]]]){
    const hand=new G.Hand(cfg,{rng:G.rng(5),runout:board});let ok=true;
    try{for(const [seat,kind,size] of steps){while(hand.actor!==seat){const l=hand.legal();hand.act(l.check?{kind:'check'}:{kind:'fold'});}
     if(kind==='raise'){const l=hand.legal(),to=typeof size==='object'?Math.round(hand.currentBet*size.x):G.units(size);hand.act({kind:'raise',target:Math.max(l.minRaiseTo,Math.min(to,l.allInTo))});}else hand.act({kind});}
     while(hand.street===0&&!hand.done){const l=hand.legal();hand.act(l.check?{kind:'check'}:{kind:'fold'});}}catch{ok=false;}
    if(!ok||hand.street!==1)continue;
    let range=null;try{range=P.postflopRanges(packs,cfg,hand.actionLog);}catch{}
    let status='nothing',spot=null;
    if(range){const m=PL.missing(libs,range,hand);if(m){status='library spot (flop unsolved)';spot=m.spot.id;}
     const seat=hand.actor,w=range.seats[seat]||[];const order=P.classes.map((c,k)=>[c,w[k]]).filter(x=>x[1]>0).sort((x,y)=>y[1]-x[1]);
     for(const [c] of order.slice(0,8)){const cards=L.cardsFor(c,board);if(!cards)continue;const x=hand.clone();x.holes[seat]=cards;const q=PL.query(libs,range,x);if(q){status=q.solve.library.standIn?'approximate':'library';spot=q.solve.library.spot;break;}}}
    rows.push({seats:n,depth,type,line:`${L.seatName(n,a)} ${type==='3-bet pot'?'opens, '+L.seatName(n,b)+' 3-bets, called':'opens, '+L.seatName(n,b)+' calls'}`,ranges:!!range,status,spot});
   }
  }
 }
 return rows;
}

function summarize(rows,keys){const out=new Map();for(const r of rows){const k=keys.map(x=>r[x]).join('|');const v=out.get(k)||{key:Object.fromEntries(keys.map(x=>[x,r[x]])),exact:0,approximate:0,nothing:0,total:0};v[r.status]++;v.total++;out.set(k,v);}return[...out.values()];}

function report(lib,pre,post,lines){
 let md=`# Coverage (${lib.version})\n\nEvery lookup goes through the app's own code (PokerPreflop.query → nearest; postflopRanges → PokerPostflopLibrary.query). Preflop: a spot counts as answered when any of ${NLH_HANDS.length} test hands gets an answer. Tables: cash (no rake), raked cash (5% capped at 3bb), tournament (1bb big-blind ante, payouts 50/30/20).\n\n`;
 const share=(v,k)=>L.pct(v[k]/v.total,0);
 md+=`## Preflop by table and line type\n\n`+L.mdTable(['game','seats','table','spots','exact','approximate','nothing'],summarize(pre,['variant','seats','table']).map(v=>[v.key.variant,v.key.seats,v.key.table,v.total,share(v,'exact'),share(v,'approximate'),share(v,'nothing')]))+'\n';
 md+=L.mdTable(['game','line type','spots','exact','approximate','nothing'],summarize(pre,['variant','type']).map(v=>[v.key.variant,v.key.type,v.total,share(v,'exact'),share(v,'approximate'),share(v,'nothing')]))+'\n';
 md+=`## Preflop by depth (NLH cash)\n\n`+L.mdTable(['depth bb','spots','exact','approximate','nothing'],summarize(pre.filter(r=>r.variant==='NLH'&&r.table==='cash'),['depth']).map(v=>[v.key.depth,v.total,share(v,'exact'),share(v,'approximate'),share(v,'nothing')]))+'\n';
 md+=`## Preflop by open size (NLH cash, spots facing an open)\n\n`+L.mdTable(['open','spots','exact','approximate','nothing'],summarize(pre.filter(r=>r.variant==='NLH'&&r.table==='cash'&&r.type==='vs open').map(r=>({...r,size:r.line.match(/ ([\d.]+)bb open/)?.[1]})),['size']).map(v=>[v.key.size+'bb',v.total,share(v,'exact'),share(v,'approximate'),share(v,'nothing')]))+'\n';
 const flagCount=new Map();for(const r of pre)for(const f of r.flags){const k=f.startsWith('sizes')?'mapped raise sizes':f.startsWith('depth')?'another depth':f;flagCount.set(k,(flagCount.get(k)||0)+1);}
 md+=`Approximations used: ${[...flagCount].map(([k,v])=>k+' ×'+v).join(', ')||'none'}.\n\n`;
 const reasons=summarize(pre.filter(r=>r.status==='nothing').map(r=>({...r,status:'nothing'})),['variant','reason']);
 md+=`### Why spots get nothing\n\n`+L.mdTable(['game','reason','spots'],reasons.map(v=>[v.key.variant,v.key.reason||'–',v.total]))+'\n';
 const nothingTypes=summarize(pre.filter(r=>r.variant==='NLH'&&r.table==='cash'&&r.depth===100),['type','seats']).filter(v=>v.nothing);
 md+=`### NLH cash 100bb spots with no answer\n\n`+(nothingTypes.length?L.mdTable(['line type','seats','spots','nothing'],nothingTypes.map(v=>[v.key.type,v.key.seats,v.total,v.nothing])):'None.\n')+'\n';
 md+=`## Flop library spots\n\nShare of all dealt flops (by frequency) the app answers for each chart line, from the app's own rules (solved flop up to suits, or a stand-in of the same suit pattern and pairing), plus a sample of flops asked end to end through postflopRanges + query.\n\n`;
 md+=L.mdTable(['spot','solved flops','library','stand-in','nothing','end-to-end sample (library/stand-in/nothing)'],post.spots.map(s=>[s.label,s.solvedFlops,L.pct(s.flopShare.library),L.pct(s.flopShare.approximate),L.pct(s.flopShare.nothing),`${s.endToEnd.library}/${s.endToEnd.approximate}/${s.endToEnd.nothing} of ${s.endToEnd.tried}${s.chartFound?'':' (chart missing)'}`]))+'\n';
 const ls=summarize(lines.map(r=>({...r,status:r.status==='library'||r.status==='approximate'?'exact':r.status==='nothing'?'nothing':'approximate'})),['seats','depth','type']);
 md+=`## Heads-up flop lines across tables (NLH cash)\n\nEvery opener vs caller (single-raised) and opener calling a 3-bet, asked on Kd7s2c. "answered" = a library spot answers (solved or stand-in flop); "spot, flop unsolved" = the line has a spot but this flop is not in it; "nothing" = live solver only. Turn and river: no turn library is bundled, so every turn and river decision falls to the live solver.\n\n`;
 md+=L.mdTable(['seats','depth','pot','lines','answered','spot, flop unsolved','nothing'],ls.map(v=>[v.key.seats,v.key.depth,v.key.type,v.total,v.exact,v.approximate,v.nothing]))+'\n';
 return md;
}

async function main(){
 const o=L.parseArgs(process.argv.slice(2),{jobs:4,seats:'2-9'});
 const lib=L.openLibrary(o.library),seats=[...L.range(o.seats)];
 if(o.worker){for(const item of L.workerItems()){process.stdout.write(JSON.stringify(item.kind==='pre'?{kind:'pre',rows:preflopCoverage(lib,o,[item.n])}:{kind:'post',...(()=>{const p=postflopCoverage(lib,o);return{spots:p.spots,lines:postflopLines(lib,p.libs,o,seats)};})()})+'\n');}return;}
 const t=Date.now(),extra=process.argv.slice(2).filter((a,i,arr)=>!['--jobs','--out'].includes(a)&&!['--jobs','--out'].includes(arr[i-1]));
 const items=[{kind:'post'},...seats.slice().sort((a,b)=>b-a).map(n=>({kind:'pre',n}))];
 const res=await L.parallel(__filename,items,o.jobs,extra);
 const pre=res.filter(r=>r.kind==='pre').flatMap(r=>r.rows),post=res.find(r=>r.kind==='post');
 const out=o.out||L.defaultOut(lib);
 L.writeOut(out,'coverage',{json:{version:lib.version,library:lib.spec,seconds:(Date.now()-t)/1000,preflop:pre,flopSpots:post.spots,flopLines:post.lines},md:report(lib,pre,post,post.lines)});
 const c=s=>pre.filter(r=>r.status===s).length;
 console.log(`coverage: ${pre.length} preflop spots (${c('exact')} exact, ${c('approximate')} approximate, ${c('nothing')} nothing), ${post.spots.length} flop spots, ${((Date.now()-t)/1000).toFixed(0)}s -> ${path.join(out,'coverage.md')}`);
}
module.exports={lineSpecs,drive,preflopStatus,config};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
