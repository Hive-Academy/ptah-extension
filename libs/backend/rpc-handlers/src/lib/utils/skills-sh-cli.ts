/**
 * skills.sh CLI process helpers.
 *
 * `runSkillsCli` is the one `npx skills …` spawn in the codebase.
 * `stageSkillsInstall` is the one INSTALL, and it deliberately never runs in a
 * directory anyone reads.
 *
 * WHY A STAGING DIRECTORY — the `skills` CLI offers no output-directory flag.
 * Its only redirection is `-g`, which moves the write from `{cwd}/.claude/skills`
 * to `~/.claude/skills`; both are places the harness reconciler either manages
 * (and would call `foreign`) or cannot see at all. What the CLI DOES do,
 * verified against `skills@latest` on 2026-08-18, is resolve every project-scope
 * path relative to `process.cwd()`:
 *
 *   - `npx skills add <src> --skill <id> --agent claude-code -y --copy` run in
 *     an empty directory produced exactly `{cwd}/.claude/skills/<slug>/**` plus
 *     `{cwd}/skills-lock.json`, and touched nothing under `$HOME`.
 *   - Omitting `--skill` installs every skill in the repo, one directory each
 *     (`vercel-labs/agent-skills` → 9 slugs).
 *   - `--agent claude-code` writes real files. `--agent '*'` instead makes
 *     `{cwd}/.agents/skills/<slug>` canonical and SYMLINKS `.claude/skills` at
 *     it, which would not survive being moved — hence the single agent plus an
 *     explicit `--copy`.
 *   - A bad source exits 1 and leaves the directory empty.
 *
 * So cwd IS the output-directory flag. Pointing it at a scratch directory gives
 * Ptah the bytes with no side effects, and the caller moves them into a source
 * root the reconciler already understands. The alternative — refetching from
 * `https://skills.sh/api` — was rejected: that API exposes only `/api/search`,
 * which returns metadata (`id`, `skillId`, `name`, `installs`, `source`) and no
 * file content, so it would have meant reimplementing the CLI's GitHub fetch,
 * ref resolution and security-advisory check against an unversioned surface.
 */

import crossSpawn from 'cross-spawn';

import { isSafePathToken, parseSourceSlug } from '@ptah-extension/shared';

import { SAFE_SKILL_ID_PATTERN } from '../handlers/skills-sh-rpc.schema';

/** Raw result of one `npx skills …` invocation. */
export interface SkillsCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Default timeout for a `skills add` run — the CLI fetches from GitHub. */
export const SKILLS_INSTALL_TIMEOUT_MS = 30000;

/**
 * Relative path the CLI writes project-scope skills to, as path segments.
 *
 * `--agent claude-code` is what puts them here. It is NOT an endorsement of
 * `.claude/skills` as a destination — this directory is inside a scratch tree
 * that is deleted before the call returns.
 */
export const STAGED_SKILLS_REL = ['.claude', 'skills'] as const;

/** Identity of the skills to install. */
export interface SkillInstallRequest {
  /** `owner/repo` slug. */
  source: string;
  /** Optional single skill within the repo. Absent installs all of them. */
  skillId?: string;
}

/**
 * Run `npx skills <args>`.
 *
 * Resolves with the captured streams and exit code. A timeout is reported as
 * exit code 124 after SIGTERM. Rejects only if the child process emits `error`
 * (binary missing, spawn refused).
 *
 * Routed through `cross-spawn` with NO `shell` option. `npx` is a `.cmd` shim on
 * Windows, which is why this used to pass `shell: true` — but `shell: true`
 * together with an args array is the `[DEP0190]` shape: cmd.exe receives the
 * arguments concatenated and unescaped, so `source`/`skillId` would only be
 * separated from the command line by the three validation layers above them.
 * `cross-spawn` runs the same `.cmd` shim through `cmd.exe /d /s /c` with every
 * argument escaped, so the args array stays an args array (TASK_2026_348).
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

    const child = crossSpawn('npx', ['skills', ...args], {
      cwd: cwd || undefined,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    // Optional chaining because `cross-spawn` is typed as returning a plain
    // `ChildProcess`; with the default `stdio: 'pipe'` both streams are always
    // present at runtime.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (data: string) => {
      stdout += data;
    });

    child.stderr?.on('data', (data: string) => {
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
 * Build the argv for a staged `npx skills add`.
 *
 * Every flag here is load-bearing; see the module header for what each was
 * measured to do. There is no `-g`: a staged install is never global, because
 * the whole point is that the bytes land where the caller puts them.
 */
export function buildSkillInstallArgs(request: SkillInstallRequest): string[] {
  const args = ['add', request.source];
  if (request.skillId !== undefined && request.skillId !== '') {
    args.push('--skill', request.skillId);
  }
  args.push('--agent', 'claude-code');
  args.push('--copy');
  args.push('-y');
  return args;
}

/**
 * Reject a request whose `source` or `skillId` cannot safely become a path
 * segment or a process argument. Returns the reason, or `null` when the request
 * is admissible.
 *
 * Both checks are STRICTER than the historical regexes and neither replaces
 * them. `SAFE_SOURCE_PATTERN` and `SAFE_SKILL_ID_PATTERN` both accept the
 * literal string `..`, which was harmless while these values only became CLI
 * arguments and is not harmless now that they also become directory names.
 * `isSafePathToken` is the shared rule that adds the `.`/`..` rejection, and it
 * is applied to the source's two halves by `parseSourceSlug`.
 */
export function rejectUnsafeInstallRequest(
  request: SkillInstallRequest,
): string | null {
  if (parseSourceSlug(request.source) === null) {
    return `Invalid source format: "${request.source}". Expected "owner/repo".`;
  }

  if (request.skillId !== undefined && request.skillId !== '') {
    if (
      !SAFE_SKILL_ID_PATTERN.test(request.skillId) ||
      !isSafePathToken(request.skillId)
    ) {
      return `Invalid skillId format: "${request.skillId}".`;
    }
  }

  return null;
}

/** Outcome of one staged install. */
export type StagedInstallResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Run the install with `cwd` set to `stagingDir`.
 *
 * The directory must already exist and should be empty — the caller owns its
 * creation and its deletion, because the caller is also the one that has to
 * move the result out of it.
 *
 * Returns a failure result for every expected problem (bad slug, non-zero exit)
 * and throws only when the CLI cannot be spawned at all, so callers keep their
 * own logging for the unexpected case.
 */
export async function stageSkillsInstall(
  request: SkillInstallRequest,
  stagingDir: string,
): Promise<StagedInstallResult> {
  const rejection = rejectUnsafeInstallRequest(request);
  if (rejection !== null) {
    return { success: false, error: rejection };
  }

  const result = await runSkillsCli(
    buildSkillInstallArgs(request),
    stagingDir,
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
