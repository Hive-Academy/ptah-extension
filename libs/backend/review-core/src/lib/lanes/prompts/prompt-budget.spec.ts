import { budgetReviewPrompt, REVIEW_PROMPT_MAX_CHARS, ReviewPromptTooLargeError } from './prompt-budget';
import { buildCorrectnessLifecyclePrompt } from './correctness-lifecycle.prompt';
import type { ReviewPromptInput } from './prompt-fence';

const base: ReviewPromptInput = { headSha: 'a'.repeat(40), title: 'title', body: 'body', diff: 'diff',
  fileContent: 'file', comments: 'comment', deterministicEvidence: 'evidence', repositoryRules: 'rules' };

describe('review prompt budget', () => {
  it('keeps small inputs unchanged', () => {
    expect(budgetReviewPrompt(base, 1_000)).toEqual({ input: base, coverage: [] });
  });

  it('drops lower priority material first and reports omitted files and characters', () => {
    const diff = Array.from({ length: 100 }, (_, n) => `diff --git a/f${n} b/f${n}\n@@ -1 +1 @@\n${'x'.repeat(2_000)}\n`).join('');
    const result = budgetReviewPrompt({ ...base, diff, fileContent: 'source'.repeat(2_000),
      comments: 'comment'.repeat(5_000), deterministicEvidence: 'evidence'.repeat(5_000) }, 2_000);
    expect(result.input.repositoryRules).toBe(base.repositoryRules);
    expect(result.input.diff).toContain('[truncated:');
    expect(result.input.diff).toMatch(/of 100 files \/ \d+ chars omitted/);
    expect(result.input.comments).toContain('[truncated:');
    expect(result.coverage).toContainEqual(expect.stringContaining('prompt:truncated:diff:'));
  });

  it('keeps surrogate pairs intact and caps a large lens prompt including instructions', () => {
    const prompt = buildCorrectnessLifecyclePrompt({ ...base, diff: '😀'.repeat(150_000),
      fileContent: 'src\n'.repeat(5_000) });
    expect(prompt.length).toBeLessThanOrEqual(REVIEW_PROMPT_MAX_CHARS);
    expect(prompt).toContain('[truncated:');
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(prompt).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(prompt).toContain('schemaVersion: 1');
  });

  it('fails with a specific error when rules and one file cannot fit', () => {
    expect(() => buildCorrectnessLifecyclePrompt({ ...base, repositoryRules: 'r'.repeat(REVIEW_PROMPT_MAX_CHARS),
      fileContent: 'source' })).toThrow(ReviewPromptTooLargeError);
  });
});
