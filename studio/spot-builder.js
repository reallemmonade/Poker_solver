// New spot: pick players, stack, your seat, your hand and any board cards, then the hand starts in Train › Decision
// with every seat under your control. Play the line, and the analysis pane solves it through the usual routes
// (preflop charts, flop library, Mac bridge with its progress bar).
const spotBuilder={n:6,stack:100,format:'cash',step:'setup',roles:[],hands:[],board:[],target:null,line:[],frozen:null,randomSeats:[],seed:1,pending:null,live:null,dialog:null};
// Cash or tournament. Tournament spots are chip EV with a 1 bb big-blind ante, the game the bundled MTT charts are
// solved for (one paid place makes ICM equal chip EV). Bubble and final-table ICM still come from Edit game payouts.
const STUDY_FORMATS={cash:{label:'Cash',stack:100},mtt:{label:'Tournament',stack:25}};
const studyFormatOf=c=>c?.mode==='icm'?'mtt':'cash';
function studyFormatFields(c,format){
 if(studyFormatOf(c)===format)return{};
 return format==='mtt'?{mode:'icm',ante:c?.startStreet?0:1,anteMode:'bigblind',payouts:[1],otherStacks:[],rakePct:0}:{mode:'cash',ante:0,bounties:Array(c?.seats||2).fill(0)};
}
function syncStudyFormat(c){const box=$('uiStudyFormat');if(!box||!c)return;const f=studyFormatOf(c);box.querySelectorAll('[data-study-format]').forEach(b=>{const on=b.dataset.studyFormat===f;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});}
// Switching the format on Study this decision deals a fresh hand in that format; equal default stacks follow it.
function setStudyFormat(format){
 const c=state.config;if(!c||studyFormatOf(c)===format)return;
 if(state.busy){status('A calculation is running. Cancel it first.',true);return;}
 const from=STUDY_FORMATS[studyFormatOf(c)].stack,stacks=c.stacks.every(x=>x===from)?Array(c.seats).fill(STUDY_FORMATS[format].stack):c.stacks;
 try{const config=G.normalize({...c,...studyFormatFields(c,format),stacks});stopTableMotion();writeForm(config,state.abstraction);markDirty();if(!deal(false))return;}
 catch(e){status(e.message,true);}
}
function spotSeatsInOrder(n,button){return n===2?[button,(button+1)%n]:Array.from({length:n},(_,k)=>(button+3+k)%n);}
function spotHoleCount(){return state.config?.rules?.hole||2;}
function spotCardLabel(c){const s=C.cardName(c);return'<span class="sb-pip suit-'+s[1]+'">'+s[0]+'<i>'+{c:'♣',d:'♦',h:'♥',s:'♠'}[s[1]]+'</i></span>';}
function spotSeatOptions(){return[...$('seats').options].filter(o=>!o.disabled).map(o=>+o.value);}
// Seats: each one is out (folds preflop by itself), in the hand, or you. Hands: exact cards, or none for a random hand
// (that seat's whole range is what the strategy is about anyway). Seat 0 is always the button.
function spotResetSeats(hero){const b=spotBuilder,hole=spotHoleCount();b.roles=Array(b.n).fill('in');b.roles[Math.min(hero??0,b.n-1)]='you';b.hands=Array.from({length:b.n},()=>Array(hole).fill(null));b.target={seat:Math.min(hero??0,b.n-1),i:0};}
function spotHero(){return spotBuilder.roles.indexOf('you');}
function openSpotBuilder(){
 if(state.busy){status('A calculation is running. Cancel it first.',true);return;}
 const b=spotBuilder,c=state.config||{},hole=spotHoleCount(),seats=spotSeatOptions();
 b.format=studyFormatOf(c);b.step='setup';b.line=[];b.frozen=null;
 // Reopening keeps the sheet as you left it while the table still matches it; otherwise it starts from the table.
 const same=b.roles?.length&&b.roles.length===c.seats&&c.button===0&&b.hands?.[0]?.length===hole;
 if(!same){b.n=seats.includes(c.seats)?c.seats:seats.includes(6)?6:seats[0];const hero=c.seats===b.n&&Number.isInteger(state.hero)?((state.hero-(c.button||0))%b.n+b.n)%b.n:0;spotResetSeats(hero);b.stack=c.stacks?.[state.hero??0]||STUDY_FORMATS[b.format].stack;}
 if(b.board?.length!==5)b.board=Array(5).fill(null);
 renderSpotBuilder();const d=b.dialog;if(!d.open){document.body.classList.add('ui-dialog-open');d.showModal();}
}
function spotConfig(){const b=spotBuilder,base={...state.config,seats:b.n,startStreet:0};return G.normalize({...base,...studyFormatFields(base,b.format),seats:b.n,button:0,stacks:Array(b.n).fill(b.stack),bounties:Array(b.n).fill(0),startStreet:0,board:'',pot:0});}
function spotKnownCards(){const b=spotBuilder;return new Map([...b.hands.flatMap((h,seat)=>h.map((c,i)=>[c,{seat,i}])),...b.board.map((c,i)=>[c,{seat:-1,i}])].filter(([c])=>c!==null));}
function spotGridHTML(){const used=spotKnownCards();if(spotBuilder.frozen)spotBuilder.frozen.forEach((h,seat)=>h.forEach((c,i)=>{if(!used.has(c))used.set(c,{seat,i})}));let grid='';
 for(const suit of[3,2,1,0])for(let r=12;r>=0;r--){const card=r*4+suit,taken=used.has(card);grid+='<button type="button" class="sb-card'+(taken?' taken':'')+'" data-sb-card="'+card+'" aria-label="'+cardSpeech(card)+'">'+spotCardLabel(card)+'</button>';}
 return'<div class="sb-grid" role="group" aria-label="Pick a card">'+grid+'</div>';}
function spotSlotHTML(seat,i,card,label){const t=spotBuilder.target,on=t&&t.seat===seat&&t.i===i;return'<button type="button" class="sb-slot'+(on?' active':'')+(card===null?'':' filled')+'" data-sb-slot="'+seat+':'+i+'" aria-label="'+label+'">'+(card===null?'':spotCardLabel(card))+'</button>';}
function spotBoardHTML(){const b=spotBuilder;return b.board.map((c,i)=>spotSlotHTML(-1,i,c,['Flop','Flop','Flop','Turn','River'][i])).join('');}
function renderSpotBuilder(){const b=spotBuilder;if(b.step==='line')return renderSpotLine();
 const d=b.dialog,hole=spotHoleCount(),order=spotSeatsInOrder(b.n,0),names=G.positions(b.n,0),inHand=b.roles.filter(r=>r!=='out').length;
 const chip=(attr,label,on)=>'<button type="button" class="sb-chip'+(on?' on':'')+'" '+attr+' aria-pressed="'+on+'">'+label+'</button>';
 d.querySelector('h2').textContent='New spot';
 d.querySelector('.ui-dialog-content').innerHTML=
  '<div class="sb-row"><span class="sb-label">Game</span><div class="sb-chips">'+Object.entries(STUDY_FORMATS).map(([k,f])=>chip('data-sb-format="'+k+'"',f.label,k===b.format)).join('')+'</div></div>'+
  '<div class="sb-row"><span class="sb-label">Table</span><div class="sb-chips">'+spotSeatOptions().map(n=>chip('data-sb-n="'+n+'"',n,n===b.n)).join('')+'</div></div>'+
  '<div class="sb-row"><label class="sb-label" for="sbStack">Stack</label><div class="sb-chips"><input class="input sb-stack" id="sbStack" type="number" inputmode="decimal" min="1" step="1" value="'+b.stack+'"><span class="muted small">bb</span></div></div>'+
  '<div class="sb-row"><span class="sb-label">Board</span><div class="sb-slots">'+spotBoardHTML()+'</div></div>'+
  '<div class="sb-head"><strong>Players · '+inHand+' in the hand</strong><button type="button" class="sb-chip" data-sb-allin>Everyone in · random</button></div>'+
  '<div class="sb-seats">'+order.map(seat=>{const role=b.roles[seat],h=b.hands[seat],empty=h.every(c=>c===null),t=b.target?.seat===seat;
   return'<div class="sb-seat'+(role==='out'?' out':'')+'"><b>'+names[seat]+'</b><div class="sb-seg" role="group" aria-label="'+names[seat]+'">'+[['out','Out'],['in','In'],['you','You']].map(([k,l])=>'<button type="button" class="'+(role===k?'on':'')+'" data-sb-role="'+seat+':'+k+'" aria-pressed="'+(role===k)+'">'+l+'</button>').join('')+'</div>'+
   '<div class="sb-hand">'+(role==='out'?'<span class="muted small">folds preflop</span>':empty&&!t?'<button type="button" class="sb-chip sb-random" data-sb-slot="'+seat+':0">Random</button>':h.map((c,i)=>spotSlotHTML(seat,i,c,names[seat]+' card '+(i+1))).join(''))+'</div></div>';}).join('')+'</div>'+
  spotGridHTML()+
  '<p class="ui-dialog-error sb-error" role="alert" hidden></p>'+
  '<div class="sb-foot"><button type="button" class="btn secondary" data-sb-deal>Deal spot</button><button type="button" class="btn" data-sb-line>Enter the line</button></div>';
}
// The line: every action in order, on any street. Out seats fold by themselves. Random hands are fixed when the line
// starts (so the board picker can avoid them), and the random board cards come from a fixed shuffle until you pick them.
function spotFreeze(){const b=spotBuilder,known=new Set(spotKnownCards().keys()),rng=G.rng(b.seed),deck=Array.from({length:52},(_,i)=>i).filter(c=>!known.has(c));
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 b.randomSeats=[];b.frozen=b.hands.map((h,seat)=>{if(h.some(c=>c===null)&&b.roles[seat]!=='out')b.randomSeats.push(seat);return h.map(c=>c===null?deck.pop():c);});}
function spotRunout(){const b=spotBuilder,out=[];for(const c of b.board){if(c===null)break;out.push(c);}return out;}
function spotActionLabel(a,before){if(a.kind==='fold')return'Fold';if(a.kind==='check')return'Check';if(a.kind==='call')return'Call';const tone=actionTones([a],before)[0];return toneLabel({...a,label:a.label||((a.kind==='raise'?'Raise to ':'Bet ')+fmt(G.bb(a.target))+' bb')},tone,before);}
function spotAutoFold(h,steps){const b=spotBuilder;while(!h.done&&h.street===0&&b.roles[h.actor]==='out'){const before=h.clone(),a={id:'f',kind:'fold',label:'Fold'};h.act(a);steps.push({seat:before.actor,street:0,label:'Fold',auto:true,action:a});}}
function spotLineHand(){const b=spotBuilder,h=new G.Hand(spotConfig(),{holes:b.frozen,runout:spotRunout(),rng:G.rng(b.seed+1)}),steps=[];spotAutoFold(h,steps);
 for(const a of b.line){const before=h.clone();h.act(a);steps.push({seat:before.actor,street:before.street,label:spotActionLabel(a,before),action:a});spotAutoFold(h,steps);}
 return{hand:h,steps};}
function renderSpotLine(){
 const b=spotBuilder,d=b.dialog,{hand:h,steps}=spotLineHand(),names=G.positions(b.n,0),hero=spotHero();
 d.querySelector('h2').textContent='New spot · Line';
 let log='';for(let st=0;st<=h.street;st++){const acts=steps.filter(x=>x.street===st),cards=st?h.board.slice(0,st+2):[];if(!acts.length&&st===h.street&&st&&h.done)continue;
  log+='<div class="sb-street"><span>'+['Preflop','Flop','Turn','River'][st]+'</span>'+(st?'<span class="sb-slots">'+cards.slice(st===1?0:st+1,st+2).map((c,k)=>{const i=st===1?k:st+1;return spotSlotHTML(-1,i,c,['Flop','Flop','Flop','Turn','River'][i]);}).join('')+'</span>':'')+'</div>'+
  '<div class="sb-chips">'+acts.map(x=>'<span class="sb-act'+(x.auto?' auto':'')+'"><b>'+names[x.seat]+'</b> '+esc(x.label)+'</span>').join('')+'</div>';}
 let panel='';
 if(h.done)panel='<p class="muted small">The hand is over. Undo to stop earlier.</p>';
 else{const acts=G.modelActions(h,state.abstraction),tones=actionTones(acts,h),l=h.legal(),me=h.actor===hero,hand=b.frozen[h.actor];
  panel='<div class="sb-turn"><div class="sb-turn-head"><b>'+names[h.actor]+(me?' · You':'')+'</b><span class="sb-turn-cards">'+(b.randomSeats.includes(h.actor)?'<span class="muted small">random</span>':hand.map(spotCardLabel).join(''))+'</span><span class="muted small">'+(l.toCall?'to call '+fmt(G.bb(l.callCost))+' · ':'')+'pot '+fmt(G.bb(h.pot))+'</span></div>'+
   '<div class="sb-acts">'+acts.map((a,i)=>'<button type="button" class="sb-actbtn" data-sb-act="'+i+'"><i style="background:var(--act-'+tones[i]+')"></i>'+esc(tones[i]==='allin'?'All-in':toneLabel(a,tones[i],h).replace(/ · .*/,''))+'</button>').join('')+'</div>'+
   (l.canRaise?'<div class="sb-custom"><input class="input" id="sbCustom" type="number" inputmode="decimal" min="0" step="0.1" placeholder="'+(h.currentBet?'Raise to':'Bet')+' (bb total)"><button type="button" class="btn secondary" data-sb-custom>'+(h.currentBet?'Raise':'Bet')+'</button></div>':'')+'</div>';}
 const boardPick=b.target?.seat===-1;
 d.querySelector('.ui-dialog-content').innerHTML=
  '<div class="sb-chips"><button type="button" class="sb-chip" data-sb-back>1 Players &amp; hands</button><span class="sb-chip on">2 Line</span></div>'+
  '<div class="sb-log">'+log+'</div>'+panel+
  (boardPick?'<p class="muted small">Pick the board card, or leave it random.</p>'+spotGridHTML():'<p class="muted small">Tap each action in order. Tap a board card to change it. Stop on the decision you want to study.</p>')+
  '<p class="ui-dialog-error sb-error" role="alert" hidden></p>'+
  '<div class="sb-foot"><button type="button" class="btn secondary" data-sb-undo'+(b.line.length?'':' disabled')+'>Undo</button><button type="button" class="btn" data-sb-study>'+(h.done?'Replay this hand':'Study this decision')+'</button></div>';
}
function spotError(m){const e=spotBuilder.dialog.querySelector('.sb-error');if(e){e.textContent=m;e.hidden=!m;}}
function spotPickCard(card){const b=spotBuilder,t=b.target;if(!t)return;let known=spotKnownCards();
 if(b.frozen){const owner=b.frozen.findIndex(h=>h.includes(card));if(owner>=0){spotError('That card is in '+G.positions(b.n,0)[owner]+'’s hand.');return;}}
 if(t.seat===-1){if(b.frozen){const shown=spotLineHand().hand.board;for(let i=0;i<t.i;i++)if(b.board[i]===null)b.board[i]=shown[i]??null;known=spotKnownCards();}
  const at=known.get(card);if(at&&at.seat===-1&&at.i!==t.i)b.board[at.i]=null;else if(at&&at.seat!==-1)b.hands[at.seat][at.i]=null;b.board[t.i]=card;
  if(b.frozen){b.target=null;spotTrimLine();return;}const next=b.board.findIndex((c,i)=>c===null&&i>t.i);b.target=next>=0?{seat:-1,i:next}:null;return;}
 const at=known.get(card);if(at){if(at.seat===-1)b.board[at.i]=null;else b.hands[at.seat][at.i]=null;}
 if(b.roles[t.seat]==='out')b.roles[t.seat]='in';b.hands[t.seat][t.i]=card;const next=b.hands[t.seat].findIndex(c=>c===null);b.target=next>=0?{seat:t.seat,i:next}:null;}
// A board change can make a later action illegal (an all-in already ran it out, say): keep the line up to there.
function spotTrimLine(){const b=spotBuilder;for(let k=b.line.length;k>=0;k--){const keep=b.line.slice(0,k);try{const saved=b.line;b.line=keep;spotLineHand();if(k<saved.length)spotError('Later actions were removed: they no longer fit.');return;}catch{}}}
function spotBuilderClick(event){
 const b=spotBuilder,t=event.target.closest('button');if(!t||t.disabled)return;const hole=spotHoleCount();
 if($('sbStack'))b.stack=+$('sbStack').value||b.stack;spotError('');
 if(t.dataset.sbFormat){const f=t.dataset.sbFormat;if(f!==b.format&&b.stack===STUDY_FORMATS[b.format].stack)b.stack=STUDY_FORMATS[f].stack;b.format=f;}
 else if(t.dataset.sbN){const hero=Math.max(0,spotHero());b.n=+t.dataset.sbN;spotResetSeats(hero<b.n?hero:0);}
 else if(t.dataset.sbRole){const [seat,role]=t.dataset.sbRole.split(':');const s=+seat;if(role==='you'){const old=spotHero();if(old>=0&&old!==s)b.roles[old]='in';}else if(b.roles[s]==='you'){status('Pick another seat as You first.');return;}
  b.roles[s]=role;if(role==='out'){b.hands[s].fill(null);if(b.target?.seat===s)b.target=null;}if(b.roles.filter(r=>r!=='out').length<2){b.roles[s]='in';spotError('A hand needs at least two players.');}}
 else if(t.dataset.sbSlot){const [seat,i]=t.dataset.sbSlot.split(':').map(Number),cur=seat===-1?b.board[i]:b.hands[seat][i],same=b.target&&b.target.seat===seat&&b.target.i===i;
  if(same&&cur!==null&&!b.frozen){if(seat===-1)b.board[i]=null;else b.hands[seat][i]=null;}else if(same&&b.frozen){b.target=null;}else b.target={seat,i};}
 else if(t.dataset.sbCard)spotPickCard(+t.dataset.sbCard);
 else if('sbAllin' in t.dataset){b.roles=b.roles.map(r=>r==='you'?r:'in');b.hands.forEach((h,s)=>{if(b.roles[s]!=='you')h.fill(null);});}
 else if('sbLine' in t.dataset){if(!spotCheck())return;b.seed=1+Math.floor(Math.random()*1e9);spotFreeze();b.line=[];b.target=null;b.step='line';}
 else if('sbBack' in t.dataset){b.step='setup';b.frozen=null;b.line=[];b.target={seat:Math.max(0,spotHero()),i:0};}
 else if(t.dataset.sbAct){const {hand:h}=spotLineHand(),a=G.modelActions(h,state.abstraction)[+t.dataset.sbAct];if(a)b.line.push(a);}
 else if('sbCustom' in t.dataset){const {hand:h}=spotLineHand(),l=h.legal(),v=+$('sbCustom').value,target=Math.min(G.units(v),l.maxRaiseTo);
  if(!(v>0)||target<=h.currentBet||target<l.minRaiseTo&&target!==l.allInTo){spotError('Enter the street total in bb: at least '+fmt(G.bb(Math.min(l.minRaiseTo,l.maxRaiseTo)))+', at most '+fmt(G.bb(l.maxRaiseTo))+'.');return;}
  const kind=h.currentBet?'raise':'bet',match=G.modelActions(h,state.abstraction).find(a=>a.kind===kind&&a.target===target);b.line.push(match||{kind,target,id:'u'+target,label:(kind==='raise'?'Raise to ':'Bet ')+fmt(G.bb(target))+' bb'});}
 else if('sbUndo' in t.dataset)b.line.pop();
 else if('sbDeal' in t.dataset){dealBuiltSpot(false);return;}
 else if('sbStudy' in t.dataset){dealBuiltSpot(true);return;}
 else return;
 renderSpotBuilder();
}
function spotCheck(){const b=spotBuilder,stack=+($('sbStack')?.value||b.stack);
 if(!(stack>=1&&stack<=1e6)){spotError('Stack needs to be at least 1 bb.');return false;}
 const half=b.hands.findIndex(h=>h.some(c=>c===null)&&h.some(c=>c!==null));if(half>=0){spotError('Pick both of '+G.positions(b.n,0)[half]+'’s cards, or none for a random hand.');return false;}
 if(state.busy){spotError('A calculation is running. Cancel it first.');return false;}
 b.stack=stack;return true;}
// Deals the spot into Train › Decision. With a line, the hand is replayed to its last action (the replay shows every
// earlier decision in History, and a finished line opens in Hand replay so each step can be analysed).
function dealBuiltSpot(withLine){
 const b=spotBuilder,d=b.dialog;if(!withLine&&!spotCheck())return;if(withLine&&state.busy){spotError('A calculation is running. Cancel it first.');return;}
 try{
  const config=spotConfig(),hero=Math.max(0,spotHero()),line=withLine?spotLineHand():null;
  if(line?.hand.done){const rec=H.record(line.hand,{hero,revealAll:true});d.close();loadHistory(rec);state.reviewIndex=0;renderReview();studioInterface.navigate?.('review');spotShowReplay();return;}
  stopTableMotion();writeForm(config,state.abstraction);$('hero').value=String(hero);
  const mine=withLine?b.frozen[hero]:b.hands[hero];$('heroCards').value=mine.some(c=>c===null)?'':mine.map(c=>C.cardName(c)).join(' ');markDirty();
  spotBuilder.pending={holes:withLine?b.frozen.map((h,s)=>b.roles[s]==='out'&&!b.hands[s].some(c=>c!==null)?null:h.slice()):b.hands.map(h=>h.some(c=>c===null)?null:h.slice()),runout:withLine?line.hand.board.concat(spotRunout().slice(line.hand.board.length)):spotRunout()};
  d.close();studioInterface.navigate?.('study');
  if(!deal(false)){spotBuilder.pending=null;return;}
  const h=state.hand;h.assisted=true;spotBuilder.live={dealId:h.dealId,out:b.roles.map((r,s)=>r==='out'?s:-1).filter(s=>s>=0)};
  const steps=withLine?line.steps:[];if(!withLine){const tmp=[];spotAutoFold(h.clone(),tmp);steps.push(...tmp);}
  for(const x of steps)h.act(x.action);
  if(steps.length){saveLiveSession();renderAll();}
 }catch(e){spotBuilder.pending=null;spotError(e.message);if(!d.open)status(e.message,true);}
}
// History › Every decision (Train › Decision only): each decision of the hand with the seat's cards and the strategy
// for them where a chart or the flop library answers it. Tap a row to open that step in Hand replay, which can solve it.
const everyDecision={key:'',html:''};
function everyDecisionHTML(){
 const h=state.hand;if(!h||!h.actionLog.length)return'';const key=h.dealId+'|'+h.actionLog.length+'|'+(h.done?1:0);if(everyDecision.key===key)return everyDecision.html;
 let frames;try{frames=H.frames(H.record(h,{hero:state.hero,revealAll:true}),state.abstraction);}catch{return'';}
 const names=G.positions(h.n,h.button),rows=[];let street=-1,folds=[];
 const flush=()=>{if(folds.length){rows.push('<button type="button" class="ed-row ed-folds" data-ed-step="'+folds[0].k+'"><b>'+folds.map(f=>names[f.seat]).join(', ')+'</b><span class="muted small">fold</span></button>');folds=[];}};
 h.actionLog.forEach((e,k)=>{const f=frames[k];if(!f)return;if(e.street!==street){flush();street=e.street;rows.push('<div class="ed-street"><span>'+G.STREET[street]+'</span>'+(street?'<span class="ed-board">'+f.board.map(c=>cardHTML(c)).join('')+'</span>':'')+'</div>');}
  const out=spotBuilder.live?.dealId===h.dealId&&spotBuilder.live.out.includes(e.seat);if(e.kind==='fold'&&street===0&&out){folds.push({k,seat:e.seat});return;}
  if(e.kind==='fold'&&street===0){let r=null;try{r=preflopReference(f);}catch{}const fi=r?.supported?r.actions.findIndex(a=>a.kind==='fold'):-1;if(!r?.supported||fi>=0&&(r.reference??r.probs)[fi]>.995){folds.push({k,seat:e.seat});return;}}
  flush();let r=null;try{r=activeSpotResult(f);if(!r?.supported)r=street===0?preflopReference(f):postflopLibraryReference(f);}catch{}
  const probs=r?.supported?(r.reference||r.probs):null,tones=probs?actionTones(r.actions,f):null,label=spotActionLabel(e,f).replace(/^Raise to /,'Raise ').replace(/ bb$/,'');
  const bar=probs?'<span class="ed-mix">'+r.actions.map((a,i)=>Number.isFinite(probs[i])&&probs[i]>0?'<i style="width:'+(probs[i]*100).toFixed(1)+'%;background:var(--act-'+tones[i]+')"></i>':'').join('')+'</span>':'<span class="ed-solve">Solve</span>';
  const sized=['bet','raise'].includes(e.kind);let took=probs?r.actions.findIndex(a=>a.kind===e.kind&&(!sized||a.target===e.target)):-1;
  if(took<0&&probs&&sized){let best=Infinity;r.actions.forEach((a,i)=>{const d=Math.abs((a.target||0)-e.target);if(['bet','raise'].includes(a.kind)&&!/all-in/i.test(a.label||'')&&d<best){best=d;took=i;}});}
  const q=took>=0&&Number.isFinite(probs[took])?probs[took]:null,pct=!probs?'':q===null?'<em class="ed-pct ed-bad" title="Not in the chart">—</em>':'<em class="ed-pct ed-'+(q>=.5?'good':q>=.1?'ok':'bad')+'">'+fmt(q*100,0)+'%</em>';
  rows.push('<button type="button" class="ed-row'+(probs?'':' ed-open')+'" data-ed-step="'+k+'"><b>'+names[e.seat]+'</b><span class="ed-cards">'+f.holes[e.seat].map(c=>cardHTML(c)).join('')+'</span>'+bar+'<span class="ed-took">'+esc(label)+pct+'</span></button>');});
 flush();
 if(!h.done){rows.push('<div class="ed-row ed-now"><b>'+names[h.actor]+'</b><span class="muted small">to act</span></div>');}
 everyDecision.key=key;everyDecision.html=rows.join('');return everyDecision.html;}
function renderEveryDecision(){const box=$('uiEveryDecision');if(!box)return;const show=studioInterface.area==='study'&&!!state.hand?.actionLog.length;box.hidden=!show;if(show)box.querySelector('.ed-body').innerHTML=everyDecisionHTML();}
// Hand replay keeps its import tools on top; jump past them to the table.
function spotShowReplay(){requestAnimationFrame(()=>$('reviewTable')?.scrollIntoView({block:'start',behavior:'auto'}));}
// A row with no chart or library answer starts the replay's analysis straight away.
function openDecisionStep(k,solve=false){const h=state.hand;if(!h)return;try{loadHistory(H.record(h,{hero:state.hero,revealAll:true}));state.reviewIndex=Math.min(k,state.reviewFrames.length-1);renderReview();studioInterface.navigate?.('review');spotShowReplay();if(solve)setTimeout(()=>{const b=$('reviewAnalyze');if(b&&!b.disabled)b.click();},0);}catch(e){status(e.message,true);}}
function initSpotBuilder(){
 const d=document.createElement('dialog');d.className='ui-dialog sb-dialog';d.id='uiSpotDialog';d.setAttribute('aria-label','New spot');
 d.innerHTML='<div class="ui-dialog-head"><h2>New spot</h2><button type="button" class="btn secondary" data-close-dialog>Close</button></div><div class="ui-dialog-content"></div>';
 (document.querySelector('.shell')||document.body).append(d);spotBuilder.dialog=d;
 d.querySelector('[data-close-dialog]').onclick=()=>d.close();
 d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();return;}spotBuilderClick(event);});
 d.addEventListener('change',event=>{if(event.target.id==='sbStack')spotBuilder.stack=+event.target.value||spotBuilder.stack;});
 d.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='sbCustom'){event.preventDefault();d.querySelector('[data-sb-custom]')?.click();}});
 d.addEventListener('close',()=>{if(![...document.querySelectorAll('dialog')].some(n=>n.open))document.body.classList.remove('ui-dialog-open');});
 // The planned board rides on the next deal only.
 const baseOptions=newHandOptions;newHandOptions=function(){const o=baseOptions(),p=spotBuilder.pending;if(p){spotBuilder.pending=null;if(p.runout.length)o.runout=p.runout;p.holes.forEach((cards,s)=>{if(cards)o.holes[s]=cards;});}return o;};
 // Out seats keep folding by themselves when they come to act preflop at the table.
 const baseBots=advanceBots;advanceBots=function(){baseBots();const h=state.hand,live=spotBuilder.live;if(!h||h.done||h.street!==0||!live||live.dealId!==h.dealId||!live.out.includes(h.actor))return;clearTimeout(spotBuilder.foldTimer);
  spotBuilder.foldTimer=setTimeout(()=>{if(state.hand===h&&!h.done&&h.street===0&&live.out.includes(h.actor)&&!tableView.playing&&!playBusy())applyPlayAction({id:'f',kind:'fold',label:'Fold'});},motionMs(350));};
 const pane=$('uiHistoryPane'),log=$('handLog');if(pane&&log){const box=document.createElement('section');box.id='uiEveryDecision';box.className='ed-box';box.hidden=true;box.innerHTML='<h2>Every decision</h2><div class="ed-body"></div>';log.before(box);
  box.addEventListener('click',e=>{const r=e.target.closest('[data-ed-step]');if(r)openDecisionStep(+r.dataset.edStep,r.classList.contains('ed-open'));});
  const baseRender=renderPlay;renderPlay=function(...args){const out=baseRender.apply(this,args);try{renderEveryDecision();}catch{}return out;};}
 const edit=$('uiEditGame');if(edit){const btn=document.createElement('button');btn.type='button';btn.className='btn secondary sb-open';btn.id='uiNewSpot';btn.textContent='New spot';btn.setAttribute('aria-haspopup','dialog');btn.onclick=openSpotBuilder;edit.before(btn);const wrap=document.createElement('div');wrap.className='sb-context-actions';btn.before(wrap);wrap.append(btn,edit);}
 const heading=document.querySelector('.ui-page-heading');if(heading){const box=document.createElement('div');box.className='sb-chips study-format';box.id='uiStudyFormat';box.setAttribute('role','group');box.setAttribute('aria-label','Game');
  box.innerHTML=Object.entries(STUDY_FORMATS).map(([k,f])=>'<button type="button" class="sb-chip" data-study-format="'+k+'" aria-pressed="false">'+f.label+'</button>').join('');
  box.onclick=e=>{const t=e.target.closest('[data-study-format]');if(t)setStudyFormat(t.dataset.studyFormat);};heading.querySelector('h1').after(box);syncStudyFormat(state.config);}
 studioInterface.openSpotBuilder=openSpotBuilder;
}
