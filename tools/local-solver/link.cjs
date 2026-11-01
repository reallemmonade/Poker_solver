#!/usr/bin/env node
'use strict';
// Links a server with no browser (a rented Linux box) to your account, so it solves what the app sends it while it
// is idle: it signs in once and saves the session where the bridge looks for it (~/.citrus-poker-bridge.json).
//   node tools/local-solver/link.cjs [--api https://range-lab-live-rooms.onrender.com]
// then run the bridge with a name and its price, for example
//   node tools/local-solver/server.cjs --name hetzner --rate 0
// A rate of 0 says the box is paid for anyway, so the app offers it as free while it is idle.
const fs=require('fs'),os=require('os'),path=require('path'),readline=require('readline');
const FILE=process.env.CITRUS_BRIDGE_LINK||path.join(os.homedir(),'.citrus-poker-bridge.json');
const i=process.argv.indexOf('--api'),api=(i>0?process.argv[i+1]:'https://range-lab-live-rooms.onrender.com').replace(/\/$/,'');
const rl=readline.createInterface({input:process.stdin,output:process.stdout}),ask=q=>new Promise(r=>rl.question(q,r));
(async()=>{
 const username=(await ask('Username or email: ')).trim(),password=await ask('Password: ');rl.close();
 const r=await fetch(api+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})}),b=await r.json().catch(()=>({}));
 if(!r.ok||!b.token)throw Error(b.error||'Sign-in failed ('+r.status+').');
 fs.writeFileSync(FILE,JSON.stringify({api,token:b.token,user:b.user.id,cursor:0}),{mode:0o600});
 console.log('Linked to '+b.user.username+'. Start or restart the bridge with --name and --rate.');
})().catch(e=>{console.error(e.message);process.exit(1);});
