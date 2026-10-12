// Token-free check of CLI-agent output handling: post a fake agent and bursts
// of agent-monitor:output messages into the renderer (each message is
// dispatched in its own task, like the preload does for real IPC) and measure
// main-thread cost and slow frames.
// The fake card lives only in renderer memory; a reload clears it.
// Usage: node agent-output-burst.js [rounds=20] [perRound=100] [bytes=200]
const { chromium } = require('playwright-core');

const [rounds = 20, perRound = 100, bytes = 200] = process.argv
  .slice(2)
  .map(Number);

(async () => {
  const b = await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.PTAH_CDP_PORT ?? 9333}`,
  );
  const page = b
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );

  const agentId = `perf-burst-${Date.now()}`;
  await page.evaluate((id) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'agent-monitor:spawned',
          payload: {
            agentId: id,
            cli: 'gemini',
            task: 'perf burst (synthetic, tools/perf/agent-output-burst.js)',
            workingDirectory: '/tmp',
            startedAt: new Date().toISOString(),
            status: 'running',
          },
        },
      }),
    );
  }, agentId);
  await page.waitForTimeout(1000);

  const before = await metrics();
  const r = await page.evaluate(
    async ({ id, rounds, perRound, bytes }) => {
      const frames = [];
      let last = performance.now();
      let running = true;
      const loop = (t) => {
        if (!running) return;
        frames.push(t - last);
        last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      const line = 'x'.repeat(Math.max(1, bytes - 1)) + '\n';
      const t0 = performance.now();
      for (let i = 0; i < rounds; i++) {
        for (let j = 0; j < perRound; j++) {
          setTimeout(() =>
            window.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'agent-monitor:output',
                  payload: {
                    agentId: id,
                    stdoutDelta: line,
                    stderrDelta: '',
                    timestamp: Date.now(),
                  },
                },
              }),
            ),
          );
        }
        await new Promise((res) => setTimeout(res, 50));
      }
      await new Promise((res) => setTimeout(res, 300));
      running = false;
      const f = frames.slice(1);
      return {
        wallMs: Math.round(performance.now() - t0),
        frames: f.length,
        over33: f.filter((d) => d > 33.4).length,
        over50: f.filter((d) => d > 50).length,
        maxFrame: Math.round(Math.max(0, ...f)),
      };
    },
    { id: agentId, rounds, perRound, bytes },
  );
  const after = await metrics();

  await page.evaluate((id) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'agent-monitor:exited',
          payload: {
            agentId: id,
            cli: 'gemini',
            task: 'perf burst',
            workingDirectory: '/tmp',
            startedAt: new Date().toISOString(),
            status: 'completed',
            exitCode: 0,
          },
        },
      }),
    );
  }, agentId);

  const d = (k) => +(after[k] - before[k]).toFixed(3);
  console.log(
    JSON.stringify(
      {
        agentId,
        rounds,
        perRound,
        bytes,
        deltas: rounds * perRound,
        ...r,
        scriptSec: d('ScriptDuration'),
        taskSec: d('TaskDuration'),
        styleSec: d('RecalcStyleDuration'),
        layoutSec: d('LayoutDuration'),
      },
      null,
      2,
    ),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
