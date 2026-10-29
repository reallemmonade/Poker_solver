#!/usr/bin/env node
'use strict';
// Runs every chart bot on one library and writes their reports plus a summary.
//   node tools/chart-bots/run-all.cjs [--library studio/libraries/manifest.json] [--out out/chart-bots/<version>]
//        [--quick] [--jobs 4] [--calibration file.json] [--only selfplay,exploit,coverage,offtree]
const path=require('path'),fs=require('fs'),{spawnSync}=require('child_process'),L=require('./lib.cjs');

const o=L.parseArgs(process.argv.slice(2),{jobs:4});
const lib=L.openLibrary(o.library),out=path.resolve(o.out||L.defaultOut(lib));L.ensureDir(out);
const pass=['library','jobs','quick','calibration'].flatMap(k=>o[k]===undefined?[]:o[k]===true?['--'+k]:['--'+k,String(o[k])]);
const bots=L.list(o.only)||['selfplay','exploit','coverage','offtree'],times={},t0=Date.now();
console.log(`chart bots on ${lib.version} (${lib.packs.length} chart packs, ${lib.flops.length} flop spots) -> ${out}`);
for(const bot of bots){
 const t=Date.now(),r=spawnSync(process.execPath,[path.join(__dirname,bot+'.cjs'),...pass,'--out',out],{stdio:'inherit'});
 times[bot]=(Date.now()-t)/1000;if(r.status!==0){console.error(`${bot} failed (exit ${r.status}).`);process.exitCode=1;}
}
const read=n=>{try{return JSON.parse(fs.readFileSync(path.join(out,n+'.json'),'utf8'));}catch{return null;}};
const sp=read('selfplay'),ex=read('exploit'),cv=read('coverage'),ot=read('offtree');
let md=`# Chart bots: ${lib.version}\n\nLibrary: \`${path.relative(L.ROOT,lib.spec)||lib.spec}\`. Run ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC${o.quick?' (--quick)':''}, ${((Date.now()-t0)/60000).toFixed(1)} min (${Object.entries(times).map(([k,v])=>`${k} ${v.toFixed(0)}s`).join(', ')}).\n\nAll EVs come from the charts' own payoff model (tools/preflop: equity table for all-ins, equity-realization share for flop pots). It is an approximation of postflop play, so model-only gains can be false holes; exploit.md marks which findings survive perturbed models.\n\n`;
md+=`Reports: [selfplay.md](selfplay.md), [exploit.md](exploit.md), [coverage.md](coverage.md), [offtree.md](offtree.md), each with a .json twin.\n\n`;
if(sp){const fails=sp.results.flatMap(r=>r.checks.filter(c=>!c.ok&&c.robust).map(c=>`${r.id}: ${c.text}`));md+=`## Self-play\n\n${sp.results.length} charts, ${sp.hands} hands each. ${fails.length} failed checks (model artefacts left out)${fails.length?':':'.'}\n\n${fails.slice(0,15).map(x=>'- '+x).join('\n')}\n\n`;
 const worst=sp.results.slice().sort((a,b)=>b.nashConv-a.nashConv).slice(0,5);md+=`Least converged charts in their own model (NashConv bb/hand): ${worst.map(r=>`${r.id} ${r.nashConv.toFixed(4)} (claims ${r.claimedNashConv})`).join('; ')}.\n\n`;}
if(ex){const all=ex.results.flatMap(r=>r.findings),rob=all.filter(x=>x.robust).sort((a,b)=>b.score-a.score);
 md+=`## Exploiter\n\n${all.length} findings over ${ex.results.length} charts (gain > ${ex.min} bb), ${rob.length} robust to the perturbed models. Top robust:\n\n`+L.mdTable(['chart','spot','hand','chart mix','better','gain bb','score bb/100'],rob.slice(0,12).map(x=>[x.pack,x.spot,x.hand,x.chart,x.action,L.f(x.gain,3),L.f(x.score,3)]))+'\n';}
if(cv){const c=s=>cv.preflop.filter(r=>r.status===s).length,n=cv.preflop.length,cash=cv.preflop.filter(r=>r.variant==='NLH'&&r.table==='cash'),cc=s=>cash.filter(r=>r.status===s).length;
 md+=`## Coverage\n\nPreflop spots: ${n} (${L.pct(c('exact')/n,0)} exact, ${L.pct(c('approximate')/n,0)} approximate, ${L.pct(c('nothing')/n,0)} nothing); NLH cash only: ${L.pct(cc('exact')/cash.length,0)} / ${L.pct(cc('approximate')/cash.length,0)} / ${L.pct(cc('nothing')/cash.length,0)}. Flop spots: ${cv.flopSpots.length}, solved flops cover ${L.pct(cv.flopSpots.reduce((a,s)=>a+s.flopShare.library,0)/cv.flopSpots.length,1)} of dealt flops on average, the rest are stand-ins. Heads-up flop lines with a library spot: ${cv.flopLines.filter(r=>r.status!=='nothing').length} of ${cv.flopLines.length}.\n\n`;}
if(ot){const flags=ot.results.flatMap(r=>r.flags||[]),k=x=>flags.filter(f=>f.kind===x).length;md+=`## Off-tree sizes\n\n${flags.length} flags: ${k('no answer')} no answer, ${k('jump')} jumps, ${k('auto-profit')} auto-profit, ${k('crash')} crashes.\n\n`+L.mdTable(['table','depth','own chart','NashConv (passive / fold fill)','no stored answer /100 hands'],ot.results.filter(r=>r.kind==='depth').map(r=>[`${r.seats}-max ${r.format}`,r.depth,r.hasChart?'yes':'no',`${L.f(r.nashConv,4)} / ${L.f(r.nashConvFold,4)}`,L.f(r.holesPer100,2)]))+'\n';}
fs.writeFileSync(path.join(out,'README.md'),md);
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({version:lib.version,library:lib.spec,quick:!!o.quick,seconds:(Date.now()-t0)/1000,times},null,1));
console.log(`done in ${((Date.now()-t0)/60000).toFixed(1)} min -> ${path.join(out,'README.md')}`);
