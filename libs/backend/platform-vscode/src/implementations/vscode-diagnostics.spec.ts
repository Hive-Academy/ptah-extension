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

  it('narrows to the files named in the scope', async () => {
    __vscodeState.setDiagnostics([
      {
        file: '/tmp/edited.ts',
        diagnostics: [{ message: 'err', line: 0, severity: 'error' }],
      },
      {
        file: '/tmp/untouched.ts',
        diagnostics: [{ message: 'other', line: 0, severity: 'error' }],
      },
    ]);

    // The language servers hold the whole workspace already, so there is no
    // compile to avoid here and no reason to return past what was asked for.
    // This is the narrow end of the `DiagnosticsScope` contract; the compiling
    // provider takes the wide end.
    const provider = new VscodeDiagnosticsProvider('linux');
    const result = await provider.getDiagnostics(undefined, {
      files: ['/tmp/edited.ts'],
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics.map((d) => d.file)).toEqual(['/tmp/edited.ts']);
  });

  it('ignores an empty scope instead of reporting nothing', async () => {
    __vscodeState.setDiagnostics([
      {
        file: '/tmp/only.ts',
        diagnostics: [{ message: 'err', line: 0, severity: 'error' }],
      },
    ]);

    // `{ files: [] }` and "no scope" must behave alike. Reading an empty list
    // as "check nothing" turns a caller whose filter matched nothing into a
    // clean bill of health for the whole workspace.
    const provider = new VscodeDiagnosticsProvider('linux');
    const result = await provider.getDiagnostics(undefined, { files: [] });

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(1);
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

  /**
   * TASK_2026_303 finding 1. Pins the case rule of the root filter: fold on
   * win32, do not fold anywhere else.
   *
   * Read the pair together — the second case is what gives the first one
   * meaning. On its own, "casing mismatch is contained" would also pass an
   * implementation that folded case unconditionally, which would let
   * `/WS/ROOT` match an authorized `/ws/root` on a case-sensitive filesystem.
   *
   * Honest scope: this does NOT reproduce a defect in the pre-TASK_2026_303
   * code. That task was opened believing `path.relative` is case-sensitive on
   * win32; it is not (Node lower-cases both operands in `path.win32.relative`),
   * so the old form passed these cases too on a Windows host. What these
   * specs buy is a behavioural pin on the rule itself, held independently of
   * whichever implementation is behind it.
   *
   * `platform` is passed explicitly rather than read from `process.platform` so
   * the rule is pinned identically on the ubuntu CI runner and on a Windows dev
   * box. A `process.platform === 'win32'` guard would make it a no-op in CI.
   */
  it('keeps an in-root diagnostic that differs from the root only in casing (win32)', async () => {
    __vscodeState.setDiagnostics([
      {
        file: 'D:/Projects/Ptah/src/in-root.ts',
        diagnostics: [{ message: 'in-root error', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider('win32');
    const result = await provider.getDiagnostics('d:/projects/ptah');

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].file).toBe('D:/Projects/Ptah/src/in-root.ts');
  });

  it('still drops an out-of-root diagnostic when only the casing differs (linux)', async () => {
    // The win32 fold must not leak onto case-sensitive filesystems, where
    // `/WS/ROOT` and `/ws/root` are genuinely different directories.
    __vscodeState.setDiagnostics([
      {
        file: '/WS/ROOT/src/a.ts',
        diagnostics: [{ message: 'a', line: 0, severity: 'error' }],
      },
    ]);

    const provider = new VscodeDiagnosticsProvider('linux');
    const result = await provider.getDiagnostics('/ws/root');

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.diagnostics).toEqual([]);
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
