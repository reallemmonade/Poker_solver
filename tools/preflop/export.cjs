'use strict';
// Solve a trimmed preflop game and write it as a Range Lab chart pack.
//   node tools/preflop/export.cjs --seats 9 --stack 200 --format cash [--game plo] --iterations 2000 --out pack.json
// format "mtt" adds a 1bb big-blind ante and marks the pack as chip-EV, so it
// matches tournament tables whatever their payouts.
const fs=require('fs'),{Solver,PLAY}=require('./solve.cjs');
const P=require('../../studio/preflop.js');

// NLH open sizes by format and depth: 2bb when short, 2.2bb in tournaments, 2.5bb in cash.
// PLO raises are always pot-sized. PLO equities run closer, so a smaller realization edge (x1.05 in position) matches published 6-max opening ranges.
function game({seats,stack,format,game='nlh'}){
 const short=stack<40,mtt=format==='mtt',ante=mtt?1:0;
 if(game==='plo')return{seats,stack,ante,variant:'PLO4',potLimit:true,realization:.05,foldRemoval:false};
 return{seats,stack,ante,open:short?2:mtt?2.2:2.5,sbOpen:short?2.5:3};
}

// Rows are rounded to 4 decimals; the largest entry absorbs the rounding error.
function tidy(row){
 const r=row.map(x=>Math.round(x*1e4)/1e4),big=r.indexOf(Math.max(...r));
 r[big]=0;r[big]=1-r.reduce((a,b)=>a+b,0);return r;
}

function solve(spec,{iterations=2000,every=500,log=()=>{}}={}){
 const solver=new Solver(game(spec)),o=solver.o,m=solver.m,plo=m.variant==='PLO4',start=Date.now();let gap;
 while(solver.t<iterations){
  solver.iterate(Math.min(every,iterations-solver.t));gap=solver.exploitability();
  log(`${solver.t} iterations, ${((Date.now()-start)/1000).toFixed(0)}s, NashConv ${gap.nashConv.toFixed(4)} bb/hand`);
 }
 const nodes=solver.tree.nodes.map(node=>{
  const rows=solver.rows(node),strategy={};for(const c of m.classes)strategy[c]=tidy(rows[c]);
  return{seat:node.actor,history:node.history.map(e=>({seat:e.seat,kind:e.kind,...e.kind==='raise'?{to:e.to}:{}})),
   actions:node.actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:a.to}:{}})),strategy};
 });
 const n=o.seats,mtt=spec.format==='mtt',settings=[
  `${n}-handed, ${o.stack}bb, blinds ${o.sb}/${o.bb}, ${mtt?'1bb big-blind ante, chip EV (no ICM)':'no ante or rake'}.`,
  plo?`Pot-limit, four-card Omaha. Every raise is pot-sized; all-in once a pot raise reaches the stack. Hands are grouped into ${m.K} groups by suits, pairing, connectedness, suited ace and equity against a random hand; everything in a group plays the same strategy.`:`Sizes: open ${o.open}bb (SB ${o.sbOpen}bb), 3-bet ${o.threeBetIP}x in position or ${o.threeBetOOP}x from the blinds plus ${o.squeezePerCaller}x per caller, 4-bet ${o.fourBet}x${o.deep?', 5-bet '+o.fiveBet+'x':''}, then all-in; any raise to ${o.jamShare*100}% of the stack or more is all-in${o.extraJam?'; all-in is also offered at every raise':''}.`,
  'Trimmed tree: no open-limps, at most one player flats an open, other players fold to a 3-bet, a flatter continues against a squeeze only if the opener folds, and every flop is heads-up.',
  `Postflop is not played out. All-in pots pay all-in equity; flop pots pay an equity-realization share (in position x${(1+o.realization).toFixed(2)}, out of position x${(1-o.realization).toFixed(2)}, playability ${plo?'by hand shape, see tools/preflop/plo-model.cjs':JSON.stringify({...PLAY,...o.playability})}).`,
  ...plo?['Approximate: grouped PLO hands and a realization model, not a full PLO solve.']:[],
  `CFR+ with linear averaging, ${solver.t} iterations, NashConv ${gap.nashConv.toFixed(4)} bb/hand within this model.`,
 ].join(' ');
 const config={variant:plo?'PLO4':'NLH',seats:n,stacks:Array(n).fill(o.stack),sb:o.sb,bb:o.bb,mode:mtt?'icm':'cash',button:0,...mtt?{ante:o.ante,anteMode:'bigblind',payouts:[1]}:{}};
 const pack={format:'range-lab-preflop-reference-v1',name:`${plo?'PLO':'NLH'} ${mtt?'MTT':'cash'} ${n}-handed ${o.stack}bb (Range Lab CFR+ model${plo?', approximate':''})`,...mtt?{chipEV:true}:{},...plo?{handGroups:m.handGroups}:{},
  source:{name:'Range Lab preflop CFR+ model',url:'https://github.com/reallemmonade/poker_solver/tree/main/tools/preflop',solver:'Range Lab preflop CFR+ (tools/preflop) with an equity-realization postflop model',settings,createdAt:new Date().toISOString()},
  config,nodes};
 P.validate(pack);
 return{pack,nashConv:gap.nashConv,checks:checks(solver)};
}

// Poker sanity checks on the first-in decisions. PLO hands are looked up by group.
function checks(solver){
 const m=solver.m,plo=m.variant==='PLO4',P=require('../../studio/preflop.js'),G=require('../../studio/game.js');
 const label=h=>plo?m.handGroups.labels[parseInt(m.handGroups.classes.substr(2*P.ploClasses().classOf(G.Core.cards(h)),2),36)]:h;
 const premium=plo?['AsAhKsKh','AsAhJsTh']:['AA','KK'],trash=label(plo?'7c7d7h2s':'72o');
 const first=solver.tree.nodes.filter(n=>n.history.every(e=>e.kind==='fold')),problems=[],opens=[];
 const n=solver.o.seats,sb=n===2?0:1;
 for(const node of first){
  const rows=solver.rows(node),fold=node.actions.findIndex(a=>a.kind==='fold');
  for(const h of premium)if(rows[label(h)][fold]>.01)problems.push(`seat ${node.actor} folds ${h} ${(100*rows[label(h)][fold]).toFixed(1)}%`);
  const open=1-m.classes.reduce((s,c,i)=>s+m.weight[i]*rows[c][fold],0);
  if(node.actor!==sb)opens.push({seat:node.actor,open});
 }
 if(first[0]&&n>2&&solver.o.stack>=20){const rows=solver.rows(first[0]),fold=first[0].actions.findIndex(a=>a.kind==='fold');if(rows[trash][fold]<.99)problems.push(`first position opens ${plo?'7c7d7h2s':'72o'} ${(100*(1-rows[trash][fold])).toFixed(1)}%`);}
 for(let i=1;i<opens.length;i++)if(opens[i].open+.02<opens[i-1].open)problems.push(`seat ${opens[i].seat} opens less than the seat before it`);
 return{opens:opens.map(x=>+(100*x.open).toFixed(1)),problems};
}

module.exports={solve,game,checks};

if(require.main===module){
 const args={seats:9,stack:200,format:'cash',game:'nlh',iterations:2000,every:500,out:null};
 for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=['out','format','game'].includes(k)?v:Number(v);}
 const out=args.out||`${args.game}-${args.format}-${args.seats}max-${args.stack}bb.json`;
 const r=solve(args,{iterations:args.iterations,every:args.every,log:console.log});
 fs.writeFileSync(out,JSON.stringify(r.pack));
 console.log(`Wrote ${out}: ${r.pack.nodes.length} nodes, ${(fs.statSync(out).size/1e6).toFixed(1)} MB, validated. Opens ${r.checks.opens.join('/')}%. ${r.checks.problems.length?'Problems: '+r.checks.problems.join('; '):'Checks passed.'}`);
}
