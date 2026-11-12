#!/usr/bin/env node
'use strict';
// Checks the bridge with a stand-in solver (no TexasSolver needed): overlapping
// solves get 409 and the bridge stays up, cancel frees it at once, Origin null
// is refused, a temp folder with a space works, bad hand classes get 400, and action EVs
// go only to an app that asks for them (an older app gets the old reply and a frequency grade).
//   node tools/local-solver/check-bridge.cjs
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'bridge check ')),fake=path.join(work,'console_solver');fs.mkdirSync(path.join(work,'resources'));
fs.writeFileSync(fake,`#!/bin/bash
out=$(grep '^dump_result' "$2" | cut -d' ' -f2-)
echo "Iter: 1"; sleep 2
echo '{"node_type":"action_node","actions":["CHECK"],"player":1,"strategy":{"actions":["CHECK"],"strategy":{"AsKd":[1]}}}' > "$out"
`,{mode:0o755});
const sizes={};for(const w of ['ip','oop'])sizes[w]={flop:{bet:[33],raise:[66],donk:[]},turn:{bet:[66],raise:[],donk:[]},river:{bet:[75],raise:[],donk:[]}};
const spec={version:1,board:['Qs','Jh','2h'],pot:550,stack:9750,sizes,allinThreshold:.67,rangeIp:{AA:1,AKo:1},rangeOop:{KK:1,AKo:1},path:[],hero:'AsKd',heroSeat:2,heroIsIp:false,accuracy:1,maxIterations:50};
const port=8790+Math.floor(Math.random()*9),srv=spawn(process.execPath,[path.join(__dirname,'server.cjs'),'--solver',fake,'--port',String(port)],{env:{...process.env,TMPDIR:work},stdio:'ignore'});
let died=false,fail=0;srv.on('exit',()=>{died=true;});
const post=(p,b,h={})=>fetch('http://127.0.0.1:'+port+p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b)}).then(async r=>[r.status,await r.json()]);
const ok=(c,m)=>{if(!c)fail++;console.log((c?'ok   ':'FAIL ')+m);};
(async()=>{
 try{
  await new Promise(r=>setTimeout(r,800));
  const [a,b]=await Promise.all([post('/solve',spec),new Promise(r=>setTimeout(r,50)).then(()=>post('/solve',spec))]);
  ok(a[0]===200&&a[1].tree&&b[0]===409,'overlapping solves: the first runs ('+a[0]+'), the second gets 409 ('+b[0]+'), in a temp folder with a space');
  ok(!died,'the bridge is still up');
  const p=post('/solve',spec);await new Promise(r=>setTimeout(r,300));await post('/cancel',{});const c=await p,d=await post('/solve',spec);
  ok(c[0]===500&&/cancelled/.test(c[1].error)&&d[0]===200,'a cancelled solve says so, and the next one starts at once');
  ok((await post('/solve',spec,{Origin:'null'}))[0]===403,'Origin null is refused');
  ok((await post('/solve',{...spec,rangeIp:{AAs:1}}))[0]===400&&(await post('/solve',{...spec,rangeIp:{KAs:1}}))[0]===400,'invalid hand classes get 400');
  // Action EVs are opt-in. An app from before chip-EV grading sends no actionEVs flag: against a solver that reports
  // action EVs it must get, byte for byte, what a bridge with a solver from before them returns, and its answer must
  // grade on frequency. Otherwise the bridge's own copy of the app code (queue jobs, the cloud) would hand that app
  // EVs it takes for an unusable estimate, and the decision would go ungraded. The solver here is the solve-flow
  // stand-in, which reports EVs even when told not to; with FAKE_TEXASSOLVER_NO_EVS=1 it is a solver from before them.
  srv.kill();await new Promise(r=>setTimeout(r,300));
  const G=require('../../studio/game.js'),S=require('../../studio/spot-solver.js'),T=require('../../studio/trainer.js'),C=G.Core,standIn=path.join(__dirname,'..','solve-flow','fake-texassolver.cjs');fs.chmodSync(standIn,0o755);
  const config=G.normalize({variant:'NLH',seats:2,stacks:[100,100]}),h=new G.Hand(config,{holes:{0:C.cards('AhAd'),1:C.cards('AsKd')},runout:C.cards('QsJh2h3c4d'),rng:G.rng(1)});h.act({kind:'raise',target:250});h.act({kind:'call'});
  const data={config,actor:h.actor,heroCards:h.holes[h.actor],board:h.board,actions:h.actionLog},shape=x=>Object.keys(x).join();
  // What the bridge returns for one request, and the answer the bridge's own app code makes of the same spot (as a
  // queue or cloud job does), for an app that asks for action EVs (ask) or not.
  const run=async(env,ask)=>{
   const b=spawn(process.execPath,[path.join(__dirname,'server.cjs'),'--solver',standIn,'--port',String(port+10),'--threads','1'],{env:{...process.env,TMPDIR:work,CITRUS_BRIDGE_LINK:path.join(work,'no-link.json'),...env},stdio:'ignore'});
   try{await new Promise(r=>setTimeout(r,800));const url='http://127.0.0.1:'+(port+10),raw=await fetch(url+'/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...spec,...ask?{actionEVs:true}:{}})}).then(r=>r.json());
    const solver=new S.Solver(null,data,{ranges:['AA,76s','AKo,QQ'],localSolver:url,forceLocal:true,...ask?{actionEVs:true}:{}});while(!solver.complete){if(solver.waiting){await new Promise(r=>setTimeout(r,200));continue;}solver.step();}
    const result=solver.result();if(result.solve)result.solve.seconds=0;return{raw,result};
   }finally{b.kill();await new Promise(r=>setTimeout(r,300));}};
  const before=await run({FAKE_TEXASSOLVER_NO_EVS:'1'},false),old=await run({},false),asked=await run({},true);
  ok(old.raw.tree&&JSON.stringify(old.raw.tree)===JSON.stringify(before.raw.tree)&&shape(old.raw)==='tree,iterations,exploitability,seconds,threads'&&shape(old.raw)===shape(before.raw)&&!/action_evs|actionEvs/.test(JSON.stringify(old.raw)),'a request without the actionEVs flag gets the reply of a bridge from before action EVs, byte for byte ('+JSON.stringify(old.raw.tree||'').length+' bytes)');
  ok(old.result.supported&&JSON.stringify(old.result)===JSON.stringify(before.result)&&old.result.mean.every(x=>x===0)&&old.result.loss.every(x=>x===0)&&!('evAvailable' in old.result.solve)&&!('evSkipped' in old.result.solve)&&!('reliable' in old.result)&&!/"ev"|evHero|evKind/.test(JSON.stringify(old.result.solve.tree||{})),'a queue or cloud job from an app without the flag gets the old answer, byte for byte: EVs all 0, no EV fields, none in the kept tree');
  ok(!T.assessmentEvidence(old.result).usable&&old.result.reference.every(Number.isFinite)&&Math.abs(old.result.reference.reduce((a,b)=>a+b,0)-1)<1e-9,'that answer grades on frequency ('+old.result.reference.map(x=>(100*x).toFixed(0)+'%').join(' / ')+')');
  ok(asked.raw.actionEvs===true&&asked.raw.tree.action_evs&&asked.raw.tree.action_evs_kind==='average'&&asked.result.solve.evAvailable===true&&T.assessmentEvidence(asked.result).usable&&asked.result.mean.some(x=>x!==0)&&JSON.stringify(asked.result.reference)===JSON.stringify(old.result.reference),'the same request with the flag gets the action EVs and grades on EV, with the same frequencies');
 }finally{srv.kill();fs.rmSync(work,{recursive:true,force:true});}
 console.log(fail?fail+' check(s) failed.':'All bridge checks passed.');process.exit(fail?1:0);
})();
