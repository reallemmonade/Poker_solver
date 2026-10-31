'use strict';
const transferUI={file:null,busy:false,rows:[],drill:null,generation:0};
const studyStores=['models','hands','grades','meta','solves'];
const backupFormat='range-lab-device-backup-v1';
function transferMessage(message,error=false){$('transferStatus').textContent=message;$('transferStatus').classList.toggle('error',error);}
function readStudyStores(includeModels=true){return openDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(studyStores,'readonly'),out={models:[]};for(const name of studyStores){if(name==='models'&&!includeModels)continue;const request=tx.objectStore(name).getAll();request.onsuccess=()=>{out[name]=request.result;};}tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error||Error('Could not read study data.'));tx.onerror=()=>{};}));}
function validRecordId(value){return typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(value);}
function rowDate(row){return Date.parse(row.updatedAt||row.createdAt||'')||0;}
// Preflop charts are one per name and game, as in addPreflopPacks; stored compact tables are typed arrays.
function packKey(pack){try{return pack.name+'\u0000'+G.familyId(G.normalize(pack.config))}catch{return JSON.stringify(pack)}}
// Device-only rows: the site's built-in charts (re-downloaded on every desktop, about 120 MB) and their record, plus drafts.
const localOnlyMeta=['quizDraft-v1','liveSession-broken','bundledLibraries-v1','postflopLibraries-v1'];
function builtInPackTest(meta){const listed=new Set((meta.find(r=>r.id==='bundledLibraries-v1')?.value?.preflop||[]).map(p=>p.name+'\n'+p.family));return p=>listed.has(p?.name+'\n'+p?.family)||/\(Range Lab CFR\+ model(, approximate)?\)$/.test(p?.name);}
function plainPack(pack){return{...pack,nodes:pack.nodes.map(n=>ArrayBuffer.isView(n.table)?{...n,table:Array.from(n.table)}:n)}}
// A saved chart lookup is graded by its chart frequency, like a live preflop decision.
function savedSpotUsable(row){return PokerPreflop.isResult(row.result)||T.assessmentEvidence(row.result).usable;}
function spotQuality(row){if(!validSpotResult(row.result))return 0;return T.assessmentEvidence(row.result).usable?2:1;}
function archiveSavedSpot(row){if(row.archived===true&&row.id==='archive-'+hash(row.key))return row;const key=typeof row.key==='string'?row.key:JSON.stringify(['legacy',row.id]);return{id:'archive-'+hash(key),key,archived:true,record:row,updatedAt:new Date(rowDate(row)||Date.now()).toISOString()};}
function savedSpotContext(row){
 const key=JSON.parse(row.key);if(!Array.isArray(key)||key[0]!=='spot-v3'||typeof key[1]!=='string')throw Error('Unsupported saved spot key.');
 const base=JSON.parse(key[1]);if(!Array.isArray(base)||base.length!==5||!Array.isArray(base[4]))throw Error('Invalid saved spot history.');
 const observed=row.observed||{config:base[0],actor:base[1],heroCards:base[2],board:base[3],actions:base[4].map((a,i)=>({seat:a[0],street:a[1],kind:a[2],target:a[3],id:'restored-'+i}))};
 if(!observed||!Number.isInteger(observed.actor)||!Array.isArray(observed.heroCards)||!Array.isArray(observed.board)||observed.board.length>5||!Array.isArray(observed.actions)||observed.actions.length>300||!observed.heroCards.concat(observed.board).every(c=>Number.isInteger(c)&&c>=0&&c<52))throw Error('Invalid saved spot cards or actions.');
 if(PokerSpot.publicKey(observed)!==key[1])throw Error('Saved spot context does not match its cache key.');
 const config=G.normalize(observed.config);if(observed.actor<0||observed.actor>=config.seats||observed.heroCards.length!==config.rules.hole)throw Error('Invalid saved spot actor.');
 const holes=Array(config.seats).fill(null);holes[observed.actor]=observed.heroCards;
 const hand=PokerSpot.reconstruct(observed,holes,G.rng(9181)),options=row.options||key[2];PokerSpot.options(options);
 return{observed,hand,options,extraAction:row.extraAction??key[3]??null};
}
function normalizeSavedSpot(row){
 if(!row||typeof row.key!=='string'||row.key.length>2000000||row.id!=='spot-'+hash(row.key)||!validSpotResult(row.result))throw Error('Invalid saved solver result.');
 const context=savedSpotContext(row);for(const action of row.result.actions)context.hand.clone().act(action);
 return{id:row.id,key:row.key,result:row.result,observed:context.observed,options:context.options,extraAction:context.extraAction,updatedAt:new Date(rowDate(row)||Date.now()).toISOString()};
}
function portableSpot(observed,options,result,extraAction=null,updatedAt=null){
 if(!validSpotResult(result))throw Error('This analysis is not a supported saved result.');
 const opts=PokerSpot.options(options),holes=Array(observed.config.seats).fill(null);holes[observed.actor]=observed.heroCards;const hand=PokerSpot.reconstruct(observed,holes,G.rng(9181));
 if(!extraAction){const regular=PokerSpot.actionsAt(hand,hand,opts,null),extra=result.actions.filter(a=>T.matchAction(regular,a)<0);if(extra.length>1)throw Error('The analysis contains unrecorded custom actions. Export a full study backup instead.');extraAction=extra[0]||null;}
 const key=JSON.stringify(['spot-v3',PokerSpot.publicKey(observed),opts,extraAction]);return normalizeSavedSpot({id:'spot-'+hash(key),key,result,observed,options:opts,extraAction,updatedAt:Number.isFinite(Date.parse(updatedAt))?updatedAt:new Date().toISOString()});
}
function exportPortableSpot(){try{const result=state.hand&&!state.hand.done?activeSpotResult(state.hand):null;if(!result)return;const key=spotUI.last.cacheKey,row=key?normalizeSavedSpot({id:'spot-'+hash(key),key,result,observed:observedData(state.hand),options:spotUI.last.options,updatedAt:new Date().toISOString()}):portableSpot(observedData(state.hand),spotUI.last.options,result);exportJSON({format:'range-lab-spot-solve-v1',...row},'range-lab-spot-analysis.json');}catch(error){status(error.message,true);}}
async function refreshTransferCounts(){
 try{const db=await openDB(),counts=await new Promise((resolve,reject)=>{const tx=db.transaction(studyStores,'readonly'),out={};for(const name of studyStores){const r=tx.objectStore(name).count();r.onsuccess=()=>{out[name]=r.result;};}tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error);});$('transferCounts').innerHTML=[['Solver results',counts.solves],['Saved models',counts.models],['Hand histories',counts.hands],['Assessments',counts.grades]].map(([label,count])=>'<div class="stat"><small>'+label+'</small><strong>'+fmt(count,0)+'</strong></div>').join('');}catch(error){transferMessage('Local data could not be read: '+error.message,true);}
}
function invalidatePreparedBackup(){transferUI.file=null;$('backupShare').disabled=true;$('backupDownload').disabled=true;$('backupReady').textContent='';}
async function prepareStudyBackup(){
 if(transferUI.busy||state.busy){transferMessage('Finish or cancel the current calculation before preparing a backup.',true);return;}
 transferUI.busy=true;$('backupPrepare').disabled=true;$('backupImport').disabled=true;invalidatePreparedBackup();transferMessage('Preparing your saved analyses and study data…');
 try{
  const includeModels=$('backupContents').value==='complete';if(includeModels)await saveModel(false);const stores=await readStudyStores(includeModels),builtIn=builtInPackTest(stores.meta);stores.meta=stores.meta.filter(row=>!localOnlyMeta.includes(row.id)&&(includeModels||row.id!=='lastModel'));let legacy=0;
  // A legacy row and its archived copy share one ID; keep the newest so the backup stays importable.
  const solves=new Map();for(const row of stores.solves.map(row=>{try{return normalizeSavedSpot(row);}catch{legacy++;return archiveSavedSpot(row);}})){const old=solves.get(row.id);if(!old||rowDate(row)>rowDate(old))solves.set(row.id,row);}stores.solves=[...solves.values()];
  // The study file lists reference charts by name (re-import them from their file); a complete backup carries them as plain arrays.
  const charts=stores.meta.find(row=>row.id==='preflopReferences-v1');if(charts)charts.value=(Array.isArray(charts.value)?charts.value:[]).filter(p=>!builtIn(p));const references=(charts?.value||[]).map(p=>({name:p.name,source:p.source,seats:p.config?.seats,stack:p.config?.stacks?.[0]}));if(charts)stores.meta=stores.meta.map(row=>row!==charts?row:includeModels&&row.value.length?{id:row.id,value:row.value.map(plainPack)}:null).filter(Boolean);
  const exportedAt=new Date().toISOString(),data={format:backupFormat,version:1,contents:includeModels?'complete':'study',exportedAt,...!includeModels&&references.length?{references}:{},stores},text=JSON.stringify(data),name='range-lab-study-'+exportedAt.replace(/[:.]/g,'-')+'.json';
  if(text.length>250*1048576)throw Error('it would be '+fmt(text.length/1048576,0)+' MB, over the 250 MB import limit. Choose the Study file, which leaves out models and reference charts.');
  transferUI.file=new File([text],name,{type:'application/json'});$('backupDownload').disabled=false;
  let canShare=false;try{canShare=!!navigator.canShare?.({files:[transferUI.file]});}catch{}$('backupShare').disabled=!canShare;
  $('backupReady').textContent=fmt(transferUI.file.size/1048576,2)+' MB prepared at '+new Date(exportedAt).toLocaleTimeString()+'. '+(canShare?'Share it to a cloud drive or folder.':'Download it, then copy it to the other device.');
  transferMessage('Backup ready: '+stores.solves.length+' saved analyses, '+stores.models.length+' models, '+stores.hands.length+' hands and '+stores.grades.length+' assessments.'+(legacy?' '+legacy+' older analyses are preserved as records but may not support practice.':'')+(data.references?' '+data.references.length+' preflop reference charts are listed but not included; re-import them from their reference file.':''));await refreshTransferCounts();
 }catch(error){transferMessage('Backup could not be prepared: '+error.message,true);}finally{transferUI.busy=false;$('backupPrepare').disabled=false;$('backupImport').disabled=state.busy;}
}
function shareStudyBackup(){
 const file=transferUI.file;if(!file)return;
 navigator.share({files:[file],title:'Guava Poker study backup'}).then(()=>transferMessage('Share sheet closed. Your backup is in the destination you selected; this app cannot confirm the upload.')).catch(error=>{if(error.name!=='AbortError')transferMessage('Sharing failed. Use Download backup instead. '+error.message,true);});
}
function downloadStudyBackup(){if(!transferUI.file)return;const url=URL.createObjectURL(transferUI.file),a=document.createElement('a');a.href=url;a.download=transferUI.file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);transferMessage('Download requested. Copy the file to your other device and open it there.');}
function validateBackupRow(store,row){
 if(!row||!validRecordId(row.id))throw Error('Invalid '+store+' record ID.');
 if(store==='solves'){if(row.archived===true){if(typeof row.key!=='string'||row.key.length>2000000||row.id!=='archive-'+hash(row.key)||!row.record||typeof row.record!=='object')throw Error('Invalid archived analysis.');return{id:row.id,key:row.key,archived:true,record:row.record,updatedAt:new Date(rowDate(row)||Date.now()).toISOString()};}return normalizeSavedSpot(row);}
 if(store==='models'){const model=T.Model.load(row.snapshot);if(typeof row.name!=='string'||row.name.length>300)throw Error('Invalid model name.');return{id:row.id,name:row.name,snapshot:row.snapshot,summary:model.summary(),updatedAt:new Date(rowDate(row)||Date.now()).toISOString()};}
 if(store==='hands'){const record=H.pack(H.validate(row.record));return{id:row.id,record,createdAt:new Date(rowDate(row)||Date.now()).toISOString()};}
 if(store==='grades'){
  const config=G.normalize(row.config);if(!Number.isInteger(row.hero)||row.hero<0||row.hero>=config.seats||!Number.isInteger(row.street)||row.street<0||row.street>3||typeof row.hand!=='string'||typeof row.action!=='string'||row.action.length>200||typeof row.position!=='string'||row.position.length>80||!Array.isArray(row.actions)||!Number.isFinite(Date.parse(row.createdAt)))throw Error('Invalid saved assessment.');
  for(const key of ['loss','lossSE','estimatedLoss','estimatedLossSE','effectiveSamples','coverage','referenceVisits','referenceUpdates'])if(row[key]!==undefined&&row[key]!==null&&!Number.isFinite(row[key]))throw Error('Invalid assessment number: '+key);
  const holes=Array(config.seats).fill(null);holes[row.hero]=row.hand;H.validate({format:'range-lab-hand-v1',chipScale:G.U,config,holes,board:row.board,actions:row.actions,notes:[]});
  return scrubSavedGrade({...row,config,mode:config.mode,variant:config.variant,units:config.mode==='cash'?'bb':'prize units',createdAt:new Date(row.createdAt).toISOString()});
 }
 if(store==='meta'){
  const allowed=['lastModel','spotSizing','spotDealBudget','spotLocalSolver','autoAnalyze','gradeEvery','liveSession','preflopReferences-v1','preflopPreferred-v1','solverHelp','drillLeaks-v1'];if(!allowed.includes(row.id))throw Error('Unknown device setting: '+row.id);
  if(row.id==='lastModel'&&!validRecordId(row.value))throw Error('Invalid model selection.');
  if(['autoAnalyze','gradeEvery','solverHelp'].includes(row.id)&&typeof row.value!=='boolean')throw Error('Invalid automatic-analysis preference.');
  if(row.id==='spotLocalSolver'&&!['','http://127.0.0.1:8787'].includes(row.value))throw Error('Invalid local solver setting.');
  if(row.id==='spotDealBudget'&&![20000,50000,100000,200000,500000].includes(row.value))throw Error('Invalid deal limit.');
  if(row.id==='spotSizing')T.normalizeAbstraction(row.value);
  if(row.id==='drillLeaks-v1'&&!PokerDrills.validDeck(row.value))throw Error('Invalid drill schedule.');
  if(row.id==='preflopReferences-v1'){if(!Array.isArray(row.value)||row.value.length>1000)throw Error('Invalid preflop reference collection.');for(const pack of row.value)PokerPreflop.validate(pack);}
  return{id:row.id,value:row.value};
 }
 throw Error('Unsupported backup record.');
}
async function validateStudyImport(data){
 if(data?.format==='range-lab-spot-solve-v1'){
  const row=data.key?normalizeSavedSpot({...data,id:'spot-'+hash(data.key)}):portableSpot(data.observed,data.options,data.result,data.extraAction,data.updatedAt||data.exportedAt);
  return Object.fromEntries(studyStores.map(name=>[name,name==='solves'?[row]:[]]));
 }
 if(data?.format!==backupFormat||data.version!==1||!data.stores||typeof data.stores!=='object')throw Error('Choose a Guava Poker study backup or exported spot analysis.');
 const out={};let total=0;
 for(const name of studyStores){const rows=data.stores[name];if(!Array.isArray(rows)||rows.length>100000)throw Error('Invalid or oversized '+name+' collection.');total+=rows.length;}
 if(total>200000)throw Error('This backup has too many records for a browser import.');
 for(const name of studyStores){out[name]=[];const ids=new Set();for(let i=0;i<data.stores[name].length;i++){if(name==='meta'&&localOnlyMeta.includes(data.stores[name][i]?.id))continue;let row;try{row=validateBackupRow(name,data.stores[name][i]);}catch(error){const id=data.stores[name][i]?.id;throw Error(({hands:'Saved hand',grades:'Practice decision',solves:'Saved analysis',models:'Model',meta:'Setting'})[name]+' '+(i+1)+' of '+data.stores[name].length+(typeof id==='string'?' ('+id.slice(0,80)+')':'')+' is invalid: '+String(error.message).replace(/\.?$/,'.')+' No data was changed.');}if(ids.has(row.id)){const at=out[name].findIndex(r=>r.id===row.id),old=out[name][at];if(name!=='solves'||!row.archived||!old.archived||old.key!==row.key)throw Error('Duplicate '+name+' record in backup.');if(rowDate(row)>rowDate(old))out[name][at]=row;continue;}ids.add(row.id);out[name].push(row);if(i%25===0){transferMessage('Checking '+name+' records: '+(i+1)+' / '+data.stores[name].length);await new Promise(resolve=>setTimeout(resolve,0));}}}
 return out;
}
function mergeStudyRows(existing,incoming){
 const updates={};let count=0,kept=0;
 for(const name of studyStores){updates[name]=[];const known=new Map(existing[name].map(row=>[row.id,row]));for(const row of incoming[name]){const old=known.get(row.id);let use=!old;
   if(old&&name==='solves'){if(old.key!==row.key)throw Error('A saved-analysis ID collision prevented import. No data was changed.');const q=spotQuality(row),p=spotQuality(old);use=q>0&&(q>p||q===p&&rowDate(row)>rowDate(old))&&JSON.stringify(row.result)!==JSON.stringify(old.result);}
   else if(old&&name==='models')use=row.snapshot.episodes>old.snapshot.episodes||row.snapshot.episodes===old.snapshot.episodes&&rowDate(row)>rowDate(old);
   else if(name==='meta'&&row.id==='preflopReferences-v1'){const values=Array.isArray(old?.value)?old.value:[],charts=new Map(),newer=(v,o)=>!o||(Date.parse(v.source?.createdAt)||0)>(Date.parse(o.source?.createdAt)||0);for(const v of values){const k=packKey(v);if(newer(v,charts.get(k)))charts.set(k,v);}let changed=charts.size!==values.length;for(const v of row.value){const k=packKey(v);if(newer(v,charts.get(k))){charts.set(k,v);changed=true;}}if(changed){updates[name].push({id:row.id,value:[...charts.values()]});count++;}else kept++;continue;}
   else if(old&&name==='meta'&&row.id==='drillLeaks-v1')use=(Date.parse(row.value.updatedAt)||0)>(Date.parse(old.value?.updatedAt)||0);
   else if(old&&name!=='meta'&&name!=='solves'&&name!=='models')use=rowDate(row)>rowDate(old);
   if(use){updates[name].push(row);count++;}else kept++;
  }}return{updates,count,kept};
}
async function importStudyData(data){
 const incoming=await validateStudyImport(data),existing=await readStudyStores(),plan=mergeStudyRows(existing,incoming),db=await openDB();if(plan.count)transferMessage('Saving '+fmt(plan.count,0)+' record'+(plan.count===1?'':'s')+'…');
 await new Promise((resolve,reject)=>{const tx=db.transaction(studyStores,'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('Import was rolled back.'));tx.onerror=()=>{};try{for(const name of studyStores)for(const row of plan.updates[name])tx.objectStore(name).put(row);}catch(error){tx.abort();reject(error);}});
 for(const name of studyStores)for(const row of plan.updates[name])citrusAccount.changed(name,row.id);spotUI.cache.clear();spotUI.last=null;const stores=await readStudyStores();state.models=stores.models;state.histories=newestRows(stores.hands,validHandRow).rows;state.grades=newestRows(stores.grades.map(r=>{try{return scrubSavedGrade(r)}catch{return null}}),validGradeRow).rows;renderLibrary();renderSavedHands();renderProgress();invalidatePreparedBackup();
 if(plan.updates.meta.some(row=>row.id==='preflopReferences-v1')){preflopLibrary.packs=preflopLibrary.packs.filter(p=>memoryOnly.has(p));restorePreflop(stores.meta);spotUI.last=null;renderPlay();renderRanges();}
 await refreshTransferCounts();plan.references=Array.isArray(data?.references)?data.references.filter(r=>!builtInPackTest(stores.meta)(r)).length:0;
 return plan;
}
async function importStudyFile(file){
 if(!file)return;if(transferUI.busy||state.busy){transferMessage(transferUI.busy?'Wait for the current backup step to finish, then open the file again.':'Finish or cancel the current calculation before importing.',true);$('backupFile').value='';return;}if(file.size>250*1048576){transferMessage('This file exceeds the 250 MB browser import limit. Export a smaller set of data for your phone.',true);$('backupFile').value='';return;}
 transferUI.busy=true;lock('dataImport');$('stop').disabled=true;$('backupImport').disabled=true;$('backupPrepare').disabled=true;transferMessage('Reading '+file.name+'…');
 try{let data;try{data=JSON.parse(await file.text());}catch(error){if(error instanceof SyntaxError)throw Error('This file is incomplete or damaged, so it cannot be read as a backup. It may not have finished downloading (common with iCloud or other cloud folders); download or export it again and retry. No data was changed.');throw error;}const plan=await importStudyData(data);transferMessage('Imported '+fmt(plan.count,0)+' new or newer records; kept '+fmt(plan.kept,0)+' existing records. Open Saved spots to practice without recalculating.'+(plan.references?' This file lists '+plan.references+' preflop reference charts that it does not include; import any you are missing from their reference file.':''));$('backupReload').classList.toggle('hide',!plan.updates.meta.length);}
 catch(error){transferMessage('Import failed: '+error.message,true);}finally{transferUI.busy=false;$('backupImport').disabled=false;$('backupPrepare').disabled=false;$('backupFile').value='';lock();}
}
async function refreshSavedSpots(){
 const generation=++transferUI.generation;try{const rows=await dbAll('solves');if(generation!==transferUI.generation)return;let skipped=0;transferUI.rows=[];for(const row of rows){try{const normalized=normalizeSavedSpot(row);transferUI.rows.push(normalized);}catch{skipped++;}}transferUI.rows.sort((a,b)=>rowDate(b)-rowDate(a));const only=$('savedReliableOnly').checked,eligible=transferUI.rows.filter(row=>!only||savedSpotUsable(row));
 const total=transferUI.rows.length,hidden=total-eligible.length;$('savedSpotStatus').textContent=(!total?'No saved spots yet. Analyze a decision in Play or Study and it is saved here.':hidden?eligible.length+' of '+total+' saved spot'+(total>1?'s':'')+' shown. '+hidden+' did not reach the assessment target and '+(hidden>1?'are':'is')+' hidden by the \'Only spots with a usable assessment\' filter in Library > Saved spots; turn it off to practice '+(hidden>1?'them':'it')+' as study only.':total+' saved spot'+(total>1?'s':'')+' ready to practice, no new solve needed.')+(skipped?' · '+skipped+' older records cannot be replayed.':'');
 $('savedSpotList').innerHTML=eligible.slice(0,200).map(row=>{const data=row.observed,labels=G.positions(data.config.seats,data.config.button),quality=PokerPreflop.isResult(row.result)?'Chart frequencies':T.assessmentEvidence(row.result).usable?'Assessment target reached':'Study only · accuracy target not reached';return'<div class="item saved-spot-row"><div><strong>'+esc(data.config.variant)+' · '+data.config.seats+' seats · '+esc(G.STREET[data.board.length===5?3:data.board.length===4?2:data.board.length===3?1:0])+'</strong><div class="small muted">'+esc(labels[data.actor])+' · '+esc(data.heroCards.map(C.cardName).join(' '))+' · '+quality+'</div><div class="small muted">'+esc(dateLabel(row.updatedAt))+'</div></div><button class="btn secondary" data-saved-spot="'+row.id+'">Practice spot</button></div>';}).join('')||'<div class="notice">'+(rows.length?'No spots match this filter. Turn off the assessment filter to review other saved results.':'Or import a backup from another device.')+'</div>';
 document.querySelectorAll('[data-saved-spot]').forEach(button=>button.onclick=()=>startSavedSpot(button.dataset.savedSpot));
 }catch(error){$('savedSpotStatus').textContent='Could not load saved analyses: '+error.message;}
}
function startSavedSpot(id){
 try{const row=transferUI.rows.find(r=>r.id===id);if(!row)return;const {hand}=savedSpotContext(row),hero=hand.actor,labels=G.positions(hand.n,hand.button),known=Array(hand.n).fill(false);known[hero]=true;transferUI.drill={row,hand,answered:false};
 $('savedSpotDrill').classList.remove('hide');$('savedDrillTitle').textContent=hand.config.variant+' · '+hand.n+' seats · '+labels[hero]+' · '+G.STREET[hand.street];$('savedDrillScope').textContent='Saved result under the recorded ranges and bet tree. This drill uses the saved decision only; imported data has not been recalculated on this device.';
 const sb=hand.n===2?hand.button:(hand.button+1)%hand.n,bb=(hand.button+(hand.n===2?1:2))%hand.n,origin=hand.config.startStreet?'This study begins on '+G.STREET[hand.config.startStreet]+' with '+fmt(hand.config.pot)+' bb in the pot; earlier actions are not in the saved study.':'Initial stacks: '+hand.initial.map((amount,i)=>labels[i]+' '+fmt(G.bb(amount))+' bb').join(' · ')+'. '+labels[sb]+' posts '+hand.config.sb+' bb; '+labels[bb]+' posts '+hand.config.bb+' bb.'+(hand.config.ante?' Ante '+hand.config.ante+' bb ('+hand.config.anteMode+').':'');
 $('savedDrillHistory').innerHTML='<div class="history-start">'+esc(origin)+'</div>'+historyLog(hand.log).map(event=>'<div>'+esc(eventLabel(event,seatNames(hand,hero)))+'</div>').join('')+'<div><strong>'+esc(labels[hero])+': your decision</strong></div>';
 paintTable($('savedDrillTable'),hand,hero,{known,caption:'Your saved practice decision'});$('savedDrillActions').innerHTML=row.result.actions.map((action,i)=>'<button class="btn" data-saved-action="'+i+'">'+esc(action.label)+'</button>').join('');$('savedDrillFeedback').textContent='Choose your action to reveal the saved analysis.';document.querySelectorAll('[data-saved-action]').forEach(button=>button.onclick=()=>answerSavedSpot(Number(button.dataset.savedAction)));$('savedSpotDrill').scrollIntoView({block:'start'});
 }catch(error){$('savedSpotStatus').textContent='This saved spot could not be reconstructed: '+error.message;}
}
function answerSavedSpot(index){const drill=transferUI.drill;if(!drill||drill.answered)return;const result=drill.row.result,action=result.actions[index];if(!action)return;drill.answered=true;document.querySelectorAll('[data-saved-action]').forEach(button=>button.disabled=true);const chart=PokerPreflop.isResult(result),usable=T.assessmentEvidence(result).usable;if(usable||chart)scoreResult(result,{kind:'savedSpot',hand:drill.hand,action},action);$('savedDrillFeedback').innerHTML='<p><strong>You chose '+esc(action.label)+'.</strong> '+(chart?(result.reference[index]===null?'Outside the chart.':'Chart frequency: '+fmt(result.reference[index]*100,1)+'%.'):usable?'Saved estimated decision cost: '+fmt(result.loss[index],3)+' '+esc(result.units)+'.':'This saved result did not reach the assessment target, so no grade is recorded.')+'</p>'+decisionResultHTML(result);}
function nextSavedSpot(){const eligible=transferUI.rows.filter(row=>!$('savedReliableOnly').checked||savedSpotUsable(row));if(!eligible.length)return;const current=eligible.findIndex(row=>row.id===transferUI.drill?.row.id);startSavedSpot(eligible[(current+1)%eligible.length].id);}
function initTransfer(){
 $('backupPrepare').onclick=prepareStudyBackup;$('backupContents').onchange=invalidatePreparedBackup;$('backupShare').onclick=shareStudyBackup;$('backupDownload').onclick=downloadStudyBackup;$('backupImport').onclick=()=>$('backupFile').click();$('backupFile').onchange=()=>importStudyFile($('backupFile').files[0]);$('backupReload').onclick=()=>location.reload();$('savedRefresh').onclick=refreshSavedSpots;$('savedReliableOnly').onchange=refreshSavedSpots;$('savedTransfer').onclick=()=>switchTab('transfer');$('savedNextSpot').onclick=nextSavedSpot;
 $('mobileSetupToggle').onclick=()=>{const hidden=document.querySelector('.layout').classList.toggle('mobile-setup-hidden');$('mobileSetupToggle').setAttribute('aria-expanded',String(!hidden));$('mobileSetupToggle').textContent=hidden?'Table setup & solver options':'Close table setup';};
}
