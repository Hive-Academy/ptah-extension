import type { ElectronApplication } from '@playwright/test';
import { test as realRpcTest, expect } from './real-rpc-fixtures';
import { launchPtah } from './electron-launcher';

/**
 * Fixtures for TASK_2026_264 — pinning TASK_2026_247's fix at the wiring
 * level.
 *
 * Extends `real-rpc-fixtures` (real backend, nothing mocked) with two things
 * neither that file nor any existing spec needs:
 *
 * 1. `PTAH_LOG_LEVEL=debug` on the launched app. `Logger.logToConsole` is
 *    false under the e2e harness's normal `NODE_ENV=test` (production
 *    defaults), so `[ConfigWatcher] Configuration changed` and
 *    `[SdkAgentAdapter] Config change detected, re-initializing...` never
 *    reach stdout — which is exactly the signal this task's assertion 3
 *    needs ("ConfigWatcher actually fired", not "nothing happened and the
 *    test passed anyway"). `PTAH_LOG_LEVEL=debug` is a real, already-shipped
 *    env var (`logger.ts` `detectDevelopmentMode()`), not a new seam — this
 *    fixture only chooses to set it for this one spec so the ~20 other
 *    real-rpc-fixtures specs keep their existing (quieter) launch.
 * 2. `stdoutLog` — a plain Node `data` listener on
 *    `electronApp.process().stdout`, independent of the one
 *    `electron-launcher.ts` already installs (Node streams support multiple
 *    listeners; this one buffers instead of just forwarding).
 *
 * `electronApp` is REDEFINED here rather than requesting a change to
 * `real-rpc-fixtures.ts`, which is prior art shared by ~20 specs this task
 * must leave unmodified in behaviour. Playwright fixture overrides via
 * `test.extend` are scoped to the `test` this file exports — the original
 * `real-rpc-fixtures` `test` (and everything built on it) is untouched.
 */

const HOME_ENV_KEYS = ['USERPROFILE', 'HOME'] as const;
const REAL_BOOT_TIMEOUT_MS = 120_000;

export interface StdoutLog {
  /** Everything captured so far, oldest first. */
  snapshot(): string;
  /**
   * Poll until `snapshot()` contains `needle`, or throw after `timeoutMs`.
   * Polls rather than using a one-shot listener because the target lines are
   * logged by a background re-init chain (`onConfigChanged` → `initialize()`)
   * whose exact timing relative to the triggering RPC's own response is not
   * itself part of what this fixture wants to assert on.
   */
  waitForLine(needle: string, timeoutMs?: number): Promise<void>;
}

function attachStdoutLog(app: ElectronApplication): StdoutLog {
  const chunks: string[] = [];
  app.process().stdout?.on('data', (buf: Buffer) => {
    chunks.push(buf.toString('utf8'));
  });
  app.process().stderr?.on('data', (buf: Buffer) => {
    // Some log levels route through console.error (e.g. Logger.error) —
    // the lines this fixture waits for are 'info', but capturing stderr
    // too keeps this fixture correct if that ever changes.
    chunks.push(buf.toString('utf8'));
  });

  return {
    snapshot: () => chunks.join(''),
    async waitForLine(needle: string, timeoutMs = 20_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (chunks.join('').includes(needle)) return;
        if (Date.now() > deadline) {
          throw new Error(
            `[permission-seam-fixtures] Timed out after ${timeoutMs}ms waiting for stdout/stderr to contain: ${needle}\n` +
              `Captured so far:\n${chunks.join('')}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}

/**
 * Every message the main process has pushed on the 'to-renderer' channel
 * since `messageLog` was installed, readable by polling.
 *
 * Deliberately NOT built on `RpcBridge.waitForRendererMessage` /
 * `RpcBridge.sendRpc`, both of which work by TEMPORARILY patching
 * `webContents.send` for the lifetime of one call and restoring whatever was
 * patched before them on completion (see `rpc-bridge.ts`). That nests safely
 * as long as calls are sequential, but this spec needs to fire the seed
 * permission WITHOUT waiting for it (its own response only arrives once
 * something later answers or tears it down), then separately observe both
 * the request it broadcasts and — later — its own eventual response. A
 * one-shot listener installed after the fact can miss a message that already
 * flowed through; a persistent, poll-only collector installed once at the
 * BASE of the patch chain (before any `sendRpc`/`waitForRendererMessage` call
 * exists to nest on top of it) cannot.
 */
export interface MessageLog {
  waitFor<T = unknown>(
    predicate: (msg: unknown) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
}

async function attachMessageLog(app: ElectronApplication): Promise<MessageLog> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('[permission-seam-fixtures] No BrowserWindow');
    const g = globalThis as unknown as { __ptahCapturedMessages: unknown[] };
    g.__ptahCapturedMessages = [];
    const patchable = win.webContents as unknown as {
      send: (channel: string, ...args: unknown[]) => void;
    };
    const originalSend = patchable.send.bind(win.webContents);
    patchable.send = (channel: string, ...args: unknown[]) => {
      if (channel === 'to-renderer') {
        g.__ptahCapturedMessages.push(args[0]);
      }
      originalSend(channel, ...args);
    };
  });

  return {
    async waitFor<T>(
      predicate: (msg: unknown) => boolean,
      timeoutMs = 20_000,
    ): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // `captured` crosses the CDP boundary as plain JSON, back into THIS
        // (Node/test) process — unlike `RpcBridge.waitForRendererMessage`,
        // the predicate never needs to run inside the Electron main process,
        // so it is called directly here with its original closure intact.
        const captured = (await app.evaluate(
          () =>
            (globalThis as unknown as { __ptahCapturedMessages: unknown[] })
              .__ptahCapturedMessages,
        )) as unknown[];
        const match = captured.find((msg) => predicate(msg));
        if (match !== undefined) return match as T;
        if (Date.now() > deadline) {
          throw new Error(
            `[permission-seam-fixtures] Timed out after ${timeoutMs}ms waiting for a ` +
              `'to-renderer' message matching the predicate. Captured ${captured.length} message(s).`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    },
  };
}

export interface PermissionSeamFixtures {
  stdoutLog: StdoutLog;
  messageLog: MessageLog;
}

export const test = realRpcTest.extend<PermissionSeamFixtures>({
  electronApp: async ({ repo, ptahHome }, use) => {
    const env: Record<string, string> = { PTAH_LOG_LEVEL: 'debug' };
    for (const key of HOME_ENV_KEYS) env[key] = ptahHome;
    const app = await launchPtah({
      args: [repo.root],
      env,
      timeout: REAL_BOOT_TIMEOUT_MS,
    });
    try {
      await use(app);
    } finally {
      await app.close().catch(() => {});
    }
  },

  stdoutLog: async ({ electronApp }, use) => {
    await use(attachStdoutLog(electronApp));
  },

  // Depends on `rpcBridge` (unused directly) purely for ordering: rpcBridge's
  // own fixture setup runs several temporary `webContents.send` patch/unpatch
  // cycles (`waitForRpcReady`'s readiness probes). Those must fully settle —
  // patch chain back to the true original — before this fixture installs its
  // OWN, permanent patch underneath, or a probe that finishes after this
  // fixture would restore what IT saw as "original" and silently discard this
  // collector. Sibling fixtures with no declared dependency can initialize
  // concurrently in Playwright; this dependency removes that race.
  messageLog: async (
    { electronApp, mainWindow, rpcBridge: _rpcBridge },
    use,
  ) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    await use(await attachMessageLog(electronApp));
  },
});

export { expect };
