#!/usr/bin/env node
'use strict';
// Level 2: flop pots paid from solved flops hand by hand, not only from the fitted formula.
// Each TexasSolver flop solved with per-class EVs (tools/postflop/library.cjs) gives every class's
// share of the pot on that line, (pot/2 + EV) / pot, averaged over the flops by weight. A
// calibration with those shares as `measured` (per line, both sides, with the ranges they were
// solved against) makes solve.cjs scale the line's share matrix class by class to match them.
// Solving again on the new charts and refitting converges the ranges and the shares together
// (tools/calibration/level2.sh runs the rounds).
//   node tools/preflop/level2.cjs extract --work dir[,dir] --out m.json.gz [--chart "NLH cash 6-handed 100bb"] [--live 0 for the old flop-only weighting]
//   node tools/preflop/level2.cjs fit --measure m0.json.gz,dir1[,...] --base set2.json --out cal.json [--keep 2] [--step .4 --prior cal-previous.json] [--probe-cap 1.2]
//   node tools/preflop/level2.cjs settle --old charts.json.gz --new charts.json.gz [--threshold .03]
//   node tools/preflop/level2.cjs moved --old charts.json.gz --new charts.json.gz --spots per-spot-6max [--threshold .05]
//   node tools/preflop/level2.cjs compare --a m0.json.gz --b dir|m.json.gz
// compare (a diagnostic) prints, per line both measured and per side, the combo-weighted mean share
// of the classes in a's range (5% or more) in a and in b, the mean share in b of classes a never had,
// and the share of b's opponent range those extra classes make up; then the means by pot type.
// extract keeps only the shares (a few hundred kB), to move solves between computers. fit keeps
// for every line the last --keep measurements given (in --measure order) and writes them into the
// base calibration (a set from calibrate.cjs --depths, or one fit). --step a damps it: each class's
// factor moves only a of the way (in logs) from the previous round's (--prior, that round's
// calibration; none = the formula) to the measured one, so ranges and shares settle together instead
// of overshooting (undamped, the pilot's round 1 jumped to the new values and 3-bets exploded).
// settle prints how far the chart's preflop strategy moved between two rounds (largest and mean
// change in any action's frequency, by combos, over nodes reached 1% or more) and exits 0 once the
// largest node change is under --threshold. moved prints the flop lines
// whose ranges moved more than --threshold (total variation over combos, either player) between
// two chart bundles, so a round re-solves only those.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const args={cmd:process.argv[2]||'help',a:'',b:'',live:'',step:'',prior:'',probecap:'',work:'',out:'',chart:'NLH cash 6-handed 100bb',measure:'',base:'',keep:'2',old:'',new:'',spots:'per-spot-6max',threshold:'.05'};
for(let i=3;i<process.argv.length;i+=2){const k=process.argv[i].replace(/^--/,'').replace(/-/g,'');if(!(k in args))throw Error('Unknown option '+process.argv[i]);args[k]=process.argv[i+1];}
const read=f=>{const raw=fs.readFileSync(f);return JSON.parse(/\.gz$/.test(f)?zlib.gunzipSync(raw):raw);};
const round=x=>Math.round(x*1e4)/1e4;
// Combos of a hand class (AKs, AKo, 77) that no board card blocks. A flop that hits a class (88 on
// 8-x-x, A5s on A-x-x) leaves it few live combos, and a class's EV there is an average over those
// few only, so a flop average over boards has to weight each board by them: weighting by the flop
// alone counted the boards that block a class as fully as the ones that don't, and those are the
// boards where the class is strongest. Measured shares came out about 1.23 of the pot, not 1.05.
function live(cls,board){
 const dead=new Set(board.match(/[2-9TJQKA][cdhs]/g)||[]),a=cls[0],b=cls[1],suits='cdhs';let n=0;
 if(cls.length===2){const left=suits.split('').filter(s=>!dead.has(a+s)).length;return left*(left-1)/2;}
 for(const s of suits)for(const t of suits){if(dead.has(a+s)||dead.has(b+t))continue;if(cls[2]==='s'?s===t:s!==t)n++;}
 return n;
}

// One record per solved line: its chart, key, ranges and each class's average pot share.
function extract(dirs,chart){
 const out=[];
 for(const dir of dirs.split(','))for(const id of fs.readdirSync(dir).sort()){
  const meta=path.join(dir,id,'spot.json');if(!fs.existsSync(meta))continue;
  const spot=JSON.parse(fs.readFileSync(meta,'utf8')),name=spot.chart.name.split(' (')[0];if(chart&&name!==chart)continue;
  const sum={ip:{},oop:{}},mass={ip:{},oop:{}};let flops=0;
  for(const f of fs.readdirSync(path.join(dir,id)).filter(x=>/^([2-9TJQKA][cdhs]){3}\.json$/.test(x))){
   let r;try{r=JSON.parse(fs.readFileSync(path.join(dir,id,f),'utf8'));}catch{continue;}if(!r.evs)continue;flops++;
   for(const side of ['ip','oop'])for(const [c,ev]of Object.entries(r.evs[side])){{const w=r.weight*(args.live==='0'?1:live(c,f.replace('.json',''))),x=(spot.pot/2+ev)/spot.pot;if(!(w>0))continue;sum[side][c]=(sum[side][c]||0)+w*x;mass[side][c]=(mass[side][c]||0)+w;}}
  }
  if(!flops)continue;
  const share=side=>Object.fromEntries(Object.keys(sum[side]).sort().map(c=>[c,round(sum[side][c]/mass[side][c])]));
  out.push({chart:name,key:spot.chart.key,id,flops,pot:spot.pot,rangeIp:spot.rangeIp,rangeOop:spot.rangeOop,ip:share('ip'),oop:share('oop')});
 }
 return out;
}
const measurements=src=>fs.statSync(src).isDirectory()?extract(src,args.chart):read(src);

function fit(){
 const cal=read(args.base),keep=Math.max(1,Number(args.keep)|0),lines=new Map();
 for(const src of args.measure.split(','))for(const m of measurements(src)){const k=m.chart+'|'+m.key;if(!lines.has(k))lines.set(k,[]);lines.get(k).push({rangeIp:m.rangeIp,rangeOop:m.rangeOop,ip:m.ip,oop:m.oop,flops:m.flops});}
 const depth=k=>Number((k.match(/ (\d+)bb\|/)||[])[1]),bucket=(c,k)=>c.buckets?c.buckets.find(b=>b.depth===depth(k)):c;
 const step=args.step===''?null:Number(args.step),prior=args.prior&&fs.existsSync(args.prior)?read(args.prior):null;
 if(step!==null&&!(step>0&&step<=1))throw Error('--step must be in (0, 1].');
 // The previous round's entry for a line, only what solve.cjs needs to work its factors out again.
 const before=k=>{const e=prior&&bucket(prior,k)?.spots?.[k];return e?.measured?.length?{measured:e.measured,...e.step!==undefined?{step:e.step,prior:e.prior}:{}}:undefined;};
 for(const [k,list]of lines){
  // A set keeps one fit per depth; the line goes into its own depth's bucket.
  const target=bucket(cal,k);if(!target){console.log(`${k}: no ${depth(k)}bb fit in ${args.base}, skipped`);continue;}
  target.spots=target.spots||{};const e={...target.spots[k],measured:list.slice(-keep)};delete e.step;delete e.prior;delete e.probeCap;if(Number(args.probecap)>1)e.probeCap=Number(args.probecap);
  if(step!==null&&step<1){e.step=step;const p=before(k);if(p)e.prior=p;}
  target.spots[k]=e;
 }
 fs.writeFileSync(args.out,JSON.stringify(cal));
 console.log(`Wrote ${args.out}: measured shares on ${lines.size} lines${step!==null&&step<1?`, damped ${step}${prior?' from '+args.prior:' from the formula'}`:''} (${[...lines.values()].reduce((s,l)=>s+Math.min(keep,l.length),0)} measurements).`);
}

function moved(){
 const Lib=require('../postflop/library.cjs'),P=require('../../studio/preflop.js'),old=read(args.old).packs,now=read(args.new).packs;
 const ids=args.spots.split(',').flatMap(id=>id==='per-spot-6max'?Lib.PER_SPOT_6MAX:id==='per-spot'?Lib.PER_SPOT:[id]),n=P.classes.map(c=>c.length===2?6:c[2]==='s'?4:12);
 const tv=(a,b)=>{let A=0,B=0,d=0;for(let i=0;i<n.length;i++){A+=(a[P.classes[i]]||0)*n[i];B+=(b[P.classes[i]]||0)*n[i];}if(!A||!B)return 1;for(let i=0;i<n.length;i++)d+=Math.abs((a[P.classes[i]]||0)*n[i]/A-(b[P.classes[i]]||0)*n[i]/B);return d/2;};
 const out=[];
 for(const id of ids){let a,b;try{a=Lib.prepare(id,old);b=Lib.prepare(id,now);}catch{continue;}
  const d=Math.max(tv(a.rangeIp,b.rangeIp),tv(a.rangeOop,b.rangeOop));if(d>Number(args.threshold))out.push(id);console.error(`${id.padEnd(16)} ${(100*d).toFixed(1)}%`);}
 console.log(out.join(','));
}

function settle(){
 const P=require('../../studio/preflop.js'),pick=f=>{const p=read(f);return P.validate(p.packs?p.packs.find(x=>x.name.startsWith(args.chart+' ')):p);},a=pick(args.old),b=pick(args.new);
 const n=P.classes.map(c=>c.length===2?6:c[2]==='s'?4:12),N=n.reduce((x,y)=>x+y,0),th=Number(args.threshold),K=n.length;let max=0,maxKey='',sum=0,count=0;
 const row=(node,i)=>{const A=node.actions.length;return node.table?Array.from(node.table.subarray(i*A,i*A+A),v=>v/1000):node.actions.map((_,x)=>node.strategy[P.classes[i]]?.[x]||0);};
 for(const na of a.nodes){const nb=b.index.get(na.key);if(!nb||!((na.reach??1)>=.01)||nb.actions.length!==na.actions.length)continue;let d=0;
  for(let i=0;i<K;i++){const ra=row(na,i),rb=row(nb,i);for(let x=0;x<ra.length;x++)d+=Math.abs(ra[x]-rb[x])*n[i]/N/2;}
  sum+=d;count++;if(d>max){max=d;maxKey=na.key;}}
 console.log(`settle: ${count} nodes, mean change ${(100*sum/Math.max(1,count)).toFixed(2)}%, largest ${(100*max).toFixed(2)}% at ${maxKey}`);
 process.exit(count&&max<th?0:1);
}
// A side's mean share over its whole solved range, by combos.
function whole(m,side){const n=c=>c.length===2?6:c[2]==='s'?4:12,own=side==='ip'?m.rangeIp:m.rangeOop;let w=0,x=0;for(const [c,v]of Object.entries(m[side])){const r=own[c]||0;w+=r*n(c);x+=r*n(c)*v;}return w?x/w:NaN;}
function compare(){
 const n=c=>c.length===2?6:c[2]==='s'?4:12,A=new Map(measurements(args.a).map(m=>[m.chart+'|'+m.key,m])),sum={};
 const kind=key=>['limp/srp','srp','3-bet','4-bet','5-bet'][Math.min(4,(key.match(/:raise:/g)||[]).length)];
 for(const b of measurements(args.b)){const a=A.get(b.chart+'|'+b.key);if(!a)continue;
  for(const side of ['ip','oop']){
   const own=side==='ip'?a.rangeIp:a.rangeOop,oppB=side==='ip'?b.rangeOop:b.rangeIp,oppA=side==='ip'?a.rangeOop:a.rangeIp;let wa=0,sa=0,sb=0,wj=0,sj=0,extra=0,tot=0;
   for(const [c,w]of Object.entries(own))if(w>=.05&&a[side][c]>0&&b[side][c]>0){wa+=w*n(c);sa+=w*n(c)*a[side][c];sb+=w*n(c)*b[side][c];}
   for(const [c,x]of Object.entries(b[side]))if(!(own[c]>=.005)){wj+=n(c);sj+=n(c)*x;}
   for(const [c,w]of Object.entries(oppB)){tot+=w*n(c);if(!(oppA[c]>=.005))extra+=w*n(c);}
   if(!wa)continue;const k=kind(b.key),row={a:sa/wa,b:sb/wa,junk:wj?sj/wj:NaN,extra:extra/tot,whole:whole(b,side)};
   (sum[k+' '+side]=sum[k+' '+side]||[]).push(row);
   console.log(`${k.padEnd(8)} ${side.padEnd(3)} ${(b.id||'').padEnd(16)} in-range ${row.a.toFixed(3)} -> ${row.b.toFixed(3)}  extra classes ${isNaN(row.junk)?'  -  ':row.junk.toFixed(3)}  extra share of opp range ${(100*row.extra).toFixed(1)}%  whole range ${row.whole.toFixed(3)}`);
  }}
 console.log('\nMeans by pot type and side:');
 for(const [k,rows]of Object.entries(sum)){const m=f=>rows.reduce((s,r)=>s+(isNaN(r[f])?0:r[f]),0)/rows.filter(r=>!isNaN(r[f])).length;console.log(`${k.padEnd(14)} ${rows.length} lines: in-range ${m('a').toFixed(3)} -> ${m('b').toFixed(3)}, extra classes ${m('junk').toFixed(3)}, extra opp range ${(100*m('extra')).toFixed(1)}%, whole range ${m('whole').toFixed(3)}`);}
 console.log('A side\'s whole-range mean share; ip and oop of one line should add to about 1 (zero-sum flop), up to card removal.');
}

if(require.main===module){
 if(args.cmd==='extract'){const m=extract(args.work,args.chart),buf=Buffer.from(JSON.stringify(m));fs.writeFileSync(args.out,/\.gz$/.test(args.out)?zlib.gzipSync(buf):buf);console.log(`Wrote ${args.out}: ${m.length} lines, ${m.reduce((s,x)=>s+x.flops,0)} flops.`);}
 else if(args.cmd==='fit')fit();
 else if(args.cmd==='moved')moved();
 else if(args.cmd==='compare')compare();
 else if(args.cmd==='settle')settle();
 else console.log(fs.readFileSync(__filename,'utf8').split('\n').slice(2,24).join('\n'));
}
module.exports={extract};
