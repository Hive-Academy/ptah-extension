/**
 * TASK_2026_278 Batch 3, E24 — the session-start preflight.
 *
 * `SessionQueryExecutor.executeQuery` is the ONE funnel every interactive,
 * gateway-driven and resumed SDK session passes through. Before Batch 3 nothing
 * on that path checked whether the workspace actually had a harness, so a
 * session started by `ptah tui`, the gateway or a cron job in a workspace no
 * GUI host had ever opened began with whatever the last host happened to leave
 * behind — frequently nothing.
 *
 * Three contracts are pinned here, and each corresponds to a way the feature
 * could be worse than not having it at all:
 *
 * 1. It runs BEFORE the SDK module is loaded and the options are built, so the
 *    repair lands before the model is told what it has.
 * 2. It is handed the session's OWN cwd, not a host-global root — that is what
 *    makes E14 (a sub-folder cwd) and multi-workspace hosts work.
 * 3. A preflight that throws cannot fail the session. `executeQuery`'s catch
 *    tears the registration down and rethrows, so an unguarded call would turn
 *    a harness hiccup into a failed user message.
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ISdkPermissionHandler, AuthEnv } from '@ptah-extension/shared';
import { SessionQueryExecutor } from './session-query-executor.service';
import type { IHarnessPreflight } from '../../harness/harness-preflight.port';

const PROJECT_PATH = '/repo/packages/api';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface Harness {
  executor: SessionQueryExecutor;
  ensure: jest.Mock;
  getQueryFunction: jest.Mock;
  build: jest.Mock;
  logger: Logger;
}

function buildExecutor(ensure: jest.Mock | null): Harness {
  const logger = makeLogger();
  // `build` throwing is the cheapest way to stop the executor right after the
  // preflight without standing up the whole SDK: everything under test has
  // already happened by then, and `executeQuery` rolls back cleanly.
  const build = jest.fn().mockRejectedValue(new Error('stop-after-preflight'));
  const getQueryFunction = jest.fn().mockResolvedValue(jest.fn());

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
    ensure === null ? null : ({ ensure } as IHarnessPreflight),
  );

  return {
    executor,
    ensure: ensure ?? jest.fn(),
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

describe('SessionQueryExecutor — harness preflight (E24)', () => {
  it("hands the preflight the session's own cwd", async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const h = buildExecutor(ensure);

    await run(h);

    expect(ensure).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it('runs before the SDK module is loaded and before options are built', async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const h = buildExecutor(ensure);

    await run(h);

    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
      h.getQueryFunction.mock.invocationCallOrder[0],
    );
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(
      h.build.mock.invocationCallOrder[0],
    );
  });

  it('continues the session when the preflight throws', async () => {
    // The port promises never to throw; this is the guard for an implementation
    // that breaks that promise. Reaching `build` at all is the assertion.
    const ensure = jest.fn().mockRejectedValue(new Error('EPERM'));
    const h = buildExecutor(ensure);

    await run(h);

    expect(h.build).toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it('is skipped, not failed, when no workspace path is known', async () => {
    const ensure = jest.fn().mockResolvedValue(null);
    const h = buildExecutor(ensure);

    await expect(
      h.executor.executeQuery({
        sessionId: 'sess-2' as never,
        sessionConfig: undefined,
      } as never),
    ).rejects.toThrow('stop-after-preflight');

    expect(ensure).not.toHaveBeenCalled();
  });

  it('starts sessions unchanged in a host with no preflight bound', async () => {
    const h = buildExecutor(null);

    await run(h);

    expect(h.build).toHaveBeenCalled();
  });
});
