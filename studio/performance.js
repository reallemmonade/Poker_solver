'use strict';
// Performance: your Citrus rating (rating.js) for Overall, MTT, Cash and Heads-up, with its progression over time.
// Ratings are rebuilt from the saved hands' unassisted graded decisions each time the view opens, so they need no
// storage of their own and follow the hands wherever they sync.
const perf={sel:'overall',key:''};
const PERF_WEEK=7*864e5;
function perfPath(history,w,h,pad=2,padY=pad){const pts=PokerRating.thin(history);if(!pts.length)return{d:'',lo:0,hi:0};
 const rs=pts.map(p=>p[1]),lo=Math.min(...rs,PokerRating.START),hi=Math.max(...rs,PokerRating.START),span=Math.max(hi-lo,40),mid=(hi+lo)/2,top=mid+span/2,bottom=mid-span/2,
  x=i=>pad+(pts.length<2?w-2*pad:i*(w-2*pad)/(pts.length-1)),y=r=>padY+(top-r)*(h-2*padY)/(top-bottom);
 return{d:(pts.length<2?'M'+pad+' '+y(pts[0][1])+'L':'M')+pts.map((p,i)=>x(i).toFixed(1)+' '+y(p[1]).toFixed(1)).join('L'),lo:Math.round(bottom),hi:Math.round(top),y};}
function perfSpark(c){const p=perfPath(c.history,100,28);return'<svg class="perf-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="'+p.d+'"/></svg>';}
function perfDelta(c){const d=PokerRating.change(c.history,Date.now()-PERF_WEEK);return d?'<span class="perf-delta '+(d>0?'up':'down')+'" title="Last 7 days">'+(d>0?'+':'−')+Math.abs(d)+'</span>':'';}
const perfSigned=x=>x===null?'–':x>0?'+'+x:x<0?'−'+-x:'0';
const perfRating=c=>c.rating===null?'–':c.rating+(c.provisional?'?':'');
function renderPerformance(){const box=$('uiPerformance');if(!box)return;
 const facts=factsOf(state.histories),key=facts.map(f=>f.key).join()+'|'+perf.sel+'|'+$('gradeEvery').checked;if(perf.key===key&&box.dataset.ready)return;perf.key=key;box.dataset.ready='1';
 const cats=PokerRating.compute(leakDecisions(facts)),c=cats.find(x=>x.id===perf.sel)||cats[0],cat=PokerRating.CATEGORIES.find(x=>x.id===c.id),
  hands=facts.filter(f=>!f.assisted&&cat.test(f)),rate=bbPer100(hands);
 if(!cats[0].n){box.innerHTML='<div class="perf-empty"><b>Play to earn your rating</b><p class="help">'+(!$('gradeEvery').checked?'<button type="button" class="ui-jump" data-jump="recording">Turn on decision recording</button> first.':'Hands where you saw the analysis before acting don’t count.')+'</p>'+(!$('gradeEvery').checked?'':'<button type="button" class="btn" data-route="play">Play</button>')+'</div>';return;}
 const big=perfPath(c.history,600,180,8,22);
 box.innerHTML='<div class="perf-cards" role="tablist">'+cats.map(x=>'<button type="button" role="tab" class="perf-card'+(x.id===c.id?' active':'')+(x.n?'':' empty')+'" data-perf="'+x.id+'" aria-selected="'+(x.id===c.id)+'"><small>'+x.label+'</small><b>'+perfRating(x)+'</b>'+perfDelta(x)+(x.n>1?perfSpark(x):'')+'</button>').join('')+'</div>'+
  '<div class="perf-detail">'+(c.n?'<svg class="perf-chart" viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label="'+c.label+' rating over time"><line x1="0" x2="600" y1="'+big.y(PokerRating.START).toFixed(1)+'" y2="'+big.y(PokerRating.START).toFixed(1)+'"/><path d="'+big.d+'"/></svg><div class="perf-axis small muted"><span>'+big.hi+'</span><span>'+big.lo+'</span></div>':'<p class="help">No '+c.label+' hands yet.</p>')+
  '<div class="hud-grid perf-stats"><span><small>Decisions</small>'+c.n+'</span><span><small>Accuracy</small>'+(c.accuracy===null?'–':Math.round(100*c.accuracy)+'%')+'</span><span><small>Peak</small>'+(c.peak??'–')+'</span><span><small>Hands</small>'+hands.length+'</span><span><small>bb/100</small>'+signedBB(rate)+'</span><span title="Change over the last 7 days"><small>7 days</small>'+perfSigned(c.n?PokerRating.change(c.history,Date.now()-PERF_WEEK):null)+'</span></div></div>';}
function initPerformance(){const v=$('uiPerformance');if(!v)return;
 v.addEventListener('click',e=>{const b=e.target.closest('[data-perf]');if(!b)return;perf.sel=b.dataset.perf;renderPerformance();});}
