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

## Batch 1: Backend [✅ COMPLETE]

**Recommended Executor**: backend-developer
**Execution Mode**: sequential

### Task 1.1: Do the thing [✅ COMPLETE]

## Batch 2: Frontend [❌ FAILED]

**Recommended Executor**: frontend-developer | fallback

### Task 2.1: Build UI [FAILED]
`;

describe('spec-extractor pure parsers', () => {
  describe('normalizeExecutor', () => {
    it('reduces a decorated executor to a single slug', () => {
      expect(normalizeExecutor('**backend-developer**')).toBe(
        'backend-developer',
      );
      expect(normalizeExecutor('[frontend-developer | codex]')).toBe(
        'frontend-developer',
      );
      expect(normalizeExecutor('senior-tester, fallback')).toBe(
        'senior-tester',
      );
    });
  });

  describe('detectStatus', () => {
    it('prefers FAILED, treats pending markers as unresolved', () => {
      expect(detectStatus('[✅ COMPLETE]')).toBe('COMPLETE');
      expect(detectStatus('[❌ FAILED]')).toBe('FAILED');
      expect(detectStatus('[🔄 IN PROGRESS]')).toBeNull();
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
      const md = `## Batch 1: Orphan [✅ COMPLETE]\n\nno executor here\n`;
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

  it('marks a spec completed via future-enhancements.md and parses batches', async () => {
    const specDir = await makeSpec('TASK_2026_001');
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    await writeFile(
      join(specDir, 'future-enhancements.md'),
      '# Future\n',
      'utf8',
    );
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

  it('treats an in-progress tasks.md (no completion markers) as not completed', async () => {
    const specDir = await makeSpec('TASK_2026_002');
    await writeFile(
      join(specDir, 'tasks.md'),
      `## Batch 1: Backend [🔄 IN PROGRESS]\n\n**Recommended Executor**: backend-developer\n`,
      'utf8',
    );
    const spec = await extractSpec(specDir);
    expect(spec?.completed).toBe(false);
  });

  it('detects the harvested marker', async () => {
    const specDir = await makeSpec('TASK_2026_003');
    await writeFile(join(specDir, 'tasks.md'), TASKS_MD, 'utf8');
    await writeFile(join(specDir, 'future-enhancements.md'), '#', 'utf8');
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
