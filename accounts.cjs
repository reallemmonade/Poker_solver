'use strict';
// Player accounts and synced personal data. Each account's records (hands, assessments, saved spots, drill
// progress, settings) are rows keyed by store and id; the newest write by its client timestamp wins, and every
// accepted write gets a fresh sequence number so devices pull only what changed since their last sync.
// DATABASE_URL picks Postgres (Neon or Render); without it the service keeps accounts in memory for local use.
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
 const users=new Map(),sessions=new Map(),records=new Map();let seq=0;
 const rows=id=>{if(!records.has(id))records.set(id,new Map());return records.get(id);};
 return{kind:'memory',
  async init(){},
  async createUser(u){if([...users.values()].some(x=>x.username===u.username))return false;users.set(u.id,{...u,createdAt:new Date().toISOString()});return true;},
  async userByName(username){return[...users.values()].find(u=>u.username===username)||null;},
  async createSession(hash,userId){sessions.set(hash,{userId,seenAt:Date.now()});},
  async sessionUser(hash){const s=sessions.get(hash);if(!s)return null;if(Date.now()-s.seenAt>SESSION_DAYS*864e5){sessions.delete(hash);return null;}s.seenAt=Date.now();return users.get(s.userId)||null;},
  async deleteSession(hash){sessions.delete(hash);},
  async usage(userId){let bytes=0,count=0;for(const r of rows(userId).values()){bytes+=r.size;count++;}return{bytes,count};},
  async sizes(userId,list){const m=rows(userId);return list.map(r=>m.get(r.store+'\u0000'+r.id)?.size||0);},
  async push(userId,list){const m=rows(userId);let accepted=0;for(const r of list){const key=r.store+'\u0000'+r.id,old=m.get(key);if(old&&old.t>=r.t)continue;m.set(key,{...r,seq:++seq});accepted++;}return accepted;},
  async pull(userId,since,limit){return[...rows(userId).values()].filter(r=>r.seq>since).sort((a,b)=>a.seq-b.seq).slice(0,limit);},
  async deleteUser(userId){users.delete(userId);records.delete(userId);for(const [k,s]of sessions)if(s.userId===userId)sessions.delete(k);}
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
CREATE INDEX IF NOT EXISTS citrus_records_user_seq ON citrus_records(user_id,seq);`);},
  async createUser(u){const r=await q('INSERT INTO citrus_users(id,username,name,pass) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING',[u.id,u.username,u.name,u.pass]);return r.rowCount===1;},
  async userByName(username){return(await q('SELECT id,username,name,pass FROM citrus_users WHERE username=$1',[username])).rows[0]||null;},
  async createSession(hash,userId){await q('INSERT INTO citrus_sessions(token_hash,user_id) VALUES($1,$2)',[hash,userId]);},
  async sessionUser(hash){const r=await q(`UPDATE citrus_sessions s SET seen_at=now() FROM citrus_users u WHERE s.token_hash=$1 AND u.id=s.user_id AND s.seen_at>now()-interval '${SESSION_DAYS} days' RETURNING u.id,u.username,u.name`,[hash]);return r.rows[0]||null;},
  async deleteSession(hash){await q('DELETE FROM citrus_sessions WHERE token_hash=$1',[hash]);},
  async usage(userId){const r=(await q('SELECT coalesce(sum(size),0)::bigint AS bytes,count(*)::int AS count FROM citrus_records WHERE user_id=$1',[userId])).rows[0];return{bytes:Number(r.bytes),count:r.count};},
  async sizes(userId,list){const r=await q('SELECT store,id,size FROM citrus_records WHERE user_id=$1 AND (store,id) IN (SELECT * FROM unnest($2::text[],$3::text[]))',[userId,list.map(x=>x.store),list.map(x=>x.id)]),m=new Map(r.rows.map(x=>[x.store+'\u0000'+x.id,x.size]));return list.map(x=>m.get(x.store+'\u0000'+x.id)||0);},
  async push(userId,list){const r=await q(`INSERT INTO citrus_records(user_id,store,id,t,size,data) SELECT $1,* FROM unnest($2::text[],$3::text[],$4::bigint[],$5::int[],$6::text[])
ON CONFLICT(user_id,store,id) DO UPDATE SET t=excluded.t,size=excluded.size,data=excluded.data,seq=nextval('citrus_record_seq') WHERE citrus_records.t<excluded.t`,[userId,list.map(x=>x.store),list.map(x=>x.id),list.map(x=>x.t),list.map(x=>x.size),list.map(x=>x.data)]);return r.rowCount;},
  async pull(userId,since,limit){return(await q('SELECT store,id,t,seq,size,data FROM citrus_records WHERE user_id=$1 AND seq>$2 ORDER BY seq LIMIT $3',[userId,since,limit])).rows.map(r=>({...r,t:Number(r.t),seq:Number(r.seq)}));},
  async deleteUser(userId){await q('DELETE FROM citrus_users WHERE id=$1',[userId]);}
 };
}

function chooseStore(){const url=process.env.DATABASE_URL;if(url)try{return postgresStore(url)}catch(e){console.error('Accounts are off: the Postgres driver did not load ('+e.message+'). Run npm install.');return null;}if(process.env.RENDER&&!process.env.ACCOUNTS_IN_MEMORY)return null;return memoryStore();}

function createAccounts({json,err,body,limit,store=chooseStore()}){
 let ready=store?store.init().then(()=>true,e=>{console.error('Account database could not start:',e.message);ready=null;return false;}):null;
 async function db(){if(!store)throw err(503,'Accounts are not switched on for this server yet.');if(!ready)ready=store.init().then(()=>true,()=>{ready=null;return false;});if(!await ready)throw err(503,'The account database is not reachable right now. Your work stays saved on this device.');return store;}
 const cleanName=value=>String(value||'').replace(/[<>\u0000-\u001f]/g,'').trim();
 const publicUser=u=>({id:u.id,username:u.username,name:u.name});
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
   limit(req,verb,verb==='signup'?10:30,15*60*1000);const s=await db(),{name,username,password}=await credentials(req);
   if(verb==='signup'){
    if(!/^[a-z0-9_.-]{3,24}$/.test(username))throw err(400,'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.');
    if(password.length<8||password.length>200)throw err(400,'Use a password of at least 8 characters.');
    const user={id:newId(),username,name,pass:await hashPassword(password)};if(!await s.createUser(user))throw err(409,'That username is taken.');
    return json(res,201,await startSession(s,user));
   }
   const user=username&&await s.userByName(username),ok=await checkPassword(password,user?user.pass:await DUMMY);if(!user||!ok)throw err(401,'Wrong username or password.');
   return json(res,200,await startSession(s,user));
  }
  if(kind==='auth'&&req.method==='POST'&&verb==='logout'){const {hash}=await signedIn(req);await (await db()).deleteSession(hash);return json(res,200,{ok:true});}
  if(kind==='auth'&&req.method==='GET'&&verb==='me'){const {user}=await signedIn(req),s=await db();return json(res,200,{user:publicUser(user),usage:{...await s.usage(user.id),quota:QUOTA}});}
  if(kind==='sync'&&req.method==='POST'&&!verb){
   limit(req,'sync',600,10*60*1000);const {user}=await signedIn(req),s=await db(),data=await body(req,4*1048576),rows=validRows(data.rows);
   if(rows.length){const usage=await s.usage(user.id),old=await s.sizes(user.id,rows),after=usage.bytes+rows.reduce((sum,r,i)=>sum+r.size-old[i],0);if(after>QUOTA&&after>usage.bytes)throw err(507,'Your account is full ('+Math.round(QUOTA/1048576)+' MB). New work stays saved on this device.');}
   return json(res,200,{accepted:rows.length?await s.push(user.id,rows):0});
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
module.exports={createAccounts,memoryStore,postgresStore};
