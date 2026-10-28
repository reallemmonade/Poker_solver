// Renders the chip-slice mark (CITRUS_MARK in interface.js) into full-bleed square home-screen icons.
// Run with Playwright available: node studio/make-icons.cjs. The PNGs are committed; build.cjs copies them.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=__dirname,mark=fs.readFileSync(path.join(base,'interface.js'),'utf8').match(/const CITRUS_MARK='([^']*)'/)[1].replace(' class="ui-mark"','');
// Every icon is opaque black to the edges, with the chip centred inside a black border (21% each side); the tiny favicon keeps the chip full size.
const sizes=[['apple-touch-icon.png',180,.58],['icon-192.png',192,.58],['icon-512.png',512,.58],['favicon-32.png',32,1],['favicon-192.png',192,.58]];
(async()=>{const browser=await chromium.launch();
 for(const [name,size,fill]of sizes){const chip=Math.round(size*fill);const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  // Crop the 100-unit viewBox to the chip's r=46 circle, then centre it at `fill` of the tile.
  await page.setContent('<html><body style="margin:0;width:'+size+'px;height:'+size+'px;background:#000;overflow:hidden;display:grid;place-items:center">'+mark.replace('viewBox="0 0 100 100"','viewBox="4 4 92 92" width="'+chip+'" height="'+chip+'" style="display:block"')+'</body></html>');
  fs.writeFileSync(path.join(base,name),await page.screenshot({clip:{x:0,y:0,width:size,height:size}}));await page.close();}
 await browser.close();console.log('wrote '+sizes.map(s=>s[0]).join(', '));})();
