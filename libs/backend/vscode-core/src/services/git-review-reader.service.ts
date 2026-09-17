import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type {
  GitBlobRead,
  GitReadErrorCode,
  GitReviewChangesResult,
  GitReviewFile,
  GitReviewFileResult,
} from '@ptah-extension/shared';
import type { Logger } from '../logging';
import {
  execGit,
  execGitBuffer,
  type ExecGitBufferResult,
  type ExecGitOptions,
  type ExecGitResult,
} from '../utils/exec-git';

const BINARY_SNIFF_BYTES = 8000;
const DEFAULT_MAX_ISSUED_REVIEWS = 256;

type TextGitRunner = (
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
) => Promise<ExecGitResult>;
type BufferGitRunner = (
  args: string[],
  cwd: string,
  options?: ExecGitOptions,
) => Promise<ExecGitBufferResult>;

export interface ReviewFileRequest {
  baseSha: string;
  headSha: string;
  path: string;
  originalPath?: string;
}

interface CachedReview {
  result: GitReviewChangesResult;
  issued: Map<string, string>;
}

/** Read-only historical branch comparison and issued-file authorization. */
export class GitReviewReaderService {
  private readonly reviewCache = new Map<string, CachedReview>();
  private readonly issuedReviews = new Map<string, Map<string, string>>();

  constructor(
    private readonly logger: Logger,
    private readonly spawner?: IProcessSpawner,
    private readonly maxIssuedReviews = DEFAULT_MAX_ISSUED_REVIEWS,
    private readonly textGitRunner: TextGitRunner = execGit,
    private readonly bufferGitRunner: BufferGitRunner = execGitBuffer,
  ) {}

  invalidate(workspacePath?: string): void {
    if (!workspacePath) {
      this.reviewCache.clear();
      this.issuedReviews.clear();
      return;
    }
    const prefix = `${workspacePath}\0`;
    for (const key of [...this.reviewCache.keys()]) {
      if (key.startsWith(prefix)) this.reviewCache.delete(key);
    }
    for (const key of [...this.issuedReviews.keys()]) {
      if (key.startsWith(prefix)) this.issuedReviews.delete(key);
    }
  }

  async reviewChanges(
    workspacePath: string,
    baseName: string,
    headName: string,
  ): Promise<GitReviewChangesResult> {
    try {
      const baseSha = await this.resolveReviewRef(workspacePath, baseName);
      const headSha = await this.resolveReviewRef(workspacePath, headName);
      if (!baseSha || !headSha) {
        return this.reviewFailure('A review ref could not be resolved.');
      }

      // Plain `git merge-base A B` (without `--all`) prints one best ancestor.
      const mergeBase = await this.runGit(
        ['merge-base', baseSha, headSha],
        workspacePath,
      );
      const mergeBaseSha = mergeBase.stdout.trim();
      if (mergeBase.exitCode !== 0 || !this.isObjectSha(mergeBaseSha)) {
        return this.reviewFailure(
          'The selected refs do not share a merge base.',
        );
      }

      const reviewKey = `${workspacePath}\0${mergeBaseSha}\0${headSha}`;
      const cached = this.reviewCache.get(reviewKey);
      if (cached) {
        this.touch(this.reviewCache, reviewKey, cached);
        this.issue(reviewKey, cached.issued);
        return cached.result;
      }

      const [names, stats] = await Promise.all([
        this.runGit(
          [
            'diff',
            '--name-status',
            '-z',
            '--find-renames',
            '--find-copies',
            mergeBaseSha,
            headSha,
            '--',
          ],
          workspacePath,
        ),
        this.runGit(
          [
            'diff',
            '--numstat',
            '-z',
            '--find-renames',
            '--find-copies',
            mergeBaseSha,
            headSha,
            '--',
          ],
          workspacePath,
        ),
      ]);
      if (names.exitCode !== 0 || stats.exitCode !== 0) {
        return this.reviewFailure('The branch comparison could not be read.');
      }

      const namedFiles = this.parseReviewNames(names.stdout);
      const statMap = this.parseNumstat(stats.stdout);
      const matchedNumstatEntries = namedFiles.filter((file) =>
        statMap.has(file.path),
      ).length;
      if (namedFiles.length !== matchedNumstatEntries) {
        this.logger.warn(
          '[GitReviewReaderService] review parser count mismatch',
          {
            nameStatusCount: namedFiles.length,
            matchedNumstatCount: matchedNumstatEntries,
          },
        );
      }
      const files = namedFiles.map((file) => ({
        ...file,
        ...(statMap.get(file.path) ?? {
          additions: null,
          deletions: null,
          binary: true,
        }),
      }));
      const totals = files.reduce(
        (sum, file) => ({
          additions: sum.additions + (file.additions ?? 0),
          deletions: sum.deletions + (file.deletions ?? 0),
          binaryFiles: sum.binaryFiles + (file.binary ? 1 : 0),
        }),
        { additions: 0, deletions: 0, binaryFiles: 0 },
      );
      const issued = new Map<string, string>();
      for (const file of files) {
        issued.set(file.path, file.originalPath ?? file.path);
      }
      const result: GitReviewChangesResult = {
        success: true,
        base: { name: baseName, sha: baseSha },
        head: { name: headName, sha: headSha },
        mergeBaseSha,
        files,
        totals,
      };
      this.putBounded(this.reviewCache, reviewKey, { result, issued });
      this.issue(reviewKey, issued);
      return result;
    } catch (error: unknown) {
      this.logger.error(
        '[GitReviewReaderService] reviewChanges failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return this.reviewFailure('The branch comparison could not be read.');
    }
  }

  async reviewFile(
    workspacePath: string,
    request: ReviewFileRequest,
  ): Promise<GitReviewFileResult> {
    const originalPath = request.originalPath ?? request.path;
    const failure = (error: string): GitReviewFileResult => ({
      success: false,
      path: request.path,
      originalPath,
      baseSha: request.baseSha,
      headSha: request.headSha,
      original: { outcome: 'error', code: 'unknown', message: error },
      modified: { outcome: 'error', code: 'unknown', message: error },
      error,
    });
    try {
      this.validatePathSegment(request.path);
      this.validatePathSegment(originalPath);
      if (
        !this.isObjectSha(request.baseSha) ||
        !this.isObjectSha(request.headSha)
      ) {
        return failure('Invalid review identity.');
      }
      const reviewKey = `${workspacePath}\0${request.baseSha}\0${request.headSha}`;
      const issued = this.issuedReviews.get(reviewKey);
      if (!issued || issued.get(request.path) !== originalPath) {
        return failure('This file was not issued by the selected review.');
      }
      this.touch(this.issuedReviews, reviewKey, issued);
      const [original, modified] = await Promise.all([
        this.readBlob(workspacePath, request.baseSha, originalPath),
        this.readBlob(workspacePath, request.headSha, request.path),
      ]);
      return {
        success: true,
        path: request.path,
        originalPath,
        baseSha: request.baseSha,
        headSha: request.headSha,
        original,
        modified,
      };
    } catch (error: unknown) {
      this.logger.error(
        '[GitReviewReaderService] reviewFile failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return failure('This review file could not be read.');
    }
  }

  private issue(key: string, issued: Map<string, string>): void {
    this.putBounded(this.issuedReviews, key, issued);
  }

  private putBounded<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > this.maxIssuedReviews) {
      const oldest = map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  private touch<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key);
    map.set(key, value);
  }

  private reviewFailure(error: string): GitReviewChangesResult {
    return {
      success: false,
      files: [],
      totals: { additions: 0, deletions: 0, binaryFiles: 0 },
      error,
    };
  }

  private isObjectSha(value: string): boolean {
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
  }

  private async resolveReviewRef(
    workspacePath: string,
    ref: string,
  ): Promise<string | null> {
    const value = ref.trim();
    if (
      !value ||
      value.startsWith('-') ||
      value.length > 255 ||
      [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    ) {
      return null;
    }
    const result = await this.runGit(
      ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`],
      workspacePath,
    );
    const sha = result.stdout.trim();
    return result.exitCode === 0 && this.isObjectSha(sha) ? sha : null;
  }

  private parseNumstat(
    output: string,
  ): Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  > {
    const result = new Map<
      string,
      { additions: number | null; deletions: number | null; binary: boolean }
    >();
    const fields = output.split('\0');
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      if (!field) continue;
      const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(field);
      if (!match) continue;
      let filePath = match[3];
      if (!filePath) {
        index += 2;
        filePath = fields[index] ?? '';
      }
      if (!filePath) continue;
      const binary = match[1] === '-' || match[2] === '-';
      result.set(filePath, {
        additions: binary ? null : Number.parseInt(match[1], 10),
        deletions: binary ? null : Number.parseInt(match[2], 10),
        binary,
      });
    }
    return result;
  }

  private parseReviewNames(output: string): GitReviewFile[] {
    const fields = output.split('\0');
    const files: GitReviewFile[] = [];
    for (let index = 0; index < fields.length; ) {
      const statusField = fields[index++];
      if (!statusField) continue;
      const status = statusField[0] as GitReviewFile['status'];
      if (!['M', 'A', 'D', 'R', 'C'].includes(status)) continue;
      const firstPath = fields[index++] ?? '';
      if (!firstPath) continue;
      if (status === 'R' || status === 'C') {
        const filePath = fields[index++] ?? '';
        if (filePath) {
          files.push({
            path: filePath,
            originalPath: firstPath,
            status,
            additions: null,
            deletions: null,
            binary: false,
          });
        }
      } else {
        files.push({
          path: firstPath,
          status,
          additions: null,
          deletions: null,
          binary: false,
        });
      }
    }
    return files;
  }

  private validatePathSegment(filePath: string): void {
    if (!filePath || !filePath.trim()) {
      throw new Error('path must be a non-empty string');
    }
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new Error('Path traversal detected');
    }
  }

  private async readBlob(
    workspacePath: string,
    rev: string,
    relativePath: string,
  ): Promise<GitBlobRead> {
    this.validatePathSegment(relativePath);
    const spec = `${rev}:${relativePath}`;
    try {
      const show = await this.bufferGitRunner(
        ['show', spec],
        workspacePath,
        this.withSpawner(),
      );
      if (show.exitCode === 0) {
        if (show.stdout.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
          return { outcome: 'binary', byteLength: show.stdout.byteLength };
        }
        return { outcome: 'content', content: show.stdout.toString('utf8') };
      }
      const probe = await this.runGit(
        ['rev-parse', '--verify', '--quiet', spec],
        workspacePath,
      );
      if (probe.exitCode === 1) return { outcome: 'absent' };
      if (show.exitCode === 128 && probe.exitCode === 0) {
        return this.gitReadError('submodule', relativePath);
      }
      this.logger.error('[GitReviewReaderService] readBlob failed', {
        workspacePath,
        rev,
        relativePath,
        showExitCode: show.exitCode,
        revParseExitCode: probe.exitCode,
        stderr: show.stderr,
      });
      return this.gitReadError(
        await this.probeReadErrorCode(workspacePath),
        relativePath,
      );
    } catch (error: unknown) {
      this.logger.error(
        '[GitReviewReaderService] readBlob threw',
        error instanceof Error ? error : new Error(String(error)),
      );
      return this.gitReadError(this.classifyExecError(error), relativePath);
    }
  }

  private async probeReadErrorCode(
    workspacePath: string,
  ): Promise<GitReadErrorCode> {
    try {
      const repo = await this.runGit(
        ['rev-parse', '--is-inside-work-tree'],
        workspacePath,
      );
      if (repo.exitCode !== 0 || repo.stdout.trim() !== 'true') {
        return 'not-a-repo';
      }
      const head = await this.runGit(
        ['rev-parse', '--verify', '--quiet', 'HEAD'],
        workspacePath,
      );
      return head.exitCode === 0 ? 'unknown' : 'no-commits';
    } catch (error: unknown) {
      return this.classifyExecError(error);
    }
  }

  private classifyExecError(error: unknown): GitReadErrorCode {
    if (!(error instanceof Error)) return 'unknown';
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'git-missing';
    if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
    if (/timed out after \d+ms/.test(error.message)) return 'timeout';
    return 'unknown';
  }

  private gitReadError(
    code: GitReadErrorCode,
    relativePath: string,
  ): GitBlobRead {
    return {
      outcome: 'error',
      code,
      message: `Could not read "${relativePath}" from git (${code}).`,
    };
  }

  private runGit(args: string[], cwd: string): Promise<ExecGitResult> {
    return this.textGitRunner(args, cwd, this.withSpawner());
  }

  private withSpawner(): ExecGitOptions | undefined {
    return this.spawner ? { spawner: this.spawner } : undefined;
  }
}
