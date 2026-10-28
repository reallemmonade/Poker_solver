'use strict';
// Reference spots side by side for chart bundles (v4, v5, v6 ...): 6-max 100bb BTN vs an HJ open,
// SB first in, 9-max 100bb UTG first in and 6-max 50bb BTN first in.
//   node tools/calibration/refcheck.cjs preflop-library-v4.json.gz preflop-library-v6-calibrated.json.gz
const fs=require('fs'),path=require('path'),zlib=require('zlib'),P=require('../../studio/preflop.js');
const w=c=>c.length===2?6:c[2]==='s'?4:12;
// Charts are found by name up to " (", so bundles from before and after the rename compare.
function show(packs,chart,key,hands){
 const raw=packs.find(p=>p.name.split(' (')[0]===chart);if(!raw)return'(no chart)';const n=P.validate(raw).index.get(key);if(!n)return'(no node)';
 const A=n.actions.length,t=new Array(A).fill(0);let T=0;P.classes.forEach((c,i)=>{T+=w(c);for(let j=0;j<A;j++)t[j]+=w(c)*n.table[i*A+j]/1000;});
 let s=n.actions.map((a,j)=>a.label+' '+(100*t[j]/T).toFixed(1)+'%').join(', ');
 for(const h of hands){const i=P.classes.indexOf(h);s+='\n      '+h.padEnd(4)+n.actions.map((a,j)=>a.label.replace(/ bb$/,'')+' '+(n.table[i*A+j]/10).toFixed(0)+'%').join(', ');}
 return s;
}
const SPOTS=[
 ['6-max 100bb BTN vs HJ 2.5bb open','NLH cash 6-handed 100bb','3:fold:0/4:raise:250/5:fold:0',['A7s','A5s','A4s','KJs','KQo','76s','77','88','99']],
 ['6-max 100bb SB first in','NLH cash 6-handed 100bb','3:fold:0/4:fold:0/5:fold:0/0:fold:0',['A7s','K7s','76s','Q5o']],
 ['9-max 100bb UTG first in','NLH cash 9-handed 100bb','',['A9s','KJo','76s','55']],
 ['6-max 50bb BTN first in','NLH cash 6-handed 50bb','3:fold:0/4:fold:0/5:fold:0',['A7s','K9o','76s','T8o']],
];
const bundles=process.argv.slice(2).map(f=>({name:path.basename(f),packs:JSON.parse(zlib.gunzipSync(fs.readFileSync(f))).packs}));
if(!bundles.length){console.log('Usage: node tools/calibration/refcheck.cjs bundle.json.gz [more.json.gz ...]');process.exit(1);}
for(const [label,chart,key,hands]of SPOTS){console.log(label);for(const b of bundles)console.log('  '+b.name+': '+show(b.packs,chart,key,hands));}
