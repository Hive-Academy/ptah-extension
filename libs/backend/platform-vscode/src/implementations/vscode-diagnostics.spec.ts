/**
 * `VscodeDiagnosticsProvider` — contract against `IDiagnosticsProvider`.
 *
 * The provider calls `vscode.languages.getDiagnostics()` which our mock
 * exposes as a seedable slot. The contract's `seed` hook primes that slot
 * with the platform-agnostic format and the provider converts VS Code
 * `DiagnosticSeverity` back into the union severity string.
 */

import 'reflect-metadata';
import { runDiagnosticsProviderContract } from '@ptah-extension/platform-core/testing';
import { VscodeDiagnosticsProvider } from './vscode-diagnostics-provider';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runDiagnosticsProviderContract('VscodeDiagnosticsProvider', () => {
  const provider = new VscodeDiagnosticsProvider();
  return {
    provider,
    seed(entries) {
      __vscodeState.setDiagnostics(entries);
    },
  };
});

describe('VscodeDiagnosticsProvider — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('maps vscode.DiagnosticSeverity enum to the severity union', () => {
    __vscodeState.setDiagnostics([
      {
        file: '/tmp/multi.ts',
        diagnostics: [
          { message: 'err', line: 0, severity: 'error' },
          { message: 'warn', line: 1, severity: 'warning' },
          { message: 'info', line: 2, severity: 'info' },
          { message: 'hint', line: 3, severity: 'hint' },
        ],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const [entry] = provider.getDiagnostics();
    expect(entry.diagnostics.map((d) => d.severity)).toEqual([
      'error',
      'warning',
      'info',
      'hint',
    ]);
  });

  it('skips files with an empty diagnostics array', () => {
    __vscodeState.setDiagnostics([
      { file: '/tmp/empty.ts', diagnostics: [] },
      {
        file: '/tmp/nonempty.ts',
        diagnostics: [{ message: 'x', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const result = provider.getDiagnostics();
    expect(result.map((r) => r.file)).toEqual(['/tmp/nonempty.ts']);
  });
});
