import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import type {
  DiagnosticsResult,
  DiagnosticsScope,
} from '../../interfaces/diagnostics-provider.interface';
import { createMockDiagnosticsProvider } from '../mocks/diagnostics-provider.mock';
import { withCoverageVerdict } from '../../interfaces/language-coverage.interface';
import {
  runDiagnosticsProviderContract,
  syntaxOnlyClaimViolations,
} from './run-diagnostics-provider-contract';

runDiagnosticsProviderContract('createMockDiagnosticsProvider', () => {
  const provider = createMockDiagnosticsProvider();
  return {
    provider,
    seed(diagnostics): void {
      provider.__state.setDiagnostics(diagnostics);
    },
    makeUnavailable(reason: string): void {
      provider.__state.setUnavailable(reason);
    },
  };
});

/**
 * Drives the second-checkout case, which the seeded mock cannot: its answer
 * ignores the root. This stand-in reports one error on every scoped file that
 * exists on disk, at that file's own path, so a correct second checkout (a
 * plain copy here) must produce the same root-relative answer as the primary.
 */
runDiagnosticsProviderContract('root-aware fake (second checkout)', () => {
  const provider = createMockDiagnosticsProvider({
    getDiagnostics: async (
      _workspaceRoot?: string,
      scope?: DiagnosticsScope,
    ): Promise<DiagnosticsResult> => ({
      status: 'available',
      source: 'fake',
      diagnostics: (scope?.files ?? [])
        .filter((file) => fs.existsSync(file))
        .map((file) => ({
          file: path.resolve(file).replace(/\\/g, '/'),
          diagnostics: [{ message: 'fixture', line: 0, severity: 'error' }],
        })),
    }),
  });
  return {
    provider,
    createSecondCheckout(primaryRoot: string): string {
      const secondRoot = `${primaryRoot}-second`;
      fs.cpSync(primaryRoot, secondRoot, { recursive: true });
      return secondRoot;
    },
  };
});

/**
 * TASK_2026_559 Batch 25a: drives "syntax-only is not a type-check claim"
 * with a stand-in that syntax-checks `.py` files by name (a file called
 * `broken*` has one error), so the case itself is proven satisfiable.
 */
runDiagnosticsProviderContract('syntax-only fake', () => {
  const provider = createMockDiagnosticsProvider({
    getDiagnostics: async (
      _workspaceRoot?: string,
      scope?: DiagnosticsScope,
    ): Promise<DiagnosticsResult> => {
      const files = scope?.files ?? [];
      return {
        status: 'available',
        source: 'fake-syntax',
        coverage: withCoverageVerdict({
          supportedLanguages: ['python'],
          census: 'complete',
          analyzed: files.length,
          unchecked: 0,
          failed: 0,
          unsupported: 0,
          unrecognised: 0,
          nonSource: 0,
          excluded: 0,
          omittedByCap: 0,
          checks: 'syntax-only',
          approximations: ['python:syntax-only'],
        }),
        diagnostics: files
          .filter((file) => path.basename(file).startsWith('broken'))
          .map((file) => ({
            file: path.resolve(file).replace(/\\/g, '/'),
            diagnostics: [{ message: 'syntax', line: 0, severity: 'error' }],
          })),
      };
    },
  });
  return {
    provider,
    syntaxOnly: {
      language: 'python',
      extension: '.py',
      broken: 'def f(:\n',
      clean: 'def f():\n    return 1\n',
    },
  };
});

describe('syntaxOnlyClaimViolations', () => {
  const base = {
    supportedLanguages: ['python'] as const,
    census: 'complete' as const,
    analyzed: 1,
    unchecked: 0,
    failed: 0,
    unsupported: 0,
    unrecognised: 0,
    nonSource: 0,
    excluded: 0,
    omittedByCap: 0,
  };
  const answer = (
    coverage?: Parameters<typeof withCoverageVerdict>[0],
  ): DiagnosticsResult => ({
    status: 'available',
    source: 'x',
    ...(coverage === undefined
      ? {}
      : { coverage: withCoverageVerdict(coverage) }),
    diagnostics: [],
  });

  it('flags a syntax-only approximation under a type-check claim', () => {
    expect(
      syntaxOnlyClaimViolations(
        answer({
          ...base,
          checks: 'type-check',
          approximations: ['python:syntax-only'],
        }),
      ),
    ).toHaveLength(2);
  });

  it('flags a known syntax-only language answered without coverage', () => {
    expect(syntaxOnlyClaimViolations(answer(), 'python')).toEqual([
      'no coverage: nothing says python was only syntax-checked',
    ]);
  });

  it('flags a syntax-only language the approximations do not name', () => {
    expect(
      syntaxOnlyClaimViolations(
        answer({ ...base, checks: 'syntax-only' }),
        'python',
      ),
    ).toEqual(['approximations do not name python:syntax-only']);
  });

  it('accepts syntax-only and mixed answers that name the language', () => {
    for (const checks of ['syntax-only', 'mixed'] as const) {
      expect(
        syntaxOnlyClaimViolations(
          answer({ ...base, checks, approximations: ['python:syntax-only'] }),
          'python',
        ),
      ).toEqual([]);
    }
  });

  it('accepts an answer with no coverage when nothing is known to be syntax-only', () => {
    expect(syntaxOnlyClaimViolations(answer())).toEqual([]);
  });
});
