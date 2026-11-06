import 'reflect-metadata';
import {
  ELECTRON_CODEX_BOUND_TOKENS,
  EXPECTED_RUNTIME_TOKENS,
} from './expected-resolvable';
/**
 * RPC surface baseline — Electron desktop host (reference implementation).
 *
 * Electron serves the entire RPC registry, so its derived exclusion set is
 * empty. If a method is excluded, a capability was switched off.
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
    expect(surface.excluded).toEqual([]);
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

  it('serves the capability matrix read on every host that loads the manifest', () => {
    expect(surface.registered).toContain('agent:getCapabilityMatrix');
    expect(surface.excluded).not.toContain('agent:getCapabilityMatrix');
  });

  it('serves every method owned by the live manifest', () => {
    expect(surface.registered).toEqual(manifestMethods);
    expect(surface.registered.length + surface.excluded.length).toBe(
      manifestMethods.length,
    );
  });

  it('serves all fourteen review methods', () => {
    const methods =
      RPC_HANDLER_MANIFEST.find((entry) => entry.key === 'review')?.methods ??
      [];
    expect(methods).toHaveLength(14);
    expect(surface.registered).toEqual(expect.arrayContaining(methods));
    expect(surface.excluded).toEqual(expect.not.arrayContaining(methods));
  });

  it('serves git:watchRoots behind the gitRootWatch capability (TASK_2026_855 D20)', () => {
    expect(surface.registered).toContain('git:watchRoots');
    expect(surface.excluded).not.toContain('git:watchRoots');
  });

  it('serves the session handoff chain (TASK_2026_876)', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining(['session:handoffChain']),
    );
  });

  it('serves the backend-owned follow-up queue methods (TASK_2026_884)', () => {
    const queueMethods = [
      'chat:queued-list',
      'chat:queued-withdraw',
      'chat:queued-steer',
    ];
    expect(surface.registered).toEqual(expect.arrayContaining(queueMethods));
    for (const method of queueMethods) {
      expect(surface.excluded).not.toContain(method);
    }
  });

  it('serves artifact listing and external link opening', () => {
    expect(surface.registered).toEqual(
      expect.arrayContaining(['artifacts:list', 'artifacts:openLink']),
    );
  });

  it('serves file:viewBinary for the display panel (TASK_2026_879)', () => {
    expect(surface.registered).toContain('file:viewBinary');
    expect(surface.excluded).not.toContain('file:viewBinary');
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
    expect.arrayContaining([...ELECTRON_CODEX_BOUND_TOKENS.slice(1)]),
  );
  expect(new Set(ELECTRON_CODEX_BOUND_TOKENS).size).toBe(8);
});
