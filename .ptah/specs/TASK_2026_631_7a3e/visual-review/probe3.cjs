const { chromium } = require('playwright-core');
(async()=>{
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = b.contexts()[0].pages()[0];
console.log(await p.evaluate(()=>({ng:typeof window.ng, keys:Object.keys(window.ng||{}), root:!!document.querySelector('[ng-version]'), ver:document.querySelector('[ng-version]')?.getAttribute('ng-version')})));
await b.close();
})();
