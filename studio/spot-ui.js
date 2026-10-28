'use strict';
const spotUI={hand:null,rangeValues:[],last:null,cache:new Map(),workerStamp:null};
// TexasSolver bridge on this computer: probed only once the user picks it, so
// other users never see the browser's local-network prompt. While it is known
// to be down, the solve button is not offered for spots that need it.
const localBridge={up:null,checked:0};
async function checkLocalBridge(){const el=$('spotLocalStatus'),url=$('spotLocalSolver')?.value;if(!url){localBridge.up=null;if(el)el.textContent='';return null;}
 try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),3000),h=await fetch(url.replace(/\/$/,'')+'/health',{signal:ctl.signal}).then(r=>r.json()).finally(()=>clearTimeout(t));localBridge.up=!!h.solver;localBridge.spot=!!h.spot;localBridge.threads=Number(h.threads)||0;if(el)el.textContent=h.solver?'TexasSolver is running on this computer'+(h.threads?' with '+h.threads+' threads':'')+'. Big heads-up flop, turn and river spots go to it.':'The bridge is running, but TexasSolver is not built. Run tools/local-solver/install-mac.sh.';}
 catch{localBridge.up=false;if(el)el.textContent='TexasSolver is not running on this computer. Start it with tools/local-solver/start.command.';}
 localBridge.checked=Date.now();spotUI.last=null;return localBridge.up;}
function renderSpotRangeEditors(){
 const h=state.hand,host=$('spotRangeInputs');if(!h||!host)return;
 if(spotUI.hand!==h){spotUI.hand=h;spotUI.rangeValues=Array(h.n).fill('');if($('spotRootSizes'))$('spotRootSizes').value='';host.innerHTML='';spotUI.last=null;}
 if(host.childElementCount===h.n)return;
 const names=G.positions(h.n,h.button);host.innerHTML=names.map((name,i)=>'<div class="field"><label for="spotRange-'+i+'">Seat '+(i+1)+' · '+esc(name)+(i===state.hero?' · you':'')+'</label><input class="input" id="spotRange-'+i+'" placeholder="Auto / all hands" value="'+esc(spotUI.rangeValues[i]||'')+'" autocomplete="off"></div>').join('');
 host.querySelectorAll('input').forEach(el=>el.onchange=()=>{spotUI.rangeValues[+el.id.split('-')[1]]=el.value.trim();spotUI.last=null;renderPlay();});
}
// Fixed solve budgets: a spot is offered only when its route finishes with an answer (see spotPlan), so the
// budgets are generous rather than user-tunable. Phones and tablets get the memory a phone tab can hold.
function spotSettings(hand,pending={}){
 const isQuiz=pending.kind==='quiz'||pending.kind==='quizPrepare',same=hand===state.hand,small=typeof smallMemoryDevice==='function'&&smallMemoryDevice(),plan=pending.plan||(isQuiz?null:spotPlan(hand)),texas=plan?.route==='texas';
 const pinned=isQuiz?pending.quizQuestion?.solveOptions:null;const rangedPinned=pinned&&pending.quizQuestion?.rangeAnchor!==undefined&&hand.actionLog.length>pending.quizQuestion.rangeAnchor?{...pinned,ranges:Array(hand.n).fill('')}:pinned;
 const effort=SOLVE_EFFORTS[pending.effort]?pending.effort:'standard',url=$('spotLocalSolver')?.value||'';
 return PokerSpot.options(rangedPinned||{rangeMode:$('spotRangeMode')?.value||'auto',ranges:same?spotUI.rangeValues.slice():Array(hand.n).fill(''),iterations:200000,milliseconds:180000,maxInfos:150000,maxJointDeals:small?100000:500000,exactMemoryMB:small?256:1024,preparationMilliseconds:60000,approximate:false,
  localSolver:texas?url:'',...texas?{forceLocal:true,localAccuracy:hand.street===1?SOLVE_EFFORTS[effort].accuracy:.5,localIterations:1000,bridgeMilliseconds:1.8e6}:{},
  samples:Math.max(2000,Number(pending.samples)||2000),tolerance:.001,rootSizes:same?String($('spotRootSizes')?.value||'').split(/[\s,;]+/).filter(Boolean).map(Number):[],abstraction:{...(pending.referenceModel?.abstraction||state.abstraction),...(state.spotSizing||{})}});
}
// Which solver answers this spot, and roughly how long it takes. Only routes measured to finish with an answer
// are offered (2026-10-28):
// - Heads-up NLH and PLO rivers solve exactly in the browser: about 25 s (NLH) and 40 s (PLO) on a laptop for
//   chart ranges. Turns and flops do not fit a tab (a turn tree takes 10 s an iteration, a flop over 1 GB), and
//   pots with three or more players exceed the exact multiway engine's deal budget even at 500,000 deals.
// - With the solver on your Mac turned on, heads-up NLH flops, turns and rivers go to TexasSolver. Flop times are
//   the medians of the 624-flop library solved on an M3 Pro with 11 threads to 1% of the pot: 3-bet pots about
//   16 s, 6-max single-raised pots about 110 s, heads-up and limped pots about 300 s. Turns and rivers are
//   short, so they get no effort choice: through the bridge on a 3-thread Linux box, where a 3-bet flop took
//   85-130 s (about 6x the Mac), a single-raised turn took 15 s and a river 10 s, setup included.
// The times scale with the bridge's thread count, and each finished solve corrects later estimates on this device.
const SOLVE_EFFORTS={quick:{label:'Quick',accuracy:2,factor:.5},standard:{label:'Standard',accuracy:1,factor:1},deep:{label:'Deep',accuracy:.5,factor:2}};
const TURN_SECONDS=5,RIVER_SECONDS=3;
function solveTimes(){try{return JSON.parse(localStorage.getItem('range-lab-solve-times')||'{}')||{}}catch{return{}}}
function recordSolveTime(plan,seconds){if(!plan||!(seconds>0))return;const t=solveTimes(),key=plan.route+'-'+plan.street,ratio=seconds/plan.seed,old=t[key];t[key]=old>0?.6*old+.4*ratio:ratio;try{localStorage.setItem('range-lab-solve-times',JSON.stringify(t))}catch{}}
function spotPlan(hand){
 if(!hand||hand.done||hand.street===0)return null;
 const c=hand.config,live=hand.living(),simple=!c.rules.low&&!c.bounties.some(x=>x>0),small=typeof smallMemoryDevice==='function'&&smallMemoryDevice();if(live.length!==2||!simple)return null;
 const bridge=localBridge.up===true&&!!$('spotLocalSolver')?.value,start=hand.pot-hand.streetPaid.reduce((s,x)=>s+x,0),spr=Math.min(...live.map(i=>hand.stacks[i]+hand.streetPaid[i]))/Math.max(1,start);
 let plan=null;
 if(c.variant==='NLH'&&bridge){const flop=spr<7?16:spr<30&&c.seats>2?110:300,threads=Math.min(4,Math.pow(11/Math.max(1,localBridge.threads||11),.8));plan={route:'texas',seed:(hand.street===1?flop:hand.street===2?TURN_SECONDS:RIVER_SECONDS)*Math.max(1,threads),efforts:hand.street===1};}
 else if(c.variant==='NLH'&&hand.street===3)plan={route:'river',seed:25*(small?2.5:1)};
 else if(c.variant==='PLO4'&&hand.street===3&&!small)plan={route:'plo-river',seed:40};
 if(!plan)return null;plan.street=hand.street;const learned=solveTimes()[plan.route+'-'+plan.street];plan.seconds=plan.seed*(learned>0?learned:1);return plan;
}
// Why the solve button is missing, in one line.
function unsolvableReason(hand){
 if(!hand||hand.done)return '';const live=hand.living().length;
 if(hand.street===0)return 'No preflop chart covers this line.';if(live>2)return 'Too many players left to solve.';
 if(hand.config.variant==='NLH')return 'Turn on the solver on your Mac to solve flops and turns.';return 'Too big to solve here.';
}
function solveTimeText(seconds){return seconds<60?'about '+Math.max(5,Math.round(seconds/5)*5)+' s':'about '+Math.round(seconds/60)+' min';}
// A spot whose answer is already stored (preflop chart or flop library) needs no solve.
function spotReferenceReady(hand){if(!hand||hand.done)return false;try{return !!(preflopReference(hand)||postflopLibraryReference(hand));}catch{return false;}}
// The solve button: references show at once; a short solve starts; a longer one asks first, with an effort
// choice only on Mac flops, where the extra time buys a measurably closer solution.
function solveSpotClick(){
 const h=state.hand;if(!h||h.done||state.busy)return;hideSolveConfirm();const plan=spotPlan(h);
 if(!plan||spotReferenceReady(h)){analyzeSpot(h,{kind:'inspect'});return;}
 if(!plan.efforts&&plan.seconds<=10){analyzeSpot(h,{kind:'inspect',plan});return;}
 const box=$('spotConfirm');if(!box)return;
 const where=plan.route==='texas'?'on your Mac':'on this device';
 box.innerHTML=plan.efforts?'<p><strong>Solve this flop '+where+'?</strong> Pick how thorough. Deeper is closer to the exact strategy.</p><div class="row">'+Object.entries(SOLVE_EFFORTS).map(([id,e])=>'<button type="button" class="btn'+(id==='standard'?'':' secondary')+'" data-solve-effort="'+id+'">'+e.label+' · '+solveTimeText(plan.seconds*e.factor)+'</button>').join('')+'<button type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>':'<p><strong>Solve this spot '+where+'?</strong> It takes '+solveTimeText(plan.seconds)+'.</p><div class="row"><button type="button" class="btn" data-solve-effort="standard">Solve</button><button type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>';
 box.classList.remove('hide');
 box.querySelectorAll('[data-solve-effort]').forEach(b=>b.onclick=()=>{hideSolveConfirm();if(state.hand===h&&!h.done)analyzeSpot(h,{kind:'inspect',plan,effort:b.dataset.solveEffort});});
 box.querySelector('[data-solve-cancel]').onclick=hideSolveConfirm;
}
function hideSolveConfirm(){const box=$('spotConfirm');if(box){box.classList.add('hide');box.innerHTML='';}}
function spotSourceStamp(snapshot){return JSON.stringify([snapshot?.format,snapshot?.id,snapshot?.episodes,snapshot?.decisions,snapshot?.createdAt,snapshot?.seedState,snapshot?.config,snapshot?.abstraction]);}
function spotCacheKey(observed,options,extraAction,snapshot){const parts=['spot-v3',PokerSpot.publicKey(observed),options,extraAction],automatic=options.rangeMode==='auto'&&Array.from({length:observed.config.seats},(_,i)=>String(options.ranges[i]||'').trim()).some(text=>!text||/^auto$/i.test(text));if(automatic&&snapshot?.episodes>0&&observed.actions.length)parts.push(spotSourceStamp(snapshot));return JSON.stringify(parts);}
function validSpotResult(r){
 if(PokerPreflop.isResult(r))return true;const q=r?.solve,tree=q?.actionTree;if(!r?.supported||q?.version!==1||!['exact-river','exact-postflop','exact-multiway','sampled-subgame'].includes(q.method)||!Number.isInteger(q.iterations)||q.iterations<1||!Number.isFinite(q.seconds)||!tree||!['betSizes','raiseSizes','openSizes','preflopRaiseMultipliers'].every(k=>Array.isArray(tree[k])&&tree[k].length>0&&tree[k].length<=4&&tree[k].every(x=>Number.isFinite(x)&&x>0))||!Array.isArray(q.rangeAssumptions)||q.rangeAssumptions.length<2||q.rangeAssumptions.length>9)return false;
 if(!q.rangeAssumptions.every(v=>v&&Number.isInteger(v.seat)&&v.seat>=0&&v.seat<9&&typeof v.range==='string'&&typeof v.source==='string'&&Number.isFinite(v.combinations)&&v.combinations>0))return false;
 if(['exact-river','exact-postflop','exact-multiway'].includes(q.method)&&(!q.exact||!Number.isFinite(q.gap)||q.gap<0||!Number.isFinite(q.handRegret)||q.handRegret<0||!Number.isFinite(q.tolerance)||q.tolerance<=0))return false;
 return !!(Array.isArray(r.actions)&&r.actions.length>0&&r.actions.length<=20&&r.actions.every(a=>a&&typeof a.label==='string'&&['fold','check','call','bet','raise'].includes(a.kind))&&['mean','se','loss','lossSE','reference'].every(k=>Array.isArray(r[k])&&r[k].length===r.actions.length&&r[k].every(Number.isFinite))&&r.reference.every(x=>x>=0)&&Math.abs(r.reference.reduce((s,x)=>s+x,0)-1)<1e-6&&Number.isInteger(r.best)&&r.best>=0&&r.best<r.actions.length);
}
async function getSavedSpot(key){try{const db=await openDB();return await new Promise((resolve,reject)=>{const request=db.transaction('solves').objectStore('solves').get('spot-'+hash(key));request.onsuccess=()=>{const row=request.result,learned=row?.result?.solve?.rangeAssumptions?.some(range=>range.historyActionsUsed>0);resolve(row?.key===key&&(!learned||JSON.parse(key).length>4)&&(PokerPreflop.isResult(row.result)||row.result?.solve?.revision>=PokerSpot.REVISION)?row.result:null);};request.onerror=()=>reject(request.error);});}catch{return null;}}
function rememberSpot(key,result,context={}){
 if(!validSpotResult(result))return;spotUI.cache.set(key,result);while(spotUI.cache.size>100)spotUI.cache.delete(spotUI.cache.keys().next().value);
 dbPut('solves',{id:'spot-'+hash(key),key,result,...context,updatedAt:new Date().toISOString()}).catch(error=>status('Analysis is ready, but saving on this device failed. Export it to keep a copy. '+error.message,true));
}
async function analyzeSpot(hand,pending={kind:'inspect'},extraAction=null){
 if(state.busy||tableView.playing||!hand||hand.done)return;
 try{
  const reference=pending.referenceModel?{model:pending.referenceModel,snapshot:pending.referenceSnapshot||pending.referenceModel.snapshot()}:studyReference(hand),opts=spotSettings(hand,{...pending,referenceModel:reference.model}),observed=observedData(hand),baseKey=PokerSpot.publicKey(observed),sourceStamp=spotSourceStamp(reference.snapshot);
  const regular=PokerSpot.actionsAt(hand,hand,opts,null);if(extraAction&&T.matchAction(regular,extraAction)>=0)extraAction=null;
  let cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot),task={...pending,hand:hand.clone(),referenceModel:reference.model,referenceSnapshot:reference.snapshot,cacheKey,baseKey,solveOptions:opts};state.pending=task;lock('spotSolve');status('Preparing player ranges and the continuation betting tree…');
  if(!['quiz','quizPrepare'].includes(pending.kind))$(pending.kind==='review'?'reviewFeedback':'playFeedback').innerHTML='<h3>Solving this position…</h3><p id="spotInlineProgress" role="status">Preparing player ranges and legal bet sizes.</p><p class="help">The calculation uses the public history and your cards. You can cancel without changing the hand.</p>';
  if(bundleManifest&&smallMemoryDevice()){await ensurePhoneLibraries(state.hand===hand?hand:task.hand);if(state.pending!==task)return;}
  const sourceReference=preflopReference(hand,regular,pending.quizQuestion?.referencePack);if(sourceReference&&!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length){if(extraAction&&T.matchAction(sourceReference.actions,extraAction)<0){sourceReference.actions.push(extraAction);sourceReference.reference.push(null);sourceReference.probs=sourceReference.reference;}if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:sourceReference};state.pending=null;lock();finishAnalysis(sourceReference,task);return;}
  const libraryReference=!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length?postflopLibraryReference(hand):null;if(libraryReference&&!(extraAction&&T.matchAction(libraryReference.actions,extraAction)<0)){if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:libraryReference};state.pending=null;lock();finishAnalysis(libraryReference,task);return;}
  const turnReference=!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length?await turnLibraryReference(hand):null;if(state.pending!==task)return;if(turnReference&&!(extraAction&&T.matchAction(turnReference.actions,extraAction)<0)){if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:turnReference};state.pending=null;lock();finishAnalysis(turnReference,task);return;}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const context=await requestSolvedPolicy(hand);if(state.pending!==task)return;if(context?.conditionedRanges?.every(Boolean)){opts.ranges=context.conditionedRanges;opts.rangeOrigin='Conditioned on the preceding exact strategy and public actions';cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const carried=await carriedPostflopRanges(hand);if(state.pending!==task)return;if(carried){opts.ranges=carried.ranges;opts.rangeOrigin=carried.origin;cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const chart=chartPostflopRanges(hand,observed,opts);if(chart){opts.ranges=chart.ranges;opts.rangeOrigin=chart.origin;cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  let cached=spotUI.cache.get(cacheKey);if(!pending.force&&!cached)cached=await getSavedSpot(cacheKey);
  if(state.pending!==task)return;
  if(!pending.force&&validSpotResult(cached)){spotUI.cache.set(cacheKey,cached);if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey:task.baseKey,options:task.solveOptions,cacheKey:task.cacheKey,result:cached};state.pending=null;lock();finishAnalysis({...cached,reused:true},task);return;}
  const worker=ensureWorker();if(spotUI.workerStamp!==sourceStamp){worker.postMessage({type:'load',snapshot:reference.snapshot});spotUI.workerStamp=sourceStamp;state.workerVersion=0;}
  task.dispatched=true;task.started=Date.now();worker.postMessage({type:'solve',observed,options:opts,extraAction,tag:pending.kind});
  }catch(error){const task=state.pending;state.pending=null;lock();quizAnalysisError(error.message,task);endSolveFeedback(task,error.message,true);status(error.message,true);}
}
// A solve that ends without a result replaces its "Solving" block, so the
// heading and cancel hint do not stay on screen.
function endSolveFeedback(task,message,failed){const progress=$('spotInlineProgress'),el=$(task?.kind==='review'?'reviewFeedback':'playFeedback');if(!progress)return;if(['quiz','quizPrepare'].includes(task?.kind)||!el?.contains(progress)){progress.textContent=message;return;}el.innerHTML='<h3>'+(failed?'The solve failed':'The solve was stopped')+'</h3><p role="status"'+(failed?' class="error"':'')+'>'+esc(message)+'</p>';}
function handleSpotWorkerMessage(message){
 if(message.type==='spotProgress'){
  const p=message,phase=p.phase==='local'?'Solving with TexasSolver on this computer · '+fmt(p.done,0)+'s'+(p.iterations?' · iteration '+fmt(p.iterations,0):'')+(Number.isFinite(p.exploitability)?' · exploitability '+fmt(p.exploitability,2)+'% of pot':''):p.phase==='preparing'?'Preparing ranges':p.phase==='evaluating'?'Evaluating the solved continuation':p.method==='exact-multiway'?'Solving the exact '+(p.players>2?'multiplayer':'heads-up')+' tree':p.method==='exact-river'?'Solving the exact river tree':'Solving the current continuation',text=phase+(p.total>1?' · '+fmt(p.done,0)+' / '+fmt(p.total,0)+(p.method?.startsWith('exact-')?' iterations':p.phase==='evaluating'?' deals':' sampled updates'):'')+(Number.isFinite(p.gap)?' · deviation gap '+fmt(p.gap,5):'');
  status(text);if($('spotInlineProgress'))$('spotInlineProgress').textContent=text;$('progress').style.width=p.phase==='preparing'?'2%':p.phase==='local'?Math.min(95,5+p.done/6)+'%':Math.min(99,100*p.done/p.total)+'%';
  if(['quiz','quizPrepare'].includes(state.pending?.kind))$('quizStatus').textContent=(state.pending.kind==='quizPrepare'?'Preparing your next decision · ': 'Reviewing your hand · ')+text;
  return true;
 }
 if(message.type==='error'){const task=state.pending;if(task&&!['quiz','quizPrepare','review'].includes(task.kind))spotUI.last={baseKey:task.baseKey,options:task.solveOptions,result:{supported:false,message:message.message}};spotUI.workerStamp=null;endSolveFeedback(task,message.message,true);return false;}if(message.type!=='spotResult')return false;
 const pending=state.pending;state.pending=null;if(!pending)return true;const result=message.result;if(result.supported&&pending.started&&pending.plan)recordSolveTime(pending.plan.route==='texas'&&pending.plan.efforts?{...pending.plan,seed:pending.plan.seed*SOLVE_EFFORTS[pending.effort||'standard'].factor}:pending.plan,(Date.now()-pending.started)/1000);if(result.supported)rememberSpot(pending.cacheKey,result,{observed:observedData(pending.hand),options:pending.solveOptions,extraAction:JSON.parse(pending.cacheKey)[3]||null});if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey:pending.baseKey,options:pending.solveOptions,cacheKey:pending.cacheKey,result};
 lock();$('progress').style.width=result.canceled?'0%':'100%';if(result.canceled){quizAnalysisError(result.message,pending);endSolveFeedback(pending,result.message,false);status(result.message);return true;}finishAnalysis(result,pending);return true;
}
function activeSpotResult(hand){return spotUI.last&&PokerSpot.publicKey(observedData(hand))===spotUI.last.baseKey?spotUI.last.result:null;}
function spotLocal(result){const q=result?.solve;return !!(result?.supported&&q?.method==='local-texassolver');}
function spotApproximate(result){const q=result?.solve;return !!(result?.supported&&q?.approximate&&q.method==='sampled-subgame'&&!spotCertified(result));}
function spotCertified(result){const q=result?.solve;return !!(result?.supported&&q?.exact&&['exact-river','exact-postflop','exact-multiway'].includes(q.method)&&Number.isFinite(q.gap)&&Number.isFinite(q.tolerance)&&q.gap<=q.tolerance&&Number.isFinite(q.handRegret)&&q.handRegret<=(q.handTolerance??q.tolerance));}
function spotFrequencyHTML(result){
 if(!result.supported)return '<div class="notice"><strong>No matching reliable solution</strong><br>'+esc(result.message)+'</div>';if(PokerPreflop.isResult(result))return preflopFrequencyHTML(result);
 if(spotLocal(result))return '<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%"></i></div></div>').join('')+'</div>';
 if(spotApproximate(result))return '<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%"></i></div></div>').join('')+'</div>';
 if(!spotCertified(result))return '<div class="notice"><strong>No solver answer for this spot.</strong> The solve did not reach its accuracy target.</div>';
 const solve=result.solve;return'<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%"></i></div></div>').join('')+'</div>';
}
function spotRangesHTML(result){const ranges=result?.solve?.rangeAssumptions||[];return ranges.length?'<div class="spot-ranges"><h3>Ranges</h3><ul>'+ranges.map(r=>'<li><strong>Seat '+(r.seat+1)+':</strong> '+esc(r.range)+'</li>').join('')+'</ul></div>':'';}
function spotResultHTML(result,grade=null){
 if(PokerPreflop.isResult(result))return preflopResultHTML(result,grade);
 const solve=result.solve,converged=spotCertified(result),approximate=spotApproximate(result),best=result.actions[result.best],frequent=result.reference.indexOf(Math.max(...result.reference));
 const local=spotLocal(result),title=local?'Solved on this computer with TexasSolver':converged?'Finite-game solution reached the accuracy target':approximate?'Approximate solution':'No reliable recommendation available';
 const actionValues=approximate?'<h3>Estimated action values</h3><div class="tableWrap"><table><thead><tr><th>Action</th><th>Frequency</th><th>Estimated EV</th></tr></thead><tbody>'+result.actions.map((a,i)=>'<tr><td>'+esc(a.label)+(i===result.best?' · highest estimate':'')+'</td><td>'+fmt(result.reference[i]*100,1)+'%</td><td>'+signed(result.mean[i],3)+' ± '+fmt(1.96*result.se[i],3)+' '+esc(result.units)+'</td></tr>').join('')+'</tbody></table></div>':converged?'<h3>Action values from this decision</h3><div class="tableWrap"><table><thead><tr><th>Action</th><th>Frequency</th><th>EV</th><th>Estimated cost</th></tr></thead><tbody>'+result.actions.map((a,i)=>'<tr><td>'+esc(a.label)+(i===result.best?' · highest EV':'')+'</td><td>'+fmt(result.reference[i]*100,1)+'%</td><td>'+signed(result.mean[i],3)+' '+esc(result.units)+'</td><td>'+fmt(result.loss[i],3)+' '+esc(result.units)+'</td></tr>').join('')+'</tbody></table></div>':'';
 return'<section class="spot-solution"><div class="eyebrow">Analysis of the current position</div><h3>'+title+'</h3>'+(converged?'<p><strong>Highest-EV action: '+esc(best.label)+'</strong>'+(frequent!==result.best?' · most frequent: '+esc(result.actions[frequent].label)+' ('+fmt(result.reference[frequent]*100,1)+'%)':'')+'</p>':approximate||local?'<p><strong>Most frequent action: '+esc(result.actions[frequent].label)+'</strong></p>':'')+spotFrequencyHTML(result)+spotRangesHTML(result)+actionValues+(converged&&grade?'<p><strong>Your action cost: '+fmt(grade.estimatedLoss??grade.loss,3)+' '+esc(result.units)+'</strong></p>':'')+'</section>';
}
function renderSpotQuizReport(report){
 const rows=report.decisions,certified=rows.filter(d=>spotCertified(d.result)&&d.chosenIndex>=0),references=rows.filter(d=>PokerPreflop.isResult(d.result)),complete=certified.length===rows.length,total=certified.reduce((s,d)=>s+d.result.loss[d.chosenIndex],0),units=esc(report.units);
 const title=complete?'Whole-hand measured grade':references.length?'Hand review with source references':'Reliable whole-hand grade unavailable';
 return '<section class="quiz-hand-grade"><div class="eyebrow">Whole-hand review</div><h3>'+title+'</h3><p class="help">Source charts provide action frequencies. EV costs require a finite postflop solve that meets its measured accuracy target.</p><div class="quiz-grade-stats"><div><small>Decisions with source frequencies</small><strong>'+references.length+' / '+rows.length+'</strong><span>Imported references match the game and line exactly.</span></div><div><small>Total measured decision cost</small><strong>'+(complete?fmt(total,3)+' '+units:'Unavailable')+'</strong><span>'+(complete?'All decisions met the accuracy target.':'A whole-hand cost requires measured values for every decision.')+'</span></div><div><small>Decisions with measured grades</small><strong>'+certified.length+' / '+rows.length+'</strong></div></div><div class="quiz-grade-decisions">'+rows.map(d=>{
  const chart=PokerPreflop.isResult(d.result),a=d.chosenIndex,frequency=chart&&a>=0?d.result.reference[a]:null,label=spotCertified(d.result)&&a>=0?fmt(d.result.loss[a],3)+' '+units:chart&&frequency!==null?fmt(frequency*100,1)+'% in source':'Not graded';
  return '<details class="quiz-grade-decision"><summary><span><strong>'+d.number+'. '+esc(G.STREET[d.street])+'</strong> · '+esc(d.action)+'</span><span class="quiz-decision-cost">'+label+'<small>'+(spotCertified(d.result)?'Measured accuracy target reached':chart?'Source frequency only':'No reliable grade')+'</small></span></summary><div class="quiz-grade-context">'+esc(d.position)+' · '+esc(d.cards)+(d.board?' · '+esc(d.board):'')+'</div>'+(d.result?decisionResultHTML(d.result,d.grade):'<p>The solve has not finished for this decision.</p>')+'</details>';
 }).join('')+'</div><p class="help">Winning or losing a pot does not determine decision quality. Simulated player choices, missing source coverage and uncertified estimates are excluded from grades.</p></section>';
}
function prepareQuizSpot(question){
 if(state.quiz!==question||question.completedHand||state.busy)return;question.preparing=true;question.answered=true;question.solveOptions??=spotSettings(question.hand,{kind:'quizPrepare',quizQuestion:question,referenceModel:question.model,samples:Number(question.filters.quizSamples)});if(question.rangeAnchor===undefined)question.solveOptions.ranges=Array(question.hand.n).fill('');question.solveOptions.rootSizes=[];
 $('quizEmpty').classList.add('hide');$('quizTable').classList.remove('hide');paintTable($('quizTable'),question.hand,question.hero);renderQuizHistory(question);$('quizActions').innerHTML='';$('quizStatus').textContent='Preparing a solution for this decision before you act…';
 analyze(question.hand,{kind:'quizPrepare',quizQuestion:question,referenceModel:question.model,referenceSnapshot:question.snapshot,samples:Number(question.filters.quizSamples)});
}
function finishQuizPreparation(result,pending){
 const question=pending.quizQuestion;if(state.quiz!==question)return;question.preparing=false;question.answered=false;if(!result.supported){question.prepared=null;question.continuationError=false;showQuizQuestion();$('quizStatus').textContent='Practice only — '+result.message;return;}question.prepared=result;question.continuationError=false;showQuizQuestion();$('quizStatus').textContent='Decision '+question.decisionNumber+(result.referenceOnly?' · source reference matched':' · finite-game solve completed')+' · choose your action. Feedback appears after the hand.';
}
function initSpotSolving(){
 $('spotStop').onclick=()=>{if(state.job!=='spotSolve')return;const task=state.pending;if(task?.dispatched){state.worker?.postMessage({type:'stop'});status('Stopping the current solve…');}else{state.pending=null;lock();quizAnalysisError('Preparation was canceled.',task);endSolveFeedback(task,'Preparation was canceled.',false);status('Preparation was canceled.');}};
 $('quizStopSolve').onclick=()=>$('spotStop').onclick();
 $('spotExport').onclick=exportPortableSpot;
 ['spotRangeMode','spotRootSizes'].forEach(id=>$(id).onchange=()=>{spotUI.last=null;renderPlay();});$('spotLocalSolver').onchange=()=>{spotUI.last=null;dbPut('meta',{id:'spotLocalSolver',value:$('spotLocalSolver').value}).catch(()=>{});checkLocalBridge().then(()=>renderPlay());renderPlay();};addEventListener('focus',()=>{if($('spotLocalSolver').value&&Date.now()-localBridge.checked>10000)checkLocalBridge();});$('spotResetRanges').onclick=()=>{spotUI.rangeValues=Array(state.hand?.n||2).fill('');$('spotRangeInputs').innerHTML='';spotUI.last=null;renderSpotRangeEditors();renderPlay();};
 $('spotClearCache').onclick=async()=>{spotUI.cache.clear();spotUI.last=null;renderPlay();try{const db=await openDB();const tx=db.transaction('solves','readwrite');tx.objectStore('solves').clear();tx.oncomplete=()=>status('Saved spot analyses cleared. The next Analyze click will solve again.');tx.onerror=()=>status(tx.error.message,true);}catch(error){status(error.message,true);}};renderSpotRangeEditors();initMultiwayStudies();
}
