'use strict';
// Funky-spot detectors: read one hand trace (studio/hand-trace.js) and list anything that looks wrong, so problems are
// caught without anyone reporting them. The same checks run everywhere a hand is played:
//   - in the app, at the end of each hand (the flags are saved on the trace, so they sync with the account),
//   - on the server, which hands every flagged hand from every account to Claude's review (GET /api/funky-spots),
//   - in scripted play (tools/solve-flow/run.cjs fails a hand that trips one),
//   - when a trace is read by hand (tools/hand-trace.cjs prints them under each hand).
// Each flag is {kind, text, spot?, job?}. kind groups flags that likely share a cause; text says what happened.
// Add a detector here when a new kind of bug shows up, so it is caught the next time on its own.
(function(root){
 const KINDS={
  'duplicate-solve':'The same decision was solved more than once',
  'solve-not-shown':'A solve finished but was never shown or used to grade',
  'solve-stuck':'A solve was still queued or running long after the hand',
  'solve-error':'A solve or the solve flow failed',
  'grade-missing':'A decision waited for a solve to grade it and never got a grade',
  'sources-disagree':'Two answers for the same decision disagree a lot',
  'premium-fold':'The answer folds a premium hand preflop',
  'impossible-mix':'An answer\'s frequencies do not add up',
  'ungraded-silently':'A decision you played got no grade, and the trace does not say why',
 };
 const STUCK_MS=15*60*1000;
 const used=e=>e.type==='show job'||e.type==='grade from job'||e.type==='answer'&&e.from==='finished job';
 // fold / passive (check, call) / aggressive (bet, raise, all-in), from an action label.
 function bucket(label){const s=String(label||'').toLowerCase();if(/^fold/.test(s))return 0;if(/^(check|call|limp|complete)/.test(s))return 1;return 2;}
 function buckets(mix){const b=[0,0,0];for(const [k,v] of Object.entries(mix||{}))if(Number.isFinite(v))b[bucket(k)]+=v;return b;}
 const premium=cards=>{const r=String(cards||'').replace(/[^AKQJT2-9]/gi,'').toUpperCase();return r==='AA'||r==='KK';};

 function check(t,opts={}){
  if(!t||!Array.isArray(t.events))return[];
  const now=opts.now||Date.now(),ev=t.events,flags=[],add=(kind,text,extra)=>flags.push({kind,text,...extra});
  // The same decision solved twice. A solve that replaces a failed or cancelled one is a retry, and a solve with different inputs (the played size added to the tree) is a new solve, not a duplicate.
  const bySpot=new Map();for(const e of ev)if(e.type==='solve'&&e.spot&&!['failed','cancelled'].includes(e.replaces)){const k=e.spot+'|'+(e.inputs||'');bySpot.set(k,[...(bySpot.get(k)||[]),e]);}
  for(const [k,list] of bySpot)if(list.length>1){const spot=k.split('|')[0];add('duplicate-solve','decision '+spot+' solved '+list.length+' times ('+list.map(e=>(e.where||'?')+'@'+((e.ms||0)/1000).toFixed(1)+'s').join(', ')+')',{spot});}
  // Job lifecycle: the last status each job reached.
  const last=new Map(),lastAt=new Map();for(const e of ev)if(e.type==='job'&&e.job){last.set(e.job,e);lastAt.set(e.job,e.ms||0);}
  const shown=new Set(ev.filter(used).map(e=>e.job));
  for(const [job,e] of last){
   if(e.status==='done'&&!shown.has(job))add('solve-not-shown','solve '+job+' ('+(e.target||'?')+') finished but was never shown or used to grade',{job,spot:e.spot});
   if((e.status==='queued'||e.status==='running')&&t.startedAt&&now-(t.startedAt+(lastAt.get(job)||0))>STUCK_MS)add('solve-stuck','solve '+job+' ('+(e.target||'?')+') still '+e.status+' '+Math.round((now-t.startedAt-(lastAt.get(job)||0))/60000)+' min after its last change',{job,spot:e.spot});
   if(e.status==='failed')add('solve-error','solve '+job+' ('+(e.target||'?')+') failed: '+(e.message||'no message'),{job,spot:e.spot});
  }
  for(const e of ev){
   if(e.type==='error'||e.type==='solve error')add('solve-error',e.type+': '+(e.message||'no message'),{spot:e.spot});
   if(e.type==='cloud start'&&e.ok===false)add('solve-error','cloud solve did not start: '+(e.error||'no message'),{job:e.job});
   if(e.type==='finished job not shown'&&e.reason==='answer not usable')add('solve-not-shown','solve '+e.job+' finished with an answer that could not be used',{job:e.job,spot:e.spot});
  }
  // A decision whose grade waited for a solve: it must end graded (or be dropped with a reason we can see).
  for(const e of ev)if(e.type==='grade waits for job'||e.type==='grade waits for street tree'){
   const done=ev.some(x=>(x.ms||0)>=(e.ms||0)&&(x.type==='grade wait dropped'||(x.type==='grade from job'||x.type==='graded')&&(x.spot===e.spot||!e.spot)));
   const old=t.startedAt&&now-t.startedAt>STUCK_MS;if(!done&&old)add('grade-missing','decision '+(e.spot||'?')+' waited for a solve to grade it and was never graded',{spot:e.spot});
  }
  for(const e of ev)if(e.type==='grade wait dropped'&&e.status!=='cancelled')add('grade-missing','a decision ('+(e.action||'?')+') lost its grade: its solve ended '+(e.status||'?'),{job:e.job});
  // Every decision you played ends graded, waiting on a solve, or with a "not graded (…)" line saying why. Checked once the
  // hand has ended and gone quiet for two minutes (grades for the last decisions land after the hand), or right away
  // when the caller knows the hand is settled (opts.settled, scripted play).
  const lastMs=ev.reduce((m,e)=>Math.max(m,e.ms||0),0),quiet=opts.settled||t.startedAt&&now-(t.startedAt+lastMs)>120000;
  if(quiet&&ev.some(e=>e.type==='end'))for(const a of ev)if(a.type==='act'&&a.spot&&a.gradeEvery!==false&&!a.guessed){
   const told=ev.some(e=>e.spot===a.spot&&(e.type==='graded'||/^not graded/.test(e.type)||/^grade (waits|wait dropped|from job)/.test(e.type)));
   if(!told)add('ungraded-silently',(a.action||'a decision')+' on '+(['preflop','the flop','the turn','the river'][a.street]||'?')+' got no grade (showing '+(a.showing||'nothing')+')',{spot:a.spot});
  }
  // Answers: frequencies that do not add up, premium folds, and two sources that disagree on the same decision.
  const info=t.info||{},answers=new Map();
  for(const e of ev){
   if(e.type!=='result'||!e.mix)continue;
   const total=Object.values(e.mix).reduce((s,v)=>s+(Number(v)||0),0);
   if(total>0&&Math.abs(total-1)>.03)add('impossible-mix','answer from '+(e.from||'?')+' adds up to '+Math.round(total*100)+'%',{spot:e.spot});
   const b=buckets(e.mix);
   if(e.street===0&&e.actor!=null&&e.actor===info.hero&&premium(info.heroCards)&&b[0]>.05)add('premium-fold','answer from '+(e.from||'?')+' folds '+info.heroCards+' '+Math.round(b[0]*100)+'% preflop',{spot:e.spot});
   if(e.spot&&total>0){const list=answers.get(e.spot)||[];list.push({from:e.from||'?',b});answers.set(e.spot,list);}
  }
  for(const [spot,list] of answers)for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   const a=list[i],c=list[j];if(a.from===c.from)continue;const tv=(Math.abs(a.b[0]-c.b[0])+Math.abs(a.b[1]-c.b[1])+Math.abs(a.b[2]-c.b[2]))/2;
   if(tv>.5){add('sources-disagree','decision '+spot+': '+a.from+' says fold/passive/aggressive '+a.b.map(x=>Math.round(x*100)).join('/')+', '+c.from+' says '+c.b.map(x=>Math.round(x*100)).join('/'),{spot});i=list.length;break;}
  }
  // One flag per kind and spot/job is enough.
  const seen=new Set();return flags.filter(f=>{const k=f.kind+'|'+(f.spot||'')+'|'+(f.job||'')+'|'+(f.spot||f.job?'':f.text);if(seen.has(k))return false;seen.add(k);return true;});
 }
 const api={check,KINDS,STUCK_MS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FunkySpots=api;
})(typeof globalThis!=='undefined'?globalThis:this);
