/**
 * Argv parsing for `bench-memory-skills`. Lives outside the entry module
 * because that module calls `main()` on load and cannot be imported by a spec.
 */

import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export interface RunMemorySkillsCliArgs {
  readonly planPath: string;
  readonly ci: boolean;
  readonly runId?: string;
  readonly workspace?: string;
  readonly hostScript?: string;
  readonly hostCompletionTimeoutMs?: number;
  readonly codexAuthSource?: string;
}

function absolute(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isAbsolute(value)) {
    throw new Error(`--${name} must be an absolute path, got ${value}`);
  }
  return resolve(value);
}

export function parseRunMemorySkillsArgs(
  argv: readonly string[],
): RunMemorySkillsCliArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      plan: { type: 'string' },
      ci: { type: 'boolean', default: false },
      'run-id': { type: 'string' },
      workspace: { type: 'string' },
      'host-script': { type: 'string' },
      'host-timeout-ms': { type: 'string' },
      'codex-auth-source': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const planPath = absolute('plan', values.plan);
  if (planPath === undefined) {
    throw new Error(
      'usage: bench-memory-skills --plan <absolute plan.json> [--ci]',
    );
  }
  const timeout = values['host-timeout-ms'];
  const hostCompletionTimeoutMs =
    timeout === undefined ? undefined : Number(timeout);
  if (
    hostCompletionTimeoutMs !== undefined &&
    !(Number.isInteger(hostCompletionTimeoutMs) && hostCompletionTimeoutMs > 0)
  ) {
    throw new Error(
      `--host-timeout-ms must be a positive integer, got ${timeout}`,
    );
  }

  return {
    planPath,
    ci: values.ci,
    runId: values['run-id'],
    workspace: absolute('workspace', values.workspace),
    hostScript: absolute('host-script', values['host-script']),
    hostCompletionTimeoutMs,
    codexAuthSource: absolute(
      'codex-auth-source',
      values['codex-auth-source'],
    ),
  };
}
