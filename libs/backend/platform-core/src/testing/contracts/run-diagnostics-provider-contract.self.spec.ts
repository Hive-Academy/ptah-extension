import 'reflect-metadata';
import { createMockDiagnosticsProvider } from '../mocks/diagnostics-provider.mock';
import { runDiagnosticsProviderContract } from './run-diagnostics-provider-contract';

runDiagnosticsProviderContract('createMockDiagnosticsProvider', () => {
  const provider = createMockDiagnosticsProvider();
  return {
    provider,
    seed(diagnostics): void {
      provider.__state.setDiagnostics(diagnostics);
    },
  };
});
