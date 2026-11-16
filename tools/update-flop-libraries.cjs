#!/usr/bin/env node
// Replaces or adds flop spots in studio/libraries without touching anything else (split-libraries.cjs
// rebuilds the whole folder). Each spot of each bundle (library.cjs bundle) is written as its own
// flops/<library>--<spot>.json.gz like split-libraries.cjs does; an existing manifest entry for the
// same file is updated in place (bytes, label, chart), a new one is appended. Bumps the version.
// Usage: node tools/update-flop-libraries.cjs <version> <postflop-library.json[.gz]>... [--only id,id] [--name "Library name"]
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const argv=process.argv.slice(2),opt=k=>{const i=argv.indexOf(k);if(i<0)return null;const v=argv[i+1];argv.splice(i,2);return v;};
const only=opt('--only'),rename=opt('--name'),[version,...inputs]=argv;
if(!version||!inputs.length)throw Error('Usage: node tools/update-flop-libraries.cjs <version> <library.json[.gz]>... [--only id,id] [--name "Library name"]');
const out=path.join(__dirname,'..','studio','libraries'),mfile=path.join(out,'manifest.json'),manifest=JSON.parse(fs.readFileSync(mfile,'utf8'));
const read=f=>JSON.parse((/\.gz$/.test(f)?zlib.gunzipSync(fs.readFileSync(f)):fs.readFileSync(f)).toString('utf8'));
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),keep=only?new Set(only.split(',').map(s=>s.trim()).filter(Boolean)):null;
const write=(file,value)=>{const data=zlib.gzipSync(JSON.stringify(value),{level:9});fs.mkdirSync(path.dirname(path.join(out,file)),{recursive:true});fs.writeFileSync(path.join(out,file),data);return data.length;};
let replaced=0,added=0;const seen=new Set();
for(const input of inputs){const lib=read(input);if(lib.format!=='range-lab-postflop-library-v1')throw Error(input+' is not a postflop library bundle');
 if(rename)lib.name=rename;const {spots,...head}=lib;
 for(const spot of spots){if(keep&&!keep.has(spot.id))continue;seen.add(spot.id);
  const file='flops/'+slug(lib.name)+'--'+slug(spot.id)+'.json.gz',entry={file,library:lib.name,id:spot.id,label:spot.label||spot.id,chart:spot.chart,bytes:write(file,{...head,spots:[spot]})};
  const i=manifest.flops.findIndex(f=>f.file===file);if(i>=0){manifest.flops[i]=entry;replaced++;}else{manifest.flops.push(entry);added++;}}}
if(keep)for(const id of keep)if(!seen.has(id))throw Error('spot '+id+' is not in the bundle');
manifest.version=version;fs.writeFileSync(mfile,JSON.stringify(manifest)+'\n');
console.log(replaced+' flop spots replaced, '+added+' added; '+manifest.flops.length+' flop spots in studio/libraries ('+version+').');
