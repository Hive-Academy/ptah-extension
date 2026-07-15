import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectStatus,
  extractSpec,
  normalizeExecutor,
  parseBatchVerdicts,
  HARVEST_MARKER_FILE,
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
  });

  it('skips a folder with no task.md carrier', async () => {
    const specDir = await makeSpec('TASK_2026_LEGACY');
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    const spec = await extractSpec(specDir);
    expect(spec).toBeNull();
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
});
