'use strict';
// Checks that first-in opens are in kicker order: on a node where everyone before has folded, a
// hand should not fold (mostly) while the same hand with a lower kicker opens (Q9s folds, Q8s opens).
// Real solvers are close to monotone here; a breach points at noise in the preflop model's fit.
//   node tools/preflop/order-check.cjs chart.json[.gz] | bundle.json.gz [--max 0]
// Counts, for every NLH chart, pairs where the lower kicker opens at least 50 points more often, and
// exits non-zero if any chart has more than --max of them.
const fs=require('fs'),zlib=require('zlib'),P=require('../../studio/preflop.js');
const args=process.argv.slice(2),max=args.includes('--max')?Number(args[args.indexOf('--max')+1]):0;
const files=args.filter((a,i)=>!a.startsWith('--')&&args[i-1]!=='--max');
if(!files.length)throw Error('Usage: node tools/preflop/order-check.cjs chart.json[.gz] | bundle.json.gz [--max 0]');
const R='AKQJT98765432';
// Each hand XY with its lower-kicker hands XZ, suited with suited and offsuit with offsuit. Suited
// wheel aces (A5s-A2s) may open over A9s-A6s, as they do in real solvers.
const pairs=[];
for(let i=0;i<13;i++)for(let j=i+1;j<13;j++)for(const s of ['s','o'])for(let k=j+1;k<13;k++)
 if(!(i===0&&s==='s'&&k>=9))pairs.push([R[i]+R[j]+s,R[i]+R[k]+s]);
function charts(file){
 const raw=fs.readFileSync(file),data=JSON.parse(/\.gz$/.test(file)?zlib.gunzipSync(raw):raw);
 return (data.packs||[data]).filter(p=>/^NLH/.test(p.name)).map(p=>P.validate(p));
}
// How often a class does anything but fold.
function opens(n,c){const A=n.actions.length,i=P.classes.indexOf(c),f=n.actions.findIndex(a=>a.kind==='fold');return f<0?1:1-n.table[i*A+f]/1000;}
let bad=0;
for(const file of files)for(const chart of charts(file)){
 const found=[];
 for(const n of chart.nodes)if(n.history.every(h=>h.kind==='fold')&&n.actions.some(a=>a.kind==='fold'))
  for(const [hi,lo] of pairs)if(opens(n,lo)-opens(n,hi)>=0.5)found.push(`seat ${n.seat}: ${hi} < ${lo}`);
 if(found.length>max)bad++;
 console.log(`${found.length>max?'FAIL':'ok  '} ${chart.name}: ${found.length}${found.length?' ('+found.slice(0,6).join(', ')+(found.length>6?', …':'')+')':''}`);
}
if(bad){console.log(`${bad} chart(s) open out of kicker order.`);process.exit(1);}
