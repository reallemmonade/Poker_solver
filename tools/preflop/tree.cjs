'use strict';
// Trimmed preflop betting tree. Pots that reach the flop are always heads-up:
// at most one player flats an open (or, with limp, the small blind completes when
// folded to), and after a 3-bet only the player who made
// the previous raise may continue. A player who flatted the open may continue
// against a squeeze only once the opener has folded. Everyone else folds.
const round=x=>Math.round(x*10)/10;

function defaults(raw={}){
 const n=raw.seats||9,stack=raw.stack||200;
 // 3-bets (times the open, plus squeezePerCaller per caller) and 4-bets (times the 3-bet) offer a
 // small and a big size; a number instead of a list gives one size.
 return{seats:n,stack,sb:.5,bb:1,ante:0,open:2.5,sbOpen:3,threeBetIP:[3,4],threeBetOOP:[3.5,4.5],squeezePerCaller:1,fourBet:[2.2,2.7],fiveBet:2.2,
  // Short stacks may also shove at every raise; deep stacks get a sized 5-bet.
  extraJam:stack<=25,deep:stack>=300,jamShare:.4,pushFold:false,potLimit:false,foldRemoval:true,playability:{},
  // Flop realization (solve.cjs matrices): position edge, extra edge for the last raiser, and
  // sharpness, which makes hands that are behind realize less than their raw equity.
  realization:.12,initiative:.06,sharpness:1.2,
  // reraised: {realization, initiative, sharpness, playTable} for flop pots after a 3-bet or more,
  // which play shallower than single-raised pots; null uses the settings above for every pot.
  reraised:null,
  // spots: {line key: {realization, initiative, sharpness, playTable}} for single flop lines
  // (calibrate.cjs --per-spot), which win over reraised and the settings above.
  spots:null,
  // Flop pots pay all-in equity below allInSPR (stack behind / pot), the realization share above
  // flopSPR, and a blend in between: with that little behind the money goes in on most flops.
  allInSPR:.5,flopSPR:1.5,
  // limp: the small blind may complete when everyone else has folded (heads-up, the button
  // may limp); the big blind then checks or raises to isoRaise bb. Off unless asked for.
  limp:false,isoRaise:3.5,
  // Facing a 4-bet or more, flatting is dropped (all-in or fold) when the call would leave
  // less than callSPR times the pot behind.
  callSPR:2.5,
  // Cash rake (percent of the pot, capped in bb), taken only from pots that see a flop. A flop
  // pot is raked as if it grew rakeGrowth times by the river; all-in pots as they stand.
  rake:0,rakeCap:3,rakeGrowth:2,
  // Share of an opponent's continuing range that CFR passes also send down every action.
  // anteEach: an ante every seat posts (dead money, like the big-blind ante).
  anteEach:0,
  // force: one hand's real line up to a decision ([{seat,kind,to}], seats relative to the button, to in bb), for
  // solving that one spot (spot.cjs). Each action on it is added where the trimmed rules leave it out, and the
  // player to act next gets every action (fold, check or call, each raise size and all-in) at the node marked
  // spot. Pots can then reach the flop three-way near the line: 'flop3'/'allin3' terminals ('many' for four or more).
  force:null,
  tremble:1e-5,...raw,seats:n};
}

// Seats are relative to the button (seat 0). SB is 1 and BB 2, or 0 and 1 heads-up.
function blinds(n){return n===2?[0,1]:[1,2];}
function actionOrder(n){const [,bb]=blinds(n);return Array.from({length:n},(_,k)=>(bb+1+k)%n);}
// Postflop the button acts last, heads-up too (where it is also the small blind).
function postflopRank(n,seat){return(seat-1+n)%n;}

function build(raw){
 const o=defaults(raw),n=o.seats,[sbSeat,bbSeat]=blinds(n),order=actionOrder(n),nodes=[];
 // The big-blind ante is dead money: it is in the pot but not part of any bet.
 const dead=Array(n).fill(o.anteEach||0);dead[bbSeat]+=o.ante;
 const cap=dead.map(d=>o.stack-d),bets=Array(n).fill(0);bets[sbSeat]=o.sb;bets[bbSeat]=o.bb;
 const root=step({bets,folded:Array(n).fill(false),bet:o.bb,allIn:false,level:0,raiser:-1,prevRaiser:-1,callers:0,caller:-1,pending:order.slice(),history:[],fi:o.force?0:-1});
 return{options:o,root,nodes};

 // The sized raises for this actor, smallest first; null stands for a size that would be all-in.
 function sizesFor(s,actor){
  // Pot limit: every raise is pot-sized (call, then raise the pot), all-in once that reaches the stack.
  if(o.potLimit){const to=Math.floor((2*s.bet-s.bets[actor]+sum(s.bets)+sum(dead))*10+1e-9)/10;return[to>=cap[actor]?null:to];}
  const list=x=>[].concat(x);let to;
  // Against limps, the isolation raise grows by squeezePerCaller big blinds for each limper after the first.
  if(s.level===0)to=[s.callers>0?o.isoRaise+s.bet*o.squeezePerCaller*(s.callers-1):actor===sbSeat&&n>2?o.sbOpen:o.open];
  else if(s.level===1)to=list(actor===sbSeat||actor===bbSeat?o.threeBetOOP:o.threeBetIP).map(k=>s.bet*k+s.bet*o.squeezePerCaller*s.callers);
  else if(s.level===2)to=list(o.fourBet).map(k=>s.bet*k);
  else if(s.level===3&&o.deep)to=[s.bet*o.fiveBet];
  else return[null];
  return [...new Set(to.map(round))].sort((a,b)=>a-b).map(x=>x>=o.jamShare*o.stack?null:x);
 }
 function raises(s,actor){
  if(cap[actor]<=s.bet)return[];
  if(o.pushFold)return[{kind:'raise',to:cap[actor],jam:true}];
  const sizes=sizesFor(s,actor),out=sizes.filter(x=>x!==null).map(to=>({kind:'raise',to}));
  if(sizes.includes(null)||o.extraJam&&!o.potLimit)out.push({kind:'raise',to:cap[actor],jam:true});
  return out;
 }
 function options(s,actor){
  const fold={kind:'fold'},call={kind:'call'};
  if(s.allIn){
   if(s.level===1&&s.callers===0)return[fold,call];
   if(s.level===1||actor!==s.prevRaiser&&!(s.level===2&&actor===s.caller&&s.folded[s.prevRaiser]))return[];
   return[fold,call];
  }
  if(o.pushFold)return s.level===0&&actor!==bbSeat?[fold,...raises(s,actor)]:[];
  if(s.level===0){
   if(actor===bbSeat)return s.callers>0?[{kind:'check'},...raises(s,actor)]:[];
   const limp=o.limp&&actor===sbSeat&&s.folded.every((f,i)=>f||i===sbSeat||i===bbSeat);
   return[fold,...limp?[call]:[],...raises(s,actor)];
  }
  if(s.level===1)return s.callers===0?[fold,call,...raises(s,actor)]:[fold,...raises(s,actor)];
  if(actor!==s.prevRaiser&&!(s.level===2&&actor===s.caller&&s.folded[s.prevRaiser]))return[];
  const up=raises(s,actor),pot=sum(s.bets)+sum(dead)+s.bet-s.bets[actor];
  if(s.level>=3&&up.length&&Math.min(cap[actor],cap[s.raiser])-s.bet<o.callSPR*pot)return[fold,...up];
  return[fold,call,...up];
 }
 // A forced action matches a tree action of the same kind (raises within 0.05bb, or both all-in).
 function same(a,f,actor){if(a.kind!==f.kind)return false;if(a.kind!=='raise')return true;return f.to>=cap[actor]-1e-9?!!a.jam:!a.jam&&Math.abs(a.to-f.to)<.05;}
 function toAction(f,actor){if(f.kind!=='raise')return{kind:f.kind};return f.to>=cap[actor]-1e-9?{kind:'raise',to:cap[actor],jam:true}:{kind:'raise',to:round(f.to)};}
 // Every action at the spot: fold when facing a bet, check or call, and the raises the chart tree offers at this
 // level (all-in where it would be, so a deep spot doesn't gain jams the charts never weigh).
 function full(s,actor){
  const owe=s.bet-s.bets[actor];return[...owe>0?[{kind:'fold'}]:[],owe>0?{kind:'call'}:{kind:'check'},...s.allIn?[]:raises(s,actor)];
 }
 function step(s){
  while(s.pending.length){
   const actor=s.pending[0];
   if(s.folded[actor]){s.pending=s.pending.slice(1);continue;}
   let acts=options(s,actor),forced=-1,proxy=-1,added=false;
   if(s.fi>=0&&s.fi<o.force.length){
    const f=o.force[s.fi];if(f.seat!==actor)throw Error('The line does not follow the betting order (seat '+f.seat+' is not next).');
    if(f.kind==='fold'&&!acts.length){s={...s,folded:s.folded.map((x,i)=>x||i===actor),pending:s.pending.slice(1),history:s.history.concat([{seat:actor,kind:'fold',auto:true}]),fi:s.fi+1};continue;}
    forced=acts.findIndex(a=>same(a,f,actor));
    // An action the trimmed tree leaves out has no range of its own (added). Its proxy is the nearest action of
    // the same kind at the node (the closest raise size), whose range the solver lends it (solve.cjs); with none,
    // it gets the hands that continue at the node.
    if(forced<0){added=true;const add=toAction(f,actor),near=acts.map((a,i)=>({a,i})).filter(({a})=>a.kind===add.kind).sort((p,q)=>Math.abs(Math.log((p.a.to||1)/(add.to||1)))-Math.abs(Math.log((q.a.to||1)/(add.to||1))))[0];acts=acts.concat([add]);forced=acts.length-1;if(near)proxy=near.i;}
   }else if(s.fi>=0)acts=full(s,actor);
   if(acts.length===0){
    // Unopened BB is checked out of the hand; everyone else folds.
    if(s.level===0&&actor===bbSeat){s.pending=s.pending.slice(1);continue;}
    s={...s,folded:s.folded.map((f,i)=>f||i===actor),pending:s.pending.slice(1),history:s.history.concat([{seat:actor,kind:'fold',auto:true}])};continue;
   }
   const node={type:'decision',id:nodes.length,actor,level:s.level,history:s.history,pot:sum(s.bets)+sum(dead),toCall:s.bet-s.bets[actor],children:[],actions:[]};nodes.push(node);
   if(s.fi>=0&&s.fi===o.force.length)node.spot=true;
   if(added)node.added={k:forced,proxy};
   for(const [ai,a]of acts.entries()){
    const next={...s,bets:s.bets.slice(),folded:s.folded.slice(),pending:s.pending.slice(1),fi:ai===forced?s.fi+1:-1};
    let event;
    if(a.kind==='fold'){next.folded[actor]=true;event={seat:actor,kind:'fold'};}
    else if(a.kind==='check')event={seat:actor,kind:'check'};
    else if(a.kind==='call'){next.bets[actor]=Math.min(s.bet,cap[actor]);next.callers=s.callers+1;next.caller=actor;event={seat:actor,kind:'call'};}
    else{
     next.bets[actor]=a.to;next.bet=a.to;next.allIn=!!a.jam;next.level=s.level+1;next.prevRaiser=s.raiser;next.raiser=actor;next.callers=0;
     const start=order.indexOf(actor);next.pending=Array.from({length:n-1},(_,k)=>order[(start+1+k)%n]).filter(i=>!next.folded[i]);
     event={seat:actor,kind:'raise',to:a.to};
    }
    next.history=s.history.concat([event]);
    node.actions.push(event);node.children.push(step(next));
   }
   return node;
  }
  return terminal(s);
 }
 function terminal(s){
  const live=s.bets.map((_,i)=>i).filter(i=>!s.folded[i]),bets=s.bets.slice();
  if(live.length===2){const matched=Math.min(bets[live[0]],bets[live[1]]);for(const i of live)bets[i]=matched;}
  // Each player's stake includes their dead ante; uncalled chips go back.
  const inv=bets.map((b,i)=>b+dead[i]),pot=sum(inv);
  if(live.length===1)return{type:'fold',winner:live[0],inv,pot};
  if(live.length>2){
   if(!o.force)throw Error('Trimmed tree reached a '+live.length+'-way pot.');
   // Three or more players see the flop (forced lines only): everyone matches the bet; players in postflop order.
   const top=Math.max(...live.map(i=>bets[i]));for(const i of live)bets[i]=Math.min(top,cap[i]);
   const inv=bets.map((b,i)=>b+dead[i]),pot=sum(inv),players=live.slice().sort((x,y)=>postflopRank(n,x)-postflopRank(n,y));
   if(live.length>3)return{type:'many',players,inv,pot,key:lineKey(s.history)};
   const spr=Math.min(...live.map(i=>cap[i]-bets[i]))/pot,commit=s.allIn||live.some(i=>bets[i]>=cap[i])?1:Math.min(1,Math.max(0,(o.flopSPR-spr)/(o.flopSPR-o.allInSPR)));
   const rake=Math.min(o.rakeCap,o.rake/100*pot*(1+(1-Math.min(1,commit))*(o.rakeGrowth-1)));
   return{type:commit>=1?'allin3':'flop3',players,inv,pot,aggressor:s.raiser,raises:s.level,key:lineKey(s.history),...commit>0&&commit<1?{commit}:{},...rake>0?{net:pot-rake}:{}};
  }
  const [a,b]=live,ip=postflopRank(n,a)>postflopRank(n,b)?a:b,spr=Math.min(cap[a]-bets[a],cap[b]-bets[b])/pot;
  // commit: weight of all-in equity in a flop pot's payoff (1 when effectively all-in).
  const commit=s.allIn?1:Math.min(1,Math.max(0,(o.flopSPR-spr)/(o.flopSPR-o.allInSPR)));
  const rake=Math.min(o.rakeCap,o.rake/100*pot*(1+(1-Math.min(1,commit))*(o.rakeGrowth-1)));
  return{type:commit>=1?'allin':'flop',players:[ip,ip===a?b:a],inv,pot,aggressor:s.raiser,raises:s.level,key:lineKey(s.history),...commit>0&&commit<1?{commit}:{},...rake>0?{net:pot-rake}:{}};
 }
}
function sum(a){return a.reduce((x,y)=>x+y,0);}
// A line as chart packs key it (studio/preflop.js historyKey): seat:kind:raise target in hundredths of a bb.
function lineKey(history){return history.map(e=>`${e.seat}:${e.kind}:${e.kind==='raise'?Math.round(e.to*100):0}`).join('/');}

module.exports={build,defaults,blinds,actionOrder,postflopRank,lineKey};
