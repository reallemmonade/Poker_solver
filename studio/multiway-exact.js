(function(root){
 'use strict';
 const G=root.PokerGame||(typeof require==='function'?(()=>{try{return require('./hand-engine.js')}catch{return require('./game.js')}})():null);
 const sum=a=>a.reduce((s,x)=>s+x,0),clock=()=>typeof performance==='undefined'?Date.now():performance.now(),key=cs=>cs.slice().sort((a,b)=>a-b).join('.');
 function need(ok,message){if(!ok)throw Error(message);}
 function mask(cards){let lo=0,hi=0;for(const c of cards)if(c<32)lo|=1<<c;else hi|=1<<(c-32);return{lo,hi};}

 // Public-tree CFR+ with exact joint private deals. A player's decision row is
 // indexed only by that player's own cards and the complete public path. Best
 // responses maximize after aggregating hidden opponent deals, never per deal.
 // This is a bounded finite-game engine, not a full-range preflop blueprint.
 class Engine{
  constructor(data,ranges,opt,extra,api){
   this.data=data;this.ranges=ranges;this.options=opt;this.extra=extra;this.api=api;this.started=clock();this.iterations=0;this.complete=false;this.nodes=[];this.boards=new Map();this.terminals=new Map();this.bytes=0;this.diagnostic=null;this.scratch=[];
   this.memoryLimit=opt.exactMemoryMB*1024*1024;this.nodeLimit=opt.maxInfos;this.dealLimit=opt.maxJointDeals;this.trials=0;
   this.rootHand=api.reconstruct(data,ranges.draw(G.rng(971),true).holes,G.rng(975));this.seats=this.rootHand.living();this.player=seat=>this.seats.indexOf(seat);this.hero=this.player(data.actor);need(this.hero>=0,'A folded player cannot be the acting seat.');
   this.hands=this.seats.map(seat=>ranges.rows(seat));this.sizes=this.hands.map(h=>h.length);this.lookups=this.hands.map(h=>new Map(h.map((r,i)=>[r.key,i])));this.ones=this.sizes.map(s=>new Float64Array(s).fill(1));this.heroIndex=this.lookups[this.hero].get(key(data.heroCards));need(this.heroIndex!==undefined,'Your hand is excluded from your range.');
   this.variables=[];for(let seat=0;seat<data.config.seats;seat++){const p=this.player(seat);if(p>=0||!ranges.distributions[seat].uniform){const rows=p>=0?this.hands[p]:ranges.rows(seat);this.variables.push({seat,player:p,rows:rows.map(r=>({...r,...mask(r.cards)}))});}}
   this.privateCount=this.variables.length*this.rootHand.rules.hole;this.worlds=[];this.enumerate(0,mask(data.board),1,[],Array(this.seats.length).fill(0));need(this.worlds.length,'These ranges contain no compatible joint deals.');this.normalizer=sum(this.worlds.map(w=>w.weight));for(const w of this.worlds)w.weight/=this.normalizer;
   this.heroMass=this.worlds.reduce((s,w)=>s+(w.indices[this.hero]===this.heroIndex?w.weight:0),0);need(this.heroMass>0,'Your hand has no compatible joint opponent ranges.');
   this.account(sum(this.sizes)*64);this.root=this.build(this.rootHand.clone());this.actions=this.root.actions;need(this.actions?.length,'The root must be an open decision.');this.threshold=data.config.mode==='cash'?Math.max(.0001,G.bb(this.rootHand.pot)*opt.tolerance):Math.max(.000001,sum(data.config.payouts)*opt.tolerance*.01);
  }
  account(bytes=0){
   this.bytes+=bytes;
   need(this.bytes<=this.memoryLimit&&this.nodes.length<this.nodeLimit,'Exact multiplayer calculation exceeds the configured memory or tree-node budget. No approximate strategy was substituted. Use fewer future sizes/raises, narrower current ranges, or export this position for a larger compute budget.');
   need(clock()-this.started<this.options.preparationMilliseconds,'Exact multiplayer tree preparation exceeds the configured time budget. The full private-deal and public-card tree is too large for this request. No sampled recommendation was substituted.');
  }
  enumerate(k,used,weight,chosen,indices){
   if(k===this.variables.length){need(this.worlds.length<this.dealLimit,'Exact private ranges exceed the '+this.dealLimit.toLocaleString()+' joint-deal budget. Narrow the current ranges or use a larger compute budget; additional rollout samples do not remove this requirement.');this.account(120+this.variables.length*32+this.seats.length*8);this.worlds.push({weight,lo:used.lo,hi:used.hi,chosen:chosen.slice(),indices:indices.slice()});return;}
   const v=this.variables[k];for(let i=0;i<v.rows.length;i++){if(++this.trials%2048===0)this.account();need(this.trials<Math.max(2000000,this.dealLimit*100),'Exact joint-deal enumeration exceeds the compatibility-search budget. Use narrower ranges.');const r=v.rows[i];if((r.lo&used.lo)||(r.hi&used.hi))continue;chosen[k]=i;if(v.player>=0)indices[v.player]=i;this.enumerate(k+1,{lo:used.lo|r.lo,hi:used.hi|r.hi},weight*r.prob,chosen,indices);}
  }
  board(cards){
   const id=cards.join('.');if(this.boards.has(id))return this.boards.get(id);this.account(this.worlds.length+100);const bits=mask(cards),valid=Uint8Array.from(this.worlds,w=>(w.lo&bits.lo)||(w.hi&bits.hi)?0:1),info={cards:cards.slice(),valid,mass:0};
   // Root board bits are included in each world's mask. Only newly exposed
   // cards can conflict with private cards; known root cards are shared data.
   const fresh=mask(cards.slice(this.data.board.length));for(let j=0;j<this.worlds.length;j++){const w=this.worlds[j];valid[j]=(w.lo&fresh.lo)||(w.hi&fresh.hi)?0:1;if(valid[j])info.mass+=w.weight;}
   this.boards.set(id,info);return info;
  }
  node(kind,board){this.account(240);const n={kind,board};this.nodes.push(n);return n;}
  build(hand){
   const board=this.board(hand.board),n=this.node(hand.done?'terminal':'decision',board);if(hand.done){n.utility=this.terminalValues(hand,board);return n;}
   n.actor=this.player(hand.actor);need(n.actor>=0,'An excluded seat attempted to act.');n.actions=this.api.actionsAt(hand,this.rootHand,this.options,this.extra);const length=this.sizes[n.actor]*n.actions.length;this.account(length*32);for(const name of ['regrets','average','strategy','actionValues'])n[name]=new Float64Array(length);
   n.children=n.actions.map(action=>{const next=hand.clone(),prior=next.board.slice();next.act(action);return next.board.length>prior.length?this.chance(next,prior,next.board.length):this.build(next);});return n;
  }
  chance(template,prior,targetLength){
   if(prior.length===targetLength){const h=template.clone();h.board=prior.slice();return this.build(h);}
   const n=this.node('chance',this.board(prior));n.children=[];const available=52-prior.length-this.privateCount;need(available>0,'The configured ranges leave no legal public cards.');n.probability=1/available;
   for(let card=0;card<52;card++)if(!prior.includes(card)){const cards=[...prior,card];if(this.board(cards).mass>0)n.children.push(this.chance(template,cards,targetLength));}return n;
  }
  terminalValues(hand,board){
   const base=hand.stacks.map((v,i)=>v-sum(hand.pots.map(p=>p.paid[i]))),id=JSON.stringify([board.cards,hand.folded,hand.total,base,hand.foldWinner]);if(this.terminals.has(id))return this.terminals.get(id);
   this.account(this.seats.length*this.worlds.length*8);const values=this.sizes.map(()=>new Float64Array(this.worlds.length));
   for(let j=0;j<this.worlds.length;j++)if(board.valid[j]){
    if(j%256===0)this.account();const w=this.worlds[j],h=hand.clone();h.stacks=base.slice();h.pots=[];h.done=false;h.bounties=h.config.bounties.slice();h.bountyCash=Array(h.n).fill(0);
    for(let k=0;k<this.variables.length;k++)h.holes[this.variables[k].seat]=this.variables[k].rows[w.chosen[k]].cards.slice();
    h.settle(hand.foldWinner);const utility=this.api.utility(h,this.rootHand);for(let p=0;p<this.seats.length;p++)values[p][j]=utility[this.seats[p]];
   }
   this.terminals.set(id,values);return values;
  }
  setStrategy(average=false){for(const n of this.nodes)if(n.kind==='decision'){const source=average?n.average:n.regrets,A=n.actions.length;for(let h=0;h<this.sizes[n.actor];h++){let total=0;for(let a=0;a<A;a++)total+=Math.max(0,source[h*A+a]);for(let a=0;a<A;a++)n.strategy[h*A+a]=total?Math.max(0,source[h*A+a])/total:1/A;}}}
  aggregate(player,reach,values,board,chance){
   const out=new Float64Array(this.sizes[player]);for(let j=0;j<this.worlds.length;j++)if(board.valid[j]){const w=this.worlds[j];let mass=w.weight*chance;for(let p=0;p<this.seats.length;p++)if(p!==player)mass*=reach[p][w.indices[p]];out[w.indices[player]]+=mass*(values?values[j]:1);}return out;
  }
  buffers(depth){return this.scratch[depth]??={v:this.sizes.map(s=>new Float64Array(s)),reach:this.sizes.map(s=>new Float64Array(s))};}
  walk(n,reach,chance=1,update=-1,averageWeight=0,depth=0){
   const buf=this.buffers(depth),v=buf.v;if(n.utility){for(let p=0;p<this.seats.length;p++)v[p]=this.aggregate(p,reach,n.utility[p],n.board,chance);return v;}for(const a of v)a.fill(0);
   if(n.kind==='chance'){for(const child of n.children){const value=this.walk(child,reach,chance*n.probability,update,averageWeight,depth+1);for(let p=0;p<this.seats.length;p++)for(let h=0;h<this.sizes[p];h++)v[p][h]+=value[p][h];}return v;}
   const p=n.actor,A=n.actions.length,H=this.sizes[p],next=reach.slice(),own=reach[p];next[p]=buf.reach[p];
   for(let a=0;a<A;a++){for(let h=0;h<H;h++)next[p][h]=own[h]*n.strategy[h*A+a];const value=this.walk(n.children[a],next,chance,update,averageWeight,depth+1);for(let h=0;h<H;h++)n.actionValues[h*A+a]=value[p][h];for(let q=0;q<this.seats.length;q++)for(let h=0;h<this.sizes[q];h++)v[q][h]+=value[q][h]*(q===p?n.strategy[h*A+a]:1);}
   if(update===p)for(let h=0;h<H;h++)for(let a=0;a<A;a++){const i=h*A+a;n.regrets[i]=Math.max(0,n.regrets[i]+n.actionValues[i]-v[p][h]);}
   if(averageWeight)for(let h=0;h<H;h++)for(let a=0;a<A;a++)n.average[h*A+a]+=averageWeight*own[h]*n.strategy[h*A+a];return v;
  }
  bestResponse(player,n=this.root,reach=this.ones,chance=1){
   if(n.utility)return this.aggregate(player,reach,n.utility[player],n.board,chance);const out=new Float64Array(this.sizes[player]);
   if(n.kind==='chance'){for(const child of n.children){const v=this.bestResponse(player,child,reach,chance*n.probability);for(let h=0;h<out.length;h++)out[h]+=v[h];}}
   else if(n.actor===player){out.fill(-Infinity);for(const child of n.children){const v=this.bestResponse(player,child,reach,chance);for(let h=0;h<out.length;h++)out[h]=Math.max(out[h],v[h]);}}
   else for(let a=0;a<n.actions.length;a++){const next=reach.slice();next[n.actor]=reach[n.actor].map((r,h)=>r*n.strategy[h*n.actions.length+a]);const v=this.bestResponse(player,n.children[a],next,chance);for(let h=0;h<out.length;h++)out[h]+=v[h];}return out;
  }
  measure(){
   this.setStrategy(true);const ev=this.walk(this.root,this.ones).map(sum),br=this.seats.map((_,p)=>sum(this.bestResponse(p))),gain=br.map((v,p)=>Math.max(0,v-ev[p])),p=this.hero,i=this.heroIndex,A=this.actions.length,values=Array.from({length:A},(_,a)=>this.root.actionValues[i*A+a]/this.heroMass),mixed=sum(values.map((v,a)=>v*this.root.strategy[i*A+a]));
   this.diagnostic={seats:this.seats.slice(),ev,bestResponse:br,deviationGain:gain,nashConv:sum(gain),handRegret:Math.max(0,Math.max(...values)-mixed),exploitability:null};return this.diagnostic;
  }
  step(){if(this.complete)return;for(let p=0;p<this.seats.length;p++){this.setStrategy();this.walk(this.root,this.ones,1,p);}this.setStrategy();this.walk(this.root,this.ones,1,-1,this.iterations+1);this.iterations++;if(this.iterations%20===0){const d=this.measure();if(d.nashConv<=this.threshold&&d.handRegret<=this.threshold)this.complete=true;}if(this.iterations>=this.options.iterations||clock()-this.started>=this.options.milliseconds)this.complete=true;}
  progress(){return{method:'exact-multiway',phase:'solving',done:this.iterations,total:this.options.iterations,states:this.nodes.length,jointDeals:this.worlds.length,gap:this.diagnostic?.nashConv??null,tolerance:this.threshold,seconds:(clock()-this.started)/1000};}
  trace(data){
   if(G.familyId(data.config)!==G.familyId(this.data.config)||data.actions.length<this.data.actions.length||!this.data.actions.every((e,i)=>{const a=data.actions[i];return e.seat===a.seat&&e.street===a.street&&e.kind===a.kind&&e.target===a.target;}))return null;
   let node=this.root;const reaches=this.ones.map(r=>r.slice()),chance=()=>{while(node?.kind==='chance')node=node.children.find(c=>c.board.cards.length<=data.board.length&&c.board.cards.every((card,i)=>card===data.board[i]));return !!node;};
   for(const event of data.actions.slice(this.data.actions.length)){if(!chance()||node.kind!=='decision'||node.actor!==this.player(event.seat))return null;const a=node.actions.findIndex(a=>a.kind===event.kind&&(!['bet','raise'].includes(a.kind)||a.target===event.target));if(a<0)return null;for(let h=0;h<reaches[node.actor].length;h++)reaches[node.actor][h]*=node.strategy[h*node.actions.length+a];node=node.children[a];}
   if(!chance()||node.kind!=='decision'||node.actor!==this.player(data.actor)||node.board.cards.join('.')!==data.board.join('.'))return null;return{node,reaches};
  }
  policyAt(data){const found=this.trace(data),p=this.player(data.actor);if(!found||p<0)return null;const i=this.lookups[p].get(key(data.heroCards));if(i===undefined)return null;const n=found.node,A=n.actions.length;if(!this.aggregate(p,found.reaches,null,n.board,1)[i])return null;return{actions:n.actions.map(a=>({...a})),probs:Array.from(n.strategy.slice(i*A,(i+1)*A))};}
  conditionRanges(data){
   const found=this.trace(data);if(!found)return null;const out=Array(this.data.config.seats).fill('all'),blocked=new Set(data.board);
   for(const variable of this.variables){const p=variable.player,weights=variable.rows.map((r,i)=>r.cards.some(c=>blocked.has(c))?0:r.prob*(p<0?1:found.reaches[p][i])),peak=Math.max(...weights);out[variable.seat]=peak?variable.rows.map((r,i)=>weights[i]>0?r.cards.map(G.Core.cardName).join('')+':'+weights[i]/peak:null).filter(Boolean).join(','):'';}return out;
  }
  result(){
   const d=this.measure(),i=this.heroIndex,A=this.actions.length,mean=Array.from({length:A},(_,a)=>this.root.actionValues[i*A+a]/this.heroMass),best=mean.indexOf(Math.max(...mean)),reference=Array.from(this.root.strategy.slice(i*A,(i+1)*A)),converged=d.nashConv<=this.threshold&&d.handRegret<=this.threshold;
   return{supported:true,actions:this.actions,reference,mean,se:mean.map(()=>0),loss:mean.map(v=>Math.max(0,mean[best]-v)),lossSE:mean.map(()=>0),best,samples:0,effectiveSamples:0,units:this.data.config.mode==='cash'?'bb':'prize units',referenceTrained:this.iterations>0,referenceVisits:this.iterations,referenceUpdates:this.iterations,coverage:1,evidenceCoverage:1,beliefCoverage:1,actionCoverage:mean.map(()=>1),ignoredPublicActions:0,reliable:converged,solve:{version:1,method:'exact-multiway',exact:true,iterations:this.iterations,states:this.nodes.length,jointDeals:this.worlds.length,publicBoards:this.boards.size,memoryBytes:this.bytes,tableSeats:this.data.config.seats,remainingSeats:this.seats.slice(),gap:d.nashConv,handRegret:d.handRegret,tolerance:this.threshold,converged,diagnostics:d,rangeAssumptions:this.ranges.descriptions,actionTree:this.options.abstraction,additionalRootSizes:this.options.rootSizes,historyPreserved:true,privateCardsUsed:'Every compatible joint deal in the specified ranges; only own cards and public history identify decision rows',foldedCardAssumption:'Nonuniform folded ranges are enumerated for card bunching; unspecified folded ranges are uniform and analytically marginalized.',seconds:(clock()-this.started)/1000,warning:'Exact joint private deals and public runouts were enumerated within this finite bet tree. Each remaining player has an independent best-response deviation measurement. Multiplayer CFR+ is not guaranteed to converge; advice requires the measured targets to pass. This does not validate the input ranges, earlier strategy, or omitted bet sizes.'}};
  }
 }
 const api={Engine};root.PokerExactMultiway=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
