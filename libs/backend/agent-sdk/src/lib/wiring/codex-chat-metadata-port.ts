import { CodexRuntimeCompositionError } from './codex-runtime-composition-error';
import type { SessionMetadataStore } from '../session-metadata-store';
import type { CodexChatMetadataPort } from '../codex-app-server/codex-chat-adapter';

/** Pass the initialized lookup as the writer so persistence also updates routing. */
export function createCodexChatMetadataPort(
  store: Pick<SessionMetadataStore, 'updateCodexExecution' | 'incrementCodexMessageCount'>,
): CodexChatMetadataPort {
  return {
    completedTurn: (sessionId) => store.incrementCodexMessageCount(sessionId),
    save: (sessionId, identity, title) => {
      if (sessionId !== identity.threadId) {
        return Promise.reject(
          new CodexRuntimeCompositionError('session-thread-mismatch'),
        );
      }
      return store.updateCodexExecution(sessionId, () => ({
        version: 1,
        runtime: 'codex-app-server',
        sessionId,
        providerId: identity.providerId,
        workspaceId: identity.workspaceId,
        codex: { normalizedHome: identity.normalizedHome },
      }), undefined, title);
    },
  };
}
