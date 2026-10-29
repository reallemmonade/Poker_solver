'use strict';
// Runs one solve from the account queue (queue.cjs) with the app's own solver code: the spot goes to this
// bridge's endpoints (TexasSolver, the PLO solver, or the multiway engines), exactly as from the app here.
// A heads-up flop this computer has learned (learn.cjs) is answered from the learned flops at once instead.
const {parentPort,workerData}=require('worker_threads'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const S=require('../../studio/spot-solver.js');
const {observed,options,extraAction,url,learned}=workerData,sleep=ms=>new Promise(r=>setTimeout(r,ms));
// The learned flop's answer, as the app's own library lookup gives it, or null. Ranges come from the same built-in
// charts the app uses (studio/libraries), so only an exact flop of a spot whose ranges still match answers.
function learnedAnswer(){
 if(!learned||extraAction||observed.board.length!==3||observed.config.variant!=='NLH')return null;
 const Learn=require('./learn.cjs'),lib=Learn.library();if(!lib)return null;
 const G=require('../../studio/game.js'),P=require('../../studio/preflop.js'),Lib=require('../../studio/postflop-library.js'),dir=path.join(__dirname,'..','..','studio','libraries');
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')),c=observed.config;
 const packs=manifest.packs.filter(p=>p.variant===c.variant&&p.seats===c.seats).map(p=>{try{return P.validate(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,p.file)))));}catch{return null;}}).filter(Boolean);
 const hand=G.replay(c,observed.actions,{holes:{[observed.actor]:observed.heroCards},runout:observed.board});
 if(hand.actor!==observed.actor||hand.board.join()!==observed.board.join())return null;
 const q=Lib.query([lib],P.postflopRanges(packs,c,observed.actions),hand);
 return q&&!q.solve.library.standIn?q:null;
}
(async()=>{
 try{
  let hit=null;try{hit=learnedAnswer();}catch{}
  if(hit)return parentPort.postMessage({result:hit});
  const solver=new S.Solver(null,observed,{...options,localSolver:url,forceLocal:true},extraAction||null);
  while(!solver.complete){if(solver.waiting){await sleep(500);continue;}solver.step();}
  parentPort.postMessage({result:solver.result()});
 }catch(error){parentPort.postMessage({error:error.message});}
 finally{process.exit(0);}
})();
