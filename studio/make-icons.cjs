// Renders the chip-slice mark (CITRUS_MARK in interface.js) into full-bleed square home-screen icons.
// Run with Playwright available: node studio/make-icons.cjs. The PNGs are committed; build.cjs copies them.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const base=__dirname,mark=fs.readFileSync(path.join(base,'interface.js'),'utf8').match(/const CITRUS_MARK='([^']*)'/)[1].replace(' class="ui-mark"','');
// Every icon is opaque: the chip's rim touches all four edges and the corners are solid black, so nothing white or see-through is left.
const sizes=[['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['favicon-32.png',32],['favicon-192.png',192]];
(async()=>{const browser=await chromium.launch();
 for(const [name,size]of sizes){const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
  // Crop the 100-unit viewBox to the chip's r=46 circle so it spans the whole tile.
  await page.setContent('<html><body style="margin:0;width:'+size+'px;height:'+size+'px;background:#000;overflow:hidden">'+mark.replace('viewBox="0 0 100 100"','viewBox="4 4 92 92" width="'+size+'" height="'+size+'" style="display:block"')+'</body></html>');
  fs.writeFileSync(path.join(base,name),await page.screenshot({clip:{x:0,y:0,width:size,height:size}}));await page.close();}
 await browser.close();console.log('wrote '+sizes.map(s=>s[0]).join(', '));})();
