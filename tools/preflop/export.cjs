'use strict';
// Solve a trimmed preflop game and write it as a Range Lab chart pack.
//   node tools/preflop/export.cjs --seats 9 --stack 200 --format cash [--game plo] --iterations 2000 --out pack.json
// format "mtt" adds a 1bb big-blind ante and marks the pack as chip-EV, so it
// matches tournament tables whatever their payouts.
const fs=require('fs'),{Solver,PLAY}=require('./solve.cjs');
const P=require('../../studio/preflop.js');

// NLH open sizes by format and depth: 2bb when short, 2.2bb in tournaments, 2.5bb in cash.
// Up to 200bb NLH drops 4-bet flats that leave under 6x the pot behind, so the 5-bet jam range keeps KK and AK (see README).
// PLO raises are always pot-sized. PLO equities run closer, so realization is sharper (hands
// behind realize much less), position counts for more and the last raiser gets no extra edge;
// this matches published 6-max opening ranges and leaves room to flat in position.
// A calibration file (tools/preflop/calibrate.cjs) replaces the NLH realization settings and
// playability with values fitted to TexasSolver flop solves.
function game({seats,stack,format,game='nlh',rake=0,rakeCap=3,limp=0,calibration=null}){
 const short=stack<40,mtt=format==='mtt',ante=mtt?1:0;rake=mtt?0:rake;
 if(game==='plo')return{seats,stack,ante,rake,rakeCap,limp:!!limp,variant:'PLO4',potLimit:true,realization:.1,initiative:0,sharpness:1.5,foldRemoval:false};
 const cal=calibration?JSON.parse(fs.readFileSync(calibration,'utf8')):null;
 return{seats,stack,ante,rake,rakeCap,limp:!!limp,open:short?2:mtt?2.2:2.5,sbOpen:short?2.5:3,...stack<=200?{callSPR:6}:{},...cal?{realization:cal.realization,initiative:cal.initiative,sharpness:cal.sharpness,playTable:cal.play,calibrated:cal.source}:{}};
}

// Rows are rounded to 4 decimals; the largest entry absorbs the rounding error.
function tidy(row){
 const r=row.map(x=>Math.round(x*1e4)/1e4),big=r.indexOf(Math.max(...r));
 r[big]=0;r[big]=1-r.reduce((a,b)=>a+b,0);return r;
}

// CFR+ is not guaranteed to settle with more than two players, so the averaged strategy
// with the lowest NashConv over the checkpoints (every `every` iterations) is the one kept.
function solve(spec,{iterations=2000,every=500,log=()=>{}}={}){
 every=Math.max(1,Math.floor(every)||1);
 const solver=new Solver(game(spec)),o=solver.o,m=solver.m,plo=m.variant==='PLO4',start=Date.now();let gap=null,best=null;
 const check=()=>{gap=solver.exploitability();log(`${solver.t} iterations, ${((Date.now()-start)/1000).toFixed(0)}s, NashConv ${gap.nashConv.toFixed(4)} bb/hand`);
  if(!best||gap.nashConv<best.gap.nashConv)best={gap,t:solver.t,sums:solver.tree.nodes.map(n=>n.sum.slice())};};
 while(solver.t<iterations){solver.iterate(Math.min(every,iterations-solver.t));check();}
 if(!best)check();
 if(best.t!==solver.t){solver.tree.nodes.forEach((n,i)=>n.sum.set(best.sums[i]));gap=best.gap;log(`Keeping the averaged strategy from ${best.t} iterations (lowest NashConv).`);}
 const reach=lineReach(solver);
 const nodes=solver.tree.nodes.map((node,i)=>{
  const rows=solver.rows(node),strategy={};for(const c of m.classes)strategy[c]=tidy(rows[c]);
  return{seat:node.actor,history:node.history.map(e=>({seat:e.seat,kind:e.kind,...e.kind==='raise'?{to:e.to}:{}})),
   actions:node.actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:a.to}:{}})),strategy,reach:+reach[i].toPrecision(2)};
 });
 const n=o.seats,mtt=spec.format==='mtt',settings=[
  `${n}-handed, ${o.stack}bb, blinds ${o.sb}/${o.bb}, ${mtt?'1bb big-blind ante, chip EV (no ICM)':o.rake>0?`no ante; ${o.rake}% rake capped at ${o.rakeCap}bb, no flop no drop (a flop pot is raked as if it grew ${o.rakeGrowth}x by the river)`:'no ante or rake'}.`,
  plo?`Pot-limit, four-card Omaha. Every raise is pot-sized; all-in once a pot raise reaches the stack. Hands are grouped into ${m.K} groups by suits, pairing, connectedness, suited ace and equity against a random hand; everything in a group plays the same strategy.`:`Sizes: open ${o.open}bb (SB ${o.sbOpen}bb), 3-bet ${o.threeBetIP}x in position or ${o.threeBetOOP}x from the blinds plus ${o.squeezePerCaller}x per caller, 4-bet ${o.fourBet}x${o.deep?', 5-bet '+o.fiveBet+'x':''}, then all-in; any raise to ${o.jamShare*100}% of the stack or more is all-in${o.extraJam?'; all-in is also offered at every raise':''}.`,
  `Trimmed tree: ${o.limp?`no open-limps except the small blind completing when folded to (the big blind then checks or raises to ${o.isoRaise}bb)`:'no open-limps'}, at most one player flats an open, other players fold to a 3-bet, a flatter continues against a squeeze only if the opener folds, facing a 4-bet a call that leaves under ${o.callSPR}x the pot behind is dropped, and every flop is heads-up.`,
  `Postflop is not played out. All-in pots pay all-in equity; flop pots pay an equity-realization share (odds to the power ${o.sharpness}, in position x${(1+o.realization).toFixed(2)}, out of position x${(1-o.realization).toFixed(2)}, last raiser x${(1+o.initiative).toFixed(2)}, playability ${plo?'by hand shape, see tools/preflop/plo-model.cjs':o.playTable?'per hand class, calibrated to '+o.calibrated:JSON.stringify({...PLAY,...o.playability})}), blended into all-in equity as the stack-to-pot ratio falls from ${o.flopSPR} to ${o.allInSPR}.`,
  ...plo?['Approximate: grouped PLO hands and a realization model, not a full PLO solve.']:[],
  `CFR+ with linear averaging, ${best.t} iterations, NashConv ${gap.nashConv.toFixed(4)} bb/hand within this model.`,
  'Each node carries reach: how often the averaged strategies arrive there (0-1). Lines that almost never happen (reach under 0.0001) are solved against a token range only and are less reliable.',
 ].join(' ');
 const config={variant:plo?'PLO4':'NLH',seats:n,stacks:Array(n).fill(o.stack),sb:o.sb,bb:o.bb,mode:mtt?'icm':'cash',button:0,...mtt?{ante:o.ante,anteMode:'bigblind',payouts:[1]}:{},...o.rake>0?{rakePct:o.rake,rakeCap:o.rakeCap,noFlopNoDrop:true}:{}};
 const pack={format:'range-lab-preflop-reference-v1',name:`${plo?'PLO':'NLH'} ${mtt?'MTT':'cash'} ${n}-handed ${o.stack}bb${o.rake>0?` rake ${o.rake}% cap ${o.rakeCap}bb`:''} (Range Lab CFR+ model${plo?', approximate':''})`,...mtt?{chipEV:true}:{},...plo?{handGroups:m.handGroups}:{},
  source:{name:'Range Lab preflop CFR+ model',url:'https://github.com/reallemmonade/poker_solver/tree/main/tools/preflop',solver:'Range Lab preflop CFR+ (tools/preflop) with an equity-realization postflop model',settings,createdAt:new Date().toISOString()},
  config,nodes};
 P.validate(pack);
 return{pack,nashConv:gap.nashConv,checks:checks(solver)};
}

// Each node's reach under the averaged strategies: the product over players of the share
// of their hands that play the line (folded ranges independent, no card removal).
function lineReach(solver,visit){
 const K=solver.K,w=solver.m.weight,out=new Float64Array(solver.tree.nodes.length);
 (function walk(node,reach){
  if(node.type!=='decision')return;
  out[node.id]=reach.reduce((p,r)=>{let s=0;for(let i=0;i<K;i++)s+=w[i]*r[i];return p*s;},1);if(visit)visit(node,reach,out[node.id]);
  const st=solver.strategy(node,true);
  node.children.forEach((c,k)=>{const next=reach.slice(),r=new Float64Array(K);for(let i=0;i<K;i++)r[i]=reach[node.actor][i]*st[k*K+i];next[node.actor]=r;walk(c,next);});
 })(solver.tree.root,Array.from({length:solver.n},()=>new Float64Array(K).fill(1)));
 return out;
}

// Poker sanity checks. PLO hands are looked up by group.
function checks(solver){
 const m=solver.m,plo=m.variant==='PLO4',P=require('../../studio/preflop.js'),G=require('../../studio/game.js');
 const label=h=>plo?m.handGroups.labels[parseInt(m.handGroups.classes.substr(2*P.ploClasses().classOf(G.Core.cards(h)),2),36)]:h;
 const premium=plo?['AsAhKsKh','AsAhJsTh']:['AA','KK'],trash=label(plo?'7c7d7h2s':'72o');
 const first=solver.tree.nodes.filter(n=>n.history.every(e=>e.kind==='fold')),problems=[],opens=[];
 const n=solver.o.seats,stack=solver.o.stack;
 for(const node of first){
  const rows=solver.rows(node),fold=node.actions.findIndex(a=>a.kind==='fold');
  for(const h of premium)if(rows[label(h)][fold]>.01)problems.push(`seat ${node.actor} folds ${h} ${(100*rows[label(h)][fold]).toFixed(1)}%`);
  const open=1-m.classes.reduce((s,c,i)=>s+m.weight[i]*rows[c][fold],0);
  if(node.actor!==1||n===2)opens.push({seat:node.actor,open});
 }
 if(first[0]&&n>2&&stack>=20){const rows=solver.rows(first[0]),fold=first[0].actions.findIndex(a=>a.kind==='fold');if(rows[trash][fold]<.99)problems.push(`first position opens ${plo?'7c7d7h2s':'72o'} ${(100*(1-rows[trash][fold])).toFixed(1)}%`);}
 for(let i=1;i<opens.length;i++)if(opens[i].open+.02<opens[i-1].open)problems.push(`seat ${opens[i].seat} opens less than the seat before it`);
 // Heads-up the button acts last after the flop and should open most hands.
 if(n===2&&stack>=20&&opens[0]&&opens[0].open<.6)problems.push(`heads-up button opens only ${(100*opens[0].open).toFixed(1)}%`);
 // Premiums continue against a single raise (an open or a 3-bet) on every line that is reached.
 const top=label(premium[0]),ti=m.classes.indexOf(top);
 lineReach(solver,(node,reach,line)=>{
  const fold=node.actions.findIndex(a=>a.kind==='fold'),R=node.history.filter(e=>e.kind==='raise'),raises=R.length;
  // NLH 40-200bb: KK stacks off against the 5-bet jam after 4-betting.
  const kk=m.classes.indexOf('KK');if(!plo&&fold>=0&&raises===4&&R[2].seat===node.actor&&stack>=40&&stack<=200&&line>=1e-5&&reach[node.actor][kk]>=.5){const f=solver.rows(node).KK[fold];if(f>.1)problems.push(`seat ${node.actor} folds KK ${(100*f).toFixed(1)}% to the jam after ${node.history.map(e=>e.seat+e.kind[0]+(e.to||'')).join(' ')}`);}
  if(fold<0||line<1e-4||raises<1||raises>2||stack>200||reach[node.actor][ti]<.5)return;
  const f=solver.rows(node)[top][fold];if(f>.01)problems.push(`seat ${node.actor} folds ${premium[0]} ${(100*f).toFixed(1)}% after ${node.history.map(e=>e.seat+e.kind[0]+(e.to||'')).join(' ')}`);
 });
 return{opens:opens.map(x=>+(100*x.open).toFixed(1)),problems};
}

module.exports={solve,game,checks,lineReach};

// Command-line arguments, checked so that a typo or a bad value stops with a message instead
// of looping, crashing later or quietly solving some other game.
function parseArgs(argv){
 const args={seats:9,stack:200,format:'cash',game:'nlh',iterations:2000,every:500,rake:0,rakeCap:3,limp:0,calibration:null,out:null},text=['out','format','game','calibration'];
 const fail=m=>{throw Error(m+'\nUsage: node tools/preflop/export.cjs [--seats 2-9] [--stack bb] [--format cash|mtt] [--game nlh|plo] [--iterations n] [--every n] [--rake pct --rakeCap bb] [--limp 1] [--calibration file.json] [--out file.json]');};
 for(let i=0;i<argv.length;i+=2){
  const k=argv[i].replace(/^--/,''),v=argv[i+1];
  if(!/^--/.test(argv[i])||!(k in args))fail(`Unknown option ${argv[i]}.`);
  if(v===undefined||/^--/.test(v))fail(`--${k} needs a value.`);
  args[k]=text.includes(k)?v:Number(v);
 }
 if(!Number.isInteger(args.seats)||args.seats<2||args.seats>9)fail('--seats must be a whole number from 2 to 9.');
 if(!Number.isFinite(args.stack)||args.stack<=1||args.stack>10000)fail('--stack must be more than the 1bb big blind (in big blinds, at most 10000).');
 if(!['cash','mtt'].includes(args.format))fail('--format must be cash or mtt.');
 if(!['nlh','plo'].includes(args.game))fail('--game must be nlh or plo.');
 if(!(args.rake>=0&&args.rake<=20)||!(args.rakeCap>=0))fail('--rake must be a percentage from 0 to 20 and --rakeCap at least 0 bb.');
 if(args.rake>0&&args.format!=='cash')fail('Rake applies to cash charts only.');
 if(args.calibration&&(args.game!=='nlh'||!fs.existsSync(args.calibration)))fail('--calibration needs an existing calibration file, and applies to NLH charts only.');
 for(const k of ['iterations','every'])if(!Number.isInteger(args[k])||args[k]<1)fail(`--${k} must be a whole number of at least 1.`);
 return args;
}
module.exports.parseArgs=parseArgs;

if(require.main===module){
 let args;try{args=parseArgs(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}
 const out=args.out||`${args.game}-${args.format}-${args.seats}max-${args.stack}bb.json`;
 const r=solve(args,{iterations:args.iterations,every:args.every,log:console.log});
 fs.writeFileSync(out,JSON.stringify(r.pack));
 console.log(`Wrote ${out}: ${r.pack.nodes.length} nodes, ${(fs.statSync(out).size/1e6).toFixed(1)} MB, validated. Opens ${r.checks.opens.join('/')}%. ${r.checks.problems.length?'Problems: '+r.checks.problems.join('; '):'Checks passed.'}`);
}
