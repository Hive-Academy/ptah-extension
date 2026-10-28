import type {
  HookCallback,
  HookJSONOutput,
  Options,
  SDKUserMessage,
} from '../types/sdk-types/claude-sdk.types';

const ADMISSION_PENDING = 'Account admission pending.';

/**
 * Seconds the CLI waits on one held `PreToolUse` call. Above the whole
 * admission chain (each awaited step has its own 15 s deadline), so the hold
 * ends on admission, refusal, abort or dispose, never on the CLI hook timeout.
 */
export const NAMED_ACCOUNT_TOOL_HOLD_SECONDS = 600;

const DENY_TOOL: HookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: ADMISSION_PENDING,
  },
};

function abortedAsDenied(signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) resolve(false);
    else signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}

/**
 * Gates every tool call of a named-account child on one admission check.
 *
 * `bypassPermissions` (lane YOLO) and allow rules approve a tool before
 * `canUseTool` is consulted (SDK 0.3.278 `sdk.mjs:209`,
 * `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`), so the same `admitted` check also runs
 * as a `PreToolUse` hook for every tool, ahead of the caller's own hooks.
 * When admitted the hook gives no decision, so the caller's permission flow
 * (its hooks, mode and `canUseTool`) still applies; otherwise it denies.
 * `admitted` must resolve false on refusal, abort and dispose.
 */
export function withNamedAccountToolGate(
  options: Options,
  admitted: () => Promise<boolean>,
): Options {
  const canUseTool = options.canUseTool;
  const gate: HookCallback = async (_input, _toolUseId, { signal }) =>
    (await Promise.race([admitted(), abortedAsDenied(signal)])) &&
    !signal.aborted
      ? {}
      : DENY_TOOL;
  return {
    ...options,
    canUseTool: async (tool, input, context) =>
      canUseTool && (await admitted())
        ? canUseTool(tool, input, context)
        : { behavior: 'deny', message: ADMISSION_PENDING },
    hooks: {
      ...options.hooks,
      PreToolUse: [
        { hooks: [gate], timeout: NAMED_ACCOUNT_TOOL_HOLD_SECONDS },
        ...(options.hooks?.PreToolUse ?? []),
      ],
    },
  };
}

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
