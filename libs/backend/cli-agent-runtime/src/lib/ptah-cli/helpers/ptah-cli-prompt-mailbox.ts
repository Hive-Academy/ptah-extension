import type { SDKUserMessage } from '@ptah-extension/agent-sdk';

export interface PromptMailbox {
  readonly prompt: AsyncGenerator<SDKUserMessage>;
  push(message: string): void;
  close(): void;
}

function toUserMessage(message: string): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: message,
    },
    parent_tool_use_id: null,
  };
}

export function createPromptMailbox(initialTask: string): PromptMailbox {
  const queue: SDKUserMessage[] = [toUserMessage(initialTask)];
  let closed = false;
  let notify: (() => void) | null = null;

  const waitForNext = (): Promise<void> =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });

  const wake = (): void => {
    if (notify) {
      const resolve = notify;
      notify = null;
      resolve();
    }
  };

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) {
          yield next;
        }
      }
      if (closed) {
        return;
      }
      await waitForNext();
    }
  }

  return {
    prompt: generator(),
    push(message: string): void {
      if (closed) {
        return;
      }
      queue.push(toUserMessage(message));
      wake();
    },
    close(): void {
      closed = true;
      wake();
    },
  };
}
