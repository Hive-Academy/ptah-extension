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

  it('maps vscode.DiagnosticSeverity enum to the severity union', async () => {
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
    const result = await provider.getDiagnostics();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      const [entry] = result.diagnostics;
      expect(entry.diagnostics.map((d) => d.severity)).toEqual([
        'error',
        'warning',
        'info',
        'hint',
      ]);
    }
  });

  it('skips files with an empty diagnostics array', async () => {
    __vscodeState.setDiagnostics([
      { file: '/tmp/empty.ts', diagnostics: [] },
      {
        file: '/tmp/nonempty.ts',
        diagnostics: [{ message: 'x', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.diagnostics.map((r) => r.file)).toEqual([
        '/tmp/nonempty.ts',
      ]);
    }
  });

  it('returns available with source vscode-languages', async () => {
    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.source).toBe('vscode-languages');
    }
  });

  it('returns available with empty diagnostics when nothing seeded', async () => {
    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('filters diagnostics to files within the requested workspaceRoot (TASK_2026_299 Task 4.2)', async () => {
    __vscodeState.setDiagnostics([
      {
        file: '/workspace/root/src/in-root.ts',
        diagnostics: [{ message: 'in-root error', line: 0, severity: 'error' }],
      },
      {
        file: '/workspace/other/out-of-root.ts',
        diagnostics: [
          { message: 'out-of-root error', line: 0, severity: 'error' },
        ],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics('/workspace/root');

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].file).toBe('/workspace/root/src/in-root.ts');
  });

  it('returns all diagnostics (unfiltered) when no workspaceRoot is given', async () => {
    __vscodeState.setDiagnostics([
      {
        file: '/workspace/root/src/a.ts',
        diagnostics: [{ message: 'a', line: 0, severity: 'error' }],
      },
      {
        file: '/workspace/other/b.ts',
        diagnostics: [{ message: 'b', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics();

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(2);
  });

  it('preserves zero-based line numbers (does not add 1)', async () => {
    __vscodeState.setDiagnostics([
      {
        file: '/tmp/lines.ts',
        diagnostics: [{ message: 'first line', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider();
    const result = await provider.getDiagnostics();

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics[0].diagnostics[0].line).toBe(0);
  });
});
