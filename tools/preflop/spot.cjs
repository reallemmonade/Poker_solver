'use strict';
// Solves one preflop spot that no chart covers (Solve this spot, through the Mac bridge).
//   node tools/preflop/spot.cjs spot.json result.json [--mw-solver path] [--threads n] [--effort quick|standard|deep]
// spot.json: {config, actions, actor, heroCards}, the app's own hand (studio/game.js): the table, the preflop
// actions so far and the player to act.
//
// The chart solver (solve.cjs) plays the whole preflop game again with this hand's line forced into its tree
// (tree.cjs force): each action on the line is added where the trimmed tree leaves it out, and the player to act
// gets every action. Off the line, the usual trimmed tree is played, so everyone's ranges on the way come from
// the same game. Near the line, pots can reach the flop three-way:
// 1. A first pass pays them with the three-way equity table (equity3.cpp) and the heads-up realization settings.
// 2. Each three-way flop pot the spot can lead to (the likeliest three) is played out by the 3-way solver
//    (tools/multiway-solver) on sample flops with the first pass's ranges, and its realization (sharpness, a
//    factor per postflop position and one for the last raiser) is fitted to the solver's EVs by hand class.
// 3. A second pass solves again with those fits.
// A spot where you can see the flop four or more ways is refused: those pots only have a rough model.
// Progress lines ("Progress: <0-1> <seconds left>") go to stdout for the bridge.
const fs=require('fs'),os=require('os'),path=require('path'),{spawn,execFileSync}=require('child_process');
const {Solver,classes}=require('./solve.cjs'),{game}=require('./export.cjs'),G=require('../../studio/game.js');
const EFFORTS={quick:{flops:20,first:250,second:500},standard:{flops:40,first:300,second:800},deep:{flops:80,first:400,second:1200}};
const RUNOUTS=48,MAX_THREE=3,K=classes.length,FOUR_WAY='This line can reach the flop four or more ways, which can\'t be solved yet.';

// The table and line in the chart solver's terms: seats relative to the button, amounts in big blinds, one stack
// (the effective one between the player to act and the biggest other stack still in).
function convert(spot){
 const c=G.normalize(spot.config),n=c.seats,rel=i=>(i-c.button+n)%n,hand=G.replay(c,[]),bb=c.bb;
 if(c.variant!=='NLH')throw Error('Only no-limit hold\'em preflop spots can be solved.');
 if(c.rules?.low||c.bounties.some(x=>x>0))throw Error('Hi-lo and bounty games can\'t be solved preflop.');
 const pre=spot.actions.filter(a=>a.street===0);let h=G.replay(c,[]);for(const a of pre)h.act({kind:a.kind,target:a.target});
 if(h.street!==0||h.done||h.actor!==spot.actor)throw Error('The spot is not a preflop decision.');
 const others=h.living().filter(i=>i!==h.actor).map(i=>h.initial[i]),stack=G.bb(Math.min(h.initial[h.actor],Math.max(...others)))/bb;
 const force=pre.map(a=>({seat:rel(a.seat),kind:a.kind==='bet'?'raise':a.kind,...['raise','bet'].includes(a.kind)?{to:G.bb(a.target)/bb}:{}}));
 const cash=c.mode==='cash',opts={...game({seats:n,stack,format:'cash',rake:cash?c.rakePct:0,rakeCap:cash?c.rakeCap/bb:3,limp:1}),
  sb:c.sb/bb,ante:c.anteMode==='bigblind'?c.ante/bb:0,anteEach:c.anteMode==='each'?c.ante/bb:0,force};
 return{config:c,hand:h,opts,hero:rel(h.actor),rel,stack,heroClass:G.Core.handClass(spot.heroCards),chipEV:!cash,unequal:h.living().some(i=>G.bb(h.initial[i])/bb<stack-1e-9)};
}

// Every terminal under the spot with each player's class reach on the way (averaged strategies).
function terminals(S,spot){
 const out=[];
 (function walk(node,reach){
  if(node.type!=='decision'){out.push({node,reach});return;}
  const s=S.strategy(node,true);node.children.forEach((child,a)=>{const next=reach.slice();next[node.actor]=branch(S,node,a,reach[node.actor],s);walk(child,next);});
 })(spot,pathReach(S,spot));
 return out;
}
// A player's class reach after one action: the averaged strategy, or for a forced action outside the trimmed tree
// the range the solver gives it (solve.cjs addedReach), scaled back up from its sliver.
function branch(S,node,a,own,s){const r=new Float64Array(K);if(node.added?.k===a){S.addedReach(node,own,s,r);for(let i=0;i<K;i++)r[i]/=S.o.tremble;}else for(let i=0;i<K;i++)r[i]=own[i]*s[a*K+i];return r;}
// Each player's class reach at a node: the averaged strategy of every action they took from the root to it.
function pathReach(S,target){
 const reach=Array.from({length:S.n},()=>new Float64Array(K).fill(1));let found=null;
 (function walk(node,r){if(found||node.type!=='decision')return;if(node===target){found=r;return;}
  const s=S.strategy(node,true);node.children.forEach((child,a)=>{if(found)return;const next=r.slice();next[node.actor]=branch(S,node,a,r[node.actor],s);walk(child,next);});
 })(S.tree.root,reach);
 return found;
}
const mass=v=>{let s=0;for(let i=0;i<K;i++)s+=v[i]*(classes[i].length===2?6:classes[i][2]==='s'?4:12)/1326;return s;};
const rangeText=w=>{const peak=Math.max(...w);return peak>0?classes.map((c,i)=>[c,w[i]/peak]).filter(([,x])=>x>=.002).map(([c,x])=>x>=.9995?c:c+':'+(Math.round(x*1000)/1000)).join(','):'';};

// A seeded spread of flops (three distinct cards).
function flops(count,seed){
 let s=seed>>>0||1;const rnd=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;},R='23456789TJQKA',S='cdhs',out=new Set();
 while(out.size<count){const d=new Set();while(d.size<3)d.add(Math.floor(rnd()*52));out.add([...d].sort((a,b)=>b-a).map(c=>R[c>>2]+S[c&3]).join(''));}
 return[...out];
}
// One three-way flop through the 3-way solver: each slot's mean EV share of the pot by hand class.
function solveFlop(bin,t,board,threads,dir){
 const chips=x=>Math.max(1,Math.round(x*100)),lines=['game NLH3','board '+board,'pot '+chips(t.pot),'stack '+chips(t.behind),'min_bet 100',...t.ranges.map((r,s)=>'range'+s+' '+r),
  'bet flop all 0.33,0.66,1.5','bet turn all 0.66','bet river all 0.66','raise flop all 0.66','raise turn all 0.66','raise river all 0.66','cap flop 1','cap turn 1','cap river 1','allin flop 1','allin turn 1','allin river 1','allin_threshold 0.67',
  ...t.agg>=0?[0,1,2].filter(s=>s!==t.agg).map(s=>'lead flop '+s+' 0'):[],'runouts '+RUNOUTS,'threads '+threads,'accuracy 1','max_iterations 200','time_limit 1200','output result.json'];
 fs.writeFileSync(path.join(dir,'input.txt'),lines.join('\n')+'\n');
 return new Promise((resolve,reject)=>{const child=spawn(bin,['input.txt'],{cwd:dir,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>{err=(err+d).slice(-500);});
  child.on('error',reject);child.on('close',code=>{try{if(code!==0)throw Error('The 3-way solver failed: '+(err.trim()||'exit '+code));const r=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
   if(!r.rootEV)throw Error('The 3-way solver on this computer is out of date. Run tools/local-solver/install-mac.sh again.');
   resolve(r.combos.map((list,s)=>{const sum=new Float64Array(K),w=new Float64Array(K);list.forEach((name,h)=>{const v=r.rootEV[s][h];if(v===null)return;const i=classes.indexOf(G.Core.handClass(G.Core.cards(name)));sum[i]+=r.weights[s][h]*v;w[i]+=r.weights[s][h];});return{sum,w,pot:r.pot};}));}catch(e){reject(e);}});});
}

// Fits a three-way pot's realization to the solved EV shares: coordinate descent over sharpness g, the first and
// last slots' factors (the middle one is 1) and the last raiser's factor, least squares weighted by class reach.
function fit(S,t,target){
 const C=S.M.C,play=S.m.play,reach=t.reachBySlot,agg=t.agg;
 const loss=th=>{
  const {P,Q}=S.powers(th.g),R=[th.r0,1,th.r2].map((x,s)=>x*(s===agg?th.ini:1));let L=0;
  for(let s=0;s<3;s++){const A=reach[(s+1)%3],B=reach[(s+2)%3];
   for(let i=0;i<K;i++){const wt=target[s].w[i];if(!(wt>0))continue;const ri=i*K;let num=0,den=0;
    for(let j=0;j<K;j++){const aj=A[j]*C[ri+j];if(!(aj>0))continue;const base=(ri+j)*K,jb=(j*K+i)*K,tj=R[(s+1)%3]*play[j];
     for(let k=0;k<K;k++){const b=B[k]*C[ri+k];if(!(b>0))continue;const ws=P[base+k]*R[s]*play[i],w=ws+P[jb+k]*tj+Q[base+k]*R[(s+2)%3]*play[k];num+=aj*b*(w>0?ws/w:0);den+=aj*b;}}
    if(den>0){const d=num/den-target[s].share[i];L+=wt*d*d;}}}
  return L;
 };
 const grid={g:[.8,1,1.2,1.4,1.6,1.8,2,2.3],r0:[.6,.7,.8,.88,.95,1,1.1],r2:[.9,1,1.08,1.15,1.25,1.4,1.6],ini:[.9,1,1.05,1.1,1.2,1.3]};
 let best={g:S.o.sharpness??1.2,r0:1-S.o.realization,r2:1+S.o.realization,ini:1+(S.o.initiative||0)},bestL=loss(best);const start=bestL;
 for(let round=0;round<2;round++)for(const k of Object.keys(grid))for(const v of grid[k]){if(v===best[k])continue;const th={...best,[k]:v},L=loss(th);if(L<bestL){bestL=L;best=th;}
  for(const g of [...S.three.keys()])if(g!==Math.round(best.g*100)/100&&g!==1)S.three.delete(g);}
 return{g:best.g,R:[best.r0,1,best.r2],ini:best.ini,error:Math.sqrt(bestL/target.reduce((s,x)=>s+x.w.reduce((a,b)=>a+b,0),0)),before:Math.sqrt(start/target.reduce((s,x)=>s+x.w.reduce((a,b)=>a+b,0),0))};
}

function iterate(S,count,report,from,to){const step=Math.max(1,Math.floor(count/20));for(let done=0;done<count;done+=step){S.iterate(Math.min(step,count-done));report(from+(to-from)*Math.min(1,(done+step)/count));}}

async function run(spot,{bin,threads=Math.max(1,os.cpus().length-1),effort='standard',equity3,flops:flopCount=0,maxThree=MAX_THREE,log=()=>{},progress=()=>{}}={}){
 const e={...EFFORTS[effort]||EFFORTS.standard,...flopCount>0?{flops:flopCount}:{}},started=Date.now(),x=convert(spot),opts={...x.opts,equity3};
 // A first pass, then (with three-way pots to fit) the flops, then a second pass. Shares of the time: rough.
 let S=new Solver(opts),spotNode=S.tree.nodes.find(n=>n.spot);
 if(!spotNode||spotNode.actor!==x.hero)throw Error('This line could not be rebuilt in the preflop solver.');
 // Only three-way pots you are in change what your actions are worth; the rest keep the default model.
 const all=terminals(S,spotNode),three=all.filter(t=>t.node.type==='flop3'&&t.node.players.includes(x.hero)),many=all.some(t=>t.node.type==='many'&&t.node.players.includes(x.hero));
 // Four or more players to the flop are paid by a rough model that undervalues speculative hands badly (it folded
 // 55 and T9s on the button to two limps), so a spot that can reach one is not answered.
 if(many)throw Error(FOUR_WAY);
 const plan=three.length?{first:.15,flops:.7}:{first:1,flops:0};
 iterate(S,three.length?e.first:e.second,p=>progress(p*plan.first),0,1);
 const fits={},solved=[];
 if(three.length){
  if(!bin||!fs.existsSync(bin))throw Error('Three-way pots need the 3-way solver (tools/multiway-solver). Run tools/local-solver/install-mac.sh.');
  // The likeliest three-way pots under the spot, by how often the spot's players reach them together.
  const ranked=terminals(S,spotNode).filter(t=>t.node.type==='flop3'&&t.node.players.includes(x.hero)).map(t=>({...t,weight:t.node.players.reduce((w,p)=>w*mass(t.reach[p]),1)})).sort((a,b)=>b.weight-a.weight).slice(0,maxThree).filter(t=>t.weight>0);
  const total=ranked.length*e.flops;let done=0;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'citrus-preflop-'));
  try{
   for(const t of ranked){
    const node=t.node,slots=node.players,dead=s=>(opts.anteEach||0)+(s===(x.config.seats===2?1:2)?opts.ante:0),behind=Math.min(...slots.map(s=>x.stack-(node.inv[s]-dead(s))));
    const info={pot:node.pot,behind:Math.max(.01,behind),agg:slots.indexOf(node.aggressor),ranges:slots.map(s=>rangeText(t.reach[s])),reachBySlot:slots.map(s=>t.reach[s])};
    const sum=[0,1,2].map(()=>({sum:new Float64Array(K),w:new Float64Array(K)}));let ok=0;
    for(const board of flops(e.flops,7919+solved.length)){
     try{const r=await solveFlop(bin,info,board,threads,dir);r.forEach((q,s)=>{for(let i=0;i<K;i++)if(q.w[i]>0){sum[s].sum[i]+=q.sum[i]/q.w[i]/q.pot;sum[s].w[i]+=1;}});ok++;}catch(error){if(/out of date/.test(error.message))throw error;log('Flop '+board+': '+error.message);}
     done++;progress(plan.first+plan.flops*done/total);
    }
    if(ok<Math.max(Math.min(3,e.flops),e.flops/2)){solved.push({key:node.key,players:slots,flops:ok,skipped:true});continue;}
    // Target: each class's mean share over the flops it was dealt on, weighted by its reach in that slot.
    const target=sum.map((q,s)=>({share:Float64Array.from(q.sum,(v,i)=>q.w[i]>0?v/q.w[i]:0),w:Float64Array.from(q.w,(n,i)=>n>0?info.reachBySlot[s][i]*(classes[i].length===2?6:classes[i][2]==='s'?4:12):0)}));
    const f=fit(S,info,target);fits[node.key]={g:f.g,R:f.R,ini:f.ini};solved.push({key:node.key,players:slots,flops:ok,fit:fits[node.key],error:f.error,before:f.before,weight:t.weight});
    log('Fitted '+node.key+' on '+ok+' flops: g '+f.g+', R '+f.R.join('/')+', raiser x'+f.ini+'; error '+f.before.toFixed(4)+' -> '+f.error.toFixed(4));
   }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  S=new Solver({...opts,threeFits:fits});spotNode=S.tree.nodes.find(n=>n.spot);
  iterate(S,e.second,p=>progress(plan.first+plan.flops+(1-plan.first-plan.flops)*p),0,1);
 }
 const gap=S.exploitability(),rows=Object.fromEntries(Object.entries(S.rows(spotNode)).map(([c,r])=>[c,r.map(x=>Math.round(x*1e4)/1e4)])),reach=pathReach(S,spotNode);
 return{version:1,actions:spotNode.actions.map(a=>({kind:a.kind,to:a.to??null,jam:!!a.jam})),heroClass:x.heroClass,hero:rows[x.heroClass],classes:rows,
  ranges:Object.fromEntries(reach.map((r,s)=>[s,classes.map((c,i)=>Math.round(r[i]*1000)/1000)]).filter(([s])=>!spotNode.history.some(h=>h.seat===+s&&h.kind==='fold'))),
  classOrder:classes,heroSeat:x.hero,stack:x.stack,iterations:S.t,nashConv:gap.nashConv,threeWay:solved,manyWay:many,chipEV:x.chipEV,unequalStacks:x.unequal,seconds:(Date.now()-started)/1000,effort};
}

// Estimated seconds for a spot on this computer: the passes, and the flops (about 150 s each for wide pots on a
// Mac, scaled by threads), so the app can say how long it will take before it starts.
function estimate(spot,{threads=8,effort='standard'}={}){
 const e=EFFORTS[effort]||EFFORTS.standard,x=convert(spot),S=new Solver(x.opts),spotNode=S.tree.nodes.find(n=>n.spot);
 const t=spotNode?terminals(S,spotNode):[],three=Math.min(MAX_THREE,t.filter(q=>q.node.type==='flop3'&&q.node.players.includes(x.hero)).length),perIt=S.tree.nodes.length/1000*.5;
 return{seconds:Math.round(perIt*(three?e.first+e.second:e.second)+three*e.flops*150*Math.pow(8/Math.max(1,threads),.8)),threeWay:three,manyWay:t.some(q=>q.node.type==='many'&&q.node.players.includes(x.hero))};
}

// The three-way equity table, built once on this computer (about 2 minutes on 8 cores).
function ensureEquity3(file=path.join(__dirname,'equity3.bin'),threads=Math.max(1,os.cpus().length-1)){
 if(fs.existsSync(file)&&fs.statSync(file).size===2*K*K*K)return file;
 const bin=path.join(__dirname,'equity3'),list=path.join(os.tmpdir(),'citrus-classes.txt');
 if(!fs.existsSync(bin))execFileSync('c++',['-O3','-std=c++17','-pthread','-o',bin,path.join(__dirname,'equity3.cpp')],{stdio:'inherit'});
 fs.writeFileSync(list,classes.join('\n'));execFileSync(bin,[list,'1000',file+'.tmp',String(threads)],{stdio:'inherit'});fs.renameSync(file+'.tmp',file);return file;
}

module.exports={run,estimate,convert,ensureEquity3,EFFORTS};

if(require.main===module){
 const argv=process.argv.slice(2),opt={};for(let i=2;i<argv.length;i+=2)opt[argv[i].replace(/^--/,'')]=argv[i+1];
 if(argv.length<2){console.error('usage: node tools/preflop/spot.cjs spot.json result.json [--mw-solver path] [--threads n] [--effort quick|standard|deep]');process.exit(1);}
 (async()=>{
  try{
   const spot=JSON.parse(fs.readFileSync(argv[0],'utf8')),threads=Number(opt.threads)||Math.max(1,os.cpus().length-1),equity3=ensureEquity3(opt.equity3,threads);let last=0;const t0=Date.now();
   const result=await run(spot,{bin:opt['mw-solver']||path.join(__dirname,'..','multiway-solver','mw_solver'),threads,effort:opt.effort,equity3,log:m=>console.log(m),
    progress:p=>{const now=Date.now();if(now-last<2000&&p<1)return;last=now;const s=(now-t0)/1000;console.log('Progress: '+p.toFixed(3)+' '+(p>.02?Math.round(s*(1-p)/p):-1));}});
   fs.writeFileSync(argv[1],JSON.stringify(result));console.log('Done: '+result.iterations+' iterations, NashConv '+result.nashConv.toFixed(4)+' bb, '+Math.round(result.seconds)+' s');
  }catch(error){console.error('Error: '+error.message);process.exit(2);}
 })();
}
