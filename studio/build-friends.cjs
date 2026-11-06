'use strict';
// Friend games are part of the main app now; friends.html only forwards old invite links (friends.html?room=CODE) to it.
const fs=require('node:fs'),path=require('node:path'),studio=__dirname,out=path.join(studio,'render-site');
if(!fs.existsSync(path.join(out,'index.html')))throw Error('Build the main web app before adding the friends page.');
fs.copyFileSync(path.join(studio,'friends.html'),path.join(out,'friends.html'));
console.log(JSON.stringify({friendsPage:path.join(out,'friends.html')}));
