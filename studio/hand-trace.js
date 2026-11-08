'use strict';
// Hand traces: an invisible log of what the solve and grading code did during each hand. It records which answer each
// decision used and where it came from (chart, flop/turn library, a saved or reused tree, a solve on this device, the
// Mac, a rented server or the cloud), why a solve started, every solve job's status changes and cancellations, whether
// a finished solve was shown, and what each of your decisions was graded against.
// Nothing is shown on screen. Each trace is saved in the account (meta rows "trace-<device>-<slot>", a ring of each
// device's last SLOTS hands) so a bug reported from a screenshot can be read back exactly: node tools/hand-trace.cjs (see CLAUDE.md).
// In a browser console, HandTrace.recent() returns this tab's latest traces.
const HandTrace=(()=>{
 const SLOTS=80,MAX_EVENTS=300,KEEP=10;
 const traces=new Map(),dirty=new Set();let timer=0;
 const slotKey=()=>'guava-trace-slot:'+(citrusAccount.user?.id||'guest');
 function nextSlot(){let n=0;try{n=(Number(localStorage.getItem(slotKey()))||0)+1;localStorage.setItem(slotKey(),String(n));}catch{n=Math.floor(Math.random()*SLOTS);}return n%SLOTS;}
 // Keep each event small: short strings, rounded numbers, a few array items, shallow objects.
 function small(v,depth=0){
  if(v==null||typeof v==='boolean')return v;if(typeof v==='number')return Number.isFinite(v)?Math.round(v*1e4)/1e4:null;if(typeof v==='string')return v.length>200?v.slice(0,200)+'…':v;
  if(typeof v!=='object'||depth>3)return undefined;if(Array.isArray(v))return v.slice(0,24).map(x=>small(x,depth+1));
  const out={};for(const [k,x] of Object.entries(v)){const s=small(x,depth+1);if(s!==undefined)out[k]=s;}return out;
 }
 const idOf=hand=>typeof hand==='string'?hand:hand?.dealId||null;
 const spot=key=>key?hash(String(key)):null;
 function cardText(cards){try{return(cards||[]).map(C.cardName).join('');}catch{return'';}}
 function trace(hand){
  const id=idOf(hand);if(!id)return null;let t=traces.get(id);if(t)return t;
  t={v:1,hand:id,slot:nextSlot(),device:typeof deviceId==='function'?deviceId():'',startedAt:Date.now(),events:[],dropped:0};traces.set(id,t);
  while(traces.size>KEEP)traces.delete(traces.keys().next().value);return t;
 }
 function save(t){dirty.add(t);clearTimeout(timer);timer=setTimeout(flush,2500);}
 function flush(){clearTimeout(timer);timer=0;for(const t of dirty){t.savedAt=Date.now();try{dbPut('meta',{id:'trace-'+(t.device||'x')+'-'+t.slot,value:t}).catch(()=>{});}catch{}}dirty.clear();}
 function log(hand,type,data){
  try{
   const t=trace(hand);if(!t)return;const h=hand&&typeof hand==='object'?hand:null,e={ms:Date.now()-t.startedAt,type};
   if(h&&Array.isArray(h.actionLog)){e.street=h.street;e.step=h.actionLog.length;if(!h.done)e.actor=h.actor;}
   Object.assign(e,small(data||{}));
   // A runaway hand keeps its first events and its latest ones.
   if(t.events.length>=MAX_EVENTS){t.events.splice(60,1);t.dropped++;}t.events.push(e);save(t);
  }catch{}
 }
 function describe(h){
  try{const pos=G.positions(h.n,h.button);return{table:typeof solveTable==='function'?solveTable():'play',variant:h.config?.variant,mode:h.config?.mode,players:h.n,hero:state.hero,heroPosition:pos[state.hero],heroCards:cardText(h.holes?.[state.hero]),stacksBB:(h.initial||h.stacks||[]).map(x=>x/100),friends:!!h.friendRoom};}catch{return{};}
 }
 function deal(h){const t=trace(h);if(!t)return;t.info=small(describe(h));log(h,'deal');}
 function end(h){
  const t=trace(h);if(!t)return;t.info=small({...describe(h),...t.info&&{heroCards:t.info.heroCards}});
  try{t.board=cardText(h.board);const pos=G.positions(h.n,h.button);t.actions=[[],[],[],[]];for(const a of h.actionLog)(t.actions[a.street]||(t.actions[a.street]=[])).push((pos[a.seat]||'seat'+a.seat)+' '+a.kind+(a.target?' '+a.target/100+'bb':'')+(a.allIn?' all-in':''));while(t.actions.length&&!t.actions[t.actions.length-1].length)t.actions.pop();}catch{}
  log(h,'end');flush();
 }
 // Where an answer came from, in a few words.
 function source(result){if(!result)return null;if(!result.supported)return'unsupported';const s=result.solve;return s?.method||s?.source||(result.referenceOnly?'chart':result.reused?'saved':'model');}
 addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
 return{log,deal,end,flush,spot,source,recent:()=>[...traces.values()].reverse(),get:id=>traces.get(id)||null};
})();
