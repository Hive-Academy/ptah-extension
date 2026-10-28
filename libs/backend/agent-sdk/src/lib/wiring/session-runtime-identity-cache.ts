import { CodexRuntimeCompositionError } from './codex-runtime-composition-error';
import { SessionId, type SessionRuntimeIdentity } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionRuntimeIdentityLookup } from '../codex-app-server/session-runtime-identity';
import type {
  SessionMetadata,
  SessionMetadataStore,
} from '../session-metadata-store';

export interface InitializedSessionRuntimeIdentityLookup extends SessionRuntimeIdentityLookup {
  /** All native identity writes must use this port before publishing the session. */
  updateCodexExecution: SessionMetadataStore['updateCodexExecution'];
  incrementCodexMessageCount: SessionMetadataStore['incrementCodexMessageCount'];
  releaseSession(sessionId: SessionId): void;
  dispose(): void;
}

/** Await before binding host ports. Hosts own disposal and must await every write. */
export async function initializeSessionRuntimeIdentityLookup(
  store: Pick<
    SessionMetadataStore,
    'getAll' | 'get' | 'onMetadataChanged' | 'updateCodexExecution' | 'incrementCodexMessageCount'
  >,
  logger: Logger,
): Promise<InitializedSessionRuntimeIdentityLookup> {
  const entries = new Map<string, SessionRuntimeIdentity>();
  const workspacePaths = new Map<string, string>();
  const sequences = new Map<string, number>();
  const writes = new Map<string, object>();
  const refreshing = new Set<Promise<void>>();
  const initialChanges = new Set<string>();
  let loading = true;
  let disposed = false;
  let sequence = 0;
  const advance = (id: string) => {
    const next = ++sequence;
    sequences.set(id, next);
    if (loading) initialChanges.add(id);
    return next;
  };
  const replace = (id: string, metadata: SessionMetadata | null) => {
    // Only a delete event may remove a known native binding.
    if (!metadata) return;
    const workspacePath = metadata.codexThread?.workspaceId;
    if (workspacePath === undefined) workspacePaths.delete(id);
    else workspacePaths.set(id, workspacePath);
    entries.set(
      id,
      metadata.codexExecution ?? {
        version: 1,
        sessionId: SessionId.from(id),
        runtime: 'claude-sdk',
        providerId: metadata.providerId ?? 'claude-cli',
        workspaceId: metadata.workspaceId,
      },
    );
  };
  const unsubscribe = store.onMetadataChanged(({ sessionId, kind }) => {
    if (disposed) return;
    if (kind === 'deleted') {
      if (loading) initialChanges.add(sessionId);
      writes.delete(sessionId);
      sequences.delete(sessionId);
      entries.delete(sessionId);
      workspacePaths.delete(sessionId);
      return;
    }
    const version = advance(sessionId);
    const refresh = store
      .get(sessionId)
      .then((metadata) => {
        if (!disposed && sequences.get(sessionId) === version)
          replace(sessionId, metadata);
      })
      .catch(() => {
        if (!disposed)
          logger.warn(
            '[CodexRuntimeComposition] Runtime identity refresh failed; retaining binding',
          );
      });
    refreshing.add(refresh);
    void refresh.finally(() => refreshing.delete(refresh));
  });
  const dispose = () => {
    disposed = true;
    unsubscribe();
    entries.clear();
    workspacePaths.clear();
    sequences.clear();
    writes.clear();
    initialChanges.clear();
    refreshing.clear();
  };
  try {
    for (const row of await store.getAll()) {
      if (!initialChanges.has(row.sessionId)) replace(row.sessionId, row);
    }
    await Promise.all(refreshing);
    loading = false;
    initialChanges.clear();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    lookup: (id) => {
      const persisted = entries.get(id);
      return persisted
        ? { persisted, workspacePath: workspacePaths.get(id) }
        : undefined;
    },
    updateCodexExecution: async (id, updater, thread, title) => {
      if (disposed)
        throw new CodexRuntimeCompositionError('identity-lookup-disposed');
      const write = {};
      writes.set(id, write);
      try {
        let written: SessionRuntimeIdentity | undefined;
        await store.updateCodexExecution(
          id,
          (current) => {
            const proposed = updater(current);
            written = proposed;
            return proposed;
          },
          thread,
          title,
        );
        if (disposed || writes.get(id) !== write) return;
        // Commit only after persistence succeeds; prefer the normalized re-read when available.
        if (written) entries.set(id, written);
        const version = advance(id);
        try {
          const metadata = await store.get(id);
          if (!metadata?.codexExecution)
            throw new CodexRuntimeCompositionError(
              'persisted-identity-unavailable',
            );
          if (
            !disposed &&
            sequences.get(id) === version &&
            writes.get(id) === write
          )
            replace(id, metadata);
        } catch {
          if (!disposed)
            logger.warn(
              '[CodexRuntimeComposition] Runtime identity re-read failed; retaining written binding',
              {
                code: 'persisted-identity-unavailable',
              },
            );
        }
      } finally {
        if (writes.get(id) === write) writes.delete(id);
      }
    },
    incrementCodexMessageCount: (id) => store.incrementCodexMessageCount(id),
    releaseSession: (id) => {
      if (entries.get(id)?.runtime === 'codex-app-server') return;
      entries.delete(id);
      workspacePaths.delete(id);
      sequences.delete(id);
    },
    dispose,
  };
}
