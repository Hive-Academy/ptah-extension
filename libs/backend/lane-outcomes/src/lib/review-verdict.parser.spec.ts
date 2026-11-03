import {
  REVIEW_DELIVERABLE_MAX_CHARS,
  parseReviewDeliverable,
} from './review-verdict.parser';

const REVIEWER = 'subagent:reviewer';

function parse(...lines: string[]) {
  return parseReviewDeliverable(lines.join('\n'), REVIEWER);
}

describe('parseReviewDeliverable', () => {
  it('reads one reviewed run and one verdict', () => {
    expect(parse('# Review', 'Reviewed-Run: lane:abc', 'Verdict: APPROVED')).toEqual({
      reviewedRunId: 'lane:abc',
      verdict: 'approved',
    });
  });

  it.each([
    ['lowercase labels and verdict', ['reviewed-run: lane:a', 'verdict: revise'], 'revise'],
    ['mixed case', ['REVIEWED-RUN: lane:a', 'VeRdIcT: Rejected'], 'rejected'],
    ['bullets and bold labels', ['- **Reviewed-Run**: lane:a', '* **Verdict**: APPROVED'], 'approved'],
    ['bold label with colon inside', ['**Reviewed-Run:** lane:a', '**Verdict:** REVISE'], 'revise'],
    ['bold verdict value', ['Reviewed-Run: lane:a', 'Verdict: **REJECTED**'], 'rejected'],
    ['heading verdict', ['Reviewed-Run: lane:a', '## Verdict: APPROVED'], 'approved'],
    ['backticked run id', ['Reviewed-Run: `lane:a`', 'Verdict: APPROVED'], 'approved'],
    ['CRLF line endings', ['Reviewed-Run: lane:a\r', 'Verdict: REVISE\r'], 'revise'],
    ['text after the verdict word', ['Reviewed-Run: lane:a', 'Verdict: APPROVED - ship it'], 'approved'],
    ['repeated agreeing verdicts', ['Verdict: REVISE', 'Reviewed-Run: lane:a', '- Verdict: revise'], 'revise'],
    ['repeated identical run lines', ['Reviewed-Run: lane:a', 'Reviewed-Run: `lane:a`', 'Verdict: REVISE'], 'revise'],
  ])('accepts %s', (_name, lines, verdict) => {
    expect(parse(...lines)).toEqual({ reviewedRunId: 'lane:a', verdict });
  });

  it('accepts subagent and pipe-joined run ids', () => {
    expect(parse('Reviewed-Run: subagent:agent-7', 'Verdict: APPROVED')).toEqual({
      reviewedRunId: 'subagent:agent-7',
      verdict: 'approved',
    });
    expect(parse('Reviewed-Run: lane:a|b.c_d', 'Verdict: APPROVED')).toEqual({
      reviewedRunId: 'lane:a|b.c_d',
      verdict: 'approved',
    });
  });

  it('refuses a deliverable without a reviewed run', () => {
    expect(parse('Verdict: APPROVED')).toEqual({ refusal: 'no-target' });
    expect(parse('Reviewed run: lane:a', 'Verdict: APPROVED')).toEqual({
      refusal: 'no-target',
    });
    expect(parse('Reviewed-Run: lane:a and more', 'Verdict: APPROVED')).toEqual({
      refusal: 'no-target',
    });
    expect(parse(`Reviewed-Run: ${'a'.repeat(201)}`, 'Verdict: APPROVED')).toEqual({
      refusal: 'no-target',
    });
  });

  it('refuses free-form praise or a missing verdict', () => {
    expect(parse('Reviewed-Run: lane:a', 'Looks great, approved!')).toEqual({
      refusal: 'no-verdict',
    });
    expect(parse('Reviewed-Run: lane:a', 'Verdict: LGTM')).toEqual({
      refusal: 'no-verdict',
    });
    expect(parse('Reviewed-Run: lane:a', 'The verdict: APPROVED')).toEqual({
      refusal: 'no-verdict',
    });
    expect(parse('Reviewed-Run: lane:a', 'Verdict: APPROVEDISH')).toEqual({
      refusal: 'no-verdict',
    });
    expect(parseReviewDeliverable('', REVIEWER)).toEqual({ refusal: 'no-target' });
  });

  it('refuses conflicting verdicts', () => {
    expect(
      parse('Reviewed-Run: lane:a', 'Verdict: APPROVED', 'Verdict: REVISE'),
    ).toEqual({ refusal: 'ambiguous' });
  });

  it('refuses more than one distinct reviewed run', () => {
    expect(
      parse('Reviewed-Run: lane:a', 'Reviewed-Run: lane:b', 'Verdict: APPROVED'),
    ).toEqual({ refusal: 'ambiguous' });
  });

  it('refuses a review of the reviewer itself', () => {
    expect(parse(`Reviewed-Run: ${REVIEWER}`, 'Verdict: APPROVED')).toEqual({
      refusal: 'self-review',
    });
  });

  it('refuses text over the three-file read bound without reading it', () => {
    const text = `Reviewed-Run: lane:a\nVerdict: APPROVED\n${'x'.repeat(
      REVIEW_DELIVERABLE_MAX_CHARS,
    )}`;
    expect(parseReviewDeliverable(text, REVIEWER)).toEqual({
      refusal: 'too-large',
    });
    expect(REVIEW_DELIVERABLE_MAX_CHARS).toBe(3 * 64 * 1024);
  });
});
