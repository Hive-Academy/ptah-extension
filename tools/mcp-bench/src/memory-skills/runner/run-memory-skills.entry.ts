/**
 * `nx run mcp-bench:bench-memory-skills -- --plan <abs> [--ci] [--run-id <id>]
 * [--workspace <abs>] [--host-script <abs>] [--host-timeout-ms <n>]
 * [--codex-auth-source <abs>]`
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
import { resolve } from 'node:path';

import { resolveBenchDataDir } from '../../bench-data';
import { launchBenchHost } from '../../transport/host-launcher';
import { getGitExecutable } from '../../utils/git-executable';
import { createRubricAgreementSuite } from '../suites/skills/rubric-agreement.suite';
import { loadRubricPanelManifest } from '../suites/skills/rubric-panel-manifest';
import { startNetRecorder } from './net-recorder';
import type { GitRunner } from './read-path-guard';
import type { MemorySkillsOfflineSuite } from './offline-suites';
import { parseRunMemorySkillsArgs } from './run-memory-skills.args';
import { runMemorySkills } from './run-memory-skills';
import { COMMITTED_FIXTURES_DIR } from './runner-plan';

/**
 * Model-free suites the parent runs inside the launcher window, by plan id.
 * The offline suites of Batches 17-23 register here.
 */
const OFFLINE_SUITES: readonly MemorySkillsOfflineSuite[] = [];

const GIT_TIMEOUT_MS = 30_000;

async function main(): Promise<number> {
  const args = parseRunMemorySkillsArgs(process.argv.slice(2));
  const gitExecutable = getGitExecutable();

  const repoRoot = execFileSync(
    gitExecutable,
    ['rev-parse', '--show-toplevel'],
    {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
    },
  ).trim();
  const benchDataDir = resolveBenchDataDir({ create: true });
  const git: GitRunner = (args) =>
    execFileSync(gitExecutable, ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    });

  const result = await runMemorySkills(
    {
      planPath: args.planPath,
      ci: args.ci,
      runId: args.runId,
      workspace: args.workspace,
      hostScript:
        args.hostScript ??
        resolve(
          repoRoot,
          'dist',
          'tools',
          'mcp-bench',
          'memory-skills-host.mjs',
        ),
      repoRoot: resolve(repoRoot),
      benchDataDir,
      realHome: homedir(),
      hostCompletionTimeoutMs: args.hostCompletionTimeoutMs,
      codexAuthSource: args.codexAuthSource,
    },
    {
      launch: launchBenchHost,
      startNetRecorder,
      git,
      offlineSuites: [
        ...OFFLINE_SUITES,
        createRubricAgreementSuite({
          fixturesDir: resolve(repoRoot, COMMITTED_FIXTURES_DIR),
          panelManifest: loadRubricPanelManifest(benchDataDir),
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
