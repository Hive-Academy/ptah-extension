/**
 * PlanLimitOwnerDiscoveryService (TASK_2026_596, Component 10b).
 *
 * F69 every in-scope provider reachable; F70 the selected provider is the
 * first owner; F72 account change; F81 `claude-cli` through a probe handle;
 * F82 a direct Anthropic key is `unsupported-auth` with no read; F83 the Codex
 * account home with no credential reference. A missing Ollama key is still
 * listed and reads `unsupported-config`, a placeholder `unsupported-auth`,
 * with no network. A throwing source drops only that source.
 */
import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  PlanUsageService,
  type ActiveAuth,
  type PlanCredentialResolution,
} from '@ptah-extension/auth-providers';
import {
  LIMIT_LOOKUP_DEADLINE_MS,
  type CliDetectionResult,
  type PtahCliSummary,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import {
  PlanLimitOwnerDiscoveryService,
  type DiscoveredPlanOwner,
  type DiscoveryLedger,
  type DiscoveryOwnerSource,
} from './plan-limit-owner-discovery.service';

const ref = (
  providerId: string,
  identityKind: QuotaOwnerRef['identityKind'],
  hex: string,
): QuotaOwnerRef => ({
  providerId,
  identityKind,
  key: `${providerId}#${identityKind}:${hex.padEnd(16, '0')}`,
  label: `${providerId} ${identityKind}`,
});

const CLAUDE_A = ref('anthropic', 'account', 'aa');
const CLAUDE_KEY = ref('anthropic', 'credential', 'ab');
const CLAUDE_UNKNOWN = ref('anthropic', 'unknown', 'ac');
const CODEX_A = ref('openai-codex', 'account', 'ca');
const CODEX_B = ref('openai-codex', 'account', 'cb');
const OPENCODE = ref('opencode', 'cli-store', 'dc');
const ANTIGRAVITY = ref('antigravity', 'cli-store', 'ea');
const OLLAMA_KEY = ref('ollama-cloud', 'credential', 'fa');
const GLM_LANE = ref('ollama-cloud', 'credential', 'fb');
const GLM_NO_KEY = ref('ollama-cloud', 'unknown', 'fc');

const detected = (...clis: CliDetectionResult['cli'][]): CliDetectionResult[] =>
  clis.map((cli) => ({ cli, installed: true, messagingMode: 'queue' }));

const glmAgent = (id: string, enabled = true): PtahCliSummary =>
  ({
    id,
    name: `Glm ${id}`,
    providerId: 'ollama-cloud',
    enabled,
    hasApiKey: true,
  }) as unknown as PtahCliSummary;

interface Harness {
  service: PlanLimitOwnerDiscoveryService;
  logger: ReturnType<typeof createMockLogger>;
  owners: jest.Mocked<DiscoveryOwnerSource>;
  ledger: jest.Mocked<DiscoveryLedger>;
  activeAuth: { resolveActiveAuth: jest.Mock<ActiveAuth, []> };
  detection: { detectAll: jest.Mock };
  agents: { listAgents: jest.Mock };
  routes: Map<string, 'native' | 'proxy'>;
}

function createHarness(active: ActiveAuth): Harness {
  const logger = createMockLogger();
  const owners = {
    ownerForProviderKey: jest.fn(async (id: string) =>
      id === 'anthropic' ? CLAUDE_KEY : OLLAMA_KEY,
    ),
    ownerForPtahCli: jest.fn(async () => GLM_LANE),
    ownerForClaudeAccount: jest.fn(() => CLAUDE_UNKNOWN),
    ownerForCodexHome: jest.fn(() => CODEX_A),
    ownerForCliStore: jest.fn(() => OPENCODE),
    ownerForAntigravity: jest.fn(() => ANTIGRAVITY),
    ownerForSession: jest.fn(async () => CLAUDE_A),
  } as unknown as jest.Mocked<DiscoveryOwnerSource>;
  const ledger = {
    snapshotFor: jest.fn(() => undefined),
    knownOwners: jest.fn(() => []),
    sessionOwners: jest.fn(() => ({})),
  } as unknown as jest.Mocked<DiscoveryLedger>;
  const routes = new Map<string, 'native' | 'proxy'>();
  const activeAuth = { resolveActiveAuth: jest.fn(() => active) };
  const detection = { detectAll: jest.fn(async () => detected()) };
  const agents = { listAgents: jest.fn(async () => [] as PtahCliSummary[]) };
  const service = new PlanLimitOwnerDiscoveryService(
    logger as unknown as Logger,
    owners,
    ledger,
    {
      sessionRoute: (id: string) => {
        const kind = routes.get(id);
        return kind ? { providerId: 'anthropic', routeKind: kind } : null;
      },
    },
    activeAuth,
    detection,
    agents,
  );
  return {
    service,
    logger,
    owners,
    ledger,
    activeAuth,
    detection,
    agents,
    routes,
  };
}

const ownerKeyOf = (entry: DiscoveredPlanOwner): string =>
  entry.kind === 'read' ? entry.target.ownerRef.key : entry.snapshot.owner.key;
const providerOf = (entry: DiscoveredPlanOwner): string =>
  entry.kind === 'read'
    ? entry.target.ownerRef.providerId
    : entry.snapshot.owner.providerId;

const CLAUDE_CLI: ActiveAuth = {
  authMethod: 'claudeCli',
  providerId: 'anthropic',
};
const THIRD_PARTY = (providerId: string): ActiveAuth => ({
  authMethod: 'thirdParty',
  providerId,
});

describe('PlanLimitOwnerDiscoveryService', () => {
  it('F69: one owner each for Claude, Codex, Antigravity, OpenCode and Ollama Cloud', async () => {
    const h = createHarness(CLAUDE_CLI);
    h.routes.set('sess-1', 'native');
    h.detection.detectAll.mockResolvedValue(
      detected('codex', 'antigravity', 'opencode', 'copilot'),
    );
    h.agents.listAgents.mockResolvedValue([glmAgent('pc-glm')]);

    const entries = await h.service.discoverTargets({ sessionIds: ['sess-1'] });

    expect(entries.map(providerOf).sort()).toEqual([
      'anthropic',
      'antigravity',
      'ollama-cloud',
      'openai-codex',
      'opencode',
    ]);
    expect(new Set(entries.map(ownerKeyOf)).size).toBe(entries.length);
    expect(entries.every((entry) => entry.kind === 'read')).toBe(true);
    expect(entries[0]).toEqual(
      expect.objectContaining({ origin: 'selected-provider' }),
    );
    expect(h.owners.ownerForAntigravity).toHaveBeenCalledTimes(1);
    expect(h.owners.ownerForCliStore).toHaveBeenCalledWith('opencode');
    expect(h.owners.ownerForCliStore).not.toHaveBeenCalledWith('antigravity');
  });

  it('F81: selected claude-cli is a Claude subscription read through the probe handle, with no credential', async () => {
    const h = createHarness(CLAUDE_CLI);
    h.routes.set('sess-proxy', 'proxy');
    h.routes.set('sess-native', 'native');

    const [first] = await h.service.discoverTargets({
      selectedProviderId: 'claude-cli',
      sessionIds: ['sess-proxy', 'sess-native'],
    });

    expect(first).toEqual({
      kind: 'read',
      origin: 'selected-provider',
      target: {
        providerId: 'anthropic',
        ownerRef: CLAUDE_A,
        sessionHandle: { kind: 'session', sessionId: 'sess-native' },
      },
    });
    expect(h.owners.ownerForSession).toHaveBeenCalledWith('sess-native');
  });

  it('F81: with no open native session the Claude target reads "no open session" and is not read', async () => {
    const h = createHarness(CLAUDE_CLI);

    const [first] = await h.service.discoverTargets({});

    expect(first.kind).toBe('known');
    expect(first.kind === 'known' && first.snapshot).toEqual(
      expect.objectContaining({
        owner: CLAUDE_UNKNOWN,
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
        windows: [],
      }),
    );
  });

  it('F81: a native session the ledger already tracks serves as the probe handle', async () => {
    const h = createHarness(CLAUDE_CLI);
    h.routes.set('sess-tracked', 'native');
    h.ledger.sessionOwners.mockReturnValue({
      'sess-tracked': { ownerKey: CLAUDE_A.key, modelScope: 'sonnet' },
    });

    const [first] = await h.service.discoverTargets({});

    expect(first.kind === 'read' && first.target.sessionHandle).toEqual({
      kind: 'session',
      sessionId: 'sess-tracked',
    });
  });

  it('F82: a direct Anthropic API key is unsupported-auth and is never read', async () => {
    const h = createHarness({ authMethod: 'apiKey', providerId: 'anthropic' });

    const [first] = await h.service.discoverTargets({
      selectedProviderId: 'anthropic',
    });

    expect(h.owners.ownerForProviderKey).toHaveBeenCalledWith('anthropic');
    expect(first).toEqual({
      kind: 'known',
      origin: 'selected-provider',
      snapshot: {
        owner: CLAUDE_KEY,
        status: 'unsupported-auth',
        windowSetEstablished: false,
        windows: [],
        ownerEvidence: [],
      },
    });
  });

  it('F82: selecting anthropic while another provider is active resolves the apiKey route', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));

    const [first] = await h.service.discoverTargets({
      selectedProviderId: 'anthropic',
    });

    expect(first.kind === 'known' && first.snapshot.status).toBe(
      'unsupported-auth',
    );
  });

  it('F83: selected openai-codex is the Codex account home with no credential reference', async () => {
    const h = createHarness(CLAUDE_CLI);

    const [first] = await h.service.discoverTargets({
      selectedProviderId: 'openai-codex',
    });

    expect(first).toEqual({
      kind: 'read',
      origin: 'selected-provider',
      target: { providerId: 'openai-codex', ownerRef: CODEX_A },
    });
  });

  it('F70: changing the selected provider changes the first owner', async () => {
    const h = createHarness(CLAUDE_CLI);
    h.detection.detectAll.mockResolvedValue(detected('codex', 'opencode'));

    const codexFirst = await h.service.discoverTargets({
      selectedProviderId: 'openai-codex',
    });
    const ollamaFirst = await h.service.discoverTargets({
      selectedProviderId: 'ollama-cloud',
    });

    expect(ownerKeyOf(codexFirst[0])).toBe(CODEX_A.key);
    expect(ownerKeyOf(ollamaFirst[0])).toBe(OLLAMA_KEY.key);
    expect(ollamaFirst[0]).toEqual({
      kind: 'read',
      origin: 'selected-provider',
      target: {
        providerId: 'ollama-cloud',
        ownerRef: OLLAMA_KEY,
        credentialRef: { kind: 'provider-key', providerId: 'ollama-cloud' },
      },
    });
  });

  it('lists a provider outside the plan-limit scope as provider-unsupported, never read', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));

    const [first] = await h.service.discoverTargets({});

    expect(first.kind).toBe('known');
    expect(first.kind === 'known' && first.snapshot).toEqual(
      expect.objectContaining({
        status: 'provider-unsupported',
        windows: [],
      }),
    );
    expect(first.kind === 'known' && first.snapshot.owner.providerId).toBe(
      'openrouter',
    );
  });

  it('F72: after an account change the new owner is listed and read; the old one only from the ledger', async () => {
    const h = createHarness(THIRD_PARTY('openai-codex'));
    h.owners.ownerForCodexHome
      .mockReturnValueOnce(CODEX_A)
      .mockReturnValue(CODEX_B);

    const before = await h.service.discoverTargets({});
    const after = await h.service.discoverTargets({ ownerKeys: [CODEX_A.key] });

    expect(ownerKeyOf(before[0])).toBe(CODEX_A.key);
    expect(after[0]).toEqual({
      kind: 'read',
      origin: 'selected-provider',
      target: { providerId: 'openai-codex', ownerRef: CODEX_B },
    });
    const old = after.find((entry) => ownerKeyOf(entry) === CODEX_A.key);
    expect(old).toEqual(
      expect.objectContaining({ kind: 'known', origin: 'owner-key' }),
    );
    expect(old?.kind === 'known' && old.snapshot.status).toBe(
      'service-unavailable',
    );
  });

  it('builds ledger-only snapshots from evidence, never for keys a live source listed, and drops malformed keys', async () => {
    const h = createHarness(THIRD_PARTY('openai-codex'));
    const cooldown = { until: 9_999_999_999_999, observedAt: 1 };
    h.ledger.snapshotFor.mockImplementation((key: string) =>
      key === CLAUDE_A.key
        ? {
            owner: CLAUDE_A,
            windows: [],
            ownerEvidence: [{ observedAt: 1, source: 'stream-event' }],
            cooldown,
          }
        : undefined,
    );

    const entries = await h.service.discoverTargets({
      ownerKeys: [
        CODEX_A.key,
        CLAUDE_A.key,
        'not-a-key',
        'anthropic#account:me@example.test',
      ],
    });

    expect(entries.map(ownerKeyOf)).toEqual([CODEX_A.key, CLAUDE_A.key]);
    expect(entries[0].kind).toBe('read');
    expect(entries[1]).toEqual({
      kind: 'known',
      origin: 'owner-key',
      snapshot: {
        owner: expect.objectContaining({ key: CLAUDE_A.key }),
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
        ownerEvidence: [{ observedAt: 1, source: 'stream-event' }],
        cooldown,
        // A Claude account without its session: the status planOwnerRead knows.
        unavailableReason: 'no-open-session',
      },
    });
  });

  it('a ledger-only owner needing a live read is plain service-unavailable', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));

    const entries = await h.service.discoverTargets({
      ownerKeys: [OPENCODE.key],
    });

    const entry = entries.find((e) => ownerKeyOf(e) === OPENCODE.key);
    expect(entry?.kind).toBe('known');
    if (entry?.kind !== 'known') return;
    expect(entry.origin).toBe('owner-key');
    expect(entry.snapshot.status).toBe('service-unavailable');
    expect(entry.snapshot).not.toHaveProperty('unavailableReason');
  });

  it('a ledger-only Anthropic API-key owner keeps unsupported-auth, with no windows', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));
    h.ledger.snapshotFor.mockImplementation((key: string) =>
      key === CLAUDE_KEY.key
        ? {
            owner: CLAUDE_KEY,
            windows: [
              {
                key: 'five_hour',
                kind: 'five_hour',
                label: '5-hour',
                observedAt: 1,
              },
            ],
            ownerEvidence: [],
          }
        : undefined,
    );
    h.ledger.knownOwners.mockReturnValue([CLAUDE_KEY]);

    const fromKeys = await h.service.discoverTargets({
      ownerKeys: [CLAUDE_KEY.key],
    });
    const fromEvidence = await h.service.discoverTargets({});

    for (const [entries, origin] of [
      [fromKeys, 'owner-key'],
      [fromEvidence, 'active-evidence'],
    ] as const) {
      const entry = entries.find((e) => ownerKeyOf(e) === CLAUDE_KEY.key);
      expect(entry).toEqual({
        kind: 'known',
        origin,
        snapshot: expect.objectContaining({
          status: 'unsupported-auth',
          windows: [],
        }),
      });
    }
  });

  it('reports selected-provider timeout as unavailable and releases its timer', async () => {
    jest.useFakeTimers();
    try {
      const h = createHarness(THIRD_PARTY('ollama-cloud'));
      h.owners.ownerForProviderKey.mockImplementation(
        () => new Promise<QuotaOwnerRef>(() => undefined),
      );
      const pending = h.service.discoverSelectedProvider('ollama-cloud');
      await jest.advanceTimersByTimeAsync(LIMIT_LOOKUP_DEADLINE_MS);
      await expect(pending).resolves.toEqual({ kind: 'unavailable' });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports selected-provider throw as unavailable', async () => {
    const h = createHarness(THIRD_PARTY('ollama-cloud'));
    h.owners.ownerForProviderKey.mockRejectedValue(
      new Error('store unavailable'),
    );

    await expect(
      h.service.discoverSelectedProvider('ollama-cloud'),
    ).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('reports an unsupported selected route as an owner outcome, never as unavailable', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));

    await expect(h.service.discoverSelectedProvider('z-ai')).resolves.toEqual({
      kind: 'owner',
      entry: expect.objectContaining({
        origin: 'selected-provider',
        snapshot: expect.objectContaining({ status: 'provider-unsupported' }),
      }),
    });
  });

  it('a source that never settles is dropped alone at the lookup deadline, timers released', async () => {
    jest.useFakeTimers();
    try {
      const h = createHarness(THIRD_PARTY('openai-codex'));
      h.detection.detectAll.mockResolvedValue(detected('opencode'));
      h.agents.listAgents.mockImplementation(
        () => new Promise<PtahCliSummary[]>(() => undefined),
      );

      let settled = false;
      const pending = h.service
        .discoverTargets({ ownerKeys: [CLAUDE_KEY.key] })
        .then((entries) => {
          settled = true;
          return entries;
        });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      jest.advanceTimersByTime(LIMIT_LOOKUP_DEADLINE_MS - 1);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      const entries = await pending;

      expect(entries.map(ownerKeyOf)).toEqual([
        CODEX_A.key,
        OPENCODE.key,
        CLAUDE_KEY.key,
      ]);
      const timedOut = h.logger.debug.mock.calls.filter(
        ([message]) => message === '[PlanLimitOwnerDiscovery] source timed out',
      );
      expect(timedOut).toEqual([
        ['[PlanLimitOwnerDiscovery] source timed out', { source: 'ptah-cli' }],
      ]);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists owners with active evidence, skipping unknown owners and providers outside the scope', async () => {
    const h = createHarness(THIRD_PARTY('openai-codex'));
    h.ledger.knownOwners.mockReturnValue([
      CODEX_A,
      CLAUDE_A,
      CLAUDE_UNKNOWN,
      ref('openrouter', 'credential', '0f'),
    ]);

    const entries = await h.service.discoverTargets({});

    expect(entries.map((entry) => [ownerKeyOf(entry), entry.origin])).toEqual([
      [CODEX_A.key, 'selected-provider'],
      [CLAUDE_A.key, 'active-evidence'],
    ]);
  });

  it('lists every requested session owner under its own probe handle', async () => {
    const h = createHarness(THIRD_PARTY('openai-codex'));
    h.owners.ownerForSession
      .mockResolvedValueOnce(CLAUDE_A)
      .mockResolvedValueOnce(OLLAMA_KEY);

    const entries = await h.service.discoverTargets({
      sessionIds: ['sess-a', 'sess-b'],
    });

    expect(entries.slice(1)).toEqual([
      {
        kind: 'read',
        origin: 'session',
        target: {
          providerId: 'anthropic',
          ownerRef: CLAUDE_A,
          sessionHandle: { kind: 'session', sessionId: 'sess-a' },
        },
      },
      {
        kind: 'read',
        origin: 'session',
        target: {
          providerId: 'ollama-cloud',
          ownerRef: OLLAMA_KEY,
          credentialRef: { kind: 'provider-key', providerId: 'ollama-cloud' },
        },
      },
    ]);
  });

  it('lists enabled Ptah CLI Ollama Cloud agents under their own key, skipping disabled ones', async () => {
    const h = createHarness(THIRD_PARTY('openrouter'));
    h.agents.listAgents.mockResolvedValue([
      glmAgent('pc-glm'),
      glmAgent('pc-off', false),
    ]);

    const entries = await h.service.discoverTargets({});

    expect(h.owners.ownerForPtahCli).toHaveBeenCalledTimes(1);
    expect(h.owners.ownerForPtahCli).toHaveBeenCalledWith(
      'pc-glm',
      'ollama-cloud',
    );
    expect(entries[1]).toEqual({
      kind: 'read',
      origin: 'lane',
      target: {
        providerId: 'ollama-cloud',
        ownerRef: GLM_LANE,
        credentialRef: { kind: 'ptah-cli-key', ptahCliId: 'pc-glm' },
      },
    });
  });

  it('a throwing source drops only that source', async () => {
    const h = createHarness(THIRD_PARTY('openai-codex'));
    h.detection.detectAll.mockRejectedValue(new Error('PATH secret /home/x'));
    h.agents.listAgents.mockResolvedValue([glmAgent('pc-glm')]);
    h.owners.ownerForSession.mockRejectedValue(new Error('probe down'));

    const entries = await h.service.discoverTargets({ sessionIds: ['sess-a'] });

    expect(entries.map(ownerKeyOf)).toEqual([CODEX_A.key, GLM_LANE.key]);
    const dropped = h.logger.debug.mock.calls
      .filter(
        ([message]) => message === '[PlanLimitOwnerDiscovery] source dropped',
      )
      .map(([, meta]) => (meta as { source: string }).source);
    expect(dropped).toEqual(expect.arrayContaining(['detection', 'session']));
    expect(JSON.stringify(h.logger.debug.mock.calls)).not.toContain('/home/x');
  });

  it('a throwing selected-provider resolution still lists the other sources', async () => {
    const h = createHarness(CLAUDE_CLI);
    h.activeAuth.resolveActiveAuth.mockImplementation(() => {
      throw new Error('settings unreadable');
    });
    h.detection.detectAll.mockResolvedValue(detected('opencode'));

    const entries = await h.service.discoverTargets({});

    expect(entries.map(ownerKeyOf)).toEqual([OPENCODE.key]);
  });

  describe('Ollama Cloud keys through the real PlanUsageService, with no network', () => {
    function usageService(resolution: PlanCredentialResolution) {
      const credentials = { resolve: jest.fn(async () => resolution) };
      const service = new PlanUsageService(
        createMockLogger() as unknown as Logger,
        { snapshotFor: jest.fn(), recordWindowEvidence: jest.fn() },
        credentials,
        { readPlanUsage: jest.fn() } as never,
        { getUsage: jest.fn(), currentOwnerKey: jest.fn() } as never,
      );
      return { service, credentials };
    }

    it.each<[string, PlanCredentialResolution, string]>([
      [
        'missing',
        { kind: 'unavailable', status: 'unsupported-config' },
        'unsupported-config',
      ],
      [
        'placeholder',
        { kind: 'unavailable', status: 'unsupported-auth' },
        'unsupported-auth',
      ],
    ])(
      'a %s Glm key is still listed and reads %s',
      async (_name, resolution, status) => {
        const h = createHarness(THIRD_PARTY('openrouter'));
        h.owners.ownerForPtahCli.mockResolvedValue(GLM_NO_KEY);
        h.agents.listAgents.mockResolvedValue([glmAgent('pc-glm')]);
        const usage = usageService(resolution);

        const entries = await h.service.discoverTargets({});
        const lane = entries.find((entry) => entry.origin === 'lane');
        if (lane?.kind !== 'read') throw new Error('Glm lane not listed');
        const snapshot = await usage.service.getOwnerSnapshot(lane.target);

        expect(usage.credentials.resolve).toHaveBeenCalledWith({
          kind: 'ptah-cli-key',
          ptahCliId: 'pc-glm',
        });
        expect(snapshot.status).toBe(status);
        expect(snapshot.owner).toEqual(GLM_NO_KEY);
        expect(snapshot.windows).toEqual([]);
      },
    );
  });
});
