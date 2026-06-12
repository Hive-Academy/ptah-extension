import type { DependencyContainer } from 'tsyringe';

import { type Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  PERSISTENCE_TOKENS,
  VecStatusService,
  type VecLoadDiagnostic,
} from '@ptah-extension/persistence-sqlite';
import {
  MEMORY_TOKENS,
  type MemoryCuratorService,
  type EmbedderStatusService,
  type EmbedderStatusSnapshot,
  type ObservationQueueStore,
  type CorpusStore,
} from '@ptah-extension/memory-curator';

import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter.js';

interface PushDisposable {
  dispose: () => void;
}

export function wireThothPushBridges(
  container: DependencyContainer,
  pushAdapter: CliWebviewManagerAdapter,
  logger: Logger,
): PushDisposable[] {
  const disposables: PushDisposable[] = [];

  try {
    if (container.isRegistered(MEMORY_TOKENS.MEMORY_CURATOR)) {
      const memoryCurator = container.resolve<MemoryCuratorService>(
        MEMORY_TOKENS.MEMORY_CURATOR,
      );
      disposables.push(
        memoryCurator.onEvent((ev) => {
          if (
            ev.kind === 'curator-run' &&
            ev.stats &&
            typeof ev.stats['created'] === 'number' &&
            (ev.stats['created'] as number) > 0
          ) {
            void pushAdapter.broadcastMessage(MESSAGE_TYPES.MEMORY_EXTRACTED, {
              sessionId: ev.sessionId ?? '',
              workspaceRoot: null,
              extracted: Number(ev.stats['extracted'] ?? 0),
              created: Number(ev.stats['created'] ?? 0),
              merged: Number(ev.stats['merged'] ?? 0),
              timestamp: ev.timestamp,
            });
          }
        }),
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Memory curator push bridge skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (container.isRegistered(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)) {
      const queueStore = container.resolve<ObservationQueueStore>(
        MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
      );
      disposables.push(
        queueStore.onCapture((evt) => {
          void pushAdapter.broadcastMessage(
            MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED,
            evt,
          );
        }),
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Observation push bridge skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (container.isRegistered(MEMORY_TOKENS.CORPUS_STORE)) {
      const corpusStore = container.resolve<CorpusStore>(
        MEMORY_TOKENS.CORPUS_STORE,
      );
      disposables.push(
        corpusStore.onChange((evt) => {
          void pushAdapter.broadcastMessage(
            MESSAGE_TYPES.MEMORY_CORPUS_CHANGED,
            evt,
          );
        }),
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Corpus push bridge skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (container.isRegistered(PERSISTENCE_TOKENS.VEC_STATUS)) {
      const vecStatus = container.resolve<VecStatusService>(
        PERSISTENCE_TOKENS.VEC_STATUS,
      );
      disposables.push(
        vecStatus.on('change', (snapshot) => {
          void pushAdapter.broadcastMessage(MESSAGE_TYPES.VEC_STATUS_CHANGED, {
            ok: snapshot.available,
            diagnostic: serializeVecDiagnostic(snapshot.diagnostic),
          });
        }),
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Vec status push bridge skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (container.isRegistered(MEMORY_TOKENS.EMBEDDER_STATUS)) {
      const embedderStatus = container.resolve<EmbedderStatusService>(
        MEMORY_TOKENS.EMBEDDER_STATUS,
      );
      disposables.push(
        embedderStatus.on('change', (snapshot) => {
          void pushAdapter.broadcastMessage(
            MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
            { status: serializeEmbedderSnapshot(snapshot) },
          );
        }),
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Embedder status push bridge skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return disposables;
}

function serializeVecDiagnostic(diagnostic: VecLoadDiagnostic): {
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

function serializeEmbedderSnapshot(snapshot: EmbedderStatusSnapshot): {
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
