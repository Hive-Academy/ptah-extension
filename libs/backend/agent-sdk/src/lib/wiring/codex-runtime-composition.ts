import type { DependencyContainer } from 'tsyringe';
import {
  LegacySessionControls,
  type LegacySessionLookup,
  type LegacySettingsPersistence,
  type LegacySlashCommands,
} from '../codex-app-server/legacy-session-controls';
import type { IModelResolver } from '../auth-env.port';
import type { SessionControl } from '../helpers/session-lifecycle/session-control.service';
import { SDK_TOKENS } from '../di/tokens';

export interface LegacySessionControlPorts {
  sessions: LegacySessionLookup;
  persistence: LegacySettingsPersistence;
  modelResolver: Pick<IModelResolver, 'resolve'>;
  lifecycle: Pick<SessionControl, 'interruptCurrentTurn'>;
  slash: LegacySlashCommands;
}

export function createLegacySessionControls(
  ports: LegacySessionControlPorts,
): LegacySessionControls {
  return new LegacySessionControls(
    ports.sessions,
    ports.persistence,
    ports.modelResolver,
    ports.lifecycle,
    ports.slash,
  );
}

/** Guard cached adapters against late native activation in the same container. */
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
        throw new Error(
          'Runtime ports must be bound before resolving the agent adapter; use a fresh container for native activation',
        );
      }
    }),
  );
  return () => {
    const current = tokens.map((token) => container.resolve<unknown>(token));
    if (
      snapshot &&
      current.some((value, index) => value !== snapshot?.[index])
    ) {
      throw new Error(
        'Runtime ports must be bound before resolving the agent adapter; use a fresh container for native activation',
      );
    }
    snapshot ??= current;
  };
}
