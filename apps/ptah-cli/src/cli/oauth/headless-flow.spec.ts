/**
 * Unit tests for `runHeadlessLogin` — the headless OAuth orchestrator.
 *
 * TASK_2026_104 Batch 8d.
 *
 * Coverage targets:
 *   - happy path: success flows through `auth.login.{start,url,complete}` and
 *     returns exit code 0.
 *   - timeout / denial: `pollLogin` resolves false → `task.error` with
 *     `ptah_code: 'auth_required'` and exit code 3.
 *   - SIGINT cancellation: signal during polling triggers `cancelLogin`,
 *     emits `task.error` with `cancelled: true`, returns exit code 130.
 *   - beginLogin failure: error during device-code request → `task.error` +
 *     exit code 3 without invoking `pollLogin` or surfacing a URL.
 *   - SIGINT handler is uninstalled in `finally` so subsequent invocations
 *     do not inherit a stale handler.
 */

import { EventEmitter } from 'node:events';

import {
  runHeadlessLogin,
  HEADLESS_LOGIN_TIMEOUT_MS,
  SIGINT_EXIT_CODE,
} from './headless-flow.js';
import type {
  HeadlessProcessLike,
  RunHeadlessLoginInput,
} from './headless-flow.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { ICopilotAuthService } from '@ptah-extension/agent-sdk';
import type { IOAuthUrlOpener } from '@ptah-extension/platform-cli';

/**
 * Local mirror of `CopilotDeviceLoginInfo` from
 * `libs/backend/agent-sdk/.../copilot-provider.types.ts`. The type is not
 * surfaced through the agent-sdk barrel, so we inline the shape here — the
 * spec only depends on field names matching what `runHeadlessLogin` reads.
 */
interface CopilotDeviceLoginInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

interface MockCopilotAuth {
  beginLogin: jest.Mock<Promise<CopilotDeviceLoginInfo>, []>;
  pollLogin: jest.Mock<Promise<boolean>, [string, unknown?]>;
  cancelLogin: jest.Mock<void, [string]>;
  /** Service-under-test — typed against the real interface. */
  service: ICopilotAuthService;
}

const SAMPLE_DEVICE_LOGIN: CopilotDeviceLoginInfo = {
  deviceCode: 'device-code-1234',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  interval: 5,
  expiresIn: 900,
};

function makeCopilotAuth(): MockCopilotAuth {
  const beginLogin: MockCopilotAuth['beginLogin'] = jest.fn(
    async () => SAMPLE_DEVICE_LOGIN,
  );
  const pollLogin: MockCopilotAuth['pollLogin'] = jest.fn(
    async (_deviceCode: string, _opts?: unknown) => true,
  );
  const cancelLogin: MockCopilotAuth['cancelLogin'] = jest.fn();
  // Cast through `unknown` because the helper only depends on
  // begin/poll/cancel — the rest of `ICopilotAuthService` is unused.
  const service = {
    beginLogin,
    pollLogin,
    cancelLogin,
    login: jest.fn(),
    tryRestoreAuth: jest.fn(),
    isAuthenticated: jest.fn(),
    getAuthState: jest.fn(),
    getHeaders: jest.fn(),
    logout: jest.fn(),
  } as unknown as ICopilotAuthService;
  return { beginLogin, pollLogin, cancelLogin, service };
}

function makeOpener(
  response: { opened: boolean; code?: string } = { opened: true },
): { opener: IOAuthUrlOpener; calls: Array<unknown> } {
  const calls: Array<unknown> = [];
  const opener: IOAuthUrlOpener = {
    openOAuthUrl: jest.fn(async (params) => {
      calls.push(params);
      return response;
    }),
  };
  return { opener, calls };
}

function makeProcessRef(): HeadlessProcessLike & { emitter: EventEmitter } {
  const emitter = new EventEmitter();
  return {
    emitter,
    on: (event: 'SIGINT', listener: () => void) => {
      emitter.on(event, listener);
      return undefined;
    },
    off: (event: 'SIGINT', listener: () => void) => {
      emitter.off(event, listener);
      return undefined;
    },
  };
}

function makeInput(overrides: Partial<RunHeadlessLoginInput> = {}): {
  input: RunHeadlessLoginInput;
  formatterTrace: FormatterTrace;
  copilotAuth: MockCopilotAuth;
  openerTrace: ReturnType<typeof makeOpener>;
  processRef: ReturnType<typeof makeProcessRef>;
} {
  const formatterTrace = makeFormatter();
  const copilotAuth = makeCopilotAuth();
  const openerTrace = makeOpener();
  const processRef = makeProcessRef();
  const input: RunHeadlessLoginInput = {
    provider: 'copilot',
    formatter: formatterTrace.formatter,
    copilotAuth: copilotAuth.service,
    opener: openerTrace.opener,
    processRef,
    timeoutMs: 1_000,
    ...overrides,
  };
  return { input, formatterTrace, copilotAuth, openerTrace, processRef };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runHeadlessLogin', () => {
  it('happy path — surfaces URL, polls successfully, emits start/url/complete + exit 0', async () => {
    const { input, formatterTrace, copilotAuth, openerTrace } = makeInput();

    const result = await runHeadlessLogin(input);

    expect(result).toEqual({
      exitCode: ExitCode.Success,
      outcome: 'success',
      deviceCode: SAMPLE_DEVICE_LOGIN.deviceCode,
    });
    expect(copilotAuth.beginLogin).toHaveBeenCalledTimes(1);
    expect(openerTrace.calls).toEqual([
      {
        provider: 'copilot',
        verificationUri: SAMPLE_DEVICE_LOGIN.verificationUri,
        userCode: SAMPLE_DEVICE_LOGIN.userCode,
      },
    ]);
    expect(copilotAuth.pollLogin).toHaveBeenCalledWith(
      SAMPLE_DEVICE_LOGIN.deviceCode,
      { timeoutMs: 1_000 },
    );

    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'auth.login.start',
      'auth.login.url',
      'auth.login.complete',
    ]);

    const urlNotification = formatterTrace.notifications[1];
    expect(urlNotification?.params).toMatchObject({
      provider: 'copilot',
      verification_uri: SAMPLE_DEVICE_LOGIN.verificationUri,
      user_code: SAMPLE_DEVICE_LOGIN.userCode,
      opened: true,
    });
  });

  it('timeout / denial — pollLogin returns false → task.error + exit 3', async () => {
    const harness = makeInput();
    harness.copilotAuth.pollLogin.mockResolvedValue(false);

    const result = await runHeadlessLogin(harness.input);

    expect(result.exitCode).toBe(ExitCode.AuthRequired);
    expect(result.outcome).toBe('timeout');

    const errorNotification = harness.formatterTrace.notifications.at(-1);
    expect(errorNotification?.method).toBe('task.error');
    expect(errorNotification?.params).toMatchObject({
      provider: 'copilot',
      ptah_code: 'auth_required',
    });
  });

  it('SIGINT — cancels polling, emits task.error with cancelled:true, exit 130', async () => {
    const harness = makeInput();
    let resolvePoll: ((value: boolean) => void) | undefined;
    harness.copilotAuth.pollLogin.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePoll = resolve;
        }),
    );

    const promise = runHeadlessLogin(harness.input);

    // Wait for `pollLogin` to be invoked so the SIGINT handler is installed.
    await new Promise((r) => setImmediate(r));
    expect(harness.copilotAuth.pollLogin).toHaveBeenCalled();

    // Fire SIGINT — should call cancelLogin, then resolve the polling promise
    // with false (real CopilotAuthService does this when its AbortController
    // aborts; we simulate by resolving the mock promise after cancel fires).
    harness.processRef.emitter.emit('SIGINT');
    expect(harness.copilotAuth.cancelLogin).toHaveBeenCalledWith(
      SAMPLE_DEVICE_LOGIN.deviceCode,
    );
    resolvePoll?.(false);

    const result = await promise;
    expect(result.exitCode).toBe(SIGINT_EXIT_CODE);
    expect(result.outcome).toBe('cancelled');

    const errorNotification = harness.formatterTrace.notifications.at(-1);
    expect(errorNotification?.method).toBe('task.error');
    expect(errorNotification?.params).toMatchObject({
      provider: 'copilot',
      ptah_code: 'auth_required',
      cancelled: true,
    });

    // Handler must be uninstalled in finally — emitter has 0 SIGINT listeners.
    expect(harness.processRef.emitter.listenerCount('SIGINT')).toBe(0);
  });

  it('beginLogin failure — emits task.error and skips opener + pollLogin', async () => {
    const harness = makeInput();
    harness.copilotAuth.beginLogin.mockRejectedValue(
      new Error('GitHub device endpoint refused'),
    );

    const result = await runHeadlessLogin(harness.input);

    expect(result.exitCode).toBe(ExitCode.AuthRequired);
    expect(result.outcome).toBe('failed');
    expect(harness.copilotAuth.pollLogin).not.toHaveBeenCalled();
    expect(harness.openerTrace.calls).toHaveLength(0);

    const methods = harness.formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual(['auth.login.start', 'task.error']);
  });

  it('opener throws — still proceeds to pollLogin and emits auth.login.url with opened:false', async () => {
    const harness = makeInput();
    (
      harness.openerTrace.opener.openOAuthUrl as jest.Mock
    ).mockRejectedValueOnce(new Error('peer disconnected'));

    const result = await runHeadlessLogin(harness.input);

    expect(result.exitCode).toBe(ExitCode.Success);
    const urlNotification = harness.formatterTrace.notifications.find(
      (n) => n.method === 'auth.login.url',
    );
    expect(urlNotification?.params).toMatchObject({ opened: false });
    expect(harness.copilotAuth.pollLogin).toHaveBeenCalled();
  });

  it('SIGINT handler is uninstalled even when pollLogin throws', async () => {
    const harness = makeInput();
    harness.copilotAuth.pollLogin.mockRejectedValue(
      new Error('network broken'),
    );

    await expect(runHeadlessLogin(harness.input)).rejects.toThrow(
      'network broken',
    );
    expect(harness.processRef.emitter.listenerCount('SIGINT')).toBe(0);
  });

  it('default timeout — uses HEADLESS_LOGIN_TIMEOUT_MS when timeoutMs is omitted', async () => {
    const harness = makeInput({ timeoutMs: undefined });

    await runHeadlessLogin(harness.input);

    expect(harness.copilotAuth.pollLogin).toHaveBeenCalledWith(
      SAMPLE_DEVICE_LOGIN.deviceCode,
      { timeoutMs: HEADLESS_LOGIN_TIMEOUT_MS },
    );
  });
});
