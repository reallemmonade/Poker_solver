'use strict';
// Builds the PLO4 hand model used by the preflop solver: hand groups, group-vs-group
// compatibility (exact) and all-in equity (sampled), plus each group's playability.
//   g++ -O3 -march=native -pthread -o plo-equity tools/preflop/plo-equity.cpp
//   node tools/preflop/plo-model.cjs --bin ./plo-equity [--threads 4] [--groups 128]
// Writes tools/preflop/plo-model.json.
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const P=require('../../studio/preflop.js');

const args={bin:'./plo-equity',threads:os.cpus().length,groups:128,classSamples:4000,pairSamples:3000,bandWidth:.05,work:os.tmpdir()};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,''),v=process.argv[i+1];args[k]=['bin','work'].includes(k)?v:Number(v);}
const run=(...a)=>execFileSync(path.resolve(args.bin),a.map(String),{maxBuffer:1<<30,encoding:'utf8'});
const H=P.ploClasses(),n=H.keys.length,ranks='23456789TJQKA';

// Shape of a hand: suits, pairing, connectedness and whether the ace is suited.
function shape(cs){
 const r=cs.map(c=>c>>2),s=cs.map(c=>c&3),bySuit=[0,1,2,3].map(x=>s.filter(y=>y===x).length).sort((a,b)=>b-a);
 const suits=bySuit[0]>=3?'3+ suited':bySuit[1]===2?'double-suited':bySuit[0]===2?'single-suited':'rainbow';
 const counts={};for(const x of r)counts[x]=(counts[x]||0)+1;const c=Object.values(counts).sort((a,b)=>b-a);
 const pairs=c[0]>=3?'trips':c[0]===2&&c[1]===2?'two pair':c[0]===2?'one pair':'no pair';
 // Most distinct ranks inside any five-rank window; the ace also plays low.
 const distinct=new Set(r.flatMap(x=>x===12?[12,-1]:[x]));let conn=0;
 for(let lo=-1;lo<=8;lo++){let k=0;for(let x=lo;x<lo+5;x++)if(distinct.has(x))k++;conn=Math.max(conn,k);}
 const connect=conn>=4?'connected':conn===3?'semi-connected':'disconnected';
 const aceSuited=cs.some((x,i)=>r[i]===12&&cs.some((y,j)=>j!==i&&s[j]===s[i]));
 return{suits,pairs,connect,aceSuited,high:Math.max(...r)};
}

// Postflop playability multipliers on equity realization (see README).
const PLAY={'double-suited':.10,'single-suited':.04,rainbow:-.06,'3+ suited':-.08,aceSuited:.04,connected:.06,'semi-connected':.02,disconnected:-.04,'two pair':.02,trips:-.12,lowOnly:-.03};
function playability(f){
 let x=(1+PLAY[f.suits])*(1+PLAY[f.connect]);
 if(f.aceSuited)x*=1+PLAY.aceSuited;if(f.pairs==='two pair')x*=1+PLAY['two pair'];if(f.pairs==='trips')x*=1+PLAY.trips;
 if(f.high<=5)x*=1+PLAY.lowOnly;
 return x;
}

console.log(`${n} PLO classes. Sampling equity vs a random hand (${args.classSamples} runouts each)...`);
const reps=path.join(args.work,'plo-reps.txt');fs.writeFileSync(reps,H.reps.map(r=>r.join(' ')).join('\n')+'\n');
// Cached in the work folder, since the sampler is seeded and the result never changes.
const cache=path.join(args.work,`plo-vs-random-${args.classSamples}.txt`);
if(!fs.existsSync(cache))fs.writeFileSync(cache,run('classes',reps,args.classSamples,args.threads));
const vsRandom=fs.readFileSync(cache,'utf8').trim().split('\n').map(Number);

// Groups: shape first, then equity bands within each shape, sized by combos.
const features=H.reps.map(shape),shapes=new Map();
H.keys.forEach((k,i)=>{const f=features[i],id=[f.suits,f.pairs,f.connect,f.aceSuited?'suited ace':''].filter(Boolean).join(', ');if(!shapes.has(id))shapes.set(id,[]);shapes.get(id).push(i);});
const total=H.counts.reduce((a,b)=>a+b,0),groupOf=new Int32Array(n),labels=[],members=[];
for(const [id,list] of [...shapes].sort()){
 list.sort((a,b)=>vsRandom[a]-vsRandom[b]);
 const combos=list.reduce((s,i)=>s+H.counts[i],0),spread=vsRandom[list[list.length-1]]-vsRandom[list[0]];
 // Bands follow the shape's share of combos, and no band spans much more than 5 points of equity.
 const bands=Math.max(1,Math.min(list.length,Math.max(Math.round(args.groups*combos/total),Math.ceil(spread/args.bandWidth))));
 let done=0,band=0,start=labels.length;
 for(let b=0;b<bands;b++)labels.push(null),members.push([]);
 for(const i of list){
  const g=start+Math.min(bands-1,Math.floor(bands*(done+H.counts[i]/2)/combos));groupOf[i]=g;members[g].push(i);done+=H.counts[i];
 }
 for(let b=0;b<bands;b++){const m=members[start+b];if(!m.length)continue;const lo=vsRandom[m[0]],hi=vsRandom[m[m.length-1]];
  labels[start+b]=`${id}${bands>1?`, band ${b+1} of ${bands} (${(100*lo).toFixed(1)}-${(100*hi).toFixed(1)}% vs random)`:''}`;}
}
// Drop empty bands and renumber.
const keep=labels.map((l,g)=>l?g:-1).filter(g=>g>=0),renumber=new Map(keep.map((g,i)=>[g,i]));
const groups=keep.map(g=>({label:labels[g],classes:members[g]}));for(let i=0;i<n;i++)groupOf[i]=renumber.get(groupOf[i]);
const K=groups.length;console.log(`${K} hand groups.`);

// Group of every combo in colex order, for the sampler.
const bin=new Uint16Array(270725);let x=0;
for(let d=3;d<52;d++)for(let c=2;c<d;c++)for(let b=1;b<c;b++)for(let a=0;a<b;a++)bin[x++]=groupOf[H.classOf([a,b,c,d])];
const binFile=path.join(args.work,'plo-groups.bin');fs.writeFileSync(binFile,Buffer.from(bin.buffer));
console.log(`Sampling group-vs-group equity (${args.pairSamples} runouts per pair)...`);
const rows=run('matrix',binFile,K,args.pairSamples,args.threads).trim().split('\n').map(l=>l.split(' ').map(Number));
const compatibility=rows.slice(0,K),equity=rows.slice(K);

const out={
 description:'PLO4 preflop hand model: suit-isomorphic classes grouped by shape and equity vs a random hand. compatibility[i][j] is the share of the 194,580 opposing combos that are disjoint and in group j, averaged over group i; equity[i][j] is sampled all-in equity.',
 classSamples:args.classSamples,pairSamples:args.pairSamples,play:PLAY,
 labels:groups.map(g=>g.label),combos:groups.map(g=>g.classes.reduce((s,i)=>s+H.counts[i],0)),
 playability:groups.map(g=>{const w=g.classes.reduce((s,i)=>s+H.counts[i]*playability(features[i]),0);return+(w/g.classes.reduce((s,i)=>s+H.counts[i],0)).toFixed(4);}),
 classes:Array.from(groupOf,g=>g.toString(36).padStart(2,'0')).join(''),
 vsRandom:groups.map(g=>+(g.classes.reduce((s,i)=>s+H.counts[i]*vsRandom[i],0)/g.classes.reduce((s,i)=>s+H.counts[i],0)).toFixed(4)),
 compatibility,equity,
};
const file=path.join(__dirname,'plo-model.json');fs.writeFileSync(file,JSON.stringify(out));
const sums=compatibility.map(r=>r.reduce((a,b)=>a+b,0));
console.log(`Wrote ${file}: ${K} groups, compatibility rows sum to ${Math.min(...sums).toFixed(6)}-${Math.max(...sums).toFixed(6)}.`);
