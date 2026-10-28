'use strict';
// Shared by the main app (inlined before interface.js) and the friends page (/looks.js).
// Looks from the Off My Plate app: each pairs a neutral family (ground, panel, ink, muted, rule; light and dark)
// with an accent and the glow colours behind the top of the page. Text colours are moved, keeping their hue,
// until they reach 4.5:1 on the ground and the panel, so every look stays readable. "Classic" is the original green.
const citrusLooks=(()=>{
 const NEUTRALS={slate:{light:['#f3f5fa','#ffffff','#111733','#4f5775','#dde1ee'],dark:['#0a0f1e','#121a30','#e6e9f5','#a3abc8','#232d4a']},lavender:{light:['#f6f4fc','#ffffff','#1d1838','#544c74','#e5e0f3'],dark:['#100d1c','#1a162c','#eeeafb','#b5aed2','#2d2746']},plum:{light:['#fbf6f4','#ffffff','#2a1830','#62506a','#eee2e2'],dark:['#150f24','#211836','#f6eef5','#c7b6cd','#352a4e']},paper:{light:['#faf8f4','#ffffff','#1f1c17','#5a5449','#ebe6dc'],dark:['#14120f','#1e1b17','#f3efe7','#b8b0a2','#302b25']}};
 const list=[{id:'marigold',label:'Marigold',accent:'#a64b00',accentDark:'#ffb547',neutrals:'paper',glow:['#ffc94d','#ffa37a','#ff8fa3']},{id:'lavender-aurora',label:'Lavender Aurora',accent:'#a28ff2',neutrals:'lavender',glow:['#c4b5fd','#93c5fd','#fda4af']},{id:'ember-aurora',label:'Ember Aurora',accent:'#c2410c',accentDark:'#ff8a57',neutrals:'plum',glow:['#ffab66','#93b9ff','#ff7b72']},{id:'aurora',label:'Aurora',accent:'#1c9a86',neutrals:'slate',glow:['#a7f3d0','#bae6fd','#fed7aa']},{id:'nightshift',label:'Night Shift',accent:'#2f54eb',accentDark:'#7d95ff',neutrals:'slate',glow:['#2f54eb','#7d95ff']},{id:'rosewater',label:'Rosewater',accent:'#3a5bd9',accentDark:'#8ea6ff',neutrals:'lavender',glow:['#ff9fb2','#7fa3ff','#ffd0d8']},{id:'classic',label:'Classic green'}];
 // Status colours carried over from the original theme, re-checked against each look's surfaces.
 const STATUS={light:{gold:'#83560f',blue:'#225d84',red:'#a8361f'},dark:{gold:'#e5c38c',blue:'#92c7df',red:'#f09b88'}};
 const rgb=h=>{const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255]},hex=c=>'#'+c.map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
 const lum=h=>{const c=rgb(h).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]},contrast=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const mix=(a,b,t)=>{const A=rgb(a),B=rgb(b);return hex(A.map((v,i)=>v+(B[i]-v)*t))};
 // Moves a colour toward white or black (whichever the backgrounds need) until it reaches 4.5:1 on all of them.
 const reach=(h,bgs,up)=>{let c=h;for(let i=1;i<=40&&bgs.some(bg=>contrast(c,bg)<4.5);i++)c=mix(h,up?'#ffffff':'#000000',i/40);return c};
 const onColor=bg=>contrast('#ffffff',bg)>=contrast('#17132a',bg)?'#ffffff':'#17132a';
 function tokens(look,light){
  const [ground,panel,ink,muted,rule]=NEUTRALS[look.neutrals][light?'light':'dark'],surfaces=[ground,panel],up=!light;
  // The accent is also text on its own tint (active tabs) and on notices, so it is checked there too.
  const raw=light?look.accent:look.accentDark||look.accent,surface=light?mix(ground,panel,.6):mix(ground,panel,.45),notice=mix(panel,STATUS[light?'light':'dark'].gold,light?.12:.14),softOf=a=>mix(panel,a,light?.13:.2);
  let accent=raw;for(let i=0;i<3;i++)accent=reach(accent,[...surfaces,surface,notice,softOf(accent)],up);const on=onColor(accent),fill=contrast(on,accent)>=4.5?accent:reach(accent,[on],on!=='#ffffff'),st=STATUS[light?'light':'dark'];
  const glow=look.glow.map(g=>light?g+'73':mix(g,ground,.45)+'59');
  return{'--bg':ground,'--panel':panel,'--panel2':mix(panel,rule,.6),'--line':light?mix(rule,ink,.12):mix(rule,ink,.08),'--ink':ink,'--muted':muted,'--green':accent,'--gold':reach(st.gold,surfaces,up),'--blue':reach(st.blue,surfaces,up),'--red':reach(st.red,surfaces,up),
   '--accent-fill':fill,'--accent-on':on,'--accent-soft':softOf(accent),'--accent-edge':mix(panel,accent,.5),'--surface':surface,'--field':light?'#ffffff':mix(ground,panel,.3),'--track':light?rule:mix(rule,ground,.2),
   '--notice':notice,'--notice-good':mix(panel,accent,light?.1:.14),'--glow1':glow[0],'--glow2':glow[1]||glow[0],'--glow3':glow[2]||glow[1]||glow[0]};
 }
 const names=Object.keys(tokens(list[0],true));
 function apply(id,light){const root=document.documentElement,look=list.find(l=>l.id===id)||list[0];
  for(const n of names)root.style.removeProperty(n);
  if(look.id==='classic'){delete root.dataset.look;return}
  root.dataset.look=look.id;const t=tokens(look,light);for(const n of names)root.style.setProperty(n,t[n]);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>m.setAttribute('content',t['--bg']));}
 // Table felts: Citrus is a deep felt in the look's accent, Night the dark app background with an accent rail,
 // Paper the light app background; each carries the look's glow at the top like the page. Classic is the original green.
 const FELTS=[{id:'citrus',label:'Citrus'},{id:'night',label:'Night'},{id:'paper',label:'Paper'},{id:'classic',label:'Classic green'}];
 const rgba=(h,a)=>{const c=rgb(h);return'rgba('+c.join(',')+','+a+')'};
 function felt(id,kind){const look=list.find(l=>l.id===id)||list[0];
  if(kind==='classic'||look.id==='classic'&&kind!=='night'&&kind!=='paper')return{bg:'radial-gradient(ellipse at 50% 40%,#245b4d,#123a30)',rail:'#50483b',edge:'#81735a',ink:'#e9eddb',slot:'#aac8b52e',turn:'#f3d18d',shadow:'#001a1599',back1:'#233f57',back2:'#2f5165'};
  const n=NEUTRALS[look.neutrals||'paper'],bright=look.accentDark||look.accent||'#e5c38c',glow=look.glow||[],[dGround,dPanel,dInk]=n.dark,[lGround,lPanel,lInk,,lRule]=n.light,at=['85% 40% at 12% 0%','75% 36% at 92% 0%','60% 30% at 55% -6%'],glows=(f,k=3)=>glow.slice(0,k).map((g,i)=>'radial-gradient('+at[i]+','+f(g)+',transparent 70%),').join(''),centre=(a,b)=>'radial-gradient(ellipse 95% 70% at 50% 46%,'+a+','+b+')';
  if(kind==='night')return{bg:glows(g=>rgba(mix(g,dGround,.4),.42))+centre(mix(dPanel,bright,.07),dGround),rail:mix(dPanel,bright,.5),edge:rgba(bright,.55),ink:dInk,slot:rgba(dInk,.14),turn:bright,shadow:'#00000080',back1:mix(bright,'#000000',.5),back2:mix(bright,'#000000',.3)};
  if(kind==='paper')return{bg:glows(g=>rgba(g,.5))+centre(lPanel,mix(lGround,lRule,.5)),rail:mix(lRule,lInk,.16),edge:rgba(lInk,.12),ink:lInk,slot:rgba(lInk,.16),turn:look.accent||'#83560f',shadow:'#281e0a2e',back1:mix(look.accent||bright,'#000000',.25),back2:look.accent||bright};
  return{bg:glows(g=>rgba(g,.22),2)+centre(mix(bright,'#0c0b0a',.6),mix(bright,'#060505',.83)),rail:mix(bright,'#000000',.72),edge:rgba(mix(bright,'#ffffff',.2),.5),ink:'#f6f1e7',slot:'#ffffff24',turn:mix(bright,'#ffffff',.3),shadow:'#00000073',back1:mix(bright,'#000000',.55),back2:mix(bright,'#000000',.38)};
 }
 function applyFelt(id,kind){const root=document.documentElement,f=felt(id,FELTS.some(x=>x.id===kind)?kind:'citrus');root.dataset.felt=FELTS.some(x=>x.id===kind)?kind:'citrus';for(const k in f)root.style.setProperty('--felt-'+k,f[k]);}
 return{list,apply,tokens,contrast,felts:FELTS,felt,applyFelt,fallback:'marigold'};
})();
if(typeof module!=='undefined')module.exports=citrusLooks;
