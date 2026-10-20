const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const { pathToFileURL } = require('url');

const url = pathToFileURL(path.join(__dirname, 'start-screen.html')).href;
const linear = n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
const luminance = a => linear(a[0]) * .2126 + linear(a[1]) * .7152 + linear(a[2]) * .0722;
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

(async () => {
  const browser = await chromium.launch({headless:true});
  let failed = false;
  for (const [theme,state,width,selectors] of [
    ['dark','first-run',1440,['.hero h1','.hero p']],
    ['light','first-run',1440,['.hero h1','.hero p']],
    ['dark','running-cap',1440,['.hero h1','.hero p','#block-reason']],
    ['dark','single-chat',280,['.single-brand h1','.single-brand p','.card-head p','.row-state']],
    ['light','single-chat',280,['.single-brand h1','.single-brand p','.card-head p','.row-state']],
    ['light','single-chat-ready',900,['.single-brand h1','.single-brand p']],
  ]) {
    const page = await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
    await page.goto(`${url}?theme=${theme}&state=${state}`);
    if (process.env.AURORA_PHASE) await page.evaluate(phase => {
      for (const layer of document.querySelectorAll('.aurora-lights')) {
        layer.style.setProperty('--phase', phase);
        layer.classList.add('contrast-phase');
      }
      const style=document.createElement('style');
      style.textContent='.contrast-phase::after{animation-delay:var(--phase)!important;animation-play-state:paused!important}';
      document.head.append(style);
    }, `-${process.env.AURORA_PHASE}s`);
    await page.waitForTimeout(450);
    const data = await page.evaluate(selectors => {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d');
      const rgb=value=>{ctx.fillStyle='#000';ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
      return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length).map(e=>{
        const r=e.getBoundingClientRect();const color=rgb(getComputedStyle(e).color);
        e.style.visibility='hidden';
        return {selector,rect:{x:Math.floor(r.x),y:Math.floor(r.y),right:Math.ceil(r.right),bottom:Math.ceil(r.bottom)},color};
      }));
    },selectors);
    const png = await page.screenshot();
    const {data: pixels,info} = await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for (const item of data) {
      let minimum=Infinity,point=null;
      for(let y=Math.max(0,item.rect.y);y<Math.min(info.height,item.rect.bottom);y++) for(let x=Math.max(0,item.rect.x);x<Math.min(info.width,item.rect.right);x++) {
        const i=(y*info.width+x)*3;
        const value=ratio(item.color,[pixels[i],pixels[i+1],pixels[i+2]]);
        if(value<minimum){minimum=value;point=[x,y];}
      }
      const pass=minimum>=4.5;
      console.log(`${theme} ${state} ${item.selector}: ${minimum.toFixed(2)}:1 at ${point} ${pass?'PASS':'FAIL'}`);
      failed ||= !pass;
    }
    await page.close();
  }
  await browser.close();
  if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
