#!/usr/bin/env node
'use strict';
// Local bridge between the Citrus Poker web app and the solvers on this computer:
// TexasSolver's console solver for heads-up NLH, tools/multiway-solver for three-way NLH,
// tools/plo-solver for pot-limit Omaha, and the app's own engines in Node for other
// spots with three or more players.
// Listens on 127.0.0.1 only. The app posts a solve spec (studio/local-solver.js);
// the bridge validates it, writes the solver input itself, runs one solve at
// a time and returns the strategy for the current street.
//   node tools/local-solver/server.cjs [--solver path/to/console_solver] [--plo-solver path/to/plo_solver] [--mw-solver path/to/mw_solver] [--port 8787] [--threads N] [--memory MB]
//     [--name NAME --rate DOLLARS_PER_HOUR]   another computer solving for your account: it takes the jobs the app
//                                            sends to NAME (see queue.cjs; link it with link.cjs)
//     [--once job.json]                      a cloud worker: solve the one job in job.json, then exit (tools/cloud)
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process'),{Worker}=require('worker_threads');
const L=require('../../studio/local-solver.js');
const {createQueue}=require('./queue.cjs'),learn=require('./learn.cjs');

const bootAt=Date.now(),args={name:'mac',rate:0,once:'',port:8787,threads:Math.max(1,os.cpus().length-1),solver:path.join(__dirname,'TexasSolver','install','console_solver'),'plo-solver':path.join(__dirname,'..','plo-solver','plo_solver'),'mw-solver':path.join(__dirname,'..','multiway-solver','mw_solver'),timeout:1800,memory:Math.round(os.totalmem()/1048576*.7)};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=['port','threads','timeout','memory','rate'].includes(k)?Number(v):v;}
if(!/^[a-z0-9-]{1,24}$/.test(args.name))throw Error('--name takes 1 to 24 lowercase letters, digits or dashes.');
const once=args.once?JSON.parse(fs.readFileSync(args.once,'utf8')):null;
// Pages allowed to call the bridge: the Render site, and the app served from
// localhost. A file:// page sends Origin "null", which sandboxed iframes on any
// site also send, so it is allowed only when RANGE_LAB_ORIGINS lists null.
const allowed=(process.env.RANGE_LAB_ORIGINS||'https://range-lab-poker-studio.onrender.com,http://localhost,http://127.0.0.1').split(',').map(s=>s.trim()).filter(Boolean);
const originOK=o=>!o||allowed.some(a=>o===a||(/^http:\/\/(localhost|127\.0\.0\.1)$/.test(a)&&o.startsWith(a+':')));

let job=null,finished=null;
// A flop being learned (learn.cjs) runs only while nothing else wants the solver: any solve from the app or the queue
// stops it, and it is tried again later.
const busy=()=>!!job&&!job.learning;
const learnedCount=()=>{try{return (learn.library()?.spots||[]).reduce((n,s)=>n+Object.keys(s.flops).length,0);}catch{return 0;}};
async function stopLearning(){const j=job;if(!j?.learning)return;j.cancelled=true;j.child.kill('SIGKILL');await j.closed;}
// Updating from the app (POST /update here, or a 'macupdate' row from your phone): the same setup-mac.sh as the first
// install, in its own process group so it outlives the restart it ends with. Its output goes to
// ~/Library/Logs/citrus-poker-update.log.
const UPDATE_CMD='curl -fsSL https://raw.githubusercontent.com/reallemmonade/Poker_solver/main/tools/local-solver/setup-mac.sh | bash',canUpdate=process.platform==='darwin'&&args.name==='mac';let updating=0;
function selfUpdate(){
 if(!canUpdate)throw Error('Updating from the app works on a Mac only.');
 if(busy())throw Error('A solve is running on this computer. Update once it ends.');
 if(Date.now()-updating<15*60e3)return;updating=Date.now();
 const log=path.join(os.homedir(),'Library','Logs','citrus-poker-update.log'),fd=fs.openSync(log,'a');
 try{spawn('/bin/bash',['-c',UPDATE_CMD],{detached:true,stdio:['ignore',fd,fd],env:{...process.env,PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'}}).unref();}finally{fs.closeSync(fd);}
 console.log('Updating the solver. Log: '+log);
}
// A cloud worker never learns in the background: it is paid for by the second.
const queue=createQueue({port:args.port,threads:args.threads,busy,name:args.name,rate:args.rate>0?args.rate:0,bootAt,once,onIdle:once&&(()=>{console.log('Cloud job finished.');process.exit(0);}),status:()=>busy()&&{iterations:job.iterations,exploitability:job.exploitability,seconds:(Date.now()-job.started)/1000,...job.fraction!==undefined?{fraction:job.fraction,remaining:job.remaining}:{}},
 learn:once?null:want=>job?Promise.reject(Error('Another solve is already running on this computer.')):solve(learn.spec(want),true).then(out=>learn.save(want,out)),
 learnPreflop:once?null:want=>job?Promise.reject(Error('Another solve is already running on this computer.')):solvePreflop(validatePreflop({spot:want.spot,effort:'standard'}),true),stopLearning,update:canUpdate&&selfUpdate});
function headers(req){
 const o=req.headers.origin,h={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(o&&originOK(o)){h['Access-Control-Allow-Origin']=o;h['Vary']='Origin';h['Access-Control-Allow-Methods']='GET, POST, OPTIONS';h['Access-Control-Allow-Headers']='Content-Type';h['Access-Control-Allow-Private-Network']='true';}
 return h;
}
function send(req,res,code,body){res.writeHead(code,headers(req));res.end(JSON.stringify(body));}

function solve(spec,learning=false){
 return new Promise((resolve,reject)=>{
  // The solver runs in its own folder and writes result.json there; a relative
  // name keeps temp paths with spaces out of the solver's input.
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'range-lab-')),out=path.join(dir,'result.json'),file=path.join(dir,'input.txt'),plo=spec.game==='PLO4',mw=spec.game==='NLH3',own=plo||mw,bin=plo?args['plo-solver']:mw?args['mw-solver']:args.solver,name=plo?'The PLO solver':mw?'The 3-way solver':'TexasSolver';
  // The PLO and 3-way solvers stop themselves a little before the bridge's timeout and still write their result.
  fs.writeFileSync(file,own?L.input(spec,{threads:args.threads,output:'result.json',memoryMB:args.memory,timeLimit:args.timeout*.95}):L.input(spec,{threads:args.threads,output:'result.json'}));
  const started=Date.now(),child=spawn(bin,own?[file]:['-i',file,'--resource_dir',path.join(path.dirname(args.solver),'resources')],{cwd:dir});
  const mine=job={child,started,iterations:0,exploitability:null,cancelled:false,closed:null,learning};let log='',tail='';mine.closed=new Promise(r=>child.on('close',r));
  const timer=setTimeout(()=>child.kill('SIGKILL'),args.timeout*1000);
  child.stdout.on('data',d=>{log=(log+d).slice(-20000);for(const line of String(d).split(/[\r\n]+/)){let m=line.match(/^Iter: (\d+)/);if(m)mine.iterations=+m[1];m=line.match(/Total exploitability (-?[\d.]+)/);if(m)mine.exploitability=+m[1];}});
  child.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});
  child.on('error',error=>{clearTimeout(timer);if(job===mine)job=null;reject(Error('Could not start '+name+' at '+bin+': '+error.message+(own?'. Run tools/local-solver/install-mac.sh first.':'')));});
  child.on('close',code=>{
   clearTimeout(timer);const seconds=(Date.now()-started)/1000,{iterations,exploitability,cancelled}=mine;if(job===mine)job=null;
   try{
    if(code!==0||!fs.existsSync(out)){const what=(tail.match(/what\(\):\s*(.*)/)||tail.match(/Error: (.*)/)||[])[1];throw Error(cancelled?'The solve was cancelled.':code===null||code===137?'The solve was stopped (time limit or out of memory).':name+' failed'+(what?': '+what.replace(/\.$/,''):' (exit '+code+')')+'.');}
    resolve({tree:JSON.parse(fs.readFileSync(out,'utf8')),iterations,exploitability,seconds,threads:args.threads});
   }catch(error){reject(error);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
 });
}

// Multiway spots (POST /spot-async): the app's own engines run in a worker
// thread with this computer's memory and up to the bridge's time limit. The
// body is the spot, each seat's range as text, and the engine options.
function validateSpot(body){
 const ok=(v,m)=>{if(!v)throw Error(m)},d=body?.data,o=body?.options,ints=(a,n)=>Array.isArray(a)&&a.length<=n&&a.every(c=>Number.isInteger(c)&&c>=0&&c<52);
 ok(d&&typeof d==='object'&&d.config&&typeof d.config==='object','The spot is missing.');
 ok(Number.isInteger(d.actor)&&ints(d.heroCards,4)&&ints(d.board,5)&&d.board.length>=3&&Array.isArray(d.actions)&&d.actions.length<=300,'The spot is malformed.');
 ok(o&&typeof o==='object'&&Array.isArray(o.ranges)&&o.ranges.length<=9&&o.ranges.every(r=>typeof r==='string'&&r.length<=400000),'The ranges are malformed.');
 return{data:d,extra:body.extra&&typeof body.extra==='object'?body.extra:null,options:{...o,
  milliseconds:Math.min(Number(o.milliseconds)||600000,args.timeout*900),preparationMilliseconds:Math.min(args.timeout*300,300000),
  exactMemoryMB:Math.min(Number(o.exactMemoryMB)||8192,Math.round(args.memory*.6))}};
}
function solveSpot(spec){
 return new Promise((resolve,reject)=>{
  const started=Date.now(),worker=new Worker(path.join(__dirname,'spot-worker.cjs'),{workerData:spec,resourceLimits:{maxOldGenerationSizeMb:args.memory}});
  const mine=job={child:{kill:()=>worker.terminate()},started,iterations:0,exploitability:null,cancelled:false,closed:null};let outcome=null;mine.closed=new Promise(r=>worker.on('exit',r));
  const timer=setTimeout(()=>worker.terminate(),args.timeout*1000);
  worker.on('message',m=>{if(m.progress){mine.iterations=m.progress.iterations;mine.exploitability=m.progress.exploitability;}else outcome=m;});
  worker.on('error',error=>{outcome={error:/memory/i.test(error.message)?'The multiway solve ran out of memory on this computer.':error.message};});
  worker.on('exit',()=>{clearTimeout(timer);if(job===mine)job=null;
   if(mine.cancelled)return reject(Error('The solve was cancelled.'));
   if(!outcome)return reject(Error('The multiway solve was stopped (time limit or out of memory).'));
   if(outcome.error)return reject(Error(outcome.error));
   resolve({...outcome.result,seconds:(Date.now()-started)/1000});});
 });
}

// Preflop lines no chart covers (POST /preflop-async): tools/preflop/spot.cjs in its own process group, so a cancel
// also stops the 3-way solves it runs. These take minutes to hours, so they get PREFLOP_HOURS, not the usual limit.
const PREFLOP_HOURS=12;
function validatePreflop(body){
 const ok=(v,m)=>{if(!v)throw Error(m)},s=body?.spot;
 ok(s&&typeof s==='object'&&s.config&&typeof s.config==='object'&&Array.isArray(s.actions)&&s.actions.length<=60&&Number.isInteger(s.actor)&&Array.isArray(s.heroCards)&&s.heroCards.length===2&&s.heroCards.every(c=>Number.isInteger(c)&&c>=0&&c<52),'The preflop spot is malformed.');
 ok(s.actions.every(a=>a&&Number.isInteger(a.seat)&&a.street===0&&['fold','check','call','raise','bet'].includes(a.kind)&&(a.target===undefined||a.target===null||Number.isFinite(a.target))),'The preflop actions are malformed.');
 return{spot:{config:s.config,actions:s.actions.map(a=>({seat:a.seat,street:0,kind:a.kind,...Number.isFinite(a.target)?{target:a.target}:{}})),actor:s.actor,heroCards:s.heroCards},effort:['quick','standard','deep'].includes(body.effort)?body.effort:'standard'};
}
function solvePreflop(spec,learning=false){
 return new Promise((resolve,reject)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'citrus-preflop-')),input=path.join(dir,'spot.json'),out=path.join(dir,'result.json');fs.writeFileSync(input,JSON.stringify(spec.spot));
  const started=Date.now(),child=spawn(process.execPath,[path.join(__dirname,'..','preflop','spot.cjs'),input,out,'--mw-solver',args['mw-solver'],'--threads',String(args.threads),'--effort',spec.effort],{detached:true,stdio:['ignore','pipe','pipe']});
  const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
  const mine=job={child:{kill},started,iterations:0,exploitability:null,fraction:0,remaining:null,cancelled:false,closed:null,learning};let tail='';mine.closed=new Promise(r=>child.on('close',r));
  const timer=setTimeout(kill,PREFLOP_HOURS*3600e3);
  child.stdout.on('data',d=>{for(const line of String(d).split(/[\r\n]+/)){const m=line.match(/^Progress: ([\d.]+) (-?\d+)/);if(m){mine.fraction=+m[1];mine.remaining=+m[2]>=0?+m[2]:null;}else if(line.trim())console.log('Preflop solve: '+line.trim());}});
  child.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});
  child.on('error',error=>{clearTimeout(timer);if(job===mine)job=null;reject(error);});
  child.on('close',code=>{clearTimeout(timer);if(job===mine)job=null;
   try{if(mine.cancelled)throw Error('The solve was cancelled.');if(code!==0||!fs.existsSync(out))throw Error((tail.match(/Error: (.*)/)||[])[1]||'The preflop solve stopped (exit '+code+').');resolve(JSON.parse(fs.readFileSync(out,'utf8')));}
   catch(error){reject(error);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
 });
}

const server=http.createServer((req,res)=>{
 if(req.headers.origin&&!originOK(req.headers.origin))return send(req,res,403,{error:'This page is not allowed to use the local solver. Add its origin to RANGE_LAB_ORIGINS.'});
 if(req.method==='OPTIONS'){res.writeHead(204,headers(req));return res.end();}
 if(req.method==='GET'&&req.url==='/health')return send(req,res,200,{ok:true,update:canUpdate,solver:fs.existsSync(args.solver),ploSolver:fs.existsSync(args['plo-solver']),mwSolver:fs.existsSync(args['mw-solver']),threads:args.threads,memoryMB:args.memory,load:Math.round(os.loadavg()[0]/os.cpus().length*100)/100,busy:busy(),learning:!!job?.learning,learnedFlops:learnedCount(),spot:true,preflop:true,linkedUser:queue.user,version:1});
 // The app on this computer links the bridge to the signed-in account, so solves queued from other devices run here.
 if(req.method==='POST'&&req.url==='/link'){let body='';req.on('data',d=>{body+=d;if(body.length>4000)req.destroy();});req.on('end',()=>{try{queue.link(JSON.parse(body));send(req,res,200,{ok:true});}catch(error){send(req,res,400,{error:error.message});}});return;}
 if(req.method==='GET'&&req.url==='/status')return send(req,res,200,busy()?{busy:true,iterations:job.iterations,exploitability:job.exploitability,seconds:(Date.now()-job.started)/1000,...job.fraction!==undefined?{fraction:job.fraction,remaining:job.remaining}:{}}:{busy:false});
 if(req.method==='POST'&&req.url==='/update'){try{selfUpdate();send(req,res,202,{updating:true});}catch(error){send(req,res,409,{error:error.message});}return;}
 if(req.method==='POST'&&req.url==='/cancel'){if(!busy())return send(req,res,200,{ok:true});const j=job;j.cancelled=true;j.child.kill('SIGKILL');j.closed.then(()=>send(req,res,200,{ok:true}));return;}
 // A background solve's outcome, collected once: 202 while it runs.
 // The flops this computer learned, as one postflop library for the app here.
 if(req.method==='GET'&&req.url==='/learned'){let lib=null;try{learn.refresh();lib=learn.library();}catch(error){return send(req,res,500,{error:error.message});}return send(req,res,200,lib||{none:true});}
 if(req.method==='GET'&&req.url==='/result'){if(busy())return send(req,res,202,{busy:true});if(!finished)return send(req,res,404,{error:'No finished solve to collect.'});const f=finished;finished=null;return f.error?send(req,res,500,{error:f.error}):send(req,res,200,f.result);}
 if(req.method==='POST'&&(req.url==='/solve'||req.url==='/solve-async'||req.url==='/spot-async'||req.url==='/preflop-async')){
  if(busy())return send(req,res,409,{error:'Another solve is already running on this computer.'});
  const multiway=req.url==='/spot-async';let body='';req.on('data',d=>{body+=d;if(body.length>(multiway?2e7:2e6))req.destroy();});
  req.on('end',async()=>{
   const preflop=req.url==='/preflop-async';let spec;try{spec=preflop?validatePreflop(JSON.parse(body)):multiway?validateSpot(JSON.parse(body)):L.validate(JSON.parse(body));}catch(error){return send(req,res,400,{error:error.message});}
   // Checked again here: two requests can both pass the check above before
   // either body has arrived. A flop being learned gives way.
   await stopLearning();
   if(job)return send(req,res,409,{error:'Another solve is already running on this computer.'});
   // /solve-async answers at once and keeps the outcome for GET /result, so a
   // solve of many minutes needs no long-open request.
   if(preflop){finished=null;solvePreflop(spec).then(result=>{finished={result};},error=>{finished={error:error.message};});return send(req,res,202,{started:true});}
   if(multiway){finished=null;solveSpot(spec).then(result=>{finished={result};},error=>{finished={error:error.message};});return send(req,res,202,{started:true});}
   if(req.url==='/solve-async'){finished=null;solve(spec).then(result=>{finished={result};},error=>{finished={error:error.message};});return send(req,res,202,{started:true});}
   try{send(req,res,200,await solve(spec));}catch(error){send(req,res,500,{error:error.message});}
  });
  return;
 }
 send(req,res,404,{error:'Not found.'});
});
server.requestTimeout=0;server.headersTimeout=60000;
server.listen(args.port,'127.0.0.1',()=>{
 console.log('Citrus Poker local solver listening on http://127.0.0.1:'+args.port+' with '+args.threads+' threads.');
 if(!fs.existsSync(args.solver))console.log('Warning: TexasSolver (NLH) was not found at '+args.solver+'. Run tools/local-solver/install-mac.sh first.');
 if(!fs.existsSync(args['plo-solver']))console.log('Warning: the PLO solver was not found at '+args['plo-solver']+'. Run tools/local-solver/install-mac.sh first.');
 if(!fs.existsSync(args['mw-solver']))console.log('Warning: the 3-way solver was not found at '+args['mw-solver']+'. Run tools/local-solver/install-mac.sh first.');
});
