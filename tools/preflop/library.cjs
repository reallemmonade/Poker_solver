'use strict';
// Builds the whole NLH and PLO preflop chart library and bundles it into one file.
//   node tools/preflop/library.cjs --out dir [--jobs 4] [--iterations 2000] [--every 500] [--games nlh,plo]
// With --rake pct [--rakeCap bb] it builds raked cash charts only (tables with that rake and
// cap use them; other raked tables fall back to the rake-free charts), at --depths (default 50,100,150,200); otherwise 10-1000bb, plus 4-15bb heads-up NLH.
// Each chart keeps its averaged strategy from the checkpoint (every --every iterations) with the
// lowest NashConv, since multiway CFR+ need not settle.
// PLO needs plo-model.json (see plo-model.cjs).
// Each chart is solved in its own process; finished charts are kept, so a rerun
// only solves what is missing.
// --calibration file (tools/preflop/calibrate.cjs, one fit or a set by depth) applies to the NLH
// charts. --seats 2,6 and --formats cash limit the charts built; --base bundle.json.gz carries
// every other chart of that bundle over unchanged (matched by name up to " (").
const fs=require('fs'),path=require('path'),os=require('os'),{execFile}=require('child_process'),P=require('../../studio/preflop.js');

const args={out:'preflop-library',jobs:Math.max(1,os.cpus().length),iterations:2000,every:500,games:'nlh,plo',rake:0,rakeCap:3,limp:0,depths:'',seats:'',formats:'',calibration:'',base:''};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=['out','games','depths','seats','formats','calibration','base'].includes(k)?v:Number(v);}
const raked=args.rake>0,SEATS=args.seats?args.seats.split(',').map(Number):[2,3,4,5,6,7,8,9],DEPTHS=args.depths?args.depths.split(',').map(Number):raked?[50,100,150,200]:[10,20,50,100,150,200,500,1000],FORMATS=args.formats?args.formats.split(','):raked?['cash']:['cash','mtt'],tag=raked?`-rake${args.rake}-cap${args.rakeCap}`:'';
fs.mkdirSync(args.out,{recursive:true});

// Heads-up NLH also gets 4, 6, 8, 12 and 15bb charts: below 20bb the right play shifts fast with depth
// (an 8bb spot read off the 10bb chart limps hands that jam at 8bb), and these charts take seconds.
const HU_SHORT=!args.depths&&!raked?[4,6,8,12,15]:[];
const specs=[];for(const game of args.games.split(','))for(const seats of SEATS.slice().reverse())for(const format of FORMATS)for(const stack of [...game==='nlh'&&seats===2?HU_SHORT:[],...DEPTHS].sort((a,b)=>a-b))specs.push({game,seats,stack,format});
const file=s=>path.join(args.out,`${s.game}-${s.format}-${s.seats}max-${s.stack}bb${tag}.json`);
const queue=specs.filter(s=>!fs.existsSync(file(s)));
console.log(`${specs.length} charts, ${queue.length} to solve, ${args.jobs} at a time.`);

let running=0;const report=[];
function next(){
 if(!queue.length){if(!running)finish();return;}
 const s=queue.shift();running++;const t=Date.now();
 execFile(process.execPath,[path.join(__dirname,'export.cjs'),'--game',s.game,'--seats',String(s.seats),'--stack',String(s.stack),'--format',s.format,...raked?['--rake',String(args.rake),'--rakeCap',String(args.rakeCap)]:[],...args.limp?['--limp','1']:[],...args.calibration&&s.game==='nlh'?['--calibration',args.calibration]:[],'--iterations',String(args.iterations),'--every',String(Math.min(args.every,args.iterations)),'--out',file(s)],{maxBuffer:1e7},(error,stdout)=>{
  running--;const line=stdout.trim().split('\n').slice(-2).join(' | ');
  console.log(`${path.basename(file(s))} ${((Date.now()-t)/60000).toFixed(1)} min ${error?'FAILED '+error.message:line}`);
  next();
 });
}
for(let i=0;i<args.jobs;i++)next();

// Bundled rows are compact: one row per class (NLH class or PLO group order), either the
// index of a pure action or per-mille frequencies, the largest absorbing the rounding.
function compact(pack){
 const labels=pack.handGroups?pack.handGroups.labels:P.classes;
 for(const node of pack.nodes)node.strategy=labels.map(c=>{const r=node.strategy[c].map(x=>Math.round(x*1000)),big=r.indexOf(Math.max(...r));r[big]+=1000-r.reduce((a,b)=>a+b,0);const pure=r.indexOf(1000);return pure>=0?pure:r;});
 P.validate(pack);return pack;
}
function finish(){
 const packs=specs.filter(s=>fs.existsSync(file(s))).map(s=>compact(JSON.parse(fs.readFileSync(file(s),'utf8'))));
 if(args.base){const raw=fs.readFileSync(args.base),base=JSON.parse(/\.gz$/.test(args.base)?require('zlib').gunzipSync(raw):raw),key=p=>p.name.split(' (')[0],built=new Set(packs.map(key));
  const kept=base.packs.filter(p=>!built.has(key(p)));kept.forEach(p=>P.validate(p));packs.push(...kept);console.log(`Kept ${kept.length} charts from ${args.base}.`);}
 const bundle={format:'range-lab-preflop-bundle-v1',name:'Citrus Poker preflop library'+(raked?` (rake ${args.rake}% cap ${args.rakeCap}bb)`:''),createdAt:new Date().toISOString(),packs};
 const out=path.join(args.out,'preflop-library.json');fs.writeFileSync(out,JSON.stringify(bundle));
 // The app also imports the gzipped copy, which is far smaller to move around.
 fs.writeFileSync(out+'.gz',require('zlib').gzipSync(fs.readFileSync(out),{level:9}));
 console.log(`Bundled ${packs.length} charts into ${out} (${(fs.statSync(out).size/1e6).toFixed(1)} MB, ${(fs.statSync(out+'.gz').size/1e6).toFixed(1)} MB gzipped).`);
}
