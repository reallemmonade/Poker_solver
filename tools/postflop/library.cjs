#!/usr/bin/env node
'use strict';
// Precomputes heads-up flop strategies with TexasSolver for common preflop
// lines, using ranges from the preflop chart library. Each solved flop is saved
// as its own file, so runs can stop and resume; `bundle` merges them into one
// range-lab-postflop-library-v1 file that the app imports.
//   node tools/postflop/library.cjs solve --charts preflop-library.json.gz --spots btn-bb --flops 100 --out postflop-work
//   node tools/postflop/library.cjs bundle --out postflop-work
//   node tools/postflop/library.cjs list
const fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),{spawn}=require('child_process');
const G=require('../../studio/game.js'),P=require('../../studio/preflop.js'),L=require('../../studio/local-solver.js'),Lib=require('../../studio/postflop-library.js'),F=require('./flops.cjs'),C=G.Core;

// Preflop lines as chart actions in seat order from the first actor: for
// raises the chart's smallest raise (an open or 3-bet, never the all-in).
const SIX=['UTG','HJ','CO','BTN','SB','BB'];
const line=(seats,steps)=>({seats,steps});
const SPOTS={
 'btn-bb':{label:'6-max 100bb · BTN opens, BB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','fold','call'])},
 'co-bb':{label:'6-max 100bb · CO opens, BB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','fold','fold','call'])},
 'utg-bb':{label:'6-max 100bb · UTG opens, BB calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','fold','fold','fold','call'])},
 'sb-bb':{label:'6-max 100bb · SB opens, BB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','fold','raise','call'])},
 'btn-bb-3bet':{label:'6-max 100bb · BTN opens, BB 3-bets, BTN calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','fold','raise','call'])},
 'hu-srp':{label:'Heads-up 100bb · button opens, BB calls',chart:'NLH cash 2-handed 100bb',...line(2,['raise','call'])},
};
// One bet size per street, raises only on the flop (all-in after that), no
// donk bets: the tree a 100bb flop fits in about 5 GB and solves in minutes.
const TREE={flop:{bet:[33],raise:[66]},turn:{bet:[66],raise:[]},river:{bet:[75],raise:[]},allinThreshold:.67};

const args={cmd:process.argv[2]||'help',charts:path.join(__dirname,'charts-100bb.json.gz'),spots:'btn-bb',flops:'100',out:'postflop-work',threads:String(os.cpus().length),accuracy:'1',iterations:'200',solver:path.join(__dirname,'..','local-solver','TexasSolver','install','console_solver'),timeout:'7200',name:'Range Lab postflop library'};
for(let i=3;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];

function loadCharts(file){const raw=fs.readFileSync(file),json=JSON.parse(/\.gz$/.test(file)?zlib.gunzipSync(raw):raw);return json.format==='range-lab-preflop-bundle-v1'?json.packs:[json];}

// Replays the spot's line in its chart and returns the ranges, pot and stack at the flop.
function prepare(id,packs){
 const def=SPOTS[id];if(!def)throw Error('Unknown spot '+id+'. Known: '+Object.keys(SPOTS).join(', '));
 const raw=packs.find(p=>p.name.startsWith(def.chart+' '));if(!raw)throw Error('The chart library has no "'+def.chart+'" pack.');
 const pack=P.validate(raw),h=new G.Hand(pack.config,{rng:G.rng(5)}),actions=[];
 for(const kind of def.steps){const node=pack.index.get(P.historyKey(h));if(!node)throw Error('Line leaves the chart at '+kind+'.');const options=node.actions.filter(a=>a.kind===kind).sort((a,b)=>(a.target||0)-(b.target||0));if(!options.length)throw Error('The chart has no '+kind+' here.');const a={seat:h.actor,street:0,kind,target:options[0].target};actions.push(a);h.act({kind,target:a.target});}
 if(h.street!==1)throw Error('The line does not reach the flop.');
 const range=P.postflopRanges([pack],pack.config,actions);if(!range||range.key!==P.historyKey(h))throw Error('Could not derive ranges for '+id+'.');
 const live=h.living(),after=i=>(i-h.button+h.n)%h.n||h.n,[oop,ip]=live.slice().sort((a,b)=>after(a)-after(b));
 const classes=w=>{const o={};P.classes.forEach((c,i)=>{if(w[i]>=.005)o[c]=Math.round(w[i]*1000)/1000;});return o;};
 return{id,label:def.label,pack,range,pot:h.pot,stack:Math.min(h.stacks[ip],h.stacks[oop]),ip,oop,rangeIp:classes(range.seats[ip]),rangeOop:classes(range.seats[oop])};
}

function spec(spot,board){
 const sizes={};for(const who of ['ip','oop']){sizes[who]={};for(const s of ['flop','turn','river'])sizes[who][s]={bet:TREE[s].bet.slice(),raise:TREE[s].raise.slice(),donk:[]};}
 return L.validate({version:1,board,pot:spot.pot,stack:spot.stack,sizes,allinThreshold:TREE.allinThreshold,rangeIp:spot.rangeIp,rangeOop:spot.rangeOop,path:[],hero:'2c2d',heroSeat:spot.oop,heroIsIp:false,accuracy:Number(args.accuracy),maxIterations:Number(args.iterations)});
}

function run(input,dir){
 return new Promise((resolve,reject)=>{
  const file=path.join(dir,'input.txt');fs.writeFileSync(file,input);let iterations=0,exploitability=null,tail='';const started=Date.now();
  const child=spawn(args.solver,['-i',file,'--resource_dir',path.join(path.dirname(args.solver),'resources')],{cwd:dir}),timer=setTimeout(()=>child.kill('SIGKILL'),Number(args.timeout)*1000);
  child.stdout.on('data',d=>{for(const l of String(d).split(/[\r\n]+/)){let m=l.match(/^Iter: (\d+)/);if(m)iterations=+m[1];m=l.match(/Total exploitability (-?[\d.]+)/);if(m)exploitability=+m[1];}});
  child.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});
  child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);code===0?resolve({iterations,exploitability,seconds:(Date.now()-started)/1000}):reject(Error('TexasSolver exit '+code+' '+tail.slice(-300)));});
 });
}

// Flop decision nodes of a TexasSolver dump, as library nodes. Labels keep
// whole chips ("BET 182"); the root's player number is the out-of-position one.
function nodes(tree){
 const out=[],oopPlayer=tree.player,label=a=>a.replace(/^(\w+) ([\d.]+)$/,(m,k,x)=>k+' '+(+(+x).toFixed(2)));
 (function visit(node,p){
  if(!node||node.node_type!=='action_node')return;const actions=node.actions.map(label),rows=[];
  for(const [combo,row]of Object.entries(node.strategy.strategy))rows.push([Lib.comboIndex(C.cards(combo)),row]);
  out.push({path:p,player:node.player===oopPlayer?'oop':'ip',actions,table:Lib.encode(rows,actions.length)});
  node.actions.forEach((a,i)=>{const child=node.childrens&&node.childrens[a];if(child)visit(child,(p?p+'/':'')+actions[i]);});
 })(tree,'');
 return out;
}

async function solve(){
 const packs=loadCharts(args.charts),ids=args.spots.split(','),flops=args.flops==='all'?F.all():F.subset(Number(args.flops));
 for(const id of ids){
  const spot=prepare(id,packs),dir=path.join(args.out,id);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'spot.json'),JSON.stringify({id,label:spot.label,chart:{name:spot.pack.name,key:spot.range.key},pot:spot.pot,stack:spot.stack,tree:TREE,rangeIp:spot.rangeIp,rangeOop:spot.rangeOop},null,1));
  console.log(spot.label+': pot '+G.bb(spot.pot)+' bb, stack '+G.bb(spot.stack)+' bb, '+flops.length+' flops');
  for(const f of flops){
   const file=path.join(dir,f.key+'.json');if(fs.existsSync(file))continue;
   const work=fs.mkdtempSync(path.join(os.tmpdir(),'range-lab-lib-')),dump=path.join(work,'out.json');
   try{
    const s=spec(spot,f.cards.map(C.cardName)),stats=await run(L.input(s,{threads:Number(args.threads),output:dump}),work);
    const result={key:f.key,weight:f.weight||f.count,...stats,nodes:nodes(JSON.parse(fs.readFileSync(dump,'utf8')))};
    fs.writeFileSync(file+'.tmp',JSON.stringify(result));fs.renameSync(file+'.tmp',file);
    console.log(new Date().toISOString().slice(11,19)+' '+id+' '+f.key+': '+stats.iterations+' iterations, '+stats.exploitability+'% pot, '+Math.round(stats.seconds)+' s');
   }catch(error){console.log(id+' '+f.key+' failed: '+error.message);}
   finally{fs.rmSync(work,{recursive:true,force:true});}
  }
 }
}

function bundle(){
 const spots=[];
 for(const id of fs.readdirSync(args.out)){const dir=path.join(args.out,id),meta=path.join(dir,'spot.json');if(!fs.existsSync(meta))continue;
  const spot=JSON.parse(fs.readFileSync(meta,'utf8'));spot.flops={};
  for(const f of fs.readdirSync(dir).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));spot.flops[r.key]={weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,nodes:r.nodes};}
  if(Object.keys(spot.flops).length)spots.push(spot);}
 const lib=Lib.validate({format:Lib.FORMAT,name:args.name,createdAt:new Date().toISOString(),source:{solver:'TexasSolver (console, DCFR) via tools/postflop/library.cjs',ranges:'Range Lab preflop chart library'},spots});
 const file=path.join(args.out,'postflop-library.json');fs.writeFileSync(file,JSON.stringify(lib));fs.writeFileSync(file+'.gz',zlib.gzipSync(fs.readFileSync(file),{level:9}));
 console.log(spots.map(s=>s.id+': '+Object.keys(s.flops).length+' flops').join('\n')+'\nWrote '+file+' and '+file+'.gz');
}

if(require.main===module){if(args.cmd==='solve')solve().catch(e=>{console.error(e.message);process.exit(1);});
else if(args.cmd==='bundle')bundle();
else if(args.cmd==='list')for(const [id,s]of Object.entries(SPOTS))console.log(id.padEnd(12)+s.label);
else console.log('Usage: library.cjs solve|bundle|list [--charts file] [--spots a,b] [--flops N|all] [--out dir] [--threads N] [--accuracy pct] [--iterations N]');}
module.exports={SPOTS,TREE,prepare,spec,nodes};
