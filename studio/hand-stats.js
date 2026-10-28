(function(root){
  'use strict';
  // HUD counters for one finished hand. Input: {n, actions:[{seat,street,kind}], startStreet, flop, showdown:[seat], won:[bool]}.
  // Each counter is a did/could pair (e.g. threeBet/threeBetOpp), so totals add up across hands and players.
  const KEYS=['hands','pre','vpip','pfr','threeBetOpp','threeBet','foldTo3Opp','foldTo3','cbetOpp','cbet','foldCbetOpp','foldCbet','sawFlop','wtsd','wsd','aggr','calls'];
  const empty=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
  function tally(input){
    const n=input.n,out=Array.from({length:n},empty),folded=Array(n).fill(false),pre=!(input.startStreet>0),acts=input.actions||[];
    let raises=0,opener=-1,aggressor=-1;const facing3=new Set(),faced3=new Set();
    for(const o of out){o.hands=1;if(pre)o.pre=1;}
    for(const a of acts){const o=out[a.seat],aggro=a.kind==='bet'||a.kind==='raise';if(!o)continue;
      if(a.street===0&&pre){
        if(raises===1&&a.seat!==opener&&!facing3.has(a.seat)){facing3.add(a.seat);o.threeBetOpp=1;if(aggro)o.threeBet=1;}
        if(raises===2&&a.seat===opener&&!faced3.has(a.seat)){faced3.add(a.seat);o.foldTo3Opp=1;if(a.kind==='fold')o.foldTo3=1;}
        if(aggro||a.kind==='call')o.vpip=1;
        if(aggro){o.pfr=1;raises++;if(raises===1)opener=a.seat;aggressor=a.seat;}
      }else if(a.street>0){if(aggro)o.aggr++;else if(a.kind==='call')o.calls++;}
      if(a.kind==='fold')folded[a.seat]=true;
    }
    const preFolded=Array(n).fill(false);for(const a of acts)if(a.street===0&&a.kind==='fold')preFolded[a.seat]=true;
    const flop=input.flop??acts.some(a=>a.street>=1);
    if(flop)for(let s=0;s<n;s++)if(!preFolded[s])out[s].sawFlop=1;
    // C-bet: the last preflop raiser's first flop action when nobody bet before it; fold to c-bet: each player's first answer to it.
    if(pre&&flop&&aggressor>=0&&!preFolded[aggressor]){let bets=0,cbet=false,acted=false;const answered=new Set();
      for(const a of acts.filter(x=>x.street===1)){const aggro=a.kind==='bet'||a.kind==='raise';
        if(a.seat===aggressor&&!acted){acted=true;if(bets===0){out[a.seat].cbetOpp=1;if(aggro){out[a.seat].cbet=1;cbet=true;}}}
        else if(cbet&&bets===1&&a.seat!==aggressor&&!answered.has(a.seat)){answered.add(a.seat);out[a.seat].foldCbetOpp=1;if(a.kind==='fold')out[a.seat].foldCbet=1;}
        if(aggro)bets++;}}
    for(const s of input.showdown||[])if(out[s]&&out[s].sawFlop){out[s].wtsd=1;if(input.won?.[s])out[s].wsd=1;}
    return out;
  }
  function add(total,c){for(const k of KEYS)total[k]+=c[k]||0;return total;}
  const pct=(a,b)=>b?Math.round(100*a/b):null;
  // The popup's short list: the numbers that tell you how a player plays, in reading order.
  function summary(t){return[
    ['VPIP',pct(t.vpip,t.pre)],['PFR',pct(t.pfr,t.pre)],['3B',pct(t.threeBet,t.threeBetOpp)],
    ['F3B',pct(t.foldTo3,t.foldTo3Opp)],['CB',pct(t.cbet,t.cbetOpp)],['FCB',pct(t.foldCbet,t.foldCbetOpp)],
    ['WTSD',pct(t.wtsd,t.sawFlop)],['W$SD',pct(t.wsd,t.wtsd)],['AF',t.calls?Math.round(10*t.aggr/t.calls)/10:t.aggr?t.aggr:null]];}
  // A saved range-lab-hand-v1 record in the shape tally() reads. Net and showdown come from the recorded ending stacks.
  function fromRecord(rec){const n=rec.config.seats,folded=Array(n).fill(false);for(const a of rec.actions)if(a.kind==='fold')folded[a.seat]=true;
    const live=folded.map((f,i)=>f?-1:i).filter(i=>i>=0),boardCards=(rec.board||'').length/2,net=Array.isArray(rec.endingStacks)?rec.endingStacks.map((x,i)=>x-rec.config.stacks[i]):null,
      flop=rec.actions.some(a=>a.street>=1)||live.length>1&&boardCards>=3||rec.config.startStreet>0;
    return{n,actions:rec.actions,startStreet:rec.config.startStreet||0,flop,showdown:net&&live.length>1?live:[],won:net?net.map(x=>x>0):[],net};}
  // Plain meanings for the stat and hand-row codes (Help > Poker terms, and the tooltip on each stat).
  const TERMS={VPIP:'Voluntarily put money in preflop: how often a player calls or raises before the flop. Around 20–30% is typical at 6-max.',PFR:'Preflop raise: how often a player raises before the flop.','3B':'3-bet: how often a player re-raises a preflop raise.',F3B:'Fold to a 3-bet after raising.',CB:'Continuation bet: the preflop raiser bets the flop.',FCB:'Fold to a continuation bet.',WTSD:'Went to showdown, of the hands that saw a flop.',W$SD:'Won money at showdown, of the hands that reached it.',AF:'Aggression factor: bets and raises per call. Above 2 is aggressive.','bb/100':'Big blinds won per 100 hands.',SRP:'Single-raised pot: one preflop raise, then a call.',Limped:'Nobody raised preflop.','X B C R F':'Your actions in a hand row: check, bet, call, raise, fold. A slash starts the next street (X/X/XC: check preflop, check the flop, check-call the turn).'};
  root.PokerStats={KEYS,empty,tally,add,summary,pct,fromRecord,TERMS};
  if(typeof module==='object')module.exports=root.PokerStats;
})(typeof window!=='undefined'?window:globalThis);
