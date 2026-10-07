/**
 * `nx run mcp-bench:bench-memory-skills -- --plan <abs> [--ci] [--run-id <id>]
 * [--workspace <abs>] [--host-script <abs>] [--host-timeout-ms <n>]`
 *
 * Composition root of the memory-skills runner (`run-memory-skills.ts`): it
 * resolves the bench data folder with 619's `resolveBenchDataDir()` here, in
 * the parent, and wires 619's `launchBenchHost` and the Batch 14 net
 * recorder. Offline suites register in `OFFLINE_SUITES`.
 *
 * stdout: one JSON line with the run summary. Exit code 1 when the run has a
 * problem (CI gate, missing host completion, early or killed host), the run
 * was refused, or the CI net recorder saw an outbound attempt.
 */

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { resolveBenchDataDir } from '../../bench-data';
import { launchBenchHost } from '../../transport/host-launcher';
import { createRubricAgreementSuite } from '../suites/skills/rubric-agreement.suite';
import { startNetRecorder } from './net-recorder';
import type { GitRunner } from './read-path-guard';
import type { MemorySkillsOfflineSuite } from './offline-suites';
import { runMemorySkills } from './run-memory-skills';
import { COMMITTED_FIXTURES_DIR } from './runner-plan';

/**
 * Model-free suites the parent runs inside the launcher window, by plan id.
 * The offline suites of Batches 17-23 register here.
 */
const OFFLINE_SUITES: readonly MemorySkillsOfflineSuite[] = [];

const GIT_TIMEOUT_MS = 30_000;

function absolute(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!isAbsolute(value)) {
    throw new Error(`--${name} must be an absolute path, got ${value}`);
  }
  return resolve(value);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      ci: { type: 'boolean', default: false },
      'run-id': { type: 'string' },
      workspace: { type: 'string' },
      'host-script': { type: 'string' },
      'host-timeout-ms': { type: 'string' },
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

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  }).trim();
  const git: GitRunner = (args) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    });

  const result = await runMemorySkills(
    {
      planPath,
      ci: values.ci,
      runId: values['run-id'],
      workspace: absolute('workspace', values.workspace),
      hostScript:
        absolute('host-script', values['host-script']) ??
        resolve(
          repoRoot,
          'dist',
          'tools',
          'mcp-bench',
          'memory-skills-host.mjs',
        ),
      repoRoot: resolve(repoRoot),
      benchDataDir: resolveBenchDataDir({ create: true }),
      realHome: homedir(),
      hostCompletionTimeoutMs,
    },
    {
      launch: launchBenchHost,
      startNetRecorder,
      git,
      offlineSuites: [
        ...OFFLINE_SUITES,
        createRubricAgreementSuite({
          fixturesDir: resolve(repoRoot, COMMITTED_FIXTURES_DIR),
        }),
      ],
    },
  );
  process.stdout.write(
    `${JSON.stringify({
      benchMemorySkills: result.exitCode === 0 ? 'ok' : 'failed',
      runId: result.runId,
      runDir: result.runDir,
      scorecard: result.scorecardPath,
      summary: result.summaryPath,
      hostExit: result.hostExit.kind,
      suites: result.suites.map(({ id, verdict, status }) => ({
        id,
        verdict,
        status,
      })),
      gate: result.gate,
      problems: result.problems,
    })}\n`,
  );
  return result.exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `[bench-memory-skills] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
