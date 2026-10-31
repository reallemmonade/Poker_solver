// Table sounds, synthesized with Web Audio so there are no sound files to license or download.
// Three sets share the same events. The audio session is "ambient", so iPhones follow the silent switch
// and music from other apps keeps playing. Nothing sounds until the first tap or key press unlocks audio.
const CitrusSounds=(()=>{
 const KEY='citrus-sounds',SETS=[{id:'zest',label:'Zest'},{id:'felt',label:'Felt'},{id:'pop',label:'Pop'}],EVENTS=['deal','check','fold','call','bet','raise','allin','win','turn'];
 let ctx=null,out=null,noiseBuffer=null,choice='zest';
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
 // Zest: soft marimba notes and light chip clinks.
 const mallet=(t,f,gain=.22,dur=.38)=>{tone(t,{f,dur,gain});tone(t,{f:f*4,dur:dur*.3,gain:gain*.22});tone(t,{f:f*10,dur:.02,gain:gain*.08})};
 const clink=t=>{const f=wobble(2700,.1);tone(t,{f,dur:.06,gain:.09});tone(t,{f:f*1.48,dur:.045,gain:.05});noise(t,{f:7000,filter:'highpass',dur:.02,gain:.12})};
 const zest={
  card:t=>noise(t,{f:4200,to:1600,q:.9,dur:.07,gain:.32}),
  check:t=>{mallet(t,523,.2,.16);mallet(t+.1,523,.16,.16)},
  fold:t=>{noise(t,{f:1800,to:500,q:.8,dur:.2,gain:.16,attack:.02});tone(t,{f:440,to:294,dur:.18,gain:.08})},
  call:t=>{clink(t);clink(t+.05);mallet(t+.03,659,.12,.25)},
  bet:t=>{for(let i=0;i<3;i++)clink(t+i*.045);mallet(t+.04,784,.16)},
  raise:t=>{for(let i=0;i<4;i++)clink(t+i*.04);mallet(t+.03,784,.15,.22);mallet(t+.13,988,.17)},
  allin:t=>{for(let i=0;i<9;i++)clink(t+i*.035+Math.random()*.01);[523,659,784,1047].forEach((f,i)=>mallet(t+.1+i*.07,f,.15,.5))},
  win:t=>{for(let i=0;i<7;i++)clink(t+i*.05);[1047,1319,1568,2093].forEach((f,i)=>mallet(t+.06+i*.085,f,.14,.45))},
  turn:t=>{mallet(t,1319,.26,.45);mallet(t+.14,1760,.28,.6)}};
 // Felt: a real table, all cloth, card snaps and clay chips.
 const clack=t=>{const f=wobble(3600,.15);noise(t,{f,q:7,dur:.035,gain:.55});tone(t,{f:wobble(f*.9,.05),dur:.025,gain:.05,type:'triangle'})},
  thump=(t,gain=.5)=>{tone(t,{f:150,to:70,dur:.09,gain});noise(t,{f:500,filter:'lowpass',dur:.05,gain:gain*.7})};
 const felt={
  card:t=>{noise(t,{f:2500,filter:'highpass',dur:.04,gain:.42});noise(t+.008,{f:900,q:.7,dur:.07,gain:.14})},
  check:t=>{thump(t);thump(t+.13,.42)},
  fold:t=>{noise(t,{f:1100,to:2600,q:.6,dur:.24,gain:.18,attack:.06});noise(t+.18,{f:2400,filter:'highpass',dur:.03,gain:.2})},
  call:t=>{clack(t);clack(t+.07)},
  bet:t=>{for(let i=0;i<3;i++)clack(t+i*.06+Math.random()*.012);thump(t+.2,.25)},
  raise:t=>{for(let i=0;i<5;i++)clack(t+i*.05+Math.random()*.012);thump(t+.27,.3)},
  allin:t=>{noise(t,{f:700,to:1500,q:.5,dur:.35,gain:.18,attack:.08});for(let i=0;i<12;i++)clack(t+.08+i*.032+Math.random()*.015);thump(t+.5,.55)},
  win:t=>{noise(t,{f:900,to:1800,q:.5,dur:.6,gain:.14,attack:.1});for(let i=0;i<14;i++)clack(t+.05+i*.045+Math.random()*.02)},
  turn:t=>{tone(t,{f:1568,dur:1.1,gain:.2});tone(t,{f:1568*2.76,dur:.45,gain:.05});tone(t,{f:1568*5.4,dur:.15,gain:.02})}};
 // Pop: playful game blips.
 const blip=(t,f,dur=.07,gain=.07,type='square')=>tone(t,{f,dur,gain,type,attack:.002});
 const pop={
  card:t=>tone(t,{f:900,to:1700,dur:.045,gain:.12,type:'triangle'}),
  check:t=>{blip(t,660,.05);blip(t+.08,660,.05)},
  fold:t=>tone(t,{f:520,to:180,dur:.18,gain:.16,type:'triangle'}),
  call:t=>{blip(t,880,.06,.06);blip(t+.07,1175,.08,.06)},
  bet:t=>{tone(t,{f:520,to:1040,dur:.12,gain:.06,type:'square'});blip(t+.12,1319,.08)},
  raise:t=>[659,880,1175].forEach((f,i)=>blip(t+i*.065,f,.07)),
  allin:t=>{[523,659,784,1047,1319,1568,2093].forEach((f,i)=>blip(t+i*.045,f,.06,.055));tone(t+.33,{f:2093,dur:.4,gain:.12,type:'triangle'})},
  win:t=>{[784,988,1175].forEach((f,i)=>blip(t+i*.09,f,.08,.06));tone(t+.27,{f:1568,dur:.5,gain:.1,type:'square'});tone(t+.27,{f:1568*1.5,dur:.5,gain:.06,type:'triangle'})},
  turn:t=>{tone(t,{f:988,dur:.12,gain:.16,type:'triangle'});tone(t+.13,{f:1319,dur:.3,gain:.18,type:'triangle'})}};
 const voices={zest,felt,pop};
 // name is one of EVENTS (or 'card'); at delays the sound in seconds; set overrides the saved choice for previews.
 function play(name,{at=0,set=choice,cards=1,gap=.07}={}){if(set==='off'||!voices[set])return false;if(!ctx||ctx.state!=='running')return false;const c=ctx;
  const v=voices[set],t=c.currentTime+.01+Math.max(0,at);
  if(name==='deal'){for(let i=0;i<cards;i++)v.card(t+i*gap);return true}
  if(!v[name])return false;v[name](t);if(name==='turn')try{navigator.vibrate?.([25,60,25])}catch{}return true;}
 function set(id){if(id!=='off'&&!SETS.some(s=>s.id===id))return;choice=id;try{localStorage.setItem(KEY,id)}catch{}}
 return{sets:SETS,events:EVENTS,play,set,get choice(){return choice},unlock};
})();
if(typeof window!=='undefined')window.CitrusSounds=CitrusSounds;
