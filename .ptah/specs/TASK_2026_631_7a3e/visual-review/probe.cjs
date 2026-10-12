const { chromium } = require('playwright-core');
(async()=>{
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = b.contexts()[0].pages()[0];
console.log(await p.title(), p.viewportSize());
const r = await p.evaluate(()=>({w:innerWidth,h:innerHeight,txt:document.body.innerText.slice(0,600), nav:[...document.querySelectorAll('button,a')].map(e=>e.innerText.trim()||e.getAttribute('aria-label')).filter(Boolean).slice(0,40)}));
console.log(JSON.stringify(r,null,1));
await b.close();
})();
