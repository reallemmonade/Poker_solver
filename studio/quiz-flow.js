'use strict';
function renderQuizFlowControls(){
 const question=state.quiz,complete=!!question?.completedHand;
 $('quizContinuation').classList.toggle('hide',!question);
 $('quizContinue').classList.toggle('hide',!question?.continuationError);
 $('quizFinish').classList.toggle('hide',!question||complete);
 $('quizReview').classList.toggle('hide',!complete||!question.record);
 $('quizExport').classList.toggle('hide',!complete||!question.record);
 $('quizNextHand').classList.toggle('hide',!complete);
 $('quizRetryGrades').classList.toggle('hide',!complete||question.grading||!question.decisions?.some(d=>!d.result||d.result.error));
 $('quizContinuationNote').textContent=complete?(question.grading?'The hand is over. Your choices are being assessed together.':'Review your choices below, replay the hand, or export the history and assessment.'):'Choose each action to keep playing. Feedback appears when the hand ends. Simulating the rest excludes those computer choices from your grade.';
 syncQuizFilters();
}
function showQuizQuestion(){
 const question=state.quiz;if(!question)return;if(question.hand.config.startStreet!==0){clearQuizQuestion();$('quizStatus').textContent='Quiz requires a hand recorded from the initial deal. Choose a full-hand study game.';return}
 const h=question.hand,q=question.prepared?{actions:question.prepared.actions}:question.model.query(h),labels=G.positions(h.n,h.button);question.chosenActions??=new Set();question.autoHeroActions??=new Set();question.grades??=[];question.decisions??=[];question.startActionIndex??=h.actionLog.length;question.startStreet??=h.street;question.decisionNumber=question.decisions.length+1;
 renderQuizHistory(question);renderQuizFlowControls();$('quizEmpty').classList.add('hide');$('quizTable').classList.remove('hide');paintTable($('quizTable'),h,question.hero);if(question.decisionNumber===1)dealIntoSeats($('quizTable'),h,question.hero).catch(()=>{});
 $('quizSpot').innerHTML=[h.config.variant,h.config.mode==='icm'?'Tournament · ICM':'Cash',h.n+' handed',fmt(quizEffective(h.config,question.hero))+' bb starting effective',labels[question.hero],G.STREET[h.street],quizDecisionLabel(h)].map(s=>'<span>'+esc(s)+'</span>').join('');$('quizStatus').textContent='Decision '+question.decisionNumber+' · complete history from the deal · '+question.sourceName;
 // A source chart grades only its own actions, so only those are offered, in fold, check/call, raise-size order.
 const chart=question.prepared?.referenceOnly,rank=a=>a.kind==='fold'?0:['check','call'].includes(a.kind)?1:2+(a.target||0)/1e9,offered=q.actions.map((a,i)=>i).filter(i=>!chart||question.prepared.reference[i]!==null);if(chart)offered.sort((x,y)=>rank(q.actions[x])-rank(q.actions[y]));
 $('quizActions').innerHTML=offered.map(i=>`<button class="btn secondary" data-quiz="${i}" ${question.answered?'disabled':''}>${esc(q.actions[i].label)}</button>`).join('');document.querySelectorAll('[data-quiz]').forEach(b=>b.onclick=()=>{if(state.busy||quizTraining.building||state.quiz!==question||question.answered)return;question.answered=true;question.selectedAction={...q.actions[+b.dataset.quiz]};document.querySelectorAll('[data-quiz]').forEach(x=>x.disabled=true);continueQuizHand(false);});
 $('quizFeedback').textContent=(question.decisions.length?question.decisions.length+' choice'+(question.decisions.length===1?'':'s')+' recorded. ':'')+'Keep playing. Your whole-hand assessment and reference frequencies appear at the end.';$('quizReference').innerHTML='';
}
function finishQuizDecision(result,pending,grade){
 const question=pending.quizQuestion;if(!question||state.quiz!==question)return;
 const decision=question.decisions[pending.quizDecisionIndex];if(!decision)return;
 decision.result=result;decision.grade=grade;question.grades=question.decisions.map(d=>d.grade).filter(Boolean);
 gradeNextQuizDecision(question);
}
async function quizContinuationAction(hand,model,preferred=null){const solved=await requestSolvedPolicy(hand);if(solved)return solved.actions[G.pick(solved.probs)];const source=preflopReference(hand,null,preferred);if(source)return source.actions[G.pick(source.reference.map(x=>x||0))];const q=model.query(hand),policy=PokerBots.policy(PokerBots.observe(hand),q,'reference');return policy.actions[G.pick(policy.probs)];}
function paintQuizContinuation(question,hand,message){question.hand=hand;question.viewHand=hand;renderQuizHistory(question);paintTable($('quizTable'),hand,question.hero);$('quizStatus').textContent=message;}
async function continueQuizHand(finish=false){
 const question=state.quiz;if(!question||(!question.selectedAction&&!finish&&!question.continuationError)||question.completedHand||state.busy||quizTraining.building)return;
 const token=++quizTraining.generation,hand=question.hand.clone(),chosen=new Set(question.chosenActions),automatic=new Set(question.autoHeroActions);quizTraining.continuing=true;setQuizBusy(true);$('quizActions').innerHTML='';const active=()=>token===quizTraining.generation&&state.quiz===question;
 try{
  question.continuationError=false;
  // Keep a snapshot of exactly what was known when the user chose. End-of-hand grading
  // sends observedData(snapshot), never the showdown cards or the completed board.
  if(question.selectedAction){const decision={hand:hand.clone(),action:{...question.selectedAction},actionIndex:hand.actionLog.length,result:question.prepared?.supported?question.prepared:null};hand.act(decision.action);question.decisions.push(decision);chosen.add(decision.actionIndex);question.selectedAction=null;}
  question.chosenActions=chosen;question.autoHeroActions=automatic;
  paintQuizContinuation(question,hand,'Continuing this hand…');saveQuizDraft(question);let steps=0;
  while(!hand.done&&(finish||hand.actor!==question.hero||hand.folded[question.hero])){
   if(!active())return;const oldBoard=hand.board.length;if(hand.actor===question.hero)automatic.add(hand.actionLog.length);hand.act(await quizContinuationAction(hand,question.model,question.referencePack));question.viewAutoHeroActions=automatic;paintQuizContinuation(question,hand,finish?'Simulating the remaining hand…':'Opponents are acting…');if(hand.board.length>oldBoard)await revealBoard($('quizTable'),oldBoard);if(!active())return;await motionPause(120);if(++steps>300)throw Error('The continuation exceeded its action limit.');
  }
  if(!active())return;question.viewHand=null;question.viewAutoHeroActions=null;question.chosenActions=chosen;question.autoHeroActions=automatic;
  question.hand=hand;question.selectedAction=null;question.answered=false;
  if(hand.done){question.completedHand=hand;completeQuizHand(question);}else{question.needsPreparation=true;}
 }catch(error){if(active()){question.viewHand=null;question.viewAutoHeroActions=null;question.hand=hand;question.chosenActions=chosen;question.autoHeroActions=automatic;question.selectedAction=null;question.answered=false;question.continuationError=true;paintTable($('quizTable'),hand,question.hero);renderQuizHistory(question);$('quizStatus').textContent=error.message;$('quizStatus').classList.add('error');renderQuizFlowControls();}}finally{if(active()){quizTraining.continuing=false;setQuizBusy(false);renderQuizHistory(question);renderQuizFlowControls();if(question.needsPreparation){question.needsPreparation=false;saveQuizDraft(question);prepareQuizSpot(question);}}}
}
function completeQuizHand(question){
 const hand=question.completedHand;paintTable($('quizTable'),hand,question.hero);renderQuizHistory(question);$('quizActions').innerHTML='';$('quizReference').innerHTML='';
 clearQuizDraft();saveQuizHand(question);gradeNextQuizDecision(question);
}
function gradeNextQuizDecision(question){
 if(state.quiz!==question||!question.completedHand)return;
 for(let i=0;i<question.decisions.length;i++){const d=question.decisions[i];if(d.result?.supported&&!d.grade&&!d.gradeRecorded){d.grade=scoreResult(d.result,{kind:'quiz',action:d.action,hand:d.hand});d.gradeRecorded=true;}}question.grades=question.decisions.map(d=>d.grade).filter(Boolean);
 const index=question.decisions.findIndex(d=>!d.result);
 if(index<0){question.grading=false;question.report=quizHandReport(question);$('quizStatus').textContent='Hand complete · '+question.decisions.length+' choice'+(question.decisions.length===1?'':'s')+' reviewed';$('quizFeedback').innerHTML=quizHandReportHTML(question.report);saveQuizHand(question);renderQuizFlowControls();status('Hand complete. Your assessment is ready.');if($('quiz').classList.contains('active'))$('quizContinuation').scrollIntoView({block:'start',behavior:motionMs(100)?'smooth':'auto'});return;}
 question.grading=true;const decision=question.decisions[index];$('quizStatus').textContent='Hand complete · reviewing decision '+(index+1)+' of '+question.decisions.length;
 $('quizFeedback').innerHTML='<h3>Grading your hand</h3><p>Reviewing choice '+(index+1)+' of '+question.decisions.length+' · '+esc(G.STREET[decision.hand.street])+'.</p><p class="help">Each choice is assessed using only the cards and action available at that moment. Results appear together when the review is finished.</p>';renderQuizFlowControls();
 analyze(decision.hand,{kind:'quiz',quizQuestion:question,quizDecisionIndex:index,action:decision.action,referenceModel:question.model,referenceSnapshot:question.snapshot,samples:+question.filters.quizSamples});
}
function quizHandReport(question){return buildQuizAssessmentReport(question); }
function quizHandReportHTML(report){return renderQuizAssessmentReport(report); }
function quizReportReadable(report){
 if(!report||report.version!==1||!['bb','prize units'].includes(report.units)||!Number.isInteger(report.startStreet)||report.startStreet<0||report.startStreet>3||!Array.isArray(report.decisions)||report.decisions.length>300||!Array.isArray(report.simulatedHeroActions)||!report.summary)return false;
 const s=report.summary;if(!['total','estimated','evidence','clearCosts'].every(k=>Number.isInteger(s[k])&&s[k]>=0)||s.total!==report.decisions.length||s.totalLoss!==null&&!Number.isFinite(s.totalLoss)||s.biggestDecision!==null&&!Number.isInteger(s.biggestDecision))return false;
 return report.decisions.every(d=>{
  if(!Number.isInteger(d.number)||!Number.isInteger(d.street)||d.street<0||d.street>3||!Number.isInteger(d.chosenIndex))return false;
  const r=d.result;if(!r||!r.supported)return true;if(r.referenceOnly)return PokerPreflop.isResult(r);
  if(!Array.isArray(r.actions)||!r.actions.length||r.actions.length>100||!Number.isInteger(r.best)||r.best<0||r.best>=r.actions.length||!Number.isFinite(r.samples)||!Number.isFinite(r.ignoredPublicActions))return false;
  return ['mean','se','loss','lossSE'].every(k=>Array.isArray(r[k])&&r[k].length===r.actions.length&&r[k].every(Number.isFinite))&&Array.isArray(r.reference)&&r.reference.every(Number.isFinite)&&r.actions.every(a=>a&&typeof a.label==='string');
 });
}
function saveQuizHand(question){
 const hand=question.completedHand,record=H.record(hand,{hero:question.hero,grading:question.grades});record.notes.push('Quiz hand recorded from the initial deal through completion. Only choices made by the player count toward the hand assessment.');
 if(question.autoHeroActions.size)record.notes.push('Some player decisions were simulated and excluded from grading.');
 record.quizStudy=quizHandReport(question);
 if(!question.savedRow){question.savedRow={id:id('quiz-hand-'),createdAt:record.createdAt,record};state.histories.unshift(question.savedRow);}else{record.createdAt=question.savedRow.createdAt;question.savedRow.record=record;}
 question.record=record;dbPut('hands',question.savedRow).catch(()=>status('The hand review is ready, but saving in this browser failed. Export the history to keep it.',true));renderSavedHands();
}
function quizPrivateCardsHTML(hand,hero){return`<div class="quiz-history-cardline"><span>Your hand</span><div class="quiz-history-cards">${hand.holes[hero].map(card=>cardHTML(card)).join('')}</div></div>`;}
function quizShowdownHTML(hand,name){if(!hand.done||hand.foldWinner!==null)return'';return`<div class="quiz-history-showdown">${hand.living().map(seat=>{const value=G.evaluate(hand.holes[seat],hand.board,hand.rules);return`<div class="quiz-history-cardline"><strong>${esc(name(seat))} shows</strong><div class="quiz-history-cards">${hand.holes[seat].map(card=>cardHTML(card)).join('')}</div><span class="muted">${handName(value.high)}${value.low!==null?' · '+lowName(value.low):hand.rules.low?' · no qualifying low':''}</span></div>`}).join('')}</div>`;}
function renderQuizHistory(question){
 const panel=$('quizHistory');if(!question){panel.classList.add('hide');panel.innerHTML='';return}
 const hand=question.viewHand||question.completedHand||question.hand,c=hand.config;if(c.startStreet!==0)throw Error('Quiz history must start with the initial deal.');
 const labels=G.positions(hand.n,hand.button),name=seat=>(seat===question.hero?'You · ':'')+labels[seat],amount=chips=>fmt(G.bb(chips))+' bb',forced=hand.forced,posts=[],sum=values=>(values||[]).reduce((s,v)=>s+v,0),automatic=question.viewAutoHeroActions||question.autoHeroActions||new Set(),chosen=question.chosenActions||new Set();
 let pot=sum(forced.live)+sum(forced.ante)+(forced.bigBlindAnte?.amount||0);const sb=hand.n===2?hand.button:(hand.button+1)%hand.n,bb=(hand.button+(hand.n===2?1:2))%hand.n;posts.push(name(sb)+' posts '+amount(forced.live[sb])+' small blind',name(bb)+' posts '+amount(forced.live[bb])+' big blind');const antes=forced.ante.map((value,seat)=>({value,seat})).filter(x=>x.value>0);if(antes.length===hand.n&&antes.every(x=>x.value===antes[0].value))posts.push('Each player posts '+amount(antes[0].value)+' ante');else for(const ante of antes)posts.push(name(ante.seat)+' posts '+amount(ante.value)+' ante');if(forced.bigBlindAnte?.amount)posts.push(name(forced.bigBlindAnte.seat)+' posts '+amount(forced.bigBlindAnte.amount)+' big-blind ante');
 const groups=[{street:0,board:[],pot,rows:[]}];let group=groups[0],actionIndex=0;
 for(const event of hand.log){if(event.type==='street'&&event.street<=hand.street){group={street:event.street,board:event.board.slice(),pot,rows:[]};groups.push(group)}else if(event.type==='action'){const description=event.kind==='fold'?'folds':event.kind==='check'?'checks':event.kind==='call'?'calls '+amount(event.paid):event.kind==='bet'?'bets '+amount(event.target):'raises to '+amount(event.target);group.rows.push({seat:event.seat,text:description,allIn:event.allIn,automatic:automatic.has(actionIndex),chosen:chosen.has(actionIndex),setup:event.seat===question.hero&&actionIndex<question.startActionIndex});pot+=event.paid;actionIndex++;}else if(event.type==='refund'){group.rows.push({seat:event.seat,text:'receives '+amount(event.amount)+' back (uncalled)'});pot-=event.amount;}}
 const legal=hand.done?null:hand.legal(),decision=hand.done?(hand.foldWinner!==null?'Hand ended by folds.':'Showdown complete.'):(quizTraining.continuing?'Playing out the hand…':legal.check?'Nothing to call · your decision.':'You face '+amount(legal.callCost)+' to call'+(legal.callCost===hand.stacks[hand.actor]?' · all-in':'')+'.');
 const ending=hand.done?`<div class="quiz-history-result"><h4>${hand.foldWinner!==null?'Won without showdown':'Showdown and awards'}</h4>${quizShowdownHTML(hand,name)}${hand.pots.map((p,i)=>`<div>${hand.pots.length===1?'Pot':i?'Side pot '+i:'Main pot'} · ${amount(p.net)} → ${p.paid.map((value,seat)=>value>0?esc(name(seat))+' '+amount(value):null).filter(Boolean).join(' · ')}</div>`).join('')}${hand.foldWinner===null?handResultLines(hand,hand.holes.map((_,seat)=>name(seat)),false).map(line=>`<div class="muted">${esc(line)}</div>`).join(''):''}${hand.rake?`<div class="muted">Rake ${amount(hand.rake)}</div>`:''}<div class="quiz-ending-stacks">${hand.stacks.map((value,seat)=>`<span>${esc(name(seat))}: <strong>${amount(value)}</strong> (${signed(hand.returns[seat])} bb)</span>`).join('')}</div>${hand.bountyCash.some(x=>x>0)?'<div>Bounty cash: '+hand.bountyCash.map((value,seat)=>value>0?esc(name(seat))+' '+fmt(value)+' prize units':null).filter(Boolean).join(' · ')+'</div>':''}</div>`:'';
 panel.innerHTML=`<div class="row between"><h3>${hand.done?'Complete hand history':'Hand history · from the deal'}</h3><span class="quiz-history-pot">${hand.done?'Final':'Current'} pot ${amount(hand.pot)}</span></div><p class="quiz-history-posts">${posts.map(esc).join(' · ')}</p>${quizPrivateCardsHTML(hand,question.hero)}<details class="quiz-starting-stacks"><summary>Starting stacks</summary><div>${hand.initial.map((value,seat)=>esc(name(seat))+': '+amount(value)).join(' · ')}</div></details><div class="quiz-history-streets" aria-label="Complete hand history in chronological order">${groups.map(g=>`<section class="quiz-history-street ${g.street===hand.street?'current':''}"><div class="row between"><h4>${G.STREET[g.street]}</h4><span class="small muted">Pot ${amount(g.pot)} at start</span></div>${g.board.length?`<div class="quiz-history-board" aria-label="${G.STREET[g.street]} board">${g.board.map(card=>cardHTML(card)).join('')}</div>`:''}<ol>${g.rows.map(row=>`<li class="${row.seat===question.hero?'your-action':''}"><span class="quiz-history-position">${esc(name(row.seat))}</span><span>${esc(row.text)}${row.allIn?'<em class="quiz-history-allin">All-in</em>':''}${row.automatic?'<em class="quiz-history-tag">Simulated</em>':row.chosen?'<em class="quiz-history-tag">You chose</em>':row.setup?'<em class="quiz-history-tag">Before practice</em>':''}</span></li>`).join('')||'<li class="muted">No action yet on this street.</li>'}</ol>${g.street===hand.street&&!hand.done&&!quizTraining.continuing?'<div class="quiz-history-now">Your decision now</div>':''}</section>`).join('')}</div>${ending}<div class="quiz-history-footer">${esc(decision)} <span>Raises show the total bet for that street.</span></div>`;
 panel.classList.remove('hide');
}
// An unfinished practice hand is kept in IndexedDB after each answered choice, so a reload or a discarded
// tab resumes it. Only the cards, the actions and the choices are stored; solves are recomputed.
function saveQuizDraft(question){
 if(!question||state.quiz!==question||question.completedHand||!question.decisions?.length)return;const h=question.hand,pack=question.referencePack;
 const value={version:1,savedAt:new Date().toISOString(),config:h.config,holes:h.holes.map(x=>x.slice()),board:h.board.slice(),actions:h.actionLog.map(e=>({kind:e.kind,target:e.target})),hero:question.hero,startActionIndex:question.startActionIndex,startStreet:question.startStreet,decisions:question.decisions.map(d=>({actionIndex:d.actionIndex,action:{...d.action},result:PokerPreflop.isResult(d.result)?d.result:null})),chosen:[...question.chosenActions],auto:[...question.autoHeroActions],sourceName:question.sourceName,filters:question.filters,source:pack?{kind:'chart',name:pack.name,family:pack.family}:question.rangeAnchor!==undefined?{kind:h.n===2?'exact':'multiway',rangeAnchor:question.rangeAnchor}:{kind:'model',key:question.sourceKey}};
 quizTraining.draft=true;dbPut('meta',{id:'quizDraft-v1',value}).catch(()=>{});
}
function clearQuizDraft(){if(!quizTraining.draft)return;quizTraining.draft=false;dbPut('meta',{id:'quizDraft-v1',value:null}).catch(()=>{});}
function restoreQuizDraft(value){
 if(!value)return;quizTraining.draft=true;if(value.version!==1||state.quiz)return clearQuizDraft();
 try{
  const s=value.source;let question;
  if(s.kind==='chart'){const pack=preflopLibrary.packs.find(p=>p.name===s.name&&p.family===s.family);if(!pack)throw Error('The chart for this hand is no longer loaded.');const model=new T.Model(pack.config,state.abstraction);question={model,snapshot:model.snapshot(),referencePack:pack};}
  else if(s.kind==='exact'||s.kind==='multiway'){const study=(s.kind==='exact'?exactStudyQuestion:multiwayStudyQuestion)(null);question={model:study.model,snapshot:study.snapshot,solveOptions:study.solveOptions,rangeAnchor:s.rangeAnchor};}
  else{const source=quizSources(value.filters).find(x=>x.key===s.key);if(!source)throw Error('The model for this hand is no longer available.');question={model:quizModel(source),snapshot:source.snapshot,sourceKey:source.key};}
  const hand=new G.Hand(value.config,{holes:value.holes,runout:value.board}),saved=new Map(value.decisions.map(d=>[d.actionIndex,d])),decisions=[];
  for(const e of value.actions){const d=saved.get(hand.actionLog.length);if(d)decisions.push({hand:hand.clone(),action:d.action,actionIndex:d.actionIndex,result:PokerPreflop.isResult(d.result)?d.result:null});hand.act(e);}
  if(hand.done||decisions.length!==value.decisions.length)throw Error('The saved hand could not be replayed.');
  Object.assign(question,{hand,hero:value.hero,answered:false,sourceName:value.sourceName,filters:value.filters,decisions,grades:[],chosenActions:new Set(value.chosen),autoHeroActions:new Set(value.auto),startActionIndex:value.startActionIndex,startStreet:value.startStreet});state.quiz=question;
  const heroTurn=hand.actor===question.hero&&!hand.folded[question.hero];$('quizEmpty').classList.add('hide');$('quizTable').classList.remove('hide');paintTable($('quizTable'),hand,question.hero);renderQuizHistory(question);
  // Chart spots prepare instantly; a solved spot waits for Continue so a reload does not start a solve in the background.
  const ready=heroTurn&&!state.busy&&!!question.referencePack;question.continuationError=!ready;renderQuizFlowControls();if(ready)prepareQuizSpot(question);$('quizStatus').textContent='Restored your unfinished practice hand · '+decisions.length+' choice'+(decisions.length===1?'':'s')+' kept'+(ready?'.':'. Choose Continue to resume it.');status('Your unfinished practice hand was restored. Open Practice to finish it.');
 }catch(error){state.quiz=null;clearQuizDraft();}
}
function initQuizFlow(){
 $('quizContinue').onclick=()=>continueQuizHand(false);$('quizFinish').onclick=()=>continueQuizHand(true);$('quizNextHand').onclick=dealQuiz;$('quizRetryGrades').onclick=()=>{const question=state.quiz;if(!question||state.busy)return;for(const d of question.decisions)if(d.result?.error)d.result=null;gradeNextQuizDecision(question);};$('quizExport').onclick=()=>{if(state.quiz?.record)exportJSON(H.pack(state.quiz.record),'range-lab-complete-quiz-hand.json');};$('quizReview').onclick=()=>{if(!state.quiz?.record)return;loadHistory(state.quiz.record);switchTab('review');};
}
