/**
 * Headless OAuth orchestration for `ptah auth login copilot`.
 *
 * Coordinates three async surfaces of the GitHub Copilot Device Code flow
 * (RFC 8628), wired against the headless-friendly API split delivered by B8a:
 *
 *   1. `beginLogin()`            → request a fresh device code from GitHub.
 *   2. `IOAuthUrlOpener.openOAuthUrl(...)` → surface the verification URL +
 *      user code to the connected JSON-RPC peer (or stderr fallback).
 *   3. `pollLogin(deviceCode, { timeoutMs })` → poll GitHub for the access
 *      token until it arrives or the timeout elapses.
 *
 * Lifecycle notifications emitted via the supplied {@link Formatter}:
 *   - `auth.login.start`    — flow has begun (provider + verification URI)
 *   - `auth.login.url`      — URL surfaced to peer / stderr (incl. `opened`)
 *   - `auth.login.complete` — success, with `success: true`
 *   - `task.error`          — timeout / cancel / failure, with `ptah_code`
 *
 * Hard guarantees:
 *   - 5-minute hard timeout via `pollLogin({ timeoutMs: 300_000 })`. The
 *     in-flight promise resolves with `false` and the device-code entry is
 *     evicted from the in-memory map by `pollLogin` itself.
 *   - SIGINT installs a one-shot handler that calls `cancelLogin(deviceCode)`
 *     to abort the polling AbortController, then resolves the promise so
 *     the command exits 130 (POSIX convention for SIGINT termination).
 *   - The SIGINT handler is uninstalled in `finally`, even on exception, so
 *     subsequent commands in the same process do not inherit a stale handler.
 *
 * No DI imports — the helper receives every collaborator by parameter so the
 * CLI command can compose `Full` or `Partial+` engines and tests can pass
 * vanilla objects without touching tsyringe.
 */

import type { ICopilotAuthService } from '@ptah-extension/auth-providers';
import type { IOAuthUrlOpener } from '@ptah-extension/platform-cli';

import type { Formatter } from '../output/formatter.js';
import { ExitCode, type ExitCodeValue } from '../jsonrpc/types.js';

/** 5-minute hard cap for the headless device-code flow. */
export const HEADLESS_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** POSIX exit code for SIGINT-terminated processes (128 + 2). */
export const SIGINT_EXIT_CODE = 130;

/** Subset of `process` we depend on — narrowed for testability. */
export interface HeadlessProcessLike {
  on(event: 'SIGINT', listener: () => void): unknown;
  off(event: 'SIGINT', listener: () => void): unknown;
}

/**
 * Inputs to {@link runHeadlessLogin}. The CLI command composes these from
 * its DI engine; tests pass plain doubles.
 */
export interface RunHeadlessLoginInput {
  /** Provider id surfaced in `auth.login.*` notifications. Currently `'copilot'`. */
  provider: string;
  /** Copilot auth service (begin/poll/cancel) — typed against the interface. */
  copilotAuth: ICopilotAuthService;
  /** OAuth URL opener — JsonRpc when a peer is attached, stderr otherwise. */
  opener: IOAuthUrlOpener;
  /** Notification sink — JSON-RPC NDJSON or human pretty-printer. */
  formatter: Formatter;
  /**
   * Process-level signal source. Defaults to {@link process} but tests pass an
   * `EventEmitter` so we never trip the real Node SIGINT handler.
   */
  processRef?: HeadlessProcessLike;
  /** Override timeout — tests use 0/sub-second values. Defaults to 5 min. */
  timeoutMs?: number;
}

/** Result of {@link runHeadlessLogin} — exit code + outcome metadata. */
export interface RunHeadlessLoginResult {
  exitCode: ExitCodeValue | typeof SIGINT_EXIT_CODE;
  outcome: 'success' | 'timeout' | 'cancelled' | 'failed';
  /** The device code reserved by `beginLogin`, surfaced for log/debug. */
  deviceCode?: string;
}

/**
 * Drive the full headless device-code flow end-to-end. Returns the exit code
 * the CLI command should set; never calls `process.exit` directly so tests
 * can run multiple invocations in-process.
 */
export async function runHeadlessLogin(
  input: RunHeadlessLoginInput,
): Promise<RunHeadlessLoginResult> {
  const {
    provider,
    copilotAuth,
    opener,
    formatter,
    processRef = process,
    timeoutMs = HEADLESS_LOGIN_TIMEOUT_MS,
  } = input;

  await formatter.writeNotification('auth.login.start', {
    provider,
    timestamp: new Date().toISOString(),
  });
  let deviceLogin;
  try {
    deviceLogin = await copilotAuth.beginLogin();
  } catch (error) {
    await formatter.writeNotification('task.error', {
      provider,
      ptah_code: 'auth_required',
      message: error instanceof Error ? error.message : String(error),
    });
    return { exitCode: ExitCode.AuthRequired, outcome: 'failed' };
  }

  const deviceCode = deviceLogin.deviceCode;
  let openResult: { opened: boolean; code?: string };
  try {
    openResult = await opener.openOAuthUrl({
      provider,
      verificationUri: deviceLogin.verificationUri,
      userCode: deviceLogin.userCode,
    });
  } catch {
    openResult = { opened: false };
  }

  await formatter.writeNotification('auth.login.url', {
    provider,
    verification_uri: deviceLogin.verificationUri,
    user_code: deviceLogin.userCode,
    opened: openResult.opened,
    expires_in: deviceLogin.expiresIn,
    interval: deviceLogin.interval,
  });
  let sigintReceived = false;
  const sigintHandler = (): void => {
    sigintReceived = true;

    copilotAuth.cancelLogin(deviceCode);
  };
  processRef.on('SIGINT', sigintHandler);

  try {
    const success = await copilotAuth.pollLogin(deviceCode, { timeoutMs });

    if (sigintReceived) {
      await formatter.writeNotification('task.error', {
        provider,
        ptah_code: 'auth_required',
        message: 'Login cancelled (SIGINT)',
        cancelled: true,
      });
      return { exitCode: SIGINT_EXIT_CODE, outcome: 'cancelled', deviceCode };
    }

    if (success) {
      await formatter.writeNotification('auth.login.complete', {
        provider,
        success: true,
        timestamp: new Date().toISOString(),
      });
      return { exitCode: ExitCode.Success, outcome: 'success', deviceCode };
    }
    await formatter.writeNotification('task.error', {
      provider,
      ptah_code: 'auth_required',
      message: 'Device code authorization timed out or was denied',
    });
    return { exitCode: ExitCode.AuthRequired, outcome: 'timeout', deviceCode };
  } finally {
    processRef.off('SIGINT', sigintHandler);
  }
}
