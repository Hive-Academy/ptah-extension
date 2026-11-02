const {launch,OUT}=require('./lib.cjs'); const H=require('./h.cjs'); const fs=require('fs');
(async()=>{const {app,page}=await launch(); await page.evaluate(H.INS);
 const names=await page.evaluate(()=>Array.from(document.querySelectorAll('button,[role=button],[role=tab],article,li')).filter(e=>/done|idle/.test(e.innerText)&&e.getBoundingClientRect().left<470&&e.getBoundingClientRect().height>60&&e.getBoundingClientRect().height<400).map(e=>e.innerText.split('\n')[0]).slice(0,8));
 console.log(JSON.stringify(names));
 const cards=page.locator('button,[role=button],article,li').filter({hasText:/done|idle/}).locator('visible=true');
 const N=await cards.count(); console.log('cardN',N);
 const seq=[0,1,2,1,0];
 for(let k=0;k<seq.length;k++){
  await page.evaluate(()=>window.__insReset()); const sc=await H.screencast(page,'tab'+k,50);
  await page.waitForTimeout(150);
  const card=page.locator('button,[role=button],article,li').filter({hasText:/done|idle/}).locator('visible=true').nth(seq[k]);
  await card.click({force:true,timeout:5000}).catch(e=>console.log('clickfail',e.message.slice(0,60)));
  await page.waitForTimeout(2200); await sc.stop();
  const d=await H.snapshotIns(page); const s=H.summarise(d);
  console.log('TAB',k,'card',seq[k],JSON.stringify({adds:s.adds,enters:s.enters,sc:[...new Set(d.fr.map(f=>f.sc))],anims:s.anims.map(a=>a.name),rm:d.ev.filter(e=>e.k==='remove').length}));
 }
 await app.close();})().catch(e=>{console.error(e.message.slice(0,500));process.exit(1)});
