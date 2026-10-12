const { chromium } = require('playwright-core');
(async()=>{
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = b.contexts()[0].pages()[0];
await p.getByText('Analytics',{exact:true}).first().click();
await p.waitForTimeout(2500);
const r = await p.evaluate(()=>({hs:[...document.querySelectorAll('h1,h2,h3,h4,h5')].map(h=>h.tagName+': '+h.innerText.trim().slice(0,60)), lists:[...document.querySelectorAll('ul,ol')].map(u=>u.className.slice(0,80)+' | '+u.children.length)}));
console.log(JSON.stringify(r,null,1));
await p.screenshot({path:'probe.png'});
await b.close();
})();
