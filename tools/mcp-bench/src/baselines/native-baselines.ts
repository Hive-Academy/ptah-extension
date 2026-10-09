import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import fastGlob from 'fast-glob';

import { type Answer, normalizePath } from '../metrics/retrieval-metrics';
import { getGitExecutable } from '../utils/git-executable';
import {
  type RgRunOptions,
  type RgRunResult,
  type RgRunner,
} from './rg-runner';

const execFileAsync = promisify(execFile);
const RG_TIMEOUT_MS = 10_000;
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;
const RG_EXCLUDES = [
  '--hidden',
  '--glob',
  '!.git',
  '--glob',
  '!tools/mcp-bench/questions/**',
  '--glob',
  '!**/node_modules/**',
];
const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'from',
  'into',
  'not',
  'the',
  'this',
  'that',
  'these',
  'those',
  'with',
  'for',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'how',
]);

export interface NativeResult {
  answer: Answer;
  commands: number;
  resultText: string;
  latencyMs: number;
  error: string | null;
  view?: string;
}

export type GitRunner = (
  args: readonly string[],
  options: RgRunOptions,
) => Promise<RgRunResult>;

export interface NativeContext {
  corpusRoot: string;
  rg: RgRunner;
  git?: GitRunner;
  gitRoot?: string;
  corpusCommit?: string;
}

export interface SymbolQuestion {
  query: string;
}
export interface ReferenceQuestion {
  query: string;
}
export interface DefinitionQuestion {
  file: string;
  query: string;
}
export interface DependentQuestion {
  file: string;
}
export interface RelevanceQuestion {
  query: string;
}
export interface AstQuestion {
  file: string;
}
export interface GlobQuestion {
  pattern: string;
}
export interface TextQuestion {
  query: string;
}
export interface MemoryQuestion {
  query: string;
  abstain?: boolean;
}

export async function symbolsExactBaseline(
  question: SymbolQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const name = question.query.trim();
  const declaration = `\\b(function|class|interface|type|enum|const|let|var)\\s+${escapeRegex(name)}\\b`;
  const first = await rg(ctx, ['-n', '-e', declaration, '.']);
  if (first.error || first.value.stdout)
    return toLineResult(first, ctx.corpusRoot);

  const methodOrProperty = `\\b${escapeRegex(name)}\\s*(?:\\(|:|=)`;
  return toLineResult(
    await rg(ctx, ['-n', '-e', methodOrProperty, '.'], first),
    ctx.corpusRoot,
  );
}

export async function symbolsConceptBaseline(
  question: SymbolQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  return rankedKeywordFiles(longestTokens(question.query, 3), ctx);
}

export async function referencesBaseline(
  question: ReferenceQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  return toLineResult(
    await rg(ctx, ['-n', '-w', '-e', question.query.trim(), '.']),
    ctx.corpusRoot,
  );
}

export async function definitionsBaseline(
  question: DefinitionQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const declaration = definitionPattern(question.query.trim());
  const result = toLineResult(
    await rg(ctx, ['-n', '-e', declaration, '.']),
    ctx.corpusRoot,
  );
  const sameFile = normalizePath(question.file, {
    workspaceRoot: ctx.corpusRoot,
  });
  result.answer.ranked.sort((left, right) => {
    const sameFileDifference =
      Number(!left.startsWith(`${sameFile}:`)) -
      Number(!right.startsWith(`${sameFile}:`));
    if (sameFileDifference !== 0) return sameFileDifference;
    return pathFromLocation(left).localeCompare(pathFromLocation(right));
  });
  return result;
}

export async function dependentsBaseline(
  question: DependentQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const stem = path.basename(question.file).replace(/\.[^.]+$/u, '');
  const staticImport = `from\\s+['"][^'"]*${escapeRegex(stem)}['"]`;
  const dynamicImport = `import\\(\\s*['"][^'"]*${escapeRegex(stem)}['"]\\s*\\)`;
  const first = await rg(ctx, ['-l', '-e', staticImport, 'libs', 'apps']);
  if (first.error) return toFileResult(first, ctx.corpusRoot);
  const second = await rg(
    ctx,
    ['-l', '-e', dynamicImport, 'libs', 'apps'],
    first,
  );
  return toFileResult(second, ctx.corpusRoot);
}

export async function relevanceBaseline(
  question: RelevanceQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const keywords = relevanceKeywords(question.query);
  return rankedKeywordFiles(keywords, ctx);
}

export async function relevanceGitLogBaseline(
  question: RelevanceQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const keywords = relevanceKeywords(question.query);
  const git = ctx.git ?? defaultGitRunner;
  const results = await Promise.all(
    keywords.map((keyword) => gitLog(git, keyword, ctx)),
  );
  const error = results.find((result) => result.error)?.error ?? null;
  const counts = new Map<string, number>();
  for (const result of results) {
    for (const file of parseGitLogFiles(
      result.stdout,
      ctx.gitRoot ?? ctx.corpusRoot,
    )) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([file]) => file);
  return {
    answer: { ranked, abstained: ranked.length === 0 },
    commands: results.length,
    resultText: results
      .map((result) => result.stdout)
      .filter(Boolean)
      .join('\n'),
    latencyMs: results.reduce((sum, result) => sum + result.latencyMs, 0),
    error,
    view: 'git-log',
  };
}

export async function astBaseline(
  question: AstQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const startedAt = performance.now();
  try {
    const content = await readFile(
      resolveCorpusPath(ctx.corpusRoot, question.file),
      'utf8',
    );
    return success([content], 1, content, performance.now() - startedAt);
  } catch (error) {
    return failure(1, performance.now() - startedAt, error);
  }
}

export async function globBaseline(
  question: GlobQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const startedAt = performance.now();
  try {
    const files = await fastGlob(question.pattern, {
      cwd: ctx.corpusRoot,
      onlyFiles: true,
      dot: true,
      ignore: ['**/.git/**', '**/node_modules/**'],
    });
    const ranked = files.map((file) => normalizePath(file));
    return success(ranked, 1, ranked.join('\n'), performance.now() - startedAt);
  } catch (error) {
    return failure(1, performance.now() - startedAt, error);
  }
}

export async function textLiteralBaseline(
  question: TextQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  return toLineResult(
    await rg(ctx, ['-n', '-F', '--', question.query, '.']),
    ctx.corpusRoot,
  );
}

export async function textRegexBaseline(
  question: TextQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  // PCRE2 is intentionally not enabled: ripgrep's default engine is the requested baseline.
  return toLineResult(
    await rg(ctx, ['-n', '-e', question.query, '.']),
    ctx.corpusRoot,
  );
}

export async function memoryBaseline(
  question: MemoryQuestion,
  ctx: NativeContext,
): Promise<NativeResult> {
  const keywords = relevanceKeywords(question.query);
  const files = await rankedKeywordFiles(keywords, ctx, ['.ptah/specs']);
  const git = ctx.git ?? defaultGitRunner;
  const gitResults = await Promise.all(
    keywords.map((keyword) => gitLog(git, keyword, ctx)),
  );
  const gitError = gitResults.find((result) => result.error)?.error ?? null;
  const gitText = gitResults
    .map((result) => result.stdout)
    .filter(Boolean)
    .join('\n');
  return {
    ...files,
    answer: {
      ranked: files.answer.ranked,
      abstained: question.abstain ?? files.answer.ranked.length === 0,
    },
    commands: files.commands + gitResults.length,
    latencyMs:
      files.latencyMs +
      gitResults.reduce((sum, result) => sum + result.latencyMs, 0),
    resultText: [files.resultText, gitText].filter(Boolean).join('\n'),
    error: files.error ?? gitError,
    view: 'comparison',
  };
}

async function rankedKeywordFiles(
  keywords: string[],
  ctx: NativeContext,
  paths: string[] = ['.'],
): Promise<NativeResult> {
  let aggregate: Aggregate | undefined;
  const counts = new Map<string, number>();
  for (const keyword of keywords) {
    const next = await rg(
      ctx,
      ['-i', '-l', '-e', keyword, ...paths],
      aggregate,
    );
    aggregate = next;
    if (next.error) return toFileResult(next, ctx.corpusRoot);
    for (const file of parseFileOutput(next.value.stdout, ctx.corpusRoot)) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([file]) => file);
  return success(
    ranked,
    aggregate?.commands ?? 0,
    aggregate?.stdout ?? '',
    aggregate?.latencyMs ?? 0,
  );
}

type Aggregate = {
  value: RgRunResult;
  commands: number;
  stdout: string;
  latencyMs: number;
  error: string | null;
};

async function rg(
  ctx: NativeContext,
  args: string[],
  previous?: Aggregate,
): Promise<Aggregate> {
  try {
    const value = await ctx.rg([...RG_EXCLUDES, ...args], {
      cwd: ctx.corpusRoot,
      timeoutMs: RG_TIMEOUT_MS,
    });
    return {
      value,
      commands: (previous?.commands ?? 0) + 1,
      stdout: [previous?.stdout, value.stdout].filter(Boolean).join('\n'),
      latencyMs: (previous?.latencyMs ?? 0) + value.latencyMs,
      error: previous?.error ?? null,
    };
  } catch (error) {
    return {
      value: { stdout: '', exitCode: 2, latencyMs: 0, commandLine: '' },
      commands: (previous?.commands ?? 0) + 1,
      stdout: previous?.stdout ?? '',
      latencyMs: previous?.latencyMs ?? 0,
      error: errorMessage(error),
    };
  }
}

function toLineResult(aggregate: Aggregate, corpusRoot: string): NativeResult {
  return aggregate.error
    ? failure(
        aggregate.commands,
        aggregate.latencyMs,
        aggregate.error,
        aggregate.stdout,
      )
    : success(
        parseLineOutput(aggregate.stdout, corpusRoot),
        aggregate.commands,
        aggregate.stdout,
        aggregate.latencyMs,
      );
}

function toFileResult(aggregate: Aggregate, corpusRoot: string): NativeResult {
  return aggregate.error
    ? failure(
        aggregate.commands,
        aggregate.latencyMs,
        aggregate.error,
        aggregate.stdout,
      )
    : success(
        parseFileOutput(aggregate.stdout, corpusRoot),
        aggregate.commands,
        aggregate.stdout,
        aggregate.latencyMs,
      );
}

function success(
  ranked: string[],
  commands: number,
  resultText: string,
  latencyMs: number,
): NativeResult {
  return {
    answer: { ranked: [...new Set(ranked)], abstained: ranked.length === 0 },
    commands,
    resultText,
    latencyMs,
    error: null,
  };
}

function failure(
  commands: number,
  latencyMs: number,
  error: unknown,
  resultText = '',
): NativeResult {
  return {
    answer: { ranked: [], abstained: true },
    commands,
    resultText,
    latencyMs,
    error: errorMessage(error),
  };
}

// rg runs multi-threaded (no `--sort path`, which serialises it and inflates
// the native latency), so its output order varies; the parsers sort by path
// and line to keep ranked baselines deterministic.
function parseLineOutput(stdout: string, corpusRoot: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = /^(.*?):(\d+):/u.exec(line);
      return match
        ? [
            {
              path: normalizePath(match[1], { workspaceRoot: corpusRoot }),
              line: Number(match[2]),
            },
          ]
        : [];
    })
    .sort((a, b) => comparePaths(a.path, b.path) || a.line - b.line)
    .map((hit) => `${hit.path}:${hit.line}`);
}

function parseFileOutput(stdout: string, corpusRoot: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((file) => normalizePath(file, { workspaceRoot: corpusRoot }))
    .sort(comparePaths);
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function defaultGitRunner(
  args: readonly string[],
  options: RgRunOptions,
): Promise<RgRunResult> {
  const startedAt = performance.now();
  try {
    const { stdout } = await execFileAsync(getGitExecutable(), [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return {
      stdout,
      exitCode: 0,
      latencyMs: performance.now() - startedAt,
      commandLine: ['git', ...args].join(' '),
    };
  } catch (error: unknown) {
    const failure = error as { code?: number; stdout?: string };
    if (failure.code === 1)
      return {
        stdout: failure.stdout ?? '',
        exitCode: 1,
        latencyMs: performance.now() - startedAt,
        commandLine: ['git', ...args].join(' '),
      };
    if (errorMessage(error).includes('maxBuffer')) {
      throw new Error(
        `git output exceeded 512 MiB: ${['git', ...args].join(' ')}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function gitLog(
  git: GitRunner,
  keyword: string,
  ctx: NativeContext,
): Promise<RgRunResult & { error: string | null }> {
  try {
    const args = ['log'];
    if (ctx.corpusCommit) args.push(ctx.corpusCommit);
    args.push(
      '-i',
      `--grep=${keyword}`,
      '--name-only',
      '--format=__MCP_COMMIT__%H',
    );
    return {
      ...(await git(args, {
        cwd: ctx.gitRoot ?? ctx.corpusRoot,
        timeoutMs: RG_TIMEOUT_MS,
      })),
      error: null,
    };
  } catch (error) {
    return {
      stdout: '',
      exitCode: 2,
      latencyMs: 0,
      commandLine: '',
      error: errorMessage(error),
    };
  }
}

function longestTokens(query: string, count: number): string[] {
  return [...new Set(query.match(/[A-Za-z0-9_]+/gu) ?? [])]
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    )
    .slice(0, count);
}

function relevanceKeywords(query: string): string[] {
  return longestTokens(query, Number.POSITIVE_INFINITY).filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function definitionPattern(name: string): string {
  const modifiers =
    '(?:(?:export|default|async|static|public|private|protected|readonly|abstract|override|declare|get|set)\\s+)*';
  const declaration =
    '(?:function\\s*\\*?\\s*|class\\s+|interface\\s+|type\\s+|enum\\s+|(?:const|let|var)\\s+)?';
  return `^\\s*${modifiers}${declaration}${escapeRegex(name)}\\s*(?:<[^>]*>)?\\s*[(=:]`;
}

function pathFromLocation(location: string): string {
  return location.slice(0, location.lastIndexOf(':'));
}

function parseGitLogFiles(stdout: string, gitRoot: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith('__MCP_COMMIT__'))
    .map((file) => normalizePath(file, { workspaceRoot: gitRoot }));
}

function resolveCorpusPath(corpusRoot: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(corpusRoot, file);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
