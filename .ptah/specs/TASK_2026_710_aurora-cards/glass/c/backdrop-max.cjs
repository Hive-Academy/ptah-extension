const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const { pathToFileURL } = require('url'); const path = require('path'); const fs=require('fs');
(async () => {
  const b = await chromium.launch(); const out = {};
  for (const t of ['dark','light']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(pathToFileURL(path.join(__dirname,'index.html')).href + (t==='light'?'?theme=light':''));
    await p.addStyleTag({content:'body{display:none!important}'});
    const buf = await p.screenshot();
    const dataUrl = 'data:image/png;base64,'+buf.toString('base64');
    out[t] = await p.evaluate(async (u)=>{ const i=new Image(); i.src=u; await i.decode(); const c=document.createElement('canvas'); c.width=i.width;c.height=i.height; const x=c.getContext('2d'); x.drawImage(i,0,0); const d=x.getImageData(0,0,c.width,c.height).data; let best=null,bl=-1,dark=null,dl=2;
      const lum=(r,g,bb)=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(bb)};
      for(let k=0;k<d.length;k+=4*7){const l=lum(d[k],d[k+1],d[k+2]); if(l>bl){bl=l;best=[d[k],d[k+1],d[k+2]]} if(l<dl){dl=l;dark=[d[k],d[k+1],d[k+2]]}} return {bright:best,dark}; }, dataUrl);
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname,'_backdrop.json'), JSON.stringify(out)); console.log(JSON.stringify(out)); await b.close();
})();
