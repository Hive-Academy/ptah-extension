const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { _electron } = require('@playwright/test');

const root = path.resolve(__dirname, '../../../../');
const entry = path.join(root, 'dist/apps/ptah-electron/main.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-attention-visual-'));
const log = { entry, temp, port: 9347, shots: [], checks: {}, errors: [] };
let app;
let pid;
const portFree = () => new Promise(resolve => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(9347, '127.0.0.1', () => server.close(() => resolve(true)));
});
const item = (kind, n) => ({
  key: `visual-${kind}-${n}`, generation: 1, kind, source: 'visual',
  workspacePath: 'C:/work/ptah', workspaceName: 'ptah', sessionId: 'visual-session',
  severity: kind === 'failure' ? 'error' : kind === 'warning' ? 'warning' : 'info',
  title: kind === 'permission' || kind === 'lane-permission' ? 'Permission needed' :
    kind === 'question' ? 'Question needs your answer' : kind === 'failure' ? 'Voice provider failed' : 'Git status is unavailable',
  context: kind === 'permission' || kind === 'lane-permission' ? 'Claude · Bash' :
    kind === 'question' ? 'Claude · Which option should I use?' : 'Please try again',
  actions: kind === 'permission' || kind === 'lane-permission'
    ? [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'open', label: 'Open session' }]
    : kind === 'question' ? [{ id: 'open', label: 'Open session' }]
    : kind === 'warning' ? [{ id: 'retry', label: 'Retry' }] : [{ id: 'open', label: 'Open session' }],
  actionable: true, soundEligible: false,
});
async function service(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('ptah-notification-snackbar, ptah-notification-center')) {
      const ctx = el.__ngContext__;
      window.__attentionVisualDebug = { ng:typeof window.ng, contextType:typeof ctx, contextArray:Array.isArray(ctx), keys:Object.keys(el).filter(k=>k.includes('ng')) };
      if (!Array.isArray(ctx)) continue;
      for (const value of ctx) if (value?.notifications?.upsert && value?.notifications?.needsYou) {
        window.__attentionVisualService = value.notifications;
        return true;
      }
    }
    return false;
  });
}
async function reset(page) {
  await page.evaluate(() => {
    const svc = window.__attentionVisualService;
    if (!svc) return;
    for (const entry of [...svc.needsYou(), ...svc.recentNotices()]) svc.resolve(entry.key);
  });
}
async function inject(page, kinds) {
  await reset(page);
  await page.evaluate(items => { for (const x of items) window.__attentionVisualService.upsert(x); }, kinds.map((k, i) => item(k, i)));
  await page.waitForTimeout(150);
}
async function shot(page, theme, state) {
  const file = path.join(__dirname, `${theme}-${state}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log.shots.push({ theme, state, file, dataTheme: await page.locator('[data-theme]').first().getAttribute('data-theme').catch(() => null) });
}
async function checks(page, tag) {
  log.checks[tag] = await page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
    const cards = [...document.querySelectorAll('.snackbar-card')].map(box);
    const composer = document.querySelector('textarea, [contenteditable="true"]');
    const tabs = document.querySelector('[role="tablist"]');
    const intersects = (a,b) => a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true});
    const parse = s => {try{context.clearRect(0,0,1,1);context.fillStyle=s;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].slice(0,3);}catch{return null;}};
    const lum = c => c.map(v => { v/=255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4; }).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>{ if(!a||!b)return null; const x=lum(a),y=lum(b);return +(Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    const bg = e => { for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c&&!c.includes(', 0)')&&!c.includes(',0)')&&c!=='transparent')return c;}return 'rgb(255,255,255)'; };
    const contrast = [...document.querySelectorAll('.snackbar-card p, #ptah-notification-center-panel p, #ptah-notification-center-panel h2, #ptah-notification-center-panel h3')].filter(e=>e.textContent.trim()).map(e=>({text:e.textContent.trim().slice(0,45),color:getComputedStyle(e).color,background:bg(e),ratio:ratio(parse(getComputedStyle(e).color),parse(bg(e)))}));
    const panel=document.querySelector('#ptah-notification-center-panel');
    return { dataTheme:document.querySelector('[data-theme]')?.getAttribute('data-theme'), horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
      cards, panel:panel&&box(panel), composer:composer&&box(composer), tabs:tabs&&box(tabs), composerOverlap:cards.some(c=>intersects(c,composer&&box(composer))), tabOverlap:cards.some(c=>intersects(c,tabs&&box(tabs))), contrast };
  });
}
async function main() {
  if (!fs.existsSync(entry)) throw Error(`Built entry missing: ${entry}`);
  if (!(await portFree())) throw Error('Port 9347 occupied before launch');
  const env = { ...process.env, HOME:temp, USERPROFILE:temp, APPDATA:path.join(temp,'AppData/Roaming'), LOCALAPPDATA:path.join(temp,'AppData/Local'), PTAH_DB_PATH:path.join(temp,'state.sqlite'), PTAH_NO_DEVTOOLS:'1', NODE_ENV:'test' };
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(env.APPDATA, {recursive:true}); fs.mkdirSync(env.LOCALAPPDATA, {recursive:true});
  app = await _electron.launch({ args:[entry, `--user-data-dir=${path.join(temp,'profile')}`, '--remote-debugging-port=9347'], env, timeout:90000 });
  pid = app.process().pid;
  const page = await app.firstWindow();
  await page.waitForURL(u=>u.protocol==='file:'&&u.pathname.endsWith('/renderer/index.html'), {timeout:90000});
  await page.locator('[data-testid="notification-center-bell"]').waitFor({timeout:90000});
  log.checks.shellControls = await page.evaluate(()=>({themeToggles:document.querySelectorAll('ptah-theme-toggle').length,buttons:[...document.querySelectorAll('button,[role="button"]')].slice(0,35).map(e=>({label:e.getAttribute('aria-label'),title:e.getAttribute('title'),text:e.textContent.trim().slice(0,35)}))}));
  await page.setViewportSize({width:1440,height:900});
  for (const theme of ['dark','light']) {
    const name = theme === 'dark' ? 'anubis' : 'anubis-light';
    const themeToggle = page.locator('ptah-theme-toggle');
    if (await themeToggle.count()) {
      await themeToggle.locator('[aria-label="Change theme"]').click();
      await themeToggle.locator(`button[data-theme="${name}"]`).click();
    } else {
      await page.evaluate(n=>localStorage.setItem('ptah-theme',n),name);
      await page.reload();
    }
    await page.waitForTimeout(500);
    const actual = await page.locator('[data-theme]').first().getAttribute('data-theme').catch(()=>null);
    if (actual !== name) { log.errors.push(`${theme}: theme mechanism yielded ${actual}`); continue; }
    await shot(page,theme,'baseline');
    const bell = page.locator('[data-testid="notification-center-bell"]');
    if (await bell.count()) {
      await bell.click(); await shot(page,theme,'panel-empty'); await checks(page,`${theme}-panel-empty`);
      await page.locator('[data-testid="notification-center-panel"] h2').focus();
      await page.keyboard.press('Escape'); await page.waitForTimeout(50);
      log.checks[`${theme}-escape`] = {closed:await page.locator('[data-testid="notification-center-panel"]').count()===0,focusBell:await bell.evaluate(el=>document.activeElement===el)};
    }
    const available = await service(page);
    log.checks[`${theme}-injectionAvailable`] = available;
    log.checks[`${theme}-injectionDebug`] = await page.evaluate(()=>window.__attentionVisualDebug);
    if (!available) continue;
    for (const [state,kinds] of [['permission',['permission']],['question',['question']],['lane',['lane-permission']],['stack',['permission','question','lane-permission','permission','question']],['failure',['failure']],['bell-badge',['permission']],['panel',['permission','question','failure']],['git-warning',['warning']]]) {
      await inject(page,kinds);
      if (state==='panel') await bell.click();
      await shot(page,theme,state);
      await checks(page,`${theme}-${state}`);
      if (state==='panel') await page.keyboard.press('Escape');
    }
    await inject(page,['permission','question','lane-permission','permission','question']);
    await page.setViewportSize({width:800,height:700});
    await shot(page,theme,'800'); await checks(page,`${theme}-800`);
    await page.setViewportSize({width:1440,height:900});
  }
}
(async()=>{try{await main();}catch(e){log.errors.push(String(e.stack||e));}finally{
  if(app) await app.close().catch(e=>log.errors.push(`close: ${e}`));
  if(pid){try{execFileSync('taskkill',['/T','/PID',String(pid),'/F'],{stdio:'ignore'});}catch{}}
  log.portFreeAfter=await portFree();
  try{fs.rmSync(temp,{recursive:true,force:true});log.tempRemoved=!fs.existsSync(temp);}catch(e){log.errors.push(`cleanup: ${e}`);}
  fs.writeFileSync(path.join(__dirname,'capture-results.json'),JSON.stringify(log,null,2));
  process.stdout.write(JSON.stringify({shots:log.shots.length,checks:Object.keys(log.checks).length,errors:log.errors,portFreeAfter:log.portFreeAfter,tempRemoved:log.tempRemoved})+'\n');
}})();
