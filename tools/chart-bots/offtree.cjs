#!/usr/bin/env node
'use strict';
// Off-tree probe: bet sizes and depths the charts were not solved for, fed through the app's
// own mapping code, to find gaps (no answer), crashes, sharp jumps between neighbouring sizes,
// and answers that hand the bettor a free profit.
//  1. Preflop open sizes (2bb to all-in): each responder's answer via PokerPreflop.query and
//     then PokerPreflop.nearest, which maps a raise to the chart's closest size within 1.6x.
//  2. Preflop 3-bet sizes, answered by the opener.
//  3. Flop bet sizes (5% of the pot to all-in) through PokerPostflopLibrary's walk(), which maps
//     a bet between solved sizes pseudo-harmonically (clamped at the ends), and aggregate() for the
//     answering range as the app serves it (PokerPostflopLibrary.price): between two solved sizes its
//     fold share lies on the line between theirs, above the largest it tightens toward MDF up to the
//     all-in's fold share, below the smallest it widens by the bluff break-even ratio.
//  4. Depths with no chart (30bb, 70bb, 130bb ...): the whole preflop strategy the app serves
//     there (via nearest) is written into that depth's own game, and its NashConv measured in
//     the chart model. Exact charts score about 0.0004 bb/hand. The same probe at a depth that has a
//     chart is the control: the app must serve that chart, so it must score the chart's own claimed
//     NashConv (within CONTROL_FACTOR x claim + CONTROL_SLACK) and every row written must be the chart's
//     stored row, or the run fails (exit 1).
// "Auto-profit" compares how often everyone folds with the share a pure bluff needs to break
// even (risk / (risk + pot)); above it, raising any two cards at that size wins outright.
// On the flop that share is not a bound: the bettor's weakest hands are worth something checked
// (they see a turn), so a solved defence may fold more, and the libraries do, by up to 15 points at
// their own solved sizes. So a flop size the library was not solved for is flagged only when it folds
// more over the break-even share than the solved sizes on either side of it do (as the preflop sweeps
// compare with the chart's own size). A solved size 10 or more points over is listed as "solved
// over-fold": the library's own answer, which tools/postflop/balance-check.cjs warns about at 10 and
// stops grading at 25.
//   node tools/chart-bots/offtree.cjs [--library ...] [--quick] [--calibration file] [--jobs 4] [--out dir]
//        [--kinds open,3bet,flop,depth] [--seats 6] [--depths 20,100] [--modes cash]   (the last three filter the preflop probes)
const path=require('path'),L=require('./lib.cjs'),C=require('./coverage.cjs');
const {G,P,PL}=L;
// Own-chart control: 14 bundled charts (2 to 9 seats, 10 to 1000bb, cash and MTT) served through the app all
// score within 0.0002 bb/hand of their claim, which is the claim's rounding. Before November 2026 the probe
// itself broke this (0.22 against 0.0004 at 6-max 100bb), which hid what the no-chart depths really score.
const CONTROL_FACTOR=1.5,CONTROL_SLACK=0.0005;

function reference(packs,hand){
 try{for(const pack of packs){const q=P.query(pack,hand);if(q)return{q,exact:true};}const q=P.nearest(packs,hand);return q?{q,exact:false}:null;}
 catch(e){return{error:e.message};}
}
// Range-wide answer at a hand's decision: combo-weighted fold / call / raise shares over the 169
// classes, and which share got no answer.
function rangeAnswer(packs,hand,weights=null){
 const out={fold:0,call:0,raise:0,none:0,errors:0,mapped:null,exact:0};let total=0;
 for(const [ci,cls] of P.classes.entries()){
  const x=hand.clone(),cards=L.cardsFor(cls,[]);if(!cards)continue;x.holes[hand.actor]=cards;
  const w=L.comboWeight(cls)*(weights?weights[ci]:1);if(!(w>0))continue;const r=reference(packs,x);total+=w;
  if(!r){out.none+=w;continue;}if(r.error){out.errors+=w;out.none+=w;continue;}
  if(r.exact)out.exact+=w;if(r.q.sizeMatch)out.mapped=r.q.sizeMatch.map(m=>m.actual+'→'+m.chart).join(',');if(r.q.depthMatch?.depthDiffers)out.depth=r.q.depthMatch.chart;
  r.q.actions.forEach((a,i)=>{const p=r.q.reference[i]||0;out[a.kind==='check'?'call':a.kind==='fold'?'fold':a.kind==='call'?'call':'raise']+=w*p;});
 }
 for(const k of ['fold','call','raise','none','errors','exact'])out[k]/=total;
 const answered=1-out.none;if(answered>0)for(const k of ['fold','call','raise'])out[k]/=answered;
 return out;
}
const fold=(h)=>{const l=h.legal();h.act(l.check?{kind:'check'}:{kind:'fold'});};

// 1 and 2: sweeps of one raise size, answered by every later seat in turn (all fold before it).
function sweep(packs,cfg,{opener,threeBettor=null,sizes,label}){
 const n=cfg.seats,rows=[];
 for(const s of sizes){
  const h=new G.Hand(cfg,{rng:G.rng(9)});
  while(h.actor!==opener)fold(h);
  const lo=h.legal();let to;
  let weights=null;
  if(threeBettor===null){to=s==='jam'?lo.allInTo:G.units(s);}else{
   // The opener's range: how often the chart opens each class to 2.5bb here.
   weights=P.classes.map(cls=>{const x=h.clone();x.holes[x.actor]=L.cardsFor(cls,[]);const r=reference(packs,x);if(!r||r.error)return 0;const i=r.q.actions.findIndex(a=>a.kind==='raise'&&a.target===G.units(2.5));return i<0?0:r.q.reference[i]||0;});
   h.act({kind:'raise',target:G.units(2.5)});while(h.actor!==threeBettor)fold(h);const l=h.legal();to=s==='jam'?l.allInTo:G.units(s);}
  const l=h.legal();if(to<l.minRaiseTo||to>l.allInTo)continue;
  const potBefore=G.bb(h.pot),posted=G.bb(h.streetPaid[h.actor]);h.act({kind:'raise',target:to});
  // Each responder, with everyone between folding; the first is enough for 3-bets (the opener).
  const answers=[];let pAllFold=1;const x=h.clone();
  // Against a 3-bet, the players behind fold (the charts' trimmed tree) and the opener answers.
  if(threeBettor!==null)while(!x.done&&x.street===0&&x.actor!==opener)fold(x);
  while(!x.done&&x.street===0&&!(threeBettor===null?false:answers.length)){
   const a=rangeAnswer(packs,x,threeBettor===null?null:weights);a.seat=L.seatName(n,x.actor);answers.push(a);pAllFold*=a.none>.5?NaN:a.fold;
   if(threeBettor!==null)break;fold(x);
  }
  const risk=G.bb(to)-posted,pot=potBefore,be=risk/(risk+pot);
  rows.push({size:s==='jam'?'all-in':s,to:G.bb(to),answers:answers.map(a=>({seat:a.seat,fold:a.fold,call:a.call,raise:a.raise,none:a.none,mapped:a.mapped,exact:a.exact,errors:a.errors})),allFold:pAllFold,breakEven:be,autoProfit:Number.isFinite(pAllFold)?pAllFold-be:null});
 }
 // Flags: gaps, crashes, jumps between neighbouring sizes, auto-profit beyond the chart size's.
 const flags=[],base=rows.find(r=>r.answers[0]?.exact>.5);
 for(let i=0;i<rows.length;i++){const r=rows[i],a=r.answers[0];if(!a)continue;
  if(a.errors>0)flags.push({kind:'crash',size:r.size,text:`${label}: lookup threw at ${r.size}`});
  if(a.none>.5)flags.push({kind:'no answer',size:r.size,text:`${label} to ${r.to}bb: no chart answer for ${a.seat}`});
  const p=rows[i-1]?.answers[0];if(p&&p.none<.5&&a.none<.5){const d=Math.max(Math.abs(a.fold-p.fold),Math.abs(a.raise-p.raise),Math.abs(a.call-p.call));if(d>.10)flags.push({kind:'jump',size:r.size,text:`${label}: ${a.seat}'s answer jumps ${(100*d).toFixed(0)} points between ${rows[i-1].to}bb and ${r.to}bb (fold ${L.pct(p.fold,0)}→${L.pct(a.fold,0)}, call ${L.pct(p.call,0)}→${L.pct(a.call,0)}, raise ${L.pct(p.raise,0)}→${L.pct(a.raise,0)})`,delta:d});}
  if(r.autoProfit!==null&&r.autoProfit>0.02&&(!base||r.autoProfit>(base.autoProfit??-1)+0.02))flags.push({kind:'auto-profit',size:r.size,text:`${label} to ${r.to}bb: everyone folds ${L.pct(r.allFold)} but a bluff needs only ${L.pct(r.breakEven)} (margin ${L.pct(r.autoProfit)})${base?`; at the chart's own size the margin is ${L.pct(base.autoProfit)}`:''}`,margin:r.autoProfit});
 }
 return{label,rows,flags};
}

// 3: flop bet sizes for one spot. Sizes under the 1bb minimum bet cannot be made and sizes of the whole stack or
// more are the all-in, so both are skipped; 4x to 13x pot fill the gap up to the all-in in deep pots, so neighbouring
// rows are neighbouring prices.
const FLOP_MIN_BET=100,FLOP_OVER=.05,FLOP_BEYOND=.02,FLOP_SOLVED_OVER=.10;
function flopSweep(spot,o){
 const keys=Object.keys(spot.flops),pick=keys.filter((_,i)=>i%Math.max(1,Math.floor(keys.length/(o.quick?4:12)))===0).slice(0,o.quick?4:12);
 const fracs=[.05,.1,.15,.2,.25,.3,.33,.4,.5,.6,.66,.75,.85,1,1.25,1.5,2,2.5,3,4,6,9,13,'jam'].filter(fr=>fr==='jam'||Math.round(fr*spot.pot)>=FLOP_MIN_BET&&Math.round(fr*spot.pot)<spot.stack),rows=[],flags=[];
 const size=r=>r.fraction==='jam'?'all-in':Math.round(100*r.fraction)+'%';
 for(const line of [{name:'IP bets after a check',pre:[{kind:'check'}]},{name:'OOP leads',pre:[]}]){
  for(const fr of fracs){
   const agg={fold:0,call:0,raise:0,n:0,none:0,substituted:0,mapped:new Set()};
   for(const k of pick){const flop=spot.flops[k],amount=fr==='jam'?spot.stack:Math.round(fr*spot.pot);
    let w;try{w=PL.walk(flop,Object.assign([...line.pre,{kind:'bet',amount,allIn:fr==='jam'}],{pot:spot.pot,stack:spot.stack}),1,FLOP_MIN_BET);}catch(e){w=null;agg.error=e.message;}
    if(!w||!w.node){agg.none++;continue;}
    // The answering range as the app serves it: walk's result prices the node from the solved sizes around the real one.
    const a=PL.aggregate(spot,flop,w.path,w);if(!a){agg.none++;continue;}
    agg.n++;if(w.substituted)agg.substituted++;agg.mapped.add(w.path.split('/').pop());
    a.actions.forEach((x,i)=>{const kind=x==='FOLD'?'fold':x==='CALL'?'call':'raise';agg[kind]+=a.freq[i];});
   }
   const n=agg.n||1,alpha=fr==='jam'?spot.stack/(spot.stack+spot.pot):fr/(1+fr);rows.push({line:line.name,fraction:fr,answered:agg.n/pick.length,solved:agg.n>0&&!agg.substituted,fold:agg.fold/n,call:agg.call/n,raise:agg.raise/n,mappedTo:[...agg.mapped].map(b=>{const c=+b.split(' ')[1];return b.split(' ')[0]+' '+(Math.round(100*c/spot.pot))+'%';}),alpha,over:agg.fold/n-alpha});
  }
  const lr=rows.filter(r=>r.line===line.name);
  for(let i=0;i<lr.length;i++){const r=lr[i];
   if(r.answered<.5)flags.push({kind:'no answer',text:`${spot.label}, ${line.name} ${size(r)==='all-in'?'all-in':size(r)+' pot'}: no library answer (${L.pct(1-r.answered,0)} of sampled flops)`});
   else if(r.solved){if(r.over>FLOP_SOLVED_OVER)flags.push({kind:'solved over-fold',text:`${spot.label}, ${line.name} ${size(r)==='all-in'?'all-in':size(r)+' pot'} (a solved size): folds ${L.pct(r.fold)} where a bluff needs ${L.pct(r.alpha)} folds`,margin:r.over});}
   else{
    // The solved sizes on either side (answered ones); r.near is the larger of their margins over the break-even share.
    const ok=x=>x.solved&&x.answered>=.5,lo=lr.slice(0,i).reverse().find(ok),hi=lr.slice(i+1).find(ok);r.near=Math.max(lo?lo.over:-1,hi?hi.over:-1);
    if(r.over>FLOP_OVER&&r.over>r.near+FLOP_BEYOND)flags.push({kind:'auto-profit',text:`${spot.label}, ${line.name} ${size(r)} pot: answered as ${r.mappedTo.join('/')}, folds ${L.pct(r.fold)} but a bluff needs only ${L.pct(r.alpha)} folds (margin ${L.pct(r.over)}; the solved sizes around it are at most ${L.pct(r.near)} over)`,margin:r.over});}
   const p=lr[i-1];if(p&&p.answered>=.5&&r.answered>=.5&&Math.abs(r.fold-p.fold)>.1)flags.push({kind:'jump',text:`${spot.label}, ${line.name}: fold share jumps ${L.pct(p.fold,0)}→${L.pct(r.fold,0)} between ${size(p)} and ${size(r)}${size(r)==='all-in'?'':' pot'}`});
  }
 }
 return{spot:spot.id,label:spot.label,tree:spot.tree,flops:pick,rows,flags};
}

// 4: the strategy the app serves at a depth with no chart, in that depth's own game. Two copies
// of the charts are asked: the app's own (which withholds off-path nodes and hands that almost
// never reach a node) for the unanswered rate, and an unfiltered copy (every stored row served)
// for the strategy, so the NashConv measures the depth and size mapping itself rather than the
// withheld rows. The same probe at a depth that has its own chart is the control. The game is
// that chart's own (read from its text, as the other bots do) when the depth has a chart, and
// otherwise the one library.cjs would solve there with the --calibration file, if one is given.
function unfiltered(lib,metas){return metas.map(m=>{const pack=L.P.validate(L.loadPack(lib,m).raw);for(const n of pack.nodes){n.offPath=false;n.path=null;}return pack;});}
// The control's verdict: null when the depth has no chart. rowsOff counts the rows (a hand class at a decision)
// written from the app's answer that are not the chart's stored row; it must be 0 whatever the model. The NashConv
// is not comparable when the chart states none, or is calibrated and its calibration file was not given (the
// rebuilt game is then not the chart's).
function control(model,nashConv,rowsOff=0){
 if(!model)return null;const comparable=model.claimedNashConv!==null&&!model.approximate,limit=model.claimedNashConv===null?null:+(CONTROL_FACTOR*model.claimedNashConv+CONTROL_SLACK).toFixed(4);
 return{comparable,rowsOff,limit,ok:!rowsOff&&(!comparable||nashConv<=limit)};
}
function depthProbe(lib,packs,raw,seats,depth,format,calibration=null){
 const own=L.selectPacks(lib,{games:'nlh',modes:format,seats:String(seats),depths:String(depth)}).find(m=>!m.rake),spec={seats,stack:depth,format,game:'nlh',limp:1,calibration},model=own?L.modelOptions(L.loadPack(lib,own).raw,{calibration}):null,opts=model?model.options:L.E.game(spec),cfg=G.normalize({variant:'NLH',seats,stacks:Array(seats).fill(depth),sb:.5,bb:1,button:0,mode:format==='mtt'?'icm':'cash',...format==='mtt'?{ante:1,anteMode:'bigblind',payouts:[1]}:{}});
 const S=new L.Solver(opts),K=S.K,answered=new Map(),stand=new Map(),served=new Map();let mapped=0,total=0,errors=0,rawMissing=0,moved=0,lost=0,rowsOff=0;const chartRows=own?new Map(L.loadPack(lib,own).raw.nodes.map(n=>[L.hkey(n.history),n])):null;
 for(const node of S.tree.nodes){
  const h=new G.Hand(cfg,{rng:G.rng(4)});let ok=true;
  try{for(const e of node.history)h.act(e.kind==='raise'?{kind:'raise',target:G.units(e.to)}:{kind:e.kind});}catch{ok=false;}
  const A=node.actions.length,got=new Uint8Array(K),hole=new Uint8Array(K),fold=node.actions.findIndex(a=>a.kind==='fold'),pass=node.actions.findIndex(a=>a.kind==='check'||a.kind==='call');node.sum.fill(0);
  for(let i=0;i<K;i++){
   let r=null,u=null;if(ok&&h.actor===node.actor){const x=h.clone();x.holes[node.actor]=L.cardsFor(P.classes[i],[]);r=reference(packs,x);u=reference(raw,x);}
   total++;if(r&&!r.error)got[i]=1;if(r?.error||u?.error)errors++;
   if(!u||u.error){rawMissing++;hole[i]=1;continue;}
   if(!u.exact)mapped++;if(!served.has(node.id))served.set(node.id,u.q.actions.map(a=>a.kind==='raise'?'raise '+G.bb(a.target):a.kind).join(', ')+(u.q.sizeMatch?' (sizes '+u.q.sizeMatch.map(m=>m.actual+'→'+m.chart).join(', ')+')':''));
   u.q.actions.forEach((a,j)=>{const p=u.q.reference[j]||0;if(!p)return;let k=-1;
    if(a.kind==='raise'){const raises=node.actions.map((x,y)=>[x,y]).filter(([x])=>x.kind==='raise'),jam=a.target>=h.legal().allInTo;k=(jam?raises.find(([x])=>x.to>=depth-(opts.ante||0)-1e-6):null)?.[1]??raises.sort((v,w)=>Math.abs(Math.log(v[0].to/G.bb(a.target)))-Math.abs(Math.log(w[0].to/G.bb(a.target))))[0]?.[1]??-1;}
    else k=node.actions.findIndex(x=>x.kind===a.kind||(a.kind==='check'&&x.kind==='call')||(a.kind==='call'&&x.kind==='check'));
    // An action this game's tree lacks goes back where it came from, never dropped: dropping it and
    // rescaling the row turned the app's borrowed overcall (a call taken out of the chart's folds at a
    // fold-or-squeeze node) into squeezes, which alone put the own-chart control at 0.22 instead of 0.0004.
    // The call returns to fold; a raise where the tree only lets the seat call all-in is that call.
    if(k<0){k=a.kind==='raise'?pass:fold;moved+=p;}
    if(k>=0)node.sum[k*K+i]+=p;else lost+=p;});
  }
  // Control: every row written must be the chart's own stored row (to its per-mille rounding).
  if(chartRows){const cn=chartRows.get(L.hkey(node.history)),same=cn&&cn.actions.length===A&&cn.actions.every((a,k)=>a.kind===node.actions[k].kind&&(a.kind!=='raise'||Math.abs(a.to-node.actions[k].to)<1e-6));
   for(let i=0;i<K;i++){const row=same?(Array.isArray(cn.strategy)?cn.strategy[i]:cn.strategy[S.m.classes[i]]):null,t=Array.isArray(row)?row.reduce((x,y)=>x+y,0)||1:1;let off=!same||row===undefined||row===null||!!hole[i];
    for(let k=0;k<A&&!off;k++)off=Math.abs(node.sum[k*K+i]-(Number.isInteger(row)?+(row===k):row[k]/t))>1e-6;if(off)rowsOff++;}}
  answered.set(node.id,got);stand.set(node.id,{hole,sum:node.sum.slice(),fold,pass,check:node.actions.findIndex(a=>a.kind==='check')});
 }
 // Rows with no stored answer at all are filled two ways, passive (check or call) and folding
 // (check or fold); the two NashConv numbers bracket what those holes cost.
 const run=passive=>{for(const node of S.tree.nodes){const x=stand.get(node.id);node.sum.set(x.sum);const d=passive?(x.pass>=0?x.pass:Math.max(0,x.fold)):(x.check>=0?x.check:x.fold>=0?x.fold:Math.max(0,x.pass));for(let i=0;i<K;i++)if(x.hole[i])node.sum[d*K+i]=1;}return S.exploitability();};
 const exF=run(false),ex=run(true);
 // Where the served strategy loses: each decision's one-spot gain (every hand class switching to its best
 // action there, everyone else kept on the served strategy), in bb/hand, with the range-wide served mix.
 const av=L.actionValues(S),worst=[];
 for(const node of S.tree.nodes){const rec=av.q.get(node.id),o=av.own.get(node.id);if(!rec||!o)continue;let g=0,m=0;const mix=node.actions.map(()=>0),bestMix=node.actions.map(()=>0);
  for(let i=0;i<K;i++){let b=0;rec.values.forEach((v,k)=>{if(v[i]>rec.values[b][i])b=k;});const w=S.m.weight[i]*o[i];g+=w*(rec.values[b][i]-rec.mix[i]);m+=w;bestMix[b]+=w;node.actions.forEach((_,k)=>mix[k]+=w*rec.sigma[k*K+i]);}
  if(g>1e-4)worst.push({spot:L.spotName(seats,node),key:L.hkey(node.history),gain:+g.toFixed(4),tree:node.actions.map(L.actionText).join(', '),app:served.get(node.id)||'no answer',served:mix.map(x=>+(x/(m||1)).toFixed(3)),best:bestMix.map(x=>+(x/(m||1)).toFixed(3))});}
 worst.sort((a,b)=>b.gain-a.gain);
 let unanswered=0,holes=0;const missing=new Map(),holeSpots=new Map();
 L.E.lineReach(S,(node,reach,line)=>{const got=answered.get(node.id),hole=stand.get(node.id).hole,own=reach[node.actor],w=S.m.weight;let m=0,u=0,hh=0;for(let i=0;i<K;i++){m+=w[i]*own[i];if(!got[i])u+=w[i]*own[i];if(hole[i])hh+=w[i]*own[i];}if(!(m>0))return;const k=L.spotName(seats,node);if(u){const x=line*u/m;unanswered+=x;missing.set(k,(missing.get(k)||0)+x);}if(hh){const x=line*hh/m;holes+=x;holeSpots.set(k,(holeSpots.get(k)||0)+x);}});
 return{seats,depth,format,nodes:S.tree.nodes.length,claimed:model?model.claimedNashConv:null,control:control(model,ex.nashConv,rowsOff),moved,lost,worst:worst.slice(0,12),nashConv:ex.nashConv,nashConvFold:exF.nashConv,gains:ex.gains,holesPer100:100*holes,holeSpots:[...holeSpots].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>[k,+(100*v).toFixed(2)]),unansweredPer100:100*unanswered,noRowShare:rawMissing/total,mappedShare:mapped/total,errors,missing:[...missing].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>[k,+(100*v).toFixed(2)]),hasChart:packs.some(p=>p.config.seats===seats&&Math.max(...p.config.stacks)===depth&&p.config.mode===(format==='mtt'?'icm':'cash'))};
}

function work(lib,item,o){
 const pre=L.selectPacks(lib,{games:'nlh'}),packs=pre.map(m=>L.loadPack(lib,m).pack);
 if(item.kind==='open'||item.kind==='3bet'){const cfg=C.config('NLH',item.seats,item.depth,'cash');return{...item,...sweep(packs,cfg,item)};}
 if(item.kind==='flop'){const libs=L.loadFlops(lib,f=>f.id===item.id&&f.library===item.library);const spot=libs.flatMap(l=>l.spots).find(s=>s.id===item.id);return{...item,...flopSweep(spot,o)};}
 if(item.kind==='depth')return{...item,...depthProbe(lib,packs,unfiltered(lib,pre),item.seats,item.depth,item.format,o.calibration||null)};
}

function items(lib,o){
 const out=[],q=o.quick;
 const opens=[];for(let s=2;s<=6.001;s+=q?.25:.1)opens.push(+s.toFixed(2));opens.push(7,8,10,12,15,20,25,30,35,39,40,45,50,'jam');
 const tables=q?[[6,100],[2,100]]:[[6,100],[2,100],[9,100],[6,40],[6,200]];
 for(const [n,d] of tables){const order=Array.from({length:n},(_,k)=>((n===2?1:2)+1+k)%n);
  for(const opener of order.slice(0,n-1).filter((s,i)=>q?i===order.length-2||s===0:true))out.push({kind:'open',seats:n,depth:d,opener,sizes:opens.filter(s=>s==='jam'||s<d),label:`${n}-max ${d}bb ${L.seatName(n,opener)} opens`});}
 const threes=[];for(let s=5;s<=30.001;s+=q?1:.5)threes.push(+s.toFixed(1));threes.push(35,40,'jam');
 out.push({kind:'3bet',seats:6,depth:100,opener:4,threeBettor:0,sizes:threes,label:'6-max 100bb BTN 3-bets the HJ 2.5bb open'});
 out.push({kind:'3bet',seats:6,depth:100,opener:0,threeBettor:2,sizes:threes,label:'6-max 100bb BB 3-bets the BTN 2.5bb open'});
 out.push({kind:'3bet',seats:2,depth:100,opener:0,threeBettor:1,sizes:threes,label:'HU 100bb BB 3-bets the button 2.5bb open'});
 for(const f of lib.flops.filter(f=>!/plo/.test(f.id)&&(!q||['btn-bb','hu-srp','btn-bb-3bet'].includes(f.id))))out.push({kind:'flop',id:f.id,library:f.library});
 for(const [n,d,fmt] of q?[[6,100,'cash'],[6,30,'cash'],[6,130,'cash']]:[[6,100,'cash'],[6,20,'cash'],[6,30,'cash'],[6,40,'cash'],[6,70,'cash'],[6,130,'cash'],[6,300,'cash'],[2,30,'cash'],[2,70,'cash'],[9,130,'cash'],[6,30,'mtt']])out.push({kind:'depth',seats:n,depth:d,format:fmt});
 const kinds=L.list(o.kinds),seats=L.range(o.seats),depths=L.list(o.depths)?.map(Number),modes=L.list(o.modes);
 return out.filter(x=>(!kinds||kinds.includes(x.kind))&&(x.kind==='flop'||(!seats||seats.has(x.seats))&&(!depths||depths.includes(x.depth))&&(!modes||modes.includes(x.format||'cash'))));
}
// Own-chart controls that scored above their limit: each fails the run.
const failedControls=res=>res.filter(r=>r.kind==='depth'&&r.control&&!r.control.ok);

function report(lib,res){
 const flags=res.flatMap(r=>r.flags||[]),by=k=>flags.filter(f=>f.kind===k);
 let md=`# Off-tree probe (${lib.version})\n\nSizes the charts were not solved for, fed through the app's own mapping (PokerPreflop.nearest for preflop raises, PokerPostflopLibrary walk/aggregate for flop bets). Auto-profit: everyone folds more often than a pure bluff of that size needs (risk / (risk + pot)), so raising any two cards at that size wins before any equity. On the flop a solved defence may fold more than that share (the bettor's weakest hands are worth something checked), so an unsolved flop size is flagged only when it is ${100*FLOP_OVER} points over and more than ${100*FLOP_BEYOND} points further over than the solved sizes on either side of it; a solved size ${100*FLOP_SOLVED_OVER} or more points over is a "solved over-fold", the library's own answer (tools/postflop/balance-check.cjs warns at 10 and stops grading at 25).\n\n`;
 md+=`Flags: ${['no answer','jump','auto-profit','solved over-fold','crash'].map(k=>by(k).length+' '+k).join(', ')}.\n\n`;
 const pre=res.filter(r=>r.kind==='open'||r.kind==='3bet');
 md+=`## Preflop raise sizes\n\n`;
 for(const r of pre){
  const rows=r.rows,gaps=[];let start=null;rows.forEach((x,i)=>{const none=!x.answers[0]||x.answers[0].none>.5;if(none&&start===null)start=x.to;if(!none&&start!==null){gaps.push(start===rows[i-1].to?`${start}`:`${start}-${rows[i-1].to}`);start=null;}});if(start!==null)gaps.push(`${start}-${rows[rows.length-1].to}`);
  md+=`### ${r.label}\n\nNo answer at: ${gaps.length?gaps.join(', ')+' bb':'none'}. First responder's answer by size (fold/call/raise; mapped size):\n\n`;
  const show=rows.filter((x,i)=>i%Math.max(1,Math.floor(rows.length/14))===0||x.size==='all-in'||[2,2.2,2.5,3,3.5,4,4.1,4.5,7.5,10,11,12].includes(x.size));
  md+=L.mdTable(['to bb','first responder','fold','call','raise','mapped','everyone folds','bluff needs'],show.map(x=>{const a=x.answers[0]||{};return[x.to,a.seat||'–',a.none>.5?'no answer':L.pct(a.fold,0),a.none>.5?'':L.pct(a.call,0),a.none>.5?'':L.pct(a.raise,0),a.mapped||(a.exact>.5?'exact':''),Number.isFinite(x.allFold)?L.pct(x.allFold,0):'–',L.pct(x.breakEven,0)];}))+'\n';
 }
 md+=`## Flop bet sizes\n\n`;
 for(const r of res.filter(r=>r.kind==='flop')){
  md+=`### ${r.label}\n\nSolved sizes: flop bet ${r.tree?.flop?.bet?.join('/')}% , raise ${r.tree?.flop?.raise?.join('/')}%; ${r.flops.length} solved flops sampled.\n\n`;
  md+=L.mdTable(['line','bet % pot','answered','mapped to','fold','call','raise','bluff needs'],r.rows.map(x=>[x.line,x.fraction==='jam'?'all-in':Math.round(100*x.fraction),L.pct(x.answered,0),x.mappedTo.join(' ')+(x.solved?' (solved)':''),x.answered?L.pct(x.fold,0):'–',x.answered?L.pct(x.call,0):'–',x.answered?L.pct(x.raise,0):'–',L.pct(x.alpha,0)]))+'\n';
 }
 md+=`## Depths without a chart\n\nThe whole preflop strategy the app serves at that depth (the nearest chart, raise sizes mapped and kept within the table's legal range) written into that depth's own game and measured in the chart model. Rows come from an unfiltered copy of the charts (rows the app withholds as off-path are served too), so NashConv measures the depth and size mapping; a row with a chart of its own is the control: the app must serve that chart, so every row must be the chart's stored row and it must score the chart's claimed NashConv (at most ${CONTROL_FACTOR} x the claim + ${CONTROL_SLACK}); the run fails otherwise. An action the app offers that this depth's tree lacks is not dropped: the borrowed overcall goes back to the fold it was taken from, and a raise where the tree only lets the seat call all-in is that call. Decisions where even the unfiltered charts have no row (lines the stand-in chart's tree lacks) are filled passively (check or call) or by folding (check or fold); the two NashConv numbers bracket what those holes cost. "Unanswered" counts decisions per 100 hands, played along the served strategy, where the app itself gives no chart answer.\n\n`;
 md+=L.mdTable(['table','depth','own chart','NashConv (passive / fold fill)','chart claims','control','largest seat gain','no stored answer /100 hands','app unanswered /100 hands','rows from another depth or size','where the holes are (/100 hands)'],res.filter(r=>r.kind==='depth').map(r=>[`${r.seats}-max ${r.format}`,r.depth,r.hasChart?'yes':'no',`${L.f(r.nashConv,4)} / ${L.f(r.nashConvFold,4)}`,r.claimed===null?'–':L.f(r.claimed,4),!r.control?'–':!r.control.ok?`FAILED (${r.control.rowsOff} rows differ from the chart${r.control.comparable?', NashConv limit '+r.control.limit:''})`:r.control.comparable?'ok':'rows ok; NashConv not comparable (no calibration file)',L.f(Math.max(...r.gains),3),L.f(r.holesPer100,2),L.f(r.unansweredPer100,2),L.pct(r.mappedShare,0),(r.holeSpots.length?r.holeSpots:r.missing).map(([k,v])=>`${k} (${v})`).slice(0,3).join('; ')]))+'\n';
 const bad=failedControls(res);if(bad.length)md+=`**Own-chart control failed** for ${bad.map(r=>`${r.seats}-max ${r.format} ${r.depth}bb (served ${L.f(r.nashConv,4)}, chart claims ${L.f(r.claimed,4)}, ${r.control.rowsOff} rows differ)`).join('; ')}: the app does not serve that chart as solved, or this probe misreads the app's answer. The other rows cannot be trusted until it passes.\n\n`;
 md+=`Where each served strategy loses most: a decision's one-spot gain is what its seat wins there, in bb/hand, by moving every hand class to its best action while everyone else keeps the served strategy. "Served" and "best" are range-wide shares of the tree's actions, in the tree's order.\n\n`;
 for(const r of res.filter(r=>r.kind==='depth'&&r.worst?.length))md+=`### ${r.seats}-max ${r.format} ${r.depth}bb\n\n`+L.mdTable(['decision','one-spot gain','this depth\'s actions','the app offers','served','best'],r.worst.slice(0,6).map(w=>[w.spot,L.f(w.gain,4),w.tree,w.app,w.served.map(x=>L.pct(x,0)).join(' / '),w.best.map(x=>L.pct(x,0)).join(' / ')]))+'\n';
 md+=`## All flags\n\n`+flags.map(f=>`- [${f.kind}] ${f.text}`).join('\n')+'\n';
 return md;
}

async function main(){
 const o=L.parseArgs(process.argv.slice(2),{jobs:4});
 const lib=L.openLibrary(o.library);
 if(o.worker){for(const item of L.workerItems())process.stdout.write(JSON.stringify(work(lib,item,o))+'\n');return;}
 const t=Date.now(),list=items(lib,o),extra=process.argv.slice(2).filter((a,i,arr)=>!['--jobs','--out'].includes(a)&&!['--jobs','--out'].includes(arr[i-1]));
 // Heaviest first, spread over the workers.
 const weight=x=>x.kind==='depth'?50*x.seats:x.kind==='open'?x.sizes.length*x.seats:x.kind==='3bet'?20:10;list.sort((a,b)=>weight(b)-weight(a));
 const res=await L.parallel(__filename,list,o.jobs,extra),order=['open','3bet','flop','depth'];res.sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind));
 const out=o.out||L.defaultOut(lib);
 L.writeOut(out,'offtree',{json:{version:lib.version,library:lib.spec,seconds:(Date.now()-t)/1000,results:res},md:report(lib,res)});
 const flags=res.flatMap(r=>r.flags||[]);
 const controls=res.filter(r=>r.kind==='depth'&&r.control),bad=failedControls(res);
 console.log(`offtree: ${res.length} probes, ${flags.length} flags, own-chart control ${controls.length-bad.length} of ${controls.length} ok, ${((Date.now()-t)/1000).toFixed(0)}s -> ${path.join(out,'offtree.md')}`);
 for(const r of bad)console.error(`offtree: own-chart control FAILED: ${r.seats}-max ${r.format} ${r.depth}bb served through the app scores NashConv ${L.f(r.nashConv,4)}, the chart claims ${L.f(r.claimed,4)} (limit ${r.control.limit}); ${r.control.rowsOff} served rows differ from the chart's.`);
 if(bad.length)process.exitCode=1;
}
module.exports={depthProbe,unfiltered,sweep,flopSweep,rangeAnswer,control,CONTROL_FACTOR,CONTROL_SLACK};
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
