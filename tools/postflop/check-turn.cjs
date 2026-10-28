#!/usr/bin/env node
'use strict';
// Checks that the app answers turn decisions from a turn file (library.cjs --turn 1, bundle-turn)
// for live hands: suit-permuted boards and turn cards find the solved flop and turn, each main flop
// line reaches its turn nodes, the answer is the stored row for the hero's combo, its actions are
// legal, and carried ranges stay within the chart ranges. Lines the file does not keep (a flop
// raise, a donk bet: the tree has none) get no answer.
//   node tools/postflop/check-turn.cjs --turn postflop-work/turn-btn-bb.ctl --charts preflop-library.json.gz
const fs=require('fs'),zlib=require('zlib');
const G=require('../../studio/game.js'),P=require('../../studio/preflop.js'),Lib=require('../../studio/postflop-library.js'),{SPOTS}=require('./library.cjs'),C=G.Core;
const args={turn:'',charts:require('path').join(__dirname,'charts-100bb.json.gz'),flops:'5'};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
if(!args.turn){console.log('Usage: check-turn.cjs --turn turn-<spot>.ctl --charts preflop-library.json.gz [--flops 5]');process.exit(1);}
const read=f=>{const raw=fs.readFileSync(f);return JSON.parse(/\.gz$/.test(f)?zlib.gunzipSync(raw):raw);};
const file=Lib.readTurn(new Uint8Array(fs.readFileSync(args.turn))),{header}=file,spot={...header.spot,flops:header.flops},charts=read(args.charts),rng=G.rng(98);let pass=0,fail=0;
const ok=(cond,msg)=>{if(cond)pass++;else{fail++;console.log('FAIL '+msg);}};
const def=SPOTS[spot.id],raw=(charts.packs||[charts]).find(p=>p.name.replace(/Citrus Poker/g,'Range Lab')===spot.chart.name.replace(/Citrus Poker/g,'Range Lab'));
if(!def||!raw){console.log('No spot or chart for '+spot.id);process.exit(1);}
const pack=P.validate(raw),packs=[pack];

for(const f of header.flops.slice(0,Number(args.flops))){
 const chunk=JSON.parse(zlib.gunzipSync(file.flop(f)));
 // A real board: the canonical flop under a random suit permutation, and a random turn card.
 const perm=[0,1,2,3].sort(()=>rng()-.5),flop=C.cards(f.key).map(c=>(c&~3)|perm[c&3]);let turnCard;do turnCard=Math.floor(rng()*52);while(flop.includes(turnCard));
 for(const [what,flopLine,turnLine,answers]of [['check-check, root',['check','check'],[],true],['check-check, vs check',['check','check'],['check'],true],['bet-call, root',['bet33','call'],[],true],
  ['check-bet-call, vs check',['check','bet33','call'],['check'],true],['check-bet-call, donk bet',['check','bet33','call'],['bet66'],false],['check-check, vs check-bet',['check','check'],['check','bet66'],true],['bet-raise-call, root',['bet33','raise','call'],[],false]]){
  const h=new G.Hand(pack.config,{runout:[...flop,turnCard],rng:G.rng(7)});
  const proxy=new G.Hand(pack.config,{rng:G.rng(7)});for(const kind of def.steps){const node=pack.index.get(P.historyKey(proxy));if(!node){proxy.act({kind});h.act({kind});continue;}const t=node.actions.filter(a=>a.kind===kind).sort((a,b)=>(a.target||0)-(b.target||0))[0].target;proxy.act({kind,target:t});h.act({kind,target:t});}
  const act=s=>{if(s==='check'||s==='call')return h.act({kind:s});if(s==='raise')return h.act({kind:'raise',target:Math.max(h.legal().minRaiseTo,h.currentBet*3)});const frac={bet33:.33,bet66:.66}[s];h.act({kind:'bet',target:Math.max(h.legal().minRaiseTo,Math.round(h.pot*frac))});};
  try{flopLine.forEach(act);ok(h.street===2,spot.id+' '+f.key+' '+what+': reaches the turn');turnLine.forEach(act);}catch(e){ok(false,spot.id+' '+f.key+' '+what+': '+e.message);continue;}
  const range=P.postflopRanges(packs,h.config,h.actionLog),t=Lib.turnSpot([spot],range,h);ok(t&&t.key===f.key,spot.id+' '+f.key+' '+what+': finds the turn spot and flop');if(!t)continue;
  // Hero: a random combo off the board that the carried range holds.
  const weights=Lib.carry(t,chunk,h);ok(!!weights===answers,spot.id+' '+f.key+' '+what+': '+(answers?'carries ranges':'keeps no ranges past the file'));
  if(!answers){ok(!Lib.queryTurn(t,chunk,range,h),spot.id+' '+f.key+' '+what+': no answer off the kept lines');continue;}if(!weights)continue;
  const hero=h.actor,w=weights[hero];let cards=null;
  for(let i=0;i<5000&&!cards;i++){const j=Math.floor(rng()*w.length);if(w[j]>.05)cards=Lib.COMBOS[j].slice();}
  if(!cards){ok(false,spot.id+' '+f.key+' '+what+': no hero combo');continue;}
  for(const seat of [t.ip,t.oop])ok(weights[seat].every((x,i)=>x>=0&&x<=1+1e-9&&(!x||!h.board.some(c=>Lib.COMBOS[i].includes(c)))),spot.id+' '+f.key+' '+what+': carried weights within the chart, off the board');
  h.holes[hero]=cards;const r=Lib.queryTurn(t,chunk,range,h);
  ok(r&&r.supported,spot.id+' '+f.key+' '+what+': turn answer');if(!r)continue;
  ok(Math.abs(r.reference.reduce((a,b)=>a+b,0)-1)<1e-9,spot.id+' '+f.key+' '+what+': frequencies sum to 1');
  const node=chunk.turn.find(n=>n.path===r.solve.library.line);ok(!!node,spot.id+' '+f.key+' '+what+': answers a stored turn node');
  if(node){const map=Lib.canonical(flop).map,direct=Lib.row(node,Lib.comboIndex(cards.map(c=>(c&~3)|map[c&3])));ok(!direct||node.actions.length!==r.actions.length||direct.every((p,i)=>Math.abs(p-r.reference[i])<1e-9),spot.id+' '+f.key+' '+what+': same row as the stored node');}
  for(const a of r.actions)ok((()=>{try{h.clone().act(a);return true;}catch{return false;}})(),spot.id+' '+f.key+' '+what+': legal action '+a.label);
  // The river after the turn checks through: ranges carry, and only the turn answers turn decisions.
  if(what==='check-check, vs check'){const river=h.clone();try{river.act({kind:'check'});}catch{}if(river.street===3){const tr=Lib.turnSpot([spot],range,river);ok(tr&&Lib.carry(tr,chunk,river),spot.id+' '+f.key+': ranges carry to the river');ok(!Lib.queryTurn(tr,chunk,range,river),spot.id+' '+f.key+': no turn answer on the river');}}
 }
}
console.log(pass+' checks passed, '+fail+' failed.');process.exit(fail?1:0);
