/**
 * B1 + C3 (TASK_2026_315) — activation-order and heap-budget invariants.
 *
 * These are SOURCE assertions, deliberately. `wireRuntime` is a ~450-line
 * activation function that resolves two dozen DI tokens, opens SQLite, reaches
 * the network and builds an Electron application menu; standing it up in Jest
 * would test the mock graph, not the ordering. What actually broke here is
 * textual sequence inside one function body, and that is what these pin — the
 * same technique `libs/backend/skill-synthesis` uses to keep provider ids out
 * of the lane resolver.
 *
 * The behaviour behind them was verified against a real boot
 * (`tmp/logs/b4-verify.log`): MCP reaches port 51820 and `setPtahMcpPort` fires
 * BEFORE `Booting deferred backend services`, and no `[SdkQueryRunner] MCP
 * disabled (server not running)` appears anywhere in the run. These tests exist
 * so a later edit cannot quietly put it back.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const RAW_SOURCE = readFileSync(join(__dirname, 'wire-runtime.ts'), 'utf8');
const RAW_BOOTER_SOURCE = readFileSync(
  join(__dirname, 'boot-heavy-services.ts'),
  'utf8',
);
/**
 * `post-window.ts` is read as TEXT and never imported: it evaluates
 * `import.meta.url`, and `tsconfig.spec.json` compiles with `module: commonjs`,
 * so requiring it fails with `TS1343`. The behaviour that moved OUT of it is
 * covered for real in `start-messaging-gateway.spec.ts`; what is left to pin
 * here is that the inline start did not come back.
 */
const RAW_POST_WINDOW_SOURCE = readFileSync(
  join(__dirname, 'post-window.ts'),
  'utf8',
);

/**
 * The source with comments removed.
 *
 * Every assertion below runs against this rather than the raw file. The
 * negative ones must not be satisfiable by prose: the comment beside the new
 * constant explains what the old `Worker heap after warmup` label got wrong,
 * and quoting a retired string in the explanation of why it was retired is not
 * a regression. Only whole-line `//` comments are stripped, so a `//` inside a
 * URL or string literal survives.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const SOURCE = stripComments(RAW_SOURCE);
const BOOTER_SOURCE = stripComments(RAW_BOOTER_SOURCE);
const POST_WINDOW_SOURCE = stripComments(RAW_POST_WINDOW_SOURCE);

/** Index of a substring, asserting it exists so a rename fails loudly. */
function at(needle: string, source: string = SOURCE): number {
  const index = source.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('wireRuntimePreWindow — boot ordering (B1)', () => {
  it('brings MCP up BEFORE the heavy boot that issues the first LLM query', () => {
    // The heavy boot → `bootThothRuntime` starts the memory boot scan, which
    // dials a real curator query per unscanned session. With bring-up after it,
    // those queries saw `mcpServerRunning: false` and ran tool-less while the
    // identical query later in the same boot got the tools.
    // `resolveMcpSessionWiring` reads `IMcpServerStatus.getPort()` live at
    // query time, so this ordering is the whole of the guarantee.
    expect(at('await bringUpSubsystems(')).toBeLessThan(
      at('booter.startOrJoin(startupWorkspaceRoot)'),
    );
  });

  it('registers the workspace-change listener after bring-up and immediately before the startup RESERVATION', () => {
    // No `await` may sit between registering the listener and reserving the
    // startup root's latch: an interleaved folder-change event would otherwise
    // create the entry for ITS root first, and the startup root would then
    // start a second, concurrent boot (TASK_2026_331 risk 3).
    const listener = at('workspaceProvider.onDidChangeWorkspaceFolders(');
    const reservation = at('booter.startOrJoin(startupWorkspaceRoot)');

    expect(at('await bringUpSubsystems(')).toBeLessThan(listener);
    expect(listener).toBeLessThan(reservation);
    expect(SOURCE.slice(listener, reservation)).not.toContain('await ');
  });

  it('propagates on a folder change ONLY when the root has already booted (TASK_2026_345)', () => {
    // A first switch to a root reserves its heavy boot, and that boot runs the
    // identical user-layer pass plus its own `activation` harness reconcile.
    // Propagating unconditionally beside it put two `mirrorAll` and two
    // `reconcile` passes on the same tree in the same second
    // (`tmp/logs/log.log:1206-1223`). The predicate must be read BEFORE
    // `startOrJoin`, which creates the entry — reading it after always answers
    // "reserved" and the propagation would never fire again.
    const read = at('const alreadyBooted = booter.isReserved(active)');
    const reserve = at('booter.startOrJoin(active)');
    const guard = at('if (alreadyBooted) {');
    const propagate = at("propagateHarness(container, active, 'workspace");

    expect(read).toBeLessThan(reserve);
    expect(reserve).toBeLessThan(guard);
    expect(guard).toBeLessThan(propagate);
    expect(SOURCE.slice(read, reserve)).not.toContain('await ');
    // Exactly one propagation call site in this file, and it is the guarded one.
    expect(SOURCE.split('propagateHarness(').length - 1).toBe(1);
  });

  it('has exactly one bringUpSubsystems call site', () => {
    // The reorder moved the block; a merge that reintroduced the old one would
    // start MCP twice (idempotent, but the second call would also re-run
    // `ensureRegisteredForSubagents` against a moved workspace root).
    expect(SOURCE.split('bringUpSubsystems(').length - 1).toBe(1);
  });

  it('keeps the heavy boot out of the pre-window phase entirely', () => {
    // The window is created by `registerPostWindow`, which runs between
    // `wireRuntimePreWindow` and `postWindow()`. Anything that opens SQLite,
    // reconciles the harness or imports sessions from inside the pre-window
    // body would put itself back in front of the window.
    expect(SOURCE).not.toContain('bootThothRuntime');
    expect(SOURCE).not.toContain('scanAndImport');
    expect(SOURCE).not.toContain('reconcileHarness');
  });
});

describe('boot-heavy-services — the post-window boot (B1)', () => {
  it('opens SQLite FIRST, before the harness and the session import', () => {
    // Until the readiness contract lands there is no way for an RPC to learn
    // that SQLite is not open yet, so the ONLY bound on that window is this
    // ordering. `bootThothRuntime` awaits `openAndMigrate()` before its own
    // scans, so being first here is what makes the window short.
    const thoth = at('await bootThothRuntime(', BOOTER_SOURCE);
    expect(thoth).toBeLessThan(at('refreshUserLayer(', BOOTER_SOURCE));
    expect(thoth).toBeLessThan(at('reconcileHarness(', BOOTER_SOURCE));
    expect(thoth).toBeLessThan(at('scanAndImport(', BOOTER_SOURCE));
  });

  it('keeps the deliberate double harness reconcile', () => {
    // One pass before the network so a warm start has skills immediately, one
    // after the download so a cold first run does not wait for the NEXT app
    // start (TASK_2026_278). Collapsing them is defect 8.
    expect(BOOTER_SOURCE.split('reconcileHarness(').length - 1).toBe(2);
    // Two CALL SITES for the user-layer pass, same two moments. Since
    // TASK_2026_345 the mirror, the reconcile and the catalog sync are ONE
    // call — `refreshUserLayer` — behind a per-root coalescer, so a boot can no
    // longer run three separately-ordered steps that a concurrent propagation
    // could interleave with.
    expect(BOOTER_SOURCE.split('refreshUserLayer(').length - 1).toBe(2);
    expect(BOOTER_SOURCE).not.toContain('mirrorUserLayer(');
    expect(BOOTER_SOURCE).not.toContain('syncSkillRegistryCatalog(');
  });

  it('holds the one-shot boot as a promise per root, not a boolean', () => {
    // A boolean latch answers "has one started"; every caller needs "has one
    // finished". Keyed by NORMALIZED root so two spellings of one directory
    // join a single boot instead of starting two.
    expect(BOOTER_SOURCE).toContain(
      'const boots = new Map<string, Promise<void>>()',
    );
    expect(BOOTER_SOURCE).toContain('boots.set(key, reserved)');
    expect(BOOTER_SOURCE).toContain('normalizeWorkspaceRoot(workspaceRoot)');
    expect(BOOTER_SOURCE).not.toContain('hasBootedHeavyServices');
  });

  it('reserves synchronously — the map entry is created before any await', () => {
    const reserveStart = at(
      'startOrJoin(workspaceRoot: string | undefined): Promise<void> {',
      BOOTER_SOURCE,
    );
    const setEntry = at('boots.set(key, reserved)', BOOTER_SOURCE);
    expect(BOOTER_SOURCE.slice(reserveStart, setEntry)).not.toContain('await ');
  });
});

describe('the persistence gate (TASK_2026_347)', () => {
  /** The happy-path mark; the other call site is the aborted early return. */
  const HAPPY_PATH_MARK = 'sqliteOpen: thoth.sqliteConnection?.isOpen';

  it('opens the gate immediately after bootThothRuntime and before the mirror', () => {
    // `bootThothRuntime` awaits `openAndMigrate()` to completion, so this is
    // the first instant at which SQLite is open AND migrated. Marking earlier
    // would hand a waiter a database whose migration runner is still applying.
    const thoth = at('await bootThothRuntime(', BOOTER_SOURCE);
    const mark = at(HAPPY_PATH_MARK, BOOTER_SOURCE);

    expect(thoth).toBeLessThan(mark);
    expect(mark).toBeLessThan(at('refreshUserLayer(', BOOTER_SOURCE));
  });

  it('also settles the gate on the aborted early return', () => {
    // Otherwise a quit before the gate opens parks every gated consumer for the
    // rest of the process.
    const abortReturn = at('if (signal.aborted) {', BOOTER_SOURCE);
    const firstMark = at('coordinator.markPersistenceSettled(', BOOTER_SOURCE);

    expect(firstMark).toBeGreaterThan(abortReturn);
    expect(firstMark).toBeLessThan(
      at('await bootThothRuntime(', BOOTER_SOURCE),
    );
    expect(
      BOOTER_SOURCE.split('coordinator.markPersistenceSettled(').length - 1,
    ).toBe(2);
  });
});

describe('post-window — the gateway start is delegated and gated', () => {
  it('delegates to startMessagingGateway', () => {
    expect(POST_WINDOW_SOURCE).toContain('startMessagingGateway({');
    expect(POST_WINDOW_SOURCE).toContain('coordinator,');
  });

  it('no longer starts the gateway or the bridge inline', () => {
    // The inline IIFE ran during `registerPostWindow`, which is BEFORE
    // `coordinator.startPostWindow(...)` opens SQLite — the whole defect.
    expect(POST_WINDOW_SOURCE).not.toContain('await gateway.start()');
    expect(POST_WINDOW_SOURCE).not.toContain('bridge.start()');
    expect(POST_WINDOW_SOURCE).not.toContain('GATEWAY_STATUS_CHANGED');
  });
});

describe('wireRuntime — embedder warmup heap budget (C3)', () => {
  it('states the threshold once, as a named constant', () => {
    // It used to be an inline `200` in both the comparison and the message it
    // printed, so the two could drift and neither said what it was for.
    expect(SOURCE).toContain('const WARMUP_HEAP_DELTA_BUDGET_MB = 48');
    expect(SOURCE).not.toContain('budget: 200 MB');
  });

  it('measures the heap DELTA across warmup, not the absolute heap', () => {
    // The embedder runs in a utilityProcess, so `process.memoryUsage()` here
    // reports the MAIN process. Absolute heap tracked workspace size (56.3 /
    // 246.0 / 272.0 MB across three captures) and said nothing about warmup.
    // The delta is attributable, because the index cost is on both sides of
    // the subtraction.
    expect(SOURCE).toContain('const heapBeforeMb = heapUsedMb()');
    expect(SOURCE).toContain('const heapAfterMb = heapUsedMb()');
    expect(SOURCE).toContain('deltaMb > WARMUP_HEAP_DELTA_BUDGET_MB');
  });

  it('no longer calls the main-process heap "Worker heap"', () => {
    expect(SOURCE).not.toContain('Worker heap after warmup');
  });
});
