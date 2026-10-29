#!/usr/bin/env node
'use strict';
// Fits the preflop model's flop-pot realization (solve.cjs: odds to the power `sharpness`,
// position, initiative and a playability multiplier per hand class) to TexasSolver flop
// solves. Each solved flop saved by tools/postflop/library.cjs with per-class EVs (TexasSolver
// built with tools/local-solver/texassolver-evs.patch) gives, for every hand class in both
// ranges, the share of the pot it actually wins: (pot/2 + EV) / pot, averaged over the flops by
// their weights. The model predicts that share against the opponent's range; the fit picks the
// sharpness, position and initiative factors on a grid and, for each, the per-class playability
// that matches the solved shares best (a damped fixed point). Classes with little weight in the
// solved ranges keep the shape rule's value.
//   node tools/preflop/calibrate.cjs --work postflop-work-ev[,more] --out calibration.json
// Then: node tools/preflop/export.cjs --seats 6 --stack 100 --calibration calibration.json ...
// With --depths 20,50,100,200 it fits each depth on the spots solved from that depth's charts
// and writes a calibration set; export.cjs and library.cjs then use the nearest depth's fit.
// With --split 1 the 3-bet pots (two raises or more before the flop) get a fit of their own,
// written as `reraised` (tree.cjs), and the single-raised and limped pots the main one. With no
// single-raised spots solved, the main fit is the default model.
// A class's fitted playability is shrunk toward the shape rule by how much data stands behind it:
// the log multiplier is scaled by n/(n + shrink x the median n of the fitted classes), where n is
// its combos times flops. With a few dozen flops per spot the raw per-class fit is mostly noise
// (fits on two halves of 120 3-bet-pot flops agreed at r=0.39). --shrink 0 turns it off.
// --check dir reports the fitted model's pot-share error on flops solved elsewhere (held out).
// --per-spot 1 also fits every spot with at least --spot-flops solved flops on its own, shrunk
// toward its pot type's fit instead of the shape rule, and writes them as `spots` keyed by
// "<chart>|<flop line>"; solve.cjs then pays that exact preflop line by its own fit.
const fs=require('fs'),path=require('path');
const {playability,PLAY}=require('./solve.cjs');
const table=JSON.parse(fs.readFileSync(path.join(__dirname,'equity-table.json'),'utf8'));
const classes=table.classes,K=classes.length,index=new Map(classes.map((c,i)=>[c,i])),combos=classes.map(c=>c.length===2?6:c[2]==='s'?4:12);

const args={work:'',out:'calibration.json',min:'0.5',depths:'',split:'',shrink:'1',check:'','per-spot':'','spot-flops':'20'};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
if(!args.work){console.log('Usage: calibrate.cjs --work dir[,dir] [--out calibration.json] [--min 0.5] [--depths 20,50,100,200] [--split 1] [--shrink 1] [--check dir] [--per-spot 1 [--spot-flops 20]]');process.exit(1);}

// The two players at the flop, from the chart line "seat:kind:target/...": out of position is
// first after the button (seat 0), and the aggressor is the last raiser (none in a limped pot).
function roles(key){
 const steps=key.split('/').map(s=>{const [seat,kind]=s.split(':');return{seat:+seat,kind};}),seats=[...new Set(steps.map(s=>s.seat))],n=seats.length;
 const live=seats.filter(s=>!steps.some(x=>x.seat===s&&x.kind==='fold')),after=i=>i%n||n,[oop,ip]=live.sort((a,b)=>after(a)-after(b));
 const raises=steps.filter(s=>s.kind==='raise');return{ip,oop,aggressorIsOop:raises.length>0&&raises[raises.length-1].seat===oop,reraised:raises.length>=2};
}

// Solved shares per spot and side: target[i] and how much data stands behind it. With a
// depth, only spots solved from that depth's charts ("NLH cash 6-handed 50bb ...").
function collect(depth,dirs=args.work){
const data=[];let flopCount=0;
for(const dir of dirs.split(','))for(const id of fs.readdirSync(dir)){
 const meta=path.join(dir,id,'spot.json');if(!fs.existsSync(meta))continue;
 const spot=JSON.parse(fs.readFileSync(meta,'utf8'));if(depth&&Number((spot.chart.name.match(/ (\d+)bb\b/)||[])[1])!==depth)continue;
 const r=roles(spot.chart.key),sum={ip:new Float64Array(K),oop:new Float64Array(K)},mass={ip:new Float64Array(K),oop:new Float64Array(K)};let used=0;
 for(const f of fs.readdirSync(path.join(dir,id)).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){
  const flop=JSON.parse(fs.readFileSync(path.join(dir,id,f),'utf8'));if(!flop.evs)continue;used++;
  for(const side of ['ip','oop'])for(const [c,ev]of Object.entries(flop.evs[side])){const i=index.get(c);if(i===undefined)continue;sum[side][i]+=flop.weight*(spot.pot/2+ev)/spot.pot;mass[side][i]+=flop.weight;}
 }
 if(!used)continue;flopCount+=used;
 for(const side of ['ip','oop']){
  const own=side==='ip'?spot.rangeIp:spot.rangeOop,opp=side==='ip'?spot.rangeOop:spot.rangeIp,target=new Float64Array(K),weight=new Float64Array(K),oppMass=new Float64Array(K);
  for(let i=0;i<K;i++){oppMass[i]=(opp[classes[i]]||0)*combos[i];if(mass[side][i]>0){target[i]=sum[side][i]/mass[side][i];weight[i]=(own[classes[i]]||0)*combos[i]*used;}}
  // Matrix roles as in solve.cjs: a caller in position facing an out-of-position raiser uses
  // ipCaller/oopRaiser (initiative goes to the raiser); otherwise the player in position has it.
  const ini=r.aggressorIsOop?(side==='oop'?'self':'opp'):(side==='ip'?'self':'opp');
  data.push({spot:id,chart:spot.chart.name.split(' (')[0],key:spot.chart.key,side,ip:side==='ip',ini,target,weight,oppMass,reraised:r.reraised,flops:used});
 }
}
return{data,flopCount,depth};
}

const C=table.compatibility.map(r=>r.map(x=>x/1225)),E=table.equity;
// Predicted pot share of every class for one datum.
function predict(d,g,rho,iota,play,out){
 const rSelf=(d.ip?1+rho:1-rho)*(d.ini==='self'?1+iota:1),rOpp=(d.ip?1-rho:1+rho)*(d.ini==='opp'?1+iota:1);
 for(let i=0;i<K;i++){if(!d.weight[i]){out[i]=0;continue;}let won=0,seen=0;const Ci=C[i],Ei=E[i],pi=play[i]*rSelf;
  for(let j=0;j<K;j++){const m=d.oppMass[j];if(!m)continue;const c=Ci[j]*m;if(!c)continue;const e=Ei[j],a=e**g*pi,b=(1-e)**g*rOpp*play[j];won+=c*(a+b>0?a/(a+b):.5);seen+=c;}
  out[i]=seen>0?won/seen:0;}
 return out;
}
function loss(data,g,rho,iota,play){let s=0,w=0;const out=new Float64Array(K);for(const d of data){predict(d,g,rho,iota,play,out);for(let i=0;i<K;i++)if(d.weight[i]){const x=out[i]-d.target[i];s+=d.weight[i]*x*x;w+=d.weight[i];}}return Math.sqrt(s/w);}

const base=classes.map(c=>playability(c,PLAY));
function fit(collected){
 const r=fitPots(collected);if(args['per-spot']!=='1')return r;
 // Grouped by chart and line, so the same spot id solved on charts with other raise sizes stays apart.
 const spots={},line=d=>d.chart+'|'+d.key,lines=[...new Set(collected.data.map(line))];console.log('  single spots:');
 for(const k of lines){
  const data=collected.data.filter(d=>line(d)===k),flops=data.filter(d=>d.side==='ip').reduce((s,d)=>s+d.flops,0),id=data[0].spot;if(flops<Number(args['spot-flops']))continue;
  const pool=data[0].reraised&&r.reraised?r.reraised.play:r.play,f=fitOne({data,flopCount:flops,depth:collected.depth},data[0].reraised,classes.map(c=>pool[c]),id);
  spots[k]={spot:id,flops,sharpness:f.sharpness,realization:f.realization,initiative:f.initiative,play:f.play,rmse:f.fit.rmseFitted};
 }
 return{...r,spots};
}
function fitPots(collected){
 if(args.split!=='1')return fitOne(collected,null);
 const part=re=>{const data=collected.data.filter(d=>d.reraised===re);return{data,depth:collected.depth,flopCount:data.filter(d=>d.side==='ip').reduce((s,d)=>s+d.flops,0)};},single=part(false),three=part(true);
 if(!three.data.length){console.log('  no 3-bet pots solved: one fit for every pot');return fitOne(collected,null);}
 console.log('  single-raised and limped pots:');
 const main=single.data.length?fitOne(single,false):{format:'range-lab-preflop-calibration-v1',source:'default model',sharpness:1.2,realization:.12,initiative:.06,play:Object.fromEntries(classes.map((c,i)=>[c,+base[i].toFixed(4)]))};
 if(!single.data.length)console.log('    none solved: default model');
 console.log('  3-bet pots:');const r=fitOne(three,true);
 return{...main,source:main.source+'; 3-bet pots: '+r.source,reraised:{sharpness:r.sharpness,realization:r.realization,initiative:r.initiative,play:r.play,fit:r.fit}};
}
function fitOne({data,flopCount,depth},reraised,base0=base,label=''){
const total=new Float64Array(K);for(const d of data)for(let i=0;i<K;i++)total[i]+=d.weight[i];
const maxTotal=Math.max(...total),fitted=i=>total[i]>=Number(args.min)/100*maxTotal;
const sorted=total.filter((_,i)=>fitted(i)).sort((a,b)=>a-b),shrink=Number(args.shrink)*sorted[sorted.length>>1];
function fitPlay(g,rho,iota){
 const play=Float64Array.from(base0),out=new Float64Array(K);
 for(let it=0;it<25;it++){
  const num=new Float64Array(K),den=new Float64Array(K);
  for(const d of data){predict(d,g,rho,iota,play,out);for(let i=0;i<K;i++)if(d.weight[i]){num[i]+=d.weight[i]*d.target[i];den[i]+=d.weight[i]*out[i];}}
  for(let i=0;i<K;i++)if(fitted(i)&&den[i]>0)play[i]=Math.min(4,Math.max(.25,play[i]*(num[i]/den[i])**1.5));
  // Only ratios matter; keep the geometric mean of the fitted classes at that of the starting table.
  if(it===24&&shrink>0)for(let i=0;i<K;i++)if(fitted(i))play[i]=base0[i]*(play[i]/base0[i])**(total[i]/(total[i]+shrink));
  let ls=0,lb=0,n=0;for(let i=0;i<K;i++)if(fitted(i)){ls+=Math.log(play[i]);lb+=Math.log(base0[i]);n++;}const k=Math.exp((lb-ls)/n);for(let i=0;i<K;i++)if(fitted(i))play[i]*=k;
 }
 return play;
}

const before=loss(data,1.2,.12,.06,base);let best=null;
for(const g of [1,1.1,1.2,1.3,1.4,1.6,1.8,2,2.4])for(const rho of [.04,.08,.12,.16,.2,.25])for(const iota of [0,.03,.06,.1,.15]){
 const play=fitPlay(g,rho,iota),l=loss(data,g,rho,iota,play);if(!best||l<best.l)best={g,rho,iota,play,l};
}
const shape=loss(data,best.g,best.rho,best.iota,base0);
let held=null;if(args.check){const h=collect(depth,args.check).data.filter(d=>reraised===null||d.reraised===reraised);if(h.length)held={rmseDefault:+loss(h,1.2,.12,.06,base).toFixed(5),rmseFitted:+loss(h,best.g,best.rho,best.iota,best.play).toFixed(5)};}
const result={format:'range-lab-preflop-calibration-v1',source:`TexasSolver flop solves (${data.length/2} spots, ${flopCount} flops in ${args.work.split(',').map(d=>path.basename(d)).join(', ')})`,createdAt:new Date().toISOString(),
 sharpness:best.g,realization:best.rho,initiative:best.iota,play:Object.fromEntries(classes.map((c,i)=>[c,+best.play[i].toFixed(4)])),
 fit:{rmseDefault:+before.toFixed(5),rmseShapeAtFittedFactors:+shape.toFixed(5),rmseFitted:+best.l.toFixed(5),classesFitted:classes.filter((_,i)=>fitted(i)).length,...held?{heldOut:held}:{}}};
if(label){console.log(`    ${label}: ${flopCount} flops, error ${(100*before).toFixed(1)}% -> ${(100*best.l).toFixed(1)}%, sharpness ${best.g}, position x${(1+best.rho).toFixed(2)}, initiative x${(1+best.iota).toFixed(2)}`);return result;}
console.log(`${result.source}. Pot-share error (RMS): default model ${(100*before).toFixed(2)}%, fitted ${(100*best.l).toFixed(2)}%. Sharpness ${best.g}, position x${(1+best.rho).toFixed(2)}/x${(1-best.rho).toFixed(2)}, initiative x${(1+best.iota).toFixed(2)}, playability fitted for ${result.fit.classesFitted} classes.${held?` Held out (${args.check}): default ${(100*held.rmseDefault).toFixed(2)}%, fitted ${(100*held.rmseFitted).toFixed(2)}%.`:''}`);
for(const c of ['AA','KK','AKs','AKo','A7s','A5s','KJs','KQo','JTs','76s','54s','22','T8o','72o'])console.log('  '+c.padEnd(4)+' playability '+base[index.get(c)].toFixed(3)+' -> '+best.play[index.get(c)].toFixed(3));
return result;
}

// One fit, or a set with a fit per depth. Charts shallower than minStack (push/fold) keep the
// default model; the others take the fit of the nearest depth (by ratio).
let out;
if(args.depths){
 const buckets=[];for(const depth of args.depths.split(',').map(Number)){const d=collect(depth);if(!d.data.length){console.log(`No solved ${depth}bb flops with EVs found in ${args.work}.`);process.exit(1);}console.log(depth+'bb:');buckets.push({depth,...fit(d)});}
 out={format:'range-lab-preflop-calibration-set-v1',createdAt:new Date().toISOString(),minStack:15,buckets};
}else{const d=collect(0);if(!d.data.length){console.log('No solved flops with EVs found in '+args.work+'.');process.exit(1);}out=fit(d);}
fs.writeFileSync(args.out,JSON.stringify(out,null,1));console.log('Wrote '+args.out+'.');
