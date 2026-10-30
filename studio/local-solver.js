(function(root){
 'use strict';
 // Heads-up postflop solves on the user's own computer through the TexasSolver
 // bridge in tools/local-solver. The bridge rebuilds the solver input from the
 // validated spec below, so a web page can never pass raw solver commands.
 let G=root.PokerGame;
 if(!G&&typeof require==='function'){try{G=require('./hand-engine.js');}catch{G=require('./game.js');}}
 const C=G&&G.Core,STREETS=['flop','turn','river'],assert=(v,m)=>{if(!v)throw Error(m)};
 const CARD=/^[2-9TJQKA][cdhs]$/,COMBO=/^([2-9TJQKA][cdhs]){2}$/,CLASS=/^(?:([2-9TJQKA])\1|(?:A[2-9TJQK]|K[2-9TJQ]|Q[2-9TJ]|J[2-9T]|T[2-9]|9[2-8]|8[2-7]|7[2-6]|6[2-5]|5[2-4]|4[23]|32)[so])$/;
 const DEFAULT_URL='http://127.0.0.1:8787',LOCAL_TREE={bet:[[33,66],[33,66,150],[33,66,150]],later:[66,66],raise:66,allinThreshold:.67};
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
  const live=h.living();if(live.length===3)return mwSpec(data,ranges,opt,config,h,start);assert(live.length===2,'The local solver handles heads-up and three-way pots only.');
  const firstAfterButton=i=>(i-h.button+h.n)%h.n||h.n,[oop,ip]=live.slice().sort((a,b)=>firstAfterButton(a)-firstAfterButton(b));
  const street=current-1,pot=start.pot,base=pot/2,stack=Math.min(start.stacks[ip],start.stacks[oop]);
  assert(stack>0,'Nobody has chips behind, so there is nothing left to solve.');
  // Default tree: a small bet, a big bet and an overbet (1/3, 2/3 and 1.5x the pot) and all-in on the turn and the
  // river; on the flop, where memory is the limit, the small and the big bet, with one size on each later street
  // (2/3 of the pot). A raise size on the flop only, no donk bets (sizes used in the hand are added below).
  // Bets that would commit over two thirds of the stack become all-in. Raises and donks on every street took
  // 7.5 GB and 3x the time on a 100bb flop.
  const sizes={};for(const who of ['ip','oop']){sizes[who]={};for(let s=street;s<3;s++){const bet=street===0&&s>0?[LOCAL_TREE.later[s-1]]:LOCAL_TREE.bet[s];sizes[who][STREETS[s]]={bet:bet.slice(),raise:s===0?[LOCAL_TREE.raise]:[],donk:[]};}}
  // The 1bb minimum bet: TexasSolver's console has no minimum of its own, so a
  // default size below it in a small pot becomes exactly 1bb.
  const minBet=G.units(config.bb);for(const who of ['ip','oop']){const b=sizes[who][STREETS[street]];b.bet=b.bet.map(p=>p*pot/100<minBet?round(100*minBet/pot):p);}
  let allinThreshold=LOCAL_TREE.allinThreshold;
  // Add the sizes actually used on this street so the real line exists in the tree.
  const path=[],paid={[ip]:0,[oop]:0};let facing=0;
  for(const a of data.actions.filter(a=>a.street===current)){
   const who=a.seat===ip?'ip':'oop',book=sizes[who][STREETS[street]];
   if(a.kind==='check')path.push({kind:'check'});
   else if(a.kind==='call'){path.push({kind:'call'});paid[a.seat]=facing;}
   else if(a.kind==='fold')throw Error('The hand has already ended.');
   else{
    const target=a.target,allIn=target>=stack;
    if(!allIn){if(a.kind==='bet'&&!facing){const p=round(betPercent(target,base));book.bet.push(p);if(who==='oop'&&street>0)book.donk.push(p);}else book.raise.push(round(raisePercent(target,facing,base)));}
    // Keep a real bet that commits most of the stack from collapsing into all-in.
    // TexasSolver collapses a bet when pot/2 + street total > threshold x stack.
    if(!allIn&&base+target>allinThreshold*stack)allinThreshold=round((base+target)/stack*1.001+1e-6);
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

 // Three-player NLH pots go to tools/multiway-solver: exact weighted combos in postflop order
 // (first to act first), one stack for all three (the smallest), bet sizes as fractions of the pot,
 // raises as fractions of the pot after the call, and the exact amounts already played on this
 // street (the solver adds them to its tree). Flop solves keep the turn and river slim and deal an
 // even spread of turn and river cards when every card would not fit; turn and river solves use
 // every size and every card.
 const MW_TREE={flop:{flop:{bet:[1/3,2/3,1.5],raise:[2/3]},turn:{bet:[2/3],raise:[]},river:{bet:[2/3],raise:[]}},turn:{turn:{bet:[1/3,2/3,1.5],raise:[2/3]},river:{bet:[1/3,2/3,1.5],raise:[]}},river:{river:{bet:[1/3,2/3,1.5],raise:[2/3]}},cap:1,allinThreshold:.67,runouts:96},MW_MAX_COMBOS=1326;
 // A flop's runout budget: 96 turn x river cards for wide ranges (about 1,600 combos in all), more in proportion
 // for narrower ones, which solve faster (a squeeze pot's 230 combos get about 670), so a solve takes about as long.
 function mwRunouts(ranges){const total=ranges.reduce((s,r)=>s+Object.keys(r).length,0);return Math.min(2352,Math.max(MW_TREE.runouts,Math.round(MW_TREE.runouts*1600/Math.max(1,total))));}
 function mwSpec(data,ranges,opt,config,h,start){
  const current=data.board.length-2,street=current-1,live=h.living();assert(live.length===3,'The 3-way solver needs exactly three players.');
  const firstAfterButton=i=>(i-h.button+h.n)%h.n||h.n,seats=live.slice().sort((a,b)=>firstAfterButton(a)-firstAfterButton(b));
  const stack=Math.min(...seats.map(i=>start.stacks[i]));assert(stack>0,'Nobody has chips behind, so there is nothing left to solve.');
  // Chips of players who folded before this street are dead money in the pot. A player who folds on this street
  // without putting chips in is left out of the line; anything else needs the full multiway engine.
  const path=[];
  for(const a of data.actions.filter(a=>a.street===current)){
   if(!seats.includes(a.seat)){assert(a.kind==='fold'||a.kind==='check','A player who left this street put chips in.');continue;}
   assert(a.kind!=='fold','The hand has already ended.');path.push(a.kind==='check'||a.kind==='call'?{kind:a.kind}:{kind:a.kind,to:a.target});
  }
  // On the flop only the last preflop raiser may lead (no donk bets), when that player is still in.
  const raiser=[...data.actions].reverse().find(a=>a.street===0&&(a.kind==='raise'||a.kind==='bet'))?.seat,tree=MW_TREE[STREETS[street]],sizes={},caps={};
  for(const [k,v] of Object.entries(tree)){sizes[k]={bet:v.bet.map(round4),raise:v.raise.map(round4)};caps[k]=MW_TREE.cap;}
  const lead=street===0&&seats.includes(raiser)?{flop:seats.map(i=>i===raiser)}:{};
  const name=cs=>cs.slice().sort((a,b)=>b-a).map(C.cardName).join(''),hero=name(data.heroCards);
  const combos=seat=>{const rows=ranges.rows(seat),peak=Math.max(0,...rows.map(r=>r.prob??r.weight??0));assert(peak>0,'A player has an empty range.');const out={};for(const r of rows){const w=round4((r.prob??r.weight??0)/peak);if(w>=1e-4)out[name(r.cards)]=w;}return out;};
  const list=seats.map(combos),heroIndex=seats.indexOf(data.actor);if(!list[heroIndex][hero])list[heroIndex][hero]=.005;
  return{version:1,game:'NLH3',board:data.board.map(C.cardName),pot:start.pot,stack,minBet:G.units(config.bb),sizes,caps,lead,allin:true,allinThreshold:MW_TREE.allinThreshold,ranges:list,seats,path,hero,heroIndex,runouts:street===0?mwRunouts(list):0,
   accuracy:Math.min(5,Math.max(.1,Number(opt.localAccuracy)||.5)),maxIterations:Math.min([300,400,1000][street],Math.max(10,Number(opt.localIterations)||1000))};
 }
 function validateMW(s){
  const num=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi,board=Array.isArray(s.board)?s.board:[];
  assert(board.length>=3&&board.length<=5&&board.every(c=>typeof c==='string'&&CARD.test(c))&&new Set(board).size===board.length,'Invalid board.');
  assert(num(s.pot,1,1e9)&&num(s.stack,1,1e10)&&num(s.minBet,1,1e9),'Invalid pot, stack or minimum bet.');
  const allowed=STREETS.slice(board.length-3);
  assert(Array.isArray(s.ranges)&&s.ranges.length===3,'Three ranges are needed.');
  for(const r of s.ranges){assert(r&&typeof r==='object'&&!Array.isArray(r),'Invalid range.');const keys=Object.keys(r);assert(keys.length>0&&keys.length<=MW_MAX_COMBOS,'Each range needs 1 to '+MW_MAX_COMBOS+' combos.');for(const k of keys)assert(COMBO.test(k)&&k.slice(0,2)!==k.slice(2)&&!k.match(/../g).some(c=>board.includes(c))&&num(r[k],1e-6,1),'Invalid range entry '+k.slice(0,12)+'.');}
  assert(s.sizes&&typeof s.sizes==='object'&&s.caps&&typeof s.caps==='object'&&s.lead&&typeof s.lead==='object','Missing bet sizes.');
  for(const [street,book] of Object.entries(s.sizes)){assert(allowed.includes(street),'Invalid street '+street+'.');for(const k of ['bet','raise'])assert(Array.isArray(book[k])&&book[k].length<=4&&book[k].every(x=>num(x,.05,3)),'Invalid '+k+' sizes.');}
  for(const [street,c] of Object.entries(s.caps))assert(allowed.includes(street)&&Number.isInteger(c)&&c>=0&&c<=3,'Invalid raise cap.');
  for(const [street,l] of Object.entries(s.lead))assert(allowed.includes(street)&&Array.isArray(l)&&l.length===3&&l.every(x=>typeof x==='boolean'),'Invalid lead flags.');
  assert(typeof s.allin==='boolean'&&num(s.allinThreshold,.1,1),'Invalid all-in settings.');
  assert(s.runouts===undefined||Number.isInteger(s.runouts)&&num(s.runouts,0,2352),'Invalid runout budget.');
  assert(num(s.accuracy,.05,5)&&Number.isInteger(s.maxIterations)&&num(s.maxIterations,10,2000),'Invalid accuracy settings.');
  assert(Array.isArray(s.path)&&s.path.length<=16&&s.path.every(p=>p&&(p.kind==='check'||p.kind==='call')&&p.to===undefined||p&&(p.kind==='bet'||p.kind==='raise')&&num(p.to,1,1e10)),'Invalid action path.');
  assert(Number.isInteger(s.heroIndex)&&s.heroIndex>=0&&s.heroIndex<3&&typeof s.hero==='string'&&COMBO.test(s.hero)&&s.ranges[s.heroIndex][s.hero]>0,'Invalid hero hand.');
  return s;
 }
 function inputMW(s,{threads=4,output='result.json',memoryMB=8192,timeLimit=1800}={}){
  validateMW(s);assert(typeof output==='string'&&!/[\r\n]/.test(output),'Invalid output path.');
  const range=r=>Object.entries(r).map(([k,w])=>w>=1?k:k+':'+w).join(','),n=x=>String(Math.round(x*1e6)/1e6);
  const lines=['game NLH3','board '+s.board.join(''),'pot '+n(s.pot),'stack '+n(s.stack),'min_bet '+n(s.minBet),'allin_threshold '+n(s.allinThreshold),...s.ranges.map((r,i)=>'range'+i+' '+range(r))];
  for(const street of STREETS.slice(s.board.length-3)){const book=s.sizes[street]||{bet:[],raise:[]};for(const k of ['bet','raise'])lines.push(k+' '+street+' all '+(book[k].length?book[k].map(n).join(','):'none'));lines.push('cap '+street+' '+(s.caps[street]??1),'allin '+street+' '+(s.allin?1:0));if(s.lead[street])s.lead[street].forEach((x,i)=>lines.push('lead '+street+' '+i+' '+(x?1:0)));}
  if(s.path.length)lines.push('path '+s.path.map(p=>p.to===undefined?p.kind:'to:'+n(p.to)).join(','));
  if(s.runouts)lines.push('runouts '+s.runouts);
  lines.push('threads '+Math.max(1,Math.min(256,threads|0)),'accuracy '+n(s.accuracy),'max_iterations '+s.maxIterations,'print_interval '+(s.board.length===3?20:10),'memory_limit_mb '+Math.max(256,Math.round(memoryMB)),'time_limit '+Math.max(10,Math.round(timeLimit)),'output '+output);
  return lines.join('\n')+'\n';
 }

 // Strict checks shared by the bridge, which turns a spec into solver commands.
 function validate(s){
  if(s&&s.game==='PLO4'&&s.version===1)return validatePLO(s);
  if(s&&s.game==='NLH3'&&s.version===1)return validateMW(s);
  const num=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  assert(s&&s.version===1,'Unknown spec version.');
  assert(Array.isArray(s.board)&&s.board.length>=3&&s.board.length<=5&&s.board.every(c=>CARD.test(c))&&new Set(s.board).size===s.board.length,'Invalid board.');
  assert(num(s.pot,1,1e7)&&num(s.stack,1,1e8),'Invalid pot or stack.');
  for(const r of [s.rangeIp,s.rangeOop]){assert(r&&typeof r==='object'&&Object.keys(r).length>0&&Object.keys(r).length<=169,'Invalid range.');for(const [k,w]of Object.entries(r))assert(CLASS.test(k)&&num(w,0,1),'Invalid range entry '+k+'.');}assert(s.stack>0,'Invalid stack.');
  for(const who of ['ip','oop']){assert(s.sizes&&s.sizes[who],'Missing bet sizes.');for(const [street,book]of Object.entries(s.sizes[who])){assert(STREETS.indexOf(street)>=s.board.length-3,'Invalid street '+street+'.');for(const k of ['bet','raise','donk'])assert(Array.isArray(book[k])&&book[k].length<=6&&book[k].every(x=>num(x,.01,10000)),'Invalid '+k+' sizes.');}}
  assert(num(s.allinThreshold,.1,100),'Invalid all-in threshold.');
  assert(num(s.accuracy,.1,5)&&Number.isInteger(s.maxIterations)&&num(s.maxIterations,10,1000),'Invalid accuracy settings.');
  assert(Array.isArray(s.path)&&s.path.length<=12&&s.path.every(p=>['check','call','bet','raise'].includes(p.kind)&&(p.amount===undefined||num(p.amount,0,1e8))),'Invalid action path.');
  assert(typeof s.hero==='string'&&COMBO.test(s.hero),'Invalid hero hand.');
  return s;
 }

 function input(s,{threads=4,output='output_result.json'}={}){
  if(s&&s.game==='PLO4')return inputPLO(s,arguments[1]);
  if(s&&s.game==='NLH3')return inputMW(s,arguments[1]);
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
 // TexasSolver plays for chips: say so when the table pays prizes, bounties or rake.
 function chipCaveat(config){const notes=[config.mode!=='cash'&&'tournament prizes (ICM)',config.bounties?.some(x=>x>0)&&'bounties',config.rakePct>0&&'rake'].filter(Boolean);return notes.length?' These are chip-EV frequencies: the solve ignores '+notes.join(', ')+'.':'';}
 function mapActions(hand,node,row,spec){
  const legal=hand.legal(),paid=hand.streetPaid[hand.actor],actions=[],probs=[],index=[];
  node.actions.forEach((label,i)=>{
   const [kind,amount]=label.split(' ');let action;
   if(kind==='FOLD')action={kind:'fold',label:'Fold'};
   else if(kind==='CHECK')action={kind:'check',label:'Check'};
   else if(kind==='CALL')action={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'};
   // Amounts below the minimum bet or raise go up to it; the effective all-in
   // stays all-in for whoever is shorter, or puts the shorter player all-in.
   else{const k=hand.currentBet?'raise':'bet',want=paid+Math.round(parseFloat(amount)),jam=!!spec&&want>=spec.stack,target=Math.min(legal.allInTo,Math.max(want,k==='raise'?legal.minRaiseTo:Math.max(want,G.units(hand.config.bb))));action={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':jam?' · puts the opponent all-in':'')};}
   action.id=action.kind+':'+(action.target||0);
   const same=actions.findIndex(a=>a.id===action.id);index.push(same>=0?same:actions.length);if(same>=0)probs[same]+=row[i];else{actions.push(action);probs.push(row[i]);}
  });
  const total=probs.reduce((a,b)=>a+b,0);return{actions,probs:probs.map(p=>p/total),index};
 }
 // The acting player's whole range at this decision: each hand class's average action mix over its combos, in the
 // order of the mapped actions (index maps solver actions onto them). For the range grid.
 function classMix(table,index,size){
  const sum={},count={};
  for(const [combo,row]of Object.entries(table)){const cs=C.cards(combo);if(cs.length!==2||!Array.isArray(row))continue;const k=C.handClass(cs),t=row.reduce((a,b)=>a+b,0);if(!(t>0))continue;const m=sum[k]||(sum[k]=Array(size).fill(0));row.forEach((p,i)=>{m[index[i]]+=p/t;});count[k]=(count[k]||0)+1;}
  const out={};for(const k in sum)out[k]=sum[k].map(x=>Math.round(x/count[k]*1000)/1000);return out;
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
  const cash=engine.hand.config.mode==='cash',{actions,probs,mean}=mapPLO(engine.hand,node,node.strategy[index],node.evs[index]),hasEV=cash&&mean.every(Number.isFinite),values=hasEV?mean:actions.map(()=>0),best=hasEV?values.indexOf(Math.max(...values)):probs.indexOf(Math.max(...probs)),zeros=actions.map(()=>0),converged=Number.isFinite(tree.exploitability)&&tree.exploitability<=s.accuracy,adjusted=(node.adjusted||[]).includes(index);
  return{supported:true,actions,reference:probs,mean:values,se:zeros,loss:hasEV?values.map(v=>values[best]-v):zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:cash?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),reliable:hasEV&&converged,
   solve:{version:1,method:'local-plo',exact:false,approximate:false,iterations:tree.iterations,exploitability:tree.exploitability,seconds:tree.seconds,memoryMB:tree.memoryEstimateMB,converged,evAvailable:hasEV,heroReach:node.reach[index],bestEVRow:adjusted,treeReduced:tree.treeReduced,raiseCaps:tree.caps,suitSymmetries:tree.suitSymmetries,rangeAssumptions:engine.ranges.descriptions,rangeCombos:[Object.keys(s.rangeOop).length,Object.keys(s.rangeIp).length],
    actionTree:{betSizes:s.sizes[STREETS[s.board.length-3]][s.heroIsIp?'ip':'oop'].bet,raiseSizes:[1],potLimit:true,maxRaises:tree.caps[s.board.length-3],jam:true},
    warning:'Solved by the PLO solver on this computer for the combos shown, with one bet size and pot-sized raises on every later street. Exploitability is measured exactly, in percent of the pot.'+(hasEV?' EVs are in bb from this decision, before rake.':' EVs are chip values, not prize units, so they are not shown.')+(tree.treeReduced?' Raise caps were lowered to fit memory.':'')+(converged?'':' The solve stopped before reaching its accuracy target.')+(adjusted?' This line is rare in the solved strategy for your hand and its mix had not settled, so the best-EV action is shown.':'')}};
 }

 // The 3-way solver's tree has the PLO solver's shape (actions with street totals). No-limit amounts: the
 // solver plays everyone at the smallest stack, so its all-in is clamped to this player's legal range.
 const followMW=followPLO;
 function mapMW(hand,node,row,evs){
  const legal=hand.legal(),paid=hand.streetPaid[hand.actor],actions=[],probs=[],mean=[],index=[];
  node.actions.forEach((x,i)=>{
   let action;
   if(x.kind==='fold')action={kind:'fold',label:'Fold'};
   else if(x.kind==='check')action={kind:'check',label:'Check'};
   else if(x.kind==='call')action={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'};
   else{const top=Math.min(legal.maxRaiseTo,legal.allInTo),target=Math.min(top,Math.max(legal.minRaiseTo,Math.round(x.to))),k=hand.currentBet?'raise':'bet';action={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':'')};}
   action.id=action.kind+':'+(action.target||0);const ev=evs?G.bb(evs[i]+paid):null;
   const same=actions.findIndex(a=>a.id===action.id);index.push(same>=0?same:actions.length);if(same>=0){probs[same]+=row[i];if(ev!==null&&ev>mean[same])mean[same]=ev;}else{actions.push(action);probs.push(row[i]);mean.push(ev);}
  });
  const total=probs.reduce((a,b)=>a+b,0);return{actions,probs:probs.map(p=>p/total),mean,index};
 }
 function resultMW(engine){
  const s=engine.spec,tree=engine.body.tree,node=followMW(tree.tree,s.path),player=node.player,index=tree.combos[player].indexOf(s.hero);
  assert(player===s.heroIndex&&index>=0,'The solver strategy does not include your hand.');
  const cash=engine.hand.config.mode==='cash',{actions,probs,mean,index:map}=mapMW(engine.hand,node,node.strategy[index],node.evs[index]),hasEV=cash&&mean.every(Number.isFinite),values=hasEV?mean:actions.map(()=>0),best=hasEV?values.indexOf(Math.max(...values)):probs.indexOf(Math.max(...probs)),zeros=actions.map(()=>0),converged=Number.isFinite(tree.exploitability)&&tree.exploitability<=s.accuracy,adjusted=(node.adjusted||[]).includes(index);
  let handMix=null;try{const table={};tree.combos[player].forEach((c,i)=>{table[c]=node.strategy[i];});handMix={seat:engine.hand.actor,classes:classMix(table,map,actions.length)};}catch{}
  const street=STREETS[s.board.length-3],book=s.sizes[street],shortest=Math.min(...s.seats.map(i=>engine.hand.stacks[i]+engine.hand.streetPaid[i]))<Math.max(...s.seats.map(i=>engine.hand.stacks[i]+engine.hand.streetPaid[i]));
  return{supported:true,actions,reference:probs,mean:values,se:zeros,loss:hasEV?values.map(v=>values[best]-v):zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:cash?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),reliable:hasEV&&converged,...handMix?{handMix}:{},
   solve:{version:1,method:'local-multiway',exact:false,approximate:false,iterations:tree.iterations,exploitability:tree.exploitability,seconds:tree.seconds,memoryMB:tree.memoryEstimateMB,converged,evAvailable:hasEV,heroReach:node.reach[index],bestEVRow:adjusted,sampledRunouts:tree.sampledRunouts,turnCards:tree.turnCards,riverCards:tree.riverCards,suitSymmetries:tree.suitSymmetries,rangeAssumptions:engine.ranges.descriptions,rangeCombos:s.ranges.map(r=>Object.keys(r).length),
    actionTree:{betSizes:book.bet,raiseSizes:book.raise,maxRaises:s.caps[street],jam:true},
    warning:'Solved by the 3-way solver on this computer for the ranges shown, with bets of '+book.bet.map(x=>Math.round(100*x)+'%').join(', ')+' of the pot and all-in on this street'+(s.board.length===3?', and one size (2/3 of the pot) on the turn and river':'')+'. Exploitability is the average gain of a best response for each player, in percent of the pot. Card removal between your two opponents is treated as independent.'+(tree.sampledRunouts?' To fit memory, '+tree.chance+' were dealt instead of every card.':'')+(shortest?' All three play the smallest stack.':'')+(hasEV?' EVs are in bb from this decision, before rake.':' EVs are chip values, not prize units, so they are not shown.')+(converged?'':' The solve stopped before reaching its accuracy target.')+(adjusted?' This line is rare in the solved strategy for your hand and its mix had not settled, so the best-EV action is shown.':'')}};
 }

 // Worker engine: one HTTP request, then complete. step() never blocks.
 class Engine{
  constructor(data,ranges,opt,hand,fetcher,custom=false){
   this.data=data;this.hand=hand;this.ranges=ranges;this.url=(opt.localSolver||DEFAULT_URL).replace(/\/$/,'');this.spec=custom?null:spec(data,ranges,opt);this.complete=false;this.waiting=false;this.started=Date.now();this.fetch=fetcher||(typeof fetch==='function'?fetch.bind(root):null);
  }
  step(){
   if(this.waiting||this.complete)return;this.waiting=true;
   if(!this.fetch){this.fail('This browser cannot reach the local solver.');return;}
   const reply=r=>r.json().catch(()=>({error:'The local solver sent an unreadable reply ('+r.status+').'})).then(body=>{if(!r.ok)throw Object.assign(Error(body.error||('Local solver error '+r.status)),{http:true});return body;});
   const done=body=>{clearInterval(this.poll);this.body=body;this.complete=true;this.waiting=false;};
   const failed=error=>{clearInterval(this.poll);this.fail(!error.http?'The local solver is not running on this computer at '+this.url+'. Start it with tools/local-solver/start.command, or turn it off under Analysis settings.':error.message);};
   const post=path=>this.fetch(this.url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(this.spec)});
   // Long solves run in the background on the bridge and the result is collected by
   // polling, so no request stays open for minutes; an older bridge only has /solve.
   let polling=false;
   this.poll=setInterval(()=>{this.fetch(this.url+'/status').then(r=>r.json()).then(s=>{this.status=s;}).catch(()=>{});
    if(!polling||this.complete)return;this.fetch(this.url+'/result').then(r=>r.status===202?null:reply(r)).then(body=>{if(body&&!this.complete)done(body);},error=>{if(error.http)failed(error);});},3000);
   post(this.asyncPath||'/solve-async').then(r=>{if(r.status===404){if(this.asyncPath)throw Object.assign(Error('The local solver on this computer is out of date. Update it (git pull) and restart it to solve multiway spots.'),{http:true});return post('/solve').then(reply).then(done);}return reply(r).then(()=>{polling=true;});}).catch(failed);
  }
  fail(message){this.error=message;this.complete=true;this.waiting=false;}
  cancel(){clearInterval(this.poll);if(this.waiting&&this.fetch)this.fetch(this.url+'/cancel',{method:'POST'}).catch(()=>{});}
  progress(){if(this.complete)clearInterval(this.poll);const s=this.status||{};return{phase:'local',done:Math.round((Date.now()-this.started)/1000),total:0,iterations:s.iterations||0,exploitability:s.exploitability??null};}
  result(){
   if(this.error)return{supported:false,message:'Local solver: '+this.error};
   if(this.spec.game==='PLO4')return resultPLO(this);
   if(this.spec.game==='NLH3')return resultMW(this);
   const node=follow(this.body.tree,this.spec.path),row=heroRow(node,this.spec.hero),{actions,probs,index}=mapActions(this.hand,node,row,this.spec),best=probs.indexOf(Math.max(...probs)),zeros=actions.map(()=>0);let handMix=null;try{handMix={seat:this.hand.actor,classes:classMix(node.strategy.strategy,index,actions.length)};}catch{}
   return{supported:true,actions,reference:probs,mean:zeros,se:zeros,loss:zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:this.hand.config.mode==='cash'?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),...handMix?{handMix}:{},
    solve:{version:1,method:'local-texassolver',exact:false,approximate:false,iterations:this.body.iterations||0,exploitability:this.body.exploitability,seconds:this.body.seconds,rangeAssumptions:this.ranges.descriptions,actionTree:{betSizes:this.spec.sizes[this.spec.heroIsIp?'ip':'oop'][STREETS[this.spec.board.length-3]].bet.map(x=>x/100),raiseSizes:this.spec.sizes.ip[STREETS[this.spec.board.length-3]].raise.map(x=>x/100),maxAggressions:4,jam:true},
     warning:'Solved by TexasSolver on this computer for the ranges shown, with the listed bet sizes on every later street. Exploitability is the solver\'s own estimate, in percent of the pot. It does not report action EVs, so no decision cost is graded.'+chipCaveat(this.hand.config)}};
  }
 }

 // Multiway spots (three or more players, flop on) run on the bridge in Node
 // with the app's own exact and sampled engines, with budgets far beyond a
 // browser tab's. Each seat's current range is sent as weighted combos.
 class SpotEngine extends Engine{
  constructor(data,ranges,opt,extra,fetcher){
   const C=G.Core;super(data,ranges,{...opt},null,fetcher,true);
   const text=seat=>{const d=ranges.distributions[seat];if(d.uniform)return'';const peak=Math.max(...d.rows.map(r=>r.prob));return d.rows.filter(r=>r.prob>0).map(r=>r.cards.map(C.cardName).join('')+':'+Math.max(1e-5,Math.round(r.prob/peak*1e5)/1e5)).join(' ');};
   this.asyncPath='/spot-async';
   this.spec={data,extra:extra||null,options:{rangeMode:'uniform',ranges:Array.from({length:data.config.seats},(_,s)=>text(s)),iterations:5e6,milliseconds:opt.bridgeMilliseconds||600000,maxInfos:1e7,maxJointDeals:5e7,exactMemoryMB:65536,samples:Math.max(2000,opt.samples||2000),tolerance:opt.tolerance,rootSizes:opt.rootSizes,abstraction:opt.abstraction}};
  }
  progress(){if(this.complete)clearInterval(this.poll);const s=this.status||{};return{phase:'local',done:Math.round((Date.now()-this.started)/1000),total:Math.round((this.spec.options.milliseconds||0)/1000),iterations:s.iterations||0,exploitability:s.exploitability??null};}
  result(){
   if(this.error)return{supported:false,message:'Local solver: '+this.error};
   const r=this.body;if(r?.solve){r.solve.rangeAssumptions=this.ranges.descriptions;r.solve.solvedOn='This computer (local solver)';}
   return r?.supported===false?{...r,message:'Solved on this computer: '+r.message}:r;
  }
 }

 // Preflop lines no chart covers: the bridge solves the whole preflop game with this line in its tree
 // (tools/preflop/spot.cjs), playing three-way flop pots out with the 3-way solver, and answers by hand class.
 class PreflopEngine extends Engine{
  constructor(data,opt,fetcher){
   super(data,null,{...opt},null,fetcher,true);this.hand=G.replay(data.config,data.actions,{holes:{[data.actor]:data.heroCards}});this.asyncPath='/preflop-async';
   this.spec={spot:{config:data.config,actions:data.actions.map(a=>({seat:a.seat,street:a.street,kind:a.kind,target:a.target})),actor:data.actor,heroCards:data.heroCards.slice()},effort:opt.preflopEffort||'standard'};
  }
  progress(){if(this.complete)clearInterval(this.poll);const s=this.status||{};return{phase:'local',done:Math.round((Date.now()-this.started)/1000),total:0,iterations:s.iterations||0,exploitability:null,fraction:s.fraction??null,remaining:s.remaining??null};}
  result(){
   if(this.error)return{supported:false,message:'Local solver: '+this.error};
   try{return preflopResult(this.hand,this.body);}catch(error){return{supported:false,message:'Local solver: '+error.message};}
  }
 }
 // The spot solver's answer in the app's terms: its actions at this table's legal sizes (merged where two land on
 // the same size), your hand class's frequencies, every class's mix and each live player's range at this spot.
 function preflopResult(hand,body){
  assert(body&&Array.isArray(body.actions)&&Array.isArray(body.hero)&&body.classes&&typeof body.classes==='object','The preflop solver sent an unreadable answer.');
  const legal=hand.legal(),c=hand.config,n=hand.n,top=Math.min(legal.maxRaiseTo,legal.allInTo),actions=[],probs=[],index=[];
  body.actions.forEach((x,i)=>{
   let a;if(x.kind==='fold')a={kind:'fold',label:'Fold'};else if(x.kind==='check'||x.kind==='call'&&!legal.callCost)a={kind:'check',label:'Check'};else if(x.kind==='call')a={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'+(legal.callCost>=hand.stacks[hand.actor]?' · all-in':'')};
   else{const k=hand.currentBet?'raise':'bet',jam=x.to>=body.stack-1e-6,target=jam?top:Math.min(top,Math.max(legal.minRaiseTo,Math.round(x.to*c.bb*100)));a={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':'')};}
   a.id=a.kind+':'+(a.target||0);const same=actions.findIndex(b=>b.id===a.id);index.push(same>=0?same:actions.length);if(same>=0)probs[same]+=body.hero[i];else{actions.push(a);probs.push(body.hero[i]);}
  });
  const total=probs.reduce((s,x)=>s+x,0);assert(total>0,'The preflop solver has no strategy for your hand.');
  const classes={};for(const [name,row]of Object.entries(body.classes)){const m=actions.map(()=>0);row.forEach((p,k)=>{m[index[k]]+=p;});const t=m.reduce((s,x)=>s+x,0);if(t>0)classes[name]=m.map(x=>Math.round(x/t*1000)/1000);}
  const order=body.classOrder,combos=k=>k.length===2?6:k[2]==='s'?4:12,source='Solved on your Mac from this preflop line',rangeAssumptions=[];
  for(const [rel,w]of Object.entries(body.ranges||{})){const seat=(+rel+hand.button)%n,peak=Math.max(...w);if(!(peak>0)||hand.folded[seat])continue;
   const text=order.map((k,i)=>[k,w[i]/peak]).filter(([,x])=>x>=.002).map(([k,x])=>x>=.9995?k:k+':'+(Math.round(x*1000)/1000)).join(',');
   rangeAssumptions.push({seat,range:text,combinations:Math.round(order.reduce((s,k,i)=>s+combos(k)*w[i]/peak,0)),source});}
  const zeros=actions.map(()=>0),reference=probs.map(p=>p/total),best=reference.indexOf(Math.max(...reference)),three=(body.threeWay||[]).filter(t=>t.fit);
  const notes=['Solved by the preflop solver on your Mac for this exact line, with the chart model (flop pots are paid by an equity-realization model, not played out)'+(three.length?'; '+three.length+' three-way flop pot'+(three.length>1?'s were':' was')+' played out on '+three.map(t=>t.flops).join('/')+' sample flops by the 3-way solver to fit that model':'')+'.',
   body.unequalStacks?'Everyone plays the effective stack of '+Math.round(body.stack*10)/10+' bb.':null,
   'Players\' earlier actions that the usual charts leave out are played by the same ranges that continue there.',chipCaveat(c).trim()||null].filter(Boolean);
  return{supported:true,actions,reference,mean:zeros,se:zeros,loss:zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:c.mode==='cash'?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),handMix:{seat:hand.actor,classes},
   solve:{version:1,method:'local-preflop',exact:false,approximate:false,iterations:body.iterations,exploitability:body.nashConv,seconds:body.seconds,effort:body.effort,threeWay:body.threeWay,rangeAssumptions,solvedOn:'This computer (local solver)',warning:notes.join(' ')}};
 }

 const api={DEFAULT_URL,spec,validate,input,follow,heroRow,mapActions,followPLO,mapPLO,followMW,mapMW,mwRunouts,Engine,SpotEngine,PreflopEngine,preflopResult,betPercent,raisePercent,PLO_TREE,MW_TREE};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerLocalSolver=api;
})(typeof globalThis!=='undefined'?globalThis:this);
