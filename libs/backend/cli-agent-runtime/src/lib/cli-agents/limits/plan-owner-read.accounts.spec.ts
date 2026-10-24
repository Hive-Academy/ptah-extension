/**
 * Lane and session owner discovery on named Claude accounts (TASK_2026_712,
 * Batch 23; plan 209-214).
 *
 * Covers: a named read carries its certified route and needs its own session;
 * route material separates route, revision, epoch and run; the same verified
 * identity in two directories is one owner; distinct and unknown owners stay
 * separate; a replaced query's late answer is discarded; a failed read never
 * becomes a known owner; the ambient card never reads a named session; a
 * lane's remembered owner is keyed by its route. Mocked collaborators only.
 */
import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ActiveAuth,
  ClaudeAccountInfo,
} from '@ptah-extension/auth-providers';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { PtahCliSummary, QuotaOwnerRef } from '@ptah-extension/shared';
import {
  NO_OPEN_SESSION,
  namedSourceMaterial,
  planOwnerRead,
  sameSourceBinding,
  type PlanOwnerSourceBinding,
} from './plan-owner-read';
import {
  PlanLimitOwnerDiscoveryService,
  type DiscoveredPlanOwner,
  type DiscoveryLedger,
  type DiscoveryOwnerSource,
  type DiscoverySessionRecord,
} from './plan-limit-owner-discovery.service';
import { LaneOwnerResolver, type LaneOwnerSource } from './lane-owner.resolver';
import { PtahCliLanePlanLimits } from '../../ptah-cli/helpers/ptah-cli-lane-plan-limits';

const route = (
  fingerprint: string,
  authEpoch = 1,
  runId = 'run-1',
): ClaudeAccountNamedRoute =>
  ({
    kind: 'named',
    provider: 'claude',
    profileId: `profile-${fingerprint}`,
    canonicalConfigDir: `/fixture/${fingerprint}`,
    routeFingerprint: fingerprint,
    routeRevision: 1,
    authEpoch,
    runId,
  }) as unknown as ClaudeAccountNamedRoute;

const bindingOf = (r: ClaudeAccountNamedRoute): PlanOwnerSourceBinding => ({
  provider: r.provider,
  routeFingerprint: r.routeFingerprint,
  routeRevision: r.routeRevision,
  authEpoch: r.authEpoch,
});

/** Owner by email+organization (directory-independent), else by material. */
function claudeOwner(
  account: ClaudeAccountInfo,
  material: string,
): QuotaOwnerRef {
  const email = account?.email?.trim();
  return email
    ? {
        providerId: 'anthropic',
        identityKind: 'account',
        key: `anthropic#account:${email}|${account?.organization ?? ''}`,
        label: 'Claude account',
      }
    : {
        providerId: 'anthropic',
        identityKind: 'unknown',
        key: `anthropic#unknown:${material}`,
        label: 'Claude identity unavailable (no email)',
      };
}

const ALICE: ClaudeAccountInfo = {
  email: 'alice@example.test',
  organization: 'org-a',
};
const BOB: ClaudeAccountInfo = {
  email: 'bob@example.test',
  organization: 'org-b',
};
const CLAUDE_CLI: ActiveAuth = {
  authMethod: 'claudeCli',
  providerId: 'anthropic',
};

const keyOf = (entry: DiscoveredPlanOwner): string =>
  entry.kind === 'read' ? entry.target.ownerRef.key : entry.snapshot.owner.key;

describe('planOwnerRead on a named Claude source', () => {
  const owner = claudeOwner(ALICE, 'unused');

  it('reads only through its own session and carries a copy of the route', () => {
    const named = route('fp-a');
    const plan = planOwnerRead(owner, { sessionId: 's-1', claudeRoute: named });
    expect(plan).toEqual({
      kind: 'read',
      target: expect.objectContaining({
        providerId: 'anthropic',
        sessionHandle: { kind: 'session', sessionId: 's-1' },
        claudeRoute: expect.objectContaining({
          routeFingerprint: 'fp-a',
          authEpoch: 1,
        }),
      }),
    });
    expect(plan?.kind === 'read' && plan.target.claudeRoute).not.toBe(named);
  });

  it('is unavailable without a matching session; no other query stands in', () => {
    expect(planOwnerRead(owner, { claudeRoute: route('fp-a') })).toEqual(
      NO_OPEN_SESSION,
    );
  });

  it('keeps an API-key owner unsupported with no read', () => {
    const key: QuotaOwnerRef = {
      ...owner,
      identityKind: 'credential',
      key: 'anthropic#credential:k',
    };
    expect(
      planOwnerRead(key, { sessionId: 's-1', claudeRoute: route('fp-a') }),
    ).toEqual({
      kind: 'known',
      status: 'unsupported-auth',
    });
  });

  it('separates route material by route, epoch and run, and matches bindings exactly', () => {
    const a1 = bindingOf(route('fp-a', 1));
    const a2 = bindingOf(route('fp-a', 2));
    expect(namedSourceMaterial(a1, 'run:x')).not.toBe(
      namedSourceMaterial(a2, 'run:x'),
    );
    expect(namedSourceMaterial(a1, 'run:x')).not.toBe(
      namedSourceMaterial(a1, 'run:y'),
    );
    expect(sameSourceBinding(a1, { ...a1 })).toBe(true);
    expect(sameSourceBinding(a1, a2)).toBe(false);
    expect(sameSourceBinding(a1, undefined)).toBe(false);
  });
});

describe('LaneOwnerResolver on named Claude lanes', () => {
  function resolver() {
    const owners = {
      ownerForClaudeAccount: jest.fn(claudeOwner),
    } as unknown as jest.Mocked<LaneOwnerSource>;
    return {
      owners,
      lanes: new LaneOwnerResolver(
        createMockLogger() as unknown as Logger,
        owners,
      ),
    };
  }

  it('dedups the same identity across two directories and separates unknown runs by route', () => {
    const { lanes } = resolver();
    const a = lanes.ownerForClaudeLane(ALICE, 'agent-1', route('fp-a'));
    const b = lanes.ownerForClaudeLane(ALICE, 'agent-2', route('fp-b'));
    expect(a.key).toBe(b.key);
    expect(
      lanes.ownerForClaudeLane(BOB, 'agent-3', route('fp-b')).key,
    ).not.toBe(a.key);
    const unknownOld = lanes.ownerForClaudeLane(
      null,
      'agent-4',
      route('fp-a', 1),
    );
    const unknownNew = lanes.ownerForClaudeLane(
      null,
      'agent-4',
      route('fp-a', 2),
    );
    expect(unknownOld.identityKind).toBe('unknown');
    expect(unknownOld.key).not.toBe(unknownNew.key);
  });

  it('keeps the ambient material unchanged', () => {
    const { lanes, owners } = resolver();
    lanes.ownerForClaudeLane(null, 'agent-9');
    expect(owners.ownerForClaudeAccount).toHaveBeenCalledWith(
      null,
      'run:agent-9',
    );
  });

  it('remembers known owners per route and never remembers an unknown one', () => {
    const { lanes } = resolver();
    const alice = lanes.ownerForClaudeLane(ALICE, 'agent-1', route('fp-a'));
    lanes.rememberLaneOwner(
      { cli: 'ptah-cli', ptahCliId: 'claude', accountRouteFingerprint: 'fp-a' },
      alice,
    );
    lanes.rememberLaneOwner(
      { cli: 'ptah-cli', ptahCliId: 'claude', accountRouteFingerprint: 'fp-b' },
      lanes.ownerForClaudeLane(null, 'agent-2', route('fp-b')),
    );
    expect(
      lanes.lastLaneOwner({
        cli: 'ptah-cli',
        ptahCliId: 'claude',
        accountRouteFingerprint: 'fp-a',
      }),
    ).toBe(alice);
    expect(
      lanes.lastLaneOwner({
        cli: 'ptah-cli',
        ptahCliId: 'claude',
        accountRouteFingerprint: 'fp-b',
      }),
    ).toBeUndefined();
    expect(
      lanes.lastLaneOwner({ cli: 'ptah-cli', ptahCliId: 'claude' }),
    ).toBeUndefined();
  });
});

describe('PtahCliLanePlanLimits on a named Claude lane', () => {
  it('reads its own query and keys an email-less owner to the route and epoch', async () => {
    const ownerForClaudeLane = jest.fn(
      (
        account: ClaudeAccountInfo,
        agentId: string,
        r?: ClaudeAccountNamedRoute,
      ) =>
        claudeOwner(
          account,
          r ? namedSourceMaterial(bindingOf(r), agentId) : agentId,
        ),
    );
    const recordOwner = jest.fn(() => true);
    const lane = new PtahCliLanePlanLimits({
      logger: createMockLogger() as unknown as Logger,
      ledger: null,
      owners: { ownerForClaudeLane, ownerForPtahCliKey: jest.fn() },
      recordOwner,
      ptahCliId: 'claude',
      providerId: 'claude-cli',
    });
    const named = route('fp-a', 3);
    const accountInfo = jest.fn(async () => null);
    lane.onSystemInit({ accountInfo }, named);
    lane.attach('agent-1');
    await lane.settled;
    await Promise.resolve();
    expect(accountInfo).toHaveBeenCalledTimes(1);
    expect(ownerForClaudeLane).toHaveBeenCalledWith(
      null,
      'agent-1',
      expect.objectContaining({ authEpoch: 3 }),
    );
    expect(recordOwner).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ identityKind: 'unknown' }),
    );
  });

  it('records no owner when its own read fails', async () => {
    const recordOwner = jest.fn(() => true);
    const lane = new PtahCliLanePlanLimits({
      logger: createMockLogger() as unknown as Logger,
      ledger: null,
      owners: { ownerForClaudeLane: jest.fn(), ownerForPtahCliKey: jest.fn() },
      recordOwner,
      ptahCliId: 'claude',
      providerId: 'claude-cli',
    });
    lane.onSystemInit(
      { accountInfo: jest.fn(async () => Promise.reject(new Error('denied'))) },
      route('fp-a'),
    );
    lane.attach('agent-1');
    await lane.settled;
    await Promise.resolve();
    expect(recordOwner).not.toHaveBeenCalled();
  });
});

describe('PlanLimitOwnerDiscoveryService on named Claude sessions', () => {
  function harness() {
    const records = new Map<string, DiscoverySessionRecord>();
    const accounts = new Map<string, ClaudeAccountInfo | Error>();
    const native = new Set<string>();
    const owners = {
      ownerForProviderKey: jest.fn(),
      ownerForPtahCli: jest.fn(),
      ownerForClaudeAccount: jest.fn(claudeOwner),
      ownerForCodexHome: jest.fn(),
      resolveCodexHomeOwner: jest.fn(),
      ownerForCliStore: jest.fn(),
      ownerForOpenCode: jest.fn(),
      ownerForAntigravity: jest.fn(),
      ownerForSession: jest.fn(async (id: string) => {
        const account = accounts.get(id) ?? null;
        if (account instanceof Error) throw account;
        return claudeOwner(account, `session:${id}`);
      }),
      detailsFor: jest.fn(() => ({})),
    } as unknown as jest.Mocked<DiscoveryOwnerSource>;
    const ledger = {
      snapshotFor: jest.fn(() => undefined),
      knownOwners: jest.fn(() => []),
      sessionOwners: jest.fn(() => ({})),
    } as unknown as jest.Mocked<DiscoveryLedger>;
    const service = new PlanLimitOwnerDiscoveryService(
      createMockLogger() as unknown as Logger,
      owners,
      ledger,
      {
        sessionRoute: (id: string) =>
          native.has(id)
            ? { providerId: 'anthropic', routeKind: 'native' }
            : null,
      },
      { resolveActiveAuth: jest.fn(() => CLAUDE_CLI) },
      { detectAll: jest.fn(async () => []) },
      { listAgents: jest.fn(async () => [] as PtahCliSummary[]) },
      { find: (id: string) => records.get(id) },
    );
    const open = (
      id: string,
      r: ClaudeAccountNamedRoute | undefined,
      account: ClaudeAccountInfo | Error,
    ) => {
      records.set(id, {
        query: { id },
        ...(r && { accountBinding: bindingOf(r) }),
      });
      accounts.set(id, account);
      native.add(id);
    };
    return { service, owners, ledger, records, open };
  }

  const sessionEntries = (entries: DiscoveredPlanOwner[]) =>
    entries.filter((entry) => entry.origin === 'session');

  it('lists one owner for the same verified identity in two directories, unread', async () => {
    const h = harness();
    h.open('s-a', route('fp-a'), ALICE);
    h.open('s-b', route('fp-b'), ALICE);
    const entries = sessionEntries(
      await h.service.discoverTargets({ sessionIds: ['s-a', 's-b'] }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'known',
      snapshot: {
        status: 'service-unavailable',
        unavailableReason: 'no-open-session',
        windowSetEstablished: false,
      },
    });
    expect(keyOf(entries[0])).toBe(claudeOwner(ALICE, '').key);
  });

  it('keeps distinct identities and unknown routes separate', async () => {
    const h = harness();
    h.open('s-a', route('fp-a'), ALICE);
    h.open('s-b', route('fp-b'), BOB);
    h.open('s-c', route('fp-c'), null);
    h.open('s-d', route('fp-d'), null);
    const keys = sessionEntries(
      await h.service.discoverTargets({
        sessionIds: ['s-a', 's-b', 's-c', 's-d'],
      }),
    ).map(keyOf);
    expect(new Set(keys).size).toBe(4);
    expect(keys.filter((key) => key.includes('#unknown:'))).toHaveLength(2);
    expect(
      keys.find((key) => key.includes('#unknown:') && key.includes('fp-c')),
    ).toBeDefined();
  });

  it('discards a late answer from a replaced query and keeps the owner unknown', async () => {
    const h = harness();
    h.open('s-a', route('fp-a', 1), ALICE);
    h.owners.ownerForSession.mockImplementationOnce(async () => {
      h.records.set('s-a', {
        query: { replaced: true },
        accountBinding: bindingOf(route('fp-a', 2)),
      });
      return claudeOwner(ALICE, 'session:s-a');
    });
    const [entry] = sessionEntries(
      await h.service.discoverTargets({ sessionIds: ['s-a'] }),
    );
    expect(entry.kind).toBe('known');
    expect(keyOf(entry)).toContain('#unknown:');
    expect(keyOf(entry)).toContain('fp-a');
  });

  it('never promotes a failed read to a known owner', async () => {
    const h = harness();
    h.open('s-a', route('fp-a'), new Error('probe failed'));
    const first = sessionEntries(
      await h.service.discoverTargets({ sessionIds: ['s-a'] }),
    );
    expect(keyOf(first[0])).toContain('#unknown:');
    h.open('s-b', route('fp-b'), ALICE);
    const second = sessionEntries(
      await h.service.discoverTargets({ sessionIds: ['s-a', 's-b'] }),
    );
    expect(second.map(keyOf)).toEqual([
      keyOf(first[0]),
      claudeOwner(ALICE, '').key,
    ]);
  });

  it('is unavailable when the bound session has no open query', async () => {
    const h = harness();
    h.records.set('s-a', {
      query: null,
      accountBinding: bindingOf(route('fp-a')),
    });
    const [entry] = sessionEntries(
      await h.service.discoverTargets({ sessionIds: ['s-a'] }),
    );
    expect(entry).toMatchObject({
      kind: 'known',
      snapshot: { unavailableReason: 'no-open-session' },
    });
    expect(h.owners.ownerForSession).toHaveBeenCalledTimes(1);
    expect(keyOf(entry)).toContain('#unknown:');
  });

  it('never reads a named session for the ambient selected provider', async () => {
    const h = harness();
    h.open('s-named', route('fp-a'), BOB);
    h.ledger.sessionOwners.mockReturnValue({
      's-named': { ownerKey: 'anthropic#account:bob', modelScope: null },
    });
    const entries = await h.service.discoverTargets({
      selectedProviderId: 'claude-cli',
    });
    const selected = entries.find(
      (entry) => entry.origin === 'selected-provider',
    );
    expect(selected).toMatchObject({
      kind: 'known',
      snapshot: { unavailableReason: 'no-open-session' },
    });
    expect(h.owners.ownerForSession).not.toHaveBeenCalled();
  });

  it('keeps reading the ambient observed owner through its own session', async () => {
    const h = harness();
    h.open('s-ambient', undefined, ALICE);
    const entries = await h.service.discoverTargets({
      selectedProviderId: 'claude-cli',
      sessionIds: ['s-ambient'],
    });
    const selected = entries.find(
      (entry) => entry.origin === 'selected-provider',
    );
    expect(selected).toMatchObject({
      kind: 'read',
      target: { sessionHandle: { kind: 'session', sessionId: 's-ambient' } },
    });
    expect(
      selected?.kind === 'read' && selected.target.claudeRoute,
    ).toBeFalsy();
  });
});
