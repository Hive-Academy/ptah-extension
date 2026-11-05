import type { ReviewPromptInput } from './prompt-fence';

export const REVIEW_PROMPT_MAX_CHARS = 180_000;
export class ReviewPromptTooLargeError extends Error {
  readonly code = 'prompt-too-large';
  constructor() { super('Review prompt cannot fit instructions, repository rules, and one file'); }
}

type Field = Exclude<keyof ReviewPromptInput, 'headSha'>;
const priority: Field[] = ['repositoryRules', 'title', 'body', 'diff', 'fileContent', 'comments', 'deterministicEvidence'];

function safePrefix(value: string, length: number): string {
  let end = Math.min(value.length, Math.max(0, length));
  if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
  return value.slice(0, end);
}

function atBoundary(value: string, length: number, field: Field): string {
  const prefix = safePrefix(value, length);
  if (prefix.length === value.length || prefix.length < 256) return prefix;
  if (field === 'diff') {
    const hunk = prefix.lastIndexOf('\n@@ ');
    const file = prefix.lastIndexOf('\ndiff --git ');
    const boundary = Math.max(hunk, file);
    if (boundary > prefix.length / 2) return prefix.slice(0, boundary);
  }
  if (field === 'fileContent') {
    const boundary = prefix.lastIndexOf('\n');
    if (boundary > prefix.length / 2) return prefix.slice(0, boundary);
  }
  return prefix;
}

function fileCount(value: string): number {
  return (value.match(/^diff --git /gm) ?? []).length;
}

export interface PromptBudgetResult { input: ReviewPromptInput; coverage: string[] }
export function budgetReviewPrompt(input: ReviewPromptInput, fixedChars: number): PromptBudgetResult {
  const values: ReviewPromptInput = { ...input };
  const coverage: string[] = [];
  // Leave room for the longest truncation markers and seven fenced section labels.
  let remaining = REVIEW_PROMPT_MAX_CHARS - fixedChars - 1_200;
  if (remaining <= 0 || input.repositoryRules.length > remaining) throw new ReviewPromptTooLargeError();
  const minimumFile = input.fileContent ? Math.min(8_000, input.fileContent.length) : 0;
  if (minimumFile && remaining - input.repositoryRules.length < minimumFile) throw new ReviewPromptTooLargeError();
  for (const field of priority) {
    const original = input[field];
    const reserve = field === 'fileContent' ? 0 : minimumFile;
    const allowance = Math.max(0, remaining - reserve);
    const cap = field === 'title' || field === 'body' ? Math.min(4_000, allowance) : allowance;
    const kept = original.length <= cap ? original : atBoundary(original, cap, field);
    remaining -= kept.length;
    if (kept.length === original.length) continue;
    const omitted = original.length - kept.length;
    const files = field === 'diff' ? `${Math.max(0, fileCount(original) - fileCount(kept))} of ${fileCount(original)} files / ` : '';
    values[field] = `${kept}\n[truncated: ${files}${omitted} chars omitted]`;
    coverage.push(`prompt:truncated:${field}: ${files}${omitted} chars omitted`);
  }
  return { input: values, coverage };
}
