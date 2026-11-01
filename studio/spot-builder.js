// New spot: pick players, stack, your seat, your hand and any board cards, then the hand starts in Train › Decision
// with every seat under your control. Play the line, and the analysis pane solves it through the usual routes
// (preflop charts, flop library, Mac bridge with its progress bar).
const spotBuilder={n:6,stack:100,seat:null,slots:[],active:0,runout:null,dialog:null};
function spotSeatsInOrder(n,button){return n===2?[button,(button+1)%n]:Array.from({length:n},(_,k)=>(button+3+k)%n);}
function spotHoleCount(){return state.config?.rules?.hole||2;}
function spotCardLabel(c){const s=C.cardName(c);return'<span class="sb-pip suit-'+s[1]+'">'+s[0]+'<i>'+{c:'♣',d:'♦',h:'♥',s:'♠'}[s[1]]+'</i></span>';}
function spotSeatOptions(){return[...$('seats').options].filter(o=>!o.disabled).map(o=>+o.value);}
function openSpotBuilder(){
 if(state.busy){status('A calculation is running. Cancel it first.',true);return;}
 const c=state.config||{},hole=spotHoleCount(),seats=spotSeatOptions();
 spotBuilder.n=seats.includes(c.seats)?c.seats:seats.includes(6)?6:seats[0];spotBuilder.stack=c.stacks?.[state.hero??0]||100;spotBuilder.seat=null;
 if(spotBuilder.slots.length!==hole+5)spotBuilder.slots=Array(hole+5).fill(null);spotBuilder.active=spotBuilder.slots.findIndex(x=>x===null);if(spotBuilder.active<0)spotBuilder.active=0;
 renderSpotBuilder();const d=spotBuilder.dialog;if(!d.open){document.body.classList.add('ui-dialog-open');d.showModal();}
}
function renderSpotBuilder(){
 const b=spotBuilder,d=b.dialog,hole=spotHoleCount(),button=0,order=spotSeatsInOrder(b.n,button),names=G.positions(b.n,button);
 if(b.seat===null||b.seat>=b.n)b.seat=button;
 const chip=(attr,label,on)=>'<button type="button" class="sb-chip'+(on?' on':'')+'" '+attr+' aria-pressed="'+on+'">'+label+'</button>';
 const slot=i=>{const c=b.slots[i];return'<button type="button" class="sb-slot'+(i===b.active?' active':'')+(c===null?'':' filled')+(i===hole+3?' sb-gap':'')+'" data-sb-slot="'+i+'" aria-label="'+(i<hole?'Hand card '+(i+1):['Flop','Flop','Flop','Turn','River'][i-hole])+'">'+(c===null?'':spotCardLabel(c))+'</button>';};
 const used=new Map(b.slots.map((c,i)=>[c,i]).filter(([c])=>c!==null));let grid='';
 for(const suit of[3,2,1,0])for(let r=12;r>=0;r--){const card=r*4+suit,taken=used.has(card);grid+='<button type="button" class="sb-card'+(taken?' taken':'')+'" data-sb-card="'+card+'" aria-label="'+cardSpeech(card)+'">'+spotCardLabel(card)+'</button>';}
 d.querySelector('.ui-dialog-content').innerHTML=
  '<div class="sb-row"><span class="sb-label">Players</span><div class="sb-chips">'+spotSeatOptions().map(n=>chip('data-sb-n="'+n+'"',n,n===b.n)).join('')+'</div></div>'+
  '<div class="sb-row"><label class="sb-label" for="sbStack">Stack</label><div class="sb-chips"><input class="input sb-stack" id="sbStack" type="number" inputmode="decimal" min="1" step="1" value="'+b.stack+'"><span class="muted small">bb</span></div></div>'+
  '<div class="sb-row"><span class="sb-label">You</span><div class="sb-chips">'+order.map(i=>chip('data-sb-seat="'+i+'"',names[i],i===b.seat)).join('')+'</div></div>'+
  '<div class="sb-row"><span class="sb-label">Cards</span><div class="sb-slots">'+Array.from({length:hole},(_,i)=>slot(i)).join('')+'<span class="sb-divider"></span>'+[0,1,2,3,4].map(k=>slot(hole+k)).join('')+'</div></div>'+
  '<div class="sb-grid" role="group" aria-label="Pick a card">'+grid+'</div>'+
  '<p class="ui-dialog-error sb-error" role="alert" hidden></p>'+
  '<div class="sb-foot"><button type="button" class="btn secondary" data-sb-clear>Clear cards</button><button type="button" class="btn" data-sb-deal>Deal spot</button></div>';
}
function spotBuilderClick(event){
 const b=spotBuilder,t=event.target.closest('button');if(!t)return;const hole=spotHoleCount();
 if(t.dataset.sbN){b.n=+t.dataset.sbN;b.seat=null;}
 else if(t.dataset.sbSeat)b.seat=+t.dataset.sbSeat;
 else if(t.dataset.sbSlot){const i=+t.dataset.sbSlot;if(i===b.active&&b.slots[i]!==null)b.slots[i]=null;b.active=i;}
 else if(t.dataset.sbCard){const card=+t.dataset.sbCard,at=b.slots.indexOf(card);if(at>=0){b.slots[at]=null;b.active=at;}else{b.slots[b.active]=card;const next=b.slots.findIndex((x,i)=>x===null&&i>b.active);b.active=next>=0?next:b.slots.findIndex(x=>x===null);if(b.active<0)b.active=hole+4;}}
 else if('sbClear' in t.dataset){b.slots.fill(null);b.active=0;}
 else if('sbDeal' in t.dataset){dealBuiltSpot();return;}
 else return;
 b.stack=+$('sbStack').value||b.stack;renderSpotBuilder();
}
function dealBuiltSpot(){
 const b=spotBuilder,d=b.dialog,hole=spotHoleCount(),error=d.querySelector('.sb-error'),fail=m=>{error.textContent=m;error.hidden=false;};
 const stack=+$('sbStack').value,hand=b.slots.slice(0,hole),board=b.slots.slice(hole).filter(c=>c!==null);
 if(!(stack>=1&&stack<=1e6))return fail('Stack needs to be at least 1 bb.');
 if(hand.some(c=>c===null)&&hand.some(c=>c!==null))return fail('Pick all '+hole+' of your cards, or none for a random hand.');
 if(state.busy)return fail('A calculation is running. Cancel it first.');
 b.stack=stack;
 try{
  const n=b.n,config=G.normalize({...state.config,seats:n,button:0,stacks:Array(n).fill(stack),bounties:Array(n).fill(0),startStreet:0,board:'',pot:0});
  stopTableMotion();writeForm(config,state.abstraction);$('hero').value=String(b.seat);
  $('heroCards').value=hand[0]===null?'':hand.map(c=>C.cardName(c)).join(' ');markDirty();
  spotBuilder.runout=board.length?board:null;
  d.close();studioInterface.navigate?.('study');
  if(!deal(false)){spotBuilder.runout=null;return;}
 }catch(e){spotBuilder.runout=null;fail(e.message);}
}
function initSpotBuilder(){
 const d=document.createElement('dialog');d.className='ui-dialog sb-dialog';d.id='uiSpotDialog';d.setAttribute('aria-label','New spot');
 d.innerHTML='<div class="ui-dialog-head"><h2>New spot</h2><button type="button" class="btn secondary" data-close-dialog>Close</button></div><div class="ui-dialog-content"></div>';
 (document.querySelector('.shell')||document.body).append(d);spotBuilder.dialog=d;
 d.querySelector('[data-close-dialog]').onclick=()=>d.close();
 d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();return;}spotBuilderClick(event);});
 d.addEventListener('change',event=>{if(event.target.id==='sbStack')spotBuilder.stack=+event.target.value||spotBuilder.stack;});
 d.addEventListener('close',()=>{if(![...document.querySelectorAll('dialog')].some(n=>n.open))document.body.classList.remove('ui-dialog-open');});
 // The planned board rides on the next deal only.
 const baseOptions=newHandOptions;newHandOptions=function(){const o=baseOptions();if(spotBuilder.runout){o.runout=spotBuilder.runout;spotBuilder.runout=null;}return o;};
 const edit=$('uiEditGame');if(edit){const btn=document.createElement('button');btn.type='button';btn.className='btn secondary sb-open';btn.id='uiNewSpot';btn.textContent='New spot';btn.setAttribute('aria-haspopup','dialog');btn.onclick=openSpotBuilder;edit.before(btn);const wrap=document.createElement('div');wrap.className='sb-context-actions';btn.before(wrap);wrap.append(btn,edit);}
 studioInterface.openSpotBuilder=openSpotBuilder;
}
