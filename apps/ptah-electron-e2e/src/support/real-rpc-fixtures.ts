import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchPtah } from './electron-launcher';
import { UiDriver } from './ui-driver';
import { RpcBridge } from './rpc-bridge';
import { createThreeHunkRepo, type ScratchRepo } from './git-scratch-repo';

/**
 * Real-RPC fixtures — the app talks to its own backend, nothing is mocked.
 *
 * The default `fixtures.ts` `ui` fixture calls `installFakeRpcListener()`,
 * which runs `ipcMain.removeAllListeners('rpc')` and answers every RPC from a
 * static map. That is the right tool for renderer-shaped assertions and the
 * wrong one for `TASK_2026_218`, whose whole question is whether a click in
 * the running UI reaches the real handler. A spec built on the mocked driver
 * would re-prove what Batch 8B already proved under jsdom.
 *
 * So this file deliberately does NOT install the fake listener and does NOT
 * seed `get-startup-config`: the real handler registered in
 * `apps/ptah-electron/src/activation/post-window.ts` answers with the real
 * `ElectronWorkspaceProvider` root, which resolves from the positional argv
 * this fixture passes at launch.
 *
 * Kept in its own file rather than added to `fixtures.ts` so the ~20 existing
 * specs on the mocked driver are untouched.
 */

/**
 * Booting a real workspace is what makes home-directory isolation mandatory
 * here rather than merely tidy. `wire-runtime.ts:345` awaits `bootHeavyServices`
 * whenever a startup workspace exists, which opens the SQLite database that
 * `persistence-sqlite/src/lib/db-path.ts` resolves to
 * `os.homedir()/.ptah/state/ptah.sqlite`. Without an isolated home, an e2e run
 * would contend with — and write migrations into — the developer's live Ptah
 * database. `--user-data-dir` does not cover this: it moves Electron's userData,
 * not `os.homedir()`.
 *
 * Node resolves `os.homedir()` from `USERPROFILE` on Windows and `HOME`
 * elsewhere, so both are set. This also isolates `~/.ptah/settings.json` and
 * the downloaded-content cache.
 */
const HOME_ENV_KEYS = ['USERPROFILE', 'HOME'] as const;

/**
 * A first boot into an empty home runs every migration from zero, so the
 * default 30s launch window is too tight — and `bootHeavyServices` is awaited
 * before the window is created, so the cost lands on `firstWindow()`.
 */
const REAL_BOOT_TIMEOUT_MS = 120_000;

/**
 * A method name that is deliberately NOT registered, used to probe the RPC
 * transport without doing any domain work (TASK_2026_230).
 *
 * `RpcHandler.handleMessage` answers an unknown method with a full response
 * envelope — `{ success: false, error: 'Method not found: …' }` — carrying the
 * caller's `correlationId`, so the probe exercises the entire path the real
 * calls take (ipcMain 'rpc' listener → RpcHandler → `event.sender.send`)
 * while touching no service, no subprocess and no disk. That is what makes it
 * a readiness gate rather than a warm-up: the only thing it can be waiting on
 * is the main-process event loop.
 *
 * It logs one `RpcHandler: Method not found` warning per test. That noise is
 * the price of a probe that cannot be answered early by a cached value.
 */
const RPC_READY_PROBE_METHOD = 'e2e:rpc-ready-probe';

/**
 * Why the `rpcBridge` fixture gates before handing the bridge over, instead of
 * treating `domcontentloaded` as readiness (TASK_2026_230).
 *
 * `domcontentloaded` says the RENDERER is up. It says nothing about the
 * backend, and two separate costs land on whichever RPC goes first:
 *
 * 1. THE EVENT LOOP. `wire-runtime.ts` is still finishing `bootHeavyServices`
 *    — migrations, the memory curator, the skill registry sync, the recursive
 *    git watcher, the embedder warmup — all on the same main-process event
 *    loop that services the 'rpc' channel. Measured here, a no-op RPC issued
 *    straight after `domcontentloaded` took ~7.6s; once the loop is free the
 *    same probe returns in 8-111ms.
 *
 * 2. THE FIRST GIT SUBPROCESS. Independently of the loop, the first `git`
 *    spawn in a freshly booted app process costs 4.4-11.3s on Windows. With
 *    the loop already quiet, `git:applyHunks` alone measured 10.8-12.5s; put a
 *    read-only `git:info` in front of it and `git:info` absorbs 4.4-11.3s
 *    while `git:applyHunks` drops to 2.2-4.4s. The cost follows whichever call
 *    spawns git first, not the method.
 *
 * `RpcBridge.sendRpc` defaults to a 10s timeout, and (1) + (2) together
 * routinely exceed it. The visible symptom was `[RpcBridge] sendRpc timed out
 * after 10000ms` in the `git:applyHunks` stale-snapshot control — which reads
 * like a hung guard and is not one. The guard answers, and answers correctly;
 * it was just behind boot and a cold `git`.
 *
 * Paying both costs here, off the clock of any assertion, keeps a spec's own
 * `sendRpc` timeout meaning "the call under test did not answer" rather than
 * "the app was still starting".
 *
 * (2) is a real user-facing latency, not only a test artefact: the first diff
 * opened after launching Ptah pays it too. It is out of scope here — this is a
 * slow path, not a stuck one — but it is worth its own carrier.
 */
const RPC_READY_TIMEOUT_MS = 120_000;

/**
 * A no-op probe that comes back inside this counts as "the event loop is
 * free". The probe does no work at all, so anything slower than this is queued
 * behind boot, not caused by the probe.
 */
const RPC_QUIET_ROUND_TRIP_MS = 1_000;

/**
 * How many consecutive quiet probes end the gate. One is not enough: boot work
 * arrives in bursts, so a single fast reply can land in a gap between two
 * expensive phases.
 */
const RPC_QUIET_STREAK = 2;

/** Pause between probes, so the gate samples rather than spins. */
const RPC_PROBE_INTERVAL_MS = 250;

/** What the readiness gate observed, for logging when a spec fails anyway. */
interface RpcReadiness {
  /** No-op probe round trips in ms, oldest first. */
  readonly probes: readonly number[];
  /** Cost of the read-only `git:info` that absorbs the first git spawn. */
  readonly gitWarmupMs: number;
}

/**
 * Block until the main process is actually ready to serve real work: the event
 * loop answers a no-op RPC promptly and repeatedly, AND a git subprocess has
 * been spawned once so the next caller does not pay for the first one.
 *
 * The no-op probe asserts on the router's own "method not found" wording on
 * purpose: a probe that accepted any reply would also pass against a fake
 * listener, and this fixture exists precisely because nothing is supposed to be
 * intercepting the 'rpc' channel here.
 *
 * The git warm-up is `git:info`, which reads branch and status and writes
 * nothing — it cannot disturb a spec that asserts on the index, and the app's
 * own git watcher is already reading the same repository regardless. Its reply
 * is deliberately not asserted on: the point is the spawn, and a repo-shaped
 * complaint from `git:info` is the spec's problem to report, not the fixture's.
 */
async function waitForRpcReady(
  bridge: RpcBridge,
  workspaceRoot: string,
): Promise<RpcReadiness> {
  const probes = await waitForQuietEventLoop(bridge);
  const startedGit = Date.now();
  await bridge.sendRpc(
    'rpc',
    {
      type: 'rpc:call',
      payload: { method: 'git:info', params: { workspaceRoot } },
    },
    RPC_READY_TIMEOUT_MS,
  );
  return { probes, gitWarmupMs: Date.now() - startedGit };
}

/**
 * Poll a no-op RPC until it comes back quickly enough, twice running.
 *
 * Returns the observed round trips, oldest first.
 */
async function waitForQuietEventLoop(bridge: RpcBridge): Promise<number[]> {
  const deadline = Date.now() + RPC_READY_TIMEOUT_MS;
  const samples: number[] = [];
  let streak = 0;

  for (;;) {
    const started = Date.now();
    const response = (await bridge.sendRpc(
      'rpc',
      {
        type: 'rpc:call',
        payload: { method: RPC_READY_PROBE_METHOD, params: {} },
      },
      Math.max(1_000, deadline - started),
    )) as { success?: boolean; error?: string } | undefined;
    const elapsed = Date.now() - started;
    samples.push(elapsed);

    const error = response?.error ?? '';
    if (response?.success !== false || !error.startsWith('Method not found')) {
      throw new Error(
        `[real-rpc-fixtures] RPC readiness probe got an unexpected reply. ` +
          `Expected the real RpcHandler to refuse "${RPC_READY_PROBE_METHOD}" ` +
          `with "Method not found"; got ${JSON.stringify(response)}. ` +
          `Something is answering the 'rpc' channel that should not be.`,
      );
    }

    streak = elapsed <= RPC_QUIET_ROUND_TRIP_MS ? streak + 1 : 0;
    if (streak >= RPC_QUIET_STREAK) return samples;

    if (Date.now() >= deadline) {
      // Not fatal: a busy machine may never go fully quiet, and a spec that
      // then fails on its own generous timeout is a better signal than a
      // fixture that fails for everyone.
      console.warn(
        `[real-rpc-fixtures] backend never went quiet within ` +
          `${RPC_READY_TIMEOUT_MS}ms; probe round trips (ms): ` +
          `${JSON.stringify(samples)}`,
      );
      return samples;
    }
    await new Promise((resolve) => setTimeout(resolve, RPC_PROBE_INTERVAL_MS));
  }
}

export interface RealRpcFixtures {
  /** A throwaway git repo with one committed file and three unstaged hunks. */
  repo: ScratchRepo;
  /** Isolated `os.homedir()` for the launched app — never the developer's. */
  ptahHome: string;
  electronApp: ElectronApplication;
  mainWindow: Page;
  /** UiDriver with no RPC mocking installed. */
  ui: UiDriver;
  /** Talks to the REAL handler here — nothing intercepts the `rpc` channel. */
  rpcBridge: RpcBridge;
}

export const test = base.extend<RealRpcFixtures>({
  // eslint-disable-next-line no-empty-pattern
  repo: async ({}, use) => {
    const repo = createThreeHunkRepo();
    try {
      await use(repo);
    } finally {
      repo.cleanup();
    }
  },

  // eslint-disable-next-line no-empty-pattern
  ptahHome: async ({}, use) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-home-'));
    try {
      await use(home);
    } finally {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // SQLite and the recursive workspace watcher can hold handles past
        // process exit on Windows; a leaked tmp home is not a spec failure.
      }
    }
  },

  electronApp: async ({ repo, ptahHome }, use) => {
    const env: Record<string, string> = {};
    for (const key of HOME_ENV_KEYS) env[key] = ptahHome;
    // The first non-flag argv becomes the workspace root — see
    // apps/ptah-electron/src/activation/bootstrap.ts.
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

  mainWindow: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow({
      timeout: REAL_BOOT_TIMEOUT_MS,
    });
    await use(win);
  },

  rpcBridge: async ({ electronApp, mainWindow, repo }, use) => {
    // Depends on mainWindow because sendRpc dispatches through the live
    // BrowserWindow's webContents, and on repo because the readiness gate
    // warms git against the workspace the app was launched on.
    await mainWindow.waitForLoadState('domcontentloaded');
    const bridge = new RpcBridge(electronApp);
    // See RPC_READY_TIMEOUT_MS — the backend is still starting at this point.
    const ready = await waitForRpcReady(bridge, repo.root);
    console.log(
      `[real-rpc-fixtures] RPC ready — no-op probes (ms): ` +
        `${JSON.stringify(ready.probes)}, git warm-up: ${ready.gitWarmupMs}ms`,
    );
    await use(bridge);
  },

  ui: async ({ electronApp, mainWindow }, use) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const driver = new UiDriver(electronApp, mainWindow);
    await driver.page
      .locator('ptah-electron-shell')
      .waitFor({ state: 'visible' });
    await use(driver);
  },
});

export const expect = base.expect;
