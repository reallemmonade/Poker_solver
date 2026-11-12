#!/usr/bin/env node
'use strict';
// Solve-flow player: plays real hands in the real app against a local copy of everything a solve passes through, and
// fails when the solve flow misbehaves. Nothing here touches production: the account server runs in memory on
// 127.0.0.1, the Mac is the real bridge (tools/local-solver/server.cjs) linked to that account with a stand-in
// TexasSolver (fake-texassolver.cjs) and the real 3-way solver cut to a few iterations (fast-mw-solver.cjs), and the cloud is the same bridge started in --once mode
// for each job, the way the Modal worker runs it. Every other outside request from the page is blocked.
//
// For each hand it reads the app's own hand trace (studio/hand-trace.js) and fails on any funky-spot check
// (studio/funky-spots.js, the same checks the app and Claude's review run on real hands), which include:
//   - the same decision solved more than once,
//   - a solve that finished but was never shown or used to grade,
//   - a solve still queued or running long after the hand ended,
//   - a decision graded against a live TexasSolver answer that neither carries its EV loss nor says why it was graded
//     on frequency instead (the stand-in and a solver built by the installers both report action EVs),
//   - a page error.
//
//   node tools/solve-flow/run.cjs [--hands 12] [--tables hu,3way,6max,9max] [--stacks 100] [--mode cash] [--style follow]
//                                 [--seed 7] [--headed] [--keep] [--no-opens]
// --stacks is a list each hand picks from (e.g. 10,20,40,100,200; "mixed" gives every seat its own), --mode cash, icm or
// mix, --solver fake (default) or the path of a real TexasSolver console_solver (tools/local-solver/install-*.sh builds one
// at tools/local-solver/TexasSolver/install/console_solver; real solves are slower and their answers are checked against
// the libraries), --no-opens keeps every 3-way hand a limped pot (by default another seat opens with a raise in half of the 3-way table's hands, see below; --opens is still accepted), and --style how the hero plays: follow (mostly what the answer says), aggro, passive, random, or mix (a style a hand).
// Writes every trace and a summary to solve-flow-report/ (git-ignored). Needs Playwright with Chromium, a C++
// compiler for the 3-way solver, and the repo's npm install.
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),{spawn,execFileSync}=require('child_process');
const FunkySpots=require('../../studio/funky-spots.js'),repo=path.resolve(__dirname,'../..'),args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true;};
const HANDS=Number(opt('hands',12)),TABLES=String(opt('tables','hu,3way')).split(','),STACKS=String(opt('stacks','100')).split(','),MODE=String(opt('mode','cash')),STYLE=String(opt('style','follow')),SEED=Number(opt('seed',7)),OPENS=!args.includes('--no-opens'),out=path.resolve(repo,String(opt('out','solve-flow-report'))),work=fs.mkdtempSync(path.join(os.tmpdir(),'solve-flow-'));
const SOLVER=opt('solver','fake')==='fake'?path.join(__dirname,'fake-texassolver.cjs'):path.resolve(String(opt('solver'))),REAL=!SOLVER.endsWith('fake-texassolver.cjs'),SOLVE_TIMEOUT=REAL?'240':'120';
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
 start('account-server',['server.cjs'],{...cleanEnv(),PORT:String(apiPort),ACCOUNTS_IN_MEMORY:'1',SYNC_RATE_LIMIT:'100000',ALLOWED_ORIGINS:api});
 await until(async()=>(await fetch(api+'/api/health')).ok,20000,'account server');
 const username='flow'+Date.now().toString(36),password='solve-flow-'+Math.random().toString(36).slice(2);
 const signup=await (await fetch(api+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,email:username+'@example.com'})})).json();
 if(!signup.token)throw Error('Sign-up failed: '+JSON.stringify(signup));
 const link={api,token:signup.token,user:signup.user.id,cursor:0},linkFile=path.join(work,'bridge.json');fs.writeFileSync(linkFile,JSON.stringify(link));
 const fast={CITRUS_QUEUE_POLL_MS:'1000',CITRUS_QUEUE_PROGRESS_MS:'2000',CITRUS_QUEUE_BEAT_MS:'15000'};
 start('mac-bridge',['tools/local-solver/server.cjs','--port',String(bridgePort),'--threads','2','--solver',SOLVER,'--mw-solver',path.join(__dirname,'fast-mw-solver.cjs'),'--timeout',SOLVE_TIMEOUT],{...cleanEnv(),...fast,CITRUS_BRIDGE_LINK:linkFile});
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
   start('cloud-'+clouds,['tools/local-solver/server.cjs','--name','modal','--rate','0.441','--once',file,'--port',String(await freePort()),'--threads','2','--solver',SOLVER,'--mw-solver',path.join(__dirname,'fast-mw-solver.cjs'),'--timeout',SOLVE_TIMEOUT],{...cleanEnv(),...fast,CITRUS_BRIDGE_LINK:path.join(dir,'link.json')});
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
  log(table+' '+r.stacks.join('/')+'bb '+r.mode+' '+r.style+' hand '+(n+1)+': '+r.hand+' '+(r.problems.length?'FAIL '+r.problems.join('; '):'ok')+' · '+r.summary);
 }
 // Chip-EV grading: decisions graded against a live heads-up solve report the EV they lost.
 const live=results.flatMap(r=>r.liveGrades||[]),onEV=live.filter(g=>g.onEV),noEV=live.length>0&&!onEV.length;
 log(live.length+' decisions graded against a live TexasSolver solve: '+onEV.length+' on EV ('+onEV.filter(g=>g.loss>0).length+' lost EV, most '+(onEV.length?Math.max(...onEV.map(g=>g.loss)).toFixed(2):'0')+' bb), '+(live.length-onEV.length)+' on frequency'+(live.some(g=>g.evSkipped)?' ('+[...new Set(live.filter(g=>g.evSkipped).map(g=>g.evSkipped))].join('; ')+')':'')+'.');
 if(noEV)log('FAIL no decision graded against a live solve carried an EV loss.');
 const failed=results.filter(r=>r.problems.length);
 const report={at:new Date().toISOString(),seed:SEED,tables:TABLES,stacks:STACKS,mode:MODE,style:STYLE,hands:results.length,failed:failed.length,clouds,liveGrades:{total:live.length,onEV:onEV.length,lostEV:onEV.filter(g=>g.loss>0).length},pageErrors:errors,results};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
 if(errors.length)log('Page errors:\n'+errors.join('\n'));
 log(results.length+' hands, '+failed.length+' with problems, '+clouds+' cloud solves. Report: '+path.relative(repo,out)+'/report.json');
 await browser.close();
 return failed.length||errors.length||noEV?1:0;
}

// One hand at the given table, the hero choosing at random (seeded) whether to solve each decision, where, and whether
// to wait for the answer before acting.
async function playHand(page,table,n){
 const setup=await page.evaluate(([table,STACKS,MODE,STYLE,OPENS])=>{
  const r=flowRand,seats={hu:2,'3way':3,'6max':6,'9max':9}[table]||2,choice=a=>a[Math.floor(r()*a.length)];
  const depths=STACKS.filter(x=>x!=='mixed').map(Number),mixed=STACKS.includes('mixed')&&r()<.5,depth=choice(depths.length?depths:[100]);
  const stacks=Array.from({length:seats},()=>mixed?choice(depths.length>1?depths:[20,40,100,200]):depth),mode=MODE==='mix'?choice(['cash','icm']):MODE;
  const style=STYLE==='mix'?choice(['follow','follow','aggro','passive','random']):STYLE;
  state.config=G.normalize({...state.config,variant:'NLH',seats,stacks,mode,payouts:seats>2?[.5,.3,.2]:[.65,.35],otherStacks:[],button:Math.floor(r()*seats),ante:0,startStreet:0,board:'',bounties:Array(seats).fill(0)});state.dirty=false;
  // A 3-way table: everyone calls preflop (the test plays the other seats there), so the flop is 3-way and goes to the
  // 3-way solver; from the flop on the app's bots play. In half of those hands (none with --no-opens) the first other
  // seat to act opens with a raise instead (flowOpen), so the hero also sees flops as a caller: leading into the
  // raiser, or facing a lead, and pots that go heads-up when one of the three folds to a bet.
  // At 6- and 9-max the bots play every other seat from the deal.
  $('controlAll').checked=table==='3way';window.flowOpen=OPENS&&table==='3way'&&r()<.5;
  window.flowStyle=style;state.hero=Math.floor(r()*seats);if(!deal(false))throw Error('Could not deal.');return{id:state.hand.dealId,stacks,mode,style};
 },[table,STACKS,MODE,STYLE,OPENS]),id=setup.id;
 const started=Date.now();let decisions=0,solves=0;
 while(Date.now()-started<(REAL?900000:240000)){
  await page.evaluate(()=>{const h=state.hand;if(!$('controlAll').checked||!h||h.done||tableView.playing||state.busy||playBusy())return;
   if(h.street>0){$('controlAll').checked=false;renderPlay();if(typeof advanceBots==='function')advanceBots();return;}
   if(h.actor!==state.hero){const l=h.legal(),open=window.flowOpen&&!h.actionLog.some(a=>a.kind==='raise')?G.modelActions(h,{...state.abstraction,...state.spotSizing}).find(a=>a.kind==='raise'):null;chooseAction(open||(l.check?{kind:'check',label:'Check'}:{kind:'call',label:'Call'}));}});
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
   await page.waitForFunction(()=>{const h=state.hand;if(!h||h.done||h.actor!==state.hero)return true;const j=spotJob(h);return!state.pending&&(!j||!jobPending(j));},null,{timeout:REAL?300000:90000,polling:300}).catch(()=>{});
   await page.waitForTimeout(400);
  }
  await page.evaluate(()=>{
   const h=state.hand;if(!h||h.done||h.actor!==state.hero||playBusy())return;const r=flowRand,acts=G.modelActions(h,{...state.abstraction,...state.spotSizing});
   // Mostly play what the answer on screen says, so hands reach the lines charts and libraries cover.
   const st=window.flowStyle||'follow',follow={follow:.8,aggro:.45,passive:.45,random:.1}[st]??.8;
   const shown=activeSpotResult(h);if(shown?.supported&&shown.actions?.length&&r()<follow){const probs=shown.reference||shown.probs||[];let x=r(),i=0;for(;i<shown.actions.length-1;i++){x-=probs[i]||0;if(x<=0)break;}let a=shown.actions[i];if(a?.kind==='fold'&&h.street===0&&h.n>2&&r()<.5)a=shown.actions.find(b=>b.kind==='call')||a;if(a){try{h.clone().act(a);chooseAction(a);return;}catch{}}}
   const by=k=>acts.filter(a=>a.kind===k),x=st==='aggro'?.12+r()*.88*(r()<.6?1:.66):st==='passive'?r()*.7:r()*(h.street===0&&h.n>2?.85:1)+(h.street===0&&h.n>2?.12:0),pick=(x<.12?by('fold'):x<.7?[...by('check'),...by('call')]:[...by('bet'),...by('raise')]);const list=pick.length?pick:acts;
   chooseAction(list[Math.floor(r()*list.length)]);
  });
 }
 // Let solves still out for this hand land (they grade decisions already made), and the grades still being worked out
 // (the first hand can end while the charts load, and its last decision's grade waits for them), then read the trace.
 await page.waitForFunction(()=>!state.pending&&!state.gradeQueue.length&&!chartsLoading(),null,{timeout:60000,polling:250}).catch(()=>{});
 await page.waitForFunction(id=>![...spotUI.jobs.values()].some(j=>j.hand===id&&jobPending(j)),id,{timeout:REAL?400000:120000,polling:500}).catch(()=>{});
 await page.waitForTimeout(3000);
 const trace=await page.evaluate(id=>{HandTrace.flush();const t=HandTrace.get(id);const jobs=[...spotUI.jobs.values()].filter(j=>j.hand===id).map(j=>({job:j.rowId.slice(5),status:j.status}));const h=state.hand?.dealId===id?state.hand:null;return t&&{...JSON.parse(JSON.stringify(t)),jobsNow:jobs,config:h&&JSON.parse(JSON.stringify(h.config)),actionLog:h&&JSON.parse(JSON.stringify(h.actionLog)),board:h&&h.board?.map(c=>G.Core.cardName(c))};},id);
 fs.writeFileSync(path.join(out,'trace-'+id+'.json'),JSON.stringify(trace,null,1));
 return{hand:id,table,...setup,decisions,solves,problems:check(trace),liveGrades:liveGrades(trace),summary:summary(trace)};
}

// What the trace must never show.
function check(t){
 if(!t)return['no trace was recorded'];
 // The funky-spot checks the app and the server review run (studio/funky-spots.js), plus the live job states below.
 // The stand-in TexasSolver makes up its strategies, so its answers disagreeing with a library is expected here.
 const fake=REAL?/multiway/i:/local-texassolver|multiway|mac|cloud|modal|job/i,p=FunkySpots.check(t,{settled:true}).filter(f=>f.kind!=='sources-disagree'||!fake.test(f.text)).map(f=>f.kind+': '+f.text),ev=t.events;
 const used=new Set(ev.filter(e=>e.type==='show job'||e.type==='grade from job'||e.type==='answer'&&e.from==='finished job').map(e=>e.job));
 for(const j of t.jobsNow){
  if(j.status==='done'&&!used.has(j.job)&&!p.some(x=>x.includes(' '+j.job+' ')))p.push('solve-not-shown: solve '+j.job+' finished but was never shown or used to grade');
  if(j.status==='queued'||j.status==='running')p.push('solve-stuck: solve '+j.job+' still '+j.status+' '+(REAL?'7':'2')+' minutes after the hand');
 }
 for(const g of liveGrades(t))if(!g.onEV&&!g.evSkipped)p.push('live-solve-no-ev: '+g.action+' was graded against a live solve without an EV loss, and the trace does not say why');
 return[...new Set(p)];
}
// Decisions graded against a live TexasSolver answer (this street's solve, or its kept tree): on EV with the bb lost,
// or on frequency with the reason the EVs were set aside.
function liveGrades(t){return(t?.events||[]).filter(e=>e.type==='graded'&&e.source==='local-texassolver').map(e=>({action:e.action,onEV:/^EV from a live solve/.test(e.gradedOn||'')&&e.rated===true&&Number.isFinite(e.loss)&&Number.isFinite(e.ev),loss:e.loss,ev:e.ev??null,best:e.best||null,frequency:e.frequency??null,evSkipped:e.evSkipped||null}));}
function summary(t){if(!t)return'';const c=k=>t.events.filter(e=>e.type===k).length;return c('solve')+' solves, '+c('show job')+' shown, '+c('grade from job')+' graded from jobs, '+c('graded')+' graded, '+c('cancel')+' cancelled';}

main().then(code=>{process.exitCode=code;},e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const c of children)try{c.kill();}catch{}if(!opt('keep',false))fs.rmSync(work,{recursive:true,force:true});});
