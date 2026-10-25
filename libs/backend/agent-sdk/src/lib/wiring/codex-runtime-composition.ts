import type { DependencyContainer } from 'tsyringe';
import { SDK_TOKENS } from '../di/tokens';
import { CodexRuntimeCompositionError } from './codex-runtime-composition-error';

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
    for (const token of tokens) {
      const value = container.resolve<unknown>(token);
      current.push(value);
      if (
        token === SDK_TOKENS.RUNTIME_ADMISSION_PORT &&
        value == null &&
        (current[0] != null || current[1] != null)
      ) {
        throw new CodexRuntimeCompositionError(
          'missing-admission-port',
          'RUNTIME_ADMISSION_PORT (RuntimeAdmissionPort)',
        );
      }
    }
    snapshot ??= current;
  };
}
