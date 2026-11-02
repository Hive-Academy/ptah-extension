const {launch,OUT}=require('./lib.cjs'); const H=require('./h.cjs'); const fs=require('fs');
(async()=>{const {app,page}=await launch(); await page.evaluate(H.INS);
 await H.openSessionsDialog(page);
 const q=process.env.Q||'agent-lanes'; await page.getByPlaceholder('Search sessions...').fill(q); await page.waitForTimeout(1500);
 const rows=page.locator('button.session-row-open'); console.log('rows',await rows.count(), (await rows.nth(0).innerText()).replace(/\n/g,' | '));
 await page.evaluate(()=>window.__insReset());
 const sc=await H.screencast(page,'d_open',80);
 await rows.nth(parseInt(process.env.ROWI||'0')).click(); await page.waitForTimeout(25000); await sc.stop();
 const info=()=>page.evaluate(()=>{const sc=Array.from(document.querySelectorAll('.chat-scroll-content')).find(e=>e.getBoundingClientRect().height>0); if(!sc) return null; const scr=sc.parentElement; return {items:sc.querySelectorAll(':scope > .chat-msg-item').length, slots:sc.querySelectorAll('[data-ptah-transcript-message-id]').length, st:Math.round(scr.scrollTop), sh:scr.scrollHeight, ch:scr.clientHeight};});
 console.log('after open',JSON.stringify(await info()));
 const d0=await H.snapshotIns(page); console.log('OPEN',JSON.stringify({adds:d0.ev.filter(e=>e.k==='add').length,enters:d0.ev.filter(e=>/ptah-msg-enter/.test(e.cls)).length,sc:[...new Set(d0.fr.map(f=>f.sc))],lt:d0.lt.map(x=>x.d)})); 
 await page.screenshot({path:OUT+'/d_open_final.png'});
 // scroll up / prepend
 await page.evaluate(()=>window.__insReset());
 const out=[];
 for(let it=0;it<8;it++){
  const m=await page.evaluate(async()=>{ const sc=Array.from(document.querySelectorAll('.chat-scroll-content')).find(e=>e.getBoundingClientRect().height>0); const scr=sc.parentElement; scr.scrollTop=0; await new Promise(r=>setTimeout(r,250)); const r0=scr.getBoundingClientRect(); const slots=Array.from(sc.querySelectorAll('[data-ptah-transcript-message-id]')); const a=slots.find(s=>s.getBoundingClientRect().bottom>r0.top+4); const id=a&&a.getAttribute('data-ptah-transcript-message-id'); const top0=a?a.getBoundingClientRect().top-r0.top:null; const n0=sc.querySelectorAll(':scope > .chat-msg-item').length; const sh0=scr.scrollHeight; const track=[]; const t0=performance.now(); while(performance.now()-t0<1800){ await new Promise(r=>requestAnimationFrame(r)); const el=id&&sc.querySelector('[data-ptah-transcript-message-id="'+CSS.escape(id)+'"]'); track.push(el?Math.round((el.getBoundingClientRect().top-r0.top)*10)/10:null);} const n1=sc.querySelectorAll(':scope > .chat-msg-item').length; return {id:id&&id.slice(-6),top0,n0,n1,sh0,sh1:scr.scrollHeight,st:Math.round(scr.scrollTop),minTop:Math.min(...track.filter(x=>x!==null)),maxTop:Math.max(...track.filter(x=>x!==null))}; });
  out.push(m); console.log('SCROLL',it,JSON.stringify(m)); if(m.n1===m.n0 && it>2) break;
 }
 const d1=await H.snapshotIns(page); console.log('PREPEND ev',JSON.stringify({adds:d1.ev.filter(e=>e.k==='add').length,enters:d1.ev.filter(e=>/ptah-msg-enter/.test(e.cls)).length,removes:d1.ev.filter(e=>e.k==='remove').length,lt:d1.lt.map(x=>x.d)}));
 await page.screenshot({path:OUT+'/d_scrolled_top.png'});
 fs.writeFileSync(OUT+'/d.json',JSON.stringify({out,d0:{ev:d0.ev.length},d1:{ev:d1.ev.slice(0,60)}}));
 await app.close();})().catch(e=>{console.error(e.message.slice(0,500));process.exit(1)});
