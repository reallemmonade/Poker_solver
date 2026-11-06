'use strict';
// Friend games inside Play. The table server (server.cjs, /api/rooms) runs the game; this file keeps a copy of the
// current hand built with the same engine (game.js) from what the server shares: the deal settings, every action, your
// own cards, the board, the cards shown at showdown and how the pots were paid. Other players' unknown cards are random
// stand-ins that are never shown (hiddenSeats). Play then draws that copy with its usual table, action bar, sounds and
// animations. The solver, grading, guesses and saved hand history are off in friend games; player stats are kept.
const FriendPlay=(()=>{
 const API_ORIGIN='__MULTIPLAYER_API_ORIGIN__',API=(/^https?:\/\//.test(API_ORIGIN)?API_ORIGIN:/^https?:$/.test(location.protocol)?location.origin:'')+'/api/rooms';
 const KEY='guava-friend-room-v1',STATS='citrus-friend-stats-v1',NAME='guava-friend-name',STREETS=['Preflop','Flop','Turn','River'];
 const read=()=>{try{const s=JSON.parse(localStorage.getItem(KEY)||'null');return s?.room&&s.token?s:null}catch{return null}};
 let session=read(),view=null,pollTimer=0,nextTimer=0,busy=false,pumping=false,notice='',dialog=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const nameKey=n=>String(n||'').trim().toLowerCase();
 const has=()=>!!session,inGame=()=>!!session&&typeof tableSlots!=='undefined'&&tableSlots.owner==='friends';
 const persist=()=>{try{session?localStorage.setItem(KEY,JSON.stringify(session)):localStorage.removeItem(KEY)}catch{}};
 const linkFor=code=>location.origin+'/?room='+encodeURIComponent(code);
 function knownName(){try{const a=JSON.parse(localStorage.getItem('citrus-account-v1')||'null');if(a?.token&&a.user?.username)return String(a.user.username).slice(0,24)}catch{}try{return localStorage.getItem(NAME)||''}catch{return''}}
 function rememberName(n){try{if(n&&n!=='Player')localStorage.setItem(NAME,n)}catch{}}

 async function request(path,body){const r=await fetch(API+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});if(r.status===204)return null;let data={};try{data=await r.json()}catch{}if(!r.ok){const e=Error(data.error||'Could not reach the table.');e.status=r.status;throw e}return data}

 // ---- Entering and leaving ----
 function begin(data){session={room:data.room,token:data.token,seat:data.seat};persist();view=data.state||null;notice=data.pending?'Asked the host to let you back in…':'';try{history.replaceState(null,'','/?room='+encodeURIComponent(data.room))}catch{}dialog?.close();go();poll();}
 function go(){if(typeof studioInterface!=='undefined'&&studioInterface.navigate)studioInterface.navigate('play');else shown();}
 async function create(){const f=dialog,name=f.querySelector('[name=name]').value.trim()||'Player',stack=+f.querySelector('[name=stack]').value,ante=+f.querySelector('[name=ante]').value||0;
  if(!(stack>=1)||!(stack>ante+1))return dialogError('The starting stack must be at least 1 bb and more than the ante plus the big blind.');rememberName(name);
  try{begin(await request('',{name,seats:+f.querySelector('[name=seats]').value,stack,ante}))}catch(e){dialogError(e.message)}}
 async function join(){const f=dialog,code=f.querySelector('[name=code]').value.replace(/\s+/g,'').toUpperCase(),name=f.querySelector('[name=name]').value.trim()||'Player';
  if(!/^[A-Z0-9]{6,12}$/.test(code))return dialogError('Enter the 6-character room code.');rememberName(name);
  try{begin(await request('/'+encodeURIComponent(code)+'/join',{name}))}catch(e){dialogError(e.message)}}
 async function leave(){const s=session;if(!s)return;if(state.hand&&!state.hand.done&&inGame()&&!confirm('Leave this table? Your hand will be folded.'))return;stop();session=null;persist();view=null;notice='';
  try{await request('/'+s.room+'/leave',{token:s.token})}catch{}
  if(typeof tableSlots!=='undefined')delete tableSlots.parked.friends;try{history.replaceState(null,'','/')}catch{}document.body.classList.remove('friend-game');go();}
 // Bots, from the Play tabs, while you sit at a friend table.
 function leaveForBots(){if(!confirm('Leave the friend table and play bots?'))return false;leave();return false;}
 function stop(){clearTimeout(pollTimer);clearTimeout(nextTimer);pollTimer=nextTimer=0}

 // ---- Talking to the table ----
 async function poll(){clearTimeout(pollTimer);const s=session;if(!s)return;try{const r=await request('/'+s.room+'?token='+encodeURIComponent(s.token)+'&since='+(view?.version??-1));if(session!==s)return;
   if(r?.pending)notice='Asked the host to let you back in…';else if(r?.state){if(notice.startsWith('Asked'))notice='';update(r.state)}else if(notice&&!notice.startsWith('Asked')){notice='';draw()}
   pollTimer=setTimeout(poll,document.hidden?3000:800)}
  catch(e){if(session!==s)return;if(e.status===401||e.status===404){stop();session=null;persist();notice='';document.body.classList.remove('friend-game');if(typeof tableSlots!=='undefined')delete tableSlots.parked.friends;go();if(typeof status==='function')status(e.message,true);return}notice=e.message;draw();pollTimer=setTimeout(poll,2000)}}
 async function send(verb,extra={}){const s=session;if(!s||busy)return null;busy=true;draw();try{const r=await request('/'+s.room+'/'+verb,{token:s.token,version:view?.version,handVersion:view?.handVersion,...extra});if(session===s&&r?.state)update(r.state);return r}catch(e){notice=e.message;if(e.status===409)poll();return null}finally{busy=false;draw()}}
 function act(action){const a={kind:action.kind};if(action.kind==='bet'||action.kind==='raise')a.target=G.bb(action.target);send('action',{action:a});}
 function update(v){view=v;if(inGame())pump();}

 // ---- Rebuilding the hand ----
 const card=n=>C.cards(n)[0];
 function build(v,count){const e=v.engine,h=v.hand,seats=e.seats,me=seats.indexOf(session.seat),holes=Array(seats.length).fill(null),known=new Set();
  if(me>=0&&h.ownCards?.length){holes[me]=h.ownCards.map(card);known.add(me)}
  (h.revealed||[]).forEach((cs,seat)=>{const k=seats.indexOf(seat);if(cs&&k>=0&&!known.has(k)){holes[k]=cs.map(card);known.add(k)}});
  const hand=new G.Hand(e.config,{holes,runout:h.board.map(card)});
  hand.hiddenSeats=new Set(seats.map((_,k)=>k).filter(k=>!known.has(k)));hand.seatLabels=seats.map(s=>v.players[s]?.name||'Seat '+(s+1));
  hand.friendSpectator=me<0;hand.friendRoom=v.room;hand.friendHand=v.handNumber;hand.dealId=v.room+':'+v.handNumber;
  // The stand-in cards would decide a showdown at random, so the server's payout replaces the engine's.
  if(e.result){const r=e.result,settle=G.Hand.prototype.settle;hand.settle=function(fw){settle.call(this,fw);this.pots.forEach((p,j)=>{const q=r.pots[j];if(q)Object.assign(p,{winners:q.winners,highWinners:q.highWinners,lowWinners:q.lowWinners,paid:q.paid.slice(),net:q.net,rake:q.rake})});this.stacks=r.stacks.slice();this.rake=r.rake;this.returns=this.stacks.map((x,i)=>G.bb(x-this.initial[i]));const last=this.log[this.log.length-1];if(last?.type==='result')last.stacks=this.stacks.slice();}}
  for(const a of e.actions.slice(0,count))hand.act(a);return hand}
 // Brings the table up to the server's state: a new hand is dealt with the deal animation, then each new action is
 // played through applyPlayAction so it moves, sounds and animates exactly like a bot game.
 async function pump(){if(pumping)return;pumping=true;try{for(let guard=0;guard<50&&inGame();guard++){const v=view;
   if(!v?.hand||!v.engine){if(state.hand&&!state.hand.done&&!v?.hand)state.hand=null;draw();break}
   const e=v.engine,me=e.seats.indexOf(session.seat);let h=state.hand;
   if(!h||h.friendRoom!==v.room||h.friendHand!==v.handNumber){clearTimeout(nextTimer);state.hero=Math.max(0,me);state.config=G.normalize(e.config);state.hand=build(v,0);state.handSaved=false;state.currentGrades=[];await startTableDeal();h=state.hand;if(view!==v)continue}
   const done=h.actionLog.length,count=e.actions.length;
   if(done!==count||h.done!==!!v.hand.done){state.hand=build(v,Math.min(done,count));
    for(let i=state.hand.actionLog.length;i<count&&inGame()&&state.hand.friendHand===v.handNumber;i++){const live=state.hand,before=live.actionLog.length;await applyPlayAction(e.actions[i]);if(state.hand===live&&live.actionLog.length===before&&!live.done)live.act(e.actions[i]);}
    if(state.hand.done&&!state.handSaved)onHandEnd()}
   draw();if(view===v)break}}catch(err){console.error(err);if(view?.engine)try{state.hand=build(view,view.engine.actions.length)}catch{}draw()}finally{pumping=false}}
 function draw(){if(inGame()&&!tableView.playing)renderPlay();else if(inGame())renderBar()}

 // ---- Hand over: stats, and the host deals the next one ----
 function handEnded(){recordStats();scheduleNext();}
 function scheduleNext(){clearTimeout(nextTimer);const v=view;if(!v||!v.hostViewer||v.done||!v.hand?.done)return;nextTimer=setTimeout(()=>{const w=view;if(w===v||w&&w.handNumber===v.handNumber&&w.hand?.done&&!w.done&&w.hostViewer){const sitting=w.players.filter(p=>p.joined&&!p.left&&p.stack>0&&!p.away).length;if(sitting>=2&&!tableView.playing)send('next');else if(tableView.playing)scheduleNext()}},4500);}
 function friendStats(){try{const db=JSON.parse(localStorage.getItem(STATS)||'null');if(db?.players&&Array.isArray(db.seen))return db}catch{}return{players:{},seen:[]}}
 function recordStats(){const v=view,h=v?.hand;if(!h?.done||!window.PokerStats)return;const id=v.room+':'+v.handNumber,db=friendStats();if(db.seen.includes(id))return;
  const showdown=h.foldWinner===null?v.players.filter(p=>p.active&&!p.folded).map(p=>p.seat):[],won=new Set(h.winners.flatMap(w=>w.seats));
  const t=PokerStats.tally({n:v.players.length,actions:h.actions.map(a=>({seat:a.seat,street:STREETS.indexOf(a.street),kind:a.kind})),flop:h.actions.some(a=>a.street!=='Preflop')||showdown.length>1&&h.board.length>=3,showdown,won});
  for(const p of v.players)if(p.active){const k=nameKey(p.name);db.players[k]=PokerStats.add({...PokerStats.empty(),...db.players[k]},t[p.seat])}
  db.seen=[...db.seen,id].slice(-300);try{localStorage.setItem(STATS,JSON.stringify(db))}catch{}}
 function hudHTML(seat){const s=view?.engine?.seats?.[seat],p=s===undefined?null:view.players[s];if(!p||!window.PokerStats)return'';const t=friendStats().players[nameKey(p.name)]||PokerStats.empty();
  return'<div class="hud-head"><b>'+esc(p.seat===session?.seat?'You':p.name)+'</b><span>'+t.hands+' hand'+(t.hands===1?'':'s')+'</span></div>'+hudGridHTML(t)}

 // ---- Drawing ----
 // The room strip above the table: code, link, Copy and Share; it shrinks to the code and Share once cards are dealt.
 function renderBar(){let bar=$('friendBar');if(!bar){bar=document.createElement('div');bar.id='friendBar';bar.className='friend-bar';$('table').before(bar);
   bar.addEventListener('click',e=>{const b=e.target.closest('[data-fb]');if(!b)return;const k=b.dataset.fb;if(k==='copy')copy();else if(k==='share')share();else if(k==='leave')leave();else if(k==='back')send('back');else if(k==='rebuy')send('rebuy');else if(k==='show')send('show');else if(k==='approve'||k==='deny')send(k,{seat:+b.dataset.seat});});}
  const v=view;if(!inGame()||!session){bar.hidden=true;return}bar.hidden=false;const code=session.room,dealt=!!v?.handNumber,me=v?.players?.[session.seat],between=!v?.hand||v.hand.done,shareLabel=navigator.share?'Share':'Copy link';
  const actor=v?.hand&&!v.hand.done?v.players[v.hand.actor]:null,clock=actor?(actor.seat===session.seat?'Your turn':esc(actor.name))+(v.turnLeft!=null?' · '+v.turnLeft+'s':''):'';
  const extra=[...(v?.claims||[]).map(c=>'<span class="fb-claim">'+esc(c.name)+' wants their seat back <button class="btn sm" data-fb="approve" data-seat="'+c.seat+'">Let in</button><button class="btn secondary sm" data-fb="deny" data-seat="'+c.seat+'">No</button></span>'),
   v?.away?'<button class="btn sm" data-fb="back">Sit back in</button>':'',me&&me.stack===0&&between&&!me.left?'<button class="btn sm" data-fb="rebuy">Rebuy '+fmt(v.stack)+' bb</button>':'',v?.hand?.done&&v.hand.mucked?.includes(session.seat)?'<button class="btn secondary sm" data-fb="show">Show cards</button>':''].filter(Boolean).join('');
  const html='<div class="fb-row"><span class="fb-code" title="Room code">'+esc(code)+'</span>'+(dealt?'<span class="fb-clock">'+clock+'</span>':'<span class="fb-link">'+esc(linkFor(code).replace(/^https?:\/\//,''))+'</span>')+(dealt||!navigator.share?'':'<button class="btn secondary sm" data-fb="copy">Copy</button>')+'<button class="btn sm '+(dealt?'secondary':'')+'" data-fb="share">'+shareLabel+'</button><button class="btn secondary sm fb-leave" data-fb="leave" aria-label="Leave table" title="Leave table">Leave</button></div>'+(extra||notice?'<div class="fb-row fb-notes">'+extra+(notice?'<span class="fb-notice">'+esc(notice)+'</span>':'')+'</div>':'');
  if(bar._html!==html){bar.innerHTML=html;bar._html=html;document.body.style.setProperty('--friend-bar',bar.offsetHeight+6+'px')}}
 async function share(){const url=linkFor(session.room);if(navigator.share){try{await navigator.share({title:'Guava Poker',text:'Join my poker table on Guava Poker',url});return}catch(e){if(e?.name==='AbortError')return}}copy()}
 async function copy(){try{await navigator.clipboard.writeText(linkFor(session.room));notice='Invite link copied.'}catch{notice='Invite link: '+linkFor(session.room)}draw();setTimeout(()=>{if(notice.startsWith('Invite link')){notice='';draw()}},2500)}
 // Before the first hand: you sit at the bottom, friends who joined take their seats, and every open seat is an Invite button.
 function lobbyHTML(v){const n=v.maxSeats,layout=seatLayouts[n]||seatLayouts[9],joined=v.players.filter(p=>p.joined&&!p.left).length;
  const seats=v.players.map(p=>{const at=layout[(p.seat-session.seat+n)%n],pos='style="left:'+at[0]+'%;top:'+at[1]+'%"';
   if(!p.joined)return'<button type="button" class="seat-node friend-invite" data-invite '+pos+'><span>+</span>Invite</button>';
   return'<div data-seat="'+p.seat+'" class="seat-node '+(p.seat===session.seat?'hero-seat':'')+'" '+pos+'><div class="player '+(p.seat===session.seat?'you':'')+' '+(p.connected?'':'folded')+'"><b class="seat-name">'+esc(p.name)+'</b><div class="seat-stack">'+fmt(p.stack,1)+'</div></div></div>'}).join('');
  return'<div class="friend-lobby-center"><div class="muted">'+(v.done?'Game over':'Waiting for friends')+'</div><b>'+joined+' / '+n+'</b></div>'+seats}
 function render(){renderBar();const v=view,h=tableView.presented||state.hand,box=$('playActions'),policy=$('currentPolicy');$('customBet')?.classList.add('hide');$('analyze').hidden=true;
  const off='<div class="notice">The solver is off in games with friends.</div>';
  if(!v||!h||!v.hand&&!h.friendHand){const root=$('table');if(v){const html=lobbyHTML(v);if(root._tableMarkup!==html){root.innerHTML=html;root._tableMarkup=html;root.querySelectorAll('[data-invite]').forEach(b=>b.onclick=share)}}
   $('tableTitle').textContent='Friends · '+(v?v.maxSeats+' seats':'');ActionBar.clear(box);
   const sitting=v?v.players.filter(p=>p.joined&&!p.left&&p.stack>0).length:0;
   box.innerHTML=!v?'':v.hostViewer&&!v.done?'<button class="btn friend-deal" id="friendDeal" '+(sitting<2||busy?'disabled':'')+'>'+(sitting<2?'Deal once a friend sits down':'Deal')+'</button>':'<div class="small muted friend-wait">'+(v.done?'Game over':'Waiting for the host to deal…')+'</div>';
   if($('friendDeal'))$('friendDeal').onclick=()=>send('start');policy.innerHTML=off;return}
  if(box.querySelector('#friendDeal,.friend-wait'))box.innerHTML='';
  paintTable($('table'),h,state.hero,{caption:tableView.message});$('tableTitle').textContent='Friends · '+h.n+' handed · '+G.STREET[h.street];
  const names=seatNames(h,state.hero);$('handLog').innerHTML=historyLog(h.log).reverse().map(x=>'<div>'+esc(eventLabel(x,names))+'</div>').join('');
  if(h.done||state.hand.done){ActionBar.clear(box);const r=v?.hand?.done?v.hand:null;policy.innerHTML=(r?'<div class="result">'+r.winners.map((w,j)=>(r.winners.length>1?(j?'Side pot '+j:'Main pot')+' · ':'')+w.seats.map(s=>esc(v.players[s]?.name)).join(', ')+' won '+fmt(w.amount)+' bb'+(w.hands?.[0]?' with '+esc(w.hands[0]):'')).join('<br>')+'</div>':'')+off;return}
  const canPlay=!busy&&!tableView.playing&&!h.friendSpectator&&h.actor===state.hero;
  if(!canPlay){ActionBar.clear(box);if(!h.friendSpectator&&preActionSeat(h)&&!tableView.playing)ActionBar.waiting(box,{key:preActionKey(h),toCall:G.bb(Math.max(0,Math.min(h.currentBet-h.streetPaid[state.hero],h.stacks[state.hero])))});policy.innerHTML=off;return}
  const l=h.legal();if(renderActionBar(h,{actions:G.modelActions(h)},l,true))return;policy.innerHTML=off;}

 // ---- Opening ----
 function dialogError(m){const e=dialog?.querySelector('.friend-error');if(e){e.textContent=m;e.hidden=!m}}
 function open(code=''){if(session){go();return}const ui=studioInterface;if(!dialog){dialog=ui.dialog('uiFriendDialog','Play with friends');const name=esc(knownName());
   dialog.querySelector('.ui-dialog-content').innerHTML='<div class="fields"><div class="field wide"><label for="friendName">Your name</label><input class="input" id="friendName" name="name" maxlength="24" autocomplete="nickname" value="'+name+'"></div></div>'+
    '<h3>Join a table</h3><div class="fields"><div class="field"><label for="friendCode">Room code</label><input class="input" id="friendCode" name="code" maxlength="12" placeholder="e.g. K7M2QX" autocapitalize="characters" autocomplete="off" spellcheck="false"></div></div><button class="btn" id="friendJoin">Join table</button>'+
    '<h3>New table</h3><div class="fields"><div class="field"><label for="friendSeats">Seats</label><select class="input" id="friendSeats" name="seats">'+[2,3,4,5,6,7,8,9].map(n=>'<option'+(n===6?' selected':'')+'>'+n+'</option>').join('')+'</select></div><div class="field"><label for="friendStack">Starting stack · bb</label><input class="input" id="friendStack" name="stack" type="number" min="1.01" step=".01" value="100"></div><div class="field"><label for="friendAnte">Ante · bb</label><input class="input" id="friendAnte" name="ante" type="number" min="0" step=".05" value="0"></div></div><button class="btn" id="friendCreate">Create a table</button>'+
    '<p class="friend-error result bad" role="alert" hidden></p><p class="help">Your cards stay private until showdown. The solver and saved hand history are off at friend tables.</p>';
   dialog.querySelector('#friendJoin').onclick=join;dialog.querySelector('#friendCreate').onclick=create;dialog.querySelector('#friendCode').onkeydown=e=>{if(e.key==='Enter')join()};}
  dialogError('');const c=dialog.querySelector('#friendCode');if(code)c.value=code;if(!dialog.querySelector('#friendName').value)dialog.querySelector('#friendName').value=knownName();ui.showDialog(dialog);if(code&&dialog.querySelector('#friendName').value)dialog.querySelector('#friendJoin').focus();}
 // Play just switched to the friend table (on entering, or coming back from another tab).
 function shown(){renderBar();if(view)pump();else draw();if(!pollTimer)poll();}
 // On load: a ?room= link joins that table, or an unfinished friend game picks up where it was.
 function init(){const code=(new URLSearchParams(location.search).get('room')||'').replace(/\s+/g,'').toUpperCase(),start=()=>{if(code&&/^[A-Z0-9]{6,12}$/.test(code)&&session?.room!==code){if(session){stop();session=null;persist()}open(code);return}if(session){go();poll()}};
  let tries=0;const wait=()=>{if(typeof studioInterface!=='undefined'&&studioInterface.ready||++tries>60)start();else setTimeout(wait,200)};wait();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session)poll()});}
 return{has,inGame,open,act,render,renderBar,handEnded,hudHTML,shown,leaveForBots,init,leave};
})();
