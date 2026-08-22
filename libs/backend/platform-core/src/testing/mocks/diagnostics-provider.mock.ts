/**
 * `createMockDiagnosticsProvider` — `jest.Mocked<IDiagnosticsProvider>` backed
 * by an in-memory array of file-scoped diagnostic groups. Seedable via the
 * `diagnostics` override or the `__state` helpers.
 *
 * The mock is async + capability-aware: `getDiagnostics` returns a
 * `Promise<DiagnosticsResult>`. By default it returns an `available` result
 * seeded from the in-memory array; `setUnavailable(reason)` flips it to
 * `unavailable`.
 */

import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
} from '../../interfaces/diagnostics-provider.interface';

export interface MockDiagnosticsProviderState {
  readonly diagnostics: FileDiagnostics[];
  setDiagnostics(next: FileDiagnostics[]): void;
  setUnavailable(reason: string): void;
  setAvailable(): void;
}

export type MockDiagnosticsProvider = jest.Mocked<IDiagnosticsProvider> & {
  readonly __state: MockDiagnosticsProviderState;
};

export interface MockDiagnosticsProviderOverrides extends Partial<IDiagnosticsProvider> {
  diagnostics?: FileDiagnostics[];
  unavailableReason?: string;
}

export function createMockDiagnosticsProvider(
  overrides?: MockDiagnosticsProviderOverrides,
): MockDiagnosticsProvider {
  const diagnostics: FileDiagnostics[] = [...(overrides?.diagnostics ?? [])];
  let unavailableReason: string | undefined = overrides?.unavailableReason;

  const mock = {
    getDiagnostics: jest.fn((): Promise<DiagnosticsResult> => {
      if (unavailableReason !== undefined) {
        return Promise.resolve({
          status: 'unavailable' as const,
          source: 'mock',
          reason: unavailableReason,
        });
      }
      return Promise.resolve({
        status: 'available' as const,
        source: 'mock',
        diagnostics: diagnostics.map((d) => ({
          file: d.file,
          diagnostics: [...d.diagnostics],
        })),
      });
    }),
    __state: {
      diagnostics,
      setDiagnostics(next: FileDiagnostics[]): void {
        diagnostics.splice(0, diagnostics.length, ...next);
        unavailableReason = undefined;
      },
      setUnavailable(reason: string): void {
        unavailableReason = reason;
      },
      setAvailable(): void {
        unavailableReason = undefined;
      },
    },
  } as MockDiagnosticsProvider;

  if (overrides && typeof overrides.getDiagnostics === 'function') {
    mock.getDiagnostics = jest.fn(overrides.getDiagnostics);
  }

  return mock;
}
