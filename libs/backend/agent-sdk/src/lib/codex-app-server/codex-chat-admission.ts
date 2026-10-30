import type { Logger } from '@ptah-extension/vscode-core';
import { CodexChatAdapterError } from './codex-chat-adapter-error';

/** The turn/start receipt is the boundary between admission and stream delivery. */
export interface CodexChatAdmission {
  accepted(): void;
  ended(): void;
  rejected(error: unknown): void;
}

export function publishUntilAdmitted(
  publish: (admission: CodexChatAdmission) => Promise<void>,
  logger: Logger,
): Promise<void> {
  let admitted = false;
  let ended = false;
  let decided = false;
  let resolveAdmission: () => void = () => undefined;
  let rejectAdmission: (error: unknown) => void = () => undefined;
  const admissionResult = new Promise<void>((resolve, reject) => {
    resolveAdmission = resolve;
    rejectAdmission = reject;
  });
  const admission: CodexChatAdmission = {
    accepted: () => {
      if (decided) return;
      decided = true;
      admitted = true;
      resolveAdmission();
    },
    ended: () => {
      if (decided) return;
      decided = true;
      ended = true;
      // The broadcaster must detach before chat:continue checks isStreaming.
    },
    rejected: (error) => {
      if (decided) return;
      decided = true;
      rejectAdmission(error);
    },
  };

  // Observe the entire publisher even after admission. Its finally block owns
  // iterator.return(), and a late publisher rejection must not be unhandled.
  void Promise.resolve().then(() => publish(admission)).then(
    () => {
      if (ended) {
        resolveAdmission();
        return;
      }
      if (!decided) admission.rejected(new CodexChatAdapterError('runtime-failed', 'publish'));
    },
    (error: unknown) => {
      if (ended) {
        rejectAdmission(error);
        return;
      }
      if (!admitted) {
        admission.rejected(error);
        return;
      }
      logger.error(
        '[CodexChatAdapter] Follow-up publisher failed after admission.',
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  );
  return admissionResult;
}
