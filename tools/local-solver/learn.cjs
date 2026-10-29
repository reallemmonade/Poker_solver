'use strict';
// Flops this computer learns for the flop library. When a heads-up flop comes up whose preflop line has a library
// spot but whose flop (up to suits) was never solved, the app answers with a stand-in flop and adds a 'flopwant-'
// row to your account (studio/spot-ui.js, noteMissingFlop). When the bridge has nothing else to do and the computer
// is otherwise idle, it solves that flop with the library's own tree and ranges (tools/postflop/library.cjs), so the
// new flop matches the rest of the library exactly. Each one is saved in the library's work-folder layout,
//   <bridge folder>/learned/<spot id>/spot.json and <flop>.json,
// which `node tools/postflop/library.cjs bundle --out learned` turns into a library file for the site. The app on
// this computer loads them from GET /learned, and solves your phone sends here for a learned flop are answered from
// them at once.
const fs=require('fs'),path=require('path');
const G=require('../../studio/game.js'),L=require('../../studio/local-solver.js'),Lib=require('../../studio/postflop-library.js'),{TREE,nodes}=require('../postflop/library.cjs'),C=G.Core;
const DIR=process.env.CITRUS_LEARNED_DIR||path.join(__dirname,'..','..','learned');
const FLOP=/^([2-9TJQKA][cdhs]){3}$/,ID=/^[a-z0-9-]{1,60}$/;

// A wanted flop as the app sends it: the library spot (id, label, chart line, pot, stack, tree and ranges) and the flop.
function check(want){
 const s=want?.spot,ranges=r=>r&&typeof r==='object'&&Object.values(r).every(x=>Number.isFinite(x)&&x>=0&&x<=1);
 if(!s||!ID.test(s.id)||typeof s.label!=='string'||typeof s.chart?.name!=='string'||typeof s.chart?.key!=='string'||!(s.pot>0)||!(s.stack>0)||!ranges(s.rangeIp)||!ranges(s.rangeOop)||!FLOP.test(want.key||''))throw Error('The wanted flop is malformed.');
 if(Lib.canonical(C.cards(want.key)).key!==want.key)throw Error('The wanted flop is not in canonical form.');
 return want;
}
// The solve spec: the library's tree (the spot's own, else tools/postflop/library.cjs TREE) to 1% of the pot.
function spec(want){
 const s=want.spot,tree=s.tree&&s.tree.flop?s.tree:TREE,sizes={};
 for(const who of ['ip','oop']){sizes[who]={};for(const st of ['flop','turn','river'])sizes[who][st]={bet:tree[st].bet.slice(),raise:tree[st].raise.slice(),donk:[]};}
 return L.validate({version:1,board:C.cards(want.key).map(C.cardName),pot:s.pot,stack:s.stack,sizes,allinThreshold:tree.allinThreshold??TREE.allinThreshold,rangeIp:s.rangeIp,rangeOop:s.rangeOop,path:[],hero:'2c2d',heroSeat:0,heroIsIp:false,accuracy:1,maxIterations:200});
}
const spotFile=id=>path.join(DIR,id,'spot.json'),flopFile=(id,key)=>path.join(DIR,id,key+'.json');
const sameSpot=(a,b)=>a&&b&&a.chart.name===b.chart.name&&a.chart.key===b.chart.key&&a.pot===b.pot&&a.stack===b.stack&&JSON.stringify(a.rangeIp)===JSON.stringify(b.rangeIp)&&JSON.stringify(a.rangeOop)===JSON.stringify(b.rangeOop);
function readSpot(id){try{return JSON.parse(fs.readFileSync(spotFile(id),'utf8'));}catch{return null;}}
// Learned already, for this spot's current ranges.
function has(want){return sameSpot(readSpot(want.spot.id),want.spot)&&fs.existsSync(flopFile(want.spot.id,want.key));}
let version=0,cached=null;
// Saves a solved flop (the bridge's TexasSolver result for spec(want)). A spot whose chart was re-solved since gets a
// fresh folder; the old one is kept beside it as <id>.old-<time>.
function save(want,out){
 const s=want.spot,dir=path.join(DIR,s.id),old=readSpot(s.id);
 if(old&&!sameSpot(old,s))fs.renameSync(dir,dir+'.old-'+Date.now());
 fs.mkdirSync(dir,{recursive:true});
 if(!fs.existsSync(spotFile(s.id)))fs.writeFileSync(spotFile(s.id),JSON.stringify({id:s.id,label:s.label,chart:s.chart,pot:s.pot,stack:s.stack,tree:s.tree&&s.tree.flop?s.tree:TREE,rangeIp:s.rangeIp,rangeOop:s.rangeOop},null,1));
 const file=flopFile(s.id,want.key),row={key:want.key,weight:1,iterations:out.iterations,exploitability:out.exploitability,seconds:out.seconds,nodes:nodes(out.tree),learnedAt:new Date().toISOString()};
 fs.writeFileSync(file+'.tmp',JSON.stringify(row));fs.renameSync(file+'.tmp',file);version++;cached=null;
 return row;
}
// Every learned flop as one postflop library (null when there are none yet).
function library(){
 if(cached&&cached.version===version)return cached.lib;const spots=[];
 let ids=[];try{ids=fs.readdirSync(DIR).filter(x=>ID.test(x));}catch{}
 for(const id of ids){const spot=readSpot(id);if(!spot)continue;spot.flops={};
  for(const f of fs.readdirSync(path.join(DIR,id)).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x)))try{const r=JSON.parse(fs.readFileSync(path.join(DIR,id,f),'utf8'));spot.flops[r.key]={weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,nodes:r.nodes};}catch{}
  if(Object.keys(spot.flops).length)spots.push(spot);}
 const lib=spots.length?Lib.validate({format:Lib.FORMAT,name:'Flops your Mac learned',createdAt:new Date().toISOString(),source:{solver:'TexasSolver via tools/local-solver/learn.cjs',ranges:'Citrus Poker preflop chart library'},spots}):null;
 cached={version,lib};return lib;
}
// Picks up flops written by another bridge process or by hand.
function refresh(){version++;cached=null;}
module.exports={DIR,check,spec,has,save,library,refresh};
