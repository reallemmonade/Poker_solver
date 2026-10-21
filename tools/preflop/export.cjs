'use strict';
// Solve a trimmed preflop game and write it as a Range Lab chart pack.
//   node tools/preflop/export.cjs --seats 9 --stack 200 --iterations 1500 --out pack.json
const fs=require('fs'),path=require('path'),{Solver,classes,PLAY}=require('./solve.cjs');
const P=require('../../studio/preflop.js');

const args={seats:9,stack:200,iterations:1500,every:250,out:null};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=k==='out'?v:Number(v);}
const out=args.out||`${args.seats}max-${args.stack}bb-preflop-cfr.json`;

const solver=new Solver({seats:args.seats,stack:args.stack}),o=solver.o,start=Date.now();let gap;
while(solver.t<args.iterations){
 solver.iterate(Math.min(args.every,args.iterations-solver.t));gap=solver.exploitability();
 console.log(`${solver.t} iterations, ${((Date.now()-start)/1000).toFixed(0)}s, NashConv ${gap.nashConv.toFixed(4)} bb/hand`);
}

// Rows are rounded to 4 decimals; the largest entry absorbs the rounding error.
function tidy(row){
 const r=row.map(x=>Math.round(x*1e4)/1e4),big=r.indexOf(Math.max(...r));
 r[big]=0;r[big]=1-r.reduce((a,b)=>a+b,0);return r;
}
const nodes=solver.tree.nodes.map(node=>{
 const rows=solver.rows(node),strategy={};for(const c of classes)strategy[c]=tidy(rows[c]);
 return{seat:node.actor,history:node.history.map(e=>({seat:e.seat,kind:e.kind,...e.kind==='raise'?{to:e.to}:{}})),
  actions:node.actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:a.to}:{}})),strategy};
});
const n=o.seats,settings=[
 `${n}-handed, ${o.stack}bb, blinds ${o.sb}/${o.bb}, no ante or rake.`,
 `Sizes: open ${o.open}bb (SB ${o.sbOpen}bb), 3-bet ${o.threeBetIP}x in position or ${o.threeBetOOP}x from the blinds plus ${o.squeezePerCaller}x per caller, 4-bet ${o.fourBet}x, then all-in; any raise to ${o.jamShare*100}% of the stack or more is all-in.`,
 'Trimmed tree: no open-limps, at most one player flats an open, other players fold to a 3-bet, a flatter continues against a squeeze only if the opener folds, and every flop is heads-up.',
 `Postflop is not played out. All-in pots pay all-in equity; flop pots pay an equity-realization share (in position x${(1+o.realization).toFixed(2)}, out of position x${(1-o.realization).toFixed(2)}, playability ${JSON.stringify({...PLAY,...o.playability})}).`,
 `CFR+ with linear averaging, ${solver.t} iterations, NashConv ${gap.nashConv.toFixed(4)} bb/hand within this model.`,
].join(' ');
const pack={format:'range-lab-preflop-reference-v1',name:`${n}-handed ${o.stack}bb preflop (Range Lab CFR+ model)`,
 source:{name:'Range Lab preflop CFR+ model',url:'https://github.com/reallemmonade/poker_solver/tree/main/tools/preflop',solver:'Range Lab preflop CFR+ (tools/preflop) with an equity-realization postflop model',settings,createdAt:new Date().toISOString()},
 config:{variant:'NLH',seats:n,stacks:Array(n).fill(o.stack),sb:o.sb,bb:o.bb,mode:'cash',button:0},nodes};
P.validate(pack);
fs.writeFileSync(out,JSON.stringify(pack));
console.log(`Wrote ${out}: ${nodes.length} nodes, ${(fs.statSync(out).size/1e6).toFixed(1)} MB, validated.`);
