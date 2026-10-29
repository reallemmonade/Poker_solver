'use strict';
// Solves sent from your other devices. A phone can't reach this bridge, so it queues a spot in your account
// instead: a 'solvejob-<hash>' meta row holding the spot, its ranges and the solve options (studio/spot-ui.js,
// sendToMac). Once the app on this computer has linked the bridge to your account (POST /link), the bridge pulls
// your account's changes every 20 seconds, solves queued spots one at a time through its own endpoints (a job the
// phone cancels stops at the next progress check, within 10 seconds), and
// pushes each answer back as the saved spot the phone looks for, then marks the job done or failed. Every few
// minutes it also pushes a 'macsolver' heartbeat (last seen, threads, load) so the phone can say whether this
// computer is online and busy. With nothing queued and the computer otherwise idle, it learns the flops your devices
// asked for ('flopwant-' rows, see learn.cjs) one at a time, and marks each done.
const fs=require('fs'),os=require('os'),path=require('path'),{Worker}=require('worker_threads');
const FILE=process.env.CITRUS_BRIDGE_LINK||path.join(os.homedir(),'.citrus-poker-bridge.json'),POLL_MS=20000,BEAT_MS=180000,PROGRESS_MS=10000,IDLE_LOAD=.5,WANT_DAYS=30;

// How far a running solve has got, pushed with the job every 10 seconds. TexasSolver and the PLO solver report
// exploitability (% of the pot), which falls roughly geometrically, so progress is how far its log has moved from
// the first reading toward the job's target; reaching the iteration cap ends a solve too. Multiway solves have no
// target, so they count time against the estimate. Time left extrapolates the rate so far once there is one.
function progressOf(job,s,first){
 if(!s)return{phase:'preparing',p:0,remaining:Math.max(1,job.seconds||60)};
 const target=Number(job.options?.localAccuracy)||0,cap=Number(job.options?.localIterations)||0,e=Number(s.exploitability),est=Math.max(1,job.seconds||60);let p=0;
 if(target>0&&e>0){if(!(first.e>0))first.e=e;if(first.e>target*1.01)p=Math.log(first.e/e)/Math.log(first.e/target);}
 if(cap>0&&s.iterations>0)p=Math.max(p,s.iterations/cap);
 // Until the solver's first reading, and for multiway solves, time against the estimate stands in (up to 10%).
 if(!(target>0))p=s.seconds/est;else if(p<.1)p=Math.max(p,Math.min(.1,.1*s.seconds/est));
 p=Math.min(.99,Math.max(0,p||0));
 const remaining=p>=.1?s.seconds*(1-p)/p:Math.max(est-s.seconds,est*.1);
 return{phase:'solving',p:Math.round(p*1000)/1000,remaining:Math.max(1,Math.round(remaining)),iterations:s.iterations||0,exploitability:Number.isFinite(e)?e:null,target:target||null};
}
function createQueue({port,threads,busy,status=()=>null,learn=null,stopLearning=async()=>{},log=console.log}){
 let link=null,cursor=0,running=null,timer=null,beat=0,current=null,learning=null;const jobs=new Map(),wants=new Map();
 // Open jobs and wanted flops are kept with the cursor: a restart pulls only what changed since, so they would be lost.
 const open=(m,...states)=>[...m].filter(([,v])=>states.includes(v.status));
 try{const {jobs:j,wants:w,...saved}=JSON.parse(fs.readFileSync(FILE,'utf8'));if(saved?.api&&saved?.token){link=saved;cursor=Number(saved.cursor)||0;for(const [id,v]of Array.isArray(j)?j:[])jobs.set(id,v);for(const [id,v]of Array.isArray(w)?w:[])wants.set(id,v);}}catch{}
 const save=()=>{try{fs.writeFileSync(FILE,JSON.stringify({...link,cursor,jobs:open(jobs,'queued','running'),wants:open(wants,'wanted','learning')}),{mode:0o600});}catch(e){log('Could not save the account link: '+e.message);}};
 async function api(method,route,body){
  const r=await fetch(link.api.replace(/\/$/,'')+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+link.token},body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.error||'Account service error '+r.status),{status:r.status});return data;
 }
 const meta=(id,value,t=Date.now())=>({store:'meta',id,t,data:{id,value}});
 const heartbeat=()=>meta('macsolver',{seen:Date.now(),threads,load:Math.round(os.loadavg()[0]/os.cpus().length*100)/100,busy:busy()});
 async function pull(){
  for(;;){const page=await api('GET','/api/sync?since='+cursor);
   for(const r of page.rows)if(r.store==='meta'&&r.data?.value&&typeof r.data.value==='object'){if(/^solvejob-/.test(r.id))jobs.set(r.id,{...r.data.value,t:r.t});else if(/^flopwant-/.test(r.id)&&!(learning?.id===r.id))wants.set(r.id,r.data.value);}
   cursor=page.cursor;if(!page.more)break;}
  save();
 }
 function solve(job){
  return new Promise(resolve=>{
   const worker=new Worker(path.join(__dirname,'queue-worker.cjs'),{workerData:{observed:job.observed,options:job.options,extraAction:job.extraAction,url:'http://127.0.0.1:'+port,learned:!!learn}});let out=null;
   current={stop(){out={cancelled:true};fetch('http://127.0.0.1:'+port+'/cancel',{method:'POST'}).catch(()=>{});worker.terminate();}};
   worker.on('message',m=>{out=m;});worker.on('error',e=>{out={error:e.message};});worker.on('exit',()=>{current=null;resolve(out||{error:'The solve stopped without an answer.'});});
  });
 }
 async function runNext(){
  // Only this bridge runs queued solves, one at a time, so a job still marked running here was cut off by a restart.
  const next=[...jobs.entries()].filter(([,j])=>j.status==='queued'||j.status==='running').sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0))[0];if(!next)return;
  // The job's rows from here on are stamped just after the phone's own write, not with this computer's clock, so a
  // cancel the phone writes later wins over them even when its clock is behind or it was offline when you tapped.
  const [id,job]=next;let n=0,over=false;const at=()=>(job.t||Date.now())+ ++n;await stopLearning();const started={...job,status:'running',startedAt:Date.now()};delete started.t;jobs.set(id,started);
  await api('POST','/api/sync',{rows:[meta(id,started,at())]});log('Solving a spot sent from your account ('+id+').');
  // Progress goes up every 10 seconds while the solve runs, and the heartbeat with it: a long solve holds the
  // regular round, and the phone should still see this computer as online. A report still pulling when the solve
  // ends sends nothing, or its 'running' row would land after the answer and the job would be solved again.
  const first={},report=async()=>{try{await pull();}catch{}if(over)return;if(jobs.get(id)?.status==='cancelled'){current?.stop();return;}const rows=[meta(id,{...started,progress:{...progressOf(job,status(),first),at:Date.now()}},at())];if(Date.now()-beat>BEAT_MS){beat=Date.now();rows.push(heartbeat());}return api('POST','/api/sync',{rows}).catch(e=>log('Solve queue progress: '+e.message));};
  const ticker=setInterval(report,PROGRESS_MS);let out;try{out=await solve(job);}finally{clearInterval(ticker);over=true;}const result=out.result;
  // Cancelled from the phone: the job row already says so, so nothing goes back.
  if(out.cancelled){log('Cancelled '+id+'.');return;}
  // A solve started from the app on this computer meanwhile holds the solver: try again on the next round.
  if(!result&&/already running/.test(out.error||'')||result&&!result.supported&&/already running/.test(result.message||'')){jobs.set(id,job);await api('POST','/api/sync',{rows:[meta(id,{...job,status:'queued'},at())]});return;}
  const ok=result?.supported===true,rows=[],{t:_,...base}=job,done={...base,status:ok?'done':'failed',startedAt:started.startedAt,finishedAt:Date.now(),message:ok?undefined:(out.error||result?.message||'No answer.').replace(/^Local solver: /,'')};
  if(ok)rows.push({store:'solves',id:job.rowId,t:Date.now(),data:{id:job.rowId,key:job.key,result,observed:job.observed,options:job.options,extraAction:job.extraAction||null,updatedAt:new Date().toISOString()}});
  rows.push(meta(id,done,at()));jobs.set(id,done);await api('POST','/api/sync',{rows});log((ok?'Solved ':'Could not solve ')+id+' in '+Math.round((done.finishedAt-done.startedAt)/1000)+' s'+(ok?'.':': '+done.message));
 }
 async function tick(){
  if(!link||running)return;
  running=(async()=>{try{
   if(Date.now()-beat>BEAT_MS){beat=Date.now();await api('POST','/api/sync',{rows:[heartbeat()]});}
   await pull();if(!busy())await runNext();
   if(!busy()&&!learning&&![...jobs.values()].some(j=>j.status==='queued'||j.status==='running'))learnNext();
  }catch(e){if(e.status===401){log('The account link expired. Open the app on this computer, signed in, to link it again.');link=null;try{fs.unlinkSync(FILE)}catch{}}else log('Solve queue: '+e.message);}
  finally{running=null;}})();
  return running;
 }
 // The newest wanted flop not learned yet, solved in the background while this computer is idle (other work, like a
 // long calibration, keeps it waiting). A solve from the app or the queue stops it; it is tried again later.
 function learnNext(){
  if(!learn||os.loadavg()[0]/os.cpus().length>IDLE_LOAD)return;const L=require('./learn.cjs'),now=Date.now();
  const open=[...wants.entries()].filter(([,w])=>(w.status==='wanted'||w.status==='learning')&&now-(w.at||0)<WANT_DAYS*864e5).sort((a,b)=>(b[1].at||0)-(a[1].at||0));
  for(const [id,want]of open){
   try{L.check(want);}catch{wants.set(id,{...want,status:'failed',message:'Malformed.'});continue;}
   if(L.has(want)){const done={...want,status:'done'};wants.set(id,done);api('POST','/api/sync',{rows:[meta(id,done)]}).catch(()=>{});continue;}
   const started={...want,status:'learning',startedAt:now};wants.set(id,started);
   learning=(async()=>{let row={...want,status:'wanted'};try{
     await api('POST','/api/sync',{rows:[meta(id,started)]}).catch(()=>{});log('Learning flop '+want.key+' for '+want.spot.label+'.');
     const out=await learn(want);row={...want,status:'done',learnedAt:Date.now(),seconds:Math.round(out.seconds),exploitability:out.exploitability};log('Learned flop '+want.key+' in '+Math.round(out.seconds)+' s ('+out.exploitability+'% of the pot).');
    }catch(e){if(!/cancelled|already running/.test(e.message)){row={...want,status:'failed',message:e.message};log('Could not learn flop '+want.key+': '+e.message);}}
    finally{wants.set(id,row);learning=null;await api('POST','/api/sync',{rows:[meta(id,row)]}).catch(()=>{});}})();
   learning.id=id;return;
  }
 }
 function start(){if(!timer){timer=setInterval(tick,POLL_MS);timer.unref?.();}tick();}
 if(link)start();
 return{
  get user(){return link?.user||null},
  link(body){const api=String(body?.api||''),token=String(body?.token||''),user=String(body?.user||'');
   if(!/^https:\/\/[a-z0-9.-]+(:\d+)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(api.replace(/\/$/,''))||!/^[A-Za-z0-9_-]{20,100}$/.test(token)||!/^[A-Za-z0-9_-]{1,40}$/.test(user))throw Error('The account link is malformed.');
   if(link?.user!==user||link?.api!==api){cursor=0;jobs.clear();wants.clear();}link={api,token,user};beat=0;save();log('Linked to your account: solves sent from your other devices run here.');start();},
  tick
 };
}
module.exports={createQueue,progressOf};
