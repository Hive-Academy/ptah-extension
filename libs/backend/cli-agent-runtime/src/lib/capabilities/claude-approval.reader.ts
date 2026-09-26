/**
 * The user's own Claude Code approvals for a workspace's `.mcp.json` servers —
 * the only inputs the one-time capability import trusts (TASK_2026_560, C4).
 *
 * Two sources, both user-authored and neither writable by a cloned
 * repository:
 *
 * - `~/.claude.json` `projects[<physicalRoot>]` — what Claude Code records
 *   when the user answers its `.mcp.json` prompt. The key is matched with the
 *   same folding rule as `claude-user-mcp.reader.ts`: separators and trailing
 *   separators always collapse, case folds on win32 and darwin only, and every
 *   folded-matching entry is read (the file really does hold drive-letter case
 *   duplicates).
 * - `<root>/.claude/settings.local.json` — ONLY when git reports it untracked
 *   AND ignored. A tracked or unignored copy could have arrived with the
 *   repository, and a repository must not approve its own servers.
 *
 * ## Outcomes
 *
 * The reader never throws. `ok` means every source was either read or is
 * legitimately absent (a missing file, a folder that is not a git work tree,
 * a git that is not installed — in the last two the local settings file is
 * simply not trusted), and the caller publishes the import. `error` means a
 * source exists but could not be read, parsed or classified — including a git
 * that timed out or exited unexpectedly — and the caller publishes nothing and
 * retries on the next resolve.
 */

import { execFile, type ExecFileException } from 'child_process';
import { promises as fsPromises } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import which from 'which';
import type {
  CapabilityPolicyReason,
  ClaudeApprovalRecord,
} from '@ptah-extension/shared';

/** Upper bound on each git call; a hung git is a failure, not a verdict. */
export const CLAUDE_APPROVAL_GIT_TIMEOUT_MS = 2_000;

/** The local settings file, relative to the workspace root, in git's form. */
const SETTINGS_LOCAL_GIT_PATH = '.claude/settings.local.json';

/** Enough for `rev-parse` and a one-path `ls-files`; more is a misbehaving git. */
const GIT_MAX_BUFFER_BYTES = 64 * 1024;

/** What the reader returns. `approvals` is empty whenever `status` is `error`. */
export interface ClaudeApprovalReadResult {
  status: 'ok' | 'error';
  approvals: ClaudeApprovalRecord[];
  /** Why the read failed; empty when `ok`. */
  reasons: CapabilityPolicyReason[];
}

/**
 * How one git invocation ended.
 *
 * - `exited` — git ran and exited with `code`; a non-zero code is an answer
 *   (`check-ignore` exits 1 for "not ignored"), not a failure.
 * - `not-installed` — there is no git binary to ask.
 * - `failed` — git could not give an answer: timeout, signal, oversized
 *   output, or a spawn error other than a missing binary.
 */
export type GitRunResult =
  | { outcome: 'exited'; code: number; stdout: string }
  | { outcome: 'not-installed' }
  | { outcome: 'failed'; reason: string };

/** Runs `git -C <cwd> <args…>` — an argument array, never a shell string. */
export type GitRunner = (
  cwd: string,
  args: readonly string[],
) => Promise<GitRunResult>;

export interface ClaudeApprovalReaderOptions {
  /** Overridable so a spec never reads the developer's real `~/.claude.json`. */
  homeDir?: string;
  /** Whether to fold case when matching project keys. Defaults to win32/darwin. */
  caseInsensitive?: boolean;
  /** Overridable so a spec can simulate a hung or failing git. */
  runGit?: GitRunner;
}

/**
 * The default {@link GitRunner}: `execFile` with no shell and a timeout, on
 * the absolute git path resolved once (as `exec-git.ts` does), so the spawn
 * itself never searches `PATH`.
 */
export function createGitRunner(
  timeoutMs: number = CLAUDE_APPROVAL_GIT_TIMEOUT_MS,
): GitRunner {
  let gitBinary: string | null = null;
  return (cwd, args) => {
    gitBinary ??= which.sync('git', { nothrow: true });
    if (gitBinary === null) {
      return Promise.resolve<GitRunResult>({ outcome: 'not-installed' });
    }
    const binary = gitBinary;
    return new Promise<GitRunResult>((resolve) => {
      execFile(
        binary,
        ['-C', cwd, ...args],
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: GIT_MAX_BUFFER_BYTES,
          encoding: 'utf8',
        },
        (error, stdout) => {
          resolve(gitRunResult(error, stdout));
        },
      );
    });
  };
}

function gitRunResult(
  error: ExecFileException | null,
  stdout: string,
): GitRunResult {
  if (error === null) return { outcome: 'exited', code: 0, stdout };
  // `-C` carries the directory, so a spawn ENOENT can only mean the binary.
  if (error.code === 'ENOENT') return { outcome: 'not-installed' };
  if (error.killed === true || typeof error.signal === 'string') {
    return { outcome: 'failed', reason: 'git timed out' };
  }
  if (typeof error.code === 'number') {
    return { outcome: 'exited', code: error.code, stdout };
  }
  return {
    outcome: 'failed',
    reason: typeof error.code === 'string' ? `git ${error.code}` : 'git failed',
  };
}

/** Reads the trusted Claude approval sources for one workspace. */
export class ClaudeApprovalReader {
  private readonly homeDir: string;
  private readonly caseInsensitive: boolean;
  private readonly runGit: GitRunner;

  constructor(options: ClaudeApprovalReaderOptions = {}) {
    this.homeDir = options.homeDir ?? homedir();
    this.caseInsensitive =
      options.caseInsensitive ??
      (process.platform === 'win32' || process.platform === 'darwin');
    this.runGit = options.runGit ?? createGitRunner();
  }

  /**
   * The approvals recorded for `physicalRoot` (the `realpath.native` of the
   * workspace root). Never throws.
   */
  async read(physicalRoot: string): Promise<ClaudeApprovalReadResult> {
    try {
      const approvals: ClaudeApprovalRecord[] = [];
      const reasons: CapabilityPolicyReason[] = [];

      for (const source of [
        await this.readClaudeProject(physicalRoot),
        await this.readSettingsLocal(physicalRoot),
      ]) {
        if (source.status === 'error') reasons.push(source.reason);
        else if (source.status === 'ok') approvals.push(source.record);
      }

      if (reasons.length > 0) return { status: 'error', approvals: [], reasons };
      return { status: 'ok', approvals, reasons: [] };
    } catch (error: unknown) {
      // Every expected failure is already a reason; this is the "never
      // throws" backstop for an unexpected one, and it still fails closed.
      return {
        status: 'error',
        approvals: [],
        reasons: [
          {
            path: physicalRoot,
            error: error instanceof Error ? error.name : 'unexpected error',
          },
        ],
      };
    }
  }

  /** `~/.claude.json` `projects[<root>]`, every folded-matching entry merged. */
  private async readClaudeProject(physicalRoot: string): Promise<SourceRead> {
    const path = join(this.homeDir, '.claude.json');
    const file = await readJsonObjectFile(path);
    if (file.status !== 'ok') return file;

    const projects = file.value['projects'];
    if (projects === undefined) return { status: 'absent' };
    if (!isPlainObject(projects)) {
      return { status: 'error', reason: { path, error: 'invalid projects map' } };
    }

    const wanted = normalizeProjectPath(physicalRoot, this.caseInsensitive);
    const entries: Record<string, unknown>[] = [];
    for (const [key, value] of Object.entries(projects)) {
      if (normalizeProjectPath(key, this.caseInsensitive) !== wanted) continue;
      if (isPlainObject(value)) entries.push(value);
    }
    if (entries.length === 0) return { status: 'absent' };

    return {
      status: 'ok',
      record: mergeApprovals(path, 'claude-project', entries),
    };
  }

  /**
   * `.claude/settings.local.json`, only when git says it is untracked and
   * ignored. Git is asked only when the file exists.
   */
  private async readSettingsLocal(physicalRoot: string): Promise<SourceRead> {
    const path = join(physicalRoot, '.claude', 'settings.local.json');
    try {
      await fsPromises.lstat(path);
    } catch (error: unknown) {
      if (fsErrorCode(error) === 'ENOENT') return { status: 'absent' };
      return {
        status: 'error',
        reason: { path, error: fsErrorCode(error) ?? 'unreadable' },
      };
    }

    const trust = await this.gitTrustsSettingsLocal(physicalRoot);
    if (trust.status === 'error') {
      return { status: 'error', reason: { path, error: trust.error } };
    }
    if (!trust.trusted) return { status: 'absent' };

    const file = await readJsonObjectFile(path);
    if (file.status !== 'ok') return file;
    return {
      status: 'ok',
      record: mergeApprovals(path, 'settings-local', [file.value]),
    };
  }

  /**
   * Whether git reports the local settings file as untracked AND ignored.
   *
   * Not a git work tree (`rev-parse` exits 128) or no git at all → not
   * trusted, which is an answer. A timeout, a signal or an exit code git does
   * not use for these questions → `error`.
   */
  private async gitTrustsSettingsLocal(
    root: string,
  ): Promise<{ status: 'ok'; trusted: boolean } | { status: 'error'; error: string }> {
    const inside = await this.runGit(root, ['rev-parse', '--is-inside-work-tree']);
    if (inside.outcome === 'not-installed') return { status: 'ok', trusted: false };
    if (inside.outcome === 'failed') return { status: 'error', error: inside.reason };
    if (inside.code === 128) return { status: 'ok', trusted: false };
    if (inside.code !== 0) return unexpectedExit('rev-parse', inside.code);
    if (inside.stdout.trim() !== 'true') return { status: 'ok', trusted: false };

    const tracked = await this.runGit(root, [
      'ls-files',
      '-z',
      '--',
      SETTINGS_LOCAL_GIT_PATH,
    ]);
    if (tracked.outcome !== 'exited') return gitUnavailable(tracked);
    if (tracked.code !== 0) return unexpectedExit('ls-files', tracked.code);
    if (tracked.stdout.length > 0) return { status: 'ok', trusted: false };

    const ignored = await this.runGit(root, [
      'check-ignore',
      '-q',
      '--',
      SETTINGS_LOCAL_GIT_PATH,
    ]);
    if (ignored.outcome !== 'exited') return gitUnavailable(ignored);
    // `check-ignore` exits 0 for "ignored" and 1 for "not ignored".
    if (ignored.code === 0) return { status: 'ok', trusted: true };
    if (ignored.code === 1) return { status: 'ok', trusted: false };
    return unexpectedExit('check-ignore', ignored.code);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceRead =
  | { status: 'ok'; record: ClaudeApprovalRecord }
  | { status: 'absent' }
  | { status: 'error'; reason: CapabilityPolicyReason };

function unexpectedExit(
  command: string,
  code: number,
): { status: 'error'; error: string } {
  return { status: 'error', error: `git ${command} exited ${code}` };
}

/** git vanished or failed between two calls of the same read. */
function gitUnavailable(
  result: Exclude<GitRunResult, { outcome: 'exited' }>,
): { status: 'error'; error: string } {
  return {
    status: 'error',
    error: result.outcome === 'failed' ? result.reason : 'git not installed',
  };
}

/** A JSON object file: `absent` on ENOENT, `error` on anything else unusable. */
async function readJsonObjectFile(
  path: string,
): Promise<
  | { status: 'ok'; value: Record<string, unknown> }
  | { status: 'absent' }
  | { status: 'error'; reason: CapabilityPolicyReason }
> {
  let content: string;
  try {
    content = await fsPromises.readFile(path, 'utf-8');
  } catch (error: unknown) {
    if (fsErrorCode(error) === 'ENOENT') return { status: 'absent' };
    return {
      status: 'error',
      reason: { path, error: fsErrorCode(error) ?? 'unreadable' },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Reported to the caller as a reason; the import is not published.
    return { status: 'error', reason: { path, error: 'invalid JSON' } };
  }
  if (!isPlainObject(parsed)) {
    return { status: 'error', reason: { path, error: 'not a JSON object' } };
  }
  return { status: 'ok', value: parsed };
}

/**
 * One record from one file's matching objects. `enableAll` is true when any
 * says so; the name lists are unions. The import planner makes an OFF win
 * over an ON, so merging loses nothing.
 */
function mergeApprovals(
  path: string,
  kind: ClaudeApprovalRecord['kind'],
  objects: readonly Record<string, unknown>[],
): ClaudeApprovalRecord {
  const enabled = new Set<string>();
  const disabled = new Set<string>();
  let enableAll = false;
  for (const object of objects) {
    if (object['enableAllProjectMcpServers'] === true) enableAll = true;
    for (const name of stringArray(object['enabledMcpjsonServers'])) {
      enabled.add(name);
    }
    for (const name of stringArray(object['disabledMcpjsonServers'])) {
      disabled.add(name);
    }
  }
  return {
    path,
    kind,
    ...(enableAll ? { enableAllProjectMcpServers: true } : {}),
    ...(enabled.size > 0 ? { enabledMcpjsonServers: [...enabled] } : {}),
    ...(disabled.size > 0 ? { disabledMcpjsonServers: [...disabled] } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item !== '',
  );
}

/**
 * The key-folding rule of `claude-user-mcp.reader.ts`: separators and trailing
 * separators always collapse; case folds only where the filesystem does.
 */
function normalizeProjectPath(value: string, caseInsensitive: boolean): string {
  // Runs are collapsed first, so at most one trailing separator remains.
  const collapsed = value.replace(/[\\/]+/g, '/');
  const normalized = collapsed.endsWith('/')
    ? collapsed.slice(0, -1)
    : collapsed;
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fsErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
