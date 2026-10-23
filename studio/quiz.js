'use strict';
const quizTraining={generation:0,building:false,cache:new Map()},quizFilterIds=['quizEvidence','quizStart','quizVariant','quizFormat','quizSeats','quizStack','quizPosition','quizStreet','quizTopic','quizSamples'];
function quizFilters(){return Object.fromEntries(quizFilterIds.map(id=>[id,$(id).value]));}
function quizEffective(config,seat){return Math.min(config.stacks[seat],Math.max(...config.stacks.filter((_,i)=>i!==seat)));}
function quizStackMatches(amount,filter){return filter==='any'||filter==='short'&&amount<=20||filter==='medium'&&amount>20&&amount<=50||filter==='deep'&&amount>50&&amount<=100||filter==='verydeep'&&amount>100;}
function quizPositionMatches(label,filter){return filter==='any'||label.split('/').includes(filter);}
function quizStreetChoices(config,filters){if(config.startStreet!==0)return[];if(filters.quizStart==='full')return[0];let streets=[0,1,2,3].filter(s=>s>=config.startStreet&&(filters.quizStreet==='any'||s===+filters.quizStreet));if(['firstin','vsopen','vs3bet'].includes(filters.quizTopic))streets=streets.filter(s=>s===0);if(['betcheck','vsbet','vsraise'].includes(filters.quizTopic))streets=streets.filter(s=>s>0);return streets;}
function quizHeroSeats(config,filters){const labels=G.positions(config.seats,config.button);return labels.map((label,i)=>quizPositionMatches(label,filters.quizPosition)&&quizStackMatches(quizEffective(config,i),filters.quizStack)?i:-1).filter(i=>i>=0);}
function quizSources(filters=quizFilters()){
 const sources=new Map(),add=(snapshot,name,current=false)=>{if(!snapshot||snapshot.episodes<1&&!current)return;const config=G.normalize(snapshot.config);if(config.startStreet!==0)return;const key=G.familyId(config)+'|'+JSON.stringify({...snapshot.abstraction,maxInfos:0}),old=sources.get(key);if(!old||snapshot.episodes>old.snapshot.episodes)sources.set(key,{key,snapshot,config,name,current});};
 add(state.snapshot,'Current table setup',true);for(const row of state.models)add(row.snapshot,row.name);add(window.STUDIO_STARTER,'Included heads-up NLH game');for(const pack of builtInPolicies())add(pack,pack.name);
 return [...sources.values()].filter(s=>(filters.quizVariant==='any'||s.config.variant===filters.quizVariant)&&(filters.quizFormat==='any'||s.config.mode===filters.quizFormat)&&(filters.quizSeats==='any'||s.config.seats===+filters.quizSeats)&&quizStreetChoices(s.config,filters).length&&quizHeroSeats(s.config,filters).length);
}
function quizModel(source){if(source.current&&state.snapshot===source.snapshot)return state.model;const old=quizTraining.cache.get(source.key);if(old?.snapshot===source.snapshot)return old.model;const model=PokerPolicies.load(source.snapshot);quizTraining.cache.set(source.key,{snapshot:source.snapshot,model});while(quizTraining.cache.size>2)quizTraining.cache.delete(quizTraining.cache.keys().next().value);return model;}
function refreshQuizAvailability(){if(!$('quizAvailability'))return;warmQuizCharts();const variant=$('quizVariant').value,count=preflopLibrary.packs.reduce((s,p)=>s+(variant==='any'||p.config.variant===variant?p.nodes.length:0),0),studies=['any','NLH'].includes(variant);$('quizAvailability').textContent=count?count+' imported chart decisions available for this game. '+(studies?'Heads-up and three-player NLH river studies are also mixed in. ':'')+'Filters must match the chosen source.':(studies?'Without imported charts, matched practice alternates two built-in NLH river studies with fixed boards. Import the preflop chart library in Library for varied preflop spots, or choose Free practice to play generated hands.':'No imported charts or built-in studies cover this game. Import the preflop chart library in Library (it includes 4-card PLO), or choose Free practice with a model trained for this game.');}
function syncQuizFilters(){const full=$('quizStart').value==='full';for(const id of ['quizStreet','quizTopic'])$(id).disabled=full||state.busy||quizTraining.building;$('quizStartHelp').textContent=full?'Full hand: start at your first action and play to the end. Street and decision filters apply when starting at a selected spot.':'Selected spot: use the street and decision filters, then play the rest of that hand. Earlier setup choices are excluded from your grade.';}
function setQuizBusy(busy){quizTraining.building=busy;document.querySelectorAll('.quiz-filter,#quizMix,#quizDeal,#quizContinue,#quizFinish').forEach(x=>x.disabled=busy||state.busy);syncQuizFilters();}
function cancelQuizGeneration(){quizTraining.generation++;const continuing=quizTraining.continuing;quizTraining.continuing=false;setQuizBusy(false);if(continuing&&state.quiz){state.quiz.continuationError=true;state.quiz.viewHand=null;state.quiz.viewAutoHeroActions=null;$('quizTable').getAnimations({subtree:true}).forEach(a=>a.cancel());paintTable($('quizTable'),state.quiz.completedHand||state.quiz.hand,state.quiz.hero);renderQuizHistory(state.quiz);renderQuizFlowControls();}}
function clearQuizQuestion(){clearQuizDraft();state.quiz=null;renderQuizHistory(null);renderQuizFlowControls();$('quizActions').innerHTML='';$('quizReference').innerHTML='';$('quizSpot').innerHTML='';$('quizTable').classList.add('hide');$('quizTable').getAnimations({subtree:true}).forEach(a=>a.cancel());$('quizEmpty').classList.remove('hide');$('quizFeedback').textContent='Play the hand to the end to see your assessment, reference frequencies and estimated action costs.';}
function saveQuizFilters(){try{localStorage.setItem('range-lab-quiz-filters',JSON.stringify(quizFilters()))}catch{}}
function quizTopicMatches(hand,topic){const legal=hand.legal();if(topic==='any')return true;if(topic==='firstin')return hand.street===0&&legal.canRaise&&hand.actionLog.every(e=>e.kind==='fold');if(topic==='vsopen')return hand.street===0&&hand.aggressions===1&&legal.toCall>0;if(topic==='vs3bet')return hand.street===0&&hand.aggressions>=2&&legal.toCall>0;if(topic==='betcheck')return hand.street>0&&legal.check&&legal.canRaise;if(topic==='vsbet')return hand.street>0&&legal.toCall>0&&hand.aggressions===1;if(topic==='vsraise')return hand.street>0&&legal.toCall>0&&hand.aggressions>=2;if(topic==='allin')return legal.toCall>0&&hand.stacks.some((x,i)=>i!==hand.actor&&x===0&&!hand.folded[i]&&hand.streetPaid[i]===hand.currentBet);return false;}
function quizDecisionLabel(hand){for(const [key,label]of [['allin','Facing an all-in'],['vs3bet','Facing a 3-bet or higher'],['vsopen','Facing a preflop raise'],['firstin','First-in preflop'],['vsraise','Facing a raise'],['vsbet','Facing a bet'],['betcheck','Bet or check']])if(quizTopicMatches(hand,key))return label;return'Preflop decision';}
// Imported chart practice. Each pack is indexed once (decision topic and how often the chart's own
// strategy reaches each line), so a deal filters plain rows instead of replaying every node. Lines
// the chart never plays are skipped, and the hero is dealt from the range the chart brings there.
const quizCharts={index:new WeakMap(),combos:null},quizChartTopics=['allin','vs3bet','vsopen','firstin'],quizChartReach=1e-6;
function quizPick(weights,total){let r=Math.random()*total,last=-1;for(let i=0;i<weights.length;i++)if(weights[i]>0){last=i;if((r-=weights[i])<=0)return i;}return last;}
function quizChartClassCards(i){const c=PokerPreflop.classes[i];return C.cards(c[0]+'s'+c[1]+(c[2]==='s'?'s':'h'));}
function quizChartFreq(pack,node,i,a){if(node.table)return node.table[i*node.actions.length+a]/1000;const row=pack.groups?node.strategy[pack.groups.labels[i]]:PokerPreflop.row(pack,node,quizChartClassCards(i));return row?.[a]||0;}
function quizChartStep(pack,parentKey,part){const [seat,kind,target]=part.split(':'),parent=pack.index.get(parentKey),a=parent?parent.actions.findIndex(x=>x.kind===kind&&(kind!=='raise'||x.target===+target)):-1;return{seat:+seat,kind,target:+target,parent,a};}
function quizChartPrior(pack){if(!pack.groups)return PokerPreflop.classes.map(c=>(c.length===2?6:c[2]==='s'?4:12)/1326);const pc=PokerPreflop.ploClasses(),w=new Float64Array(pack.groups.labels.length);pc.counts.forEach((n,k)=>w[pack.groups.of[k]]+=n/270725);return w;}
function quizChartIndex(pack){
 let index=quizCharts.index.get(pack);if(index)return index;index=[];
 const n=pack.config.seats,prior=quizChartPrior(pack),L=prior.length,base=new G.Hand(pack.config,{rng:G.rng(1)}),hands=new Map(),ranges=new Map([['',Array(n).fill(null)]]);
 // Per seat, the share of each hand class still in that player's range on a line (null: an action the
 // chart never takes). A decision the pack does not list leaves that player's range unchanged.
 const vecsOf=key=>{let vecs=ranges.get(key);if(vecs!==undefined)return vecs;const cut=key.lastIndexOf('/'),parentKey=cut<0?'':key.slice(0,cut),step=quizChartStep(pack,parentKey,key.slice(cut+1));vecs=vecsOf(parentKey);if(vecs&&step.parent){if(step.a<0)vecs=null;else{const old=vecs[step.seat],v=new Float32Array(L);for(let i=0;i<L;i++)v[i]=(old?old[i]:1)*quizChartFreq(pack,step.parent,i,step.a);vecs=vecs.slice();vecs[step.seat]=v;}}ranges.set(key,vecs);return vecs;};
 for(const node of pack.nodes.slice().sort((a,b)=>a.history.length-b.history.length)){
  const cut=node.key.lastIndexOf('/'),parentKey=node.history.length?cut<0?'':node.key.slice(0,cut):null,step=parentKey===null?null:quizChartStep(pack,parentKey,node.key.slice(cut+1));let h;
  try{const ph=step?hands.get(parentKey):base;if(ph){h=ph.clone();if(step)h.act({kind:step.kind,target:['raise','bet'].includes(step.kind)?step.target:undefined});}else{h=base.clone();for(const e of node.history)h.act({kind:e.kind,target:e.to===undefined?undefined:G.units(e.to)});}}catch{continue}
  if(h.done||h.street!==0||h.actor!==node.seat)continue;hands.set(node.key,h);
  const vecs=vecsOf(node.key),reach=vecs?vecs.reduce((p,v)=>{if(!v)return p;let m=0;for(let i=0;i<L;i++)m+=prior[i]*v[i];return p*m;},1):0,topics=quizChartTopics.filter(t=>quizTopicMatches(h,t));
  index.push({pack,node,hero:node.seat,topics,topic:topics[0]||'other',heroActed:node.history.some(e=>e.seat===node.seat),reach});
 }
 quizCharts.index.set(pack,index);return index;
}
// Deals the hero's private cards in proportion to how often the chart's own earlier choices keep them.
function quizChartHole(entry){
 const {pack,node,hero}=entry,parts=node.key?node.key.split('/'):[],steps=[];
 for(let j=0;j<parts.length;j++){const step=quizChartStep(pack,parts.slice(0,j).join('/'),parts[j]);if(step.seat!==hero||!step.parent)continue;if(step.a<0)return null;steps.push(step);}
 if(!steps.length)return false;
 if(!pack.groups){const combos=quizCharts.combos||=G.combinations(Array.from({length:52},(_,i)=>i),2);let total=0;const w=combos.map(cs=>{let x=1;for(const s of steps){x*=PokerPreflop.row(pack,s.parent,cs)?.[s.a]||0;if(!x)break;}total+=x;return x;});return total>0?combos[quizPick(w,total)].slice():null;}
 const pc=PokerPreflop.ploClasses(),of=pack.groups.of,gw=new Float64Array(pack.groups.labels.length).fill(1);for(const s of steps)for(let g=0;g<gw.length;g++)gw[g]*=quizChartFreq(pack,s.parent,g,s.a);
 let total=0;const w=new Float64Array(pc.counts.length);for(let k=0;k<w.length;k++)total+=w[k]=gw[of[k]]*pc.counts[k];if(!(total>0))return null;
 const perm=[0,1,2,3];for(let i=3;i>0;i--){const j=Math.floor(Math.random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}return pc.reps[quizPick(w,total)].map(c=>(c&~3)|perm[c&3]);
}
function quizChartHand(entry){const hole=quizChartHole(entry);if(hole===null)return null;const holes=Array(entry.pack.config.seats).fill(null);if(hole)holes[entry.hero]=hole;try{const h=new G.Hand(entry.pack.config,{holes});for(const e of entry.node.history)h.act({kind:e.kind,target:e.to===undefined?undefined:G.units(e.to)});return !h.done&&h.actor===entry.hero&&PokerPreflop.historyKey(h)===entry.node.key?h:null;}catch{return null}}
function quizChartPacks(filters){return preflopLibrary.packs.filter(p=>{const c=p.config;return(filters.quizVariant==='any'||filters.quizVariant===c.variant)&&['any',c.mode].includes(filters.quizFormat)&&(filters.quizSeats==='any'||+filters.quizSeats===c.seats)&&(filters.quizStart==='full'||['any','0'].includes(filters.quizStreet)&&!['betcheck','vsbet','vsraise'].includes(filters.quizTopic));});}
function quizChartEntries(packs,filters){const full=filters.quizStart==='full',out=[];for(const pack of packs){const c=pack.config,labels=G.positions(c.seats);for(const e of quizChartIndex(pack))if(e.reach>=quizChartReach&&(full?!e.heroActed:filters.quizTopic==='any'||e.topics.includes(filters.quizTopic))&&quizPositionMatches(labels[e.hero],filters.quizPosition)&&quizStackMatches(quizEffective(c,e.hero),filters.quizStack))out.push(e);}return out;}
// Mixed decisions pick a decision type first, then a chart, then a line by how often the chart reaches it,
// so deep multiway trees full of 3-bet and all-in nodes do not crowd out first-in and heads-up spots.
function quizChartQuestion(entries,filters){
 const one=list=>list[Math.floor(Math.random()*list.length)];
 for(let attempt=0;attempt<40&&entries.length;attempt++){
  let pool=entries;if(filters.quizStart!=='full'&&filters.quizTopic==='any'){const topic=one([...new Set(pool.map(e=>e.topic))]);pool=pool.filter(e=>e.topic===topic);}const pack=one([...new Set(pool.map(e=>e.pack))]);pool=pool.filter(e=>e.pack===pack);
  const w=pool.map(e=>e.reach),entry=pool[quizPick(w,w.reduce((s,x)=>s+x,0))],hand=entry&&quizChartHand(entry);if(!hand){entries=entries.filter(e=>e!==entry);continue;}
  const model=new T.Model(pack.config,state.abstraction);return{hand,hero:entry.hero,answered:false,model,snapshot:model.snapshot(),sourceName:pack.name,referencePack:pack,filters};
 }
 return null;
}
// Indexes the library in short background slices while the Practice view is open, so the first deal rarely waits.
function warmQuizCharts(){if(quizCharts.warming)return;const todo=preflopLibrary.packs.filter(p=>!quizCharts.index.has(p));if(!todo.length)return;quizCharts.warming=true;const step=()=>{const end=performance.now()+8;while(todo.length&&performance.now()<end)quizChartIndex(todo.shift());if(todo.length)setTimeout(step,40);else quizCharts.warming=false;};setTimeout(step,250);}
async function chartQuizQuestion(filters,token){
 const packs=quizChartPacks(filters),todo=packs.filter(p=>!quizCharts.index.has(p));
 if(todo.length){setQuizBusy(true);$('quizStatus').textContent='Preparing the imported charts for practice. This happens once per chart.';let last=performance.now();try{for(const pack of todo){if(performance.now()-last>12){await new Promise(resolve=>setTimeout(resolve,0));last=performance.now();}if(token!==quizTraining.generation)return null;quizChartIndex(pack);}}finally{if(token===quizTraining.generation)setQuizBusy(false);}}
 return quizChartQuestion(quizChartEntries(packs,filters),filters);
}
async function dealQuiz(){
 if(state.busy||quizTraining.building)return;stopTableMotion();cancelQuizGeneration();clearQuizQuestion();const filters=quizFilters(),sources=quizSources(filters),token=quizTraining.generation;refreshQuizAvailability();$('quizStatus').classList.remove('error');
 // Free practice plays generated hands from the selected game's models; matched practice mixes imported
 // chart spots with the two built-in solved studies, which have fixed boards.
 const free=filters.quizEvidence==='free';let referenceQuestion=null;
 if(!free||!sources.length){const chart=await chartQuizQuestion(filters,token);if(token!==quizTraining.generation)return;if(chart&&(free||Math.random()<.85))referenceQuestion=chart;else if(!free)for(const study of [exactStudyQuestion,multiwayStudyQuestion].sort(()=>Math.random()-.5))referenceQuestion||=study(filters);referenceQuestion||=chart;}
 if(referenceQuestion){state.quiz=referenceQuestion;prepareQuizSpot(referenceQuestion);return;}
 const game=$('quizVariant').selectedOptions[0]?.textContent||filters.quizVariant;
 if(!free){$('quizStatus').textContent=(preflopLibrary.packs.length?'No imported chart or built-in study matches these filters':'No built-in study matches these filters, and no preflop charts are imported')+(filters.quizStart==='full'?' (Full hand practice uses imported charts only)':'')+'. Import the preflop chart library in Library, widen the filters, or choose Free practice.';return;}
 if(!sources.length){$('quizStatus').textContent='Free practice has no trained full-hand model for '+game+(filters.quizSeats==='any'?'':' at '+filters.quizSeats+' seats')+' and no matching imported chart. Train a matching table setup in Play, import the preflop chart library in Library, or widen the filters.';return}
 setQuizBusy(true);$('quizStatus').textContent='Finding a spot that matches your practice choices.';let found=null,lastYield=performance.now();const deadline=lastYield+20000;
 const possibleStreets=[...new Set(sources.flatMap(s=>quizStreetChoices(s.config,filters)))],street=possibleStreets[Math.floor(Math.random()*possibleStreets.length)],pool=sources.filter(s=>quizStreetChoices(s.config,filters).includes(street)).sort((a,b)=>(b.snapshot.episodes||0)-(a.snapshot.episodes||0));
 try{for(let attempt=0;attempt<4000&&!found;attempt++){
   if(token!==quizTraining.generation)return;const source=pool[Math.floor(Math.random()*pool.length)],model=quizModel(source),seats=quizHeroSeats(source.config,filters),hero=seats[Math.floor(Math.random()*seats.length)],hand=new G.Hand(source.config);let steps=0;
   while(!hand.done&&hand.street<=street&&steps++<250){const q=model.query(hand);if(hand.actor===hero&&hand.street===street&&quizTopicMatches(hand,filters.quizStart==='full'?'any':filters.quizTopic)&&q.actions.length>1){const question={hand:hand.clone(),hero,answered:false,model,snapshot:source.snapshot,sourceName:source.name,sourceKey:source.key,filters};found=question;break;}const bot=PokerBots.policy(PokerBots.observe(hand),q,'reference');hand.act(bot.actions[G.pick(bot.probs)]);}
   if(performance.now()>deadline)break;if(performance.now()-lastYield>12){$('quizStatus').textContent='Searching '+fmt(attempt+1,0)+' sampled hands for a matching decision.';await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
  }
  if(token!==quizTraining.generation)return;
  
  state.quiz=found;if(!state.quiz){$('quizStatus').textContent='No reachable decision matched the selected filters. Widen the position or decision filters and deal again.';$('quizStatus').classList.add('error');return}setQuizBusy(false);prepareQuizSpot(state.quiz);
 }catch(error){if(token===quizTraining.generation){$('quizStatus').textContent=error.message;$('quizStatus').classList.add('error')}}finally{if(token===quizTraining.generation)setQuizBusy(false)}
}

function renderQuizReference(){$('quizReference').innerHTML='';}
function quizAnalysisError(message,pending){if(pending?.kind==='quizPrepare'&&state.quiz===pending.quizQuestion){pending.quizQuestion.preparing=false;pending.quizQuestion.continuationError=false;pending.quizQuestion.prepared=null;pending.quizQuestion.answered=false;showQuizQuestion();$('quizStatus').textContent='Practice only — '+message;return;}if(pending?.kind!=='quiz'||state.quiz!==pending.quizQuestion)return;finishQuizDecision({supported:false,error:true,message:'This choice could not be assessed: '+message},pending,null);}
function initQuizTraining(){try{const saved=JSON.parse(localStorage.getItem('range-lab-quiz-filters')||'{}');for(const id of quizFilterIds)if([...$(id).options].some(o=>o.value===saved[id]))$(id).value=saved[id]}catch{}syncQuizFilters();document.querySelectorAll('.quiz-filter').forEach(el=>el.onchange=()=>{cancelQuizGeneration();clearQuizQuestion();saveQuizFilters();refreshQuizAvailability();$('quizStatus').textContent='Training choices updated. Deal a new question.';$('quizStatus').classList.remove('error');});$('quizMix').onclick=()=>{if(state.busy)return;cancelQuizGeneration();for(const id of quizFilterIds)if(!['quizSamples','quizStart','quizEvidence'].includes(id))$(id).value='any';clearQuizQuestion();saveQuizFilters();refreshQuizAvailability();$('quizStatus').textContent='Mixed practice selected. Deal a question to begin.';$('quizStatus').classList.remove('error');};}
