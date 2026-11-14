'use strict';
// Spot trust audit: lists every kind of spot the app answers, how much its answer can be trusted, and whether the app
// grades it, then fails when a spot it does not trust is still graded (or Train drills a spot Play does not grade).
//   node tools/spot-trust/audit.cjs [--md report.md] [--json report.json]     # about 2 minutes
// Exits 2 on a gap.
//
// Trust levels:
//   trusted        sound answer; graded in full
//   approximate    answer usable with a known limit; graded only on the part that holds (or labelled), never more
//   ungraded       not sound enough to grade; shown only
//   wrong framing  the answer replies to the wrong question (an unbalanced range, a line the tree lacks); must be ungraded
// "Graded" is measured by running each spot through the app's own grading code (studio/hand-db.js), and "drilled" through
// Train's chart index (studio/quiz.js), so the table reflects what the app does, not what its comments say.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),vm=require('vm'),{spawnSync}=require('child_process');
const ROOT=path.join(__dirname,'..','..'),STUDIO=path.join(ROOT,'studio'),LIB=path.join(STUDIO,'libraries');
const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
for(const a of args)if(a.startsWith('--')&&!['--md','--json'].includes(a))throw Error('Unknown option '+a+'. Use --md file, --json file.');

// ---------- The app's own grading and drill code, loaded as the browser loads it ----------
const G=require(path.join(STUDIO,'game.js')),P=require(path.join(STUDIO,'preflop.js')),L=require(path.join(STUDIO,'postflop-library.js'));
const ctx=vm.createContext({G,C:G.Core,PokerGame:G,PokerPreflop:P,chartMistakeFrequency:.05,console,Math,JSON,Array,Set,Map,WeakMap,Number,String,Object,Float32Array,Float64Array,Uint8Array,Infinity,isFinite});
for(const f of ['hand-db.js','quiz.js'])vm.runInContext(fs.readFileSync(path.join(STUDIO,f),'utf8'),ctx,{filename:f});
const app=Object.fromEntries(['gradeCounts','gradeSplit','gradeFrequency','gradeMistake','gradeApprox','gradeOpenConnector','gradeOffChart','gradeOvercall','gradeChart','gradeSolved','gradeGuessedRanges','quizChartIndex','quizChartStep','comboOf','chartOrderBreach','chartLineSplit'].map(k=>[k,vm.runInContext(k,ctx)]));

const gz=f=>{const raw=fs.readFileSync(f);return JSON.parse(/\.gz$/.test(f)?zlib.gunzipSync(raw):raw);};
const manifest=require(path.join(LIB,'manifest.json'));
const pct=x=>(100*x).toFixed(x<.1&&x>0?1:0)+'%';
const gaps=[],notes=[];const gap=(where,text)=>gaps.push({where,text});

// ---------- Preflop: every chart node, classified by the line it answers ----------
// The class says what the actor faces and what they did before, from the saved history (seat, kind, to).
function lineClass(node,stack){
 let r=0,limps=0,callers=0;const own=[];let jam=false;
 for(const h of node.history){
  if(h.seat===node.seat&&h.kind!=='fold')own.push({kind:h.kind,r});
  if(h.kind==='raise'||h.kind==='bet'){r++;callers=0;jam=Number.isFinite(h.to)&&h.to>=stack-1e-9;}
  else if(h.kind==='call'){if(r===0)limps++;else if(h.seat!==node.seat)callers++;}
 }
 if(!own.length){
  if(r===0)return limps?'vs limp':'first in';
  if(r===1)return callers?'vs open + caller':jam?'vs jam':limps?'vs raise over limp':'vs open';
  return 'cold vs 3-bet+';
 }
 const last=own[own.length-1];
 if(last.kind==='call'&&last.r===0)return r===1?'limper vs raise':'limper vs 3-bet+';
 if(last.kind==='raise'&&last.r===0)return 'opener vs 3-bet'+(r>2?'+':'');
 if(last.kind==='call'&&last.r===1)return 'flatter vs squeeze';
 if(last.kind==='raise'&&last.r===1)return '3-bettor vs 4-bet';
 return 'vs 5-bet+';
}
// What the model can stand behind for each line, before any check runs. Reasons come from the chart model's known limits.
const POLICY={
 'first in':{trust:'trusted',why:'first-in opens; order and premium checks below'},
 'vs jam':{trust:'trusted',why:'call or fold against an all-in is equity against a known range'},
 'vs open':{trust:'approximate',why:'how often a hand continues is sound, the 3-bet/flat split is not (linear 3-bets): graded fold vs continue only'},
 'vs raise over limp':{trust:'approximate',why:'graded fold vs continue only, like vs open'},
 'vs limp':{trust:'approximate',why:'limp trees are a realization-model guess (README: the raise rate is likely high); no outside reference'},
 'limper vs raise':{trust:'approximate',why:'the limper\'s range comes from the limp/raise split; graded fold vs continue only'},
 'vs open + caller':{trust:'wrong framing',why:'no chart has overcalls; the call is borrowed from the flat against the open alone'},
 'cold vs 3-bet+':{trust:'wrong framing',why:'players behind a 3-bet fold in the chart model'},
 'opener vs 3-bet':{trust:'wrong framing',why:'answers an unbalanced (linear) 3-bet range; continue range far too wide'},
 'opener vs 3-bet+':{trust:'wrong framing',why:'own range came through the open/3-bet split'},
 'flatter vs squeeze':{trust:'wrong framing',why:'own flat range is full of holes (linear 3-bets)'},
 '3-bettor vs 4-bet':{trust:'wrong framing',why:'own 3-bet range is linear'},
 'vs 5-bet+':{trust:'wrong framing',why:'own range came through the 3-bet/4-bet split'},
 'limper vs 3-bet+':{trust:'wrong framing',why:'own range came through the limp/raise split twice'},
};
const UNTRUSTED=new Set(['ungraded','wrong framing']);
const NEUTRAL={NLH:'AsKd',PLO4:'AsKdQhJc'};// a hand no hand-specific rule (connectors, bluff band) touches
const optionsOf=(node,f=()=>null)=>node.actions.map((a,i)=>({label:a.label||a.kind,f:f(i)}));
function syntheticGrade(pack,node,hand,choice,freq,options){
 return{street:0,hero:node.seat,hand,choice,referenceFrequency:freq,referenceSource:{name:pack.name,kind:'chart'},options,actions:node.history.map(h=>({seat:h.seat,kind:h.kind})),variant:pack.config.variant,mode:pack.config.mode};
}
const R='AKQJT98765432';
// Kicker pairs (hi, lo): XY against XZ with Z<Y, same suitedness; suited wheel aces may outplay A9s-A6s (as in real solvers).
const KICKER=[];for(let i=0;i<13;i++)for(let j=i+1;j<13;j++)for(const s of ['s','o'])for(let k=j+1;k<13;k++)if(!(i===0&&s==='s'&&k>=9))KICKER.push([R[i]+R[j]+s,R[i]+R[k]+s]);
for(const gp of [1,2])for(let i=1;i+gp<13;i++)for(let k=i+1;k+gp<13;k++)KICKER.push([R[i]+R[i+gp]+'s',R[k]+R[k+gp]+'s']);
const classCards=c=>c[0]+'s'+c[1]+(c.length===2?'h':c[2]==='s'?'s':'h');
const freqRow=(node,i)=>{const A=node.actions.length;return node.actions.map((_,a)=>node.table[i*A+a]/1000);};
const contOf=(node,i)=>{const f=node.actions.findIndex(a=>a.kind==='fold');return f<0?1:1-node.table[i*node.actions.length+f]/1000;};

// How often a hand class reaches a node through its own earlier choices.
function ownReach(pack,node,i){const parts=node.key?node.key.split('/'):[];let r=1;for(let j=0;j<parts.length;j++){const st=app.quizChartStep(pack,parts.slice(0,j).join('/'),parts[j]);if(st.seat!==node.seat||!st.parent)continue;if(st.a<0)return 0;r*=st.parent.table[i*st.parent.actions.length+st.a]/1000;}return r;}
const preflop={rows:new Map(),charts:0,nodes:0};
function bump(key,init){let r=preflop.rows.get(key);if(!r){r={...init,charts:new Set(),nodes:0,graded:0,partial:0,drilled:0,reach:0,premiumFolds:[],orderBreaches:0,orderGraded:[],sumBad:0,examples:[]};preflop.rows.set(key,r);}return r;}
const sizeBucket=n=>n===2?'HU':n<=5?'3-5 handed':n===6?'6-max':'7-9 handed',depthBucket=d=>d<=15?'≤15bb':d<=50?'20-50bb':d<=200?'70-200bb':'300bb+';
const firstIn=new Map();// variant|mode|seats -> [{depth, pack, nodes by seat}]
const vsLimp=[];
for(const entry of manifest.packs){
 const pack=P.validate(gz(path.join(LIB,entry.file))),cfg=pack.config,variant=cfg.variant,plo=!!pack.groups,stack=Math.max(...cfg.stacks);
 preflop.charts++;let index;try{index=app.quizChartIndex(pack);}catch(e){gap(pack.name,'Train cannot index this chart: '+e.message);continue;}
 const fiKey=variant+'|'+cfg.mode+'|'+cfg.seats;if(!plo){if(!firstIn.has(fiKey))firstIn.set(fiKey,[]);firstIn.get(fiKey).push({depth:stack,pack,nodes:new Map()});}
 for(const e of index){
  if(!(e.reach>=1e-6))continue;const node=e.node;preflop.nodes++;
  const cls=lineClass(node,stack),pol=POLICY[cls],key=[cls,variant,cfg.mode==='icm'?'MTT':'cash',sizeBucket(cfg.seats),depthBucket(stack)].join('|');
  const row=bump(key,{cls,variant,mode:cfg.mode==='icm'?'MTT':'cash',size:sizeBucket(cfg.seats),depth:depthBucket(stack),...pol});row.charts.add(pack.name);row.nodes++;row.reach+=e.reach;
  // Graded? The neutral hand, choosing the chart's most played continue action.
  const fold=node.actions.findIndex(a=>a.kind==='fold'),cont=node.actions.findIndex((a,i)=>i!==fold),opts=optionsOf(node,()=>.5),g=syntheticGrade(pack,node,NEUTRAL[variant],cont,.5,opts);
  const graded=app.gradeCounts(g),split=app.gradeSplit(g);if(graded)row.graded++;if(graded&&split==='vsopen')row.partial++;
  const drilled=e.topics.length>0&&!e.afterSplit;if(drilled)row.drilled++;
  if(drilled!==graded&&row.examples.length<3)row.examples.push((drilled?'drilled, not graded: ':'graded, not drilled: ')+pack.name+' seat '+node.seat+' after '+(node.key||'(start)'));
  if(plo)continue;
  // Integrity: every class's row adds to 1.
  for(let i=0;i<P.classes.length;i++){const s=freqRow(node,i).reduce((a,b)=>a+b,0);if(Math.abs(s-1)>.01){row.sumBad++;break;}}
  // Premium sanity: AA never folds; KK not before a 4-bet. Rows a hand reaches under 0.1% of the time are never served.
  const raises=node.history.filter(h=>h.kind==='raise').length;
  for(const c of raises>=3?['AA']:['AA','KK']){const i=P.classes.indexOf(c);if(fold>=0&&node.table[i*node.actions.length+fold]/1000>.05&&ownReach(pack,node,i)>=.001)row.premiumFolds.push(c+' folds '+pct(node.table[i*node.actions.length+fold]/1000)+' · '+pack.name+' after '+node.key);}
  // Kicker order: first in, by how often a hand opens; facing an open, by how often it continues (what is graded there).
  if(cls==='first in'||cls==='vs open'){
   if(cls==='first in')firstIn.get(fiKey).at(-1).nodes.set(node.seat,node);
   for(const [hi,lo] of KICKER){const a=contOf(node,P.classes.indexOf(hi)),b=contOf(node,P.classes.indexOf(lo));if(b-a<.5)continue;row.orderBreaches++;
    // A breach is safe only when the app grades neither hand: then it cannot call the wrong one a mistake.
    // The app flags the breach at grade time from the node's class mix (referenceOrderBreach in references-ui.js); same here.
    const mix=Object.fromEntries(P.classes.map((x,j)=>[x,freqRow(node,j)]));
    const gradedHand=c=>{const i=P.classes.indexOf(c),fr=freqRow(node,i),o=optionsOf(node,k=>fr[k]),breach=app.chartOrderBreach(mix,c,fold);return[fold,cont].some(k=>k>=0&&app.gradeCounts({...syntheticGrade(pack,node,classCards(c),k,fr[k],o),...breach?{orderBreach:true}:{}}));};
    if(gradedHand(hi)||gradedHand(lo))row.orderGraded.push(hi+' '+pct(a)+' < '+lo+' '+pct(b)+' · '+pack.name.replace(/ \(.*\)$/,'')+' seat '+node.seat);}
  }
  if(cls==='vs limp'){const ri=node.actions.map((a,i)=>a.kind==='raise'?i:-1).filter(i=>i>=0);let t=0,w=0;P.classes.forEach((c,i)=>{const n=c.length===2?6:c[2]==='s'?4:12;w+=n;for(const k of ri)t+=n*node.table[i*node.actions.length+k]/1000;});vsLimp.push({chart:pack.name,seat:node.seat,seats:cfg.seats,raise:t/w});}
 }
}
// Depth stand-ins: a table between two chart depths gets the nearer chart. Where neighbours (within the 1.6x match
// tolerance) disagree on whether a hand opens, a grade near the midpoint depends on which chart answered.
const depthFlips=[];
for(const [k,list] of firstIn){list.sort((a,b)=>a.depth-b.depth);for(let j=1;j<list.length;j++){const a=list[j-1],b=list[j];if(b.depth/a.depth>1.6*1.6)continue;
 let w=0,flip=0;for(const [seat,na] of a.nodes){const nb=b.nodes.get(seat);if(!nb)continue;P.classes.forEach((c,i)=>{const n=c.length===2?6:c[2]==='s'?4:12,x=contOf(na,i),y=contOf(nb,i);w+=n;if(Math.min(x,y)<.05&&Math.max(x,y)>=.5)flip+=n;});}
 if(w)depthFlips.push({spot:k.replace(/\|/g,' '),from:a.depth,to:b.depth,flip:flip/w});}}

// 6-max 100bb: the outside-reference balance check on responses to an open.
function runCheck(cmd,file){const r=spawnSync(process.execPath,[path.join(ROOT,cmd),file],{encoding:'utf8'});return{ok:r.status===0,out:(r.stdout+r.stderr).trim().split('\n')};}
const sixMax=manifest.packs.find(p=>p.variant==='NLH'&&p.mode==='cash'&&p.seats===6&&p.stack===100);
const balance=sixMax?runCheck('tools/preflop/balance-check.cjs',path.join(LIB,sixMax.file)):null;

// ---------- Postflop libraries: gates, and how well a stand-in flop stands in ----------
// The flop-library balance gate (tools/postflop/balance-check.cjs), run fresh: every flop or line it flags must be marked in
// the shipped file (spot.gate), or the app grades it.
const os=require('os'),gateJson=path.join(os.tmpdir(),'spot-trust-gate-'+process.pid+'.json');
const gateRun=spawnSync(process.execPath,[path.join(ROOT,'tools/postflop/balance-check.cjs'),...(manifest.flops||[]).map(f=>path.join(LIB,f.file)),'--json',gateJson],{encoding:'utf8',maxBuffer:64<<20});
let fresh=new Map();try{for(const r of JSON.parse(fs.readFileSync(gateJson,'utf8')).results)fresh.set(path.basename(r.file||'')+'|'+r.id,r);fs.unlinkSync(gateJson);}catch(e){gap('tools/postflop/balance-check.cjs','did not run: '+(gateRun.stderr||e.message).trim().split('\n').pop());}
const postflop=[];
for(const entry of manifest.flops||[]){
 let lib;try{lib=L.validate(gz(path.join(LIB,entry.file)));}catch(e){gap(entry.file,'flop library does not load: '+e.message);continue;}
 for(const spot of lib.spots){const g=spot.gate||null,flops=Object.keys(spot.flops).length,badFlops=g?.flops?Object.keys(g.flops).length:0,lines=g?.lines?Object.keys(g.lines):[];
  const now=fresh.get(path.basename(entry.file)+'|'+spot.id)||[...fresh.values()].find(r=>r.id===spot.id&&r.label===spot.label);
  if(now&&!g?.fail){const flops2=Object.keys(now.badFlops||{}).filter(k=>!g?.flops?.[k]),lines2=Object.keys(now.badLines||{}).filter(k=>!g?.lines?.[k]);
   if(now.fails?.length)gap(spot.label,'fails the flop balance gate ('+now.fails[0]+') but is graded');
   if(flops2.length)gap(spot.label,flops2.length+' flop(s) fail the balance gate but are graded (not marked): '+flops2.slice(0,4).map(k=>k+' '+now.badFlops[k]).join('; '));
   if(lines2.length)gap(spot.label,'line(s) '+lines2.join(', ')+' fail the balance gate but are graded (not marked)');
   if(now.standIns&&!g?.standIns)gap(spot.label,'stand-in flops are graded although the balance gate says '+now.standIns);}
  // Solved flops: trusted unless the gate marks flops or lines; stand-in flops (most flops a hand reaches): approximate when
  // graded (the gate found them close enough), ungraded when marked.
  const solved=g?.fail?'ungraded':badFlops||lines.length?'approximate':'trusted',standIn=g?.fail||g?.standIns?'ungraded':spot.game==='PLO4'?'approximate':'approximate';
  postflop.push({id:spot.id,label:spot.label,game:spot.game||'NLH',flops,verdict:now?now.fails.length?'fail':now.partial.length?'partial':'pass':'not run',badFlops,lines,solved,standInTrust:standIn,standIn:now?.stats?.standIn||null,marked:g});}
}

// ---------- Rules the app applies wherever an answer comes from (synthetic decisions through hand-db.js) ----------
const base={street:1,hero:0,hand:'AsKd',choice:0,options:[{label:'Check',f:.5},{label:'Bet 3 bb',f:.5}],actions:[],referenceSource:null,rated:true,loss:0,units:'bb'};
const ROUTES=[
 ['Live solve, ranges from charts/library',{trust:'trusted',why:'TexasSolver or the exact engine on known ranges'},{...base,solve:{rangeAssumptions:[{range:'AA,KK'}]}}],
 ['Live solve with a guessed range',{trust:'ungraded',why:'a player\'s range is "All legal hands" or a bot guess'},{...base,solve:{rangeAssumptions:[{range:'All legal hands'}]}}],
 ['Off-tree size (answer mapped >1.6x)',{trust:'approximate',why:'shown as approximate, never graded'},{...base,rated:false,loss:null,referenceSource:{name:'Flop library'},referenceFrequency:.5,approximate:true}],
 ['Flop library, sizes not in the tree',{trust:'approximate',why:'nearest solved size stands in'},{...base,rated:false,loss:null,referenceSource:{name:'Flop library'},referenceFrequency:.5,approximate:true,solve:{method:'postflop-library',library:{standIn:true,sizesMatched:false}}}],
 ['Flop library stand-in flop',{trust:'approximate',why:'nearest solved flop of the same texture; see stand-in error'},{...base,rated:false,loss:null,referenceSource:{name:'Flop library'},referenceFrequency:.5,approximate:true,solve:{method:'postflop-library',library:{standIn:true,sizesMatched:true}}}],
 ['ICM table answered by a chip-EV chart',{trust:'ungraded',why:'payouts are not modelled'},{...base,street:0,rated:false,loss:null,referenceSource:{name:'NLH MTT 9-handed 20bb · chip-EV chart: this table\'s payouts (ICM) are not modelled'},referenceFrequency:.5}],
];
const routes=ROUTES.map(([name,pol,g])=>({name,...pol,graded:app.gradeCounts(g)}));
// The flop-library balance gate is applied in scoreResult (app.js), outside hand-db.js: check it is still wired.
const appSrc=fs.readFileSync(path.join(STUDIO,'app.js'),'utf8');
routes.push({name:'Flop library flop/line failing the balance gate',trust:'ungraded',why:'tools/postflop/balance-check.cjs --mark',graded:!/result\.solve\?\.library\?\.ungraded\)\{traceUngraded/.test(appSrc)});
const refSrc=fs.readFileSync(path.join(STUDIO,'references-ui.js'),'utf8');
if(!/referenceOrderBreach\(result,h\)\?\{orderBreach:true\}/.test(refSrc))gap('references-ui.js','chart grades no longer flag kicker-order breaches (orderBreach), so the audit\'s breach check does not match the app');
for(const r of routes)if(UNTRUSTED.has(r.trust)&&r.graded)gap(r.name,'graded although '+r.trust+' ('+r.why+')');

// ---------- Verdicts ----------
const rows=[...preflop.rows.values()].sort((a,b)=>a.variant.localeCompare(b.variant)||a.mode.localeCompare(b.mode)||Object.keys(POLICY).indexOf(a.cls)-Object.keys(POLICY).indexOf(b.cls)||a.size.localeCompare(b.size)||a.depth.localeCompare(b.depth));
for(const r of rows){
 const where=[r.cls,r.variant,r.mode,r.size,r.depth].join(' · ');
 if(r.premiumFolds.length){r.trust='wrong framing';r.why='premium hand folds: '+r.premiumFolds[0];}
 if(r.sumBad){r.trust='ungraded';r.why=r.sumBad+' node(s) whose rows do not add to 1';}
 if(r.orderGraded.length){r.checkNote=r.orderGraded.length+' graded kicker-order breach(es), e.g. '+r.orderGraded.slice(0,2).join('; ');}
 if(UNTRUSTED.has(r.trust)&&r.graded)gap(where,r.graded+'/'+r.nodes+' nodes graded although '+r.trust+' ('+r.why+')');
 if(r.trust==='approximate'&&r.graded>r.partial&&/fold vs continue/.test(r.why))gap(where,(r.graded-r.partial)+' nodes graded on the full action mix, but only fold vs continue is trusted');
 // Train scores what it deals, so a drilled spot Play does not grade is a gap; graded but not drilled is only coverage.
 if(r.drilled>r.graded)gap(where,'Train drills '+r.drilled+' nodes, Play grades '+r.graded+' ('+r.examples.find(x=>x.startsWith('drilled'))+')');
 else if(r.drilled<r.graded)r.coverage='not drilled in Train';
}
for(const d of depthFlips)if(d.flip>.1)notes.push('Depth stand-in '+d.spot+' '+d.from+'↔'+d.to+'bb: '+pct(d.flip)+' of first-in combos open in one chart and fold in the other');

// ---------- Report ----------
const roll=new Map();// summary: one row per line class and variant/format, worst trust wins
const order=['trusted','approximate','ungraded','wrong framing'];
for(const r of rows){const k=[r.cls,r.variant,r.mode].join('|');let s=roll.get(k);if(!s){s={cls:r.cls,variant:r.variant,mode:r.mode,trust:r.trust,why:r.why,nodes:0,graded:0,partial:0,drilled:0,charts:new Set(),order:0};roll.set(k,s);}
 if(order.indexOf(r.trust)>order.indexOf(s.trust)){s.trust=r.trust;s.why=r.why;}s.nodes+=r.nodes;s.graded+=r.graded;s.partial+=r.partial;s.drilled+=r.drilled;r.charts.forEach(c=>s.charts.add(c));s.order+=r.orderGraded.length;}
const gradedText=s=>!s.graded?'no':s.graded===s.nodes?(s.partial===s.graded?'fold vs continue':'yes'):s.graded+'/'+s.nodes;
const md=[];
md.push('# Spot trust audit','',`${manifest.version} · ${preflop.charts} preflop charts, ${preflop.nodes} reachable chart nodes · ${postflop.length} flop-library spots · ${gaps.length} gap(s)`,'');
md.push('## Gaps (trust and grading disagree)','',gaps.length?gaps.map(g=>'- **'+g.where+'**: '+g.text).join('\n'):'None: every untrusted spot is ungraded, and Train drills exactly the spots Play grades.','');
md.push('## Preflop','','| Spot | Game | Trust | Graded | Drilled | Nodes | Why |','|---|---|---|---|---|---|---|');
for(const s of roll.values())md.push(`| ${s.cls} | ${s.variant} ${s.mode} | ${s.trust} | ${gradedText(s)} | ${s.drilled===s.nodes?'yes':s.drilled?s.drilled+'/'+s.nodes:'no'} | ${s.nodes} | ${s.why}${s.order?' · '+s.order+' graded kicker-order breaches':''} |`);
md.push('','Checks: 6-max 100bb balance vs BeyondGTO '+(balance?balance.ok?'**pass**':'**fail**':'n/a')+(balance&&!balance.ok?' ('+balance.out.filter(l=>/FAIL|fail/i.test(l)).slice(0,4).join('; ')+')':'')+'.');
const limpHi=vsLimp.filter(v=>v.raise>.5);md.push('Vs limp raise rate: '+(vsLimp.length?pct(Math.min(...vsLimp.map(v=>v.raise)))+'–'+pct(Math.max(...vsLimp.map(v=>v.raise)))+' across '+vsLimp.length+' nodes'+(limpHi.length?', '+limpHi.length+' over 50%':''):'none')+'.');
const worstDepth=depthFlips.slice().sort((a,b)=>b.flip-a.flip).slice(0,5);md.push('Depth stand-ins (first-in open/fold flips between neighbouring charts): '+(worstDepth.length?worstDepth.map(d=>d.spot+' '+d.from+'↔'+d.to+'bb '+pct(d.flip)).join(', '):'none')+'.','');
md.push('### Kicker-order breaches that are graded','');const ob=rows.flatMap(r=>r.orderGraded.map(x=>r.cls+' · '+x));md.push(ob.length?ob.slice(0,30).map(x=>'- '+x).join('\n')+(ob.length>30?'\n- … '+(ob.length-30)+' more':''):'None.','');
md.push('## Postflop libraries','','Stand-in error: answering each solved flop from its nearest other solved flop, the share of combos where the stand-in calls a play a mistake (<5%) that the real flop plays 25%+ / plays as its main play (50%+). Stand-ins grade only where the main-play figure is at most 3%.','','| Spot | Flops | Gate | Solved flops | Stand-in flops | Stand-in error |','|---|---|---|---|---|---|');
for(const s of postflop)md.push(`| ${s.label} | ${s.flops} | ${s.verdict}${s.badFlops?' · '+s.badFlops+' flops ungraded':''}${s.lines.length?' · lines '+s.lines.join(', ')+' ungraded':''} | ${s.solved} | ${s.standInTrust} | ${s.standIn?pct(s.standIn.falseMistake)+' / '+pct(s.standIn.mainPlay):'–'} |`);
md.push('','## Answer routes','','| Route | Trust | Graded | Why |','|---|---|---|---|');for(const r of routes)md.push(`| ${r.name} | ${r.trust} | ${r.graded?'yes':'no'} | ${r.why} |`);
if(notes.length)md.push('','## Notes','',notes.map(n=>'- '+n).join('\n'));
const text=md.join('\n')+'\n';
if(opt('--md'))fs.writeFileSync(opt('--md'),text);
if(opt('--json'))fs.writeFileSync(opt('--json'),JSON.stringify({version:manifest.version,gaps,notes,preflop:rows.map(r=>({...r,charts:[...r.charts]})),postflop,routes,balance,vsLimp,depthFlips},null,1));
if(!opt('--md'))process.stdout.write(text);else console.log(`${preflop.nodes} chart nodes, ${postflop.length} library spots, ${gaps.length} gap(s). Report: ${opt('--md')}`);
if(gaps.length)process.exitCode=2;
