#!/usr/bin/env node
'use strict';
// Read the hand traces the app saves to an account (studio/hand-trace.js): what the solve and grading code did in each
// recent hand, event by event. Read-only: it only runs SELECTs.
//
//   node tools/hand-trace.cjs --user maxam              last 5 hands, newest first
//   node tools/hand-trace.cjs --user maxam --last 20
//   node tools/hand-trace.cjs --user maxam --hand h<id>  one hand (ids are printed in the list)
//   node tools/hand-trace.cjs --user maxam --json        raw traces
//   node tools/hand-trace.cjs --file trace.json          format a trace copied from a browser (HandTrace.recent())
//
// The database comes from TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, read from the environment or from an env file
// (--env <file>; by default .env.telescope.local or .env in the repo, which hold the production Turso keys on Maxam's Mac).
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true;};
const repo=path.resolve(__dirname,'..');

function loadEnv(){
 const files=opt('env')?[path.resolve(String(opt('env')))]:['.env.telescope.local','.env'].map(f=>path.join(repo,f));
 for(const f of files){if(!fs.existsSync(f))continue;for(const line of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}
}
const clock=ms=>new Date(ms).toISOString().replace('T',' ').slice(0,19)+'Z';
const secs=ms=>(ms/1000).toFixed(1).padStart(6)+'s';
function line(e){
 const skip=new Set(['ms','type','street','step','actor']),parts=[];
 for(const [k,v] of Object.entries(e)){if(skip.has(k)||v==null||v===false)continue;parts.push(k+'='+(typeof v==='object'?JSON.stringify(v):v));}
 const where=e.street==null?'':['pre','flop','turn','river'][e.street]+'#'+e.step+(e.actor!=null?' seat'+e.actor:'');
 return secs(e.ms)+'  '+where.padEnd(16)+e.type.padEnd(26)+parts.join(' ');
}
function show(t){
 const i=t.info||{};
 console.log('━━ '+t.hand+' · '+clock(t.startedAt)+' · '+(i.table||'?')+' · '+(i.players||'?')+'-handed '+(i.variant||'')+' '+(i.mode||'')+' · you '+(i.heroPosition||'?')+' '+(i.heroCards||'')+(t.board?' · board '+t.board:'')+(t.device?' · device '+t.device:''));
 if(i.stacksBB)console.log('   stacks (bb): '+i.stacksBB.join(' '));
 if(t.actions)console.log('   actions: '+t.actions.map(s=>Array.isArray(s)?s.join(', '):s).join(' | '));
 if(t.dropped)console.log('   ('+t.dropped+' middle events dropped to keep the trace small)');
 for(const e of t.events)console.log('   '+line(e));
 const solves=t.events.filter(e=>e.type==='solve'),bySpot=new Map();for(const e of solves)bySpot.set(e.spot,(bySpot.get(e.spot)||0)+1);
 const dupes=[...bySpot].filter(([,n])=>n>1);if(dupes.length)console.log('   ⚠ the same spot was solved more than once: '+dupes.map(([s,n])=>s+'×'+n).join(', '));
 const done=t.events.filter(e=>e.type==='job'&&e.status==='done').map(e=>e.job),shown=new Set(t.events.filter(e=>e.type==='show job'||e.type==='grade from job'||e.type==='answer'&&e.from==='finished job').map(e=>e.job));
 const lost=done.filter(j=>!shown.has(j));if(lost.length)console.log('   ⚠ finished solve never shown or used to grade: '+lost.join(', '));
 console.log('');
}
async function main(){
 if(opt('file')){let v=JSON.parse(fs.readFileSync(String(opt('file')),'utf8'));for(const t of Array.isArray(v)?v:[v])show(t);return;}
 loadEnv();
 const url=process.env.TURSO_DATABASE_URL,token=process.env.TURSO_AUTH_TOKEN;if(!url)throw Error('TURSO_DATABASE_URL is not set (pass --env <file> or run from the repo on the Mac that has .env.telescope.local).');
 const user=opt('user');if(!user||user===true)throw Error('Pass --user <username or email>.');
 const {createClient}=require('@libsql/client'),db=createClient({url:url.trim(),authToken:(token||'').trim()});
 const u=(await db.execute({sql:'SELECT id,username,name FROM citrus_users WHERE lower(username)=lower(?) OR lower(coalesce(email,\'\'))=lower(?) OR lower(name)=lower(?) LIMIT 2',args:[user,user,user]})).rows;
 if(!u.length)throw Error('No account named '+user+'.');if(u.length>1)throw Error('More than one account matches '+user+'; use the username.');
 const rows=(await db.execute({sql:"SELECT data FROM citrus_records WHERE user_id=? AND store='meta' AND id LIKE 'trace-%' ORDER BY t DESC",args:[u[0].id]})).rows;
 let traces=rows.map(r=>{try{return JSON.parse(r.data).value}catch{return null}}).filter(t=>t&&t.hand).sort((a,b)=>b.startedAt-a.startedAt);
 const hand=opt('hand');if(hand&&hand!==true)traces=traces.filter(t=>t.hand===hand);else traces=traces.slice(0,Number(opt('last'))||5);
 if(opt('json')){console.log(JSON.stringify(traces,null,1));return;}
 if(!traces.length){console.log('No hand traces saved for '+u[0].username+' yet.');return;}
 console.log(traces.length+' hand trace(s) for '+u[0].username+', newest first. Times are seconds from the deal; spot= is a hash of the decision.\n');
 for(const t of traces)show(t);
}
main().catch(e=>{console.error(e.message||e);process.exitCode=1;});
