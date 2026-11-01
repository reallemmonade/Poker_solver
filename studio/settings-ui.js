'use strict';
// Settings laid out as grouped rows (the Guava settings mockup): gold section headings, one row per setting with a
// switch or a value on the right, and the longer panels (solver, help) as rows that open in place.
// Runs after initInterface, which builds the dialog's pieces; this only regroups and restyles them.
function initSettingsLayout(){
 const dialog=$('uiSettingsDialog'),content=dialog?.querySelector('.ui-dialog-content');if(!content||content.dataset.grouped)return;content.dataset.grouped='1';
 dialog.querySelector('.ui-dialog-head h2').textContent='Settings';dialog.setAttribute('aria-label','Settings');
 const make=(tag,cls,html='')=>{const n=document.createElement(tag);if(cls)n.className=cls;n.innerHTML=html;return n;};
 const byTitle=t=>[...content.querySelectorAll(':scope > details')].find(d=>d.querySelector(':scope > summary')?.textContent.trim()===t);
 const section=title=>{const s=make('section','set-section','<h3 class="set-head">'+title+'</h3>');return s;};
 const valueRow=(label,select)=>{const row=make('label','set-row','<span>'+label+'</span>');select.className='set-value';row.append(select);return row;};
 // Decision recording keeps its details element (the "recording" jump target flashes it), always open.
 const grading=byTitle('Decision recording'),recording=section('Decision recording');
 if(grading){grading.classList.add('set-fixed');grading.open=true;grading.querySelector(':scope > summary').hidden=true;grading.addEventListener('toggle',()=>{if(!grading.open)grading.open=true;});
  const rows=[['guessGateOn','Guess before solver','Pick your play before analysis shows'],['handReportOn','Rate each hand when it ends',''],['gradeEvery','Grade my decisions','']];
  // The hand report's own switch can be left behind when its script adds it before the dialog is built, so both are made here when missing.
  const made={guessGateOn:()=>typeof guessGateSwitch==='function'?guessGateSwitch():null,handReportOn:()=>{if(typeof handReportOn!=='function')return null;const b=document.createElement('input');b.type='checkbox';b.id='handReportOn';b.checked=handReportOn();b.onchange=()=>{try{localStorage.setItem(handReport.key,b.checked?'1':'0')}catch{}if(!b.checked)handReportClose();};return b;}};
  for(const [id,text,sub] of rows){const box=$(id)||made[id]?.();if(!box)continue;const label=box.closest('label')||make('label');label.className='set-row';label.textContent='';label.append(make('span','',text+(sub?'<small>'+sub+'</small>':'')),box);grading.append(label);}
  recording.append(grading);}
 const table=section('Table');
 if($('uiSounds'))table.append(valueRow('Sounds',$('uiSounds')));
 for(const [id,label] of [['uiLook','Look'],['uiFelt','Table color'],['uiTheme','Light or dark']])if($(id))table.append(valueRow(label,$(id)));
 content.querySelector('.ui-sounds')?.remove();const display=byTitle('Card display & theme');if(display&&!display.querySelector('select,input,button'))display.remove();
 const disc=(sec,titles)=>{for(const t of titles){const d=byTitle(t);if(d){d.classList.add('set-disc');sec.append(d);}}return sec;};
 const solver=disc(section('Solver'),['Solver settings','Advanced solver tools']);
 const help=disc(section('Help'),['How to use Guava Poker','Poker terms','Technical details','Activity details']);
 // Anything else the dialog holds stays, after the solver rows.
 for(const n of [...content.children])if(!n.matches('section.set-section')){if(n.tagName==='DETAILS')n.classList.add('set-disc');solver.append(n);}
 content.prepend(recording,table,solver,help);if(display?.isConnected&&display.parentElement!==solver)solver.append(display);
 const style=document.createElement('style');style.textContent=`
#uiSettingsDialog .ui-dialog-content{padding-top:4px}
#uiSettingsDialog .set-head{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);margin:20px 0 2px}
#uiSettingsDialog details.set-fixed{margin:0;padding:0}#uiSettingsDialog details.set-fixed>summary{display:none}
#uiSettingsDialog .set-row{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:54px;padding:12px 0;margin:0;border-bottom:1px solid var(--line);font-size:15px;font-weight:500;color:var(--ink);cursor:pointer}
#uiSettingsDialog .set-row>span{flex:1;min-width:0}
#uiSettingsDialog .set-row small{display:block;color:var(--muted);font-size:12px;font-weight:400;margin-top:2px}
#uiSettingsDialog .set-row input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:none;width:48px;height:29px;margin:0;border-radius:15px;background:color-mix(in srgb,var(--ink) 18%,transparent);position:relative;cursor:pointer;transition:background .18s}
#uiSettingsDialog .set-row input[type=checkbox]::after{content:'';position:absolute;left:3px;top:3px;width:23px;height:23px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transition:transform .18s}
#uiSettingsDialog .set-row input[type=checkbox]:checked{background:var(--gold)}
#uiSettingsDialog .set-row input[type=checkbox]:checked::after{transform:translateX(19px)}
#uiSettingsDialog .set-row input[type=checkbox]:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
#uiSettingsDialog select.set-value{appearance:none;-webkit-appearance:none;width:auto;max-width:55%;min-height:0;margin:0;padding:4px 16px 4px 4px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;text-align:right;text-align-last:right;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(-45deg,transparent 50%,currentColor 50%);background-size:5px 5px;background-position:calc(100% - 7px) 50%,calc(100% - 2px) 50%;background-repeat:no-repeat;transform:none}
#uiSettingsDialog details.set-disc{margin:0;padding:0;border-top:0;border-bottom:1px solid var(--line)}
#uiSettingsDialog details.set-disc>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;min-height:54px;margin:0;padding:12px 0;color:var(--ink);font-size:15px;font-weight:500;cursor:pointer}
#uiSettingsDialog details.set-disc>summary::-webkit-details-marker{display:none}
#uiSettingsDialog details.set-disc>summary::after{content:'›';color:var(--muted);font-size:20px;line-height:1;transition:transform .15s}
#uiSettingsDialog details.set-disc[open]>summary::after{transform:rotate(90deg)}
#uiSettingsDialog details.set-disc[open]{padding-bottom:12px}`;document.head.append(style);}
