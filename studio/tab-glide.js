// Tab glide: a highlight pill that slides between tabs instead of jumping, like YouTube's phone tab bar.
// With scrub on, you can drag a finger along the bar: the pill follows it, and lifting picks the tab under it.
// A tab bar whose screens swipe (Play's History/Table/Analysis) passes progress(), the fractional tab index from
// the swipe, so the pill moves with the screens as your finger drags them.
function tabGlide(bar,{items,scrub=false,progress=null}){
 const pill=document.createElement('span');pill.className='tab-glide-pill';pill.setAttribute('aria-hidden','true');
 bar.classList.add('has-glide');if(scrub)bar.classList.add('glide-scrub');
 const list=()=>[...bar.querySelectorAll(items)].filter(n=>n.getClientRects().length),
  boxOf=n=>({x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight}),
  place=(b,animate)=>{if(!pill.isConnected)bar.prepend(pill);pill.classList.toggle('instant',!animate);
   pill.style.width=b.w+'px';pill.style.height=b.h+'px';pill.style.transform='translate('+b.x+'px,'+b.y+'px)';pill.style.opacity=b.w?1:0;},
  // A position between tabs i and i+1 blends their boxes, so a pill crossing a wide and a narrow tab changes width smoothly.
  between=(nodes,f)=>{f=Math.max(0,Math.min(nodes.length-1,f));const i=Math.floor(f),t=f-i,a=boxOf(nodes[i]),b=boxOf(nodes[Math.min(nodes.length-1,i+1)]);
   return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,w:a.w+(b.w-a.w)*t,h:a.h+(b.h-a.h)*t};};
 let drag=null,hold=0,swallow=false,shown=false;
 const update=animate=>{if(drag)return;const nodes=list();if(!nodes.length||!bar.getClientRects().length){pill.style.opacity=0;return;}pill.style.borderRadius=getComputedStyle(nodes[0]).borderRadius;
  const f=progress&&Date.now()>hold?progress():null;
  if(f!=null&&isFinite(f)){place(between(nodes,f),false);return;}
  const active=nodes.find(n=>n.classList.contains('active'));if(!active){pill.style.opacity=0;return;}
  place(boxOf(active),animate!==false&&shown);shown=true;};
 // Tabs become active in many places (routes, swipes, taps); watching the class keeps the pill in step with all of them.
 new MutationObserver(records=>{records=records.filter(r=>r.target!==pill);if(!records.length)return;if(records.some(r=>r.type==='childList'&&[...r.addedNodes].some(n=>n!==pill))){shown=false;}update();})
  .observe(bar,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
 if(window.ResizeObserver)new ResizeObserver(()=>update(false)).observe(bar);addEventListener('resize',()=>update(false));
 if(scrub){
  const nearest=(nodes,x)=>{let best=0,dist=Infinity;nodes.forEach((n,i)=>{const d=Math.abs(n.offsetLeft+n.offsetWidth/2-x);if(d<dist){dist=d;best=i;}});return best;},
   localX=e=>e.clientX-bar.getBoundingClientRect().left+bar.scrollLeft,
   hot=(nodes,i)=>nodes.forEach((n,k)=>n.classList.toggle('glide-hot',k===i));
  bar.addEventListener('pointerdown',e=>{if(e.button>0||!e.target.closest(items))return;drag={id:e.pointerId,x0:e.clientX,y0:e.clientY,on:false};},{passive:true});
  bar.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const nodes=list();if(!nodes.length)return;
   if(!drag.on){const dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy))return;drag.on=true;try{bar.setPointerCapture(e.pointerId);}catch{}bar.classList.add('glide-dragging');}
   // The pill's centre rides under the finger, clamped to the first and last tab.
   const x=localX(e),first=nodes[0],last=nodes[nodes.length-1],lo=first.offsetLeft+first.offsetWidth/2,hi=last.offsetLeft+last.offsetWidth/2,c=Math.max(lo,Math.min(hi,x));
   let i=0;while(i<nodes.length-2&&c>nodes[i+1].offsetLeft+nodes[i+1].offsetWidth/2)i++;
   const a=nodes[i].offsetLeft+nodes[i].offsetWidth/2,b=nodes[Math.min(nodes.length-1,i+1)].offsetLeft+nodes[Math.min(nodes.length-1,i+1)].offsetWidth/2,box=between(nodes,i+(b>a?(c-a)/(b-a):0));
   box.x=c-box.w/2;place(box,false);hot(nodes,nearest(nodes,c));});
  const end=(e,cancel)=>{if(!drag||e.pointerId!==drag.id)return;const was=drag.on;drag=null;if(!was)return;
   const nodes=list(),pick=cancel?null:nodes[nearest(nodes,localX(e))];hold=Date.now()+450;swallow=true;setTimeout(()=>swallow=false,350);
   if(pick&&!pick.classList.contains('active'))pick.click();
   bar.classList.remove('glide-dragging');hot(nodes,-1);update(true);};
  bar.addEventListener('pointerup',e=>end(e,false));bar.addEventListener('pointercancel',e=>end(e,true));
  // A scrub ends with the browser's own click on the tab you started on; drop it so only the tab you let go over counts.
  bar.addEventListener('click',e=>{if(swallow&&e.isTrusted){swallow=false;e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 requestAnimationFrame(()=>update(false));
 return{update};
}
