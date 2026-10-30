'use strict';
// Practice → Leaks: drills built from your own graded table decisions (drill-plan.js ranks and schedules them).
// Preflop leaks deal fresh cards on the same chart line, weighted toward close decisions and the hands you
// missed, so you learn the spot rather than one hand. Postflop leaks replay your own decisions that already
// have a saved solve, so they grade at once without solving again.
const leakDrill={deck:{cards:{}},loaded:null,classes:new Map(),solves:null,list:[],refs:new Map(),spot:null,lastKey:null,stuck:new Set(),spent:new Set(),done:new Set(),score:[0,0],dealing:false};
const LEAK_TOPICS=['allin','vs3bet','vsopen','firstin','vsraise','vsbet','betcheck'];
function leakObserved(g){return{config:g.config,actor:g.hero,heroCards:C.cards(g.hand),board:g.board?C.cards(g.board):[],actions:g.actions};}
// Spot type of one graded decision, cached by grade id: decision type, effective stack and its solve key.
function leakClass(g){if(leakDrill.classes.has(g.id))return leakDrill.classes.get(g.id);let c=null;
 try{const observed=leakObserved(g),holes=Array(g.config.seats).fill(null);holes[g.hero]=observed.heroCards;const hand=PokerSpot.reconstruct(observed,holes,G.rng(1));
  if(hand.actor===g.hero)c={topic:LEAK_TOPICS.find(t=>quizTopicMatches(hand,t))||'other',depth:quizEffective(hand.config,g.hero),publicKey:PokerSpot.publicKey(observed),seats:hand.n,pos:G.positions(hand.n,hand.button)[g.hero]};}catch{}
 leakDrill.classes.set(g.id,c);return c;}
// Your graded table decisions (of the given hands' facts), newest first. Only grades with a measured cost or a chart frequency count.
function leakDecisions(facts=factsOf(state.histories)){const out=[];
 for(const f of facts){if(f.assisted)continue;for(const g of f.grades.slice().reverse()){
  const chart=!!g.referenceSource&&!g.approximate&&Number.isFinite(g.referenceFrequency),solved=!!g.rated&&Number.isFinite(g.loss);if(!chart&&!solved||!g.config||!Array.isArray(g.actions)||!g.hand)continue;
  const c=leakClass(g);if(!c)continue;const mistake=gradeMistake(g);
  out.push({id:g.id,variant:g.config.variant,mode:g.config.mode,seats:c.seats,pos:g.position||c.pos,street:g.street,topic:c.topic,depth:c.depth,mistake,cost:solved?gradeCost(g):null,at:Date.parse(g.createdAt)||Date.parse(f.at)||0,cls:g.hand.length===4?comboOf(g.hand):'',publicKey:c.publicKey,grade:g});}}
 return out;}
async function leakSolves(){if(leakDrill.solves)return leakDrill.solves;const index=new Map();
 try{for(const row of await dbAll('solves')){try{const k=JSON.parse(row.key)[1];if(typeof k!=='string'||!row.result?.supported||!row.result.actions?.length)continue;if(!PokerPreflop.isResult(row.result)&&!T.assessmentEvidence(row.result).usable)continue;if(!index.has(k))index.set(k,row);}catch{}}}catch{}
 return leakDrill.solves=index;}
function leakPacks(l){return preflopLibrary.packs.filter(p=>p.config.seats===l.seats&&p.config.variant===l.variant&&p.config.mode===l.mode);}
const leakPackDepth=p=>{const s=p.config.stacks.slice().sort((a,b)=>a-b);return s[s.length>>1];};
function leakPack(l){let best=null,gap=Infinity;for(const p of leakPacks(l)){const d=Math.abs(Math.log(leakPackDepth(p)/l.depth));if(d<gap){gap=d;best=p;}}return gap<Math.log(1.6)?best:null;}
function leakDrillable(l){if(l.held||leakDrill.stuck.has(l.key))return false;if(l.street===0&&quizChartTopics.includes(l.topic)&&leakPack(l))return true;return(leakDrill.refs.get(l.key)||[]).some(r=>leakReplay(r));}
async function refreshLeaks(){
 if(!leakDrill.loaded)leakDrill.loaded=dbAll('meta').then(rows=>{const v=rows.find(r=>r.id==='drillLeaks-v1')?.value;if(PokerDrills.validDeck(v))leakDrill.deck=v;}).catch(()=>{});
 leakDrill.solves=null;leakDrill.live=null;await Promise.all([leakDrill.loaded,leakSolves()]);
 const decisions=leakDecisions();leakDrill.refs=new Map();for(const d of decisions){const k=PokerDrills.keyOf(d);if(!leakDrill.refs.has(k))leakDrill.refs.set(k,[]);leakDrill.refs.get(k).push(d);}
 // A preflop leak drilled on the nearest chart is labelled with that chart's depth, the stack its drills deal.
 leakDrill.list=PokerDrills.leaks(decisions).map(l=>{const p=l.street===0&&quizChartTopics.includes(l.topic)?leakPack(l):null;return p?{...l,label:PokerDrills.label({...l,depth:leakPackDepth(p)})}:l;});PokerDrills.sync(leakDrill.deck,leakDrill.list);leakDrill.graded=decisions.length;renderLeaks();}
function saveLeakDeck(){leakDrill.deck.updatedAt=new Date().toISOString();dbPut('meta',{id:'drillLeaks-v1',value:leakDrill.deck}).catch(()=>{});}
addEventListener('citrus-synced',e=>{if(!e.detail?.meta)return;leakDrill.loaded=null;if($('uiLeaks')?.dataset.ready)refreshLeaks();});
function leakPick(list,total){let r=Math.random()*total;for(let i=0;i<list.length;i++)if((r-=list[i].w)<=0)return list[i];return list[list.length-1];}
// Hold'em classes on a chart node's range edge: the main action differs from a neighbour one kicker
// (or one pair rank) away. Charts are mostly pure, so these are the hands worth drilling.
const leakEdges=new WeakMap();
function leakEdge(pack,node){if(pack.groups)return null;let edge=leakEdges.get(node);if(edge)return edge;const cls=PokerPreflop.classes,at=new Map(cls.map((c,i)=>[c,i])),main=i=>{let best=-1,top=-1;for(let a=0;a<node.actions.length;a++){const f=quizChartFreq(pack,node,i,a);if(f>top){top=f;best=a;}}return best;},R='23456789TJQKA';
 edge=new Set();cls.forEach((c,i)=>{const hi=R.indexOf(c[0]),lo=R.indexOf(c[1]),near=c.length===2?[hi-1,hi+1].map(r=>R[r]+R[r]):[lo-1,lo+1].filter(r=>r!==hi).map(r=>c[0]+R[r]+c[2]);if(near.some(n=>at.has(n)&&main(at.get(n))!==main(i)))edge.add(c);});leakEdges.set(node,edge);return edge;}
// A fresh chart spot on the leak's line. Of 80 sampled deals it favours range-edge hands, mixed decisions and
// the hand classes you missed, with a few clear ones kept in.
async function leakChartSpot(l){const pack=leakPack(l);if(!pack)return null;if(!quizCharts.index.has(pack)){await new Promise(r=>setTimeout(r,0));}
 const labels=G.positions(pack.config.seats),entries=quizChartIndex(pack).filter(e=>e.reach>=quizChartReach&&e.topic===l.topic&&labels[e.hero]===l.pos);if(!entries.length)return null;
 const reach=entries.reduce((s,e)=>s+e.reach,0),missed=new Set((leakDrill.refs.get(l.key)||[]).filter(d=>d.mistake).map(d=>d.cls)),options=[];
 for(let i=0;i<80;i++){const entry=leakPick(entries.map(e=>({e,w:e.reach})),reach).e,hand=quizChartHand(entry);if(!hand)continue;const result=preflopReference(hand,null,pack);if(!result?.supported)continue;
  const refs=result.reference.filter(x=>x!==null);if(refs.length<2)continue;const cls=comboOf(hand.holes[entry.hero].map(C.cardName).join('')),edge=leakEdge(pack,entry.node);
  options.push({w:.05+(1-Math.max(...refs))+(edge?.has(cls)?1:0)+(missed.has(cls)?1:0),hand,hero:entry.hero,result});}
 return options.length?{kind:'chart',leak:l,...leakPick(options,options.reduce((s,o)=>s+o.w,0))}:null;}
// Your own decision replayed: its saved solve, or else the chart or flop library looked up again (cached per spot).
function leakReplay(ref){const row=leakDrill.solves?.get(ref.publicKey);
 if(row){try{const {hand}=savedSpotContext(row);return{hand,result:row.result};}catch{}}
 if(!leakDrill.live)leakDrill.live=new Map();if(leakDrill.live.has(ref.publicKey))return leakDrill.live.get(ref.publicKey);let out=null;
 try{const g=ref.grade,observed=leakObserved(g),holes=Array(g.config.seats).fill(null);holes[g.hero]=observed.heroCards;const hand=PokerSpot.reconstruct(observed,holes,G.rng(1)),result=hand.street===0?preflopReference(hand):hand.street===1?postflopLibraryReference(hand):null;if(result?.supported&&!result.offTree&&result.actions.length>1)out={hand,result};}catch{}
 leakDrill.live.set(ref.publicKey,out);return out;}
// Mistakes come up three times as often as decisions you got right. Each saved decision comes up once per sitting,
// so a leak is not passed by remembering one answer.
function leakExactSpot(l){const pool=(leakDrill.refs.get(l.key)||[]).filter(r=>!leakDrill.spent.has(r.publicKey)&&leakReplay(r));if(!pool.length)return null;
 const pick=leakPick(pool.map(r=>({r,w:r.mistake?3:1})),pool.reduce((s,r)=>s+(r.mistake?3:1),0)).r,{hand,result}=leakReplay(pick);return{kind:'exact',leak:l,hand,hero:hand.actor,result,publicKey:pick.publicKey};}
async function dealLeak(){if(leakDrill.dealing)return;leakDrill.dealing=true;$('leakNext').disabled=true;
 try{for(let tries=0;tries<6;tries++){const list=leakDrill.list.filter(l=>leakDrillable(l)&&!leakDrill.done.has(l.key)),l=PokerDrills.pick(list,leakDrill.deck,Date.now(),leakDrill.lastKey);if(!l)break;
   const spot=(l.street===0?await leakChartSpot(l):null)||leakExactSpot(l);if(!spot){leakDrill[(leakDrill.refs.get(l.key)||[]).some(r=>leakReplay(r))?'done':'stuck'].add(l.key);continue;}
   leakDrill.spot={...spot,answered:false};leakDrill.lastKey=l.key;showLeakSpot();return;}
  leakDrill.spot=null;renderLeaks();}
 finally{leakDrill.dealing=false;$('leakNext').disabled=false;}}
function showLeakSpot(){const s=leakDrill.spot,h=s.hand,known=Array(h.n).fill(false);known[s.hero]=true;$('leakCard').hidden=false;$('leakHome').hidden=true;
 $('leakLabel').textContent=s.leak.label;$('leakLine').textContent=compactLeakLine(h);$('leakScore').textContent=leakDrill.score[1]?leakDrill.score[0]+'/'+leakDrill.score[1]:'';
 paintTable($('leakTable'),h,s.hero,{known,caption:'Drill'});$('leakActions').innerHTML=s.result.actions.map((a,i)=>'<button type="button" class="btn" data-leak-action="'+i+'">'+esc(a.label)+'</button>').join('');
 $('leakFeedback').innerHTML='';$('leakFeedback').hidden=true;$('leakNext').hidden=true;}
function compactLeakLine(h){return typeof compactLine==='function'?compactLine(h):'';}
const leakByFrequency=r=>PokerPreflop.isResult(r)||r.solve?.method==='postflop-library'||!(r.loss||[]).some(x=>Number.isFinite(x)&&x>0);
function leakChoiceGood(result,i){if(leakByFrequency(result)){const f=result.reference[i];return f!==null&&f>=chartMistakeFrequency;}const loss=result.loss?.[i];return !(Number.isFinite(loss)&&loss>(result.units==='bb'?.05:0));}
function leakFrequencyHTML(result,chosen){const chart=leakByFrequency(result),tones=actionTones(result.actions,leakDrill.spot?.hand||null);return'<div class="frequency-grid">'+result.actions.map((a,i)=>{const f=result.reference[i],cost=!chart&&Number.isFinite(result.loss?.[i])&&result.loss[i]>.005?' · −'+fmt(result.loss[i],2)+' bb':'';return'<div class="policyRow'+(i===chosen?' leak-chosen':'')+'"><div class="row between"><span>'+esc(toneLabel(a,tones[i]))+'</span><strong>'+(f===null?'–':fmt(f*100,0)+'%')+cost+'</strong></div>'+(f===null?'':'<div class="bar"><i style="width:'+f*100+'%;background:var(--act-'+tones[i]+')"></i></div>')+'</div>';}).join('')+'</div>';}
function answerLeak(i){const s=leakDrill.spot;if(!s||s.answered)return;const action=s.result.actions[i];if(!action)return;s.answered=true;
 if(s.kind==='exact')leakDrill.spent.add(s.publicKey);const good=leakChoiceGood(s.result,i),card=leakDrill.deck.cards[s.leak.key]||=PokerDrills.newCard(Date.now());PokerDrills.answer(card,good);saveLeakDeck();leakDrill.score[1]++;if(good)leakDrill.score[0]++;
 // Drill answers go to Progress like other practice; table leaks read saved hands only, so they stay separate.
 try{if(PokerPreflop.isResult(s.result))referenceChoiceGrade(s.result,{kind:'drill',hand:s.hand,action});else scoreResult(s.result,{kind:'drill',hand:s.hand,action});}catch{}
 document.querySelectorAll('[data-leak-action]').forEach(b=>{b.disabled=true;if(+b.dataset.leakAction===i)b.classList.add(good?'leak-good':'leak-bad');});
 $('leakFeedback').hidden=false;$('leakFeedback').innerHTML='<p class="leak-verdict '+(good?'leak-good':'leak-bad')+'">'+(good?'✓':'✗')+'</p>'+leakFrequencyHTML(s.result,i);$('leakScore').textContent=leakDrill.score[0]+'/'+leakDrill.score[1];$('leakNext').hidden=false;$('leakNext').focus({preventScroll:true});}
function leakDots(card){const box=card?.box||0;return'<span class="leak-dots" title="'+(box>=PokerDrills.FIXED?'Fixed':'Box '+(box+1)+' of '+(PokerDrills.FIXED+1))+'">'+Array.from({length:PokerDrills.FIXED},(_,i)=>'<i'+(i<box?' class="on"':'')+'></i>').join('')+'</span>';}
const leakPct=x=>x===null||x===undefined?'–':Math.round(x*100)+'%';
function renderLeaks(){const box=$('uiLeaks');if(!box)return;const now=Date.now(),drillable=leakDrill.list.filter(leakDrillable),due=drillable.filter(l=>PokerDrills.isDue(leakDrill.deck.cards[l.key],now)).length;
 $('leakCard').hidden=!leakDrill.spot;$('leakHome').hidden=!!leakDrill.spot;$('leakStart').disabled=!drillable.length;$('leakStart').textContent=due?'Drill · '+due+' due':'Drill';
 $('leakList').innerHTML=leakDrill.list.slice(0,8).map(l=>{const card=leakDrill.deck.cards[l.key],ok=drillable.includes(l);return'<li class="'+(ok?'':'leak-off')+'"'+(l.held?' title="Not drilled yet"':'')+'><div><b>'+esc(l.label)+'</b><small>'+fmt(l.cost,1)+' bb · '+l.mistakes+'/'+l.decisions+'</small></div><div class="leak-rates"><span><small>Table</small>'+leakPct(l.hit)+'</span><span><small>Drill</small>'+leakPct(PokerDrills.drillHit(card))+'</span>'+leakDots(card)+'</div></li>';}).join('');
 $('leakEmpty').innerHTML=leakDrill.list.length?drillable.length?'':leakDrill.list.every(l=>l.held)?'Vs-open spots aren’t drilled yet.':'Solve these spots once to drill them.':leakDrill.graded?'No leaks found in your graded decisions.':!$('gradeEvery').checked?'<button type="button" class="ui-jump" data-jump="recording">Turn on decision recording</button> to find your leaks.':'Play hands to find your leaks. Hands where you saw the analysis before acting don’t count.';
 $('leakEmpty').hidden=!$('leakEmpty').textContent;}
function initLeakDrills(){const v=$('uiLeaks');if(!v||v.dataset.ready)return;v.dataset.ready='1';
 v.innerHTML='<div id="leakHome"><div class="leak-head"><button type="button" class="btn" id="leakStart">Drill</button></div><ol id="leakList" class="leak-list"></ol><p id="leakEmpty" class="help" hidden></p></div>'+
  '<div id="leakCard" hidden><div class="leak-spot"><b id="leakLabel"></b><span id="leakScore" class="small muted"></span></div><div id="leakLine" class="small muted"></div><div id="leakTable" class="felt" aria-label="Drill table"></div><div id="leakActions" class="actions"></div><div id="leakFeedback" class="result" aria-live="polite" hidden></div><div class="row leak-nav"><button type="button" class="btn" id="leakNext" hidden>Next</button><button type="button" class="btn secondary" id="leakDone">Done</button></div></div>';
 $('leakStart').onclick=()=>{leakDrill.score=[0,0];for(const s of [leakDrill.stuck,leakDrill.spent,leakDrill.done])s.clear();dealLeak();};$('leakNext').onclick=dealLeak;$('leakDone').onclick=()=>{leakDrill.spot=null;refreshLeaks();};
 $('leakActions').addEventListener('click',e=>{const b=e.target.closest('[data-leak-action]');if(b)answerLeak(+b.dataset.leakAction);});}
