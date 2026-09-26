import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import type {
  DiagnosticsResult,
  DiagnosticsScope,
} from '../../interfaces/diagnostics-provider.interface';
import { createMockDiagnosticsProvider } from '../mocks/diagnostics-provider.mock';
import { runDiagnosticsProviderContract } from './run-diagnostics-provider-contract';

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
