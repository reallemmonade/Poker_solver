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

 // How often each part of the range (two pair+, top pair, weaker pairs, no pair) bets or raises, with each part's share.
 function betByCategory(rows,mix,actions,board){
  const C=root.PokerGame?.Core,out={},deadSet=new Set(board);if(!C)return null;
  for(const r of rows){if(!(r.weight>0)||r.cards.some(c=>deadSet.has(c)))continue;const m=mix[C.handClass(r.cards)];if(!m)continue;
   const cat=classify(r.cards,board).cat,o=out[cat]||(out[cat]={w:0,bet:0});o.w+=r.weight;o.bet+=r.weight*actions.reduce((s,a,i)=>s+(aggressive(a)?m[i]||0:0),0);}
  const total=Object.values(out).reduce((s,o)=>s+o.w,0);if(!total)return null;
  for(const o of Object.values(out)){o.share=o.w/total;o.rate=o.bet/o.w;}return out;
 }

 const aggressive=a=>a.kind==='bet'||a.kind==='raise';

 // The reasons, as short sentences, most telling first. input: {board, hero, heroIsIp, spr, actions, tones, labels,
 // heroMix, mine, theirs, mix, heroClass, heroWeight}; mine/theirs are range rows, mix maps hand class -> action mix.
 function reasons(x){
  const out=[],A=x.actions,labels=x.labels,board=x.board,facing=A.some(a=>a.kind==='fold'||a.kind==='call'),river=board.length>=5,turn=board.length===4;
  const freq=x.mine&&x.mix?rangeFrequencies(x.mine,x.mix,A,board):null,bet=freq?A.reduce((s,a,i)=>s+(aggressive(a)?freq[i]:0),0):null;
  // 1. How the range bets, as a reason (the frequencies are already on screen, so no numbers here).
  if(freq&&bet>=.1){
   const smallShare=A.reduce((t,a,i)=>t+(aggressive(a)&&(x.tones?.[i]==='bet1'||/1\/[34]|1\/2/.test(labels[i]||''))?freq[i]:0),0)/bet;
   const cats=x.mix?betByCategory(x.mine,x.mix,A,board):null,r=c=>cats?.[c]&&cats[c].share>=.03?cats[c].rate:null;
   const s=r('strong'),tp=r('top'),p=r('pair'),a=r('air'),polar=s!=null&&p!=null&&a!=null&&s-p>=.25&&a-p>=.15;
   let t='';
   if(facing)t=polar?'You raise your strongest hands and some bluffs, and just call with the middle: a raise only gets called by better.':'';
   else if(polar)t=river?'You bet your strongest hands for value and missed hands as bluffs, and check middling pairs: they win some showdowns but worse hands won’t call a bet.':'You bet your strongest hands and your bluffs, and check middling pairs to keep the pot small.';
   else if(smallShare>=.6&&bet>.5)t='You bet small and often: your whole range is ahead enough that a cheap bet makes their weak hands fold or pay.';
   else if(smallShare<.4&&tp!=null&&tp>=.5)t='Bets are big because your value hands are strong enough to want a big pot, and big bets give your bluffs more fold equity.';
   if(t)out.push({k:'size',t});
  }
  // 2. Who the board favours, by top pair or better and by two pair or better.
  if(x.mine&&x.theirs){
   const me=profile(x.mine,board,[]),them=profile(x.theirs,board,x.hero||[]);
   if(me.total>0&&them.total>0){
    // Only say the board favours someone when top pair+ and two pair+ agree; when they point opposite ways, say so.
    const diff=me.topPlus-them.topPlus,showNut=Math.max(me.strong,them.strong)>=.03,nut=showNut?me.strong-them.strong:0;
    const side=v=>Math.abs(v)<.03?0:Math.sign(v),dS=Math.abs(diff)<.04?0:Math.sign(diff),nS=side(nut);
    const who=dS&&nS&&dS!==nS?(dS>0?'You have more top pairs, they have more strong hands':'They have more top pairs, you have more strong hands'):(dS||nS)===0?'Board hits both ranges about evenly':(dS||nS)>0?'Board favours you':'Board favours them';
    const so=bet==null?'':who==='Board favours you'&&bet>=.5?', so you can bet a lot':who==='Board favours them'&&bet<.5?', so you check more':'';
    let t=who+' (top pair or better '+pct(me.topPlus)+' vs '+pct(them.topPlus)+(showNut?', two pair or better '+pct(me.strong)+' vs '+pct(them.strong):'')+')'+(facing?'':so);
    out.push({k:'adv',t:t+'.'});x._draws=[me.draw,them.draw];
   }
  }
  // 3. Board texture.
  const tex=textureWords(board),draws=x._draws&&Math.max(...x._draws)>=.08?(x._draws[0]>x._draws[1]*1.3?' You have more of the draws, so you can bet them as semi-bluffs.':x._draws[1]>x._draws[0]*1.3?' They have more of the draws, so charge them to see the next card.':' Both ranges have draws, so the next card can change who is ahead.'):'';
  const after=river?(tex.wet?' No cards to come, so missed draws can only win by bluffing.':''):tex.dry?' Few draws, so whoever is ahead now tends to stay ahead.':draws||(tex.wet?(turn?' Many draws, so the river can change who is ahead.':' Many draws, so the next cards can change who is ahead.'):'');
  out.push({k:'board',t:board.map(cardText).join(' ')+': '+(tex.words.length?tex.words.join(', '):tex.highName)+'.'+after});
  // 4. Stack-to-pot ratio.
  // On the river only the all-in case matters (no later streets to plan for).
  if(x.spr>0&&(!river||x.spr<1.5)){const s=x.spr<10?Math.round(x.spr*10)/10:Math.round(x.spr);
   out.push({k:'spr',t:'SPR '+s+': '+(river?'a pot-sized bet or less puts you all in.':x.spr<2.5?'one bet nearly gets it all in, so top pair plays like a very strong hand.':x.spr<6?'about two bets get it all in.':'deep stacks, so the strongest hands start building the pot early.')});}
  // 5. Position, when nothing is bet yet.
  if(x.heroIsIp!=null&&!facing&&bet!=null){
   if(x.heroIsIp)out.push({k:'pos',t:bet<.4?(river?'You act last: checking back goes straight to showdown.':'You act last: checking back sees the next card for free.'):'You act last, so you can bet more hands.'});
   else if(bet<.4)out.push({k:'pos',t:'You act first: checking keeps your weaker hands out of trouble.'});}
  // 6. The hero's own hand: what it has, a blocker, its play next to the range's.
  if(x.hero?.length===2){
   const k=classify(x.hero,board),bits=[k.made],draw=k.nutFlushDraw?'the nut flush draw':k.flushDraw?'a flush draw':k.straightDraw==='open'?'an open-ended straight draw':k.straightDraw==='gutshot'?'a gutshot':'';
   if(draw)bits.push(draw);
   const flushSuits=[0,1,2,3].filter(s=>board.filter(c=>suit(c)===s).length>=2),topRank=Math.max(...board.map(rank));let block='';
   for(const c of x.hero){if(!block&&!k.flushDraw&&k.cat!=='strong'&&rank(c)===12&&flushSuits.includes(suit(c)))block='blocks their nut flush draws';if(!block&&k.cat==='air'&&rank(c)===topRank)block='blocks some of their top pairs';}
   let t='Your '+x.hero.map(cardText).join('')+': '+bits.join(' with ')+(block?', '+block:'');
   if(x.heroMix){
    const order=x.heroMix.map((p,i)=>[p,i]).sort((a,b)=>b[0]-a[0]),main=A[order[0][1]],kind=aggressive(main)?(facing?'raise':'bet'):main.kind,c=k.cat,made=c!=='air';
    let why='';
    if(kind==='bet'||kind==='raise')why=c==='strong'||c==='top'?'strong enough to '+kind+' for value: worse hands still call':c==='pair'?kind+'s thin for value: worse pairs'+(river?'':' and draws')+' still call':draw&&!river?kind+'s as a semi-bluff: it can improve if called':kind+'s as a bluff: it rarely wins at showdown'+(block?' and its blocker makes their strong hands less likely':'');
    else if(kind==='check')why=c==='strong'?'checks to trap: it keeps their bluffs and weaker hands in':c==='top'||c==='pair'?'checks: it often wins at showdown, but worse hands won’t call a bet':river?'gives up: worse hands fold to a bet and better ones call':'checks: worse hands fold and better ones call, so a bet does little';
    else if(kind==='call')why=made?'calls: it beats enough of their bluffs to pay off':draw&&!river?'calls: the price is right to draw':'calls as a bluff-catcher: it beats their missed draws';
    else if(kind==='fold')why='folds: it loses to most of their betting range';
    if(why)t+='. '+why[0].toUpperCase()+why.slice(1);
    if(order[1]&&order[1][0]>=.25)t+='. It mixes in '+labels[order[1][1]]+' because the two plays are close';
   }
   out.unshift({k:'hand',t:t+'.'});
   if(x.heroWeight!=null&&x.heroWeight<.02)out.push({k:'rare',t:'Your preflop chart almost never gets '+x.heroClass+' here, so this hand’s advice is less settled.'});
  }
  return out;
 }

 const api={classify,profile,textureWords,rangeFrequencies,reasons};
 root.SpotWhy=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

if(typeof document!=='undefined'){
 const WHY_KEY='guava-why-open';
 // Remember the last open/closed state on this device.
 document.addEventListener('toggle',e=>{const d=e.target;if(d?.classList?.contains('spot-why'))try{localStorage.setItem(WHY_KEY,d.open?'1':'0');}catch{}},true);
 globalThis.spotWhyHTML=function(result){
  try{
   const h=state.hand;if(!h||h.done||!result?.supported||(h.board||[]).length<3||h.rules?.hole>2||h.config?.variant!=='NLH')return'';
   const all=result.solve?.rangeAssumptions||result.rangeAssumptions||[],live=new Set(h.living()),seat=result.handMix?.seat??h.actor;
   const parse=r=>{try{return PokerSpot.parseRange(r.range,{hole:2},h.board)||null;}catch{return null;}};
   const mineR=all.find(r=>r.seat===seat),others=all.filter(r=>r.seat!==seat&&live.has(r.seat)),mine=mineR&&parse(mineR),theirs=others.length===1?parse(others[0]):null;
   const tones=actionTones(result.actions,h),labels=result.actions.map((a,i)=>toneLabel(a,tones[i],h));
   const potStart=h.pot-h.streetPaid.reduce((s,x)=>s+x,0),liveSeats=h.living(),stack=Math.min(...liveSeats.map(i=>h.stacks[i]+h.streetPaid[i]));
   const after=i=>(i-h.button+h.n)%h.n||h.n,ip=liveSeats.slice().sort((a,b)=>after(a)-after(b)).pop();
   const hero=seat===state.hero&&h.holes[seat]?.length===2?h.holes[seat]:null,heroClass=hero?G.Core.handClass(hero):null;
   let heroWeight=null;if(hero&&mine){const key=hero.slice().sort((a,b)=>a-b).join(),peak=Math.max(...mine.map(r=>r.weight)),row=mine.find(r=>r.cards.join()===key);heroWeight=peak>0?(row?row.weight:0)/peak:null;}
   const list=SpotWhy.reasons({board:h.board,hero,heroIsIp:seat===ip,spr:potStart>0?stack/potStart:0,actions:result.actions,tones,labels,heroMix:hero?result.reference:null,mine,theirs,mix:result.handMix?.classes||null,heroClass,heroWeight});
   if(!list.length)return'';let open=false;try{open=localStorage.getItem(WHY_KEY)==='1';}catch{}
   return'<details class="spot-why"'+(open?' open':'')+'><summary>Why?</summary><ul>'+list.map(r=>'<li>'+esc(r.t)+'</li>').join('')+'</ul></details>';
  }catch(error){return'';}
 };
}
