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

  const summary = {
    ok: diagnostic.ok,
    reason: diagnostic.reason,
    attemptedPath: diagnostic.attemptedPath,
    packageName: diagnostic.packageName,
    fsExists: diagnostic.fsExists,
    electronVersion: diagnostic.electronVersion,
    processArch: diagnostic.processArch,
    processPlatform: diagnostic.processPlatform,
    error: diagnostic.error,
    attempts: diagnostic.errorChain?.length ?? 0,
    chain: diagnostic.errorChain,
  };

  if (diagnostic.ok) {
    console.log('[persistence-sqlite] sqlite-vec diagnostic', summary);
  } else {
    console.warn(
      '[persistence-sqlite] sqlite-vec diagnostic (offline)',
      summary,
    );
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
