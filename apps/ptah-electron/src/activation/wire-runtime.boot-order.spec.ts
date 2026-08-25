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
const SOURCE = RAW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^[ \t]*\/\/.*$/gm,
  '',
);

/** Index of a substring, asserting it exists so a rename fails loudly. */
function at(needle: string): number {
  const index = SOURCE.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('wireRuntime — boot ordering (B1)', () => {
  it('brings MCP up BEFORE the heavy boot that issues the first LLM query', () => {
    // `bootHeavyServices` → `bootThothRuntime` starts the memory boot scan,
    // which dials a real curator query per unscanned session. With bring-up
    // after it, those queries saw `mcpServerRunning: false` and ran tool-less
    // while the identical query later in the same boot got the tools.
    // `resolveMcpSessionWiring` reads `IMcpServerStatus.getPort()` live at
    // query time, so this ordering is the whole of the guarantee.
    expect(at('await bringUpSubsystems(')).toBeLessThan(
      at('await bootHeavyServices(startupWorkspaceRoot)'),
    );
  });

  it('registers the workspace-change listener after bring-up and immediately before the startup boot', () => {
    // No `await` may sit between registering the listener and calling the
    // startup boot: an interleaved folder-change event would otherwise win the
    // one-shot latch and the awaited call would return before the boot it was
    // supposed to wait for.
    const listener = at('workspaceProvider.onDidChangeWorkspaceFolders(');
    const startupBoot = at('await bootHeavyServices(startupWorkspaceRoot)');

    expect(at('await bringUpSubsystems(')).toBeLessThan(listener);
    expect(listener).toBeLessThan(startupBoot);
    expect(SOURCE.slice(listener, startupBoot)).not.toContain('await ');
  });

  it('holds the one-shot heavy boot as a promise, not a boolean', () => {
    // A boolean latch answers "has one started"; every caller here needs "has
    // one finished". Under a boolean the workspace-change listener could win
    // the race and `wireRuntime` would return with `refs.*` still null,
    // leaving main.ts's will-quit chain nothing to dispose.
    expect(SOURCE).toContain('let heavyServicesBoot: Promise<void> | null');
    expect(SOURCE).toContain(
      'heavyServicesBoot ??= bootHeavyServicesOnce(workspaceRoot)',
    );
    expect(SOURCE).not.toContain('hasBootedHeavyServices');
  });

  it('has exactly one bringUpSubsystems call site', () => {
    // The reorder moved the block; a merge that reintroduced the old one would
    // start MCP twice (idempotent, but the second call would also re-run
    // `ensureRegisteredForSubagents` against a moved workspace root).
    expect(SOURCE.split('bringUpSubsystems(').length - 1).toBe(1);
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
