(function(root){
 'use strict';
 // Heads-up postflop solves on the user's own computer through the TexasSolver
 // bridge in tools/local-solver. The bridge rebuilds the solver input from the
 // validated spec below, so a web page can never pass raw solver commands.
 let G=root.PokerGame;
 if(!G&&typeof require==='function'){try{G=require('./hand-engine.js');}catch{G=require('./game.js');}}
 const C=G&&G.Core,STREETS=['flop','turn','river'],assert=(v,m)=>{if(!v)throw Error(m)};
 const CARD=/^[2-9TJQKA][cdhs]$/,COMBO=/^([2-9TJQKA][cdhs]){2}$/,CLASS=/^(?:([2-9TJQKA])\1|[2-9TJQKA]{2}[so])$/;
 const DEFAULT_URL='http://127.0.0.1:8787',LOCAL_TREE={bet:[33,66,75],raise:66,allinThreshold:.67};
 // PLO tree: one bet size per street (fraction of pot), a pot raise, at most 2 raises
 // on the flop and 3 later. The solver lowers the caps itself if memory runs short.
 const COMBO4=/^([2-9TJQKA][cdhs]){4}$/,PLO_TREE={bet:[.33,.66,.75],raise:1,cap:[2,3,3],allinThreshold:.67},PLO_MAX_COMBOS=20000,round4=x=>Math.round(x*1e4)/1e4;

 // Pot percentages that reproduce an exact bet or raise in TexasSolver's tree.
 // Chips are the app's internal units (100 per bb). Each player starts the
 // street with base = pot/2 committed; a bet is pct x pot, and a raise adds
 // pct x (2 x the larger commitment) on top of the call.
 function betPercent(target,base){return 100*target/(2*base);}
 function raisePercent(target,facing,base){return 100*(target-facing)/(2*(base+facing));}
 const round=x=>Math.round(x*1e6)/1e6;

 // Builds the solver spec for the current decision, or explains why it cannot.
 function spec(data,ranges,opt={}){
  const config=G.normalize(data.config);if(config.variant==='PLO4')return ploSpec(data,ranges,opt,config);
  assert(config.variant==='NLH'&&config.rules.hole===2,'The local solver supports No-Limit Hold\'em only.');
  assert(data.board.length>=3,'The local solver starts from the flop.');
  const h=new G.Hand(config,{runout:data.board.slice(config.boardCards.length),rng:G.rng(1)}),current=data.board.length-2,snapshot=x=>({pot:x.pot,stacks:x.stacks.slice()});let start=null;
  for(const a of data.actions){if(h.street===current&&!start)start=snapshot(h);h.act(a);}
  if(!start)start=snapshot(h);
  assert(!h.done&&h.actor===data.actor,'The selected spot is no longer an open decision.');
  const live=h.living();assert(live.length===2,'The local solver handles heads-up pots only.');
  const firstAfterButton=i=>(i-h.button+h.n)%h.n||h.n,[oop,ip]=live.slice().sort((a,b)=>firstAfterButton(a)-firstAfterButton(b));
  const street=current-1,pot=start.pot,base=pot/2,stack=Math.min(start.stacks[ip],start.stacks[oop]);
  assert(stack>0,'Nobody has chips behind, so there is nothing left to solve.');
  // Default tree: one bet size per street, one raise size and all-in. Bets that
  // would commit over two thirds of the stack become all-in. Wider trees ran out
  // of 15 GB on 100bb spots.
  const sizes={};for(const who of ['ip','oop']){sizes[who]={};for(let s=street;s<3;s++){const bet=[LOCAL_TREE.bet[s]];sizes[who][STREETS[s]]={bet:bet.slice(),raise:[LOCAL_TREE.raise],donk:who==='oop'&&s>0?bet.slice():[]};}}
  let allinThreshold=LOCAL_TREE.allinThreshold;
  // Add the sizes actually used on this street so the real line exists in the tree.
  const path=[],paid={[ip]:0,[oop]:0};let facing=0;
  for(const a of data.actions.filter(a=>a.street===current)){
   const who=a.seat===ip?'ip':'oop',book=sizes[who][STREETS[street]];
   if(a.kind==='check')path.push({kind:'check'});
   else if(a.kind==='call'){path.push({kind:'call'});paid[a.seat]=facing;}
   else if(a.kind==='fold')throw Error('The hand has already ended.');
   else{
    const target=a.target,allIn=target>=start.stacks[a.seat];
    if(!allIn){if(a.kind==='bet'&&!facing){const p=round(betPercent(target,base));book.bet.push(p);if(who==='oop'&&street>0)book.donk.push(p);}else book.raise.push(round(raisePercent(target,facing,base)));}
    // Keep a real bet that commits most of the stack from collapsing into all-in.
    if(!allIn&&base+target>allinThreshold*(stack+base))allinThreshold=1;
    path.push({kind:facing?'raise':'bet',amount:target-paid[a.seat],allIn});paid[a.seat]=target;facing=target;
   }
  }
  for(const who of ['ip','oop'])for(const s of Object.values(sizes[who]))for(const k of ['bet','raise','donk'])s[k]=[...new Set(s[k])].filter(x=>x>0).sort((a,b)=>a-b).slice(0,6);
  // Ranges go to the solver per hand class (average weight of the class's live
  // combos). Exact combos would switch off TexasSolver's suit isomorphism,
  // which costs several times the memory and time.
  const classes=seat=>{const rows=ranges.rows(seat),sums={},counts={};for(const r of rows){const k=C.handClass(r.cards),w=r.prob??r.weight??0;sums[k]=(sums[k]||0)+w;counts[k]=(counts[k]||0)+1;}
   const avg=Object.fromEntries(Object.keys(sums).map(k=>[k,sums[k]/counts[k]])),peak=Math.max(...Object.values(avg));assert(peak>0,'A player has an empty range.');
   const out={};for(const [k,w]of Object.entries(avg))if(w/peak>.005)out[k]=round(w/peak);return out;};
  const hero=data.heroCards.slice().sort((a,b)=>a-b).map(C.cardName).join(''),heroClass=C.handClass(data.heroCards),rangeIp=classes(ip),rangeOop=classes(oop),heroRange=data.actor===ip?rangeIp:rangeOop;
  if(!heroRange[heroClass])heroRange[heroClass]=.01;
  return{version:1,board:data.board.map(C.cardName),pot,stack,sizes,allinThreshold,rangeIp,rangeOop,path,hero,heroSeat:data.actor,heroIsIp:data.actor===ip,
   accuracy:Math.min(5,Math.max(.1,Number(opt.localAccuracy)||1)),maxIterations:Math.min(1000,Math.max(10,Number(opt.localIterations)||200))};
 }

 // Pot-limit Omaha (4 cards, high) goes to tools/plo-solver: exact weighted combos,
 // bet sizes as fractions of the pot, raises as fractions of a pot raise, and the
 // exact amounts already played on this street (the solver adds them to its tree).
 function ploSpec(data,ranges,opt,config){
  assert(config.rules.hole===4&&!config.rules.low,'The local PLO solver supports 4-card high only.');
  assert(data.board.length>=3,'The local solver starts from the flop.');
  const h=new G.Hand(config,{runout:data.board.slice(config.boardCards.length),rng:G.rng(1)}),current=data.board.length-2,snapshot=x=>({pot:x.pot,stacks:x.stacks.slice()});let start=null;
  for(const a of data.actions){if(h.street===current&&!start)start=snapshot(h);h.act(a);}
  if(!start)start=snapshot(h);
  assert(!h.done&&h.actor===data.actor,'The selected spot is no longer an open decision.');
  const live=h.living();assert(live.length===2,'The local solver handles heads-up pots only.');
  const firstAfterButton=i=>(i-h.button+h.n)%h.n||h.n,[oop,ip]=live.slice().sort((a,b)=>firstAfterButton(a)-firstAfterButton(b));
  const street=current-1,stack=Math.min(start.stacks[ip],start.stacks[oop]);assert(stack>0,'Nobody has chips behind, so there is nothing left to solve.');
  const sizes={},caps={};for(let s=street;s<3;s++){sizes[STREETS[s]]={};caps[STREETS[s]]=PLO_TREE.cap[s];for(const who of ['ip','oop'])sizes[STREETS[s]][who]={bet:[PLO_TREE.bet[s]],raise:[PLO_TREE.raise]};}
  const path=[];for(const a of data.actions.filter(a=>a.street===current)){assert(a.kind!=='fold','The hand has already ended.');path.push(a.kind==='check'||a.kind==='call'?{kind:a.kind}:{kind:a.kind,to:a.target});}
  const name=cs=>cs.slice().sort((a,b)=>b-a).map(C.cardName).join(''),hero=name(data.heroCards);
  const combos=seat=>{const rows=ranges.rows(seat),peak=Math.max(0,...rows.map(r=>r.prob??r.weight??0));assert(peak>0,'A player has an empty range.');const out={};for(const r of rows){const w=round4((r.prob??r.weight??0)/peak);if(w>=1e-4)out[name(r.cards)]=w;}return out;};
  const rangeIp=combos(ip),rangeOop=combos(oop),heroRange=data.actor===ip?rangeIp:rangeOop;
  if(!heroRange[hero])heroRange[hero]=.005;
  return{version:1,game:'PLO4',board:data.board.map(C.cardName),pot:start.pot,stack,minBet:G.units(config.bb),sizes,caps,allinThreshold:PLO_TREE.allinThreshold,rangeIp,rangeOop,path,hero,heroSeat:data.actor,heroIsIp:data.actor===ip,
   accuracy:Math.min(5,Math.max(.1,Number(opt.localAccuracy)||.5)),maxIterations:Math.min(2000,Math.max(10,Number(opt.localIterations)||300))};
 }
 function validatePLO(s){
  const num=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi,board=Array.isArray(s.board)?s.board:[];
  assert(board.length>=3&&board.length<=5&&board.every(c=>typeof c==='string'&&CARD.test(c))&&new Set(board).size===board.length,'Invalid board.');
  assert(num(s.pot,1,1e9)&&num(s.stack,1,1e10)&&num(s.minBet,1,1e9),'Invalid pot, stack or minimum bet.');
  const first=board.length-3,allowed=STREETS.slice(first);
  for(const r of [s.rangeIp,s.rangeOop]){assert(r&&typeof r==='object'&&!Array.isArray(r),'Invalid range.');const keys=Object.keys(r);assert(keys.length>0&&keys.length<=PLO_MAX_COMBOS,'Each range needs 1 to '+PLO_MAX_COMBOS+' combos.');for(const k of keys){assert(COMBO4.test(k)&&new Set(k.match(/../g)).size===4&&!k.match(/../g).some(c=>board.includes(c))&&num(r[k],1e-6,1),'Invalid range entry '+k.slice(0,12)+'.');}}
  assert(s.sizes&&typeof s.sizes==='object'&&s.caps&&typeof s.caps==='object','Missing bet sizes.');
  for(const street of Object.keys(s.sizes)){assert(allowed.includes(street),'Invalid street '+street+'.');for(const who of Object.keys(s.sizes[street])){assert(who==='ip'||who==='oop','Invalid player.');const book=s.sizes[street][who];for(const k of ['bet','raise'])assert(Array.isArray(book[k])&&book[k].length<=6&&book[k].every(x=>num(x,.01,1)),'Invalid '+k+' sizes.');}}
  for(const [street,c] of Object.entries(s.caps))assert(allowed.includes(street)&&Number.isInteger(c)&&c>=0&&c<=4,'Invalid raise cap.');
  assert(num(s.allinThreshold,.1,1),'Invalid all-in threshold.');
  assert(num(s.accuracy,.05,5)&&Number.isInteger(s.maxIterations)&&num(s.maxIterations,10,2000),'Invalid accuracy settings.');
  assert(Array.isArray(s.path)&&s.path.length<=16&&s.path.every(p=>p&&(p.kind==='check'||p.kind==='call')&&p.to===undefined||p&&(p.kind==='bet'||p.kind==='raise')&&num(p.to,1,1e10)),'Invalid action path.');
  assert(typeof s.hero==='string'&&COMBO4.test(s.hero)&&(s.heroIsIp?s.rangeIp:s.rangeOop)[s.hero]>0,'Invalid hero hand.');
  assert(typeof s.heroIsIp==='boolean','Invalid hero seat.');
  return s;
 }
 function inputPLO(s,{threads=4,output='result.json',memoryMB=8192,timeLimit=1800}={}){
  validatePLO(s);assert(typeof output==='string'&&!/[\r\n]/.test(output),'Invalid output path.');
  const range=r=>Object.entries(r).map(([k,w])=>w>=1?k:k+':'+w).join(','),n=x=>String(Math.round(x*1e6)/1e6);
  const lines=['game PLO4','board '+s.board.join(''),'pot '+n(s.pot),'stack '+n(s.stack),'min_bet '+n(s.minBet),'allin_threshold '+n(s.allinThreshold),'range_oop '+range(s.rangeOop),'range_ip '+range(s.rangeIp)];
  for(const [street,books] of Object.entries(s.sizes))for(const [who,book] of Object.entries(books))for(const k of ['bet','raise'])lines.push(k+' '+street+' '+who+' '+(book[k].length?book[k].map(n).join(','):'none'));
  for(const [street,c] of Object.entries(s.caps))lines.push('cap '+street+' '+c);
  if(s.path.length)lines.push('path '+s.path.map(p=>p.to===undefined?p.kind:'to:'+n(p.to)).join(','));
  lines.push('threads '+Math.max(1,Math.min(256,threads|0)),'accuracy '+n(s.accuracy),'max_iterations '+s.maxIterations,'print_interval 10','memory_limit_mb '+Math.max(256,Math.round(memoryMB)),'time_limit '+Math.max(10,Math.round(timeLimit)),'output '+output);
  return lines.join('\n')+'\n';
 }

 // Strict checks shared by the bridge, which turns a spec into solver commands.
 function validate(s){
  if(s&&s.game==='PLO4'&&s.version===1)return validatePLO(s);
  const num=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  assert(s&&s.version===1,'Unknown spec version.');
  assert(Array.isArray(s.board)&&s.board.length>=3&&s.board.length<=5&&s.board.every(c=>CARD.test(c))&&new Set(s.board).size===s.board.length,'Invalid board.');
  assert(num(s.pot,1,1e7)&&num(s.stack,1,1e8),'Invalid pot or stack.');
  for(const r of [s.rangeIp,s.rangeOop]){assert(r&&typeof r==='object'&&Object.keys(r).length>0&&Object.keys(r).length<=169,'Invalid range.');for(const [k,w]of Object.entries(r))assert(CLASS.test(k)&&num(w,0,1),'Invalid range entry '+k+'.');}
  for(const who of ['ip','oop']){assert(s.sizes&&s.sizes[who],'Missing bet sizes.');for(const [street,book]of Object.entries(s.sizes[who])){assert(STREETS.indexOf(street)>=s.board.length-3,'Invalid street '+street+'.');for(const k of ['bet','raise','donk'])assert(Array.isArray(book[k])&&book[k].length<=6&&book[k].every(x=>num(x,.01,10000)),'Invalid '+k+' sizes.');}}
  assert(num(s.allinThreshold,.1,1),'Invalid all-in threshold.');
  assert(num(s.accuracy,.1,5)&&Number.isInteger(s.maxIterations)&&num(s.maxIterations,10,1000),'Invalid accuracy settings.');
  assert(Array.isArray(s.path)&&s.path.length<=12&&s.path.every(p=>['check','call','bet','raise'].includes(p.kind)&&(p.amount===undefined||num(p.amount,0,1e8))),'Invalid action path.');
  assert(typeof s.hero==='string'&&COMBO.test(s.hero),'Invalid hero hand.');
  return s;
 }

 function input(s,{threads=4,output='output_result.json'}={}){
  if(s&&s.game==='PLO4')return inputPLO(s,arguments[1]);
  validate(s);const range=r=>Object.entries(r).map(([k,w])=>w>=1?k:k+':'+w).join(','),lines=['set_pot '+s.pot,'set_effective_stack '+s.stack,'set_board '+s.board.join(','),'set_range_ip '+range(s.rangeIp),'set_range_oop '+range(s.rangeOop)];
  for(const who of ['ip','oop'])for(const [street,book]of Object.entries(s.sizes[who])){
   for(const k of ['bet','raise','donk'])if(book[k].length)lines.push('set_bet_sizes '+who+','+street+','+k+','+book[k].join(','));
   lines.push('set_bet_sizes '+who+','+street+',allin');
  }
  lines.push('set_allin_threshold '+s.allinThreshold,'build_tree','set_thread_num '+Math.max(1,Math.min(64,threads|0)),'set_accuracy '+s.accuracy,'set_max_iteration '+s.maxIterations,'set_print_interval 10','set_use_isomorphism 1','start_solve','set_dump_rounds 1','dump_result '+output);
  return lines.join('\n')+'\n';
 }

 // Walks TexasSolver's dumped tree along the actual line. Labels look like
 // "BET 25.000000" or "RAISE 85.000000", where the amount is the chips added.
 function follow(tree,path){
  let node=tree;
  for(const step of path){
   assert(node&&node.childrens,'The solver tree does not contain this line.');
   const labels=Object.keys(node.childrens);let key;
   if(step.kind==='check'||step.kind==='call')key=labels.find(l=>l===step.kind.toUpperCase());
   else{const options=labels.filter(l=>l.startsWith(step.kind.toUpperCase()+' ')).map(l=>({l,amount:parseFloat(l.split(' ')[1])}));const best=options.sort((a,b)=>Math.abs(a.amount-step.amount)-Math.abs(b.amount-step.amount))[0];if(best&&(Math.abs(best.amount-step.amount)<=Math.max(2,.01*step.amount)||step.allIn&&best.amount===Math.max(...options.map(o=>o.amount))))key=best.l;}
   assert(key,'The solver tree does not contain the action '+step.kind+(step.amount?' '+step.amount:'')+'.');
   node=node.childrens[key];
  }
  assert(node&&node.node_type==='action_node'&&node.strategy,'The solver did not return a strategy for this decision.');
  return node;
 }

 function heroRow(node,hero){
  const table=node.strategy.strategy,swap=hero.slice(2)+hero.slice(0,2),row=table[hero]||table[swap];
  assert(row,'The solver strategy does not include your hand.');return row;
 }

 // Maps solver labels back to the app's legal actions at this decision.
 function mapActions(hand,node,row,spec){
  const legal=hand.legal(),paid=hand.streetPaid[hand.actor],actions=[],probs=[];
  node.actions.forEach((label,i)=>{
   const [kind,amount]=label.split(' ');let action;
   if(kind==='FOLD')action={kind:'fold',label:'Fold'};
   else if(kind==='CHECK')action={kind:'check',label:'Check'};
   else if(kind==='CALL')action={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'};
   else{const target=Math.min(paid+Math.round(parseFloat(amount)),legal.allInTo),k=hand.currentBet?'raise':'bet';action={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':'')};}
   action.id=action.kind+':'+(action.target||0);
   const same=actions.findIndex(a=>a.id===action.id);if(same>=0)probs[same]+=row[i];else{actions.push(action);probs.push(row[i]);}
  });
  const total=probs.reduce((a,b)=>a+b,0);return{actions,probs:probs.map(p=>p/total)};
 }

 // The PLO solver's tree: actions carry the street total ("to") they bet or raise to.
 function followPLO(tree,path){
  let node=tree;
  for(const step of path){
   assert(node&&Array.isArray(node.actions),'The solver tree does not contain this line.');
   let i=-1;if(step.kind==='check'||step.kind==='call')i=node.actions.findIndex(a=>a.kind===step.kind);
   else{const options=node.actions.map((a,k)=>({a,k})).filter(o=>o.a.kind===step.kind).sort((x,y)=>Math.abs(x.a.to-step.to)-Math.abs(y.a.to-step.to));if(options[0]&&Math.abs(options[0].a.to-step.to)<=Math.max(2,.01*step.to))i=options[0].k;}
   assert(i>=0,'The solver tree does not contain the action '+step.kind+(step.to?' '+step.to:'')+'.');node=node.children[i];
  }
  assert(node&&Array.isArray(node.actions)&&node.strategy,'The solver did not return a strategy for this decision.');
  return node;
 }
 // Maps PLO solver actions to the app's legal actions; EVs become bb from this decision.
 function mapPLO(hand,node,row,evs){
  const legal=hand.legal(),paid=hand.streetPaid[hand.actor],actions=[],probs=[],mean=[];
  node.actions.forEach((x,i)=>{
   let action;
   if(x.kind==='fold')action={kind:'fold',label:'Fold'};
   else if(x.kind==='check')action={kind:'check',label:'Check'};
   else if(x.kind==='call')action={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'};
   else{const top=Math.min(legal.maxRaiseTo,legal.allInTo),target=x.allin?top:Math.min(top,Math.max(legal.minRaiseTo,Math.round(x.to))),k=hand.currentBet?'raise':'bet';action={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':'')};}
   action.id=action.kind+':'+(action.target||0);const ev=evs?G.bb(evs[i]+paid):null;
   const same=actions.findIndex(a=>a.id===action.id);if(same>=0){probs[same]+=row[i];if(ev!==null&&ev>mean[same])mean[same]=ev;}else{actions.push(action);probs.push(row[i]);mean.push(ev);}
  });
  const total=probs.reduce((a,b)=>a+b,0);return{actions,probs:probs.map(p=>p/total),mean};
 }
 function resultPLO(engine){
  const s=engine.spec,tree=engine.body.tree,player=s.heroIsIp?1:0,node=followPLO(tree.tree,s.path),index=tree.combos[player].indexOf(s.hero);
  assert(index>=0,'The solver strategy does not include your hand.');
  const cash=engine.hand.config.mode==='cash',{actions,probs,mean}=mapPLO(engine.hand,node,node.strategy[index],node.evs[index]),hasEV=cash&&mean.every(Number.isFinite),values=hasEV?mean:actions.map(()=>0),best=hasEV?values.indexOf(Math.max(...values)):probs.indexOf(Math.max(...probs)),zeros=actions.map(()=>0),converged=Number.isFinite(tree.exploitability)&&tree.exploitability<=s.accuracy,rare=node.reach[index]<.005;
  return{supported:true,actions,reference:probs,mean:values,se:zeros,loss:hasEV?values.map(v=>values[best]-v):zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:cash?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),reliable:hasEV&&converged,
   solve:{version:1,method:'local-plo',exact:false,approximate:false,iterations:tree.iterations,exploitability:tree.exploitability,seconds:tree.seconds,memoryMB:tree.memoryEstimateMB,converged,evAvailable:hasEV,heroReach:node.reach[index],treeReduced:tree.treeReduced,raiseCaps:tree.caps,suitSymmetries:tree.suitSymmetries,rangeAssumptions:engine.ranges.descriptions,rangeCombos:[Object.keys(s.rangeOop).length,Object.keys(s.rangeIp).length],
    actionTree:{betSizes:s.sizes[STREETS[s.board.length-3]][s.heroIsIp?'ip':'oop'].bet,raiseSizes:[1],potLimit:true,maxRaises:tree.caps[s.board.length-3],jam:true},
    warning:'Solved by the PLO solver on this computer for the combos shown, with one bet size and pot-sized raises on every later street. Exploitability is measured exactly, in percent of the pot.'+(hasEV?' EVs are in bb from this decision, before rake.':' EVs are chip values, not prize units, so they are not shown.')+(tree.treeReduced?' Raise caps were lowered to fit memory.':'')+(converged?'':' The solve stopped before reaching its accuracy target.')+(rare?' Your hand almost never reaches this spot in the solved strategy, so its row shows the best-EV action.':'')}};
 }

 // Worker engine: one HTTP request, then complete. step() never blocks.
 class Engine{
  constructor(data,ranges,opt,hand,fetcher){
   this.data=data;this.hand=hand;this.ranges=ranges;this.url=(opt.localSolver||DEFAULT_URL).replace(/\/$/,'');this.spec=spec(data,ranges,opt);this.complete=false;this.waiting=false;this.started=Date.now();this.fetch=fetcher||(typeof fetch==='function'?fetch.bind(root):null);
  }
  step(){
   if(this.waiting||this.complete)return;this.waiting=true;
   if(!this.fetch){this.fail('This browser cannot reach the local solver.');return;}
   this.poll=setInterval(()=>this.fetch(this.url+'/status').then(r=>r.json()).then(s=>{this.status=s;}).catch(()=>{}),3000);
   this.fetch(this.url+'/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.spec)}).then(r=>r.json().then(body=>{if(!r.ok)throw Error(body.error||('Local solver error '+r.status));return body;})).then(body=>{clearInterval(this.poll);this.body=body;this.complete=true;this.waiting=false;},error=>{clearInterval(this.poll);this.fail(/fetch|network|Failed/i.test(error.message)?'The local solver is not running on this computer at '+this.url+'. Start it with tools/local-solver/start.command, or turn it off under Analysis settings.':error.message);});
  }
  fail(message){this.error=message;this.complete=true;this.waiting=false;}
  cancel(){clearInterval(this.poll);if(this.waiting&&this.fetch)this.fetch(this.url+'/cancel',{method:'POST'}).catch(()=>{});}
  progress(){if(this.complete)clearInterval(this.poll);const s=this.status||{};return{phase:'local',done:Math.round((Date.now()-this.started)/1000),total:0,iterations:s.iterations||0,exploitability:s.exploitability??null};}
  result(){
   if(this.error)return{supported:false,message:'Local solver: '+this.error};
   if(this.spec.game==='PLO4')return resultPLO(this);
   const node=follow(this.body.tree,this.spec.path),row=heroRow(node,this.spec.hero),{actions,probs}=mapActions(this.hand,node,row,this.spec),best=probs.indexOf(Math.max(...probs)),zeros=actions.map(()=>0);
   return{supported:true,actions,reference:probs,mean:zeros,se:zeros,loss:zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:this.hand.config.mode==='cash'?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),
    solve:{version:1,method:'local-texassolver',exact:false,approximate:false,iterations:this.body.iterations||0,exploitability:this.body.exploitability,seconds:this.body.seconds,rangeAssumptions:this.ranges.descriptions,actionTree:{betSizes:this.spec.sizes[this.spec.heroIsIp?'ip':'oop'][STREETS[this.spec.board.length-3]].bet.map(x=>x/100),raiseSizes:this.spec.sizes.ip[STREETS[this.spec.board.length-3]].raise.map(x=>x/100),maxAggressions:4,jam:true},
     warning:'Solved by TexasSolver on this computer for the ranges shown, with the listed bet sizes on every later street. Exploitability is the solver\'s own estimate, in percent of the pot. It does not report action EVs, so no decision cost is graded.'}};
  }
 }

 const api={DEFAULT_URL,spec,validate,input,follow,heroRow,mapActions,followPLO,mapPLO,Engine,betPercent,raisePercent,PLO_TREE};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerLocalSolver=api;
})(typeof globalThis!=='undefined'?globalThis:this);
