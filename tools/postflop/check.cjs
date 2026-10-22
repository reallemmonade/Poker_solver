#!/usr/bin/env node
'use strict';
// Checks that the app finds library answers for live hands: the preflop line
// maps to the spot, suit-permuted flops find their canonical flop, hero combos
// map through the same permutation, and flop bet sizes match or are refused.
//   node tools/postflop/check.cjs --library postflop-work/postflop-library.json.gz --charts preflop-library.json.gz
const fs=require('fs'),zlib=require('zlib');
const G=require('../../studio/game.js'),P=require('../../studio/preflop.js'),Lib=require('../../studio/postflop-library.js'),{SPOTS}=require('./library.cjs'),C=G.Core;
const args={library:'postflop-work/postflop-library.json.gz',charts:'/mnt/project-files/chart-packs/preflop-library.json.gz'};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
const read=f=>{const raw=fs.readFileSync(f);return JSON.parse(/\.gz$/.test(f)?zlib.gunzipSync(raw):raw);};
const library=Lib.validate(read(args.library)),charts=read(args.charts),rng=G.rng(99);let pass=0,fail=0;
const ok=(cond,msg)=>{if(cond)pass++;else{fail++;console.log('FAIL '+msg);}};

for(const spot of library.spots){
 const def=SPOTS[spot.id],raw=(charts.packs||[charts]).find(p=>p.name===spot.chart.name);if(!def||!raw){console.log('skip '+spot.id);continue;}
 const pack=P.validate(raw),packs=[pack];
 for(const [key,flop]of Object.entries(spot.flops).slice(0,5)){
  // A real board: the canonical flop under a random suit permutation.
  const perm=[0,1,2,3].sort(()=>rng()-.5),canon=C.cards(key),board=canon.map(c=>(c&~3)|perm[c&3]);
  ok(Lib.canonical(board).key===key,spot.id+' '+key+' canonical key');
  for(const [what,flopLine,openScale]of [['root',[],1],['vs check',['check'],1],['vs bet',['check','bet'],1],['vs bet 40%',['check','bet40'],1],['vs bet 120%',['check','bet120'],1],['3bb open',['check'],1.2]]){
   const h=new G.Hand(pack.config,{runout:board,rng:G.rng(7)});
   const proxy=new G.Hand(pack.config,{rng:G.rng(7)});for(const kind of def.steps){const node=pack.index.get(P.historyKey(proxy)),t=node.actions.filter(a=>a.kind===kind).sort((a,b)=>(a.target||0)-(b.target||0))[0].target;proxy.act({kind,target:t});h.act({kind,target:kind==='raise'?Math.round(t*openScale/50)*50:undefined});}
   const pot=h.pot;for(const s of flopLine){if(s==='check')h.act({kind:'check'});else{const f={bet:.33,bet40:.4,bet120:1.2}[s];h.act({kind:'bet',target:Math.round(pot*f)});}}
   // Hero: a random combo off the board that the solved range holds.
   const range=P.postflopRanges(packs,h.config,h.actionLog),hero=h.actor;let cards;
   for(let t=0;t<500&&!cards;t++){const a=Math.floor(rng()*52),b=Math.floor(rng()*52);if(a===b||board.includes(a)||board.includes(b))continue;const w=range&&range.seats[hero][P.classes.indexOf(C.handClass([a,b]))];if(w>.2)cards=[a,b];}
   if(!cards){ok(false,spot.id+' '+key+' '+what+': no hero combo');continue;}
   h.holes[hero]=cards;const r=Lib.query([library],range,h);
   if(what==='vs bet 120%'){ok(!r,spot.id+' '+key+' '+what+' should not match');continue;}
   if(what==='3bb open'&&!r){ok(Math.abs(Math.log(1.2))>Math.log(1.5),spot.id+' '+key+' 3bb open should still match');continue;}
   ok(r&&r.supported,spot.id+' '+key+' '+what+': library answer');if(!r)continue;
   const s=r.reference.reduce((a,b)=>a+b,0);ok(Math.abs(s-1)<1e-9,spot.id+' '+key+' '+what+': frequencies sum to 1');
   if(what==='vs bet 40%')ok(!r.solve.library.sizesMatched,spot.id+' '+key+' '+what+': labelled as a nearest size');
   // Same row as decoding the stored node directly with the canonical combo.
   const node=flop.nodes.find(n=>n.path===r.solve.library.line),direct=Lib.row(node,Lib.comboIndex(cards.map(c=>(c&~3)|Lib.canonical(board).map[c&3]))),best=direct.indexOf(Math.max(...direct));
   ok(node.actions.length!==r.actions.length||direct.every((p,i)=>Math.abs(p-r.reference[i])<1e-9),spot.id+' '+key+' '+what+': same row as the stored node');
   ok(Math.abs(r.reference[r.best]-direct[best])<1e-9||node.actions.length!==r.actions.length,spot.id+' '+key+' '+what+': best action');
   for(const a of r.actions)ok((()=>{try{h.clone().act(a);return true;}catch{return false;}})(),spot.id+' '+key+' '+what+': legal action '+a.label);
  }
 }
}
console.log(pass+' checks passed, '+fail+' failed.');process.exit(fail?1:0);
