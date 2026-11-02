const fs=require('fs'); const {OUT}=require('./lib.cjs'); const INS=require('./ins.cjs');
fs.mkdirSync(OUT+'/frames',{recursive:true});
async function burst(page,prefix,ms,every=40){ const out=[]; const t0=Date.now(); let k=0; while(Date.now()-t0<ms){ const t=Date.now()-t0; const f=`${OUT}/frames/${prefix}_${String(k).padStart(3,'0')}.jpg`; try{ await page.screenshot({path:f,type:'jpeg',quality:55}); }catch(e){break;} out.push({f:f.split('/').pop(),t}); k++; const w=every-(Date.now()-t0-t); if(w>0) await page.waitForTimeout(w);} return out; }
async function openSessionsDialog(page){ await page.getByText(/previous sessions/i).locator('visible=true').first().click(); await page.waitForTimeout(1200); }
async function snapshotIns(page){ return page.evaluate(()=>JSON.parse(JSON.stringify(window.__ins))); }
// summarise enter events: per added item with ptah-msg-enter
function summarise(d){
  const adds=d.ev.filter(e=>e.k==='add');
  const enters=adds.filter(e=>/ptah-msg-enter/.test(e.cls));
  const anims={}; // ix -> {first,last,delay,dur,props}
  d.fr.forEach(f=>f.an.forEach(a=>{ const k=a.name+'#'+a.ix+'@'+f.n; const o=anims[k]||(anims[k]={name:a.name,ix:a.ix,delay:a.delay,dur:a.dur,props:a.props,first:f.t,last:f.t,n:f.n}); o.last=f.t; }));
  return {adds:adds.length, enters:enters.length, enterIdx:enters.map(e=>e.i), addedWithoutEnter:adds.length-enters.length, firstAddT:adds[0]&&adds[0].t, anims:Object.values(anims).slice(0,40), lt:d.lt, frames:d.fr.length};
}
module.exports={burst,openSessionsDialog,snapshotIns,summarise,INS};
// CDP screencast
async function screencast(page,prefix,max=150){ const cdp=await page.context().newCDPSession(page); const frames=[]; const t0=Date.now(); let n=0;
  cdp.on('Page.screencastFrame',async ev=>{ if(n<max){ const f=`${prefix}_${String(n).padStart(3,'0')}.jpg`; fs.writeFileSync(`${OUT}/frames/${f}`,Buffer.from(ev.data,'base64')); frames.push({f,t:Date.now()-t0,ts:ev.metadata.timestamp}); n++; } cdp.send('Page.screencastFrameAck',{sessionId:ev.sessionId}).catch(()=>{}); });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:60,maxWidth:900,maxHeight:600,everyNthFrame:1});
  return {frames, stop:async()=>{ await cdp.send('Page.stopScreencast').catch(()=>{}); await cdp.detach().catch(()=>{}); return frames; }};
}
module.exports.screencast=screencast;
