#!/usr/bin/env node
'use strict';
// Claude's review of funky spots: every hand from every account in the last day whose trace trips a check in
// studio/funky-spots.js (a solve run twice, a solve never shown, a stuck or failed solve, a missing grade, two answers
// that disagree, a premium hand folded...). Each hand prints with its whole trace, grouped by kind, so each group can be
// handed to an agent and triaged from the trace alone. Read-only.
//
//   node tools/funky-spots.cjs                       last 24 hours, from the live server
//   node tools/funky-spots.cjs --hours 72 --kind duplicate-solve
//   node tools/funky-spots.cjs --json                raw {kinds, flagged:[{user, hand, flags, trace}]}
//   node tools/funky-spots.cjs --file solve-flow-report   check traces saved by tools/solve-flow/run.cjs (a folder), or a
//                                                    JSON file from HandTrace.recent() or this tool's --json
//   node tools/funky-spots.cjs --print-key           the review key (needs the database key, e.g. on Maxam's Mac)
//
// The live server answers only to the review key: FUNKY_REVIEW_TOKEN in the environment (or --key). The key is the
// server's FUNKY_REVIEW_TOKEN, or when that is not set one derived from the database key (--print-key works it out).
const fs=require('node:fs'),path=require('node:path'),FunkySpots=require('../studio/funky-spots.js'),{show,loadEnv}=require('./hand-trace.cjs');
const args=process.argv.slice(2),opt=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1]&&!args[i+1].startsWith('--')?args[i+1]:true;};
const API=String(opt('api')||process.env.FUNKY_API||'https://range-lab-live-rooms.onrender.com').replace(/\/$/,'');

function report({kinds,flagged,labels=FunkySpots.KINDS,scanned,hours,total}){
 const only=opt('kind');if(only&&only!==true)flagged=flagged.filter(x=>x.flags.some(f=>f.kind===only));
 if(opt('json')){console.log(JSON.stringify({hours,scanned,kinds,flagged},null,1));return;}
 const counts=Object.entries(kinds).sort((a,b)=>b[1]-a[1]);
 console.log((hours?'Last '+hours+' h: ':'')+(scanned!=null?scanned+' hand traces checked, ':'')+(total??flagged.length)+' with funky spots.');
 for(const [k,n] of counts)console.log('  '+String(n).padStart(4)+'  '+k.padEnd(18)+labels[k]);
 if(!flagged.length)return;
 const groups=new Map();for(const x of flagged){const k=x.flags[0].kind;groups.set(k,[...(groups.get(k)||[]),x]);}
 for(const [k,list] of groups){
  console.log('\n══════ '+k+' · '+(labels[k]||'')+' · '+list.length+' hand(s) ══════\n');
  for(const x of list){console.log('account '+(x.user||'?')+' · flags: '+x.flags.map(f=>f.kind+' ('+f.text+')').join('; '));show(x.trace);}
 }
}
async function main(){
 if(opt('print-key')){loadEnv();const {reviewKey}=require('../accounts.cjs'),k=reviewKey();if(!k)throw Error('No database key here (TURSO_AUTH_TOKEN).');console.log(k);return;}
 if(opt('file')){
  const f=path.resolve(String(opt('file'))),read=x=>JSON.parse(fs.readFileSync(x,'utf8')),v=fs.statSync(f).isDirectory()?fs.readdirSync(f).filter(x=>/^trace-.*\.json$/.test(x)).map(x=>read(path.join(f,x))):read(f),list=(Array.isArray(v)?v:v?.flagged?v.flagged:[v]).flatMap(x=>x?.trace&&x?.hand?[x.trace]:x?.events?[x]:x?.results?x.results.map(r=>r.trace).filter(Boolean):[]);
  const kinds={},flagged=[];for(const t of list){const flags=FunkySpots.check(t,{now:t.savedAt||Date.now()});if(!flags.length)continue;for(const f of flags)kinds[f.kind]=(kinds[f.kind]||0)+1;flagged.push({user:'file',hand:t.hand,flags,trace:t});}
  return report({kinds,flagged,scanned:list.length});
 }
 loadEnv();const key=String(opt('key')||process.env.FUNKY_REVIEW_TOKEN||'').trim();if(!key)throw Error('Set FUNKY_REVIEW_TOKEN (or pass --key). On the Mac: node tools/funky-spots.cjs --print-key');
 const q=new URLSearchParams({hours:String(Number(opt('hours'))||24),limit:String(Number(opt('limit'))||60)});
 let r;for(let i=0;i<3;i++){try{r=await fetch(API+'/api/funky-spots?'+q,{headers:{Authorization:'Bearer '+key}});if(r.status<500)break;}catch(e){if(i===2)throw e;}await new Promise(ok=>setTimeout(ok,5000*(i+1)));} // Render can take a moment to wake.
 const b=await r.json().catch(()=>null);if(!r.ok)throw Error('Server answered '+r.status+': '+(b?.error||''));
 report({...b,total:b.flaggedHands});
}
main().catch(e=>{console.error(e.message||e);process.exitCode=1;});
