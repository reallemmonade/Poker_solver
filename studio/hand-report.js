'use strict';
// Hand report: when the setting is on, a sheet rises after each hand with a score and one row per hero decision.
// The score is the mean of the same per-decision score the Elo uses (1 if right, e^-bb lost for a measured solver miss,
// 0 for a chart miss or a decision made after peeking), so a 90 here means what a 90% decision rate means on Performance.
// Solver rows carry every option's EV (grade.options); chart rows carry frequencies only, so they read "In chart" or a miss.
// It only appears once the hand is over: showing it mid-hand would hand you the analysis while you still act.
const handReport={open:false,row:null,hand:null,key:'guava-hand-report',wait:null};
function handReportOn(){try{return localStorage.getItem(handReport.key)==='1'}catch{return false}}
function handReportScore(g){return!gradeMistake(g)?1:gradeCost(g)>0?Math.exp(-gradeCost(g)):0;}
// Hero decisions in order, each matched to its grade by the action-log index it was made at.
function handReportDecisions(rec){const hero=rec.hero??0,grades=(rec.grading||[]).filter(g=>g.hero===undefined||g.hero===hero),out=[];
 rec.actions.forEach((a,i)=>{if(a.seat!==hero||a.type&&a.type!=='action')return;const g=grades.find(x=>(x.step??x.actions?.length)===i)||null;out.push({action:a,step:i,grade:g});});return out;}
function handReportSummary(rec){const ds=handReportDecisions(rec),graded=ds.filter(d=>d.grade),lost=graded.reduce((s,d)=>s+gradeCost(d.grade),0);
 return{ds,graded,lost,score:graded.length?Math.round(100*graded.reduce((s,d)=>s+handReportScore(d.grade),0)/graded.length):null,misses:graded.filter(d=>gradeMistake(d.grade)).length};}
// Worth a sheet when you did more than fold a chart-correct hand preflop.
function handReportWorth(rec){const s=handReportSummary(rec);return s.ds.some(d=>d.action.kind!=='fold'||d.grade&&gradeMistake(d.grade));}
const HR_STREETS=['P','F','T','R'],hrTone=g=>!g?'none':gradeMistake(g)?(gradeCost(g)>0&&gradeCost(g)<1?'ok':'bad'):'good';
function hrNum(x){return(x>=0?'+':'−')+fmt(Math.abs(x),1);}
function hrActionText(a,g){if(g?.label)return g.label;if(g?.action)return String(g.action).replace(/(\d+\.\d+)(?= bb)/g,n=>String(+(+n).toFixed(1)));return{fold:'Fold',check:'Check',call:'Call',bet:'Bet',raise:'Raise'}[a.kind]||a.kind;}
// Still grading while a queued or running assessment belongs to this hand.
function handReportGrading(){const h=handReport.hand;if(!h||$('gradeEvery')?.checked===false)return false;return state.pending?.live===h||state.gradeQueue.some(i=>i.live===h);}
function hrRow(d){const g=d.grade,tone=hrTone(g),street=HR_STREETS[d.action.street]||'',mine=hrActionText(d.action,g);let detail='',pill='';
 if(!g){detail='<div class="hr-sub">'+(handReportGrading()?'Grading…':'Not graded')+'</div>';pill='<span class="hr-pill hr-none">–</span>';}
 else if(g.peeked){detail='<div class="hr-sub">You looked at the analysis</div>';pill='<span class="hr-pill hr-bad">Peeked</span>';}
 else if(g.rated&&Array.isArray(g.options)&&g.options.some(o=>Number.isFinite(o.ev))){const evs=g.options.map(o=>o.ev).filter(Number.isFinite),max=Math.max(...evs),min=Math.min(...evs),you=g.options[g.choice]?.ev,best=g.options.find(o=>o.ev===max),span=Math.max(2,max-min),u=g.units==='bb'?'':' pts',pos=v=>Math.max(4,Math.min(100,100-92*(max-v)/span));
  const miss=gradeMistake(g);detail=(miss&&best?'<div class="hr-sub">Best '+esc(best.label)+' '+hrNum(max)+u+' · You '+hrNum(you)+u+'</div>':'<div class="hr-sub">EV '+hrNum(you)+u+'</div>')+'<div class="hr-bar"><i class="hr-'+tone+'" style="width:'+pos(you).toFixed(1)+'%"></i><u style="left:'+pos(max).toFixed(1)+'%"></u></div>';
  pill=miss?'<span class="hr-pill hr-'+tone+'">−'+fmt(g.loss,1)+u+'</span>':'<span class="hr-pill hr-good" aria-label="Best">✓</span>';}
 else if(g.referenceSource||Number.isFinite(g.referenceFrequency)){const f=g.referenceFrequency,miss=gradeMistake(g);detail='<div class="hr-sub">'+(miss?'Chart plays it '+Math.round(100*(f||0))+'%':'In chart · '+Math.round(100*(f||0))+'%')+'</div>';pill=miss?'<span class="hr-pill hr-bad">Miss</span>':'<span class="hr-pill hr-good" aria-label="In chart">✓</span>';}
 else{const f=g.options?.[g.choice]?.f;detail='<div class="hr-sub">'+(Number.isFinite(f)?'Solver plays it '+Math.round(100*f)+'%':'No EV for this spot')+'</div>';pill='<span class="hr-pill hr-none">–</span>';}
 return'<li class="hr-dec"><span class="hr-st">'+street+'</span><div class="hr-main"><b>'+esc(mine)+'</b>'+detail+'</div>'+pill+'</li>';}
function handReportHTML(row){const rec=row.record,s=handReportSummary(rec),net=handFacts(row).net,tone=s.score===null?'none':s.score>=90?'good':s.score>=60?'ok':'bad',deg=s.score===null?0:s.score*3.6;
 const head='<div class="hr-head"><div class="hr-ring hr-ring-'+tone+'" style="--deg:'+deg+'deg"><span>'+(s.score===null?'–':s.score)+'</span></div><div class="hr-sum"><div class="hr-big">'+(s.graded.length?(s.lost>0?'−'+fmt(s.lost,1):'0')+' bb <small>EV lost</small>':'Not graded')+'</div><div class="hr-sub">'+(net===null?'':(net>=0?'Won ':'Lost ')+fmt(Math.abs(net),1)+' bb · ')+(s.graded.length<s.ds.length?s.graded.length+' of '+s.ds.length+' graded':s.ds.length+' decision'+(s.ds.length===1?'':'s'))+(s.misses?' · '+s.misses+' miss'+(s.misses===1?'':'es'):'')+'</div></div></div>';
 const off=$('gradeEvery')?.checked===false?'<p class="hr-sub"><button type="button" class="ui-jump" data-jump="recording">Turn on decision recording</button> to rate hands.</p>':'';
 return'<div class="hr-grab" aria-hidden="true"></div>'+head+off+'<ol class="hr-list">'+s.ds.map(hrRow).join('')+'</ol><div class="hr-foot"><button type="button" class="btn secondary" data-hr="close">Close</button><button type="button" class="btn" data-hr="next">Next hand</button></div>';}
function handReportBox(){let box=$('handReport');if(box)return box;box=document.createElement('section');box.id='handReport';box.className='hr-sheet';box.setAttribute('role','dialog');box.setAttribute('aria-label','Hand report');box.hidden=true;document.body.append(box);
 box.addEventListener('click',e=>{const b=e.target.closest('[data-hr]');if(!b)return;const next=b.dataset.hr==='next';handReportClose();if(next&&state.hand?.done&&!$('deal').disabled)$('deal').click();else scheduleSessionNext();});
 document.addEventListener('keydown',e=>{if(handReport.open&&e.key==='Escape'){handReportClose();scheduleSessionNext();}});return box;}
function handReportPlace(box){const nav=document.querySelector('.ui-mobile-nav'),r=nav&&nav.offsetParent?nav.getBoundingClientRect():null;box.style.bottom=r&&r.top<innerHeight?Math.max(0,innerHeight-r.top)+'px':'';}
function handReportRender(){if(!handReport.open||!handReport.row)return;const box=handReportBox();box.innerHTML=handReportHTML(handReport.row);handReportPlace(box);}
function handReportShow(row,hand){const box=handReportBox();handReport.row=row;handReport.hand=hand;handReport.open=true;cancelSessionNext();box.hidden=false;handReportRender();requestAnimationFrame(()=>box.classList.add('hr-in'));}
function handReportClose(){clearTimeout(handReport.wait);handReport.wait=null;if(!handReport.open)return;handReport.open=false;const box=$('handReport');if(box){box.classList.remove('hr-in');box.hidden=true;}}
// Called once a live hand is saved: waits for the table to finish showing the hand, then opens the sheet.
function handReportOnEnd(row){handReportClose();if(!handReportOn()||typeof studioInterface!=='undefined'&&studioInterface.area==='study'||!handReportWorth(row.record))return;const hand=state.hand,t0=Date.now(),tick=()=>{handReport.wait=null;if(state.hand!==hand||!hand.done)return;if(tableView.playing&&Date.now()-t0<10000){handReport.wait=setTimeout(tick,200);return;}handReportShow(row,hand);};handReport.wait=setTimeout(tick,600);}
// A late grade for the hand on screen refreshes the sheet.
function handReportGraded(row){if(handReport.open&&handReport.row===row)handReportRender();}
function initHandReport(){const style=document.createElement('style');style.textContent=`
.hr-sheet{--hr-good:#3d8a44;--hr-ok:#a8720f;--hr-bad:#c23b2c}html:not(.light) .hr-sheet{--hr-good:#6fcf8a;--hr-ok:#e0c35c;--hr-bad:#ff7a6e}
.hr-sheet{position:fixed;left:0;right:0;bottom:0;z-index:60;max-width:440px;margin:0 auto;max-height:72svh;overflow:auto;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-bottom:0;border-radius:18px 18px 0 0;padding:10px 16px 14px;box-shadow:0 -12px 32px #0009;transform:translateY(16px);opacity:0;transition:transform .22s ease,opacity .22s ease}
.hr-sheet.hr-in{transform:none;opacity:1}@media(prefers-reduced-motion:reduce){.hr-sheet{transition:none}}
@media(min-width:900px){.hr-grab{display:none}.hr-sheet{bottom:24px;right:24px;left:auto;border-radius:16px;border-bottom:1px solid var(--line);width:400px}}
.hr-grab{width:38px;height:4px;border-radius:3px;background:var(--line);margin:0 auto 10px}
.hr-head{display:flex;gap:14px;align-items:center;margin-bottom:6px}
.hr-ring{--c:var(--muted);width:66px;height:66px;border-radius:50%;flex:none;display:grid;place-items:center;background:conic-gradient(var(--c) var(--deg),color-mix(in srgb,var(--ink) 10%,transparent) 0)}
.hr-ring span{width:54px;height:54px;border-radius:50%;background:var(--panel);display:grid;place-items:center;font-weight:800;font-size:19px}
.hr-ring-good{--c:var(--hr-good)}.hr-ring-ok{--c:var(--hr-ok)}.hr-ring-bad{--c:var(--hr-bad)}
.hr-big{font-size:21px;font-weight:800;line-height:1.15}.hr-big small{font-size:12px;font-weight:600;color:var(--muted)}
.hr-sub{font-size:12px;color:var(--muted);margin-top:2px}
.hr-list{list-style:none;margin:0;padding:0}
.hr-dec{display:grid;grid-template-columns:18px 1fr auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line)}
.hr-st{font-size:11px;font-weight:800;color:var(--muted);text-align:center}
.hr-main b{font-size:14px}
.hr-bar{position:relative;height:6px;border-radius:4px;background:color-mix(in srgb,var(--ink) 10%,transparent);margin-top:6px}
.hr-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}.hr-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.7}
.hr-bar .hr-good{background:var(--hr-good)}.hr-bar .hr-ok{background:var(--hr-ok)}.hr-bar .hr-bad{background:var(--hr-bad)}
.hr-pill{font-size:12px;font-weight:800;padding:3px 8px;border-radius:10px;white-space:nowrap}
.hr-pill.hr-good{color:var(--hr-good);background:color-mix(in srgb,var(--hr-good) 16%,transparent)}
.hr-pill.hr-ok{color:var(--hr-ok);background:color-mix(in srgb,var(--hr-ok) 16%,transparent)}
.hr-pill.hr-bad{color:var(--hr-bad);background:color-mix(in srgb,var(--hr-bad) 16%,transparent)}
.hr-pill.hr-none{color:var(--muted);background:color-mix(in srgb,var(--ink) 8%,transparent)}
.hr-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}`;document.head.append(style);
 // Setting: lives with Decision recording (the jump target "recording"), off by default.
 const add=()=>{const near=$('gradeEvery')?.closest('label');if(!near||$('handReportOn'))return;const label=document.createElement('label');label.className=near.className;label.innerHTML='<input type="checkbox" id="handReportOn"> Rate each hand when it ends';near.after(label);const box=$('handReportOn');box.checked=handReportOn();box.onchange=()=>{try{localStorage.setItem(handReport.key,box.checked?'1':'0')}catch{}if(!box.checked)handReportClose();};};
 add();setTimeout(add,0);addEventListener('resize',()=>{if(handReport.open)handReportPlace($('handReport'));});}
if(typeof document!=='undefined')initHandReport();
