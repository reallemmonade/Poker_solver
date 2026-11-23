#!/usr/bin/env node
'use strict';
// What cloud solves were quoted against what they really cost, per solve and in total, so the quotes can be checked
// and tuned. Every cloud job row ('solvejob-' meta rows with target 'modal') keeps its quote (estimate), its cap and,
// from the worker, what it cost and whether it hit the cap. Read-only: it only runs SELECTs.
//
//   node tools/cloud/costs.cjs --user maxam              last 30 cloud solves, newest first, and totals
//   node tools/cloud/costs.cjs --user maxam --last 100
//   node tools/cloud/costs.cjs --user maxam --json
//
// The database comes from TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, read from the environment or from an env file
// (--env <file>; by default .env.telescope.local or .env in the repo), as for tools/hand-trace.cjs.
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true;};
const repo=path.resolve(__dirname,'..','..');
function loadEnv(){
 const files=opt('env')?[path.resolve(String(opt('env')))]:['.env.telescope.local','.env'].map(f=>path.join(repo,f));
 for(const f of files){if(!fs.existsSync(f))continue;for(const line of fs.readFileSync(f,'utf8').split(/\r?\n/)){const m=/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}
}
const cents=d=>!(d>0)?'-':d>=1?'$'+d.toFixed(2):(d*100).toFixed(d<.1?2:1)+'¢';
const clock=ms=>ms?new Date(ms).toISOString().replace('T',' ').slice(0,16)+'Z':'?';
// One cloud job as a report row.
function summarize(j){
 const seconds=j.finishedAt>j.startedAt?Math.round((j.finishedAt-j.startedAt)/1000):null;
 return{at:j.createdAt||j.startedAt||0,status:j.status,kind:j.kind||'nlh',street:['pre','flop','turn','river'][j.street]??'?',big:j.size==='big',quote:Number(j.estimate)||0,cap:Number(j.cap)||0,cost:Number(j.cost)||0,capped:!!j.capped,seconds,quotedSeconds:j.seconds||null};
}
function report(jobs){
 const rows=jobs.map(summarize),paid=rows.filter(r=>r.cost>0&&r.quote>0);
 console.log('When (UTC)         Status     Spot          Quote    Cost     Cost/quote  Time');
 for(const r of rows)console.log([clock(r.at).padEnd(18),r.status.padEnd(10),(r.street+' '+r.kind+(r.big?' big':'')).padEnd(13),cents(r.quote).padEnd(8),cents(r.cost).padEnd(8),(r.quote>0&&r.cost>0?(r.cost/r.quote).toFixed(2)+'x':'-').padEnd(11),(r.seconds!=null?r.seconds+' s':'-')+(r.capped?'  capped':'')].join(' '));
 const q=paid.reduce((s,r)=>s+r.quote,0),c=rows.reduce((s,r)=>s+r.cost,0),ratios=paid.map(r=>r.cost/r.quote).sort((a,b)=>a-b);
 console.log('\n'+rows.length+' cloud solve(s): cost '+cents(c)+' in all'+(paid.length?'; on the '+paid.length+' with a quote, quoted '+cents(q)+', cost '+cents(paid.reduce((s,r)=>s+r.cost,0))+' (median '+ratios[ratios.length>>1].toFixed(2)+'x the quote, worst '+ratios[ratios.length-1].toFixed(2)+'x)':'')+'; '+rows.filter(r=>r.capped).length+' hit the cap.');
}
async function main(){
 loadEnv();
 const url=process.env.TURSO_DATABASE_URL,token=process.env.TURSO_AUTH_TOKEN;if(!url)throw Error('TURSO_DATABASE_URL is not set (pass --env <file> or run from the repo on the Mac that has .env.telescope.local).');
 const user=opt('user');if(!user||user===true)throw Error('Pass --user <username or email>.');
 const {createClient}=require('@libsql/client'),db=createClient({url:url.trim(),authToken:(token||'').trim()});
 const u=(await db.execute({sql:'SELECT id,username FROM citrus_users WHERE lower(username)=lower(?) OR lower(coalesce(email,\'\'))=lower(?) LIMIT 2',args:[user,user]})).rows;
 if(!u.length)throw Error('No account named '+user+'.');if(u.length>1)throw Error('More than one account matches '+user+'; use the username.');
 const rows=(await db.execute({sql:"SELECT data FROM citrus_records WHERE user_id=? AND store='meta' AND id LIKE 'solvejob-%' ORDER BY t DESC",args:[u[0].id]})).rows;
 const jobs=rows.map(r=>{try{return JSON.parse(r.data).value}catch{return null}}).filter(j=>j&&j.target==='modal').sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,Number(opt('last'))||30);
 if(opt('json')){console.log(JSON.stringify(jobs.map(summarize),null,1));return;}
 if(!jobs.length){console.log('No cloud solves on '+u[0].username+' yet.');return;}
 report(jobs);
}
if(require.main===module)main().catch(e=>{console.error(e.message||e);process.exitCode=1;});
module.exports={summarize,report};
