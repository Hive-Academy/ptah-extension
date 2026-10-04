/**
 * Owner lifecycle, backend legs (TASK_2026_596; F55 as amended by Gate 2 G2
 * and G3; F77).
 *
 * Real pieces: the session plan-limit registry, `ProviderOwnerResolver`, the
 * plan-limit ledger, `LaneOwnerResolver`, `PtahCliLanePlanLimits`,
 * `AgentProcessManager`, the `agent-events` persistence wiring and
 * `SessionMetadataStore` over an in-memory state store. The only fake is the
 * Claude session probe, reduced to what G2 requires of it: the account is
 * re-read once per turn, so two turns can answer with two accounts. No
 * account-change event is ever emitted.
 *
 * 1. Turn 1 reads account A: the session owner is A, and lane run 1 records
 *    and persists A.
 * 2. Turn 2 reads account B: the session owner moves to B. Run 1 keeps A,
 *    now a different owner; run 2 records B, the same owner.
 * 3. G3 restart: run 1 has no ledger evidence at all. After a reload through
 *    `getCliSessionsForRestore` and `restoreAgents` it still carries A, so it
 *    is still a different owner from the session's B.
 * 4. A malformed or legacy persisted owner restores as no owner ("Unknown
 *    owner"), never as B.
 */
import 'reflect-metadata';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SessionMetadataStore,
  SessionPlanLimitCallbackRegistry,
  type SessionQuotaProbe,
} from '@ptah-extension/agent-sdk';
import {
  PlanLimitLedgerService,
  ProviderOwnerResolver,
  type ClaudeAccountInfo,
} from '@ptah-extension/auth-providers';
import {
  ownerRelation,
  type AgentId,
  type CliSessionReference,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import { AgentProcessManager } from '../agent-process-manager.service';
import { AgentMessageRouter } from '../agent-message-router.service';
import { AgentSpawnEnvironment } from '../agent-spawn-environment.service';
import { AgentOutputBuffer } from '../agent-output-buffer.service';
import type { SdkHandle } from '../cli-adapters/cli-adapter.interface';
import { LaneOwnerResolver } from './lane-owner.resolver';
import { PtahCliLanePlanLimits } from '../../ptah-cli/helpers/ptah-cli-lane-plan-limits';
import { wireAgentEventListeners } from '../../wiring/agent-events';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
/**
 * Each lane exit is announced after the manager's real 3 s grace delay
 * (`GRACEFUL_EXIT_DELAY_MS`); real timers keep the store and retry path real.
 */
const EXIT_TEST_TIMEOUT_MS = 20_000;
const ROOT = realpathSync(tmpdir());

const ACCOUNT_A = {
  email: 'a@example.test',
  organization: 'org-a',
} as unknown as ClaudeAccountInfo;
const ACCOUNT_B = {
  email: 'b@example.test',
  organization: 'org-b',
} as unknown as ClaudeAccountInfo;

/** Let queued promise callbacks, store writes and retries run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * The probe surface the resolver reads. The account is cached per turn and
 * dropped at `turn-start`, as the real probe does (G2), so each turn reads
 * the next `accountInfo()` answer.
 */
function createPerTurnProbe(
  registry: SessionPlanLimitCallbackRegistry,
  accountInfo: jest.Mock<Promise<ClaudeAccountInfo>, []>,
): SessionQuotaProbe {
  let cached: Promise<ClaudeAccountInfo> | undefined;
  registry.register(({ signal }) => {
    if (signal.kind === 'turn-start') cached = undefined;
  });
  return {
    readAccount: (sessionId: string) => {
      if (sessionId !== SESSION_ID) return Promise.resolve(null);
      cached ??= accountInfo();
      return cached;
    },
    readPlanUsage: async () => null,
    sessionRoute: (sessionId: string) =>
      sessionId === SESSION_ID
        ? { providerId: 'anthropic', routeKind: 'native' }
        : null,
  } as SessionQuotaProbe;
}

function createManager(
  logger: Logger,
  laneOwners: LaneOwnerResolver,
  ledger: PlanLimitLedgerService,
): AgentProcessManager {
  type Args = ConstructorParameters<typeof AgentProcessManager>;
  type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn(() => ROOT),
    getWorkspaceFolders: jest.fn(() => [ROOT]),
    getConfiguration: jest.fn(
      (_section: string, _key: string, fallback?: unknown) => fallback,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  };
  const cliDetection = { getAdapter: jest.fn() } as unknown as Args[1];
  const sentry = { captureException: jest.fn() };
  return new AgentProcessManager(
    logger,
    cliDetection,
    { getRunningBySession: jest.fn(() => []) } as unknown as Args[2],
    sentry as unknown as Args[3],
    new AgentMessageRouter(logger, cliDetection),
    new AgentSpawnEnvironment(
      logger,
      cliDetection,
      workspaceProvider as unknown as EnvironmentArgs[2],
      { effort: { get: jest.fn(() => '') } } as unknown as EnvironmentArgs[3],
      sentry as unknown as EnvironmentArgs[4],
      null,
      null,
      null,
    ),
    new AgentOutputBuffer(logger),
    {
      signal: jest.fn(async () => ({
        delivered: false,
        reason: 'chat-runtime-unavailable',
      })),
    } as unknown as Args[7],
    laneOwners,
    ledger,
  );
}

interface World {
  logger: Logger;
  registry: SessionPlanLimitCallbackRegistry;
  resolver: ProviderOwnerResolver;
  ledger: PlanLimitLedgerService;
  laneOwners: LaneOwnerResolver;
  manager: AgentProcessManager;
  store: SessionMetadataStore;
  storage: ReturnType<typeof createMockStateStorage>;
  accountInfo: jest.Mock<Promise<ClaudeAccountInfo>, []>;
}

async function createWorld(): Promise<World> {
  const logger = createMockLogger() as unknown as Logger;
  const registry = new SessionPlanLimitCallbackRegistry(logger);
  const accountInfo = jest
    .fn<Promise<ClaudeAccountInfo>, []>()
    .mockResolvedValueOnce(ACCOUNT_A)
    .mockResolvedValueOnce(ACCOUNT_B);
  const probe = createPerTurnProbe(registry, accountInfo);
  const resolver = new ProviderOwnerResolver(
    logger,
    { getProviderKey: jest.fn(async () => undefined) } as never,
    probe,
    { currentOwnerKey: () => null } as never,
    { path: ROOT } as never,
  );
  const ledger = new PlanLimitLedgerService(
    logger,
    createMockStateStorage(),
    registry,
    resolver,
    { onRateLimit: () => () => undefined, onSuccess: () => () => undefined },
  );
  const laneOwners = new LaneOwnerResolver(logger, resolver);
  const manager = createManager(logger, laneOwners, ledger);

  const storage = createMockStateStorage();
  const store = new SessionMetadataStore(storage, logger);
  await store.create(SESSION_ID, ROOT, 'parent');

  const container: DependencyContainer = rootContainer.createChildContainer();
  container.register(TOKENS.AGENT_PROCESS_MANAGER, { useValue: manager });
  container.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: { broadcastMessage: jest.fn(async () => undefined) },
  });
  container.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: store,
  });
  wireAgentEventListeners(container, {
    logger,
    platform: 'electron',
    options: { persistCliSession: true },
  });

  return {
    logger,
    registry,
    resolver,
    ledger,
    laneOwners,
    manager,
    store,
    storage,
    accountInfo,
  };
}

function startTurn(world: World): void {
  world.registry.notifyAll({
    sessionId: SESSION_ID,
    signal: { kind: 'turn-start', observedAt: Date.now() },
  });
}

function sessionOwner(world: World): QuotaOwnerRef | undefined {
  const key = world.ledger.sessionOwners()[SESSION_ID]?.ownerKey;
  return world.ledger.knownOwners().find((owner) => owner.key === key);
}

/**
 * One Ptah CLI Claude lane run through the real lane owner path: its own
 * `accountInfo()` after the system init, recorded once the manager tracks
 * the run. Resolves with the run's id and a function that ends it.
 */
async function runLane(
  world: World,
  cliSessionId: string,
  laneAccount: ClaudeAccountInfo,
): Promise<{ agentId: string; finish: () => Promise<void> }> {
  let finish!: (code: number) => void;
  const done = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const handle: SdkHandle = {
    abort: new AbortController(),
    done,
    onOutput: () => undefined,
    getSessionId: () => cliSessionId,
  };
  const lane = new PtahCliLanePlanLimits({
    logger: world.logger,
    ledger: world.ledger,
    owners: world.laneOwners,
    recordOwner: (agentId, owner) =>
      world.manager.recordQuotaOwner(agentId, owner),
    ptahCliId: 'pc-claude',
    providerId: 'claude-cli',
  });
  lane.onSystemInit({ accountInfo: async () => laneAccount });

  const { agentId } = await world.manager.spawnFromSdkHandle(handle, {
    task: `run ${cliSessionId}`,
    cli: 'ptah-cli',
    workingDirectory: ROOT,
    parentSessionId: SESSION_ID,
    ptahCliId: 'pc-claude',
    ptahCliName: 'Claude Lane',
  });
  lane.attach(agentId);
  await lane.settled;
  await settle();
  return {
    agentId,
    // The manager announces the exit after its grace delay; the exit
    // reference is persisted from that announcement.
    finish: async () => {
      const exited = new Promise<void>((resolve) => {
        world.manager.events.once('agent:exited', () => resolve());
      });
      finish(0);
      await exited;
      await settle();
    },
  };
}

async function persistedRefs(
  store: SessionMetadataStore,
): Promise<CliSessionReference[]> {
  return store.getCliSessionsForRestore(SESSION_ID);
}

describe('Owner lifecycle (F55 backend legs, G2 per-turn account, G3 restart)', () => {
  let world: World;

  beforeEach(async () => {
    world = await createWorld();
  });

  afterEach(async () => {
    await world.manager.disposeAll();
    world.ledger.dispose();
  });

  it('moves the session from A to B across turns while each run keeps its own owner', async () => {
    const ownerA = world.resolver.ownerForClaudeAccount(ACCOUNT_A, 'a');
    const ownerB = world.resolver.ownerForClaudeAccount(ACCOUNT_B, 'b');
    expect(ownerA.identityKind).toBe('account');
    expect(ownerRelation(ownerA, ownerB)).toBe('different');

    // Turn 1: the probe reads account A.
    startTurn(world);
    await settle();
    expect(sessionOwner(world)).toEqual(ownerA);

    const run1 = await runLane(world, 'cli-run-1', ACCOUNT_A);
    expect(world.manager.findAgentInfo(run1.agentId)?.quotaOwner).toEqual(
      ownerA,
    );
    expect(
      ownerRelation(
        world.manager.findAgentInfo(run1.agentId)?.quotaOwner,
        sessionOwner(world),
      ),
    ).toBe('same');
    // The owner is persisted as soon as it is known, before the run exits.
    expect((await persistedRefs(world.store))[0]?.quotaOwner).toEqual(ownerA);
    await run1.finish();

    // Turn 2: no event of any kind, just the next per-turn read — account B.
    startTurn(world);
    await settle();
    expect(world.accountInfo).toHaveBeenCalledTimes(2);
    expect(sessionOwner(world)).toEqual(ownerB);

    const run1Info = world.manager.findAgentInfo(run1.agentId);
    expect(run1Info?.status).toBe('completed');
    expect(run1Info?.quotaOwner).toEqual(ownerA);
    expect(ownerRelation(run1Info?.quotaOwner, sessionOwner(world))).toBe(
      'different',
    );

    const run2 = await runLane(world, 'cli-run-2', ACCOUNT_B);
    await run2.finish();
    const run2Info = world.manager.findAgentInfo(run2.agentId);
    expect(run2Info?.quotaOwner).toEqual(ownerB);
    expect(ownerRelation(run2Info?.quotaOwner, sessionOwner(world))).toBe(
      'same',
    );

    const refs = await persistedRefs(world.store);
    expect(
      refs.map((ref) => [ref.cliSessionId, ref.status, ref.quotaOwner]),
    ).toEqual([
      ['cli-run-1', 'completed', ownerA],
      ['cli-run-2', 'completed', ownerB],
    ]);
  }, EXIT_TEST_TIMEOUT_MS);

  it('G3 restart: run A with no ledger evidence still restores as A, a different owner from B', async () => {
    const ownerA = world.resolver.ownerForClaudeAccount(ACCOUNT_A, 'a');
    const ownerB = world.resolver.ownerForClaudeAccount(ACCOUNT_B, 'b');

    startTurn(world);
    await settle();
    const run1 = await runLane(world, 'cli-run-1', ACCOUNT_A);
    await run1.finish();
    startTurn(world);
    await settle();
    expect(sessionOwner(world)).toEqual(ownerB);

    // Nothing was ever recorded against A: the restore cannot lean on it.
    expect(world.ledger.snapshotFor(ownerA.key)).toBeUndefined();

    // Host restart: a fresh store over the same storage, a fresh manager.
    await world.store.flush();
    const reloadedStore = new SessionMetadataStore(world.storage, world.logger);
    const refs = await reloadedStore.getCliSessionsForRestore(SESSION_ID);
    const restartedManager = createManager(
      world.logger,
      world.laneOwners,
      world.ledger,
    );
    try {
      expect(restartedManager.restoreAgents(refs, ROOT)).toBe(1);

      const restored = restartedManager.findAgentInfo(run1.agentId);
      expect(restored?.quotaOwner).toEqual(ownerA);
      expect(ownerRelation(restored?.quotaOwner, ownerB)).toBe('different');
    } finally {
      await restartedManager.disposeAll();
    }
  }, EXIT_TEST_TIMEOUT_MS);

  it.each<[string, Record<string, unknown>]>([
    ['a malformed owner', { quotaOwner: { providerId: 'anthropic', key: 'x' } }],
    ['a legacy bare key', { quotaOwnerKey: 'anthropic#account:0123456789abcdef' }],
    ['an owner with an unknown identity kind', {
      quotaOwner: {
        providerId: 'anthropic',
        identityKind: 'email',
        key: 'anthropic#account:0123456789abcdef',
        label: 'Claude account',
      },
    }],
  ])('restores %s as no owner, never the current owner B', async (_name, stored) => {
    const ownerB = world.resolver.ownerForClaudeAccount(ACCOUNT_B, 'b');
    const agentId = 'aaaaaaaa-bbbb-4ccc-8ddd-0000000000aa' as AgentId;
    await world.store.addCliSession(SESSION_ID, {
      cliSessionId: 'cli-legacy',
      cli: 'ptah-cli',
      agentId,
      task: 'older run',
      startedAt: '2026-09-01T10:00:00.000Z',
      status: 'completed',
      ...stored,
    } as unknown as CliSessionReference);
    await world.store.flush();

    const reloadedStore = new SessionMetadataStore(world.storage, world.logger);
    const refs = await reloadedStore.getCliSessionsForRestore(SESSION_ID);
    const restartedManager = createManager(
      world.logger,
      world.laneOwners,
      world.ledger,
    );
    try {
      restartedManager.restoreAgents(refs, ROOT);

      const restored = restartedManager.findAgentInfo(agentId);
      expect(restored).toBeDefined();
      expect(restored).not.toHaveProperty('quotaOwner');
      expect(restored).not.toHaveProperty('quotaOwnerKey');
      expect(ownerRelation(restored?.quotaOwner, ownerB)).toBe('unknown');
    } finally {
      await restartedManager.disposeAll();
    }
  });
});
