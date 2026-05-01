/**
 * `createMockDiagnosticsProvider` — `jest.Mocked<IDiagnosticsProvider>` backed
 * by an in-memory array of file-scoped diagnostic groups. Seedable via the
 * `diagnostics` override.
 */

import type { IDiagnosticsProvider } from '../../interfaces/diagnostics-provider.interface';

type FileDiagnostics = ReturnType<
  IDiagnosticsProvider['getDiagnostics']
>[number];

export interface MockDiagnosticsProviderState {
  readonly diagnostics: FileDiagnostics[];
  setDiagnostics(next: FileDiagnostics[]): void;
}

export type MockDiagnosticsProvider = jest.Mocked<IDiagnosticsProvider> & {
  readonly __state: MockDiagnosticsProviderState;
};

export interface MockDiagnosticsProviderOverrides extends Partial<IDiagnosticsProvider> {
  diagnostics?: FileDiagnostics[];
}

export function createMockDiagnosticsProvider(
  overrides?: MockDiagnosticsProviderOverrides,
): MockDiagnosticsProvider {
  const diagnostics: FileDiagnostics[] = [...(overrides?.diagnostics ?? [])];

  const mock = {
    getDiagnostics: jest.fn((): FileDiagnostics[] =>
      diagnostics.map((d) => ({
        file: d.file,
        diagnostics: [...d.diagnostics],
      })),
    ),
    __state: {
      diagnostics,
      setDiagnostics(next: FileDiagnostics[]): void {
        diagnostics.splice(0, diagnostics.length, ...next);
      },
    },
  } as MockDiagnosticsProvider;

  if (overrides && typeof overrides.getDiagnostics === 'function') {
    mock.getDiagnostics = jest.fn(overrides.getDiagnostics);
  }

  return mock;
}
