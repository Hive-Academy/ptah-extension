// Samples each glass theme's backdrop (page body hidden): brightest and darkest pixel.
const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const { pathToFileURL } = require('url'); const path = require('path'); const fs = require('fs');
const REG = require('./registry.cjs');
(async () => {
  const b = await chromium.launch(); const out = {};
  for (const t of Object.keys(REG)) {
    if (!REG[t].glass) continue;
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(pathToFileURL(path.join(__dirname, 'index.html')).href + '?theme=' + t);
    await p.addStyleTag({ content: 'body{display:none!important}' });
    const buf = await p.screenshot();
    out[t] = await p.evaluate(async (u) => {
      const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
      const x = c.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
      const lum = (r, g, bb) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(bb); };
      let bright = null, bl = -1, dark = null, dl = 2;
      for (let k = 0; k < d.length; k += 28) { const l = lum(d[k], d[k + 1], d[k + 2]); if (l > bl) { bl = l; bright = [d[k], d[k + 1], d[k + 2]]; } if (l < dl) { dl = l; dark = [d[k], d[k + 1], d[k + 2]]; } }
      return { bright, dark };
    }, 'data:image/png;base64,' + buf.toString('base64'));
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname, '_backdrop.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out)); await b.close();
})();
