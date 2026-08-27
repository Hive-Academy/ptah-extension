/**
 * Boot-window RPC probe (TASK_2026_331, Batch 2 scoping).
 *
 * ## The question this answers
 *
 * Batch 1 opened the window before the heavy boot, which created a window in
 * which the renderer can issue an RPC before SQLite is open. Batch 2 proposes
 * guarding "the SQLite-backed handlers" so those calls return a retryable
 * answer. That is only worth doing for calls that actually LAND in the window.
 *
 * So: launch the real built app with a real workspace, record every RPC the
 * renderer issues with the millisecond it arrived and how it answered, and mark
 * the boundary at which SQLite finished opening. Anything before the boundary
 * is a candidate for a readiness guard. Anything after it is not.
 *
 * ## Why this is safe to run
 *
 * `PTAH_DB_PATH` points at a throwaway temp file, so the run cannot open, migrate
 * or write the developer's real `~/.ptah/state/ptah.sqlite`. That override is
 * honoured ahead of every profile by `persistence-sqlite/src/lib/db-path.ts`.
 * Pass `--db=<path>` to measure against a copy of a large database; never pass
 * the real path.
 *
 * The DB size changes how WIDE the window is, not WHICH calls land in it — the
 * renderer issues the same startup calls either way — so the default empty-DB
 * run already answers the question of which methods need a guard.
 *
 * ## QUIT THE INSTALLED PTAH APP FIRST
 *
 * `main.ts` takes `app.requestSingleInstanceLock()` and calls `app.quit()` when
 * it loses. With the installed app running, this probe's Electron exits during
 * startup and the first `evaluate` fails with "Execution context was destroyed"
 * — which reads like a harness bug and is not one. Measured 2026-08-28: the run
 * that happened while no installed app was open produced a full trace; the two
 * after it launched produced nothing.
 *
 * ## Usage
 *
 *   node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs [--ws=<path>] \
 *        [--db=<path>] [--seconds=90]
 *
 * Requires a build: `npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { _electron } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const WORKSPACE = path.resolve(arg('ws', REPO_ROOT));
const SECONDS = Number(arg('seconds', '90'));
const DB_SOURCE = arg('db', '');
const ENTRY = path.join(REPO_ROOT, 'dist', 'apps', 'ptah-electron', 'main.mjs');

/**
 * A private database for this run.
 *
 * When `--db` names a file it is COPIED, never opened in place: opening it would
 * migrate it forward from the working tree, which is how a capture run once left
 * an installed build unable to read its own data (TASK_2026_291).
 */
function prepareDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-bootprobe-'));
  const target = path.join(dir, 'probe.sqlite');
  if (DB_SOURCE) {
    const source = path.resolve(DB_SOURCE);
    console.log(`[probe] copying ${source} -> ${target}`);
    fs.copyFileSync(source, target);
    // The WAL holds writes the main file does not. Without it the copy is a
    // stale snapshot and the open is faster than the real thing.
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(source + suffix)) {
        fs.copyFileSync(source + suffix, target + suffix);
      }
    }
  }
  return { dir, target };
}

/** Install the request/response recorders inside the Electron main process. */
const INSTALL_PROBE = ({ ipcMain, BrowserWindow }) => {
  const probe = { rpcs: [], byId: new Map() };
  globalThis.__bootProbe = probe;

  // `prependListener`, so the record is taken before the bridge handles it and
  // the arrival time is not inflated by the handler's own work.
  ipcMain.prependListener('rpc', (_event, message) => {
    if (!message || typeof message !== 'object') return;
    const data = message.payload ?? message;
    const method = data?.method;
    if (typeof method !== 'string') return;
    const id = data.correlationId ?? data.requestId ?? '';
    const entry = { method, id, sentAt: Date.now(), answeredAt: null };
    probe.rpcs.push(entry);
    if (id) probe.byId.set(id, entry);
  });

  // Responses come back as `webContents.send('to-renderer', { type:
  // 'rpc:response', correlationId, success, errorCode })`. Patching the shared
  // prototype catches the window whether or not it exists yet.
  const patchSend = (contents) => {
    const proto = Object.getPrototypeOf(contents);
    if (proto.__bootProbePatched) return;
    proto.__bootProbePatched = true;
    const original = proto.send;
    proto.send = function patched(channel, payload, ...rest) {
      if (channel === 'to-renderer' && payload && payload.correlationId) {
        const entry = probe.byId.get(payload.correlationId);
        if (entry && entry.answeredAt === null) {
          entry.answeredAt = Date.now();
          entry.success = payload.success !== false;
          entry.errorCode = payload.errorCode ?? null;
          entry.error =
            typeof payload.error === 'string'
              ? payload.error.slice(0, 200)
              : null;
          // Echoed to stdout as well as held in memory. A long run can lose the
          // final `evaluate` — the main-process context goes away when the app
          // quits or the window is destroyed — and a probe that discards its
          // whole trace at the last step is not a measuring instrument.
          queueMicrotask(() => {
            console.log(`[bootprobe] ${JSON.stringify(entry)}`);
          });
          // Empty-vs-absent is the distinction the readiness contract exists to
          // make, so record enough of the shape to tell them apart.
          const d = payload.data;
          entry.dataShape =
            d === null || d === undefined
              ? String(d)
              : Array.isArray(d)
                ? `array(${d.length})`
                : typeof d === 'object'
                  ? Object.keys(d).slice(0, 6).join(',')
                  : typeof d;
        }
      }
      return original.call(this, channel, payload, ...rest);
    };
  };

  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) patchSend(existing.webContents);
  else {
    const timer = setInterval(() => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        patchSend(win.webContents);
        clearInterval(timer);
      }
    }, 25);
    timer.unref?.();
  }
  return true;
};

async function main() {
  if (!fs.existsSync(ENTRY)) {
    console.error(
      `[probe] no build at ${ENTRY}\n` +
        `Run: npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`,
    );
    process.exit(1);
  }

  const db = prepareDb();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-bootprobe-udd-'));
  const stdout = [];
  const t0 = Date.now();

  console.log(`[probe] workspace: ${WORKSPACE}`);
  console.log(`[probe] database:  ${db.target}${DB_SOURCE ? ' (copy)' : ' (fresh)'}`);
  console.log(`[probe] observing for ${SECONDS}s\n`);

  const app = await _electron.launch({
    args: [ENTRY, WORKSPACE, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PTAH_DB_PATH: db.target,
      // Skip the GitHub release check: it is network I/O this probe does not
      // measure and would add noise to the same event loop.
      PTAH_E2E: '1',
      NODE_ENV: 'production',
    },
    timeout: 120_000,
  });

  const record = (chunk) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) stdout.push({ at: Date.now() - t0, line: line.trimEnd() });
    }
  };
  app.process().stdout?.on('data', record);
  app.process().stderr?.on('data', record);

  try {
    await app.evaluate(INSTALL_PROBE);
  } catch (error) {
    console.error(
      '[probe] could not install the probe:',
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      '[probe] The usual cause is the INSTALLED Ptah app being open — this run\n' +
        '[probe] loses the single-instance lock and quits during startup. Close it\n' +
        '[probe] and try again.',
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));

  // Best effort. The stdout echo below is the authoritative record; this only
  // adds the requests that never got a response, which have nothing to echo.
  let collected = [];
  try {
    const probe = await app.evaluate(() => ({
      rpcs: (globalThis.__bootProbe?.rpcs ?? []).map((r) => ({ ...r })),
    }));
    collected = probe.rpcs;
  } catch (error) {
    console.warn(
      `[probe] final evaluate failed (${error instanceof Error ? error.message : String(error)});` +
        ' falling back to the stdout echo',
    );
    collected = recoverFromStdout(stdout);
  }

  await app.close().catch(() => undefined);

  report(collected, stdout, t0);

  fs.rm(userDataDir, { recursive: true, force: true }, () => undefined);
  fs.rm(db.dir, { recursive: true, force: true }, () => undefined);
}

/**
 * Rebuild the answered-RPC list from the stdout echo.
 *
 * Only answered calls appear here — an unanswered one never reached the patched
 * `send`. That is a limitation worth stating rather than hiding: after a failed
 * evaluate the report can show what ANSWERED but cannot prove what did not.
 */
function recoverFromStdout(stdout) {
  const out = [];
  for (const { line } of stdout) {
    const marker = line.indexOf('[bootprobe] ');
    if (marker === -1) continue;
    try {
      out.push(JSON.parse(line.slice(marker + '[bootprobe] '.length)));
    } catch {
      // A torn line from an interleaved write. Skip it; the rest still counts.
    }
  }
  return out;
}

/** Find the elapsed ms of the first stdout line containing `needle`. */
function markerAt(stdout, needle) {
  return stdout.find((l) => l.line.includes(needle))?.at ?? null;
}

function report(rpcs, stdout, t0) {
  const windowOpen = markerAt(stdout, 'Startup config registered');
  const sqliteOpen = markerAt(stdout, 'SQLite connection opened + migrated');
  const sqliteStart = markerAt(stdout, 'calling openAndMigrate()');

  console.log('\n================ BOOT MARKERS ================');
  const marker = (label, at) =>
    console.log(`  ${label.padEnd(34)} ${at === null ? 'NEVER' : `${at} ms`}`);
  marker('window (Startup config registered)', windowOpen);
  marker('openAndMigrate() started', sqliteStart);
  marker('SQLite open + migrated', sqliteOpen);
  if (windowOpen !== null && sqliteOpen !== null) {
    console.log(
      `\n  READINESS WINDOW: ${sqliteOpen - windowOpen} ms ` +
        `(window open -> SQLite usable)`,
    );
  }

  const normalized = rpcs
    .map((r) => ({ ...r, at: r.sentAt - t0 }))
    .sort((a, b) => a.at - b.at);

  console.log(`\n================ RPC TRAFFIC (${normalized.length}) ================`);
  if (normalized.length === 0) {
    console.log('  none recorded — the probe attached after the renderer was done,');
    console.log('  or the renderer issued no RPCs. Re-run with a longer --seconds.');
  }

  const inWindow = [];
  for (const r of normalized) {
    const before = sqliteOpen !== null && r.at < sqliteOpen;
    if (before) inWindow.push(r);
    const outcome =
      r.answeredAt === null
        ? 'NO RESPONSE'
        : r.success
          ? `ok ${r.dataShape ?? ''}`
          : `FAIL ${r.errorCode ?? ''} ${r.error ?? ''}`;
    console.log(
      `  ${String(r.at).padStart(6)} ms ${before ? '[PRE-SQLITE] ' : '             '}` +
        `${r.method.padEnd(34)} ${outcome}`,
    );
  }

  console.log('\n================ VERDICT ================');
  if (sqliteOpen === null) {
    console.log('  SQLite never opened — verdict unavailable. Check the log above.');
  } else if (inWindow.length === 0) {
    console.log('  NO RPC arrived before SQLite was open.');
    console.log('  A readiness guard would never fire on this path.');
  } else {
    const failed = inWindow.filter((r) => r.answeredAt !== null && !r.success);
    console.log(`  ${inWindow.length} RPC(s) arrived before SQLite was open:`);
    for (const r of [...new Set(inWindow.map((r) => r.method))]) {
      console.log(`    - ${r}`);
    }
    console.log(
      `  ${failed.length} of them FAILED — these are the methods a readiness`,
    );
    console.log('  guard would actually change.');
    for (const r of failed) {
      console.log(`    - ${r.method}: ${r.errorCode ?? ''} ${r.error ?? ''}`);
    }
  }

  const out = path.join(REPO_ROOT, 'tmp', 'boot-probe.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      { markers: { windowOpen, sqliteStart, sqliteOpen }, rpcs: normalized, stdout },
      null,
      2,
    ),
  );
  console.log(`\n  full trace: ${out}`);
}

main().catch((error) => {
  console.error('[probe] failed:', error);
  process.exit(1);
});
