'use strict';
// Checks the account and sync API: sign up, sign in, push and pull records, newest-write-wins, quota and size limits,
// sign out and account deletion. Runs on the in-memory store, or on Postgres when DATABASE_URL is set.
const http=require('node:http'),assert=require('node:assert/strict');
process.env.ALLOWED_ORIGINS='http://allowed.test';process.env.ACCOUNT_QUOTA_MB='1';process.env.RESEND_API_KEY='test-key';process.env.EMAIL_FROM='Citrus Poker <codes@citrus.test>';
// Reset emails are captured here instead of going to Resend.
const sent=[],realFetch=fetch;globalThis.fetch=async(url,opts)=>{if(String(url).startsWith('https://api.resend.com/')){sent.push({auth:opts.headers.Authorization,...JSON.parse(opts.body)});return new Response('{}',{status:200});}return realFetch(url,opts);};
const {handle}=require('../server.cjs');
async function main(){
 const server=http.createServer(handle);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const call=async(method,path,{token,data,origin}={})=>{const res=await fetch(base+path,{method,headers:{...data!==undefined?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{},...origin?{Origin:origin}:{}},body:data!==undefined?JSON.stringify(data):undefined});const text=await res.text();return{status:res.status,body:text?JSON.parse(text):null,headers:res.headers};};
 const name='Tester'+Date.now().toString(36).slice(-6),password='correct horse';let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
 const pre=await fetch(base+'/api/sync',{method:'OPTIONS',headers:{Origin:'http://allowed.test','Access-Control-Request-Headers':'authorization'}});ok(pre.status===204&&/Authorization/.test(pre.headers.get('access-control-allow-headers')),'preflight allows the Authorization header');
 const email=name.toLowerCase()+'@mail.test';
 const other1=await fetch(base+'/api/auth/login',{method:'OPTIONS',headers:{Origin:'https://phone.example','Access-Control-Request-Headers':'content-type'}});ok(other1.status===204&&other1.headers.get('access-control-allow-origin')==='https://phone.example','account calls work from any site (token auth, no cookies)');
 ok((await call('POST','/api/rooms',{origin:'https://phone.example',data:{}})).status===403,'rooms stay limited to the allowed sites');
 ok((await call('POST','/api/auth/signup',{data:{username:'ab',email,password}})).status===400,'short usernames are refused');
 ok((await call('POST','/api/auth/signup',{data:{username:name,password}})).status===400&&(await call('POST','/api/auth/signup',{data:{username:name,email:'not-an-email',password}})).status===400,'an email is required');
 ok((await call('POST','/api/auth/signup',{data:{username:name,email,password:'short'}})).status===400,'short passwords are refused');
 const signup=await call('POST','/api/auth/signup',{data:{username:name,email:email.toUpperCase(),password}});ok(signup.body?.user?.email===email,'the email is stored with the username');ok(signup.status===201&&signup.body.token&&signup.body.user.username===name.toLowerCase()&&signup.body.user.name===name,'sign up returns a session');
 ok((await call('POST','/api/auth/signup',{data:{username:name.toUpperCase(),email:'x'+email,password}})).status===409,'usernames are unique regardless of case');
 ok((await call('POST','/api/auth/signup',{data:{username:'x'+name,email,password}})).body.error==='That email already has an account.','one account per email');
 ok((await call('POST','/api/auth/login',{data:{username:email,password}})).status===200,'sign in with the email works');
 ok((await call('POST','/api/auth/login',{data:{username:name,password:'wrong password'}})).status===401,'a wrong password is refused');
 ok((await call('POST','/api/auth/login',{data:{username:'nobody-'+name,password}})).status===401,'an unknown user is refused');
 const login=await call('POST','/api/auth/login',{data:{username:name.toLowerCase(),password}}),phone=signup.body.token,mac=login.body.token;ok(login.status===200&&mac&&mac!==phone,'sign in gives a second device its own session');
 ok((await call('GET','/api/sync')).status===401&&(await call('GET','/api/sync',{token:'x'.repeat(30)})).status===401,'sync needs a valid session');
 const me=await call('GET','/api/auth/me',{token:mac});ok(me.status===200&&me.body.user.name===name&&me.body.usage.count===0,'me reports the account and empty usage');
 // Phone writes two hands and a setting; the Mac pulls them.
 const hand={id:'h1',record:{format:'range-lab-hand-v1',n:1}},push=await call('POST','/api/sync',{token:phone,data:{rows:[{store:'hands',id:'h1',t:1000,data:hand},{store:'hands',id:'h2',t:1000,data:{id:'h2'}},{store:'prefs',id:'range-lab-theme',t:1000,data:'dark'}]}});ok(push.status===200&&push.body.accepted===3,'push accepts new records');
 let pull=await call('GET','/api/sync?since=0',{token:mac});ok(pull.body.rows.length===3&&pull.body.rows[0].data.record.n===1&&!pull.body.more,'another device pulls every record');const cursor=pull.body.cursor;
 ok((await call('GET','/api/sync?since='+cursor,{token:mac})).body.rows.length===0,'nothing new after the cursor');
 // An older write loses; a newer one wins and moves past the cursor.
 ok((await call('POST','/api/sync',{token:mac,data:{rows:[{store:'hands',id:'h1',t:900,data:{id:'h1',old:true}}]}})).body.accepted===0,'an older write does not replace a newer one');
 ok((await call('POST','/api/sync',{token:mac,data:{rows:[{store:'hands',id:'h1',t:2000,data:{id:'h1',v:2}},{store:'hands',id:'h1',t:1500,data:{id:'h1',v:1.5}}]}})).body.accepted===1,'duplicate ids in one batch keep the newest');
 pull=await call('GET','/api/sync?since='+cursor,{token:phone});ok(pull.body.rows.length===1&&pull.body.rows[0].data.v===2&&pull.body.rows[0].t===2000,'the newer write reaches the first device');
 // Bad input.
 ok((await call('POST','/api/sync',{token:phone,data:{rows:[{store:'models',id:'m1',t:1,data:{}}]}})).status===400,'model checkpoints are not stored on the server');
 ok((await call('POST','/api/sync',{token:phone,data:{rows:[{store:'hands',id:'bad id!',t:1,data:{}}]}})).status===400,'invalid ids are refused');
 ok((await call('POST','/api/sync',{token:phone,data:{rows:[{store:'solves',id:'big',t:1,data:'x'.repeat(300000)}]}})).status===413,'records over 256 KB are refused');
 // Paging: many records come back over several pages.
 for(let k=0;k<4;k++){const rows=Array.from({length:150},(_,i)=>({store:'grades',id:'g'+k+'-'+i,t:5000,data:{id:'g'+k+'-'+i,pad:'y'.repeat(200)}}));ok((await call('POST','/api/sync',{token:phone,data:{rows}})).body.accepted===150,'a full batch is accepted');}
 let since=0,total=0,pages=0;for(;;){const page=(await call('GET','/api/sync?since='+since,{token:mac})).body;total+=page.rows.length;pages++;since=page.cursor;if(!page.more)break;}ok(total===603&&pages===3,'pull pages through every record ('+total+' in '+pages+' pages)');
 // An upload that is the only thing past the device's cursor moves the cursor past it, so the device does not pull its own rows back; otherwise it does not.
 const own=(await call('POST','/api/sync',{token:mac,data:{since,rows:[{store:'hands',id:'h3',t:6000,data:{id:'h3'}}]}})).body;ok(own.accepted===1&&own.cursor>since&&(await call('GET','/api/sync?since='+own.cursor,{token:mac})).body.rows.length===0,'an upload returns a cursor past its own rows');
 ok(!('cursor' in (await call('POST','/api/sync',{token:phone,data:{since,rows:[{store:'hands',id:'h4',t:6000,data:{id:'h4'}}]}})).body),'no cursor when another device wrote since');
 // Quota: the account holds 1 MB in this check; a batch that would go over it is refused, and nothing in it is stored.
 const big=k=>({store:'solves',id:'big'+k,t:1,data:'z'.repeat(250000)});ok((await call('POST','/api/sync',{token:phone,data:{rows:[big(1),big(2),big(3)]}})).body.accepted===3,'large records fit under the quota');
 const full=await call('POST','/api/sync',{token:phone,data:{rows:[big(4),big(5)]}});ok(full.status===507&&(await call('GET','/api/auth/me',{token:phone})).body.usage.count===608,'a batch over the quota is refused whole');
 ok((await call('POST','/api/sync',{token:phone,data:{rows:[{...big(1),t:2,data:'small'}]}})).body.accepted===1,'shrinking a record still works when nearly full');
 // Other accounts never see this account's data.
 const other=(await call('POST','/api/auth/signup',{data:{username:'other'+name,email:'other'+email,password}})).body.token;ok((await call('GET','/api/sync?since=0',{token:other})).body.rows.length===0,'accounts are isolated');
 // Sign out ends only that session; deleting the account removes everything.
 ok((await call('POST','/api/auth/logout',{token:phone})).status===200&&(await call('GET','/api/auth/me',{token:phone})).status===401&&(await call('GET','/api/auth/me',{token:mac})).status===200,'sign out ends one device only');
 // Forgot password: a code is emailed, wrong codes count, the right one sets a new password and signs other devices out.
 ok((await call('POST','/api/auth/forgot',{data:{login:'nobody-'+name}})).status===200&&sent.length===0,'an unknown login sends nothing but answers the same');
 ok((await call('POST','/api/auth/forgot',{data:{login:name}})).status===200&&sent.length===1&&sent[0].to[0]===email&&sent[0].auth==='Bearer test-key'&&/username is /.test(sent[0].text),'the code goes to the email on the account');
 const code=/\b(\d{6})\b/.exec(sent[0].subject)[1];await call('POST','/api/auth/forgot',{data:{login:email}});ok(sent.length===1,'asking again within a minute does not send another email');
 ok((await call('POST','/api/auth/reset',{data:{login:name,code:code==='000000'?'111111':'000000',password:'new password 1'}})).body.error==='Wrong code.','a wrong code is refused');
 const reset=await call('POST','/api/auth/reset',{data:{login:email,code,password:'new password 1'}});ok(reset.status===200&&reset.body.token,'the right code sets a new password and signs in');
 ok((await call('GET','/api/auth/me',{token:mac})).status===401&&(await call('POST','/api/auth/login',{data:{username:name,password}})).status===401,'old sessions and the old password stop working');
 ok((await call('POST','/api/auth/reset',{data:{login:name,code,password:'again pass 2'}})).status===400,'a code works once');
 const fresh=(await call('POST','/api/auth/login',{data:{username:name,password:'new password 1'}})).body.token;
 ok((await call('POST','/api/account/email',{token:fresh,data:{email:'new'+email,password:'wrong one!'}})).status===401&&(await call('POST','/api/account/email',{token:fresh,data:{email:'new'+email,password:'new password 1'}})).body.user.email==='new'+email,'changing the email needs the password');
 ok((await call('GET','/api/auth/me',{token:fresh})).body.user.email==='new'+email,'me reports the email');
 ok((await call('POST','/api/account/delete',{token:fresh,data:{password:'nope nope'}})).status===401,'deleting needs the password');
 ok((await call('POST','/api/account/delete',{token:fresh,data:{password:'new password 1'}})).status===200&&(await call('GET','/api/auth/me',{token:fresh})).status===401&&(await call('POST','/api/auth/login',{data:{username:name,password:'new password 1'}})).status===401,'deleting the account removes it');
 await call('POST','/api/account/delete',{token:other,data:{password}});
 server.close();console.log(JSON.stringify({ok:true,checks,store:process.env.TURSO_DATABASE_URL?'turso':process.env.DATABASE_URL?'postgres':'memory'}));process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
