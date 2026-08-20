/**
 * `cli-diagnostics-provider.spec.ts` — runs `runDiagnosticsProviderContract`
 * against `CliDiagnosticsProvider`. The CLI Phase 0 impl returns an explicit
 * `unavailable` result (no live language server).
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
  };
  return setup;
});

describe('CliDiagnosticsProvider — CLI-specific behaviour', () => {
  let provider: CliDiagnosticsProvider;

  beforeEach(() => {
    provider = new CliDiagnosticsProvider();
  });

  it('getDiagnostics returns unavailable with source and reason', async () => {
    const result = await provider.getDiagnostics();
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.source).toBe('cli-phase0');
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('getDiagnostics is stable — repeat calls return equivalent results', async () => {
    const a = await provider.getDiagnostics();
    const b = await provider.getDiagnostics();
    expect(a).toEqual(b);
  });

  it('getDiagnostics never throws even when called many times', async () => {
    for (let i = 0; i < 50; i++) {
      await expect(provider.getDiagnostics()).resolves.not.toThrow();
    }
  });
});
