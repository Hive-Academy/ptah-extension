import { randomUUID } from 'node:crypto';

const HOST_RUN_ID = randomUUID();

/**
 * Identifies this host process for its whole lifetime. A persisted `running`
 * CLI reference stamped with another id, or with none, was left behind by an
 * earlier host run, so its process cannot be alive in this one.
 */
export function currentHostRunId(): string {
  return HOST_RUN_ID;
}
