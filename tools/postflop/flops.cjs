'use strict';
// Flops up to suit isomorphism, keyed like studio/postflop-library.js.
const G=require('../../studio/game.js'),Lib=require('../../studio/postflop-library.js'),C=G.Core;
// All 1,755 canonical flops, with how many of the 22,100 real flops each stands for.
function all(){
 const seen=new Map();
 for(let a=0;a<52;a++)for(let b=a+1;b<52;b++)for(let c=b+1;c<52;c++){const k=Lib.canonical([a,b,c]),e=seen.get(k.key);if(e)e.count++;else seen.set(k.key,{key:k.key,cards:k.cards,count:1});}
 return[...seen.values()];
}
function texture(cards){
 const r=cards.map(c=>c>>2).sort((a,b)=>b-a),suits=new Set(cards.map(c=>c&3)).size,ranks=new Set(r).size;
 return{high:r[0],suits:suits===1?'monotone':suits===2?'two-tone':'rainbow',pairing:ranks===1?'trips':ranks===2?'paired':'unpaired'};
}
// A spread of flops, most common textures first. Strata are suit pattern x
// pairing x high card; each stratum gets flops in proportion to how often it
// is dealt, spaced evenly through its rank order. Every flop carries the share
// of real flops it stands for.
function subset(n){
 const strata=new Map();
 for(const f of all()){const t=texture(f.cards),k=[t.suits,t.pairing,t.high>=11?'A-K':t.high>=8?'Q-T':t.high>=5?'9-7':'6-2'].join('|');if(!strata.has(k))strata.set(k,[]);strata.get(k).push(f);}
 const picked=[];
 for(const list of strata.values()){const weight=list.reduce((s,f)=>s+f.count,0),take=Math.min(list.length,Math.max(1,Math.round(n*weight/22100)));list.sort((a,b)=>a.key<b.key?-1:1);for(let i=0;i<take;i++)picked.push({...list[Math.floor((i+.5)*list.length/take)],weight:weight/take});}
 return picked.sort((a,b)=>b.weight-a.weight||(a.key<b.key?-1:1));
}
module.exports={all,texture,subset};
if(require.main===module){const n=Number(process.argv[2])||0,list=n?subset(n):all();console.log(list.length+' flops');console.log(list.map(f=>f.key).join(' '));}
