'use strict';
// Checks the 6-max 100bb cash chart's responses to an open against published solver output.
//   node tools/preflop/balance-check.cjs chart.json[.gz] | bundle.json.gz
// Aggregates (3-bet and call, % of combos) are BeyondGTO's 6-max NL500 100bb defense charts
// (beyondgto.com/defense/*, read 2026-10-28). Those are raked and ours are not, so the blinds
// defend more here; the bands are loose on purpose, and the big blind's calls are only checked on raked
// charts (rake 5% capped at 3bb flats about 16 points fewer hands in the big blind). The hand checks are what every published
// solver does: a 3-bet range that has bluffs (a suited wheel ace 3-bets) and middle pairs that
// mostly flat in position instead of 3-betting.
const fs=require('fs'),zlib=require('zlib'),P=require('../../studio/preflop.js');
const w=c=>c.length===2?6:c[2]==='s'?4:12;
const CHART='NLH cash 6-handed 100bb';
// [label, line, 3-bet %, call %, checks]
const SPOTS=[
 ['CO vs HJ open','3:fold:0/4:raise:250',8,5,{bluff:true,pairs:true}],
 ['BTN vs HJ open','3:fold:0/4:raise:250/5:fold:0',8,8,{bluff:true,pairs:true}],
 ['BTN vs CO open','3:fold:0/4:fold:0/5:raise:250',10,9,{bluff:true,pairs:true}],
 ['SB vs BTN open','3:fold:0/4:fold:0/5:fold:0/0:raise:250',13,5,{bluff:true}],
 ['BB vs BTN open','3:fold:0/4:fold:0/5:fold:0/0:raise:250/1:fold:0',13,32,{rakedCall:true}],
 ['BB vs SB open','3:fold:0/4:fold:0/5:fold:0/0:fold:0/1:raise:300',17,39,{rakedCall:true}],
];
const BAND=5;

function load(file){
 const raw=fs.readFileSync(file),data=JSON.parse(/\.gz$/.test(file)?zlib.gunzipSync(raw):raw);
 const pack=data.packs?data.packs.find(p=>p.name.startsWith(CHART)):data;
 if(!pack||!pack.name.startsWith(CHART))throw Error(`${file} has no "${CHART}" chart.`);
 const chart=P.validate(pack);chart.raked=!!pack.config.rakePct;return chart;
}
// Share of combos per action kind (fold, call, raise) and each class's row.
function node(chart,key){
 const n=chart.index.get(key);if(!n)return null;
 const A=n.actions.length,kinds=n.actions.map(a=>a.kind),tot={fold:0,call:0,raise:0};let T=0;
 // Bundled charts hold a per-mille table, exported ones frequencies per class.
 const row=c=>{const i=P.classes.indexOf(c),r={fold:0,call:0,raise:0};for(let j=0;j<A;j++)r[kinds[j]]+=n.table?n.table[i*A+j]/1000:n.strategy[c][j];return r;};
 for(const c of P.classes){const r=row(c);T+=w(c);for(const k in tot)tot[k]+=w(c)*r[k];}
 for(const k in tot)tot[k]=100*tot[k]/T;
 return{tot,row};
}

function check(chart){
 const lines=[];let fails=0;
 for(const [label,key,three,call,want]of SPOTS){
  const n=node(chart,key);if(!n){lines.push(`${label}: no node`);fails++;continue;}
  const bad=[];
  if(Math.abs(n.tot.raise-three)>BAND)bad.push(`3-bet ${n.tot.raise.toFixed(1)}% vs ${three}%`);
  if((!want.rakedCall||chart.raked)&&Math.abs(n.tot.call-call)>BAND+(call>20?5:0))bad.push(`call ${n.tot.call.toFixed(1)}% vs ${call}%`);
  const wheel=Math.max(n.row('A5s').raise,n.row('A4s').raise);
  if(want.bluff&&wheel<.25)bad.push(`no suited wheel ace 3-bets 25% (A5s ${(100*n.row('A5s').raise).toFixed(0)}%, A4s ${(100*n.row('A4s').raise).toFixed(0)}%)`);
  const mid=['77','66','55'].reduce((s,c)=>s+n.row(c).call,0)/3;
  if(want.pairs&&mid<.5)bad.push(`77-55 flat only ${(100*mid).toFixed(0)}%`);
  fails+=bad.length;
  const hands=['99','77','55','AJs','A5s','A4s','KJs','T9s'].map(c=>{const r=n.row(c);return`${c} ${(100*r.raise).toFixed(0)}/${(100*r.call).toFixed(0)}`;}).join(' ');
  lines.push(`${bad.length?'FAIL':'ok  '} ${label}: 3-bet ${n.tot.raise.toFixed(1)}% (ref ${three}), call ${n.tot.call.toFixed(1)}% (ref ${call})${bad.length?' -- '+bad.join('; '):''}\n       3-bet/call %: ${hands}`);
 }
 return{lines,fails};
}
module.exports={check,load,SPOTS};

if(require.main===module){
 if(process.argv.length<3){console.log('Usage: node tools/preflop/balance-check.cjs chart.json[.gz] [more ...]');process.exit(1);}
 let fails=0;for(const f of process.argv.slice(2)){const r=check(load(f));console.log(f);r.lines.forEach(l=>console.log('  '+l));fails+=r.fails;}
 process.exit(fails?2:0);
}
