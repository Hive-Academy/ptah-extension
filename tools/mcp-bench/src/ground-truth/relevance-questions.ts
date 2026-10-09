/**
 * Relevance ground truth for `ptah_relevance_rank_files`: merged pull
 * requests before the corpus pin plus non-merge commits reachable from it,
 * each mapped to the eligible source files it changed (user decision,
 * 2026-10-07).
 *
 * A pull request or commit qualifies when it changes 1-8 eligible source
 * files (`isEligibleSourcePath`). Its other changed files (docs, specs,
 * `.md`, lockfiles, tests) are ignored; the truth is the eligible files
 * only, workspace-relative with forward slashes, sorted. Every truth file
 * must exist at the pin, and a PR's merge commit must be an ancestor of the
 * pin. Commits come from `git log <pin> --no-merges` and are reachable by
 * construction; a commit whose subject starts with `Merge`, whose SHA is
 * the merge commit of a kept PR, or whose truth files match a kept PR
 * exactly is dropped - the PR wins.
 *
 * Questions are ordered by date (PR `mergedAt`, commit committer date)
 * with ties broken by id. The most recent 200 are the held-out `test`
 * split, the earlier ones `tune`; when fewer than 200 qualify the most
 * recent half is `test` and the split is reported as a deviation so the
 * caller can surface it.
 *
 * The `gh` calls live in `fetchMergedPullRequests` (paged GraphQL, 25 PRs
 * per page, each page attempted up to 3 times; PRs changing more than 100
 * files are skipped and counted, because one page cannot hold their file
 * list) and the `git log` call in `fetchCommitCandidates`. Both are
 * injectable, so the spec (and any caller) feeds the parsed data in and CI
 * never runs `gh`. `generateRelevanceQuestionFile` drives both fetches for
 * the orchestrator.
 */

import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { compareCodeUnits } from '../utils/compare-code-units';
import { getGhExecutable, getGitExecutable } from '../utils/git-executable';

/** File extensions eligible for corpus questions (mirrors corpus.config.json). */
export const ELIGIBLE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
];

const LOCKFILE_BASENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'bun.lockb',
]);

/** PR shape the generator consumes (mapped from one GraphQL page node). */
export const mergedPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().nullable(),
  files: z.array(z.object({ path: z.string().min(1) })),
  mergeCommit: z.object({ oid: z.string().min(1) }),
  mergedAt: z.string().min(1),
});
export type MergedPullRequest = z.infer<typeof mergedPullRequestSchema>;

/**
 * One non-merge commit reachable from the pin, parsed by
 * `fetchCommitCandidates` from `git log --name-only` output.
 */
export const commitCandidateSchema = z.object({
  sha: z.string().min(1),
  /** Commit subject (`%s`), the query for commit questions. */
  subject: z.string().min(1),
  /** Committer date (`%cI`), strict ISO 8601. */
  committedAt: z.string().min(1),
  /** Changed paths, one per `--name-only` line. */
  files: z.array(z.string()),
});
export type CommitCandidate = z.infer<typeof commitCandidateSchema>;

/** Repository facts the filter needs, injectable so the spec needs no git. */
export interface RelevanceGitDeps {
  /** True when the merge commit is an ancestor of the corpus pin. */
  readonly isAncestor: (mergeCommitSha: string) => boolean;
  /** True when the file exists at the corpus pin. */
  readonly fileExistsAtPin: (path: string) => boolean;
}

/** `RelevanceGitDeps` backed by real `git` calls against `repoRoot`. */
export function gitRelevanceDeps(
  repoRoot: string,
  corpusCommit: string,
): RelevanceGitDeps {
  return {
    isAncestor: (mergeCommitSha: string): boolean => {
      try {
        execFileSync(
          getGitExecutable(),
          [
            '-C',
            repoRoot,
            'merge-base',
            '--is-ancestor',
            mergeCommitSha,
            corpusCommit,
          ],
          { stdio: 'ignore' },
        );
        return true;
      } catch (error) {
        if (exitCode(error) === 1) return false;
        throw error;
      }
    },
    // `cat-file -e` exits 128 for a missing path and for a real failure alike;
    // `ls-tree` exits 0 for a missing path (empty output) and fails only on a
    // real error (bad commit, broken repository), which then propagates.
    // `-z` gives NUL-separated, unquoted names (core.quotePath would quote
    // non-ASCII paths in the default output).
    fileExistsAtPin: (path: string): boolean =>
      execFileSync(
        getGitExecutable(),
        [
          '-C',
          repoRoot,
          'ls-tree',
          '-z',
          '--name-only',
          corpusCommit,
          '--',
          path,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
        .split('\0')
        .some((name) => name === path),
  };
}

function exitCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined;
}

/** Merged PRs fetched per GraphQL page. */
const PR_PAGE_SIZE = 25;
/** Changed files read per PR; one GraphQL page holds at most 100. */
const PR_FILES_PAGE_SIZE = 100;
/**
 * Attempts per GraphQL page before the fetch gives up. The single-shot
 * `gh pr list --limit 1000` call this replaces died on HTTP 502 and
 * truncated JSON, so a failed attempt (exec error or unparseable output)
 * is retried.
 */
const MAX_PAGE_ATTEMPTS = 3;

/** `gh api graphql` response shape for one page of merged pull requests. */
const pullRequestPageSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequests: z.object({
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
          nodes: z.array(
            z
              .object({
                number: z.number(),
                title: z.string(),
                body: z.string().nullable(),
                mergedAt: z.string().nullable(),
                mergeCommit: z.object({ oid: z.string() }).nullable(),
                files: z.object({
                  totalCount: z.number().int().nonnegative(),
                  nodes: z.array(z.object({ path: z.string() })).nullable(),
                }),
              })
              .nullable(),
          ),
        }),
      })
      .nullable(),
  }),
});

type PullRequestPage = z.infer<typeof pullRequestPageSchema>;

/**
 * The page query. The first page has no cursor and omits `after`
 * altogether; every following page passes `after: $cursor` with the
 * previous `endCursor` as the `cursor` form field.
 */
function pullRequestPageQuery(
  owner: string,
  name: string,
  withCursor: boolean,
): string {
  const variables = withCursor ? '($cursor: String!)' : '';
  const after = withCursor ? ', after: $cursor' : '';
  return `query${variables} {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequests(states: MERGED, first: ${PR_PAGE_SIZE}${after}, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        body
        mergedAt
        mergeCommit { oid }
        files(first: ${PR_FILES_PAGE_SIZE}) { totalCount nodes { path } }
      }
    }
  }
}`;
}

/** Owner and repository name for the GraphQL query, from `gh repo view`. */
function resolveRepository(repoRoot: string): {
  owner: string;
  name: string;
} {
  const stdout = execFileSync(
    getGhExecutable(),
    ['repo', 'view', '--json', 'nameWithOwner'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const { nameWithOwner } = z
    .object({ nameWithOwner: z.string().min(3) })
    .parse(JSON.parse(stdout));
  const separator = nameWithOwner.indexOf('/');
  if (separator < 1 || separator === nameWithOwner.length - 1) {
    throw new Error(`unexpected repository name from gh: ${nameWithOwner}`);
  }
  return {
    owner: nameWithOwner.slice(0, separator),
    name: nameWithOwner.slice(separator + 1),
  };
}

/** Runs one GraphQL page, attempted up to `MAX_PAGE_ATTEMPTS` times. */
function fetchPullRequestPage(
  repoRoot: string,
  query: string,
  cursor: string | undefined,
): PullRequestPage {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const args = ['api', 'graphql', '-f', `query=${query}`];
      if (cursor !== undefined) {
        args.push('-f', `cursor=${cursor}`);
      }
      const stdout = execFileSync(getGhExecutable(), args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      // JSON.parse throws on the truncated stdout that killed the
      // single-shot fetch; that counts as a failed attempt.
      return pullRequestPageSchema.parse(JSON.parse(stdout));
    } catch (error) {
      if (attempt >= MAX_PAGE_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/** `fetchMergedPullRequests` result: the PRs plus the skipped count. */
export interface MergedPullRequestFetch {
  readonly prs: readonly MergedPullRequest[];
  /**
   * PRs skipped because they change more than 100 files: one page cannot
   * hold their file list, so they cannot be judged.
   */
  readonly skippedLargePrs: number;
}

/**
 * Runs the paged `gh api graphql` fetch for merged pull requests. CI never
 * calls this; the frozen JSON is committed instead.
 */
export function fetchMergedPullRequests(
  repoRoot: string,
): MergedPullRequestFetch {
  const { owner, name } = resolveRepository(repoRoot);
  const prs: MergedPullRequest[] = [];
  let skippedLargePrs = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = fetchPullRequestPage(
      repoRoot,
      pullRequestPageQuery(owner, name, cursor !== undefined),
      cursor,
    );
    const pullRequests = page.data.repository?.pullRequests;
    if (pullRequests === undefined) {
      throw new Error('gh api graphql returned no repository pull requests');
    }
    for (const node of pullRequests.nodes) {
      // GitHub emits a null node for an inaccessible PR.
      if (node === null) continue;
      // A merged PR always carries mergedAt and mergeCommit; anything else
      // fails the strict parse below.
      if (node.files.totalCount > PR_FILES_PAGE_SIZE) {
        skippedLargePrs += 1;
        continue;
      }
      prs.push(
        mergedPullRequestSchema.parse({
          number: node.number,
          title: node.title,
          body: node.body,
          files: (node.files.nodes ?? []).map((file) => ({
            path: file.path,
          })),
          mergeCommit: node.mergeCommit,
          mergedAt: node.mergedAt,
        }),
      );
    }
    if (
      !pullRequests.pageInfo.hasNextPage ||
      pullRequests.pageInfo.endCursor === null
    ) {
      return { prs, skippedLargePrs };
    }
    cursor = pullRequests.pageInfo.endCursor;
  }
}

/** `git log --format` separators; they cannot appear in a SHA, subject, date or path. */
const COMMIT_RECORD_SEPARATOR = '\x1e';
const COMMIT_FIELD_SEPARATOR = '\x1f';

/**
 * Runs `git log <pin> --no-merges --name-only` and parses one candidate per
 * commit reachable from the pin: SHA, subject, committer date and changed
 * paths, split on separators that cannot collide with the content. Injectable
 * like the PR fetch; CI never calls this.
 */
export function fetchCommitCandidates(
  repoRoot: string,
  corpusCommit: string,
): readonly CommitCandidate[] {
  const stdout = execFileSync(
    getGitExecutable(),
    [
      '-C',
      repoRoot,
      'log',
      corpusCommit,
      '--no-merges',
      `--format=%x1e%H%x1f%s%x1f%cI`,
      '--name-only',
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const candidates: CommitCandidate[] = [];
  for (const record of stdout.split(COMMIT_RECORD_SEPARATOR)) {
    const headerEnd = record.indexOf('\n');
    const header = headerEnd === -1 ? record : record.slice(0, headerEnd);
    const body = headerEnd === -1 ? '' : record.slice(headerEnd + 1);
    const [sha, subject, committedAt] = header.split(COMMIT_FIELD_SEPARATOR);
    if (!sha || !subject || !committedAt) {
      continue; // leading or stray separator noise, not a commit record
    }
    const files = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    candidates.push(
      commitCandidateSchema.parse({ sha, subject, committedAt, files }),
    );
  }
  return candidates;
}

/** True for an eligible source path: right extension, not a test, not a lockfile. */
export function isEligibleSourcePath(rawPath: string): boolean {
  const path = rawPath.replaceAll('\\', '/');
  if (path.length === 0 || path.startsWith('/')) return false;
  if (!ELIGIBLE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(path)) return false;
  const segments = path.split('/');
  if (
    segments.some(
      (segment) =>
        segment === '__tests__' || segment === 'test' || segment === 'tests',
    )
  ) {
    return false;
  }
  const base = segments[segments.length - 1] ?? '';
  if (LOCKFILE_BASENAMES.has(base) || base.endsWith('.lock')) return false;
  return true;
}

/**
 * Normalised truth for one PR or commit: the eligible source paths among its
 * changed files, forward slashes, deduplicated, sorted.
 */
function eligibleTruthFiles(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((path) => path.replaceAll('\\', '/')))]
    .filter(isEligibleSourcePath)
    .sort(compareCodeUnits);
}

/** True for 1-8 truth files, the qualifying size of a relevance question. */
function hasQualifyingFileCount(truthFiles: readonly string[]): boolean {
  return truthFiles.length >= 1 && truthFiles.length <= 8;
}

/**
 * A pull request or commit that passed the qualification rule, normalised
 * for the builder: an id, a query, a date to order by and the truth files.
 */
export interface RelevanceCandidate {
  /** `pr-<number>` or `commit-<12-char sha>`. */
  readonly id: string;
  readonly source: 'pr' | 'commit';
  /** PR title or commit subject. */
  readonly query: string;
  /** PR `mergedAt` or commit committer date, ISO 8601. */
  readonly date: string;
  readonly truthFiles: readonly string[];
  /**
   * The PR's merge commit SHA (the squash commit in a squash merge), null
   * for commits. Commits carrying this SHA are dropped; the PR wins.
   */
  readonly mergeCommitSha: string | null;
}

/**
 * Orders chronologically. ISO 8601 dates may carry different UTC offsets
 * (`%cI` keeps the committer's offset), so instants are compared rather
 * than strings; ties break by id. Unparseable dates fall back to string
 * order.
 */
function compareByDateThenId(
  a: RelevanceCandidate,
  b: RelevanceCandidate,
): number {
  const aMs = Date.parse(a.date);
  const bMs = Date.parse(b.date);
  if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && aMs !== bMs) {
    return aMs - bMs;
  }
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Keeps only pull requests that qualify as relevance questions. The PR's
 * non-eligible changed files are ignored; the truth is the eligible ones.
 * Returned in input order; the builder orders the merged set.
 */
export function filterRelevantPullRequests(
  prs: readonly MergedPullRequest[],
  deps: RelevanceGitDeps,
): readonly RelevanceCandidate[] {
  const kept: RelevanceCandidate[] = [];
  for (const pr of prs) {
    if (!deps.isAncestor(pr.mergeCommit.oid)) continue;
    const truthFiles = eligibleTruthFiles(pr.files.map((file) => file.path));
    if (!hasQualifyingFileCount(truthFiles)) continue;
    if (!truthFiles.every((path) => deps.fileExistsAtPin(path))) continue;
    kept.push({
      id: `pr-${pr.number}`,
      source: 'pr',
      query: pr.title,
      date: pr.mergedAt,
      truthFiles,
      mergeCommitSha: pr.mergeCommit.oid,
    });
  }
  return kept;
}

/**
 * Keeps only commits that qualify as relevance questions. Drops `Merge`
 * subjects, commits that are the merge commit of a kept PR, and commits
 * whose truth file set matches a kept PR exactly - the PR wins. Commits
 * come from `git log <pin>` and are ancestors of the pin by construction,
 * so only the file rule and the pin-existence check apply.
 */
export function filterRelevantCommits(
  commits: readonly CommitCandidate[],
  prCandidates: readonly RelevanceCandidate[],
  deps: RelevanceGitDeps,
): readonly RelevanceCandidate[] {
  const mergeCommitShas = new Set(
    prCandidates
      .map((candidate) => candidate.mergeCommitSha)
      .filter((sha): sha is string => sha !== null),
  );
  const prFileSets = new Set(
    prCandidates.map((candidate) => candidate.truthFiles.join('\n')),
  );
  const kept: RelevanceCandidate[] = [];
  for (const commit of commits) {
    if (commit.subject.startsWith('Merge')) continue;
    if (mergeCommitShas.has(commit.sha)) continue;
    const truthFiles = eligibleTruthFiles(commit.files);
    if (!hasQualifyingFileCount(truthFiles)) continue;
    if (!truthFiles.every((path) => deps.fileExistsAtPin(path))) continue;
    if (prFileSets.has(truthFiles.join('\n'))) continue;
    kept.push({
      id: `commit-${commit.sha.slice(0, 12)}`,
      source: 'commit',
      query: commit.subject,
      date: commit.committedAt,
      truthFiles,
      mergeCommitSha: null,
    });
  }
  return kept;
}

/** Kept questions split into the held-out `test` set and the `tune` set. */
export interface RelevanceSplit {
  readonly test: readonly RelevanceCandidate[];
  readonly tune: readonly RelevanceCandidate[];
  /** Non-null when fewer than 200 questions qualified and the half-split was used. */
  readonly deviation: string | null;
}

/** The held-out split size: the most recent 200 kept questions. */
export const RELEVANCE_TEST_SPLIT_SIZE = 200;

/**
 * Splits by date: the most recent 200 kept questions are `test`, the
 * earlier ones `tune`. With fewer than 200, the most recent half is `test`
 * and a deviation is reported.
 */
export function splitByDate(
  candidates: readonly RelevanceCandidate[],
): RelevanceSplit {
  const sorted = [...candidates].sort(compareByDateThenId);
  if (sorted.length < RELEVANCE_TEST_SPLIT_SIZE) {
    const testCount = Math.ceil(sorted.length / 2);
    return {
      test: sorted.slice(sorted.length - testCount),
      tune: sorted.slice(0, sorted.length - testCount),
      deviation: `only ${sorted.length} questions qualified (< ${RELEVANCE_TEST_SPLIT_SIZE}); the most recent half is the test split`,
    };
  }
  return {
    test: sorted.slice(sorted.length - RELEVANCE_TEST_SPLIT_SIZE),
    tune: sorted.slice(0, sorted.length - RELEVANCE_TEST_SPLIT_SIZE),
    deviation: null,
  };
}

/** One relevance question: a PR title or commit subject and the eligible files it changed. */
export interface RelevanceQuestion {
  readonly id: string;
  readonly source: 'pr' | 'commit';
  readonly split: 'test' | 'tune';
  readonly query: string;
  readonly truthFiles: readonly string[];
}

export interface RelevanceBuildOptions {
  readonly corpusCommit: string;
  readonly frozenAt: string;
  readonly generator?: string;
}

/** `buildRelevanceQuestionFile` result, with the split deviation surfaced. */
export interface RelevanceBuildResult {
  readonly file: RelevanceQuestionFile;
  readonly deviation: string | null;
  /** Kept PRs plus commits. */
  readonly keptCount: number;
}

/** Frozen relevance question file (envelope mirrors scorecard groundTruth). */
export interface RelevanceQuestionFile {
  readonly id: 'relevance';
  readonly version: '1';
  readonly method: 'git-history';
  readonly frozenAt: string;
  readonly corpusCommit: string;
  readonly generator: string;
  readonly seed: null;
  readonly counts: {
    readonly test: number;
    readonly tune: number;
    readonly total: number;
    readonly pr: number;
    readonly commit: number;
  };
  readonly questions: readonly RelevanceQuestion[];
}

export const relevanceQuestionSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['pr', 'commit']),
  split: z.enum(['test', 'tune']),
  query: z.string().min(1),
  truthFiles: z.array(z.string().min(1)).min(1),
});

export const relevanceQuestionFileSchema = z
  .object({
    id: z.literal('relevance'),
    version: z.literal('1'),
    method: z.literal('git-history'),
    raterCount: z.number().int().positive().optional(),
    frozenAt: z.string().datetime(),
    corpusCommit: z.string().min(1),
    generator: z.string().min(1),
    seed: z.null(),
    counts: z.object({
      test: z.number().int().nonnegative(),
      tune: z.number().int().nonnegative(),
      total: z.number().int().positive(),
      pr: z.number().int().nonnegative(),
      commit: z.number().int().nonnegative(),
    }),
    questions: z.array(relevanceQuestionSchema),
  })
  .superRefine((file, context) => {
    if (file.counts.test + file.counts.tune !== file.counts.total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.test + counts.tune must equal counts.total',
        path: ['counts'],
      });
    }
    if (file.counts.pr + file.counts.commit !== file.counts.total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.pr + counts.commit must equal counts.total',
        path: ['counts'],
      });
    }
    if (file.counts.total !== file.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.total must equal questions.length',
        path: ['counts', 'total'],
      });
    }
  });

/** Builds the frozen relevance question file from injected PR and commit data. */
export function buildRelevanceQuestionFile(
  prs: readonly MergedPullRequest[],
  commits: readonly CommitCandidate[],
  deps: RelevanceGitDeps,
  options: RelevanceBuildOptions,
): RelevanceBuildResult {
  const prCandidates = filterRelevantPullRequests(prs, deps);
  const commitCandidates = filterRelevantCommits(commits, prCandidates, deps);
  const ordered = [...prCandidates, ...commitCandidates].sort(
    compareByDateThenId,
  );
  const split = splitByDate(ordered);
  const questionOf =
    (splitTag: 'test' | 'tune') =>
    (candidate: RelevanceCandidate): RelevanceQuestion => ({
      id: candidate.id,
      source: candidate.source,
      split: splitTag,
      query: candidate.query,
      truthFiles: candidate.truthFiles,
    });
  return {
    file: {
      id: 'relevance',
      version: '1',
      method: 'git-history',
      frozenAt: options.frozenAt,
      corpusCommit: options.corpusCommit,
      generator: options.generator ?? 'relevance-questions.ts',
      seed: null,
      counts: {
        test: split.test.length,
        tune: split.tune.length,
        total: ordered.length,
        pr: prCandidates.length,
        commit: commitCandidates.length,
      },
      questions: [
        ...split.tune.map(questionOf('tune')),
        ...split.test.map(questionOf('test')),
      ],
    },
    deviation: split.deviation,
    keptCount: ordered.length,
  };
}

/** `generateRelevanceQuestionFile` result: the file plus its fetch deviations. */
export interface GeneratedRelevanceQuestions {
  readonly file: RelevanceQuestionFile;
  /** Non-null when fewer than 200 questions qualified and the half-split was used. */
  readonly deviation: string | null;
  /** PRs skipped because they change more than 100 files. */
  readonly skippedLargePrs: number;
}

/**
 * Drives the whole generator for the orchestrator: fetches merged PRs
 * (`gh api graphql`, paged) and commit candidates (`git log <pin>`) for
 * `repoRoot`, builds the frozen question file against the real repository,
 * and surfaces the skipped-PR count. CI reads the frozen JSON instead.
 */
export function generateRelevanceQuestionFile(
  repoRoot: string,
  corpusCommit: string,
  frozenAt: string,
): GeneratedRelevanceQuestions {
  const { prs, skippedLargePrs } = fetchMergedPullRequests(repoRoot);
  const commits = fetchCommitCandidates(repoRoot, corpusCommit);
  const { file, deviation } = buildRelevanceQuestionFile(
    prs,
    commits,
    gitRelevanceDeps(repoRoot, corpusCommit),
    { corpusCommit, frozenAt },
  );
  return { file, deviation, skippedLargePrs };
}
