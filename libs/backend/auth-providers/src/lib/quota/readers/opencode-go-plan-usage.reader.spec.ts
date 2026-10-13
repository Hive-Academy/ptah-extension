import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOpenCodeGoPlanUsageReader } from './opencode-go-plan-usage.reader';
import { readOpenCodeGoStoreCredential } from '../opencode-go-credential';
import type { PlanOwnerTarget } from './plan-usage-reader.types';
import type { PlanSecret } from '../plan-credential.source';

const target = {
  providerId: 'opencode-go',
  ownerRef: { key: 'go', identityKind: 'cli-store' },
} as PlanOwnerTarget;
const request = { target, refresh: true };
const auth = async () =>
  JSON.stringify({ 'opencode-go': { type: 'api', key: 'secret' } });
const noAuth = async () => '{}';
const payload = {
  usage: {
    rolling: { percent: 20, resetsAt: '2030-01-01T00:00:00Z' },
    weekly: { percent: 40, resetsAt: '2030-01-02T00:00:00Z' },
    monthly: { percent: 60, resetsAt: '2030-01-03T00:00:00Z' },
  },
};

describe('OpenCode Go plan reader', () => {
  it('uses the stored key for credential owners without reading CLI auth', async () => {
    const fetcher = jest.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload)),
    );
    const readAuth = jest.fn(async () => {
      throw new Error('CLI auth must not be read');
    });
    const readStoreKey = jest.fn(async () => {
      throw new Error('CLI store must not be read');
    });
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      readAuth as never,
      { OPENCODE_API_KEY: 'wrong' },
      readStoreKey,
    )({
      ...request,
      target: {
        ...target,
        ownerRef: { ...target.ownerRef, identityKind: 'credential' },
      },
      credential: { reveal: () => 'stored' } as PlanSecret,
    });
    expect(result.status).toBe('available');
    expect(readAuth).not.toHaveBeenCalled();
    expect(readStoreKey).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer stored' },
    });
  });
  it('maps the three subscription windows', async () => {
    const fetcher = jest.fn(async () => new Response(JSON.stringify(payload)));
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      auth as never,
      {},
    )(request);
    expect(result.windows.map((window) => [window.kind, window.used])).toEqual([
      ['five_hour', { kind: 'percent', percent: 20 }],
      ['weekly', { kind: 'percent', percent: 40 }],
      ['monthly', { kind: 'percent', percent: 60 }],
    ]);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('prefers the v1 auth.json key over the v2 store', async () => {
    const fetcher = jest.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload)),
    );
    const readStoreKey = jest.fn(async () => {
      throw new Error('v2 store must not be read when v1 has the key');
    });
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      auth as never,
      {},
      readStoreKey,
    )(request);
    expect(result.status).toBe('available');
    expect(readStoreKey).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer secret' },
    });
  });
  it('falls back to the v2 store credential and sends it as the token', async () => {
    const fetcher = jest.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload)),
    );
    const readStoreKey = jest.fn(async () => 'store-access');
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      fetcher,
      noAuth as never,
      {},
      readStoreKey,
    )(request);
    expect(result.status).toBe('available');
    expect(readStoreKey).toHaveBeenCalledWith({});
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer store-access' },
    });
    expect(JSON.stringify(result)).not.toContain('store-access');
  });
  it('returns no plan when no credential or HTTP 403', async () => {
    const missing = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(),
      noAuth as never,
      {},
      async () => undefined,
    );
    expect((await missing(request)).status).toBe('no-usage-source');
    const forbidden = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('', { status: 403 })),
      auth as never,
      {},
    );
    expect((await forbidden(request)).status).toBe('no-usage-source');
  });
  it('maps a v2 store failure to service-unavailable', async () => {
    const result = await createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(),
      noAuth as never,
      {},
      async () => {
        throw new Error('corrupt store');
      },
    )(request);
    expect(result.status).toBe('service-unavailable');
  });
  it('reports an expired stored OAuth token as sign-in-again without a request', async () => {
    const fetcher = jest.fn(async () => {
      throw new Error('the endpoint must not be called for an expired token');
    });
    const result = await createOpenCodeGoPlanUsageReader(
      () => 2,
      fetcher,
      noAuth as never,
      {},
      async () => ({ key: 'expired-access', expiresAt: 1 }),
    )(request);
    expect(result.status).toBe('unsupported-auth');
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('expired-access');
  });
  it('sends a not-yet-expired stored OAuth token', async () => {
    const fetcher = jest.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(payload)),
    );
    const result = await createOpenCodeGoPlanUsageReader(
      () => 2,
      fetcher,
      noAuth as never,
      {},
      async () => ({ key: 'fresh-access', expiresAt: 3 }),
    )(request);
    expect(result.status).toBe('available');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer fresh-access' },
    });
  });
  it('maps HTTP 401 to a sign-in-again state', async () => {
    const rejected = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('', { status: 401 })),
      auth as never,
      {},
    );
    expect((await rejected(request)).status).toBe('unsupported-auth');
  });
  it('selects the active opencode credential from the v2 store database', async () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-go-reader-spec-'));
    const storeDir = join(dataHome, 'opencode');
    mkdirSync(storeDir, { recursive: true });
    const db = new DatabaseSync(join(storeDir, 'opencode.db'));
    try {
      db.exec(
        'CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, ' +
          'connector_id TEXT, method_id TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER)',
      );
      const insert = db.prepare(
        'INSERT INTO credential (id, integration_id, label, value, active, time_created) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insert.run(
        'older',
        'opencode',
        'old',
        JSON.stringify({ type: 'key', key: 'stale-key' }),
        0,
        1,
      );
      insert.run(
        'active',
        'opencode',
        'default',
        JSON.stringify({
          type: 'oauth',
          methodID: 'device',
          refresh: 'refresh-material',
          access: 'live-access',
          expires: 4102444800000,
          metadata: {
            server: 'https://opencode.example',
            accountID: 'acc',
            email: 'user@example.test',
          },
        }),
        1,
        2,
      );
      insert.run(
        'external',
        'opencode',
        'ext',
        JSON.stringify({ type: 'external', methodID: 'm' }),
        null,
        3,
      );
      insert.run(
        'other',
        'github',
        'default',
        JSON.stringify({ type: 'key', key: 'other-integration' }),
        1,
        4,
      );
    } finally {
      db.close();
    }
    try {
      const credential = await readOpenCodeGoStoreCredential({
        XDG_DATA_HOME: dataHome,
      });
      expect(credential).toEqual({
        key: 'live-access',
        expiresAt: 4102444800000,
      });
    } finally {
      rmSync(dataHome, { recursive: true, force: true });
    }
    expect(
      await readOpenCodeGoStoreCredential({ XDG_DATA_HOME: dataHome }),
    ).toBeUndefined();
  });
  it('rejects malformed responses and times out', async () => {
    const malformed = createOpenCodeGoPlanUsageReader(
      () => 1,
      jest.fn(async () => new Response('{}')),
      auth as never,
      {},
    );
    expect((await malformed(request)).status).toBe('service-unavailable');
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      );
      const pending = createOpenCodeGoPlanUsageReader(
        () => 1,
        fetcher as typeof fetch,
        auth as never,
        {},
      )(request);
      await jest.advanceTimersByTimeAsync(5_000);
      expect((await pending).status).toBe('service-unavailable');
    } finally {
      jest.useRealTimers();
    }
  });
});
