import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import {
  killProcessTree,
  type IProcessSpawner,
  type SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type {
  GitPrChecksSummary,
  GitPrInfo,
  GitPrReviewDecision,
  GitPrState,
  GitPrStatusResult,
  GitPrUnavailableReason,
} from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import { assertSafeRef } from './git-ref-guard';
import type { GitWriteRunner } from './git-write-lock';

export const DEFAULT_GH_PR_TIMEOUT_MS = 15_000;
export const DEFAULT_GH_PR_CACHE_TTL_MS = 60_000;

export const GH_PR_LIST_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'state',
  'isDraft',
  'statusCheckRollup',
  'reviewDecision',
  'headRefName',
  'headRepositoryOwner',
].join(',');

/**
 * PRs fetched for one head branch name. Several can share it (a fork's PR
 * from its own `main`, an older closed PR); the reader picks the one whose
 * head repository is this branch's push remote.
 */
export const GH_PR_LIST_LIMIT = 10;

/** Most `gh` stdout read; past it the process is killed → `failed`. */
export const GH_STDOUT_MAX_BYTES = 8 * 1024 * 1024;

/** Most `gh` stderr kept for classifying a failure; the rest is dropped. */
export const GH_STDERR_MAX_BYTES = 64 * 1024;

export const GH_NON_INTERACTIVE_ENV: NodeJS.ProcessEnv = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  NO_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
  GH_PAGER: 'cat',
};

/** Remote assumed to hold the branch when git names no push remote. */
const DEFAULT_PUSH_REMOTE = 'origin';

const PR_STATES: ReadonlySet<string> = new Set<GitPrState>([
  'OPEN',
  'CLOSED',
  'MERGED',
]);

const REVIEW_DECISIONS: ReadonlySet<string> = new Set<GitPrReviewDecision>([
  'APPROVED',
  'CHANGES_REQUESTED',
  'REVIEW_REQUIRED',
]);

export interface GitHubPrStatusReaderDeps {
  readonly spawner?: IProcessSpawner;
  readonly logger?: Logger;
  /**
   * Read-only git runner, used to find the branch's push remote and its
   * owner. Without it only the head branch name is matched.
   */
  readonly exec?: GitWriteRunner;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: GitPrStatusResult;
}

/** How one `gh` run ended: its exit, or a reason it never produced one. */
type GhRun =
  | {
      readonly kind: 'exited';
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: GitPrUnavailableReason };

type GhHandle = SpawnedProcessHandle | ChildProcess;

/** `workspacePath` with `/` separators, no trailing slash, lower case. */
function repoKey(workspacePath: string): string {
  const slashed = workspacePath.replaceAll('\\', '/');
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === '/') end--;
  return slashed.slice(0, end).toLowerCase();
}

export function sanitizePrUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface RawCheckItem {
  readonly conclusion?: unknown;
  readonly status?: unknown;
  readonly state?: unknown;
}

interface RawPrPayload {
  readonly number?: unknown;
  readonly title?: unknown;
  readonly state?: unknown;
  readonly isDraft?: unknown;
  readonly reviewDecision?: unknown;
  readonly url?: unknown;
  readonly headRefName?: unknown;
  readonly headRepositoryOwner?: unknown;
  readonly statusCheckRollup?: unknown;
}

export function summarizeStatusCheckRollup(
  rollup: unknown,
): GitPrChecksSummary {
  if (!Array.isArray(rollup)) {
    return { passing: 0, failing: 0, pending: 0, total: 0 };
  }
  let passing = 0;
  let failing = 0;
  let pending = 0;

  for (const item of rollup) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as RawCheckItem;
    const conclusion =
      typeof raw.conclusion === 'string' ? raw.conclusion.toUpperCase() : '';
    const status =
      typeof raw.status === 'string' ? raw.status.toUpperCase() : '';
    const state = typeof raw.state === 'string' ? raw.state.toUpperCase() : '';

    if (
      conclusion === 'FAILURE' ||
      conclusion === 'TIMED_OUT' ||
      conclusion === 'ACTION_REQUIRED' ||
      conclusion === 'STARTUP_FAILURE' ||
      conclusion === 'CANCELLED' ||
      state === 'FAILURE' ||
      state === 'ERROR'
    ) {
      failing += 1;
    } else if (
      conclusion === 'SUCCESS' ||
      conclusion === 'NEUTRAL' ||
      conclusion === 'SKIPPED' ||
      state === 'SUCCESS'
    ) {
      passing += 1;
    } else if (
      status === 'IN_PROGRESS' ||
      status === 'QUEUED' ||
      status === 'PENDING' ||
      status === 'WAITING' ||
      state === 'PENDING' ||
      state === 'EXPECTED' ||
      (!conclusion && status !== 'COMPLETED')
    ) {
      pending += 1;
    }
  }

  return { passing, failing, pending, total: passing + failing + pending };
}

/** `gh`'s PR state, or `UNKNOWN` for anything this type does not know. */
export function normalizePrState(state: unknown): GitPrState {
  if (typeof state !== 'string') return 'UNKNOWN';
  const upper = state.toUpperCase();
  return PR_STATES.has(upper) ? (upper as GitPrState) : 'UNKNOWN';
}

/** `gh`'s review decision; `null` for none (`""`, `null`) or an unknown one. */
export function normalizeReviewDecision(
  decision: unknown,
): GitPrReviewDecision | null {
  if (typeof decision !== 'string') return null;
  const upper = decision.toUpperCase();
  return REVIEW_DECISIONS.has(upper) ? (upper as GitPrReviewDecision) : null;
}

/**
 * The owner (user or organisation) in a GitHub remote URL, lower-cased:
 * `https://host/owner/repo(.git)`, `ssh://git@host[:port]/owner/repo`,
 * `git@host:owner/repo`. Null for a local path or anything else.
 */
export function ownerFromRemoteUrl(url: string): string | null {
  const schemeAt = url.indexOf('://');
  let repoPath: string;
  if (schemeAt >= 0) {
    const afterScheme = url.slice(schemeAt + 3);
    const slash = afterScheme.indexOf('/');
    if (slash < 0) return null;
    repoPath = afterScheme.slice(slash + 1);
  } else {
    const colon = url.indexOf(':');
    if (colon < 0) return null;
    repoPath = url.slice(colon + 1);
  }
  const segments = repoPath.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return null;
  return segments[segments.length - 2].toLowerCase();
}

/** Push URL per remote name, from `git remote -v`. */
function parseRemotePushUrls(stdout: string): Map<string, string> {
  const pushSuffix = ' (push)';
  const urls = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const entry = line.trimEnd();
    const tab = entry.indexOf('\t');
    if (tab <= 0 || !entry.endsWith(pushSuffix)) continue;
    urls.set(
      entry.slice(0, tab),
      entry.slice(tab + 1, entry.length - pushSuffix.length),
    );
  }
  return urls;
}

/** The remote of `refs/remotes/<remote>/<branch>`, longest known name first. */
function remoteOfTrackingRef(
  ref: string,
  remotes: Iterable<string>,
): string | undefined {
  const prefix = 'refs/remotes/';
  if (!ref.startsWith(prefix)) return undefined;
  const rest = ref.slice(prefix.length);
  let best: string | undefined;
  for (const remote of remotes) {
    const fits = rest.startsWith(`${remote}/`);
    if (fits && (best === undefined || remote.length > best.length)) {
      best = remote;
    }
  }
  return best;
}

function ownerLogin(owner: unknown): string | null {
  if (!owner || typeof owner !== 'object') return null;
  const login = (owner as { login?: unknown }).login;
  return typeof login === 'string' ? login.toLowerCase() : null;
}

/**
 * True when `raw` is a PR from `branch` (exact head name) in `headOwner`'s
 * repository; with no known owner only the name has to match.
 */
function isPrForBranch(
  raw: RawPrPayload,
  branch: string,
  headOwner: string | null,
): boolean {
  if (raw.headRefName !== branch) return false;
  return (
    headOwner === null || ownerLogin(raw.headRepositoryOwner) === headOwner
  );
}

function toPrInfo(raw: RawPrPayload): GitPrInfo {
  const url = sanitizePrUrl(raw.url);
  return {
    number: typeof raw.number === 'number' ? raw.number : 0,
    title: typeof raw.title === 'string' ? raw.title : '',
    state: normalizePrState(raw.state),
    isDraft: Boolean(raw.isDraft),
    ...(raw.reviewDecision === undefined
      ? {}
      : { reviewDecision: normalizeReviewDecision(raw.reviewDecision) }),
    ...(url ? { url } : {}),
    ...(typeof raw.headRefName === 'string'
      ? { headRefName: raw.headRefName }
      : {}),
  };
}

/**
 * The PR status from `gh pr list --json` output: the open PR of `branch`
 * (else its newest one) in `headOwner`'s repository, or `no-pr`. Null when
 * the output is not a JSON array.
 */
export function selectBranchPr(
  stdout: string,
  branch: string,
  headOwner: string | null,
): GitPrStatusResult | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const matches = data.filter(
    (item): item is RawPrPayload =>
      Boolean(item) &&
      typeof item === 'object' &&
      isPrForBranch(item as RawPrPayload, branch, headOwner),
  );
  const chosen =
    matches.find((raw) => normalizePrState(raw.state) === 'OPEN') ?? matches[0];
  if (!chosen) return { status: 'unavailable', reason: 'no-pr' };
  return {
    status: 'ok',
    pr: toPrInfo(chosen),
    checks: summarizeStatusCheckRollup(chosen.statusCheckRollup),
  };
}

/** The quiet reason for a non-zero `gh` exit, from its stderr. */
export function classifyGhFailure(stderr: string): GitPrUnavailableReason {
  const lower = stderr.toLowerCase();
  if (lower.includes('gh auth login') || lower.includes('not logged in')) {
    return 'not-authenticated';
  }
  if (lower.includes('no pull requests found')) return 'no-pr';
  if (
    lower.includes('none of the git remotes') &&
    lower.includes('github host')
  ) {
    return 'not-github';
  }
  if (
    lower.includes('gh: command not found') ||
    lower.includes('is not recognized as an internal or external command')
  ) {
    return 'gh-missing';
  }
  return 'failed';
}

/** `gh-missing` for a spawn that found no `gh` binary, else `failed`. */
function spawnFailureReason(error: unknown): GitPrUnavailableReason {
  return isEnoent(error) ? 'gh-missing' : 'failed';
}

/** SIGTERM to `gh`, then the tree kill for anything it started. */
function stopGh(handle: GhHandle): void {
  try {
    handle.kill('SIGTERM');
  } catch {
    // degradation-audit: optional-capability - the process already exited.
  }
  void killTree(handle);
}

function isEnoent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 'ENOENT' ||
    (typeof message === 'string' && message.includes('ENOENT'))
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The pid of a spawned `gh`, waiting for an off-thread spawn to report it. */
async function processId(handle: GhHandle): Promise<number | undefined> {
  if (handle.pid) return handle.pid;
  if (!('whenSpawned' in handle)) return undefined;
  try {
    return (await handle.whenSpawned) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Kill `gh` and anything it started; a process already gone is fine. */
async function killTree(handle: GhHandle): Promise<void> {
  const pid = await processId(handle);
  if (pid === undefined) return;
  try {
    await killProcessTree(pid);
  } catch {
    // degradation-audit: optional-capability - the tree is already gone or
    // cannot be walked; `kill` was sent to `gh` itself first.
  }
}

/** Chunks of one output stream, up to `limit` bytes. */
class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private overflowed = false;

  constructor(private readonly limit: number) {}

  /**
   * Keep `chunk`. False exactly once: for the first chunk that would pass
   * the limit. That chunk and every later one are dropped.
   */
  push(chunk: Buffer | string): boolean {
    if (this.overflowed) return true;
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    if (this.bytes + data.length > this.limit) {
      this.overflowed = true;
      return false;
    }
    this.chunks.push(data);
    this.bytes += data.length;
    return true;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/**
 * The GitHub PR of a local branch, through `gh pr list --head <branch>`.
 *
 * - `--head` takes the value as a branch name only, so a branch called `123`
 *   is never read as PR #123. A result is accepted only when its
 *   `headRefName` equals the branch and, when the branch's push remote is a
 *   GitHub URL, its head repository owner is that remote's owner: a fork's PR
 *   from a branch of the same name is not this branch's PR (`no-pr`).
 * - Only `ok` and `no-pr` are cached, for {@link DEFAULT_GH_PR_CACHE_TTL_MS}.
 *   {@link invalidate} bumps a generation, so a read already running when it
 *   is called does not store its (pre-push) result. Concurrent reads of one
 *   branch share one `gh` run.
 */
export class GitHubPrStatusReader {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<GitPrStatusResult>>();
  /** Bumped by `invalidate()` without a root. */
  private globalGeneration = 0;
  /** Bumped per root by `invalidate(root)`. */
  private readonly rootGenerations = new Map<string, number>();

  constructor(private readonly deps: GitHubPrStatusReaderDeps = {}) {}

  async read(
    workspaceRoot: string,
    branch: string,
  ): Promise<GitPrStatusResult> {
    assertSafeRef(branch);

    const rootKey = repoKey(workspaceRoot);
    const cacheKey = `${rootKey}::${branch}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.result;
    return await (this.inFlight.get(cacheKey) ??
      this.startRead(workspaceRoot, branch, rootKey, cacheKey));
  }

  /** One `gh` read shared by every caller until it settles. */
  private startRead(
    workspaceRoot: string,
    branch: string,
    rootKey: string,
    cacheKey: string,
  ): Promise<GitPrStatusResult> {
    const generation = this.generationOf(rootKey);
    const run = this.fetchStatus(workspaceRoot, branch).then((result) => {
      if (this.inFlight.get(cacheKey) === run) this.inFlight.delete(cacheKey);
      if (isCacheable(result) && this.generationOf(rootKey) === generation) {
        const ttl = this.deps.cacheTtlMs ?? DEFAULT_GH_PR_CACHE_TTL_MS;
        this.cache.set(cacheKey, { expiresAt: this.now() + ttl, result });
      }
      return result;
    });
    this.inFlight.set(cacheKey, run);
    return run;
  }

  /**
   * Drop cached results so the next read asks `gh` again: every branch of
   * `workspaceRoot`, or the whole cache when it is omitted. A push changes
   * the checks GitHub reports, so a cached `ok` would show pre-push checks.
   * A read still running keeps its callers but does not cache its result.
   */
  invalidate(workspaceRoot?: string): void {
    if (workspaceRoot === undefined) {
      this.globalGeneration++;
      this.cache.clear();
      this.inFlight.clear();
      return;
    }
    const rootKey = repoKey(workspaceRoot);
    this.rootGenerations.set(
      rootKey,
      (this.rootGenerations.get(rootKey) ?? 0) + 1,
    );
    const prefix = `${rootKey}::`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    for (const key of this.inFlight.keys()) {
      if (key.startsWith(prefix)) this.inFlight.delete(key);
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private generationOf(rootKey: string): string {
    return `${this.globalGeneration}:${this.rootGenerations.get(rootKey) ?? 0}`;
  }

  private async fetchStatus(
    workspaceRoot: string,
    branch: string,
  ): Promise<GitPrStatusResult> {
    const args = [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      String(GH_PR_LIST_LIMIT),
      '--json',
      GH_PR_LIST_JSON_FIELDS,
    ];
    const [headOwner, run] = await Promise.all([
      this.resolveHeadOwner(workspaceRoot, branch),
      this.runGh(workspaceRoot, args),
    ]);
    if (run.kind === 'unavailable') {
      return { status: 'unavailable', reason: run.reason };
    }
    if (run.code !== 0) {
      this.deps.logger?.debug?.('[GitHubPrStatusReader] gh exit non-zero', {
        code: run.code,
        stderr: run.stderr.trim(),
      });
      return { status: 'unavailable', reason: classifyGhFailure(run.stderr) };
    }
    const result = selectBranchPr(run.stdout, branch, headOwner);
    if (result) return result;
    this.deps.logger?.debug?.(
      '[GitHubPrStatusReader] Malformed JSON from gh pr list',
      { stdoutBytes: Buffer.byteLength(run.stdout, 'utf8') },
    );
    return { status: 'unavailable', reason: 'failed' };
  }

  /**
   * Owner of the branch's push remote (`<branch>@{push}`, else `origin`),
   * lower-cased; null when git cannot say or the URL names no owner.
   */
  private async resolveHeadOwner(
    workspaceRoot: string,
    branch: string,
  ): Promise<string | null> {
    const exec = this.deps.exec;
    if (!exec) return null;
    try {
      // `branch` passed `assertSafeRef`: it cannot be read as an option.
      const [push, remotes] = await Promise.all([
        exec(
          ['rev-parse', '--symbolic-full-name', `${branch}@{push}`],
          workspaceRoot,
        ),
        exec(['remote', '-v'], workspaceRoot),
      ]);
      if (remotes.exitCode !== 0) return null;
      const urls = parseRemotePushUrls(remotes.stdout);
      const pushRemote =
        push.exitCode === 0
          ? remoteOfTrackingRef(push.stdout.trim(), urls.keys())
          : undefined;
      const url = urls.get(pushRemote ?? DEFAULT_PUSH_REMOTE);
      return url ? ownerFromRemoteUrl(url) : null;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without an owner only the
      // head branch name is matched.
      this.deps.logger?.debug?.(
        '[GitHubPrStatusReader] could not read the push remote',
        { error: errorText(error) },
      );
      return null;
    }
  }

  /** Spawn `gh`; the unavailable reason when it could not be started. */
  private trySpawnGh(
    cwd: string,
    args: string[],
  ): GhHandle | GitPrUnavailableReason {
    const env = { ...process.env, ...GH_NON_INTERACTIVE_ENV };
    try {
      if (this.deps.spawner) {
        return this.deps.spawner.spawnProcess({
          command: 'gh',
          args,
          cwd,
          env,
        });
      }
      return crossSpawn('gh', args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      this.deps.logger?.debug?.('[GitHubPrStatusReader] Failed to spawn gh', {
        error: errorText(error),
      });
      return spawnFailureReason(error);
    }
  }

  /** Run `gh` once under the timeout, with bounded output. */
  private runGh(cwd: string, args: string[]): Promise<GhRun> {
    const spawned = this.trySpawnGh(cwd, args);
    if (typeof spawned === 'string') {
      return Promise.resolve({ kind: 'unavailable', reason: spawned });
    }
    const handle = spawned;
    const logger = this.deps.logger;
    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_GH_PR_TIMEOUT_MS;
    return new Promise((resolve) => {
      let timedOut = false;
      const stdout = new BoundedOutput(GH_STDOUT_MAX_BYTES);
      const stderr = new BoundedOutput(GH_STDERR_MAX_BYTES);

      // Settles once: later calls find `settle` already replaced by a no-op.
      let settle = (run: GhRun): void => {
        settle = () => undefined;
        clearTimeout(timer);
        resolve(run);
      };
      const unavailable = (reason: GitPrUnavailableReason): void =>
        settle({ kind: 'unavailable', reason });

      const timer = setTimeout(() => {
        timedOut = true;
        logger?.debug?.('[GitHubPrStatusReader] gh timed out', {
          cwd,
          timeoutMs,
        });
        stopGh(handle);
        const forceTimer = setTimeout(() => unavailable('timeout'), 1000);
        forceTimer.unref?.();
      }, timeoutMs);
      timer.unref?.();

      handle.stdout?.on('data', (chunk: Buffer | string) => {
        if (stdout.push(chunk)) return;
        logger?.debug?.('[GitHubPrStatusReader] gh output too large', {
          limitBytes: GH_STDOUT_MAX_BYTES,
        });
        stopGh(handle);
        unavailable('failed');
      });
      handle.stderr?.on('data', (chunk: Buffer | string) => {
        stderr.push(chunk);
      });
      handle.on('error', (error: Error) => {
        logger?.debug?.('[GitHubPrStatusReader] Process error', {
          error: error.message,
        });
        unavailable(spawnFailureReason(error));
      });
      handle.on('close', (code: number | null) => {
        if (timedOut) return unavailable('timeout');
        settle({
          kind: 'exited',
          code,
          stdout: stdout.text(),
          stderr: stderr.text(),
        });
      });
    });
  }
}

function isCacheable(result: GitPrStatusResult): boolean {
  return (
    result.status === 'ok' ||
    (result.status === 'unavailable' && result.reason === 'no-pr')
  );
}
