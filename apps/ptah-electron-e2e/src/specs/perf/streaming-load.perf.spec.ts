import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { launchPtah, resolveElectronEntry } from '../../support/electron-launcher';

/**
 * Streaming-load evaluation for the Electron main-loop freeze
 * (`.ptah/specs/main-loop-sync-blocks/perf-eval-plan.md`).
 *
 * N concurrent "sessions" are simulated at the BACKEND-CALL level, with no
 * provider call: each session issues, through the renderer's own IPC path
 * (`window.vscode.postMessage`, the same wire `ClaudeRpcService` uses), the
 * calls a streaming session makes on the main thread:
 *   - session start: `memory:search` + `memory:searchSymbols` scoped to the
 *     session's workspace root (the sync-sqlite-vec scan), then the git panel
 *     probes (`git:info`, `git:branches`, `git:stashList`, `git:lastCommit`)
 *     and `git:watchRoots` for every session root (the 4-slot git gate);
 *   - steady state: a git probe every 2 s, a scoped memory search every 15 s
 *     and a `git:watchRoots` renewal every 5 s;
 *   - a synthetic `chat:chunk` text-delta stream pushed at the renderer
 *     (`STREAM_EVENTS_PER_SEC` per session) to load the renderer drain.
 * Alongside, a 250 ms no-op RPC probe measures main-loop responsiveness as the
 * renderer sees it, and a requestAnimationFrame sampler records long frames.
 *
 * The verdict is NOT taken from this spec's own probe numbers alone: after the
 * window the app is closed and `scripts/perf/streaming-load-metrics.mjs` is run
 * over the app's own logs (event-loop lag, watchdog hangs, slow handlers, git
 * gate, SQLite) with `scripts/perf/streaming-load-thresholds.json`.
 *
 * Gated: it launches a real app for minutes, so it only runs when
 * `PTAH_PERF_STREAMING_LOAD=1`. Run it ONLY under the machine-wide lock, see
 * the plan. Environment:
 *   PTAH_PERF_SESSIONS     concurrent sessions (default 4)
 *   PTAH_PERF_DURATION_MS  measured window (default 120000; evaluation: 900000)
 *   PTAH_PERF_ROOTS        explicit session roots separated by ';' (first one is opened)
 *   PTAH_PERF_REPO         git repo whose worktrees are the session roots
 *                          (default: a throwaway scratch repo + worktrees)
 *   PTAH_PERF_DB_SOURCE    sqlite file copied as the app database; without it
 *                          the database is empty and the vector scan is NOT
 *                          representative
 *   PTAH_PERF_OUT          output directory (default <tmp>/ptah-perf-<time>)
 *   PTAH_PERF_MEMORY_ROOTS memory/symbol scoping roots (';' list, cycled over sessions)
 *   PTAH_PERF_MEMORY_QUERY / PTAH_PERF_SYMBOL_QUERY  canary queries that must match DB rows
 *   PTAH_PERF_EXPECT_SEARCH_WORKER  "1" requires the search worker to start cleanly (fix builds)
 *   PTAH_PERF_ENFORCE      "0" reports without failing the test
 */

const ENABLED = process.env['PTAH_PERF_STREAMING_LOAD'] === '1';
const SESSIONS = Number(process.env['PTAH_PERF_SESSIONS'] ?? '4');
const DURATION_MS = Number(process.env['PTAH_PERF_DURATION_MS'] ?? '120000');
const STREAM_EVENTS_PER_SEC = 40;
const PROBE_INTERVAL_MS = 250;
const BOOT_TIMEOUT_MS = 180_000;
/** Driver-side limits (renderer view); the log-based limits live in streaming-load-thresholds.json. */
const PROBE_MAX_MS = 1000;
const PROBE_P99_MS = 250;
const FRAME_GAP_MAX_MS = 500;

interface LoadStats {
  readonly rpc: Record<string, number[]>;
  readonly probeMs: number[];
  readonly frameGapsMs: number[];
  readonly driverTimeouts: Record<string, number>;
  /** RPCs that answered with `success: false`; the load is only valid if these are understood. */
  readonly rpcErrors: Record<string, { count: number; first: string }>;
  /** Canary searches (a query known to match rows in the DB copy): replies with and without results. */
  readonly canary: Record<string, { nonEmpty: number; empty: number }>;
  /** `memory:search` replies that fell back to BM25 only (embedder unavailable): no vector scan ran. */
  bm25OnlyReplies: number;
  vectorReplies: number;
}

interface LoadArgs {
  readonly roots: string[];
  readonly durationMs: number;
  readonly probeIntervalMs: number;
  /** Workspace roots used for memory/symbol scoping (cycled over sessions). */
  readonly memoryRoots: string[];
  readonly memoryQuery: string;
  readonly symbolQuery: string;
}

function pct(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

/** Session roots: real worktrees of PTAH_PERF_REPO, else a scratch repo + worktrees. */
function resolveRoots(sessions: number): { main: string; roots: string[] } {
  const explicit = process.env['PTAH_PERF_ROOTS'];
  if (explicit) {
    const roots = explicit.split(';').filter((r) => r.length > 0).slice(0, sessions);
    if (roots.length < sessions) {
      throw new Error(`PTAH_PERF_ROOTS lists ${roots.length} roots; need ${sessions}`);
    }
    // The first root is the workspace the app opens; the rest must be worktrees of it.
    return { main: roots[0] ?? '', roots };
  }
  const repo = process.env['PTAH_PERF_REPO'];
  if (repo) {
    const listed = git(repo, 'worktree', 'list', '--porcelain')
      .split(/\r?\n/)
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length));
    if (listed.length < sessions) {
      throw new Error(`${repo} has ${listed.length} worktrees; need ${sessions}`);
    }
    return { main: listed[0] ?? repo, roots: listed.slice(0, sessions) };
  }
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-perf-repo-'));
  git(main, 'init', '-q');
  git(main, 'config', 'user.email', 'perf@example.invalid');
  git(main, 'config', 'user.name', 'perf');
  fs.writeFileSync(path.join(main, 'a.ts'), 'export const a = 1;\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'init');
  const roots = [main];
  for (let i = 1; i < sessions; i++) {
    const wt = `${main}-wt${i}`;
    git(main, 'worktree', 'add', '-q', '-b', `perf/s${i}`, wt);
    roots.push(wt);
  }
  return { main, roots };
}

/** Runs inside the renderer page. Must stay self-contained (no closures). */
async function driveLoad(args: LoadArgs): Promise<LoadStats> {
  const w = window as unknown as {
    vscode: { postMessage(message: unknown): void };
  };
  const pending = new Map<string, (reply: unknown) => void>();
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data as { correlationId?: string } | undefined;
    const id = data?.correlationId;
    const done = id ? pending.get(id) : undefined;
    if (id && done) {
      pending.delete(id);
      done(data);
    }
  });
  const stats: LoadStats = {
    rpc: {},
    probeMs: [],
    frameGapsMs: [],
    driverTimeouts: {},
    rpcErrors: {},
    canary: {},
    bm25OnlyReplies: 0,
    vectorReplies: 0,
  };
  let seq = 0;
  const call = (method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> =>
    new Promise<unknown>((resolve) => {
      const id = `perf-${Date.now()}-${seq++}`;
      const started = performance.now();
      const timer = setTimeout(() => {
        pending.delete(id);
        stats.driverTimeouts[method] = (stats.driverTimeouts[method] ?? 0) + 1;
        resolve(undefined);
      }, timeoutMs);
      pending.set(id, (reply: unknown) => {
        clearTimeout(timer);
        (stats.rpc[method] ??= []).push(performance.now() - started);
        const r = reply as { success?: boolean; error?: string } | undefined;
        if (r?.success === false && method !== 'e2e:rpc-ready-probe') {
          const e = (stats.rpcErrors[method] ??= { count: 0, first: String(r.error ?? '') });
          e.count += 1;
        }
        resolve(reply);
      });
      w.vscode.postMessage({
        type: 'rpc:call',
        payload: { method, params, correlationId: id },
      });
    });

  const endAt = Date.now() + args.durationMs;
  const running = (): boolean => Date.now() < endAt;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  // Renderer long-frame sampler.
  let last = performance.now();
  const raf = (): void => {
    const now = performance.now();
    if (now - last > 100) stats.frameGapsMs.push(now - last);
    last = now;
    if (running()) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  const probe = (async (): Promise<void> => {
    while (running()) {
      const started = performance.now();
      await call('e2e:rpc-ready-probe', {}, 120_000);
      stats.probeMs.push(performance.now() - started);
      await sleep(args.probeIntervalMs);
    }
  })();

  const session = async (root: string, index: number): Promise<void> => {
    const leaseId = `perf-lease-${index}`;
    const gitProbes = async (): Promise<void> => {
      await Promise.all([
        call('git:info', { workspaceRoot: root }),
        call('git:branches', { workspaceRoot: root }),
        call('git:stashList', { workspaceRoot: root }),
        call('git:lastCommit', { workspaceRoot: root }),
      ]);
    };
    // Even rounds (turn % 16 === 0) are canaries: a query known to match rows in the DB copy,
    // whose replies must be non-empty. A search backend that failed to start returns EMPTY
    // results silently, so only a non-empty canary proves the search path really ran.
    const memoryRoot = args.memoryRoots[index % args.memoryRoots.length] ?? root;
    const hasResults = (reply: unknown, key: string): boolean => {
      const data = (reply as { data?: Record<string, unknown> } | undefined)?.data;
      const list = data?.[key];
      return Array.isArray(list) && list.length > 0;
    };
    const record = (method: string, ok: boolean): void => {
      const c = (stats.canary[method] ??= { nonEmpty: 0, empty: 0 });
      if (ok) c.nonEmpty += 1;
      else c.empty += 1;
    };
    const memory = async (turn: number): Promise<void> => {
      const canary = turn % 16 === 0;
      const [memReply, symReply] = await Promise.all([
        call('memory:search', {
          query: canary
            ? args.memoryQuery
            : `how does session ${index} turn ${turn} handle streaming and git state`,
          topK: 10,
          workspaceRoot: memoryRoot,
        }),
        call('memory:searchSymbols', {
          workspaceRoot: memoryRoot,
          query: canary ? args.symbolQuery : `stream session ${turn}`,
          limit: 20,
        }),
      ]);
      const mem = (memReply as { data?: { bm25Only?: boolean } } | undefined)?.data;
      if (mem?.bm25Only === true) stats.bm25OnlyReplies += 1;
      else if (mem?.bm25Only === false) stats.vectorReplies += 1;
      if (canary) {
        // Only the root that holds memories can answer the memory canary.
        if (memoryRoot === args.memoryRoots[0]) record('memory:search', hasResults(memReply, 'hits'));
        record('memory:searchSymbols', hasResults(symReply, 'items'));
      }
    };
    // Stagger like four tabs opened in quick succession, not simultaneously.
    await sleep(index * 750);
    await memory(0);
    await gitProbes();
    await call('git:watchRoots', { leaseId, roots: [root] });
    let tick = 0;
    while (running()) {
      tick += 1;
      await sleep(2000);
      await gitProbes();
      if (tick % 3 === 0) await call('git:watchRoots', { leaseId, roots: [root] });
      if (tick % 8 === 0) await memory(tick);
    }
  };

  await Promise.all([
    probe,
    ...args.roots.map((root, i) => session(root, i)),
  ]);
  return stats;
}

test.describe('Streaming load (main-loop freeze evaluation)', () => {
  test.skip(!ENABLED, 'set PTAH_PERF_STREAMING_LOAD=1 to run the streaming-load evaluation');
  test.setTimeout(DURATION_MS + 20 * 60_000);

  test(`${SESSIONS} concurrent sessions stay within the freeze thresholds`, async () => {
    const out =
      process.env['PTAH_PERF_OUT'] ??
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-perf-'));
    fs.mkdirSync(out, { recursive: true });
    const userDataDir = path.join(out, 'userData');
    const home = path.join(out, 'home');
    fs.mkdirSync(home, { recursive: true });

    const dbSource = process.env['PTAH_PERF_DB_SOURCE'];
    const dbPath = path.join(out, 'ptah-perf.sqlite');
    if (dbSource) {
      for (const suffix of ['', '-wal']) {
        if (fs.existsSync(dbSource + suffix)) {
          fs.copyFileSync(dbSource + suffix, dbPath + suffix);
        }
      }
    }

    // The embedder loads its model from <HOME>/.ptah/models. HOME is isolated, so copy the one
    // model the memory search needs; without it every search silently falls back to BM25 and the
    // vector scan (the 8 s main-thread block) never runs.
    const modelSource =
      process.env['PTAH_PERF_EMBEDDER_MODEL_SOURCE'] ??
      path.join(os.homedir(), '.ptah', 'models', 'Xenova', 'bge-small-en-v1.5');
    if (dbSource && fs.existsSync(modelSource)) {
      fs.cpSync(modelSource, path.join(home, '.ptah', 'models', 'Xenova', 'bge-small-en-v1.5'), {
        recursive: true,
      });
    }

    const { main, roots } = resolveRoots(SESSIONS);
    const app = await launchPtah({
      args: [main],
      userDataDir,
      timeout: BOOT_TIMEOUT_MS,
      env: {
        USERPROFILE: home,
        HOME: home,
        ...(dbSource ? { PTAH_DB_PATH: dbPath } : {}),
      },
    });
    const page = await app.firstWindow({ timeout: BOOT_TIMEOUT_MS });
    await page.waitForLoadState('domcontentloaded');

    // Boot work is not the subject; wait for the loop to answer a no-op quickly.
    const quiet = await page.evaluate(async () => {
      const w = window as unknown as { vscode: { postMessage(m: unknown): void } };
      for (let attempt = 0; attempt < 240; attempt++) {
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const id = `quiet-${attempt}`;
          const onMsg = (ev: MessageEvent): void => {
            if ((ev.data as { correlationId?: string } | undefined)?.correlationId === id) {
              window.removeEventListener('message', onMsg);
              resolve();
            }
          };
          window.addEventListener('message', onMsg);
          w.vscode.postMessage({
            type: 'rpc:call',
            payload: { method: 'e2e:rpc-ready-probe', params: {}, correlationId: id },
          });
        });
        if (performance.now() - started < 500) return attempt;
        await new Promise((r) => setTimeout(r, 500));
      }
      return -1;
    });
    expect(quiet, 'backend never answered a no-op RPC quickly after boot').toBeGreaterThanOrEqual(0);

    // Synthetic stream: text deltas for each session, pushed from the main
    // process exactly like StreamEventBatcher flushes (one 'batch' per tick).
    const sessionIds = roots.map((_, i) => `perf-session-${i}`);
    await app.evaluate(
      ({ BrowserWindow }, cfg) => {
        const win = BrowserWindow.getAllWindows()[0];
        const state = globalThis as unknown as { __perfStream?: NodeJS.Timeout };
        let n = 0;
        state.__perfStream = setInterval(() => {
          const events = cfg.sessionIds.flatMap((sessionId) =>
            Array.from({ length: cfg.perTick }, () => ({
              type: 'chat:chunk',
              payload: {
                sessionId,
                event: {
                  id: `perf-${n++}`,
                  eventType: 'text_delta',
                  timestamp: Date.now(),
                  sessionId,
                  source: 'complete',
                  messageId: `perf-msg-${sessionId}`,
                  delta: 'streaming text delta ',
                  blockIndex: 0,
                },
              },
            })),
          );
          win?.webContents.send('to-renderer', { type: 'batch', payload: { events } });
        }, cfg.tickMs);
      },
      {
        sessionIds,
        tickMs: 100,
        perTick: Math.max(1, Math.round(STREAM_EVENTS_PER_SEC / 10)),
      },
    );

    const memoryRoots = (process.env['PTAH_PERF_MEMORY_ROOTS'] ?? '')
      .split(';')
      .filter((r) => r.length > 0);
    if (memoryRoots.length === 0) memoryRoots.push(...roots);
    const fromIso = new Date().toISOString();
    const stats = await page.evaluate(driveLoad, {
      roots,
      durationMs: DURATION_MS,
      probeIntervalMs: PROBE_INTERVAL_MS,
      memoryRoots,
      memoryQuery: process.env['PTAH_PERF_MEMORY_QUERY'] ?? 'model tier alias mapping',
      symbolQuery: process.env['PTAH_PERF_SYMBOL_QUERY'] ?? 'MemorySearchService',
    });
    const toIso = new Date().toISOString();
    await app.evaluate(() => {
      const state = globalThis as unknown as { __perfStream?: NodeJS.Timeout };
      if (state.__perfStream) clearInterval(state.__perfStream);
    });
    await app.close().catch(() => undefined);

    // Driver-side numbers (what the renderer saw).
    const driver = {
      sessions: SESSIONS,
      durationMs: DURATION_MS,
      probe: {
        count: stats.probeMs.length,
        p50: pct(stats.probeMs, 50),
        p99: pct(stats.probeMs, 99),
        max: pct(stats.probeMs, 100),
      },
      longFrames: {
        count: stats.frameGapsMs.length,
        max: pct(stats.frameGapsMs, 100),
      },
      rpc: Object.fromEntries(
        Object.entries(stats.rpc).map(([m, v]) => [
          m,
          { count: v.length, p50: pct(v, 50), p99: pct(v, 99), max: pct(v, 100) },
        ]),
      ),
      driverTimeouts: stats.driverTimeouts,
      rpcErrors: stats.rpcErrors,
      canary: stats.canary,
      bm25OnlyReplies: stats.bm25OnlyReplies,
      vectorReplies: stats.vectorReplies,
    };
    // Search-worker evidence from the app's own log (fix builds run searches in a utility process).
    const logsDirEarly = path.join(userDataDir, 'logs');
    const workerLines: string[] = [];
    if (fs.existsSync(logsDirEarly)) {
      for (const name of fs.readdirSync(logsDirEarly)) {
        if (!/^Ptah Electron-.*\.log$/.test(name)) continue;
        for (const line of fs.readFileSync(path.join(logsDirEarly, name), 'utf8').split(/\r?\n/)) {
          if (line.includes('sqlite-search-worker')) workerLines.push(line);
        }
      }
    }
    const workerFile = path.resolve(path.dirname(resolveElectronEntry()), 'search-worker.mjs');
    const worker = {
      builtFilePresent: fs.existsSync(workerFile),
      readyLines: workerLines.filter((l) => / ready/.test(l)).length,
      // WARN/ERROR lines other than the worker's own "slow query" timings: start failures,
      // request timeouts ("answering degraded"), restarts and backoff all land here.
      problemLines: workerLines.filter(
        (l) => /\[(WARN|ERROR)\s*\]/.test(l) && !l.includes('slow query'),
      ),
      allLines: workerLines.slice(0, 40),
    };
    fs.writeFileSync(path.join(out, 'search-worker-evidence.json'), JSON.stringify(worker, null, 2));
    fs.writeFileSync(path.join(out, 'driver-stats.json'), JSON.stringify({ ...driver, searchWorker: worker }, null, 2));

    // Log-based verdict from the app's own logs.
    const logsDir = path.join(userDataDir, 'logs');
    const logs = fs.existsSync(logsDir)
      ? fs.readdirSync(logsDir).filter((n) => /^Ptah Electron-.*\.log$/.test(n))
      : [];
    const collectorArgs = [
      path.resolve(__dirname, '../../../../../scripts/perf/streaming-load-metrics.mjs'),
      ...logs.flatMap((n) => ['--log', path.join(logsDir, n)]),
      // The watchdog only creates ptah-hang.log on the first hang; no file means no hang.
      ...(fs.existsSync(path.join(logsDir, 'ptah-hang.log'))
        ? ['--hang-log', path.join(logsDir, 'ptah-hang.log')]
        : []),
      '--from',
      fromIso,
      '--to',
      toIso,
      '--check',
      '--json',
      path.join(out, 'metrics.json'),
      '--md',
      path.join(out, 'metrics.md'),
      '--title',
      `Streaming load, ${SESSIONS} sessions, ${Math.round(DURATION_MS / 1000)} s`,
    ];
    const collector = spawnSync(process.execPath, collectorArgs, { encoding: 'utf8' });
    console.log(`[streaming-load] output: ${out}`);
    console.log(`[streaming-load] driver: ${JSON.stringify(driver.probe)} frames ${JSON.stringify(driver.longFrames)}`);
    console.log(collector.stdout + collector.stderr);

    if (process.env['PTAH_PERF_ENFORCE'] !== '0') {
      expect(collector.status, 'log-based thresholds (see metrics.md)').toBe(0);
      expect(driver.probe.max, 'no-op RPC worst round trip (ms)').toBeLessThan(PROBE_MAX_MS);
      expect(driver.probe.p99, 'no-op RPC p99 round trip (ms)').toBeLessThan(PROBE_P99_MS);
      expect(driver.longFrames.max, 'worst renderer frame gap (ms)').toBeLessThan(FRAME_GAP_MAX_MS);
      expect(Object.keys(driver.driverTimeouts), 'RPCs that never answered').toEqual([]);
      expect(driver.rpcErrors, 'RPCs that answered success:false').toEqual({});
      if (dbSource) {
        expect(driver.bm25OnlyReplies, 'memory:search replies without the vector path (embedder unavailable)').toBe(0);
        expect(driver.vectorReplies, 'memory:search replies that used the vector path').toBeGreaterThan(0);
        for (const method of ['memory:search', 'memory:searchSymbols']) {
          const c = driver.canary[method];
          expect(c?.nonEmpty ?? 0, `${method} canary replies with results`).toBeGreaterThan(0);
          expect(c?.empty ?? 0, `${method} canary replies that were EMPTY (search backend not working)`).toBe(0);
        }
      }
      if (process.env['PTAH_PERF_EXPECT_SEARCH_WORKER'] === '1') {
        expect(worker.builtFilePresent, 'dist search-worker.mjs present').toBe(true);
        expect(worker.readyLines, 'search worker logged ready').toBeGreaterThan(0);
        expect(worker.problemLines, 'search worker WARN/ERROR lines (start failure, backoff)').toEqual([]);
      }
    }
  });
});
