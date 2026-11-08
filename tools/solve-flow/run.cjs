#!/usr/bin/env node
'use strict';
// Solve-flow player: plays real hands in the real app against a local copy of everything a solve passes through, and
// fails when the solve flow misbehaves. Nothing here touches production: the account server runs in memory on
// 127.0.0.1, the Mac is the real bridge (tools/local-solver/server.cjs) linked to that account with a stand-in
// TexasSolver (fake-texassolver.cjs) and the real 3-way solver cut to a few iterations (fast-mw-solver.cjs), and the cloud is the same bridge started in --once mode
// for each job, the way the Modal worker runs it. Every other outside request from the page is blocked.
//
// For each hand it reads the app's own hand trace (studio/hand-trace.js) and fails on:
//   - the same decision solved more than once,
//   - a solve that finished but was never shown or used to grade,
//   - a solve still queued or running long after the hand ended,
//   - a page error.
//
//   node tools/solve-flow/run.cjs [--hands 12] [--tables hu,3way] [--seed 7] [--headed] [--keep]
// Writes every trace and a summary to solve-flow-report/ (git-ignored). Needs Playwright with Chromium, a C++
// compiler for the 3-way solver, and the repo's npm install.
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),{spawn,execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'../..'),args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true;};
const HANDS=Number(opt('hands',12)),TABLES=String(opt('tables','hu,3way')).split(','),SEED=Number(opt('seed',7)),out=path.join(repo,'solve-flow-report'),work=fs.mkdtempSync(path.join(os.tmpdir(),'solve-flow-'));
const CLOUD_URL='https://maxam-lemmon--guava-solver-web.us-east.modal.run';
fs.mkdirSync(out,{recursive:true});
const children=[];const log=(...a)=>console.log('['+new Date().toISOString().slice(11,19)+']',...a);
function start(name,argv,env){const p=spawn(process.execPath,argv,{cwd:repo,env,stdio:['ignore','pipe','pipe']});const file=fs.createWriteStream(path.join(out,name+'.log'));p.stdout.pipe(file);p.stderr.pipe(file);children.push(p);return p;}
const freePort=()=>new Promise(r=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
async function until(fn,ms,what){const end=Date.now()+ms;for(;;){const v=await fn().catch(()=>null);if(v)return v;if(Date.now()>end)throw Error('Timed out: '+what);await new Promise(r=>setTimeout(r,250));}}
// A clean environment: no database keys, so nothing can reach the production Turso database.
const cleanEnv=()=>{const e={...process.env};for(const k of Object.keys(e))if(/^(TURSO_|DATABASE_URL|RENDER|BREVO_|RESEND_|MULTIPLAYER_API_ORIGIN)/.test(k))delete e[k];return e;};

function compile(){
 const mw=path.join(repo,'tools/multiway-solver/mw_solver');
 if(!fs.existsSync(mw)){log('Building the 3-way solver…');execFileSync('g++',['-O3','-std=c++17','-pthread','-o',mw,path.join(repo,'tools/multiway-solver/mw_solver.cpp')],{stdio:'inherit'});}
 const eq=path.join(repo,'tools/preflop/equity3');
 if(!fs.existsSync(eq)){log('Building the preflop 3-way equity tool…');execFileSync('g++',['-O3','-std=c++17','-pthread','-o',eq,path.join(repo,'tools/preflop/equity3.cpp')],{stdio:'inherit'});}
 for(const f of ['fake-texassolver.cjs','fast-mw-solver.cjs'])fs.chmodSync(path.join(__dirname,f),0o755);
 return mw;
}

async function main(){
 const mw=compile();
 log('Building the site…');execFileSync(process.execPath,[path.join(repo,'studio/build.cjs'),'--web'],{cwd:repo,env:cleanEnv(),stdio:'ignore'});
 const apiPort=await freePort(),bridgePort=await freePort(),api='http://127.0.0.1:'+apiPort;
 start('account-server',['server.cjs'],{...cleanEnv(),PORT:String(apiPort),ACCOUNTS_IN_MEMORY:'1',ALLOWED_ORIGINS:api});
 await until(async()=>(await fetch(api+'/api/health')).ok,20000,'account server');
 const username='flow'+Date.now().toString(36),password='solve-flow-'+Math.random().toString(36).slice(2);
 const signup=await (await fetch(api+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,email:username+'@example.com'})})).json();
 if(!signup.token)throw Error('Sign-up failed: '+JSON.stringify(signup));
 const link={api,token:signup.token,user:signup.user.id,cursor:0},linkFile=path.join(work,'bridge.json');fs.writeFileSync(linkFile,JSON.stringify(link));
 const fast={CITRUS_QUEUE_POLL_MS:'1000',CITRUS_QUEUE_PROGRESS_MS:'2000',CITRUS_QUEUE_BEAT_MS:'15000'};
 start('mac-bridge',['tools/local-solver/server.cjs','--port',String(bridgePort),'--threads','2','--solver',path.join(__dirname,'fake-texassolver.cjs'),'--mw-solver',path.join(__dirname,'fast-mw-solver.cjs'),'--timeout','120'],{...cleanEnv(),...fast,CITRUS_BRIDGE_LINK:linkFile});
 let clouds=0;
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:!opt('headed',false)});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(([account])=>{try{if(!localStorage.getItem('citrus-account-v1'))localStorage.setItem('citrus-account-v1',JSON.stringify(account));}catch{}},[{token:signup.token,user:signup.user}]);
 await context.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(api)||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();
  // The cloud: the Modal endpoint, played by the bridge in --once mode for this one job.
  if(url.startsWith(CLOUD_URL+'/solve')){
   const body=JSON.parse(route.request().postData()||'{}'),dir=fs.mkdtempSync(path.join(work,'cloud-')),file=path.join(dir,'job.json');
   fs.writeFileSync(file,JSON.stringify({id:body.id,job:body.job,t:body.t,cursor:body.cursor,link}));clouds++;
   start('cloud-'+clouds,['tools/local-solver/server.cjs','--name','modal','--rate','0.441','--once',file,'--port',String(await freePort()),'--threads','2','--solver',path.join(__dirname,'fake-texassolver.cjs'),'--mw-solver',path.join(__dirname,'fast-mw-solver.cjs'),'--timeout','120'],{...cleanEnv(),...fast,CITRUS_BRIDGE_LINK:path.join(dir,'link.json')});
   return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({started:true,rate:.441})});
  }
  if(url.startsWith(CLOUD_URL))return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'{}'});
  return route.abort();
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(api+'/');
 await page.waitForFunction('typeof studioInterface!=="undefined"&&studioInterface.ready&&state.autoAnalyzeReady',null,{timeout:120000});
 // The Mac's heartbeat arrives through the account.
 await until(()=>page.evaluate(()=>{citrusAccount.run();return typeof macOnline==='function'&&macOnline();}),60000,'the Mac bridge to come online');
 log('Mac bridge online; cloud '+(await page.evaluate(()=>cloudReady()?'ready':'not ready (signed in: '+!!citrusAccount.user+', setting on: '+cloudSolvesOn()+')'))+'. Playing '+HANDS+' hands per table: '+TABLES.join(', '));
 await page.evaluate(seed=>{
  // The test's own dice, so a failing run can be replayed with --seed.
  let s=seed>>>0;window.flowRand=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  // Sync the way a phone that's watching a solve does, a little faster.
  window.flowSync=setInterval(()=>{if(document.visibilityState!=='hidden')citrusAccount.run();},1500);
  tableView.mode='off';
 },SEED);
 const results=[];
 for(const table of TABLES)for(let n=0;n<HANDS;n++){
  const r=await playHand(page,table,n);results.push(r);
  log(table+' hand '+(n+1)+': '+r.hand+' '+(r.problems.length?'FAIL '+r.problems.join('; '):'ok')+' · '+r.summary);
 }
 const failed=results.filter(r=>r.problems.length);
 const report={at:new Date().toISOString(),seed:SEED,hands:results.length,failed:failed.length,clouds,pageErrors:errors,results};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
 if(errors.length)log('Page errors:\n'+errors.join('\n'));
 log(results.length+' hands, '+failed.length+' with problems, '+clouds+' cloud solves. Report: '+path.relative(repo,out)+'/report.json');
 await browser.close();
 return failed.length||errors.length?1:0;
}

// One hand at the given table, the hero choosing at random (seeded) whether to solve each decision, where, and whether
// to wait for the answer before acting.
async function playHand(page,table,n){
 const id=await page.evaluate(table=>{
  const seats=table==='3way'?3:table==='6max'?6:2;
  state.config=G.normalize({...state.config,variant:'NLH',seats,stacks:Array(seats).fill(100),mode:'cash',button:0,ante:0,startStreet:0,board:''});state.dirty=false;
  // A 3-way table: everyone calls preflop (the test plays the other seats there), so the flop is 3-way and goes to the
  // 3-way solver; from the flop on the app's bots play.
  $('controlAll').checked=seats>2;
  state.hero=Math.floor(flowRand()*seats);if(!deal(false))throw Error('Could not deal.');return state.hand.dealId;
 },table);
 const started=Date.now();let decisions=0,solves=0;
 while(Date.now()-started<240000){
  await page.evaluate(()=>{const h=state.hand;if(!$('controlAll').checked||!h||h.done||tableView.playing||state.busy||playBusy())return;
   if(h.street>0){$('controlAll').checked=false;renderPlay();if(typeof advanceBots==='function')advanceBots();return;}
   if(h.actor!==state.hero){const l=h.legal();chooseAction(l.check?{kind:'check',label:'Check'}:{kind:'call',label:'Call'});}});
  const s=await page.evaluate(()=>{const h=state.hand;return{done:!h||h.done,mine:!!h&&!h.done&&h.actor===state.hero&&!tableView.playing&&!state.busy&&!playBusy()};});
  if(s.done)break;if(!s.mine){await page.waitForTimeout(150);continue;}
  await page.waitForTimeout(500);decisions++;
  const step=await page.evaluate(async()=>{
   const h=state.hand,r=flowRand,out={};if(!h||h.done||h.actor!==state.hero)return out;
   const plan=spotPlan(h),job=spotJob(h),ready=spotReferenceReady(h);out.street=h.street;
   if(h.street>=1&&!ready&&!job&&!state.pending&&plan&&plan.route==='mac'&&!plan.blocked&&r()<.75){
    const where=r()<.4?'cloud':'mac',p=spotPlan(h,where)||plan;
    if(p&&!p.blocked){await analyzeSpot(h,{kind:'inspect',plan:p,effort:p.efforts?'quick':undefined});out.solved=where||p.target;}
   }
   out.wait=r()<.5;return out;
  });
  if(step.solved)solves++;
  if(step.wait){
   // Wait for the answer, as someone who tapped Solve would, then check it is the one on screen.
   await page.waitForFunction(()=>{const h=state.hand;if(!h||h.done||h.actor!==state.hero)return true;const j=spotJob(h);return!state.pending&&(!j||!jobPending(j));},null,{timeout:90000,polling:300}).catch(()=>{});
   await page.waitForTimeout(400);
  }
  await page.evaluate(()=>{
   const h=state.hand;if(!h||h.done||h.actor!==state.hero||playBusy())return;const r=flowRand,acts=G.modelActions(h,{...state.abstraction,...state.spotSizing});
   // Mostly play what the answer on screen says, so hands reach the lines charts and libraries cover.
   const shown=activeSpotResult(h);if(shown?.supported&&shown.actions?.length&&r()<.8){const probs=shown.reference||shown.probs||[];let x=r(),i=0;for(;i<shown.actions.length-1;i++){x-=probs[i]||0;if(x<=0)break;}let a=shown.actions[i];if(a?.kind==='fold'&&h.street===0&&h.n>2&&r()<.5)a=shown.actions.find(b=>b.kind==='call')||a;if(a){try{h.clone().act(a);chooseAction(a);return;}catch{}}}
   const by=k=>acts.filter(a=>a.kind===k),x=r()*(h.street===0&&h.n>2?.85:1)+(h.street===0&&h.n>2?.12:0),pick=(x<.12?by('fold'):x<.7?[...by('check'),...by('call')]:[...by('bet'),...by('raise')]);const list=pick.length?pick:acts;
   chooseAction(list[Math.floor(r()*list.length)]);
  });
 }
 // Let solves still out for this hand land (they grade decisions already made), then read the trace.
 await page.waitForFunction(id=>![...spotUI.jobs.values()].some(j=>j.hand===id&&jobPending(j)),id,{timeout:120000,polling:500}).catch(()=>{});
 await page.waitForTimeout(3000);
 const trace=await page.evaluate(id=>{HandTrace.flush();const t=HandTrace.get(id);const jobs=[...spotUI.jobs.values()].filter(j=>j.hand===id).map(j=>({job:j.rowId.slice(5),status:j.status}));return t&&{...JSON.parse(JSON.stringify(t)),jobsNow:jobs};},id);
 fs.writeFileSync(path.join(out,'trace-'+id+'.json'),JSON.stringify(trace,null,1));
 return{hand:id,table,decisions,solves,problems:check(trace),summary:summary(trace)};
}

// What the trace must never show.
function check(t){
 if(!t)return['no trace was recorded'];
 const p=[],ev=t.events,bySpot=new Map();
 for(const e of ev.filter(e=>e.type==='solve'))bySpot.set(e.spot,[...(bySpot.get(e.spot)||[]),e]);
 for(const [spot,list] of bySpot)if(list.length>1)p.push('decision '+spot+' solved '+list.length+' times ('+list.map(e=>e.where+'@'+(e.ms/1000).toFixed(1)+'s').join(', ')+')');
 const used=new Set(ev.filter(e=>e.type==='show job'||e.type==='grade from job'||e.type==='answer'&&e.from==='finished job').map(e=>e.job));
 for(const j of t.jobsNow){
  if(j.status==='done'&&!used.has(j.job))p.push('solve '+j.job+' finished but was never shown or used to grade');
  if(j.status==='queued'||j.status==='running')p.push('solve '+j.job+' still '+j.status+' 2 minutes after the hand');
 }
 for(const e of ev.filter(e=>e.type==='error'||e.type==='solve error'))p.push(e.type+': '+e.message);
 return p;
}
function summary(t){if(!t)return'';const c=k=>t.events.filter(e=>e.type===k).length;return c('solve')+' solves, '+c('show job')+' shown, '+c('grade from job')+' graded from jobs, '+c('graded')+' graded, '+c('cancel')+' cancelled';}

main().then(code=>{process.exitCode=code;},e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const c of children)try{c.kill();}catch{}if(!opt('keep',false))fs.rmSync(work,{recursive:true,force:true});});
