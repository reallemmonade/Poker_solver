'use strict';
// Trimmed preflop betting tree. Pots that reach the flop are always heads-up:
// at most one player flats an open, and after a 3-bet only the player who made
// the previous raise may continue. A player who flatted the open may continue
// against a squeeze only once the opener has folded. Everyone else folds.
const round=x=>Math.round(x*10)/10;

function defaults(raw={}){
 const n=raw.seats||9,stack=raw.stack||200;
 return{seats:n,stack,sb:.5,bb:1,ante:0,open:2.5,sbOpen:3,threeBetIP:3,threeBetOOP:4,squeezePerCaller:1,fourBet:2.3,fiveBet:2.2,
  // Short stacks may also shove at every raise; deep stacks get a sized 5-bet.
  extraJam:stack<=25,deep:stack>=300,jamShare:.4,pushFold:false,potLimit:false,foldRemoval:true,playability:{},
  // Flop realization (solve.cjs matrices): position edge, extra edge for the last raiser, and
  // sharpness, which makes hands that are behind realize less than their raw equity.
  realization:.12,initiative:.06,sharpness:1.2,
  // Flop pots pay all-in equity below allInSPR (stack behind / pot), the realization share above
  // flopSPR, and a blend in between: with that little behind the money goes in on most flops.
  allInSPR:.5,flopSPR:1.5,
  // Facing a 4-bet or more, flatting is dropped (all-in or fold) when the call would leave
  // less than callSPR times the pot behind.
  callSPR:2.5,
  // Share of an opponent's continuing range that CFR passes also send down every action.
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
 const dead=Array(n).fill(0);dead[bbSeat]=o.ante;
 const cap=dead.map(d=>o.stack-d),bets=Array(n).fill(0);bets[sbSeat]=o.sb;bets[bbSeat]=o.bb;
 const root=step({bets,folded:Array(n).fill(false),bet:o.bb,allIn:false,level:0,raiser:-1,prevRaiser:-1,callers:0,caller:-1,pending:order.slice(),history:[]});
 return{options:o,root,nodes};

 // The sized raise for this actor, or null when the next raise is all-in.
 function sizeFor(s,actor){
  // Pot limit: every raise is pot-sized (call, then raise the pot), all-in once that reaches the stack.
  if(o.potLimit){const to=Math.floor((2*s.bet-s.bets[actor]+sum(s.bets)+sum(dead))*10+1e-9)/10;return to>=cap[actor]?null:to;}
  let to;
  if(s.level===0)to=actor===sbSeat&&n>2?o.sbOpen:o.open;
  else if(s.level===1)to=s.bet*(actor===sbSeat||actor===bbSeat?o.threeBetOOP:o.threeBetIP)+s.bet*o.squeezePerCaller*s.callers;
  else if(s.level===2)to=s.bet*o.fourBet;
  else if(s.level===3&&o.deep)to=s.bet*o.fiveBet;
  else return null;
  to=round(to);
  return to>=o.jamShare*o.stack?null:to;
 }
 function raises(s,actor){
  if(cap[actor]<=s.bet)return[];
  if(o.pushFold)return[{kind:'raise',to:cap[actor],jam:true}];
  const sized=sizeFor(s,actor),out=[];
  if(sized!==null)out.push({kind:'raise',to:sized});
  if(sized===null||o.extraJam&&!o.potLimit)out.push({kind:'raise',to:cap[actor],jam:true});
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
  if(s.level===0)return actor===bbSeat?[]:[fold,...raises(s,actor)];
  if(s.level===1)return s.callers===0?[fold,call,...raises(s,actor)]:[fold,...raises(s,actor)];
  if(actor!==s.prevRaiser&&!(s.level===2&&actor===s.caller&&s.folded[s.prevRaiser]))return[];
  const up=raises(s,actor),pot=sum(s.bets)+sum(dead)+s.bet-s.bets[actor];
  if(s.level>=3&&up.length&&Math.min(cap[actor],cap[s.raiser])-s.bet<o.callSPR*pot)return[fold,...up];
  return[fold,call,...up];
 }
 function step(s){
  while(s.pending.length){
   const actor=s.pending[0];
   if(s.folded[actor]){s.pending=s.pending.slice(1);continue;}
   const acts=options(s,actor);
   if(acts.length===0){
    // Unopened BB is checked out of the hand; everyone else folds.
    if(s.level===0&&actor===bbSeat){s.pending=s.pending.slice(1);continue;}
    s={...s,folded:s.folded.map((f,i)=>f||i===actor),pending:s.pending.slice(1),history:s.history.concat([{seat:actor,kind:'fold',auto:true}])};continue;
   }
   const node={type:'decision',id:nodes.length,actor,level:s.level,history:s.history,pot:sum(s.bets)+sum(dead),toCall:s.bet-s.bets[actor],children:[],actions:[]};nodes.push(node);
   for(const a of acts){
    const next={...s,bets:s.bets.slice(),folded:s.folded.slice(),pending:s.pending.slice(1)};
    let event;
    if(a.kind==='fold'){next.folded[actor]=true;event={seat:actor,kind:'fold'};}
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
  if(live.length!==2)throw Error('Trimmed tree reached a '+live.length+'-way pot.');
  const [a,b]=live,ip=postflopRank(n,a)>postflopRank(n,b)?a:b,spr=Math.min(cap[a]-bets[a],cap[b]-bets[b])/pot;
  // commit: weight of all-in equity in a flop pot's payoff (1 when effectively all-in).
  const commit=s.allIn?1:Math.min(1,Math.max(0,(o.flopSPR-spr)/(o.flopSPR-o.allInSPR)));
  return{type:commit>=1?'allin':'flop',players:[ip,ip===a?b:a],inv,pot,aggressor:s.raiser,...commit>0&&commit<1?{commit}:{}};
 }
}
function sum(a){return a.reduce((x,y)=>x+y,0);}

module.exports={build,defaults,blinds,actionOrder,postflopRank};
