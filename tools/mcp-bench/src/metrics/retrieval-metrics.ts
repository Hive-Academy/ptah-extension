export interface Answer {
  ranked: string[];
  abstained: boolean;
}

export interface Truth {
  items: string[];
  abstain?: boolean;
}

export interface PathNormalizationOptions {
  workspaceRoot?: string;
  /**
   * Path semantics for the workspace-root comparison. On win32 the root is
   * matched case-insensitively (`D:/Projects` relativises `d:/projects/x`).
   * Default `process.platform`.
   */
  platform?: NodeJS.Platform;
}

export type MetricName =
  | 'hitAt1'
  | 'hitAt5'
  | 'meanReciprocalRank'
  | 'recallAtK'
  | 'recallAtAll'
  | 'precision'
  | 'strictAccuracyAtK'
  | 'ndcgAtK'
  | 'resultTokens'
  | 'callsPerAnswer'
  | 'p50Latency'
  | 'p95Latency'
  | 'errorRate'
  | 'truncationRate';

/** True means a lower value is better in scorecard comparisons. */
export const LOWER_IS_BETTER: Readonly<Record<MetricName, boolean>> = {
  hitAt1: false,
  hitAt5: false,
  meanReciprocalRank: false,
  recallAtK: false,
  recallAtAll: false,
  precision: false,
  strictAccuracyAtK: false,
  ndcgAtK: false,
  resultTokens: true,
  callsPerAnswer: true,
  p50Latency: true,
  p95Latency: true,
  errorRate: true,
  truncationRate: true,
};

export function callsPerAnswer(
  totalCalls: number,
  answerCount: number,
): number | undefined {
  if (answerCount === 0) return undefined;
  return totalCalls / answerCount;
}

/** Converts paths to a stable, workspace-relative comparison key. */
export function normalizePath(
  value: string,
  options: PathNormalizationOptions = {},
): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+/g, '/');
  const root = options.workspaceRoot
    ? options.workspaceRoot.trim().replaceAll('\\', '/').replace(/\/+/g, '/')
    : undefined;
  const caseNormalized = normalizeDriveLetter(normalized);
  const rootNormalized = root
    ? trimTrailingSlash(normalizeDriveLetter(root))
    : undefined;

  const fold = (path: string): string =>
    (options.platform ?? process.platform) === 'win32'
      ? path.toLowerCase()
      : path;
  if (
    !rootNormalized ||
    !isWithinWorkspace(fold(caseNormalized), fold(rootNormalized))
  ) {
    return trimLeadingDotSlash(caseNormalized);
  }

  const relative = caseNormalized.slice(rootNormalized.length);
  return trimLeadingDotSlash(relative.replace(/^\/+/, ''));
}

export function hitAt1(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): number {
  return hitAtK(answer, truth, 1, options);
}

export function hitAt5(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): number {
  return hitAtK(answer, truth, 5, options);
}

export function hitAtK(
  answer: Answer,
  truth: Truth,
  k: number,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  if (prepared.truth.size === 0 || k <= 0) return 0;
  return prepared.ranked.slice(0, k).some((item) => prepared.truth.has(item))
    ? 1
    : 0;
}

export function meanReciprocalRank(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  const firstMatch = prepared.ranked.findIndex((item) =>
    prepared.truth.has(item),
  );
  return firstMatch === -1 ? 0 : 1 / (firstMatch + 1);
}

export function recallAtK(
  answer: Answer,
  truth: Truth,
  k: number,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  if (prepared.truth.size === 0 || k <= 0) return 0;
  return (
    countMatches(prepared.ranked.slice(0, k), prepared.truth) /
    prepared.truth.size
  );
}

export function recallAtAll(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): number {
  return recallAtK(answer, truth, Number.POSITIVE_INFINITY, options);
}

export function precision(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  if (prepared.ranked.length === 0) return 0;
  return countMatches(prepared.ranked, prepared.truth) / prepared.ranked.length;
}

/** LocAgent-style Acc@k: every ground-truth item must occur in the first k results. */
export function strictAccuracyAtK(
  answer: Answer,
  truth: Truth,
  k: number,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  if (prepared.truth.size === 0 || k <= 0) return 0;
  const topK = new Set(prepared.ranked.slice(0, k));
  return [...prepared.truth].every((item) => topK.has(item)) ? 1 : 0;
}

export function ndcgAtK(
  answer: Answer,
  truth: Truth,
  k: number,
  options?: PathNormalizationOptions,
): number {
  const prepared = prepare(answer, truth, options);
  if (prepared.abstentionScore !== undefined) return prepared.abstentionScore;
  if (prepared.truth.size === 0 || k <= 0) return 0;

  const limit = Math.min(k, prepared.ranked.length);
  let dcg = 0;
  for (let index = 0; index < limit; index += 1) {
    if (prepared.truth.has(prepared.ranked[index]))
      dcg += 1 / Math.log2(index + 2);
  }

  const idealCount = Math.min(k, prepared.truth.size);
  let idcg = 0;
  for (let index = 0; index < idealCount; index += 1)
    idcg += 1 / Math.log2(index + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

interface PreparedAnswer {
  ranked: string[];
  truth: Set<string>;
  abstentionScore?: number;
}

function prepare(
  answer: Answer,
  truth: Truth,
  options?: PathNormalizationOptions,
): PreparedAnswer {
  const correctAbstention = truth.abstain === true;
  if (answer.abstained || correctAbstention) {
    return {
      ranked: [],
      truth: new Set<string>(),
      abstentionScore: answer.abstained === correctAbstention ? 1 : 0,
    };
  }
  return {
    ranked: unique(answer.ranked.map((item) => normalizePath(item, options))),
    truth: new Set(
      unique(truth.items.map((item) => normalizePath(item, options))),
    ),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function countMatches(ranked: string[], truth: Set<string>): number {
  return ranked.filter((item) => truth.has(item)).length;
}

function normalizeDriveLetter(value: string): string {
  return value.replace(
    /^([A-Za-z]):/,
    (_, drive: string) => `${drive.toLowerCase()}:`,
  );
}

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 1 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function trimLeadingDotSlash(value: string): string {
  return value.replace(/^\.\//, '');
}

function isWithinWorkspace(value: string, root: string): boolean {
  return value === root || value.startsWith(root === '/' ? root : `${root}/`);
}
