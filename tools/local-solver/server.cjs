#!/usr/bin/env node
'use strict';
// Local bridge between the Range Lab web app and TexasSolver's console solver.
// Listens on 127.0.0.1 only. The app posts a solve spec (studio/local-solver.js);
// the bridge validates it, writes the solver commands itself, runs one solve at
// a time and returns the dumped strategy for the current street.
//   node tools/local-solver/server.cjs [--solver path/to/console_solver] [--port 8787] [--threads N]
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const L=require('../../studio/local-solver.js');

const args={port:8787,threads:Math.max(1,os.cpus().length-1),solver:path.join(__dirname,'TexasSolver','install','console_solver'),timeout:1800};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=['port','threads','timeout'].includes(k)?Number(v):v;}
// Pages allowed to call the bridge: the Render site, and the app opened locally.
const allowed=(process.env.RANGE_LAB_ORIGINS||'https://range-lab-poker-studio.onrender.com,http://localhost,http://127.0.0.1,null').split(',').map(s=>s.trim()).filter(Boolean);
const originOK=o=>!o||allowed.some(a=>o===a||(/^http:\/\/(localhost|127\.0\.0\.1)$/.test(a)&&o.startsWith(a+':')));

let job=null;
function headers(req){
 const o=req.headers.origin,h={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(o&&originOK(o)){h['Access-Control-Allow-Origin']=o;h['Vary']='Origin';h['Access-Control-Allow-Methods']='GET, POST, OPTIONS';h['Access-Control-Allow-Headers']='Content-Type';h['Access-Control-Allow-Private-Network']='true';}
 return h;
}
function send(req,res,code,body){res.writeHead(code,headers(req));res.end(JSON.stringify(body));}

function solve(spec){
 return new Promise((resolve,reject)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'range-lab-')),out=path.join(dir,'result.json'),file=path.join(dir,'input.txt');
  fs.writeFileSync(file,L.input(spec,{threads:args.threads,output:out}));
  const started=Date.now(),child=spawn(args.solver,['-i',file,'--resource_dir',path.join(path.dirname(args.solver),'resources')],{cwd:dir});
  job={child,started,iterations:0,exploitability:null};let log='',tail='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),args.timeout*1000);
  child.stdout.on('data',d=>{log=(log+d).slice(-20000);for(const line of String(d).split(/[\r\n]+/)){let m=line.match(/^Iter: (\d+)/);if(m)job.iterations=+m[1];m=line.match(/Total exploitability (-?[\d.]+)/);if(m)job.exploitability=+m[1];}});
  child.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});
  child.on('error',error=>{clearTimeout(timer);reject(Error('Could not start TexasSolver at '+args.solver+': '+error.message));});
  child.on('close',code=>{
   clearTimeout(timer);const seconds=(Date.now()-started)/1000,{iterations,exploitability}=job;job=null;
   try{
    if(code!==0||!fs.existsSync(out)){const what=(tail.match(/what\(\):\s*(.*)/)||[])[1];throw Error(code===null||code===137?'The solve was stopped (time limit or out of memory).':'TexasSolver failed'+(what?': '+what:' (exit '+code+')')+'.');}
    resolve({tree:JSON.parse(fs.readFileSync(out,'utf8')),iterations,exploitability,seconds,threads:args.threads});
   }catch(error){reject(error);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
 });
}

const server=http.createServer((req,res)=>{
 if(req.headers.origin&&!originOK(req.headers.origin))return send(req,res,403,{error:'This page is not allowed to use the local solver. Add its origin to RANGE_LAB_ORIGINS.'});
 if(req.method==='OPTIONS'){res.writeHead(204,headers(req));return res.end();}
 if(req.method==='GET'&&req.url==='/health')return send(req,res,200,{ok:true,solver:fs.existsSync(args.solver),threads:args.threads,busy:!!job,version:1});
 if(req.method==='GET'&&req.url==='/status')return send(req,res,200,job?{busy:true,iterations:job.iterations,exploitability:job.exploitability,seconds:(Date.now()-job.started)/1000}:{busy:false});
 if(req.method==='POST'&&req.url==='/cancel'){if(job)job.child.kill('SIGKILL');return send(req,res,200,{ok:true});}
 if(req.method==='POST'&&req.url==='/solve'){
  if(job)return send(req,res,409,{error:'Another solve is already running on this computer.'});
  let body='';req.on('data',d=>{body+=d;if(body.length>2e6)req.destroy();});
  req.on('end',async()=>{
   let spec;try{spec=L.validate(JSON.parse(body));}catch(error){return send(req,res,400,{error:error.message});}
   try{send(req,res,200,await solve(spec));}catch(error){send(req,res,500,{error:error.message});}
  });
  return;
 }
 send(req,res,404,{error:'Not found.'});
});
server.requestTimeout=0;server.headersTimeout=60000;
server.listen(args.port,'127.0.0.1',()=>{
 console.log('Range Lab local solver listening on http://127.0.0.1:'+args.port+' with '+args.threads+' threads.');
 if(!fs.existsSync(args.solver))console.log('Warning: TexasSolver was not found at '+args.solver+'. Run tools/local-solver/install-mac.sh first.');
});
