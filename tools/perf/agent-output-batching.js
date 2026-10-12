// Check that CLI-agent output deltas are applied at most once per frame.
// Counts agent-monitor:output messages and agent-card DOM mutation batches per
// animation frame while an agent lane streams.
// Usage: node agent-output-batching.js <port> <seconds> [action.js]
const path = require('node:path');
const { chromium } = require('playwright-core');

const [port = '9333', secs = '60', action] = process.argv.slice(2);

const INSTALL = `(() => {
  const s = window.__agentBatch = { frames: 0, msgs: 0, cardUpdates: 0, framesWithMsgs: 0, framesMultiMsg: 0, framesMultiUpdate: 0, maxMsgsInFrame: 0, curMsgs: 0, curUpdates: 0, running: true };
  window.addEventListener('message', e => { if (e.data?.type === 'agent-monitor:output') { s.msgs++; s.curMsgs++; } });
  const watched = new WeakSet();
  const observe = () => {
    for (const el of document.querySelectorAll('ptah-agent-card, ptah-cli-agent-output, ptah-inline-agent-bubble')) {
      if (watched.has(el)) continue;
      watched.add(el);
      new MutationObserver(() => { s.curUpdates++; }).observe(el, { subtree: true, childList: true, characterData: true });
    }
  };
  const tick = () => {
    if (!s.running) return;
    s.frames++;
    if (s.curMsgs) s.framesWithMsgs++;
    if (s.curMsgs > 1) s.framesMultiMsg++;
    if (s.curUpdates > 1) s.framesMultiUpdate++;
    s.cardUpdates += s.curUpdates;
    s.maxMsgsInFrame = Math.max(s.maxMsgsInFrame, s.curMsgs);
    s.curMsgs = 0; s.curUpdates = 0;
    if (s.frames % 30 === 0) observe();
    requestAnimationFrame(tick);
  };
  observe();
  requestAnimationFrame(tick);
})()`;

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'));
  if (!page) throw new Error('No renderer page found');
  await page.evaluate(INSTALL);
  if (action) await require(path.resolve(action))(page);
  await page.waitForTimeout(Number(secs) * 1000);
  const r = await page.evaluate(() => {
    const s = window.__agentBatch;
    s.running = false;
    const { curMsgs, curUpdates, running, ...out } = s;
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close().catch(() => {});
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
