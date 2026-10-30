'use strict';
// Saved hands as a small database: each hand is reduced once to the facts the History filters, insights,
// Library search and seat stats read. Facts are cached per hand and refreshed when a late assessment arrives.
const handDB={cache:new Map(),filter:{pos:'',pot:'',result:'',sort:'new',by:'pos'},shown:10,statsKey:'',stats:null};
const RANKS='23456789TJQKA',POTS=['Walk','Limped','SRP','3-bet','4-bet+','Postflop'],ENDS=['Preflop','Flop','Turn','River','Showdown'];
function comboOf(cards){if(!cards||cards.length!==4)return cards||'';const a=cards[0],b=cards[2],s=cards[1]===cards[3],[hi,lo]=RANKS.indexOf(a)>=RANKS.indexOf(b)?[a,b]:[b,a];return hi===lo?hi+lo:hi+lo+(s?'s':'o');}
function handGroup(combo){if(combo.length<2||combo.length>3)return'Other';const hi=RANKS.indexOf(combo[0]),lo=RANKS.indexOf(combo[1]),suited=combo[2]==='s';if(hi===lo)return'Pairs';if(lo>=8)return'Broadway';if(suited&&hi===12)return'Suited aces';if(suited&&hi-lo<=2)return'Suited connectors';return suited?'Other suited':'Other offsuit';}
// A decision counts as a mistake when the solver measured a loss, or a chart choice is played under 5% in the source.
// A chip-EV chart standing in for an ICM table does not model the payouts, and an approximate (off-tree size) answer is not
// the chart's own, so their choices are shown but never counted as mistakes. A decision made after looking at the analysis
// (peeked) always counts, at no measured cost: needing to look means the spot isn't known yet.
function gradeMistake(g){return g.peeked?true:g.referenceSource?!g.approximate&&!/chip-EV chart/.test(g.referenceSource.name||'')&&g.referenceFrequency!==null&&g.referenceFrequency<(typeof chartMistakeFrequency==='number'?chartMistakeFrequency:.05):!!(g.rated&&g.loss>(g.units==='bb'?.05:0));}
function gradeCost(g){return!g.peeked&&g.rated&&g.units==='bb'&&Number.isFinite(g.loss)&&g.loss>0?g.loss:0;}
function handFacts(row){const rec=row.record,key=row.id+'|'+(rec.grading||[]).length;let f=handDB.cache.get(row.id);if(f?.key===key)return f;
 const c=rec.config,hero=rec.hero??0,base=PokerStats.fromRecord(rec),pre=rec.actions.filter(a=>a.street===0),raises=pre.filter(a=>a.kind==='raise'||a.kind==='bet').length,
  pot=c.startStreet>0?'Postflop':raises>=3?'4-bet+':raises===2?'3-bet':raises===1?'SRP':pre.some(a=>a.kind==='call')?'Limped':'Walk',
  mine=rec.actions.filter(a=>a.seat===hero),fold=mine.find(a=>a.kind==='fold'),atShowdown=base.showdown.includes(hero),
  ended=fold?ENDS[fold.street]:atShowdown?'Showdown':ENDS[Math.max(0,...rec.actions.map(a=>a.street))],
  line=[0,1,2,3].map(s=>mine.filter(a=>a.street===s).map(a=>({fold:'F',check:'X',call:'C',bet:'B',raise:'R'})[a.kind]).join('')).filter(Boolean).join('/'),
  grades=(rec.grading||[]).filter(g=>g.hero===undefined||g.hero===hero),mistakes=grades.filter(gradeMistake),combo=comboOf(rec.holes?.[hero]||''),pos=G.positions(c.seats,c.button)[hero]||'Seat '+(hero+1),
  net=base.net?Math.round(base.net[hero]*100)/100:null;
 f={key,id:row.id,at:row.createdAt,assisted:rec.assisted!==false,hero,pos,combo,group:rec.holes?.[hero]?.length===4?handGroup(combo):'Other',seats:c.seats,depth:c.stacks[hero],pot,ended,line,net,showdown:atShowdown,
  mistakes:mistakes.length,cost:mistakes.reduce((s,g)=>s+gradeCost(g),0),grades,base,tally:PokerStats.tally(base)};
 f.tags=[pos,combo,pot.replace(/[\s-]/g,''),ended,net===null?'':net>0?'won':net<0?'lost':'even',atShowdown?'showdown':'',f.mistakes?'mistake mistakes':'',f.group,c.seats===2?'hu headsup':c.seats+'max',line].join(' ').toLowerCase();
 handDB.cache.set(row.id,f);return f;}
function factsOf(rows){const out=[];for(const r of rows){try{out.push(handFacts(r))}catch{}}return out;}
function handDBFiltered(){const q=handDB.filter;let rows=factsOf(state.histories).filter(f=>(!q.pos||f.pos===q.pos)&&(!q.pot||f.pot===q.pot)&&(!q.result||(q.result==='won'?f.net>0:q.result==='lost'?f.net<0:q.result==='showdown'?f.showdown:q.result==='noshowdown'?!f.showdown&&f.net!==null:f.mistakes>0)));
 const by={big:(a,b)=>(b.net??-1e9)-(a.net??-1e9),loss:(a,b)=>(a.net??1e9)-(b.net??1e9),mistakes:(a,b)=>b.cost-a.cost||b.mistakes-a.mistakes}[q.sort];return by?rows.slice().sort(by):rows;}
const signedBB=x=>x===null||!Number.isFinite(x)?'–':(x>0?'+':'')+fmt(x,1);
function bbPer100(rows){const r=rows.filter(f=>f.net!==null);return r.length?100*r.reduce((s,f)=>s+f.net,0)/r.length:null;}
function hudGridHTML(t){return'<div class="hud-grid">'+PokerStats.summary(t).map(([k,v])=>'<span title="'+PokerStats.TERMS[k]+'"><small>'+k+'</small>'+(v===null?'–':v)+'</span>').join('')+'</div>';}
function handDBOptions(select,values,first,k){const html='<option value="">'+first+'</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');if(select._html!==html){select.innerHTML=html;select._html=html;}if(!values.includes(handDB.filter[k]))handDB.filter[k]='';select.value=handDB.filter[k];}
function renderHandDB(box){if(!box)return;
 if(!box.dataset.ready){box.dataset.ready='1';box.classList.add('hdb');box.innerHTML='<div class="hdb-bar"><select data-hdb="pos" aria-label="Position"></select><select data-hdb="pot" aria-label="Pot type"></select><select data-hdb="result" aria-label="Result"><option value="">Result</option><option value="won">Won</option><option value="lost">Lost</option><option value="showdown">Showdown</option><option value="noshowdown">No showdown</option><option value="mistakes">Mistakes</option></select><select data-hdb="sort" aria-label="Sort"><option value="new">Newest</option><option value="big">Biggest wins</option><option value="loss">Biggest losses</option><option value="mistakes">Costliest mistakes</option></select></div><p class="hdb-sum"></p><div class="hdb-list"></div><button type="button" class="btn secondary hdb-more" hidden>More</button><details class="ui-disclosure hdb-insights"><summary>Insights</summary><div class="hdb-body"></div></details>';
  box.addEventListener('change',e=>{const k=e.target.dataset?.hdb;if(!k)return;handDB.filter[k]=e.target.value;handDB.shown=10;box.dataset.key='';renderHandDB(box);});
  box.querySelector('.hdb-more').onclick=()=>{handDB.shown+=20;box.dataset.key='';renderHandDB(box);};box.querySelector('.hdb-insights').addEventListener('toggle',()=>{box.dataset.key='';renderHandDB(box);});}
 const all=factsOf(state.histories),key=JSON.stringify(handDB.filter)+handDB.shown+'|'+all.map(f=>f.key).join()+box.querySelector('.hdb-insights').open;if(box.dataset.key===key)return;box.dataset.key=key;
 const order=['UTG','UTG+1','UTG+2','MP','LJ','HJ','CO','BTN','BTN/SB','SB','BB'],positions=[...new Set(all.map(f=>f.pos))].sort((a,b)=>(order.indexOf(a)+1||99)-(order.indexOf(b)+1||99));
 handDBOptions(box.querySelector('[data-hdb="pos"]'),positions,'Position','pos');handDBOptions(box.querySelector('[data-hdb="pot"]'),POTS.filter(p=>all.some(f=>f.pot===p)),'Pot','pot');
 for(const k of ['result','sort'])box.querySelector('[data-hdb="'+k+'"]').value=handDB.filter[k];
 const rows=handDBFiltered(),rate=bbPer100(rows);box.querySelector('.hdb-bar').hidden=!all.length;
 box.querySelector('.hdb-sum').textContent=all.length?rows.length+' hand'+(rows.length===1?'':'s')+(rate===null?'':' · '+signedBB(rate)+' bb/100'):'';
 box.querySelector('.hdb-list').innerHTML=all.length?rows.slice(0,handDB.shown).map(f=>'<button type="button" class="hdb-row" data-open-hand="'+esc(f.id)+'"><b>'+esc(f.combo||'–')+'</b><span>'+esc(f.pos+' · '+f.pot+(f.line?' · '+f.line:''))+'</span>'+(f.assisted?'<i class="hdb-help" title="Assisted · not in leaks"></i>':'')+(f.mistakes?'<i class="hdb-flag" title="'+f.mistakes+' mistake'+(f.mistakes>1?'s':'')+'"></i>':'')+'<em class="'+(f.net>0?'hdb-up':f.net<0?'hdb-down':'')+'">'+signedBB(f.net)+'</em></button>').join('')||'<p class="help">No hands match.</p>':'<p class="help">Finished hands show up here.</p>';
 box.querySelector('.hdb-more').hidden=rows.length<=handDB.shown;box.querySelector('.hdb-insights').hidden=!all.length;
 if(box.querySelector('.hdb-insights').open)box.querySelector('.hdb-body').innerHTML=insightsHTML(rows);}
// Results swing by ±100 bb/100 over a few hundred hands, so leaks are ranked by solver-measured mistake cost, which settles far sooner.
function insightsHTML(all){const rows=all.filter(f=>!f.assisted),helped=all.length-rows.length,you=rows.reduce((t,f)=>PokerStats.add(t,f.tally[f.hero]||PokerStats.empty()),PokerStats.empty()),graded=rows.filter(f=>f.grades.length),cost=rows.reduce((s,f)=>s+f.cost,0);
 const kpis='<div class="hdb-kpis"><span><small>Hands</small>'+rows.length+'</span><span><small>bb/100</small>'+signedBB(bbPer100(rows))+'</span><span><small>Mistakes</small>'+rows.reduce((s,f)=>s+f.mistakes,0)+'</span><span><small>Cost/100</small>'+(graded.length?fmt(100*cost/rows.length,1):'–')+'</span></div>';
 const field={pos:'pos',pot:'pot',group:'group',ended:'ended'}[handDB.filter.by]||'pos',groups=new Map();for(const f of rows){const k=f[field];if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);}
 const table='<select data-hdb="by" aria-label="Break down by">'+[['pos','By position'],['pot','By pot'],['group','By hand'],['ended','By where it ended']].map(([v,t])=>'<option value="'+v+'"'+(field===v?' selected':'')+'>'+t+'</option>').join('')+'</select><table class="hdb-table"><thead><tr><th></th><th>Hands</th><th>bb/100</th><th>Cost</th></tr></thead><tbody>'+[...groups].map(([k,fs])=>({k,n:fs.length,rate:bbPer100(fs),cost:100*fs.reduce((s,f)=>s+f.cost,0)/fs.length})).sort((a,b)=>b.cost-a.cost||(a.rate??0)-(b.rate??0)).map(g=>'<tr><td>'+esc(g.k)+'</td><td>'+g.n+'</td><td class="'+(g.rate>0?'hdb-up':g.rate<0?'hdb-down':'')+'">'+signedBB(g.rate)+'</td><td>'+(g.cost?fmt(g.cost,1):'–')+'</td></tr>').join('')+'</tbody></table>';
 // The same spot types, labels and costs as Practice → Leaks.
 const leaks=typeof leakDecisions==='function'?PokerDrills.leaks(leakDecisions(rows)).slice(0,3):[],leakHTML=leaks.length?'<ol class="hdb-leaks">'+leaks.map(l=>'<li><span>'+esc(l.label)+'</span><em>'+l.mistakes+'× · '+fmt(l.cost,1)+' bb</em></li>').join('')+'</ol>':'<p class="help">'+(graded.length?'No mistakes measured.':$('gradeEvery')?.checked===false?'<button type="button" class="ui-jump" data-jump="recording">Turn on decision recording</button> to find leaks.':'Play hands to find your leaks.')+'</p>';
 return(helped?'<p class="help">'+helped+' assisted hands left out</p>':'')+kpis+'<h3>You</h3>'+hudGridHTML(you)+'<h3>Leaks</h3>'+leakHTML+table;}
// Seat stats: bots are keyed by persona (each persona plays one fixed style, and seats are reshuffled between sessions),
// so a persona's numbers keep building across sessions; your own seat reads every saved hand.
function playProfiles(h){if(!h||$('controlAll')?.checked)return null;return Array.from({length:h.n},(_,i)=>i===state.hero?'you':profileForSeat(i));}
function seatStatsTable(){const key=state.histories.length+'|'+(state.histories[0]?.id||'');if(handDB.statsKey===key)return handDB.stats;const totals=new Map(),bump=(k,c)=>{if(!totals.has(k))totals.set(k,PokerStats.empty());PokerStats.add(totals.get(k),c);};
 for(const row of state.histories){let t;try{t=handFacts(row).tally}catch{continue}const rec=row.record;bump('you',t[rec.hero??0]);const seen=new Set();(rec.profiles||[]).forEach((p,i)=>{if(p&&p!=='you'&&t[i]){bump(p,seen.has(p)?{...t[i],hands:0}:t[i]);seen.add(p);}});}// a style in two seats pools its actions but counts each hand once
 handDB.statsKey=key;handDB.stats=totals;return totals;}
function seatHUDHTML(seat){const h=state.hand;if(!h)return'';const id=seat===state.hero?'you':$('controlAll')?.checked?null:profileForSeat(seat);if(!id)return'';const t=seatStatsTable().get(id)||PokerStats.empty(),name=id==='you'?'You':PokerBots.personas[id]?.short||id;
 return'<div class="hud-head"><b>'+esc(name)+'</b><span>'+t.hands+' hand'+(t.hands===1?'':'s')+'</span></div>'+hudGridHTML(t);}
function initSeatHUD(){const root=$('table');if(!root||root._hud)return;root._hud=true;const pop=document.createElement('div');pop.className='hud-pop';pop.hidden=true;pop.setAttribute('role','tooltip');document.body.append(pop);let shown=-1,pinned=false;
 const hide=()=>{pop.hidden=true;shown=-1;pinned=false;},show=node=>{const seat=+node.dataset.seat,html=seatHUDHTML(seat);if(!html)return hide();pop.innerHTML=html;pop.hidden=false;shown=seat;const r=(node.querySelector('.player')||node).getBoundingClientRect(),w=pop.offsetWidth,ht=pop.offsetHeight,x=Math.min(innerWidth-w-8,Math.max(8,r.left+r.width/2-w/2)),y=r.top-ht-8>8?r.top-ht-8:Math.min(innerHeight-ht-8,r.bottom+8);pop.style.left=x+'px';pop.style.top=y+'px';};
 const hover=matchMedia('(hover:hover) and (pointer:fine)');
 root.addEventListener('mouseover',e=>{if(!hover.matches||pinned)return;const node=e.target.closest('[data-seat]');if(!node)return hide();if(+node.dataset.seat!==shown)show(node);});
 root.addEventListener('mouseleave',()=>{if(!pinned)hide();});
 root.addEventListener('click',e=>{const node=e.target.closest('[data-seat]');if(!node)return hide();if(pinned&&+node.dataset.seat===shown)return hide();show(node);pinned=!pop.hidden;});
 document.addEventListener('click',e=>{if(!pop.hidden&&!root.contains(e.target))hide();});addEventListener('scroll',()=>{if(!pop.hidden)hide();},{capture:true,passive:true});addEventListener('resize',hide);}
