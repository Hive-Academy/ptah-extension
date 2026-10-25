import type { DependencyContainer } from 'tsyringe';
import type { RuntimeHostCapabilities } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { CodexRuntimeCompositionError } from './codex-runtime-composition-error';

// Record which provider actually ran, including inherited defaults. A host may
// bind the same value (or even the same object); neither makes it our default.
const defaultCapabilityResolutions = new WeakSet<DependencyContainer>();

export function registerDefaultRuntimeHostCapabilities(
  container: DependencyContainer,
): void {
  const capabilities: RuntimeHostCapabilities = { nativeCodex: false };
  container.register(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, {
    useFactory: (scope) => {
      defaultCapabilityResolutions.add(scope);
      return capabilities;
    },
  });
}

/** Guard cached adapters against late activation and unstable host factories. */
export function guardRuntimeComposition(
  container: DependencyContainer,
): () => void {
  const tokens = [
    SDK_TOKENS.SESSION_RUNTIME_IDENTITY_LOOKUP,
    SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
    SDK_TOKENS.RUNTIME_ADMISSION_PORT,
    SDK_TOKENS.RUNTIME_HOST_CAPABILITIES,
    SDK_TOKENS.CODEX_CHAT_ADAPTER,
  ];
  let snapshot: unknown[] | undefined;
  tokens.forEach((token, index) =>
    container.afterResolution(token, (_token, value) => {
      if (snapshot && value !== snapshot[index]) {
        throw new CodexRuntimeCompositionError(
          'unstable-binding',
          token.description,
        );
      }
    }),
  );
  return () => {
    const current: unknown[] = [];
    defaultCapabilityResolutions.delete(container);
    for (const token of tokens.slice(0, 4)) {
      const value = container.resolve<unknown>(token);
      current.push(value);
    }
    const bound = current.map((value, index) =>
      index === 3
        ? value != null && !defaultCapabilityResolutions.has(container)
        : value != null,
    );
    if (bound.some(Boolean) && !bound.every(Boolean)) {
      const names = [
        'SESSION_RUNTIME_IDENTITY_LOOKUP',
        'CODEX_CHAT_ADAPTER_PORTS',
        'RUNTIME_ADMISSION_PORT',
        'RUNTIME_HOST_CAPABILITIES',
      ];
      throw new CodexRuntimeCompositionError(
        'partial-native-binding',
        names.filter((_name, index) => !bound[index]).join(', '),
      );
    }
    current.push(container.resolve<unknown>(SDK_TOKENS.CODEX_CHAT_ADAPTER));
    snapshot ??= current;
  };
}
