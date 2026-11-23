'use strict';
// Hand grade on the felt: when "Rate each hand" is on, the pot text gives way to a medal once the hand ends.
// A ring fills to the hand's score (the hand report's 0-100), then your Overall Elo rolls to its new value and a
// +/- chip shows the change. Tapping the medal opens the full hand report. Elo is rebuilt from saved hands, so the
// change is the Overall rating with this hand less the rating without it (rating.js, leak-drills.js leakDecisions).
// A postflop grade that is still solving keeps the ring spinning; the medal updates when it lands.
const handGrade={el:null,row:null,hand:null,shown:null,timers:[]};
const HG_ARROW={up:'<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1l4 7H1z"/></svg>',down:'<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9L1 2h8z"/></svg>'};
const hgCalm=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion:reduce)').matches;
function hgRating(rows){try{return PokerRating.rate(leakDecisions(factsOf(rows))).rating??PokerRating.START}catch{return null}}
// Score and Elo for the hand on screen. Elo is null while nothing in the hand is graded yet.
function handGradeFacts(row){const s=handReportSummary(row.record),grading=handReportGrading();
 if(s.score===null)return{score:null,grading,elo:null};
 const after=hgRating(state.histories),before=hgRating(state.histories.filter(r=>r!==row));
 return{score:s.score,grading,elo:after===null||before===null?null:{before,after}};}
function hgTone(score){return score>=90?'good':score>=60?'ok':'bad'}
// Odometer: each changed digit slides out and the new one slides in, upward for a gain and downward for a loss.
function hgOdoSet(el,v,dir){const s=String(v);if(el.children.length!==s.length||!dir){el.innerHTML=[...s].map(d=>'<span class="hg-dg"><span>'+d+'</span></span>').join('');return;}
 [...s].forEach((d,i)=>{const slot=el.children[i],cur=slot.lastElementChild;if(cur.textContent===d)return;slot.querySelectorAll('.hg-ou,.hg-od').forEach(n=>n.remove());cur.className=dir==='up'?'hg-ou':'hg-od';const n=document.createElement('span');n.textContent=d;n.className=dir==='up'?'hg-iu':'hg-id';slot.append(n);setTimeout(()=>cur.remove(),170);});}
function hgRoll(el,from,to,ms){const dir=to>from?'up':'down',gap=Math.abs(to-from),steps=Math.min(gap,30);hgOdoSet(el,from);if(!gap||hgCalm()){hgOdoSet(el,to);return;}
 for(let k=1;k<=steps;k++)hgLater(ms*Math.pow(k/steps,1.8),()=>hgOdoSet(el,from+Math.sign(to-from)*Math.round(gap*k/steps),dir));}
function hgCount(el,from,to,ms){if(hgCalm()){el.textContent=to;return;}const t0=performance.now(),f=t=>{const p=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-p,3);el.textContent=Math.round(from+(to-from)*e);if(p<1)requestAnimationFrame(f);};requestAnimationFrame(f);}
function hgSparks(dir){const el=handGrade.el;if(!el||hgCalm()||!el.animate)return;for(let i=0;i<(dir==='up'?14:8);i++){const s=document.createElement('i');s.className='hg-spark hg-'+dir+(i%2?' alt':'');el.append(s);
 const a=dir==='up'?-Math.PI/2+(Math.random()-.5)*1.6:Math.PI/2+(Math.random()-.5)*1.4,d=24+Math.random()*30;
 s.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d}px) scale(.3)`,opacity:0}],{duration:650+Math.random()*350,easing:'cubic-bezier(.2,.7,.3,1)',fill:'forwards'}).onfinish=()=>s.remove();}}
function hgLater(ms,f){handGrade.timers.push(setTimeout(f,ms));}
function hgClear(){handGrade.timers.forEach(clearTimeout);handGrade.timers=[];}
function hgBox(){const el=document.createElement('button');el.type='button';el.className='hg-medal';el.setAttribute('aria-label','Hand grade. Open the hand report');
 el.innerHTML='<span class="hg-ring"><span class="hg-score">0</span></span><span class="hg-elo"><small>ELO</small><span class="hg-odo"></span></span><span class="hg-delta"></span>';
 el.addEventListener('click',()=>{if(handGrade.row&&typeof handReportShow==='function')handReportShow(handGrade.row,handGrade.hand);});return el;}
// Put the medal where the pot text was, and keep it there when the table repaints.
function hgPlace(){const el=handGrade.el,root=$('table');if(!el||!root)return;if(el.parentNode!==root)root.append(el);root.classList.add('hg-on');
 const pot=root.querySelector('.pot-total'),R=root.getBoundingClientRect();if(!pot||!R.height)return;const r=pot.getBoundingClientRect();if(!r.height)return;
 // On a short felt the medal is taller than the pot text: keep it between the board and your cards.
 const half=el.offsetHeight/2,cards=root.querySelector('.hero-seat .seat-cards')?.getBoundingClientRect(),board=root.querySelector('.board-cards')?.getBoundingClientRect();let y=r.top+r.height/2;
 if(cards?.height&&cards.left<R.left+R.width/2+el.offsetWidth/2&&cards.right>R.left+R.width/2-el.offsetWidth/2)y=Math.min(y,cards.top-4-half);if(board?.height)y=Math.max(y,board.bottom+4+half);
 el.style.top=((y-R.top)*100/R.height).toFixed(2)+'%';}
// Draw (or redraw after a late grade) the medal from what it showed last to the current facts.
function handGradeRender(){const el=handGrade.el,row=handGrade.row;if(!el||!row)return;const f=handGradeFacts(row),was=handGrade.shown,ring=el.querySelector('.hg-ring'),score=el.querySelector('.hg-score'),odo=el.querySelector('.hg-odo'),delta=el.querySelector('.hg-delta');
 if(f.score===null&&!f.grading){handGradeHide();return;}
 hgClear();el.classList.remove('hg-glow-up','hg-glow-down','hg-shake');
 if(f.score===null){el.classList.add('hg-wait');score.textContent='';el.querySelector('.hg-elo').hidden=true;delta.className='hg-delta';delta.innerHTML='';handGrade.shown=null;return;}
 el.classList.remove('hg-wait');el.querySelector('.hg-elo').hidden=!f.elo;el.dataset.tone=hgTone(f.score);
 const from=was?.score??0;requestAnimationFrame(()=>ring.style.setProperty('--hg-deg',f.score*3.6+'deg'));hgCount(score,from,f.score,900);
 if(f.elo){const start=was?.elo?.shown??f.elo.before,end=f.elo.after,change=end-f.elo.before,dir=change>0?'up':change<0?'down':'',wait=was?150:1000;
  hgOdoSet(odo,start);delta.className='hg-delta'+(dir?' hg-'+dir:' hg-flat');delta.innerHTML=(dir?HG_ARROW[dir]:'')+(change>0?'+':change<0?'−':'±')+Math.abs(change);
  hgLater(wait,()=>{hgRoll(odo,start,end,1200);if(dir)el.classList.add('hg-glow-'+dir);});
  hgLater(wait+1250,()=>{delta.classList.add('hg-show');if(dir&&(!was||was.elo?.change!==change)){hgSparks(dir);if(dir==='down'&&!hgCalm())el.classList.add('hg-shake');}});
  hgLater(wait+2900,()=>el.classList.remove('hg-glow-up','hg-glow-down'));
  handGrade.shown={score:f.score,elo:{shown:end,change}};}
 else handGrade.shown={score:f.score,elo:null};}
function handGradeShow(row,hand){handGradeHide();handGrade.row=row;handGrade.hand=hand;handGrade.shown=null;handGrade.el=hgBox();hgPlace();handGradeRender();if(handGrade.el)requestAnimationFrame(()=>handGrade.el?.classList.add('hg-in'));}
function handGradeHide(){hgClear();handGrade.el?.remove();handGrade.el=null;handGrade.row=null;handGrade.hand=null;handGrade.shown=null;$('table')?.classList.remove('hg-on');}
function handGradeUpdate(row){if(handGrade.el&&handGrade.row===row)handGradeRender();}
function initHandGrade(){const style=document.createElement('style');style.textContent=`
@property --hg-deg{syntax:'<angle>';inherits:false;initial-value:0deg}
.felt.hg-on .table-pot .pot-total{visibility:hidden}
.hg-medal{--hg-up:#6fcf8a;--hg-ok:#e0c35c;--hg-down:#ff7a6e;position:absolute;left:50%;top:67%;z-index:6;display:flex;align-items:center;gap:9px;padding:4px 13px 4px 4px;border-radius:30px;background:#1f120fe8;border:1px solid #d6a95c66;color:#f6ebe0;box-shadow:0 8px 24px #0009;font:inherit;cursor:pointer;white-space:nowrap;transform:translate(-50%,-50%) scale(.6);opacity:0;transition:transform .45s cubic-bezier(.3,1.5,.5,1),opacity .25s,border-color .3s}
.hg-medal.hg-in{transform:translate(-50%,-50%);opacity:1}
.hg-medal:focus-visible{outline:2px solid var(--gold,#e0a63c);outline-offset:2px}
.hg-ring{--c:var(--hg-up);width:42px;height:42px;border-radius:50%;flex:none;display:grid;place-items:center;background:conic-gradient(var(--c) var(--hg-deg),#ffffff1c 0);transition:--hg-deg .9s cubic-bezier(.2,.7,.2,1)}
.hg-medal[data-tone=ok] .hg-ring{--c:var(--hg-ok)}.hg-medal[data-tone=bad] .hg-ring{--c:var(--hg-down)}
.hg-score{width:34px;height:34px;border-radius:50%;background:#20140f;display:grid;place-items:center;font-weight:800;font-size:15px;font-variant-numeric:tabular-nums}
.hg-medal.hg-wait .hg-ring{background:conic-gradient(var(--gold,#e0a63c) 70deg,#ffffff1c 0);animation:hgSpin 1s linear infinite}.hg-medal.hg-wait{padding-right:4px}
@keyframes hgSpin{to{rotate:360deg}}
.hg-elo{display:flex;flex-direction:column;align-items:flex-start;line-height:1}
.hg-elo small{font-size:8px;letter-spacing:.14em;color:#b5a394;font-weight:700}
.hg-odo{display:inline-flex;font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;overflow:hidden;line-height:1.1;transition:color .3s,text-shadow .3s}
.hg-dg{position:relative;display:inline-block;width:.62em;height:1.1em;text-align:center}.hg-dg>span{position:absolute;left:0;right:0;top:0}
@keyframes hgInUp{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}@keyframes hgOutUp{to{transform:translateY(-100%);opacity:0}}
@keyframes hgInDown{from{transform:translateY(-100%);opacity:0}to{transform:none;opacity:1}}@keyframes hgOutDown{to{transform:translateY(100%);opacity:0}}
.hg-dg .hg-iu{animation:hgInUp .16s ease-out both}.hg-dg .hg-ou{animation:hgOutUp .16s ease-in both}.hg-dg .hg-id{animation:hgInDown .16s ease-out both}.hg-dg .hg-od{animation:hgOutDown .16s ease-in both}
.hg-delta{display:inline-flex;align-items:center;gap:2px;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s}
.hg-delta.hg-show{opacity:1;transform:none}.hg-delta:empty{display:none}
.hg-delta svg{width:9px;height:9px;fill:currentColor}
.hg-delta.hg-up{color:var(--hg-up)}.hg-delta.hg-down{color:var(--hg-down)}.hg-delta.hg-flat{color:#b5a394}
.hg-medal.hg-glow-up{border-color:#6fcf8a88}.hg-medal.hg-glow-up .hg-odo{color:var(--hg-up);text-shadow:0 0 14px #6fcf8a88}
.hg-medal.hg-glow-down{border-color:#ff7a6e88}.hg-medal.hg-glow-down .hg-odo{color:var(--hg-down);text-shadow:0 0 14px #ff7a6e77}
@keyframes hgShake{0%,100%{translate:0}20%{translate:-4px}40%{translate:4px}60%{translate:-3px}80%{translate:2px}}
.hg-medal.hg-shake{animation:hgShake .45s}
.hg-spark{position:absolute;left:calc(100% - 26px);top:4px;width:5px;height:5px;border-radius:50%;pointer-events:none;background:#6fcf8a}
.hg-spark.alt{background:#e0a63c}.hg-spark.hg-down{background:#ff7a6e;top:auto;bottom:4px}
@media(max-width:500px){.hg-ring{width:38px;height:38px}.hg-score{width:31px;height:31px;font-size:14px}.hg-odo{font-size:19px}.hg-delta{font-size:13px}.hg-medal{gap:7px;padding-right:11px}}
@media(prefers-reduced-motion:reduce){.hg-medal,.hg-ring,.hg-delta{transition:none}.hg-medal.hg-wait .hg-ring{animation:none}}`;document.head.append(style);
 // The table repaints by replacing its markup; put the medal back each time.
 if(typeof paintTable==='function'){const paint=paintTable;paintTable=function(root,...rest){const out=paint.call(this,root,...rest);if(handGrade.el&&root?.id==='table'){if(state.hand!==handGrade.hand)handGradeHide();else hgPlace();}return out;};}
 addEventListener('resize',()=>{if(handGrade.el)hgPlace();});}
if(typeof document!=='undefined')initHandGrade();
