/**
 * `bootstrapElectron` — the two NETWORK calls must not gate the window
 * (TASK_2026_331 B1.T2).
 *
 * ## Why the call site is asserted from source
 *
 * `bootstrapElectron` calls `ElectronDIContainer.setup()`, which pulls in
 * better-sqlite3, sqlite-vec, the provider SDKs and the embedder worker. The DI
 * smoke test (`di/container.smoke.spec.ts`) already records that this cannot
 * boot under Jest and builds a hand-rolled container instead. Standing the
 * whole function up here would test the mock graph, not the ordering — the same
 * reasoning `wire-runtime.boot-order.spec.ts` records.
 *
 * So the split is: the two helpers are driven for real (they are pure
 * container-in, promise-out functions), and the ONE thing that cannot be
 * observed from them — whether the boot awaits them — is pinned textually.
 * The negative assertions run against the source with comments stripped, so
 * prose explaining the old shape cannot satisfy them.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

import {
  startAgentAdapterInitialization,
  startMembershipVerification,
} from './bootstrap';

const RAW_SOURCE = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8');
const SOURCE = RAW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^[ \t]*\/\/.*$/gm,
  '',
);

/** The body of `bootstrapElectron`, i.e. the source after its declaration. */
const BOOTSTRAP_BODY = SOURCE.slice(
  SOURCE.indexOf('export async function bootstrapElectron('),
);

function makeContainer(
  entries: Array<[unknown, unknown]>,
): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    resolve: (token: unknown) => {
      if (!map.has(token)) throw new Error(`not registered: ${String(token)}`);
      return map.get(token);
    },
    isRegistered: (token: unknown) => map.has(token),
  } as unknown as DependencyContainer;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('bootstrapElectron — network calls are started, not awaited', () => {
  it('starts membership verification with `void`, never `await`', () => {
    expect(BOOTSTRAP_BODY).toContain('void startMembershipVerification(');
    expect(BOOTSTRAP_BODY).not.toContain('await startMembershipVerification(');
    expect(BOOTSTRAP_BODY).not.toContain(
      'await licenseService.verifyLicense()',
    );
  });

  it('starts agent adapter initialization with `void`, never `await`', () => {
    expect(BOOTSTRAP_BODY).toContain('void startAgentAdapterInitialization(');
    expect(BOOTSTRAP_BODY).not.toContain(
      'await startAgentAdapterInitialization(',
    );
    expect(BOOTSTRAP_BODY).not.toContain('await agentAdapter.initialize()');
  });

  it('still awaits the settings migration and the workspace restore', () => {
    // The renderer reads `workspaceRoot` from `get-startup-config` as soon as
    // it loads, and that value comes from the restored folder. Deferring these
    // two would open a window pointed at no workspace.
    expect(BOOTSTRAP_BODY).toContain('await migrationRunner.runMigrations()');
    expect(BOOTSTRAP_BODY).toContain('await restoreWorkspaces(');
  });

  it('still returns startupWorkspaceRoot', () => {
    expect(BOOTSTRAP_BODY).toContain('startupWorkspaceRoot,');
  });
});

describe('startMembershipVerification', () => {
  it('resolves normally when the licence service answers', async () => {
    const verifyLicense = jest
      .fn()
      .mockResolvedValue({ valid: true, tier: 'builders' });
    const container = makeContainer([
      [TOKENS.LICENSE_SERVICE, { verifyLicense }],
    ]);

    await expect(
      startMembershipVerification(container),
    ).resolves.toBeUndefined();
    expect(verifyLicense).toHaveBeenCalledTimes(1);
  });

  it('does not reject when the network call fails', async () => {
    const container = makeContainer([
      [
        TOKENS.LICENSE_SERVICE,
        { verifyLicense: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) },
      ],
    ]);

    await expect(
      startMembershipVerification(container),
    ).resolves.toBeUndefined();
  });

  it('does not reject when the licence service is not registered', async () => {
    await expect(
      startMembershipVerification(makeContainer([])),
    ).resolves.toBeUndefined();
  });

  it('stays pending while the network hangs, without blocking its caller', async () => {
    // The shape the boot relies on: the helper is `void`-ed, so a hung request
    // costs the boot nothing. Asserting the caller is unblocked means asserting
    // that work AFTER the call runs while this promise is still pending.
    let resolveVerify!: (v: { valid: boolean }) => void;
    const container = makeContainer([
      [
        TOKENS.LICENSE_SERVICE,
        {
          verifyLicense: jest.fn(
            () =>
              new Promise((resolve) => {
                resolveVerify = resolve;
              }),
          ),
        },
      ],
    ]);

    let settled = false;
    const pending = startMembershipVerification(container).then(() => {
      settled = true;
    });

    // Stand in for the rest of the boot: several microtask turns.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveVerify({ valid: false });
    await pending;
    expect(settled).toBe(true);
  });
});

describe('startAgentAdapterInitialization', () => {
  it('preloads the SDK when auth initialized', async () => {
    const preloadSdk = jest.fn().mockResolvedValue(undefined);
    const container = makeContainer([
      [
        TOKENS.AGENT_ADAPTER,
        { initialize: jest.fn().mockResolvedValue(true), preloadSdk },
      ],
    ]);

    await startAgentAdapterInitialization(container);

    expect(preloadSdk).toHaveBeenCalledTimes(1);
  });

  it('does not preload the SDK when auth is not configured', async () => {
    const preloadSdk = jest.fn().mockResolvedValue(undefined);
    const container = makeContainer([
      [
        TOKENS.AGENT_ADAPTER,
        { initialize: jest.fn().mockResolvedValue(false), preloadSdk },
      ],
    ]);

    await startAgentAdapterInitialization(container);

    expect(preloadSdk).not.toHaveBeenCalled();
  });

  it('does not reject when initialize throws — the pre-existing non-fatal path', async () => {
    const container = makeContainer([
      [
        TOKENS.AGENT_ADAPTER,
        {
          initialize: jest.fn().mockRejectedValue(new Error('no credentials')),
          preloadSdk: jest.fn(),
        },
      ],
    ]);

    await expect(
      startAgentAdapterInitialization(container),
    ).resolves.toBeUndefined();
  });

  it('does not reject when the SDK preload fails after a successful init', async () => {
    const container = makeContainer([
      [
        TOKENS.AGENT_ADAPTER,
        {
          initialize: jest.fn().mockResolvedValue(true),
          preloadSdk: jest.fn().mockRejectedValue(new Error('preload failed')),
        },
      ],
    ]);

    await expect(
      startAgentAdapterInitialization(container),
    ).resolves.toBeUndefined();
    // Let the detached preload rejection settle inside its own `.catch`.
    await Promise.resolve();
  });
});
