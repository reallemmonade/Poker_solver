'use strict';
// CFR+ preflop solver over the trimmed tree in tree.cjs.
// Strategies are per hand class: the 169 NLH classes, or the PLO4 hand groups from
// plo-model.json. Heads-up terminals use the class-vs-class equity table with card
// removal; folded players' ranges enter as independent weights (no card removal
// across more than two players). Flops are scored by an equity-realization model
// instead of being played out.
const fs=require('fs'),path=require('path'),Tree=require('./tree.cjs');
const table=JSON.parse(fs.readFileSync(path.join(__dirname,'equity-table.json'),'utf8'));
const classes=table.classes,ranks='AKQJT98765432';
const combos=Float64Array.from(classes,c=>c.length===2?6:c[2]==='s'?4:12),weight=combos.map(c=>c/1326);

// Postflop playability multiplier on equity realization, by hand shape. Deep
// stacks reward hands that make strong, well-disguised holdings (pairs that set
// mine, suited and connected cards) and punish disconnected offsuit hands.
// Offsuit connectors and one-gappers below 65 (32o-54o) make too few straights to earn a bonus,
// and an ace- or king-high gapper takes half the gapper penalty.
const PLAY={pair:.06,suited:.07,connector:.04,oneGap:.02,offsuitGapper:-.08};
function playability(c,w=PLAY){
 if(c.length===2)return 1+w.pair;
 const hi=ranks.indexOf(c[0]),lo=ranks.indexOf(c[1]),gap=lo-hi,suited=c[2]==='s';
 let f=suited?1+w.suited:1;
 if(suited||lo<=ranks.indexOf('5')){if(gap===1)f*=1+w.connector;else if(gap===2)f*=1+w.oneGap;}
 if(!suited&&gap>=3&&lo>ranks.indexOf('T'))f*=1+w.offsuitGapper*(hi<=ranks.indexOf('K')?.5:1);
 return f;
}

// A hand model: class labels, combo weights, compatibility (share of opposing combos
// that are disjoint and in each class), all-in equity and playability.
let ploModel=null;
function model(o){
 if(o.variant!=='PLO4')return{variant:'NLH',K:169,classes,weight,compat:(i,j)=>table.compatibility[i][j]/1225,equity:(i,j)=>table.equity[i][j],play:classes.map(c=>playability(c,{...PLAY,...o.playability}))};
 ploModel=ploModel||JSON.parse(fs.readFileSync(path.join(__dirname,'plo-model.json'),'utf8'));const m=ploModel,total=m.combos.reduce((a,b)=>a+b,0);
 return{variant:'PLO4',K:m.labels.length,classes:m.labels,weight:Float64Array.from(m.combos,c=>c/total),compat:(i,j)=>m.compatibility[i][j],equity:(i,j)=>m.equity[i][j],play:m.playability,handGroups:{labels:m.labels,classes:m.classes}};
}

// Flop pots pay a share of the pot from the odds e/(1-e), raised to the power sharpness
// (above 1, the hand behind realizes less than its raw equity and the favourite more) and
// scaled by position, initiative (the last preflop raiser) and playability. The two
// players' shares always sum to one. ip/oop: the in-position player raised last;
// ipCaller/oopRaiser: the out-of-position player did.
function matrices(o,m){
 const K=m.K,C=new Float64Array(K*K),allin=new Float64Array(K*K),play=m.play;
 const rIP=1+o.realization,rOOP=1-o.realization,g=o.sharpness??1,ini=1+(o.initiative||0);
 for(let i=0;i<K;i++)for(let j=0;j<K;j++){const c=m.compat(i,j),x=i*K+j;C[x]=c;allin[x]=c*m.equity(i,j);}
 function share(ri,rj){
  const out=new Float64Array(K*K);
  for(let i=0;i<K;i++)for(let j=0;j<K;j++){const e=m.equity(i,j),x=i*K+j,a=e**g*ri*play[i],b=(1-e)**g*rj*play[j];out[x]=a+b>0?C[x]*a/(a+b):0;}
  return out;
 }
 const ip=share(rIP*ini,rOOP),oop=share(rOOP,rIP*ini);
 return{C,allin,ip,oop,ipCaller:ini===1?ip:share(rIP,rOOP*ini),oopRaiser:ini===1?oop:share(rOOP*ini,rIP)};
}

function matvec(M,v,out){
 const K=out.length;
 for(let i=0;i<K;i++){let s=0;const r=i*K;for(let j=0;j<K;j++)s+=M[r+j]*v[j];out[i]=s;}
 return out;
}

class Solver{
 constructor(options){
  this.tree=Tree.build(options);this.o=this.tree.options;this.n=this.o.seats;this.m=model(this.o);this.K=this.m.K;this.M=matrices(this.o,this.m);this.t=0;
  const K=this.K,w=this.m.weight;this.mass=v=>{let s=0;for(let i=0;i<K;i++)s+=w[i]*v[i];return s;};
  for(const node of this.tree.nodes){const A=node.actions.length,K=this.K;node.regret=new Float64Array(A*K);node.sum=new Float64Array(A*K);}
  this.ones=new Float64Array(this.K).fill(1);
 }
 // Regret matching (current) or the averaged strategy, laid out [action*K+class].
 strategy(node,average){
  const K=this.K;
  const A=node.actions.length,src=average?node.sum:node.regret,out=new Float64Array(A*K);
  for(let i=0;i<K;i++){let s=0;for(let a=0;a<A;a++){const r=src[a*K+i];if(r>0)s+=r;}
   for(let a=0;a<A;a++){const r=src[a*K+i];out[a*K+i]=s>0?(r>0?r/s:0):1/A;}}
  return out;
 }
 terminal(node,p,reach){
  const K=this.K;
  const out=new Float64Array(K);
  const [ipSeat,oopSeat]=node.players||[];
  if(!this.o.foldRemoval&&(node.type==='fold'||p!==ipSeat&&p!==oopSeat)){
   // Zero-sum variant: folded hands are independent of everything; only the two
   // players at a showdown remove each other's cards. Every player then sees the
   // same joint probabilities, which keeps the game zero-sum.
   let f=1;for(let k=0;k<this.n;k++)if(k!==p&&k!==ipSeat&&k!==oopSeat&&reach[k]!==this.ones)f*=this.mass(reach[k]);
   if(node.type!=='fold'){const seen=matvec(this.M.C,reach[oopSeat],new Float64Array(K));let both=0;for(let i=0;i<K;i++)both+=this.m.weight[i]*reach[ipSeat][i]*seen[i];f*=both;}
   out.fill(((node.type==='fold'&&node.winner===p?node.pot:0)-node.inv[p])*f);return out;
  }
  if(node.type==='fold'||p!==ipSeat&&p!==oopSeat){
   // Card removal is applied against the narrowest opposing range only.
   let f=1,narrow=-1,low=Infinity;
   for(let k=0;k<this.n;k++)if(k!==p&&reach[k]!==this.ones){const m=this.mass(reach[k]);f*=m;if(m<low){low=m;narrow=k;}}
   const payoff=(node.type==='fold'&&node.winner===p?node.pot:0)-node.inv[p];
   if(narrow<0||low===0){out.fill(payoff*f);return out;}
   matvec(this.M.C,reach[narrow],out);for(let i=0;i<K;i++)out[i]*=payoff*f/low;return out;
  }
  const q=p===ipSeat?oopSeat:ipSeat;let f=1;
  for(let k=0;k<this.n;k++)if(k!==p&&k!==q&&reach[k]!==this.ones)f*=this.mass(reach[k]);
  const M=this.M,share=node.type==='allin'?M.allin:node.aggressor===oopSeat?(p===ipSeat?M.ipCaller:M.oopRaiser):p===ipSeat?M.ip:M.oop;
  const won=matvec(share,reach[q],new Float64Array(K)),seen=matvec(this.M.C,reach[q],new Float64Array(K));
  // Low stack-to-pot flop pots blend in all-in equity (tree.cjs commit).
  if(node.commit){const all=matvec(this.M.allin,reach[q],new Float64Array(K));for(let i=0;i<K;i++)won[i]+=node.commit*(all[i]-won[i]);}
  // The winner gets the pot after rake (tree.cjs net).
  const pot=node.net??node.pot;for(let i=0;i<K;i++)out[i]=f*(pot*won[i]-node.inv[p]*seen[i]);
  return out;
 }
 // mode: 'cfr' updates p's regrets, 'value' evaluates the averaged strategy, 'best' best-responds for p.
 walk(node,p,reach,mode){
  const K=this.K;
  if(node.type!=='decision')return this.terminal(node,p,reach);
  const A=node.actions.length,a=node.actor,sigma=this.strategy(node,mode!=='cfr'),out=new Float64Array(K);
  if(a===p){
   const values=[];
   // The player's own reach does not change its counterfactual values, but it weights
   // the average strategy at its later decisions, so it is carried down in CFR passes.
   for(let k=0;k<A;k++){
    let next=reach;
    if(mode==='cfr'){next=reach.slice();const r=new Float64Array(K);for(let i=0;i<K;i++)r[i]=reach[p][i]*sigma[k*K+i];next[p]=r;}
    values.push(this.walk(node.children[k],p,next,mode));
   }
   if(mode==='best'){out.fill(-Infinity);for(const v of values)for(let i=0;i<K;i++)if(v[i]>out[i])out[i]=v[i];return out;}
   for(let k=0;k<A;k++)for(let i=0;i<K;i++)out[i]+=sigma[k*K+i]*values[k][i];
   if(mode==='cfr'){
    // Regrets are added per unit of opponent reach, so a line that opponents stop taking
    // keeps learning at the same rate, instead of being ruled by the first iterations'
    // regrets (when every range was still wide) for the rest of the solve.
    const own=reach[p];let f=1;for(let q=0;q<this.n;q++)if(q!==p&&reach[q]!==this.ones)f*=this.mass(reach[q]);f=f>0?1/f:0;
    for(let k=0;k<A;k++)for(let i=0;i<K;i++){const x=k*K+i;node.regret[x]=Math.max(0,node.regret[x]+(values[k][i]-out[i])*f);node.sum[x]+=this.t*own[i]*sigma[x];}
   }
   return out;
  }
  // Trembling opponent (CFR passes only): every action also carries a tiny share (tremble) of
  // the opponent's non-folding range at this node. Lines an opponent (almost) never takes are
  // then still solved against a sensible range, instead of keeping whatever regret matching
  // held when the line was dropped, so a deviation into them meets a real strategy.
  let nf=null;
  if(mode==='cfr'&&this.o.tremble>0){const f=node.actions.findIndex(x=>x.kind==='fold');nf=new Float64Array(K);let m=0;
   for(let i=0;i<K;i++){let c=0;for(let j=0;j<A;j++)if(j!==f)c+=sigma[j*K+i];nf[i]=reach[a][i]*c;m+=nf[i];}
   if(!(m>0))nf.set(reach[a]);for(let i=0;i<K;i++)nf[i]*=this.o.tremble;}
  for(let k=0;k<A;k++){
   const next=reach.slice(),r=new Float64Array(K);let any=false;
   for(let i=0;i<K;i++){r[i]=reach[a][i]*sigma[k*K+i]+(nf?nf[i]:0);if(r[i]>0)any=true;}
   if(!any)continue;next[a]=r;
   const v=this.walk(node.children[k],p,next,mode);for(let i=0;i<K;i++)out[i]+=v[i];
  }
  return out;
 }
 iterate(count=1){
  for(let c=0;c<count;c++){
   this.t++;
   for(let p=0;p<this.n;p++)this.walk(this.tree.root,p,Array(this.n).fill(this.ones),'cfr');
  }
 }
 // NashConv: summed gain each player could get by best-responding to the averaged strategy.
 exploitability(){
  const values=[],best=[];
  for(let p=0;p<this.n;p++){
   values.push(this.mass(this.walk(this.tree.root,p,Array(this.n).fill(this.ones),'value')));
   best.push(this.mass(this.walk(this.tree.root,p,Array(this.n).fill(this.ones),'best')));
  }
  const gains=best.map((b,p)=>b-values[p]);
  return{nashConv:gains.reduce((x,y)=>x+y,0),gains,values,zeroSum:values.reduce((x,y)=>x+y,0)};
 }
 // Averaged strategy rows for a node, keyed by class.
 rows(node){
  const K=this.K;
  const s=this.strategy(node,true),A=node.actions.length,out={};
  this.m.classes.forEach((c,i)=>{const row=[];for(let a=0;a<A;a++)row.push(s[a*K+i]);const t=row.reduce((x,y)=>x+y,0);out[c]=row.map(x=>x/t);});
  return out;
 }
 // Share of all combos taking each action, given the player reaches this node with every hand.
 frequency(node,kind){
  const rows=this.rows(node),idx=node.actions.map((a,i)=>a.kind===kind?i:-1).filter(i=>i>=0);
  return this.m.classes.reduce((s,c,i)=>s+this.m.weight[i]*idx.reduce((x,k)=>x+rows[c][k],0),0);
 }
}

module.exports={Solver,classes,weight,playability,PLAY};
