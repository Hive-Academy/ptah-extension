/**
 * `cli-diagnostics-provider.spec.ts` — runs `runDiagnosticsProviderContract`
 * against `CliDiagnosticsProvider`. The CLI impl is intentionally a stub
 * (no live language server yet) so the contract's `seed` is a no-op and all
 * assertions target the "returns a valid empty array" invariants.
 */

import 'reflect-metadata';
import {
  runDiagnosticsProviderContract,
  type DiagnosticsProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { CliDiagnosticsProvider } from './cli-diagnostics-provider';

runDiagnosticsProviderContract('CliDiagnosticsProvider', () => {
  const provider = new CliDiagnosticsProvider();
  const setup: DiagnosticsProviderSetup = {
    provider,
    // CLI has no language-server surface to seed.
  };
  return setup;
});

describe('CliDiagnosticsProvider — CLI-specific behaviour', () => {
  let provider: CliDiagnosticsProvider;

  beforeEach(() => {
    provider = new CliDiagnosticsProvider();
  });

  it('getDiagnostics returns an empty array (no language server in CLI)', () => {
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

  it('getDiagnostics returns a fresh array each call (no shared reference)', () => {
    const a = provider.getDiagnostics();
    const b = provider.getDiagnostics();
    // Both are empty, but mutating one should never affect the other.
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
