/**
 * `ptah.agent.list` → `ptah.agent.limits` binding (TASK_2026_596, Batch 14;
 * binding carried from Batch 13).
 *
 * Wired to the real `LaneLimitLookupService`: a Ptah CLI row listed by the
 * namespace must carry its `providerId`, or the lookup cannot apply the
 * Ollama Cloud key rule and the lane is left with no owner. A lookup that
 * throws yields one explicit `unknown` per row and borrows no owner.
 */
// The cli-agent-runtime barrel reaches tsyringe, which needs the polyfill.
import 'reflect-metadata';
import {
  LaneLimitLookupService,
  type AgentProcessManager,
  type CliDetectionService,
} from '@ptah-extension/cli-agent-runtime';
import type {
  CliDetectionResult,
  PlanLimitOwnerSnapshot,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import {
  buildAgentNamespace,
  type AgentNamespaceDependencies,
} from './agent-namespace.builder';

type LookupArgs = ConstructorParameters<typeof LaneLimitLookupService>;
type Registry = NonNullable<
  ReturnType<NonNullable<AgentNamespaceDependencies['getPtahCliRegistry']>>
>;

const CLOUD_OWNER: QuotaOwnerRef = {
  key: 'ollama-cloud#credential:011a',
  providerId: 'ollama-cloud',
  identityKind: 'credential',
  label: 'Cloud key',
};

const CLOUD_SNAPSHOT: PlanLimitOwnerSnapshot = {
  owner: CLOUD_OWNER,
  status: 'available',
  windowSetEstablished: false,
  windows: [],
  ownerEvidence: [],
};

const CODEX_ROW: CliDetectionResult = {
  cli: 'codex',
  installed: true,
  messagingMode: 'steer',
};

function lookupService(): {
  service: LaneLimitLookupService;
  ownerForPtahCliKey: jest.Mock;
} {
  const logger = { debug: jest.fn() };
  const ownerForPtahCliKey = jest.fn<Promise<QuotaOwnerRef>, [string, string]>(
    async () => CLOUD_OWNER,
  );
  const owners: LookupArgs[1] = {
    ownerForLane: () => undefined,
    ownerForPtahCliKey,
  };
  const snapshots: LookupArgs[2] = {
    getOwnerSnapshot: async () => CLOUD_SNAPSHOT,
  };
  const ledger: LookupArgs[3] = { snapshotFor: () => undefined };
  const service = new LaneLimitLookupService(
    logger as Pick<LookupArgs[0], 'debug'> as LookupArgs[0],
    owners,
    snapshots,
    ledger,
  );
  return { service, ownerForPtahCliKey };
}

function deps(
  getLaneLimits: AgentNamespaceDependencies['getLaneLimits'],
): AgentNamespaceDependencies {
  const detection: Pick<CliDetectionService, 'detectAll'> = {
    detectAll: async () => [CODEX_ROW],
  };
  const registry: Pick<Registry, 'listAgents'> = {
    listAgents: async () => [
      {
        id: 'glm-1',
        name: 'Glm',
        providerName: 'Cloud provider',
        providerId: 'ollama-cloud',
        hasApiKey: true,
        enabled: true,
      },
    ],
  };
  return {
    agentProcessManager: {} as AgentProcessManager,
    cliDetectionService: detection as CliDetectionService,
    getWorkspaceRoot: () => 'D:/ws',
    getPtahCliRegistry: () => registry as Registry,
    getLaneLimits,
  };
}

describe('buildAgentNamespace — limits', () => {
  it('lists a ptah-cli ollama-cloud row with its providerId, and the lookup gives it an owner', async () => {
    const { service, ownerForPtahCliKey } = lookupService();
    const agent = buildAgentNamespace(deps(service.lookup.bind(service)));

    const rows = await agent.list();
    const glm = rows.find((row) => row.ptahCliId === 'glm-1');
    expect(glm?.providerId).toBe('ollama-cloud');

    const limits = await agent.limits?.(rows);
    const glmLimit = limits?.find((limit) => limit.row.ptahCliId === 'glm-1');
    expect(ownerForPtahCliKey).toHaveBeenCalledWith('glm-1', 'ollama-cloud');
    expect(glmLimit?.lookup).toBe('ok');
    expect(glmLimit?.owner).toEqual(CLOUD_OWNER);
    expect(glmLimit?.snapshot).toEqual(CLOUD_SNAPSHOT);
  });

  it('leaves a ptah-cli row without providerId with no owner (why the binding matters)', async () => {
    const { service, ownerForPtahCliKey } = lookupService();
    const agent = buildAgentNamespace(deps(service.lookup.bind(service)));

    const rows = await agent.list();
    const stripped = rows.map((row) => ({ ...row, providerId: undefined }));
    const limits = await agent.limits?.(stripped);

    expect(ownerForPtahCliKey).not.toHaveBeenCalled();
    expect(
      limits?.find((limit) => limit.row.ptahCliId === 'glm-1')?.lookup,
    ).toBe('no-owner');
  });

  it('returns one explicit unknown per row, with no owner, when the lookup throws', async () => {
    const getLaneLimits = jest.fn(async () => {
      throw new Error('lookup down');
    });
    const agent = buildAgentNamespace(deps(getLaneLimits));

    const rows = await agent.list();
    const limits = await agent.limits?.(rows);

    expect(limits).toHaveLength(rows.length);
    for (const [index, limit] of (limits ?? []).entries()) {
      expect(limit.row).toBe(rows[index]);
      expect(limit.lookup).toBe('failed');
      expect(limit.owner).toBeUndefined();
      expect(limit.snapshot).toBeUndefined();
      expect(limit.state).toEqual({
        state: 'unknown',
        reasons: [{ kind: 'lookup-failed', failure: 'failed' }],
        windows: [],
      });
    }
  });

  it('returns undefined when no lookup is wired', async () => {
    const agent = buildAgentNamespace(deps(undefined));
    await expect(agent.limits?.([CODEX_ROW])).resolves.toBeUndefined();
  });
});
