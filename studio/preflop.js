(function(root){
 'use strict';
 const G=root.PokerGame||(typeof require==='function'?(()=>{try{return require('./hand-engine.js')}catch{return require('./game.js')}})():null),FORMAT='range-lab-preflop-reference-v1';
 const OFF_PATH=1e-4,sum=a=>a.reduce((s,x)=>s+x,0),need=(v,m)=>{if(!v)throw Error(m)},ranks='AKQJT98765432';
 const classes=[];for(let r=0;r<13;r++)for(let c=0;c<13;c++)classes.push(r===c?ranks[r]+ranks[c]:ranks[Math.min(r,c)]+ranks[Math.max(r,c)]+(r<c?'s':'o'));
 const text=(v,label,max=500)=>{need(typeof v==='string'&&v.trim()&&v.length<=max,'Provide '+label+'.');return v.trim();};
 const canonicalCards=cs=>cs.slice().sort((a,b)=>a-b).map(G.Core.cardName).join('');
 function historyKey(hand){return hand.actionLog.map(a=>[(a.seat-hand.button+hand.n)%hand.n,a.kind,['bet','raise'].includes(a.kind)?a.target:0].join(':')).join('/');}
 // PLO4 hands fall into 16,432 suit-isomorphic classes; a PLO pack maps each class to
 // one of its hand groups. Classes are numbered in order of first appearance when the
 // 270,725 combos are enumerated in colex order.
 let plo=null;const perms=[],PLO_CLASSES=16432;(function permute(a,rest){if(!rest.length)return perms.push(a);rest.forEach((x,i)=>permute(a.concat(x),rest.filter((_,j)=>j!==i)));})([],[0,1,2,3]);
 // Suit permutation applied, then a four-card sorting network (descending) with no array allocation; the class table is
 // built 270,725×24 times through here, so this keeps the first PLO lookup fast.
 function ploCode(cs){const a=cs[0],b=cs[1],c=cs[2],d=cs[3];let best=Infinity;for(const p of perms){let w=(a&~3)|p[a&3],x=(b&~3)|p[b&3],y=(c&~3)|p[c&3],z=(d&~3)|p[d&3],t;if(w<x){t=w;w=x;x=t}if(y<z){t=y;y=z;z=t}if(w<y){t=w;w=y;y=t}if(x<z){t=x;x=z;z=t}if(x<y){t=x;x=y;y=t}const v=((w*52+x)*52+y)*52+z;if(v<best)best=v;}return best;}
 function ploClasses(){
  if(plo)return plo;const index=new Map(),keys=[],reps=[],counts=[];
  for(let d=3;d<52;d++)for(let c=2;c<d;c++)for(let b=1;b<c;b++)for(let a=0;a<b;a++){const code=ploCode([a,b,c,d]);let k=index.get(code);if(k===undefined){k=keys.length;index.set(code,k);const cs=[Math.floor(code/140608),Math.floor(code/2704)%52,Math.floor(code/52)%52,code%52];keys.push(cs.map(G.Core.cardName).join(''));reps.push(cs);counts.push(0);}counts[k]++;}
  return plo={index,keys,reps,counts,classOf:cards=>index.get(ploCode(cards))};
 }
 const classIndex=new Map(classes.map((c,i)=>[c,i]));
 function rowFor(pack,node,cards){
  if(node.table){const i=pack.groups?pack.groups.of[ploClasses().classOf(cards)]:classIndex.get(G.Core.handClass(cards));if(i===undefined||ownReach(pack,node,i)<1e-3)return null;const A=node.actions.length,row=[];for(let a=0;a<A;a++)row.push(node.table[i*A+a]/1000);return row;}
  if(pack.groups)return node.strategy[pack.groups.labels[pack.groups.of[ploClasses().classOf(cards)]]]||null;
  return node.strategy[canonicalCards(cards)]||node.strategy[G.Core.handClass(cards)]||(node.defaultFold?node.foldRow:null);
 }
 // handGroups: {labels:[name per group], classes: two base-36 digits per PLO class giving its group}.
 function readGroups(raw){
  const n=plo?plo.keys.length:PLO_CLASSES;need(raw&&Array.isArray(raw.labels)&&raw.labels.length>=2&&raw.labels.length<=1296&&typeof raw.classes==='string'&&raw.classes.length===2*n,'A PLO reference needs hand groups covering all '+n+' PLO hand classes.');
  const labels=raw.labels.map(l=>text(l,'a hand group name',120));need(new Set(labels).size===labels.length,'Hand group names must be unique.');
  const of=new Uint16Array(n);for(let i=0;i<n;i++){const g=parseInt(raw.classes.substr(2*i,2),36);need(g>=0&&g<labels.length,'A PLO hand class points to a missing hand group.');of[i]=g;}
  return{labels,classes:raw.classes,of};
 }
 // trusted: rows this app stored after validating them; their replayed keys and action
 // labels are reused instead of replaying every history, which keeps start-up fast.
 function validate(input,trusted=false){
  need(input&&input.format===FORMAT,'Use a Citrus Poker preflop reference JSON file.');// Rows are read, not changed, so the large row arrays are not copied.
  const pack=JSON.parse(JSON.stringify({...input,nodes:[]}));need(Array.isArray(input.nodes),'Import one to 10,000 decision nodes.');pack.nodes=input.nodes.map(n=>({seat:n?.seat,history:JSON.parse(JSON.stringify(n?.history??null)),actions:JSON.parse(JSON.stringify(n?.actions??null)),strategy:n?.strategy,table:n?.table,defaultFold:n?.defaultFold,key:n?.key,reach:n?.reach}));pack.name=text(pack.name,'a reference name',120);need(pack.source&&typeof pack.source==='object','Provide the solver reference source.');for(const name of ['name','url','solver','settings','createdAt'])pack.source[name]=text(pack.source[name],'source '+name,2000);need(/^https:\/\//i.test(pack.source.url),'Use an HTTPS source URL.');need(Number.isFinite(Date.parse(pack.source.createdAt)),'The source date must be valid.');
  pack.config=G.normalize(pack.config);need(['NLH','PLO4'].includes(pack.config.variant)&&pack.config.startStreet===0,'Preflop references currently support NLH and four-card PLO starting from the blinds.');const groups=pack.config.variant==='PLO4'?readGroups(pack.handGroups):null;pack.groups=groups;const labels=groups?groups.labels:classes;need(pack.config.button===0,'Reference seat numbers must start at the button (seat 0).');need(Array.isArray(pack.nodes)&&pack.nodes.length>0&&pack.nodes.length<=10000,'Import one to 10,000 decision nodes.');const seen=new Set(),base=new G.Hand(pack.config,{rng:G.rng(742)}),states=new Map();
  for(const node of pack.nodes){
   need(Array.isArray(node.history)&&node.history.length<=100&&Array.isArray(node.actions)&&node.actions.length>=2&&node.actions.length<=16,'A node needs its complete preflop history and two to sixteen actions.');
   if(trusted&&typeof node.key==='string'&&node.actions.every(a=>a&&typeof a.label==='string'&&typeof a.id==='string')){node.actions=node.actions.map(a=>({kind:a.kind,id:a.id,...a.kind==='raise'?{target:a.target}:{},label:a.label}));}else{
   delete node.key;
   // Replays start from the longest history prefix already replayed for this pack.
   const keys=[''];for(const e of node.history)keys.push(keys[keys.length-1]+'/'+e?.seat+e?.kind+(e?.to??''));let k=keys.length-1;while(k>0&&!states.has(keys[k]))k--;const h=(states.get(keys[k])||base).clone();
   for(let i=k;i<node.history.length;i++){const e=node.history[i];need(!h.done&&h.street===0&&e.seat===h.actor,'The reference history has an invalid actor or street.');h.act({kind:e.kind,target:['raise','bet'].includes(e.kind)?G.units(e.to):undefined});states.set(keys[i+1],i+1<node.history.length?h.clone():h);}
   // Fold, check and call are checked against legal() exactly as Hand.act checks them; only raises replay on a copy.
   need(!h.done&&h.street===0&&node.seat===h.actor,'The node seat does not match its action history.');const ids=new Set(),l0=h.legal();node.actions=node.actions.map((a,i)=>{need(['fold','check','call','raise'].includes(a.kind),'Use fold, check, call or raise in a preflop reference.');const action={kind:a.kind,id:'pf'+i,...a.kind==='raise'?{target:a.to===undefined&&Number.isInteger(a.target)?a.target:G.units(a.to)}:{}};if(a.kind==='raise')h.clone().act(action);else need(a.kind==='fold'?l0.fold:a.kind==='check'?l0.check:l0.toCall>0,a.kind==='fold'?'Checking is available; folding to no bet is disabled.':a.kind==='check'?'A bet is outstanding.':'There is no bet to call.');const signature=a.kind+':'+(action.target||0);need(!ids.has(signature),'A reference node contains duplicate actions.');ids.add(signature);const l=h.legal();action.label=a.kind==='raise'?'Raise to '+G.bb(action.target)+' bb'+(action.target===l.allInTo?' · all-in':''):a.kind==='call'?'Call '+G.bb(l.callCost)+' bb'+(l.callCost===h.stacks[h.actor]?' · all-in':''):a.kind==='check'?'Check':'Fold';return action;});
   node.key=historyKey(h);}
   const A=node.actions.length,fold=node.actions.findIndex(a=>a.kind==='fold');node.foldRow=node.actions.map((_,i)=>i===fold?1:0);
   // Compact packs list one row per class in PokerPreflop.classes order (NLH) or hand group
   // order (PLO): an action index for a pure row, or per-mille frequencies. They are kept
   // as one per-mille table per node, which stays small in memory and storage.
   if(node.table||Array.isArray(node.strategy)){
    // A trusted stored table is already a checked Uint16Array: it is kept as it is, without the per-row checks.
    if(trusted&&node.table instanceof Uint16Array&&node.table.length===labels.length*A){node.defaultFold=false;delete node.strategy;}else{
    const t=new Uint16Array(labels.length*A);
    if(node.table){const src=ArrayBuffer.isView(node.table)||Array.isArray(node.table)?node.table:Object.values(node.table);need(src.length===t.length&&Array.prototype.every.call(src,v=>Number.isInteger(v)&&v>=0&&v<=1000),'A compact node needs one row per hand class.');t.set(src);}
    else{need(node.strategy.length===labels.length,'A compact node needs one row per hand class.');node.strategy.forEach((r,i)=>{if(Number.isInteger(r)){need(r>=0&&r<A,'A compact row names a missing action.');t[i*A+r]=1000;}else{need(Array.isArray(r)&&r.length===A&&r.every(v=>Number.isInteger(v)&&v>=0&&v<=1000),'Compact rows use per-mille frequencies.');t.set(r,i*A);}});}
    for(let i=0;i<labels.length;i++){let x=0;for(let a=0;a<A;a++)x+=t[i*A+a];need(x===1000,'Action frequencies must sum to one for '+labels[i]+'.');}
    node.table=t;delete node.strategy;node.defaultFold=false;}
   }else{
   delete node.table;need(node.strategy&&typeof node.strategy==='object'&&!Array.isArray(node.strategy),'Each node needs hand frequencies.');const normalized=Object.create(null);for(const [label,values]of Object.entries(node.strategy)){need(groups?groups.labels.includes(label):classes.includes(label)||/^(?:[2-9TJQKA][cdhs]){2}$/.test(label),'Invalid reference hand: '+label);const k=groups||classes.includes(label)?label:canonicalCards(G.Core.cards(label));need(!(k in normalized),'Duplicate reference combination.');need(Array.isArray(values)&&values.length===node.actions.length&&values.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(sum(values)-1)<1e-6,'Action frequencies must sum to one for '+label+'.');normalized[k]=values.slice();}node.strategy=normalized;node.defaultFold=node.defaultFold===true;need(!node.defaultFold||fold>=0,'defaultFold requires a fold action.');
   if(groups)need(groups.labels.every(l=>l in node.strategy),'A PLO reference node needs a row for every hand group.');else need(G.combinations(Array.from({length:52},(_,i)=>i),2).every(cs=>rowFor(pack,node,cs)),'A reference node must cover every combination or explicitly set defaultFold.');
   }
   // reach (optional): how often the chart's own strategies arrive at this node, 0-1. Lines the
   // chart (almost) never plays were solved against a token range, so query() flags them offPath.
   if(node.reach===undefined||node.reach===null)delete node.reach;else need(Number.isFinite(node.reach)&&node.reach>=0&&node.reach<=1,'A node reach must be a number from 0 to 1.');
   need(!seen.has(node.key),'The reference contains duplicate history nodes.');seen.add(node.key);
  }
  pack.chipEV=pack.chipEV===true&&pack.config.mode==='icm';pack.family=G.familyId(pack.config);pack.index=new Map(pack.nodes.map(n=>[n.key,n]));return pack;
 }
 // CFR leaves rows untrained (the uniform start or an early iterate) where an opponent never
 // takes an action on the line, or where the acting hand never gets there itself. Packs carry
 // no reach, so it is rebuilt from the rows: a node whose line the other players take with zero
 // chart probability is off path, and a hand class reaching it with under 0.1% of its combos
 // is unreached. query() serves neither as advice. Nodes a trimmed tree skips (players left to
 // fold to a 3-bet) are forced folds, which leave ranges and the line unchanged.
 // Each node is resolved on first use, so loading a library stays fast.
 function pathOf(pack,node){
  if(node.path!==undefined)return node.path;node.path=null;if(!node.table)return null;const steps=[];let key='';
  for(const seg of node.key?node.key.split('/'):[]){const anc=pack.index.get(key),[seat,kind,target]=seg.split(':');if(anc){const k=+seat===anc.seat&&anc.table?anc.actions.findIndex(a=>a.kind===kind&&(kind!=='raise'||a.target===+target)):-1;if(k<0)return null;steps.push([anc,k]);}else if(kind!=='fold')return null;key=key?key+'/'+seg:seg;}
  return node.path=steps;
 }
 function offPath(pack,node){
  if(node.offPath!==undefined)return node.offPath;if(node.reach!==undefined&&node.reach<OFF_PATH)return node.offPath=true;const steps=pathOf(pack,node);node.offPath=false;if(!steps)return false;
  const prior=priorOf(pack),L=prior.length,ranges=new Map();
  for(const [anc,k] of steps){if(anc.seat===node.seat)continue;let r=ranges.get(anc.seat);if(!r)ranges.set(anc.seat,r=new Float64Array(L).fill(1));const A=anc.actions.length,t=anc.table;let m=0;for(let c=0;c<L;c++){r[c]*=t[c*A+k]/1000;m+=prior[c]*r[c];}if(!(m>0))return node.offPath=true;}
  return false;
 }
 function priorOf(pack){if(!pack.prior){const L=pack.groups?pack.groups.labels.length:classes.length,prior=pack.prior=new Float64Array(L);if(pack.groups){const pc=ploClasses();for(let i=0;i<pc.counts.length;i++)prior[pack.groups.of[i]]+=pc.counts[i];}else classes.forEach((c,i)=>prior[i]=c.length===2?6:c[2]==='s'?4:12);}return pack.prior;}
 function ownReach(pack,node,i){const steps=pathOf(pack,node);let r=1;if(steps)for(const [anc,k] of steps)if(anc.seat===node.seat)r*=anc.table[i*anc.actions.length+k]/1000;return r;}
 // forStorage keeps compact rows as typed arrays for IndexedDB; otherwise the output is plain JSON.
 function serialize(pack,forStorage=false){return{format:FORMAT,name:pack.name,...pack.chipEV?{chipEV:true}:{},...pack.groups?{handGroups:{labels:pack.groups.labels,classes:pack.groups.classes}}:{},source:pack.source,config:pack.config,nodes:pack.nodes.map(n=>({seat:n.seat,history:n.history,actions:n.actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:G.bb(a.target)}:{}})),...forStorage?{key:n.key,actions:n.actions.map(a=>({kind:a.kind,id:a.id,...a.kind==='raise'?{target:a.target}:{},label:a.label}))}:{},...n.table?forStorage?{table:n.table}:{strategy:compactRows(n)}:{strategy:n.strategy,defaultFold:n.defaultFold},...n.reach!==undefined?{reach:n.reach}:{}}))};}
 function compactRows(n){const A=n.actions.length,out=[];for(let i=0;i<n.table.length;i+=A){const r=Array.from(n.table.subarray(i,i+A)),pure=r.indexOf(1000);out.push(pure>=0?pure:r);}return out;}
 // Buttons and frequency rows read fold, check/call, then raises from smallest to largest.
 // Where a chart answers, the buttons are its own actions only (no default size, all-in or limp
 // it lacks); any other size stays playable from the custom size box, without a grade.
 const rank=a=>a.kind==='fold'?0:a.kind==='raise'||a.kind==='bet'?2:1;
 function ordered(actions,probs){const ix=actions.map((_,i)=>i).sort((i,j)=>rank(actions[i])-rank(actions[j])||(actions[i].target||0)-(actions[j].target||0));return[ix.map(i=>actions[i]),ix.map(i=>probs[i])];}
 function query(pack,hand,controlActions=[]){
  if(hand.done||hand.street!==0||hand.family!==pack.family)return null;const node=pack.index.get(historyKey(hand));if(!node||offPath(pack,node))return null;const row=rowFor(pack,node,hand.holes[hand.actor]);if(!row)return null;const actions=node.actions.map(a=>({...a}));const [sorted,probs]=ordered(actions,actions.map((a,i)=>i<row.length?row[i]:null));
  return{supported:true,referenceOnly:true,referenceVersion:1,actions:sorted,reference:probs,probs,trained:true,displayEligible:true,visits:0,updates:0,referenceSource:{kind:'imported-preflop',name:pack.name,...pack.source,packName:pack.name},referenceKey:pack.family+'|'+node.key,...node.reach!==undefined?{chartReach:node.reach,offPath:node.reach<OFF_PATH}:{},handClass:G.Core.handClass(hand.holes[hand.actor]),units:hand.config.mode==='cash'?'bb':'prize units',game:{seats:hand.n,stacks:hand.config.stacks.slice(),ante:hand.config.ante,rakePct:hand.config.rakePct,rakeCap:hand.config.rakeCap}};
 }
 // Live sessions carry stacks between hands, so exact-depth matches are rare.
 // This falls back to the closest-depth pack of the same game (within a factor of 1.6,
 // which covers the library's 2.5x steps from 20 to 50bb and 200 to 500bb), replays the
 // line in that pack's game and labels the depth substitution.
 // Chip-EV tournament charts ignore payouts and other tables' stacks, so they
 // stand in for any tournament with the same blinds and ante; the result says so.
 function shape(config,chipEV=false,rake=true){const f=JSON.parse(G.familyId(config));delete f.stacks;if(chipEV){delete f.payouts;delete f.other;}if(!rake){delete f.rake;delete f.cap;delete f.noFlop;}return JSON.stringify(f);}
 // How a chart fits a table's game: 0 for the same game, 1 for a rake-free chart
 // standing in at a raked cash table (any same-rake chart is preferred), else null.
 function fit(pack,table,cache){const ev=pack.chipEV?1:0;if(cache[ev]===undefined)cache[ev]=shape(table,!!ev);if(packShape(pack)===cache[ev])return 0;if(!(table.rakePct>0)||pack.config.rakePct>0)return tourneyFit(pack,table,cache);if(cache[ev+2]===undefined)cache[ev+2]=shape(table,!!ev,false);return shape(pack.config,pack.chipEV,false)===cache[ev+2]?1:tourneyFit(pack,table,cache);}
 // 2 for a tournament table whose ante no chart has: a chip-EV chart putting about the same dead money in from
 // antes (within a factor of 1.6), or, with no ante at all, a rake-free cash chart, which is the same chip-EV game.
 const deadMoney=c=>c.ante*(c.anteMode==='each'?c.seats:1),looseShape=c=>{const f=JSON.parse(shape(c,true,false));delete f.mode;delete f.ante;delete f.anteMode;return JSON.stringify(f);};
 function tourneyFit(pack,table,cache){const p=pack.config,a=deadMoney(p),b=deadMoney(table);if(table.mode!=='icm'||!(pack.chipEV||p.mode==='cash'&&!(p.rakePct>0))||(a||b)&&!(a>0&&b>0&&Math.abs(Math.log(a/b))<=Math.log(1.6)))return null;if(cache[4]===undefined)cache[4]=looseShape(table);return looseShape(p)===cache[4]?2:null;}
  // A pack's shape never changes; the table's two shapes are computed once per lookup.
  const packShapes=new WeakMap();function packShape(pack){let s=packShapes.get(pack);if(s===undefined){s=shape(pack.config,pack.chipEV);packShapes.set(pack,s);}return s;}
 const topRaise=l=>Math.min(l.allInTo,l.maxRaiseTo);
 // Facing a bigger raise than the node's, the defence shrinks toward the price: k = MDF(actual)/MDF(node),
 // MDF = pot/(pot+risk). The node's continue weight (combos x own reach x 1-fold) is filled in equity
 // order (G.preflopOrder; PLO groups by the node's continue share), each hand at most at its chart
 // frequency, until k of it is used; the rest fold and continuing hands keep their call/raise mix.
 // Returns the hand's continue scale (0-1), or null when the node has no fold.
 function tighten(pack,node,cards,k){
  if(!node)return null;const f=node.actions.findIndex(a=>a.kind==='fold');if(f<0)return null;const L=pack.groups?pack.groups.labels.length:classes.length;
  if(!node.cut){const prior=priorOf(pack),mass=new Float64Array(L);for(let i=0;i<L;i++){const r=rowAt(pack,node,i);mass[i]=r?prior[i]*ownReach(pack,node,i)*(1-r[f]):0;}
   const order=pack.groups?Array.from(mass.keys()).sort((a,b)=>mass[b]/prior[b]-mass[a]/prior[a]):G.preflopOrder.map(c=>classIndex.get(c)),before=new Float64Array(L);let acc=0;for(const i of order){before[i]=acc;acc+=mass[i];}node.cut={mass,before,total:acc};}
  const {mass,before,total}=node.cut,i=pack.groups?pack.groups.of[ploClasses().classOf(cards)]:classIndex.get(G.Core.handClass(cards));
  return mass[i]>0?Math.min(1,Math.max(0,(k*total-before[i])/mass[i])):1;
 }
 function nearest(packs,hand,controlActions=[],tolerance=1.6){
  if(hand.done||hand.street!==0)return null;const n=hand.n,live=hand.living(),hero=hand.actor,others=live.filter(i=>i!==hero).map(i=>hand.initial[i]);if(!others.length)return null;
  const depth=G.bb(Math.min(hand.initial[hero],Math.max(...others))),table={...hand.config,button:0},tableShape=[];let best=null;
  for(const pack of packs){const chart=Math.max(...pack.config.stacks),gap=Math.abs(Math.log(chart/depth));if(gap>Math.log(tolerance)+1e-9)continue;const f=fit(pack,G.normalize(table),tableShape);if(f===null||best&&gap+f>=best.score)continue;best={pack,gap,chart,score:gap+f,rakeFree:f===1,tourney:f===2};}
  if(!best)return null;const relative=i=>(i-hand.button+n)%n,proxy=new G.Hand(best.pack.config,{rng:G.rng(743)}),real=new G.Hand(hand.config,{rng:G.rng(743)});
  // A pot-limit maximum, an all-in covering the effective depth, or any raise the chart's stacks
  // cannot cover stands for the chart's largest raise (a full-stack jam counts even when a posted ante sits outside its target); other sizes (a short stack's all-in too) replay unchanged.
  const eff=Math.min(hand.initial[hero],Math.max(...others));
  // A size between two of the node's raises maps by pseudo-harmonic action translation (Ganzfried &
  // Sandholm 2013, sizes as raise over the pot after calling, to the lower size when f(A) >= 1/2); one
  // above its largest raise below the top maps to that raise, and one below its smallest to the smallest.
  // An all-in with no all-in at the node maps to its largest raise. Mapped sizes are reported.
  const sizeMatch=[],frac=(h,t)=>(t-h.currentBet)/(h.pot+h.currentBet-h.streetPaid[h.actor]),mdf=(h,t)=>h.pot/(h.pot+t-h.streetPaid[h.actor]);let last=null,far=false;
  try{for(const a of hand.actionLog){let target=a.target;if(['raise','bet'].includes(a.kind)){const top=topRaise(proxy.legal()),rl=real.legal(),node=best.pack.index.get(historyKey(proxy)),all=node?node.actions.filter(x=>x.kind==='raise').map(x=>x.target).sort((x,y)=>x-y):[],sizes=all.filter(x=>x<top);
    const jam=a.target>=top||a.target>=topRaise(rl)&&(rl.maxRaiseTo<rl.allInTo||a.target>=eff||a.target===rl.allInTo&&real.initial[real.actor]>=eff);
    if(jam)target=!all.length||all.includes(top)?top:all[all.length-1];
    else if(sizes.length&&!sizes.includes(target)){const x=frac(real,a.target),hi=sizes.findIndex(t=>frac(proxy,t)>x);if(hi<0)target=sizes[sizes.length-1];else if(!hi)target=sizes[0];else{const A=frac(proxy,sizes[hi-1]),B=frac(proxy,sizes[hi]);target=(B-x)*(1+A)/((B-A)*(1+x))>=.5?sizes[hi-1]:sizes[hi];}}
    last=null;if(target!==a.target&&!(jam&&target===top)){const r=G.bb(a.target)/G.bb(target);if(Math.abs(Math.log(r))>Math.log(tolerance)+1e-9)far=true;sizeMatch.push({actual:G.bb(a.target),chart:G.bb(target)});last={seat:a.seat,k:mdf(real,a.target)/mdf(proxy,target)};}}
   real.act({kind:a.kind,target:a.target});proxy.act({kind:a.kind,target});}}catch{return null;}
  proxy.holes[relative(hero)]=hand.holes[hero].slice();const result=query(best.pack,proxy,[]);if(!result)return null;
  const cut=last&&last.seat!==hero&&last.k<1-1e-9?tighten(best.pack,best.pack.index.get(historyKey(proxy)),proxy.holes[proxy.actor],last.k):null;
  if(cut!==null){const f=result.actions.findIndex(a=>a.kind==='fold');result.reference=result.reference.map((p,i)=>i===f?1-(1-p)*cut:p*cut);result.probs=result.reference;}
  // The chart's largest raise stands for this hand's; other sizes are kept within this hand's
  // legal range, and actions that become the same are merged.
  // After a mapped size, the chart's own raises keep their ratio to the bet the player faces.
  const l=hand.legal(),chartTop=topRaise(proxy.legal()),top=topRaise(l),scale=sizeMatch.length?hand.currentBet/proxy.currentBet:1,actions=[],reference=[],node=best.pack.index.get(historyKey(proxy)),into=node.actions.map(()=>null);
  result.actions.forEach((a,i)=>{const x={...a},at=node.actions.findIndex(n=>n.kind===a.kind&&n.target===a.target);if(x.kind==='raise'){if(!l.canRaise){x.kind=l.toCall?'call':'check';delete x.target;}else x.target=x.target>=chartTop?top:Math.min(top,Math.max(Math.round(x.target*scale),l.minRaiseTo));}
   x.label=x.kind==='raise'?'Raise to '+G.bb(x.target)+' bb'+(x.target===l.allInTo?' · all-in':''):x.kind==='call'?'Call '+G.bb(l.callCost)+' bb'+(l.callCost===hand.stacks[hand.actor]?' · all-in':''):x.kind==='check'?'Check':x.label;
   try{hand.clone().act(x);}catch{return;}const j=actions.findIndex(b=>b.kind===x.kind&&b.target===x.target);if(at>=0)into[at]=j>=0?actions[j]:x;if(j>=0)reference[j]+=result.reference[i];else{actions.push(x);reference.push(result.reference[i]);}});
  const total=sum(reference);if(!(total>0)||actions.length<2)return null;result.actions=actions;result.reference=reference.map(p=>p/total);
  [result.actions,result.reference]=ordered(result.actions,result.reference);result.probs=result.reference;
  if(!best.pack.groups)Object.assign(result,chartRanges(best.pack,node,hand,relative,into.map(x=>result.actions.indexOf(x)),result.actions.length,best.pack.name));
  // Sizes mapped beyond the 1.6x tolerance or a tightened range are approximate: shown with that label, never graded as mistakes.
  if(far||last&&last.seat!==hero&&last.k<1-1e-9){result.offTree=true;result.referenceSource.name+=' · approximate: off-tree size';}
  if(sizeMatch.length){result.sizeMatch=sizeMatch;result.referenceSource.name+=' · earlier raise sizes mapped to the chart\'s: '+sizeMatch.map(m=>m.actual+' → '+m.chart+' bb').join(', ');result.referenceKey+='|sizes:'+sizeMatch.map(m=>m.actual+'>'+m.chart).join(',');}
  const standIn=(best.pack.chipEV||best.tourney)&&shape(best.pack.config)!==shape(table);if(standIn){result.chipEVStandIn=true;result.referenceSource.name+=' · chip-EV chart: this table\'s payouts (ICM) are not modelled';}if(best.tourney&&(deadMoney(best.pack.config)!==deadMoney(table)||table.ante>0&&best.pack.config.anteMode!==table.anteMode)){result.anteStandIn=true;result.referenceSource.name+=' · chart ante differs from this table\'s';}if(best.rakeFree){result.rakeStandIn=true;result.referenceSource.name+=' · rake-free chart: this table\'s rake is not modelled';}
  result.depthMatch={chart:best.chart,actual:depth,depthDiffers:best.gap>1e-9,chipEV:standIn};result.referenceKey+='|depth:'+depth;return result;
 }
 // NLH: each live player's range at this node (the chart's frequency of every action they took on the
 // way, by hand class, scaled so the widest class is 1) and the actor's whole strategy by hand class,
 // with the node's actions folded into this hand's (index[k] is node action k's place, -1 when dropped),
 // for the analysis range grids. Empty when the chart has no path to the node.
 function chartRanges(pack,node,hand,relative,index,size,name){
  const steps=pathOf(pack,node);if(!steps)return{};const live=hand.living(),source='Imported preflop chart: '+name,rangeAssumptions=[];
  // A player still to act for the first time holds every hand, so only the actor's grid is drawn for them.
  for(const seat of live){if(seat!==hand.actor&&!steps.some(([anc])=>anc.seat===relative(seat)))continue;const w=classes.map((_,i)=>{let r=1;for(const [anc,k]of steps)if(anc.seat===relative(seat)){const row=rowAt(pack,anc,i);r*=row?row[k]:0;}return r;}),peak=Math.max(...w);if(peak>0)rangeAssumptions.push({seat,range:classRangeText(w.map(x=>x/peak)),source});}
  const classMix={};classes.forEach((c,i)=>{const row=rowAt(pack,node,i);if(!row)return;const m=Array(size).fill(0);row.forEach((p,k)=>{if(index[k]>=0)m[index[k]]+=p;});const t=m.reduce((a,b)=>a+b,0);if(t>0)classMix[c]=m.map(x=>Math.round(x/t*1000)/1000);});
  return{rangeAssumptions,handMix:{seat:hand.actor,classes:classMix}};
 }
 // Postflop starting ranges from a chart: replays the preflop line in the
 // closest-depth chart of the same game and multiplies, for every hand class
 // (NLH) or hand group (PLO), the frequency of each action the player took.
 // Raises map to the chart raise of the nearest size, and an all-in maps to
 // the chart's all-in. Returns null when the line leaves the chart's tree
 // (limps, extra callers), so callers keep their other range sources.
 function rowAt(pack,node,i){
  const A=node.actions.length;if(node.table)return Array.from(node.table.subarray(i*A,i*A+A),v=>v/1000);
  const label=pack.groups?pack.groups.labels[i]:classes[i];return node.strategy[label]||(node.defaultFold?node.foldRow:null);
 }
 function postflopRanges(packs,config,actions,tolerance=1.5){
  config=G.normalize(config);const pre=actions.filter(a=>a.street===0),n=config.seats,real=new G.Hand(config,{rng:G.rng(744)});
  try{for(const a of pre)real.act(a);}catch{return null;}
  if(real.street===0&&!real.done)return null;const live=real.living();if(live.length<2)return null;
  const depth=G.bb(Math.min(...live.map(i=>real.initial[i]).sort((a,b)=>b-a).slice(0,2))),table={...config,button:0};let best=null;
  const shapes=[],normal=G.normalize(table);for(const pack of packs){const chart=Math.max(...pack.config.stacks),gap=Math.abs(Math.log(chart/depth));if(gap>Math.log(tolerance))continue;const f=fit(pack,normal,shapes);if(f===null||best&&gap+f>=best.score)continue;best={pack,gap,chart,score:gap+f,rakeFree:f===1};}
  if(!best)return null;const pack=best.pack,labels=pack.groups?pack.groups.labels:classes,relative=i=>(i-config.button+n)%n,proxy=new G.Hand(pack.config,{rng:G.rng(745)}),replay=new G.Hand(config,{rng:G.rng(746)});
  const weights=Array.from({length:n},()=>new Float64Array(labels.length).fill(1));
  for(const a of pre){
   const node=pack.index.get(historyKey(proxy));if(proxy.actor!==relative(a.seat))return null;
   // Charts leave out decisions that are always folds (BB behind an SB 3-bet); a
   // fold there ends that seat's range, so the line goes on.
   if(!node&&a.kind==='fold'){proxy.act({kind:'fold'});replay.act(a);continue;}
   if(!node)return null;
   const kinds=a.kind==='bet'?['raise']:a.kind==='check'||a.kind==='call'?[a.kind,a.kind==='check'?'call':'check']:[a.kind];let pick=-1;
   for(const kind of kinds){const options=node.actions.map((x,i)=>({x,i})).filter(o=>o.x.kind===kind);if(!options.length)continue;
    if(kind!=='raise'){pick=options[0].i;break;}
    const jam=replay.legal().allInTo,chartJam=proxy.legal().allInTo,want=G.bb(a.target);
    if(a.target>=jam){const all=options.find(o=>o.x.target===chartJam);if(all){pick=all.i;break;}}
    pick=options.filter(o=>o.x.target!==chartJam||a.target>=jam).sort((p,q)=>Math.abs(Math.log(G.bb(p.x.target)/want))-Math.abs(Math.log(G.bb(q.x.target)/want)))[0]?.i??options[0].i;break;}
   if(pick<0)return null;const w=weights[a.seat];
   for(let i=0;i<labels.length;i++){const row=rowAt(pack,node,i);w[i]*=row?row[pick]:0;}
   const chosen=node.actions[pick];proxy.act({kind:chosen.kind,target:chosen.target});replay.act(a);
  }
  const seats={};for(const seat of live){const w=weights[seat],peak=Math.max(...w);if(!(peak>0))return null;seats[seat]=Array.from(w,x=>x/peak);}
  return{pack,name:pack.name,game:pack.groups?'PLO4':'NLH',labels,seats,depthMatch:best.gap>1e-9?{chart:best.chart,actual:depth}:null,rakeFree:best.rakeFree,key:historyKey(proxy),chart:proxy,live:live.map(relative)};
 }
 // Range text the spot solver parses: hand classes with weights (NLH).
 function classRangeText(weights,floor=.001){return classes.map((c,i)=>[c,weights[i]]).filter(([,w])=>w>=floor).map(([c,w])=>w>=.9995?c:c+':'+(Math.round(w*1000)/1000)).join(',');}
 // PLO: every four-card combo off the board, weighted by its group, then a
 // sample of at most limit combos drawn in proportion to weight (systematic
 // sampling, so each kept combo stands for an equal share of the range).
 function ploCombos(range,board,{limit=200,include=null,seed=1}={}){
  const P=ploClasses(),blocked=new Set(board),of=range.pack.groups.of,w=[];let total=0;const deck=Array.from({length:52},(_,i)=>i).filter(c=>!blocked.has(c));
  for(let d=3;d<deck.length;d++)for(let c=2;c<d;c++)for(let b=1;b<c;b++)for(let a=0;a<b;a++){const cs=[deck[a],deck[b],deck[c],deck[d]],x=range.weights[of[P.classOf(cs)]];if(x>0){total+=x;w.push([cs,x]);}}
  if(!w.length)return[];const rng=G.rng(seed),step=total/Math.min(limit,w.length),out=new Map();let next=rng()*step,acc=0;
  for(const [cs,x]of w){acc+=x;let k=0;while(acc>next){k++;next+=step;}if(k)out.set(cs.join('.'),{cards:cs,weight:k});}
  if(include){const k=include.slice().sort((a,b)=>a-b),key=k.join('.');if(!out.has(key))out.set(key,{cards:k,weight:0});}
  return[...out.values()];
 }
 // Open size and re-raise multiplier the closest matching chart uses at this game's depth, so a
 // model, its bots and the hero's buttons play the chart's tree; null parts when no chart applies.
 function chartSizes(packs,config){
  const out={};let hand;try{hand=new G.Hand(config,{rng:G.rng(744)});}catch{return out;}if(hand.done||hand.street!==0)return out;
  const raises=(h,q)=>{const all=h.legal().allInTo;return q?q.actions.filter((a,i)=>a.kind==='raise'&&a.target<all&&q.reference[i]!==null):[];};
  for(let folds=0;folds<hand.n-1&&!out.openSizes;folds++){const h=hand.clone();try{for(let k=0;k<folds;k++)h.act({kind:'fold'});}catch{break;}if(h.done)break;const open=raises(h,nearest(packs,h))[0]||null;if(!open)continue;out.openSizes=[G.bb(open.target)];
   const facing=h.clone();facing.act({kind:'raise',target:open.target});for(let k=0;k<facing.n-1&&!facing.done&&!out.preflopRaiseMultipliers;k++){const three=raises(facing,nearest(packs,facing))[0];if(three)out.preflopRaiseMultipliers=[+(three.target/open.target).toFixed(2)];else facing.act({kind:'fold'});}}
  return out;
 }
 function isResult(r){return !!(r?.supported&&r.referenceOnly&&r.referenceVersion===1&&r.referenceSource?.kind==='imported-preflop'&&typeof r.referenceSource.name==='string'&&/^https:\/\//.test(r.referenceSource.url)&&Array.isArray(r.actions)&&r.actions.length>=2&&r.actions.length===r.reference?.length&&r.reference.every(x=>x===null||Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(sum(r.reference.map(x=>x||0))-1)<1e-6);}
 // Redeals the actor's cards (from the hand's deck) until the chart answers for them; false when the
 // node is off the chart's own line or no tried hand reaches it. For quiz questions drawn from pack nodes.
 function deal(pack,hand,rng=Math.random,tries=400){const node=pack.index.get(historyKey(hand));if(!node||offPath(pack,node))return false;const h=hand.holes[hand.actor],d=hand.deck;for(let t=0;t<tries;t++){if(query(pack,hand,[]))return true;for(let k=0;k<h.length;k++){const j=Math.floor(rng()*d.length);[h[k],d[j]]=[d[j],h[k]];}}return false;}
const api={FORMAT,OFF_PATH,classes,ploClasses,validate,serialize,query,nearest,chartSizes,isResult,historyKey,row:rowFor,deal,postflopRanges,classRangeText,ploCombos};root.PokerPreflop=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
