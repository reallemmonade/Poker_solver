// "Why?" under a solved postflop spot: a few plain-language reasons the strategy looks the way it does, worked out
// from the two ranges, the board, the stack-to-pot ratio, position and the hero's own cards. Hidden until tapped
// (Maxam wants minimal text on screen); the open state is remembered on this device.
(function(root){
 'use strict';
 const RANKS='23456789TJQKA',NAMES=['two','three','four','five','six','seven','eight','nine','ten','jack','queen','king','ace'],PLURAL=['twos','threes','fours','fives','sixes','sevens','eights','nines','tens','jacks','queens','kings','aces'],SUIT='♣♦♥♠';
 const rank=c=>c>>2,suit=c=>c&3,cardText=c=>RANKS[rank(c)]+SUIT[suit(c)]+'\uFE0E';
 const pct=x=>{const v=x*100;return v>0&&v<1?'<1%':Math.round(v)+'%';};
 function straightIn(m){for(let hi=13;hi>=4;hi--)if(((m>>(hi-4))&31)===31)return hi;return 0;}
 // Ranks as a bit mask, the ace also counted low (bit 13 is the ace, bit 0 the low ace via straightIn).
 const maskOf=cs=>cs.reduce((m,c)=>m|1<<(rank(c)+1),0)|(cs.some(c=>rank(c)===12)?1:0);

 // What a two-card hand has on this board: cat is strong (two pair or better), top (top pair or an overpair),
 // pair (any other pair that uses a hole card) or air; draws are flagged apart, before the river.
 function classify(hole,board){
  const all=hole.concat(board),hr=hole.map(rank),br=board.map(rank),top=Math.max(...br),count=r=>all.filter(c=>rank(c)===r).length,onBoard=r=>br.filter(x=>x===r).length;
  let cat='air',made='';
  const flushSuit=[0,1,2,3].find(s=>all.filter(c=>suit(c)===s).length>=5&&hole.some(c=>suit(c)===s));
  const st=straightIn(maskOf(all)),boardSt=straightIn(maskOf(board));
  if(flushSuit!==undefined){cat='strong';made='a flush';}
  else if(st&&st>boardSt){cat='strong';made='a straight';}
  if(cat==='air'){
   if(hr[0]===hr[1]){const n=count(hr[0]);if(n>=3){cat='strong';made=n===4?'quads':'a set';}else if(hr[0]>top){cat='top';made='an overpair';}else{cat='pair';made=hr[0]<Math.min(...br)?'an underpair':'a middle pocket pair';}}
   else{const paired=hr.filter(r=>onBoard(r)>0);
    if(paired.some(r=>onBoard(r)>=2)){cat='strong';made=paired.some(r=>onBoard(r)>=3)?'quads':'trips';}
    else if(paired.length===2){cat='strong';made='two pair';}
    else if(paired.length===1){const r=paired[0],order=[...new Set(br)].sort((a,b)=>b-a),i=order.indexOf(r);cat=i===0?'top':'pair';made=i===0?'top pair':i===order.length-1?'bottom pair':'second pair';}
    else made=NAMES[Math.max(...hr)]+' high';}
  }
  let flushDraw=false,nutFlushDraw=false,straightDraw='';
  if(board.length<5&&flushSuit===undefined){
   for(let s=0;s<4;s++){const n=all.filter(c=>suit(c)===s).length;if(n===4&&hole.some(c=>suit(c)===s)){flushDraw=true;const missing=[...Array(13).keys()].reverse().find(r=>!board.some(c=>suit(c)===s&&rank(c)===r));nutFlushDraw=hole.some(c=>suit(c)===s&&rank(c)===missing);}}
   if(!st){const m=maskOf(all);let outs=0;for(let r=0;r<13;r++){if(m&(1<<(r+1)))continue;const w=straightIn(m|1<<(r+1)|(r===12?1:0));if(w&&w>straightIn(maskOf(board.concat([r*4]))))outs++;}straightDraw=outs>=2?'open':outs===1?'gutshot':'';}
  }
  return{cat,made,flushDraw,nutFlushDraw,straightDraw,draw:flushDraw||straightDraw==='open'};
 }

 // Weighted share of each category in a range (rows: {cards, weight}); hands blocked by dead cards are left out.
 function profile(rows,board,dead=[]){
  const out={strong:0,top:0,pair:0,air:0,draw:0,total:0},deadSet=new Set(dead);
  for(const r of rows){if(!(r.weight>0)||r.cards.some(c=>deadSet.has(c)))continue;const k=classify(r.cards,board);out[k.cat]+=r.weight;if(k.draw)out.draw+=r.weight;out.total+=r.weight;}
  if(out.total>0)for(const k of ['strong','top','pair','air','draw'])out[k]/=out.total;
  out.topPlus=out.strong+out.top;return out;
 }

 function textureWords(board){
  const rs=board.map(rank),suits=[0,1,2,3].map(s=>board.filter(c=>suit(c)===s).length),most=Math.max(...suits),distinct=[...new Set(rs)].sort((a,b)=>a-b),words=[];
  const paired=distinct.length<rs.length,flop=board.slice(0,3);
  if(board.length===3)words.push(most===3?'monotone':most===2?'two-tone':'rainbow');else if(most>=3)words.push(most>=4?'four to a flush':'three to a flush');
  if(paired)words.push('paired');
  // Connected: three distinct ranks inside a five-rank window (a straight is possible), or two within one gap.
  let connected=false;for(let i=0;i+2<distinct.length;i++)if(distinct[i+2]-distinct[i]<=4)connected=true;
  if(!connected&&distinct.length>=2&&distinct.some((r,i)=>i&&r-distinct[i-1]<=2&&r>=6))connected=true;
  if(connected)words.push('connected');
  const wet=most>=2&&board.length===3||connected,high=Math.max(...rs);
  return{words,wet:!!wet,dry:!connected&&most<2&&!paired,highName:NAMES[high]+'-high',high,flop};
 }

 // Range-wide action frequencies from per-class mixes, weighted by how often the range holds each class.
 function rangeFrequencies(rows,mix,actions,dead){
  const C=root.PokerGame?.Core,freq=actions.map(()=>0),deadSet=new Set(dead);let total=0;
  for(const r of rows){if(!(r.weight>0)||r.cards.some(c=>deadSet.has(c)))continue;const k=C?C.handClass(r.cards):null,m=k&&mix[k];if(!m)continue;m.forEach((p,i)=>{freq[i]+=r.weight*(p||0);});total+=r.weight;}
  return total>0?freq.map(x=>x/total):null;
 }

 // Which hands take each action: for every action, the share of it that comes from each hand group (strong = two pair+,
 // top = top pair/overpair, pair = weaker pairs, draw = no pair but a flush or open-ended draw, air = the rest).
 function actionMakeup(rows,mix,actions,board){
  const C=root.PokerGame?.Core,deadSet=new Set(board),by=actions.map(()=>({strong:0,top:0,pair:0,draw:0,air:0,w:0}));if(!C)return null;
  for(const r of rows){if(!(r.weight>0)||r.cards.some(c=>deadSet.has(c)))continue;const m=mix[C.handClass(r.cards)];if(!m)continue;
   const k=classify(r.cards,board),cat=k.cat==='air'&&k.draw?'draw':k.cat;m.forEach((p,i)=>{const w=r.weight*(p||0);by[i][cat]+=w;by[i].w+=w;});}
  for(const o of by)if(o.w>0)for(const c of ['strong','top','pair','draw','air'])o[c]/=o.w;
  return by;
 }

 const aggressive=a=>a.kind==='bet'||a.kind==='raise';
 const GROUP={strong:'two pair or better',top:'top pair',pair:'weaker pairs',draw:'draws',air:'weak hands'};
 // The one or two hand groups that make up most of an action, in words.
 function mostly(o){const g=['strong','top','pair','draw','air'].filter(c=>o[c]>=.25).sort((a,b)=>o[b]-o[a]).slice(0,2);return g.length?g.map(c=>GROUP[c]).join(' and '):'a mix of hands';}

 // One short reason per action the solver considers, plus why the hero's own hand plays as it does.
 // input: {board, hero, heroIsIp, spr, actions, tones, labels, heroMix, mine, theirs, mix, heroClass, heroWeight};
 // mine/theirs are range rows, mix maps hand class -> action mix. Frequencies are on screen already, so none here.
 function reasons(x){
  const out=[],A=x.actions,labels=x.labels,board=x.board,facing=A.some(a=>a.kind==='fold'||a.kind==='call'),river=board.length>=5;
  const freq=x.mine&&x.mix?rangeFrequencies(x.mine,x.mix,A,board):null,makeup=freq?actionMakeup(x.mine,x.mix,A,board):null;
  const spr=x.spr>0?(x.spr<10?Math.round(x.spr*10)/10:Math.round(x.spr)):null;
  let edge=0;// +1 the board favours you (more top pair+ and two pair+), -1 them
  if(x.mine&&x.theirs){const me=profile(x.mine,board,[]),them=profile(x.theirs,board,x.hero||[]);
   if(me.total>0&&them.total>0){const d=me.topPlus-them.topPlus,n=me.strong-them.strong;edge=d>=.04&&n>-.03?1:d<=-.04&&n<.03?-1:n>=.05&&d>-.04?1:n<=-.05&&d<.04?-1:0;}}
  // The hero's hand first.
  if(x.hero?.length===2){
   const k=classify(x.hero,board),bits=[k.made],draw=k.nutFlushDraw?'the nut flush draw':k.flushDraw?'a flush draw':k.straightDraw==='open'?'an open-ended straight draw':k.straightDraw==='gutshot'?'a gutshot':'';
   if(draw)bits.push(draw);
   const flushSuits=[0,1,2,3].filter(s=>board.filter(c=>suit(c)===s).length>=2),topRank=Math.max(...board.map(rank));let block='';
   for(const c of x.hero){if(!block&&!k.flushDraw&&k.cat!=='strong'&&rank(c)===12&&flushSuits.includes(suit(c)))block='blocks their nut flush draws';if(!block&&k.cat==='air'&&rank(c)===topRank)block='blocks some of their top pairs';}
   let t='Your '+x.hero.map(cardText).join('')+': '+bits.join(' with ')+(block?', '+block:'');
   if(x.heroMix){
    const order=x.heroMix.map((p,i)=>[p,i]).sort((a,b)=>b[0]-a[0]),main=A[order[0][1]],kind=aggressive(main)?(facing?'raise':'bet'):main.kind,c=k.cat,made=c!=='air',live=!!draw&&!river;
    let why='';
    if(kind==='bet'||kind==='raise')why=c==='strong'||c==='top'?'strong enough to '+kind+' for value: worse hands still call':c==='pair'?kind+'s thin for value: worse pairs'+(river?'':' and draws')+' still call':live?kind+'s as a semi-bluff: it can improve if called':kind+'s as a bluff: it rarely wins at showdown'+(block?', and its blocker makes their strong hands less likely':'');
    else if(kind==='check')why=c==='strong'?'checks to trap: it keeps their bluffs and weaker hands in':live&&!made?'checks to see the next card free: a bet gets called mostly by hands that beat it':c==='top'||c==='pair'?'checks: it often wins at showdown, but worse hands won’t call a bet':river?'gives up: worse hands fold to a bet and better ones call':'checks: worse hands fold and better ones call, so a bet does little';
    else if(kind==='call')why=made?'calls: it beats enough of their bluffs to pay off':live?'calls: the price is right to draw':'calls as a bluff-catcher: it beats their missed draws';
    else if(kind==='fold')why='folds: it loses to most of their betting range';
    if(why)t+='. '+why[0].toUpperCase()+why.slice(1);
    if(order[1]&&order[1][0]>=.25)t+='. '+labels[order[1][1]]+' is close';
   }
   out.push({k:'hand',t:t+'.'});
  }
  // One line per action.
  if(freq&&makeup){
   const ranked=A.map((a,i)=>i);
   for(const i of ranked){
    const a=A[i],f=freq[i],o=makeup[i],tone=x.tones?.[i]||'',rare=f<.03,size=tone==='allin'||/all-in/i.test(labels[i]||'')?'jam':tone==='bet1'?'small':tone==='bet3'?'over':'big';
    const value=o.strong+o.top,bluff=o.draw+o.air;let t='';
    if(a.kind==='check'){
     const CHECK={strong:'two pair or better traps, so their bluffs stay in',top:'top pair wins at showdown but worse hands won’t call a bet',pair:'weaker pairs win at showdown but worse hands won’t call a bet',draw:river?'missed draws give up':'draws take a free card',air:'weak hands give up cheaply'};
     const g=['strong','top','pair','draw','air'].filter(c=>o[c]>=.2).sort((a,b)=>o[b]-o[a]).slice(0,2);
     t=rare?'Almost never: your hands gain more by betting.':(g.length?g:['air']).map(c=>CHECK[c]).join('; ')+(!g.includes('strong')&&o.strong>=.08?'. Some strong hands check too, so your checks aren’t all weak':'')+'.';
    }else if(a.kind==='fold')t=rare?'Almost never: your range is strong enough to continue.':'Hands that lose to their value bets and can’t draw out.';
    else if(a.kind==='call')t=rare?'Almost never: hands either fold or raise here.':mostly(o)+': they beat enough of their bluffs'+(o.draw>=.25&&!river?' or can draw out':'')+', but raising only gets called by better.';
    else if(size==='jam'){
     t=rare?(spr&&spr>2.5?'Barely used: at SPR '+spr+' an all-in risks a lot to win the pot, and strong hands get more from smaller bets.':'Barely used: a smaller bet does the same job.'):'Stacks are short: '+mostly(o)+' get it in now'+(o.draw>=.15&&!river?', and draws still have outs if called':'')+'.';
    }else{
     const verb=a.kind==='raise'?'raise':'bet';
     if(rare)t=size==='over'?'Barely used: too few very strong hands to '+verb+' this big.':size==='small'?'Barely used: your hands either want a bigger '+verb+' or a check.':'Barely used: the other sizes do this job better.';
     else if(value>=.3&&bluff>=.3)t='Value with '+mostly({strong:o.strong,top:o.top})+', bluffs with '+mostly({draw:o.draw,air:o.air})+(size==='small'?': cheap to bluff, and worse hands still call':size==='over'?': you have more of the very strong hands, so the big size makes them pay':': a bigger size gets more from the value and more folds from the bluffs')+'.';
     else if(value>=.5)t=mostly(o)+(size==='small'?': '+(river?'thin value from worse hands that call small':'cheap value that also charges their draws'):': strong enough to grow the pot')+'.';
     else if(bluff>=.5)t=mostly({draw:o.draw,air:o.air})+(o.draw>=o.air&&!river?': semi-bluffs that win by folds or by improving':': bluffs that rarely win at showdown, so they win by folds')+(size==='small'?', and a small bet is cheap':'')+'.';
     else t=mostly(o)+(size==='small'?': a cheap '+verb+' many hands can make'+(edge>0?', since the board favours you':''):': '+verb+'s to deny equity and build the pot')+'.';
    }
    if(t)out.push({k:'opt',label:labels[i],t:t[0].toUpperCase()+t.slice(1)});
   }
  }
  if(x.heroWeight!=null&&x.heroWeight<.02)out.push({k:'rare',t:'Your preflop chart almost never gets '+x.heroClass+' here, so this hand’s advice is less settled.'});
  return out;
 }

 // One short line on why the solver's main play is right for this hand, shown under every graded result.
 // x: {hand:'K5s', main:'fold'|'call'|'raise'|'bet'|'check', need (equity a call needs), eq (hand vs their range),
 //     vs:'SB', ip, dominated (share of their range that dominates this hand), blocks, plays (share of hands this seat
 //     plays here, first in; pos is its seat name), top (hand's rank among all starting hands)}.
 function decisionLine(x){
  const P=v=>v>0&&v<.01?'<1%':Math.round(v*100)+'%',dom=x.dominated>=.15?' · '+P(x.dominated)+' of their range dominates it':'';
  if(x.need>0&&x.eq!=null){
   const base=(x.main==='call'||x.main==='fold'?'Call needs '+P(x.need)+' · ':'')+x.hand+' has '+P(x.eq)+' vs '+x.vs+'’s range';
   if(x.main==='call')return base+(x.eq>=x.need-.005?' · enough to call':x.ip?' · position makes up the rest':' · money behind makes up the rest');
   if(x.main==='fold')return base+(x.eq<x.need?' · not enough':x.ip?' · won’t realize it all':' · out of position, won’t realize it')+dom;
   if(x.main==='raise'||x.main==='bet')return base+(x.eq>=.5?' · ahead, raise for value':' · raise wins it now'+(x.blocks?', and blocks their best hands':''));
  }
  if(x.plays!=null&&x.top!=null){const verb=x.main==='fold'?'folds':x.main==='call'?'calls':x.main==='check'?'checks':'raises';return x.pos+' plays '+P(x.plays)+' here · '+x.hand+(x.top<=.5||x.bottom==null?' is top '+P(x.top):' is bottom '+P(x.bottom))+' · '+verb;}
  return'';
 }

 const api={classify,profile,textureWords,rangeFrequencies,reasons,decisionLine};
 root.SpotWhy=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

if(typeof document!=='undefined'){
 const WHY_KEY='guava-why-open';
 // Remember the last open/closed state on this device.
 document.addEventListener('toggle',e=>{const d=e.target;if(d?.classList?.contains('spot-why'))try{localStorage.setItem(WHY_KEY,d.open?'1':'0');}catch{}},true);
 // The one-line reason under a graded result (guess reveal, Why?): pot odds against their range when facing a bet or
 // raise, how wide this seat plays first in, else the hand line of the postflop Why?. Works on any hand frame (live or replay).
 const whyMemo=new WeakMap();
 globalThis.decisionWhy=function(h,result){
  try{
   if(!h||h.done||!result?.supported||h.rules?.hole>2||h.config?.variant!=='NLH')return'';
   const seat=h.actor,hole=h.holes?.[seat];if(hole?.length!==2)return'';
   const probs=result.reference||[],A=result.actions||[];if(!A.length||!probs.length)return'';
   const memoKey=h.actionLog.length+'|'+A.map(a=>a.label).join()+'|'+probs.join(),m=whyMemo.get(result);if(m&&m.k===memoKey)return m.t;
   const best=probs.indexOf(Math.max(...probs.map(p=>p||0))),main=A[best]?.kind==='bet'||A[best]?.kind==='raise'?'raise':A[best]?.kind,C=G.Core,hand=C.handClass(hole);
   const l=h.legal(),names=G.positions(h.n,h.button),living=h.living(),after=i=>(i-h.button+h.n)%h.n||h.n,ip=living.slice().sort((a,b)=>after(a)-after(b)).pop()===seat;
   const firstIn=h.street===0&&h.currentBet<=G.units(h.config.bb);let t='';
   if(firstIn&&result.handMix?.classes){
    // Share of all starting hands this seat plays (anything but fold) here, and where the hand sits among them.
    const mix=result.handMix.classes,fold=A.findIndex(a=>a.kind==='fold');let all=0,play=0;
    for(const [k,p]of Object.entries(mix)){const n=k.length===2?6:k[2]==='s'?4:12;all+=n;play+=n*(1-(fold>=0?(p?.[fold]||0):0));}
    const order=Array.isArray(G.preflopOrder)?G.preflopOrder:String(G.preflopOrder).split(/[\s,]+/);let cum=0;for(const k of order){cum+=k.length===2?6:k[2]==='s'?4:12;if(k===hand)break;}
    if(all>0&&order.includes(hand))t=SpotWhy.decisionLine({hand,main,pos:names[seat],plays:play/all,top:cum/1326,bottom:1-(cum-(hand.length===2?6:hand[2]==='s'?4:12))/1326});
   }else if(l.callCost>0&&typeof icmRange==='function'&&typeof icmEquity==='function'){
    const v=living.filter(i=>i!==seat).sort((a,b)=>h.streetPaid[b]-h.streetPaid[a])[0],range=v===undefined?null:icmRange(h,v,result),eq=range?icmEquity(h,seat,v,range):null;
    if(eq!==null){
     let dominated=0;const r=hole.map(c=>c>>2);
     if(h.street===0&&r[0]!==r[1]){let rows=[];try{rows=PokerSpot.parseRange(range,{hole:2},[]).filter(x=>x.weight>0&&!x.cards.some(c=>hole.includes(c)));}catch{}
      let w=0,d=0;for(const x of rows){const q=x.cards.map(c=>c>>2);w+=x.weight;if(q[0]===q[1])continue;const shared=r.find(k=>q.includes(k));if(shared===undefined)continue;const mine=r.find(k=>k!==shared),theirs=q.find(k=>k!==shared);if(theirs>mine)d+=x.weight;}
      dominated=w>0?d/w:0;}
     t=SpotWhy.decisionLine({hand,main,need:l.callCost/(h.pot+l.callCost),eq,vs:names[v],ip,dominated,blocks:h.street===0&&hole.some(c=>(c>>2)>=11)});
    }
   }
   if(!t&&h.board.length>=3){const list=spotWhyList(result,h,seat),line=list.find(x=>x.k==='hand');t=line?line.t.replace(/\.$/,''):'';}
   whyMemo.set(result,{k:memoKey,t});return t;
  }catch(error){return'';}
 };
 // The postflop reasons for a solved spot on hand frame h (hero = the seat whose cards are shown).
 globalThis.spotWhyList=function(result,h=state.hand,heroSeat=state.hero){
  if(!h||h.done||!result?.supported||(h.board||[]).length<3||h.rules?.hole>2||h.config?.variant!=='NLH')return[];
  const all=result.solve?.rangeAssumptions||result.rangeAssumptions||[],live=new Set(h.living()),seat=result.handMix?.seat??h.actor;
  const parse=r=>{try{return PokerSpot.parseRange(r.range,{hole:2},h.board)||null;}catch{return null;}};
  const mineR=all.find(r=>r.seat===seat),others=all.filter(r=>r.seat!==seat&&live.has(r.seat)),mine=mineR&&parse(mineR),theirs=others.length===1?parse(others[0]):null;
  const tones=actionTones(result.actions,h),labels=result.actions.map((a,i)=>toneLabel(a,tones[i],h));
  const potStart=h.pot-h.streetPaid.reduce((s,x)=>s+x,0),liveSeats=h.living(),stack=Math.min(...liveSeats.map(i=>h.stacks[i]+h.streetPaid[i]));
  const after=i=>(i-h.button+h.n)%h.n||h.n,ip=liveSeats.slice().sort((a,b)=>after(a)-after(b)).pop();
  const hero=seat===heroSeat&&h.holes[seat]?.length===2?h.holes[seat]:null,heroClass=hero?G.Core.handClass(hero):null;
  let heroWeight=null;if(hero&&mine){const key=hero.slice().sort((a,b)=>a-b).join(),peak=Math.max(...mine.map(r=>r.weight)),row=mine.find(r=>r.cards.join()===key);heroWeight=peak>0?(row?row.weight:0)/peak:null;}
  return SpotWhy.reasons({board:h.board,hero,heroIsIp:seat===ip,spr:potStart>0?stack/potStart:0,actions:result.actions,tones,labels,heroMix:hero?result.reference:null,mine,theirs,mix:result.handMix?.classes||null,heroClass,heroWeight});
 };
 globalThis.spotWhyHTML=function(result){
  try{
   const h=state.hand;if(!h||h.done||!result?.supported||h.rules?.hole>2||h.config?.variant!=='NLH')return'';
   const list=h.board.length>=3?spotWhyList(result,h):[];
   // Your own decision's line (pot odds, or how wide this seat plays first in), unless the guess result above already shows it.
   const mine=(result.handMix?.seat??h.actor)===state.hero&&h.actor===state.hero,shown=h.guessReveal?.at===h.actionLog.length&&h.guessReveal.why;
   if(mine&&!shown){const line=decisionWhy(h,result);if(line&&!list.some(x=>x.t.replace(/\.$/,'')===line))list.splice(list[0]?.k==='hand'?1:0,0,{k:'odds',t:line});}
   else if(shown)for(let i=list.length-1;i>=0;i--)if(list[i].t.replace(/\.$/,'')===shown)list.splice(i,1);
   if(!list.length)return'';let open=false;try{open=localStorage.getItem(WHY_KEY)==='1';}catch{}
   return'<details class="spot-why"'+(open?' open':'')+'><summary>Why?</summary><ul>'+list.map(r=>'<li>'+(r.label?'<strong>'+esc(r.label)+'</strong> ':'')+esc(r.t)+'</li>').join('')+'</ul></details>';
  }catch(error){return'';}
 };
}
