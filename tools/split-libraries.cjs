#!/usr/bin/env node
// Splits chart and flop library files into one file per chart pack and per flop spot, in
// studio/libraries, and writes its manifest.json. Desktops load every file; phones and tablets
// download single files from the Library page (the whole set crashes a phone tab).
// Usage: node tools/split-libraries.cjs <version> <library.json[.gz]>...
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const [version,...inputs]=process.argv.slice(2);if(!version||!inputs.length)throw Error('Usage: node tools/split-libraries.cjs <version> <library.json[.gz]>...');
const out=path.join(__dirname,'..','studio','libraries'),read=f=>JSON.parse((/\.gz$/.test(f)?zlib.gunzipSync(fs.readFileSync(f)):fs.readFileSync(f)).toString('utf8'));
for(const dir of ['packs','flops']){fs.rmSync(path.join(out,dir),{recursive:true,force:true});fs.mkdirSync(path.join(out,dir),{recursive:true});}
const write=(file,value)=>{const data=zlib.gzipSync(JSON.stringify(value),{level:9});fs.writeFileSync(path.join(out,file),data);return data.length;},slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const manifest={version,packs:[],flops:[]};
for(const input of inputs){const lib=read(input);
 if(lib.format==='range-lab-postflop-library-v1'){const {spots,...head}=lib;for(const spot of spots){const file='flops/'+slug(lib.name)+'--'+slug(spot.id)+'.json.gz';manifest.flops.push({file,library:lib.name,id:spot.id,label:spot.label||spot.id,chart:spot.chart,bytes:write(file,{...head,spots:[spot]})});}continue;}
 for(const pack of lib.format==='range-lab-preflop-bundle-v1'?lib.packs:[lib]){const c=pack.config,file='packs/'+slug(pack.name)+'.json.gz';manifest.packs.push({file,name:pack.name,variant:c.variant,mode:c.mode,seats:c.seats,stack:Math.max(...c.stacks),bytes:write(file,pack)});}}
for(const f of fs.readdirSync(out))if(/\.json\.gz$/.test(f))fs.rmSync(path.join(out,f));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest)+'\n');
console.log(manifest.packs.length+' chart packs and '+manifest.flops.length+' flop spots in studio/libraries ('+version+').');
