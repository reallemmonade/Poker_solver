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
 try{const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),3000),h=await fetch(url.replace(/\/$/,'')+'/health',{signal:ctl.signal}).then(r=>r.json()).finally(()=>clearTimeout(t));localBridge.up=!!h.solver;localBridge.spot=!!h.spot;localBridge.preflop=!!h.preflop;localBridge.update=!!h.update;localBridge.threads=Number(h.threads)||0;localBridge.load=Number(h.load)||0;linkLocalBridge(url,h);loadLearnedFlops(url,h);if(el)el.textContent=h.solver?'TexasSolver is running on this computer'+(h.threads?' with '+h.threads+' threads':'')+'. Big heads-up flop, turn and river spots go to it.':'The bridge is running, but TexasSolver is not built. Run tools/local-solver/install-mac.sh.';}
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
// Preflop lines no chart covers go on a wanted list in your account too ('preflopwant-' rows, the line without your
// cards). Your Mac solves them while it is idle (tools/local-solver/queue.cjs), and the answer comes back on the row
// for every hand class, so the next time the line comes up it shows at once on any device. The key is the line
// relative to the button and the effective stack to two significant figures, so the same line at about the same
// depth counts once. The list also shows which lines the next chart build should cover.
function preflopWant(hand){
 if(!hand||hand.done||hand.street!==0||hand.config.variant!=='NLH'||hand.config.rules?.low||hand.config.bounties?.some(x=>x>0))return null;
 const c=hand.config,n=hand.n,rel=i=>(i-hand.button+n)%n,others=hand.living().filter(i=>i!==hand.actor).map(i=>hand.initial[i]);if(!others.length)return null;
 const depth=Number((G.bb(Math.min(hand.initial[hand.actor],Math.max(...others)))/c.bb).toPrecision(2)),pre=hand.actionLog.filter(a=>a.street===0);
 const key=JSON.stringify([n,depth,c.sb/c.bb,c.ante/c.bb,c.anteMode,c.mode==='cash'?[c.rakePct,c.rakeCap/c.bb]:'chips',pre.map(a=>[rel(a.seat),a.kind,a.target?G.bb(a.target)/c.bb:0])]);
 return{id:'preflopwant-'+hash(key),value:{key,depth,label:n+'-handed '+depth+'bb: '+pre.filter(a=>a.kind!=='fold').map(a=>G.positions(n,hand.button)[a.seat]+' '+(a.kind==='call'?'calls':'raises to '+G.bb(a.target)/c.bb)).join(', ')+', '+G.positions(n,hand.button)[hand.actor]+' to act',
  spot:{config:c,actions:pre.map(a=>({seat:a.seat,street:0,kind:a.kind,...a.target?{target:a.target}:{}})),actor:hand.actor,heroCards:[51,47]}}};
}
const notedPreflop=new WeakMap();
function noteMissingPreflop(hand){
 if(!hand||hand.street!==0||notedPreflop.get(hand)===hand.actionLog.length||typeof citrusAccount==='undefined'||!citrusAccount.user||chartsLoading()||!preflopLibrary.packs.length)return;
 const want=preflopWant(hand);if(!want)return;notedPreflop.set(hand,hand.actionLog.length);if(spotUI.preflopWants?.has(want.id))return;
 const value={...want.value,at:Date.now(),status:'wanted'};(spotUI.preflopWants||(spotUI.preflopWants=new Map())).set(want.id,value);dbPut('meta',{id:want.id,value}).catch(()=>{});
}
// Your Mac's answer for this preflop line, for your hand class, or null.
function learnedPreflop(hand){
 const want=preflopWant(hand),row=want&&spotUI.preflopWants?.get(want.id);if(row?.status!=='done'||!row.result?.classes)return null;
 try{const r=PokerLocalSolver.preflopResult(hand,{...row.result,hero:row.result.classes[G.Core.handClass(hand.holes[hand.actor])]});r.solve.learned=true;r.solve.warning='Your Mac solved this line earlier. '+r.solve.warning;return r;}catch{return null;}
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
// actionEVs: this app can grade on TexasSolver's action EVs, so the bridge or cloud may send them (an app from before
// chip-EV grading does not ask, and gets the frequencies-only answer it knows how to grade).
// the bridge settings; the Mac's bridge fills in its own address. Phones and tablets get the memory a phone tab can hold.
function spotSettings(hand,pending={}){
 const isQuiz=pending.kind==='quiz'||pending.kind==='quizPrepare',same=hand===state.hand,small=typeof smallMemoryDevice==='function'&&smallMemoryDevice(),plan=pending.plan||(isQuiz?null:spotPlan(hand)),texas=plan?.route==='texas'||plan?.route==='mac';
 const pinned=isQuiz?pending.quizQuestion?.solveOptions:null;const rangedPinned=pinned&&pending.quizQuestion?.rangeAnchor!==undefined&&hand.actionLog.length>pending.quizQuestion.rangeAnchor?{...pinned,ranges:Array(hand.n).fill('')}:pinned;
 const effort=SOLVE_EFFORTS[pending.effort]?pending.effort:'standard',url=$('spotLocalSolver')?.value||'',preflopEffort=hand.street===0?{preflopEffort:effort}:{};
 return PokerSpot.options(rangedPinned||{rangeMode:$('spotRangeMode')?.value||'auto',ranges:same?spotUI.rangeValues.slice():Array(hand.n).fill(''),iterations:200000,milliseconds:180000,maxInfos:150000,maxJointDeals:small?100000:500000,exactMemoryMB:small?256:1024,preparationMilliseconds:60000,approximate:false,
  localSolver:plan?.route==='texas'?url:'',...texas?{forceLocal:true,actionEVs:true,localAccuracy:hand.street===1?SOLVE_EFFORTS[effort].accuracy:.5,localIterations:1000,bridgeMilliseconds:1.8e6,...preflopEffort}:{},
  samples:Math.max(2000,Number(pending.samples)||2000),tolerance:.001,rootSizes:same?String($('spotRootSizes')?.value||'').split(/[\s,;]+/).filter(Boolean).map(Number):[],abstraction:{...(pending.referenceModel?.abstraction||state.abstraction),...(state.spotSizing||{})}});
}
// Which solver answers this spot, where it runs and roughly how long it takes (measured 2026-10-28):
// - Heads-up NLH rivers always solve exactly on this device (bets of 1/3, 2/3 and 1.5x the pot and all-in, raises of
//   the same sizes): about 1-2 s on a laptop for chart ranges and up to 7 s for every hand both ways at 200bb
//   (measured 2026-11-03; on the same ranges it matches TexasSolver's river strategy). PLO rivers take about 40 s,
//   desktop only. Turns and flops do not fit a tab (a turn tree takes 10 s an iteration, a flop over 1 GB).
// - Everything else from the flop on goes to the solver on your Mac: straight to its bridge on the Mac itself,
//   and from any other device through the account's solve queue (the bridge collects queued spots, solves them
//   and syncs each answer back as a saved spot; see tools/local-solver/server.cjs).
// - Heads-up NLH flop times are the medians of the 624-flop library solved on an M3 Pro with 11 threads to 1% of
//   the pot: 3-bet pots about 16 s, 6-max single-raised pots about 110 s, heads-up and limped pots about 300 s.
//   Through the bridge on a 3-thread Linux box, where a 3-bet flop took 85-130 s (about 6x the Mac), a
//   single-raised turn took 15 s and a river 10 s, setup included. PLO flops take about 5 minutes on the Mac
//   (tools/local-solver/README.md) and turns seconds. Pots with three or more players run the app's own engines
//   on the Mac up to the bridge's 30-minute limit, and very wide ones can stop without a settled answer, except
//   three-way NLH pots, which go to the 3-way solver (tools/multiway-solver): MW3_SECONDS are Mac estimates from
//   its 4-core Linux measurements (README there), flop, turn and river: the earlier 150, 120 and 10 s times what
//   exact card removal costs on Linux (flop 1.7, turn 1.9, river 2.1), not yet timed on a Mac. A flop solved with
//   leads (PokerLocalSolver.mwFlopLeads: the hero is not the preflop raiser, or someone has led) takes
//   MW3_LEADS_SECONDS, the 150 s times 3.0.
// - Preflop answers come from charts. A no-limit hold'em line no chart covers goes to the preflop spot solver on the
//   Mac (tools/preflop/spot.cjs): the chart solver again with this line in its tree, about 0.075 s per iteration per
//   seat on the Mac (1,100 iterations, 0.01 s heads-up), plus, when the spot can reach the flop three-way, 40 sample
//   flops of the 3-way solver at about 150 s each (Quick 12, Deep 80).
// A queued solve adds about 30 s: the bridge and the phone each sync every 20 seconds.
// Times scale with the Mac's threads and load, and each finished solve corrects later estimates on this device.
const SOLVE_EFFORTS={quick:{label:'Quick',accuracy:2,factor:.5},standard:{label:'Standard',accuracy:1,factor:1},deep:{label:'Deep',accuracy:.5,factor:2}};
const TURN_SECONDS=15,RIVER_SECONDS=5,PLO_FLOP_SECONDS=300,PLO_TURN_SECONDS=10,MULTIWAY_SECONDS=1800,MW3_SECONDS=[255,225,20],MW3_LEADS_SECONDS=450,MAC_OFFLINE_MS=10*60000,QUEUE_SECONDS=30;
// Cloud solves (tools/cloud): when your Mac is offline or busy, a queued solve can go to a container on Modal that is
// billed by the second, and the button says what it should cost. url is the deployed endpoint (empty: no cloud);
// rate is its dollars an hour, boot the seconds a cold container takes to start. A rented server running the bridge
// with --name (tools/local-solver/link.cjs) beats as 'solver-<name>' and takes jobs while idle at its own rate.
const CLOUD_STUCK_MS=3*60e3,CLOUD_SOLVER={url:'https://maxam-lemmon--guava-solver-web.us-east.modal.run',api:'https://range-lab-live-rooms.onrender.com',rate:.441,threads:16,boot:25,big:{rate:1.637,threads:64,boot:40,flop:12,pass:.7}},SERVER_OFFLINE_MS=10*60000,CLOUD_KEY='citrus-cloud-solves';
function cloudSolvesOn(){let v=null;try{v=localStorage.getItem(CLOUD_KEY)}catch{}return v!=='off';}
function cloudReady(){return!!CLOUD_SOLVER.url&&cloudSolvesOn()&&typeof citrusAccount!=='undefined'&&!!citrusAccount.user;}
// Where a queued solve goes: your Mac while it's online and free; else an idle server of yours; else the cloud; else
// it waits for your Mac. Preflop lines that reach a 3-way flop (heavy: hours on a Mac) get the big cloud machine,
// which solves 8 of their 3-way flops at once.
// where: 'cloud' or 'mac' when you picked one (the Mac/Cloud switch), else the cheapest that's ready.
function cloudTarget(heavy){const c=heavy?CLOUD_SOLVER.big:CLOUD_SOLVER;return{target:'modal',threads:c.threads,load:0,rate:c.rate,boot:c.boot,cloud:true,big:!!heavy};}
function solveTarget(heavy,where=null){
 const now=Date.now(),mac=spotUI.mac,macQueue=[...spotUI.jobs.values()].some(j=>jobPending(j)&&(j.target||'mac')==='mac');
 if(where==='cloud'&&cloudReady())return cloudTarget(heavy);
 if(where==='mac'&&macOnline())return{target:'mac',threads:mac?.threads,load:mac?.load,rate:0};
 if(macOnline()&&!mac.busy&&!macQueue)return{target:'mac',threads:mac.threads,load:mac.load,rate:0};
 for(const s of spotUI.servers.values())if(s.seen&&now-s.seen<SERVER_OFFLINE_MS&&!s.busy&&!(s.load>.5)&&![...spotUI.jobs.values()].some(j=>jobPending(j)&&j.target===s.name))return{target:s.name,threads:s.threads,load:0,rate:Number(s.rate)||0,server:true};
 if(cloudReady())return cloudTarget(heavy);
 return{target:'mac',threads:mac?.threads,load:mac?.load,rate:0};
}
// Cents, rounded the way a price reads: under 1¢ shows as <1¢. A quote is an estimate, so it reads ~39¢; the cloud
// stops a solve at CLOUD_CAP times its quote (tools/cloud/modal_app.py), and a finished one shows what it really cost.
const CLOUD_CAP=1.5;
function quoteText(dollars){const t=centsText(dollars);return t[0]==='<'?t:'~'+t;}
function centsText(dollars){const c=dollars*100;return c<1?'<1¢':c<10?(Math.round(c*10)/10)+'¢':c<100?Math.round(c)+'¢':'$'+(dollars).toFixed(2);}
function planCost(plan,factor=1){return plan.rate>0?(plan.solve*factor+(plan.boot||0))/3600*plan.rate:0;}
// What your cloud solves cost this calendar month, from the jobs synced to this account.
function cloudSpendThisMonth(){const d=new Date(),from=new Date(d.getFullYear(),d.getMonth(),1).getTime();let s=0;for(const j of spotUI.jobs?.values()||[])if(j.cost>0&&(j.startedAt||j.createdAt||0)>=from)s+=j.cost;return s;}
function solveTimes(){try{return JSON.parse(localStorage.getItem('range-lab-solve-times')||'{}')||{}}catch{return{}}}
// v2: the trees with a small bet, a big bet and an overbet (learned ratios from the one-size trees no longer apply).
// v3 for on-device rivers: the faster river engine (the learned ratios from the old one would read 10x too slow).
function solveTimeKey(plan){return(plan.target&&plan.target!=='mac'?plan.target+(plan.big?'-big':''):plan.route)+'-'+plan.street+(plan.kind&&plan.kind!=='nlh'?'-'+plan.kind:plan.route==='river'?'-v3':'-v2');}
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
// You can pick the Mac or the cloud whenever both could take the solve; the pick lasts for this visit (spotUI.where).
// A Mac that's asleep or closed stops beating, so it's away once it misses two beats: a bridge that says how often it
// beats ('beat', every minute since this was added) is away after two of them plus 30 s; an older one, which beats
// every 3 minutes, after 4.5 minutes.
function macFreshMs(m=spotUI.mac){return m?.beat>0?Math.min(MAC_OFFLINE_MS,2*m.beat+30000):4.5*60000;}
function macOnline(m=spotUI.mac){return!!m?.seen&&Date.now()-m.seen<macFreshMs(m);}
// Before offering your Mac, check it's still there: sync now if the last look is over 30 s old (opening the app and
// coming back to it sync too). Its answer re-renders the solve choice.
function freshenMac(){const now=Date.now();if(typeof citrusAccount==='undefined'||!citrusAccount.user||!spotUI.mac?.seen||now-(spotUI.macChecked||0)<30000)return;spotUI.macChecked=now;try{citrusAccount.run();}catch{}}
// The Mac can go to sleep while nothing syncs, so every 15 s the solve choice is redrawn if it went away or came
// back, and solves this device left waiting on a Mac that went to sleep move to the cloud.
spotUI.macWas=null;setInterval(()=>{if(document.visibilityState==='hidden')return;const on=macOnline();if(spotUI.macWas!==null&&on!==spotUI.macWas){spotUI.last=null;if(typeof renderPlay==='function'&&state.hand)renderPlay();}spotUI.macWas=on;rescueMacJobs();},15000);
function spotPlan(hand,where=spotUI.where){
 if(!hand||hand.done)return null;
 const c=hand.config,live=hand.living(),simple=!c.rules.low&&!c.bounties.some(x=>x>0),small=typeof smallMemoryDevice==='function'&&smallMemoryDevice();
 const pre=hand.street===0;
 if(pre&&(!simple||c.variant!=='NLH'))return{route:'none',street:0,reason:'No chart covers this preflop line yet, and only no-limit hold\'em preflop lines can be solved.'};
 if(pre&&preflopFlopPlayers(hand)>3)return{route:'none',street:0,reason:'No chart covers this preflop line, and it can reach the flop four or more ways, which can\'t be solved yet.'};
 if(!simple||!['NLH','PLO4'].includes(c.variant))return{route:'none',street:hand.street,reason:'This game type can\'t be solved yet.'};
 const bridge=localBridge.up===true&&!!$('spotLocalSolver')?.value,kind=pre?'preflop':live.length===3&&c.variant==='NLH'?'mw3':live.length>2?'multiway':c.variant==='PLO4'?'plo':'nlh';let plan;
 // Heads-up hold'em rivers always solve on this device: a second or two, faster than a trip to your Mac or the cloud,
 // and with more raise sizes than TexasSolver's river tree. PLO rivers solve here only on a computer without the bridge.
 if(kind==='nlh'&&hand.street===3)plan={route:'river',seed:(small?3:2)*deviceSlowdown(),wait:0};
 else if(kind==='plo'&&hand.street===3&&!bridge&&!small)plan={route:'plo-river',seed:40*deviceSlowdown(),wait:0};
 else{
  const three=pre&&preflopFlopPlayers(hand)===3?1:0,dest=bridge?{target:'mac',threads:localBridge.threads,load:localBridge.load,rate:0}:solveTarget(three>0,where),mac=dest,load=Math.min(1,Math.max(0,Number(mac?.load)||0)),scale=Math.min(4,Math.max(1,Math.pow(11/Math.max(1,mac?.threads||10),.8)))*(1+load);
  const start=hand.pot-hand.streetPaid.reduce((s,x)=>s+x,0),spr=Math.min(...live.map(i=>hand.stacks[i]+hand.streetPaid[i]))/Math.max(1,start),flop=1.3*(spr<7?32:spr<30&&c.seats>2?220:600);
  const base=pre?preflopSeconds(hand,three,dest.big?CLOUD_SOLVER.big:null):kind==='mw3'?(hand.street===1&&PokerLocalSolver.mwFlopLeads(hand.actionLog,live,hand.actor)?MW3_LEADS_SECONDS:MW3_SECONDS[hand.street-1]):kind==='multiway'?MULTIWAY_SECONDS:kind==='plo'?(hand.street===1?PLO_FLOP_SECONDS:hand.street===2?PLO_TURN_SECONDS:RIVER_SECONDS):hand.street===1?flop:hand.street===2?TURN_SECONDS:RIVER_SECONDS;
  const learned=kind==='nlh'&&hand.street===1&&!bridge&&dest.target==='mac'&&learnedFlopReady(hand);
  plan={route:bridge?'texas':'mac',choices:!bridge&&cloudReady()&&macOnline(),target:dest.target,rate:dest.rate,boot:dest.boot||0,cloud:!!dest.cloud,big:!!dest.big,server:!!dest.server,learned,seed:learned?5:kind==='multiway'?base:base*scale,efforts:kind==='nlh'&&hand.street===1&&!learned||pre&&three>0,mayStop:kind==='multiway',wait:bridge?0:QUEUE_SECONDS+(dest.target==='mac'?queuedSeconds():dest.boot||0)};
  // Preflop solves need the bridge from PR #128: an older one is told how to update, here and in Solver settings.
  // A bridge that can update itself does it from a tap, here or on your phone; an older one shows the setup command
  // on the Mac, and the phone sends you there.
  const hb=spotUI.mac;
  if(pre&&dest.target==='mac'&&(bridge?!localBridge.preflop:hb?.seen&&!(hb.features||[]).includes('preflop'))){const u=spotUI.macUpdate,self=bridge?localBridge.update:(hb.features||[]).includes('update');
   if(u&&(u.status==='wanted'||u.status==='updating')&&Date.now()-(u.at||0)<UPDATE_MS)plan.blocked='Updating your Mac\'s solver…';
   else if(self||bridge){plan.blocked=(u?.status==='failed'?'Update failed: '+u.message+' ':'')+'Your Mac\'s solver needs an update.';plan.jump={to:self?'mac-update':'mac-setup',label:'Update'};}
   else plan.blocked='Your Mac\'s solver needs an update. Open this app on your Mac to update it.';}
  else if(!bridge&&dest.target==='mac'){freshenMac();if(!pre&&hb?.seen&&(hb.features||[]).includes('update')&&!((hb.features||[]).includes('trees')&&(kind!=='mw3'||(hb.features||[]).includes('mwtrees'))))plan.updateHint=true;const user=typeof citrusAccount!=='undefined'&&citrusAccount.user;if(!user){plan.blocked='Sign in on this device and on your Mac to send it to your Mac.';plan.jump={to:'account',label:'Sign in'};}else if(!hb?.seen)plan.note='Open the app on your Mac once, signed in, with the solver on.';else if(!macOnline(hb)){plan.blocked='Your Mac is asleep.';if(CLOUD_SOLVER.url&&!cloudSolvesOn())plan.jump={to:'cloud-solves',label:'Use the cloud'};}}
  else if(plan.choices)freshenMac();
 }
 // A flop, turn or river solve needs everyone's range, which comes from the preflop chart: a line no chart covers
 // can't be sent, so it isn't offered (the solve would only stop with that error).
// While the charts load it waits: a solve sent then could only stop with that error.
 const uncovered=!pre&&(plan.route==='mac'||plan.route==='texas')?noChartRanges(hand):false;
 if(uncovered)return{route:'none',street:hand.street,reason:'No chart covers how this hand got here, so it can\'t be solved.'};
 if(uncovered===null&&!plan.blocked)plan.blocked='Loading charts…';
 plan.street=hand.street;plan.kind=kind;Object.defineProperty(plan,'hand',{value:hand});const ratio=plan.learned?1:solveTimes()[solveTimeKey(plan)];plan.solve=plan.seed*(ratio>0?ratio:1);plan.seconds=plan.solve+plan.wait;return plan;
}
// True only when charts are loaded, you typed no ranges and none of them covers this hand's preflop line.
const chartLineMemo=new WeakMap();
// null while the charts are still loading: whether one covers the line isn't known yet.
function noChartRanges(hand){
 if(($('spotRangeMode')?.value||'auto')!=='auto'||spotUI.rangeValues.some(x=>String(x||'').trim()))return false;if(typeof chartsLoading==='function'&&chartsLoading())return null;if(!preflopLibrary.packs.length)return false;
 const pre=hand.actionLog.filter(a=>a.street===0).length,m=chartLineMemo.get(hand);if(m&&m.pre===pre)return m.none;
 let none=true;try{none=!PokerPreflop.postflopRanges(preflopLibrary.packs,hand.config,observedData(hand).actions);}catch{}
 chartLineMemo.set(hand,{pre,none});return none;}
// How many players you can see the flop with from a preflop spot. In the solver's tree nobody else joins a raised pot
// by calling, so a raised pot you call has the players already in it plus you; an unraised one also the big blind.
function preflopFlopPlayers(hand){const n=hand.n,bb=(hand.button+(n===2?1:2))%n,pre=hand.actionLog.filter(a=>a.street===0),raised=pre.some(a=>a.kind==='raise'||a.kind==='bet'),vol=new Set(pre.filter(a=>['call','raise','bet'].includes(a.kind)&&!hand.folded[a.seat]&&a.seat!==hand.actor).map(a=>a.seat));return vol.size+1+(!raised&&!hand.folded[bb]&&bb!==hand.actor&&!vol.has(bb)?1:0);}
// Mac seconds before thread scaling (see the notes above spotPlan); the effort factor scales the flops. big: the big
// cloud machine, which solves 8 of the 40 flops at once on 8 threads each (about 12 s a flop overall; a 3-bet pot's
// flop took 55 s on 4 Linux threads) and runs the single-threaded passes at about 0.7x the Mac estimate.
function preflopSeconds(hand,three,big=null){const n=hand.n,its=three?1100:800,pass=its*(n===2?.01:.075*n);return big?pass*big.pass+three*40*big.flop:pass+three*40*150;}
// One line for a spot with no solve: what the solve button says instead.
function unsolvableReason(hand){const plan=spotPlan(hand);return plan?.route==='none'?plan.reason:plan?.blocked||'';}
// The number and its unit never split across lines.
// Times are estimates, so they read ~15 min.
function solveTimeText(seconds){return seconds<60?'~'+Math.max(5,Math.round(seconds/5)*5)+'\u00a0sec':seconds<5400?'~'+Math.round(seconds/60)+'\u00a0min':seconds<172800?'~'+Math.round(seconds/3600)+'\u00a0h':'~'+Math.round(seconds/86400)+'\u00a0days';}
function planTimeText(plan,factor=1){const text=solveTimeText(plan.solve*factor+plan.wait),t=plan.mayStop?text.replace('~','up to '):text;return plan.rate>0?t+' · '+quoteText(planCost(plan,factor)):plan.server?t+' · free':t;}
function planPlace(plan){return onDeviceRoute(plan)?'on this device':plan.cloud?'in the cloud':plan.server?'on your server':'on your Mac';}
function jobPlace(j){return j.target==='modal'?'The cloud':j.target&&j.target!=='mac'?'Your server':'Your Mac';}
// A spot whose answer is already stored (preflop chart or flop library) needs no solve.
// A stand-in flop does not count once your Mac has learned the real one.
function spotReferenceReady(hand){if(!hand||hand.done)return false;try{if(preflopReference(hand)||hand.street===0&&learnedPreflop(hand))return true;if(hand.street===0){noteMissingPreflop(hand);return false;}if(treeReference(hand))return true;const r=postflopLibraryReference(hand);return !!r&&!(r.solve?.library?.standIn&&learnedFlopReady(hand));}catch{return false;}}
// The solve button, offered on every live spot: references show at once and a short solve starts; otherwise it
// says where the solve runs and how long it takes (with an effort choice on heads-up NLH flops, where the extra
// time buys a measurably closer solution), or in one line why this spot can't be solved.
function solveSpotClick(skipReference=false){
 const h=state.hand;if(!h||h.done||state.busy)return;hideSolveConfirm();const plan=spotPlan(h),job=spotJob(h);
 if(!skipReference&&spotReferenceReady(h)){analyzeSpot(h,{kind:'inspect',expectReference:true});return;}if(!plan){analyzeSpot(h,{kind:'inspect'});return;}
 if(job?.status==='done'){deliverSolveJob(true);return;}
 const box=$('spotConfirm');if(!box)return;
 const show=()=>{box.classList.remove('hide');box.querySelectorAll('[data-solve-effort]').forEach(b=>b.onclick=()=>{hideSolveConfirm();const p=b.dataset.where?spotPlan(h,b.dataset.where):plan;if(state.hand===h&&!h.done&&p&&!p.blocked)analyzeSpot(h,{kind:'inspect',plan:p,effort:b.dataset.solveEffort});});box.querySelectorAll('[data-solve-where]').forEach(b=>b.onclick=()=>{spotUI.where=b.dataset.solveWhere;solveSpotClick(skipReference);});box.querySelector('[data-solve-cancel]').onclick=hideSolveConfirm;};
 const block=job&&(jobPending(job)||job.status==='done')?jobText(job):plan.route==='none'?plan.reason:plan.blocked;
 if(block){box.innerHTML='<p>'+esc(block)+'</p><div class="row"><button type="button" class="btn secondary" data-solve-cancel>OK</button></div>';show();return;}
 if(!plan.efforts&&plan.seconds<=10&&!plan.note&&!plan.choices){analyzeSpot(h,{kind:'inspect',plan});return;}
 const note=(plan.note?'<p class="small muted">'+esc(plan.note)+'</p>':'')+(plan.mayStop?'<p class="small muted">May stop without an answer.</p>':'');
 box.innerHTML=plan.efforts?(plan.choices?solveWhereHTML(h,plan):'<p><strong>Solve '+planPlace(plan)+'</strong></p>')+note+'<div class="row">'+Object.entries(SOLVE_EFFORTS).map(([id,e])=>'<button type="button" class="btn'+(id==='standard'?'':' secondary')+'" data-solve-effort="'+id+'">'+e.label+' · '+planTimeText(plan,e.factor)+'</button>').join('')+'<button type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>':(plan.choices?'<p><strong>Solve</strong></p>'+note+'<div class="row">'+solveChoices(h,plan).map(([w,p])=>'<button type="button" class="btn'+(w==='mac'?' secondary':'')+'" data-solve-effort="standard" data-where="'+w+'">'+(w==='cloud'?'Cloud':'Mac')+' · '+planTimeText(p)+'</button>').join('')+'<button':'<p><strong>Solve '+planPlace(plan)+'</strong> · '+planTimeText(plan)+'</p>'+note+'<div class="row"><button type="button" class="btn" data-solve-effort="standard">Solve</button><button')+' type="button" class="btn secondary" data-solve-cancel>Cancel</button></div>';
 show();
}
// The solve choice shown straight in the analysis panel when the spot has no stored answer and the solve isn't instant:
// where it runs and how long, with one button per effort.
// Both places with their time and price at the effort shown (Standard), Mac first.
function solveChoices(hand,plan){const other=spotPlan(hand,plan.cloud?'mac':'cloud'),cloud=plan.cloud?plan:other,mac=plan.cloud?other:plan;return[['mac',mac],['cloud',cloud]];}
// The Mac/Cloud switch above effort buttons: the one picked is pressed, and the efforts below are for it.
function solveWhereHTML(hand,plan){return'<div class="solve-where" role="group" aria-label="Where to solve">'+solveChoices(hand,plan).map(([w,p])=>'<button type="button" class="solve-where-pick'+((w==='cloud')===!!plan.cloud?' on':'')+'" aria-pressed="'+((w==='cloud')===!!plan.cloud)+'" data-solve-where="'+w+'"><span>'+(w==='cloud'?'Cloud':'Mac')+'</span><span>'+planTimeText(p)+'</span></button>').join('')+'</div>';}
// A Mac bridge from before PR #246 answers only the decision it was sent, so it is offered an update.
function updateHintHTML(plan){return plan?.updateHint&&!plan.cloud?'<p class="small muted"><button type="button" class="ui-jump" data-jump="mac-update">Update your Mac</button> so the rest of the hand reuses its solve.</p>':'';}
function solvePromptHTML(plan,full=false){const off=(state.busy?' disabled':'')+(full?' data-full-tree':''),time=f=>planTimeText(plan,f),h=plan.hand||state.hand;
 if(plan.choices&&!plan.efforts)return'<div class="solve-inline">'+solveChoices(h,plan).map(([w,p])=>'<button type="button" class="btn solve-cta'+(w==='mac'?' secondary':'')+'" data-inline-solve="standard" data-where="'+w+'"'+off+'><span>Solve '+planPlace(p)+'</span><span>'+planTimeText(p)+'</span></button>').join('')+updateHintHTML(solveChoices(h,plan)[0][1])+'</div>';
 return'<div class="solve-inline">'+(plan.choices?solveWhereHTML(h,plan):'')+(plan.efforts?'<div class="solve-efforts">'+Object.entries(SOLVE_EFFORTS).map(([id,e])=>'<button type="button" class="btn solve-cta'+(id==='standard'?'':' secondary')+'" data-inline-solve="'+id+'"'+off+'><span>'+e.label+'</span><span>'+time(e.factor)+'</span></button>').join('')+'</div>':'<button type="button" class="btn solve-cta" data-inline-solve="standard"'+off+'><span>Solve '+planPlace(plan)+'</span><span>'+time(1)+'</span></button>')+(plan.note?'<p class="small muted">'+esc(plan.note)+'</p>':'')+updateHintHTML(plan)+'</div>';}
document.addEventListener('click',event=>{const b=event.target.closest('[data-inline-solve]');if(!b)return;const h=state.hand;if(!h||h.done||state.busy)return;const plan=spotPlan(h,b.dataset.where||spotUI.where);if(plan&&!plan.blocked&&plan.route!=='none')analyzeSpot(h,{kind:'inspect',plan,effort:b.dataset.inlineSolve,fullTree:b.hasAttribute('data-full-tree')});});
document.addEventListener('click',event=>{const b=event.target.closest('.solve-inline [data-solve-where]');if(!b)return;spotUI.where=b.dataset.solveWhere;spotUI.last=null;if(state.hand)renderPlay();});
function hideSolveConfirm(){const box=$('spotConfirm');if(box){box.classList.add('hide');box.innerHTML='';}}
// Solves sent to the Mac. Each is a 'solvejob-<hash>' meta row that syncs through the account: the Mac's bridge
// marks it running, then done (writing the answer as the saved spot rowId) or failed. 'macsolver' is the
// bridge's heartbeat: when it was last seen, its threads and how busy the Mac is.
spotUI.jobs=new Map();spotUI.mac=null;spotUI.servers=new Map();spotUI.gradeWaits=new Map();spotUI.jobTimer=0;spotUI.macUpdate=null;
// Updating the Mac's solver: straight to the bridge on the Mac itself, else a 'macupdate' row it picks up within the sync time.
const UPDATE_MS=10*60e3;
async function updateMacSolver(){const at=Date.now(),url=$('spotLocalSolver')?.value;
 if(localBridge.up&&url){try{const r=await fetch(url.replace(/\/$/,'')+'/update',{method:'POST'}),b=await r.json().catch(()=>({}));spotUI.macUpdate=r.ok?{status:'updating',at}:{status:'failed',at,message:b.error||'Error '+r.status+'.'};}catch(e){spotUI.macUpdate={status:'failed',at,message:e.message};}
  if(spotUI.macUpdate.status==='updating')setTimeout(()=>checkLocalBridge().then(()=>{if(localBridge.preflop)spotUI.macUpdate=null;if(state.hand)renderPlay();}),90e3);}
 else{spotUI.macUpdate={status:'wanted',at};try{await dbPut('meta',{id:'macupdate',value:spotUI.macUpdate});}catch{}citrusAccount.run();watchSolveJobs();}
 spotUI.last=null;if(state.hand)renderPlay();}
async function loadSolveJobs(){try{const rows=await dbAll('meta');const before=spotUI.jobs;spotUI.jobs=new Map(rows.filter(r=>/^solvejob-/.test(r.id)&&r.value&&typeof r.value==='object').map(r=>[r.id,r.value]));traceJobChanges(before,spotUI.jobs);spotUI.wants=new Map(rows.filter(r=>/^flopwant-/.test(r.id)&&r.value&&typeof r.value==='object').map(r=>[r.id,r.value]));spotUI.preflopWants=new Map(rows.filter(r=>/^preflopwant-/.test(r.id)&&r.value&&typeof r.value==='object').map(r=>[r.id,r.value]));const learned=[...spotUI.wants.values()].filter(w=>w.status==='done').length;if(localBridge.up&&learned>spotUI.learned)checkLocalBridge();spotUI.learned=learned;const mac=rows.find(r=>r.id==='macsolver')?.value;spotUI.mac=mac&&typeof mac==='object'?mac:null;spotUI.servers=new Map(rows.filter(r=>/^solver-[a-z0-9-]+$/.test(r.id)&&r.value&&typeof r.value==='object'&&r.value.name).map(r=>[r.id,r.value]));const up=rows.find(r=>r.id==='macupdate')?.value;if(up&&typeof up==='object'&&(up.at||0)>=(spotUI.macUpdate?.at||0))spotUI.macUpdate=up;
  // Done once the Mac's heartbeat shows the new solver.
  if(spotUI.macUpdate&&(spotUI.mac?.features||[]).includes('preflop')&&(spotUI.mac.seen||0)>(spotUI.macUpdate.at||0))spotUI.macUpdate=null;rescueMacJobs();}catch{}watchSolveJobs();}
// The latest solve sent for this spot. A cancelled one counts as none: you already know, and Solve this spot is offered again.
function spotJob(hand){if(!hand||hand.done||!spotUI.jobs.size)return null;const key=PokerSpot.publicKey(observedData(hand));let found=null;for(const j of spotUI.jobs.values())if(j.baseKey===key&&(!found||j.createdAt>found.createdAt))found=j;return found?.status==='cancelled'?null:found;}
function jobPending(j){return j.status==='queued'||j.status==='running';}
// A heads-up flop or turn solve keeps its street's whole tree (PokerLocalSolver.streetTree): a later decision on
// that street reads it instead of solving again, and the next street's solve starts from the ranges the played line
// leaves. Trees are kept in memory by hand line (the earlier streets, the board, whose decision and their cards); a
// Mac or cloud answer is read back from this device's saved answers once its job is done.
spotUI.trees=new Map();spotUI.treeWaits=[];spotUI.treeRows=new Set();spotUI.treeMemo=new WeakMap();
function treeKey(o,street){return JSON.stringify([o.config,o.board.slice(0,street+2),o.actions.filter(a=>a.street<street).map(a=>[a.seat,a.street,a.kind,a.target||0]),o.actor,(o.heroCards||[]).slice().sort((a,b)=>a-b)]);}
function rememberTree(result,observed){if(!result?.solve?.tree||!(observed?.board?.length>=3))return;spotUI.trees.set(treeKey(observed,observed.board.length-2),result);while(spotUI.trees.size>12)spotUI.trees.delete(spotUI.trees.keys().next().value);}
function treeReference(hand){
 if(!hand||hand.done||hand.street<1||!spotUI.trees.size||typeof PokerLocalSolver==='undefined')return null;const memo=spotUI.treeMemo.get(hand),at=hand.actionLog.length+'|'+hand.actor+'|'+spotUI.trees.size;if(memo?.at===at)return memo.r;
 let r=null;const o=observedData(hand),saved=spotUI.trees.get(treeKey(o,hand.street));if(saved)try{r=PokerLocalSolver.treeAnswer(saved,o,hand);}catch{r=null;}spotUI.treeMemo.set(hand,{at,r});return r;}
function treeRanges(hand){if(!hand||hand.street<2||typeof PokerLocalSolver==='undefined')return null;const o=observedData(hand),saved=spotUI.trees.get(treeKey(o,hand.street-1));if(!saved)return null;try{const ranges=PokerLocalSolver.treeCarry(saved,o,{seat:hand.actor,cards:hand.holes[hand.actor]});return ranges?{ranges,origin:'The '+['flop','turn'][hand.street-2]+' solve\'s ranges, narrowed by each player\'s '+['flop','turn'][hand.street-2]+' actions with the solved frequencies'}:null;}catch{return null;}}
const sameAction=(a,b)=>a&&b&&a.seat===b.seat&&a.street===b.street&&a.kind===b.kind&&(a.target||0)===(b.target||0);
// A solve job sent earlier on this hand's line (its board and actions start this hand's).
function jobOnLine(j,hand){const o=j?.observed;return !!(o?.board&&hand&&!hand.done&&Array.isArray(o.actions)&&o.board.length<=hand.board.length&&o.actions.length<=hand.actionLog.length&&o.board.every((c,i)=>c===hand.board[i])&&o.actions.every((a,i)=>sameAction(a,hand.actionLog[i])));}
// Once you've sent one decision of a hand to your Mac or the cloud, the rest of that hand solves there without
// asking: a later decision the kept tree can't answer (the next street, or a size off the tree) goes to the same
// place by itself. The plan for that, or null.
function followUpPlan(hand){
 if(!hand||hand.done||hand.street<1||spotJob(hand))return null;const me=deviceId();let last=null;
 for(const j of spotUI.jobs.values())if(j.device===me&&j.status!=='cancelled'&&j.status!=='failed'&&jobOnLine(j,hand)&&(!last||(j.createdAt||0)>(last.createdAt||0)))last=j;
 if(!last||lineJob(hand))return null;const plan=spotPlan(hand,last.target==='modal'?'cloud':'mac');if(!plan||plan.blocked||plan.route!=='mac')return null;
 return plan;
}
// A solve still running for an earlier decision of this street on this hand's line: its tree answers this decision
// when it lands, so nothing is sent again in the meantime.
function lineJob(hand){if(!hand||hand.done||hand.street<1)return null;let found=null;for(const j of spotUI.jobs.values())if(jobPending(j)&&j.observed?.board?.length===hand.board.length&&jobOnLine(j,hand)&&(!found||(j.createdAt||0)>(found.createdAt||0)))found=j;return found;}
// Reads the saved answers of done Mac and cloud solves from earlier in this hand (each once), for their trees.
async function loadHandTrees(hand){
 if(!hand||hand.done||hand.street<1)return false;let added=false;
 for(const j of spotUI.jobs.values()){const o=j.observed;if(j.status!=='done'||!o?.board||o.board.length<3||spotUI.treeRows.has(j.rowId)||!jobOnLine(j,hand))continue;
  let row=null;try{const db=await openDB();row=await new Promise((resolve,reject)=>{const r=db.transaction('solves').objectStore('solves').get(j.rowId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{}
  if(row?.key!==j.key)continue;spotUI.treeRows.add(j.rowId);if(row.result?.solve?.tree){rememberTree(row.result,o);added=true;}}
 return added;
}
// Decisions you acted on while their street's solve was still running (analyzeSpot): graded from its tree once it lands
// (or not at all if it was cancelled or failed).
function releaseTreeWaits(){const ready=spotUI.treeWaits.filter(t=>!lineJob(t.hand));if(!ready.length)return;spotUI.treeWaits=spotUI.treeWaits.filter(t=>!ready.includes(t));for(const t of ready)state.gradeQueue.push(t);if(typeof pumpGrades==='function')pumpGrades();}
// This device's id, so it cancels only the solves it sent.
// Hand traces (hand-trace.js): this device's jobs' status changes as they arrive from the account, and the reasons a
// finished solve was not shown (each once per job).
function traceJobChanges(before,after){if(!spotUI.traceJobsReady){spotUI.traceJobsReady=true;return;}const me=deviceId();for(const [id,j] of after){const old=before.get(id);if(!j.hand||j.device!==me||old&&old.status===j.status&&old.target===j.target)continue;HandTrace.log(j.hand,'job',{job:id.slice(9),status:j.status,was:old?.status||null,target:j.target,by:j.server||j.solver||null,message:j.message||null,seconds:j.finishedAt>j.startedAt?(j.finishedAt-j.startedAt)/1000:null,cost:j.cost??null,spot:HandTrace.spot(j.baseKey)});}}
function traceDeliverSkip(h,j,reason){const k=j.rowId+'|'+reason;spotUI.deliverSkips=spotUI.deliverSkips||new Set();if(spotUI.deliverSkips.has(k))return;spotUI.deliverSkips.add(k);HandTrace.log(h,'finished job not shown',{job:j.rowId.slice(5),reason,spot:HandTrace.spot(j.baseKey)});}
function deviceId(){try{let id=localStorage.getItem('citrus-device-id');if(!id){id=Math.random().toString(36).slice(2,12);localStorage.setItem('citrus-device-id',id);}return id;}catch{return'';}}
// Cancelling marks the job; the Mac stops it at its next progress check (within about 10 seconds) or skips it.
async function cancelSolveJob(id,reason='tapped cancel'){const j=spotUI.jobs.get(id);if(!j||!jobPending(j))return;HandTrace.log(j.hand,'cancel',{job:id.slice(9),reason,was:j.status});const value={...j,status:'cancelled',cancelledAt:Date.now()};spotUI.jobs.set(id,value);try{await dbPut('meta',{id,value});}catch{}citrusAccount.run();watchSolveJobs();if(state.hand)renderPlay();}
// A solve this device sent stops once you act or the hand ends: its answer would be for a decision already made. With
// Record an assessment on, it keeps going instead: its answer grades the decision you made (gradeFromJobs).
// Not before the saved hand is back after a reload: until then the table holds a placeholder deal.
// A solve you acted before keeps running only while it can still answer a decision of yours: you're in the hand and
// it is still that solve's street. Folding, the next street or the end of the hand cancels it (Maxam, 2026-11-08).
// Each table cancels only its own solves (Play, or Solve's own table); Hand replay solves are never cancelled here.
function solveTable(){return typeof studioInterface!=='undefined'&&studioInterface.tab==='solve'?'solve':'play';}
function cancelStaleSolveJobs(){if(!liveSession.ready)return;const me=deviceId(),h=state.hand,table=solveTable();let key=null;for(const [id,j] of spotUI.jobs){if(!jobPending(j)||j.device!==me||(j.table||'play')!==table)continue;if(key===null)key=h&&!h.done?PokerSpot.publicKey(observedData(h)):'';if(j.baseKey===key)continue;
 // A solve you tapped and then acted before keeps running: it grades that decision when it lands (gradeFromJobs).
 // Automatic follow-up solves still stop, so nothing runs that nobody asked for.
 if(!j.auto&&(spotUI.gradeWaits.has(j.baseKey)||$('gradeEvery')?.checked&&h&&j.hand===h.dealId&&h.actionLog[j.observed?.actions?.length]?.seat===state.hero))continue;
 const live=!!h&&!h.done&&!(state.hero>=0&&h.folded[state.hero])&&j.observed?.board?.length===h.board.length&&jobOnLine(j,h);if(!live)cancelSolveJob(id,!h||h.done?'hand over':state.hero>=0&&h.folded[state.hero]?'you folded':j.observed?.board?.length!==h.board.length?'street moved on':'off this line');}}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cancel-job]');if(b){e.preventDefault();cancelSolveJob(b.dataset.cancelJob);}});
function queuedSeconds(){let s=0;const now=Date.now();for(const j of spotUI.jobs.values())if(jobPending(j))s+=Math.max(0,(j.seconds||0)-(j.status==='running'?(now-(j.startedAt||now))/1000:0));return s;}
// Where a Mac solve stands, in one line, with a progress bar while it runs. A running solve's progress comes from
// the Mac every 10 seconds (tools/local-solver/queue.cjs, progressOf); between reports it counts down locally.
function agoText(ms){const m=Math.round(ms/60000);return m<1?'just now':m<90?m+'\u00a0min ago':Math.round(m/60)+'\u00a0h ago';}
// Two minutes without a report (or, before the first one, since the Mac marked it running) reads as stopped.
// Between reports the bar keeps moving at the reported rate, and it never steps back when a new report is lower.
spotUI.shownProgress=new Map();
function jobProgress(j){const g=j.progress,now=Date.now();if(!g?.at){const left=Math.max(0,(j.seconds||0)-(now-(j.startedAt||now))/1000);return{phase:'starting',p:0,left,stale:j.startedAt>0&&now-j.startedAt>120000,at:j.startedAt};}const left=Math.max(0,g.remaining-(now-g.at)/1000),raw=g.remaining>0?1-(1-g.p)*left/g.remaining:g.p,run=j.rowId+' '+j.startedAt,p=Math.min(.99,Math.max(raw,spotUI.shownProgress.get(run)||0));spotUI.shownProgress.set(run,p);return{phase:g.phase,p,left:(1-p)*left/Math.max(.01,1-raw),stale:now-g.at>120000,at:g.at};}
function jobState(j){
 const where=jobPlace(j),cost=j.cost>0?' · '+centsText(j.cost):'';
 if(j.status==='failed')return{text:j.capped?where+' stopped at its price cap'+(j.cost>0?' ('+centsText(j.cost)+')':'')+' before it had an answer.':where+' could not solve this. '+(j.message||'')+(j.cost>0?' ('+centsText(j.cost)+')':'')};if(j.status==='cancelled')return{text:'Solve cancelled.'};if(j.status==='done')return{text:'Solved.'};
 if(j.status==='running'){const g=jobProgress(j);if(g.stale)return{text:where+' stopped reporting progress ('+agoText(Date.now()-g.at)+').'+(where==='Your Mac'?' It may be asleep.':''),p:g.p};
  return g.phase==='preparing'?{text:'Preparing ranges…',label:'Preparing',time:cost.slice(3),p:g.p}:{text:'Solving · '+Math.floor(g.p*100)+'% · '+(g.left>=5?solveTimeText(g.left)+' left':'almost done')+cost,label:'Solving '+Math.floor(g.p*100)+'%',time:(g.left>=5?solveTimeText(g.left):'almost done')+cost,p:g.p};}
 const sync=typeof citrusAccount!=='undefined'?citrusAccount.status:'',mac=spotUI.mac;
 if(['offline','off','expired','signedOut'].includes(sync))return{text:'Not sent yet: this device can\'t reach your account. It sends when the connection is back.'};
 // A cloud container reports within a minute or two of the tap; one that hasn't after CLOUD_STUCK_MS likely never started.
 if(j.target==='modal'){const waited=Date.now()-(j.createdAt||Date.now());if(waited>CLOUD_STUCK_MS)return{text:'The cloud hasn\'t started ('+agoText(waited).replace(' ago','')+').',retry:true};return{text:'Starting in the cloud',label:'Starting in the cloud',time:(j.estimate>0?quoteText(j.estimate):''),p:0,queued:true};}
 if(j.target&&j.target!=='mac'){const s=spotUI.servers.get('solver-'+j.target);if(!s?.seen||Date.now()-s.seen>SERVER_OFFLINE_MS)return{text:'Waiting for your server'+(s?.seen?' · last seen '+agoText(Date.now()-s.seen):'')};return{text:'Queued on your server',label:'Queued',time:'',p:0,queued:true};}
 if(!mac?.seen)return{text:'Waiting for your Mac. It hasn\'t connected yet: open the app on your Mac, signed in, with Solver on your Mac turned on.'};
 if(!macOnline(mac))return{text:'Waiting for your Mac · asleep since '+agoText(Date.now()-mac.seen)};
 const wait=solveTimeText(Math.max(0,queuedSeconds()-Math.max(0,j.seconds||0))+(j.seconds||60));return{text:'Queued · '+wait,label:'Queued',time:wait,p:0,queued:true};
}
function jobText(j){return jobState(j).text;}
// A pending solve takes the Solve button's place (.solve-job hides #analyze): the bar fills as it runs, ✕ cancels,
// striped while queued. Anything that needs words (waiting for the Mac, no progress reports) stays a notice.
// A solve still queued for your Mac can go to the cloud instead: the same row, now for the cloud.
// A running one can too once your Mac has gone to sleep: the Mac drops it when it wakes (queue.cjs).
function canMoveToCloud(j){return(j.status==='queued'||j.status==='running'&&!macOnline())&&(j.target||'mac')==='mac'&&(j.kind!=='preflop'||(j.seconds||0)<1800)&&cloudReady();}
// Solves this device sent to a Mac that has since gone to sleep go to the cloud by themselves.
function rescueMacJobs(){if(!spotUI.mac?.seen||macOnline())return;const me=deviceId();for(const [id,j] of spotUI.jobs)if(jobPending(j)&&j.device===me&&canMoveToCloud(j)){HandTrace.log(j.hand,'mac asleep',{job:id.slice(9),was:j.status,seen:spotUI.mac.seen});moveJobToCloud(id);}}
function cloudMoveSeconds(j){return Math.max(5,j.seconds||60)+CLOUD_SOLVER.boot;}
async function moveJobToCloud(id){const j=spotUI.jobs.get(id);if(!j||!canMoveToCloud(j))return;const estimate=Math.round(cloudMoveSeconds(j)/3600*CLOUD_SOLVER.rate*1e5)/1e5;
 const {progress:_p,startedAt:_s,worker:_w,...rest}=j,value={...rest,status:'queued',target:'modal',rate:CLOUD_SOLVER.rate,estimate,cap:Math.round(estimate*CLOUD_CAP*1e5)/1e5,createdAt:Date.now()};HandTrace.log(j.hand,'move to cloud',{job:id.slice(9),was:j.status});await dbPut('meta',{id,value});const t=Date.now();spotUI.jobs.set(id,value);citrusAccount.run();watchSolveJobs();startCloudSolve(id,value,t);if(state.hand)renderPlay();}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cloud-job]');if(b){e.preventDefault();moveJobToCloud(b.dataset.cloudJob);}});
async function retryCloudJob(id){const j=spotUI.jobs.get(id);if(!j||!jobPending(j)||j.target!=='modal')return;HandTrace.log(j.hand,'cloud retry',{job:id.slice(9)});const value={...j,createdAt:Date.now()};await dbPut('meta',{id,value});const t=Date.now();spotUI.jobs.set(id,value);citrusAccount.run();watchSolveJobs();startCloudSolve(id,value,t);if(state.hand)renderPlay();}
document.addEventListener('click',e=>{const b=e.target.closest?.('[data-cloud-retry]');if(b){e.preventDefault();retryCloudJob(b.dataset.cloudRetry);}});
function jobNoticeHTML(j){const bar=jobBarHTML(j),st=jobState(j);if(st.retry){const id='solvejob-'+hash(j.key);return'<div class="solve-job-stack" id="solveJobNotice">'+bar.replace(' id="solveJobNotice"','')+'<button type="button" class="btn solve-cta" data-cloud-retry="'+esc(id)+'"><span>Try the cloud again</span><span></span></button></div>';}return bar;}
function jobBarHTML(j){const st=jobState(j),id='solvejob-'+hash(j.key),cancel=label=>'<button type="button" class="'+(label?'ui-text-button solve-cancel':'solve-job-x')+'" data-cancel-job="'+esc(id)+'" aria-label="Cancel solve">'+(label||'✕')+'</button>';
 if(jobPending(j)&&st.label)return'<div class="solve-job'+(st.queued?' queued':'')+'" id="solveJobNotice" role="progressbar" aria-label="'+esc(st.text)+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.floor(st.p*100)+'"><div class="solve-job-fill" style="width:'+(st.queued?100:Math.max(2,Math.min(100,st.p*100))).toFixed(1)+'%"></div><span>'+esc(st.label)+'</span><span>'+esc(st.time)+'</span>'+cancel()+'</div>';
 return'<div class="notice'+(jobPending(j)?' solve-job-wait':'')+'" id="solveJobNotice">'+(jobPending(j)?cancel('Cancel'):'')+esc(st.text)+(st.p!==undefined?'<div class="solve-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.floor(st.p*100)+'"><div style="width:'+Math.max(2,Math.min(100,st.p*100)).toFixed(1)+'%"></div></div>':'')+'</div>';}
setInterval(()=>{const el=$('solveJobNotice');if(!el||document.visibilityState==='hidden')return;const j=spotJob(state.hand)||lineJob(state.hand);if(j&&jobPending(j))el.outerHTML=jobNoticeHTML(j);},1000);
async function sendToMac(task,observed,opts,extraAction){
 // A flop, turn or river solve needs everyone's range; a preflop line solves the whole preflop game on the Mac
 // (tools/preflop/spot.cjs) and needs none, which is exactly the line no chart covers.
 if(observed.board.length&&!opts.ranges.some(x=>String(x||'').trim()))throw Error('No chart ranges cover this line, so it can\'t be solved.');
 // A copy: observedData shares the live hand's action log and board, which keep growing after this decision.
 observed=JSON.parse(JSON.stringify(observed));
 const plan=task.plan,factor=plan.efforts?SOLVE_EFFORTS[task.effort]?.factor||1:1,id='solvejob-'+hash(task.cacheKey);
 const job={v:1,status:'queued',key:task.cacheKey,rowId:'spot-'+hash(task.cacheKey),baseKey:task.baseKey,observed,options:opts,extraAction:extraAction||null,seconds:Math.round(plan.solve*factor),seed:plan.seed*factor,device:deviceId(),hand:task.hand?.dealId||null,auto:!!task.automatic,table:task.kind==='review'?'review':solveTable(),street:plan.street,kind:plan.kind,learned:!!plan.learned,createdAt:Date.now(),target:plan.target||'mac',...plan.big?{size:'big'}:{},...plan.rate>0?{rate:plan.rate,estimate:Math.round(planCost(plan,factor)*1e5)/1e5,cap:Math.round(planCost(plan,factor)*CLOUD_CAP*1e5)/1e5}:{}};
 const prior=spotUI.jobs.get(id);HandTrace.log(task.hand,'solve',{where:job.target==='modal'?'cloud':plan.server?'server':job.target,job:id.slice(9),replaces:prior?prior.status:null,street:plan.street,kind:plan.kind,effort:task.effort||null,seconds:job.seconds,auto:!!task.automatic,background:!!task.background,inputs:task.cacheKey?hash(task.cacheKey):null,spot:HandTrace.spot(task.baseKey)});
 await dbPut('meta',{id,value:job});const t=Date.now();spotUI.jobs.set(id,job);citrusAccount.run();watchSolveJobs();
 if(job.target==='modal')startCloudSolve(id,job,t);
}
// The cloud only talks to the main accounts server. A preview build shares its database, so the same session
// works there and the answer still syncs back here.
// The cloud worker gets the job itself (it may start before this device's sync lands) with your session and this
// device's sync cursor, so it pulls only what changed since: a cancel from here. Its rows are stamped after t.
async function startCloudSolve(id,job,t){
 const link=citrusAccount.link;let error='';
 try{const r=await fetch(CLOUD_SOLVER.url.replace(/\/$/,'')+'/solve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+link.token},body:JSON.stringify({api:CLOUD_SOLVER.api||link.api,id,job,t,cursor:citrusAccount.cursor})}),b=await r.json().catch(()=>({}));if(!r.ok)error=String(b.detail||b.error||'Error '+r.status+'.');}
 catch(e){error=e?.name==='TypeError'?'No connection.':String(e?.message||e);}
 HandTrace.log(job.hand,'cloud start',{job:id.slice(9),ok:!error,error:error||null});if(!error)return;const cur=spotUI.jobs.get(id);if(!cur||!jobPending(cur))return;
 // It never started, so it's marked failed and costs nothing; Solve this spot is offered again after.
 const value={...cur,status:'failed',message:error};spotUI.jobs.set(id,value);try{await dbPut('meta',{id,value});}catch{}citrusAccount.run();if(state.hand)renderPlay();
}
// While a solve is out on the Mac, sync every 20 seconds, and every 10 while it runs, so its progress stays
// current and its answer shows soon after it lands.
function watchSolveJobs(){clearTimeout(spotUI.jobTimer);spotUI.jobTimer=0;const jobs=[...spotUI.jobs.values()],u=spotUI.macUpdate;if(!jobs.some(jobPending)&&!spotUI.awaitRow&&!(u&&(u.status==='wanted'||u.status==='updating')&&Date.now()-(u.at||0)<UPDATE_MS))return;spotUI.jobTimer=setTimeout(()=>{spotUI.jobTimer=0;if(document.visibilityState!=='hidden')citrusAccount.run();watchSolveJobs();},jobs.some(j=>j.status==='running')?10000:20000);}
// A finished Mac solve for the live spot shows as soon as it syncs in.
async function deliverSolveJob(force=false){
 const h=state.hand,j=spotJob(h),shown=activeSpotResult(h);if(!j||j.status!=='done'||!force&&spotUI.delivered===j.rowId)return;if(state.busy||shown&&shown.solve?.method!=='postflop-library'){traceDeliverSkip(h,j,state.busy?'busy':'already showing '+HandTrace.source(shown));return;}
 let row=null;try{const db=await openDB();row=await new Promise((resolve,reject)=>{const r=db.transaction('solves').objectStore('solves').get(j.rowId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{}
 // The job can sync in before its answer does: keep syncing until the answer is here, then show it.
 if(!row||row.key!==j.key){traceDeliverSkip(h,j,!row?'answer not synced yet (waiting)':'answer is for another spot (waiting)');if(spotUI.awaitRow!==j.rowId){spotUI.awaitRow=j.rowId;watchSolveJobs();}return;}
 if(spotUI.awaitRow===j.rowId)spotUI.awaitRow=null;spotUI.delivered=j.rowId;
 if(state.hand!==h||h.done||!validSpotResult(row.result)){traceDeliverSkip(h,j,state.hand!==h?'hand changed':h.done?'hand over':'answer not usable');return;}spotUI.cache.set(j.key,row.result);HandTrace.log(h,'show job',{job:j.rowId.slice(5),forced:!!force,spot:HandTrace.spot(j.baseKey),...j.rate>0?{quote:j.estimate||null,cost:j.cost||null,capped:!!j.capped}:{}});if(j.seed>0&&j.finishedAt>j.startedAt)recordSolveTime({route:'mac',target:j.target,street:j.street,kind:j.kind,seed:j.seed,learned:j.learned},(j.finishedAt-j.startedAt)/1000);
 finishAnalysis(row.result,{kind:'inspect',hand:h.clone(),baseKey:j.baseKey,cacheKey:j.key,solveOptions:j.options});
 if(typeof guessRegrade==='function')guessRegrade(h,row.result);
}
// Acting while a full-size solve of a 1/3-only library spot is out: the decision (or the guess made there, in its
// place) is graded by that solve when it lands instead of by the library.
function fullerSolveWait(hand,solved,item){if(!solved?.solve?.library?.fewerSizes||activeSpotResult(hand)!==solved)return null;const j=spotJob(hand);if(!j||!(jobPending(j)||j.status==='done'))return null;if(!item.guessed)return item;
 const at=hand.actionLog.length,g=hand.guessReveal;if(!g?.action||g.at!==at||g.regraded)return null;const old=state.currentGrades.find(r=>r.source==='guess'&&r.step===at);if(old&&old.referenceSource?.kind!=='postflop-library')return null;
 return{...item,kind:'guess',action:g.action,guessed:false,replace:old,step:at};}
// Decisions waiting on a Mac or cloud solve (see analyzeSpot) are graded once its answer syncs in. Each wait is also kept in
// localStorage (hand id, action-log step, the action or guess to grade) so closing or reloading the app before the answer
// lands doesn't lose the grade: after a reload the decision is rebuilt from the saved hand and graded into it.
const GRADE_WAITS_KEY='guava-grade-waits',GRADE_WAIT_MS=2*864e5;
function storedGradeWaits(){try{const v=JSON.parse(localStorage.getItem(GRADE_WAITS_KEY)||'[]');return Array.isArray(v)?v.filter(r=>r&&r.baseKey&&r.deal&&r.action&&Date.now()-(r.at||0)<GRADE_WAIT_MS):[];}catch{return[];}}
function writeGradeWaits(rows){try{rows.length?localStorage.setItem(GRADE_WAITS_KEY,JSON.stringify(rows.slice(-30))):localStorage.removeItem(GRADE_WAITS_KEY);}catch{}}
function keepGradeWait(key,item){const deal=item.live?.dealId||item.deal,step=item.step??item.hand?.actionLog?.length;if(!deal||!Number.isInteger(step)||!item.action)return;
 writeGradeWaits([...storedGradeWaits().filter(r=>r.baseKey!==key),{baseKey:key,deal,step,action:item.action,peeked:!!item.peeked,at:item.at||Date.now()}]);}
function dropGradeWait(key){spotUI.gradeWaits.delete(key);const rows=storedGradeWaits();if(rows.some(r=>r.baseKey===key))writeGradeWaits(rows.filter(r=>r.baseKey!==key));}
// A stored wait back as a grade item: the decision's position replayed from the saved hand. Not while that hand is still
// being played (it is graded once it is saved), and not when the decision already has its grade.
function gradeWaitItem(r){if(state.hand?.dealId===r.deal&&!state.hand.done)return undefined;const saved=state.histories.find(x=>x.id===r.deal),rec=saved?.record;if(!rec)return null;
 const hero=rec.hero??0;if((rec.grading||[]).some(g=>(g.hero===undefined||g.hero===hero)&&(g.step??g.actions?.length)===r.step))return null;
 let hand=null;try{hand=H.frames(rec,state.abstraction).find(f=>f.actionLog.length===r.step)||null;}catch{}if(!hand||hand.actor!==hero)return null;
 return{kind:'play',action:r.action,background:true,hand,live:hand,savedRow:saved,baseKey:r.baseKey,peeked:r.peeked,deal:r.deal,step:r.step,at:r.at};}
function restoreGradeWaits(){const rows=storedGradeWaits();for(const r of rows){if(spotUI.gradeWaits.has(r.baseKey))continue;const item=gradeWaitItem(r);if(item===null)dropGradeWait(r.baseKey);else if(item)spotUI.gradeWaits.set(r.baseKey,item);}if(!rows.length)writeGradeWaits([]);}
async function gradeFromJobs(){for(const [key,item] of [...spotUI.gradeWaits]){const j=[...spotUI.jobs.values()].filter(x=>x.baseKey===key).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];if(!j||j.status==='failed'||j.status==='cancelled'){HandTrace.log(item.hand||item.live||item.deal,'grade wait dropped',{job:j?j.rowId.slice(5):null,status:j?.status||'no job',action:item.action?.label||null});dropGradeWait(key);continue;}if(j.status!=='done')continue;
 let row=null;try{const db=await openDB();row=await new Promise((resolve,reject)=>{const r=db.transaction('solves').objectStore('solves').get(j.rowId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{}
 if(!row||!validSpotResult(row.result))continue;dropGradeWait(key);spotUI.cache.set(j.key,row.result);HandTrace.log(item.hand||item.live||item.deal,'grade from job',{job:j.rowId.slice(5),action:item.action?.label||null,spot:HandTrace.spot(key)});try{finishAnalysis(row.result,{...item,cacheKey:j.key,solveOptions:j.options});}catch{}}}
addEventListener('citrus-synced',()=>loadSolveJobs().then(async()=>{restoreGradeWaits();gradeFromJobs();deliverSolveJob();await loadHandTrees(state.hand).catch(()=>false);releaseTreeWaits();if(typeof renderPlay==='function'&&state.hand)renderPlay();}));
function spotSourceStamp(snapshot){return JSON.stringify([snapshot?.format,snapshot?.id,snapshot?.episodes,snapshot?.decisions,snapshot?.createdAt,snapshot?.seedState,snapshot?.config,snapshot?.abstraction]);}
function spotCacheKey(observed,options,extraAction,snapshot){const parts=['spot-v3',PokerSpot.publicKey(observed),options,extraAction],automatic=options.rangeMode==='auto'&&Array.from({length:observed.config.seats},(_,i)=>String(options.ranges[i]||'').trim()).some(text=>!text||/^auto$/i.test(text));if(automatic&&snapshot?.episodes>0&&observed.actions.length)parts.push(spotSourceStamp(snapshot));return JSON.stringify(parts);}
function validSpotResult(r){
 if(PokerPreflop.isResult(r))return true;if(r?.solve?.method==='postflop-library')return validActions(r);const q=r?.solve,tree=q?.actionTree,local=['local-texassolver','local-plo','local-multiway'].includes(q?.method);if(!r?.supported||q?.version!==1||!['exact-river','exact-postflop','exact-multiway','sampled-subgame'].includes(q.method)&&!local||!Number.isInteger(q.iterations)||q.iterations<(local?0:1)||!Number.isFinite(q.seconds)||!tree||!(local?['betSizes','raiseSizes']:['betSizes','raiseSizes','openSizes','preflopRaiseMultipliers']).every(k=>Array.isArray(tree[k])&&(local||tree[k].length>0)&&tree[k].length<=4&&tree[k].every(x=>Number.isFinite(x)&&x>0))||!Array.isArray(q.rangeAssumptions)||q.rangeAssumptions.length<2||q.rangeAssumptions.length>9)return false;
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
  let cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot),task={...pending,hand:hand.clone(),referenceModel:reference.model,referenceSnapshot:reference.snapshot,cacheKey,baseKey,solveOptions:opts};state.pending=task;lock('spotSolve');HandTrace.log(hand,'ask',{kind:pending.kind,auto:!!pending.automatic,background:!!pending.background,force:!!pending.force,fullTree:!!pending.fullTree,plan:pending.plan?{route:pending.plan.route,target:pending.plan.target,cloud:!!pending.plan.cloud,server:!!pending.plan.server,effort:pending.effort||null}:null,spot:HandTrace.spot(baseKey),grading:pending.action?.label||null});status('Preparing player ranges and the continuation betting tree…');
  if(!['quiz','quizPrepare'].includes(pending.kind))$(pending.kind==='review'?'reviewFeedback':'playFeedback').innerHTML='<h3>Solving…</h3><p id="spotInlineProgress" role="status">Preparing ranges.</p>';
  if(bundleLoading&&!spotReferenceReady(hand)){await bundleReady.catch(()=>{});if(state.pending!==task)return;}
  if(bundleManifest&&smallMemoryDevice()){await ensurePhoneLibraries(state.hand===hand?hand:task.hand);if(state.pending!==task)return;}
  const sourceReference=preflopReference(hand,regular,pending.quizQuestion?.referencePack)||(hand.street===0&&!pending.quizQuestion?learnedPreflop(hand):null);if(sourceReference&&!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length){if(extraAction&&T.matchAction(sourceReference.actions,extraAction)<0){sourceReference.actions.push(extraAction);sourceReference.reference.push(null);sourceReference.probs=sourceReference.reference;}if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:sourceReference};state.pending=null;lock();HandTrace.log(hand,'answer',{from:sourceReference.referenceOnly?'chart':'learned preflop',spot:HandTrace.spot(baseKey)});finishAnalysis(sourceReference,task);return;}
  // A flop solved on your Mac or in the cloud with every size answers instead of a library that has fewer sizes.
  if(pending.kind==='inspect'&&!pending.fullTree&&hand.street===1&&spotJob(hand)?.status==='done'){state.pending=null;lock();HandTrace.log(hand,'answer',{from:'finished job',job:spotJob(hand).rowId.slice(5),spot:HandTrace.spot(baseKey)});$('playFeedback').innerHTML='';deliverSolveJob(true);return;}
  // A later decision on a street your Mac, the cloud or this computer's bridge already solved reads that solve's tree.
  if(!pending.fullTree&&!pending.force&&!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length&&hand.street>=1){await loadHandTrees(hand);if(state.pending!==task)return;const fromTree=treeReference(hand);if(fromTree&&!(extraAction&&T.matchAction(fromTree.actions,extraAction)<0)){if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:fromTree};state.pending=null;lock();HandTrace.log(hand,'answer',{from:'street tree',solvedBy:fromTree.solve?.method||null,spot:HandTrace.spot(baseKey)});finishAnalysis(fromTree,task);return;}}
  const libraryReference=!pending.fullTree&&!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length?postflopLibraryReference(hand):null;if(libraryReference&&!(extraAction&&T.matchAction(libraryReference.actions,extraAction)<0&&!libraryReference.actions.some(a=>a.kind===extraAction.kind))){if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:libraryReference};state.pending=null;lock();HandTrace.log(hand,'answer',{from:'flop library',fewerSizes:!!libraryReference.solve?.library?.fewerSizes,sizesMatched:libraryReference.solve?.library?.sizesMatched,...libraryReference.solve?.library?.sizeFit?{sizeFit:libraryReference.solve.library.sizeFit}:{},spot:HandTrace.spot(baseKey)});finishAnalysis(libraryReference,task);return;}
  const turnReference=!opts.ranges.some(x=>x.trim())&&!opts.rootSizes.length?await turnLibraryReference(hand):null;if(state.pending!==task)return;if(turnReference&&!(extraAction&&T.matchAction(turnReference.actions,extraAction)<0&&!turnReference.actions.some(a=>a.kind===extraAction.kind))){if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey,options:opts,result:turnReference};state.pending=null;lock();HandTrace.log(hand,'answer',{from:'turn library',sizesMatched:turnReference.solve?.library?.sizesMatched,...turnReference.solve?.library?.sizeFit?{sizeFit:turnReference.solve.library.sizeFit}:{},spot:HandTrace.spot(baseKey)});finishAnalysis(turnReference,task);return;}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const context=await requestSolvedPolicy(hand);if(state.pending!==task)return;if(context?.conditionedRanges?.every(Boolean)){opts.ranges=context.conditionedRanges;opts.rangeOrigin='Conditioned on the preceding exact strategy and public actions';cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){await loadHandTrees(hand);if(state.pending!==task)return;const carried=treeRanges(hand);if(carried){opts.ranges=carried.ranges;opts.rangeOrigin=carried.origin;cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const carried=await carriedPostflopRanges(hand);if(state.pending!==task)return;if(carried){opts.ranges=carried.ranges;opts.rangeOrigin=carried.origin;cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  if(opts.rangeMode==='auto'&&!opts.ranges.some(x=>x.trim())){const chart=chartPostflopRanges(hand,observed,opts);if(chart){opts.ranges=chart.ranges;opts.rangeOrigin=chart.origin;cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  // A heads-up river solved on this device after a multiway street: the players who folded keep the ranges they folded
  // with, and solving with them makes the exact solver enumerate every player's cards together, which overruns its
  // budget after half a minute and gives no answer. Their cards are averaged out instead, as for a preflop fold.
  if((task.plan||spotPlan(hand))?.route==='river'&&opts.ranges.some(x=>String(x||'').trim())){const folded=new Set(hand.actionLog.filter(a=>a.kind==='fold').map(a=>a.seat));if([...folded].some(i=>i!==hand.actor&&String(opts.ranges[i]||'').trim()&&!/^all$/i.test(String(opts.ranges[i]).trim()))){opts.ranges=opts.ranges.map((x,i)=>folded.has(i)&&i!==hand.actor?'all':x);cacheKey=spotCacheKey(observed,opts,extraAction,reference.snapshot);task.cacheKey=cacheKey;}}
  let cached=spotUI.cache.get(cacheKey);if(!pending.force&&!cached)cached=await getSavedSpot(cacheKey);
  if(state.pending!==task)return;
  if(!pending.force&&validSpotResult(cached)){spotUI.cache.set(cacheKey,cached);if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey:task.baseKey,options:task.solveOptions,cacheKey:task.cacheKey,result:cached};state.pending=null;lock();HandTrace.log(hand,'answer',{from:'saved solve',solvedBy:HandTrace.source(cached),spot:HandTrace.spot(baseKey)});finishAnalysis({...cached,reused:true},task);return;}
  // A stored answer expected at the click was not there after all: ask about a real solve instead of running one
  // that can't finish here.
  if(pending.expectReference){const plan=spotPlan(hand);if(plan&&!onDeviceRoute(plan)){HandTrace.log(hand,'no stored answer',{offerSolve:!pending.automatic,route:plan.route,spot:HandTrace.spot(baseKey)});state.pending=null;lock();endSolveFeedback(task,'',false);$('playFeedback').innerHTML='';if(!pending.automatic)solveSpotClick(true);return;}}
  // Grading a decision you already made never runs a solve on this device when the spot belongs on your Mac or the
  // cloud: a solve already sent there for this decision grades it when its answer lands (gradeFromJobs), and keeps
  // running after you act; otherwise the decision goes ungraded.
  if(pending.background&&!onDeviceRoute(spotPlan(hand))){const job=[...spotUI.jobs.values()].find(j=>j.baseKey===baseKey&&(jobPending(j)||j.status==='done')),waitTree=!job&&!pending.treeWaited&&!!lineJob(hand);HandTrace.log(hand,job?'grade waits for job':waitTree?'grade waits for street tree':'not graded (needs Mac/cloud)',{job:job?job.rowId.slice(5):null,jobStatus:job?.status||null,action:pending.action?.label||null,spot:HandTrace.spot(baseKey)});if(!job&&!pending.treeWaited&&lineJob(hand)){spotUI.treeWaits.push({...task,treeWaited:true});state.pending=null;lock();endSolveFeedback(task,'',false);$('playFeedback').innerHTML='';if(typeof pumpGrades==='function')pumpGrades();return;}if(job){spotUI.gradeWaits.set(baseKey,{...task});keepGradeWait(baseKey,task);}state.pending=null;lock();endSolveFeedback(task,'',false);$('playFeedback').innerHTML='';if(job)gradeFromJobs();if(typeof pumpGrades==='function')pumpGrades();return;}
  if(task.plan?.route==='mac'){await sendToMac(task,observed,opts,extraAction);if(state.pending!==task)return;state.pending=null;lock();const el=$('playFeedback');if(el)el.innerHTML='';status(task.plan.cloud?'Sent to the cloud.':task.plan.server?'Sent to your server.':'Sent to your Mac.');return;}
  const worker=ensureWorker();if(spotUI.workerStamp!==sourceStamp){worker.postMessage({type:'load',snapshot:reference.snapshot});spotUI.workerStamp=sourceStamp;state.workerVersion=0;}
  task.dispatched=true;task.started=Date.now();HandTrace.log(hand,'solve',{where:opts.localSolver?'this computer (bridge)':'this device',street:hand.street,inputs:hash(task.cacheKey),spot:HandTrace.spot(baseKey)});worker.postMessage({type:'solve',observed,options:opts,extraAction,tag:pending.kind});
  }catch(error){HandTrace.log(hand,'error',{message:error?.message});const task=state.pending;state.pending=null;lock();quizAnalysisError(error.message,task);endSolveFeedback(task,error.message,true);status(error.message,true);}
}
// A solve that ends without a result replaces its "Solving" block, so the
// heading and cancel hint do not stay on screen.
function endSolveFeedback(task,message,failed){const progress=$('spotInlineProgress'),el=$(task?.kind==='review'?'reviewFeedback':'playFeedback');if(!progress)return;if(['quiz','quizPrepare'].includes(task?.kind)||!el?.contains(progress)){progress.textContent=message;return;}el.innerHTML='<h3>'+(failed?'The solve failed':'The solve was stopped')+'</h3><p role="status"'+(failed?' class="error"':'')+'>'+esc(message)+'</p>';}
function handleSpotWorkerMessage(message){
 if(message.type==='spotProgress'){
  const p=message,phase=p.phase==='local'?'Solving with TexasSolver on this computer · '+fmt(p.done,0)+'\u00a0sec'+(p.iterations?' · iteration '+fmt(p.iterations,0):'')+(Number.isFinite(p.exploitability)?' · exploitability '+fmt(p.exploitability,2)+'% of pot':''):p.phase==='preparing'?'Preparing ranges':p.phase==='evaluating'?'Evaluating the solved continuation':p.method==='exact-multiway'?'Solving the exact '+(p.players>2?'multiplayer':'heads-up')+' tree':p.method==='exact-river'?'Solving the river':'Solving the current continuation',text=p.method==='exact-river'?phase+'…':phase+(p.total>1?' · '+fmt(p.done,0)+' / '+fmt(p.total,0)+(p.method?.startsWith('exact-')?' iterations':p.phase==='evaluating'?' deals':' sampled updates'):'')+(Number.isFinite(p.gap)?' · deviation gap '+fmt(p.gap,5):'');
  status(text);if($('spotInlineProgress'))$('spotInlineProgress').textContent=text;$('progress').style.width=p.phase==='preparing'?'2%':p.method==='exact-river'?Math.min(99,Number.isFinite(p.gap)&&p.gap>0?100*Math.min(1,p.tolerance/p.gap):5)+'%':p.phase==='local'?Math.min(95,5+p.done/6)+'%':Math.min(99,100*p.done/p.total)+'%';
  if(['quiz','quizPrepare'].includes(state.pending?.kind))$('quizStatus').textContent=(state.pending.kind==='quizPrepare'?'Preparing your next decision · ': 'Reviewing your hand · ')+text;
  return true;
 }
 if(message.type==='error'){const task=state.pending;HandTrace.log(task?.hand,'solve error',{message:message.message,spot:HandTrace.spot(task?.baseKey)});if(task&&!['quiz','quizPrepare','review'].includes(task.kind))spotUI.last={baseKey:task.baseKey,options:task.solveOptions,result:{supported:false,message:message.message}};spotUI.workerStamp=null;endSolveFeedback(task,message.message,true);return false;}if(message.type!=='spotResult')return false;
 const pending=state.pending;state.pending=null;if(!pending)return true;const result=message.result;HandTrace.log(pending.hand,'solved',{where:'this device',supported:!!result.supported,canceled:!!result.canceled,seconds:pending.started?(Date.now()-pending.started)/1000:null,message:result.supported?null:result.message,spot:HandTrace.spot(pending.baseKey)});if(result.supported&&pending.started&&pending.plan)recordSolveTime(pending.plan.route==='texas'&&pending.plan.efforts?{...pending.plan,seed:pending.plan.seed*SOLVE_EFFORTS[pending.effort||'standard'].factor}:pending.plan,(Date.now()-pending.started)/1000);if(result.supported)rememberSpot(pending.cacheKey,result,{observed:observedData(pending.hand),options:pending.solveOptions,extraAction:JSON.parse(pending.cacheKey)[3]||null});if(!['quiz','quizPrepare','review'].includes(pending.kind))spotUI.last={baseKey:pending.baseKey,options:pending.solveOptions,cacheKey:pending.cacheKey,result};
 lock();$('progress').style.width=result.canceled?'0%':'100%';if(result.canceled){quizAnalysisError(result.message,pending);endSolveFeedback(pending,result.message,false);status(result.message);return true;}finishAnalysis(result,pending);return true;
}
function activeSpotResult(hand){return spotUI.last&&PokerSpot.publicKey(observedData(hand))===spotUI.last.baseKey?spotUI.last.result:null;}
// A solve on the Mac (TexasSolver, the PLO or 3-way solver) or a precomputed flop library: shown as frequencies. A
// TexasSolver answer that carries action EVs (spotCertified) also shows the EV table and grades on EV.
function spotFrequenciesOnly(result){const q=result?.solve;return !!(result?.supported&&['local-texassolver','local-plo','local-multiway','postflop-library','local-preflop'].includes(q?.method));}
function spotApproximate(result){const q=result?.solve;return !!(result?.supported&&q?.approximate&&q.method==='sampled-subgame'&&!spotCertified(result));}
function spotCertified(result){const q=result?.solve;if(result?.supported&&T.solverEV(q))return Array.isArray(result.mean)&&result.mean.every(Number.isFinite)&&Array.isArray(result.loss);return !!(result?.supported&&q?.exact&&['exact-river','exact-postflop','exact-multiway'].includes(q.method)&&Number.isFinite(q.gap)&&Number.isFinite(q.tolerance)&&q.gap<=q.tolerance&&Number.isFinite(q.handRegret)&&q.handRegret<=(q.handTolerance??q.tolerance));}
function spotFrequencyHTML(result){
 if(!result.supported)return '<div class="notice"><strong>No matching reliable solution</strong><br>'+esc(result.message)+'</div>';if(PokerPreflop.isResult(result))return preflopFrequencyHTML(result);
 const tones=actionTones(result.actions,state.hand);
 if(spotFrequenciesOnly(result))return (result.offTree?'<p class="help">Approximate</p>':'')+'<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(toneLabel(a,tones[i],state.hand))+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+freqBarWidth(result.reference[i])+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
 if(spotApproximate(result))return '<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(toneLabel(a,tones[i],state.hand))+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+freqBarWidth(result.reference[i])+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
 if(!spotCertified(result))return '<div class="notice"><strong>No solver answer for this spot.</strong> The solve did not reach its accuracy target.</div>';
 const solve=result.solve;return'<div class="frequency-grid">'+result.actions.map((a,i)=>'<div class="policyRow"><div class="row between"><span>'+esc(toneLabel(a,tones[i],state.hand))+'</span><strong>'+fmt(result.reference[i]*100,1)+'%</strong></div><div class="bar"><i style="width:'+freqBarWidth(result.reference[i])+'%;background:var(--act-'+tones[i]+')"></i></div></div>').join('')+'</div>';
}
// Each live player's range as a 13x13 grid: pairs on the diagonal, suited above it, offsuit below, each cell
// shaded by how much of that hand is in the range, read with the solver's own parser so typed shorthand (QQ+,
// A2s-A5s, AKs:50%) shades the same hands the solve used.
const GRID_RANKS='AKQJT98765432';
function rangeClassWeights(text){
 const w=new Map();let rows=null;try{rows=PokerSpot.parseRange(text,{hole:2},[]);}catch{}
 for(const r of rows||[]){const k=G.Core.handClass(r.cards);w.set(k,(w.get(k)||0)+r.weight/(k.length===2?6:k[2]==='s'?4:12));}
 return w;
}
// With mix (hand class -> action frequencies, the acting player's whole strategy), each cell splits into the action
// colors left to right, and fades with the hand's weight in the range.
// Without an action to color, a cell fills from the left by how often the player holds the hand, like the action bars.
const RANGE_KEY='<div class="action-key"><span>How often they have it:</span><span><i class="range-always"></i>100%</span><span><i class="range-sometimes"></i>50%</span><span><i class="range-never"></i>0%</span></div>';
// A hand held under 1% of the time reads as out of the range (a dark cell with no bar looked like a bug), and any hand
// above that gets a visible sliver of fill.
const RANGE_MIN=.01;
function rangeGridHTML(text,mix=null,tones=null,mark=null,pick=null){const w=rangeClassWeights(text);let cells='';for(let i=0;i<13;i++)for(let j=0;j<13;j++){const a=GRID_RANKS[Math.min(i,j)],b=GRID_RANKS[Math.max(i,j)],k=i===j?a+b:a+b+(i<j?'s':'o'),raw=Math.min(1,w.get(k)||0),x=raw<RANGE_MIN?0:raw,m=mix&&x>0&&mix[k];cells+='<span '+(k===mark?'data-hand ':'')+(pick&&k===pick.k?'data-picked ':'')+(m?'class="mixed" style="'+actionMixStyle(m,tones)+';opacity:'+(.35+.65*x).toFixed(2)+'" title="'+k+' · '+m.map(p=>Math.round(p*100)+'%').join(' / ')+'"':(x>0?'':'class="none" ')+'style="--w:'+(x>0?Math.max(.12,x):0).toFixed(2)+'" title="'+k+' '+Math.round(x*100)+'%"')+'>'+k+'</span>';}return'<div class="range-grid"'+(pick?' data-rc="'+pick.id+'" aria-label="Range grid: tap a hand for its suit combos"':' role="img" aria-label="Range grid"')+'>'+cells+'</div>'+(pick?'<div class="range-combos"'+(pick.k?'>'+rangeCombosHTML(rangeCombos.get(pick.id),pick.k):' hidden>')+'</div>':'');}
// Tap a cell in the acting player's grid (postflop) for each suit combo's own action mix: from the flop on the solver
// plays every combo apart (AhKh on a two-heart board is not AsKs), and a cell is their average. Combos the board or the
// viewer's cards block are left out; combos the range no longer holds (<1%) too.
const rangeCombos=new Map();let rangeComboSeq=0,rangePicked=null;
function classCombos(k){const suits='shdc',out=[];for(let x=0;x<4;x++)for(let y=0;y<4;y++){if(k.length===2?y<=x:k[2]==='s'?y!==x:y===x)continue;out.push(k[0]+suits[x]+k[1]+suits[y]);}return out;}
function rangeCombosHTML(d,k){
 if(!d)return'';const C=G.Core,dead=new Set(d.dead),rows=[];
 for(const name of classCombos(k)){const cs=C.cards(name);if(cs.some(c=>dead.has(c)))continue;const key=cs.slice().sort((a,b)=>b-a).map(C.cardName).join(''),m=d.combos[key];if(!m)continue;const w=d.reach?d.reach[key]??0:d.weights.get(key)??0;if(w<RANGE_MIN)continue;rows.push({cs,m,w,mine:key===d.mine});}
 const tag=k+'<button type="button" class="range-combos-close" aria-label="Close">×</button>';
 if(!rows.length)return'<div class="range-combos-head">'+tag+'</div><p class="help">Not in the range here</p>';
 return'<div class="range-combos-head">'+tag+'</div>'+rows.map(r=>'<div class="range-combo'+(r.mine?' mine':'')+'"><span class="range-combo-cards">'+r.cs.map(c=>cardHTML(c)).join('')+'</span><span class="range-combo-bar" style="'+actionMixStyle(r.m,d.tones)+';opacity:'+(.35+.65*Math.min(1,r.w)).toFixed(2)+'">'+r.m.map((p,i)=>p>=.2?'<b style="left:'+(r.m.slice(0,i).reduce((a,b)=>a+b,0)*100).toFixed(1)+'%;width:'+(p*100).toFixed(1)+'%">'+Math.round(p*100)+'</b>':'').join('')+'</span></div>').join('');
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{
 const close=e.target.closest('.range-combos-close'),cell=!close&&e.target.closest('.range-grid[data-rc]>span');if(!close&&!cell)return;
 const fig=e.target.closest('figure'),grid=fig?.querySelector('.range-grid[data-rc]'),panel=fig?.querySelector('.range-combos');if(!grid||!panel)return;
 const id=+grid.dataset.rc,d=rangeCombos.get(id),k=cell?cell.textContent:null,same=cell&&cell.hasAttribute('data-picked');
 grid.querySelectorAll('[data-picked]').forEach(x=>x.removeAttribute('data-picked'));
 if(close||same||!d||cell.classList.contains('none')){panel.hidden=true;panel.innerHTML='';rangePicked=null;return;}
 cell.setAttribute('data-picked','');panel.innerHTML=rangeCombosHTML(d,k);panel.hidden=false;rangePicked={sig:d.sig,k};
});
// The tap-a-cell state for the acting player's grid, or null where the solve has no per-combo mixes (preflop, where
// every suit combo plays the same, and PLO).
function comboPick(r,mix,tones){
 const h=state.hand,board=h?.board||[];if(!mix.combos||!board.length||!h||h.rules?.hole>2)return null;
 const C=G.Core,hero=h.holes[state.hero],own=r.seat===state.hero,dead=[...board,...(!own&&hero?.length===2?hero:[])],sig=board.map(C.cardName).join('')+'|'+r.seat+'|'+h.actionLog?.length;
 let weights=new Map();if(!mix.reach){try{for(const x of PokerSpot.parseRange(r.range,{hole:2},board))weights.set(x.cards.slice().sort((a,b)=>b-a).map(C.cardName).join(''),Math.min(1,x.weight));}catch{}}
 const id=++rangeComboSeq;rangeCombos.set(id,{combos:mix.combos,reach:mix.reach||null,weights,tones,dead,sig,mine:own&&hero?.length===2?hero.slice().sort((a,b)=>b-a).map(C.cardName).join(''):null});
 for(const old of rangeCombos.keys())if(old<id-12)rangeCombos.delete(old);
 return{id,k:rangePicked&&rangePicked.sig===sig?rangePicked.k:null};
}
// PLO has no 13x13 grid: each player's range is a grid of hand shapes (rows: aces, two pair, pair, rundown, gapped,
// disconnected; columns: double-suited, single-suited, rainbow, 3+ of a suit). The actor's cells split into action colors
// and show how often that shape is played (not folded); others fill by how often they hold it. PLO charts are approximate.
function ploRangesHTML(result){
 const pr=result.ploRange,h=state.hand,names=h&&pr.seats.every(r=>r.seat<h.n)?G.positions(h.n,h.button):null,tones=actionTones(result.actions,h),fold=result.actions.findIndex(a=>a.kind==='fold');
 const seats=pr.seats.slice().sort((p,q)=>(q.seat===pr.seat)-(p.seat===pr.seat));
 const grid=r=>{const mine=r.seat===pr.seat;let cells='<i></i>'+pr.cols.map(c=>'<b>'+esc(c)+'</b>').join('');
  pr.rows.forEach((row,i)=>{cells+='<b>'+esc(row)+'</b>';pr.cols.forEach((col,j)=>{const c=i*4+j,x=r.w[c]<RANGE_MIN?0:r.w[c],m=mine&&x>0&&pr.mix[c],title=esc(row+' · '+col),mark=mine&&c===pr.hero&&h&&pr.seat===state.hero?'data-hand ':'';
   cells+=m?'<span '+mark+'class="mixed" style="'+actionMixStyle(m,tones)+';opacity:'+(.35+.65*x).toFixed(2)+'" title="'+title+' · '+m.map(p=>Math.round(p*100)+'%').join(' / ')+'">'+Math.round(100*x*(1-(fold>=0?m[fold]:0)))+'%</span>'
    :'<span '+mark+(x>0?'':'class="none" ')+'style="--w:'+(x>0?Math.max(.12,x):0).toFixed(2)+'" title="'+title+'">'+(x>0?Math.round(x*100)+'%':'')+'</span>';});});
  return'<div class="range-grid plo-grid" role="img" aria-label="PLO range by hand shape">'+cells+'</div>';};
 return'<div class="spot-ranges"><h3>Ranges · approximate</h3><div class="range-grids">'+seats.map(r=>'<figure><figcaption><strong>'+esc(names?names[r.seat]:'Seat '+(r.seat+1))+(h&&r.seat===state.hero?' · you':'')+'</strong> · '+(r.share<.005?'<1':Math.round(r.share*100))+'% of hands</figcaption>'+(r.seat===pr.seat?actionKeyHTML(result.actions,tones,h):RANGE_KEY)+grid(r)+'</figure>').join('')+'</div></div>';
}
function spotRangesHTML(result){
 if(result?.ploRange?.seats?.length)return ploRangesHTML(result);
 const all=result?.solve?.rangeAssumptions||result?.rangeAssumptions||[],h=state.hand,live=h&&!h.done&&h.n===all.length?new Set(h.living()):null,names=h&&all.every(r=>r.seat<h.n)?G.positions(h.n,h.button):null,nb=live?h.board.length:0,legal=[...Array(h?.rules?.hole||2)].reduce((n,_,i)=>n*(52-nb-i)/(i+1),1);
 const ranges=all.filter(r=>live?live.has(r.seat):!/^All legal hands/.test(r.range));if(!ranges.length)return'';
 // Weighted share of the hands left in the deck: a combo held a tenth of the time counts a tenth, so a capped range does not read as wide.
 const share=r=>{let rows=null;try{rows=PokerSpot.parseRange(r.range,{hole:h?.rules?.hole||2},live?h.board:[]);}catch{}const n=rows?rows.reduce((s,x)=>s+x.weight,0):r.combinations;return n>0?100*n/legal:0;};
 const mix=result.handMix&&result.handMix.classes&&typeof result.handMix.classes==='object'?result.handMix:null,tones=mix?actionTones(result.actions,h):null;
 // The acting player, whose strategy colors the grid, comes first.
 ranges.sort((p,q)=>(mix&&q.seat===mix.seat)-(mix&&p.seat===mix.seat));
 return'<div class="spot-ranges"><h3>Ranges</h3><div class="range-grids">'+ranges.map(r=>{const mine=mix&&r.seat===mix.seat;return'<figure><figcaption><strong>'+esc(names?names[r.seat]:'Seat '+(r.seat+1))+(h&&r.seat===state.hero?' · you':'')+'</strong>'+(share(r)>0?' · '+(share(r)<.5?'<1':Math.round(share(r)))+'% of hands':'')+'</figcaption>'+(mine?actionKeyHTML(result.actions,tones,state.hand):rangeClassWeights(r.range).size?RANGE_KEY:'')+(/^All legal hands/.test(r.range)?'<p class="help">Any '+(h?.rules?.hole>2?'hand':'two cards')+'</p>':rangeClassWeights(r.range).size?rangeGridHTML(r.range,mine?mix.classes:null,tones,h&&r.seat===state.hero&&h.holes[r.seat]?.length===2?G.Core.handClass(h.holes[r.seat]):null,mine?comboPick(r,mix,tones):null):'<p class="help">'+esc(r.range)+'</p>')+'</figure>';}).join('')+'</div></div>';
}
// The v4 flop library bets only 1/3 pot on the flop. On a live flop it offers a solve with 1/3, 2/3 and 1.5x pot,
// on your Mac or in the cloud, which then answers this flop instead.
function fewerSizesHTML(result){const h=state.hand;if(!result?.solve?.library?.fewerSizes||!h||h.done||h.street!==1||activeSpotResult(h)!==result)return'';
 // The full-size solve sent from here: its progress shows in the prompt's place, and its answer replaces the library's once it lands.
 const job=spotJob(h);if(job&&jobPending(job))return'<div class="fewer-sizes">'+jobNoticeHTML(job)+'</div>';
 if(job?.status==='done'){setTimeout(()=>deliverSolveJob(true),0);return'';}
 const failed=job?.status==='failed'?'<p class="small error">'+esc(jobText(job))+'</p>':'';
 const plan=spotPlan(h);if(!plan||plan.route==='none')return failed;
 const note='<p class="small muted">Only 1/3 pot is solved here.'+(plan.blocked?' '+esc(plan.blocked)+(plan.jump?' <button type="button" class="ui-jump" data-jump="'+plan.jump.to+'">'+esc(plan.jump.label)+'</button>':''):' Solve with 1/3, 2/3 and 1.5x:')+'</p>';
 return'<div class="fewer-sizes">'+failed+note+(plan.blocked?'':solvePromptHTML(plan,true))+'</div>';}
function spotResultHTML(result,grade=null){
 if(PokerPreflop.isResult(result))return preflopResultHTML(result,grade);
 const solve=result.solve,converged=spotCertified(result),approximate=spotApproximate(result),frequent=result.reference.indexOf(Math.max(...result.reference));
 // Action names as the frequency rows show them, so an all-in reads All-in in the headline and the EV table too.
 const tones=actionTones(result.actions,state.hand),name=i=>toneLabel(result.actions[i],tones[i],state.hand);
 const local=spotFrequenciesOnly(result),method=solve?.method,paid=solve?.cloud?.cost>0?'<p class="small muted solve-paid">'+(solve.cloud.capped?'Stopped at its cap':'Done')+' · '+centsText(solve.cloud.cost)+'</p>':'',title=method==='postflop-library'?'Precomputed flop strategy':method==='local-preflop'?(solve.cloud?'Solved preflop in the cloud':'Solved preflop on your Mac'):method==='local-plo'?'Solved with the PLO solver':method==='local-multiway'?'Solved with the 3-way solver':local?'Solved with TexasSolver':converged?'Finite-game solution reached the accuracy target':approximate?'Approximate solution':'No reliable recommendation available';
 const actionValues=approximate?'<h3>Estimated action values</h3><div class="tableWrap"><table><thead><tr><th>Action</th><th>Frequency</th><th>Estimated EV</th></tr></thead><tbody>'+result.actions.map((a,i)=>'<tr><td>'+esc(a.label)+(i===result.best?' · highest estimate':'')+'</td><td>'+fmt(result.reference[i]*100,1)+'%</td><td>'+signed(result.mean[i],3)+' ± '+fmt(1.96*result.se[i],3)+' '+esc(result.units)+'</td></tr>').join('')+'</tbody></table></div>':converged?'<h3>Action values from this decision</h3><div class="tableWrap"><table><thead><tr><th>Action</th><th>Frequency</th><th>EV</th><th>Estimated cost</th></tr></thead><tbody>'+result.actions.map((a,i)=>'<tr><td>'+esc(name(i))+(i===result.best?' · highest EV':'')+'</td><td>'+fmt(result.reference[i]*100,1)+'%</td><td>'+signed(result.mean[i],3)+' '+esc(result.units)+'</td><td>'+fmt(result.loss[i],3)+' '+esc(result.units)+'</td></tr>').join('')+'</tbody></table></div>':'';
 return'<section class="spot-solution"><div class="eyebrow">Analysis of the current position</div><h3>'+title+'</h3>'+paid+(converged?'<p><strong>Highest-EV action: '+esc(name(result.best))+'</strong>'+(frequent!==result.best?' · most frequent: '+esc(name(frequent))+' ('+fmt(result.reference[frequent]*100,1)+'%)':'')+'</p>':approximate||local?'<p><strong>Most frequent action: '+esc(name(frequent))+'</strong></p>':'')+spotFrequencyHTML(result)+fewerSizesHTML(result)+(typeof spotWhyHTML==='function'?spotWhyHTML(result):'')+spotRangesHTML(result)+actionValues+(converged&&grade?'<p><strong>Your action cost: '+fmt(grade.estimatedLoss??grade.loss,3)+' '+esc(result.units)+'</strong></p>':'')+'</section>';
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
 // Range preparation can't hear a stop, so an in-browser solve ends with its worker; a TexasSolver job is stopped so it cancels.
 $('spotStop').onclick=()=>{if(state.job!=='spotSolve')return;const task=state.pending;if(task?.dispatched){if(task.solveOptions?.localSolver){state.worker?.postMessage({type:'stop'});status('Stopping the current solve…');}else{dropSpotWorker();handleSpotWorkerMessage({type:'spotResult',result:{supported:false,canceled:true,message:'The spot solve was stopped. You can solve this position again.'}});}}else{state.pending=null;lock();quizAnalysisError('Preparation was canceled.',task);endSolveFeedback(task,'Preparation was canceled.',false);status('Preparation was canceled.');}};
 $('quizStopSolve').onclick=()=>$('spotStop').onclick();
 $('spotExport').onclick=exportPortableSpot;
 ['spotRangeMode','spotRootSizes'].forEach(id=>$(id).onchange=()=>{spotUI.last=null;renderPlay();});$('spotLocalSolver').onchange=()=>{spotUI.last=null;dbPut('meta',{id:'spotLocalSolver',value:$('spotLocalSolver').value}).catch(()=>{});checkLocalBridge().then(()=>renderPlay());renderPlay();};addEventListener('focus',()=>{if($('spotLocalSolver').value&&Date.now()-localBridge.checked>10000)checkLocalBridge();});$('spotResetRanges').onclick=()=>{spotUI.rangeValues=Array(state.hand?.n||2).fill('');$('spotRangeInputs').innerHTML='';spotUI.last=null;renderSpotRangeEditors();renderPlay();};
 $('spotClearCache').onclick=async()=>{spotUI.cache.clear();spotUI.last=null;renderPlay();try{const db=await openDB();const tx=db.transaction('solves','readwrite');tx.objectStore('solves').clear();tx.oncomplete=()=>status('Saved spot analyses cleared. The next Analyze click will solve again.');tx.onerror=()=>status(tx.error.message,true);}catch(error){status(error.message,true);}};renderSpotRangeEditors();initMultiwayStudies();loadSolveJobs().then(()=>{if(state.hand)renderPlay();});
}
