// New hand (Solve tab): pick players, stack, your seat, your hand and any board cards, then the hand starts in Solve
// with every seat under your control. Play the line, and the analysis pane solves it through the usual routes
// (preflop charts, flop library, Mac bridge with its progress bar).
const spotBuilder={n:6,stack:100,stacks:[],prize:'chip',left:0,pay:[],format:'cash',step:'setup',roles:[],hands:[],board:[],target:null,line:[],frozen:null,randomSeats:[],seed:1,pending:null,live:null,dialog:null};
// Cash or tournament. Tournament spots have a 1 bb big-blind ante. Prizes: Chip EV (one paid place, the game the
// bundled MTT charts are solved for), or ICM from players left and the payouts (Bubble and Final table fill those in).
// Players left beyond the table get the table's average stack; exact ICM takes up to 12 players.
const STUDY_FORMATS={cash:{label:'Cash',stack:100},mtt:{label:'Tournament',stack:25}};
const studyFormatOf=c=>c?.mode==='icm'?'mtt':'cash';
function studyFormatFields(c,format){
 if(studyFormatOf(c)===format)return{};
 return format==='mtt'?{mode:'icm',ante:c?.startStreet?0:1,anteMode:'bigblind',payouts:[1],otherStacks:[],rakePct:0}:{mode:'cash',ante:0,bounties:Array(c?.seats||2).fill(0)};
}
const SB_FT_PAY=[25,17,12.5,9.5,7.5,6,5,4,3.5,3,2.5,2];
const SB_PRIZES={chip:'Chip EV',bubble:'Bubble',ft:'Final table'};
function spotPrizePreset(key){const b=spotBuilder;b.prize=key;if(key==='bubble'){b.left=Math.min(12,b.n+1);b.pay=SB_FT_PAY.slice(0,b.left-1);}else if(key==='ft'){b.left=b.n;b.pay=SB_FT_PAY.slice(0,b.n);}}
function spotStacks(){const b=spotBuilder;return Array.from({length:b.n},(_,s)=>b.stacks[s]>0?b.stacks[s]:b.stack);}
function spotPrizeFields(){const b=spotBuilder;if(b.format!=='mtt')return{};if(b.prize==='chip')return{payouts:[1],otherStacks:[]};
 const stacks=spotStacks(),left=Math.max(b.n,Math.min(12,Math.round(b.left)||b.n)),avg=stacks.reduce((s,x)=>s+x,0)/b.n,pay=b.pay.filter(x=>x>0).sort((x,y)=>y-x).slice(0,left);
 return{payouts:pay.length?pay:[1],otherStacks:Array(left-b.n).fill(Math.round(avg*10)/10)};}
function spotSeatsInOrder(n,button){return n===2?[button,(button+1)%n]:Array.from({length:n},(_,k)=>(button+3+k)%n);}
function spotHoleCount(){return state.config?.rules?.hole||2;}
function spotCardLabel(c){const s=C.cardName(c);return'<span class="sb-pip suit-'+s[1]+'">'+s[0]+'<i>'+{c:'♣',d:'♦',h:'♥',s:'♠'}[s[1]]+'</i></span>';}
function spotSeatOptions(){return[...$('seats').options].filter(o=>!o.disabled).map(o=>+o.value);}
// Seats: each one is out (folds preflop by itself), in the hand, or you. Hands: exact cards, or none for a random hand
// (that seat's whole range is what the strategy is about anyway). Seat 0 is always the button.
function spotResetSeats(hero){const b=spotBuilder,hole=spotHoleCount();b.roles=Array(b.n).fill('in');b.roles[Math.min(hero??0,b.n-1)]='you';b.hands=Array.from({length:b.n},()=>Array(hole).fill(null));b.pick=Array(b.n).fill(false);b.stacks=Array(b.n).fill(null);b.target=null;if(b.prize!=='chip')spotPrizePreset(b.prize);}
function spotHero(){return spotBuilder.roles.indexOf('you');}
function openSpotBuilder(){
 if(state.busy){status('A calculation is running. Cancel it first.',true);return;}
 const b=spotBuilder,c=state.config||{},hole=spotHoleCount(),seats=spotSeatOptions();
 const keepLine=!!(b.step==='line'&&b.frozen&&b.roles?.length===b.n);
 b.format=studyFormatOf(c);if(b.stacks?.length!==b.n)b.stacks=Array(b.n).fill(null);if(!keepLine){b.step='setup';b.line=[];b.frozen=null;}
 // Reopening keeps the sheet as you left it while the table still matches it; otherwise it starts from the table.
 const same=keepLine||b.roles?.length&&b.roles.length===c.seats&&c.button===0&&b.hands?.[0]?.length===hole;
 if(!same){b.n=seats.includes(c.seats)?c.seats:seats.includes(6)?6:seats[0];const hero=c.seats===b.n&&Number.isInteger(state.hero)?((state.hero-(c.button||0))%b.n+b.n)%b.n:0;spotResetSeats(hero);b.stack=c.stacks?.[state.hero??0]||STUDY_FORMATS[b.format].stack;}
 if(b.board?.length!==5)b.board=Array(5).fill(null);
 if(b.pick?.length!==b.n)b.pick=Array(b.n).fill(false);
 renderSpotBuilder();const d=b.dialog;if(!d.open){document.body.classList.add('ui-dialog-open');d.showModal();}
}
function spotConfig(){const b=spotBuilder,base={...state.config,seats:b.n,startStreet:0};return G.normalize({...base,...studyFormatFields(base,b.format),seats:b.n,button:0,...spotPrizeFields(),stacks:spotStacks(),bounties:Array(b.n).fill(0),startStreet:0,board:'',pot:0});}
// Preflop, the builder offers the raise sizes the chart for this format and depth was solved with at this decision (2.2bb
// tournament opens, 2.5bb cash, 2bb short), so a built line stays on the chart's tree; other sizes go in the custom box.
// Phones hold only the chart the table needs, so the builder fetches the chart for its own format and depth once and redraws.
const spotChartFetches=new Set();
function spotEnsureChart(h){
 const m=typeof bundleManifest!=='undefined'&&bundleManifest;if(!m)return;
 const c=h.config,mode=c.mode==='cash'||!(c.ante>0)?'cash':'icm',stack=G.bb(Math.max(...h.initial)),
  fit=m.packs.filter(p=>p.variant===c.variant&&p.mode===mode&&p.seats===c.seats).sort((a,b)=>Math.abs(Math.log(a.stack/stack))-Math.abs(Math.log(b.stack/stack)))[0];
 if(!fit||spotChartFetches.has(fit.file)||preflopLibrary.packs.some(p=>p.name===fit.name&&p.config.seats===fit.seats))return;spotChartFetches.add(fit.file);
 phoneFetch(fit.file).then(input=>{if(preflopLibrary.packs.some(p=>p.name===fit.name&&p.config.seats===fit.seats))return;const pack=PokerPreflop.validate(input);memoryOnly.add(pack);
  const old=preflopLibrary.packs.filter(p=>memoryOnly.has(p));if(old.length>=2)preflopLibrary.packs.splice(preflopLibrary.packs.indexOf(old[0]),1);preflopLibrary.packs.push(pack);
  if(spotBuilder.step==='line')renderSpotBuilder();}).catch(()=>{}).finally(()=>spotChartFetches.delete(fit.file));
}
function spotActions(h){const acts=G.modelActions(h,state.abstraction);if(h.street!==0||!h.legal().canRaise)return acts;let q=null;spotEnsureChart(h);
 try{const c=spotConfig(),packs=preflopLibrary.packs.filter(p=>p.config.variant===c.variant&&p.config.seats===c.seats);q=packs.length?PokerPreflop.nearest(packs,h):null;}catch{q=null;}
 const l=h.legal(),all=l.allInTo,sizes=q?.actions?[...new Set(q.actions.filter((a,i)=>a.kind==='raise'&&a.target<all&&a.target>=l.minRaiseTo&&a.target<=l.maxRaiseTo&&q.reference?.[i]!==null).map(a=>a.target))].sort((a,b)=>a-b):[];
 if(!sizes.length)return acts;const raises=sizes.map((t,i)=>({id:'k'+i,kind:'raise',target:t,label:'Raise to '+fmt(G.bb(t))+' bb'}));
 return[...acts.filter(a=>a.kind!=='raise'&&a.kind!=='bet'),...raises,...acts.filter(a=>(a.kind==='raise'||a.kind==='bet')&&a.target>=all)];}
function spotKnownCards(){const b=spotBuilder;return new Map([...b.hands.flatMap((h,seat)=>h.map((c,i)=>[c,{seat,i}])),...b.board.map((c,i)=>[c,{seat:-1,i}])].filter(([c])=>c!==null));}
function spotGridHTML(){const used=spotKnownCards();if(spotBuilder.frozen)spotBuilder.frozen.forEach((h,seat)=>h.forEach((c,i)=>{if(!used.has(c))used.set(c,{seat,i})}));let grid='';
 for(const suit of[3,2,1,0])for(let r=12;r>=0;r--){const card=r*4+suit,taken=used.has(card);grid+='<button type="button" class="sb-card'+(taken?' taken':'')+'" data-sb-card="'+card+'" aria-label="'+cardSpeech(card)+'">'+spotCardLabel(card)+'</button>';}
 return'<div class="sb-grid" role="group" aria-label="Pick a card">'+grid+'</div>';}
// A picked card you tap gets a small x at its top-right corner that takes it off (pick another card to replace it instead).
function spotSlotHTML(seat,i,card,label){const t=spotBuilder.target,on=t&&t.seat===seat&&t.i===i,slot='<button type="button" class="sb-slot'+(on?' active':'')+(card===null?'':' filled')+'" data-sb-slot="'+seat+':'+i+'" aria-label="'+label+'">'+(card===null?'':spotCardLabel(card))+'</button>';
 return on&&card!==null&&!spotBuilder.frozen?'<span class="sb-slot-wrap">'+slot+'<button type="button" class="sb-x" data-sb-clear="'+seat+':'+i+'" aria-label="Remove '+label+'">×</button></span>':slot;}
// Each player's hand is Random or specific Cards.
const SB_DICE='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1.2" fill="currentColor"/></svg>';
const SB_CARDS='<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="3.2" width="7.4" height="10.4" rx="1.6" transform="rotate(-10 5.5 8.4)" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="6.6" y="2.6" width="7.4" height="10.4" rx="1.6" transform="rotate(8 10.3 7.8)" fill="var(--panel2)" stroke="currentColor" stroke-width="1.5"/></svg>';
function spotPicking(seat){const b=spotBuilder;return!!(b.pick?.[seat]||b.hands[seat]?.some(c=>c!==null));}
function spotBoardHTML(){const b=spotBuilder;return b.board.map((c,i)=>spotSlotHTML(-1,i,c,['Flop','Flop','Flop','Turn','River'][i])).join('');}
function renderSpotBuilder(){const b=spotBuilder;if(b.step==='line')return renderSpotLine();
 const d=b.dialog,hole=spotHoleCount(),order=spotSeatsInOrder(b.n,0),names=G.positions(b.n,0),inHand=b.roles.filter(r=>r!=='out').length;
 const chip=(attr,label,on)=>'<button type="button" class="sb-chip'+(on?' on':'')+'" '+attr+' aria-pressed="'+on+'">'+label+'</button>';
 d.querySelector('h2').textContent='New hand';
 d.querySelector('.ui-dialog-content').innerHTML=
  '<div class="sb-row"><span class="sb-label">Game</span><div class="sb-chips">'+Object.entries(STUDY_FORMATS).map(([k,f])=>chip('data-sb-format="'+k+'"',f.label,k===b.format)).join('')+'</div></div>'+
  '<div class="sb-row"><span class="sb-label">Table</span><div class="sb-chips">'+spotSeatOptions().map(n=>chip('data-sb-n="'+n+'"',n,n===b.n)).join('')+'</div></div>'+
  '<div class="sb-row"><label class="sb-label" for="sbStack">Stack</label><div class="sb-chips"><input class="input sb-stack" id="sbStack" type="number" inputmode="decimal" min="1" step="1" value="'+b.stack+'"><span class="muted small">bb</span></div></div>'+
  (b.format==='mtt'?'<div class="sb-row"><span class="sb-label">Prizes</span><div class="sb-chips">'+Object.entries(SB_PRIZES).map(([k,l])=>chip('data-sb-prize="'+k+'"',l,k===b.prize)).join('')+'</div></div>'+
   (b.prize==='chip'?'':'<div class="sb-row"><span class="sb-label"></span><div class="sb-chips sb-prize"><label>Left <input class="input" id="sbLeft" type="number" inputmode="numeric" min="'+b.n+'" max="12" step="1" value="'+b.left+'"></label><label>Paid <input class="input" id="sbPay" inputmode="decimal" value="'+b.pay.join(' ')+'" placeholder="50 30 20"></label></div></div>'):'')+
  '<div class="sb-row"><span class="sb-label">Board</span><div class="sb-slots">'+spotBoardHTML()+'</div></div>'+(b.target?.seat===-1?spotGridHTML():'')+
  '<div class="sb-head"><strong>Players · '+inHand+' in the hand</strong></div>'+
  '<div class="sb-seats">'+order.map(seat=>{const role=b.roles[seat],h=b.hands[seat],pick=spotPicking(seat),t=b.target?.seat===seat;
   return'<div class="sb-seat'+(role==='out'?' out':'')+'"><span class="sb-pos"><b>'+names[seat]+'</b><input class="input sb-seat-stack" type="number" inputmode="decimal" min="0.1" step="any" data-sb-seat-stack="'+seat+'" value="'+(b.stacks[seat]>0?b.stacks[seat]:'')+'" placeholder="'+fmt(b.stack)+'" aria-label="'+names[seat]+' stack in bb"></span><div class="sb-seg" role="group" aria-label="'+names[seat]+'">'+[['out','Out'],['in','In'],['you','You']].map(([k,l])=>'<button type="button" class="'+(role===k?'on':'')+'" data-sb-role="'+seat+':'+k+'" aria-pressed="'+(role===k)+'">'+l+'</button>').join('')+'</div>'+
   '<div class="sb-hand">'+(role==='out'?'<span class="muted small">folds preflop</span>':(pick?h.map((c,i)=>spotSlotHTML(seat,i,c,names[seat]+' card '+(i+1))).join(''):'')+
    '<div class="sb-seg sb-mode" role="group" aria-label="'+names[seat]+' hand">'+[['random',SB_DICE,'Random hand'],['cards',SB_CARDS,'Pick cards']].map(([k,icon,l])=>{const on=(k==='cards')===pick;return'<button type="button" class="'+(on?'on':'')+'" data-sb-mode="'+seat+':'+k+'" aria-pressed="'+on+'" aria-label="'+l+'" title="'+l+'">'+icon+'</button>';}).join('')+'</div>')+'</div></div>'+(t&&role!=='out'?spotGridHTML():'');}).join('')+'</div>'+
  '<p class="ui-dialog-error sb-error" role="alert" hidden></p>'+
  '<div class="sb-foot"><button type="button" class="btn secondary" data-sb-deal>Deal spot</button><button type="button" class="btn" data-sb-line>Enter the line</button></div>';
}
// The line: every action in order, on any street. Out seats fold by themselves; In seats and You never fold preflop (they reach the flop), so the line offers no Fold there. Random hands are fixed when the line
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
 d.querySelector('h2').textContent='New hand · Line';
 steps.forEach((x,k)=>x.k=k);
 let log='';for(let st=0;st<=h.street;st++){const acts=steps.filter(x=>x.street===st),cards=st?h.board.slice(0,st+2):[];if(!acts.length&&st===h.street&&st&&h.done)continue;
  log+='<div class="sb-street"><span>'+['Preflop','Flop','Turn','River'][st]+'</span>'+(st?'<span class="sb-slots">'+cards.slice(st===1?0:st+1,st+2).map((c,k)=>{const i=st===1?k:st+1;return spotSlotHTML(-1,i,c,['Flop','Flop','Flop','Turn','River'][i]);}).join('')+'</span>':'')+'</div>'+
  '<div class="sb-chips">'+acts.map(x=>x.auto?'<span class="sb-act auto"><b>'+names[x.seat]+'</b> '+esc(x.label)+'</span>':'<button type="button" class="sb-act" data-sb-step="'+x.k+'" aria-label="Analyse '+names[x.seat]+' '+esc(x.label)+'"><b>'+names[x.seat]+'</b> '+esc(x.label)+'</button>').join('')+'</div>';}
 // Streets still to come show dimmed with their board cards, so it's clear the line carries on once this street closes.
 // Their cards can be picked here too, in order (flop, then turn, then river).
 let later='';if(!h.done){const known=spotRunout().length;for(let st=h.street+1;st<=3;st++){const from=st===1?0:st+1;if(known<from)break;
  later+='<div class="sb-street sb-later"><span>'+['Preflop','Flop','Turn','River'][st]+'</span><span class="sb-slots">'+[0,1,2,3,4].slice(from,st+2).map(i=>spotSlotHTML(-1,i,b.board[i],['Flop','Flop','Flop','Turn','River'][i])).join('')+'</span></div>';}}
 let panel='';
 if(h.done)panel='<p class="muted small">The hand is over. Undo to stop earlier.</p>';
 else{const acts=spotActions(h),tones=actionTones(acts,h),l=h.legal(),me=h.actor===hero,hand=b.frozen[h.actor];
  panel='<div class="sb-turn"><div class="sb-turn-head"><b>'+names[h.actor]+(me?' · You':'')+'</b><span class="sb-turn-cards">'+(b.randomSeats.includes(h.actor)?'<span class="muted small">random</span>':hand.map(spotCardLabel).join(''))+'</span><span class="muted small">'+(l.toCall?'to call '+fmt(G.bb(l.callCost))+' · ':'')+'pot '+fmt(G.bb(h.pot))+'</span></div>'+
   '<div class="sb-acts">'+acts.map((a,i)=>h.street===0&&a.kind==='fold'?'':'<button type="button" class="sb-actbtn" data-sb-act="'+i+'"><i style="background:var(--act-'+tones[i]+')"></i>'+esc(tones[i]==='allin'?'All-in':toneLabel(a,tones[i],h).replace(/ · .*/,''))+'</button>').join('')+'</div>'+
   (l.canRaise?'<div class="sb-custom"><input class="input" id="sbCustom" type="number" inputmode="decimal" min="0" step="0.1" placeholder="'+(h.currentBet?'Raise to':'Bet')+' (bb total)"><button type="button" class="btn secondary" data-sb-custom>'+(h.currentBet?'Raise':'Bet')+'</button></div>':'')+'</div>';}
 const boardPick=b.target?.seat===-1;
 d.querySelector('.ui-dialog-content').innerHTML=
  '<div class="sb-chips"><button type="button" class="sb-chip" data-sb-back>1 Players &amp; hands</button><span class="sb-chip on">2 Line</span></div>'+
  '<div class="sb-log">'+log+'</div>'+panel+(later?'<div class="sb-log">'+later+'</div>':'')+
  (boardPick?'<p class="muted small">Pick the board card, or leave it random.</p>'+spotGridHTML():'<p class="muted small">Tap each action in order. Tap a board card to change it. Stop on the decision you want to study.</p>')+
  '<p class="ui-dialog-error sb-error" role="alert" hidden></p>'+
  '<div class="sb-foot"><button type="button" class="btn secondary" data-sb-undo'+(b.line.length?'':' disabled')+'>Undo</button><button type="button" class="btn" data-sb-study>'+(h.done?'Replay this hand':'Solve this spot')+'</button></div>';
}
function spotError(m){const e=spotBuilder.dialog.querySelector('.sb-error');if(e){e.textContent=m;e.hidden=!m;}}
function spotPickCard(card){const b=spotBuilder,t=b.target;if(!t)return;let known=spotKnownCards();
 if(b.frozen){const owner=b.frozen.findIndex(h=>h.includes(card));if(owner>=0){spotError('That card is in '+G.positions(b.n,0)[owner]+'’s hand.');return;}}
 if(t.seat===-1){if(b.frozen){const shown=spotLineHand().hand.board;for(let i=0;i<t.i;i++)if(b.board[i]===null)b.board[i]=shown[i]??null;known=spotKnownCards();}
  const dealt=b.frozen?spotLineHand().hand.board.length:0,later=b.frozen&&t.i>=dealt;if(later)t.i=Math.max(dealt,Math.min(t.i,spotRunout().length));
  const at=known.get(card);if(at&&at.seat===-1&&at.i!==t.i)b.board[at.i]=null;else if(at&&at.seat!==-1)b.hands[at.seat][at.i]=null;b.board[t.i]=card;
  if(b.frozen){const next=later&&t.i<2?b.board.findIndex((c,i)=>c===null&&i>t.i&&i<3):-1;b.target=next>=0?{seat:-1,i:next}:null;spotTrimLine();return;}const next=b.board.findIndex((c,i)=>c===null&&i>t.i);b.target=next>=0?{seat:-1,i:next}:null;return;}
 const at=known.get(card);if(at){if(at.seat===-1)b.board[at.i]=null;else b.hands[at.seat][at.i]=null;}
 if(b.roles[t.seat]==='out')b.roles[t.seat]='in';b.hands[t.seat][t.i]=card;const next=b.hands[t.seat].findIndex(c=>c===null);b.target=next>=0?{seat:t.seat,i:next}:null;}
// A board change can make a later action illegal (an all-in already ran it out, say): keep the line up to there.
function spotTrimLine(){const b=spotBuilder;for(let k=b.line.length;k>=0;k--){const keep=b.line.slice(0,k);try{const saved=b.line;b.line=keep;spotLineHand();if(k<saved.length)spotError('Later actions were removed: they no longer fit.');return;}catch{}}}
function spotBuilderClick(event){
 const b=spotBuilder,t=event.target.closest('button');if(!t||t.disabled)return;const hole=spotHoleCount();
 spotReadInputs();spotError('');
 if(t.dataset.sbPrize)spotPrizePreset(t.dataset.sbPrize);
 else if(t.dataset.sbFormat){const f=t.dataset.sbFormat;if(f!==b.format&&b.stack===STUDY_FORMATS[b.format].stack)b.stack=STUDY_FORMATS[f].stack;b.format=f;}
 else if(t.dataset.sbN){const hero=Math.max(0,spotHero());b.n=+t.dataset.sbN;spotResetSeats(hero<b.n?hero:0);}
 else if(t.dataset.sbRole){const [seat,role]=t.dataset.sbRole.split(':');const s=+seat;if(role==='you'){const old=spotHero();if(old>=0&&old!==s)b.roles[old]='in';}
  b.roles[s]=role;if(role==='out'){b.hands[s].fill(null);b.pick[s]=false;if(b.target?.seat===s)b.target=null;}if(b.roles.filter(r=>r!=='out').length<2){b.roles[s]='in';spotError('A hand needs at least two players.');}}
 else if(t.dataset.sbSlot){const [seat,i]=t.dataset.sbSlot.split(':').map(Number),same=b.target&&b.target.seat===seat&&b.target.i===i;
  b.target=same?null:{seat,i};}
 else if(t.dataset.sbClear){const [seat,i]=t.dataset.sbClear.split(':').map(Number);if(seat===-1)b.board[i]=null;else b.hands[seat][i]=null;b.target={seat,i};}
 else if(t.dataset.sbMode){const [seat,mode]=t.dataset.sbMode.split(':'),s=+seat;b.pick[s]=mode==='cards';
  if(mode==='cards'){const i=b.hands[s].findIndex(c=>c===null);b.target={seat:s,i:i<0?0:i};}else{b.hands[s].fill(null);if(b.target?.seat===s)b.target=null;}}
 else if(t.dataset.sbCard)spotPickCard(+t.dataset.sbCard);
 else if('sbReset' in t.dataset){b.stack=STUDY_FORMATS[b.format].stack;b.prize='chip';b.board=Array(5).fill(null);spotResetSeats(0);b.step='setup';b.line=[];b.frozen=null;}
 else if('sbLine' in t.dataset){if(!spotCheck())return;b.seed=1+Math.floor(Math.random()*1e9);spotFreeze();b.line=[];b.target=null;b.step='line';}
 else if('sbBack' in t.dataset){b.step='setup';b.frozen=null;b.line=[];b.target=null;}
 else if(t.dataset.sbAct){const {hand:h}=spotLineHand(),a=spotActions(h)[+t.dataset.sbAct];if(a)b.line.push(a);}
 else if('sbCustom' in t.dataset){const {hand:h}=spotLineHand(),l=h.legal(),v=+$('sbCustom').value,target=Math.min(G.units(v),l.maxRaiseTo);
  if(!(v>0)||target<=h.currentBet||target<l.minRaiseTo&&target!==l.allInTo){spotError('Enter the street total in bb: at least '+fmt(G.bb(Math.min(l.minRaiseTo,l.maxRaiseTo)))+', at most '+fmt(G.bb(l.maxRaiseTo))+'.');return;}
  const kind=h.currentBet?'raise':'bet',match=spotActions(h).find(a=>a.kind===kind&&a.target===target);b.line.push(match||{kind,target,id:'u'+target,label:(kind==='raise'?'Raise to ':'Bet ')+fmt(G.bb(target))+' bb'});}
 else if('sbUndo' in t.dataset)b.line.pop();
 else if('sbDeal' in t.dataset){dealBuiltSpot(false);return;}
 else if('sbStudy' in t.dataset){dealBuiltSpot(true);return;}
 else if(t.dataset.sbStep){spotAnalyseStep(+t.dataset.sbStep);return;}
 else return;
 renderSpotBuilder();
}
function spotReadInputs(){const b=spotBuilder,d=b.dialog;if($('sbStack'))b.stack=+$('sbStack').value||b.stack;
 d?.querySelectorAll('[data-sb-seat-stack]').forEach(x=>{const v=+x.value;b.stacks[+x.dataset.sbSeatStack]=x.value.trim()&&v>0?v:null;});
 if($('sbLeft'))b.left=+$('sbLeft').value||b.left;if($('sbPay'))b.pay=$('sbPay').value.split(/[\s,;/]+/).map(Number).filter(x=>x>0);}
function spotCheck(){spotReadInputs();const b=spotBuilder,stack=+($('sbStack')?.value||b.stack);
 if(spotHero()<0){spotError('Tap You on your seat.');return false;}
 if(!(stack>=1&&stack<=1e6)){spotError('Stack needs to be at least 1 bb.');return false;}
 const half=b.hands.findIndex(h=>h.some(c=>c===null)&&h.some(c=>c!==null));if(half>=0){spotError('Pick both of '+G.positions(b.n,0)[half]+'’s cards, or none for a random hand.');return false;}
 if(b.format==='mtt'&&b.prize!=='chip'){if(!(b.left>=b.n&&b.left<=12)){spotError('Players left: '+b.n+' to 12.');return false;}if(!b.pay.length){spotError('Enter the payouts, first place first.');return false;}}
 if(state.busy){spotError('A calculation is running. Cancel it first.');return false;}
 b.stack=stack;return true;}
// Deals the spot into Train › Decision. With a line, the hand is replayed to its last action (the replay shows every
// earlier decision in History, and a finished line opens in Hand replay so each step can be analysed).
// Tapping an action in the line opens the whole line in Hand replay at that decision and starts its analysis.
// The sheet keeps the line, so reopening it lets you pick another decision.
function spotAnalyseStep(k){const b=spotBuilder;if(state.busy){spotError('A calculation is running. Cancel it first.');return;}
 try{const {hand:h}=spotLineHand(),rec=H.record(h,{hero:Math.max(0,spotHero()),revealAll:true});b.dialog.close();loadHistory(rec);
  state.reviewIndex=Math.min(k,state.reviewFrames.length-1);renderReview();studioInterface.navigate?.('review');spotShowReplay();
  setTimeout(()=>{const a=$('reviewAnalyze');if(a&&!a.disabled)a.click();},0);}catch(e){spotError(e.message);if(!b.dialog.open)status(e.message,true);}}
function spotReplaySame(){const h=state.hand;if(!h?.done)return;const live=spotBuilder.live?.dealId===h.dealId?spotBuilder.live:null;
 spotBuilder.pending={holes:h.holes.map(c=>c.slice()),runout:h.board.slice()};if(!deal(false)){spotBuilder.pending=null;return;}
 const n=state.hand;n.assisted=true;if(!live)return;spotBuilder.live={dealId:n.dealId,out:live.out.slice()};
 let folded=false;while(!n.done&&n.street===0&&live.out.includes(n.actor)){n.act({id:'f',kind:'fold',label:'Fold'});folded=true;}if(folded){saveLiveSession();renderAll();}}
function dealBuiltSpot(withLine){
 const b=spotBuilder,d=b.dialog;if(!withLine&&!spotCheck())return;if(withLine&&state.busy){spotError('A calculation is running. Cancel it first.');return;}
 try{
  const config=spotConfig(),hero=Math.max(0,spotHero()),line=withLine?spotLineHand():null;
  if(line?.hand.done){const rec=H.record(line.hand,{hero,revealAll:true});d.close();loadHistory(rec);state.reviewIndex=0;renderReview();studioInterface.navigate?.('review');spotShowReplay();return;}
  d.close();studioInterface.navigate?.('solve');// Solve's own table first, so the Play setup is never touched
  stopTableMotion();writeForm(config,state.abstraction);$('hero').value=String(hero);
  const mine=withLine?b.frozen[hero]:b.hands[hero];$('heroCards').value=mine.some(c=>c===null)?'':mine.map(c=>C.cardName(c)).join(' ');markDirty();
  spotBuilder.pending={holes:withLine?b.frozen.map((h,s)=>b.roles[s]==='out'&&!b.hands[s].some(c=>c!==null)?null:h.slice()):b.hands.map(h=>h.some(c=>c===null)?null:h.slice()),runout:withLine?line.hand.board.concat(spotRunout().slice(line.hand.board.length)):spotRunout()};
  if(!deal(false)){spotBuilder.pending=null;return;}
  const h=state.hand;h.assisted=true;spotBuilder.live={dealId:h.dealId,out:b.roles.map((r,s)=>r==='out'?s:-1).filter(s=>s>=0)};
  const steps=withLine?line.steps:[];if(!withLine){const tmp=[];spotAutoFold(h.clone(),tmp);steps.push(...tmp);}
  for(const x of steps)h.act(x.action);
  if(steps.length){saveLiveSession();renderAll();}
 }catch(e){spotBuilder.pending=null;spotError(e.message);if(!d.open)status(e.message,true);}
}
// Play › Analysis "Solve": copies the hand being played into Solve's own table, up to the action you are at (same seats,
// stacks, button, your cards, board and line), so you can keep solving and exploring it there. The Play game is not touched.
// Opponents' hidden cards are not copied while the hand is live (they'd be dealt at random), and a live decision opened
// this way counts as a peek, like looking at the analysis. A finished hand opens in Hand replay with every card shown.
function openPlayInSolve(){
 const p=state.hand;if(!p||state.busy||tableSlots.owner!=='play')return;
 const hero=state.hero;
 if(p.done){try{loadHistory(H.record(p,{hero,revealAll:true}));state.reviewIndex=0;renderReview();studioInterface.navigate?.('review');spotShowReplay();}catch(e){status(e.message,true);}return;}
 const at=p.actionLog.length;if(p.actor===hero&&!(p.guessed||[]).includes(at)&&!(p.peeks||[]).includes(at)){p.peeks=[...(p.peeks||[]),at];saveLiveSession();}
 const config=G.normalize(p.config),holes=p.holes.map((c,s)=>s===hero?c.slice():null),runout=p.board.slice(config.boardCards.length),actions=p.actionLog.map(a=>({...a}));
 studioInterface.navigate?.('solve');
 try{
  stopTableMotion();writeForm(config,state.abstraction);$('hero').value=String(hero);$('heroCards').value=holes[hero].map(c=>C.cardName(c)).join(' ');markDirty();
  spotBuilder.pending={holes,runout};if(!deal(false)){spotBuilder.pending=null;return;}
  const h=state.hand;h.assisted=true;spotBuilder.live={dealId:h.dealId,out:[]};
  for(const a of actions)h.act(a);
  renderAll();
 }catch(e){spotBuilder.pending=null;status(e.message,true);}
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
 $('uiOpenSolve')?.addEventListener('click',openPlayInSolve);
 const d=document.createElement('dialog');d.className='ui-dialog sb-dialog';d.id='uiSpotDialog';d.setAttribute('aria-label','New hand');
 d.innerHTML='<div class="ui-dialog-head"><h2>New hand</h2><div class="sb-head-actions"><button type="button" class="btn secondary" data-sb-reset>Reset</button><button type="button" class="btn secondary" data-close-dialog>Close</button></div></div><div class="ui-dialog-content"></div>';
 (document.querySelector('.shell')||document.body).append(d);spotBuilder.dialog=d;
 d.querySelector('[data-close-dialog]').onclick=()=>d.close();
 d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();return;}spotBuilderClick(event);});
 d.addEventListener('input',event=>{if(event.target.id==='sbStack'){spotBuilder.stack=+event.target.value||spotBuilder.stack;d.querySelectorAll('[data-sb-seat-stack]').forEach(x=>x.placeholder=fmt(spotBuilder.stack));}});
 d.addEventListener('change',()=>spotReadInputs());
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
 const edit=$('uiEditGame');if(edit){const btn=document.createElement('button');btn.type='button';btn.className='btn secondary sb-open';btn.id='uiNewSpot';btn.textContent='New hand';btn.setAttribute('aria-haspopup','dialog');btn.onclick=openSpotBuilder;edit.before(btn);const wrap=document.createElement('div');wrap.className='sb-context-actions';btn.before(wrap);wrap.append(btn,edit);}
 // Hand replay shows the ICM call card under the step too.
 const baseReview=renderReview;renderReview=function(...args){const out=baseReview.apply(this,args);try{const fb=$('reviewFeedback');if(fb){let box=$('reviewIcm');if(!box){box=document.createElement('div');box.id='reviewIcm';fb.after(box);}const f=state.reviewFrames[state.reviewIndex];box.innerHTML=f&&!f.done&&f.holes?.[f.actor]?.length?icmCallHTML(f,null):'';}}catch{}return out;};
 // Replay hand (Solve only): deals the finished hand again from the start with the same seats, hole cards and board.
 const next=$('deal');if(next){const again=document.createElement('button');again.type='button';again.className='btn secondary';again.id='replaySame';again.textContent='Replay hand';again.onclick=spotReplaySame;next.after(again);
  const sync=()=>{again.hidden=next.hidden||!state.hand?.done;again.disabled=next.disabled;};new MutationObserver(sync).observe(next,{attributes:true,attributeFilter:['hidden','disabled']});sync();}
 studioInterface.openSpotBuilder=openSpotBuilder;
}
// Tournament all-ins under ICM. Facing a bet that puts you or them all-in heads-up, the payouts change how much
// equity a call needs: losing your chips costs more prize money than winning theirs gains. This works from the
// table's stacks, players left (other-table stacks) and payouts, so it is exact for the call itself; the solver's
// frequencies (charts, flop library, TexasSolver on your Mac or the cloud) stay chip EV.
function icmPaid(c){return c?.mode==='icm'&&c.payouts?.filter(x=>x>0).length>1;}
function icmCallSpot(h){
 if(!h||h.done||!icmPaid(h.config))return null;const me=h.actor,l=h.legal(),live=h.living().filter(i=>i!==me);
 if(!(l.callCost>0)||live.length!==1)return null;const v=live[0];if(!(h.stacks[v]===0||l.callCost>=h.stacks[me]))return null;
 const c=h.config,S=h.stacks.map(G.bb),C=h.total.map(G.bb),dead=G.bb(h.deadPot),call=G.bb(l.callCost),others=c.otherStacks||[];
 const before=[...h.initial.map(x=>G.bb(x)+c.pot/h.n),...others],after=C.slice();after[me]+=call;const total=after.reduce((s,x)=>s+x,0)+dead,layer=k=>after.reduce((s,x)=>s+Math.min(x,k),0);
 const out=(heroGets,vilGets)=>{const s=S.slice();s[me]-=call;s[me]+=heroGets;s[v]+=vilGets;return s;};
 const fold=S.slice();fold[v]+=G.bb(h.pot);const winHero=layer(after[me])+dead,loseVil=layer(after[v])+dead,win=out(winHero,total-winHero),lose=out(total-loseVil,loseVil);
 const ev=s=>G.terminalICM([...s.map(x=>Math.max(0,Math.round(x*1e6)/1e6)),...others],before,c.payouts)[me];
 const need=(f,w,x)=>w>x?Math.min(1,Math.max(0,(f-x)/(w-x))):null,icm=need(ev(fold),ev(win),ev(lose)),chip=need(fold[me],win[me],lose[me]);
 return icm===null||chip===null?null:{me,v,icm,chip};}
// Your equity against their range (sampled, seeded so the number is steady). The range is the one the analysis
// shows: on later streets that is their range before this all-in, which is wider than the hands they shove.
const icmEquityCache=new Map();
function icmEquity(h,seat,v,range){
 const hole=h.holes[seat];if(!range||!hole?.length||/^All legal hands/.test(range))return null;const key=hole.join()+'|'+h.board.join()+'|'+range;if(icmEquityCache.has(key))return icmEquityCache.get(key);
 let rows;try{rows=PokerSpot.parseRange(range,h.rules,h.board)||[];}catch{return null;}rows=rows.filter(r=>r.weight>0&&!r.cards.some(x=>hole.includes(x)));if(!rows.length)return null;
 const wsum=rows.reduce((s,r)=>s+r.weight,0),rng=G.rng(rows.length*7919+h.board.length),need=5-h.board.length,N=need?6000:Math.min(6000,rows.length*4);let won=0,n=0;
 for(let k=0;k<N;k++){let t=rng()*wsum,r=rows[0];for(const x of rows){t-=x.weight;if(t<=0){r=x;break;}}
  const used=new Set([...hole,...r.cards,...h.board]),board=h.board.slice();while(board.length<5){const c=Math.floor(rng()*52);if(!used.has(c)){used.add(c);board.push(c);}}
  const a=G.evaluate(hole,board,h.rules).high,b=G.evaluate(r.cards,board,h.rules).high;won+=a>b?1:a===b?.5:0;n++;}
 const eq=won/n;if(icmEquityCache.size>200)icmEquityCache.clear();icmEquityCache.set(key,eq);return eq;}
// Their range from the answer shown, else from the preflop chart (at the node preflop, entering the street after).
const icmRangeMemo=new WeakMap();
function icmRange(h,v,result){const pick=r=>(r?.solve?.rangeAssumptions||r?.rangeAssumptions||[]).find(x=>x.seat===v)?.range;let range=pick(result);if(range)return range;
 const n=h.actionLog.length+'|'+preflopLibrary.packs.length,m=icmRangeMemo.get(h);if(m&&m.n===n)return m.range;
 try{if(!h.street)range=pick(preflopReference(h));else{const pr=PokerPreflop.postflopRanges(preflopLibrary.packs,h.config,observedData(h).actions);if(pr?.game==='NLH'&&pr.seats[v])range=PokerPreflop.classRangeText(pr.seats[v]);}}catch{}
 icmRangeMemo.set(h,{n,range:range||null});return range||null;}
function icmCallHTML(h,result){
 const s=icmCallSpot(h);if(!s)return'';const pct=x=>Math.round(x*100)+'%';
 const range=icmRange(h,s.v,result),eq=icmEquity(h,s.me,s.v,range);
 const verdict=eq===null?'':'<div class="icm-row"><span>'+(s.me===state.hero?'You have':G.positions(h.n,h.button)[s.me]+' has')+' <b>'+pct(eq)+'</b> vs their range'+(h.street?' before the all-in':'')+'</span><b class="icm-verdict '+(eq>=s.icm?'call':'fold')+'">'+(eq>=s.icm?'Call':'Fold')+'</b></div>';
 const exact=['exact-river','exact-postflop','exact-multiway'].includes(result?.solve?.method);
 return'<div class="icm-card"><div class="icm-row"><span><b>ICM</b> call needs <b>'+pct(s.icm)+'</b></span><span class="muted">chip EV '+pct(s.chip)+'</span></div>'+verdict+(result&&!exact?'<div class="muted small">Solver mix is chip EV.</div>':'')+'</div>';}
