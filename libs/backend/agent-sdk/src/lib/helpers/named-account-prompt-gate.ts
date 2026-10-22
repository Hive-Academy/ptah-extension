import type { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';

export type NamedAccountPromptGateState = 'held' | 'committed' | 'closed';

/** One admission only. Follow-up turns require a new gate and approval. */
export interface NamedAccountPromptGate {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly state: NamedAccountPromptGateState;
  /** Retain input locally. Refused after commit or closure. */
  push(message: SDKUserMessage): boolean;
  /** Release only this admission's held input; cannot be reused. */
  commit(): boolean;
  /** Reject admission and discard all undelivered input. */
  reject(): void;
  close(): void;
}

/**
 * Starts empty. The caller commits only after identity approval and durable
 * binding. This primitive does not perform identity checks itself.
 *
 * The shared iterator delivers each approved message once, then ends. It never
 * accepts input after commit. Close, abort and iterator return discard remaining
 * input and release every waiter; messages already delivered cannot be recalled.
 */
export function createNamedAccountPromptGate(
  signal?: AbortSignal,
): NamedAccountPromptGate {
  let state: NamedAccountPromptGateState = 'held';
  const held: SDKUserMessage[] = [];
  const waiters = new Set<() => void>();

  const wake = (): void => {
    const pending = [...waiters];
    waiters.clear();
    for (const resolve of pending) {
      resolve();
    }
  };

  const close = (): void => {
    if (state === 'closed') {
      return;
    }
    state = 'closed';
    held.length = 0;
    signal?.removeEventListener('abort', close);
    wake();
  };

  const iterator: AsyncIterableIterator<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<SDKUserMessage>> {
      // Register synchronously before awaiting so commit/close cannot miss us.
      while (state === 'held') {
        await new Promise<void>((resolve) => waiters.add(resolve));
      }
      if (state === 'committed') {
        const message = held.shift();
        if (message !== undefined) {
          return { done: false, value: message };
        }
        close();
      }
      return { done: true, value: undefined };
    },
    async return(): Promise<IteratorResult<SDKUserMessage>> {
      close();
      return { done: true, value: undefined };
    },
  };

  if (signal?.aborted) {
    close();
  } else {
    signal?.addEventListener('abort', close, { once: true });
  }

  return {
    prompt: iterator,
    get state() {
      return state;
    },
    push(message): boolean {
      if (state !== 'held') {
        return false;
      }
      held.push(message);
      return true;
    },
    commit(): boolean {
      if (state !== 'held') {
        return false;
      }
      state = 'committed';
      wake();
      return true;
    },
    reject: close,
    close,
  };
}
