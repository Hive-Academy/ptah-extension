/**
 * SessionControl — record-identity teardown spec.
 *
 * Surface under test: `endSessionIfTokenMatches`, the compare-and-end primitive
 * that lets a stream loop tear down the record it STREAMED without touching a
 * newer record registered under the same id.
 *
 * Why it has to exist: ids are reused. `executeSlashCommandQuery` ends the live
 * record and immediately registers a NEW one under the SAME id, then spends
 * seconds on harness preflight before the fresh SDK query starts. The old
 * broadcast loop sees that end as a thrown abort and reaches its `finally` in
 * that window; a presence check by id ("is anything registered?") answers yes,
 * so the old loop used to abort the REPLACEMENT's AbortController and the
 * follow-up slash command failed with "Operation aborted".
 *
 * Uses the REAL `SessionRegistry` so record identity is observed through actual
 * registration, not a stubbed return value. Collaborators that only receive
 * teardown notifications are jest mocks.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  ISdkPermissionHandler,
  SessionId,
} from '@ptah-extension/shared';

import { SessionControl } from './session-control.service';
import { SessionRegistry } from './session-registry.service';
import type { IModelResolver } from '../../auth-env.port';
import type { SessionEndCallbackRegistry } from '../session-end-callback-registry';

const KEY = 'tab_shared_key';
const KEY_ID = KEY as SessionId;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(): AISessionConfig {
  return {
    model: 'test-model',
    projectPath: '/tmp/test',
  } as AISessionConfig;
}

interface Harness {
  control: SessionControl;
  registry: SessionRegistry;
  cleanupPendingPermissions: jest.Mock;
  markAllInterrupted: jest.Mock;
  notifyAll: jest.Mock;
}

function makeHarness(): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);

  const cleanupPendingPermissions = jest.fn();
  const permissionHandler = {
    cleanupPendingPermissions,
  } as unknown as ISdkPermissionHandler;

  const markAllInterrupted = jest.fn();
  const subagentRegistry = {
    beginSessionTeardown: jest.fn(),
    endSessionTeardown: jest.fn(),
    markAllInterrupted,
  } as unknown as SubagentRegistryService;

  const modelResolver = {
    resolve: (model: string) => model,
  } as unknown as IModelResolver;

  const notifyAll = jest.fn();
  const sessionEndRegistry = {
    notifyAll,
  } as unknown as SessionEndCallbackRegistry;

  const control = new SessionControl(
    logger,
    registry,
    permissionHandler,
    subagentRegistry,
    modelResolver,
    sessionEndRegistry,
  );

  return {
    control,
    registry,
    cleanupPendingPermissions,
    markAllInterrupted,
    notifyAll,
  };
}

describe('SessionControl.endSessionIfTokenMatches', () => {
  it('refuses a stale token and leaves the REPLACEMENT record intact', async () => {
    const h = makeHarness();

    // T1 is the record a broadcast loop streamed.
    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    const t1Token = t1.token;
    await h.control.endSession(KEY_ID);

    // The slash-command re-query registers T2 under the SAME id.
    const t2 = h.registry.register(KEY, makeConfig(), new AbortController());
    expect(t2.token).not.toBe(t1Token);

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, t1Token);

    expect(ended).toBe(false);
    expect(t2.abortController.signal.aborted).toBe(false);
    expect(h.registry.find(KEY)).toBe(t2);
  });

  it('performs no teardown side effects when the token is stale', async () => {
    const h = makeHarness();

    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    const t1Token = t1.token;
    await h.control.endSession(KEY_ID);
    h.registry.register(KEY, makeConfig(), new AbortController());

    h.cleanupPendingPermissions.mockClear();
    h.markAllInterrupted.mockClear();
    h.notifyAll.mockClear();

    await h.control.endSessionIfTokenMatches(KEY_ID, t1Token);

    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
    expect(h.markAllInterrupted).not.toHaveBeenCalled();
    expect(h.notifyAll).not.toHaveBeenCalled();
  });

  it('ends the session when the token still identifies the registered record', async () => {
    const h = makeHarness();

    const t1 = h.registry.register(KEY, makeConfig(), new AbortController());
    await h.control.endSession(KEY_ID);
    const t2 = h.registry.register(KEY, makeConfig(), new AbortController());

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, t2.token);

    expect(ended).toBe(true);
    expect(t2.abortController.signal.aborted).toBe(true);
    expect(h.registry.find(KEY)).toBeUndefined();
    // Non-vacuity: the first record's token is genuinely different, so the
    // refusal above was not a mismatch of two equal strings.
    expect(t1.token).not.toBe(t2.token);
  });

  it('runs the same teardown as endSession (permissions → subagents → notify)', async () => {
    const h = makeHarness();

    const rec = h.registry.register(KEY, makeConfig(), new AbortController());

    const ended = await h.control.endSessionIfTokenMatches(KEY_ID, rec.token);

    expect(ended).toBe(true);
    expect(h.cleanupPendingPermissions).toHaveBeenCalledWith(KEY);
    expect(h.markAllInterrupted).toHaveBeenCalledWith(KEY);
    expect(h.notifyAll).toHaveBeenCalledWith({
      sessionId: KEY,
      workspaceRoot: '/tmp/test',
    });
  });

  it('returns false when nothing is registered under the id', async () => {
    const h = makeHarness();

    const ended = await h.control.endSessionIfTokenMatches(
      KEY_ID,
      'token-for-a-record-that-never-existed',
    );

    expect(ended).toBe(false);
    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
  });
});

/**
 * `endSession` on an id nothing is registered under — the state
 * `executeSlashCommandQuery` now sees when `chat:continue` routes a slash
 * command WITHOUT resuming first (TASK_2026_350).
 *
 * This is the half of that fix which lives here: the reason it is safe to hand
 * `executeSlashCommandQuery` an inactive session is that its opening
 * `endSession` finds no record and returns before ever reaching the interrupt
 * race. The pre-fix path resumed first, so the record DID exist, and the
 * teardown spent the full 5 s on `Interrupt timed out (5s)` (log.log:2335).
 *
 * Fake timers, never advanced, are the assertion: a call that awaited the 5 s
 * race would not settle. No wall-clock budget is measured — that would test the
 * host, not the code.
 */
describe('SessionControl.endSession — unregistered id (TASK_2026_350)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves without waiting on any timer and runs no teardown', async () => {
    const h = makeHarness();

    await expect(h.control.endSession(KEY_ID)).resolves.toBeUndefined();

    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
    expect(h.markAllInterrupted).not.toHaveBeenCalled();
    expect(h.notifyAll).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('non-vacuity — a REGISTERED record whose interrupt never settles does arm the 5s timer', async () => {
    const h = makeHarness();

    const rec = h.registry.register(KEY, makeConfig(), new AbortController());
    // A query whose interrupt() never settles: the only thing that can release
    // `endRecord` is the 5s leg of the Promise.race.
    rec.query = {
      interrupt: () => new Promise<void>(() => undefined),
    } as unknown as typeof rec.query;

    let settled = false;
    const pending = h.control.endSession(KEY_ID).then(() => {
      settled = true;
    });

    // Flush microtasks: without the timer, nothing can complete the race.
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(5000);
    await pending;

    expect(settled).toBe(true);
    expect(h.markAllInterrupted).toHaveBeenCalledWith(KEY);
  });
});
