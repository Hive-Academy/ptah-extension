/**
 * Test doubles shared by dashboard usage and card specs. Spec-only: no
 * production file imports this module.
 */
import { RpcResult } from '@ptah-extension/core';
import type {
  UsageFact,
  UsageSummary,
} from '@ptah-extension/shared';

export const DAY_MS = 24 * 60 * 60 * 1000;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
  readonly signal: AbortSignal | undefined;
  readonly reply: Deferred<RpcResult<unknown>>;
}

/** An RPC client whose every call stays pending until the test answers it. */
export class FakeRpc {
  readonly calls: RecordedCall[] = [];

  call(
    method: string,
    params: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<RpcResult<unknown>> {
    const reply = deferred<RpcResult<unknown>>();
    this.calls.push({ method, params, signal: options?.signal, reply });
    return reply.promise;
  }

  of(
    method:
      | 'session:list'
      | 'session:stats-batch'
      | 'analytics:spendSummary',
  ): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }
}

/** Drain every pending microtask and one macrotask turn. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** One usage fact; defaults describe a priced Anthropic day. */
export function usageFact(over: Partial<UsageFact> = {}): UsageFact {
  return {
    day: '2026-10-18',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    inputUncachedTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 50,
    costUsd: 1,
    costSource: 'provider-reported',
    cacheSavingsUsd: null,
    sourceId: 'claude-ledger',
    ...over,
  };
}

/** A summary whose window covers `range` days ending 2026-10-20 (UTC). */
export function usageSummary(
  facts: readonly UsageFact[],
  over: {
    range?: number;
    sources?: UsageSummary['sources'];
  } = {},
): UsageSummary {
  const range = over.range ?? 3;
  const untilDayExclusive = '2026-10-21';
  const fromMs =
    Date.parse(`${untilDayExclusive}T00:00:00.000Z`) - range * DAY_MS;
  return {
    version: 1,
    generatedAt: '2026-10-20T12:00:00.000Z',
    timeZone: 'UTC',
    fromDay: new Date(fromMs).toISOString().slice(0, 10),
    untilDayExclusive,
    facts: [...facts],
    sources: over.sources ?? [],
    pricing: { source: 'bundled', asOf: null },
  };
}

/** Answer a pending `analytics:spendSummary` call with a success result. */
export function answerUsage(
  call: RecordedCall,
  summary: UsageSummary,
): void {
  call.reply.resolve(new RpcResult<UsageSummary>(true, summary));
}
