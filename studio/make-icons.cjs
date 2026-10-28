// Renders the chip-slice mark (CITRUS_MARK in interface.js) into full-bleed square home-screen icons.
// Run with Playwright available: node studio/make-icons.cjs. The PNGs are committed; build.cjs copies them.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=__dirname,mark=fs.readFileSync(path.join(base,'interface.js'),'utf8').match(/const CITRUS_MARK='([^']*)'/)[1].replace(' class="ui-mark"','');
const ground='#1b1c17';
// Home-screen icons get a dark ground to the edges (iOS and Android round the corners themselves); the chip fills ~84% so maskable crops keep it whole.
const sizes=[['apple-touch-icon.png',180,.84],['icon-192.png',192,.84],['icon-512.png',512,.84],['favicon-32.png',32,1]];
(async()=>{const browser=await chromium.launch();
 for(const [name,size,fill]of sizes){const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  const chip=Math.round(size*fill),bg=fill<1?ground:'transparent';
  await page.setContent('<html><body style="margin:0;width:'+size+'px;height:'+size+'px;background:'+bg+';display:grid;place-items:center;overflow:hidden">'+mark.replace('<svg ','<svg width="'+chip+'" height="'+chip+'" style="display:block" ')+'</body></html>');
  fs.writeFileSync(path.join(base,name),await page.screenshot({omitBackground:fill>=1,clip:{x:0,y:0,width:size,height:size}}));await page.close();}
 await browser.close();console.log('wrote '+sizes.map(s=>s[0]).join(', '));})();
