import { normalizeCodexWorkspaceKey } from '@ptah-extension/codex-runtime';
import type {
  CodexThreadIdentity,
  CodexThreadIdentityStore,
} from '@ptah-extension/codex-runtime';
import { SessionId } from '@ptah-extension/shared';
import {
  parseCodexThreadRecord,
  type CodexThreadRecord,
  type SessionMetadata,
  type SessionMetadataStore,
} from '../session-metadata-store';

export type CodexThreadIdentityPersistErrorCode =
  'invalid-identity' | 'context-mismatch' | 'stale-generation' | 'write-failed';

const messages: Record<CodexThreadIdentityPersistErrorCode, string> = {
  'invalid-identity': 'Codex thread identity is invalid',
  'context-mismatch': 'Codex thread is mapped to a different context',
  'stale-generation': 'A newer Codex process generation owns this thread',
  'write-failed': 'Codex thread identity could not be persisted',
};

/** A launch must be refused when this is thrown; no turn may start. */
export class CodexThreadIdentityPersistError extends Error {
  constructor(
    readonly code: CodexThreadIdentityPersistErrorCode,
    options?: { readonly cause?: unknown },
  ) {
    super(`[CodexThreadIdentityStore] ${messages[code]}`, options);
    this.name = 'CodexThreadIdentityPersistError';
  }
}

type CodexExecution = NonNullable<SessionMetadata['codexExecution']>;

function sameBinding(
  identity: CodexThreadIdentity,
  thread: CodexThreadRecord,
  execution: CodexExecution | undefined,
): boolean {
  return (
    execution !== undefined &&
    thread.contextId === identity.contextId &&
    thread.processGeneration === identity.processGeneration &&
    thread.profileFingerprint === identity.profileFingerprint &&
    thread.workspaceId === identity.workspaceId &&
    execution.providerId === identity.providerId &&
    execution.codex.normalizedHome === identity.normalizedHome &&
    execution.workspaceId ===
      normalizeCodexWorkspaceKey(identity.workspaceId, process.platform)
  );
}

function toIdentity(row: SessionMetadata, consumer: 'chat' | 'lane'): CodexThreadIdentity | undefined {
  const thread = parseCodexThreadRecord(row.codexThread);
  const execution = row.codexExecution;
  if (!thread || !execution) return undefined;
  if ((thread.consumer === 'lane' ? 'lane' : 'chat') !== consumer) return undefined;
  return Object.freeze({
    threadId: row.sessionId,
    contextId: thread.contextId,
    processGeneration: thread.processGeneration,
    normalizedHome: execution.codex.normalizedHome,
    workspaceId: thread.workspaceId,
    providerId: execution.providerId,
    profileFingerprint: thread.profileFingerprint,
  });
}

/**
 * Persists only the context-to-thread mapping in the session record that also
 * carries `codexExecution`, so SESSION_RUNTIME_IDENTITY_LOOKUP and this store
 * read one record. Pass the initialized lookup as `writer` so its cache agrees
 * with every write. Conversation history stays in the App Server thread.
 */
export function createCodexThreadIdentityStore(
  writer: Pick<SessionMetadataStore, 'updateCodexExecution'>,
  reader: Pick<SessionMetadataStore, 'getAll' | 'get'>,
  consumer: 'chat' | 'lane' = 'chat',
): CodexThreadIdentityStore {
  return {
    async persist(identity) {
      if (!SessionId.validate(identity.threadId))
        throw new CodexThreadIdentityPersistError('invalid-identity');
      const sessionId = identity.threadId;
      try {
        await writer.updateCodexExecution(
          sessionId,
          () => ({
            version: 1,
            runtime: 'codex-app-server',
            sessionId,
            providerId: identity.providerId,
            workspaceId: identity.workspaceId,
            codex: { normalizedHome: identity.normalizedHome },
          }),
          (current) => {
            if (current && (current.consumer === 'lane' ? 'lane' : 'chat') !== consumer)
              throw new CodexThreadIdentityPersistError('context-mismatch');
            if (current && current.contextId !== identity.contextId)
              throw new CodexThreadIdentityPersistError('context-mismatch');
            if (
              current &&
              current.processGeneration > identity.processGeneration
            )
              throw new CodexThreadIdentityPersistError('stale-generation');
            return {
              version: 1,
              contextId: identity.contextId,
              processGeneration: identity.processGeneration,
              workspaceId: identity.workspaceId,
              profileFingerprint: identity.profileFingerprint,
              state: 'active',
              ...(consumer === 'lane' ? { consumer: 'lane' as const } : {}),
            };
          },
        );
      } catch (error) {
        if (error instanceof CodexThreadIdentityPersistError) throw error;
        throw new CodexThreadIdentityPersistError('write-failed', {
          cause: error,
        });
      }
    },

    async markInactive(identity) {
      if (!SessionId.validate(identity.threadId)) return;
      await writer.updateCodexExecution(
        identity.threadId,
        (current) => {
          // Reached only after the thread updater matched a stored execution.
          if (!current)
            throw new CodexThreadIdentityPersistError('invalid-identity');
          return current;
        },
        (current, execution) =>
          current &&
          current.state === 'active' &&
          (current.consumer === 'lane' ? 'lane' : 'chat') === consumer &&
          sameBinding(identity, current, execution)
            ? { ...current, state: 'inactive' }
            : current,
      );
    },

    async read(contextId) {
      let match: CodexThreadIdentity | undefined;
      for (const row of await reader.getAll()) {
        const identity = toIdentity(row, consumer);
        if (
          identity?.contextId === contextId &&
          (!match || identity.processGeneration > match.processGeneration)
        )
          match = identity;
      }
      if (!match) return undefined;
      // Listings are lean summaries; the detail row is authoritative.
      const detail = await reader.get(match.threadId);
      const identity = detail ? toIdentity(detail, consumer) : undefined;
      return identity?.contextId === contextId ? identity : undefined;
    },
  };
}
