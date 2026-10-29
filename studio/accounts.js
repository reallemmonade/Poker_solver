'use strict';
// Accounts: each person's hands, assessments, saved spots, drill progress and settings sync to the account service.
// The browser keeps its own copy (IndexedDB per account) so play works offline; the server is the shared copy across
// devices. The first account to sign in on a device takes over that device's existing data and uploads it.
const citrusAccount=(()=>{
 const API_ORIGIN='__MULTIPLAYER_API_ORIGIN__',API=/^https?:\/\//.test(API_ORIGIN)?API_ORIGIN:/^https?:$/.test(location.protocol)?location.origin:'';
 const ACCOUNT='citrus-account-v1',OWNER='citrus-device-owner-v1',LEGACY_DB='range-lab-poker-studio',ROW_MAX=250000,BATCH_BYTES=2500000,BATCH_ROWS=200;
 const STUDY=['hands','grades','solves','meta'],META=new Set(['spotSizing','spotDealBudget','autoAnalyze','gradeEvery','preflopPreferred-v1']);
 const PREFS=['range-lab-theme','citrus-look','citrus-felt','range-lab-four-color','range-lab-table-motion','range-lab-opponents','range-lab-quiz-filters','range-lab-bot-rebuy','range-lab-key-shortcuts','citrus-friend-stats-v1'];
 const read=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback}catch{return fallback}};
 const write=(key,value)=>{try{value===null?localStorage.removeItem(key):localStorage.setItem(key,JSON.stringify(value))}catch{}};
 let account=read(ACCOUNT,null);if(!account?.token||!account?.user?.id)account=null;
 const uid=()=>account?.user.id,key=name=>name+':'+uid();
 const sync={status:account?'waiting':'signedOut',at:read(account?key('citrus-sync-at-v1'):'',0),timer:0,running:null,again:false,note:''};
 const synced=(store,id)=>store==='hands'||store==='grades'||store==='solves'||store==='meta'&&(META.has(id)||/^(drill|practice|solvejob-|flopwant-)/.test(id)||id==='macsolver'||id==='liveSession');
 function dbName(){const owner=read(OWNER,null);if(account)return owner===account.user.id?LEGACY_DB:LEGACY_DB+'-'+account.user.id;return owner?LEGACY_DB+'-guest':LEGACY_DB;}
 // wake: a free Render service can take up to a minute to start, and until then requests fail outright; sign-in retries.
 async function api(method,path,data,token=account?.token,wake=false){
  if(!API)throw Object.assign(Error('Accounts need the hosted site.'),{status:0});
  let res;for(let attempt=0;;attempt++){try{res=await fetch(API+path,{method,headers:{...data?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:data?JSON.stringify(data):undefined,...!wake&&AbortSignal.timeout?{signal:AbortSignal.timeout(9e4)}:{}});break;}catch{if(!wake||attempt>=4){
   // Tell a blocked request (server reachable, browser refused the answer) apart from no connection at all.
   let reachable=false;if(wake)try{await fetch(API+'/api/health',{mode:'no-cors',cache:'no-store'});reachable=true;}catch{}
   throw Object.assign(Error(!wake?'No connection. Your work stays saved on this device.':reachable?'The browser blocked the account server ('+new URL(API).host+') on this page ('+location.origin+').':'Could not reach the account server ('+new URL(API).host+'). Check your connection and try again.'),{status:0});}if(typeof wake==='function')wake();await new Promise(r=>setTimeout(r,[3000,6000,10000,15000][attempt]));}}
  // Anything but a JSON answer means the request reached the wrong server (for example the static site) or a proxy page.
  const text=await res.text().catch(()=>'');let body=null;try{body=JSON.parse(text)}catch{}
  if(!body||typeof body!=='object'){const host=new URL(API).host;throw Object.assign(Error(res.status>=500||res.status===0?'The account server ('+host+') is not answering. It may be waking up; try again in a minute.':'The account server ('+host+') sent back a page instead of an answer (HTTP '+res.status+'). Its address may be set wrong.'),{status:res.status>=500?res.status:502});}
  if(!res.ok)throw Object.assign(Error(body.error||'Something went wrong.'),{status:res.status});return body;
 }
 // Local queue of records changed since the last upload: "store id" → change time.
 const queue=()=>account?read(key('citrus-sync-queue-v1'),{}):{},saveQueue=q=>account&&write(key('citrus-sync-queue-v1'),q);
 function changed(store,id){if(!account||!synced(store,id))return;const q=queue();q[store+' '+id]=Date.now();saveQueue(q);schedule(4000);}
 function schedule(ms){clearTimeout(sync.timer);if(account)sync.timer=setTimeout(run,ms);}
 function prefChanges(){const seen=read(key('citrus-prefs-seen-v1'),{}),rows=[];for(const k of PREFS){let v=null;try{v=localStorage.getItem(k)}catch{}if(v!==null&&v!==seen[k])rows.push({store:'prefs',id:k,t:Date.now(),data:v});}return rows;}
 function idb(stores,mode,fn){return openDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode),out=fn(tx);tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error||Error('The browser aborted the save.'));tx.onerror=()=>{};}));}
 // First sync on a device: everything already saved here goes into the queue.
 async function seed(){const q=queue(),now=Date.now();await idb(STUDY,'readonly',tx=>{for(const s of STUDY){const r=tx.objectStore(s).getAllKeys();r.onsuccess=()=>{for(const id of r.result)if(synced(s,id)&&!q[s+' '+id])q[s+' '+id]=now;};}});saveQueue(q);write(key('citrus-sync-seeded-v1'),true);}
 const encoder=new TextEncoder(),bytesOf=row=>encoder.encode(JSON.stringify(row)).length;
 async function push(){
  const prefs=prefChanges();
  for(;;){
   const q=queue(),keys=Object.keys(q);if(!keys.length&&!prefs.length)return;
   const batch=keys.slice(0,BATCH_ROWS),rows=await idb(STUDY,'readonly',tx=>{const out=[];for(const k of batch){const i=k.indexOf(' '),store=k.slice(0,i),id=k.slice(i+1),r=tx.objectStore(store).get(id);r.onsuccess=()=>out.push({k,store,id,row:r.result});}return out;});
   const send=[...prefs.splice(0)],sent=[];let bytes=0;
   for(const x of rows){if(!x.row){sent.push(x.k);continue;}const size=bytesOf(x.row);if(size>ROW_MAX||!/^[a-zA-Z0-9._:-]{1,200}$/.test(x.id)){sent.push(x.k);continue;}if(send.length&&bytes+size>BATCH_BYTES)break;bytes+=size;send.push({store:x.store,id:x.id,t:q[x.k],data:x.row});sent.push(x.k);}
   if(send.length){const since=read(key('citrus-sync-cursor-v1'),0),res=await api('POST','/api/sync',{rows:send,since});if(res.cursor>since&&read(key('citrus-sync-cursor-v1'),0)===since)write(key('citrus-sync-cursor-v1'),res.cursor);}
   const after=queue();for(const k of sent)if(after[k]===q[k])delete after[k];saveQueue(after);
   const seen=read(key('citrus-prefs-seen-v1'),{});for(const r of send)if(r.store==='prefs')seen[r.id]=r.data;write(key('citrus-prefs-seen-v1'),seen);
   if(!sent.length)return;
  }
 }
 // A record from another device replaces the local one unless this device changed it since (that change uploads next).
 function accept(store,row){if(store==='meta'&&!META.has(row?.id)){if(!row||typeof row.id!=='string'||!synced('meta',row.id))throw Error('Invalid setting.');return{id:row.id,value:row.value};}return validateBackupRow(store,row);}
 async function pull(){
  let since=read(key('citrus-sync-cursor-v1'),0),got={hands:0,grades:0,solves:0,meta:0,prefs:0,session:null};
  for(;;){
   const page=await api('GET','/api/sync?since='+since),q=queue(),puts=[];
   for(const r of page.rows){if(q[r.store+' '+r.id]>r.t)continue;if(r.store==='prefs'){if(PREFS.includes(r.id)&&typeof r.data==='string'){let cur=null;try{cur=localStorage.getItem(r.id)}catch{}if(cur!==r.data){try{localStorage.setItem(r.id,r.data)}catch{}got.prefs++;}const seen=read(key('citrus-prefs-seen-v1'),{});seen[r.id]=r.data;write(key('citrus-prefs-seen-v1'),seen);}continue;}
    try{puts.push([r.store,accept(r.store,r.data)]);}catch{}}
   if(puts.length)await idb(STUDY,'readwrite',tx=>{for(const [s,row]of puts){tx.objectStore(s).put(row);got[s]++;if(s==='meta'&&row.id==='liveSession')got.session=row.value;}});
   since=page.cursor;write(key('citrus-sync-cursor-v1'),since);if(!page.more)break;
  }
  return got;
 }
 async function run(){
  if(!account)return;if(sync.running){sync.again=true;return sync.running;}
  sync.running=(async()=>{let session=null;
   const first=!read(key('citrus-sync-seeded-v1'),false);sync.status='syncing';render();
   try{if(first)await seed();let full=null;await push().catch(e=>{if(e.status!==507)throw e;full=e;});const got=await pull();session=got.session;if(full){sync.status='full';sync.note=full.message;}else{sync.status='synced';sync.at=Date.now();write(key('citrus-sync-at-v1'),sync.at);sync.note='';}
    if(got.hands||got.grades)try{refreshSharedHands()}catch{}if(got.solves)try{refreshSavedSpots()}catch{}
    if(got.hands||got.grades||got.solves||got.meta||got.prefs)dispatchEvent(new CustomEvent('citrus-synced',{detail:got}));
    // Settings and preferences from another device apply on a fresh load; reload once after the first sync if no hand is live.
    if(first&&(got.prefs||got.meta)&&(!state.hand||state.hand.done))location.reload();
   }catch(e){if(e.status===401){sync.status='expired';}else if(e.status===503&&/not switched on/.test(e.message)){sync.status='off';}else if(e.status===507){sync.status='full';sync.note=e.message;}else{sync.status='offline';sync.note=e.message;}}
   finally{sync.running=null;render();
    // The live table hands off between devices (session.js): whichever device acted last owns it, and the other turns read-only.
    dispatchEvent(new CustomEvent('citrus-sync-done',{detail:{session}}));
    const playing=document.visibilityState==='visible'&&typeof state!=='undefined'&&!!state.hand;
    if(sync.again){sync.again=false;schedule(1000);}else if(sync.status!=='expired'&&sync.status!=='off')schedule(sync.status==='synced'?(playing?15000:90000):30000);}
  })();return sync.running;
 }
 const waking=()=>{const b=document.getElementById('uiAccountSubmit');if(b)b.textContent='Waking the server…';};
 async function signIn(kind,payload){
  const res=await api('POST','/api/auth/'+kind,payload,null,waking);
  if(!res?.token||!res?.user?.id)throw Object.assign(Error('The account server ('+new URL(API).host+') gave an unexpected answer. Try again in a minute.'),{status:502});
  if(read(OWNER,null)===null)write(OWNER,res.user.id);
  account={token:res.token,user:res.user};write(ACCOUNT,account);location.reload();
 }
 async function signOut(){const old=account;if(old){try{await push()}catch{}api('POST','/api/auth/logout',{},old.token).catch(()=>{});}account=null;write(ACCOUNT,null);location.reload();}
 async function deleteAccount(password){await api('POST','/api/account/delete',{password});for(const n of ['citrus-sync-queue-v1','citrus-sync-cursor-v1','citrus-sync-seeded-v1','citrus-sync-at-v1','citrus-prefs-seen-v1'])write(key(n),null);if(read(OWNER,null)===uid())write(OWNER,null);account=null;write(ACCOUNT,null);location.reload();}
 // Interface: a round account button beside Settings and one dialog.
 const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
 let dialog=null,button=null,mode='login',resetLogin='';
 const EYE='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path class="ui-eye-slash" d="M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
 const field=(id,label,attrs)=>'<div class="field"><label for="'+id+'">'+label+'</label><input class="input" id="'+id+'" '+attrs+'></div>';
 // Password fields share one eye button: tapping it shows or hides every password in the form.
 const passField=(id,label,auto,eye)=>'<div class="field"><label for="'+id+'">'+label+'</label><div class="ui-pass"><input class="input" id="'+id+'" type="password" autocomplete="'+auto+'" minlength="8" required>'+(eye?'<button type="button" class="ui-eye" aria-label="Show password" aria-pressed="false">'+EYE+'</button>':'')+'</div></div>';
 function statusLine(){const ago=sync.at?Math.max(0,Math.round((Date.now()-sync.at)/60000)):null;return{waiting:'Syncing soon',syncing:'Syncing…',synced:'Synced'+(ago===null?'':ago<1?' just now':' '+ago+' min ago'),offline:'Offline · saved on this device',expired:'Signed out on the server · sign in again',full:sync.note,off:'Sync is not switched on yet · saved on this device'}[sync.status]||'';}
 function render(){
  if(button){const label=account?account.user.name||account.user.username:'';button.innerHTML=account?'<span class="ui-account-initial">'+esc(label.slice(0,1).toUpperCase())+'</span>':'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';button.setAttribute('aria-label',account?'Account: '+label:'Sign in');button.classList.toggle('ui-account-alert',!!account&&['expired','full'].includes(sync.status));}
  if(!dialog?.open)return;const body=dialog.querySelector('.ui-dialog-content'),more='<p class="small ui-account-more"><button type="button" class="ui-text-button" data-account-go="transfer">Backups</button> · <button type="button" class="ui-text-button" data-account-go="help">Help</button></p>';
  if(account){const shape=JSON.stringify([account.user,sync.status==='expired'&&mode]),line=body.querySelector('#uiAccountStatus');if(line&&body.dataset.shape===shape){line.textContent=statusLine();return;}body.dataset.shape=shape;body.innerHTML='<p class="ui-account-name"><strong>'+esc(account.user.name||account.user.username)+'</strong></p>'+(account.user.email?'<p class="small muted ui-account-email">'+esc(account.user.email)+'</p>':'')+'<p class="small muted" id="uiAccountStatus">'+esc(statusLine())+'</p><div class="row gap">'+(sync.status==='expired'?'':'<button type="button" class="btn secondary" id="uiAccountSync">Sync now</button>')+'<button type="button" class="btn secondary" id="uiAccountOut">Sign out</button></div><details class="ui-disclosure"'+(account.user.email?'':' open')+'><summary>'+(account.user.email?'Change email':'Add email')+'</summary><form class="ui-account-form" id="uiEmailForm">'+field('uiEmailNew','Email','type="email" autocomplete="email" autocapitalize="none" required')+passField('uiEmailPass','Password','current-password',true)+'<p class="small error" id="uiEmailError" role="alert"></p><button class="btn" type="submit">Save email</button></form></details><details class="ui-disclosure"><summary>Delete account</summary><p class="small muted">Removes your synced data from the server. This device keeps its copy.</p><div class="row gap"><input class="input" id="uiAccountDeletePass" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password"><button type="button" class="btn secondary" id="uiAccountDelete">Delete</button></div><p class="small error" id="uiAccountDeleteError" role="alert"></p></details>';
   body.insertAdjacentHTML('beforeend',more);body.querySelector('#uiAccountSync')?.addEventListener('click',()=>run());body.querySelector('#uiAccountOut').onclick=()=>signOut();
   wireEyes(body.querySelector('#uiEmailForm'));body.querySelector('#uiEmailForm').onsubmit=async e=>{e.preventDefault();const out=body.querySelector('#uiEmailError');out.textContent='';try{const r=await api('POST','/api/account/email',{email:body.querySelector('#uiEmailNew').value,password:body.querySelector('#uiEmailPass').value});account.user=r.user;write(ACCOUNT,account);render();}catch(x){out.textContent=x.message}};
   body.querySelector('#uiAccountDelete').onclick=async()=>{const out=body.querySelector('#uiAccountDeleteError');try{await deleteAccount(body.querySelector('#uiAccountDeletePass').value)}catch(e){out.textContent=e.message}};
   if(sync.status!=='expired')return;
  }
  const signup=mode==='signup',forgot=mode==='forgot',reset=mode==='reset';if(account)body.insertAdjacentHTML('beforeend','<hr>');else body.innerHTML='';
  const tabs='<div class="ui-account-tabs" role="tablist"><button type="button" role="tab" class="btn '+(signup?'secondary':'')+'" data-mode="login" aria-selected="'+!signup+'">Sign in</button><button type="button" role="tab" class="btn '+(signup?'':'secondary')+'" data-mode="signup" aria-selected="'+signup+'">Create account</button></div>';
  const user=account?.user.username||resetLogin,fields=signup?field('uiAccountUser','Username','autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" required')+field('uiAccountEmail','Email','type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required')+passField('uiAccountPass','Password','new-password',true)+passField('uiAccountConfirm','Confirm password','new-password',false)
   :forgot?'<p class="small muted">We email you a code.</p>'+field('uiAccountUser','Username or email','autocomplete="username" autocapitalize="none" spellcheck="false" required value="'+esc(user)+'"')
   :reset?'<p class="small muted">Code sent to the email on '+esc(resetLogin)+'.</p>'+field('uiAccountCode','Code','inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required')+passField('uiAccountPass','New password','new-password',true)+passField('uiAccountConfirm','Confirm password','new-password',false)
   :field('uiAccountUser','Username or email','autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required value="'+esc(user)+'"')+passField('uiAccountPass','Password','current-password',true);
  const label=signup?'Create account':forgot?'Send code':reset?'Set password':'Sign in',extra=forgot||reset?'<button type="button" class="ui-text-button ui-account-link" data-mode="login">Back to sign in</button>':signup?'':'<button type="button" class="ui-text-button ui-account-link" data-mode="forgot">Forgot password?</button>';
  body.insertAdjacentHTML('beforeend','<form class="ui-account-form" id="uiAccountForm">'+(forgot||reset?'':tabs)+fields+'<p class="small error" id="uiAccountError" role="alert"></p><button class="btn" type="submit" id="uiAccountSubmit">'+label+'</button>'+extra+'</form>'+(account?'':more));
  const form=body.querySelector('#uiAccountForm'),val=id=>form.querySelector('#'+id)?.value||'';wireEyes(form);
  form.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render();});
  form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('#uiAccountSubmit'),out=form.querySelector('#uiAccountError');out.textContent='';
   if((signup||reset)&&val('uiAccountPass')!==val('uiAccountConfirm')){out.textContent='Passwords do not match.';form.querySelector('#uiAccountConfirm').focus();return;}
   submit.disabled=true;
   try{if(signup)await signIn('signup',{username:val('uiAccountUser'),email:val('uiAccountEmail'),password:val('uiAccountPass')});
    else if(forgot){await api('POST','/api/auth/forgot',{login:val('uiAccountUser')},null,waking);resetLogin=val('uiAccountUser').trim();mode='reset';render();}
    else if(reset)await signIn('reset',{login:resetLogin,code:val('uiAccountCode'),password:val('uiAccountPass')});
    else await signIn('login',{username:val('uiAccountUser'),password:val('uiAccountPass')});}
   catch(e){out.textContent=e.message;submit.textContent=label;submit.disabled=false;}};
 }
 function wireEyes(form){const eye=form?.querySelector('.ui-eye');if(!eye)return;eye.onclick=()=>{const show=eye.getAttribute('aria-pressed')!=='true';eye.setAttribute('aria-pressed',String(show));eye.setAttribute('aria-label',show?'Hide password':'Show password');form.querySelectorAll('.ui-pass input').forEach(i=>i.type=show?'text':'password');};}
 function mount(top,settingsButton){
  button=document.createElement('button');button.type='button';button.className='btn secondary ui-account-button';button.id='uiAccountButton';button.setAttribute('aria-haspopup','dialog');settingsButton.after(button);
  dialog=document.createElement('dialog');dialog.className='ui-dialog ui-account-dialog';dialog.id='uiAccountDialog';dialog.setAttribute('aria-label','Account');dialog.innerHTML='<div class="ui-dialog-head"><h2>Account</h2><button type="button" class="btn secondary" data-close-dialog>Close</button></div><div class="ui-dialog-content"></div>';top.closest('.shell').append(dialog);
  dialog.querySelector('[data-close-dialog]').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>{dialog.querySelector('.ui-dialog-content').dataset.shape='';if(![...document.querySelectorAll('dialog')].some(n=>n.open))document.body.classList.remove('ui-dialog-open');});
  button.onclick=()=>{dialog.showModal();document.body.classList.add('ui-dialog-open');render();if(account&&sync.status!=='syncing')run();
   // Pick up an email added on another device.
   if(account&&sync.status!=='expired')api('GET','/api/auth/me').then(r=>{if(!account||r.user.id!==account.user.id||r.user.email===account.user.email)return;account.user=r.user;write(ACCOUNT,account);if(!dialog.querySelector('#uiEmailForm input:focus'))render();}).catch(()=>{});};
  render();setInterval(()=>{if(dialog.open&&account)render();},30000);
 }
 // Signing in or out in another tab switches this device's data, so this tab follows; a fresh token for the same account is just adopted.
 addEventListener('storage',e=>{if(e.key!==ACCOUNT)return;let next=null;try{next=JSON.parse(e.newValue||'null')}catch{}if(!next?.token||!next?.user?.id)next=null;if((next?.user.id||null)!==(uid()||null))return location.reload();if(next){account=next;if(sync.status==='expired'){sync.status='waiting';schedule(500);}}});
 if(account){addEventListener('load',()=>schedule(1500));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')run();else schedule(500);});addEventListener('online',()=>schedule(500));}
 return{dbName,changed,run,mount,signIn,signOut,get user(){return account?.user||null},get link(){return account?{api:API||location.origin,token:account.token,user:account.user.id}:null},get status(){return sync.status},synced};
})();
