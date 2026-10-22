import type { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';

export type NamedAccountPromptGateState = 'held' | 'committed' | 'closed';

/** One long-lived prompt channel with fresh approval for each held batch. */
export interface NamedAccountPromptGate {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly state: NamedAccountPromptGateState;
  /** Retain input locally for the next commit. Refused after closure. */
  push(message: SDKUserMessage): boolean;
  /** Release only this admission's held input; later input needs a fresh commit. */
  commit(): boolean;
  /** Reject admission and discard all undelivered input. */
  reject(): void;
  close(): void;
}

/**
 * Starts empty. The caller commits only after identity approval and durable
 * binding. This primitive does not perform identity checks itself.
 *
 * The shared iterator delivers each approved message once, then waits for more.
 * Later input stays held until a fresh commit. Close, abort and iterator return
 * discard remaining input and release every waiter; messages already delivered
 * cannot be recalled.
 */
export function createNamedAccountPromptGate(
  signal?: AbortSignal,
): NamedAccountPromptGate {
  let state: NamedAccountPromptGateState = 'held';
  const held: SDKUserMessage[] = [];
  const committed: SDKUserMessage[] = [];
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
    held.length = committed.length = 0;
    signal?.removeEventListener('abort', close);
    wake();
  };

  const iterator: AsyncIterableIterator<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<SDKUserMessage>> {
      while (state !== 'closed') {
        const message = committed.shift();
        if (message !== undefined) {
          return { done: false, value: message };
        }
        // Register synchronously before awaiting so commit/close cannot miss us.
        await new Promise<void>((resolve) => waiters.add(resolve));
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
      if (state === 'closed') {
        return false;
      }
      state = 'held';
      held.push(message);
      return true;
    },
    commit(): boolean {
      if (state !== 'held') {
        return false;
      }
      committed.push(...held);
      held.length = 0;
      state = 'committed';
      wake();
      return true;
    },
    reject: close,
    close,
  };
}
