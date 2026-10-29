'use strict';
const spotUI={hand:null,rangeValues:[],last:null,cache:new Map(),workerStamp:null};
// Signed in on the computer that runs the bridge: hand the bridge this account so it collects solves sent from
// your other devices (see sendToMac). An older bridge has no /link and stays unlinked.
function linkLocalBridge(url,health){const link=typeof citrusAccount!=='undefined'&&citrusAccount.link;if(!link||!/^https?:\/\//.test(link.api)||!health?.solver||health.linkedUser===link.user||health.link===false)return;fetch(url.replace(/\/$/,'')+'/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:link.api,token:link.token,user:link.user})}).catch(()=>{});}
// TexasSolver bridge on this computer: probed only once the user picks it, so
// other users never see the browser's local-network prompt. While it is known
// to be down, the solve button is not offered for spots that need it.
const localBridge={up:null,checked:0};
async function checkLocalBridge(){const el=$('spotLocalStatus'),url=$('spotLocalSolver')?.value;if(!url){localBridge.up=null;if(el)el.textContent='';return null;}
 try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),3000),h=await fetch(url.replace(/\/$/,'')+'/health',{signal:ctl.signal}).then(r=>r.json()).finally(()=>clearTimeout(t));localBridge.up=!!h.solver;localBridge.spot=!!h.spot;localBridge.threads=Number(h.threads)||0;localBridge.load=Number(h.load)||0;linkLocalBridge(url,h);loadLearnedFlops(url,h);if(el)el.textContent=h.solver?'TexasSolver is running on this computer'+(h.threads?' with '+h.threads+' threads':'')+'. Big heads-up flop, turn and river spots go to it.':'The bridge is running, but TexasSolver is not built. Run tools/local-solver/install-mac.sh.';}
 catch{localBridge.up=false;if(el)el.textContent='TexasSolver is not running on this computer. Start it with tools/local-solver/start.command.';}
 localBridge.checked=Date.now();spotUI.last=null;return localBridge.up;}
// Flops the library is missing: a heads-up flop whose preflop line has a library spot but whose flop was never solved
// answers with a stand-in flop, and goes on a wanted list in your account ('flopwant-' rows). Your Mac solves wanted
// flops with the library's own tree while it is idle (tools/local-solver/learn.cjs), so the library grows toward
// every flop you actually see. The app on the Mac loads them from its bridge, and solves for a learned flop sent
// from your phone come back from them within the sync time.
function missingFlopWant(hand){
 if(!hand||hand.done||hand.street!==1||!postflopLibrary.libraries.length||!preflopLibrary.packs.length)return null;
 try{const range=PokerPreflop.postflopRanges(preflopLibrary.packs,hand.config,hand.actionLog),m=range&&PokerPostflopLibrary.missing(postflopLibrary.libraries,range,hand);if(!m)return null;
  const {id:spotId,label,chart,pot,stack,tree,rangeIp,rangeOop}=m.spot;return{id:'flopwant-'+hash([spotId,chart.name,chart.key,pot,stack,JSON.stringify(rangeIp),JSON.stringify(rangeOop)].join('|'))+'-'+m.key,value:{spot:{id:spotId,label,chart,pot,stack,tree,rangeIp,rangeOop},key:m.key}};}catch{return null;}
}
const noted=new WeakMap();
function noteMissingFlop(hand){
 if(!hand||hand.street!==1||noted.get(hand)===hand.board.join()||typeof citrusAccount==='undefined'||!citrusAccount.user)return;
 const want=missingFlopWant(hand);if(!want)return;noted.set(hand,hand.board.join());if(spotUI.wants?.has(want.id))return;
 const value={...want.value,at:Date.now(),status:'wanted'};(spotUI.wants||(spotUI.wants=new Map())).set(want.id,value);dbPut('meta',{id:want.id,value}).catch(()=>{});
}
// The flop of this spot was learned by your Mac since the library was built.
function learnedFlopReady(hand){const want=missingFlopWant(hand);return !!want&&spotUI.wants?.get(want.id)?.status==='done';}
// On the Mac: the bridge's learned flops, as one more flop library kept in memory and refreshed when the count changes.
const learnedFlops={count:0,lib:null};
async function loadLearnedFlops(url,health){
 const count=Number(health?.learnedFlops)||0;if(count===learnedFlops.count)return;
 try{const input=await fetch(url.replace(/\/$/,'')+'/learned').then(r=>r.json());if(!input||input.none)return;const lib=PokerPostflopLibrary.validate(input);memoryOnly.add(lib);
  postflopLibrary.libraries=postflopLibrary.libraries.filter(l=>l!==learnedFlops.lib).concat(lib);learnedFlops.lib=lib;learnedFlops.count=count;spotUI.last=null;if(state.hand)renderPlay();}catch{}
}
function renderSpotRangeEditors(){
 const h=state.hand,host=$('spotRangeInputs');if(!h||!host)return;
 if(spotUI.hand!==h){spotUI.hand=h;spotUI.rangeValues=Array(h.n).fill('');if($('spotRootSizes'))$('spotRootSizes').value='';host.innerHTML='';spotUI.last=null;}
 if(host.childElementCount===h.n)return;
 const names=G.positions(h.n,h.button);host.innerHTML=names.map((name,i)=>'<div class="field"><label for="spotRange-'+i+'">Seat '+(i+1)+' · '+esc(name)+(i===state.hero?' · you':'')+'</label><input class="input" id="spotRange-'+i+'" placeholder="Auto / all hands" value="'+esc(spotUI.rangeValues[i]||'')+'" autocomplete="off"></div>').join('');
 host.querySelectorAll('input').forEach(el=>el.onchange=()=>{spotUI.rangeValues[+el.id.split('-')[1]]=el.value.trim();spotUI.last=null;renderPlay();});
}
// Fixed solve budgets per route (see spotPlan), generous rather than user-tunable. A spot sent to the Mac carries
// the bridge settings; the Mac's bridge fills in its own address. Phones and tablets get the memory a phone tab can hold.
function spotSettings(hand,pending={}){
 const isQuiz=pending.kind==='quiz'||pending.kind==='quizPrepare',same=hand===state.hand,small=typeof smallMemoryDevice==='function'&&smallMemoryDevice(),plan=pending.plan||(isQuiz?null:spotPlan(hand)),texas=plan?.route==='texas'||plan?.route==='mac';
 const pinned=isQuiz?pending.quizQuestion?.solveOptions:null;const rangedPinned=pinned&&pending.quizQuestion?.rangeAnchor!==undefined&&hand.actionLog.length>pending.quizQuestion.rangeAnchor?{...pinned,ranges:Array(hand.n).fill('')}:pinned;
 const effort=SOLVE_EFFORTS[pending.effort]?pending.effort:'standard',url=$('spotLocalSolver')?.value||'';
 return PokerSpot.options(rangedPinned||{rangeMode:$('spotRangeMode')?.value||'auto',ranges:same?spotUI.rangeValues.slice():Array(hand.n).fill(''),iterations:200000,milliseconds:180000,maxInfos:150000,maxJointDeals:small?100000:500000,exactMemoryMB:small?256:1024,preparationMilliseconds:60000,approximate:false,
  localSolver:plan?.route==='texas'?url:'',...texas?{forceLocal:true,localAccuracy:hand.street===1?SOLVE_EFFORTS[effort].accuracy:.5,localIterations:1000,bridgeMilliseconds:1.8e6}:{},
  samples:Math.max(2000,Number(pending.samples)||2000),tolerance:.001,rootSizes:same?String($('spotRootSizes')?.value||'').split(/[\s,;]+/).filter(Boolean).map(Number):[],abstraction:{...(pending.referenceModel?.abstraction||state.abstraction),...(state.spotSizing||{})}});
}
// Which solver answers this spot, where it runs and roughly how long it takes (measured 2026-10-28):
// - Heads-up NLH and PLO rivers solve exactly in the browser: about 25 s (NLH) and 40 s (PLO) on a laptop for
//   chart ranges. Turns and flops do not fit a tab (a turn tree takes 10 s an iteration, a flop over 1 GB).
// - Everything else from the flop on goes to the solver on your Mac: straight to its bridge on the Mac itself,
//   and from any other device through the account's solve queue (the bridge collects queued spots, solves them
//   and syncs each answer back as a saved spot; see tools/local-solver/server.cjs).
// - Heads-up NLH flop times are the medians of the 624-flop library solved on an M3 Pro with 11 threads to 1% of
//   the pot: 3-bet pots about 16 s, 6-max single-raised pots about 110 s, heads-up and limped pots about 300 s.
//   Through the bridge on a 3-thread Linux box, where a 3-bet flop took 85-130 s (about 6x the Mac), a
//   single-raised turn took 15 s and a river 10 s, setup included. PLO flops take about 5 minutes on the Mac
//   (tools/local-solver/README.md) and turns seconds. Pots with three or more players run the app's own engines
//   on the Mac up to the bridge's 30-minute limit, and very wide ones can stop without a settled answer.
// - Preflop answers come only from charts, so a line no chart covers has no solve.
// A queued solve adds about 30 s: the bridge and the phone each sync every 20 seconds.
// Times scale with the Mac's threads and load, and each finished solve corrects later estimates on this device.
const SOLVE_EFFORTS={quick:{label:'Quick',accuracy:2,factor:.5},standard:{label:'Standard',accuracy:1,factor:1},deep:{label:'Deep',accuracy:.5,factor:2}};
const TURN_SECONDS=5,RIVER_SECONDS=3,PLO_FLOP_SECONDS=300,PLO_TURN_SECONDS=10,MULTIWAY_SECONDS=1800,MAC_OFFLINE_MS=10*60000,QUEUE_SECONDS=30;
function solveTimes(){try{return JSON.parse(localStorage.getItem('range-lab-solve-times')||'{}')||{}}catch{return{}}}
function solveTimeKey(plan){return plan.route+'-'+plan.street+(plan.kind&&plan.kind!=='nlh'?'-'+plan.kind:'');}
function recordSolveTime(plan,seconds){if(!plan||!(seconds>0)||plan.kind==='multiway'||plan.learned)return;const t=solveTimes(),key=solveTimeKey(plan),ratio=seconds/plan.seed,old=t[key];t[key]=old>0?.6*old+.4*ratio:ratio;try{localStorage.setItem('range-lab-solve-times',JSON.stringify(t))}catch{}}
// How fast this device runs the solvers' kind of work (typed-array arithmetic over scattered indexes), measured in
// about 0.2 s and kept for a week. The browser river times above were measured where this scores BENCH_REFERENCE
// (about 6.2), so an on-device estimate starts from this device's own speed before finished solves correct it.
const BENCH_REFERENCE=6.2,BENCH_KEY='citrus-device-speed-v1';
function benchScore(){const n=1<<16,a=new Float64Array(n),b=new Float64Array(n),idx=new Uint32Array(n);let seed=7;for(let i=0;i<n;i++){seed=(seed*1103515245+12345)>>>0;idx[i]=seed%n;a[i]=(seed&1023)/1024;b[i]=1-a[i];}
 let best=0;for(let round=0;round<3;round++){const t0=performance.now();let passes=0,acc=0;while(performance.now()-t0<60){for(let i=0;i<n;i++){const j=idx[i];acc+=a[j]*b[i];b[i]=Math.max(0,b[i]+a[j]-acc*1e-9);}passes++;}best=Math.max(best,passes/(performance.now()-t0));}return best;}
function deviceSpeed(){try{const saved=JSON.parse(localStorage.getItem(BENCH_KEY)||'null');if(saved?.score>0&&Date.now()-saved.at<7*864e5)return saved.score;}catch{}const score=benchScore();try{localStorage.setItem(BENCH_KEY,JSON.stringify({score,at:Date.now()}))}catch{}return score;}
function deviceSlowdown(){return Math.min(8,Math.max(.25,BENCH_REFERENCE/Math.max(.1,deviceSpeed())));}
function onDeviceRoute(plan){return plan?.route==='river'||plan?.route==='plo-river';}
function spotPlan(hand){
 if(!hand||hand.done)return null;
 const c=hand.config,live=hand.living(),simple=!c.rules.low&&!c.bounties.some(x=>x>0),small=typeof smallMemoryDevice==='function'&&smallMemoryDevice();
 if(hand.street===0)return{route:'none',street:0,reason:'No chart covers this preflop line yet.'};
 if(!simple||!['NLH','PLO4'].includes(c.variant))return{route:'none',street:hand.street,reason:'This game type can\'t be solved yet.'};
 const bridge=localBridge.up===true&&!!$('spotLocalSolver')?.value,kind=live.length>2?'multiway':c.variant==='PLO4'?'plo':'nlh';let plan;
 if(kind!=='multiway'&&hand.street===3&&!bridge&&(kind==='nlh'||!small))plan={route:kind==='nlh'?'river':'plo-river',seed:(kind==='nlh'?(small?34:24):40)*deviceSlowdown(),wait:0};
 else{
  const mac=bridge?localBridge:spotUI.mac,load=Math.min(1,Math.max(0,Number(mac?.load)||0)),scale=Math.min(4,Math.max(1,Math.pow(11/Math.max(1,mac?.threads||10),.8)))*(1+load);
  const start=hand.pot-hand.streetPaid.reduce((s,x)=>s+x,0),spr=Math.min(...live.map(i=>hand.stacks[i]+hand.streetPaid[i]))/Math.max(1,start),flop=spr<7?16:spr<30&&c.seats>2?110:300;
  const base=kind==='multiway'?MULTIWAY_SECONDS:kind==='plo'?(hand.street===1?PLO_FLOP_SECONDS:hand.street===2?PLO_TURN_SECONDS:RIVER_SECONDS):hand.street===1?flop:hand.street===2?TURN_SECONDS:RIVER_SECONDS;
  const learned=kind==='nlh'&&hand.street===1&&!bridge&&learnedFlopReady(hand);
  plan={route:bridge?'texas':'mac',learned,seed:learned?5:kind==='multiway'?base:base*scale,efforts:kind==='nlh'&&hand.street===1&&!learned,mayStop:kind==='multiway',wait:bridge?0:QUEUE_SECONDS+queuedSeconds()};
  if(!bridge){const user=typeof citrusAccount!=='undefined'&&citrusAccount.user;if(!user)plan.blocked='Sign in on this device and on your Mac to send it to your Mac.';else if(!mac?.seen)plan.note='Open the app on your Mac once, signed in, with the solver on. Your Mac picks up solves from then on.';else if(Date.now()-mac.seen>MAC_OFFLINE_MS)plan.note='Your Mac is offline. It starts when your Mac is back.';else if(load>.5)plan.note='Your Mac is busy with other work, so this is slower.';}
 }
 plan.street=hand.street;plan.kind=kind;const ratio=plan.learned?1:solveTimes()[solveTimeKey(plan)];plan.solve=plan.seed*(ratio>0?ratio:1);plan.seconds=plan.solve+plan.wait;return plan;
}
// One line for a spot with no solve: what the solve button says instead.
function unsolvableReason(hand){const plan=spotPlan(hand);return plan?.route==='none'?plan.reason:plan?.blocked||'';}
function solveTimeText(seconds){return seconds<60?'about '+Math.max(5,Math.round(seconds/5)*5)+' s':seconds<5400?'about '+Math.round(seconds/60)+' min':seconds<172800?'about '+Math.round(seconds/3600)+' h':'about '+Math.round(seconds/86400)+' days';}
function planTimeText(plan,factor=1){const text=solveTimeText(plan.solve*factor+plan.wait);return plan.mayStop?text.replace('about','up to'):text;}
function planPlace(plan){return onDeviceRoute(plan)?'on this device':'on your Mac';}
// A spot whose answer is already stored (preflop chart or flop library) needs no solve.
// A stand-in flop does not count once your Mac has learned the real one.
function spotReferenceReady(hand){if(!hand||hand.done)return false;try{if(preflopReference(hand))return true;const r=postflopLibraryReference(hand);return !!r&&!(r.solve?.library?.standIn&&learnedFlopReady(hand));}catch{return false;}}
// The solve button, offered on every live spot: references show at once and a short solve starts; otherwise it
// says where the solve runs and how long it takes (with an effort choice on heads-up NLH flops, where the extra
// time buys a measurably closer solution), or in one line why this spot can't be solved.
function solveSpotClick(skipReference=false){
 const h=state.hand;if(!h||h.done||state.busy)return;hideSolveConfirm();const plan=spotPlan(h),job=spotJob(h);
 if(!skipReference&&spotReferenceReady(h)){analyzeSpot(h,{kind:'inspect',expectReference:true});return;}if(!plan){analyzeSpot(h,{kind:'inspect'});return;}
 if(job?.status==='done'){deliverSolveJob(true);return;}
 const box=$('spotConfirm');if(!box)return;
 const show=()=>{box.classList.remove('hide');box.querySelectorAll('[data-solve-effort]').forEach(b=>b.onclick=()=>{hideSolveConfirm();if(state.hand===h&&!h.done)analyzeSpot(h,{kind:'inspect',plan,effort:b.dataset.solveEffort});});box.querySelector('[data-solve-cancel]').onclick=hideSolveConfirm;};
 const block=job&&(jobPending(job)||job.status==='done')?jobText(job):plan.route==='none'?plan.reason:plan.blocked;
 if(block){box.innerHTML='<p>'+esc(block)+'</p><div class="row"><button type="button" class="btn secondary" data-solve-cancel>OK</button></div>';show();return;}
 if(!plan.efforts&&plan.seconds<=10&&!plan.note){analyzeSpot(h,{kind:'inspect',plan});return;}
 const note=(plan.note?'<p class="small muted">'+esc(plan.note)+'</p>':'')+(plan.mayStop?'<p class="small muted">Very wide pots can stop without an answer.</p>':'');
 box.innerHTML=plan.efforts?'<p><strong>Solve this flop '+planPlace(plan)+'?</strong> Deeper is closer to the exact strategy.</p>'+note+'<div class="row">'+Object.entries(SOLVE_EFFORTS).map(([id,e])=>'<button type="button" class="btn'+(id==='standard'?'':' secondary')+'" data-solve-effort="'+id+'">'+e.label+' · '+planTimeText(plan,e.factor)+'</button>').join('')+'<button type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>':'<p><strong>Solve this spot '+planPlace(plan)+'?</strong> '+planTimeText(plan).replace(/^./,x=>x.toUpperCase())+'.</p>'+note+'<div class="row"><button type="button" class="btn" data-solve-effort="standard">Solve</button><button type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>';
 show();
}
function hideSolveConfirm(){const box=$('spotConfirm');if(box){box.classList.add('hide');box.innerHTML='';}}
// Solves sent to the Mac. Each is a 'solvejob-<hash>' meta row that syncs through the account: the Mac's bridge
// marks it running, then done (writing the answer as the saved spot rowId) or failed. 'macsolver' is the
// bridge's heartbeat: when it was last seen, its threads and how busy the Mac is.
spotUI.jobs=new Map();spotUI.mac=null;spotUI.jobTimer=0;
async function loadSolveJobs(){try{const rows=await dbAll('meta');spotUI.jobs=new Map(rows.filter(r=>/^solvejob-/.test(r.id)&&r.value&&typeof r.value==='object').map(r=>[r.id,r.value]));spotUI.wants=new Map(rows.filter(r=>/^flopwant-/.test(r.id)&&r.value&&typeof r.value==='object').map(r=>[r.id,r.value]));const mac=rows.find(r=>r.id==='macsolver')?.value;spotUI.mac=mac&&typeof mac==='object'?mac:null;}catch{}watchSolveJobs();}
function spotJob(hand){if(!hand||hand.done||!spotUI.jobs.size)return null;const key=PokerSpot.publicKey(observedData(hand));let found=null;for(const j of spotUI.jobs.values())if(j.baseKey===key&&(!found||j.createdAt>found.createdAt))found=j;return found;}
function jobPending(j){return j.status==='queued'||j.status==='running';}
// This device's id, so it cancels only the solves it sent.
function deviceId(){try{let id=localStorage.getItem('citrus-device-id');if(!id){id=Math.random().toString(36).slice(2,12);localStorage.setItem('citrus-device-id',id);}return id;}catch{return'';}}
// Cancelling marks the job; the Mac stops it at its next progress check (within about 10 seconds) or skips it.
async function cancelSolveJob(id){const j=spotUI.jobs.get(id);if(!j||!jobPending(j))return;const value={...j,status:'cancelled',cancelledAt:Date.now()};spotUI.jobs.set(id,value);try{await dbPut('meta',{id,value});}catch{}citrusAccount.run();watchSolveJobs();if(state.hand)renderPlay();}
// A solve this device sent stops once you act or the hand ends: its answer would be for a decision already made.
function cancelStaleSolveJobs(){const me=deviceId();let key=null;for(const [id,j] of spotUI.jobs){if(!jobPending(j)||j.device!==me)continue;if(key===null)key=state.hand&&!state.hand.done?PokerSpot.publicKey(observedData(state.hand)):'';if(j.baseKey!==key)cancelSolveJob(id);}}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cancel-job]');if(b){e.preventDefault();cancelSolveJob(b.dataset.cancelJob);}});
function queuedSeconds(){let s=0;const now=Date.now();for(const j of spotUI.jobs.values())if(jobPending(j))s+=Math.max(0,(j.seconds||0)-(j.status==='running'?(now-(j.startedAt||now))/1000:0));return s;}
// Where a Mac solve stands, in one line, with a progress bar while it runs. A running solve's progress comes from
// the Mac every 10 seconds (tools/local-solver/queue.cjs, progressOf); between reports it counts down locally.
function agoText(ms){const m=Math.round(ms/60000);return m<1?'just now':m<90?m+' min ago':Math.round(m/60)+' h ago';}
// Between reports the bar keeps moving at the reported rate, and it never steps back when a new report is lower.
spotUI.shownProgress=new Map();
function jobProgress(j){const g=j.progress,now=Date.now();if(!g?.at){const left=Math.max(0,(j.seconds||0)-(now-(j.startedAt||now))/1000);return{phase:'starting',p:0,left};}const left=Math.max(0,g.remaining-(now-g.at)/1000),raw=g.remaining>0?1-(1-g.p)*left/g.remaining:g.p,p=Math.min(.99,Math.max(raw,spotUI.shownProgress.get(j.rowId)||0));spotUI.shownProgress.set(j.rowId,p);return{phase:g.phase,p,left:(1-p)*left/Math.max(.01,1-raw),stale:now-g.at>120000,at:g.at};}
function jobState(j){
 if(j.status==='failed')return{text:'Your Mac could not solve this. '+(j.message||'')};if(j.status==='cancelled')return{text:'Solve cancelled.'};if(j.status==='done')return{text:'Solved on your Mac.'};
 if(j.status==='running'){const g=jobProgress(j);if(g.stale)return{text:'Your Mac stopped reporting progress ('+agoText(Date.now()-g.at)+'). It may be asleep.',p:g.p};
  return{text:g.phase==='preparing'?'Your Mac is preparing the ranges…':'Solving on your Mac · '+Math.floor(g.p*100)+'% · '+(g.left>=5?solveTimeText(g.left)+' left':'almost done'),p:g.p};}
 const sync=typeof citrusAccount!=='undefined'?citrusAccount.status:'',mac=spotUI.mac,solve=solveTimeText(j.seconds||60);
 if(['offline','off','expired','signedOut'].includes(sync))return{text:'Not sent yet: this device can\'t reach your account. It sends when the connection is back.'};
 if(!mac?.seen)return{text:'Waiting for your Mac. It hasn\'t connected yet: open the app on your Mac, signed in, with Solver on your Mac turned on.'};
 if(Date.now()-mac.seen>MAC_OFFLINE_MS)return{text:'Waiting for your Mac (last seen '+agoText(Date.now()-mac.seen)+'). Then '+solve+' to solve.'};
 const ahead=queuedSeconds()-Math.max(0,j.seconds||0);return{text:'Queued on your Mac. Starts '+(ahead>30?'in '+solveTimeText(ahead):'within 30 s')+', then '+solve+' to solve.',p:0};
}
function jobText(j){return jobState(j).text;}
function jobNoticeHTML(j){const st=jobState(j),id='solvejob-'+hash(j.key);return'<div class="notice" id="solveJobNotice">'+(jobPending(j)?'<button type="button" class="ui-text-button solve-cancel" data-cancel-job="'+esc(id)+'">Cancel</button>':'')+esc(st.text)+(st.p!==undefined?'<div class="solve-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.floor(st.p*100)+'"><div style="width:'+Math.max(2,Math.min(100,st.p*100)).toFixed(1)+'%"></div></div>':'')+'</div>';}
setInterval(()=>{const el=$('solveJobNotice');if(!el||document.visibilityState==='hidden')return;const j=spotJob(state.hand);if(j&&jobPending(j))el.outerHTML=jobNoticeHTML(j);},1000);
async function sendToMac(task,observed,opts,extraAction){
 if(!opts.ranges.some(x=>String(x||'').trim()))throw Error('No chart ranges cover this line, so it can\'t be solved.');
 const plan=task.plan,factor=plan.efforts?SOLVE_EFFORTS[task.effort]?.factor||1:1,id='solvejob-'+hash(task.cacheKey);
 const job={v:1,status:'queued',key:task.cacheKey,rowId:'spot-'+hash(task.cacheKey),baseKey:task.baseKey,observed,options:opts,extraAction:extraAction||null,seconds:Math.round(plan.solve*factor),seed:plan.seed*factor,device:deviceId(),street:plan.street,kind:plan.kind,learned:!!plan.learned,createdAt:Date.now()};
 await dbPut('meta',{id,value:job});spotUI.jobs.set(id,job);citrusAccount.run();watchSolveJobs();
}
// While a solve is out on the Mac, sync every 20 seconds, and every 10 while it runs, so its progress stays
// current and its answer shows soon after it lands.
function watchSolveJobs(){clearTimeout(spotUI.jobTimer);spotUI.jobTimer=0;const jobs=[...spotUI.jobs.values()];if(!jobs.some(jobPending))return;spotUI.jobTimer=setTimeout(()=>{spotUI.jobTimer=0;if(document.visibilityState!=='hidden')citrusAccount.run();watchSolveJobs();},jobs.some(j=>j.status==='running')?10000:20000);}
// A finished Mac solve for the live spot shows as soon as it syncs in.
async function deliverSolveJob(force=false){
 const h=state.hand,j=spotJob(h);if(!j||j.status!=='done'||state.busy||activeSpotResult(h))return;if(!force&&spotUI.delivered===j.rowId)return;spotUI.delivered=j.rowId;
 let row=null;try{const db=await openDB();row=await new Promise((resolve,reject)=>{const r=db.transaction('solves').objectStore('solves').get(j.rowId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{}
 if(state.hand!==h||h.done||!row||row.key!==j.key||!validSpotResult(row.result))return;spotUI.cache.set(j.key,row.result);if(j.seed>0&&j.finishedAt>j.startedAt)recordSolveTime({route:'mac',street:j.street,kind:j.kind,seed:j.seed,learned:j.learned},(j.finishedAt-j.startedAt)/1000);
 finishAnalysis(row.result,{kind:'inspect',hand:h.clone(),baseKey:j.baseKey,cacheKey:j.key,solveOptions:j.options});
}
addEventListener('citrus-synced',()=>loadSolveJobs().then(()=>{deliverSolveJob();if(typeof renderPlay==='function'&&state.hand)renderPlay();}));
function spotSourceStamp(snapshot){return JSON.stringify([snapshot?.format,snapshot?.id,snapshot?.episodes,snapshot?.decisions,snapshot?.createdAt,snapshot?.seedState,snapshot?.config,snapshot?.abstraction]);}
function spotCacheKey(observed,options,extraAction,snapshot){const parts=['spot-v3',PokerSpot.publicKey(observed),options,extraAction],automatic=options.rangeMode==='auto'&&Array.from({length:observed.config.seats},(_,i)=>String(options.ranges[i]||'').trim()).some(text=>!text||/^auto$/i.test(text));if(automatic&&snapshot?.episodes>0&&observed.actions.length)parts.push(spotSourceStamp(snapshot));return JSON.stringify(parts);}
function validSpotResult(r){
 if(PokerPreflop.isResult(r))return true;if(r?.solve?.method==='postflop-library')return validActions(r);const q=r?.solve,tree=q?.actionTree,local=['local-texassolver','local-plo'].includes(q?.method);if(!r?.supported||q?.version!==1||!['exact-river','exact-postflop','exact-multiway','sampled-subgame'].includes(q.method)&&!local||!Number.isInteger(q.iterations)||q.iterations<(local?0:1)||!Number.isFinite(q.seconds)||!tree||!(local?['betSizes','raiseSizes']:['betSizes','raiseSizes','openSizes','preflopRaiseMultipliers']).every(k=>Array.isArray(tree[k])&&(local||tree[k].length>0)&&tree[k].length<=4&&tree[k].every(x=>Number.isFinite(x)&&x>0))||!Array.isArray(q.rangeAssumptions)||q.rangeAssumptions.length<2||q.rangeAssumptions.length>9)return false;
 if(!q.rangeAssumptions.every(v=>v&&Number.isInteger(v.seat)&&v.seat>=0&&v.seat<9&&typeof v.range==='string'&&typeof v.source==='string'&&Number.isFinite(v.combinations)&&v.combinations>0))return false;
 if(['exact-river','exact-postflop','exact-multiway'].includes(q.method)&&(!q.exact||!Number.isFinite(q.gap)||q.gap<0||!Number.isFinite(q.handRegret)||q.handRegret<0||!Number.isFinite(q.tolerance)||q.tolerance<=0))return false;
 return validActions(r);
}
function validActions(r){
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
  // A stored answer expected at the click was not there after all: ask about a real solve instead of running one
  // that can't finish here.
  if(pending.expectReference){const plan=spotPlan(hand);if(plan&&!onDeviceRoute(plan)){state.pending=null;lock();endSolveFeedback(task,'',false);$('playFeedback').innerHTML='';if(!pending.automatic)solveSpotClick(true);return;}}
  if(task.plan?.route==='mac'){await sendToMac(task,observed,opts,extraAction);if(state.pending!==task)return;state.pending=null;lock();const el=$('playFeedback');if(el)el.innerHTML='';status('Sent to your Mac.');return;}
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
// Frequencies with no EVs: a solve on the Mac (TexasSolver or the PLO solver) or a precomputed flop library.
function spotFrequenciesOnly(result){const q=result?.solve;return !!(result?.supported&&['local-texassolver','local-plo','postflop-library'].includes(q?.method));}
function spotApproximate(result){const q=result?.solve;return !!(result?.supported&&q?.approximate&&q.method==='sampled-subgame'&&!spotCertified(result));}
function spotCertified(result){const q=result?.solve;return !!(result?.supported&&q?.exact&&['exact-river','exact-postflop','exact-multiway'].includes(q.method)&&Number.isFinite(q.gap)&&Number.isFinite(q.tolerance)&&q.gap<=q.tolerance&&Number.isFinite(q.handRegret)&&q.handRegret<=(q.handTolerance??q.tolerance));}
function spotFrequencyHTML(result){
 if(!result.supported)return '<div class="notice"><strong>No matching reliable solution</strong><br>'+esc(result.message)+'</div>';if(PokerPreflop.isResult(result))return preflopFrequencyHTML(result);
 const tones=actionTones(result.actions,state.hand);
 if(spotFrequenciesOnly(result))return '<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
 if(spotApproximate(result))return '<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
 if(!spotCertified(result))return '<div class="notice"><strong>No solver answer for this spot.</strong> The solve did not reach its accuracy target.</div>';
 const solve=result.solve;return'<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(a.label)+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+result.reference[i]*100+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
}
// Each live player's range as a 13x13 grid: pairs on the diagonal, suited above it, offsuit below, each cell
// shaded by how much of that hand is in the range. Range text is classes ("AKs:0.5") or exact combos ("AhKh:0.5").
const GRID_RANKS='AKQJT98765432';
function rangeClassWeights(text){
 const w=new Map(),add=(k,x,n)=>w.set(k,(w.get(k)||0)+x/n);
 for(const raw of String(text||'').split(/[\s,]+/)){if(!raw)continue;const [hand,wt]=raw.split(':'),x=wt===undefined?1:Number(wt);if(!(x>0))continue;
  if(/^[AKQJT2-9]{2}[so]?$/.test(hand)){const k=hand[0]===hand[1]?hand.slice(0,2):hand;if(k.length===2&&k[0]!==k[1]){add(k+'s',x,1);add(k+'o',x,1);}else w.set(k,Math.max(w.get(k)||0,x));}
  else if(/^[AKQJT2-9][cdhs][AKQJT2-9][cdhs]$/.test(hand)){const [a,b]=GRID_RANKS.indexOf(hand[0])<=GRID_RANKS.indexOf(hand[2])?[hand[0],hand[2]]:[hand[2],hand[0]];if(a===b)add(a+b,x,6);else if(hand[1]===hand[3])add(a+b+'s',x,4);else add(a+b+'o',x,12);}}
 return w;
}
// With mix (hand class -> action frequencies, the acting player's whole strategy), each cell splits into the action
// colors left to right, and fades with the hand's weight in the range.
function rangeGridHTML(text,mix=null,tones=null){const w=rangeClassWeights(text);let cells='';for(let i=0;i<13;i++)for(let j=0;j<13;j++){const a=GRID_RANKS[Math.min(i,j)],b=GRID_RANKS[Math.max(i,j)],k=i===j?a+b:a+b+(i<j?'s':'o'),x=Math.min(1,w.get(k)||0),m=mix&&x>0&&mix[k];cells+='<span '+(m?'class="mixed" style="'+actionMixStyle(m,tones)+';opacity:'+(.35+.65*x).toFixed(2)+'" title="'+k+' · '+m.map(p=>Math.round(p*100)+'%').join(' / ')+'"':'style="--w:'+x.toFixed(2)+'" title="'+k+' '+Math.round(x*100)+'%"')+'>'+k+'</span>';}return'<div class="range-grid" role="img" aria-label="Range grid">'+cells+'</div>';}
function spotRangesHTML(result){
 const all=result?.solve?.rangeAssumptions||[],h=state.hand,live=h&&!h.done&&h.n===all.length?new Set(h.living()):null,names=h&&h.n===all.length?G.positions(h.n,h.button):null;
 const ranges=all.filter(r=>live?live.has(r.seat):!/^All legal hands/.test(r.range));if(!ranges.length)return'';
 const mix=result.handMix&&result.handMix.classes&&typeof result.handMix.classes==='object'?result.handMix:null,tones=mix?actionTones(result.actions,h):null;
 // The acting player, whose strategy colors the grid, comes first.
 ranges.sort((p,q)=>(mix&&q.seat===mix.seat)-(mix&&p.seat===mix.seat));
 return'<div class="spot-ranges"><h3>Ranges</h3><div class="range-grids">'+ranges.map(r=>{const mine=mix&&r.seat===mix.seat;return'<figure><figcaption><strong>'+esc(names?names[r.seat]:'Seat '+(r.seat+1))+(h&&r.seat===state.hero?' · you':'')+'</strong>'+(r.combinations>0?' · '+Math.round(r.combinations/13.26)+'% of hands':'')+'</figcaption>'+(mine?actionKeyHTML(result.actions,tones):'')+(/^All legal hands/.test(r.range)?'<p class="help">Any two cards</p>':rangeClassWeights(r.range).size?rangeGridHTML(r.range,mine?mix.classes:null,tones):'<p class="help">'+esc(r.range)+'</p>')+'</figure>';}).join('')+'</div></div>';
}
function spotResultHTML(result,grade=null){
 if(PokerPreflop.isResult(result))return preflopResultHTML(result,grade);
 const solve=result.solve,converged=spotCertified(result),approximate=spotApproximate(result),best=result.actions[result.best],frequent=result.reference.indexOf(Math.max(...result.reference));
 const local=spotFrequenciesOnly(result),method=solve?.method,title=method==='postflop-library'?'Precomputed flop strategy':method==='local-plo'?'Solved with the PLO solver':local?'Solved on this computer with TexasSolver':converged?'Finite-game solution reached the accuracy target':approximate?'Approximate solution':'No reliable recommendation available';
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
 $('spotClearCache').onclick=async()=>{spotUI.cache.clear();spotUI.last=null;renderPlay();try{const db=await openDB();const tx=db.transaction('solves','readwrite');tx.objectStore('solves').clear();tx.oncomplete=()=>status('Saved spot analyses cleared. The next Analyze click will solve again.');tx.onerror=()=>status(tx.error.message,true);}catch(error){status(error.message,true);}};renderSpotRangeEditors();initMultiwayStudies();loadSolveJobs().then(()=>{if(state.hand)renderPlay();});
}
