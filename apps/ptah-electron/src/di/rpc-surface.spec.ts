/**
 * RPC surface baseline — Electron desktop host (reference implementation).
 *
 * Electron serves the entire RPC registry, so its derived exclusion set is
 * empty. If this test ever fails, a capability was switched off on the
 * reference host — which is the one thing this refactor must never do.
 */

import 'reflect-metadata';

import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { deriveRpcSurface } from '@ptah-extension/rpc-handlers';

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

  it('excludes nothing', () => {
    expect([...surface.excluded]).toEqual([]);
  });

  it('serves every method in the RPC registry', () => {
    expect(surface.registered.length).toBe(RPC_METHOD_NAMES.length);
    expect([...surface.registered].sort()).toEqual(
      [...RPC_METHOD_NAMES].sort(),
    );
  });
});
