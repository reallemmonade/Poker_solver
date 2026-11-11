#!/usr/bin/env node
'use strict';
// Balance gate for flop libraries (tools/postflop/library.cjs), the postflop twin of
// tools/preflop/balance-check.cjs. For every spot it checks:
//   - convergence: each flop's exploitability (% of the pot, TexasSolver's own number);
//   - tables: every in-range combo's row sums to 255 and the root covers the whole range;
//   - defence (MDF): facing the first flop bet, how often the range folds against the bet's
//     alpha = bet / (pot after the bet). On the flop a converged solve may fold somewhat more than
//     alpha (the bettor's air still has equity), so 10+ points over is a warning and 25+ a failure;
//   - nut folds: a top-3% made hand (among every hand that could be dealt on that flop) folding
//     to the first bet, the postflop twin of "AA folds preflop";
//   - bluffs: the share of the first bet range with no pair and no draw (a warning when it is
//     under 3% or over 85%).
// Exploitability is the real balance measure (a best response against the solve, in its own tree);
// the other checks catch broken inputs: wrong ranges, swapped players, truncated tables.
// A flop is ungraded on its own when it is above 2% pot or a top-3% hand folds most of the time to a
// normal-sized first bet.
// Inputs: a bundle (postflop-library.json[.gz]), split spot files (studio/libraries/flops/*.json.gz),
// or a solve folder (<out>/<spot>/<flop>.json from library.cjs solve), any number of them.
//   node tools/postflop/balance-check.cjs studio/libraries/flops/*.json.gz
//   node tools/postflop/balance-check.cjs ~/smart-work/flop-v6b [--json report.json] [--md report.md]
//   node tools/postflop/balance-check.cjs <inputs> --mark      # write the verdicts into the files
// --mark stores each failing spot's reason (spot.gate) and each failing flop (spot.gate.flops) in the
// library file itself; the app then shows those answers but does not grade them (postflop-library.js
// passes library.ungraded, app.js logs "not graded (flop library failed balance check)").
// Exits 2 when any spot fails.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const G=require('../../studio/game.js'),Lib=require('../../studio/postflop-library.js'),C=G.Core;

// Thresholds. A spot fails when its weighted mean exploitability is above MEAN_EXPL or more than
// BAD_SHARE of its flop weight is above FLOP_EXPL; a flop fails on its own above FLOP_EXPL.
const T={FLOP_EXPL:2,MEAN_EXPL:1.5,BAD_SHARE:.1,OVERFOLD:.1,OVERFOLD_FAIL:.25,FLOP_OVERFOLD:.3,NUT_FOLD:.05,NUT_TOP:.03,ROW_SUM:3,BLUFF_MIN:.03,BLUFF_MAX:.85};

const read=f=>{const raw=fs.readFileSync(f);return JSON.parse(/\.gz$/.test(f)?zlib.gunzipSync(raw):raw);};
// Every spot in the inputs: {spot, file, write(spot)} where write saves --mark results back.
function spots(inputs){
 const out=[];
 for(const input of inputs){
  const st=fs.statSync(input);
  if(st.isDirectory()){
   // A split library folder (flops/*.json.gz) or a solve folder (<spot>/spot.json + flops).
   const flopsDir=fs.existsSync(path.join(input,'flops'))?path.join(input,'flops'):null;
   if(flopsDir){out.push(...spots(fs.readdirSync(flopsDir).filter(f=>/\.json(\.gz)?$/.test(f)).map(f=>path.join(flopsDir,f))));continue;}
   const dirs=fs.existsSync(path.join(input,'spot.json'))?[input]:fs.readdirSync(input).map(d=>path.join(input,d)).filter(d=>fs.existsSync(path.join(d,'spot.json')));
   for(const dir of dirs){
    const spot=JSON.parse(fs.readFileSync(path.join(dir,'spot.json'),'utf8'));spot.flops={};
    for(const f of fs.readdirSync(dir).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){try{const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));spot.flops[r.key]={weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,nodes:r.nodes};}catch(e){spot.broken=(spot.broken||[]).concat(f);}}
    // A solve folder keeps its verdict next to spot.json; bundle() copies spot.json's fields.
    out.push({spot,file:dir,write:s=>{const head=JSON.parse(fs.readFileSync(path.join(dir,'spot.json'),'utf8'));if(s.gate)head.gate=s.gate;else delete head.gate;fs.writeFileSync(path.join(dir,'spot.json'),JSON.stringify(head,null,1));}});
   }
   continue;
  }
  const lib=read(input);if(lib.format!==Lib.FORMAT)throw Error(input+' is not a flop library ('+lib.format+').');
  lib.spots.forEach((spot,i)=>out.push({spot,file:input,write:s=>{lib.spots[i]=s;const text=JSON.stringify(lib);fs.writeFileSync(input,/\.gz$/.test(input)?zlib.gzipSync(text,{level:9}):text);}}));
 }
 return out;
}

const RANKS='23456789TJQKA';
const classOf=(a,b)=>C.handClass([a,b]);
const boardOf=key=>C.cards(key);
// Every node's actor and its rows; reach of each combo for one player along a path.
function reach(spot,flop,nodes,path,player){
 const range=player==='ip'?spot.rangeIp:spot.rangeOop,board=boardOf(flop),dead=new Set(board),r=new Float64Array(Lib.COMBOS.length);
 Lib.COMBOS.forEach(([a,b],i)=>{if(dead.has(a)||dead.has(b))return;const w=range[classOf(a,b)];if(w>0)r[i]=w;});
 const steps=path?path.split('/'):[];let prefix='';
 for(const step of steps){const n=nodes.get(prefix);if(!n)return null;
  if(n.player===player){const a=n.actions.indexOf(step);if(a<0)return null;for(let i=0;i<r.length;i++)if(r[i]){const row=Lib.row(n,i);r[i]=row?r[i]*row[a]:0;}}
  prefix=prefix?prefix+'/'+step:step;}
 return r;
}
// Pot and chips put in on the flop so far, from the path's amounts (BET x and RAISE x add x chips).
function money(spot,path){
 let pot=spot.pot,last=0;
 for(const step of path?path.split('/'):[]){const m=step.match(/^(BET|RAISE) ([\d.]+)$/);if(m){last=+m[2];pot+=last;}else if(step==='CALL'){pot+=last;}}
 return{pot,last};
}
// Made-hand strength on the flop of every unblocked combo; top = the NUT_TOP share of them.
function strengths(flop){
 const board=boardOf(flop),dead=new Set(board),s=new Float64Array(Lib.COMBOS.length).fill(-1),all=[];
 Lib.COMBOS.forEach(([a,b],i)=>{if(dead.has(a)||dead.has(b))return;s[i]=C.evaluate([a,b],board);all.push(s[i]);});
 all.sort((x,y)=>y-x);return{s,top:all[Math.floor(all.length*T.NUT_TOP)]};
}
// Air: no pair that uses a hole card, no flush draw, no open-ended straight draw (gutshots and
// backdoors count as air, as in most bluff-ratio counts).
function air(a,b,board){
 const hole=[a>>2,b>>2],br=board.map(c=>c>>2);if(hole[0]===hole[1]||hole.some(r=>br.includes(r)))return false;
 const suits=[a,b,...board].map(c=>c&3);if([a,b].some(c=>suits.filter(s=>s===(c&3)).length>=4))return false;
 const set=new Set([...hole,...br].map(r=>r+2));if(set.has(14))set.add(1);
 for(let lo=1;lo<=10;lo++){const run=[0,1,2,3].every(k=>set.has(lo+k));if(run&&lo>1&&lo+4<=14&&hole.some(r=>{const v=r+2;return v>=lo&&v<lo+4||v===14&&lo===1;}))return false;}
 return true;
}

function checkSpot(spot){
 const flops=Object.entries(spot.flops||{}),res={id:spot.id,label:spot.label||spot.id,chart:spot.chart?.name||'',flops:flops.length,fails:[],warns:[],badFlops:{},overfolds:{},stats:{}};
 if(spot.broken)res.fails.push(spot.broken.length+' unreadable flop files');
 if(!flops.length){res.fails.push('no flops');return res;}
 let W=0,EX=0,bad=0,maxEx=0,iters=[];
 const defence=new Map(),bluff={air:0,all:0};let nut={fold:0,all:0},rowBad=0,rowAll=0,rootMiss=0;
 for(const [key,flop]of flops){
  const w=flop.weight||1,ex=Number(flop.exploitability);W+=w;iters.push(flop.iterations||0);
  if(!Number.isFinite(ex)){res.badFlops[key]='no exploitability';bad+=w;continue;}
  EX+=w*ex;maxEx=Math.max(maxEx,ex);if(ex>T.FLOP_EXPL){bad+=w;res.badFlops[key]='exploitability '+ex.toFixed(2)+'% pot';}
  const nodes=new Map(flop.nodes.map(n=>[n.path,n])),board=boardOf(key),{s,top}=strengths(key);
  // Rows: every combo with a non-zero row should sum to 255 (±ROW_SUM).
  for(const n of flop.nodes){const A=n.actions.length,t=n.bytes||(n.bytes=Uint8Array.from(Buffer.from(n.table,'base64')));for(let i=0;i<Lib.COMBOS.length;i++){let sum=0;for(let a=0;a<A;a++)sum+=t[i*A+a];if(sum){rowAll++;if(Math.abs(sum-255)>T.ROW_SUM)rowBad++;}}}
  // The root covers the first actor's whole range (TexasSolver drops weights under 0.005).
  const root=nodes.get('');if(root){const r=reach(spot,key,nodes,'',root.player);for(let i=0;i<r.length;i++)if(r[i]>.006&&!Lib.row(root,i))rootMiss++;}
  // First bets: a BET right after the start or after a check, faced by the other player.
  for(const n of flop.nodes){
   const steps=n.path?n.path.split('/'):[],lastStep=steps[steps.length-1]||'';
   if(!/^BET /.test(lastStep)||steps.slice(0,-1).some(x=>x!=='CHECK'))continue;
   const {pot,last}=money(spot,n.path),alpha=last/pot,f=n.actions.indexOf('FOLD');if(f<0)continue;
   // All-in first bets are rare and huge (alpha near 1/2 at any SPR); keep the normal sizes.
   const allin=last>=spot.stack*.66;
   const r=reach(spot,key,nodes,n.path,n.player);if(!r)continue;
   let tot=0,fold=0;for(let i=0;i<r.length;i++)if(r[i]>0){const row=Lib.row(n,i);if(!row)continue;tot+=r[i];fold+=r[i]*row[f];
    if(s[i]>=top&&!allin){nut.all+=w*r[i];nut.fold+=w*r[i]*row[f];if(row[f]>.5&&!res.badFlops[key])res.badFlops[key]=C.cardName(Lib.COMBOS[i][0])+C.cardName(Lib.COMBOS[i][1])+' (top '+Math.round(T.NUT_TOP*100)+'%) folds '+Math.round(row[f]*100)+'% to '+lastStep;}}
   if(!tot)continue;const share=fold/tot,label=(steps.length===1?n.player==='ip'?'IP vs donk':'OOP vs bet':'vs bet after check')+(allin?' all-in':' '+Math.round(100*last/(pot-last))+'%');
   if(!allin&&share>alpha+T.FLOP_OVERFOLD)res.overfolds[key]='folds '+Math.round(share*100)+'% to '+lastStep+' (alpha '+Math.round(alpha*100)+'%)';
   const d=defence.get(label)||{w:0,fold:0,alpha:0,reach:0,allin};
   // Weight each flop by its deal weight times how often the line is reached (bettor's bet share).
   const bettor=n.player==='ip'?'oop':'ip',prev=nodes.get(steps.slice(0,-1).join('/')),br=reach(spot,key,nodes,steps.slice(0,-1).join('/'),bettor);
   let bet=0,all=0;if(prev&&br){const a=prev.actions.indexOf(lastStep);for(let i=0;i<br.length;i++)if(br[i]>0){const row=Lib.row(prev,i);if(!row)continue;all+=br[i];bet+=br[i]*row[a];
    if(!allin&&row[a]>0){bluff.all+=w*br[i]*row[a];if(air(...Lib.COMBOS[i],board))bluff.air+=w*br[i]*row[a];}}}
   const lw=w*(all?bet/all:0);d.w+=lw;d.fold+=lw*share;d.alpha+=lw*alpha;d.reach+=w;defence.set(label,d);
  }
 }
 const mean=EX/W;res.stats={meanExpl:+mean.toFixed(3),maxExpl:+maxEx.toFixed(3),badShare:+(bad/W).toFixed(3),iterations:[Math.min(...iters),Math.max(...iters)],rowsOff:rowBad,rows:rowAll,rootMissing:rootMiss};
 if(mean>T.MEAN_EXPL)res.fails.push('mean exploitability '+mean.toFixed(2)+'% pot (max '+T.MEAN_EXPL+')');
 if(bad/W>T.BAD_SHARE)res.fails.push(Math.round(100*bad/W)+'% of flops above '+T.FLOP_EXPL+'% pot');
 if(rowBad>rowAll*.001)res.fails.push(rowBad+' of '+rowAll+' rows do not sum to 255');
 if(rootMiss)res.fails.push(rootMiss+' in-range combos have no row at the root');
 res.stats.defence={};
 for(const [label,d]of defence){if(!d.w)continue;const fold=d.fold/d.w,alpha=d.alpha/d.w;res.stats.defence[label]={fold:+fold.toFixed(3),alpha:+alpha.toFixed(3)};
  if(!d.allin&&fold>alpha+T.OVERFOLD)res[fold>alpha+T.OVERFOLD_FAIL?'fails':'warns'].push(label+': folds '+Math.round(100*fold)+'% vs alpha '+Math.round(100*alpha)+'% (any two cards bluff)');
  if(!d.allin&&fold<.02)res.warns.push(label+': almost never folds ('+(100*fold).toFixed(1)+'%)');}
 if(nut.all){const f=nut.fold/nut.all;res.stats.nutFold=+f.toFixed(4);if(f>T.NUT_FOLD)res.fails.push('top '+Math.round(T.NUT_TOP*100)+'% hands fold '+(100*f).toFixed(1)+'% to the first bet');}
 if(bluff.all){const b=bluff.air/bluff.all;res.stats.airInBets=+b.toFixed(3);if(b<T.BLUFF_MIN)res.warns.push('first bets have no air ('+(100*b).toFixed(1)+'%)');if(b>T.BLUFF_MAX)res.warns.push('first bets are '+Math.round(100*b)+'% air');}
 return res;
}

if(require.main===module){
 const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
 const inputs=args.filter((a,i)=>!a.startsWith('--')&&!['--json','--md'].includes(args[i-1]));
 if(!inputs.length){console.log('Usage: node tools/postflop/balance-check.cjs <library files or folders> [--json file] [--md file] [--mark]');process.exit(1);}
 const all=spots(inputs),results=[];let fails=0;
 for(const {spot,file,write}of all){
  const r=checkSpot(spot);r.file=file;results.push(r);if(r.fails.length)fails++;
  const s=r.stats,d=Object.entries(s.defence||{}).map(([k,v])=>k+' '+Math.round(v.fold*100)+'/'+Math.round(v.alpha*100)).join(', ');
  console.log((r.fails.length?'FAIL':'ok  ')+' '+r.label+' ['+r.id+'] '+r.flops+' flops, expl mean '+s.meanExpl+' max '+s.maxExpl+'% pot'+(s.airInBets!=null?', air '+Math.round(s.airInBets*100)+'%':'')+(s.nutFold!=null?', nut folds '+(s.nutFold*100).toFixed(1)+'%':'')+(d?'\n       fold/alpha %: '+d:'')+(r.fails.length?'\n       -- '+r.fails.join('; '):'')+(r.warns.length?'\n       warn: '+r.warns.join('; '):'')+(Object.keys(r.overfolds).length?'\n       '+Object.keys(r.overfolds).length+' flops fold 30+ points over alpha (warning): '+Object.entries(r.overfolds).slice(0,3).map(([k,v])=>k+' '+v).join('; '):'')+(Object.keys(r.badFlops).length?'\n       '+Object.keys(r.badFlops).length+' flops flagged: '+Object.entries(r.badFlops).slice(0,4).map(([k,v])=>k+' '+v).join('; ')+(Object.keys(r.badFlops).length>4?' ...':''):''));
  if(args.includes('--mark')){
   const gate=r.fails.length||Object.keys(r.badFlops).length?{checked:new Date().toISOString().slice(0,10),...r.fails.length?{fail:r.fails.join('; ')}:{},flops:r.badFlops}:null;
   if(gate)spot.gate=gate;else delete spot.gate;delete spot.broken;write(spot);
  }
 }
 const pass=results.length-fails;console.log(`\n${pass} of ${results.length} spots pass, ${fails} fail. Flagged flops: ${results.reduce((s,r)=>s+Object.keys(r.badFlops).length,0)}.`);
 if(opt('--json'))fs.writeFileSync(opt('--json'),JSON.stringify({thresholds:T,results},null,1));
 if(opt('--md'))fs.writeFileSync(opt('--md'),'| Spot | Flops | Expl. mean / max (% pot) | Fold vs alpha (first bet) | Air in bets | Nut folds | Verdict |\n|---|---|---|---|---|---|---|\n'+results.map(r=>`| ${r.label} | ${r.flops} | ${r.stats.meanExpl} / ${r.stats.maxExpl} | ${Object.entries(r.stats.defence||{}).map(([k,v])=>k+' '+Math.round(v.fold*100)+'/'+Math.round(v.alpha*100)).join('; ')} | ${r.stats.airInBets!=null?Math.round(r.stats.airInBets*100)+'%':''} | ${r.stats.nutFold!=null?(r.stats.nutFold*100).toFixed(1)+'%':''} | ${r.fails.length?'FAIL: '+r.fails.join('; '):'pass'}${r.warns.length?'; warn: '+r.warns.join('; '):''}${Object.keys(r.badFlops).length?' ('+Object.keys(r.badFlops).length+' flops ungraded)':''} |`).join('\n')+'\n');
 process.exit(fails?2:0);
}
module.exports={checkSpot,spots,T};
