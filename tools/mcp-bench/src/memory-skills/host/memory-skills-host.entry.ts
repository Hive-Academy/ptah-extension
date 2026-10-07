/**
 * Memory-skills bench host script (TASK_2026_620, benchmark-design.md 6.1
 * R-X2). The runner starts it through 619's
 * `launchBenchHost({ hostScript: <dist>/memory-skills-host.mjs })`; the run
 * itself is `runMemorySkillsHost` in `memory-skills-host.ts`, and the engine
 * and MCP boot is 619's `bootCodeExecutionHost`.
 *
 * Wire contract (stdout is reserved for it; logs go to stderr). The ready and
 * fatal lines are the ones the launcher parses (`bench-host.entry.ts`):
 *   ready:    `{"benchHost":"ready","port":N,"workspaceRoot":"…","homedir":"…",
 *              "userDataPath":"…","dbPath":"…"}`
 *   complete: `{"benchHost":"complete","runId":"…","status":"complete"|"net-violation",
 *              "completionFile":"…"}` once every plan suite ran and the
 *              completion record is on disk
 *   fatal:    `{"benchHost":"fatal","error":"…"}`, then exit 1
 * Shutdown: stdin EOF, SIGTERM or SIGINT; exit 2 marks a forced exit after a
 * hung teardown. Usage: `node memory-skills-host.mjs --workspace <absolute dir>`
 * with `PTAH_BENCH_MEMORY_SKILLS_PLAN` set to the plan JSON.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { CliDIContainer } from '@ptah-extension/cli-engine';

import {
  BenchHostBootError,
  BenchIsolationError,
  assertIsolatedEnvironment,
  bootCodeExecutionHost,
} from '../../transport/bench-host-boot';
import { startNetRecorder } from '../runner/net-recorder';
import { SNAPSHOT_AUDIT_SUITES } from '../suites/audits/snapshot-audits.suite';
import { createDedupSuites } from '../suites/memory/dedup.suite';
import { createExtractionSuite } from '../suites/memory/extraction.suite';
import { createLivenessSuites } from '../suites/memory/liveness.suite';
import { resolveMergeUpdatePorts } from '../suites/memory/merge-update-ports';
import { READ_SIDE_SUITES } from '../suites/memory/read-side.suite';
import { hostRetentionPort } from '../suites/memory/retention-port';
import { createRetentionSuites } from '../suites/memory/retention.suite';
import { SCOPE_WRITE_SUITE } from '../suites/memory/scope-write.suite';
import { createUpdateSuites } from '../suites/memory/update.suite';
import { hostFunnelPorts } from '../suites/skills/funnel-host-port';
import { createFunnelSuites } from '../suites/skills/funnel.suite';
import { resolveJudgeServices } from '../suites/skills/judge-agreement-ports';
import { createJudgeAgreementSuites } from '../suites/skills/judge-agreement.suite';
import { NAMER_AND_TRIGGER_SUITES } from '../suites/skills/namer-and-trigger.suite';
import {
  runMemorySkillsHost,
  type MemorySkillsHostSuite,
} from './memory-skills-host';

/**
 * Suites this host runs in-process, by plan id. The memory and skills suites
 * of Batches 17-23 register here; a plan naming any other id is refused
 * before the engine boots.
 */
const HOST_SUITES: readonly MemorySkillsHostSuite[] = [
  createExtractionSuite(),
  ...createLivenessSuites(),
  ...createDedupSuites({ resolvePorts: resolveMergeUpdatePorts }),
  ...createUpdateSuites({ resolvePorts: resolveMergeUpdatePorts }),
  ...READ_SIDE_SUITES,
  SCOPE_WRITE_SUITE,
  ...NAMER_AND_TRIGGER_SUITES,
  // `placement: 'last'`: they age every row in the DB (`suite-placement.ts`).
  ...createRetentionSuites({ portOf: hostRetentionPort }),
  // Local only (R-M1a): they read a snapshot copy the plan seeds into the home.
  ...SNAPSHOT_AUDIT_SUITES,
  // Local only, `placement: 'last'`: they register one candidate row per
  // judged document.
  ...createJudgeAgreementSuites({ resolveServices: resolveJudgeServices }),
  // `placement: 'last'`: they write the skill tables and the skills dir and
  // run on a simulated clock.
  ...createFunnelSuites({ portsOf: hostFunnelPorts }),
];

const FORCED_EXIT_AFTER_MS = 20_000;

function writeWire(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(error: string): never {
  writeWire({ benchHost: 'fatal', error });
  process.exit(1);
}

class UsageError extends Error {}

function readWorkspaceArg(argv: readonly string[]): string {
  const index = argv.indexOf('--workspace');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || !isAbsolute(value)) {
    throw new UsageError(
      'usage: memory-skills-host --workspace <absolute directory>',
    );
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(value).isDirectory();
  } catch (error: unknown) {
    throw new UsageError(
      `workspace unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isDirectory) throw new UsageError(`not a directory: ${value}`);
  return resolve(value);
}

/** Resolves once on stdin EOF, SIGTERM or SIGINT. */
function shutdownRequested(): Promise<string> {
  return new Promise((done) => {
    process.stdin.once('end', () => done('stdin-eof'));
    process.stdin.once('close', () => done('stdin-eof'));
    process.once('SIGTERM', () => done('SIGTERM'));
    process.once('SIGINT', () => done('SIGINT'));
    process.stdin.resume();
  });
}

/** The fatal line: typed refusals keep their message; anything else its stack. */
function describeFailure(error: unknown): string {
  if (error instanceof BenchIsolationError || error instanceof UsageError) {
    return error.message;
  }
  if (error instanceof BenchHostBootError) {
    const cause: unknown = error.cause;
    if (cause instanceof Error && cause.stack) {
      process.stderr.write(`[memory-skills-host] ${cause.stack}\n`);
    }
    return error.message;
  }
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

async function main(): Promise<void> {
  const shutdown = shutdownRequested();
  // The engine teardown is awaited by the run; if it hangs, the process still
  // ends: exit 2 marks a forced exit.
  void shutdown.then(() => {
    setTimeout(() => process.exit(2), FORCED_EXIT_AFTER_MS).unref();
  });
  process.on('exit', () => {
    CliDIContainer.flushSync();
    CliDIContainer.disposeDiagnostics();
  });

  const { shutdownReason } = await runMemorySkillsHost({
    assertIsolated: () => assertIsolatedEnvironment(),
    readWorkspace: () => readWorkspaceArg(process.argv),
    env: process.env,
    boot: bootCodeExecutionHost,
    suites: HOST_SUITES,
    shutdownRequested: shutdown,
    startNetRecorder,
    writeWire,
    homedir,
  });
  process.stderr.write(`[memory-skills-host] stopped (${shutdownReason})\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => fail(describeFailure(error)),
);
