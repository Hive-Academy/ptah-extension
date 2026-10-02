import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('D:/projects/ptah-extension/package.json');
export const { chromium } = require('@playwright/test');
const MIME = {'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.map':'application/json','.wasm':'application/wasm'};
export function serve(root) {
  const base = fs.existsSync(path.join(root,'browser')) ? path.join(root,'browser') : root;
  const s = http.createServer((req,res)=>{
    let p = decodeURIComponent(req.url.split('?')[0]); if (p==='/') p='/index.html';
    let f = path.join(base,p);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(base,'index.html');
    res.setHeader('content-type', MIME[path.extname(f)]||'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r=>s.listen(0,'127.0.0.1',()=>r({url:`http://127.0.0.1:${s.address().port}`,close:()=>s.close()})));
}
// fixtures: method -> data | function(params)
export async function setup(ctx, { theme, fixtures }) {
  await ctx.addInitScript(({theme, fixtures}) => {
    try { if (theme) localStorage.setItem('ptah-theme', theme); } catch(e){}
    window.__out = [];
    window.__fx = fixtures;
    let acquired=false;
    window.acquireVsCodeApi = () => { if (acquired) throw new Error('twice'); acquired=true;
      let st;
      const api = { postMessage(msg){ window.__out.push(msg); (window.__log=window.__log||[]).push([Math.round(performance.now()), msg&&msg.type, msg&&msg.payload&&msg.payload.method, msg&&msg.payload&&msg.payload.correlationId]);
          if (msg && msg.type==='rpc:call' && msg.payload && msg.payload.method) {
            const {method, correlationId, params} = msg.payload;
            const fx = window.__fx[method];
            if (fx !== undefined) {
              const data = typeof fx==='string' && fx.startsWith('@fn:') ? (0,eval)('('+fx.slice(4)+')')(params) : fx;
              queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'rpc:response',correlationId,success:true,data}})));
            }
          } },
        getState(){return st;}, setState(s){st=s;} };
      window.vscode = api; return api; };
    window.acquireVsCodeApi();
    window.ptahConfig = { isVSCode:!fixtures.__electron, isElectron:!!fixtures.__electron, theme:'dark', extensionUri:'', baseUri:'', iconUri:'', userIconUri:'', panelId:'vr', platform:'win32', initialView:'chat', workspaceRoot:'C:\\ws', workspaceName:'ws' };
  }, {theme, fixtures});
}
export const inject = (page, msg) => page.evaluate(m => window.dispatchEvent(new MessageEvent('message',{data:m})), msg);
