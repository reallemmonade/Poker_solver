'use strict';
// Player accounts and synced personal data. Each account's records (hands, assessments, saved spots, drill
// progress, settings) are rows keyed by store and id; the newest write by its client timestamp wins, and every
// accepted write gets a fresh sequence number so devices pull only what changed since their last sync.
// TURSO_DATABASE_URL picks Turso (libSQL), DATABASE_URL picks Postgres; without either the service keeps accounts in memory for local use.
const crypto=require('node:crypto');
const STORES=new Set(['hands','grades','solves','meta','prefs']),ROW_MAX=262144,BATCH_MAX=200,PAGE_BYTES=3*1048576,PAGE_ROWS=300,SESSION_DAYS=180;
const QUOTA=(Number(process.env.ACCOUNT_QUOTA_MB)>0?Number(process.env.ACCOUNT_QUOTA_MB):50)*1048576;
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
const newId=()=>'u'+crypto.randomBytes(9).toString('base64url');
const newToken=()=>crypto.randomBytes(32).toString('base64url');
const scrypt=(password,salt)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1048576},(e,key)=>e?reject(e):resolve(key)));
async function hashPassword(password){const salt=crypto.randomBytes(16);return'scrypt$'+salt.toString('base64url')+'$'+(await scrypt(password,salt)).toString('base64url');}
async function checkPassword(password,stored){const [kind,salt,hash]=String(stored||'').split('$');if(kind!=='scrypt'||!salt||!hash)return false;const key=await scrypt(password,Buffer.from(salt,'base64url')),want=Buffer.from(hash,'base64url');return want.length===key.length&&crypto.timingSafeEqual(key,want);}
// A fixed hash so a wrong username costs the same time as a wrong password.
const DUMMY=hashPassword('citrus-dummy-password');

function memoryStore(){
 const users=new Map(),sessions=new Map(),records=new Map(),resets=new Map();let seq=0;
 const rows=id=>{if(!records.has(id))records.set(id,new Map());return records.get(id);};
 return{kind:'memory',
  async init(){},
  async createUser(u){if([...users.values()].some(x=>x.username===u.username||u.email&&x.email===u.email))return false;users.set(u.id,{...u,email:u.email||null,createdAt:new Date().toISOString()});return true;},
  async userByName(username){return[...users.values()].find(u=>u.username===username)||null;},
  async userByEmail(email){return[...users.values()].find(u=>u.email===email)||null;},
  async setEmail(userId,email){if([...users.values()].some(x=>x.email===email&&x.id!==userId))return false;users.get(userId).email=email;return true;},
  async setPassword(userId,pass){users.get(userId).pass=pass;for(const [k,s]of sessions)if(s.userId===userId)sessions.delete(k);},
  async saveReset(userId,hash,expires){resets.set(userId,{code_hash:hash,expires,tries:0});},
  async getReset(userId){return resets.get(userId)||null;},
  async bumpReset(userId){const r=resets.get(userId);if(r)r.tries++;},
  async deleteReset(userId){resets.delete(userId);},
  async createSession(hash,userId){sessions.set(hash,{userId,seenAt:Date.now()});},
  async sessionUser(hash){const s=sessions.get(hash);if(!s)return null;if(Date.now()-s.seenAt>SESSION_DAYS*864e5){sessions.delete(hash);return null;}s.seenAt=Date.now();return users.get(s.userId)||null;},
  async deleteSession(hash){sessions.delete(hash);},
  async usage(userId){let bytes=0,count=0;for(const r of rows(userId).values()){bytes+=r.size;count++;}return{bytes,count};},
  async sizes(userId,list){const m=rows(userId);return list.map(r=>m.get(r.store+'\u0000'+r.id)?.size||0);},
  async push(userId,list){const m=rows(userId);let accepted=0;for(const r of list){const key=r.store+'\u0000'+r.id,old=m.get(key);if(old&&old.t>=r.t)continue;m.set(key,{...r,seq:++seq});accepted++;}return accepted;},
  async head(userId,since){let count=0,max=since;for(const r of rows(userId).values())if(r.seq>since){count++;max=Math.max(max,r.seq);}return{count,max};},
  async pull(userId,since,limit){return[...rows(userId).values()].filter(r=>r.seq>since).sort((a,b)=>a.seq-b.seq).slice(0,limit);},
  async deleteUser(userId){users.delete(userId);records.delete(userId);resets.delete(userId);for(const [k,s]of sessions)if(s.userId===userId)sessions.delete(k);}
 };
}

function postgresStore(url){
 const {Pool}=require('pg'),pool=new Pool({connectionString:url,max:Number(process.env.DATABASE_POOL)||5,idleTimeoutMillis:30000});
 pool.on('error',e=>console.error('Database connection error:',e.message));
 const q=(text,values)=>pool.query(text,values);
 return{kind:'postgres',
  async init(){await q(`CREATE TABLE IF NOT EXISTS citrus_users(id text PRIMARY KEY,username text UNIQUE NOT NULL,name text NOT NULL,pass text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS citrus_sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES citrus_users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),seen_at timestamptz NOT NULL DEFAULT now());
CREATE SEQUENCE IF NOT EXISTS citrus_record_seq;
CREATE TABLE IF NOT EXISTS citrus_records(user_id text NOT NULL REFERENCES citrus_users(id) ON DELETE CASCADE,store text NOT NULL,id text NOT NULL,t bigint NOT NULL,seq bigint NOT NULL DEFAULT nextval('citrus_record_seq'),size integer NOT NULL,data text NOT NULL,PRIMARY KEY(user_id,store,id));
CREATE INDEX IF NOT EXISTS citrus_records_user_seq ON citrus_records(user_id,seq);
ALTER TABLE citrus_users ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS citrus_users_email ON citrus_users(email);
CREATE TABLE IF NOT EXISTS citrus_resets(user_id text PRIMARY KEY REFERENCES citrus_users(id) ON DELETE CASCADE,code_hash text NOT NULL,expires bigint NOT NULL,tries integer NOT NULL DEFAULT 0);`);},
  async createUser(u){const r=await q('INSERT INTO citrus_users(id,username,name,pass,email) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[u.id,u.username,u.name,u.pass,u.email||null]);return r.rowCount===1;},
  async userByName(username){return(await q('SELECT id,username,name,pass,email FROM citrus_users WHERE username=$1',[username])).rows[0]||null;},
  async userByEmail(email){return(await q('SELECT id,username,name,pass,email FROM citrus_users WHERE email=$1',[email])).rows[0]||null;},
  async setEmail(userId,email){try{await q('UPDATE citrus_users SET email=$2 WHERE id=$1',[userId,email]);return true;}catch(e){if(e.code==='23505')return false;throw e;}},
  async setPassword(userId,pass){await q('UPDATE citrus_users SET pass=$2 WHERE id=$1',[userId,pass]);await q('DELETE FROM citrus_sessions WHERE user_id=$1',[userId]);},
  async saveReset(userId,hash,expires){await q('INSERT INTO citrus_resets(user_id,code_hash,expires,tries) VALUES($1,$2,$3,0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,tries=0',[userId,hash,expires]);},
  async getReset(userId){const r=(await q('SELECT code_hash,expires,tries FROM citrus_resets WHERE user_id=$1',[userId])).rows[0];return r?{...r,expires:Number(r.expires)}:null;},
  async bumpReset(userId){await q('UPDATE citrus_resets SET tries=tries+1 WHERE user_id=$1',[userId]);},
  async deleteReset(userId){await q('DELETE FROM citrus_resets WHERE user_id=$1',[userId]);},
  async createSession(hash,userId){await q('INSERT INTO citrus_sessions(token_hash,user_id) VALUES($1,$2)',[hash,userId]);},
  async sessionUser(hash){const r=await q(`UPDATE citrus_sessions s SET seen_at=now() FROM citrus_users u WHERE s.token_hash=$1 AND u.id=s.user_id AND s.seen_at>now()-interval '${SESSION_DAYS} days' RETURNING u.id,u.username,u.name,u.email`,[hash]);return r.rows[0]||null;},
  async deleteSession(hash){await q('DELETE FROM citrus_sessions WHERE token_hash=$1',[hash]);},
  async usage(userId){const r=(await q('SELECT coalesce(sum(size),0)::bigint AS bytes,count(*)::int AS count FROM citrus_records WHERE user_id=$1',[userId])).rows[0];return{bytes:Number(r.bytes),count:r.count};},
  async sizes(userId,list){const r=await q('SELECT store,id,size FROM citrus_records WHERE user_id=$1 AND (store,id) IN (SELECT * FROM unnest($2::text[],$3::text[]))',[userId,list.map(x=>x.store),list.map(x=>x.id)]),m=new Map(r.rows.map(x=>[x.store+'\u0000'+x.id,x.size]));return list.map(x=>m.get(x.store+'\u0000'+x.id)||0);},
  async push(userId,list){const r=await q(`INSERT INTO citrus_records(user_id,store,id,t,size,data) SELECT $1,* FROM unnest($2::text[],$3::text[],$4::bigint[],$5::int[],$6::text[])
ON CONFLICT(user_id,store,id) DO UPDATE SET t=excluded.t,size=excluded.size,data=excluded.data,seq=nextval('citrus_record_seq') WHERE citrus_records.t<excluded.t`,[userId,list.map(x=>x.store),list.map(x=>x.id),list.map(x=>x.t),list.map(x=>x.size),list.map(x=>x.data)]);return r.rowCount;},
  async head(userId,since){const r=(await q('SELECT count(*)::int AS count,coalesce(max(seq),$2)::bigint AS max FROM citrus_records WHERE user_id=$1 AND seq>$2',[userId,since])).rows[0];return{count:r.count,max:Number(r.max)};},
  async pull(userId,since,limit){return(await q('SELECT store,id,t,seq,size,data FROM citrus_records WHERE user_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',[userId,since,limit])).rows.map(r=>({...r,t:Number(r.t),seq:Number(r.seq)}));},
  async deleteUser(userId){await q('DELETE FROM citrus_users WHERE id=$1',[userId]);}
 };
}

// Turso (libSQL/SQLite): TURSO_DATABASE_URL is libsql://<db>-<org>.turso.io (or file:local.db for testing) with TURSO_AUTH_TOKEN.
// SQLite has no sequences, so each accepted write takes the table's highest sequence plus one inside the batch transaction.
function libsqlStore(url,authToken){
 const {createClient}=require('@libsql/client'),db=createClient({url,authToken:authToken||undefined});
 const q=(sql,args=[])=>db.execute({sql,args}),row=r=>r.rows[0]||null;
 return{kind:'turso',
  async init(){await db.batch([`CREATE TABLE IF NOT EXISTS citrus_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,pass TEXT NOT NULL,created_at INTEGER NOT NULL)`,
   `CREATE TABLE IF NOT EXISTS citrus_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES citrus_users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,seen_at INTEGER NOT NULL)`,
   `CREATE TABLE IF NOT EXISTS citrus_records(user_id TEXT NOT NULL REFERENCES citrus_users(id) ON DELETE CASCADE,store TEXT NOT NULL,id TEXT NOT NULL,t INTEGER NOT NULL,seq INTEGER NOT NULL,size INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(user_id,store,id))`,
   `CREATE INDEX IF NOT EXISTS citrus_records_user_seq ON citrus_records(user_id,seq)`,`CREATE INDEX IF NOT EXISTS citrus_records_seq ON citrus_records(seq)`,`CREATE INDEX IF NOT EXISTS citrus_sessions_user ON citrus_sessions(user_id)`,`CREATE TABLE IF NOT EXISTS citrus_resets(user_id TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0)`],'write');
   // Accounts made before emails existed get the column added once.
   const cols=(await q('PRAGMA table_info(citrus_users)')).rows.map(r=>r.name);if(!cols.includes('email'))await q('ALTER TABLE citrus_users ADD COLUMN email TEXT');await q('CREATE UNIQUE INDEX IF NOT EXISTS citrus_users_email ON citrus_users(email)');},
  async createUser(u){const r=await q('INSERT OR IGNORE INTO citrus_users(id,username,name,pass,email,created_at) VALUES(?,?,?,?,?,?)',[u.id,u.username,u.name,u.pass,u.email||null,Date.now()]);return r.rowsAffected===1;},
  async userByName(username){return row(await q('SELECT id,username,name,pass,email FROM citrus_users WHERE username=?',[username]));},
  async userByEmail(email){return row(await q('SELECT id,username,name,pass,email FROM citrus_users WHERE email=?',[email]));},
  async setEmail(userId,email){try{await q('UPDATE citrus_users SET email=? WHERE id=?',[email,userId]);return true;}catch(e){if(/UNIQUE/i.test(e.message))return false;throw e;}},
  async setPassword(userId,pass){await db.batch([{sql:'UPDATE citrus_users SET pass=? WHERE id=?',args:[pass,userId]},{sql:'DELETE FROM citrus_sessions WHERE user_id=?',args:[userId]}],'write');},
  async saveReset(userId,hash,expires){await q('INSERT INTO citrus_resets(user_id,code_hash,expires,tries) VALUES(?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,tries=0',[userId,hash,expires]);},
  async getReset(userId){const r=row(await q('SELECT code_hash,expires,tries FROM citrus_resets WHERE user_id=?',[userId]));return r?{code_hash:r.code_hash,expires:Number(r.expires),tries:Number(r.tries)}:null;},
  async bumpReset(userId){await q('UPDATE citrus_resets SET tries=tries+1 WHERE user_id=?',[userId]);},
  async deleteReset(userId){await q('DELETE FROM citrus_resets WHERE user_id=?',[userId]);},
  async createSession(hash,userId){const now=Date.now();await q('INSERT INTO citrus_sessions(token_hash,user_id,created_at,seen_at) VALUES(?,?,?,?)',[hash,userId,now,now]);},
  async sessionUser(hash){const now=Date.now(),u=row(await q('SELECT u.id,u.username,u.name,u.email,s.seen_at FROM citrus_sessions s JOIN citrus_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.seen_at>?',[hash,now-SESSION_DAYS*864e5]));if(!u)return null;if(now-Number(u.seen_at)>36e5)await q('UPDATE citrus_sessions SET seen_at=? WHERE token_hash=?',[now,hash]);return{id:u.id,username:u.username,name:u.name,email:u.email||null};},
  async deleteSession(hash){await q('DELETE FROM citrus_sessions WHERE token_hash=?',[hash]);},
  async usage(userId){const r=row(await q('SELECT coalesce(sum(size),0) AS bytes,count(*) AS count FROM citrus_records WHERE user_id=?',[userId]));return{bytes:Number(r.bytes),count:Number(r.count)};},
  async sizes(userId,list){const r=await q('SELECT store,id,size FROM citrus_records WHERE user_id=? AND (store,id) IN (VALUES '+list.map(()=>'(?,?)').join(',')+')',[userId,...list.flatMap(x=>[x.store,x.id])]),m=new Map(r.rows.map(x=>[x.store+'\u0000'+x.id,Number(x.size)]));return list.map(x=>m.get(x.store+'\u0000'+x.id)||0);},
  async push(userId,list){const results=await db.batch(list.map(x=>({sql:`INSERT INTO citrus_records(user_id,store,id,t,size,data,seq) VALUES(?,?,?,?,?,?,(SELECT coalesce(max(seq),0)+1 FROM citrus_records))
ON CONFLICT(user_id,store,id) DO UPDATE SET t=excluded.t,size=excluded.size,data=excluded.data,seq=excluded.seq WHERE citrus_records.t<excluded.t`,args:[userId,x.store,x.id,x.t,x.size,x.data]})),'write');return results.reduce((n,r)=>n+r.rowsAffected,0);},
  async head(userId,since){const r=row(await q('SELECT count(*) AS count,coalesce(max(seq),?) AS max FROM citrus_records WHERE user_id=? AND seq>?',[since,userId,since]));return{count:Number(r.count),max:Number(r.max)};},
  async pull(userId,since,limit){return(await q('SELECT store,id,t,seq,size,data FROM citrus_records WHERE user_id=? AND seq>? ORDER BY seq LIMIT ?',[userId,since,limit])).rows.map(r=>({store:r.store,id:r.id,t:Number(r.t),seq:Number(r.seq),size:Number(r.size),data:r.data}));},
  async deleteUser(userId){await db.batch([{sql:'DELETE FROM citrus_records WHERE user_id=?',args:[userId]},{sql:'DELETE FROM citrus_sessions WHERE user_id=?',args:[userId]},{sql:'DELETE FROM citrus_resets WHERE user_id=?',args:[userId]},{sql:'DELETE FROM citrus_users WHERE id=?',args:[userId]}],'write');}
 };
}

function chooseStore(){const turso=process.env.TURSO_DATABASE_URL;if(turso)try{return libsqlStore(turso,process.env.TURSO_AUTH_TOKEN)}catch(e){console.error('Accounts are off: the Turso driver did not load ('+e.message+'). Run npm install.');return null;}const url=process.env.DATABASE_URL;if(url)try{return postgresStore(url)}catch(e){console.error('Accounts are off: the Postgres driver did not load ('+e.message+'). Run npm install.');return null;}if(process.env.RENDER&&!process.env.ACCOUNTS_IN_MEMORY)return null;return memoryStore();}

// Password-reset email goes through Resend (RESEND_API_KEY, needs a verified domain) or Brevo (BREVO_API_KEY, a verified
// sender address is enough); EMAIL_FROM is the sender, e.g. "Citrus Poker <you@example.com>".
function chooseMailer(){
 const from=process.env.EMAIL_FROM||'',m=/^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from),sender={name:m?m[1]||'Citrus Poker':'Citrus Poker',email:m?m[2]:from.trim()};
 const send=async(url,headers,payload)=>{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});if(!res.ok)throw Error('Email provider answered '+res.status+': '+(await res.text()).slice(0,200));};
 if(process.env.RESEND_API_KEY&&sender.email)return(to,subject,text)=>send('https://api.resend.com/emails',{Authorization:'Bearer '+process.env.RESEND_API_KEY},{from:sender.name+' <'+sender.email+'>',to:[to],subject,text});
 if(process.env.BREVO_API_KEY&&sender.email)return(to,subject,text)=>send('https://api.brevo.com/v3/smtp/email',{'api-key':process.env.BREVO_API_KEY},{sender,to:[{email:to}],subject,textContent:text});
 return null;
}

function createAccounts({json,err,body,limit,store=chooseStore(),mail=chooseMailer()}){
 let ready=store?store.init().then(()=>true,e=>{console.error('Account database could not start:',e.message);ready=null;return false;}):null;
 async function db(){if(!store)throw err(503,'Accounts are not switched on for this server yet.');if(!ready)ready=store.init().then(()=>true,()=>{ready=null;return false;});if(!await ready)throw err(503,'The account database is not reachable right now. Your work stays saved on this device.');return store;}
 const cleanName=value=>String(value||'').replace(/[<>\u0000-\u001f]/g,'').trim();
 const publicUser=u=>({id:u.id,username:u.username,name:u.name,email:u.email||null});
 const cleanEmail=value=>String(value||'').trim().toLowerCase(),validEmail=e=>e.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);
 const findUser=(s,login)=>{const v=String(login||'').trim().toLowerCase();return v.includes('@')?s.userByEmail(v):s.userByName(v);};
 const RESET_MS=15*60*1000,resetHash=(userId,code)=>sha(userId+':'+code);
 async function signedIn(req){const m=/^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization||'');if(!m)throw err(401,'Sign in again.');const s=await db(),user=await s.sessionUser(sha(m[1]));if(!user)throw err(401,'Sign in again.');return{user,hash:sha(m[1])};}
 async function credentials(req){const data=await body(req),name=cleanName(data.username),username=name.toLowerCase(),password=typeof data.password==='string'?data.password:'';return{data,name,username,password};}
 async function startSession(s,user){const token=newToken();await s.createSession(sha(token),user.id);return{token,user:publicUser(user)};}
 function validRows(rows){
  if(!Array.isArray(rows)||rows.length>BATCH_MAX)throw err(400,'Send at most '+BATCH_MAX+' records at a time.');
  const out=new Map();for(const r of rows){
   if(!r||!STORES.has(r.store)||typeof r.id!=='string'||!/^[a-zA-Z0-9._:-]{1,200}$/.test(r.id)||!Number.isSafeInteger(r.t)||r.t<0)throw err(400,'A record is not in the expected format.');
   const data=JSON.stringify(r.data===undefined?null:r.data),size=Buffer.byteLength(data);if(size>ROW_MAX)throw err(413,'A record is larger than 256 KB.');
   const key=r.store+'\u0000'+r.id,old=out.get(key);if(!old||old.t<r.t)out.set(key,{store:r.store,id:r.id,t:r.t,size,data});
  }return[...out.values()];
 }
 return async function route(req,res,parts,url){
  const kind=parts[1],verb=parts[2];
  if(kind==='auth'&&req.method==='POST'&&(verb==='signup'||verb==='login')){
   limit(req,verb,verb==='signup'?10:30,15*60*1000);const s=await db(),{data,name,username,password}=await credentials(req);
   if(verb==='signup'){
    const email=cleanEmail(data.email);
    if(!/^[a-z0-9_.-]{3,24}$/.test(username))throw err(400,'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.');
    if(!validEmail(email))throw err(400,'Enter a valid email.');
    if(password.length<8||password.length>200)throw err(400,'Use a password of at least 8 characters.');
    const user={id:newId(),username,name,email,pass:await hashPassword(password)};if(!await s.createUser(user))throw err(409,await s.userByName(username)?'That username is taken.':'That email already has an account.');
    return json(res,201,await startSession(s,user));
   }
   // Sign in with the username or the email on the account.
   const user=username&&await findUser(s,username),ok=await checkPassword(password,user?user.pass:await DUMMY);if(!user||!ok)throw err(401,'Wrong username, email or password.');
   return json(res,200,await startSession(s,user));
  }
  // Forgotten password: a six-digit code goes to the account's email and is good for 15 minutes and five tries.
  if(kind==='auth'&&req.method==='POST'&&verb==='forgot'){
   limit(req,'forgot',8,15*60*1000);const s=await db(),data=await body(req);if(!mail)throw err(503,'Password reset by email is not set up on this server yet.');
   const user=await findUser(s,data.login);
   if(user?.email){const old=await s.getReset(user.id);if(!old||old.expires-RESET_MS<Date.now()-60000){const code=String(crypto.randomInt(0,1e6)).padStart(6,'0');await s.saveReset(user.id,resetHash(user.id,code),Date.now()+RESET_MS);
    try{await mail(user.email,'Your Citrus Poker code: '+code,'Hi '+(user.name||user.username)+',\n\nYour code to reset your Citrus Poker password is '+code+'. It works for 15 minutes.\n\nYour username is '+user.username+'.\n\nIf you did not ask for this, ignore this email; your password stays the same.');}
    catch(e){console.error('Reset email failed:',e.message);await s.deleteReset(user.id);throw err(502,'The email could not be sent. Try again in a few minutes.');}}}
   return json(res,200,{sent:true});
  }
  if(kind==='auth'&&req.method==='POST'&&verb==='reset'){
   limit(req,'reset',30,15*60*1000);const s=await db(),data=await body(req),user=await findUser(s,data.login),code=String(data.code||'').replace(/\D/g,''),password=typeof data.password==='string'?data.password:'';
   const r=user&&await s.getReset(user.id);if(!r||r.expires<Date.now()||r.tries>=5)throw err(400,'That code expired. Ask for a new one.');
   const want=Buffer.from(r.code_hash,'hex'),got=Buffer.from(resetHash(user.id,code),'hex');if(code.length!==6||!crypto.timingSafeEqual(want,got)){await s.bumpReset(user.id);throw err(400,'Wrong code.');}
   if(password.length<8||password.length>200)throw err(400,'Use a password of at least 8 characters.');
   await s.setPassword(user.id,await hashPassword(password));await s.deleteReset(user.id);return json(res,200,await startSession(s,user));
  }
  if(kind==='account'&&req.method==='POST'&&verb==='email'){
   limit(req,'login',30,15*60*1000);const {user}=await signedIn(req),s=await db(),data=await body(req),full=await s.userByName(user.username),email=cleanEmail(data.email);
   if(!full||!await checkPassword(typeof data.password==='string'?data.password:'',full.pass))throw err(401,'Wrong password.');
   if(!validEmail(email))throw err(400,'Enter a valid email.');if(!await s.setEmail(user.id,email))throw err(409,'That email already has an account.');
   return json(res,200,{user:publicUser({...user,email})});
  }
  if(kind==='auth'&&req.method==='POST'&&verb==='logout'){const {hash}=await signedIn(req);await (await db()).deleteSession(hash);return json(res,200,{ok:true});}
  if(kind==='auth'&&req.method==='GET'&&verb==='me'){const {user}=await signedIn(req),s=await db();return json(res,200,{user:publicUser(user),usage:{...await s.usage(user.id),quota:QUOTA}});}
  if(kind==='sync'&&req.method==='POST'&&!verb){
   limit(req,'sync',600,10*60*1000);const {user}=await signedIn(req),s=await db(),data=await body(req,4*1048576),rows=validRows(data.rows);
   if(rows.length){const usage=await s.usage(user.id),old=await s.sizes(user.id,rows),after=usage.bytes+rows.reduce((sum,r,i)=>sum+r.size-old[i],0);if(after>QUOTA&&after>usage.bytes)throw err(507,'Your account is full ('+Math.round(QUOTA/1048576)+' MB). New work stays saved on this device.');}
   const since=Number.isSafeInteger(data.since)&&data.since>=0?data.since:null,accepted=rows.length?await s.push(user.id,rows):0;
   // When everything newer than the device's cursor is this upload, the device can skip past it instead of pulling its own rows back.
   const head=since===null?null:await s.head(user.id,since);return json(res,200,{accepted,...head&&head.count===accepted?{cursor:head.max}:{}});
  }
  if(kind==='sync'&&req.method==='GET'&&!verb){
   limit(req,'sync',600,10*60*1000);const {user}=await signedIn(req),s=await db(),since=Math.max(0,Math.floor(Number(url.searchParams.get('since'))||0)),list=await s.pull(user.id,since,PAGE_ROWS+1);
   const rows=[];let bytes=0;for(const r of list.slice(0,PAGE_ROWS)){if(rows.length&&bytes+r.size>PAGE_BYTES)break;bytes+=r.size;rows.push({store:r.store,id:r.id,t:r.t,data:JSON.parse(r.data)});}
   const cursor=rows.length?list[rows.length-1].seq:since;return json(res,200,{rows,cursor,more:list.length>rows.length});
  }
  if(kind==='account'&&req.method==='POST'&&verb==='delete'){
   limit(req,'login',30,15*60*1000);const {user}=await signedIn(req),s=await db(),data=await body(req),full=await s.userByName(user.username);
   if(!full||!await checkPassword(typeof data.password==='string'?data.password:'',full.pass))throw err(401,'Wrong password.');
   await s.deleteUser(user.id);return json(res,200,{deleted:true});
  }
  return json(res,404,{error:'Not found.'});
 };
}
module.exports={createAccounts,memoryStore,postgresStore,libsqlStore};
