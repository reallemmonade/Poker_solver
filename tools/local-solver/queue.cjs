'use strict';
// Solves sent from your other devices. A phone can't reach this bridge, so it queues a spot in your account
// instead: a 'solvejob-<hash>' meta row holding the spot, its ranges and the solve options (studio/spot-ui.js,
// sendToMac). Once the app on this computer has linked the bridge to your account (POST /link), the bridge pulls
// your account's changes every 20 seconds, solves queued spots one at a time through its own endpoints, and
// pushes each answer back as the saved spot the phone looks for, then marks the job done or failed. Every few
// minutes it also pushes a 'macsolver' heartbeat (last seen, threads, load) so the phone can say whether this
// computer is online and busy.
const fs=require('fs'),os=require('os'),path=require('path'),{Worker}=require('worker_threads');
const FILE=process.env.CITRUS_BRIDGE_LINK||path.join(os.homedir(),'.citrus-poker-bridge.json'),POLL_MS=20000,BEAT_MS=180000;

function createQueue({port,threads,busy,log=console.log}){
 let link=null,cursor=0,running=null,timer=null,beat=0;const jobs=new Map();
 try{const saved=JSON.parse(fs.readFileSync(FILE,'utf8'));if(saved?.api&&saved?.token){link=saved;cursor=Number(saved.cursor)||0;}}catch{}
 const save=()=>{try{fs.writeFileSync(FILE,JSON.stringify({...link,cursor}),{mode:0o600});}catch(e){log('Could not save the account link: '+e.message);}};
 async function api(method,route,body){
  const r=await fetch(link.api.replace(/\/$/,'')+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+link.token},body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.error||'Account service error '+r.status),{status:r.status});return data;
 }
 const meta=(id,value)=>({store:'meta',id,t:Date.now(),data:{id,value}});
 async function pull(){
  for(;;){const page=await api('GET','/api/sync?since='+cursor);
   for(const r of page.rows)if(r.store==='meta'&&/^solvejob-/.test(r.id)&&r.data?.value&&typeof r.data.value==='object')jobs.set(r.id,{...r.data.value,t:r.t});
   cursor=page.cursor;if(!page.more)break;}
  save();
 }
 function solve(job){
  return new Promise(resolve=>{
   const worker=new Worker(path.join(__dirname,'queue-worker.cjs'),{workerData:{observed:job.observed,options:job.options,extraAction:job.extraAction,url:'http://127.0.0.1:'+port}});let out=null;
   worker.on('message',m=>{out=m;});worker.on('error',e=>{out={error:e.message};});worker.on('exit',()=>resolve(out||{error:'The solve stopped without an answer.'}));
  });
 }
 async function runNext(){
  // Only this bridge runs queued solves, one at a time, so a job still marked running here was cut off by a restart.
  const next=[...jobs.entries()].filter(([,j])=>j.status==='queued'||j.status==='running').sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0))[0];if(!next)return;
  const [id,job]=next,started={...job,status:'running',startedAt:Date.now()};delete started.t;jobs.set(id,started);
  await api('POST','/api/sync',{rows:[meta(id,started)]});log('Solving a spot sent from your account ('+id+').');
  const out=await solve(job),result=out.result;
  // A solve started from the app on this computer meanwhile holds the solver: try again on the next round.
  if(!result&&/already running/.test(out.error||'')||result&&!result.supported&&/already running/.test(result.message||'')){jobs.set(id,job);await api('POST','/api/sync',{rows:[meta(id,{...job,status:'queued'})]});return;}
  const ok=result?.supported===true,rows=[],{t:_,...base}=job,done={...base,status:ok?'done':'failed',startedAt:started.startedAt,finishedAt:Date.now(),message:ok?undefined:(out.error||result?.message||'No answer.').replace(/^Local solver: /,'')};
  if(ok)rows.push({store:'solves',id:job.rowId,t:Date.now(),data:{id:job.rowId,key:job.key,result,observed:job.observed,options:job.options,extraAction:job.extraAction||null,updatedAt:new Date().toISOString()}});
  rows.push(meta(id,done));jobs.set(id,done);await api('POST','/api/sync',{rows});log((ok?'Solved ':'Could not solve ')+id+' in '+Math.round((done.finishedAt-done.startedAt)/1000)+' s'+(ok?'.':': '+done.message));
 }
 async function tick(){
  if(!link||running)return;
  running=(async()=>{try{
   if(Date.now()-beat>BEAT_MS){beat=Date.now();await api('POST','/api/sync',{rows:[meta('macsolver',{seen:Date.now(),threads,load:Math.round(os.loadavg()[0]/os.cpus().length*100)/100,busy:busy()})]});}
   await pull();if(!busy())await runNext();
  }catch(e){if(e.status===401){log('The account link expired. Open the app on this computer, signed in, to link it again.');link=null;try{fs.unlinkSync(FILE)}catch{}}else log('Solve queue: '+e.message);}
  finally{running=null;}})();
  return running;
 }
 function start(){if(!timer){timer=setInterval(tick,POLL_MS);timer.unref?.();}tick();}
 if(link)start();
 return{
  get user(){return link?.user||null},
  link(body){const api=String(body?.api||''),token=String(body?.token||''),user=String(body?.user||'');
   if(!/^https:\/\/[a-z0-9.-]+(:\d+)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(api.replace(/\/$/,''))||!/^[A-Za-z0-9_-]{20,100}$/.test(token)||!/^[A-Za-z0-9_-]{1,40}$/.test(user))throw Error('The account link is malformed.');
   if(link?.user!==user||link?.api!==api)cursor=0;link={api,token,user};beat=0;save();log('Linked to your account: solves sent from your other devices run here.');start();},
  tick
 };
}
module.exports={createQueue};
