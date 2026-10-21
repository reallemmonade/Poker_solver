(function(root){
 'use strict';
 let G=root.PokerGame,T=root.PokerTraining;
 if(!G&&typeof require==='function'){try{G=require('./hand-engine.js');}catch{G=require('./game.js');}}
 if(!T&&typeof require==='function'){try{T=require('./full-hand-trainer.js');}catch{T=require('./trainer.js');}}
 const C=G.Core;
 const VERSION=1,PRUNE=.03,assert=(v,m)=>{if(!v)throw Error(m)},sum=a=>a.reduce((s,x)=>s+x,0),comboKey=cs=>cs.slice().sort((a,b)=>a-b).join('.');
 const clock=()=>typeof performance==='undefined'?Date.now():performance.now();
 function choose(n,k){let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;}
 function options(raw={}){const sizes=raw.rootSizes===undefined?[]:raw.rootSizes;assert(Array.isArray(sizes)&&sizes.length<=6&&sizes.every(x=>Number.isFinite(Number(x))&&Number(x)>0),'Enter up to six positive additional bet/raise totals in bb.');const given=raw.abstraction||{},base=T.normalizeAbstraction({...given,betSizes:given.betSizes||[1/3,2/3,1.5],raiseSizes:given.raiseSizes||[1/3,2/3,1.5]}),abstraction=T.normalizeAbstraction({...base,jam:true});return{rangeMode:raw.rangeMode==='uniform'?'uniform':'auto',ranges:Array.isArray(raw.ranges)?raw.ranges.map(String):[],iterations:Math.min(500000,Math.max(1000,Number(raw.iterations)||50000)),samples:Math.min(10000,Math.max(200,Number(raw.samples)||2000)),milliseconds:Math.min(180000,Math.max(1000,Number(raw.milliseconds)||45000)),maxInfos:Math.min(500000,Math.max(1000,Number(raw.maxInfos)||150000)),exactMemoryMB:Math.min(4096,Math.max(32,Number(raw.exactMemoryMB)||256)),maxJointDeals:Math.min(500000,Math.max(100,Number(raw.maxJointDeals)||20000)),approximate:raw.approximate!==false,preparationMilliseconds:Math.min(180000,Math.max(1000,Number(raw.preparationMilliseconds)||15000)),tolerance:Math.min(.05,Math.max(.00001,Number(raw.tolerance)||.001)),rootSizes:sizes.map(Number),abstraction};}
 function publicKey(data){return JSON.stringify([data.config,data.actor,data.heroCards.slice().sort((a,b)=>a-b),data.board,data.actions.map(a=>[a.seat,a.street,a.kind,a.target])]);}
 function reconstruct(data,holes,random=G.rng(1)){
  const h=new G.Hand(data.config,{holes,runout:data.board.slice(data.config.boardCards.length),rng:random});
  for(const a of data.actions){assert(!h.done&&h.actor===a.seat&&h.street===a.street,'The public action history cannot be reconstructed.');h.act(a);}
  assert(!h.done&&h.actor===data.actor&&h.board.join(',')===data.board.join(','),'The selected spot is no longer an open decision.');return h;
 }
 function parseRange(text,rules,board){
  const clean=String(text||'').trim();if(!clean||/^(?:auto|all|random|\*)$/i.test(clean))return null;
  const map=new Map(),blocked=new Set(board),ranks='23456789TJQKA';
  const add=(cards,weight)=>{assert(cards.length===rules.hole&&new Set(cards).size===cards.length,'Each range combination needs '+rules.hole+' different cards.');if(cards.some(c=>blocked.has(c)))return;const key=comboKey(cards);map.set(key,{cards:cards.slice().sort((a,b)=>a-b),weight:Math.max(weight,map.get(key)?.weight||0),key});};
  const cls=(a,b,suffix,w)=>{const x=ranks.indexOf(a.toUpperCase()),y=ranks.indexOf(b.toUpperCase());assert(x>=0&&y>=0&&!(x===y&&suffix),'Invalid starting-hand class.');for(let i=0;i<4;i++)for(let j=0;j<4;j++){if(x===y&&i>=j||x!==y&&(suffix==='s'&&i!==j||suffix==='o'&&i===j))continue;add([4*x+i,4*y+j],w);}};
  for(const token of clean.split(/[\s,;]+/).filter(Boolean)){
   const parts=token.split(':');assert(parts.length<=2,'Use one weight per range combination.');const w=parts[1]===undefined?1:parts[1].endsWith('%')?Number(parts[1].slice(0,-1))/100:Number(parts[1]);assert(Number.isFinite(w)&&w>=0&&w<=1,'Range weights must be between zero and one.');if(!w)continue;
   const label=parts[0];if(/^(?:[2-9TJQKA][cdhs]){2,6}$/i.test(label)){add(C.cards(label),w);continue;}
   assert(rules.hole===2,'Omaha ranges use exact combinations, for example AsKsQhJh.');
   let m=/^([2-9TJQKA])([2-9TJQKA])([so]?)\+$/i.exec(label);
   if(m){const a=ranks.indexOf(m[1].toUpperCase()),b=ranks.indexOf(m[2].toUpperCase());if(a===b){for(let r=a;r<13;r++)cls(ranks[r],ranks[r],'',w);}else{assert(a>b,'Use plus ranges with the higher rank first, such as AJs+.');for(let r=b;r<a;r++)cls(ranks[a],ranks[r],m[3].toLowerCase(),w);}continue;}
   m=/^([2-9TJQKA])([2-9TJQKA])([so]?)-([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(label);
   if(m){const [a,b,d,e]=[m[1],m[2],m[4],m[5]].map(x=>ranks.indexOf(x.toUpperCase()));if(a===b&&d===e){for(let r=Math.min(a,d);r<=Math.max(a,d);r++)cls(ranks[r],ranks[r],'',w);}else{assert(a===d&&m[3].toLowerCase()===m[6].toLowerCase(),'Use pair spans or fixed-high-card spans such as A2s-A5s.');for(let r=Math.min(b,e);r<=Math.max(b,e);r++)cls(ranks[a],ranks[r],m[3].toLowerCase(),w);}continue;}
   m=/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(label);assert(m,'Unrecognized range token: '+label);cls(m[1],m[2],m[3].toLowerCase(),w);
  }
  assert(map.size,'The entered range has no legal combinations after board blockers.');return[...map.values()];
 }
 function distribution(rows,uniformCount){
  if(!rows)return{uniform:true,count:uniformCount,prob:()=>1/uniformCount};const total=sum(rows.map(r=>r.weight));assert(total>0,'A player range has zero mass.');let cumulative=0;const lookup=new Map();for(const r of rows){r.prob=r.weight/total;cumulative+=r.prob;r.cumulative=cumulative;lookup.set(r.key,r.prob);}return{uniform:false,rows,count:rows.length,prob:cards=>lookup.get(comboKey(cards))||0};
 }
 function sampleRow(d,random){let lo=0,hi=d.rows.length-1;const u=random();while(lo<hi){const m=(lo+hi)>>1;if(d.rows[m].cumulative<u)lo=m+1;else hi=m;}return d.rows[lo].cards.slice();}
 class Ranges{
  constructor(data,model,opt){
   this.data=data;this.config=G.normalize(data.config);this.rules=this.config.rules;this.hero=data.actor;this.board=data.board.slice();this.heroCards=data.heroCards.slice();this.options=opt;this.descriptions=[];this.distributions=[];
   const boardSet=new Set(this.board),deck=Array.from({length:52},(_,i)=>i).filter(c=>!boardSet.has(c)),all=this.rules.hole===2?G.combinations(deck,2).map(cards=>({cards,key:comboKey(cards),weight:1})):null;
   const count=choose(deck.length,this.rules.hole),prefix=[];if(model&&opt.rangeMode==='auto'&&all){const h=new G.Hand(this.config,{runout:data.board.slice(this.config.boardCards.length),rng:G.rng(917)});for(const a of data.actions){prefix.push({hand:h.clone(),action:a});h.act(a);}}
   for(let seat=0;seat<this.config.seats;seat++){
    const text=opt.ranges[seat]||'',explicit=parseRange(text,this.rules,this.board),automatic=!text.trim()||/^auto$/i.test(text.trim());let rows=explicit,used=0,skipped=0,pruned=0;
    if(!rows&&all){rows=all.map(r=>({...r,cards:r.cards.slice()}));if(automatic&&opt.rangeMode==='auto'&&!model)skipped=data.actions.filter(a=>a.seat===seat).length;if(automatic&&opt.rangeMode==='auto'&&model){
     for(const frame of prefix.filter(p=>p.action.seat===seat)){
      const legal=rows.filter(r=>!r.cards.some(c=>frame.hand.board.includes(c))),likelihood=[];let ready=0;
      for(const row of legal){const h=frame.hand;h.holes[seat]=row.cards;const q=model.query(h),a=T.matchAction(q.actions,frame.action),valid=a>=0&&T.referenceEvidence(q);if(valid)ready++;likelihood.push(valid?(.95*q.probs[a]+.05/q.actions.length):null);}
      // A whole action is omitted when its range-wide evidence is sparse. This
      // avoids rewarding individual untrained hands with an arbitrary fallback.
      if(ready===legal.length&&ready){for(let j=0;j<legal.length;j++)legal[j].weight*=likelihood[j];const peak=Math.max(...legal.map(r=>r.weight));if(peak>0)for(const row of legal)row.weight/=peak;used++;}else skipped++;
     }
     // Approximate mode drops hands the learned strategy almost never plays
     // this way, so later exact solves enumerate far fewer joint deals.
     if(used&&opt.approximate){const actual=seat===this.hero?comboKey(this.heroCards):null,before=rows.length;rows=rows.filter(r=>r.weight>=PRUNE||r.key===actual);pruned=before-rows.length;}
    }}else if(!rows&&automatic&&data.actions.some(a=>a.seat===seat))skipped=data.actions.filter(a=>a.seat===seat).length;
    let d=distribution(rows,count);if(!explicit&&used===0)d=distribution(null,count);
    this.distributions.push(d);this.descriptions.push({seat,range:explicit?text:used?'History-conditioned starting range':'All legal hands',combinations:d.count,historyActionsUsed:used,historyActionsOmitted:skipped,pruned,source:explicit?'User-specified current range':used?'Learned history likelihoods with 5% smoothing'+(pruned?'; '+pruned+' rarely played combinations removed':''):'Broad uniform assumption',implicit:d.uniform});
   }
   assert(!this.heroCards.some(c=>boardSet.has(c))&&this.heroCards.length===this.rules.hole,'Your private cards conflict with the public board.');assert(this.distributions[this.hero].prob(this.heroCards)>0,'Your hand is excluded from your range. Include it in the range before solving.');
  }
  rows(seat){const d=this.distributions[seat];if(!d.uniform)return d.rows.map(r=>({...r}));assert(this.rules.hole===2,'Full Omaha combination ranges exceed the local enumeration budget. Supply explicit current ranges or a matching presolved strategy.');const blocked=new Set(this.board),deck=Array.from({length:52},(_,i)=>i).filter(c=>!blocked.has(c)),p=1/d.count;return G.combinations(deck,2).map(cards=>({cards,key:comboKey(cards),prob:p}));}
  draw(random,fixedHero=false,target=true){
   const hero=this.hero,heroD=this.distributions[hero],boardSet=new Set(this.board),uniform=used=>{const deck=Array.from({length:52},(_,i)=>i).filter(c=>!used.has(c));const cs=[];for(let k=0;k<this.rules.hole;k++){const j=Math.floor(random()*deck.length);cs.push(deck[j]);deck.splice(j,1);}return cs;};
   for(let attempt=0;attempt<5000;attempt++){
    const used=new Set(boardSet),holes=Array(this.config.seats).fill(null);holes[hero]=fixedHero||target&&random()<.5?this.heroCards.slice():heroD.uniform?uniform(used):sampleRow(heroD,random);for(const c of holes[hero])used.add(c);let invalid=false;
    // Rejection over all constrained ranges samples their joint product with
    // card removal, without assigning order-dependent range probabilities.
    for(let seat=0;seat<holes.length;seat++){if(seat===hero||this.distributions[seat].uniform)continue;const cards=sampleRow(this.distributions[seat],random);if(cards.some(c=>used.has(c))){invalid=true;break;}holes[seat]=cards;cards.forEach(c=>used.add(c));}if(invalid)continue;
    for(let seat=0;seat<holes.length;seat++)if(!holes[seat]){holes[seat]=uniform(used);holes[seat].forEach(c=>used.add(c));}
    const p=heroD.prob(holes[hero]),isActual=comboKey(holes[hero])===comboKey(this.heroCards),q=target?.5*p+(isActual?.5:0):p;return{holes,weight:fixedHero?1:p/q};
   }
   throw Error('These ranges have too few compatible joint deals. Widen overlapping exact ranges.');
  }
 }
 function actionsAt(hand,rootHand,opt,extra){
  const a={...opt.abstraction,maxAggressions:(hand.street===rootHand.street?rootHand.aggressions:0)+opt.abstraction.maxAggressions},out=G.modelActions(hand,a),atRoot=hand.actionLog.length===rootHand.actionLog.length&&hand.board.length===rootHand.board.length;
  if(atRoot){const l=hand.legal(),targets=[...opt.rootSizes.map(G.units),...(extra&&['bet','raise'].includes(extra.kind)?[extra.target]:[])];for(const target of targets){if(out.some(x=>x.target===target))continue;const action={kind:hand.currentBet?'raise':'bet',id:'s'+target,target,label:(hand.currentBet?'Raise to ':'Bet ')+G.bb(target)+' bb'+(target===l.allInTo?' · all-in':'')};try{hand.clone().act(action);out.push(action);}catch{throw Error('An additional root bet size is outside the legal street total.');}}}
  return out.sort((a,b)=>Number(['bet','raise'].includes(a.kind))-Number(['bet','raise'].includes(b.kind))||((a.target||0)-(b.target||0)));
 }
 function utility(terminal,rootHand){const values=terminal.utility();if(terminal.config.mode==='cash')return values.map((v,i)=>v+G.bb(rootHand.initial[i]-rootHand.stacks[i]));return values;}
 function keyFor(hand,start){return[hand.actor,comboKey(hand.holes[hand.actor]),hand.board.join('.'),hand.actionLog.slice(start).map(a=>a.seat+':'+a.kind+':'+(a.target||0)).join('/')].join('|');}
 function summaryResult(actions,reference,rows,units,metadata){
  const n=rows.length;assert(n>1,'The solve stopped before it could evaluate the actions.');const mean=actions.map((_,a)=>sum(rows.map(r=>r[a]))/n),best=mean.indexOf(Math.max(...mean)),se=mean.map((m,a)=>Math.sqrt(sum(rows.map(r=>(r[a]-m)**2))/(n*(n-1)))),loss=mean.map(v=>Math.max(0,mean[best]-v)),lossSE=mean.map((m,a)=>{const d=mean[best]-m;return Math.sqrt(sum(rows.map(r=>((r[best]-r[a])-d)**2))/(n*(n-1)));});return{supported:true,actions,reference,mean,se,loss,lossSE,best,samples:n,effectiveSamples:n,units,ignoredPublicActions:0,...metadata};
 }
 class SampledSolver{
  constructor(data,ranges,opt,extra){this.data=data;this.ranges=ranges;this.options=opt;this.random=G.rng(71329);const deal=ranges.draw(this.random,true);this.root=reconstruct(data,deal.holes,this.random);this.start=this.root.actionLog.length;this.extra=extra;this.actions=actionsAt(this.root,this.root,opt,extra);this.table=new T.Table(opt.maxInfos);this.iterations=0;this.phase='solving';this.evaluations=[];this.complete=false;this.started=clock();this.lastPolicy=null;this.stability=null;this.covered=0;this.continuations=0;this.branchKnown=this.actions.map(()=>0);this.branchCount=this.actions.map(()=>0);this.halted=null;this.active=this.root.actors();this.actorVisits=Array(this.root.n).fill(0);}
  key(hand){
   const cs=hand.holes[hand.actor],actual=hand.actor===this.data.actor&&comboKey(cs)===comboKey(this.data.heroCards),memory=[G.preBucket(cs,hand.rules)],publicMemory=[];
   for(const len of [3,4,5])if(hand.board.length>=len){const board=hand.board.slice(0,len);memory.push(G.postBucket(cs,board,hand.rules));publicMemory.push(G.texture(board));}
   return['M1',hand.actor,actual?'exact:'+comboKey(cs):'features',memory.join('/'),publicMemory.join('/'),hand.actionLog.slice(this.start).map(a=>a.seat+':'+a.kind+':'+(a.target||0)).join('/')].join('|');
  }
  query(hand){const actions=actionsAt(hand,this.root,this.options,this.extra),key=this.key(hand);return{key,actions,...this.table.policy(key,actions,true)};}
  trainOne(){
   const deal=this.ranges.draw(this.random,false,true),h=reconstruct(this.data,deal.holes,this.random),updating=this.active[this.iterations%this.active.length],self=this,adapter={done:()=>h.done,info:()=>({actor:h.actor,key:self.key(h),actions:actionsAt(h,self.root,self.options,self.extra)}),act:a=>h.act(a),utility:p=>utility(h,self.root)[p]},scale=h.config.mode==='cash'?sum(h.config.stacks)+h.config.pot:sum(h.config.payouts)+sum(h.config.bounties);
   try{T.episode(adapter,updating,this.table,this.random,this.options.abstraction.exploration,Math.max(1,scale),deal.weight);this.actorVisits[updating]++;this.iterations++;}catch(error){if(!error.capacity)throw error;this.halted='The spot memory budget was reached.';this.phase='evaluating';}
   if(this.iterations%1000===0){const p=this.query(this.root).probs;if(this.lastPolicy)this.stability=sum(p.map((v,i)=>Math.abs(v-this.lastPolicy[i])));this.lastPolicy=p.slice();}
  }
  evaluateOne(){
   const deal=this.ranges.draw(this.random,true),h=reconstruct(this.data,deal.holes,this.random),seed=Math.floor(this.random()*4294967296),values=[];
   for(let a=0;a<this.actions.length;a++){const next=h.clone(),random=G.rng(seed);next.act(this.actions[a]);let guard=0;while(!next.done&&guard++<300){const q=this.query(next);this.continuations++;this.branchCount[a]++;if(q.updates>0){this.covered++;this.branchKnown[a]++;}next.act(q.actions[G.pick(q.probs,random)]);}assert(next.done,'A continuation exceeded its action budget.');values.push(utility(next,this.root)[this.data.actor]);}this.evaluations.push(values);
  }
  step(){if(this.complete)return;if(this.phase==='solving'){this.trainOne();if(this.iterations>=this.options.iterations||clock()-this.started>=this.options.milliseconds){this.phase='evaluating';}}else{this.evaluateOne();if(this.evaluations.length>=this.options.samples)this.complete=true;}}
  progress(){return{method:'sampled-subgame',phase:this.phase,done:this.phase==='solving'?this.iterations:this.evaluations.length,total:this.phase==='solving'?this.options.iterations:this.options.samples,states:this.table.entries.size,seconds:(clock()-this.started)/1000};}
  result(){const q=this.query(this.root),coverage=this.continuations?this.covered/this.continuations:1;return summaryResult(this.actions,q.probs,this.evaluations,this.root.config.mode==='cash'?'bb':'prize units',{referenceTrained:q.updates>0,referenceVisits:q.visits,referenceUpdates:q.updates,coverage,evidenceCoverage:coverage,beliefCoverage:1,actionCoverage:this.branchCount.map((n,i)=>n?this.branchKnown[i]/n:1),continuationDecisions:this.continuations,reliable:false,solve:{version:VERSION,method:'sampled-subgame',exact:false,iterations:this.iterations,states:this.table.entries.size,rootUpdates:q.updates,stabilityL1:this.stability,gap:null,tolerance:null,converged:false,rangeAssumptions:this.ranges.descriptions,actionTree:this.options.abstraction,additionalRootSizes:this.options.rootSizes,historyPreserved:true,privateCardsUsed:'Acting player only; opponents and future cards resampled',halted:this.halted,seconds:(clock()-this.started)/1000,observationAbstraction:'Exact acting-player hand; grouped opponent card features and future board textures, with observation memory',warning:'This sampled continuation solution has no measured equilibrium gap. Frequencies and EVs are provisional and conditional on the displayed ranges and finite bet tree.'}});}
 }
 // An exact, range-wide CFR+ river solver. NLH leaf values use sorted rank
 // sweeps and card-blocker subtraction instead of enumerating a million pairs
 // at every leaf. Other variants use explicitly enumerated compatible pairs.
 class ExactRiverSolver{
  constructor(data,ranges,opt,extra){
   assert(data.config.seats===2&&data.board.length===5&&!data.config.rules?.low&&!data.config.bounties.some(x=>x>0),'The exact path requires two players on the river without split-low or bounty utility.');
   this.data=data;this.ranges=ranges;this.options=opt;this.random=G.rng(971);this.rootHand=reconstruct(data,ranges.draw(this.random,true).holes,this.random);this.extra=extra;this.started=clock();this.iterations=0;this.complete=false;this.phase='solving';this.nodes=[];this.leaves=[];this.exact=true;
   this.hands=[0,1].map(seat=>ranges.rows(seat).map(h=>({...h,rank:G.evaluate(h.cards,data.board,this.rootHand.rules).high})).sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key)));this.sizes=this.hands.map(a=>a.length);this.fast=this.rootHand.rules.hole===2;this.lookups=this.hands.map(h=>new Map(h.map((x,i)=>[x.key,i])));this.ones=this.hands.map(h=>new Float64Array(h.length).fill(1));
   this.normalizer=0;this.pairs=null;
   if(this.fast){const weights=this.hands[1].map(h=>h.prob),cards=new Float64Array(52);for(let j=0;j<weights.length;j++)for(const c of this.hands[1][j].cards)cards[c]+=weights[j];for(const h of this.hands[0]){const j=this.lookups[1].get(h.key);this.normalizer+=h.prob*(1-cards[h.cards[0]]-cards[h.cards[1]]+(j===undefined?0:weights[j]));}}
   else{const pairs=[];assert(this.sizes[0]*this.sizes[1]<=150000,'These exact Omaha ranges exceed the local exact-tree budget.');for(let i=0;i<this.sizes[0];i++)for(let j=0;j<this.sizes[1];j++){const a=this.hands[0][i],b=this.hands[1][j];if(a.cards.some(c=>b.cards.includes(c)))continue;const w=a.prob*b.prob;this.normalizer+=w;pairs.push({i,j,w,o:a.rank>b.rank?0:a.rank<b.rank?1:2});}this.pairs=pairs;}
   assert(this.normalizer>0,'The two player ranges have no compatible deals.');this.root=this.build(this.rootHand.clone());this.actions=this.root.actions;this.heroIndex=this.lookups[data.actor].get(comboKey(data.heroCards));assert(this.heroIndex!==undefined,'Your exact hand is excluded from your range.');
   const utilityTotals=this.leaves.flatMap(n=>[0,1,2].map(o=>n.utility[0][o]+n.utility[1][o]));this.constantSum=Math.max(...utilityTotals)-Math.min(...utilityTotals)<1e-8;this.threshold=data.config.mode==='cash'?Math.max(.0001,G.bb(this.rootHand.pot)*opt.tolerance):Math.max(.000001,sum(data.config.payouts)*opt.tolerance*.01);this.diagnostic=null;
  }
  terminalValues(hand){
   const live=this.seats||this.rootHand.living(),n=hand.n,base=hand.stacks.map((stack,i)=>stack-sum(hand.pots.map(p=>p.paid[i]))),before=[...hand.initial.map(v=>G.bb(v)+hand.config.pot/n),...hand.config.otherStacks],baseline=hand.config.mode==='icm'?G.terminalICM(before,before,hand.config.payouts):null;
   return[0,1,2].map(outcome=>{const stacks=base.slice();for(const pot of hand.pots){const winners=hand.foldWinner!==null?[hand.foldWinner]:pot.eligible.length===1?pot.eligible:outcome===2?pot.eligible:[live[outcome]];const each=Math.floor(pot.net/winners.length),order=winners.slice().sort((a,b)=>((a-hand.button-1+n)%n)-((b-hand.button-1+n)%n));for(let i=0;i<order.length;i++)stacks[order[i]]+=each+(i<pot.net-each*order.length?1:0);}if(hand.config.mode==='cash')return stacks.map((v,i)=>G.bb(v-this.rootHand.stacks[i]));const equity=G.terminalICM([...stacks.map(G.bb),...hand.config.otherStacks],before,hand.config.payouts);return stacks.map((_,i)=>equity[i]-baseline[i]);});
  }
  build(hand){
   assert(this.nodes.length<2000,'The selected river bet tree exceeds the local tree budget.');const n={hand,actor:hand.actor,v:this.sizes.map(s=>new Float64Array(s))};this.nodes.push(n);if(hand.done){const values=this.terminalValues(hand);n.utility=[0,1].map(i=>values.map(v=>v[i]));this.leaves.push(n);return n;}
   n.actions=actionsAt(hand,this.rootHand,this.options,this.extra);n.children=n.actions.map(a=>{const h=hand.clone();h.act(a);return this.build(h);});const len=this.sizes[n.actor]*n.actions.length;n.regrets=new Float64Array(len);n.average=new Float64Array(len);n.strategy=new Float64Array(len);n.reaches=n.actions.map(()=>new Float64Array(this.sizes[n.actor]));return n;
  }
  setStrategy(average=false){for(const n of this.nodes){if(n.utility)continue;const source=average?n.average:n.regrets,A=n.actions.length;for(let h=0;h<this.sizes[n.actor];h++){let total=0;for(let a=0;a<A;a++)total+=Math.max(0,source[h*A+a]);for(let a=0;a<A;a++)n.strategy[h*A+a]=total?Math.max(0,source[h*A+a])/total:1/A;}}}
  aggregate(player,reach,u){
   const own=this.hands[player],opp=this.hands[1-player],out=new Float64Array(own.length);if(!this.fast){for(const pair of this.pairs){const i=player===0?pair.i:pair.j,j=player===0?pair.j:pair.i;out[i]+=pair.w/this.normalizer*reach[j]*u[pair.o];}return out;}
   const totalCards=new Float64Array(52),lowerCards=new Float64Array(52),tieCards=new Float64Array(52);let total=0,lower=0,j=0;const weights=opp.map((h,i)=>h.prob*reach[i]);for(let k=0;k<opp.length;k++){const w=weights[k];total+=w;for(const c of opp[k].cards)totalCards[c]+=w;}
   let groupRank=null,tie=0,tieEnd=0;
   for(let i=0;i<own.length;i++){
    const h=own[i];if(h.rank!==groupRank){while(j<opp.length&&opp[j].rank<h.rank){const w=weights[j];lower+=w;for(const c of opp[j].cards)lowerCards[c]+=w;j++;}tieCards.fill(0);tie=0;tieEnd=j;while(tieEnd<opp.length&&opp[tieEnd].rank===h.rank){const w=weights[tieEnd];tie+=w;for(const c of opp[tieEnd].cards)tieCards[c]+=w;tieEnd++;}groupRank=h.rank;}
    const [a,b]=h.cards,same=this.lookups[1-player].get(h.key),identical=same===undefined?0:weights[same],lo=Math.max(0,lower-lowerCards[a]-lowerCards[b]),eq=Math.max(0,tie-tieCards[a]-tieCards[b]+identical),all=Math.max(0,total-totalCards[a]-totalCards[b]+identical),hi=Math.max(0,all-lo-eq);out[i]=h.prob/this.normalizer*(lo*u[player]+eq*u[2]+hi*u[1-player]);
   }return out;
  }
  walk(n,r0,r1,update=-1,averageWeight=0){
   if(n.utility){n.v[0]=this.aggregate(0,r1,n.utility[0]);n.v[1]=this.aggregate(1,r0,n.utility[1]);return;}
   const actor=n.actor,A=n.actions.length,H=this.sizes[actor],own=actor===0?r0:r1;n.v[0].fill(0);n.v[1].fill(0);
   for(let a=0;a<A;a++){const reach=n.reaches[a];for(let h=0;h<H;h++)reach[h]=own[h]*n.strategy[h*A+a];const child=n.children[a];this.walk(child,actor===0?reach:r0,actor===1?reach:r1,update,averageWeight);for(let p=0;p<2;p++)for(let h=0;h<this.sizes[p];h++)n.v[p][h]+=child.v[p][h]*(p===actor?n.strategy[h*A+a]:1);}
   if(update===actor)for(let h=0;h<H;h++)for(let a=0;a<A;a++){const k=h*A+a;n.regrets[k]=Math.max(0,n.regrets[k]+n.children[a].v[actor][h]-n.v[actor][h]);}
   if(averageWeight)for(let h=0;h<H;h++)for(let a=0;a<A;a++)n.average[h*A+a]+=averageWeight*own[h]*n.strategy[h*A+a];
  }
  bestResponse(player,n=this.root,opponentReach=this.ones[1-player]){
   if(n.utility)return this.aggregate(player,opponentReach,n.utility[player]);const out=new Float64Array(this.sizes[player]);if(n.actor===player){out.fill(-Infinity);for(const child of n.children){const value=this.bestResponse(player,child,opponentReach);for(let h=0;h<out.length;h++)out[h]=Math.max(out[h],value[h]);}}else for(let a=0;a<n.actions.length;a++){const reach=opponentReach.map((r,h)=>r*n.strategy[h*n.actions.length+a]),value=this.bestResponse(player,n.children[a],reach);for(let h=0;h<out.length;h++)out[h]+=value[h];}return out;
  }
  measure(){this.setStrategy(true);this.walk(this.root,...this.ones);const ev=this.root.v.map(v=>sum(v)),br=[0,1].map(p=>sum(this.bestResponse(p))),gain=br.map((v,p)=>Math.max(0,v-ev[p]));const player=this.data.actor,index=this.heroIndex,A=this.root.actions.length,den=this.aggregate(player,this.ones[1-player],[1,1,1])[index],values=this.root.children.map(n=>n.v[player][index]/den),mixed=values.reduce((s,v,a)=>s+v*this.root.strategy[index*A+a],0);this.diagnostic={ev,bestResponse:br,deviationGain:gain,nashConv:sum(gain),handRegret:Math.max(0,Math.max(...values)-mixed),exploitability:this.constantSum?sum(gain)/2:null,constantSum:this.constantSum};return this.diagnostic;}
  step(){if(this.complete)return;this.setStrategy();this.walk(this.root,...this.ones,0);this.setStrategy();this.walk(this.root,...this.ones,1);this.setStrategy();this.walk(this.root,...this.ones,-1,this.iterations+1);this.iterations++;if(this.iterations%20===0){const d=this.measure();if(d.nashConv<=this.threshold&&d.handRegret<=this.threshold)this.complete=true;}if(this.iterations>=this.options.iterations||clock()-this.started>=this.options.milliseconds)this.complete=true;}
  progress(){return{method:'exact-river',phase:'solving',done:this.iterations,total:this.options.iterations,states:this.nodes.length,gap:this.diagnostic?.nashConv??null,tolerance:this.threshold,seconds:(clock()-this.started)/1000};}
  result(){
   const d=this.measure(),p=this.data.actor,i=this.heroIndex,A=this.root.actions.length,den=this.aggregate(p,this.ones[1-p],[1,1,1])[i];assert(den>0,'Your exact hand has no compatible opposing range.');const mean=this.root.children.map(child=>child.v[p][i]/den),best=mean.indexOf(Math.max(...mean)),reference=Array.from(this.root.strategy.slice(i*A,(i+1)*A)),converged=d.nashConv<=this.threshold&&d.handRegret<=this.threshold;
   return{supported:true,actions:this.actions,reference,mean,se:mean.map(()=>0),loss:mean.map(v=>Math.max(0,mean[best]-v)),lossSE:mean.map(()=>0),best,samples:0,effectiveSamples:0,units:this.rootHand.config.mode==='cash'?'bb':'prize units',referenceTrained:this.iterations>0,referenceVisits:this.iterations,referenceUpdates:this.iterations,coverage:1,evidenceCoverage:1,beliefCoverage:1,actionCoverage:mean.map(()=>1),ignoredPublicActions:0,reliable:converged,solve:{version:VERSION,method:'exact-river',exact:true,iterations:this.iterations,states:this.nodes.length,gap:d.nashConv,handRegret:d.handRegret,tolerance:this.threshold,converged,diagnostics:d,rangeAssumptions:this.ranges.descriptions,actionTree:this.options.abstraction,additionalRootSizes:this.options.rootSizes,historyPreserved:true,privateCardsUsed:'Full player ranges; only the acting player hand selects the displayed row',seconds:(clock()-this.started)/1000,warning:'The measured deviation gap applies to these entered ranges and allowed bet sizes. It does not bound range-assumption error or omitted bet sizes.'}};
  }
 }
 class Solver{
  constructor(model,data,rawOptions={},extra=null){
   this.options=options(rawOptions);this.data={...data,config:G.normalize(data.config),heroCards:data.heroCards.slice(),board:data.board.slice(),actions:data.actions.map(a=>({...a}))};assert(data.actor>=0&&data.actor<data.config.seats,'Invalid acting seat.');
   const unsupported=message=>({complete:true,step(){},progress:()=>({phase:'unsupported',done:0,total:0}),result:()=>({supported:false,message})});
   // Sampled practice blueprints cannot establish opponents' current ranges.
   // Production calculations use explicit ranges, a preceding solved strategy,
   // or prominently identified uniform assumptions, never bot personas.
   this.ranges=new Ranges(this.data,rawOptions.experimental||this.options.approximate?model:null,this.options);
   try{const hand=reconstruct(this.data,this.ranges.draw(G.rng(971),true).holes,G.rng(975)),live=hand.living(),simpleUtility=!this.data.config.rules.low&&!this.data.config.bounties.some(x=>x>0),uniformFolds=hand.folded.every((folded,seat)=>!folded||this.ranges.distributions[seat].uniform),exact=data.config.seats===2&&data.board.length===5&&simpleUtility&&(this.data.config.rules.hole===2||this.ranges.distributions.every(d=>!d.uniform&&d.count<=200));
    if(exact)this.engine=new ExactRiverSolver(this.data,this.ranges,this.options,extra);
    else if(live.length===2&&uniformFolds&&simpleUtility&&data.config.variant==='NLH'&&data.board.length>=3){const postflop=root.PokerExactPostflop||(typeof require==='function'?require('./postflop-exact.js'):null);assert(postflop,'The exact postflop engine is unavailable.');this.engine=new postflop.Engine(this.data,this.ranges,this.options,extra,{reconstruct,actionsAt,terminalValues:ExactRiverSolver.prototype.terminalValues});}
    else if(rawOptions.experimental)this.engine=new SampledSolver(this.data,this.ranges,this.options,extra);
    else{const multiway=root.PokerExactMultiway||(typeof require==='function'?require('./multiway-exact.js'):null);assert(multiway,'The multiplayer exact engine is unavailable.');this.engine=new multiway.Engine(this.data,this.ranges,this.options,extra,{reconstruct,actionsAt,utility});}
   }
   catch(error){if(!/budget|exceed/.test(error.message))throw error;
    // Spots too large for an exact solve get a sampled solve of the same tree,
    // bounded by the effort's time and state budgets and labelled approximate.
    if(this.options.approximate){this.fallback=error.message;this.engine=new SampledSolver(this.data,this.ranges,{...this.options,iterations:500000},extra);}else this.engine=unsupported(error.message);}
  }
  get complete(){return this.engine.complete;}step(){this.engine.step();}progress(){return this.engine.progress();}result(){const r=this.engine.result();if(this.fallback&&r.solve){r.solve.approximate=true;r.solve.fallbackReason=this.fallback;}return r;}conditionRanges(data){return this.engine.conditionRanges?.(data)||null;}policyAt(data){return this.engine.policyAt?.(data)||null;}
 }
 const api={VERSION,Solver,Ranges,ExactRiverSolver,SampledSolver,parseRange,options,reconstruct,publicKey,keyFor,utility,actionsAt};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerSpot=api;
})(typeof globalThis!=='undefined'?globalThis:this);
