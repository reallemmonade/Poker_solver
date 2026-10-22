#!/usr/bin/env node
'use strict';
// Checks the bridge with a stand-in solver (no TexasSolver needed): overlapping
// solves get 409 and the bridge stays up, cancel frees it at once, Origin null
// is refused, a temp folder with a space works, and bad hand classes get 400.
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
 }finally{srv.kill();fs.rmSync(work,{recursive:true,force:true});}
 console.log(fail?fail+' check(s) failed.':'All bridge checks passed.');process.exit(fail?1:0);
})();
