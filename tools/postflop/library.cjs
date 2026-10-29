#!/usr/bin/env node
'use strict';
// Precomputes heads-up flop strategies with TexasSolver for common preflop
// lines, using ranges from the preflop chart library. Each solved flop is saved
// as its own file, so runs can stop and resume; `bundle` merges them into one
// range-lab-postflop-library-v1 file that the app imports.
//   node tools/postflop/library.cjs solve --charts preflop-library.json.gz --spots btn-bb --flops 100 --out postflop-work
//   node tools/postflop/library.cjs bundle --out postflop-work
//   node tools/postflop/library.cjs list
// --spots per-spot stands for every 6-max and heads-up 100bb line used by per-spot calibration.
// --jobs N solves N flops at once (each with --threads threads), across all the listed spots;
// --limit N stops after the first N unsolved flops (to time one).
// --shard K/N keeps every Nth listed flop from the Kth (1-based, in spot and flop order) and
// --reverse 1 works from the last one back, so helper computers can share a run going forward.
// A tree.json in the --out folder ({flop:{bet:[33,75],raise:[66]},turn:...}) replaces the default bet
// sizes below (TREE) street by street, so one library can use more sizes than the calibration solves.
// --turn 1 also saves the turn's first decisions (<flop>.turn.json.gz) on the main lines: check-check,
// bet-call and check-bet-call; `bundle-turn` packs them into one turn-<spot>.ctl per spot.
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
 'co-btn':{label:'6-max 100bb · CO opens, BTN calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','call','fold','fold'])},
 'hj-btn':{label:'6-max 100bb · HJ opens, BTN calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','fold','call','fold','fold'])},
 'utg-btn':{label:'6-max 100bb · UTG opens, BTN calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','fold','call','fold','fold'])},
 'co-bb-3bet':{label:'6-max 100bb · CO opens, BB 3-bets, CO calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','fold','fold','raise','call'])},
 'btn-sb-3bet':{label:'6-max 100bb · BTN opens, SB 3-bets, BTN calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','raise','fold','call'])},
 'sb-bb-3bet':{label:'6-max 100bb · SB opens, BB 3-bets, SB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','fold','raise','raise','call'])},
 // 3-bet pots where the 3-bettor has position, for calibrating in-position 3-bets (BTN vs HJ, BTN vs CO).
 'hj-btn-3bet':{label:'6-max 100bb · HJ opens, BTN 3-bets, HJ calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','fold','raise','fold','fold','call'])},
 'co-btn-3bet':{label:'6-max 100bb · CO opens, BTN 3-bets, CO calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','raise','fold','fold','call'])},
 // The remaining heads-up 6-max lines, so the 100bb library answers every common flop.
 'hj-bb':{label:'6-max 100bb · HJ opens, BB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','fold','fold','fold','call'])},
 'btn-sb':{label:'6-max 100bb · BTN opens, SB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','raise','call','fold'])},
 'co-sb':{label:'6-max 100bb · CO opens, SB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','fold','call','fold'])},
 'hj-sb':{label:'6-max 100bb · HJ opens, SB calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','fold','fold','call','fold'])},
 'utg-sb':{label:'6-max 100bb · UTG opens, SB calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','fold','fold','call','fold'])},
 'utg-co':{label:'6-max 100bb · UTG opens, CO calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','call','fold','fold','fold'])},
 'hj-co':{label:'6-max 100bb · HJ opens, CO calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','call','fold','fold','fold'])},
 'utg-hj':{label:'6-max 100bb · UTG opens, HJ calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','call','fold','fold','fold','fold'])},
 'hj-co-3bet':{label:'6-max 100bb · HJ opens, CO 3-bets, HJ calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','raise','fold','fold','fold','call'])},
 'co-sb-3bet':{label:'6-max 100bb · CO opens, SB 3-bets, CO calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','raise','fold','raise','fold','call'])},
 'utg-hj-3bet':{label:'6-max 100bb · UTG opens, HJ 3-bets, UTG calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','raise','fold','fold','fold','fold','call'])},
 'utg-co-3bet':{label:'6-max 100bb · UTG opens, CO 3-bets, UTG calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','raise','fold','fold','fold','call'])},
 'hj-sb-3bet':{label:'6-max 100bb · HJ opens, SB 3-bets, HJ calls',chart:'NLH cash 6-handed 100bb',...line(6,['fold','raise','fold','fold','raise','fold','call'])},
 'utg-btn-3bet':{label:'6-max 100bb · UTG opens, BTN 3-bets, UTG calls',chart:'NLH cash 6-handed 100bb',...line(6,['raise','fold','fold','raise','fold','fold','call'])},
 // Limped pots exist only in charts built with --limp 1 (the SB completes, the BB checks).
 'sb-bb-limp':{label:'6-max 100bb · SB limps, BB checks',chart:'NLH cash 6-handed 100bb',...line(6,['fold','fold','fold','fold','call','check'])},
 'hu-limp':{label:'Heads-up 100bb · button limps, BB checks',chart:'NLH cash 2-handed 100bb',...line(2,['call','check'])},
 'hu-3bet':{label:'Heads-up 100bb · button opens, BB 3-bets, button calls',chart:'NLH cash 2-handed 100bb',...line(2,['raise','raise','call'])},
};
// Every heads-up flop line of the 6-max 100bb tree, for per-spot calibration (calibrate.cjs
// --per-spot): each open and call, each 3-bet the opener calls (small, and "-big" for the
// larger size), and each small 4-bet the 3-bettor calls. Existing ids keep their lines.
// A step "raise2" takes the node's second-smallest raise.
{const P6=['utg','hj','co','btn','sb','bb'],L6=['UTG','HJ','CO','BTN','SB','BB'],f=n=>Array(n).fill('fold');
 for(let i=0;i<5;i++)for(let j=i+1;j<6;j++){
  const head=[...f(i),'raise',...f(j-i-1)],tail=f(5-j),o=P6[i],r=P6[j],lab=`6-max 100bb · ${L6[i]} opens, ${L6[j]}`;
  const add=(id,label,steps)=>{if(!SPOTS[id])SPOTS[id]={label,chart:'NLH cash 6-handed 100bb',...line(6,steps)};};
  add(`${o}-${r}`,`${lab} calls`,[...head,'call',...tail]);
  add(`${o}-${r}-3bet`,`${lab} 3-bets, ${L6[i]} calls`,[...head,'raise',...tail,'call']);
  add(`${o}-${r}-3bet-big`,`${lab} 3-bets big, ${L6[i]} calls`,[...head,'raise2',...tail,'call']);
  add(`${o}-${r}-4bet`,`${lab} 3-bets, ${L6[i]} 4-bets, ${L6[j]} calls`,[...head,'raise',...tail,'raise','call']);
 }
 SPOTS['hu-3bet-big']={label:'Heads-up 100bb · button opens, BB 3-bets big, button calls',chart:'NLH cash 2-handed 100bb',...line(2,['raise','raise2','call'])};
 SPOTS['hu-4bet']={label:'Heads-up 100bb · button opens, BB 3-bets, button 4-bets, BB calls',chart:'NLH cash 2-handed 100bb',...line(2,['raise','raise','raise','call'])};
 SPOTS['hu-limp-raise']={label:'Heads-up 100bb · button limps, BB raises, button calls',chart:'NLH cash 2-handed 100bb',...line(2,['call','raise','call'])};
}
const PER_SPOT=Object.keys(SPOTS).filter(id=>/^(utg|hj|co|btn|sb)-|^hu-/.test(id));
// The same lines at other depths, for tools/preflop/calibrate.cjs: "<id>-<depth>bb" on that
// depth's chart (btn-bb-50bb). A line that does not reach the flop at a depth (a 3-bet that
// is all-in) fails in prepare.
const DEPTHS=[20,50,200];
for(const [id,s]of Object.entries(SPOTS))for(const d of DEPTHS)SPOTS[id+'-'+d+'bb']={...s,label:s.label.replace('100bb',d+'bb'),chart:s.chart.replace(/100bb$/,d+'bb')};
// 4-handed (CO, BTN, SB, BB) and 9-handed (UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB) at 100bb.
const f=n=>Array(n).fill('fold');
for(const [id,label,steps]of [
 ['co-bb','CO opens, BB calls',['raise',...f(2),'call']],['btn-bb','BTN opens, BB calls',['fold','raise','fold','call']],
 ['co-btn','CO opens, BTN calls',['raise','call',...f(2)]],['sb-bb','SB opens, BB calls',[...f(2),'raise','call']],
 ['btn-bb-3bet','BTN opens, BB 3-bets, BTN calls',['fold','raise','fold','raise','call']],['sb-bb-3bet','SB opens, BB 3-bets, SB calls',[...f(2),'raise','raise','call']],
 ['sb-bb-limp','SB limps, BB checks',[...f(2),'call','check']],
])SPOTS['4max-'+id]={label:'4-handed 100bb · '+label,chart:'NLH cash 4-handed 100bb',...line(4,steps)};
for(const [id,label,steps]of [
 ['utg-bb','UTG opens, BB calls',['raise',...f(7),'call']],['hj-bb','HJ opens, BB calls',[...f(4),'raise',...f(3),'call']],
 ['co-bb','CO opens, BB calls',[...f(5),'raise',...f(2),'call']],['btn-bb','BTN opens, BB calls',[...f(6),'raise','fold','call']],
 ['utg-btn','UTG opens, BTN calls',['raise',...f(5),'call',...f(2)]],['co-btn','CO opens, BTN calls',[...f(5),'raise','call',...f(2)]],
 ['sb-bb','SB opens, BB calls',[...f(7),'raise','call']],['btn-bb-3bet','BTN opens, BB 3-bets, BTN calls',[...f(6),'raise','fold','raise','call']],
 ['sb-bb-3bet','SB opens, BB 3-bets, SB calls',[...f(7),'raise','raise','call']],['sb-bb-limp','SB limps, BB checks',[...f(7),'call','check']],
])SPOTS['9max-'+id]={label:'9-handed 100bb · '+label,chart:'NLH cash 9-handed 100bb',...line(9,steps)};
// One bet size per street, raises only on the flop (all-in after that), no
// donk bets: the tree a 100bb flop fits in about 5 GB and solves in minutes.
const TREE={flop:{bet:[33],raise:[66]},turn:{bet:[66],raise:[]},river:{bet:[75],raise:[]},allinThreshold:.67};

const args={cmd:process.argv[2]||'help',charts:path.join(__dirname,'charts-100bb.json.gz'),spots:'btn-bb',flops:'100',out:'postflop-work',threads:String(os.cpus().length),accuracy:'1',iterations:'200',solver:path.join(__dirname,'..','local-solver','TexasSolver','install','console_solver'),timeout:'7200',jobs:'1',turn:'0',name:'Citrus Poker postflop library'};
for(let i=3;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];

function loadCharts(file){const raw=fs.readFileSync(file),json=JSON.parse(/\.gz$/.test(file)?zlib.gunzipSync(raw):raw);return json.format==='range-lab-preflop-bundle-v1'?json.packs:[json];}

// Replays the spot's line in its chart and returns the ranges, pot and stack at the flop.
function prepare(id,packs){
 const def=SPOTS[id];if(!def)throw Error('Unknown spot '+id+'. Known: '+Object.keys(SPOTS).join(', '));
 const raw=packs.find(p=>p.name.startsWith(def.chart+' '));if(!raw)throw Error('The chart library has no "'+def.chart+'" pack.');
 const pack=P.validate(raw),h=new G.Hand(pack.config,{rng:G.rng(5)}),actions=[];
 for(let kind of def.steps){const node=pack.index.get(P.historyKey(h));
  // A chart leaves out decisions that are always folds (BB behind an SB 3-bet).
  if(!node&&kind==='fold'){actions.push({seat:h.actor,street:0,kind});h.act({kind});continue;}
  if(!node)throw Error('Line leaves the chart at '+kind+'.');const second=kind==='raise2';if(second)kind='raise';const options=node.actions.filter(a=>a.kind===kind).sort((a,b)=>(a.target||0)-(b.target||0));if(!options[second?1:0])throw Error('The chart has no '+(second?'second ':'')+kind+' here.');const a={seat:h.actor,street:0,kind,target:options[second?1:0].target};actions.push(a);h.act({kind,target:a.target});}
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
const label=a=>a.replace(/^(\w+) ([\d.]+)$/,(m,k,x)=>k+' '+(+(+x).toFixed(2)));
function libraryNode(node,p,oopPlayer){
 const actions=node.actions.map(label),rows=[];
 for(const [combo,row]of Object.entries(node.strategy.strategy))rows.push([Lib.comboIndex(C.cards(combo)),row]);
 return{path:p,player:node.player===oopPlayer?'oop':'ip',actions,table:Lib.encode(rows,actions.length)};
}
function nodes(tree){
 const out=[],oopPlayer=tree.player;
 (function visit(node,p){
  if(!node||node.node_type!=='action_node')return;const n=libraryNode(node,p,oopPlayer);out.push(n);
  node.actions.forEach((a,i)=>{const child=node.childrens&&node.childrens[a];if(child)visit(child,(p?p+'/':'')+n.actions[i]);});
 })(tree,'');
 return out;
}
// Turn decisions from a dump with set_dump_rounds 2: on the flop lines that end check-check, bet-call
// or check-bet-call, every turn card's first decision and the replies to it (two actions deep).
// Paths read "<flop line>|<turn card>/<turn actions>", as in "CHECK/CHECK|Qh/BET 363".
function turnNodes(tree){
 const out=[],oopPlayer=tree.player,main=/^(CHECK\/CHECK|BET [\d.]+\/CALL|CHECK\/BET [\d.]+\/CALL)$/;
 (function visit(node,p,turn,depth){
  if(!node)return;
  if(node.node_type==='chance_node'){if(!turn&&main.test(p))for(const [card,child]of Object.entries(node.dealcards||{}))visit(child,p+'|'+card,true,0);return;}
  if(node.node_type!=='action_node')return;const actions=node.actions.map(label);
  if(turn&&node.strategy)out.push(libraryNode(node,p,oopPlayer));if(turn&&depth>=2)return;
  node.actions.forEach((a,i)=>{const child=node.childrens&&node.childrens[a];if(child)visit(child,(p&&!p.endsWith('|')?p+'/':p)+actions[i],turn,turn?depth+1:0);});
 })(tree,'',false,0);
 return out;
}

// Root EVs per hand class (chips, net of half the starting pot), averaged over the
// class's combos, when the solver reports them (TexasSolver built with
// tools/local-solver/texassolver-evs.patch). tools/preflop/calibrate.cjs reads them.
function classEvs(tree){
 if(!tree.evs)return null;const oop=String(tree.player),ip=oop==='0'?'1':'0';
 const mean=m=>{const sum={},n={};for(const [combo,ev]of Object.entries(m||{})){const k=C.handClass(C.cards(combo));sum[k]=(sum[k]||0)+ev;n[k]=(n[k]||0)+1;}return Object.fromEntries(Object.keys(sum).map(k=>[k,Math.round(sum[k]/n[k]*100)/100]));};
 return{ip:mean(tree.evs[ip]),oop:mean(tree.evs[oop])};
}

async function solve(){
 const treeFile=path.join(args.out,'tree.json');if(fs.existsSync(treeFile))Object.assign(TREE,JSON.parse(fs.readFileSync(treeFile,'utf8')));
 const packs=loadCharts(args.charts),auto=new Set(args.spots.split(',').includes('per-spot')?PER_SPOT:[]),ids=args.spots.split(',').flatMap(id=>id==='per-spot'?PER_SPOT:[id]),flops=args.flops==='all'?F.all():F.subset(Number(args.flops)),tasks=[];
 for(const id of ids){
  // A per-spot line the chart never reaches (a 4-bet that is jam or fold) is skipped.
  let spot;try{spot=prepare(id,packs);}catch(e){if(!auto.has(id))throw e;console.log(`${id}: skipped (${e.message})`);continue;}
  const dir=path.join(args.out,id);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'spot.json'),JSON.stringify({id,label:spot.label,chart:{name:spot.pack.name,key:spot.range.key},pot:spot.pot,stack:spot.stack,tree:TREE,rangeIp:spot.rangeIp,rangeOop:spot.rangeOop},null,1));
  console.log(spot.label+': pot '+G.bb(spot.pot)+' bb, stack '+G.bb(spot.stack)+' bb, '+flops.length+' flops');
  for(const f of flops){
   // Solved flops are skipped, unless --redo-above asks to re-solve those that
   // stopped above that exploitability (% of pot), for example with more iterations,
   // or --need-evs 1 asks for those saved without per-class EVs.
   const file=path.join(dir,f.key+'.json');if(fs.existsSync(file)&&!(args.turn==='1'&&!fs.existsSync(path.join(dir,f.key+'.turn.json.gz')))){const redo=Number(args['redo-above']);let old=null;try{old=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}if(!(redo>0&&old&&old.exploitability>redo)&&!(args['need-evs']==='1'&&old&&!old.evs))continue;}
   tasks.push({id,spot,f,file,index:ids.indexOf(id)*flops.length+flops.indexOf(f)});
  }
 }
 const one=async({id,spot,f,file})=>{
   // Another run writing to the same folder may have solved it meanwhile.
   if(fs.existsSync(file)&&!(Number(args['redo-above'])>0)&&args['need-evs']!=='1'&&!(args.turn==='1'&&!fs.existsSync(path.join(path.dirname(file),f.key+'.turn.json.gz'))))return;
   const work=fs.mkdtempSync(path.join(os.tmpdir(),'range-lab-lib-')),dump=path.join(work,'out.json');
   try{
    const s=spec(spot,f.cards.map(C.cardName)),input=L.input(s,{threads:Number(args.threads),output:'out.json'}),stats=await run(args.turn==='1'?input.replace('set_dump_rounds 1','set_dump_rounds 2'):input,work);
    const tree=JSON.parse(fs.readFileSync(dump,'utf8')),evs=classEvs(tree),result={key:f.key,weight:f.weight||f.count,...stats,nodes:nodes(tree),...evs?{evs}:{}};
    if(args.turn==='1'){const t=path.join(path.dirname(file),f.key+'.turn.json.gz');fs.writeFileSync(t+'.tmp',zlib.gzipSync(JSON.stringify({key:f.key,nodes:turnNodes(tree)})));fs.renameSync(t+'.tmp',t);}
    fs.writeFileSync(file+'.tmp',JSON.stringify(result));fs.renameSync(file+'.tmp',file);
    console.log(new Date().toISOString().slice(11,19)+' '+id+' '+f.key+': '+stats.iterations+' iterations, '+stats.exploitability+'% pot, '+Math.round(stats.seconds)+' s');
   }catch(error){console.log(id+' '+f.key+' failed: '+error.message);}
   finally{fs.rmSync(work,{recursive:true,force:true});}
 };
 if(args.shard){const [k,n]=args.shard.split('/').map(Number);for(let i=tasks.length-1;i>=0;i--)if(tasks[i].index%n!==k-1)tasks.splice(i,1);}
 if(args.reverse==='1')tasks.reverse();
 if(Number(args.limit)>0)tasks.splice(Number(args.limit));
 const worker=async()=>{while(tasks.length)await one(tasks.shift());};
 await Promise.all(Array.from({length:Math.max(1,Number(args.jobs)|0)},worker));
}

function bundle(){
 const spots=[];
 for(const id of fs.readdirSync(args.out)){const dir=path.join(args.out,id),meta=path.join(dir,'spot.json');if(!fs.existsSync(meta))continue;
  const spot=JSON.parse(fs.readFileSync(meta,'utf8'));spot.flops={};
  for(const f of fs.readdirSync(dir).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));spot.flops[r.key]={weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,nodes:r.nodes};}
  if(Object.keys(spot.flops).length)spots.push(spot);}
 const lib=Lib.validate({format:Lib.FORMAT,name:args.name,createdAt:new Date().toISOString(),source:{solver:'TexasSolver (console, DCFR) via tools/postflop/library.cjs',ranges:'Citrus Poker preflop chart library'},spots});
 const file=path.join(args.out,'postflop-library.json');fs.writeFileSync(file,JSON.stringify(lib));fs.writeFileSync(file+'.gz',zlib.gzipSync(fs.readFileSync(file),{level:9}));
 console.log(spots.map(s=>s.id+': '+Object.keys(s.flops).length+' flops').join('\n')+'\nWrote '+file+' and '+file+'.gz');
}

// One turn file per spot (turn-<id>.ctl in --out), read by studio/postflop-library.js readTurn:
// "CTL1", the header length (uint32, little-endian), the header JSON (the spot's chart line,
// pot, stack and ranges, and each flop's key, offset and length), then each flop's gzipped JSON
// {nodes, turn}: its flop decisions and its turn decisions. The app keeps the flops apart and
// unpacks one only when a hand of that spot reaches the turn.
function bundleTurn(){
 for(const id of fs.readdirSync(args.out)){const dir=path.join(args.out,id),meta=path.join(dir,'spot.json');if(!fs.existsSync(meta))continue;
  const files=fs.readdirSync(dir).filter(x=>/^([2-9TJQKA][cdhs]){3}\.turn\.json\.gz$/.test(x)&&fs.existsSync(path.join(dir,x.replace('.turn.json.gz','.json')))).sort();if(!files.length)continue;
  const spot=JSON.parse(fs.readFileSync(meta,'utf8')),chunks=[],flops=[];let offset=0;delete spot.tree;
  for(const f of files){const t=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,f)))),r=JSON.parse(fs.readFileSync(path.join(dir,f.replace('.turn.json.gz','.json')),'utf8'));
   const gz=zlib.gzipSync(JSON.stringify({nodes:r.nodes,turn:t.nodes}),{level:9});flops.push({key:t.key,weight:r.weight,iterations:r.iterations,exploitability:r.exploitability,offset,length:gz.length});chunks.push(gz);offset+=gz.length;}
  const header=Buffer.from(JSON.stringify({format:Lib.TURN_FORMAT,name:args.name+' (turn)',createdAt:new Date().toISOString(),spot,flops})),size=Buffer.alloc(4);size.writeUInt32LE(header.length);
  const file=path.join(args.out,'turn-'+id+'.ctl');fs.writeFileSync(file,Buffer.concat([Buffer.from('CTL1'),size,header,...chunks]));
  console.log(id+': '+files.length+' flops, '+(fs.statSync(file).size/1e6).toFixed(1)+' MB -> '+file);}
}

if(require.main===module){if(args.cmd==='solve')solve().catch(e=>{console.error(e.message);process.exit(1);});
else if(args.cmd==='bundle')bundle();
else if(args.cmd==='bundle-turn')bundleTurn();
else if(args.cmd==='list')for(const [id,s]of Object.entries(SPOTS))console.log(id.padEnd(12)+s.label);
else console.log('Usage: library.cjs solve|bundle|bundle-turn|list [--charts file] [--spots a,b] [--flops N|all] [--out dir] [--threads N] [--accuracy pct] [--iterations N] [--redo-above pct] [--need-evs 1] [--jobs N] [--timeout s] [--turn 1]');}
module.exports={SPOTS,TREE,prepare,spec,nodes,turnNodes};
