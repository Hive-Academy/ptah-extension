const {launch,OUT}=require('./lib.cjs'); const H=require('./h.cjs'); const fs=require('fs');
const COMBOS=JSON.parse(process.env.COMBOS||'[["ptah-glass","Rise"],["ptah-glass","Slide left"],["anubis-light","Rise"],["anubis-light","Slide left"],["anubis","Fade"],["anubis","Rise"],["anubis","Slide left"],["anubis","Slide right"],["anubis","Scale"],["anubis","Direction-aware"]]');
const REDUCE=process.env.REDUCE==='1';
async function openMenu(page){ const vis=await page.locator('[role="dialog"][aria-label="Theme"]').first().isVisible().catch(()=>false); if(!vis){ await page.locator('[aria-label="Change theme"]').first().click(); await page.waitForTimeout(400);} }
async function pickTheme(page,name){ const cat=name.includes('glass')?'glass':name.includes('light')?'light':'dark'; await openMenu(page); await page.getByRole('tab',{name:'Themes',exact:true}).click(); await page.waitForTimeout(200); await page.locator(`[id$="-tab-${cat}"]`).click(); await page.waitForTimeout(250); await page.locator(`.theme-grid button[data-theme="${name}"]`).first().click({force:true}); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
async function pickPreset(page,label){ await openMenu(page); await page.getByRole('tab',{name:'Animation',exact:true}).click(); await page.waitForTimeout(300); await page.locator('ptah-motion-style-picker label',{hasText:label}).first().click({force:true}); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
async function waitIdle(page){ await page.evaluate(()=>{window.__ins.on=false; window.__ins.fr.length=0;}); for(let i=0;i<60;i++){ const n=await page.evaluate(()=>window.__ins.ev.filter(e=>e.k==='add'&&e.tid==='chat-tool-output').length); if(n>=2){ await page.waitForTimeout(2500); return true;} await page.waitForTimeout(2000);} console.log('waitIdle timeout'); return false; }
async function waitIdleOld(page){ for(let i=0;i<90;i++){ await page.waitForTimeout(2000); const w=await page.evaluate(()=>document.body.innerText.includes('Ptah is working')); if(!w) return true; } console.log('waitIdle timeout'); return false; }
async function stopRun(page){ for(let i=0;i<6;i++){ const st=page.locator('[data-testid="chat-stop-btn"], button[aria-label="Stop generating"]').locator('visible=true').first(); if(await st.count()){ await st.click({timeout:3000}).catch(()=>{}); } else { const ex=page.locator('[data-testid="composer-compact-expand"]').locator('visible=true').first(); if(await ex.count()){ await ex.click({timeout:2000}).catch(()=>{}); await page.waitForTimeout(500); continue; } } await page.waitForTimeout(1500); const working=await page.evaluate(()=>document.body.innerText.includes('Ptah is working')); if(!working) return true; } console.log('stopRun: still working'); return false; }
const attrs=(page)=>page.evaluate(()=>({theme:document.documentElement.dataset.theme,glass:document.documentElement.dataset.glass,style:document.documentElement.dataset.motionStyle??null,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches}));
(async()=>{const {app,page}=await launch(!REDUCE);
 await page.evaluate(H.INS);
 const res=[]; console.log('start',JSON.stringify(await attrs(page)), 'chrome', await app.evaluate(()=>process.versions.chrome), 'interp', await page.evaluate(()=>CSS.supports('interpolate-size','allow-keywords')));
 await page.getByRole('button',{name:/^New session$/}).locator('visible=true').first().click(); await page.waitForTimeout(1200); const cr=page.getByRole('button',{name:/Create/}); if(await cr.count()) await cr.first().click(); await page.waitForTimeout(3000);
 let n=0;
 for(const [theme,preset] of COMBOS){ n++;
  let a=await attrs(page); if(a.theme!==theme) await pickTheme(page,theme); await pickPreset(page,preset); a=await attrs(page);
  await page.evaluate(()=>{window.__insReset(); window.__ins.on=true;});
  const ta=page.locator('textarea').locator('visible=true').first(); await ta.click(); await ta.fill('ok '+n);
  const tag=`m${n}_${theme}_${preset.replace(/\W+/g,'')}`; const sc=await H.screencast(page,tag,40); await page.waitForTimeout(200);
  await page.getByRole('button',{name:/Send message/}).click(); await page.waitForTimeout(1300); const fr=await sc.stop();
  const d=await H.snapshotIns(page);
  // find motion of enter items
  const enters=d.ev.filter(e=>e.k==='add'&&/ptah-msg-enter/.test(e.cls));
  const samples={}; d.fr.forEach(f=>f.act.forEach(r=>{ (samples[r[0]]=samples[r[0]]||[]).push([Math.round(f.t),r[3],r[4]]); }));
  const an={}; d.fr.forEach(f=>f.an.forEach(x=>{an[x.name+'#'+x.ix]={...x};}));
  const r={tag,theme,preset,attrs:a,enters:enters.map(e=>({i:e.i,tid:e.tid,t:Math.round(e.t)})),anims:Object.values(an),sampleKeys:Object.keys(samples).slice(-3),sample:Object.values(samples).slice(-1)[0]?.filter((_,i)=>i%3===0).slice(0,12),lt:d.lt,frames:fr.length};
  res.push(r); console.log(JSON.stringify(r).slice(0,900));
  await page.screenshot({path:`${OUT}/${tag}_after.png`}).catch(()=>{});
  await waitIdle(page); const d2=await H.snapshotIns(page); r.all=d2.ev.filter(e=>e.k==='add').map(e=>({t:Math.round(e.t),cls:e.cls.replace(/chat-msg-item.?/,''),i:e.i,tid:e.tid,id:(e.id||'').slice(-6)})); r.leaves=d2.ev.filter(e=>e.k==='remove').length; r.finalLt=d2.lt.length; r.maxLt=Math.max(0,...d2.lt.map(x=>x.d)); console.log('ALL',JSON.stringify(r.all),'leaves',r.leaves,'lt',d2.lt.length,r.maxLt);
 }
 fs.writeFileSync(OUT+`/suite${REDUCE?'_reduce':''}.json`,JSON.stringify(res));
 await app.close();})().catch(e=>{console.error(e.message.slice(0,600));process.exit(1)});
