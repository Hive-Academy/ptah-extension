import 'reflect-metadata';
import {
  ELECTRON_CODEX_BOUND_TOKENS,
  EXPECTED_RUNTIME_TOKENS,
} from './expected-resolvable';
/**
 * RPC surface baseline — Electron desktop host (reference implementation).
 *
 * Electron serves the entire RPC registry, so its derived exclusion set is
 * empty. If this test ever fails, a capability was switched off on the
 * reference host — which is the one thing this refactor must never do.
 */

import {
  deriveRpcSurface,
  RPC_HANDLER_MANIFEST,
} from '@ptah-extension/rpc-handlers';

import { createElectronRpcHostProfile } from '../rpc-host-profile';

describe('Electron RPC surface', () => {
  const container = {
    isRegistered: jest.fn(() => false),
    resolve: jest.fn(),
  } as unknown as Parameters<typeof createElectronRpcHostProfile>[0];
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Parameters<typeof createElectronRpcHostProfile>[1];

  const surface = deriveRpcSurface(
    createElectronRpcHostProfile(container, logger),
  );
  const manifestMethods = RPC_HANDLER_MANIFEST.flatMap((entry) => [
    ...entry.methods,
  ]).sort();

  it('excludes nothing', () => {
    expect([...surface.excluded]).toEqual([]);
  });

  it('serves bound guidance and generation recovery methods', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'attention:getSnapshot',
        'enhancedPrompts:cancel',
        'enhancedPrompts:getRunState',
        'wizard:get-generation-run-state',
      ]),
    );
  });

  it('serves the community pack install plan (TASK_2026_701 B8)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'wizard:plan-pack-install',
        'wizard:install-pack-agents',
      ]),
    );
    expect(surface.excluded).not.toContain('wizard:plan-pack-install');
  });

  it('serves the plugin kept-item and config-home methods (TASK_2026_701 B12)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'plugins:replace-kept-items',
        'plugins:resolve-config-home',
      ]),
    );
    expect(surface.excluded).not.toContain('plugins:replace-kept-items');
    expect(surface.excluded).not.toContain('plugins:resolve-config-home');
  });

  it('serves every method owned by the live manifest', () => {
    expect(surface.registered).toEqual(manifestMethods);
    expect(surface.registered.length + surface.excluded.length).toBe(
      manifestMethods.length,
    );
  });

  it('serves git:watchRoots behind the gitRootWatch capability (TASK_2026_855 D20)', () => {
    expect(surface.registered).toContain('git:watchRoots');
    expect(surface.excluded).not.toContain('git:watchRoots');
  });

  it('serves artifact listing and external link opening', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining(['artifacts:list', 'artifacts:openLink']),
    );
  });

  it('serves the detached Display window methods (TASK_2026_853)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining([
        'displayWindow:open',
        'displayWindow:close',
        'displayWindow:status',
        'displayWindow:publishState',
        'displayWindow:getState',
        'displayWindow:action',
      ]),
    );
  });
});

it('includes the complete Electron runtime binding in the DI census', () => {
  expect(EXPECTED_RUNTIME_TOKENS).toEqual(
    expect.arrayContaining([...ELECTRON_CODEX_BOUND_TOKENS]),
  );
  expect(new Set(ELECTRON_CODEX_BOUND_TOKENS).size).toBe(6);
});
