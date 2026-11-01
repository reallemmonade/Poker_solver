#!/usr/bin/env node
'use strict';
// End-to-end check of cloud solves without Modal: a local account server, a Mac bridge linked to the account, and the
// bridge in --once mode standing in for the Modal container (tools/cloud/modal_app.py runs exactly that command).
//  1. A job sent to the cloud is solved by the --once worker, which pushes progress, the answer and what it cost;
//     the Mac bridge on the same account leaves it alone.
//  2. A cloud job cancelled from the phone stops the worker at its next progress check, and it exits.
// Needs TexasSolver built (tools/local-solver/install-linux.sh).
//   node tools/cloud/test-cloud.cjs
const fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const ROOT=path.join(__dirname,'..','..'),G=require(ROOT+'/studio/game.js'),S=require(ROOT+'/studio/spot-solver.js');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-check-')),port=10400+Math.floor(Math.random()*300),api='http://127.0.0.1:'+port;
let fail=0;const ok=(c,m)=>{if(!c)fail++;console.log((c?'ok   ':'FAIL ')+m);},sleep=ms=>new Promise(r=>setTimeout(r,ms)),kids=[];
const run=(args,env={})=>{const p=spawn(process.execPath,args,{cwd:ROOT,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.log=()=>out;kids.push(p);return p;};
async function call(method,route,body,token){const r=await fetch(api+route,{method,headers:{'Content-Type':'application/json',...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined});const b=await r.json();if(!r.ok)throw Error(route+': '+(b.error||r.status));return b;}
async function rows(token){let since=0,all=[];for(;;){const p=await call('GET','/api/sync?since='+since,null,token);all=all.concat(p.rows);since=p.cursor;if(!p.more)return{all,cursor:since};}}
const metaRow=(token,id)=>rows(token).then(r=>r.all.filter(x=>x.store==='meta'&&x.id===id).pop()?.data.value);
// A heads-up spot checked down to the river (or only to the flop), fixed cards, small ranges both sides.
function spot(street,ranges){let seed=11;const rng=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const c=G.normalize({variant:'NLH',seats:2,button:0,stacks:[100,100],sb:.5,bb:1}),h=new G.Hand(c,{rng});
 for(const k of['call','check','check','check','check','check'].slice(0,street===3?6:2))h.act({kind:k});
 const mine=G.Core.handClass(h.holes[h.actor]);ranges+=','+mine;
 const options=S.options({ranges:[ranges,ranges],rangeMode:'auto',forceLocal:true,localAccuracy:street===3?.5:.05,localIterations:street===3?200:5000,bridgeMilliseconds:1.8e6,approximate:false});
 return{observed:{config:h.config,actor:h.actor,heroCards:h.holes[h.actor],board:h.board,actions:h.actionLog},options};}
function job(id,street,ranges){const {observed,options}=spot(street,ranges);return{v:1,status:'queued',key:id+'-key',rowId:'spot-'+id,baseKey:id,observed,options,extraAction:null,seconds:30,seed:30,device:'test',street,kind:'nlh',learned:false,createdAt:Date.now(),target:'modal',rate:.441};}
async function cloud(token,user,id,value,cursor){const t=Date.now();await call('POST','/api/sync',{rows:[{store:'meta',id,t,data:{id,value}}]},token);
 const file=path.join(work,id+'.json');fs.writeFileSync(file,JSON.stringify({id,job:value,t,cursor,link:{api,token,user}}));
 return run(['tools/local-solver/server.cjs','--name','modal','--rate','0.441','--once',file,'--port',String(port+400+Math.floor(Math.random()*90)),'--threads','4'],{CITRUS_BRIDGE_LINK:path.join(work,id+'-link.json')});}
(async()=>{
 try{
  run(['server.cjs'],{PORT:String(port),ACCOUNTS_IN_MEMORY:'1',RENDER:''});
  for(let i=0;i<50;i++){try{await call('GET','/api/health');break;}catch{await sleep(200);}}
  const {token,user}=await call('POST','/api/auth/signup',{username:'cloudcheck',email:'cloud@example.com',password:'password123'});
  // The Mac's bridge, linked to the same account: it must leave cloud jobs alone.
  fs.writeFileSync(path.join(work,'mac-link.json'),JSON.stringify({api,token,user:user.id,cursor:0}));
  const mac=run(['tools/local-solver/server.cjs','--port',String(port+300)],{CITRUS_BRIDGE_LINK:path.join(work,'mac-link.json')});
  const {cursor}=await rows(token);
  const river=await cloud(token,user.id,'solvejob-river',job('river',3,'AA,KK,QQ,JJ,AK,AQs,KQs,QJs,JTs,T9s,98s'),cursor);
  const code=await new Promise(r=>river.on('exit',r));
  const done=await metaRow(token,'solvejob-river'),answer=(await rows(token)).all.find(x=>x.store==='solves'&&x.id==='spot-river');
  ok(code===0&&done?.status==='done','the cloud worker solved the river job and exited ('+(done?.status||'no job')+', exit '+code+')'+(done?.status==='done'?'':'\n'+river.log()));
  ok(done?.worker==='modal'&&done.cost>0&&done.cost<.01,'the job says the cloud solved it and what it cost ($'+done?.cost+')');
  ok(answer?.data?.result?.supported===true,'the answer is saved where the phone looks for it');
  ok(!/Solving a spot sent from your account/.test(mac.log()),'the Mac bridge left the cloud job alone');
  // Cancel: a wide flop that runs well past the first progress report.
  const flop=await cloud(token,user.id,'solvejob-flop',job('flop',1,'22+,A2s+,K2s+,Q2s+,J5s+,T6s+,96s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o'),(await rows(token)).cursor);
  let running=null;for(let i=0;i<90&&!running?.progress;i++){await sleep(1000);running=await metaRow(token,'solvejob-flop');}
  ok(running?.status==='running'&&running.progress&&running.cost>0,'a running cloud job reports progress and its cost so far ($'+running?.cost+')');
  await call('POST','/api/sync',{rows:[{store:'meta',id:'solvejob-flop',t:Date.now(),data:{id:'solvejob-flop',value:{...running,status:'cancelled',cancelledAt:Date.now()}}}]},token);
  const t0=Date.now(),exit=await Promise.race([new Promise(r=>flop.on('exit',r)),sleep(40000).then(()=>'timeout')]);
  ok(exit!=='timeout','the worker stopped '+Math.round((Date.now()-t0)/1000)+' s after the cancel');
  ok((await metaRow(token,'solvejob-flop'))?.status==='cancelled','the job stays cancelled');
 }catch(e){fail++;console.log('FAIL '+e.stack);}
 finally{for(const k of kids)try{k.kill('SIGKILL')}catch{}fs.rmSync(work,{recursive:true,force:true});}
 console.log(fail?fail+' check(s) failed.':'All cloud checks passed.');process.exit(fail?1:0);
})();
