import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { CodexAccountUsageClient } from './codex-account-usage-client';
import { CodexAppServerProcess } from './codex-app-server-process';
import type {
  CodexHomeAuthEvent,
  CodexHomeAuthReader,
} from './codex-home-auth-reader';
import type { CodexUsageEligibility } from './codex-account-usage.types';
import type { CodexExecutionProfile } from './codex-runtime.types';

const homeA = resolve('usage-home-a');
const homeB = resolve('usage-home-b');
const key = (home: string) =>
  process.platform === 'win32' ? resolve(home).toLowerCase() : resolve(home);

class UsageChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly frames: Record<string, unknown>[] = [];
  readonly whenSpawned = Promise.resolve(7);
  readonly pid = 7;
  exitCode: number | null = null;
  killed = false;
  readonly kill = jest.fn(() => {
    this.killed = true;
    this.finish();
    return true;
  });
  readonly stdin: Writable;
  requestId?: number;
  response: unknown = { rateLimits: {} };
  hold = false;
  fail = false;
  notification = false;

  constructor(
    readonly home: string,
    readonly echo = home,
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        const frame: Record<string, unknown> = JSON.parse(chunk.toString());
        this.frames.push(frame);
        done();
        queueMicrotask(() => {
          if (this.exitCode !== null) return;
          if (frame['method'] === 'initialize')
            this.send({
              id: frame['id'],
              result: {
                codexHome: this.echo,
                platformFamily: 'test',
                platformOs: process.platform,
                userAgent: 'test',
              },
            });
          if (
            frame['method'] === 'account/rateLimits/read' &&
            typeof frame['id'] === 'number'
          ) {
            this.requestId = frame['id'];
            if (this.notification)
              this.send({
                method: 'account/rateLimits/updated',
                params: { rateLimits: { primary: { usedPercent: 20 } } },
              });
            if (!this.hold) this.respond();
          }
        });
      },
    });
    this.stdin.on('finish', () => queueMicrotask(() => this.finish()));
  }

  send(value: unknown): void {
    this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  }
  respond(): void {
    this.send(
      this.fail
        ? {
            id: this.requestId,
            error: { code: -1, message: 'secret account credential' },
          }
        : { id: this.requestId, result: this.response },
    );
  }
  finish(): void {
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.emit('close', 0, null);
    }
  }
}

describe('CodexAccountUsageClient', () => {
  let now: number;
  let client: CodexAccountUsageClient;
  let auth: CodexHomeAuthReader;
  let children: UsageChild[];
  let configure: (child: UsageChild) => void;
  let wrongEcho: boolean;
  let eligibility: Map<string, CodexUsageEligibility>;
  let watchers: Map<string, (event: CodexHomeAuthEvent) => void>;
  let disposed: jest.Mock;

  beforeEach(() => {
    now = 1000;
    children = [];
    configure = () => undefined;
    wrongEcho = false;
    eligibility = new Map();
    watchers = new Map();
    disposed = jest.fn();
    auth = {
      isAuthenticated: jest.fn(async () => true),
      ensureTokensFresh: jest.fn(async () => true),
      getUsageEligibility: jest.fn(
        async (home: string) => eligibility.get(home) ?? 'supported',
      ),
      watch: jest.fn((home, listener) => {
        watchers.set(home, listener);
        return {
          dispose: () => {
            watchers.delete(home);
            disposed();
          },
        };
      }),
    };
    client = new CodexAccountUsageClient(
      auth,
      (home, handlers) => {
        const child = new UsageChild(home, wrongEcho ? key(homeB) : home);
        configure(child);
        children.push(child);
        const profile: CodexExecutionProfile = {
          normalizedHome: home,
          contextId: 'usage',
          consumer: 'usage',
          providerId: 'openai-codex',
          workspaceId: 'usage',
          cwd: process.cwd(),
          model: 'unused',
          permissionLevel: 'plan',
          approvalPolicy: 'never',
          sandboxPolicy: {
            mode: 'read-only',
            networkAccess: false,
            writableRoots: [],
          },
          experimentalApi: true,
          instructionSources: [],
          mcpServers: [],
          attachments: [],
          profileFingerprint: 'usage',
        };
        return new CodexAppServerProcess(
          { spawnProcess: jest.fn(() => child) },
          {
            resolvedPath: '/codex',
            expectedManifestRow: {
              platform: process.platform,
              arch: process.arch,
              pinnedVersion: '0.155.1',
              version: 'codex-cli 0.155.1',
              binarySha256: 'a'.repeat(64),
              schemaSha256: 'b'.repeat(64),
            },
          },
          {
            executablePath: '/codex',
            platform: process.platform,
            arch: process.arch,
            versionOutput: 'codex-cli 0.155.1',
            sha256: 'a'.repeat(64),
          },
          profile,
          handlers,
        );
      },
      () => now,
    );
  });

  afterEach(async () => {
    await client.close();
    for (const child of children) {
      expect(child.exitCode).toBe(0);
      expect(child.stdout.listenerCount('data')).toBe(0);
    }
    expect(watchers.size).toBe(0);
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  function invalidate(home: string): void {
    watchers.get(key(home))?.({
      home: key(home),
      generation: 2,
      kind: 'changed',
    });
  }

  it('reads two homes concurrently, preserves isolated caches and hashes scoped identities', async () => {
    configure = (child) => {
      child.response = {
        accountId: 'private-account',
        rateLimits: {
          planType: 'plus',
          primary: {
            usedPercent: child.home === key(homeA) ? 12 : 78,
            resetsAt: null,
          },
        },
      };
    };
    const [a, b] = await Promise.all([client.read(homeA), client.read(homeB)]);
    expect(a.quota?.primary).toEqual({ usedPercent: 12, resetsAt: null });
    expect(b.quota?.primary?.usedPercent).toBe(78);
    expect(await client.read(homeA)).toEqual(a);
    expect(await client.read(homeB)).toEqual(b);
    expect(children).toHaveLength(2);
    expect(client.currentOwnerKey(homeA)).toMatch(
      /^openai-codex#account:[a-f0-9]{64}$/,
    );
    expect(client.currentOwnerKey(homeA)).not.toBe(
      client.currentOwnerKey(homeB),
    );
    expect(JSON.stringify([a, b, client.currentOwnerKey(homeA)])).not.toContain(
      'private-account',
    );
  });

  it('coalesces lexical home aliases and uses only the supported usage request', async () => {
    await Promise.all([
      client.read(homeA),
      client.read(resolve(homeA, 'nested', '..')),
    ]);
    expect(children).toHaveLength(1);
    expect(children[0].frames.map((frame) => frame['method'])).toEqual([
      'initialize',
      'initialized',
      'account/rateLimits/read',
    ]);
  });

  it('leaves missing quota, plan, activity and owner fields absent', async () => {
    expect(await client.read(homeA)).toEqual({
      status: 'available',
      providerId: 'openai-codex',
      fetchedAt: 1000,
    });
    expect(client.currentOwnerKey(homeA)).toBeNull();
  });

  it('prefers the codex limit bucket and preserves zero and nullable reported values', async () => {
    configure = (child) => {
      child.response = {
        rateLimits: { primary: { usedPercent: 90 } },
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 0, windowDurationMins: null },
            secondary: { usedPercent: 40, resetsAt: 123 },
            rateLimitReachedType: 'weekly',
            planType: 'team',
          },
        },
      };
    };
    expect(await client.read(homeA)).toEqual({
      status: 'available',
      providerId: 'openai-codex',
      fetchedAt: 1000,
      account: { planType: 'team' },
      quota: {
        primary: { usedPercent: 0, windowDurationMins: null },
        secondary: { usedPercent: 40, resetsAt: 123 },
        rateLimitReachedType: 'weekly',
      },
    });
  });

  it('handles the observed rate-limit notification without inventing response fields', async () => {
    configure = (child) => {
      child.notification = true;
    };
    expect(await client.read(homeA)).toEqual({
      status: 'available',
      providerId: 'openai-codex',
      fetchedAt: now,
    });
  });

  it('does not return obsolete cached quota after a notification and failed refresh', async () => {
    configure = (child) => {
      child.response = { rateLimits: { primary: { usedPercent: 3 } } };
    };
    await client.read(homeA);
    configure = (child) => { child.notification = true; child.fail = true; };
    expect(await client.read(homeA, { refresh: true })).toEqual({
      status: 'service-unavailable', providerId: 'openai-codex',
    });
  });

  it.each(['unsupported-auth', 'unsupported-config'] as const)(
    'keeps %s eligibility home-scoped',
    async (status) => {
      eligibility.set(key(homeA), status);
      expect((await client.read(homeA)).status).toBe(status);
      expect((await client.read(homeB)).status).toBe('available');
      expect(children).toHaveLength(1);
      expect(children[0].home).toBe(key(homeB));
    },
  );

  it('rechecks eligibility before serving cached data and clears old identity', async () => {
    configure = (child) => {
      child.response = { rateLimits: {}, accountId: 'old' };
    };
    await client.read(homeA);
    eligibility.set(key(homeA), 'unsupported-auth');
    expect((await client.read(homeA)).status).toBe('unsupported-auth');
    expect(client.currentOwnerKey(homeA)).toBeNull();
  });

  it('refreshes explicitly or after TTL and does not let callers mutate cached quotas', async () => {
    configure = (child) => {
      child.response = { rateLimits: { primary: { usedPercent: 3 } } };
    };
    const result = await client.read(homeA);
    expect(Object.isFrozen(result.quota?.primary)).toBe(true);
    await client.read(homeA, { refresh: true });
    now += 30_001;
    await client.read(homeA);
    expect(children).toHaveLength(3);
  });

  it('sanitizes failures, backs off misses, and lets refresh retry', async () => {
    configure = (child) => {
      child.fail = true;
    };
    const failure = {
      status: 'service-unavailable',
      providerId: 'openai-codex',
    };
    expect(await client.read(homeA)).toEqual(failure);
    expect(await client.read(homeA)).toEqual(failure);
    expect(children).toHaveLength(1);
    await client.read(homeA, { refresh: true });
    expect(children).toHaveLength(2);
    now += 30_001;
    await client.read(homeA);
    expect(children).toHaveLength(3);
  });

  it('returns same-home stale data on failure but never after auth invalidation', async () => {
    const available = await client.read(homeA);
    configure = (child) => {
      child.fail = true;
    };
    expect(await client.read(homeA, { refresh: true })).toEqual({
      ...available,
      status: 'stale',
      staleSince: now,
    });
    expect((await client.read(homeB)).status).toBe('service-unavailable');
    invalidate(homeA);
    expect((await client.read(homeA)).status).toBe('service-unavailable');
  });

  it('drops old-generation responses and preserves a new flight and cache', async () => {
    configure = (child) => {
      child.hold = true;
    };
    const old = client.read(homeA);
    await flush();
    expect(children[0].requestId).toBeDefined();
    invalidate(homeA);
    configure = (child) => {
      child.response = {
        accountId: 'new',
        rateLimits: { primary: { usedPercent: 42 } },
      };
    };
    const fresh = client.read(homeA);
    children[0].response = {
      accountId: 'old',
      rateLimits: { primary: { usedPercent: 99 } },
    };
    children[0].respond();
    expect((await old).status).toBe('service-unavailable');
    expect((await fresh).quota?.primary?.usedPercent).toBe(42);
    expect((await client.read(homeA)).quota?.primary?.usedPercent).toBe(42);
    expect(children).toHaveLength(2);
  });

  it('drops eligibility resolutions from invalidated generations without spawning', async () => {
    let release: (value: CodexUsageEligibility) => void = () => undefined;
    auth.getUsageEligibility = jest.fn(
      () =>
        new Promise((resolveEligibility) => {
          release = resolveEligibility;
        }),
    );
    const pending = client.read(homeA);
    invalidate(homeA);
    release('supported');
    expect((await pending).status).toBe('service-unavailable');
    expect(children).toHaveLength(0);
  });

  it('cancels one waiter independently and closes the process when the last waiter aborts', async () => {
    configure = (child) => {
      child.hold = true;
    };
    const first = new AbortController();
    const second = new AbortController();
    const a = client.read(homeA, { signal: first.signal });
    const b = client.read(homeA, { signal: second.signal });
    await flush();
    first.abort();
    await expect(a).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Codex usage read aborted',
    });
    expect(children[0].stdin.writableEnded).toBe(false);
    const closed = new Promise<void>((resolveClosed) =>
      children[0].once('close', () => resolveClosed()),
    );
    second.abort();
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    await closed;
    expect(children[0].exitCode).toBe(0);
  });

  it('allows an uncancelled joiner to receive the shared response', async () => {
    configure = (child) => {
      child.hold = true;
    };
    const controller = new AbortController();
    const first = client.read(homeA, { signal: controller.signal });
    const second = client.read(homeA);
    await flush();
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    children[0].respond();
    expect((await second).status).toBe('available');
  });

  it('rejects pre-aborted callers without watching or spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.read(homeA, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(auth.watch).not.toHaveBeenCalled();
    expect(children).toHaveLength(0);
  });

  it('refuses a mismatched server home before requesting usage', async () => {
    wrongEcho = true;
    expect((await client.read(homeA)).status).toBe('service-unavailable');
    expect(children[0].frames).toHaveLength(1);
    expect(client.currentOwnerKey(homeA)).toBeNull();
  });

  it('sanitizes malformed provider results instead of returning their data', async () => {
    configure = (child) => {
      child.response = {
        rateLimits: { primary: { usedPercent: 'credential' } },
      };
    };
    expect(await client.read(homeA)).toEqual({
      status: 'service-unavailable',
      providerId: 'openai-codex',
    });
  });

  it('can close while eligibility is still unresolved', async () => {
    auth.getUsageEligibility = jest.fn(() => new Promise(() => undefined));
    const pending = client.read(homeA);
    await client.close();
    expect((await pending).status).toBe('service-unavailable');
    expect(children).toHaveLength(0);
  });

  it('releases home watchers and active children on close and refuses later reads', async () => {
    configure = (child) => {
      child.hold = true;
    };
    const pending = client.read(homeA);
    await flush();
    await client.close();
    expect((await pending).status).toBe('service-unavailable');
    expect(disposed).toHaveBeenCalledTimes(1);
    expect((await client.read(homeB)).status).toBe('service-unavailable');
    expect(children).toHaveLength(1);
  });
});
