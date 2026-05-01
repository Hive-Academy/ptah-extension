/**
 * `electron-diagnostics.spec.ts` — runs `runDiagnosticsProviderContract`
 * against `ElectronDiagnosticsProvider`. The Electron impl is intentionally
 * a stub (no live language server) so the contract's `seed` is a no-op and
 * all assertions target the "returns a valid empty array" invariants.
 */

import 'reflect-metadata';
import {
  runDiagnosticsProviderContract,
  type DiagnosticsProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { ElectronDiagnosticsProvider } from './electron-diagnostics-provider';

runDiagnosticsProviderContract('ElectronDiagnosticsProvider', () => {
  const provider = new ElectronDiagnosticsProvider();
  const setup: DiagnosticsProviderSetup = {
    provider,
    // Electron has no language-server surface to seed — the contract's
    // seed-then-read invariants are already guarded against empty returns.
  };
  return setup;
});

describe('ElectronDiagnosticsProvider — Electron-specific behaviour', () => {
  let provider: ElectronDiagnosticsProvider;

  beforeEach(() => {
    provider = new ElectronDiagnosticsProvider();
  });

  it('getDiagnostics returns an empty array (no language server available)', () => {
    expect(provider.getDiagnostics()).toEqual([]);
  });

  it('getDiagnostics is stable — repeat calls return equivalent results', () => {
    expect(provider.getDiagnostics()).toEqual(provider.getDiagnostics());
  });

  it('getDiagnostics never throws even when called many times', () => {
    for (let i = 0; i < 50; i++) {
      expect(() => provider.getDiagnostics()).not.toThrow();
    }
  });
});
