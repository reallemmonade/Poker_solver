'use strict';
const liveSession={rootConfig:null,rootHero:0,rootBots:null,round:1,handNumber:0,timer:null,ready:false,message:'',passive:false};
// Tabs share one saved session: the tab that saved last owns it, and any other open tab turns read-only (playBusy) until the
// player takes the session over there, which reloads the latest saved state first, so two tabs never fork one session.
const studioTab=Math.random().toString(36).slice(2),studioChannel=(()=>{try{return typeof BroadcastChannel==='function'?new BroadcastChannel('range-lab-poker-studio'):null}catch{return null}})();
function postStudio(message){try{studioChannel?.postMessage({...message,tab:studioTab})}catch{}}
function sessionElsewhere(){if(liveSession.passive)return;liveSession.passive=true;cancelSessionNext();clearTimeout(tableView.botTimer);tableView.botTimer=null;renderAll();}
async function takeOverSession(){if(!liveSession.passive)return;try{const value=(await dbAll('meta')).find(row=>row?.id==='liveSession')?.value;liveSession.passive=false;if(value)restoreLiveSession(value);else{saveLiveSession();renderAll();}status('This tab now has the live session; any other open tab is read-only.');}catch(error){liveSession.passive=false;status('Could not read the latest session: '+error.message,true);renderAll();}}
async function refreshSharedHands(){try{const [hands,grades]=await Promise.all([dbAll('hands'),dbAll('grades')]);state.histories=newestRows(hands,validHandRow).rows;state.grades=newestRows(grades.map(r=>{try{return scrubSavedGrade(r)}catch{return null}}),validGradeRow).rows;renderSavedHands();renderProgress();}catch{}}
if(studioChannel)studioChannel.onmessage=event=>{const m=event.data||{};if(m.tab===studioTab)return;if(m.type==='session'&&liveSession.ready)sessionElsewhere();if(m.type==='hands')refreshSharedHands();};
function cancelSessionNext(){clearTimeout(liveSession.timer);liveSession.timer=null;}
function beginLiveSession(config=state.config,hero=state.hero){cancelSessionNext();liveSession.rootConfig=G.normalize(config);liveSession.rootHero=hero;liveSession.rootBots=botSettings.seats.slice();liveSession.handNumber=0;state.sessionHands=0;liveSession.message='';liveSession.level='';}
// Blind levels shrink every stack by the same factor in whole chips (0.01 bb), keeping the scaled total exact by largest remainder; no stack drops to zero.
function scaleChips(stacks,factor){const chips=stacks.map(x=>Math.round(x*100)),raw=chips.map(v=>v/factor),out=raw.map(Math.floor);let left=Math.round(chips.reduce((s,v)=>s+v,0)/factor)-out.reduce((s,v)=>s+v,0);for(const i of raw.map((_,i)=>i).sort((a,b)=>(raw[b]-out[b])-(raw[a]-out[a])))if(left-->0)out[i]++;for(let i=0;i<out.length;i++)if(!out[i]){const j=out.indexOf(Math.max(...out));if(out[j]>1)out[j]--;out[i]++;}return out.map(v=>v/100);}
// Tournament finish for the hero after a completed hand: bust (place and prize), every remaining prize equal (a satellite's
// seats are decided), or the last player at this table while other tables play on. Null while the session continues.
function tournamentFinish(h){
 const c=h.config;if(c.mode!=='icm')return null;const alive=h.stacks.filter(x=>x>0).length,left=alive+c.otherStacks.length,pay=c.payouts,busted=h.stacks[state.hero]===0,decided=!busted&&left>1&&left<=pay.length&&pay.slice(0,left).every(x=>x===pay[0]),alone=!busted&&alive<2&&c.otherStacks.length>0;if(!busted&&!decided&&!alone)return null;
 const before=[...h.initial.map(x=>G.bb(x)+c.pot/h.n),...c.otherStacks],prize=G.terminalICM([...h.stacks.map(G.bb),...c.otherStacks],before,pay)[state.hero],place=busted?left+1+h.stacks.filter((x,p)=>x===0&&p!==state.hero&&h.initial[p]>h.initial[state.hero]).length:null,nth=n=>n+(n%100>10&&n%100<14?'th':['th','st','nd','rd'][n%10]||'th');
 return{over:true,message:busted?'You finished '+nth(place)+(prize>0?' · prize '+fmt(prize,2):' · no prize')+'. The next hand restarts the original setup.':decided?'Seats decided: '+(left===2?'both':'all '+left)+' remaining players win '+fmt(pay[0],2)+', including you. The next hand restarts the original setup.':'Every opponent at this table is out; '+c.otherStacks.length+' player'+(c.otherStacks.length>1?'s':'')+' remain at other tables. Your tournament equity: '+fmt(prize,2)+'. The next hand restarts the original setup.'};
}
function nextPersistentSessionConfig(){
 const h=state.hand;if(!h?.done)return state.config;
 // Cash tables keep their size: a bot that busts or drops below half its starting stack rebuys to that stack.
 const root=liveSession.rootConfig,rebuy=h.config.mode==='cash'&&$('botRebuy')?.checked!==false&&root?.stacks?.length===h.n&&h.stacks[state.hero]>0,stacks=h.stacks.map((amount,seat)=>rebuy&&seat!==state.hero&&root.stacks[seat]>0&&G.bb(amount)<root.stacks[seat]/2?G.units(root.stacks[seat]):amount),reloaded=stacks.filter((amount,seat)=>amount!==h.stacks[seat]).length;
 const alive=stacks.map((amount,seat)=>amount>0?seat:-1).filter(seat=>seat>=0),finish=tournamentFinish(h);
 if(!alive.includes(state.hero)||alive.length<2||finish){
  const busted=!alive.includes(state.hero);state.hero=liveSession.rootHero;botSettings.seats=liveSession.rootBots.slice();botSettings.renderKey='';saveBotSettings();liveSession.round++;liveSession.handNumber=0;liveSession.level='';state.sessionHands=0;liveSession.message=finish?'Tournament finished · restarting with the original setup.':busted?'You busted · restarting with the original setup.':'You won the table · starting a new session.';return G.normalize(liveSession.rootConfig);
 }
 let nextButton=(h.button+1)%h.n;while(!alive.includes(nextButton))nextButton=(nextButton+1)%h.n;
 const config={...h.config,startStreet:0,board:'',boardCards:[],pot:0,seats:alive.length,stacks:alive.map(i=>G.bb(stacks[i])),button:alive.indexOf(nextButton),bounties:alive.map(i=>h.bounties[i]),payouts:h.config.payouts.slice(0,alive.length+h.config.otherStacks.length)};
 state.hero=alive.indexOf(state.hero);remapBotSeats(alive);
 let level='';if(config.mode==='icm'&&$('sessionBlindLevels').checked&&state.sessionHands%Math.max(1,+$('levelHands').value)===0){const factor=Math.max(1,+$('levelFactor').value||1);if(factor>1)level='Blinds up ×'+fmt(factor,2)+' · level '+(1+state.sessionHands/Math.max(1,+$('levelHands').value));const scaled=scaleChips([...config.stacks,...config.otherStacks],factor);config.stacks=scaled.slice(0,config.stacks.length);config.otherStacks=scaled.slice(config.stacks.length);}
 liveSession.level=level;liveSession.message=[level,h.n-alive.length?h.n-alive.length+' opponent(s) eliminated':'',reloaded?reloaded+' bot'+(reloaded>1?'s':'')+' rebought to the starting stack':''].filter(Boolean).join(' · ');return G.normalize(config);
}
function beforeLiveDeal(carry){cancelSessionNext();if(!carry||!liveSession.rootConfig)beginLiveSession();liveSession.handNumber++;}
function captureSessionTransition(){return{config:state.config,hero:state.hero,hand:state.hand,handSaved:state.handSaved,currentGrades:state.currentGrades,completedHands:state.sessionHands,bots:botSettings.seats.slice(),session:{rootConfig:liveSession.rootConfig,rootHero:liveSession.rootHero,rootBots:liveSession.rootBots?.slice(),round:liveSession.round,handNumber:liveSession.handNumber,message:liveSession.message}};}
function rollbackSessionTransition(saved){state.config=saved.config;state.hero=saved.hero;state.hand=saved.hand;state.handSaved=saved.handSaved;state.currentGrades=saved.currentGrades;state.sessionHands=saved.completedHands;Object.assign(liveSession,saved.session);botSettings.seats=saved.bots;botSettings.renderKey='';saveBotSettings();renderAll();}
function renderSessionStatus(){
 if(liveSession.passive&&!$('sessionElsewhere')){const line=$('sessionStatus').closest('.ui-session-line')||$('sessionStatus');line.insertAdjacentHTML('afterend','<div id="sessionElsewhere" class="result" role="status">This session is being played in another tab, so this tab is read-only to keep the two from overwriting each other. <button class="btn secondary" id="takeOverSession">Continue here</button></div>');$('takeOverSession').onclick=takeOverSession;}
 $('sessionElsewhere')?.classList.toggle('hide',!liveSession.passive);const h=state.hand;if(!h){$('deal').textContent='Deal hand';$('deal').disabled=playBusy()||tableView.playing;return;}
 $('sessionStatus').textContent=h.done&&tableView.playing?'':liveSession.message;// only news (busts, rebuys, eliminations); the result waits for the end-of-hand animation
 $('deal').textContent=h.done?'Next hand':'Hand in progress';$('deal').hidden=!h.done;$('deal').disabled=playBusy()||tableView.playing||!h.done;
 $('restartSession').disabled=state.busy||liveSession.passive;renderCapacityActions();
}
function scheduleSessionNext(){
 cancelSessionNext();const hand=state.hand;
 if(!hand?.done||!$('autoNextHand').checked||!$('play').classList.contains('active')||playBusy()||tableView.playing||state.dirty||$('controlAll').checked)return;
 liveSession.timer=setTimeout(()=>{liveSession.timer=null;if(state.hand!==hand||!$('play').classList.contains('active')||!$('autoNextHand').checked||playBusy()||state.dirty)return;deal(true);},4500);
}
function sessionHandEnded(){
 liveSession.message=tournamentFinish(state.hand)?.message||(state.hand.stacks[state.hero]===0?'You busted. The next hand restarts the original setup.':state.hand.stacks.filter(x=>x>0).length<2?'You won the table. The next hand starts a fresh session.':liveSession.level||'');
 saveLiveSession();renderSessionStatus();scheduleSessionNext();
}
function saveLiveSession(){
 if(!liveSession.ready||liveSession.passive||!state.hand||!liveSession.rootConfig)return;
 const h=state.hand;
 const value={version:1,rootConfig:liveSession.rootConfig,rootHero:liveSession.rootHero,rootBots:liveSession.rootBots,round:liveSession.round,handNumber:liveSession.handNumber,completedHands:state.sessionHands,hero:state.hero,bots:botSettings.seats.slice(),autoNext:$('autoNextHand').checked,blindLevels:$('sessionBlindLevels').checked,levelHands:+$('levelHands').value,levelFactor:+$('levelFactor').value,hand:{config:h.config,holes:h.holes.map(cards=>cards.slice()),board:h.board.slice(),actions:h.actionLog.map(a=>({...a})),deck:h.deck.slice(),plannedBoard:h.plannedBoard.slice(),burns:h.burns.slice(),endingStacks:h.stacks.slice(),grades:state.currentGrades,done:h.done,saved:state.handSaved}};
 dbPut('meta',{id:'liveSession',value}).catch(saveFailed);postStudio({type:'session'});
}
function restoreLiveSession(value){
 try{
  if(value?.version===1){
   const c=G.normalize(value.hand.config),root=G.normalize(value.rootConfig);if(!Number.isInteger(value.hero)||value.hero<0||value.hero>=c.seats||!Number.isInteger(value.rootHero)||value.rootHero<0||value.rootHero>=root.seats)throw Error('Invalid saved seat.');
   if(!Array.isArray(value.hand.actions)||value.hand.actions.length>300)throw Error('Invalid saved actions.');
   const hand=new G.Hand(c,{holes:value.hand.holes,runout:value.hand.board.slice(c.boardCards.length),rng:G.rng(7311)});for(const action of value.hand.actions)hand.act(action);
   if(hand.stacks.some((chips,seat)=>chips!==value.hand.endingStacks[seat]))throw Error('Saved session stacks differ from its action history.');
   const deck=value.hand.deck,planned=value.hand.plannedBoard,burns=value.hand.burns,all=[...hand.holes.flat(),...hand.board,...deck,...planned,...burns];if(all.length!==52||all.some(card=>!Number.isInteger(card)||card<0||card>51)||new Set(all).size!==52)throw Error('Saved card order is invalid.');
   cancelSessionNext();stopTableMotion();hand.deck=deck.slice();hand.plannedBoard=planned.slice();hand.burns=burns.slice();
   state.hand=hand;state.config=c;state.hero=value.hero;state.handSaved=hand.done&&value.hand.saved!==false;state.currentGrades=(value.hand.grades||[]).map(scrubSavedGrade);state.sessionHands=value.completedHands||0;
   liveSession.rootConfig=root;liveSession.rootHero=value.rootHero;liveSession.rootBots=value.rootBots.slice();liveSession.round=value.round||1;liveSession.handNumber=value.handNumber||1;liveSession.message='Saved session restored · stacks and dealer position preserved.';
   if(Array.isArray(value.bots))botSettings.seats=value.bots.map(p=>PokerBots.personas[p]?p:'balanced');botSettings.renderKey='';$('autoNextHand').checked=value.autoNext!==false;$('sessionBlindLevels').checked=!!value.blindLevels;$('levelHands').value=value.levelHands||10;$('levelFactor').value=value.levelFactor||1.5;
   writeForm(c,state.abstraction);$('hero').value=state.hero;renderAll();if(hand.done&&!state.handSaved){liveSession.ready=true;onHandEnd();}scheduleSessionNext();if(!hand.done)advanceBots();
  }
 }catch(error){status('The saved session could not be restored: '+error.message+' A copy was kept on this device.',true);dbPut('meta',{id:'liveSession-broken',value}).catch(()=>{});}
 finally{liveSession.ready=true;saveLiveSession();renderSessionStatus();}
}
function restartLiveSession(){
 if(state.busy||liveSession.passive)return;cancelSessionNext();stopTableMotion();if(!liveSession.rootConfig)beginLiveSession();
 state.config=G.normalize(liveSession.rootConfig);state.hero=liveSession.rootHero;botSettings.seats=liveSession.rootBots.slice();botSettings.renderKey='';state.dirty=false;liveSession.round++;writeForm(state.config,state.abstraction);$('hero').value=state.hero;deal(false);
}
function renderCapacityActions(){
 if(!$('capacityReached')||!state.model)return;const max=state.model.abstraction.maxInfos,size=state.model.table.entries.size,reached=/capacity/i.test(state.snapshot?.halted||'')||size>=max-1;
 $('capacityReached').classList.toggle('hide',!reached);$('capacityLimitNote').textContent=max<2000000?'Your learning is preserved. Increase the memory budget to remember more situations.':'This model has reached the 2,000,000-state browser budget. The checkpoint is preserved; a larger run needs a larger training memory budget.';
 $('resumeCapacity').textContent=max<1000000?'Increase to 1,000,000 & resume':'Increase to 2,000,000 & resume';$('resumeCapacity').disabled=state.busy||liveSession.passive||max>=2000000||state.dirty;
}
function resumeWithMoreCapacity(){
 if(state.busy||liveSession.passive||state.dirty||!state.model)return;const capacity=state.model.abstraction.maxInfos<1000000?1000000:2000000;if(state.model.abstraction.maxInfos>=2000000)return;
 const snapshot={...state.snapshot,halted:null,abstraction:{...state.model.abstraction,maxInfos:capacity}};setModel(snapshot);state.abstraction=state.model.abstraction;selectValue('capacity',capacity);train();
}
function initSessions(){
 $('autoNextHand').onchange=()=>{saveLiveSession();scheduleSessionNext();};$('sessionBlindLevels').onchange=saveLiveSession;$('levelHands').onchange=saveLiveSession;$('levelFactor').onchange=saveLiveSession;$('restartSession').onclick=restartLiveSession;$('resumeCapacity').onclick=resumeWithMoreCapacity;
}
