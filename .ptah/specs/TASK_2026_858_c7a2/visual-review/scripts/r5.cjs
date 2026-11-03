const {launch,OUT}=require('./lib.cjs'); const H=require('./h.cjs'); const fs=require('fs');
const THEME=process.env.THEME||'anubis-light'; const TAG=process.env.TAG||'r4';
async function openMenu(page){ const vis=await page.locator('[role="dialog"][aria-label="Theme"]').first().isVisible().catch(()=>false); if(!vis){ await page.locator('[aria-label="Change theme"]').first().click(); await page.waitForTimeout(400);} }
async function pickTheme(page,name){ const cat=name.includes('glass')?'glass':name.includes('light')?'light':'dark'; await openMenu(page); await page.getByRole('tab',{name:'Themes',exact:true}).click(); await page.waitForTimeout(200); await page.locator(`[id$="-tab-${cat}"]`).click(); await page.waitForTimeout(250); await page.locator(`.theme-grid button[data-theme="${name}"]`).first().click({force:true}); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
async function done(page,max=75){ await page.waitForTimeout(2500); for(let i=0;i<max;i++){ const ok=await page.evaluate(()=>/Orchestrator\s*(done|idle)/i.test(document.body.innerText)); if(ok){ await page.waitForTimeout(1500); return true;} await page.waitForTimeout(2000);} return false; }
async function send(page,text){ const ta=page.locator('textarea').locator('visible=true').first(); await ta.click(); await ta.fill(text); await page.getByRole('button',{name:/Send message/}).click(); }
const SAMPLER=`(()=>{ window.__rw={fr:[],on:true}; const loop=()=>{ if(!window.__rw.on) return; const sc=Array.from(document.querySelectorAll('.chat-scroll-content')).find(e=>e.getBoundingClientRect().height>0)||null; const scr=sc&&sc.parentElement; const items=sc?Array.from(sc.querySelectorAll(':scope > .chat-msg-item')):[]; window.__rw.fr.push({t:Math.round(performance.now()), st:scr?Math.round(scr.scrollTop):null, sh:scr?scr.scrollHeight:null, it:items.map(n=>{const r=n.getBoundingClientRect(); const cs=getComputedStyle(n); const tm=cs.transform; return [(n.dataset.ptahMsgItem||'').slice(-5), Math.round(r.top*10)/10, Math.round(r.height*10)/10, +(+cs.opacity).toFixed(2), tm==='none'?'':tm.replace('matrix(1, 0, 0, 1, ','').replace(')',''), (n.hasAttribute('data-ptah-leaving')?'L':'')+(n.hasAttribute('data-ptah-leave-cut')?'C':'')+(n.classList.contains('ptah-msg-enter')?'E':''), cs.display==='none'?'N':'']}), u:document.querySelectorAll('[data-testid="chat-user-message"]').length, ul:document.querySelectorAll('[data-ptah-leaving] [data-testid="chat-user-message"]').length, fo:(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('[data-ptah-leaving]'))?1:0}); if(window.__rw.fr.length>1500) window.__rw.fr.shift(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); })()`;
async function phaseStart(page){ await page.evaluate(()=>window.__insReset()); await page.evaluate(SAMPLER); }
async function phaseEnd(page,name){ await page.evaluate(()=>{window.__rw.on=false;}); const rw=await page.evaluate(()=>window.__rw); const ins=await page.evaluate(()=>({ev:window.__ins.ev,lt:window.__ins.lt})); fs.writeFileSync(`${OUT}/${TAG}_${name}.json`,JSON.stringify({rw,ins})); return {rw,ins}; }
(async()=>{const {app,page}=await launch();
 await page.evaluate(H.INS);
 await pickTheme(page,THEME); console.log('theme',await page.evaluate(()=>[document.documentElement.dataset.theme,document.documentElement.dataset.glass,document.documentElement.dataset.motionStyle]));
 await page.getByRole('button',{name:/^New session$/}).locator('visible=true').first().click(); await page.waitForTimeout(1200); const cr=page.getByRole('button',{name:/Create/}); if(await cr.count()) await cr.first().click(); await page.waitForTimeout(3000);
 await phaseStart(page); await send(page,'Reply with the single word one. No tools.'); console.log('done1',await done(page,80)); await phaseEnd(page,'turn1');

 await phaseStart(page); const sc=await H.screencast(page,TAG+'_t2',150);
 await send(page,'Reply with the single word two. No tools.'); console.log('done2',await done(page,40)); await sc.stop(); await phaseEnd(page,'turn2');
 await page.screenshot({path:`${OUT}/${TAG}_before_rewind.png`});
 // rewind
 await phaseStart(page);
 const firstUser=page.locator('[data-testid="chat-user-message"]').locator('visible=true').first(); await firstUser.hover(); await page.waitForTimeout(500);
 const rb=page.locator('[data-testid="user-rewind-button"]').locator('visible=true').first(); console.log('rewind btn',await rb.count(), await rb.isEnabled().catch(()=>null));
 await page.screenshot({path:`${OUT}/${TAG}_hover.png`});
 await rb.click({force:true}); await page.waitForTimeout(1000);
 await page.screenshot({path:`${OUT}/${TAG}_dialog.png`});
 const sc2=await H.screencast(page,TAG+'_rw',150);
 const before=await page.evaluate(()=>document.querySelectorAll('.chat-scroll-content > .chat-msg-item').length);
 await page.getByRole('button',{name:'Rewind',exact:true}).click(); 
 const tabLog=[]; for(let k=0;k<12;k++){ await page.keyboard.press('Tab'); await page.waitForTimeout(25); tabLog.push(await page.evaluate(()=>{const a=document.activeElement; return [a&&a.tagName, !!(a&&a.closest&&a.closest('[data-ptah-leaving]')), a&&(a.getAttribute('data-testid')||a.getAttribute('aria-label')||'').slice(0,30)];})); }
 await page.waitForTimeout(1500); await sc2.stop();
 await page.screenshot({path:`${OUT}/${TAG}_after_rewind.png`});
 console.log('before items',before,'after',await page.evaluate(()=>document.querySelectorAll('.chat-scroll-content > .chat-msg-item').length)); console.log('TAB',JSON.stringify(tabLog));
 await phaseEnd(page,'rewind');
 await app.close();})().catch(e=>{console.error(e.message.slice(0,500));process.exit(1)});
