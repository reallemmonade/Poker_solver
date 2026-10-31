// Table sounds, synthesized with Web Audio so there are no sound files to license or download.
// Three sets share the same events. The audio session is "ambient", so iPhones follow the silent switch
// and music from other apps keeps playing. Nothing sounds until the first tap or key press unlocks audio.
const CitrusSounds=(()=>{
 const KEY='citrus-sounds',SETS=[{id:'felt',label:'Felt'},{id:'zest',label:'Zest'},{id:'pop',label:'Pop'}],EVENTS=['deal','board','check','fold','call','bet','raise','allin','win','turn'];
 let ctx=null,out=null,noiseBuffer=null,choice='felt';
 try{const saved=localStorage.getItem(KEY);if(saved==='off'||SETS.some(s=>s.id===saved))choice=saved}catch{}
 function audio(){if(ctx)return ctx;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;try{if(navigator.audioSession)navigator.audioSession.type='ambient'}catch{}
  ctx=new AC();const squash=ctx.createDynamicsCompressor();squash.threshold.value=-14;squash.ratio.value=6;out=ctx.createGain();out.gain.value=.8;out.connect(squash);squash.connect(ctx.destination);
  noiseBuffer=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return ctx;}
 function unlock(force){if(choice==='off'&&!force)return Promise.resolve();const c=audio();if(!c)return Promise.resolve();const ready=c.state==='running'?Promise.resolve():c.resume().catch(()=>{});
  // iOS only starts output after a sound begins inside the gesture itself.
  const s=c.createBufferSource();s.buffer=c.createBuffer(1,1,c.sampleRate);s.connect(c.destination);s.start();return ready;}
 if(typeof window!=='undefined')for(const type of ['pointerdown','touchend','keydown'])window.addEventListener(type,()=>unlock(),{capture:true,passive:true});
 function envelope(t,gain,attack,dur){const g=ctx.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+dur);g.connect(out);return g;}
 function tone(t,{f,to=f,type='sine',dur=.2,gain=.2,attack=.004}){const o=ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(f,t);if(to!==f)o.frequency.exponentialRampToValueAtTime(to,t+dur);o.connect(envelope(t,gain,attack,dur));o.start(t);o.stop(t+dur+.02);}
 function noise(t,{f=2000,to=f,filter='bandpass',q=1,dur=.08,gain=.3,attack=.002}){const s=ctx.createBufferSource(),b=ctx.createBiquadFilter();s.buffer=noiseBuffer;b.type=filter;b.Q.value=q;b.frequency.setValueAtTime(f,t);if(to!==f)b.frequency.exponentialRampToValueAtTime(to,t+dur);s.connect(b);b.connect(envelope(t,gain,attack,dur));s.start(t,Math.random()*.8);s.stop(t+dur+.02);}
 const wobble=(x,k=.06)=>x*(1+(Math.random()*2-1)*k);
 // Cards and chips sound the same in every set. A card is a quick slide, an edge snap and a soft landing on cloth.
 const card=(t,level=1)=>{const g=wobble(level,.12);noise(t,{f:1400,to:4200,q:1.1,dur:.05,gain:.2*g,attack:.018});noise(t+.035,{f:3200,filter:'highpass',dur:.014,gain:.34*g});noise(t+.05,{f:2200,q:.8,dur:.03,gain:.16*g});noise(t+.058,{f:700,filter:'lowpass',dur:.045,gain:.3*g});tone(t+.058,{f:wobble(170),to:90,dur:.04,gain:.08*g})};
 // A clay chip hitting another rings briefly at a few high modes; a stack is a run of hits that settle.
 function chip(t,level=1){const s=ctx.createBufferSource();s.buffer=noiseBuffer;const g=ctx.createGain();g.gain.setValueAtTime(level*3.2,t);g.gain.exponentialRampToValueAtTime(.001,t+.008);s.connect(g);
  for(const [f,q,v] of [[2600,14,.9],[4100,18,.8],[5900,20,.6],[8300,16,.35]]){const b=ctx.createBiquadFilter(),m=ctx.createGain();b.type='bandpass';b.frequency.value=wobble(f,.08);b.Q.value=q;m.gain.value=v;g.connect(b);b.connect(m);m.connect(out)}
  s.start(t,Math.random()*.9);s.stop(t+.03);noise(t,{f:7000,filter:'highpass',dur:.006,gain:.18*level});}
 function stack(t,count,level=1){let at=t,v=level;for(let i=0;i<count;i++){chip(at,v);at+=wobble(i<count-3?.03:.018,.35);v*=i<count-3?wobble(.95,.04):.62}return at}
 const slide=(t,dur=.3,gain=.12)=>noise(t,{f:600,to:1400,q:.6,dur,gain,attack:dur*.4});
 const chips={call:t=>stack(t,4),bet:t=>stack(t,6),raise:t=>stack(stack(t,6)+.09,5,.9)};
 const allinChips=t=>{slide(t,.32,.16);return stack(stack(stack(t+.12,6)+.02,6,.9)+.02,6,.85)},potChips=t=>{slide(t,.55,.14);for(let i=0;i<14;i++)chip(t+.06+i*wobble(.045,.3),wobble(.75,.2));return t+.7};
 // Zest: soft marimba notes.
 const mallet=(t,f,gain=.22,dur=.38)=>{tone(t,{f,dur,gain});tone(t,{f:f*4,dur:dur*.3,gain:gain*.22});tone(t,{f:f*10,dur:.02,gain:gain*.08})};
 const zest={...chips,
  check:t=>{mallet(t,523,.2,.16);mallet(t+.1,523,.16,.16)},
  fold:t=>{noise(t,{f:1800,to:500,q:.8,dur:.2,gain:.16,attack:.02});tone(t,{f:440,to:294,dur:.18,gain:.08})},
  allin:t=>{const end=allinChips(t);[523,659,784,1047].forEach((f,i)=>mallet(end+i*.07,f,.15,.5))},
  win:t=>{potChips(t);[1047,1319,1568,2093].forEach((f,i)=>mallet(t+.1+i*.085,f,.14,.45))},
  turn:t=>{mallet(t,1319,.26,.45);mallet(t+.14,1760,.28,.6)}};
 // Felt: a real table, knocks and cloth.
 const thump=(t,gain=.5)=>{tone(t,{f:150,to:70,dur:.09,gain});noise(t,{f:500,filter:'lowpass',dur:.05,gain:gain*.7})};
 const felt={...chips,
  check:t=>{thump(t);thump(t+.13,.42)},
  fold:t=>{noise(t,{f:1100,to:2600,q:.6,dur:.24,gain:.18,attack:.06});noise(t+.18,{f:2400,filter:'highpass',dur:.03,gain:.2})},
  allin:t=>{thump(allinChips(t)+.02,.5)},
  win:t=>{potChips(t)},
  turn:t=>{tone(t,{f:1568,dur:1.1,gain:.2});tone(t,{f:1568*2.76,dur:.45,gain:.05});tone(t,{f:1568*5.4,dur:.15,gain:.02})}};
 // Pop: playful game blips.
 const blip=(t,f,dur=.07,gain=.07,type='square')=>tone(t,{f,dur,gain,type,attack:.002});
 const pop={...chips,
  check:t=>{blip(t,660,.05);blip(t+.08,660,.05)},
  fold:t=>tone(t,{f:520,to:180,dur:.18,gain:.16,type:'triangle'}),
  allin:t=>{const end=allinChips(t);[523,659,784,1047,1319,1568,2093].forEach((f,i)=>blip(end+i*.045,f,.06,.055));tone(end+.33,{f:2093,dur:.4,gain:.12,type:'triangle'})},
  win:t=>{potChips(t);[784,988,1175].forEach((f,i)=>blip(t+.1+i*.09,f,.08,.06));tone(t+.37,{f:1568,dur:.5,gain:.1,type:'square'});tone(t+.37,{f:1568*1.5,dur:.5,gain:.06,type:'triangle'})},
  turn:t=>{tone(t,{f:988,dur:.12,gain:.16,type:'triangle'});tone(t+.13,{f:1319,dur:.3,gain:.18,type:'triangle'})}};
 const voices={zest,felt,pop};
 // name is one of EVENTS; at delays the sound in seconds; set overrides the saved choice for previews.
 function play(name,{at=0,set=choice,cards=1,gap=.07}={}){if(set==='off'||!voices[set])return false;if(!ctx||ctx.state!=='running')return false;const c=ctx;
  const v=voices[set],t=c.currentTime+.01+Math.max(0,at);
  if(name==='deal'){for(let i=0;i<cards;i++)card(t+i*gap);return true}
  // Board cards: the burn card goes face down first, then the street's cards flip.
  if(name==='board'){card(t,.6);for(let i=0;i<cards;i++)card(t+.14+i*gap);return true}
  if(!v[name])return false;v[name](t);if(name==='turn')try{navigator.vibrate?.([25,60,25])}catch{}return true;}
 // The speaker button turns sounds off and back on to the last set; Settings and every button stay in step.
 let last='felt';try{const l=localStorage.getItem(KEY+'-last');if(SETS.some(s=>s.id===l))last=l}catch{}if(choice!=='off')last=choice;
 function set(id){if(id!=='off'&&!SETS.some(s=>s.id===id))return;choice=id;if(id!=='off')last=id;try{localStorage.setItem(KEY,id);localStorage.setItem(KEY+'-last',last)}catch{}if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('citrus-sounds',{detail:id}));}
 function toggle(){set(choice==='off'?last:'off');if(choice!=='off')unlock().then(()=>play('check'));}
 const ICON='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
 function button(className='btn secondary'){const b=document.createElement('button');b.type='button';b.className=className+' sound-toggle';const paint=()=>{const off=choice==='off';b.innerHTML=ICON+(off?'<path d="M17 9l5 6M22 9l-5 6"/>':'<path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>')+'</svg>';b.setAttribute('aria-pressed',String(!off));b.setAttribute('aria-label',off?'Turn sounds on':'Turn sounds off');b.title=off?'Sounds off':'Sounds on'};paint();b.onclick=toggle;window.addEventListener('citrus-sounds',paint);return b;}
 return{sets:SETS,events:EVENTS,play,set,toggle,button,get choice(){return choice},unlock};
})();
if(typeof window!=='undefined')window.CitrusSounds=CitrusSounds;
