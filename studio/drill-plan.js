(function(root){
  'use strict';
  // Leak drills: groups your graded table decisions into spot types, ranks them by solver mistake cost,
  // and schedules each one with spaced repetition. Pure functions; the app supplies the decisions.
  // A decision: {seats, pos, street, topic, depth, variant, mode, mistake, cost (bb, null for chart-only grades), at, cls}.
  const TOPICS={firstin:'Open',vsopen:'Vs open',vs3bet:'Vs 3-bet',allin:'Vs all-in',betcheck:'Bet or check',vsbet:'Vs bet',vsraise:'Vs raise',other:'Other'};
  const STREETS=['Preflop','Flop','Turn','River'],DAY=864e5;
  // Days until a leak returns after each promotion; the last box counts as fixed.
  const BOX_DAYS=[0,1,3,7,21],STREAK=3,FIXED=BOX_DAYS.length-1;
  // Chart grades carry frequencies but no EV, so a chart mistake is charged a typical preflop cost.
  const CHART_COST=.5;
  // Older decisions fade: one with 300 newer graded decisions counts half.
  const HALF_LIFE=300;
  // Spot types whose reference is not trusted yet. 3-bet-vs-call facing an open stays out until
  // the v6 preflop charts pass the balance check; delete the entry then.
  const UNTRUSTED=new Set(['0|vsopen']);
  const trusted=d=>!UNTRUSTED.has(d.street+'|'+d.topic);
  const depthClass=x=>x<=20?20:x<=50?50:x<=100?100:200;
  const keyOf=d=>[d.variant||'NLH',d.mode||'cash',d.seats,d.pos,d.street,d.topic,depthClass(d.depth)].join('|');
  const tableLabel=n=>n===2?'HU':n+'-max';
  function label(l){return[l.pos,TOPICS[l.topic]||l.topic,l.street?STREETS[l.street]:'',tableLabel(l.seats),Math.round(l.depth)+'bb'].filter(Boolean).join(' · ');}
  // decisions newest first.
  function leaks(decisions){
    const groups=new Map();
    decisions.forEach((d,i)=>{if(!trusted(d))return;const key=keyOf(d),w=Math.pow(.5,i/HALF_LIFE);let g=groups.get(key);
      if(!g){g={key,variant:d.variant||'NLH',mode:d.mode||'cash',seats:d.seats,pos:d.pos,street:d.street,topic:d.topic,depths:[],n:0,m:0,cost:0,decisions:0,mistakes:0,lastMistakeAt:0,missed:new Set()};groups.set(key,g);}
      g.n+=w;g.decisions++;g.depths.push(d.depth);
      if(d.mistake){g.m+=w;g.mistakes++;g.cost+=w*(Number.isFinite(d.cost)&&d.cost>0?d.cost:CHART_COST);g.lastMistakeAt=Math.max(g.lastMistakeAt,d.at||0);if(d.cls)g.missed.add(d.cls);}});
    return[...groups.values()].filter(g=>g.mistakes>0).map(g=>{const s=g.depths.slice().sort((a,b)=>a-b);g.depth=s[s.length>>1];delete g.depths;g.hit=1-g.m/g.n;g.score=g.cost;g.label=label(g);return g;}).sort((a,b)=>b.score-a.score||b.mistakes-a.mistakes);
  }
  const newCard=now=>({box:0,streak:0,due:now,boxAt:0,results:[]});
  // Adds a card for every leak, and sends a promoted leak back to the start when table play shows it again.
  function sync(deck,list,now=Date.now()){deck.cards||={};for(const l of list){const c=deck.cards[l.key]||=newCard(now);if(c.box>0&&l.lastMistakeAt>c.boxAt){c.box=0;c.streak=0;c.due=now;}}return deck;}
  function answer(card,correct,now=Date.now()){card.results=(card.results||[]).concat(correct?1:0).slice(-20);card.last=now;
    if(correct){card.streak=(card.streak||0)+1;if(card.streak>=STREAK){card.box=Math.min(FIXED,card.box+1);card.streak=0;card.boxAt=now;card.due=now+BOX_DAYS[card.box]*DAY;}}
    else{card.box=0;card.streak=0;card.due=now;}return card;}
  const isDue=(card,now)=>!card||card.due<=now;
  // Next leak to drill: the costliest due ones, interleaved so the same spot type rarely comes twice in a row.
  // With nothing due it keeps drilling the costliest leaks, so the button always deals.
  function pick(list,deck,now=Date.now(),lastKey=null,rng=Math.random){
    if(!list.length)return null;const due=list.filter(l=>isDue(deck.cards?.[l.key],now)),pool=(due.length?due:list).slice(0,3),fresh=pool.length>1?pool.filter(l=>l.key!==lastKey):pool;
    const total=fresh.reduce((s,l)=>s+l.score,0);let r=rng()*total;for(const l of fresh)if((r-=l.score)<=0)return l;return fresh[fresh.length-1];
  }
  const num=x=>typeof x==='number'&&Number.isFinite(x);
  function validDeck(v){if(!v||typeof v!=='object'||!v.cards||typeof v.cards!=='object'||Array.isArray(v.cards))return false;const cards=Object.entries(v.cards);if(cards.length>5000)return false;
    return cards.every(([k,c])=>k.length<200&&c&&Number.isInteger(c.box)&&c.box>=0&&c.box<=FIXED&&num(c.due)&&num(c.boxAt)&&(c.streak===undefined||Number.isInteger(c.streak))&&Array.isArray(c.results)&&c.results.length<=20&&c.results.every(x=>x===0||x===1));}
  function drillHit(card){const r=card?.results||[];return r.length?r.reduce((s,x)=>s+x,0)/r.length:null;}
  const api={TOPICS,BOX_DAYS,STREAK,FIXED,CHART_COST,HALF_LIFE,UNTRUSTED,trusted,depthClass,keyOf,label,leaks,newCard,sync,answer,isDue,pick,drillHit,validDeck};
  root.PokerDrills=api;if(typeof module==='object')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
