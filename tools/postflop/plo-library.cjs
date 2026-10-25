#!/usr/bin/env node
'use strict';
// Precomputes heads-up pot-limit Omaha flop strategies with tools/plo-solver for
// common preflop lines, using ranges from the PLO preflop charts. Like
// library.cjs, each solved flop is its own file, so runs resume; `bundle` writes
// a range-lab-postflop-library-v1 file whose spots are marked game PLO4. A PLO
// flop stores the combos it was solved for (a systematic sample of each range,
// --combos a side); the app answers other hands from the most similar stored one.
//   node tools/postflop/plo-library.cjs solve --charts preflop-library.json.gz --spots plo-btn-bb --flops 40 --out plo-work
//   node tools/postflop/plo-library.cjs bundle --out plo-work
//   node tools/postflop/plo-library.cjs list
const fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),{spawn}=require('child_process');
const G=require('../../studio/game.js'),P=require('../../studio/preflop.js'),L=require('../../studio/local-solver.js'),Lib=require('../../studio/postflop-library.js'),F=require('./flops.cjs'),C=G.Core;

const line=(seats,steps)=>({seats,steps});
const SPOTS={
 'plo-btn-bb':{label:'PLO 6-max 100bb · BTN opens, BB calls',chart:'PLO cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','fold','call'])},
 'plo-co-bb':{label:'PLO 6-max 100bb · CO opens, BB calls',chart:'PLO cash 6-handed 100bb',...line(6,['fold','fold','raise','fold','fold','call'])},
 'plo-sb-bb':{label:'PLO 6-max 100bb · SB opens, BB calls',chart:'PLO cash 6-handed 100bb',...line(6,['fold','fold','fold','fold','raise','call'])},
 'plo-btn-bb-3bet':{label:'PLO 6-max 100bb · BTN opens, BB 3-bets, BTN calls',chart:'PLO cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','fold','raise','call'])},
 'plo-hu-srp':{label:'PLO heads-up 100bb · button opens, BB calls',chart:'PLO cash 2-handed 100bb',...line(2,['raise','call'])},
};
// The app's PLO tree (studio/local-solver.js): one bet size per street, pot raises.
const TREE=L.PLO_TREE;

const args={cmd:process.argv[2]||'help',charts:'preflop-library.json.gz',spots:'plo-btn-bb',flops:'40',combos:'500',out:'plo-work',threads:String(os.cpus().length),accuracy:'1',iterations:'200',solver:path.join(__dirname,'..','plo-solver','plo_solver'),memory:String(Math.round(os.totalmem()/1048576*.7)),timeout:'7200',name:'Range Lab PLO postflop library'};
for(let i=3;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];

function loadCharts(file){const raw=fs.readFileSync(file),json=JSON.parse(/\.gz$/.test(file)?zlib.gunzipSync(raw):raw);return json.format==='range-lab-preflop-bundle-v1'?json.packs:[json];}

// Replays the spot's line in its chart: ranges per hand group, pot and stack at the flop.
function prepare(id,packs){
 const def=SPOTS[id];if(!def)throw Error('Unknown spot '+id+'. Known: '+Object.keys(SPOTS).join(', '));
 const raw=packs.find(p=>p.name.startsWith(def.chart+' '));if(!raw)throw Error('The chart library has no "'+def.chart+'" pack.');
 const pack=P.validate(raw),h=new G.Hand(pack.config,{rng:G.rng(5)}),actions=[];
 for(const kind of def.steps){const node=pack.index.get(P.historyKey(h));
  if(!node&&kind==='fold'){actions.push({seat:h.actor,street:0,kind});h.act({kind});continue;}
  if(!node)throw Error('Line leaves the chart at '+kind+'.');const options=node.actions.filter(a=>a.kind===kind).sort((a,b)=>(a.target||0)-(b.target||0));if(!options.length)throw Error('The chart has no '+kind+' here.');const a={seat:h.actor,street:0,kind,target:options[0].target};actions.push(a);h.act({kind,target:a.target});}
 if(h.street!==1)throw Error('The line does not reach the flop.');
 const range=P.postflopRanges([pack],pack.config,actions);if(!range||range.key!==P.historyKey(h))throw Error('Could not derive ranges for '+id+'.');
 const live=h.living(),after=i=>(i-h.button+h.n)%h.n||h.n,[oop,ip]=live.slice().sort((a,b)=>after(a)-after(b));
 const groups=w=>{const o={};range.labels.forEach((g,i)=>{if(w[i]>=.005)o[g]=Math.round(w[i]*1000)/1000;});return o;};
 return{id,label:def.label,pack,range,pot:h.pot,stack:Math.min(h.stacks[ip],h.stacks[oop]),ip,oop,rangeIp:groups(range.seats[ip]),rangeOop:groups(range.seats[oop]),minBet:G.units(pack.config.bb)};
}

const name=cs=>cs.slice().sort((a,b)=>b-a).map(C.cardName).join('');
function spec(spot,board){
 const cards=board.map(C.cards).flat(),combos=seat=>{const out={};for(const c of P.ploCombos({pack:spot.pack,weights:spot.range.seats[seat]},cards,{limit:Number(args.combos),seed:1+seat}))out[name(c.cards)]=c.weight;const peak=Math.max(...Object.values(out));for(const k in out)out[k]=Math.round(out[k]/peak*1e4)/1e4;return out;};
 const sizes={},caps={};for(let s=0;s<3;s++){const st=['flop','turn','river'][s];sizes[st]={};caps[st]=TREE.cap[s];for(const who of ['ip','oop'])sizes[st][who]={bet:[TREE.bet[s]],raise:[TREE.raise]};}
 const rangeIp=combos(spot.ip),rangeOop=combos(spot.oop),hero=Object.keys(rangeOop)[0];
 return L.validate({version:1,game:'PLO4',board,pot:spot.pot,stack:spot.stack,minBet:spot.minBet,sizes,caps,allinThreshold:TREE.allinThreshold,rangeIp,rangeOop,path:[],hero,heroSeat:spot.oop,heroIsIp:false,accuracy:Number(args.accuracy),maxIterations:Number(args.iterations)});
}

function run(input,dir){
 return new Promise((resolve,reject)=>{
  const file=path.join(dir,'input.txt');fs.writeFileSync(file,input);let iterations=0,exploitability=null,tail='';const started=Date.now();
  const child=spawn(args.solver,[file],{cwd:dir}),timer=setTimeout(()=>child.kill('SIGKILL'),Number(args.timeout)*1000);
  child.stdout.on('data',d=>{for(const l of String(d).split(/[\r\n]+/)){let m=l.match(/^Iter: (\d+)/);if(m)iterations=+m[1];m=l.match(/Total exploitability (-?[\d.]+)/);if(m)exploitability=+m[1];}});
  child.stderr.on('data',d=>{tail=(tail+d).slice(-2000);});child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);code===0?resolve({iterations,exploitability,seconds:(Date.now()-started)/1000}):reject(Error('plo_solver exit '+code+' '+tail.slice(-300)));});
 });
}

// Flop decision nodes of a plo_solver result as library nodes. Labels carry the
// chips the action adds on this street ("BET 250", "RAISE 900"), as in the NLH
// library; tables are bytes per stored combo of the acting player.
function nodes(tree,pot){
 const out=[];
 (function visit(node,p,paid){
  if(!node||!Array.isArray(node.actions)||!Array.isArray(node.strategy))return;const who=node.player===1?'ip':'oop',me=node.player===1?1:0;
  const actions=node.actions.map(a=>a.kind==='fold'?'FOLD':a.kind==='check'?'CHECK':a.kind==='call'?'CALL':(a.kind==='bet'?'BET ':'RAISE ')+Math.round(a.to-paid[me]));
  out.push({path:p,player:who,actions,table:Lib.encode(node.strategy.map((row,i)=>[i,row]),actions.length,node.strategy.length)});
  node.actions.forEach((a,i)=>{const next=paid.slice();if(a.kind==='call')next[me]=Math.max(...paid);else if(a.to!=null)next[me]=a.to;visit(node.children&&node.children[i],(p?p+'/':'')+actions[i],next);});
 })(tree,'',[0,0]);
 return out;
}

async function solve(){
 const packs=loadCharts(args.charts),ids=args.spots.split(','),flops=args.flops==='all'?F.all():F.subset(Number(args.flops));
 for(const id of ids){
  const spot=prepare(id,packs),dir=path.join(args.out,id);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'spot.json'),JSON.stringify({id,label:spot.label,game:'PLO4',chart:{name:spot.pack.name,key:spot.range.key},pot:spot.pot,stack:spot.stack,tree:TREE,rangeIp:spot.rangeIp,rangeOop:spot.rangeOop},null,1));
  console.log(spot.label+': pot '+G.bb(spot.pot)+' bb, stack '+G.bb(spot.stack)+' bb, '+flops.length+' flops, '+args.combos+' combos a side');
  for(const f of flops){
   const file=path.join(dir,f.key+'.json');if(fs.existsSync(file))continue;
   const work=fs.mkdtempSync(path.join(os.tmpdir(),'range-lab-plo-'));
   try{
    const s=spec(spot,f.cards.map(C.cardName)),stats=await run(L.input(s,{threads:Number(args.threads),output:'out.json',memoryMB:Number(args.memory),timeLimit:Number(args.timeout)*.95}),work);
    const tree=JSON.parse(fs.readFileSync(path.join(work,'out.json'),'utf8'));
    const result={key:f.key,weight:f.weight||f.count,iterations:tree.iterations||stats.iterations,exploitability:tree.exploitability??stats.exploitability,seconds:stats.seconds,combos:{oop:tree.combos[0],ip:tree.combos[1]},weights:{oop:tree.weights[0],ip:tree.weights[1]},nodes:nodes(tree.tree,spot.pot)};
    fs.writeFileSync(file+'.tmp',JSON.stringify(result));fs.renameSync(file+'.tmp',file);
    console.log(new Date().toISOString().slice(11,19)+' '+id+' '+f.key+': '+result.iterations+' iterations, '+result.exploitability+'% pot, '+Math.round(stats.seconds)+' s');
   }catch(error){console.log(id+' '+f.key+' failed: '+error.message);}
   finally{fs.rmSync(work,{recursive:true,force:true});}
  }
 }
}

function bundle(){
 const spots=[];
 for(const id of fs.readdirSync(args.out)){const dir=path.join(args.out,id),meta=path.join(dir,'spot.json');if(!fs.existsSync(meta))continue;
  const spot=JSON.parse(fs.readFileSync(meta,'utf8'));spot.flops={};
  for(const f of fs.readdirSync(dir).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));spot.flops[r.key]={weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,combos:r.combos,weights:r.weights,nodes:r.nodes};}
  if(Object.keys(spot.flops).length)spots.push(spot);}
 const lib=Lib.validate({format:Lib.FORMAT,name:args.name,createdAt:new Date().toISOString(),source:{solver:'Range Lab PLO solver (tools/plo-solver, DCFR) via tools/postflop/plo-library.cjs',ranges:'Range Lab PLO preflop charts'},spots});
 const file=path.join(args.out,'plo-postflop-library.json');fs.writeFileSync(file,JSON.stringify(lib));fs.writeFileSync(file+'.gz',zlib.gzipSync(fs.readFileSync(file),{level:9}));
 console.log(spots.map(s=>s.id+': '+Object.keys(s.flops).length+' flops').join('\n')+'\nWrote '+file+' and '+file+'.gz');
}

module.exports={SPOTS,prepare,spec,nodes};
if(require.main===module){
 if(args.cmd==='list')for(const [id,s]of Object.entries(SPOTS))console.log(id.padEnd(18)+s.label);
 else if(args.cmd==='solve')solve().catch(e=>{console.error(e.message);process.exit(1);});
 else if(args.cmd==='bundle')bundle();
 else console.log('Usage: node tools/postflop/plo-library.cjs list | solve --charts file --spots ids --flops N --combos N --out dir | bundle --out dir');
}
