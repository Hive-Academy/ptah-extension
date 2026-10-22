/**
 * PlanLimitsSnapshotService (TASK_2026_596, Component 12).
 *
 * The handler spec drives the RPC surface through this service; these cases
 * pin what only the service owns: the push repeats the last request's scope
 * without a refresh, the provider lookup picks the selected-provider owner,
 * and a failed read still lists its owner without quoting the error.
 */

// The cli-agent-runtime barrel (plan-limit discovery tokens) reaches the
// workspace-intelligence tree-sitter loader, whose `wasm-bundle-dir` reads
// `import.meta.url` (unparseable under CommonJS ts-jest). Nothing here parses.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanOwnerTarget } from '@ptah-extension/auth-providers';
import type {
  DiscoveredPlanOwner,
  SelectedProviderDiscovery,
} from '@ptah-extension/cli-agent-runtime';
import type {
  PlanLimitOwnerSnapshot,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { PlanLimitsSnapshotService } from './plan-limits-snapshot.service';

const CODEX: QuotaOwnerRef = {
  key: 'openai-codex#cli-store:a1',
  providerId: 'openai-codex',
  identityKind: 'cli-store',
  label: 'Codex account',
};
const OLLAMA: QuotaOwnerRef = {
  key: 'ollama-cloud#credential:b2',
  providerId: 'ollama-cloud',
  identityKind: 'credential',
  label: 'Ollama Cloud key',
};
const OPENCODE: QuotaOwnerRef = {
  key: 'opencode#cli-store:c3',
  providerId: 'opencode',
  identityKind: 'cli-store',
  label: 'OpenCode account',
};

function available(owner: QuotaOwnerRef): PlanLimitOwnerSnapshot {
  return {
    owner,
    status: 'available',
    windowSetEstablished: true,
    windows: [],
    ownerEvidence: [],
  };
}

function build() {
  const logger: MockLogger = createMockLogger();
  const discoverTargets = jest.fn<Promise<DiscoveredPlanOwner[]>, [unknown, number?]>(
    async () => [],
  );
  const discoverSelectedProvider = jest.fn(
    async (providerId: string): Promise<SelectedProviderDiscovery> => ({
      kind: 'owner',
      entry: (await discoverTargets({ selectedProviderId: providerId })).find(
        (entry) => entry.origin === 'selected-provider',
      ),
    }),
  );
  const getOwnerSnapshot = jest.fn<
    Promise<PlanLimitOwnerSnapshot>,
    [PlanOwnerTarget, unknown]
  >(async (target) => available(target.ownerRef));
  const service = new PlanLimitsSnapshotService(
    logger as unknown as Logger,
    { discoverTargets, discoverSelectedProvider },
    { getOwnerSnapshot },
    {
      snapshotFor: jest.fn(() => undefined),
      sessionOwners: jest.fn(() => ({})),
    },
  );
  return {
    service,
    discoverTargets,
    discoverSelectedProvider,
    getOwnerSnapshot,
    logger,
  };
}

describe('PlanLimitsSnapshotService', () => {
  it('passes an incomplete discovery marker to the client snapshot', async () => {
    const s = build();
    s.discoverTargets.mockResolvedValue(
      Object.assign([] as DiscoveredPlanOwner[], { discoveryIncomplete: true }),
    );
    await expect(s.service.snapshot({})).resolves.toMatchObject({
      discoveryIncomplete: true,
    });
  });

  it('pushes with the scope of the last request and never refreshes', async () => {
    const s = build();
    s.discoverTargets.mockResolvedValue([
      {
        kind: 'read',
        origin: 'selected-provider',
        target: { providerId: 'openai-codex', ownerRef: CODEX },
      },
    ]);

    await s.service.snapshot({
      providerId: 'openai-codex',
      sessionIds: ['s-1'],
      ownerKeys: [OLLAMA.key],
      refresh: true,
    });
    await s.service.currentSnapshot();

    expect(s.discoverTargets).toHaveBeenNthCalledWith(2, {
      selectedProviderId: 'openai-codex',
      sessionIds: ['s-1'],
      ownerKeys: [OLLAMA.key],
    }, expect.any(Number));
    expect(s.getOwnerSnapshot.mock.calls.map(([, options]) => options)).toEqual(
      [
        expect.objectContaining({ refresh: true }),
        expect.objectContaining({ refresh: false }),
      ],
    );
  });

  it('pushes with an empty scope before any request', async () => {
    const s = build();
    await s.service.currentSnapshot();
    expect(s.discoverTargets).toHaveBeenCalledWith({}, expect.any(Number));
  });

  it('returns a partial snapshot within 24 seconds after slow discovery and a hung Codex read', async () => {
    jest.useFakeTimers();
    try {
      const s = build();
      s.discoverTargets.mockImplementation(() => new Promise((resolve) =>
        setTimeout(() => resolve([
          { kind: 'known', origin: 'selected-provider', snapshot: available(OLLAMA) },
          { kind: 'read', origin: 'lane', target: { providerId: 'openai-codex', ownerRef: CODEX } },
        ]), 11_000),
      ));
      s.getOwnerSnapshot.mockImplementation(() => new Promise(() => undefined));
      const pending = s.service.snapshot({});
      await jest.advanceTimersByTimeAsync(24_000);
      await expect(pending).resolves.toMatchObject({ owners: [
        { owner: OLLAMA, status: 'available' },
        { owner: CODEX, status: 'service-unavailable' },
      ] });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reserves time for a live owner read after discovery uses its 12 second deadline', async () => {
    jest.useFakeTimers();
    try {
      const s = build();
      const startedAt = Date.now();
      s.discoverTargets.mockImplementation(() => new Promise((resolve) =>
        setTimeout(() => resolve([
          { kind: 'read', origin: 'cli-store', target: { providerId: 'opencode', ownerRef: OPENCODE } },
        ]), 12_000),
      ));
      s.getOwnerSnapshot.mockResolvedValue({ ...available(OPENCODE), status: 'unsupported-config' });

      const pending = s.service.snapshot({});
      expect(s.discoverTargets).toHaveBeenCalledWith({}, startedAt + 12_000);
      await jest.advanceTimersByTimeAsync(12_000);
      await expect(pending).resolves.toMatchObject({ owners: [
        { owner: OPENCODE, status: 'unsupported-config' },
      ] });
      expect(s.getOwnerSnapshot).toHaveBeenCalledWith(
        { providerId: 'opencode', ownerRef: OPENCODE },
        expect.objectContaining({ refresh: false, signal: expect.any(AbortSignal) }),
      );
      expect(Date.now() - startedAt).toBeLessThan(24_000);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a provider lookup reads only the selected-provider owner and keeps the push scope', async () => {
    const s = build();
    await s.service.snapshot({ providerId: 'claude-cli' });
    s.discoverTargets.mockResolvedValue([
      {
        kind: 'read',
        origin: 'lane',
        target: { providerId: 'openai-codex', ownerRef: CODEX },
      },
      {
        kind: 'read',
        origin: 'selected-provider',
        target: { providerId: 'ollama-cloud', ownerRef: OLLAMA },
      },
    ]);

    const result = await s.service.ownerSnapshotForProvider(
      'ollama-cloud',
      false,
    );

    expect(result).toMatchObject({
      kind: 'snapshot',
      snapshot: { owner: OLLAMA },
    });
    expect(s.getOwnerSnapshot).toHaveBeenCalledTimes(1);
    await s.service.currentSnapshot();
    expect(s.discoverTargets).toHaveBeenLastCalledWith({
      selectedProviderId: 'claude-cli',
    }, expect.any(Number));
  });

  describe('read deadline', () => {
    /** A read that answers after 5 s unless its signal aborts first. */
    function slowRead(s: ReturnType<typeof build>): void {
      s.getOwnerSnapshot.mockImplementation(
        (target, options) =>
          new Promise((resolve, reject) => {
            const signal = (options as { signal?: AbortSignal } | undefined)
              ?.signal;
            const timer = setTimeout(
              () => resolve(available(target.ownerRef)),
              5_000,
            );
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      );
      s.discoverTargets.mockResolvedValue([
        {
          kind: 'read',
          origin: 'selected-provider',
          target: { providerId: 'openai-codex', ownerRef: CODEX },
        },
      ]);
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('a provider lookup is not cut at 3 s: the reader keeps its own limit', async () => {
      const s = build();
      slowRead(s);

      const pending = s.service.ownerSnapshotForProvider('openai-codex', true);
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toEqual({
        kind: 'snapshot',
        snapshot: available(CODEX),
      });
      expect(s.getOwnerSnapshot).toHaveBeenCalledWith(
        { providerId: 'openai-codex', ownerRef: CODEX },
        { refresh: true },
      );
    });

    it('a plan-limits snapshot gives Codex a 12-second deadline', async () => {
      const s = build();
      slowRead(s);

      let settled: unknown;
      const pending = s.service
        .snapshot({ providerId: 'openai-codex' })
        .then((value) => (settled = value));
      await jest.advanceTimersByTimeAsync(3_000);
      expect(settled).toBeUndefined();
      await jest.advanceTimersByTimeAsync(2_000);
      const result = await pending;

      expect(result.owners).toEqual([available(CODEX)]);
    });

    it('the push also gives Codex the longer deadline', async () => {
      const s = build();
      slowRead(s);

      const pending = s.service.currentSnapshot();
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toMatchObject({
        owners: [{ owner: CODEX, status: 'available' }],
      });
    });

    it('still cuts a non-Codex owner read at 3 seconds', async () => {
      const s = build();
      slowRead(s);
      s.discoverTargets.mockResolvedValue([
        {
          kind: 'read',
          origin: 'selected-provider',
          target: { providerId: 'ollama-cloud', ownerRef: OLLAMA },
        },
      ]);
      const pending = s.service.snapshot({ providerId: 'ollama-cloud' });
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toMatchObject({
        owners: [{ owner: OLLAMA, status: 'service-unavailable' }],
      });
    });
  });

  it('a provider lookup with no selected-provider owner reports no-owner', async () => {
    const s = build();
    await expect(
      s.service.ownerSnapshotForProvider('z-ai', false),
    ).resolves.toEqual({ kind: 'no-owner' });
  });

  it('preserves an unavailable selected-provider discovery', async () => {
    const s = build();
    s.discoverSelectedProvider.mockResolvedValue({ kind: 'unavailable' });

    await expect(
      s.service.ownerSnapshotForProvider('openai-codex', false),
    ).resolves.toEqual({ kind: 'unavailable' });
  });

  it('a failed read still lists the owner and logs only the error name', async () => {
    const s = build();
    s.discoverTargets.mockResolvedValue([
      {
        kind: 'read',
        origin: 'lane',
        target: { providerId: 'ollama-cloud', ownerRef: OLLAMA },
      },
    ]);
    s.getOwnerSnapshot.mockRejectedValue(new RangeError('body: secret-ish'));

    const result = await s.service.snapshot({});

    expect(result.owners).toEqual([
      {
        owner: OLLAMA,
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
        ownerEvidence: [],
      },
    ]);
    expect(s.logger.debug).toHaveBeenCalledWith(
      '[PlanLimitsSnapshot] owner read ended without a snapshot',
      { providerId: 'ollama-cloud', reason: 'RangeError' },
    );
    expect(JSON.stringify(s.logger.debug.mock.calls)).not.toContain(
      'secret-ish',
    );
  });
});
