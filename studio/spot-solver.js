(function(root){
 'use strict';
 let G=root.PokerGame,T=root.PokerTraining;
 if(!G&&typeof require==='function'){try{G=require('./hand-engine.js');}catch{G=require('./game.js');}}
 if(!T&&typeof require==='function'){try{T=require('./full-hand-trainer.js');}catch{T=require('./trainer.js');}}
 const C=G.Core;
 // REVISION changes whenever solver output for the same spot and options
 // changes, so results saved by an older solver are solved again.
 const VERSION=1,REVISION=2,PRUNE=.03,ALLIN=.67,assert=(v,m)=>{if(!v)throw Error(m)},sum=a=>a.reduce((s,x)=>s+x,0),comboKey=cs=>cs.slice().sort((a,b)=>a-b).join('.');
 const clock=()=>typeof performance==='undefined'?Date.now():performance.now(),fmt=v=>(Math.round(v*100)/100).toString();
 function choose(n,k){let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;}
 // The bridge on the user's computer runs this engine in Node for multiway
 // spots, with time and memory budgets far beyond a browser tab's.
 const NODE=typeof window==='undefined'&&typeof process!=='undefined'&&!!process.versions?.node;
 function options(raw={}){const big=raw.bridge===true&&NODE,cap=(small,large)=>big?large:small,sizes=raw.rootSizes===undefined?[]:raw.rootSizes;assert(Array.isArray(sizes)&&sizes.length<=6&&sizes.every(x=>Number.isFinite(Number(x))&&Number(x)>0),'Enter up to six positive additional bet/raise totals in bb.');const given=raw.abstraction||{},base=T.normalizeAbstraction({...given,betSizes:given.betSizes||[1/3,2/3,1.5],raiseSizes:given.raiseSizes||[1/3,2/3,1.5]}),abstraction=T.normalizeAbstraction({...base,jam:true});return{rangeMode:raw.rangeMode==='uniform'?'uniform':'auto',ranges:Array.isArray(raw.ranges)?raw.ranges.map(String):[],iterations:Math.min(cap(500000,5e6),Math.max(1000,Number(raw.iterations)||50000)),samples:Math.min(10000,Math.max(200,Number(raw.samples)||2000)),milliseconds:Math.min(cap(180000,1.8e6),Math.max(1000,Number(raw.milliseconds)||45000)),maxInfos:Math.min(cap(500000,1e7),Math.max(1000,Number(raw.maxInfos)||150000)),exactMemoryMB:Math.min(cap(4096,65536),Math.max(32,Number(raw.exactMemoryMB)||256)),maxJointDeals:Math.min(cap(500000,5e7),Math.max(100,Number(raw.maxJointDeals)||20000)),approximate:raw.approximate!==false,localSolver:/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(String(raw.localSolver||''))?String(raw.localSolver):'',forceLocal:!!raw.forceLocal,bridgeMilliseconds:Math.min(1.8e6,Math.max(10000,Number(raw.bridgeMilliseconds)||600000)),localAccuracy:Number(raw.localAccuracy)||undefined,preflopEffort:['quick','standard','deep'].includes(raw.preflopEffort)?raw.preflopEffort:undefined,localIterations:Number(raw.localIterations)||undefined,preparationMilliseconds:Math.min(cap(180000,6e5),Math.max(1000,Number(raw.preparationMilliseconds)||15000)),tolerance:Math.min(.05,Math.max(.00001,Number(raw.tolerance)||.001)),rootSizes:sizes.map(Number),abstraction,...raw.actionEVs===true?{actionEVs:true}:{}};}
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
 // Starting hands ordered by all-in equity against two random hands. Used only
 // when no explicit, charted or learned range describes a preflop action, so
 // a raiser or caller is not credited with any two cards.
 const PREFLOP_ORDER=G.preflopOrder,PREFLOP_SPAN=(()=>{const m=new Map();let done=0;for(const c of PREFLOP_ORDER){const n=c.length===2?6:c[2]==='s'?4:12;m.set(c,[done/1326,(done+n)/1326]);done+=n;}return m;})();
 function topShare(cls,p){const [a,b]=PREFLOP_SPAN.get(cls);return Math.min(1,Math.max(0,(p-a)/(b-a)));}
 function heuristicPreflop(config,actions,seat){
  const n=config.seats,bb=n===2?(config.button+1)%n:(config.button+2)%n,open=[.15,.5,.45,.3,.24,.2,.17,.15,.13],steps=[];let raises=0,width=1;
  for(const a of actions){if(a.street!==0)break;
   if(a.kind==='raise'||a.kind==='bet'){const p=raises===0?open[Math.min(8,(bb-a.seat+n)%n)]:raises===1?.05:raises===2?.025:.015;if(a.seat===seat)steps.push({hi:p,lo:0,top:1});raises++;width=p;}
   else if(a.kind==='call'&&a.seat===seat){if(raises===0)steps.push({hi:seat===(n===2?config.button:(config.button+1)%n)?.6:.35,lo:0,top:1});else if(raises===1)steps.push({hi:seat===bb?Math.min(.6,width+.25):Math.max(.06,.8*width),lo:.03,top:.3});else if(raises===2)steps.push({hi:.07,lo:.015,top:.3});else steps.push({hi:.025,lo:0,top:1});}}
  if(!steps.length)return null;return cls=>steps.reduce((w,x)=>w*(topShare(cls,x.hi)-(1-x.top)*topShare(cls,x.lo)),1);
 }
 class Ranges{
  constructor(data,model,opt){
   this.data=data;this.config=G.normalize(data.config);this.rules=this.config.rules;this.hero=data.actor;this.board=data.board.slice();this.heroCards=data.heroCards.slice();this.options=opt;this.descriptions=[];this.distributions=[];
   const boardSet=new Set(this.board),deck=Array.from({length:52},(_,i)=>i).filter(c=>!boardSet.has(c)),all=this.rules.hole===2?G.combinations(deck,2).map(cards=>({cards,key:comboKey(cards),weight:1})):null;
   const count=choose(deck.length,this.rules.hole),prefix=[];if(model&&opt.rangeMode==='auto'&&all){const h=new G.Hand(this.config,{runout:data.board.slice(this.config.boardCards.length),rng:G.rng(917)});for(const a of data.actions){prefix.push({hand:h.clone(),action:a});h.act(a);}}
   for(let seat=0;seat<this.config.seats;seat++){
    const folded=data.actions.some(a=>a.seat===seat&&a.kind==='fold'),text=opt.ranges[seat]||'',explicit=parseRange(text,this.rules,this.board),automatic=!text.trim()||/^auto$/i.test(text.trim());let rows=explicit,used=0,skipped=0,pruned=0;
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
    let heuristic=false;const share=!explicit&&!used&&automatic&&opt.rangeMode==='auto'&&opt.approximate&&all&&this.rules.hole===2&&this.config.variant==='NLH'?heuristicPreflop(this.config,data.actions,seat):null;
    if(share){const actual=seat===this.hero?comboKey(this.heroCards):null;rows=all.map(r=>({...r,cards:r.cards.slice(),weight:r.key===actual?Math.max(.02,share(C.handClass(r.cards))):share(C.handClass(r.cards))})).filter(r=>r.weight>0);heuristic=rows.length>0;}
    let d=distribution(rows,count);if(!explicit&&used===0&&!heuristic)d=distribution(null,count);
    this.distributions.push(d);this.descriptions.push({seat,range:explicit?text:used?'History-conditioned starting range':heuristic?'Estimated preflop range':'All legal hands',combinations:d.count,historyActionsUsed:used,historyActionsOmitted:skipped,pruned,source:explicit?'User-specified current range':heuristic?'Built-in estimate from preflop position and action':used?'Learned history likelihoods with 5% smoothing'+(pruned?'; '+pruned+' rarely played combinations removed':''):folded?'Folded seat; its unknown cards are averaged out':'Broad uniform assumption',implicit:d.uniform,folded});
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
 // Bets an opponent cannot fully match, or that leave less than a third of
 // the effective stack behind, are one all-in action instead of several
 // identical sizes. Extra root sizes that do not fit this decision are skipped.
 function actionsAt(hand,rootHand,opt,extra){
  const a={...opt.abstraction,maxAggressions:(hand.street===rootHand.street?rootHand.aggressions:0)+opt.abstraction.maxAggressions},atRoot=hand.actionLog.length===rootHand.actionLog.length&&hand.board.length===rootHand.board.length,l=hand.legal(),cover=Math.max(0,...hand.living().filter(i=>i!==hand.actor).map(i=>hand.streetPaid[i]+hand.stacks[i])),open=l.canRaise&&cover>hand.currentBet,eff=Math.min(cover,l.allInTo),capTo=Math.max(cover,l.minRaiseTo),jam=!open?null:l.allInTo<=l.maxRaiseTo?l.allInTo:capTo<=l.maxRaiseTo?capTo:null,user=atRoot&&extra&&['bet','raise'].includes(extra.kind)?extra.target:null;
  const sized=t=>({kind:hand.currentBet?'raise':'bet',id:'s'+t,target:t,label:(hand.currentBet?'Raise to ':'Bet ')+G.bb(t)+' bb'+(t===l.allInTo?' · all-in'+(cover<l.allInTo?', effectively '+G.bb(cover)+' bb':''):t>=cover?' · effective all-in':'')}),out=[];
  for(const x of G.modelActions(hand,a)){if(!['bet','raise'].includes(x.kind)){out.push(x);continue;}if(!open)continue;const t=jam!==null&&(x.target>=eff||x.target-l.paid>=ALLIN*(eff-l.paid))?jam:x.target;if(!out.some(y=>y.target===t))out.push({...x,target:t,label:sized(t).label});}
  if(atRoot){
   for(const size of open?opt.rootSizes.map(G.units):[]){const t=size>=eff&&jam!==null?jam:Math.min(size,l.maxRaiseTo);if(t<=hand.currentBet||t<l.minRaiseTo&&t!==l.allInTo||out.some(x=>x.target===t))continue;out.push(sized(t));}
   if(user!==null&&!out.some(x=>x.target===user)){const action=sized(user);try{hand.clone().act(action);}catch{throw Error('The chosen bet size is outside the legal street total.');}const same=user>=eff?out.findIndex(x=>x.target===jam):-1;if(same>=0)out[same]={...out[same],target:user,label:action.label};else out.push(action);}
  }
  return out.sort((a,b)=>Number(['bet','raise'].includes(a.kind))-Number(['bet','raise'].includes(b.kind))||((a.target||0)-(b.target||0)));
 }
 function utility(terminal,rootHand){const values=terminal.utility();if(terminal.config.mode==='cash')return values.map((v,i)=>v+G.bb(rootHand.initial[i]-rootHand.stacks[i]));return values;}
 function keyFor(hand,start){return[hand.actor,comboKey(hand.holes[hand.actor]),hand.board.join('.'),hand.actionLog.slice(start).map(a=>a.seat+':'+a.kind+':'+(a.target||0)).join('/')].join('|');}
 function summaryResult(actions,reference,rows,units,metadata){
  const n=rows.length;assert(n>1,'The solve stopped before it could evaluate the actions.');const mean=actions.map((_,a)=>sum(rows.map(r=>r[a]))/n),best=mean.indexOf(Math.max(...mean)),se=mean.map((m,a)=>Math.sqrt(sum(rows.map(r=>(r[a]-m)**2))/(n*(n-1)))),loss=mean.map(v=>Math.max(0,mean[best]-v)),lossSE=mean.map((m,a)=>{const d=mean[best]-m;return Math.sqrt(sum(rows.map(r=>((r[best]-r[a])-d)**2))/(n*(n-1)));});return{supported:true,actions,reference,mean,se,loss,lossSE,best,samples:n,effectiveSamples:n,units,ignoredPublicActions:0,...metadata};
 }
 // Two tables share the state budget and are trained on independent deal
 // streams: one groups card features, the other keys exact cards and boards.
 // Every evaluation deal is played out with both, so the EVs must agree across
 // two different abstractions, not only two seeds that share the same bias.
 class SampledSolver{
  constructor(data,ranges,opt,extra){this.data=data;this.ranges=ranges;this.options=opt;this.random=G.rng(71329);const deal=ranges.draw(this.random,true);this.root=reconstruct(data,deal.holes,this.random);this.start=this.root.actionLog.length;this.extra=extra;this.actions=actionsAt(this.root,this.root,opt,extra);this.tables=[new T.Table(Math.ceil(opt.maxInfos/2)),new T.Table(Math.floor(opt.maxInfos/2))];this.table=this.tables[0];this.streams=[this.random,G.rng(52711)];this.iterations=0;this.phase='solving';this.evaluations=[];this.runs=[];this.complete=false;this.started=clock();this.evaluationStarted=null;this.lastPolicy=null;this.stability=null;this.covered=0;this.continuations=0;this.branchKnown=this.actions.map(()=>0);this.branchCount=this.actions.map(()=>0);this.halted=null;this.reset=false;this.active=this.root.actors();this.actorVisits=Array(this.root.n).fill(0);}
  key(hand,run=0){
   const cs=hand.holes[hand.actor];if(run)return['X1',hand.actor,comboKey(cs),hand.board.join('.'),hand.actionLog.slice(this.start).map(a=>a.seat+':'+a.kind+':'+(a.target||0)).join('/')].join('|');const actual=hand.actor===this.data.actor&&comboKey(cs)===comboKey(this.data.heroCards),memory=[G.preBucket(cs,hand.rules)],publicMemory=[];
   for(const len of [3,4,5])if(hand.board.length>=len){const board=hand.board.slice(0,len);memory.push(G.postBucket(cs,board,hand.rules));publicMemory.push(G.texture(board));}
   return['M1',hand.actor,actual?'exact:'+comboKey(cs):'features',memory.join('/'),publicMemory.join('/'),hand.actionLog.slice(this.start).map(a=>a.seat+':'+a.kind+':'+(a.target||0)).join('/')].join('|');
  }
  query(hand,table=this.table){const actions=actionsAt(hand,this.root,this.options,this.extra),key=this.key(hand,this.tables.indexOf(table));return{key,actions,...table.policy(key,actions,true)};}
  rootPolicy(){const qs=this.tables.map(t=>this.query(this.root,t));return{qs,probs:qs[0].probs.map((p,i)=>(p+qs[1].probs[i])/2)};}
  trainOne(){
   const run=this.iterations%2,random=this.streams[run],table=this.tables[run],deal=this.ranges.draw(random,false,true),h=reconstruct(this.data,deal.holes,random),updating=this.active[(this.iterations>>1)%this.active.length],self=this,adapter={done:()=>h.done,info:()=>({actor:h.actor,key:self.key(h,run),actions:actionsAt(h,self.root,self.options,self.extra)}),act:a=>h.act(a),utility:p=>utility(h,self.root)[p]},scale=h.config.mode==='cash'?sum(h.config.stacks)+h.config.pot:sum(h.config.payouts)+sum(h.config.bounties);
   try{T.episode(adapter,updating,table,random,this.options.abstraction.exploration,Math.max(1,scale),deal.weight);this.actorVisits[updating]++;this.iterations++;}catch(error){if(!error.capacity)throw error;this.halted=run?'The exact-card cross-check run reached its half of the state budget.':'The spot memory budget was reached.';this.phase='evaluating';}
   if(this.iterations%1000===0){const p=this.rootPolicy().probs;if(this.lastPolicy)this.stability=sum(p.map((v,i)=>Math.abs(v-this.lastPolicy[i])));this.lastPolicy=p.slice();}
  }
  evaluateOne(){
   const deal=this.ranges.draw(this.random,true),h=reconstruct(this.data,deal.holes,this.random),seed=Math.floor(this.random()*4294967296),rows=this.tables.map(()=>[]);
   for(let a=0;a<this.actions.length;a++)this.tables.forEach((table,run)=>{const next=h.clone(),random=G.rng(seed);next.act(this.actions[a]);let guard=0;while(!next.done&&guard++<300){const q=this.query(next,table);this.continuations++;this.branchCount[a]++;if(q.updates>0){this.covered++;this.branchKnown[a]++;}next.act(q.actions[G.pick(q.probs,random)]);}assert(next.done,'A continuation exceeded its action budget.');rows[run].push(utility(next,this.root)[this.data.actor]);});
   this.runs.push(rows);this.evaluations.push(rows[0].map((v,a)=>(v+rows[1][a])/2));
  }
  // The evaluation phase has its own time bound, so an effort's stated
  // budget is not exceeded by slow continuation play-outs. Halfway through
  // training the averages are scaled down, so the reported strategy is not
  // dragged toward the near-uniform play of the first iterations.
  step(){if(this.complete)return;if(this.phase==='solving'){if(!this.reset&&(clock()-this.started>=this.options.milliseconds/2||this.iterations>=this.options.iterations/2)){this.reset=true;for(const t of this.tables)for(const e of t.entries.values())for(let i=0;i<e.average.length;i++)e.average[i]*=1e-3;}this.trainOne();if(this.iterations>=this.options.iterations||clock()-this.started>=this.options.milliseconds){this.phase='evaluating';}}else{this.evaluationStarted??=clock();this.evaluateOne();if(this.evaluations.length>=this.options.samples||this.evaluations.length>=200&&clock()-this.evaluationStarted>=Math.max(1000,this.options.milliseconds/4))this.complete=true;}}
  progress(){return{method:'sampled-subgame',phase:this.phase,done:this.phase==='solving'?this.iterations:this.evaluations.length,total:this.phase==='solving'?this.options.iterations:this.options.samples,states:this.tables[0].entries.size+this.tables[1].entries.size,seconds:(clock()-this.started)/1000};}
  // Accuracy checks beyond coverage: the two runs must agree on every action's
  // EV, no action may score below what simply folding later guarantees (or
  // above everything that can be won), which only an unsound continuation can
  // do, and the trained mix may not favour actions its own EVs show are worse.
  accuracy(r){
   const h=this.root,n=this.runs.length,cash=h.config.mode==='cash',pot=G.bb(h.pot),l=h.legal(),split=[0,1].map(run=>this.actions.map((_,a)=>sum(this.runs.map(x=>x[run][a]))/n)),spread=this.actions.map((_,a)=>split[0][a]-split[1][a]),spreadSE=this.actions.map((_,a)=>Math.sqrt(sum(this.runs.map(x=>(x[0][a]-x[1][a]-spread[a])**2))/(n*(n-1)))),tolerance=cash?Math.max(.25,.1*pot):.02*sum(h.config.payouts);
   const floors=this.actions.map(a=>!cash?null:a.kind==='call'?-G.bb(l.callCost):['bet','raise'].includes(a.kind)?-G.bb(a.target-l.paid):0),ceiling=cash?pot+sum(h.living().filter(i=>i!==h.actor).map(i=>G.bb(Math.min(h.stacks[i],h.stacks[h.actor])))):null,margin=cash?.01*pot:0;
   const below=this.actions.filter((_,a)=>floors[a]!==null&&r.mean[a]+3*r.se[a]<floors[a]-margin),above=this.actions.filter((_,a)=>ceiling!==null&&r.mean[a]-3*r.se[a]>ceiling+margin),unstable=this.actions.filter((_,a)=>Math.abs(spread[a])>tolerance+3*spreadSE[a]),qs=this.rootPolicy().qs,policyL1=sum(qs[0].probs.map((p,i)=>Math.abs(p-qs[1].probs[i]))),u=r.units,regret=sum(this.actions.map((_,a)=>r.reference[a]*Math.max(0,r.loss[a]-2*r.lossSE[a])));
   const reasons=[...below.map(a=>a.label+' scores '+fmt(r.mean[this.actions.indexOf(a)])+' '+u+', below the '+fmt(floors[this.actions.indexOf(a)])+' '+u+' that folding later guarantees'),...above.map(a=>a.label+' scores '+fmt(r.mean[this.actions.indexOf(a)])+' '+u+', more than the '+fmt(ceiling)+' '+u+' that can be won'),...unstable.length?['the grouped-feature and exact-card training runs value '+unstable.map(a=>a.label).join(', ')+' up to '+fmt(Math.max(...unstable.map(a=>Math.abs(spread[this.actions.indexOf(a)]))))+' '+u+' apart']:[],...regret>tolerance/2?['the trained strategy for your hand still plays actions that score clearly below the best one, losing '+fmt(regret)+' '+u+' on average']:[]];
   return{passed:!reasons.length,handRegret:regret,reason:reasons.slice(0,2).join('; ')+(reasons.length>2?'; and '+(reasons.length-2)+' more':''),spread,spreadSE,spreadTolerance:tolerance,policyL1,floors,ceiling,belowFloor:below.map(a=>a.label),aboveCeiling:above.map(a=>a.label),unstable:unstable.map(a=>a.label)};
  }
  result(){
   const {qs,probs}=this.rootPolicy(),q=qs[0],coverage=this.continuations?this.covered/this.continuations:1,r=summaryResult(this.actions,probs,this.evaluations,this.root.config.mode==='cash'?'bb':'prize units',{referenceTrained:qs.every(x=>x.updates>0),referenceVisits:q.visits+qs[1].visits,referenceUpdates:q.updates+qs[1].updates,coverage,evidenceCoverage:coverage,beliefCoverage:1,actionCoverage:this.branchCount.map((n,i)=>n?this.branchKnown[i]/n:1),continuationDecisions:this.continuations,reliable:false,solve:{version:VERSION,method:'sampled-subgame',exact:false,iterations:this.iterations,states:this.tables[0].entries.size+this.tables[1].entries.size,rootUpdates:q.updates+qs[1].updates,stabilityL1:this.stability,gap:null,tolerance:null,converged:false,rangeAssumptions:this.ranges.descriptions,actionTree:this.options.abstraction,additionalRootSizes:this.options.rootSizes,historyPreserved:true,privateCardsUsed:'Acting player only; opponents and future cards resampled',halted:this.halted,seconds:(clock()-this.started)/1000,observationAbstraction:'Exact acting-player hand; one run groups opponent card features and future board textures with observation memory, the other uses exact cards and boards, and the shown values average both',warning:'This sampled continuation solution has no measured equilibrium gap. Frequencies and EVs are provisional and conditional on the displayed ranges and finite bet tree.'}});
   // The displayed spread covers evaluation noise and the difference between
   // the two training runs; neither measures the grouped-feature bias.
   const check=this.accuracy(r),lossSpread=this.actions.map((_,a)=>check.spread[r.best]-check.spread[a]);r.sampleSE=r.se;r.se=r.se.map((e,a)=>Math.sqrt(e*e+check.spread[a]**2/4));r.lossSE=r.lossSE.map((e,a)=>Math.sqrt(e*e+lossSpread[a]**2/4));r.solve.accuracy=check;return r;
  }
 }
 // An exact, range-wide CFR+ river solver. NLH leaf values use sorted rank
 // sweeps and card-blocker subtraction instead of enumerating a million pairs
 // at every leaf. Other variants use explicitly enumerated compatible pairs.
 // The current hand's own mixing regret is not weighted by how rarely that
 // hand is dealt, so its target is five times the range-wide gap target.
 class ExactRiverSolver{
  constructor(data,ranges,opt,extra){
   assert(data.config.seats===2&&data.board.length===5&&!data.config.rules?.low&&!data.config.bounties.some(x=>x>0),'The exact path requires two players on the river without split-low or bounty utility.');
   this.data=data;this.ranges=ranges;this.options=opt;this.random=G.rng(971);this.rootHand=reconstruct(data,ranges.draw(this.random,true).holes,this.random);this.extra=extra;this.started=clock();this.iterations=0;this.complete=false;this.phase='solving';this.nodes=[];this.leaves=[];this.exact=true;
   this.hands=[0,1].map(seat=>ranges.rows(seat).map(h=>({...h,rank:G.evaluate(h.cards,data.board,this.rootHand.rules).high})).sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key)));this.sizes=this.hands.map(a=>a.length);this.fast=this.rootHand.rules.hole===2;this.lookups=this.hands.map(h=>new Map(h.map((x,i)=>[x.key,i])));this.ones=this.hands.map(h=>new Float64Array(h.length).fill(1));
   this.normalizer=0;this.pairs=null;
   if(this.fast){const weights=this.hands[1].map(h=>h.prob),cards=new Float64Array(52);for(let j=0;j<weights.length;j++)for(const c of this.hands[1][j].cards)cards[c]+=weights[j];for(const h of this.hands[0]){const j=this.lookups[1].get(h.key);this.normalizer+=h.prob*(1-cards[h.cards[0]]-cards[h.cards[1]]+(j===undefined?0:weights[j]));}}
   else{const pairs=[];assert(this.sizes[0]*this.sizes[1]<=150000,'These exact Omaha ranges exceed the local exact-tree budget.');for(let i=0;i<this.sizes[0];i++)for(let j=0;j<this.sizes[1];j++){const a=this.hands[0][i],b=this.hands[1][j];if(a.cards.some(c=>b.cards.includes(c)))continue;const w=a.prob*b.prob;this.normalizer+=w;pairs.push({i,j,w,o:a.rank>b.rank?0:a.rank<b.rank?1:2});}this.pairs=pairs;}
   assert(this.normalizer>0,'The two player ranges have no compatible deals.');this.root=this.build(this.rootHand.clone());this.actions=this.root.actions;this.heroIndex=this.lookups[data.actor].get(comboKey(data.heroCards));assert(this.heroIndex!==undefined,'Your exact hand is excluded from your range.');
   const utilityTotals=this.leaves.flatMap(n=>[0,1,2].map(o=>n.utility[0][o]+n.utility[1][o]));this.constantSum=Math.max(...utilityTotals)-Math.min(...utilityTotals)<1e-8;this.threshold=data.config.mode==='cash'?Math.max(.0001,G.bb(this.rootHand.pot)*opt.tolerance):Math.max(.000001,sum(data.config.payouts)*opt.tolerance*.01);this.handThreshold=5*this.threshold;this.diagnostic=null;
  }
  terminalValues(hand){
   const live=this.seats||this.rootHand.living(),n=hand.n,base=hand.stacks.map((stack,i)=>stack-sum(hand.pots.map(p=>p.paid[i]))),before=[...hand.initial.map(v=>G.bb(v)+hand.config.pot/n),...hand.config.otherStacks],baseline=hand.config.mode==='icm'?G.terminalICM(before,before,hand.config.payouts):null;
   return[0,1,2].map(outcome=>{const stacks=base.slice();for(const pot of hand.pots){const winners=hand.foldWinner!==null?[hand.foldWinner]:pot.eligible.length===1?pot.eligible:outcome===2?pot.eligible:[live[outcome]];const each=Math.floor(pot.net/winners.length),order=winners.slice().sort((a,b)=>((a-hand.button-1+n)%n)-((b-hand.button-1+n)%n));for(let i=0;i<order.length;i++)stacks[order[i]]+=each+(i<pot.net-each*order.length?1:0);}if(hand.config.mode==='cash')return stacks.map((v,i)=>G.bb(v-this.rootHand.stacks[i]));const equity=G.terminalICM([...stacks.map(G.bb),...hand.config.otherStacks],before,hand.config.payouts);return stacks.map((_,i)=>equity[i]-baseline[i]);});
  }
  // Flat per-hand arrays for the sweeps below: both cards, range weight, the
  // same combination's index in the other range, and where the other range's
  // weaker and tied hands end (both ranges are sorted by showdown rank).
  prepare(){
   if(this.flat)return;const f=this.flat={card:[],prob:[],same:[],below:[],upto:[]};
   for(let p=0;p<2;p++){const own=this.hands[p],opp=this.hands[1-p],H=own.length,a=new Uint8Array(2*H),prob=new Float64Array(H),same=new Int32Array(H),below=new Int32Array(H),upto=new Int32Array(H);let lo=0,hi=0;
    for(let i=0;i<H;i++){const h=own[i];a[2*i]=h.cards[0];a[2*i+1]=h.cards[1]??0;prob[i]=h.prob;const j=this.lookups[1-p].get(h.key);same[i]=j===undefined?-1:j;while(lo<opp.length&&opp[lo].rank<h.rank)lo++;if(hi<lo)hi=lo;while(hi<opp.length&&opp[hi].rank<=h.rank)hi++;below[i]=lo;upto[i]=hi;}
    f.card.push(a);f.prob.push(prob);f.same.push(same);f.below.push(below);f.upto.push(upto);}
   f.weights=this.sizes.map(s=>new Float64Array(s));f.cards=new Float64Array(52);f.side=new Float64Array(52);
  }
  build(hand){
   this.prepare();assert(this.nodes.length<2000,'The selected river bet tree exceeds the local tree budget.');const n={hand,actor:hand.actor,v:this.sizes.map(s=>new Float64Array(s))};this.nodes.push(n);if(hand.done){const values=this.terminalValues(hand);n.utility=[0,1].map(i=>values.map(v=>v[i]));n.fold=values[0].every((v,i)=>v===values[1][i]&&v===values[2][i]);this.leaves.push(n);return n;}
   n.actions=actionsAt(hand,this.rootHand,this.options,this.extra);n.children=n.actions.map(a=>{const h=hand.clone();h.act(a);return this.build(h);});const len=this.sizes[n.actor]*n.actions.length;n.regrets=new Float64Array(len);n.average=new Float64Array(len);n.strategy=new Float64Array(len);n.reaches=n.actions.map(()=>new Float64Array(this.sizes[n.actor]));return n;
  }
  setStrategy(average=false){const floor=2e-9*(this.averageMass||1);for(const n of this.nodes){if(n.utility)continue;const A=n.actions.length;for(let h=0;h<this.sizes[n.actor];h++){let source=average?n.average:n.regrets,total=0;for(let a=0;a<A;a++)total+=Math.max(0,source[h*A+a]);if(average&&total<=floor){source=n.regrets;total=0;for(let a=0;a<A;a++)total+=Math.max(0,source[h*A+a]);}for(let a=0;a<A;a++)n.strategy[h*A+a]=total?Math.max(0,source[h*A+a])/total:1/A;}}}
  // Values of the player's hands at a terminal against the opponent's reach,
  // with card removal. Showdowns sweep once up and once down the rank order.
  aggregate(player,reach,u,out=new Float64Array(this.sizes[player])){
   if(!this.fast){out.fill(0);for(const pair of this.pairs){const i=player===0?pair.i:pair.j,j=player===0?pair.j:pair.i;out[i]+=pair.w/this.normalizer*reach[j]*u[pair.o];}return out;}
   const f=this.flat,opp=1-player,oc=f.card[opp],w=f.weights[opp],op=f.prob[opp],O=w.length,mc=f.card[player],mp=f.prob[player],same=f.same[player],H=out.length,cards=f.cards,side=f.side,scale=1/this.normalizer;
   cards.fill(0);let total=0;for(let k=0;k<O;k++){const x=w[k]=op[k]*reach[k];total+=x;cards[oc[2*k]]+=x;cards[oc[2*k+1]]+=x;}
   const fold=u[0]===u[1]&&u[1]===u[2];
   for(let i=0;i<H;i++){const s=same[i],all=total-cards[mc[2*i]]-cards[mc[2*i+1]]+(s>=0?w[s]:0);out[i]=mp[i]*scale*Math.max(0,all);}
   if(fold){const v=u[0];for(let i=0;i<H;i++)out[i]*=v;return out;}
   // out holds each hand's compatible opposing mass; split it into wins, ties and losses.
   const win=u[player],lose=u[opp],tie=u[2],below=f.below[player],upto=f.upto[player];
   side.fill(0);let lower=0,k=0;
   for(let i=0;i<H;i++){const end=below[i];while(k<end){const x=w[k];lower+=x;side[oc[2*k]]+=x;side[oc[2*k+1]]+=x;k++;}const lo=Math.max(0,lower-side[mc[2*i]]-side[mc[2*i+1]])*mp[i]*scale;out[i]=out[i]*tie+lo*(win-tie);}
   side.fill(0);let higher=0;k=O-1;
   for(let i=H-1;i>=0;i--){const start=upto[i];while(k>=start){const x=w[k];higher+=x;side[oc[2*k]]+=x;side[oc[2*k+1]]+=x;k--;}const hi=Math.max(0,higher-side[mc[2*i]]-side[mc[2*i+1]])*mp[i]*scale;out[i]+=hi*(lose-tie);}
   return out;
  }
  // One traversal for one player: its counterfactual values at every node
  // (written to node.v[player]) against the opponent's current reach. With
  // update, it also updates that player's regrets and average strategy.
  traverse(p,n,mine,theirs,update=false,weight=0){
   const v=n.v[p];if(n.utility)return this.aggregate(p,theirs,n.utility[p],v);
   const A=n.actions.length,H=this.sizes[n.actor],s=n.strategy;
   if(n.actor!==p){v.fill(0);for(let a=0;a<A;a++){const r=n.reaches[a];for(let h=0;h<H;h++)r[h]=theirs[h]*s[h*A+a];const c=this.traverse(p,n.children[a],mine,r,update,weight);for(let h=0;h<v.length;h++)v[h]+=c[h];}return v;}
   v.fill(0);for(let a=0;a<A;a++){const r=n.reaches[a];for(let h=0;h<H;h++)r[h]=mine[h]*s[h*A+a];const c=this.traverse(p,n.children[a],r,theirs,update,weight);for(let h=0;h<H;h++)v[h]+=c[h]*s[h*A+a];}
   if(update){const g=n.regrets,avg=n.average;for(let a=0;a<A;a++){const c=n.children[a].v[p];for(let h=0;h<H;h++){const k=h*A+a;g[k]+=c[h]-v[h];avg[k]+=weight*mine[h]*s[k];}}}
   return v;
  }
  bestResponse(player,n=this.root,opponentReach=this.ones[1-player]){
   if(n.utility)return this.aggregate(player,opponentReach,n.utility[player]);const out=new Float64Array(this.sizes[player]);if(n.actor===player){out.fill(-Infinity);for(const child of n.children){const value=this.bestResponse(player,child,opponentReach);for(let h=0;h<out.length;h++)out[h]=Math.max(out[h],value[h]);}}else for(let a=0;a<n.actions.length;a++){const reach=opponentReach.map((r,h)=>r*n.strategy[h*n.actions.length+a]),value=this.bestResponse(player,n.children[a],reach);for(let h=0;h<out.length;h++)out[h]+=value[h];}return out;
  }
  measure(){this.setStrategy(true);const ev=[0,1].map(p=>sum(this.traverse(p,this.root,this.ones[p],this.ones[1-p]))),br=[0,1].map(p=>sum(this.bestResponse(p))),gain=br.map((v,p)=>Math.max(0,v-ev[p]));const player=this.data.actor,index=this.heroIndex,A=this.root.actions.length;this.traverse(player,this.root,this.ones[player],this.ones[1-player]);const den=this.aggregate(player,this.ones[1-player],[1,1,1])[index],values=this.root.children.map(n=>n.v[player][index]/den),mixed=values.reduce((s,v,a)=>s+v*this.root.strategy[index*A+a],0);this.diagnostic={ev,bestResponse:br,deviationGain:gain,nashConv:sum(gain),handRegret:Math.max(0,Math.max(...values)-mixed),exploitability:this.constantSum?sum(gain)/2:null,constantSum:this.constantSum};return this.diagnostic;}
  // Discounted CFR (alpha 1.5, beta 0, gamma 2) with alternating updates: positive regrets keep t^1.5/(t^1.5+1) of
  // their size each iteration, negative ones half, and the average weights iteration t by about t^2. It reaches the
  // gap in about half of CFR+'s iterations, and a line nobody in your range takes is answered the way the opponent
  // would answer your whole range taking it (CFR+ left the opponent punishing the one hand shown).
  step(){if(this.complete)return;const t=this.iterations+1,ta=Math.pow(t-1,1.5),pos=ta/(ta+1),gamma=Math.pow((t-1)/t,2);
   for(const n of this.nodes)if(!n.utility){const g=n.regrets,avg=n.average;for(let k=0;k<g.length;k++){g[k]*=g[k]>0?pos:.5;avg[k]*=gamma;}}this.averageMass=(this.averageMass||0)*gamma+1;
   for(let p=0;p<2;p++){this.setStrategy();this.traverse(p,this.root,this.ones[p],this.ones[1-p],true,1);}
   this.iterations++;
   // The gap check costs about two iterations, so it runs every 10 iterations at first and every eighth of the
   // iterations so far later on (the solve overshoots its target by at most that eighth).
   if(this.iterations>=(this.nextCheck||10)){this.nextCheck=this.iterations+Math.max(10,Math.round(this.iterations/8));const d=this.measure();if(d.nashConv<=this.threshold&&d.handRegret<=this.handThreshold)this.complete=true;}if(this.iterations>=this.options.iterations||clock()-this.started>=this.options.milliseconds)this.complete=true;}
  progress(){return{method:'exact-river',phase:'solving',done:this.iterations,total:this.options.iterations,states:this.nodes.length,gap:this.diagnostic?.nashConv??null,tolerance:this.threshold,seconds:(clock()-this.started)/1000};}
  // Each root action is valued with your best continuation against the solved
  // opponents, so a line your range never takes is not valued with untrained play.
  result(){
   const d=this.measure(),p=this.data.actor,i=this.heroIndex,A=this.root.actions.length,den=this.aggregate(p,this.ones[1-p],[1,1,1])[i];assert(den>0,'Your exact hand has no compatible opposing range.');const mean=this.root.children.map(child=>this.bestResponse(p,child,this.ones[1-p])[i]/den),best=mean.indexOf(Math.max(...mean)),reference=Array.from(this.root.strategy.slice(i*A,(i+1)*A)),converged=d.nashConv<=this.threshold&&d.handRegret<=this.handThreshold;
   return{supported:true,actions:this.actions,reference,mean,se:mean.map(()=>0),loss:mean.map(v=>Math.max(0,mean[best]-v)),lossSE:mean.map(()=>0),best,samples:0,effectiveSamples:0,units:this.rootHand.config.mode==='cash'?'bb':'prize units',referenceTrained:this.iterations>0,referenceVisits:this.iterations,referenceUpdates:this.iterations,coverage:1,evidenceCoverage:1,beliefCoverage:1,actionCoverage:mean.map(()=>1),ignoredPublicActions:0,reliable:converged,solve:{version:VERSION,method:'exact-river',exact:true,iterations:this.iterations,states:this.nodes.length,gap:d.nashConv,handRegret:d.handRegret,tolerance:this.threshold,handTolerance:this.handThreshold,converged,diagnostics:d,rangeAssumptions:this.ranges.descriptions,actionTree:this.options.abstraction,additionalRootSizes:this.options.rootSizes,historyPreserved:true,privateCardsUsed:'Full player ranges; only the acting player hand selects the displayed row',seconds:(clock()-this.started)/1000,warning:'The measured deviation gap applies to these entered ranges and allowed bet sizes. It does not bound range-assumption error or omitted bet sizes.'}};
  }
 }
 // The river from its first action with only the two live seats: seat 0 out of position, seat 1 on the button,
 // everything already in the pot as dead money, and each seat's range read from the full table's ranges.
 function headsUpRiver(data,hand,ranges){
  const n=hand.n,after=i=>(i-hand.button+n)%n||n,seats=hand.living().slice().sort((a,b)=>after(a)-after(b)),map=new Map(seats.map((s,i)=>[s,i]));
  if(seats.length!==2||!data.actions.every(a=>a.street===3?map.has(a.seat):true)||seats.some(s=>!(hand.stacks[s]+hand.streetPaid[s]>0)))return null;
  const paid=hand.streetPaid.reduce((x,y)=>x+y,0),config=G.normalize({...data.config,seats:2,button:1,stacks:seats.map(s=>G.bb(hand.stacks[s]+hand.streetPaid[s])),startStreet:3,board:data.board.map(C.cardName).join(''),pot:G.bb(hand.pot-paid),ante:0,otherStacks:[],bounties:[]});
  const reduced={...data,config,actor:map.get(data.actor),actions:data.actions.filter(a=>a.street===3).map(a=>({...a,seat:map.get(a.seat)}))};
  const view={descriptions:ranges.descriptions,distributions:seats.map(s=>ranges.distributions[s]),rows:seat=>ranges.rows(seats[seat]),draw:(...args)=>{const d=ranges.draw(...args);return{...d,holes:seats.map(s=>d.holes[s])};}};
  return{data:reduced,ranges:view};
 }
 class Solver{
  constructor(model,data,rawOptions={},extra=null){
   this.options=options(rawOptions);this.data={...data,config:G.normalize(data.config),heroCards:data.heroCards.slice(),board:data.board.slice(),actions:data.actions.map(a=>({...a}))};assert(data.actor>=0&&data.actor<data.config.seats,'Invalid acting seat.');
   const unsupported=message=>({complete:true,step(){},progress:()=>({phase:'unsupported',done:0,total:0}),result:()=>({supported:false,message})});
   // Sampled practice blueprints cannot establish opponents' current ranges.
   // Production calculations use explicit ranges, a preceding solved strategy,
   // or prominently identified uniform assumptions, never bot personas.
   // A preflop line no chart covers goes to the preflop spot solver on the Mac (tools/preflop/spot.cjs).
   const LocalSolver=root.PokerLocalSolver||(typeof require==='function'?require('./local-solver.js'):null);
   if(!this.data.board.length&&this.options.forceLocal&&this.options.localSolver&&LocalSolver?.PreflopEngine){this.engine=new LocalSolver.PreflopEngine(this.data,this.options);return;}
   this.ranges=new Ranges(this.data,rawOptions.experimental||this.options.approximate?model:null,this.options);
   try{const hand=reconstruct(this.data,this.ranges.draw(G.rng(971),true).holes,G.rng(975)),live=hand.living(),simpleUtility=!this.data.config.rules.low&&!this.data.config.bounties.some(x=>x>0),uniformFolds=hand.folded.every((folded,seat)=>!folded||this.ranges.distributions[seat].uniform),exact=data.config.seats===2&&data.board.length===5&&simpleUtility&&(this.data.config.rules.hole===2||this.ranges.distributions.every(d=>!d.uniform&&d.count<=300));
    // Two players left in a PLO pot (folded seats' cards ignored) with explicit ranges
    // go to the PLO solver on this computer when it is turned on.
    const Local=root.PokerLocalSolver||(typeof require==='function'?require('./local-solver.js'):null),ploLocal=!exact&&this.options.localSolver&&Local&&this.data.config.variant==='PLO4'&&live.length===2&&data.board.length>=3&&simpleUtility&&live.every(seat=>!this.ranges.distributions[seat].uniform);let local=null;
    if(ploLocal){try{local=new Local.Engine(this.data,this.ranges,this.options,hand);}catch{}}
    // A full solve (effort Full) sends any heads-up spot from the flop on to TexasSolver on this computer,
    // and a three-way NLH pot to the 3-way solver there.
    if(!local&&this.options.forceLocal&&this.options.localSolver&&Local&&(live.length===2||live.length===3&&this.data.config.variant==='NLH')&&data.board.length>=3&&simpleUtility){try{local=new Local.Engine(this.data,this.ranges,this.options,hand);}catch{}}
    // Three or more players from the flop on: the browser's engines rarely fit
    // these ranges, so they go to the bridge, which runs the same engines in Node.
    if(!local&&this.options.forceLocal&&this.options.localSolver&&Local?.SpotEngine&&live.length>2&&data.board.length>=3){try{local=new Local.SpotEngine(this.data,this.ranges,this.options,extra);}catch{}}
    // Two players left on a hold'em river at a bigger table: the folded seats only left chips in the pot, so the
    // spot is the same heads-up river with that money as dead pot, and the fast river engine solves it.
    const folded=!exact&&!ploLocal&&live.length===2&&data.board.length===5&&simpleUtility&&this.data.config.mode==='cash'&&this.data.config.rules.hole===2?headsUpRiver(this.data,hand,this.ranges):null;
    if(exact)this.engine=new ExactRiverSolver(this.data,this.ranges,this.options,extra);
    else if(folded)this.engine=new ExactRiverSolver(folded.data,folded.ranges,this.options,extra);
    else if(local)this.engine=local;
    else if(live.length===2&&uniformFolds&&simpleUtility&&data.config.variant==='NLH'&&data.board.length>=3){const postflop=root.PokerExactPostflop||(typeof require==='function'?require('./postflop-exact.js'):null);assert(postflop,'The exact postflop engine is unavailable.');this.engine=new postflop.Engine(this.data,this.ranges,this.options,extra,{reconstruct,actionsAt,terminalValues:ExactRiverSolver.prototype.terminalValues});}
    else if(rawOptions.experimental)this.engine=new SampledSolver(this.data,this.ranges,this.options,extra);
    else{const multiway=root.PokerExactMultiway||(typeof require==='function'?require('./multiway-exact.js'):null);assert(multiway,'The multiplayer exact engine is unavailable.');this.engine=new multiway.Engine(this.data,this.ranges,this.options,extra,{reconstruct,actionsAt,utility});}
   }
   catch(error){if(!/budget|exceed/.test(error.message))throw error;
    // Heads-up spots too large to solve exactly here can go to TexasSolver on
    // this computer when the user has turned that on.
    const Local=root.PokerLocalSolver||(typeof require==='function'?require('./local-solver.js'):null);
    if(this.options.localSolver&&Local){try{this.engine=new Local.Engine(this.data,this.ranges,this.options,reconstruct(this.data,this.ranges.draw(G.rng(971),true).holes,G.rng(975)));this.local=error.message;return;}catch{}}
    // Spots too large for an exact solve get a sampled solve of the same tree,
    // bounded by the effort's time and state budgets and labelled approximate.
    if(this.options.approximate){this.fallback=error.message;this.engine=new SampledSolver(this.data,this.ranges,{...this.options,iterations:Math.max(500000,this.options.iterations)},extra);}else this.engine=unsupported(error.message);}
  }
  get complete(){return this.engine.complete;}get waiting(){return !!this.engine.waiting;}cancel(){this.engine.cancel?.();}step(){this.engine.step();}progress(){return this.engine.progress();}result(){
   const r=this.engine.result();if(r.solve)r.solve.revision=REVISION;if(!this.fallback||!r.solve)return r;const reason=this.fallback.replace(/\s*No (?:sampled|approximate) (?:strategy|recommendation) (?:has been|was) substituted\./g,'').trim();r.solve.approximate=true;r.solve.fallbackReason=reason;
   // Untrained continuation decisions play uniformly at random, which makes
   // large bets look hugely profitable. Coverage alone does not show the
   // estimate is accurate, so it must also pass the sampled accuracy checks.
   const coverage=r.coverage,weakest=Math.min(...r.actionCoverage),trained=!r.solve.halted&&coverage>=.9&&weakest>=.85,check=r.solve.accuracy;if(trained&&check?.passed!==false)return r;
   return{supported:false,approximateWithheld:true,accuracy:check||null,message:'No reliable approximation for this spot. '+reason.replace(/\.?$/,'.')+' The sampled fallback '+[trained?null:'did not settle: only '+Math.round(100*coverage)+'% of later decisions were trained'+(r.solve.halted?' before it reached its memory budget':'')+', and untrained decisions play at random',check?.passed===false?'failed its accuracy check: '+check.reason:null].filter(Boolean).join(', and it ')+'. Its frequencies and EVs would be misleading, so they are not shown. Use fewer bet sizes or raises, narrower ranges under "Solver assumptions and accuracy", fewer players or shallower stacks'+(this.data.board.length?'':', or import a preflop chart under Library → Preflop solver references')+'.'};
  }conditionRanges(data){return this.engine.conditionRanges?.(data)||null;}policyAt(data){return this.engine.policyAt?.(data)||null;}
 }
 const api={VERSION,REVISION,Solver,Ranges,ExactRiverSolver,SampledSolver,parseRange,options,reconstruct,publicKey,keyFor,utility,actionsAt,heuristicPreflop};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerSpot=api;
})(typeof globalThis!=='undefined'?globalThis:this);
