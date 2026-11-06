import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectStatus,
  extractSpec,
  isDocumentReview,
  normalizeExecutor,
  parseReviewVerdict,
  parseBatchVerdicts,
  taskVerdict,
  HARVEST_MARKER_FILE,
  type SpecReviewVerdict,
} from './spec-extractor';

const TASKS_MD = `# Development Tasks - TASK_2026_001

## Batch 1: Backend — COMPLETE

**Recommended Executor**: backend-developer
**Execution Mode**: sequential

### Task 1.1: Do the thing — COMPLETE

## Batch 2: Frontend — FAILED

**Recommended Executor**: frontend-developer | fallback

### Task 2.1: Build UI — FAILED
`;

/** Build a valid `task.md` frontmatter carrier for the given status. */
function taskMd(id: string, status: string): string {
  return `---
id: ${id}
status: ${status}
type: FEATURE
title: Example task ${id}
created: 2026-07-14T10:00:00.000Z
updated: 2026-07-14T10:00:00.000Z
---

## Description

Example body for ${id}.
`;
}

describe('spec-extractor pure parsers', () => {
  it('accepts only explicit terminal review verdicts', () => {
    expect(parseReviewVerdict('judge-round-1.json', '{"verdict":"approved","run_id":"r1"}', 'digest', 0)).toEqual(expect.objectContaining({ verdict: 'pass', runId: 'r1' }));
    expect(parseReviewVerdict('judge-round-2.json', '{"pass":false,"taskId":"TASK_2026_001"}', 'digest', 0)).toEqual(expect.objectContaining({ verdict: 'fail' }));
    expect(parseReviewVerdict('judge-round-1.json', '{broken', 'digest', 0)).toBeNull();
    expect(parseReviewVerdict('code-style-review.md', 'Some tests passed.', 'digest', 0)).toBeNull();
  });
  it('parses the repository review verdict formats', () => {
    const samples = [
      ['code-logic-review.md', '## Verdict\n\n- Recommendation: REVISE (Verdict: REVISE)\n- Confidence: MEDIUM-HIGH', 'fail'],
      ['code-style-review.md', '## Verdict\n\n- Recommendation: APPROVE\n- Confidence: HIGH', 'pass'],
      ['code-style-review.md', '## Verdict\n\n- **Recommendation**: NEEDS_REVISION\n- Confidence: HIGH', 'fail'],
      ['code-style-review.md', 'Verdict: REJECT', 'fail'],
      ['code-style-review.md', 'Verdict: REJECTED', 'fail'],
      ['code-style-review.md', 'Verdict: NEEDS REVISION', 'fail'],
      ['code-style-review.md', 'Verdict: NEEDS-REVISION', 'fail'],
      ['code-style-review.md', 'Recommendation: APPROVE with minor changes', 'pass'],
      ['code-style-review.md', 'Verdict: APPROVED\nStatus: draft notes', 'pass'],
      ['code-logic-review.md', '## Verdict\n\nAPPROVED\n', 'pass'],
    ] as const;
    for (const [file, content, verdict] of samples) {
      expect(parseReviewVerdict(file, content, 'digest', 0)?.verdict).toBe(verdict);
    }
  });
  it('parses bold verdict forms around the label, the value or both', () => {
    const samples = [
      ['Verdict: **APPROVED**', 'pass'],
      ['**Verdict:** REVISE', 'fail'],
      ['**Verdict: REVISE**', 'fail'],
      ['Verdict: **NEEDS_REVISION**', 'fail'],
      ['- **Verdict**: **PASS**', 'pass'],
      ['**Verdict:**APPROVED', 'pass'],
      ['## Verdict\n\n**REJECTED**\n', 'fail'],
    ] as const;
    for (const [content, verdict] of samples) {
      expect(parseReviewVerdict('code-logic-review.md', content, 'digest', 7)).toEqual(
        expect.objectContaining({ verdict, modifiedAt: 7 }),
      );
    }
    expect(parseReviewVerdict('code-logic-review.md', '**Verdict:** pending', 'digest', 0)).toBeNull();
  });
  it('classifies planning-document reviews apart from work reviews', () => {
    for (const file of ['implementation-plan-review.md', 'plan-review.md', 'architecture-review.md',
      'design-spec-review.md', 'task-description-review.md']) {
      expect(isDocumentReview(file)).toBe(true);
    }
    for (const file of ['code-logic-review.md', 'code-logic-review-phase-a.md', 'visual-review-home.md',
      'test-report.md', 'judge-round-1.json', 'code-style-review-planner.md']) {
      expect(isDocumentReview(file)).toBe(false);
    }
  });
  describe('taskVerdict', () => {
    const review = (file: string, verdict: 'pass' | 'fail', modifiedAt: number): SpecReviewVerdict => ({
      file, digest: 'd', verdict, runId: null, sessionId: null, batch: null, taskId: null, modifiedAt,
    });
    it('fails a cancelled task regardless of reviews', () => {
      expect(taskVerdict({ taskStatus: 'cancelled', reviews: [] })).toBe('failed');
      expect(taskVerdict({ taskStatus: 'cancelled', reviews: [review('code-logic-review.md', 'pass', 1)] })).toBe('failed');
    });
    it('uses the latest work review of a done task', () => {
      expect(taskVerdict({ taskStatus: 'done', reviews: [review('code-logic-review.md', 'pass', 5)] })).toBe('succeeded');
      expect(taskVerdict({ taskStatus: 'done', reviews: [review('code-logic-review.md', 'fail', 5)] })).toBe('failed');
      // REVISE first, APPROVED later -> succeeded.
      expect(taskVerdict({ taskStatus: 'done', reviews: [
        review('code-logic-review.md', 'fail', 1), review('code-logic-review-phase-b.md', 'pass', 9),
      ] })).toBe('succeeded');
      // APPROVED first, a later rejecting test report -> failed.
      expect(taskVerdict({ taskStatus: 'done', reviews: [
        review('code-style-review.md', 'pass', 1), review('test-report.md', 'fail', 9),
      ] })).toBe('failed');
    });
    it('ignores document reviews and leaves a done task without a work review unreconciled', () => {
      expect(taskVerdict({ taskStatus: 'done', reviews: [] })).toBeNull();
      expect(taskVerdict({ taskStatus: 'done', reviews: [review('implementation-plan-review.md', 'pass', 9)] })).toBeNull();
      expect(taskVerdict({ taskStatus: 'done', reviews: [
        review('code-logic-review.md', 'fail', 1), review('implementation-plan-review.md', 'pass', 9),
      ] })).toBe('failed');
    });
    it('leaves ambiguous ties and unfinished tasks unreconciled', () => {
      expect(taskVerdict({ taskStatus: 'done', reviews: [
        review('code-logic-review.md', 'pass', 4), review('code-style-review.md', 'fail', 4),
      ] })).toBeNull();
      expect(taskVerdict({ taskStatus: 'done', reviews: [
        review('code-logic-review.md', 'pass', 4), review('code-style-review.md', 'pass', 4),
      ] })).toBe('succeeded');
      for (const taskStatus of ['backlog', 'in_progress', 'in_review', 'blocked'] as const) {
        expect(taskVerdict({ taskStatus, reviews: [review('code-logic-review.md', 'pass', 1)] })).toBeNull();
      }
    });
  });
  describe('normalizeExecutor', () => {
    it('reduces a decorated executor to a single slug', () => {
      expect(normalizeExecutor('**backend-developer**')).toBe(
        'backend-developer',
      );
      expect(normalizeExecutor('[frontend-developer | fallback]')).toBe(
        'frontend-developer',
      );
      expect(normalizeExecutor('senior-tester, fallback')).toBe(
        'senior-tester',
      );
    });
  });

  describe('detectStatus', () => {
    it('classifies word-token statuses only (no emoji)', () => {
      expect(detectStatus('Batch 1: Backend — COMPLETE')).toBe('COMPLETE');
      expect(detectStatus('Batch 2: Frontend — FAILED')).toBe('FAILED');
      expect(detectStatus('Batch 3 — IN PROGRESS')).toBeNull();
      expect(detectStatus('Batch 4 — IMPLEMENTED')).toBeNull();
      expect(detectStatus('Batch 5 — PENDING')).toBeNull();
      expect(detectStatus('done but COMPLETE and FAILED')).toBe('FAILED');
    });
  });

  describe('parseBatchVerdicts', () => {
    it('returns one verdict per batch keyed on executor', () => {
      const verdicts = parseBatchVerdicts(TASKS_MD);
      expect(verdicts).toEqual([
        { slug: 'backend-developer', status: 'COMPLETE' },
        { slug: 'frontend-developer', status: 'FAILED' },
      ]);
    });

    it('skips batches without a resolvable executor', () => {
      const md = `## Batch 1: Orphan — COMPLETE\n\nno executor here\n`;
      expect(parseBatchVerdicts(md)).toEqual([]);
    });
  });
});

describe('extractSpec', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-extract-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeSpec(name: string): Promise<string> {
    const specDir = join(dir, name);
    await mkdir(specDir, { recursive: true });
    return specDir;
  }

  it('marks a spec completed via task.md status: done and parses batches', async () => {
    const specDir = await makeSpec('TASK_2026_001');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_001', 'done'),
      'utf8',
    );
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    await writeFile(
      join(specDir, 'code-logic-review.md'),
      'VERDICT: missing error handling',
      'utf8',
    );

    const spec = await extractSpec(specDir);
    expect(spec).not.toBeNull();
    expect(spec?.taskId).toBe('TASK_2026_001');
    expect(spec?.taskStatus).toBe('done');
    expect(spec?.completed).toBe(true);
    expect(spec?.harvested).toBe(false);
    expect(spec?.batches).toHaveLength(2);
    expect(spec?.reviewFindings).toContain('missing error handling');
  });

  it('treats status: cancelled as completed (harvest-eligible)', async () => {
    const specDir = await makeSpec('TASK_2026_004');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_004', 'cancelled'),
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec?.completed).toBe(true);
    expect(spec?.taskStatus).toBe('cancelled');
    expect(spec && taskVerdict(spec)).toBe('failed');
  });

  it('treats an in-progress task.md as not completed', async () => {
    const specDir = await makeSpec('TASK_2026_002');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_002', 'in_progress'),
      'utf8',
    );
    await writeFile(
      join(specDir, 'tasks.md'),
      `## Batch 1: Backend — IN PROGRESS\n\n**Recommended Executor**: backend-developer\n`,
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec?.completed).toBe(false);
    expect(spec?.taskStatus).toBe('in_progress');
  });

  it('skips a folder with no task.md carrier', async () => {
    const specDir = await makeSpec('TASK_2026_LEGACY');
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    const spec = await extractSpec(specDir);
    expect(spec).toBeNull();
  });

  it('reads batches.md for the per-batch verdicts', async () => {
    const specDir = await makeSpec('TASK_2026_010');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_010', 'done'),
      'utf8',
    );
    await writeFile(join(specDir, 'batches.md'), TASKS_MD, 'utf8');

    const spec = await extractSpec(specDir);
    expect(spec?.batches).toEqual([
      { slug: 'backend-developer', status: 'COMPLETE' },
      { slug: 'frontend-developer', status: 'FAILED' },
    ]);
  });

  it('falls back to the legacy tasks.md name — permanently', async () => {
    const specDir = await makeSpec('TASK_2026_011');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_011', 'done'),
      'utf8',
    );
    // Only the pre-rename name exists. Task folders are gitignored, so this is
    // the steady state for every folder created before the rename — it must
    // keep working forever, not warn and not degrade.
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');

    const spec = await extractSpec(specDir);
    expect(spec?.batches).toEqual([
      { slug: 'backend-developer', status: 'COMPLETE' },
      { slug: 'frontend-developer', status: 'FAILED' },
    ]);
  });

  it('prefers batches.md when both names are present', async () => {
    const specDir = await makeSpec('TASK_2026_012');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_012', 'done'),
      'utf8',
    );
    await writeFile(
      join(specDir, 'batches.md'),
      `## Batch 1: Current — COMPLETE\n\n**Recommended Executor**: senior-tester\n`,
      'utf8',
    );
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');

    const spec = await extractSpec(specDir);
    expect(spec?.batches).toEqual([
      { slug: 'senior-tester', status: 'COMPLETE' },
    ]);
  });

  it('skips a folder whose task.md has unparseable YAML frontmatter', async () => {
    const specDir = await makeSpec('TASK_2026_BADYAML');
    await writeFile(
      join(specDir, 'task.md'),
      `---\nstatus: done\n  title: : : broken\n   - nope\n---\n\nbody\n`,
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec).toBeNull();
  });

  it('skips a folder whose task.md has an invalid status', async () => {
    const specDir = await makeSpec('TASK_2026_005');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_005', 'wip'),
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec).toBeNull();
  });

  it('detects the harvested marker', async () => {
    const specDir = await makeSpec('TASK_2026_003');
    await writeFile(
      join(specDir, 'task.md'),
      taskMd('TASK_2026_003', 'done'),
      'utf8',
    );
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    await writeFile(
      join(specDir, HARVEST_MARKER_FILE),
      JSON.stringify({
        taskId: 'TASK_2026_003',
        harvestedAt: 1,
        reconciledCount: 2,
      }),
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec?.harvested).toBe(true);
  });

  it('records a bounded diagnostic for malformed judge JSON and changes the artifact digest after correction', async () => {
    const specDir = await makeSpec('TASK_2026_300');
    await writeFile(join(specDir, 'task.md'), taskMd('TASK_2026_300', 'done'), 'utf8');
    await writeFile(join(specDir, 'judge-round-1.json'), '{broken', 'utf8');
    const before = await extractSpec(specDir);
    expect(before?.reviews).toEqual([]);
    expect(before?.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('judge-round-1.json')]));
    await writeFile(join(specDir, 'judge-round-1.json'), '{"taskId":"TASK_2026_300","pass":true}', 'utf8');
    const after = await extractSpec(specDir);
    expect(after?.artifactDigest).not.toBe(before?.artifactDigest);
    expect(after?.reviews).toEqual([expect.objectContaining({ verdict: 'pass' })]);
  });

  it('records one bounded diagnostic for review text without a verdict', async () => {
    const specDir = await makeSpec('TASK_2026_302');
    await writeFile(join(specDir, 'task.md'), taskMd('TASK_2026_302', 'done'), 'utf8');
    await writeFile(join(specDir, 'code-logic-review.md'), 'Sensitive review content without a verdict', 'utf8');
    const spec = await extractSpec(specDir);
    expect(spec?.diagnostics).toEqual(['code-logic-review.md: invalid or missing terminal verdict']);
    expect(spec?.diagnostics.join(' ')).not.toContain('Sensitive');
  });

  it('reads suffixed review files with their mtimes and derives the task verdict', async () => {
    const specDir = await makeSpec('TASK_2026_303');
    await writeFile(join(specDir, 'task.md'), taskMd('TASK_2026_303', 'done'), 'utf8');
    const files: Array<[string, string, number]> = [
      ['code-logic-review-phase-a.md', '**Verdict:** REVISE', 1_000],
      ['visual-review-home.md', 'Verdict: **APPROVED**', 2_000],
      ['test-report-batch-2.md', '**Verdict: PASS**', 3_000],
      ['implementation-plan-review.md', 'Verdict: REJECTED', 9_000],
      ['research-report.md', 'Verdict: REJECTED', 9_500],
    ];
    for (const [file, content, seconds] of files) {
      await writeFile(join(specDir, file), content, 'utf8');
      await utimes(join(specDir, file), seconds, seconds);
    }
    const spec = await extractSpec(specDir);
    expect(spec?.reviews.map((review) => [review.file, review.verdict, review.modifiedAt])).toEqual([
      ['code-logic-review-phase-a.md', 'fail', 1_000_000],
      ['implementation-plan-review.md', 'fail', 9_000_000],
      ['test-report-batch-2.md', 'pass', 3_000_000],
      ['visual-review-home.md', 'pass', 2_000_000],
    ]);
    expect(spec?.reviewFindings).not.toContain('research-report.md');
    // The plan review is newest but is a document review; the test report decides.
    expect(spec && taskVerdict(spec)).toBe('succeeded');
  });

  it('rejects a task folder outside the supplied specs root', async () => {
    const specDir = await makeSpec('TASK_2026_301');
    await writeFile(join(specDir, 'task.md'), taskMd('TASK_2026_301', 'done'), 'utf8');
    expect(await extractSpec(specDir, join(dir, 'different-root'))).toBeNull();
  });
});
