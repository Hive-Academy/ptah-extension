/**
 * `ElectronStateStorageWorkerHost` — the host's own refusal paths.
 *
 * The existing host suite drives real work through an in-process runtime, which
 * is the right shape for the happy path but can never produce a MALFORMED
 * worker: the runtime always answers correctly. These cases script the worker
 * instead, so the host has to deal with a reply it cannot parse, a reply for an
 * operation it never issued, and a `postMessage` that throws — each of which is
 * a live-session data-loss risk if it is mishandled, and none of which was
 * covered (TASK_2026_411).
 *
 * `extractLargeStrings` is exported and tested directly: it is the host's guard
 * against handing `structuredClone` something it cannot transfer, and every one
 * of its rejections was unreached.
 */

import { StateStorageRecoveryRequiredError } from '@ptah-extension/platform-core';
import {
  ElectronStateStorageWorkerHost,
  extractLargeStrings,
  type ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import {
  ElectronStateWorkerProtocolError,
  MAX_PROTOCOL_DEPTH,
} from './electron-state-storage-worker-protocol';

type Reply = (request: Record<string, unknown>) => unknown;

/** A worker whose every reply the test writes. */
class ScriptedWorker implements ElectronStateWorkerLike {
  private readonly messageListeners: Array<(value: unknown) => void> = [];
  terminated = false;

  constructor(
    private readonly reply: Reply,
    private readonly onPost?: () => void,
  ) {}

  postMessage(value: unknown): void {
    this.onPost?.();
    const request = value as Record<string, unknown>;
    queueMicrotask(() => {
      const response = this.reply(request);
      if (response === undefined) return;
      for (const listener of this.messageListeners) listener(response);
    });
  }

  on(event: 'message' | 'error' | 'exit', listener: (arg: never) => void): this {
    if (event === 'message') {
      this.messageListeners.push(listener as (value: unknown) => void);
    }
    return this;
  }

  unref(): void {
    /* nothing to unref on a fake */
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

/** The two replies every successful start needs, in order. */
function healthyStart(request: Record<string, unknown>): unknown {
  const operationId = request['operationId'] as number;
  if (request['type'] === 'initialize') {
    return { type: 'ready', operationId, generation: 1, mutationEpoch: 0 };
  }
  if (request['type'] === 'read-snapshot-page') {
    return {
      type: 'snapshot-page',
      operationId,
      operations: [],
      nextCursor: null,
      done: true,
      approximateBytes: 2,
    };
  }
  return { type: 'success', operationId };
}

function makeHost(
  reply: Reply,
  overrides: { maxRestartAttempts?: number; cacheExcludeKeyPrefixes?: string[] } = {},
  onPost?: () => void,
): ElectronStateStorageWorkerHost {
  return new ElectronStateStorageWorkerHost({
    workerPath: '/fake-worker.mjs',
    legacyFilePath: '/fake/workspace-state.json',
    v2RootPath: '/fake/workspace-state.v2',
    maxRestartAttempts: overrides.maxRestartAttempts ?? 0,
    cacheExcludeKeyPrefixes: overrides.cacheExcludeKeyPrefixes,
    workerFactory: () => new ScriptedWorker(reply, onPost),
  });
}

describe('extractLargeStrings', () => {
  it('lifts a string past the inline budget out of the payload', () => {
    const big = 'x'.repeat(40 * 1024);

    const result = extractLargeStrings({ note: big, small: 'ok' });

    expect(result.value).toEqual({ note: '', small: 'ok' });
    expect(result.strings).toEqual([
      { path: ['note'], value: big, totalBytes: Buffer.byteLength(big, 'utf8') },
    ]);
  });

  it('passes primitives, arrays and nested objects through unchanged', () => {
    const input = { a: [1, true, null, { b: 'c' }] };

    expect(extractLargeStrings(input).value).toEqual(input);
  });

  it('refuses a value nested past the protocol depth limit', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i <= MAX_PROTOCOL_DEPTH + 1; i++) deep = { next: deep };

    expect(() => extractLargeStrings(deep)).toThrow(
      ElectronStateWorkerProtocolError,
    );
  });

  it('refuses a non-finite number — JSON cannot carry it back', () => {
    expect(() => extractLargeStrings({ n: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite number/,
    );
    expect(() => extractLargeStrings({ n: Number.NaN })).toThrow(
      /non-finite number/,
    );
  });

  it('refuses a cyclic value instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(() => extractLargeStrings(cyclic)).toThrow(/cyclic value/);
  });

  it('refuses a class instance, which would not survive the round trip', () => {
    expect(() => extractLargeStrings({ when: new Date() })).toThrow(
      /non-plain object/,
    );
  });

  it('refuses a value with no JSON representation at all', () => {
    expect(() => extractLargeStrings({ fn: () => undefined })).toThrow(
      /non-cloneable/,
    );
  });
});

describe('ElectronStateStorageWorkerHost — malformed worker replies', () => {
  it('fails the operation when the worker answers something unparseable', async () => {
    const host = makeHost((request) =>
      request['type'] === 'initialize' ? { not: 'a response' } : healthyStart(request),
    );

    await expect(host.start()).rejects.toThrow();
  });

  it('fails the operation when the worker answers an id it never issued', async () => {
    const host = makeHost((request) => {
      if (request['type'] !== 'initialize') return healthyStart(request);
      // A reply correlated to nothing: the host must treat the channel as
      // broken rather than silently dropping the answer and hanging.
      return { type: 'ready', operationId: 9999, generation: 1, mutationEpoch: 0 };
    });

    await expect(host.start()).rejects.toThrow();
  });

  it('surfaces a postMessage that throws instead of leaving the caller pending', async () => {
    const host = makeHost(healthyStart, {}, () => {
      throw new Error('structured clone failed');
    });

    await expect(host.start()).rejects.toThrow('structured clone failed');
  });

  it('reports a plain worker failure code verbatim', async () => {
    const host = makeHost((request) =>
      request['type'] === 'initialize'
        ? { type: 'failure', operationId: request['operationId'], code: 'io-failed' }
        : healthyStart(request),
    );

    await expect(host.start()).rejects.toThrow(
      'State storage worker operation failed: io-failed',
    );
  });

  it('maps a recovery-required failure onto the typed error main.ts renders', async () => {
    const host = makeHost((request) =>
      request['type'] === 'initialize'
        ? {
            type: 'failure',
            operationId: request['operationId'],
            code: 'recovery-required',
            recoveryReason: 'blob-missing',
          }
        : healthyStart(request),
    );

    await expect(host.start()).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
  });

  it('refuses to send once disposed', async () => {
    const host = makeHost(healthyStart);
    await host.start();

    await host.dispose();

    await expect(host.get('anything')).rejects.toThrow('disposed');
  });
});

describe('ElectronStateStorageWorkerHost — cache bookkeeping', () => {
  it('a delete drops the key from the hydrated cache', async () => {
    const host = makeHost(healthyStart);
    await host.start();

    await host.update('keep', 'value');
    expect(host.getCache()).toEqual({ keep: 'value' });

    await host.update('keep', undefined);
    expect(host.getCache()).toEqual({});
  });

  it('an excluded prefix is written through but never cached', async () => {
    const host = makeHost(healthyStart, { cacheExcludeKeyPrefixes: ['bulk:'] });
    await host.start();

    await host.update('bulk:one', 'large');
    host.setCacheValue('bulk:two', 'large');

    // Worker-owned keys are read on demand; caching them is what the startup
    // hydration budget exists to avoid.
    expect(host.getCache()).toEqual({});
  });

  it('reads a value straight back from the worker', async () => {
    const host = makeHost((request) => {
      if (request['type'] === 'get') {
        return {
          type: 'value',
          operationId: request['operationId'],
          found: true,
          value: 'from-worker',
        };
      }
      return healthyStart(request);
    });
    await host.start();

    await expect(host.get('key')).resolves.toBe('from-worker');
  });

  it('reports a missing key as undefined rather than a failure', async () => {
    const host = makeHost((request) =>
      request['type'] === 'get'
        ? { type: 'value', operationId: request['operationId'], found: false }
        : healthyStart(request),
    );
    await host.start();

    await expect(host.get('absent')).resolves.toBeUndefined();
  });

  // The host's `splitArrayValue` is deliberately NOT scripted here. Its reply is
  // a `migration-receipt`, whose schema a hand-written fixture cannot satisfy
  // without restating the protocol in the test — and the path is already driven
  // end to end, against a real receipt, by
  // `electron-state-storage-worker-runtime.error-paths.spec.ts`.
});
