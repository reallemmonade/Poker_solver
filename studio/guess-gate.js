'use strict';
// Guess before solver (Settings › Decision recording, on by default): no solver strategy for a spot shows until you
// have committed to a play there, and that play is what the rating counts.
// · Wherever the analysis would show (Play at your turn, Train › Decision and the spot builder, Control every seat,
//   Hand replay) the pane shows the spot's actions first; at the table you swipe over, guess, then swipe back and act
//   (bots wait on your turn). The one you pick is graded like a table decision, then the strategy shows
//   with your pick, its cost and the rating change on top. Skip opens it without a guess (a peek at your own seat).
// Live-hand guesses join that hand's grades (so the rating, leaks and the hand report pick them up when it is saved);
// Hand replay guesses are kept with the other grades and join the rating as one extra group (replayGuessFact).
const guessGate={key:'guava-guess-gate',replay:null};
function guessGateOn(){try{return localStorage.getItem(guessGate.key)!=='0'}catch{return true}}
const GUESS_LOCK='<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V7a3 3 0 0 0-6 0z"/></svg>';
function guessButtonsHTML(actions,hand,attr){const tones=actionTones(actions,hand);
 return'<div class="guess-btns">'+actions.map((a,i)=>'<button type="button" class="guess-btn" '+attr+'="'+i+'"><i style="background:var(--act-'+tones[i]+')"></i>'+esc(tones[i]==='allin'?'All-in':toneLabel(a,tones[i],hand).replace(/ · .*/,''))+'</button>').join('')+'<button type="button" class="guess-btn guess-skip" '+attr+'-skip>Skip</button></div>';}
// The grade's cost line and the rating change it makes now (only when it counts toward the rating).
function guessVerdict(row,counted){if(!row)return{text:'',elo:null,cls:'none'};
 const chart=!!row.referenceSource&&Number.isFinite(row.referenceFrequency),solved=!!row.rated&&Number.isFinite(row.loss),mistake=gradeMistake(row),cost=gradeCost(row);
 const top=Math.max(0,...(row.options||[]).map(o=>Number.isFinite(o.f)?o.f:0)),pct=fmt(row.referenceFrequency*100,row.referenceFrequency<.1?1:0)+'%';
 const text=solved?(cost>0?'−'+fmt(cost,cost<1?2:1)+' bb vs best':'Best play'):chart?(mistake?'Rare · solver plays it '+pct:row.referenceFrequency>=top-1e-9?'Best play · '+pct:'Mixed · solver plays it '+pct):'Not graded';
 let elo=null;if(counted&&(chart||solved)&&typeof leakDecisions==='function'){try{const r=PokerRating.rate(leakDecisions()),now=r.rating??PokerRating.START,s=PokerRating.score({mistake,cost:solved?cost:null});elo=Math.round((r.n<PokerRating.PROVISIONAL?40:16)*(s-PokerRating.expected(now,PokerRating.SPOT[row.street]??1500)));}catch{}}
 return{text,elo,cls:!(chart||solved)?'none':!mistake?'good':solved&&cost<1?'ok':'bad'};}
function guessRevealHTML(g){const v=g.verdict;return'<div class="guess-reveal"><div><b><i style="background:var(--act-'+g.tone+')"></i>You: '+esc(g.label)+'</b>'+(v.text?'<span>'+esc(v.text)+'</span>':'')+'</div>'+(v.elo!==null?'<em class="guess-pill guess-'+v.cls+'">'+(v.elo>=0?'+':'−')+Math.abs(v.elo)+' Elo</em>':'')+'</div>';}
// renderPlay asks for the analysis pane's content through this. body() builds the normal content.
function guessGateHTML(h,solved,q,body){
 if(!guessGateOn()||!h||h.done)return body();
 const shows=solved?!!solved.supported:displayPolicyReady(q),at=h.actionLog.length;
 if((h.unlocked||[]).includes(at)){guessSettle(h);const g=h.guessReveal?.at===at?h.guessReveal:null;return(g?guessRevealHTML(g):'')+body();}
 // No answer yet: guess first, then the solve prompt (the solve grades the guess when it lands). A spot nothing can solve shows its notice.
 if(!shows&&(unsolvableSpot(h)||!q?.actions?.length))return body();
 const actions=solved?.supported?solved.actions:q.actions;
 return'<div class="guess-lock"><div class="guess-blur" aria-hidden="true"></div><div class="guess-q">'+GUESS_LOCK+' Your play?<small>Guess to see the solver</small></div>'+guessButtonsHTML(actions,h,'data-guess')+'</div>';}
function guessUnlock(h,at){if(!(h.unlocked||[]).includes(at))h.unlocked=[...(h.unlocked||[]),at];}
// The result a live guess is graded against: the analysis on screen, else the preflop chart or flop library behind it.
function guessResult(h){let r=activeSpotResult(h);if(r?.supported)return r;try{r=(h.street===0?preflopReference(h):null)||postflopLibraryReference(h);}catch{r=null;}return r?.supported?r:null;}
function guessLive(index){const h=state.hand;if(!h||h.done)return;const at=h.actionLog.length,solved=activeSpotResult(h),q=solved?.supported?null:studyReferenceQuery(h),actions=solved?.supported?solved.actions:q.actions,action=actions[index];if(!action)return;
 const tones=actionTones(actions,h);
 h.guessed=[...(h.guessed||[]),at];guessUnlock(h,at);
 h.guessReveal={at,label:tones[index]==='allin'?'All-in':toneLabel(action,tones[index],h).replace(/ · .*/,''),tone:tones[index],verdict:{text:'Solve to grade',elo:null,cls:'none'}};
 h.pendingGuess={at,action};guessSettle(h);
 saveLiveSession();renderPlay();}
// Grades a guess as soon as its spot has an answer: at once when one is on hand, else when the solve lands while it is
// still your turn. If you act first, chooseAction (app.js) grades the guess through the background assessment instead.
function guessSettle(h){const g=h.pendingGuess;if(!g||g.at!==h.actionLog.length||h.done)return;const result=guessResult(h);if(!result)return;
 h.pendingGuess=null;let row=null;if(T.matchAction(result.actions,g.action)>=0)try{row=scoreResult(result,{kind:'guess',action:g.action,hand:h.clone(),live:h});}catch{row=null;}
 const study=studioInterface.area==='study',counted=!!row&&!h.assisted&&!$('reveal').checked&&(study||!$('controlAll').checked);
 if(h.guessReveal?.at===g.at)h.guessReveal.verdict=guessVerdict(row,counted);saveLiveSession();}
// Hand replay: a finished review analysis waits behind the guess buttons.
function guessReplayHTML(){const g=guessGate.replay;return'<div class="guess-lock guess-replay"><div class="guess-q">'+GUESS_LOCK+' Your play?<small>Guess to see the solver</small></div>'+guessButtonsHTML(g.result.actions,g.hand,'data-guess-replay')+'</div>';}
function guessReplay(index){const g=guessGate.replay;if(!g)return;guessGate.replay=null;const box=$('reviewFeedback');
 if(index===null){box.innerHTML=resultHTML(g.result);return;}
 const action=g.result.actions[index],tones=actionTones(g.result.actions,g.hand),row=scoreResult(g.result,{kind:'reviewGuess',action,hand:g.hand});
 box.innerHTML=guessRevealHTML({label:tones[index]==='allin'?'All-in':toneLabel(action,tones[index],g.hand).replace(/ · .*/,''),tone:tones[index],verdict:guessVerdict(row,!!row)})+resultHTML(g.result,row);
 if(typeof renderPerformance==='function')try{renderPerformance()}catch{}}
function replayGuessFact(){return{assisted:false,at:'',key:'replay-guesses',grades:(state.grades||[]).filter(g=>g.source==='reviewGuess')};}
{const finish=finishAnalysis;finishAnalysis=function(result,pending){
 if(pending?.kind==='review'&&guessGateOn()&&result?.supported&&result.actions?.length){const hand=state.reviewFrames?.[state.reviewIndex];if(hand&&!hand.done&&hand.holes?.[hand.actor]){guessGate.replay={result,hand};finish(result,pending);$('reviewFeedback').innerHTML=guessReplayHTML();return;}}
 if(pending?.kind==='review')guessGate.replay=null;
 return finish(result,pending);};}
function initGuessGate(){
 const style=document.createElement('style');style.textContent=`
.guess-lock{position:relative;display:grid;gap:12px;padding:14px 0 4px}
.guess-blur{height:150px;border-radius:12px;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--ink) 9%,transparent) 0 14px,transparent 14px 16px),repeating-linear-gradient(0deg,color-mix(in srgb,var(--ink) 9%,transparent) 0 14px,transparent 14px 16px);filter:blur(5px);opacity:.7}
.guess-q{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:7px;font-weight:800;font-size:17px;text-align:center}
.guess-q small{flex-basis:100%;font-size:12px;font-weight:600;color:var(--muted)}
.guess-blur+.guess-q{position:absolute;top:58px;left:0;right:0}
.guess-btns{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.guess-btn{display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:8px 6px;border-radius:12px;border:1.5px solid var(--line);background:var(--panel2);color:var(--ink);font:inherit;font-weight:800;font-size:14px;cursor:pointer}
.guess-btn i{width:9px;height:9px;border-radius:3px;flex:none}
.guess-btn:hover{border-color:var(--gold)}.guess-skip{color:var(--muted)}
.guess-wait{display:flex;align-items:center;gap:7px;padding:8px 2px;color:var(--muted);font-weight:700;font-size:13px}
.guess-wait span{flex:1}
.guess-peek{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:12px;padding:5px 12px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
.guess-reveal{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 12px;padding:11px 14px;border-radius:14px;background:var(--panel2)}
.guess-reveal b{display:flex;align-items:center;gap:7px;font-size:15px}.guess-reveal b i{width:9px;height:9px;border-radius:3px}
.guess-reveal span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.guess-pill{font-style:normal;font-size:14px;font-weight:800;padding:3px 10px;border-radius:10px;white-space:nowrap}
.guess-good{color:var(--act-passive);background:color-mix(in srgb,var(--act-passive) 16%,transparent)}
.guess-ok{color:var(--act-bet1);background:color-mix(in srgb,var(--act-bet1) 16%,transparent)}
.guess-bad{color:var(--act-allin);background:color-mix(in srgb,var(--act-allin) 16%,transparent)}
.ui-analysis:has(.guess-lock) #analyze{display:none}
.guess-none{color:var(--muted);background:color-mix(in srgb,var(--ink) 8%,transparent)}`;document.head.append(style);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-guess],[data-guess-skip],[data-guess-replay],[data-guess-replay-skip]');if(!b)return;
  if(b.hasAttribute('data-guess'))guessLive(+b.dataset.guess);
  else if(b.hasAttribute('data-guess-skip')){const h=state.hand;if(!h||h.done)return;guessUnlock(h,h.actionLog.length);saveLiveSession();renderPlay();if(typeof studioInterface!=='undefined')markAssisted();}
  else if(b.hasAttribute('data-guess-replay'))guessReplay(+b.dataset.guessReplay);else guessReplay(null);});
}
// The switch itself (Settings › Decision recording, placed by settings-ui.js).
function guessGateSwitch(){const box=document.createElement('input');box.type='checkbox';box.id='guessGateOn';box.checked=guessGateOn();box.onchange=()=>{try{localStorage.setItem(guessGate.key,box.checked?'1':'0')}catch{}renderPlay();};return box;}
if(typeof document!=='undefined')initGuessGate();
