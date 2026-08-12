/**
 * skills.sh CLI process helpers.
 *
 * Extracted from `SkillsShRpcHandlers` so the marketplace RPC surface and
 * `HarnessSkillInstallService` drive the exact same `npx skills` invocation
 * instead of maintaining two copies of the spawn + argv + guard logic.
 *
 * EXTRACTION CONTRACT — `runSkillsCli` and `installSkillViaCli` keep the exact
 * behaviour the handler had before extraction:
 *   - `runSkillsCli` resolves (never rejects) on a non-zero exit or a timeout,
 *     and rejects only when the process fails to spawn at all.
 *   - `installSkillViaCli` validates `source`/`skillId` against the shared
 *     allowlists, refuses project scope without a workspace root, and returns
 *     the CLI's own stderr/stdout tail as the failure detail.
 */

import { spawn } from 'child_process';
import * as os from 'os';

import {
  SAFE_SKILL_ID_PATTERN,
  SAFE_SOURCE_PATTERN,
} from '../handlers/skills-sh-rpc.schema';

/** Raw result of one `npx skills …` invocation. */
export interface SkillsCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Default timeout for a `skills add` run — the CLI fetches from GitHub. */
export const SKILLS_INSTALL_TIMEOUT_MS = 30000;

/** Identity of one skill to install via the skills.sh CLI. */
export interface SkillInstallRequest {
  /** `owner/repo` slug. */
  source: string;
  /** Optional single skill within the repo. */
  skillId?: string;
  scope: 'project' | 'global';
}

/** Outcome of a single install attempt. */
export interface SkillInstallResult {
  success: boolean;
  error?: string;
}

/**
 * Run `npx skills <args>`.
 *
 * Resolves with the captured streams and exit code. A timeout is reported as
 * exit code 124 after SIGTERM, matching the previous inline helper. Rejects
 * only if the child process emits `error` (binary missing, spawn refused).
 */
export function runSkillsCli(
  args: string[],
  cwd: string,
  timeout = 15000,
): Promise<SkillsCliResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (result: SkillsCliResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const child = spawn('npx', ['skills', ...args], {
      shell: true,
      cwd: cwd || undefined,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (data: string) => {
      stdout += data;
    });

    child.stderr.on('data', (data: string) => {
      stderr += data;
    });

    child.on('close', (code: number | null) => {
      settle({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle({
        stdout,
        stderr: `CLI timed out after ${timeout}ms`,
        exitCode: 124,
      });
    }, timeout);
  });
}

/**
 * Build the argv for `npx skills add`.
 *
 * `--agent claude-code` lands the skill in `.claude/skills` (or `~/.claude/skills`
 * with `-g`), which Claude Code discovers natively.
 */
export function buildSkillInstallArgs(request: SkillInstallRequest): string[] {
  const args = ['add', request.source];
  if (request.skillId) {
    args.push('--skill', request.skillId);
  }
  args.push('--agent', 'claude-code');
  args.push('-y');
  if (request.scope === 'global') {
    args.push('-g');
  }
  return args;
}

/**
 * Install one skills.sh skill, applying the input guards before shelling out.
 *
 * Returns a failure result for every expected problem (bad slug, missing
 * workspace, non-zero exit). Throws only when the CLI cannot be spawned, so
 * callers keep their own logging for the unexpected case.
 */
export async function installSkillViaCli(
  request: SkillInstallRequest,
  workspaceRoot: string | undefined,
): Promise<SkillInstallResult> {
  if (!SAFE_SOURCE_PATTERN.test(request.source)) {
    return {
      success: false,
      error: `Invalid source format: "${request.source}". Expected "owner/repo".`,
    };
  }

  if (request.skillId && !SAFE_SKILL_ID_PATTERN.test(request.skillId)) {
    return {
      success: false,
      error: `Invalid skillId format: "${request.skillId}".`,
    };
  }

  if (!workspaceRoot && request.scope === 'project') {
    return {
      success: false,
      error: 'No workspace folder open for project-scope installation.',
    };
  }

  const result = await runSkillsCli(
    buildSkillInstallArgs(request),
    workspaceRoot || os.homedir(),
    SKILLS_INSTALL_TIMEOUT_MS,
  );

  if (result.exitCode !== 0) {
    const errorDetail =
      result.stderr.trim() ||
      result.stdout.trim().split('\n').pop() ||
      `CLI exited with code ${result.exitCode}`;
    return { success: false, error: errorDetail };
  }

  return { success: true };
}
