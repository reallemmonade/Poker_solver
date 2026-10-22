(function(root){
 'use strict';
 const G=root.PokerGame||(typeof require==='function'?(()=>{try{return require('./hand-engine.js')}catch{return require('./game.js')}})():null),FORMAT='range-lab-preflop-reference-v1';
 const sum=a=>a.reduce((s,x)=>s+x,0),need=(v,m)=>{if(!v)throw Error(m)},ranks='AKQJT98765432';
 const classes=[];for(let r=0;r<13;r++)for(let c=0;c<13;c++)classes.push(r===c?ranks[r]+ranks[c]:ranks[Math.min(r,c)]+ranks[Math.max(r,c)]+(r<c?'s':'o'));
 const text=(v,label,max=500)=>{need(typeof v==='string'&&v.trim()&&v.length<=max,'Provide '+label+'.');return v.trim();};
 const canonicalCards=cs=>cs.slice().sort((a,b)=>a-b).map(G.Core.cardName).join('');
 function historyKey(hand){return hand.actionLog.map(a=>[(a.seat-hand.button+hand.n)%hand.n,a.kind,['bet','raise'].includes(a.kind)?a.target:0].join(':')).join('/');}
 // PLO4 hands fall into 16,432 suit-isomorphic classes; a PLO pack maps each class to
 // one of its hand groups. Classes are numbered in order of first appearance when the
 // 270,725 combos are enumerated in colex order.
 let plo=null;const perms=[];(function permute(a,rest){if(!rest.length)return perms.push(a);rest.forEach((x,i)=>permute(a.concat(x),rest.filter((_,j)=>j!==i)));})([],[0,1,2,3]);
 function ploCode(cs){let best=Infinity;for(const p of perms){const m=cs.map(c=>(c&~3)|p[c&3]).sort((x,y)=>y-x),v=((m[0]*52+m[1])*52+m[2])*52+m[3];if(v<best)best=v;}return best;}
 function ploClasses(){
  if(plo)return plo;const index=new Map(),keys=[],reps=[],counts=[];
  for(let d=3;d<52;d++)for(let c=2;c<d;c++)for(let b=1;b<c;b++)for(let a=0;a<b;a++){const code=ploCode([a,b,c,d]);let k=index.get(code);if(k===undefined){k=keys.length;index.set(code,k);const cs=[Math.floor(code/140608),Math.floor(code/2704)%52,Math.floor(code/52)%52,code%52];keys.push(cs.map(G.Core.cardName).join(''));reps.push(cs);counts.push(0);}counts[k]++;}
  return plo={index,keys,reps,counts,classOf:cards=>index.get(ploCode(cards))};
 }
 const classIndex=new Map(classes.map((c,i)=>[c,i]));
 function rowFor(pack,node,cards){
  if(node.table){const i=pack.groups?pack.groups.of[ploClasses().classOf(cards)]:classIndex.get(G.Core.handClass(cards));if(i===undefined)return null;const A=node.actions.length,row=[];for(let a=0;a<A;a++)row.push(node.table[i*A+a]/1000);return row;}
  if(pack.groups)return node.strategy[pack.groups.labels[pack.groups.of[ploClasses().classOf(cards)]]]||null;
  return node.strategy[canonicalCards(cards)]||node.strategy[G.Core.handClass(cards)]||(node.defaultFold?node.foldRow:null);
 }
 // handGroups: {labels:[name per group], classes: two base-36 digits per PLO class giving its group}.
 function readGroups(raw){
  const n=ploClasses().keys.length;need(raw&&Array.isArray(raw.labels)&&raw.labels.length>=2&&raw.labels.length<=1296&&typeof raw.classes==='string'&&raw.classes.length===2*n,'A PLO reference needs hand groups covering all '+n+' PLO hand classes.');
  const labels=raw.labels.map(l=>text(l,'a hand group name',120));need(new Set(labels).size===labels.length,'Hand group names must be unique.');
  const of=new Uint16Array(n);for(let i=0;i<n;i++){const g=parseInt(raw.classes.substr(2*i,2),36);need(g>=0&&g<labels.length,'A PLO hand class points to a missing hand group.');of[i]=g;}
  return{labels,classes:raw.classes,of};
 }
 // trusted: rows this app stored after validating them; their replayed keys and action
 // labels are reused instead of replaying every history, which keeps start-up fast.
 function validate(input,trusted=false){
  need(input&&input.format===FORMAT,'Use a Range Lab preflop reference JSON file.');// Rows are read, not changed, so the large row arrays are not copied.
  const pack=JSON.parse(JSON.stringify({...input,nodes:[]}));need(Array.isArray(input.nodes),'Import one to 10,000 decision nodes.');pack.nodes=input.nodes.map(n=>({seat:n?.seat,history:JSON.parse(JSON.stringify(n?.history??null)),actions:JSON.parse(JSON.stringify(n?.actions??null)),strategy:n?.strategy,table:n?.table,defaultFold:n?.defaultFold,key:n?.key}));pack.name=text(pack.name,'a reference name',120);need(pack.source&&typeof pack.source==='object','Provide the solver reference source.');for(const name of ['name','url','solver','settings','createdAt'])pack.source[name]=text(pack.source[name],'source '+name,2000);need(/^https:\/\//i.test(pack.source.url),'Use an HTTPS source URL.');need(Number.isFinite(Date.parse(pack.source.createdAt)),'The source date must be valid.');
  pack.config=G.normalize(pack.config);need(['NLH','PLO4'].includes(pack.config.variant)&&pack.config.startStreet===0,'Preflop references currently support NLH and four-card PLO starting from the blinds.');const groups=pack.config.variant==='PLO4'?readGroups(pack.handGroups):null;pack.groups=groups;const labels=groups?groups.labels:classes;need(pack.config.button===0,'Reference seat numbers must start at the button (seat 0).');need(Array.isArray(pack.nodes)&&pack.nodes.length>0&&pack.nodes.length<=10000,'Import one to 10,000 decision nodes.');const seen=new Set(),base=new G.Hand(pack.config,{rng:G.rng(742)}),states=new Map();
  for(const node of pack.nodes){
   need(Array.isArray(node.history)&&node.history.length<=100&&Array.isArray(node.actions)&&node.actions.length>=2&&node.actions.length<=16,'A node needs its complete preflop history and two to sixteen actions.');
   if(trusted&&typeof node.key==='string'&&node.actions.every(a=>a&&typeof a.label==='string'&&typeof a.id==='string')){node.actions=node.actions.map(a=>({kind:a.kind,id:a.id,...a.kind==='raise'?{target:a.target}:{},label:a.label}));}else{
   delete node.key;
   // Replays start from the longest history prefix already replayed for this pack.
   const keys=[''];for(const e of node.history)keys.push(keys[keys.length-1]+'/'+e?.seat+e?.kind+(e?.to??''));let k=keys.length-1;while(k>0&&!states.has(keys[k]))k--;const h=(states.get(keys[k])||base).clone();
   for(let i=k;i<node.history.length;i++){const e=node.history[i];need(!h.done&&h.street===0&&e.seat===h.actor,'The reference history has an invalid actor or street.');h.act({kind:e.kind,target:['raise','bet'].includes(e.kind)?G.units(e.to):undefined});states.set(keys[i+1],h.clone());}
   need(!h.done&&h.street===0&&node.seat===h.actor,'The node seat does not match its action history.');const ids=new Set();node.actions=node.actions.map((a,i)=>{need(['fold','check','call','raise'].includes(a.kind),'Use fold, check, call or raise in a preflop reference.');const action={kind:a.kind,id:'pf'+i,...a.kind==='raise'?{target:a.to===undefined&&Number.isInteger(a.target)?a.target:G.units(a.to)}:{}};h.clone().act(action);const signature=a.kind+':'+(action.target||0);need(!ids.has(signature),'A reference node contains duplicate actions.');ids.add(signature);const l=h.legal();action.label=a.kind==='raise'?'Raise to '+G.bb(action.target)+' bb'+(action.target===l.allInTo?' · all-in':''):a.kind==='call'?'Call '+G.bb(l.callCost)+' bb':a.kind==='check'?'Check':'Fold';return action;});
   node.key=historyKey(h);}
   const A=node.actions.length,fold=node.actions.findIndex(a=>a.kind==='fold');node.foldRow=node.actions.map((_,i)=>i===fold?1:0);
   // Compact packs list one row per class in PokerPreflop.classes order (NLH) or hand group
   // order (PLO): an action index for a pure row, or per-mille frequencies. They are kept
   // as one per-mille table per node, which stays small in memory and storage.
   if(node.table||Array.isArray(node.strategy)){
    const t=new Uint16Array(labels.length*A);
    if(node.table){const src=ArrayBuffer.isView(node.table)||Array.isArray(node.table)?node.table:Object.values(node.table);need(src.length===t.length&&Array.prototype.every.call(src,v=>Number.isInteger(v)&&v>=0&&v<=1000),'A compact node needs one row per hand class.');t.set(src);}
    else{need(node.strategy.length===labels.length,'A compact node needs one row per hand class.');node.strategy.forEach((r,i)=>{if(Number.isInteger(r)){need(r>=0&&r<A,'A compact row names a missing action.');t[i*A+r]=1000;}else{need(Array.isArray(r)&&r.length===A&&r.every(v=>Number.isInteger(v)&&v>=0&&v<=1000),'Compact rows use per-mille frequencies.');t.set(r,i*A);}});}
    for(let i=0;i<labels.length;i++){let x=0;for(let a=0;a<A;a++)x+=t[i*A+a];need(x===1000,'Action frequencies must sum to one for '+labels[i]+'.');}
    node.table=t;delete node.strategy;node.defaultFold=false;
   }else{
   delete node.table;need(node.strategy&&typeof node.strategy==='object'&&!Array.isArray(node.strategy),'Each node needs hand frequencies.');const normalized=Object.create(null);for(const [label,values]of Object.entries(node.strategy)){need(groups?groups.labels.includes(label):classes.includes(label)||/^(?:[2-9TJQKA][cdhs]){2}$/.test(label),'Invalid reference hand: '+label);const k=groups||classes.includes(label)?label:canonicalCards(G.Core.cards(label));need(!(k in normalized),'Duplicate reference combination.');need(Array.isArray(values)&&values.length===node.actions.length&&values.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Math.abs(sum(values)-1)<1e-6,'Action frequencies must sum to one for '+label+'.');normalized[k]=values.slice();}node.strategy=normalized;node.defaultFold=node.defaultFold===true;need(!node.defaultFold||fold>=0,'defaultFold requires a fold action.');
   if(groups)need(groups.labels.every(l=>l in node.strategy),'A PLO reference node needs a row for every hand group.');else need(G.combinations(Array.from({length:52},(_,i)=>i),2).every(cs=>rowFor(pack,node,cs)),'A reference node must cover every combination or explicitly set defaultFold.');
   }
   need(!seen.has(node.key),'The reference contains duplicate history nodes.');seen.add(node.key);
  }
  pack.chipEV=pack.chipEV===true&&pack.config.mode==='icm';pack.family=G.familyId(pack.config);pack.index=new Map(pack.nodes.map(n=>[n.key,n]));return pack;
 }
 // forStorage keeps compact rows as typed arrays for IndexedDB; otherwise the output is plain JSON.
 function serialize(pack,forStorage=false){return{format:FORMAT,name:pack.name,...pack.chipEV?{chipEV:true}:{},...pack.groups?{handGroups:{labels:pack.groups.labels,classes:pack.groups.classes}}:{},source:pack.source,config:pack.config,nodes:pack.nodes.map(n=>({seat:n.seat,history:n.history,actions:n.actions.map(a=>({kind:a.kind,...a.kind==='raise'?{to:G.bb(a.target)}:{}})),...forStorage?{key:n.key,actions:n.actions.map(a=>({kind:a.kind,id:a.id,...a.kind==='raise'?{target:a.target}:{},label:a.label}))}:{},...n.table?forStorage?{table:n.table}:{strategy:compactRows(n)}:{strategy:n.strategy,defaultFold:n.defaultFold}}))};}
 function compactRows(n){const A=n.actions.length,out=[];for(let i=0;i<n.table.length;i+=A){const r=Array.from(n.table.subarray(i,i+A)),pure=r.indexOf(1000);out.push(pure>=0?pure:r);}return out;}
 function query(pack,hand,controlActions=[]){
  if(hand.done||hand.street!==0||hand.family!==pack.family)return null;const node=pack.index.get(historyKey(hand));if(!node)return null;const row=rowFor(pack,node,hand.holes[hand.actor]);if(!row)return null;const actions=node.actions.map(a=>({...a}));for(const a of controlActions)if(!actions.some(b=>b.kind===a.kind&&(!['raise','bet'].includes(a.kind)||b.target===a.target)))actions.push({...a});const probs=actions.map((a,i)=>i<row.length?row[i]:null);
  return{supported:true,referenceOnly:true,referenceVersion:1,actions,reference:probs,probs,trained:true,displayEligible:true,visits:0,updates:0,referenceSource:{kind:'imported-preflop',name:pack.name,...pack.source},referenceKey:pack.family+'|'+node.key,handClass:G.Core.handClass(hand.holes[hand.actor]),units:hand.config.mode==='cash'?'bb':'prize units',game:{seats:hand.n,stacks:hand.config.stacks.slice(),ante:hand.config.ante,rakePct:hand.config.rakePct,rakeCap:hand.config.rakeCap}};
 }
 // Live sessions carry stacks between hands, so exact-depth matches are rare.
 // This falls back to the closest-depth pack of the same game (within 25%),
 // replays the line in that pack's game and labels the depth substitution.
 // Chip-EV tournament charts ignore payouts and other tables' stacks, so they
 // stand in for any tournament with the same blinds and ante.
 function shape(config,chipEV=false){const f=JSON.parse(G.familyId(config));delete f.stacks;if(chipEV){delete f.payouts;delete f.other;}return JSON.stringify(f);}
 function nearest(packs,hand,controlActions=[],tolerance=1.5){
  if(hand.done||hand.street!==0)return null;const n=hand.n,live=hand.living(),hero=hand.actor,others=live.filter(i=>i!==hero).map(i=>hand.initial[i]);if(!others.length)return null;
  const depth=G.bb(Math.min(hand.initial[hero],Math.max(...others))),table={...hand.config,button:0};let best=null;
  for(const pack of packs){const chart=Math.max(...pack.config.stacks),gap=Math.abs(Math.log(chart/depth));if(gap>Math.log(tolerance)||shape(pack.config,pack.chipEV)!==shape(table,pack.chipEV)||best&&gap>=best.gap)continue;best={pack,gap,chart};}
  if(!best)return null;const relative=i=>(i-hand.button+n)%n,proxy=new G.Hand(best.pack.config,{rng:G.rng(743)});
  try{for(const a of hand.actionLog)proxy.act({kind:a.kind,target:a.target});}catch{return null;}
  proxy.holes[relative(hero)]=hand.holes[hero].slice();const result=query(best.pack,proxy,[]);if(!result)return null;
  // The chart's all-in stands for this hand's all-in, whatever its depth.
  const chartJam=proxy.legal().allInTo,jam=hand.legal().allInTo;for(const a of result.actions)if(a.kind==='raise'&&a.target===chartJam){a.target=jam;a.label='Raise to '+G.bb(jam)+' bb · all-in';}
  for(const a of controlActions)if(!result.actions.some(b=>b.kind===a.kind&&(!['raise','bet'].includes(a.kind)||b.target===a.target))){result.actions.push({...a});result.reference.push(null);}result.probs=result.reference;
  result.depthMatch={chart:best.chart,actual:depth};result.referenceKey+='|depth:'+depth;return result;
 }
 function isResult(r){return !!(r?.supported&&r.referenceOnly&&r.referenceVersion===1&&r.referenceSource?.kind==='imported-preflop'&&typeof r.referenceSource.name==='string'&&/^https:\/\//.test(r.referenceSource.url)&&Array.isArray(r.actions)&&r.actions.length>=2&&r.actions.length===r.reference?.length&&r.reference.every(x=>x===null||Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(sum(r.reference.map(x=>x||0))-1)<1e-6);}
 const api={FORMAT,classes,ploClasses,validate,serialize,query,nearest,isResult,historyKey};root.PokerPreflop=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
