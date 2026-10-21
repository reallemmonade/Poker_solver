'use strict';
// Trimmed preflop betting tree. Pots that reach the flop are always heads-up:
// at most one player flats an open, and after a 3-bet only the player who made
// the previous raise may continue. A player who flatted the open may continue
// against a squeeze only once the opener has folded. Everyone else folds.
const round=x=>Math.round(x*2)/2;

function defaults(raw={}){
 const n=raw.seats||9;
 return{seats:n,stack:200,sb:.5,bb:1,open:2.5,sbOpen:3,threeBetIP:3,threeBetOOP:4,squeezePerCaller:1,fourBet:2.3,
  jamShare:.4,openJam:false,pushFold:false,realization:.12,playability:{},...raw,seats:n};
}

// Seats are relative to the button (seat 0). SB is 1 and BB 2, or 0 and 1 heads-up.
function blinds(n){return n===2?[0,1]:[1,2];}
function actionOrder(n){const [,bb]=blinds(n);return Array.from({length:n},(_,k)=>(bb+1+k)%n);}
function postflopRank(n,seat){return(seat-blinds(n)[0]+n)%n;}

function build(raw){
 const o=defaults(raw),n=o.seats,[sbSeat,bbSeat]=blinds(n),order=actionOrder(n),nodes=[];
 const inv=Array(n).fill(0);inv[sbSeat]=o.sb;inv[bbSeat]=o.bb;
 const root=step({inv,folded:Array(n).fill(false),bet:o.bb,level:0,raiser:-1,prevRaiser:-1,callers:0,caller:-1,pending:order.slice(),history:[]});
 return{options:o,root,nodes};

 function sizeFor(s,actor){
  // The raise this actor would make, in bb, or the stack when it is close.
  let to;
  if(s.level===0)to=actor===sbSeat&&n>2?o.sbOpen:o.open;
  else if(s.level===1)to=s.bet*(actor===sbSeat||actor===bbSeat?o.threeBetOOP:o.threeBetIP)+s.bet*o.squeezePerCaller*s.callers;
  else if(s.level===2)to=s.bet*o.fourBet;
  else to=o.stack;
  to=round(to);
  return to>=o.jamShare*o.stack||o.pushFold||s.level===0&&o.openJam?o.stack:to;
 }
 function options(s,actor){
  if(s.bet>=o.stack)return['fold','call'];
  if(o.pushFold)return s.level===0?(actor===bbSeat?[]:['fold','raise']):['fold','call'];
  if(s.level===0)return actor===bbSeat?[]:['fold','raise'];
  if(s.level===1)return s.callers===0?['fold','call','raise']:['fold','raise'];
  if(actor!==s.prevRaiser&&!(s.level===2&&actor===s.caller&&s.folded[s.prevRaiser]))return[];
  return['fold','call','raise'];
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
   const node={type:'decision',id:nodes.length,actor,level:s.level,history:s.history,pot:sum(s.inv),toCall:s.bet-s.inv[actor],children:[],actions:[]};nodes.push(node);
   for(const kind of acts){
    const next={...s,inv:s.inv.slice(),folded:s.folded.slice(),pending:s.pending.slice(1),history:s.history.concat()};
    let event;
    if(kind==='fold'){next.folded[actor]=true;event={seat:actor,kind:'fold'};}
    else if(kind==='call'){next.inv[actor]=s.bet;next.callers=s.callers+1;next.caller=actor;event={seat:actor,kind:'call'};}
    else{
     const to=sizeFor(s,actor);next.inv[actor]=to;next.bet=to;next.level=s.level+1;next.prevRaiser=s.raiser;next.raiser=actor;next.callers=0;
     const start=order.indexOf(actor);next.pending=Array.from({length:n-1},(_,k)=>order[(start+1+k)%n]).filter(i=>!next.folded[i]);
     event={seat:actor,kind:'raise',to};
    }
    next.history=s.history.concat([event]);
    node.actions.push(event);node.children.push(step(next));
   }
   return node;
  }
  return terminal(s);
 }
 function terminal(s){
  const live=s.inv.map((_,i)=>i).filter(i=>!s.folded[i]),pot=sum(s.inv);
  // An unopened pot folds to the BB.
  if(live.length===1)return{type:'fold',winner:live[0],inv:s.inv.slice(),pot};
  if(live.length!==2)throw Error('Trimmed tree reached a '+live.length+'-way pot.');
  const [a,b]=live,ip=postflopRank(n,a)>postflopRank(n,b)?a:b;
  return{type:s.bet>=o.stack?'allin':'flop',players:[ip,ip===a?b:a],inv:s.inv.slice(),pot};
 }
}
function sum(a){return a.reduce((x,y)=>x+y,0);}

module.exports={build,defaults,blinds,actionOrder,postflopRank};
