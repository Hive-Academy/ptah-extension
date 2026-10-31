import {
  LegacySessionControls,
  type LegacySessionLookup,
  type LegacySettingsPersistence,
  type LegacySlashCommands,
} from '../codex-app-server/legacy-session-controls';
import type { IModelResolver } from '../auth-env.port';
import type { SessionControl } from '../helpers/session-lifecycle/session-control.service';

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
