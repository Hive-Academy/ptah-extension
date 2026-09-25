/**
 * TASK_2026_278 Batch 3, E24 — the session-start preflight, as TASK_2026_560
 * (C5) turned it into a capability-policy sync.
 *
 * `SessionQueryExecutor.executeQuery` is the ONE funnel every interactive,
 * gateway-driven and resumed SDK session passes through. It resolves the
 * capability policy once, syncs the harness to that policy's fingerprint, and
 * hands the SAME policy to the options builder.
 *
 * Contracts pinned here, each a way the feature could be worse than not having
 * it at all:
 *
 * 1. The sync runs BEFORE the SDK module is loaded and the options are built,
 *    so the repair lands before the model is told what it has.
 * 2. It is handed the policy's physical root and fingerprint — the root the
 *    resolver computed from the session's OWN cwd, not a host-global root.
 * 3. A sync that throws, or does not acknowledge, cannot fail the session.
 * 4. An unverified policy — including a missing or throwing resolver — runs
 *    no sync at all and still reaches the builder as unverified (R8).
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ISdkPermissionHandler,
  AuthEnv,
  EffectiveCapabilitySet,
  ICapabilityResolver,
} from '@ptah-extension/shared';
import { SessionQueryExecutor } from './session-query-executor.service';

const PROJECT_PATH = '/repo/packages/api';
const PHYSICAL_ROOT = '/repo';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function policy(
  overrides: Partial<EffectiveCapabilitySet> = {},
): EffectiveCapabilitySet {
  return {
    physicalRoot: PHYSICAL_ROOT,
    policyKey: PHYSICAL_ROOT,
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: ['global-off-skill'],
    disabledPluginIds: [],
    harnessFingerprint: 'fp-1',
    ...overrides,
  };
}

interface Harness {
  executor: SessionQueryExecutor;
  resolve: jest.Mock;
  apply: jest.Mock;
  getQueryFunction: jest.Mock;
  build: jest.Mock;
  logger: Logger;
}

function buildExecutor(opts: {
  resolve?: jest.Mock | null;
  apply?: jest.Mock | null;
}): Harness {
  const logger = makeLogger();
  // `build` throwing is the cheapest way to stop the executor right after the
  // sync without standing up the whole SDK: everything under test has
  // already happened by then, and `executeQuery` rolls back cleanly.
  const build = jest.fn().mockRejectedValue(new Error('stop-after-preflight'));
  const getQueryFunction = jest.fn().mockResolvedValue(jest.fn());
  const resolve =
    opts.resolve === undefined
      ? jest.fn().mockResolvedValue(policy())
      : opts.resolve;
  const apply =
    opts.apply === undefined
      ? jest.fn().mockResolvedValue({ acknowledged: true })
      : opts.apply;

  const registry = {
    register: jest.fn().mockReturnValue({
      messageQueue: [],
      permissionLevel: 'ask',
    }),
    remove: jest.fn(),
  };
  const streamPump = { createUserMessageStream: jest.fn() };
  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('ask'),
  } as unknown as ISdkPermissionHandler;

  const executor = new SessionQueryExecutor(
    logger,
    registry as never,
    streamPump as never,
    permissionHandler,
    { getQueryFunction } as never,
    { build } as never,
    { createUserMessage: jest.fn() } as never,
    {} as AuthEnv,
    { invokeWithLoadedQuery: jest.fn() } as never,
    resolve === null ? null : ({ resolve } as unknown as ICapabilityResolver),
    apply === null ? null : { apply },
  );

  return {
    executor,
    resolve: resolve ?? jest.fn(),
    apply: apply ?? jest.fn(),
    getQueryFunction,
    build,
    logger,
  };
}

async function run(h: Harness): Promise<void> {
  await expect(
    h.executor.executeQuery({
      sessionId: 'sess-1' as never,
      sessionConfig: { projectPath: PROJECT_PATH } as never,
    } as never),
  ).rejects.toThrow('stop-after-preflight');
}

function builtPolicy(h: Harness): EffectiveCapabilitySet | undefined {
  const [input] = h.build.mock.calls[0] as [
    { capabilityPolicy?: EffectiveCapabilitySet },
  ];
  return input.capabilityPolicy;
}

describe('SessionQueryExecutor — capability policy and harness sync (E24, C5)', () => {
  it("resolves the policy for the session's own cwd", async () => {
    const h = buildExecutor({});

    await run(h);

    expect(h.resolve).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it("syncs the harness to the policy's physical root and fingerprint", async () => {
    const h = buildExecutor({});

    await run(h);

    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.apply).toHaveBeenCalledWith(PHYSICAL_ROOT, 'fp-1');
  });

  it('runs the sync before the SDK module is loaded and before options are built', async () => {
    const h = buildExecutor({});

    await run(h);

    expect(h.apply.mock.invocationCallOrder[0]).toBeLessThan(
      h.getQueryFunction.mock.invocationCallOrder[0],
    );
    expect(h.apply.mock.invocationCallOrder[0]).toBeLessThan(
      h.build.mock.invocationCallOrder[0],
    );
  });

  it('hands the builder the SAME policy snapshot the sync used', async () => {
    const resolved = policy({ harnessFingerprint: 'fp-snapshot' });
    const h = buildExecutor({ resolve: jest.fn().mockResolvedValue(resolved) });

    await run(h);

    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(builtPolicy(h)).toBe(resolved);
    // A global-OFF skill reaches the builder only through the set.
    expect(builtPolicy(h)?.deniedSkillNames).toEqual(['global-off-skill']);
  });

  it('logs an unacknowledged pass and continues the session', async () => {
    const h = buildExecutor({
      apply: jest.fn().mockResolvedValue({ acknowledged: false }),
    });

    await run(h);

    expect(h.build).toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('did not acknowledge'),
      expect.objectContaining({ fingerprint: 'fp-1' }),
    );
  });

  it('continues the session when the sync throws', async () => {
    // `apply` sits on a never-throwing port; this is the guard for an
    // implementation that breaks that promise. Reaching `build` is the assertion.
    const h = buildExecutor({
      apply: jest.fn().mockRejectedValue(new Error('EPERM')),
    });

    await run(h);

    expect(h.build).toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('runs no sync for an unverified policy and still builds under it', async () => {
    const unverified = policy({
      status: 'unverified',
      reasons: [
        {
          path: '/home/u/.ptah/capabilities/global/x.json',
          error: 'invalid JSON',
        },
      ],
    });
    const h = buildExecutor({
      resolve: jest.fn().mockResolvedValue(unverified),
    });

    await run(h);

    expect(h.apply).not.toHaveBeenCalled();
    expect(builtPolicy(h)).toBe(unverified);
  });

  it('fails closed when no resolver is registered: no sync, unverified policy', async () => {
    const h = buildExecutor({ resolve: null });

    await run(h);

    expect(h.apply).not.toHaveBeenCalled();
    expect(builtPolicy(h)).toMatchObject({
      status: 'unverified',
      ptahEnabled: true,
      deniedSkillNames: [],
    });
  });

  it('fails closed when the resolver throws: no sync, unverified policy', async () => {
    const h = buildExecutor({
      resolve: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await run(h);

    expect(h.apply).not.toHaveBeenCalled();
    expect(builtPolicy(h)?.status).toBe('unverified');
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('is skipped, not failed, when no workspace path is known', async () => {
    const h = buildExecutor({});

    await expect(
      h.executor.executeQuery({
        sessionId: 'sess-2' as never,
        sessionConfig: undefined,
      } as never),
    ).rejects.toThrow('stop-after-preflight');

    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('starts sessions in a host with no harness sync bound', async () => {
    const h = buildExecutor({ apply: null });

    await run(h);

    expect(h.build).toHaveBeenCalled();
    expect(builtPolicy(h)?.status).toBe('verified');
  });
});
