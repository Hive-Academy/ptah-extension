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
 */

import {
  StateStorageCursorStaleError,
  StateStorageRecoveryRequiredError,
  StateStorageValueTooLargeError,
} from '@ptah-extension/platform-core';
import {
  ElectronStateStorageWorkerHost,
  type ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';

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

  on(
    event: 'message' | 'error' | 'exit',
    listener: (arg: never) => void,
  ): this {
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
    return {
      type: 'ready',
      operationId,
      generation: 1,
      mutationEpoch: 0,
      migrationReceipts: [],
    };
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
  overrides: {
    maxRestartAttempts?: number;
    cacheExcludeKeyPrefixes?: string[];
    onWorkerCreated?: () => void;
  } = {},
  onPost?: () => void,
): ElectronStateStorageWorkerHost {
  return new ElectronStateStorageWorkerHost({
    workerPath: '/fake-worker.mjs',
    legacyFilePath: '/fake/workspace-state.json',
    v2RootPath: '/fake/workspace-state.v2',
    maxRestartAttempts: overrides.maxRestartAttempts ?? 0,
    cacheExcludeKeyPrefixes: overrides.cacheExcludeKeyPrefixes,
    workerFactory: () => {
      overrides.onWorkerCreated?.();
      return new ScriptedWorker(reply, onPost);
    },
  });
}

describe('ElectronStateStorageWorkerHost — malformed worker replies', () => {
  it('fails the operation when the worker answers something unparseable', async () => {
    const host = makeHost((request) =>
      request['type'] === 'initialize'
        ? { not: 'a response' }
        : healthyStart(request),
    );

    await expect(host.start()).rejects.toThrow();
  });

  it('fails the operation when the worker answers an id it never issued', async () => {
    const host = makeHost((request) => {
      if (request['type'] !== 'initialize') return healthyStart(request);
      // A reply correlated to nothing: the host must treat the channel as
      // broken rather than silently dropping the answer and hanging.
      return {
        type: 'ready',
        operationId: 9999,
        generation: 1,
        mutationEpoch: 0,
        migrationReceipts: [],
      };
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
        ? {
            type: 'failure',
            operationId: request['operationId'],
            code: 'io-failed',
          }
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

  it('reads an excluded value straight back from the worker', async () => {
    const host = makeHost(
      (request) => {
        if (request['type'] === 'get') {
          return {
            type: 'value',
            operationId: request['operationId'],
            found: true,
            value: 'from-worker',
          };
        }
        return healthyStart(request);
      },
      { cacheExcludeKeyPrefixes: ['bulk:'] },
    );
    await host.start();

    await expect(host.get('bulk:key')).resolves.toBe('from-worker');
  });

  it('answers an unprojected cached key from the cache without a worker round trip', async () => {
    const posted: string[] = [];
    const host = makeHost((request) => {
      posted.push(String(request['type']));
      return healthyStart(request);
    });
    await host.start();
    posted.length = 0;

    await expect(host.get('never-written')).resolves.toBeUndefined();
    expect(posted).toEqual([]);
  });

  it('sends a projected read of a cached key to the worker with its projection', async () => {
    const requests: Record<string, unknown>[] = [];
    const host = makeHost((request) => {
      requests.push(request);
      return request['type'] === 'get'
        ? { type: 'value', operationId: request['operationId'], found: false }
        : healthyStart(request);
    });
    await host.start();

    await host.get('index', { projection: { omit: [['items', '*', 'raw']] } });

    expect(requests.at(-1)).toMatchObject({
      type: 'get',
      key: 'index',
      projection: { omit: [['items', '*', 'raw']] },
    });
  });

  it('reports a missing key as undefined rather than a failure', async () => {
    const host = makeHost(
      (request) =>
        request['type'] === 'get'
          ? { type: 'value', operationId: request['operationId'], found: false }
          : healthyStart(request),
      { cacheExcludeKeyPrefixes: ['bulk:'] },
    );
    await host.start();

    await expect(host.get('bulk:absent')).resolves.toBeUndefined();
  });

  // The host's `splitArrayValue` is deliberately NOT scripted here. Its reply is
  // a `migration-receipt`, whose schema a hand-written fixture cannot satisfy
  // without restating the protocol in the test — and the path is already driven
  // end to end, against a real receipt, by
  // `electron-state-storage-worker-runtime.error-paths.spec.ts`.
});

describe('ElectronStateStorageWorkerHost — typed failures', () => {
  it('maps value-too-large onto StateStorageValueTooLargeError with the key and size only', async () => {
    const host = makeHost(
      (request) =>
        request['type'] === 'get'
          ? {
              type: 'failure',
              operationId: request['operationId'],
              code: 'value-too-large',
              valueBytes: 1_600_000,
            }
          : healthyStart(request),
      { cacheExcludeKeyPrefixes: ['detail:'] },
    );
    await host.start();

    const error = await host.get('detail:a').then(
      () => null,
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(StateStorageValueTooLargeError);
    expect(error).toMatchObject({ key: 'detail:a', bytes: 1_600_000 });
  });

  it('restarts a paged scalar read once on cursor-stale, then throws the typed error', async () => {
    let gets = 0;
    const host = makeHost(
      (request) => {
        const operationId = request['operationId'];
        if (request['type'] === 'get') {
          gets++;
          return {
            type: 'value-paged',
            operationId,
            operations: [{ kind: 'object', path: ['detail:a'] }],
            nextCursor: 'g1.pnone.1',
            done: false,
            approximateBytes: 1024,
          };
        }
        if (request['type'] === 'read-scalar-page') {
          return { type: 'failure', operationId, code: 'cursor-stale' };
        }
        return healthyStart(request);
      },
      { cacheExcludeKeyPrefixes: ['detail:'] },
    );
    await host.start();

    await expect(host.get('detail:a')).rejects.toBeInstanceOf(
      StateStorageCursorStaleError,
    );
    expect(gets).toBe(2);
  });

  it('re-sends the original projection on every scalar continuation', async () => {
    const continuations: Record<string, unknown>[] = [];
    const projection = { omit: [['children', '*', 'raw']] };
    const host = makeHost(
      (request) => {
        const operationId = request['operationId'];
        if (request['type'] === 'get') {
          return {
            type: 'value-paged',
            operationId,
            operations: [{ kind: 'object', path: ['detail:a'] }],
            nextCursor: 'g1.p0123456789abcdef.1',
            done: false,
            approximateBytes: 1024,
          };
        }
        if (request['type'] === 'read-scalar-page') {
          continuations.push(request);
          const last = continuations.length === 2;
          return {
            type: 'scalar-page',
            operationId,
            operations: [
              {
                kind: 'value',
                path: ['detail:a', `field${continuations.length}`],
                value: continuations.length,
              },
            ],
            nextCursor: last ? null : 'g1.p0123456789abcdef.2',
            done: last,
            approximateBytes: 1024,
          };
        }
        return healthyStart(request);
      },
      { cacheExcludeKeyPrefixes: ['detail:'] },
    );
    await host.start();

    await expect(host.get('detail:a', { projection })).resolves.toEqual({
      field1: 1,
      field2: 2,
    });
    expect(continuations).toHaveLength(2);
    for (const continuation of continuations) {
      expect(continuation['projection']).toEqual(projection);
    }
  });

  it('does not retry a typed failure but retries a crash exactly once', async () => {
    let created = 0;
    let updates = 0;
    const typedHost = makeHost(
      (request) => {
        if (request['type'] === 'update') {
          updates++;
          return {
            type: 'failure',
            operationId: request['operationId'],
            code: 'not-a-sequence',
          };
        }
        return healthyStart(request);
      },
      { maxRestartAttempts: 1, onWorkerCreated: () => created++ },
    );
    await typedHost.start();
    await expect(typedHost.update('k', 1)).rejects.toThrow('not-a-sequence');
    expect(updates).toBe(1);
    expect(created).toBe(1);

    let crashCreated = 0;
    const crashHost = new ElectronStateStorageWorkerHost({
      workerPath: '/fake-worker.mjs',
      legacyFilePath: '/fake/workspace-state.json',
      v2RootPath: '/fake/workspace-state.v2',
      maxRestartAttempts: 1,
      workerFactory: () => {
        crashCreated++;
        const errorListeners: Array<(error: Error) => void> = [];
        const messageListeners: Array<(value: unknown) => void> = [];
        const worker: ElectronStateWorkerLike = {
          postMessage(value: unknown) {
            const request = value as Record<string, unknown>;
            queueMicrotask(() => {
              if (request['type'] === 'update') {
                for (const listener of errorListeners) {
                  listener(new Error('crashed'));
                }
                return;
              }
              for (const listener of messageListeners) {
                listener(healthyStart(request));
              }
            });
          },
          on(event: string, listener: (arg: never) => void) {
            if (event === 'error') {
              errorListeners.push(listener as (error: Error) => void);
            }
            if (event === 'message') {
              messageListeners.push(listener as (value: unknown) => void);
            }
            return worker;
          },
          terminate: async () => 0,
        } as ElectronStateWorkerLike;
        return worker;
      },
    });
    await crashHost.start();
    await expect(crashHost.update('k', 1)).rejects.toThrow('crashed');
    expect(crashCreated).toBe(2);
  });

  it('treats an internal-error commit answer as a plain failure with no refresh and no sticky state', async () => {
    const requests: Record<string, unknown>[] = [];
    const host = makeHost((request) => {
      requests.push(request);
      const operationId = request['operationId'];
      if (request['type'] === 'update') {
        return { type: 'failure', operationId, code: 'internal-error' };
      }
      if (request['type'] === 'read-snapshot-page' && request['includeKeys']) {
        return { type: 'failure', operationId, code: 'io-failed' };
      }
      return healthyStart(request);
    });
    await host.start();
    requests.length = 0;

    await expect(host.update('k', 1)).rejects.toThrow('internal-error');
    expect(requests.map((request) => request['type'])).toEqual(['update']);
    expect(host.getRecoveryReason()).toBeNull();
  });

  it('fails closed with a sticky recovery state when the refresh after an uncertain commit fails', async () => {
    const host = makeHost((request) => {
      const operationId = request['operationId'];
      if (request['type'] === 'update') {
        return {
          type: 'failure',
          operationId,
          code: 'commit-failed',
          landed: true,
        };
      }
      if (request['type'] === 'read-snapshot-page' && request['includeKeys']) {
        return { type: 'failure', operationId, code: 'io-failed' };
      }
      return healthyStart(request);
    });
    await host.start();

    await expect(host.update('k', 1)).rejects.toThrow('commit-failed');
    expect(host.getRecoveryReason()).toBe('current-pointer-invalid');
    await expect(host.get('k')).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
  });

  it('refreshes touched cache keys from the worker before surfacing an uncertain commit', async () => {
    const host = makeHost((request) => {
      const operationId = request['operationId'];
      if (request['type'] === 'update') {
        return {
          type: 'failure',
          operationId,
          code: 'commit-failed',
          landed: true,
        };
      }
      if (request['type'] === 'read-snapshot-page' && request['includeKeys']) {
        return {
          type: 'snapshot-page',
          operationId,
          operations: [{ kind: 'value', path: ['k'], value: 'durable' }],
          nextCursor: null,
          done: true,
          approximateBytes: 1024,
        };
      }
      return healthyStart(request);
    });
    await host.start();

    await expect(host.update('k', 'attempted')).rejects.toThrow(
      'commit-failed',
    );
    expect(host.getCache()).toEqual({ k: 'durable' });
    expect(host.getRecoveryReason()).toBeNull();
  });

  it('marks a commit-uncertain answer as a sticky recovery state', async () => {
    const host = makeHost(
      (request) =>
        request['type'] === 'get'
          ? {
              type: 'failure',
              operationId: request['operationId'],
              code: 'commit-uncertain',
            }
          : healthyStart(request),
      { cacheExcludeKeyPrefixes: ['bulk:'] },
    );
    await host.start();

    await expect(host.get('bulk:a')).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
    expect(host.getRecoveryReason()).toBe('current-pointer-invalid');
  });
});
