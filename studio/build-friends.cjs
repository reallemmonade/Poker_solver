'use strict';
const fs=require('node:fs'),path=require('node:path'),studio=__dirname,out=path.join(studio,'render-site'),api=(process.env.MULTIPLAYER_API_ORIGIN||'').replace(/\/$/,'');
fs.mkdirSync(out,{recursive:true});
for(const file of ['friends.html','action-bar.js','action-bar.css'])fs.copyFileSync(path.join(studio,file),path.join(out,file));
fs.writeFileSync(path.join(out,'friends.js'),fs.readFileSync(path.join(studio,'friends.js'),'utf8').replace('__MULTIPLAYER_API_ORIGIN__',api));
const main=path.join(out,'index.html');
if(!fs.existsSync(main))throw Error('Build the main web app before adding the friends page.');
let html=fs.readFileSync(main,'utf8');
const marker='<a class="small" href="river-cfr-solver.html">';
if(!html.includes('href="/friends.html"')){const at=html.indexOf(marker);if(at<0)throw Error('Could not find the main app header link location.');html=html.slice(0,at)+'<a class="small" href="/friends.html">Play with friends</a> '+html.slice(at);fs.writeFileSync(main,html);}
console.log(JSON.stringify({friendsPage:path.join(out,'friends.html'),apiOrigin:api||'same origin for local use'}));
