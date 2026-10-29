(function(root){
  'use strict';
  let Core=root.PokerRiver;
  if(!Core&&typeof require==='function'){try{Core=require('./river-engine.js')}catch{Core=require('../river/engine.js')}}
  const U=100, STREET=['Preflop','Flop','Turn','River'], R='23456789TJQKA';
  const variants={NLH:{name:'No-limit Hold’em',hole:2,use:0,limit:'NL'},PLO4:{name:'Pot-limit Omaha · 4 cards',hole:4,use:2,limit:'PL'},PLO5:{name:'Pot-limit Omaha · 5 cards',hole:5,use:2,limit:'PL'},PLO6:{name:'Pot-limit Omaha · 6 cards',hole:6,use:2,limit:'PL'},PLO8:{name:'Omaha 8-or-better',hole:4,use:2,limit:'PL',low:8},PLO5HI8:{name:'5-card Omaha 8-or-better',hole:5,use:2,limit:'PL',low:8}};
  const assert=(x,m)=>{if(!x)throw Error(m)},units=x=>Math.round(x*U),bb=x=>x/U,clone=x=>JSON.parse(JSON.stringify(x));
  function rng(seed=Date.now()){let x=(seed>>>0)||1;const f=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296};f.state=()=>x>>>0;return f}
  function pick(weights,random=Math.random){let total=weights.reduce((s,x)=>s+Math.max(0,x),0);if(!total)return Math.floor(random()*weights.length);let x=random()*total;for(let i=0;i<weights.length;i++){x-=Math.max(0,weights[i]);if(x<=0)return i}return weights.length-1}
  function combinations(a,n){const out=[],p=[];function rec(s){if(p.length===n){out.push(p.slice());return}for(let i=s;i<=a.length-(n-p.length);i++){p.push(a[i]);rec(i+1);p.pop()}}rec(0);return out}
  function straight(mask){if(mask&(1<<14))mask|=2;for(let h=14;h>=5;h--)if((mask&(31<<(h-4)))===(31<<(h-4)))return h;return 0}
  function encode(category,values){let n=category;for(let i=0;i<5;i++)n=n*15+(values[i]||0);return n}
  function rankHigh(cs){
    const counts=new Uint8Array(15),suits=new Uint8Array(4),sm=new Uint32Array(4);let mask=0;
    for(const c of cs){const r=(c>>2)+2,s=c&3;counts[r]++;suits[s]++;mask|=1<<r;sm[s]|=1<<r}
    let flush=-1,sf=0;for(let s=0;s<4;s++)if(suits[s]>=5){const rs=[];for(let r=14;r>=2;r--)if(sm[s]&(1<<r))rs.push(r);const v=encode(5,rs);if(v>flush)flush=v;sf=Math.max(sf,straight(sm[s]))}
    if(sf)return encode(8,[sf]);
    const quads=[],trips=[],pairs=[],singles=[];for(let r=14;r>=2;r--){if(counts[r]===4)quads.push(r);if(counts[r]>=3)trips.push(r);if(counts[r]>=2)pairs.push(r);if(counts[r])singles.push(r)}
    if(quads.length)return encode(7,[quads[0],singles.find(r=>r!==quads[0])]);
    if(trips.length&&pairs.some(r=>r!==trips[0]))return encode(6,[trips[0],pairs.find(r=>r!==trips[0])]);
    if(flush>=0)return flush;
    const st=straight(mask);if(st)return encode(4,[st]);
    if(trips.length)return encode(3,[trips[0],...singles.filter(r=>r!==trips[0]).slice(0,2)]);
    if(pairs.length>=2)return encode(2,[pairs[0],pairs[1],singles.find(r=>r!==pairs[0]&&r!==pairs[1])]);
    if(pairs.length)return encode(1,[pairs[0],...singles.filter(r=>r!==pairs[0]).slice(0,3)]);
    return encode(0,singles);
  }
  function lowFive(cs,qualifier){const vals=cs.map(c=>((c>>2)+2)===14?1:(c>>2)+2).sort((a,b)=>b-a);if(vals[0]>qualifier||new Set(vals).size!==5)return null;return vals.reduce((n,r)=>n*9+r,0)}
  function evaluate(hole,board,rules){
    if(!rules.use)return{high:rankHigh([...hole,...board]),low:null};
    let high=-1,low=null;const hs=combinations(hole,rules.use),bs=combinations(board,5-rules.use);
    for(const h of hs)for(const b of bs){const c=[...h,...b];high=Math.max(high,rankHigh(c));if(rules.low){const l=lowFive(c,rules.low);if(l!==null&&(low===null||l<low))low=l}}
    return{high,low};
  }
  function normalize(raw={}){
    const c={variant:'NLH',seats:6,button:0,stacks:[40,40,40,40,40,40],sb:.5,bb:1,ante:0,anteMode:'each',startStreet:0,board:'',pot:0,mode:'cash',rakePct:0,rakeCap:3,noFlopNoDrop:true,otherStacks:[],payouts:[500,300,200],bounties:[],bountyCashFraction:1,...raw};
    const rules=c.variant==='CUSTOM'?c.custom:variants[c.variant];assert(rules,'Unknown variant.');
    assert(Number.isInteger(rules.hole)&&rules.hole>=2&&rules.hole<=6&&Number.isInteger(rules.use)&&rules.use>=0&&rules.use<=Math.min(3,rules.hole)&&['NL','PL'].includes(rules.limit),'Invalid custom community-card rules.');c.rules={...rules};
    assert(Number.isInteger(+c.seats)&&c.seats>=2&&c.seats<=9,'Use two to nine seats.');c.seats=+c.seats;
    assert(c.seats*rules.hole+8<=52,'This variant needs fewer seats: private cards, the board and three burn cards exceed the deck.');
    c.stacks=c.stacks.slice(0,c.seats).map(Number);assert(c.stacks.length===c.seats&&c.stacks.every(x=>Number.isFinite(x)&&x>=.01&&x<=10000000),'Every seat needs a positive stack at the supported chip resolution.');
    for(const k of ['sb','bb','ante','pot','rakePct','rakeCap']){c[k]=Number(c[k]);assert(Number.isFinite(c[k])&&c[k]>=0&&c[k]<=10000000,`Invalid ${k}.`);if(['sb','bb','ante'].includes(k))assert(Math.abs(units(c[k])-c[k]*U)<1e-6,`The ${k==='ante'?'ante':k==='sb'?'small blind':'big blind'} must be a whole number of chips (0.01 bb resolution).`);if(k!=='rakePct')c[k]=bb(units(c[k]));}assert(c.bb>0&&c.sb<=c.bb,'Blinds must be positive and small blind cannot exceed big blind.');assert(c.rakePct<=20,'Rake must be at most 20%.');
    assert(['each','bigblind'].includes(c.anteMode),'Ante mode must be per player or big blind.');c.button=Number(c.button);assert(Number.isInteger(c.button)&&c.button>=0&&c.button<c.seats,'Button seat is outside the table.');
    c.startStreet=Number(c.startStreet);assert(Number.isInteger(c.startStreet)&&c.startStreet>=0&&c.startStreet<=3,'Invalid starting street.');
    c.boardCards=c.board.trim()?Core.cards(c.board):[];assert(c.boardCards.length===[0,3,4,5][c.startStreet],'Enter zero, three, four or five public cards to match the starting street.');
    if(!c.startStreet)assert(c.pot===0,'Preflop starts with the posted blinds and antes; set the extra pot to zero.');else c.ante=0;
    assert(['cash','icm'].includes(c.mode),'Use cash or tournament utility.');
    c.otherStacks=(c.otherStacks||[]).map(Number);c.payouts=(c.payouts||[]).map(Number);
    if(c.mode==='icm'){assert(c.seats+c.otherStacks.length<=12&&c.otherStacks.every(x=>Number.isFinite(x)&&x>0),'Exact ICM supports up to twelve remaining positive stacks.');assert(c.payouts.length<=c.seats+c.otherStacks.length,'More payouts ('+c.payouts.length+') than remaining players ('+(c.seats+c.otherStacks.length)+'). Remove the extra places or add other-table stacks.');assert(c.payouts.length>0&&c.payouts.every((x,i)=>Number.isFinite(x)&&x>=0&&(!i||x<=c.payouts[i-1]))&&c.payouts.some(x=>x>0),'Enter nonincreasing payouts, first place first.');}
    c.bounties=Array.from({length:c.seats},(_,i)=>c.bounties[i]===undefined?0:Number(c.bounties[i]));assert(c.bounties.every(x=>Number.isFinite(x)&&x>=0&&x<=1e12),'Bounties must be finite and nonnegative.');assert(c.mode==='icm'||c.bounties.every(x=>!x),'Bounties use tournament prize units.');c.bountyCashFraction=Number(c.bountyCashFraction);assert(c.bountyCashFraction>=0&&c.bountyCashFraction<=1,'Bounty cash fraction must be between 0 and 1.');assert(!rules.low||rules.low===8&&rules.use===2,'Only exactly-two-private-card eight-or-better low is supported.');assert(!rules.low||c.bounties.every(x=>!x),'Bounty attribution for split high/low games is not supported.');
    c.stacks=c.stacks.map(x=>bb(units(x)));return c;
  }
  function positions(n,button=0){const names={2:['BTN/SB','BB'],3:['BTN','SB','BB'],4:['BTN','SB','BB','CO'],5:['BTN','SB','BB','HJ','CO'],6:['BTN','SB','BB','UTG','HJ','CO'],7:['BTN','SB','BB','UTG','MP','HJ','CO'],8:['BTN','SB','BB','UTG','UTG+1','MP','HJ','CO'],9:['BTN','SB','BB','UTG','UTG+1','UTG+2','MP','HJ','CO']}[n];return Array.from({length:n},(_,i)=>names[(i-button+n)%n])}
  function familyId(config){const c=config.rules?config:normalize(config),rotate=a=>Array.from({length:c.seats},(_,k)=>a[(c.button+k)%c.seats]);return JSON.stringify({variant:c.variant,rules:c.rules,seats:c.seats,stacks:rotate(c.stacks),sb:c.sb,bb:c.bb,ante:c.ante,anteMode:c.anteMode,start:c.startStreet,board:c.board,pot:c.pot,mode:c.mode,rake:c.rakePct,cap:c.rakeCap,noFlop:c.noFlopNoDrop,other:c.otherStacks,payouts:c.mode==='icm'?c.payouts:[],bounties:rotate(c.bounties),fraction:c.bountyCashFraction})}
  class Hand{
    constructor(raw={},options={}){
      this.config=normalize(raw);const c=this.config,n=c.seats;this.family=familyId(c);this.rules=c.rules;this.n=n;this.button=c.button;this.initial=c.stacks.map(units);this.stacks=this.initial.slice();this.total=Array(n).fill(0);this.streetPaid=Array(n).fill(0);this.folded=Array(n).fill(false);this.actedAt=Array(n).fill(null);this.actedKind=Array(n).fill(null);this.pending=new Set();this.street=c.startStreet;this.board=c.boardCards.slice();this.deadPot=units(c.pot);this.currentBet=0;this.lastFullRaise=units(c.bb);this.actedAt.fill(null);this.actedKind.fill(null);this.aggressions=0;this.done=false;this.log=[];this.actionLog=[];this.pots=[];this.rake=0;this.bountyCash=Array(n).fill(0);this.bounties=c.bounties.slice();
      const fixed=Array.from({length:n},(_,i)=>options.holes?.[i]?Array.isArray(options.holes[i])?options.holes[i].slice():Core.cards(options.holes[i]):null),runout=options.runout?(Array.isArray(options.runout)?options.runout.slice():Core.cards(options.runout)):[];
      fixed.forEach(h=>{if(h)assert(h.length===this.rules.hole,'Incorrect number of private cards.')});const known=[...this.board,...runout,...fixed.filter(Boolean).flat()];assert(new Set(known).size===known.length,'Known private cards and board contain duplicates.');assert(this.board.length+runout.length<=5,'Too many board cards.');
      const random=options.rng||Math.random;this.deck=Array.from({length:52},(_,i)=>i).filter(c=>!known.includes(c));for(let i=this.deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]]}
      this.holes=fixed.map(h=>h||[]);for(let k=0;k<this.rules.hole;k++)for(let offset=1;offset<=n;offset++){const i=(this.button+offset)%n;if(!fixed[i])this.holes[i].push(this.deck.pop())}this.plannedBoard=runout.slice();this.burns=[];
      if(!this.street){if(c.anteMode==='each')for(let i=0;i<n;i++)this.commit(i,Math.min(this.stacks[i],units(c.ante)),false);const sb=n===2?this.button:(this.button+1)%n,bbSeat=(this.button+(n===2?1:2))%n;this.commit(sb,Math.min(this.stacks[sb],units(c.sb)));this.commit(bbSeat,Math.min(this.stacks[bbSeat],units(c.bb)));if(c.anteMode==='bigblind'){const amount=Math.min(this.stacks[bbSeat],units(c.ante));this.stacks[bbSeat]-=amount;this.deadPot+=amount;this.log.push({type:'ante',seat:bbSeat,amount})}this.currentBet=units(c.bb);this.actor=n===2?this.button:(bbSeat+1)%n;}
      else this.actor=(this.button+1)%n;
      this.forced={live:this.streetPaid.slice(),ante:this.total.map((x,i)=>x-this.streetPaid[i]),bigBlindAnte:this.log.find(e=>e.type==='ante')||null};for(let i=0;i<n;i++)if(this.stacks[i]>0)this.pending.add(i);this.ensureAction();
    }
    clone(){const h=Object.create(Hand.prototype);Object.assign(h,this);for(const k of ['initial','stacks','total','streetPaid','folded','actedAt','actedKind','board','deck','plannedBoard','burns','bountyCash','bounties'])h[k]=this[k].slice();h.holes=this.holes.map(a=>a.slice());h.pending=new Set(this.pending);h.log=this.log.slice();h.actionLog=this.actionLog.slice();h.pots=this.pots.map(p=>({...p,eligible:p.eligible.slice(),winners:p.winners?.slice()}));if(this.returns)h.returns=this.returns.slice();return h}
    commit(p,amount,live=true){assert(Number.isInteger(amount)&&amount>=0&&amount<=this.stacks[p],'Invalid chip commitment.');this.stacks[p]-=amount;this.total[p]+=amount;if(live)this.streetPaid[p]+=amount}
    get pot(){return this.deadPot+this.total.reduce((a,b)=>a+b,0)}
    living(){return Array.from({length:this.n},(_,i)=>i).filter(i=>!this.folded[i])}
    actors(){return this.living().filter(i=>this.stacks[i]>0)}
    nextPending(after){for(let k=1;k<=this.n;k++){const p=(after+k)%this.n;if(this.pending.has(p))return p}return -1}
    refund(){const sorted=this.streetPaid.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);const difference=sorted[0].v-(sorted[1]?.v||0);if(difference>0){const p=sorted[0].i;this.streetPaid[p]-=difference;this.total[p]-=difference;this.stacks[p]+=difference;this.log.push({type:'refund',seat:p,amount:difference})}this.currentBet=Math.max(...this.streetPaid)}
    ensureAction(){
      while(!this.done){const live=this.living();if(live.length===1){this.refund();this.settle(live[0]);return}const actors=this.actors();for(const p of [...this.pending])if(this.folded[p]||this.stacks[p]===0)this.pending.delete(p);
        if(actors.length===1){const p=actors[0],opponentMax=Math.max(0,...live.filter(i=>i!==p).map(i=>this.streetPaid[i]));if(this.streetPaid[p]<opponentMax){this.currentBet=opponentMax;this.pending=new Set([p]);this.actor=p;return}this.pending.clear()}
        if(actors.length===0)this.pending.clear();
        if(!this.pending.size&&actors.length<=1&&live.length>1&&this.allInStreet===undefined)this.allInStreet=this.street;
        if(!this.pending.size){this.refund();if(this.street===3){this.settle();return}this.street++;this.burns.push(this.deck.pop());this.board.push(...Array.from({length:this.street===1?3:1},()=>this.plannedBoard.length?this.plannedBoard.shift():this.deck.pop()));this.streetPaid.fill(0);this.currentBet=0;this.lastFullRaise=units(this.config.bb);this.actedAt.fill(null);this.actedKind.fill(null);this.aggressions=0;this.pending=new Set(this.actors());this.actor=(this.button+1)%this.n;this.log.push({type:'street',street:this.street,board:this.board.slice()});continue}
        if(!this.pending.has(this.actor))this.actor=this.nextPending(this.actor-1);return;
      }
    }
    legal(){assert(!this.done,'This hand has ended.');const p=this.actor,paid=this.streetPaid[p],call=Math.max(0,this.currentBet-paid),cost=Math.min(call,this.stacks[p]),fullMax=paid+this.stacks[p],min=this.currentBet?this.currentBet+this.lastFullRaise:units(this.config.bb),potMax=this.rules.limit==='PL'?Math.max(paid+call+this.pot+call,min):fullMax,max=Math.min(fullMax,potMax),reopened=this.actedAt[p]===null||this.currentBet-this.actedAt[p]>=this.lastFullRaise||this.actedKind[p]==='check'&&this.actedAt[p]===0&&this.currentBet>0,canRaise=this.actors().some(i=>i!==p)&&reopened&&max>this.currentBet;
      return{seat:p,toCall:call,callCost:cost,check:call===0,fold:call>0,minRaiseTo:min,maxRaiseTo:max,allInTo:fullMax,canRaise:canRaise&&(max>=min||max===fullMax),reopened,paid};
    }
    act(action){const legal=this.legal(),p=this.actor,oldBet=this.currentBet;let kind=action.kind,paid=0,target=this.streetPaid[p];assert(['fold','check','call','raise','bet'].includes(kind),'Unknown action.');if(kind==='bet'||kind==='raise')kind=oldBet?'raise':'bet';
      if(kind==='fold'){assert(legal.fold,'Checking is available; folding to no bet is disabled.');this.folded[p]=true}
      else if(kind==='check'){assert(legal.check,'A bet is outstanding.');}
      else if(kind==='call'){assert(legal.toCall>0,'There is no bet to call.');paid=legal.callCost;this.commit(p,paid);target=this.streetPaid[p]}
      else{target=Math.round(action.target);assert(legal.canRaise&&target>oldBet&&target<=legal.maxRaiseTo,'That raise is not legal.');assert(target>=legal.minRaiseTo||target===legal.allInTo,'A short raise must be an all-in.');paid=target-this.streetPaid[p];this.commit(p,paid);const increment=target-oldBet;if(increment>=this.lastFullRaise)this.lastFullRaise=increment;this.currentBet=target;this.aggressions++;for(const other of this.actors())if(other!==p&&this.streetPaid[other]<target)this.pending.add(other)}
      this.pending.delete(p);this.actedAt[p]=this.currentBet;this.actedKind[p]=kind;const event={type:'action',seat:p,street:this.street,kind,target,paid,id:action.id||`${kind}:${target}`,allIn:this.stacks[p]===0};this.log.push(event);this.actionLog.push(event);this.actor=(p+1)%this.n;this.ensureAction();return event;
    }
    settle(foldWinner=null){
      if(this.done)return;const ranks=this.holes.map((h,i)=>this.folded[i]||foldWinner!==null?null:evaluate(h,this.board,this.rules)),levels=[...new Set(this.total.filter(x=>x>0))].sort((a,b)=>a-b);let previous=0;
      if(this.deadPot)this.pots.push({amount:this.deadPot,cap:0,eligible:this.living()});
      for(const cap of levels){const contributors=this.total.map((v,i)=>v>=cap?i:-1).filter(i=>i>=0),eligible=contributors.filter(i=>!this.folded[i]);const last=this.pots[this.pots.length-1],amount=(cap-previous)*contributors.length;if(last&&last.eligible.join()===eligible.join()){last.amount+=amount;last.cap=cap}else this.pots.push({amount,cap,eligible});previous=cap}
      const gross=this.pots.reduce((s,p)=>s+p.amount,0),c=this.config,drop=c.mode==='cash'&&(!c.noFlopNoDrop||this.board.length>=3);this.rake=drop?Math.min(units(c.rakeCap),Math.floor(gross*c.rakePct/100)):0;
      const rawTakes=this.pots.map(p=>this.rake*p.amount/(gross||1)),takes=rawTakes.map(Math.floor),order=rawTakes.map((x,i)=>({i,f:x-Math.floor(x)})).sort((a,b)=>b.f-a.f);let left=this.rake-takes.reduce((a,b)=>a+b,0);for(const x of order)if(left-->0)takes[x.i]++;
      this.pots.forEach((pot,i)=>{const take=takes[i];pot.rake=take;pot.net=pot.amount-take;assert(pot.eligible.length>0,'Side pot has no eligible player.');
        const high=foldWinner!==null?[foldWinner]:pot.eligible.filter(p=>ranks[p].high===Math.max(...pot.eligible.map(j=>ranks[j].high))),qual=foldWinner===null&&this.rules.low?pot.eligible.filter(p=>ranks[p].low!==null):[],low=qual.length?qual.filter(p=>ranks[p].low===Math.min(...qual.map(j=>ranks[j].low))):[];pot.winners=[...new Set([...high,...low])];pot.highWinners=high;pot.lowWinners=low;pot.paid=Array(this.n).fill(0);
        const award=(amount,winners)=>{const each=Math.floor(amount/winners.length),odd=amount-each*winners.length,order=winners.slice().sort((a,b)=>((a-this.button-1+this.n)%this.n)-((b-this.button-1+this.n)%this.n));for(let k=0;k<order.length;k++){const pay=each+(k<odd?1:0);this.stacks[order[k]]+=pay;pot.paid[order[k]]+=pay}};
        if(low.length){award(Math.ceil(pot.net/2),high);award(Math.floor(pot.net/2),low)}else award(pot.net,high);
      });
      for(let loser=0;loser<this.n;loser++)if(!this.stacks[loser]&&this.bounties[loser]){const pot=this.pots.find(p=>p.cap===this.total[loser]),winners=pot?.winners.filter(i=>i!==loser)||[];if(!winners.length)continue;const bounty=this.bounties[loser];this.bounties[loser]=0;for(const winner of winners){this.bountyCash[winner]+=bounty*c.bountyCashFraction/winners.length;this.bounties[winner]+=bounty*(1-c.bountyCashFraction)/winners.length;}}
      this.done=true;this.pending.clear();this.returns=this.stacks.map((x,i)=>bb(x-this.initial[i]));this.foldWinner=foldWinner;this.log.push({type:'result',stacks:this.stacks.slice(),rake:this.rake});
      assert(this.stacks.reduce((s,x)=>s+x,0)+this.rake===this.initial.reduce((s,x)=>s+x,0)+units(this.config.pot),'Chip conservation failed.');
    }
    utility(){assert(this.done,'Utility requires a completed hand.');if(this.config.mode==='cash')return this.returns.slice();const c=this.config,before=[...this.initial.map(x=>bb(x)+c.pot/this.n),...c.otherStacks],after=[...this.stacks.map(bb),...c.otherStacks],baseline=icmCached(before,c.payouts),ending=terminalICM(after,before,c.payouts);return this.stacks.map((_,i)=>ending[i]-baseline[i]+this.bountyCash[i]);}
    snapshot(){return{config:this.config,holes:this.holes.map(h=>h.map(Core.cardName).join('')),board:this.board.map(Core.cardName).join(''),actions:this.actionLog.map(a=>({...a})),done:this.done,stacks:this.stacks.map(bb),pots:clone(this.pots),rake:bb(this.rake),returns:this.returns,bountyCash:this.bountyCash,bounties:this.bounties};}
  }
  function modelActions(hand,abstraction={}){
    const p={betSizes:[.5,1],openSizes:[2.5],raiseSizes:[.75],preflopRaiseMultipliers:[3],maxAggressions:2,jam:true,jamAfterCap:false,...abstraction},l=hand.legal(),out=[],capped=hand.aggressions>=p.maxAggressions;
    if(l.fold)out.push({id:'f',kind:'fold',label:'Fold'});if(l.check)out.push({id:'x',kind:'check',label:'Check'});else out.push({id:'c',kind:'call',label:`Call ${bb(l.callCost)} bb${l.callCost===hand.stacks[hand.actor]?' · all-in':''}`});
    if(l.canRaise&&(!capped||p.jam&&p.jamAfterCap)){let targets=[];if(capped);else if(!hand.street){targets=hand.aggressions===0?p.openSizes.map((x,i)=>({id:'o'+i,target:units(x*hand.config.bb)})):p.preflopRaiseMultipliers.map((x,i)=>({id:'r'+i,target:Math.round(hand.currentBet*x)}))}else targets=(l.toCall?p.raiseSizes:p.betSizes).map((x,i)=>({id:(l.toCall?'r':'b')+i,target:Math.round(l.toCall?hand.currentBet+x*(hand.pot+l.toCall):l.paid+x*hand.pot)}));if(p.jam&&l.allInTo<=l.maxRaiseTo)targets.push({id:'j',target:l.allInTo});for(const t of targets){t.target=Math.min(l.maxRaiseTo,Math.max(l.minRaiseTo,t.target));if(t.target<=hand.currentBet||t.target<l.minRaiseTo&&t.target!==l.allInTo||out.some(a=>a.target===t.target))continue;out.push({id:t.id,kind:hand.currentBet?'raise':'bet',target:t.target,label:`${hand.currentBet?'Raise to':'Bet'} ${bb(t.target)} bb${t.target===l.allInTo?' · all-in':''}`});}}
    return out;
  }
  function texture(board){if(!board.length)return'-';const rs=board.map(c=>c>>2),ss=board.map(c=>c&3),maxSuit=Math.max(...[0,1,2,3].map(s=>ss.filter(x=>x===s).length)),distinct=new Set(rs).size,high=Math.floor(Math.max(...rs)/3),low=rs.filter(x=>x<=6||x===12).length;return`${high}${board.length-distinct}${maxSuit}${Math.min(3,low)}`}
  const icmCache=new Map();
  function icmCached(stacks,payouts){const key=stacks.join(',')+'|'+payouts.join(',');if(icmCache.has(key))return icmCache.get(key);const value=Core.icm(stacks,payouts);if(icmCache.size<30000)icmCache.set(key,value);return value;}
  function terminalICM(stacks,before,payouts){const alive=stacks.map((x,i)=>x>0?i:-1).filter(i=>i>=0),dead=stacks.map((x,i)=>x===0?i:-1).filter(i=>i>=0).sort((a,b)=>before[b]-before[a]),out=Array(stacks.length).fill(0),values=icmCached(alive.map(i=>stacks[i]),payouts.slice(0,alive.length));alive.forEach((p,i)=>out[p]=values[i]);let k=0;while(k<dead.length){let end=k+1;while(end<dead.length&&before[dead[end]]===before[dead[k]])end++;const money=dead.slice(k,end).reduce((s,_,j)=>s+(payouts[alive.length+k+j]||0),0)/(end-k);for(let j=k;j<end;j++)out[dead[j]]=money;k=end;}return out;}
  function preBucket(hole,rules){if(hole.length===2)return Core.handClass(hole);const rs=hole.map(c=>c>>2).sort((a,b)=>b-a),ss=[0,1,2,3].map(s=>hole.filter(c=>(c&3)===s).length).sort((a,b)=>b-a),pairs=hole.length-new Set(rs).size,aces=rs.filter(r=>r===12).length,broad=rs.filter(r=>r>=8).length,connect=rs.slice(1).filter((r,i)=>rs[i]-r<=2).length,low=rules.low?'L'+Math.min(4,new Set(rs.filter(r=>r<=6||r===12)).size):'';return`O${hole.length}${aces}${pairs}${ss.filter(n=>n>=2).length}${Math.min(3,broad)}${Math.min(3,connect)}${low}`}
  function postBucket(hole,board,rules){const result=evaluate(hole,board,rules),rank=result.high,cat=Math.floor(rank/15**5),kicker=Math.floor((Math.floor(rank/15**4)%15)/4),suit=[0,1,2,3].map(s=>({h:hole.filter(c=>(c&3)===s).length,b:board.filter(c=>(c&3)===s).length})),draw=suit.some(x=>x.b+x.h===4&&(!rules.use||x.h>=2&&x.b>=2))?1:0;return`${cat}${kicker}${draw}${rules.low?'L'+(result.low===null?'n':Math.floor(result.low/9**4)):''}`}
  function information(hand,seat=hand.actor){const hole=hand.holes[seat],memory=[preBucket(hole,hand.rules)],publicMemory=[];for(const len of [3,4,5])if(hand.board.length>=len){const board=hand.board.slice(0,len);memory.push(postBucket(hole,board,hand.rules));publicMemory.push(texture(board));}const relative=i=>(i-hand.button+hand.n)%hand.n,actions=hand.actionLog.map(a=>`${a.street}${relative(a.seat)}${a.id}`).join('.'),family=Array.from({length:hand.n},(_,k)=>hand.initial[(hand.button+k)%hand.n]).join(',')+':'+hand.config.bb+':'+hand.config.ante+':'+hand.config.startStreet+':'+hand.deadPot;return `S3|${family}|${relative(seat)}|${memory.join('/')}|${publicMemory.join('/')}|${actions}`;}
  // Share of the pot each listed seat wins over the remaining board cards: exact when the runouts are few
  // enough, otherwise a seeded sample so the same spot always shows the same number.
  function equity(holes,board,rules,seats,budget=200000){
    const share=Array(holes.length).fill(0);if(seats.length<2){seats.forEach(p=>share[p]=1);return share}
    const used=new Set([...board,...holes.flat()]),deck=[];for(let c=0;c<52;c++)if(!used.has(c))deck.push(c);
    const need=5-board.length,choose=(n,k)=>{let r=1;for(let i=0;i<k;i++)r=r*(n-i)/(i+1);return Math.round(r)},cost=seats.length*(rules.use?choose(rules.hole,rules.use)*choose(5,5-rules.use):1);
    const score=run=>{const b=run.length?board.concat(run):board,r=seats.map(p=>evaluate(holes[p],b,rules)),top=Math.max(...r.map(x=>x.high)),high=seats.filter((_,j)=>r[j].high===top),lows=r.map(x=>x.low).filter(x=>x!==null);
      if(rules.low&&lows.length){const best=Math.min(...lows),low=seats.filter((_,j)=>r[j].low===best);high.forEach(p=>share[p]+=.5/high.length);low.forEach(p=>share[p]+=.5/low.length)}else high.forEach(p=>share[p]+=1/high.length)};
    const total=choose(deck.length,need);let runs=0;
    if(total*cost<=budget){for(const run of need?combinations(deck,need):[[]]){score(run);runs++}}
    else{const random=rng(seats.flatMap(p=>holes[p]).concat(board).reduce((h,c)=>Math.imul(h^c+1,2654435761)>>>0,2166136261)),d=deck.slice();runs=Math.max(500,Math.floor(budget/cost));for(let k=0;k<runs;k++){for(let i=0;i<need;i++){const j=i+Math.floor(random()*(d.length-i));[d[i],d[j]]=[d[j],d[i]]}score(d.slice(0,need))}}
    return share.map(x=>x/runs);
  }
  function replay(config,events,options={}){const hand=new Hand(config,options);for(const e of events){assert(!hand.done,'History continues after the hand ended.');assert(hand.actor===e.seat&&hand.street===e.street,'Action history has an inconsistent actor or street.');hand.act({kind:e.kind,target:e.target,id:e.id})}return hand}
  // Starting hands ordered by all-in equity against two random hands (spot ranges, chart off-tree sizes).
  const preflopOrder='AA KK QQ JJ TT 99 AKs 88 AQs AKo AJs ATs AQo KQs 77 KJs AJo KTs A9s KQo ATo QJs A8s 66 KJo QTs A7s K9s JTs KTo A9o QJo A5s A6s Q9s A8o QTo 55 A4s K8s K7s A3s K9o A7o J9s JTo Q8s T9s A2s K6s A5o A6o Q9o J8s A4o K5s 44 T8s K8o K4s Q7s J9o A3o K7o 98s J7s Q6s K3s T9o Q8o A2o K2s Q5s K6o T7s 97s K5o J8o Q4s 33 T8o 87s J6s Q3s J5s T6s K4o Q7o 98o K3o J4s Q2s Q6o 96s J7o 86s 76s Q5o T7o J3s K2o 97o 22 Q4o J2s 65s 87o T5s T4s 75s 85s 95s J6o T3s Q3o 54s J5o T6o 96o T2s 86o Q2o 84s 74s 76o 64s J4o 94s 93s 53s T5o J3o 92s 75o 63s 95o 65o T4o 85o J2o 43s 83s 73s 82s 52s T3o 54o 62s 64o 74o 42s 72s 94o 84o T2o 32s 93o 53o 92o 63o 43o 83o 73o 82o 52o 42o 62o 72o 32o'.split(' ');
  const api={preflopOrder,Hand,normalize,variants,positions,modelActions,equity,information,preBucket,postBucket,texture,rankHigh,evaluate,combinations,rng,pick,units,bb,STREET,Core,replay,U,terminalICM,familyId};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerGame=api;
})(typeof globalThis!=='undefined'?globalThis:this);
