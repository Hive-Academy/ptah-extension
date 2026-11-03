// injected instrumentation
module.exports = `(() => {
 if (window.__ins) return;
 const I = window.__ins = { ev: [], fr: [], lt: [], t0: performance.now(), on: true };
 const now = () => +(performance.now() - I.t0).toFixed(1);
 const info = (n) => ({ cls: n.className.toString().split(' ').join('.'), i: n.style && n.style.getPropertyValue('--ptah-msg-i'), inert: n.hasAttribute('inert'), ah: n.getAttribute('aria-hidden'), leaving: n.hasAttribute('data-ptah-leaving'), cut: n.hasAttribute('data-ptah-leave-cut'), id: n.dataset.ptahMsgItem, tid: (n.querySelector('[data-testid]')||{getAttribute:()=>null}).getAttribute('data-testid') });
 const isItem = (n) => n.nodeType===1 && n.matches && n.matches('.chat-msg-item');
 new MutationObserver((ms) => { for (const m of ms) {
   if (m.type==='childList') { m.addedNodes.forEach(n=>{ if(isItem(n)) I.ev.push({t:now(),k:'add',...info(n)}); }); m.removedNodes.forEach(n=>{ if(isItem(n)) I.ev.push({t:now(),k:'remove',...info(n)}); }); }
   else if (m.type==='attributes' && isItem(m.target)) I.ev.push({t:now(),k:'attr:'+m.attributeName,...info(m.target)});
 }}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','inert','aria-hidden','data-ptah-leaving','data-ptah-leave-cut']});
 try { new PerformanceObserver(l=>{ l.getEntries().forEach(e=>I.lt.push({t:+(e.startTime-I.t0).toFixed(1),d:+e.duration.toFixed(1)})); }).observe({entryTypes:['longtask']}); } catch(e){}
 const loop = () => { if (I.on) {
   const items = Array.from(document.querySelectorAll('.chat-scroll-content > .chat-msg-item'));
   const sc = document.querySelector('.chat-scroll-content'); const scr = sc && sc.parentElement;
   const anims = document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.classList&&a.effect.target.classList.contains('chat-msg-item'));
   const row = items.map((n,ix)=>{ const r=n.getBoundingClientRect(); const cs=getComputedStyle(n); return [ix, Math.round(r.top*10)/10, Math.round(r.height*10)/10, +cs.opacity, cs.transform==='none'?'':cs.transform, n.hasAttribute('data-ptah-leaving')?1:0]; });
   const active = row.filter(r=>r[3]<1||r[4]||r[5]);
   I.fr.push({t:now(), n:items.length, sc: scr?scr.className.toString().split(' ').filter(c=>/ptah|pane|enter|leave/.test(c)).join('.'):null, st: scr?Math.round(scr.scrollTop):null, sh: scr?scr.scrollHeight:null, ch: scr?scr.clientHeight:null, tops: row.filter(r=>r[1]>-2000&&r[1]<4000).map(r=>[r[0],r[1],r[2]]), act: active, an: anims.map(a=>{const ix=items.indexOf(a.effect.target); const t=a.effect.getTiming(); return {ix, name:a.animationName, delay:t.delay, dur:t.duration, ct:Math.round(a.currentTime), props:(a.effect.getKeyframes? a.effect.getKeyframes().reduce((s,k)=>{Object.keys(k).forEach(p=>{if(!['offset','easing','composite','computedOffset'].includes(p)) s.add(p)});return s},new Set()):new Set())}}).map(x=>({...x,props:[...x.props]})) });
   if (I.fr.length>20000) I.fr.shift();
 } requestAnimationFrame(loop); };
 requestAnimationFrame(loop);
 window.__insReset = () => { I.ev.length=0; I.fr.length=0; I.lt.length=0; I.t0=performance.now(); };
})()`;
