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

 const aggressive=a=>a.kind==='bet'||a.kind==='raise';
 // Bet size buckets from the action tones: up to about half pot is small, bigger is big, all-in is jam.
 function sizeKind(a,tone){return tone==='allin'||/all-in/i.test(a.label||'')?'jam':tone==='bet1'?'small':'big';}

 // The reasons, as short sentences, most telling first. input: {board, hero, heroIsIp, spr, actions, tones, labels,
 // heroMix, mine, theirs, mix, heroClass, heroWeight}; mine/theirs are range rows, mix maps hand class -> action mix.
 function reasons(x){
  const out=[],A=x.actions,labels=x.labels,board=x.board,facing=A.some(a=>a.kind==='fold'||a.kind==='call');
  const freq=x.mine&&x.mix?rangeFrequencies(x.mine,x.mix,A,board):null,bet=freq?A.reduce((s,a,i)=>s+(aggressive(a)?freq[i]:0),0):null;
  const by={small:0,big:0,jam:0};if(freq)A.forEach((a,i)=>{if(aggressive(a))by[sizeKind(a,x.tones[i])]+=freq[i];});
  // 1. What the whole range does.
  if(freq){
   const top=freq.map((p,i)=>[p,i]).sort((a,b)=>b[0]-a[0]).filter(([p])=>p>=.05).slice(0,3).map(([p,i])=>labels[i]+' '+pct(p)).join(', ');
   out.push({k:'range',t:(facing?'Your range here: ':bet<.25?'Your range mostly checks: ':bet>.6?'Your range bets a lot: ':'Your range mixes: ')+top+'.'});
   if(bet>=.2){const main=Object.entries(by).sort((a,b)=>b[1]-a[1])[0][0];
    out.push({k:'size',t:main==='small'?'Bets are mostly small: a cheap bet works when the whole range has an edge.':main==='big'?'Bets are mostly big: strong hands and bluffs bet, the middle checks.':'Bets are mostly all-in: stacks are short, so strong hands and draws just get it in.'});}
  }
  // 2. Who the board favours, by top pair or better and by two pair or better.
  if(x.mine&&x.theirs){
   const me=profile(x.mine,board,[]),them=profile(x.theirs,board,x.hero||[]);
   if(me.total>0&&them.total>0){
    const diff=me.topPlus-them.topPlus,nut=me.strong-them.strong,who=Math.abs(diff)<.04?'Board hits both ranges about evenly':diff>0?'Board favours you':'Board favours them';
    let t=who+': top pair or better is '+pct(me.topPlus)+' of your range, '+pct(them.topPlus)+' of theirs';
    if(Math.max(me.strong,them.strong)>=.03)t+='; two pair or better '+pct(me.strong)+' vs '+pct(them.strong);
    if(nut<-.03&&bet!=null&&bet<.35)t+=', so you bet less';else if(nut>.03&&by.big+by.jam>=.1)t+=', so you can bet big';
    out.push({k:'adv',t:t+'.'});x._draws=[me.draw,them.draw];
   }
  }
  // 3. Board texture.
  const tex=textureWords(board),draws=x._draws&&Math.max(...x._draws)>=.08?' Draws are '+pct(x._draws[0])+' of your range, '+pct(x._draws[1])+' of theirs.':'';
  out.push({k:'board',t:board.map(cardText).join(' ')+': '+(tex.words.length?tex.words.join(', '):tex.highName)+'.'+(tex.dry?' Few draws, so whoever is ahead now tends to stay ahead.':draws||(tex.wet?' Many draws, so the next card can change who is ahead.':''))});
  // 4. Stack-to-pot ratio.
  if(x.spr>0){const s=x.spr<10?Math.round(x.spr*10)/10:Math.round(x.spr);
   out.push({k:'spr',t:'SPR '+s+': '+(x.spr<2.5?'one bet nearly gets it all in, so top pair plays like a very strong hand.':x.spr<6?'about two bets get it all in.':'deep stacks, so one pair wants a small pot and the best hands build a big one.')});}
  // 5. Position, when nothing is bet yet.
  if(x.heroIsIp!=null&&!facing&&bet!=null){
   if(x.heroIsIp)out.push({k:'pos',t:bet<.4?'You act last: checking back sees the next card for free.':'You act last, so you can bet more hands.'});
   else if(bet<.4)out.push({k:'pos',t:'You act first: checking keeps your weaker hands out of trouble.'});}
  // 6. The hero's own hand: what it has, a blocker, its play next to the range's.
  if(x.hero?.length===2){
   const k=classify(x.hero,board),bits=[k.made],draw=k.nutFlushDraw?'the nut flush draw':k.flushDraw?'a flush draw':k.straightDraw==='open'?'an open-ended straight draw':k.straightDraw==='gutshot'?'a gutshot':'';
   if(draw)bits.push(draw);
   const flushSuits=[0,1,2,3].filter(s=>board.filter(c=>suit(c)===s).length>=2),topRank=Math.max(...board.map(rank));let block='';
   for(const c of x.hero){if(!block&&!k.flushDraw&&k.cat!=='strong'&&rank(c)===12&&flushSuits.includes(suit(c)))block='blocks their nut flush draws';if(!block&&k.cat==='air'&&rank(c)===topRank)block='blocks some of their top pairs';}
   let t='Your '+x.hero.map(cardText).join('')+': '+bits.join(' with ')+(block?', '+block:'');
   if(x.heroMix){const best=x.heroMix.map((p,i)=>[p,i]).sort((a,b)=>b[0]-a[0])[0];t+='. '+labels[best[1]]+' '+pct(best[0])+(freq?' (range '+pct(freq[best[1]])+')':'');}
   if(x.heroMix&&freq){const pass=A.reduce((s,a,i)=>s+(aggressive(a)?0:x.heroMix[i]),0);if(k.cat==='air'&&!draw&&pass>.7&&bet>=.3)t+='. Worse hands fold and better ones call, so it checks';}
   out.push({k:'hand',t:t+'.'});
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
