'use strict';
// Runs one multiway spot solve for the bridge (server.cjs, POST /spot-async)
// with the app's own engines (studio/spot-solver.js) and Node-sized budgets.
const {parentPort,workerData}=require('worker_threads');
const S=require('../../studio/spot-solver.js');
const {data,options,extra}=workerData;
try{
 // bridge:true lifts the browser caps; localSolver is cleared so the engine
 // never calls back into this bridge.
 const solver=new S.Solver(null,data,{...options,bridge:true,approximate:true,localSolver:'',forceLocal:false},extra||null);
 let last=0;
 while(!solver.complete){
  solver.step();
  const now=Date.now();if(now-last>1000){last=now;const p=solver.progress();parentPort.postMessage({progress:{iterations:p.done||0,exploitability:p.gap??null}});}
 }
 parentPort.postMessage({result:solver.result()});
}catch(error){parentPort.postMessage({error:error.message});}
