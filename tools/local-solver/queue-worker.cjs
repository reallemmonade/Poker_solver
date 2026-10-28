'use strict';
// Runs one solve from the account queue (queue.cjs) with the app's own solver code: the spot goes to this
// bridge's endpoints (TexasSolver, the PLO solver, or the multiway engines), exactly as from the app here.
const {parentPort,workerData}=require('worker_threads');
const S=require('../../studio/spot-solver.js');
const {observed,options,extraAction,url}=workerData,sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 try{
  const solver=new S.Solver(null,observed,{...options,localSolver:url,forceLocal:true},extraAction||null);
  while(!solver.complete){if(solver.waiting){await sleep(500);continue;}solver.step();}
  parentPort.postMessage({result:solver.result()});
 }catch(error){parentPort.postMessage({error:error.message});}
 process.exit(0);
})();
