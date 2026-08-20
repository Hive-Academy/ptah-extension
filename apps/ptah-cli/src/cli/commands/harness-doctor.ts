/**
 * `ptah harness doctor` / `ptah harness remove` — the harness-drift surface
 * (TASK_2026_278 Batch 4).
 *
 * Split out of `harness.ts` purely for size: that file already carries the ten
 * Setup-Builder sub-commands, and folding these two in pushes it past the
 * 700-line ceiling. `execute()` in `harness.ts` is still the single entry point
 * and its signature is unchanged — these are just its two dispatch targets.
 *
 * ## Why RPC and not the container
 *
 * Both verbs go over `ctx.transport` rather than resolving the reconciler out of
 * DI, for the same reason the rest of the harness family does: VS Code,
 * Electron, the CLI and the TUI must dispatch IDENTICAL verbs, so the health a
 * `--json` pipeline reads is the health the Marketplace badge renders. The
 * TUI's `/harness` slash command reuses this exact wire path, and the unit test
 * suite hands in a container whose `resolve` throws to keep it that way.
 *
 * ## Why `requireSdk: false`
 *
 * Both verbs are FILESYSTEM operations — they walk `~/.ptah/user`, compare
 * hashes against the per-target manifests, and copy or unlink files. Not one of
 * them asks a model anything. Booting them behind the SDK agent adapter's
 * `initialize()` made `ptah harness doctor` fail with `sdk_init_failed` on any
 * machine without an API key configured, which is exactly the machine a CI gate
 * on harness drift runs on.
 *
 * The mode stays `'full'`, and that half is NOT incidental. `harness:health`,
 * `harness:reconcile` and `harness:remove` are registered in DI phase 4, and
 * phase 4 is also where `PluginLoaderService.initialize()` and `bootHarness`
 * run — the wiring that gives the reconciler its desired state. Under
 * `mode: 'minimal'` the doctor would still answer, but it would answer over an
 * EMPTY plugin overlay and report a clean harness for a workspace missing every
 * plugin skill. A CI gate that goes green on a broken tree is worse than one
 * that will not boot.
 *
 * Content download stays fire-and-forget and is never awaited here: an offline
 * run is a real run, and `HarnessManifestBuilder` already reports that state
 * honestly as `pending-download` / `sources-missing` (which `summarizeHarnessHealth`
 * grades `degraded`, so the exit code is still 1).
 *
 * ## Why the health rule is not implemented here
 *
 * `summarizeHarnessHealth` in `libs/shared` is the ONE definition of "healthy",
 * shared with the badge and the `harness:healthChanged` push. Re-deriving the
 * rule from `missing`/`sources` here would let the CLI and the panel disagree
 * about the same report, so this module only consumes the reducer.
 */

import {
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessHealthLevel,
  type HarnessHealthResult,
  type HarnessReconcileResult,
  type HarnessRemoveResult,
} from '@ptah-extension/shared';
import type {
  CliMessageTransport,
  withEngine,
} from '@ptah-extension/cli-engine';

import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
// The same unwrap-or-throw helper `ptah spec` uses. There is no third copy of
// this in the tree and there should not be one.
import { callRpc } from './thoth-command-shared.js';

/**
 * Structural stderr sink. Mirrors `HarnessStderrLike` in `harness.ts`, declared
 * locally so this module never has to import back into its own dispatcher.
 */
interface StderrSink {
  write(chunk: string): boolean;
}

/** Options `doctor` reads off the parsed `HarnessOptions`. */
export interface HarnessDoctorRunOptions {
  /** Reconcile before reporting instead of only measuring. */
  fix?: boolean;
}

/** Options `remove` reads off the parsed `HarnessOptions`. */
export interface HarnessRemoveRunOptions {
  /** Explicit confirmation. Absent means refuse. */
  yes?: boolean;
}

/**
 * Map a health level onto a process exit code.
 *
 * Deliberately STRICTER than `ptah spec doctor`, which exits 0 even when it
 * finds problems: that doctor reports on a task tree the user is still
 * authoring, so a non-zero code would fail a build over an in-progress folder.
 * This doctor is meant to be usable as a CI gate on harness drift — a pipeline
 * step that "runs the harness doctor" has to go red when the harness is not
 * whole, otherwise the check is decorative.
 *
 * `unknown` is NOT a failure. It means no report exists at all (no workspace is
 * open), and there is no drift to gate on.
 */
function exitCodeFor(level: HarnessHealthLevel): number {
  return level === 'degraded' || level === 'error'
    ? ExitCode.GeneralError
    : ExitCode.Success;
}

/**
 * `ptah harness doctor [--fix]`.
 *
 * Emits exactly one `harness.doctor` notification carrying the whole report
 * plus its summary, so `--json` output stays a single parseable document.
 */
export async function runHarnessDoctor(
  opts: HarnessDoctorRunOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const fix = opts.fix === true;

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    // `--fix` reconciles and reports on the POST-fix state: the reconcile result
    // already carries the health of the pass it just ran, so a second
    // `harness:health` would only re-walk the same tree.
    const health = fix
      ? await reconcile(ctx.transport)
      : await measure(ctx.transport);

    const summary = summarizeHarnessHealth(health);

    await formatter.writeNotification('harness.doctor', {
      fixed: fix,
      health,
      summary,
    });

    return exitCodeFor(summary.level);
  });
}

async function reconcile(
  transport: CliMessageTransport,
): Promise<HarnessHealth | null> {
  const result = await callRpc<HarnessReconcileResult>(
    transport,
    'harness:reconcile',
    { mode: 'full' },
  );
  return result?.health ?? null;
}

async function measure(
  transport: CliMessageTransport,
): Promise<HarnessHealth | null> {
  const result = await callRpc<HarnessHealthResult>(
    transport,
    'harness:health',
    { refresh: true },
  );
  return result?.health ?? null;
}

/**
 * `ptah harness remove --yes`.
 *
 * The confirmation flag is required rather than prompted: the CLI's default
 * mode is machine output on a pipe, where there is nobody to prompt, and this
 * deletes every managed copy in the workspace.
 */
export async function runHarnessRemove(
  opts: HarnessRemoveRunOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: StderrSink,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.yes !== true) {
    stderr.write(
      'ptah harness remove: --yes is required to confirm removal of all Ptah-managed harness files\n',
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<HarnessRemoveResult>(
      ctx.transport,
      'harness:remove',
      { confirm: true },
    );
    const health = result?.health ?? null;

    await formatter.writeNotification('harness.removed', {
      removed: result?.removed ?? 0,
      health,
      summary: summarizeHarnessHealth(health),
    });
    // A removal that removed nothing still succeeded at removing.
    return ExitCode.Success;
  });
}
