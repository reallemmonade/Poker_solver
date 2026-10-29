(function(root){
 'use strict';
 // Precomputed heads-up flop strategies (tools/postflop/library.cjs). A library
 // holds spots, one per preflop chart line (for example 6-max 100bb, button
 // opens and big blind calls); each spot holds solved flops, stored once per
 // suit-isomorphic flop, with every flop decision node of the solved tree.
 let G=root.PokerGame;
 if(!G&&typeof require==='function'){try{G=require('./hand-engine.js');}catch{G=require('./game.js');}}
 const C=G&&G.Core,FORMAT='range-lab-postflop-library-v1',need=(v,m)=>{if(!v)throw Error(m)};
 // Two-card combos in colex order: index of [a,b] (a<b) is b(b-1)/2+a.
 const COMBOS=[];for(let b=1;b<52;b++)for(let a=0;a<b;a++)COMBOS.push([a,b]);
 const comboIndex=cards=>{const [a,b]=cards[0]<cards[1]?cards:[cards[1],cards[0]];return b*(b-1)/2+a;};
 const PERMS=[];(function permute(a,rest){if(!rest.length)return PERMS.push(a);rest.forEach((x,i)=>permute(a.concat(x),rest.filter((_,j)=>j!==i)));})([],[0,1,2,3]);
 // Suit relabelling that gives the smallest sorted board, so isomorphic flops
 // share a key. map[s] is the canonical suit of real suit s.
 function canonical(board){
  let best=null;
  for(const map of PERMS){const cards=board.map(c=>(c&~3)|map[c&3]).sort((x,y)=>y-x),key=cards.map(C.cardName).join('');if(!best||key<best.key)best={key,cards,map};}
  return best;
 }
 // Rows are stored per combo and action as bytes (0-255, rows sum to about
 // 255); a combo outside the player's range is all zeros.
 const b64=typeof Buffer!=='undefined'?{enc:u=>Buffer.from(u).toString('base64'),dec:s=>new Uint8Array(Buffer.from(s,'base64'))}:{enc:u=>btoa(String.fromCharCode(...u)),dec:s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))};
 function encode(rows,actions,size=COMBOS.length){const out=new Uint8Array(size*actions);for(const [i,row]of rows){let left=255,best=0;row.forEach((p,a)=>{if(p>row[best])best=a;});row.forEach((p,a)=>{if(a===best)return;const q=Math.round(p*255);out[i*actions+a]=q;left-=q;});out[i*actions+best]=Math.max(0,left);}return b64.enc(out);}
 function row(node,index){const A=node.actions.length,t=node.bytes||(node.bytes=b64.dec(node.table));let s=0;const r=[];for(let a=0;a<A;a++){r.push(t[index*A+a]);s+=t[index*A+a];}return s?r.map(x=>x/s):null;}

 function validate(input){
  need(input&&input.format===FORMAT&&Array.isArray(input.spots)&&input.spots.length>0,'Use a Citrus Poker postflop library file.');
  for(const spot of input.spots){
   need(typeof spot.id==='string'&&typeof spot.label==='string'&&spot.chart&&typeof spot.chart.name==='string'&&typeof spot.chart.key==='string','Each library spot needs its preflop chart line.');
   need(Number.isFinite(spot.pot)&&spot.pot>0&&Number.isFinite(spot.stack)&&spot.stack>0&&spot.flops&&typeof spot.flops==='object','Each library spot needs its pot, stack and flops.');
   const plo=spot.game==='PLO4';need(!spot.game||plo,'Unknown library game '+spot.game+'.');
   for(const [key,flop]of Object.entries(spot.flops)){need(/^([2-9TJQKA][cdhs]){3}$/.test(key)&&Array.isArray(flop.nodes)&&flop.nodes.length,'Invalid flop '+key+'.');
    // A PLO flop stores the combos it was solved for, and its tables cover those.
    if(plo)for(const who of ['ip','oop'])need(Array.isArray(flop.combos?.[who])&&flop.combos[who].length&&flop.combos[who].every(c=>/^([2-9TJQKA][cdhs]){4}$/.test(c))&&Array.isArray(flop.weights?.[who])&&flop.weights[who].length===flop.combos[who].length,'Invalid PLO combos in flop '+key+'.');
    for(const n of flop.nodes)need(typeof n.path==='string'&&['ip','oop'].includes(n.player)&&Array.isArray(n.actions)&&n.actions.length>=1&&typeof n.table==='string'&&Math.ceil(n.table.length/4)*3>=(plo?flop.combos[n.player].length:COMBOS.length)*n.actions.length,'Invalid node in flop '+key+'.');}
  }
  return input;
 }

 // Live flop actions as solver labels. Each bet or raise (chips added, scaled to
 // the library's pot) takes the node's nearest size; all-in takes the largest.
 // A size more than 1.5x away from every solved size is no match. Solved bets below the
 // table's minimum bet (small limped pots) count as the minimum bet.
 // With end, a line that ends where the street does (a call, check-check) returns its path with
 // node null.
 function walk(flop,steps,scale,minBet=0,end=false){
  const nodes=new Map(flop.nodes.map(n=>[n.path,n]));let path='',node=nodes.get(''),substituted=false;
  for(const s of steps){
   if(!node)return null;let label=null;
   if(s.kind==='check'||s.kind==='call')label=node.actions.find(a=>a===s.kind.toUpperCase());
   else if(['bet','raise'].includes(s.kind)){
    const options=node.actions.filter(a=>/^(BET|RAISE) /.test(a)).map(a=>({a,amount:a.startsWith('BET ')?Math.max(minBet,parseFloat(a.split(' ')[1])*scale):parseFloat(a.split(' ')[1])*scale}));if(!options.length)return null;
    const jam=Math.max(...options.map(o=>o.amount)),best=s.allIn?options.find(o=>o.amount===jam):options.sort((p,q)=>Math.abs(Math.log(p.amount/s.amount))-Math.abs(Math.log(q.amount/s.amount)))[0];
    if(!best||!s.allIn&&Math.abs(Math.log(best.amount/s.amount))>Math.log(1.5))return null;if(Math.abs(best.amount-s.amount)>Math.max(2,.03*s.amount))substituted=true;label=best.a;}
   if(!label)return null;path+=(path?'/':'')+label;node=nodes.get(path);
  }
  return node||end?{node:node||null,path,substituted}:null;
 }

 // Answers the current flop decision from the library, or returns null. range is
 // PokerPreflop.postflopRanges(...) for this hand; hand is the live PokerGame.Hand.
 // The app was renamed from Range Lab to Citrus Poker; charts and flop libraries built
 // on either side of the rename still pair up (the range key must match too).
 const sameName=(a,b)=>String(a).replace(/Citrus Poker/g,'Range Lab')===String(b).replace(/Citrus Poker/g,'Range Lab');
 function query(libraries,range,hand){
  if(!range||hand.done||hand.street!==1||range.live.length!==2)return null;
  const live=hand.living(),firstAfterButton=i=>(i-hand.button+hand.n)%hand.n||hand.n,[oop,ip]=live.slice().sort((a,b)=>firstAfterButton(a)-firstAfterButton(b));
  // The chart may have been re-solved since a library was built under the same name;
  // only spots whose ranges still match the solved ones answer, so an older library
  // imported alongside does not hide a newer one. Library chips scale to this hand's pot
  // (another open size or depth), as long as the stack-to-pot ratio stays within a
  // factor of 1.5; the spot with the closest ratio is used.
  const potStart=hand.pot-hand.streetPaid.reduce((s,x)=>s+x,0),stack=Math.min(...[ip,oop].map(i=>hand.stacks[i]+hand.streetPaid[i]));
  const spot=pick(libraries.flatMap(l=>l.spots),range,potStart,stack,ip,oop);if(!spot)return null;const scale=potStart/spot.pot;
  const c=canonical(hand.board),hero=hand.holes[hand.actor],candidates=spot.flops[c.key]?[{key:c.key,move:x=>(x&~3)|c.map[x&3]}]:standIns(spot,c.cards).slice(0,8).map(s=>({key:s.key,move:s.move&&(x=>s.move((x&~3)|c.map[x&3]))}));
  const steps=streetSteps(hand,1);
  // A stand-in flop is used only where it holds this decision and, with the
  // hero's cards moved onto it, a strategy for them.
  let flop,key,found,r;
  let similar=null;
  for(const cand of candidates){const f=spot.flops[cand.key],w=f&&walk(f,steps,scale,G.units(hand.config.bb));if(!w||w.node.player!==(hand.actor===ip?'ip':'oop'))continue;const cards=hero.map(cand.move),board=C.cards(cand.key);if(cards.some(x=>x==null||board.includes(x))||new Set(cards).size<cards.length)continue;
   let q=null,near=null;if(spot.game==='PLO4'){const at=ploIndex(f,w.node.player,cards,board,hand.rules);if(at){q=row(w.node,at.index);near=at.similar;}}else q=row(w.node,comboIndex(cards));
   if(q){flop=f;key=cand.key;found=w;r=q;similar=near;break;}}
  if(!r)return null;const standIn=key!==c.key;
  const {actions,probs,index}=libraryActions(hand,found.node,r,scale),handMix=spot.game==='PLO4'?null:{seat:hand.actor,classes:classMix(found.node,index,actions.length)};
  const zeros=actions.map(()=>0),best=probs.indexOf(Math.max(...probs)),spaced=k=>k.replace(/(..)(?=.)/g,'$1 '),board=hand.board.map(C.cardName).join(' '),source='Imported preflop chart: '+range.name;
  return{supported:true,actions,reference:probs,mean:zeros,se:zeros,loss:zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:hand.config.mode==='cash'?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),...handMix?{handMix}:{},
   solve:{version:1,method:'postflop-library',exact:false,approximate:false,iterations:flop.iterations||0,exploitability:flop.exploitability,seconds:0,rangeAssumptions:[{seat:ip,range:'Chart range',source},{seat:oop,range:'Chart range',source}],
    library:{spot:spot.label,flop:key,standIn,line:found.path,sizesMatched:!found.substituted,scale,...similar?{similarCombo:similar,solvedCombos:flop.combos[found.node.player].length}:{}},
    warning:(standIn?'Stand-in flop strategy for '+spot.label+': '+board+' is not in the library, so the nearest solved flop of the same texture, '+spaced(key)+', answers, with your cards moved to match. Treat it as a rough guide. It was':'Precomputed flop strategy for '+spot.label+' on '+spaced(key)+' (the same flop up to suits),')+' solved by '+(spot.game==='PLO4'?'the PLO solver':'TexasSolver')+' for the preflop chart ranges'+(Math.abs(scale-1)>.02?' and scaled to this pot':'')+'.'+(found.substituted?' Your bet sizes differ from the solved sizes, so the nearest solved size stands in.':'')+(similar?' Your hand is not among the '+flop.combos[found.node.player].length+' combos solved for this flop, so the most similar one, '+similar+', answers for it (similar made hand and draws).':'')+(range.rakeFree?' The preflop chart is rake-free, so this table\'s rake is not modelled.':'')+(spot.game==='PLO4'?' Exploitability is measured exactly, in percent of the pot. The library keeps frequencies only, so no decision cost is graded.':' Exploitability is the solver\'s own estimate, in percent of the pot. It reports no action EVs, so no decision cost is graded.')}};
 }

 // Solved flops that can stand in for an unsolved one, nearest first: same suit
 // pattern and pairing, ranked by how far each card and each gap between the
 // cards moves (gaps carry straight draws). cards is a canonical flop, highest
 // first. move(card) carries a card onto the stand-in: board suits and ranks
 // map to the stand-in's, and any other rank keeps its place between the board
 // ranks; null where the stand-in leaves it no room.
 function standIns(spot,cards){
  const shape=cs=>cs.map(x=>cs.map(y=>((x>>2)===(y>>2)?1:0)+((x&3)===(y&3)?2:0)).join('')).join('|'),want=shape(cards),rank=cards.map(x=>x>>2),out=[];
  for(const key of Object.keys(spot.flops)){
   const to=C.cards(key).sort((x,y)=>y-x);if(to.length!==3||shape(to)!==want)continue;const tr=to.map(x=>x>>2);
   let d=0;for(let i=0;i<3;i++)d+=Math.abs(rank[i]-tr[i])+(i<2?Math.abs(rank[i]-rank[i+1]-tr[i]+tr[i+1]):0);
   const suit=[-1,-1,-1,-1];cards.forEach((x,i)=>{suit[x&3]=to[i]&3;});const free=[0,1,2,3].filter(s=>!suit.includes(s));for(let s=0;s<4;s++)if(suit[s]<0)suit[s]=free.shift();
   const fixed=[[13,13],...rank.map((r,i)=>[r,tr[i]]),[-1,-1]];
   const moveRank=r=>{const same=fixed.find(f=>f[0]===r);if(same)return same[1];const hi=fixed.filter(f=>f[0]>r).pop(),lo=fixed.find(f=>f[0]<r);if(hi[1]-lo[1]<2)return null;return Math.min(hi[1]-1,Math.max(lo[1]+1,Math.round(lo[1]+(r-lo[0])*(hi[1]-lo[1])/(hi[0]-lo[0]))));};
   out.push({key,distance:d,move:x=>{const r=moveRank(x>>2);return r==null?null:r*4+suit[x&3];}});
  }
  return out.sort((a,b)=>a.distance-b.distance||(a.key<b.key?-1:1));
 }
 // PLO: the stored combo for the hero's cards, or else the most similar stored
 // combo on this board: the closest made-hand strength (as a share of the stored
 // combos) and number of turn cards that improve the hand category.
 const ploFeatures=new WeakMap();
 function ploIndex(flop,player,cards,board,rules){
  const nameOf=cs=>cs.slice().sort((a,b)=>b-a).map(C.cardName).join(''),list=flop.combos[player];
  // On a board with suit symmetry (4h4d4c, 5d5c3c) several relabellings give the
  // same canonical board, and the solver stored each combo under one of them.
  const key=board.slice().sort((a,b)=>b-a).join();
  for(const map of PERMS){const move=c=>(c&~3)|map[c&3];if(board.map(move).sort((a,b)=>b-a).join()!==key)continue;const exact=list.indexOf(nameOf(cards.map(move)));if(exact>=0)return{index:exact,similar:null};}
  const feature=cs=>{const used=new Set([...cs,...board]),high=G.evaluate(cs,board,rules).high,cat=Math.floor(high/15**5);let outs=0;for(let t=0;t<52;t++)if(!used.has(t)&&Math.floor(G.evaluate(cs,[...board,t],rules).high/15**5)>cat)outs++;return{high,outs};};
  let cache=ploFeatures.get(flop);if(!cache){cache={};ploFeatures.set(flop,cache);}
  const stored=cache[player]||(cache[player]=list.map(n=>feature(C.cards(n)))),me=feature(cards),sorted=stored.map(f=>f.high).sort((a,b)=>a-b),pct=h=>{let lo=0,hi=sorted.length;while(lo<hi){const m=lo+hi>>1;if(sorted[m]<h)lo=m+1;else hi=m;}return lo/sorted.length;};
  const mine=pct(me.high);let best=-1,bestD=Infinity;stored.forEach((f,i)=>{const d=Math.abs(pct(f.high)-mine)+Math.abs(f.outs-me.outs)/40;if(d<bestD){bestD=d;best=i;}});
  return best<0?null:{index:best,similar:list[best].replace(/(..)(?=.)/g,'$1 ')};
 }
 function sameRanges(spot,range,ip,oop){
  if(!spot.rangeIp||!spot.rangeOop||range.game!==(spot.game||'NLH'))return false;
  for(const [seat,solved]of [[ip,spot.rangeIp],[oop,spot.rangeOop]]){const w=range.seats[seat];if(!w)return false;for(let i=0;i<range.labels.length;i++){const now=w[i]>=.005?w[i]:0;if(Math.abs(now-(solved[range.labels[i]]||0))>.02)return false;}}
  return true;
 }
 // Range-weighted action frequencies at one node of a solved flop: each combo
 // counts with its chart weight times the frequency of the acting player's own
 // earlier actions on this line. For flop reports.
 function aggregate(spot,flop,path){
  const nodes=new Map(flop.nodes.map(n=>[n.path,n])),node=nodes.get(path);if(!node)return null;
  const range=node.player==='ip'?spot.rangeIp:spot.rangeOop,steps=path?path.split('/'):[],reach=spot.game==='PLO4'?flop.weights[node.player].slice():COMBOS.map(cs=>range[C.handClass(cs)]||0);
  let at='';for(const label of steps){const n=nodes.get(at);if(n&&n.player===node.player){const a=n.actions.indexOf(label);for(let i=0;i<reach.length;i++)if(reach[i]){const r=row(n,i);reach[i]*=r?r[a]:0;}}at+=(at?'/':'')+label;}
  const total=node.actions.map(()=>0);let mass=0;
  for(let i=0;i<reach.length;i++)if(reach[i]){const r=row(node,i);if(!r)continue;mass+=reach[i];r.forEach((p,a)=>total[a]+=reach[i]*p);}
  return mass?{actions:node.actions,player:node.player,freq:total.map(x=>x/mass)}:null;
 }
 // The two players' seats: out of position first after the button.
 function seats(hand){const live=hand.living(),after=i=>(i-hand.button+hand.n)%hand.n||hand.n,[oop,ip]=live.slice().sort((a,b)=>after(a)-after(b));return{ip,oop};}
 // The spot for this chart line whose ranges still match, closest in stack-to-pot ratio (within 1.5x).
 // Flops of the same spot from other libraries (the flops your Mac learned, see missing) are merged in.
 const merged=new WeakMap();
 function pick(spots,range,potStart,stack,ip,oop){
  const off=s=>Math.abs(Math.log((stack/potStart)/(s.stack/s.pot))),fits=spots.filter(s=>sameName(s.chart.name,range.name)&&s.chart.key===range.key&&sameRanges(s,range,ip,oop)).sort((a,b)=>off(a)-off(b)),spot=fits[0];
  if(!spot||off(spot)>Math.log(1.5))return null;
  const twins=fits.filter(s=>s!==spot&&s.id===spot.id&&Math.abs(s.pot-spot.pot)<=1&&Math.abs(s.stack-spot.stack)<=1);if(!twins.length||Array.isArray(spot.flops))return spot;
  const cached=merged.get(spot);if(cached&&cached.twins.length===twins.length&&cached.twins.every((t,i)=>t===twins[i]&&cached.sizes[i]===Object.keys(t.flops).length))return cached.spot;
  const out={...spot,flops:Object.assign({},...twins.map(t=>t.flops),spot.flops)};merged.set(spot,{twins,sizes:twins.map(t=>Object.keys(t.flops).length),spot:out});return out;
 }
 // The heads-up NLH flop of this hand when its chart line has a library spot but the flop itself
 // (up to suits) was not solved: {spot, key}, for the bridge to solve with the library's own tree.
 function missing(libraries,range,hand){
  if(!range||hand.done||hand.street!==1||range.live.length!==2||range.game!=='NLH')return null;
  const {ip,oop}=seats(hand),potStart=hand.pot-hand.streetPaid.reduce((s,x)=>s+x,0),stack=Math.min(...[ip,oop].map(i=>hand.stacks[i]+hand.streetPaid[i]));
  const spot=pick(libraries.flatMap(l=>l.spots),range,potStart,stack,ip,oop),key=canonical(hand.board).key;
  return spot&&!spot.game&&!spot.flops[key]?{spot,key}:null;
 }
 // One street's actions as walk steps: bets and raises as chips added this street.
 function streetSteps(hand,street){
  const {ip,oop}=seats(hand),steps=[],paid={[ip]:0,[oop]:0};let facing=0;
  for(const a of hand.actionLog.filter(a=>a.street===street)){if(['bet','raise'].includes(a.kind)){steps.push({kind:a.kind,amount:a.target-paid[a.seat],allIn:!!a.allIn});paid[a.seat]=a.target;facing=a.target;}else{steps.push({kind:a.kind});if(a.kind==='call')paid[a.seat]=facing;}}
  return steps;
 }
 // A solved node's actions as this hand's legal actions, with the hero's frequencies r.
 function libraryActions(hand,node,r,scale){
  const legal=hand.legal(),actions=[],probs=[],index=[];
  node.actions.forEach((label,i)=>{const [kind,amount]=label.split(' ');let action;
   if(kind==='FOLD')action={kind:'fold',label:'Fold'};else if(kind==='CHECK')action={kind:'check',label:'Check'};else if(kind==='CALL')action={kind:'call',label:'Call '+G.bb(legal.callCost)+' bb'};
   else{const k=hand.currentBet?'raise':'bet',target=Math.min(legal.allInTo,legal.maxRaiseTo??legal.allInTo,Math.max(legal.minRaiseTo,hand.streetPaid[hand.actor]+Math.round(parseFloat(amount)*scale)));action={kind:k,target,label:(k==='bet'?'Bet ':'Raise to ')+G.bb(target)+' bb'+(target===legal.allInTo?' · all-in':'')};}
   action.id=action.kind+':'+(action.target||0);const same=actions.findIndex(x=>x.id===action.id);index.push(same>=0?same:actions.length);if(same>=0)probs[same]+=r[i];else{actions.push(action);probs.push(r[i]);}});
  return{actions,probs,index};
 }
 // Each hand class's average action mix at a solved node, over its combos the player can hold, in the order of the
 // mapped actions. For the range grid.
 function classMix(node,index,size){
  const sum={},count={};
  COMBOS.forEach((cs,i)=>{const r=row(node,i);if(!r)return;const k=C.handClass(cs),m=sum[k]||(sum[k]=Array(size).fill(0));r.forEach((p,a)=>{m[index[a]]+=p;});count[k]=(count[k]||0)+1;});
  const out={};for(const k in sum)out[k]=sum[k].map(x=>Math.round(x/count[k]*1000)/1000);return out;
 }

 // Turn strategies (tools/postflop/library.cjs --turn 1, then bundle-turn): one file per spot.
 // Bytes: "CTL1", the header length (uint32, little-endian), the header JSON ({format, name,
 // spot, flops: [{key, weight, iterations, exploitability, offset, length}]}), then each flop's
 // gzipped JSON {nodes, turn} at its offset after the header: the flop's decisions and the turn's
 // first decisions on the check-check, bet-call and check-bet-call lines, two actions deep, with
 // paths "<flop line>|<turn card>/<turn actions>". Apps keep the flops apart and unpack one only
 // when a hand of that spot reaches the turn.
 const TURN_FORMAT='range-lab-turn-library-v1';
 function readTurn(bytes){
  const bad='Use a Citrus Poker turn library file (turn-<spot>.ctl).';need(bytes&&bytes.length>8&&String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])==='CTL1',bad);
  const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true);need(8+n<=bytes.length,bad);
  let header;try{header=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+n)));}catch{need(false,bad);}
  const spot=header&&header.spot,base=8+n;need(header.format===TURN_FORMAT&&Array.isArray(header.flops)&&header.flops.length,bad);
  need(spot&&typeof spot.id==='string'&&typeof spot.label==='string'&&spot.chart&&typeof spot.chart.name==='string'&&typeof spot.chart.key==='string'&&Number.isFinite(spot.pot)&&spot.pot>0&&Number.isFinite(spot.stack)&&spot.stack>0&&spot.rangeIp&&spot.rangeOop,'The turn library needs its preflop chart line, pot, stack and ranges.');
  for(const f of header.flops)need(typeof f.key==='string'&&/^([2-9TJQKA][cdhs]){3}$/.test(f.key)&&Number.isInteger(f.offset)&&Number.isInteger(f.length)&&f.offset>=0&&f.length>0&&base+f.offset+f.length<=bytes.length,'The turn library lists a flop outside the file.');
  return{header,flop:f=>bytes.subarray(base+f.offset,base+f.offset+f.length)};
 }
 // The turn spot for a hand on the turn or river: the spot (a turn file's header.spot, with its
 // flops listed as header.flops) whose chart line and ranges match, at the flop's stack-to-pot
 // ratio, and the canonical flop to load. null when no turn file covers this flop.
 function turnSpot(spots,range,hand){
  if(!range||hand.done||hand.street<2||range.live.length!==2||range.game!=='NLH')return null;
  const {ip,oop}=seats(hand),start=G.replay(hand.config,hand.actionLog.filter(a=>a.street===0));
  const spot=pick(spots,range,start.pot,Math.min(start.stacks[ip],start.stacks[oop]),ip,oop);if(!spot)return null;
  const key=canonical(hand.board.slice(0,3)).key,flop=(spot.flops||[]).find(f=>f.key===key);return flop?{spot,flop,key,ip,oop,scale:start.pot/spot.pot}:null;
 }
 // The flop line and turn card of a hand on its solved flop chunk, and the turn's nodes with paths
 // from the turn's start. move carries real cards onto the solved board's suits.
 function turnLine(chunk,hand,scale){
  const minBet=G.units(hand.config.bb),flop=walk({nodes:chunk.nodes},streetSteps(hand,1),scale,minBet,true);if(!flop||flop.node)return null;
  const real=hand.board.slice(0,3),canon=canonical(real).cards.join();
  for(const map of PERMS){const move=x=>(x&~3)|map[x&3];if(real.map(move).sort((a,b)=>b-a).join()!==canon)continue;
   const prefix=flop.path+'|'+C.cardName(move(hand.board[3])),nodes=chunk.turn.filter(n=>n.path===prefix||n.path.startsWith(prefix+'/')).map(n=>({...n,path:n.path===prefix?'':n.path.slice(prefix.length+1)}));
   if(nodes.length)return{flop,prefix,move,turn:{nodes},substituted:flop.substituted};}
  return null;
 }
 // Answers a turn decision from a turn spot (turnSpot) and its flop chunk, or returns null.
 function queryTurn(t,chunk,range,hand){
  if(!t||hand.done||hand.street!==2)return null;const line=turnLine(chunk,hand,t.scale);if(!line)return null;
  const found=walk(line.turn,streetSteps(hand,2),t.scale,G.units(hand.config.bb));if(!found||found.node.player!==(hand.actor===t.ip?'ip':'oop'))return null;
  const cards=hand.holes[hand.actor].map(line.move),r=row(found.node,comboIndex(cards));if(!r)return null;
  const {actions,probs,index}=libraryActions(hand,found.node,r,t.scale),handMix={seat:hand.actor,classes:classMix(found.node,index,actions.length)},zeros=actions.map(()=>0),best=probs.indexOf(Math.max(...probs)),spaced=k=>k.replace(/(..)(?=.)/g,'$1 '),source='Imported preflop chart: '+range.name,substituted=line.substituted||found.substituted;
  return{supported:true,actions,reference:probs,mean:zeros,se:zeros,loss:zeros,lossSE:zeros,best,samples:0,effectiveSamples:0,units:hand.config.mode==='cash'?'bb':'prize units',ignoredPublicActions:0,coverage:1,evidenceCoverage:1,actionCoverage:actions.map(()=>1),handMix,
   solve:{version:1,method:'postflop-library',exact:false,approximate:false,iterations:t.flop.iterations||0,exploitability:t.flop.exploitability,seconds:0,rangeAssumptions:[{seat:t.ip,range:'Chart range',source},{seat:t.oop,range:'Chart range',source}],
    library:{spot:t.spot.label,flop:t.key,turn:line.prefix.split('|')[1],standIn:false,line:line.prefix+(found.path?'/'+found.path:''),sizesMatched:!substituted,scale:t.scale},
    warning:'Precomputed turn strategy for '+t.spot.label+' on '+spaced(t.key)+' '+line.prefix.split('|')[1]+' (the same board up to suits), solved by TexasSolver together with the flop for the preflop chart ranges'+(Math.abs(t.scale-1)>.02?' and scaled to this pot':'')+'.'+(substituted?' Your bet sizes differ from the solved sizes, so the nearest solved size stands in.':'')+(range.rakeFree?' The preflop chart is rake-free, so this table\'s rake is not modelled.':'')+' Exploitability is the solver\'s own estimate for the whole flop solve, in percent of the pot. It reports no action EVs, so no decision cost is graded.'}};
 }
 // Each player's range at this point of the hand, as weights per combo (COMBOS order, real cards):
 // the chart ranges of the solve, narrowed by each player's own flop and turn actions with the
 // solved frequencies. For live solves of later decisions. null when the hand left the solved lines
 // (a turn line deeper than the file keeps).
 function carry(t,chunk,hand){
  if(!t||hand.street<2)return null;const line=turnLine(chunk,hand,t.scale);if(!line)return null;
  let turn={path:''};if(hand.street>=3){turn=walk(line.turn,streetSteps(hand,2),t.scale,G.units(hand.config.bb),true);if(!turn||turn.node)return null;}
  else{const w=walk(line.turn,streetSteps(hand,2),t.scale,G.units(hand.config.bb),true);if(!w)return null;turn=w;}
  const known=new Set(hand.board),weights={},moved=COMBOS.map(cs=>comboIndex(cs.map(line.move)));
  for(const [seat,range]of [[t.ip,t.spot.rangeIp],[t.oop,t.spot.rangeOop]])weights[seat]=Float64Array.from(COMBOS,cs=>known.has(cs[0])||known.has(cs[1])?0:range[C.handClass(cs)]||0);
  const apply=(nodes,path)=>{const map=new Map(nodes.map(n=>[n.path,n]));let at='';for(const label of path?path.split('/'):[]){const n=map.get(at);if(!n)return false;const a=n.actions.indexOf(label),w=weights[n.player==='ip'?t.ip:t.oop];if(a<0)return false;for(let i=0;i<w.length;i++)if(w[i]){const r=row(n,moved[i]);w[i]*=r?r[a]:0;}at+=(at?'/':'')+label;}return true;};
  if(!apply(chunk.nodes,line.flop.path)||!apply(line.turn.nodes,turn.path))return null;
  return weights;
 }
 const api={FORMAT,TURN_FORMAT,COMBOS,comboIndex,canonical,encode,row,validate,query,missing,walk,aggregate,standIns,readTurn,turnSpot,queryTurn,carry};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PokerPostflopLibrary=api;
})(typeof globalThis!=='undefined'?globalThis:this);
