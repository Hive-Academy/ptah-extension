const {launch,OUT}=require('./lib.cjs'); const H=require('./h.cjs'); const fs=require('fs');
async function openMenu(page){ const vis=await page.locator('[role="dialog"][aria-label="Theme"]').first().isVisible().catch(()=>false); if(!vis){ await page.locator('[aria-label="Change theme"]').first().click(); await page.waitForTimeout(400);} }
async function setMotion(page,label){ await openMenu(page); await page.getByRole('tab',{name:'Animation',exact:true}).click(); await page.waitForTimeout(300); await page.getByText(label,{exact:true}).locator('visible=true').first().click({force:true}); await page.waitForTimeout(600); await page.screenshot({path:OUT+'/rm_setting_'+label.replace(/\W+/g,'')+'.png'}); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
(async()=>{
 const MODE=process.env.MODE||'set';
 if(MODE==='set'){ const {app,page}=await launch(true); await setMotion(page,process.env.LABEL||'Reduce motion'); await page.waitForTimeout(800); console.log(fs.readFileSync(process.env.TEMP+'/ptah-stagger-udd/config.json','utf8')); await app.close(); return; }
 const {app,page}=await launch(false); await page.evaluate(H.INS);
 console.log('reduce',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches), await page.evaluate(()=>({theme:document.documentElement.dataset.theme,style:document.documentElement.dataset.motionStyle||null})));
 await page.getByRole('button',{name:/^New session$/}).locator('visible=true').first().click(); await page.waitForTimeout(1200); const cr=page.getByRole('button',{name:/Create/}); if(await cr.count()) await cr.first().click(); await page.waitForTimeout(3000);
 await page.evaluate(()=>window.__insReset());
 const ta=page.locator('textarea').locator('visible=true').first(); await ta.click(); await ta.fill('ok reduce'); const sc=await H.screencast(page,'rm',40); await page.waitForTimeout(200);
 await page.getByRole('button',{name:/Send message/}).click(); await page.waitForTimeout(1500); await sc.stop();
 const d=await H.snapshotIns(page);
 const adds=d.ev.filter(e=>e.k==='add').map(e=>({t:Math.round(e.t),cls:e.cls,i:e.i,tid:e.tid}));
 const act=[]; d.fr.forEach(f=>f.act.forEach(r=>act.push([Math.round(f.t),r[0],r[3],r[4]])));
 const cs=await page.evaluate(()=>{const it=Array.from(document.querySelectorAll('.chat-msg-item')).filter(e=>e.getBoundingClientRect().height>0).pop(); if(!it) return null; const s=getComputedStyle(it); return {dur:s.animationDuration,delay:s.animationDelay,name:s.animationName,cls:it.className};});
 console.log('adds',JSON.stringify(adds),'activeSamples',act.length,JSON.stringify(act.slice(0,6)),'anims',JSON.stringify(d.fr.flatMap(f=>f.an).slice(0,4)),'cs',JSON.stringify(cs));
 await page.screenshot({path:OUT+'/rm_after.png'}); await app.close();
})().catch(e=>{console.error(e.message.slice(0,500));process.exit(1)});
