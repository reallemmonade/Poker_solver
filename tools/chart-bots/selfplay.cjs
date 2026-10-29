#!/usr/bin/env node
'use strict';
// Chart-vs-chart preflop self-play. Every seat plays the chart through the app's own lookup
// (PokerPreflop.query on a live PokerGame.Hand), sampling mixed frequencies with a seeded
// generator. Hands that reach a flop or an all-in are paid by the chart's own payoff model
// (tools/preflop/solve.cjs): all-in pots by all-in equity from tools/preflop/equity-table.json,
// flop pots by the equity-realization share, for the two dealt hand classes. That is the
// game the chart was solved in, so no real postflop play is simulated.
//   node tools/chart-bots/selfplay.cjs [--library manifest|dir] [--hands 20000] [--seed 1]
//        [--games nlh] [--modes cash,mtt] [--seats 2-9] [--depths 100] [--jobs 4] [--out dir]
const path=require('path'),L=require('./lib.cjs');
const {G,P}=L;

function playPack(lib,meta,{hands,seed}){
 const {raw,pack,id}=L.loadPack(lib,meta),M=L.buildModel(raw),S=M.solver,n=S.n,K=S.K,cfg=pack.config;
 const sums=new Float64Array(n),sq=new Float64Array(n),r=L.rng(seed),stats={noAdvice:0,noAdviceHands:0,decisions:0,mismatch:0,autoFolds:0,flops:0,allins:0,folds:0,rake:0,noAdviceSpots:{}};
 for(let h=0;h<hands;h++){
  const hand=L.newHand(cfg,Math.floor(r()*4294967296)||1),cls=hand.holes.map(cs=>L.classOf(pack,cs));let node=S.tree.root,missed=false;
  while(node.type==='decision'){
   // Seats the trimmed tree leaves out (players left to fold to a 3-bet) fold.
   while(!hand.done&&hand.street===0&&hand.actor!==node.actor){hand.act({kind:'fold'});stats.autoFolds++;}
   const A=node.actions.length,q=P.query(pack,hand);let probs=new Array(A).fill(0);stats.decisions++;
   if(q){q.actions.forEach((a,j)=>{const k=node.actions.findIndex(x=>x.kind===a.kind&&(a.kind!=='raise'||G.units(x.to)===a.target));if(k<0)stats.mismatch++;else probs[k]+=q.reference[j]||0;});}
   if(!q||!(probs.reduce((a,b)=>a+b,0)>.999)){
    // No chart answer for this hand here (an off-path node or a class that almost never
    // gets here): the user would get no chart advice. The pack's raw row keeps the hand going.
    stats.noAdvice++;missed=true;const key=L.spotName(n,node);stats.noAdviceSpots[key]=(stats.noAdviceSpots[key]||0)+1;
    const sg=S.strategy(node,true),i=cls[node.actor];probs=Array.from({length:A},(_,k)=>sg[k*K+i]);
   }
   const k=L.sample(probs,r()),a=node.actions[k];
   hand.act(a.kind==='raise'?{kind:'raise',target:G.units(a.to)}:{kind:a.kind});
   node=node.children[k];
  }
  if(missed)stats.noAdviceHands++;
  const pay=L.payoffs(S,node,cls);stats[node.type==='fold'?'folds':node.type==='allin'?'allins':'flops']++;if(node.net!==undefined)stats.rake+=node.pot-node.net;
  for(let s=0;s<n;s++){sums[s]+=pay[s];sq[s]+=pay[s]*pay[s];}
 }
 const ex=S.exploitability(),seats=[];
 for(let s=0;s<n;s++){const mean=sums[s]/hands,sd=Math.sqrt(Math.max(0,sq[s]/hands-mean*mean));seats.push({seat:s,name:L.seatName(n,s),mc:100*mean,se:100*sd/Math.sqrt(hands),exact:100*ex.values[s],blind:-100*(S.tree.root.type==='decision'?blindOf(S,s):0)});}
 // Sanity checks.
 const checks=[],add=(ok,text,robust=true)=>checks.push({ok,text,robust});
 const mcSum=seats.reduce((a,x)=>a+x.mc,0),rakeMC=100*stats.rake/hands;
 add(Math.abs(mcSum+rakeMC)<1e-6,`self-play winrates sum to minus rake: ${mcSum.toFixed(3)} vs -${rakeMC.toFixed(3)} bb/100`);
 add(Math.abs(100*ex.zeroSum+rakeMC)<0.5,`exact model values sum to ${(100*ex.zeroSum).toFixed(2)} bb/100 (rake ${rakeMC.toFixed(2)}); the model's card-removal shortcut (removal against the narrowest folded range only) makes it non-zero-sum`,false);
 const btn=seats[0],first=n>3?seats[3]:null;
 if(first)add(btn.exact>first.exact,`BTN (${btn.exact.toFixed(1)}) beats ${first.name} (${first.exact.toFixed(1)}) bb/100`);
 if(n>3){const order=[...Array(n-3).keys()].map(k=>seats[3+k]).concat([btn]);const bad=order.slice(1).filter((x,i)=>x.exact+0.5<order[i].exact);add(!bad.length,`non-blind seats earn more the later they act${bad.length?' (not: '+bad.map(x=>x.name).join(', ')+')':''}`);}
 for(const x of seats)if(x.blind)add(x.exact>x.blind,`${x.name} does better than folding every hand (${x.exact.toFixed(1)} > ${x.blind} bb/100)`);
 for(const x of seats)if(Math.abs(x.mc-x.exact)>4*x.se+0.5)add(false,`${x.name}: self-play ${x.mc.toFixed(1)}±${x.se.toFixed(1)} disagrees with the exact model value ${x.exact.toFixed(1)} bb/100 (lookup or tree mismatch)`);
 add(stats.mismatch===0,`app actions match the tree's (${stats.mismatch} mismatches)`);
 add(M.unmatched.length===0&&M.extra.length===0,`chart nodes match the rebuilt tree (${M.unmatched.length} missing, ${M.extra.length} extra)`);
 add(M.claimedNashConv===null||Math.abs(ex.nashConv-M.claimedNashConv)<=Math.max(.002,.5*M.claimedNashConv),`NashConv of the shipped rows in the rebuilt model ${ex.nashConv.toFixed(4)} vs ${M.claimedNashConv} claimed by the pack (per-mille rounding and model rebuild)`);
 add(stats.noAdviceHands/hands<0.01,`${L.pct(stats.noAdviceHands/hands,2)} of chart-following hands meet a decision where the app gives no chart answer`);
 return{id,name:meta.name,seats:n,stack:meta.stack,mode:meta.mode,variant:meta.variant,hands,seed,perSeat:seats,stats:{...stats,noAdviceRate:stats.noAdviceHands/hands,rakePer100:rakeMC},nashConv:ex.nashConv,claimedNashConv:M.claimedNashConv,gains:ex.gains,zeroSum:ex.zeroSum,notes:M.notes,checks};
}

// Chips a seat loses by folding every hand: its blind plus any big-blind ante.
function blindOf(S,s){const o=S.o,[sb,bb]=require(L.ROOT+'/tools/preflop/tree.cjs').blinds(S.n);return s===sb?o.sb:s===bb?o.bb+(o.ante||0):0;}

function report(results,lib,o){
 let md=`# Chart self-play (${lib.version})\n\nEvery seat plays the chart through the app's own lookup (PokerPreflop.query), ${o.hands} hands per chart, seed ${o.seed}. Flop and all-in pots are paid by the chart's own payoff model (equity table plus realization share), so these are winrates inside the model, not real postflop results. "exact" is the same model evaluated over whole ranges (no sampling); "self-play" is the sampled estimate with its standard error.\n\n`;
 const fails=results.flatMap(r=>r.checks.filter(c=>!c.ok).map(c=>({r,c})));
 md+=`## Failed checks (${fails.length})\n\n`+(fails.length?L.mdTable(['chart','check','robust'],fails.map(({r,c})=>[r.id,c.text,c.robust?'yes':'model artefact'])):'None.\n')+'\n';
 md+=`## Winrates (bb/100, exact model / self-play ± SE)\n\n`;
 for(const r of results){
  md+=`### ${r.id}\n\nNashConv ${r.nashConv.toFixed(4)} bb/hand (pack claims ${r.claimedNashConv}); no chart answer in ${L.pct(r.stats.noAdviceRate,2)} of hands; ${L.pct(r.stats.flops/r.hands)} flops, ${L.pct(r.stats.allins/r.hands)} all-ins.${r.notes.length?' Notes: '+r.notes.join(' '):''}\n\n`;
  md+=L.mdTable(['seat','exact','self-play','best-response gain'],r.perSeat.map((s,i)=>[s.name,L.f(s.exact,1),L.f(s.mc,1)+' ± '+L.f(s.se,1),L.f(100*r.gains[i],2)]));
  const spots=Object.entries(r.stats.noAdviceSpots).sort((a,b)=>b[1]-a[1]).slice(0,5);if(spots.length)md+='\nNo-answer spots: '+spots.map(([k,v])=>`${k} (${v})`).join('; ')+'\n';
  md+='\n';
 }
 return md;
}

async function main(){
 const o=L.parseArgs(process.argv.slice(2),{hands:20000,seed:1,jobs:4,games:'nlh',modes:'cash,mtt'});
 if(o.quick&&!process.argv.includes('--hands'))o.hands=4000;
 const lib=L.openLibrary(o.library);
 if(o.worker){for(const name of L.workerItems()){const meta=lib.packs.find(m=>m.name===name);process.stdout.write(JSON.stringify(playPack(lib,meta,o))+'\n');}return;}
 const metas=L.selectPacks(lib,o),t=Date.now();
 const extra=process.argv.slice(2).filter((a,i,arr)=>!['--jobs','--out'].includes(a)&&!['--jobs','--out'].includes(arr[i-1]));
 const results=(await L.parallel(__filename,metas.map(m=>m.name),o.jobs,extra)).sort((a,b)=>a.variant.localeCompare(b.variant)||a.mode.localeCompare(b.mode)||a.seats-b.seats||a.stack-b.stack);
 const out=o.out||L.defaultOut(lib);
 L.writeOut(out,'selfplay',{json:{version:lib.version,library:lib.spec,hands:o.hands,seed:o.seed,seconds:(Date.now()-t)/1000,results},md:report(results,lib,o)});
 console.log(`selfplay: ${results.length} charts, ${results.reduce((a,r)=>a+r.checks.filter(c=>!c.ok).length,0)} failed checks, ${((Date.now()-t)/1000).toFixed(0)}s -> ${path.join(out,'selfplay.md')}`);
}
module.exports={playPack};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
