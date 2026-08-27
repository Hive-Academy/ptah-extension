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
    expect(thoth).toBeLessThan(at('mirrorUserLayer(', BOOTER_SOURCE));
    expect(thoth).toBeLessThan(at('reconcileUserLayer(', BOOTER_SOURCE));
    expect(thoth).toBeLessThan(at('reconcileHarness(', BOOTER_SOURCE));
    expect(thoth).toBeLessThan(at('scanAndImport(', BOOTER_SOURCE));
  });

  it('keeps the deliberate double harness reconcile', () => {
    // One pass before the network so a warm start has skills immediately, one
    // after the download so a cold first run does not wait for the NEXT app
    // start (TASK_2026_278). Collapsing them is defect 8.
    expect(BOOTER_SOURCE.split('reconcileHarness(').length - 1).toBe(2);
    expect(BOOTER_SOURCE.split('mirrorUserLayer(').length - 1).toBe(2);
    expect(BOOTER_SOURCE.split('reconcileUserLayer(').length - 1).toBe(2);
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
