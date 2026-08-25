import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type { VecLoadDiagnostic } from '@ptah-extension/persistence-sqlite';

import { DEFAULT_THOTH_LOG_PREFIX } from './types';

export function serializeVecDiagnosticForBridge(
  diagnostic: VecLoadDiagnostic,
): {
  ok: boolean;
  reason: VecLoadDiagnostic['reason'];
  electronVersion: string;
  processArch: string;
  processPlatform: string;
  attemptedPath?: string;
  packageName?: string;
  fsExists?: boolean;
  error?: { code?: string; message: string };
  errorChain?: ReadonlyArray<{
    strategy: string;
    code?: string;
    message: string;
  }>;
} {
  return {
    ok: diagnostic.ok,
    reason: diagnostic.reason,
    electronVersion: diagnostic.electronVersion,
    processArch: diagnostic.processArch,
    processPlatform: diagnostic.processPlatform,
    attemptedPath: diagnostic.attemptedPath,
    packageName: diagnostic.packageName,
    fsExists: diagnostic.fsExists,
    error: diagnostic.error
      ? { code: diagnostic.error.code, message: diagnostic.error.message }
      : undefined,
    errorChain: diagnostic.errorChain?.map((e) => ({
      strategy: e.strategy,
      code: e.code,
      message: e.message,
    })),
  };
}

export function serializeEmbedderSnapshotForBridge(
  snapshot: import('@ptah-extension/memory-curator').EmbedderStatusSnapshot,
): {
  ready: boolean;
  downloading: boolean;
  progress?: number;
  error?: { code?: string; message: string };
} {
  const base = {
    ready: snapshot.ready,
    downloading: snapshot.downloading,
  };
  const withProgress =
    snapshot.progress !== undefined
      ? { ...base, progress: snapshot.progress }
      : base;
  return snapshot.error
    ? {
        ...withProgress,
        error: {
          code: snapshot.error.code,
          message: snapshot.error.message,
        },
      }
    : withProgress;
}

let vecLoadDiagnosticEmitted = false;

/**
 * Test-only reset for the module-level "emit once per process" latch.
 * Production code must never call this.
 */
export function resetVecLoadDiagnosticForTest(): void {
  vecLoadDiagnosticEmitted = false;
}

export function emitVecLoadDiagnostic(
  container: DependencyContainer,
  diagnostic: VecLoadDiagnostic,
  logPrefix: string = DEFAULT_THOTH_LOG_PREFIX,
): void {
  if (vecLoadDiagnosticEmitted) return;
  vecLoadDiagnosticEmitted = true;

  const attempts = diagnostic.errorChain?.length ?? 0;

  if (diagnostic.ok) {
    // A LOADED extension is not a diagnostic. `SqliteConnectionService` walks
    // its resolver strategies in order and stops at the first one that loads,
    // so on Electron the `primary-resolver` miss is the EXPECTED opening move —
    // it probes `app.asar.unpacked` and the packaged `dist` tree, neither of
    // which exists under `nx serve`. Printing its `errorChain` here rendered
    // that expected miss as a nineteen-line block naming two absent paths, on
    // every single boot, for a subsystem that was working (TASK_2026_315 C7).
    //
    // So the success path keeps the FACTS a reader needs — which path won,
    // from which package, and how many strategies were skipped to get there —
    // and drops the per-strategy messages, which are only actionable when
    // nothing loaded at all. `attempts` is retained precisely so a fallback
    // load stays visible as a non-zero count rather than becoming invisible:
    // silence here would hide a machine that has quietly stopped resolving via
    // its primary path. The full chain is still on the `VecLoadDiagnostic`
    // object and still reaches the renderer through
    // `serializeVecDiagnosticForBridge`, so nothing is lost — only unasked-for.
    //
    // `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:592` already
    // built its summary without `chain` for the same reason; this is the
    // Electron/VS Code side catching up.
    console.debug('[persistence-sqlite] sqlite-vec diagnostic', {
      ok: true,
      reason: diagnostic.reason,
      attemptedPath: diagnostic.attemptedPath,
      packageName: diagnostic.packageName,
      fsExists: diagnostic.fsExists,
      attempts,
    });
  } else {
    // Nothing loaded. This is the case the block was written for: the chain is
    // the only record of WHY each strategy was rejected, and it must survive
    // intact — including the host facts, which are what make a bug report
    // about a missing native binary reproducible.
    console.warn('[persistence-sqlite] sqlite-vec diagnostic (offline)', {
      ok: false,
      reason: diagnostic.reason,
      attemptedPath: diagnostic.attemptedPath,
      packageName: diagnostic.packageName,
      fsExists: diagnostic.fsExists,
      electronVersion: diagnostic.electronVersion,
      processArch: diagnostic.processArch,
      processPlatform: diagnostic.processPlatform,
      error: diagnostic.error,
      attempts,
      chain: diagnostic.errorChain,
    });
  }

  if (!diagnostic.ok) {
    try {
      const sentry = container.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
      if (sentry.isInitialized()) {
        sentry.addBreadcrumb(
          'persistence.sqlite-vec',
          `sqlite-vec load ${diagnostic.reason}`,
          {
            reason: diagnostic.reason,
            packageName: diagnostic.packageName,
            fsExists: diagnostic.fsExists,
            electronVersion: diagnostic.electronVersion,
            processArch: diagnostic.processArch,
            processPlatform: diagnostic.processPlatform,
            errorCode: diagnostic.error?.code,
            errorMessage: diagnostic.error?.message,
            attempts: diagnostic.errorChain?.length ?? 0,
          },
        );
      }
    } catch (sentryError: unknown) {
      console.warn(
        `${logPrefix} failed to emit sentry breadcrumb for vec diagnostic`,
        sentryError instanceof Error
          ? sentryError.message
          : String(sentryError),
      );
    }
  }
}
