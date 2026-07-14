import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecHarvesterService } from './spec-harvester.service';
import { HARVEST_MARKER_FILE } from './spec-extractor';

const COMPLETED_TASKS_MD = `## Batch 1: Backend — COMPLETE

**Recommended Executor**: backend-developer

## Batch 2: Frontend — FAILED

**Recommended Executor**: frontend-developer
`;

const IN_PROGRESS_TASKS_MD = `## Batch 1: Backend — IN PROGRESS

**Recommended Executor**: backend-developer
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

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('SpecHarvesterService', () => {
  let root: string;
  let specsRoot: string;
  let store: { reconcileSubagentEvent: jest.Mock };
  let svc: SpecHarvesterService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spec-harvest-'));
    specsRoot = join(root, '.ptah', 'specs');
    await mkdir(specsRoot, { recursive: true });
    store = { reconcileSubagentEvent: jest.fn().mockReturnValue(true) };
    const workspaceProvider = { getWorkspaceRoot: jest.fn(() => root) };
    svc = new SpecHarvesterService(
      makeLogger() as never,
      workspaceProvider as never,
      store as never,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSpec(
    taskId: string,
    opts: {
      tasksMd?: string;
      completed?: boolean;
      harvestedAt?: number;
      review?: string;
    } = {},
  ): Promise<string> {
    const dir = join(specsRoot, taskId);
    await mkdir(dir, { recursive: true });
    const completed = opts.completed !== false;
    // Completion is driven by the `task.md` frontmatter status (no-legacy).
    await writeFile(
      join(dir, 'task.md'),
      taskMd(taskId, completed ? 'done' : 'in_progress'),
      'utf8',
    );
    const tasksMd =
      opts.tasksMd ?? (completed ? COMPLETED_TASKS_MD : IN_PROGRESS_TASKS_MD);
    await writeFile(join(dir, 'tasks.md'), tasksMd, 'utf8');
    if (opts.review) {
      await writeFile(join(dir, 'code-logic-review.md'), opts.review, 'utf8');
    }
    if (opts.harvestedAt !== undefined) {
      await writeFile(
        join(dir, HARVEST_MARKER_FILE),
        JSON.stringify({
          taskId,
          harvestedAt: opts.harvestedAt,
          reconciledCount: 0,
        }),
        'utf8',
      );
    }
    return dir;
  }

  it('harvests completed unharvested specs and writes a marker', async () => {
    const dir = await writeSpec('TASK_2026_001');

    const result = await svc.harvest();

    expect(result.harvested).toBe(1);
    expect(store.reconcileSubagentEvent).toHaveBeenCalledTimes(2);
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'backend-developer', succeeded: true }),
    );
    expect(store.reconcileSubagentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'frontend-developer', isError: true }),
    );
    expect(await fileExists(join(dir, HARVEST_MARKER_FILE))).toBe(true);
  });

  it('skips specs that already carry a harvest marker', async () => {
    await writeSpec('TASK_2026_002', { harvestedAt: 1 });
    const result = await svc.harvest();
    expect(result.harvested).toBe(0);
    expect(store.reconcileSubagentEvent).not.toHaveBeenCalled();
  });

  it('classifies specs for the cleanup UI', async () => {
    await writeSpec('TASK_2026_A', { completed: false }); // active
    await writeSpec('TASK_2026_B'); // complete-unharvested
    await writeSpec('TASK_2026_C', { harvestedAt: 1 }); // harvested

    const specs = await svc.listSpecs();
    const byId = Object.fromEntries(specs.map((s) => [s.taskId, s.status]));
    expect(byId['TASK_2026_A']).toBe('active');
    expect(byId['TASK_2026_B']).toBe('complete-unharvested');
    expect(byId['TASK_2026_C']).toBe('harvested');
  });

  it('archives stale harvested specs and leaves active ones untouched', async () => {
    const staleDir = await writeSpec('TASK_2026_OLD', { harvestedAt: 1 });
    const activeDir = await writeSpec('TASK_2026_LIVE', { completed: false });

    const result = await svc.clearStaleSpecs(undefined, {
      retentionDays: 0,
      mode: 'archive',
    });

    expect(result.cleared).toBe(1);
    expect(result.taskIds).toEqual(['TASK_2026_OLD']);
    expect(await fileExists(staleDir)).toBe(false);
    expect(await fileExists(join(specsRoot, '.archive', 'TASK_2026_OLD'))).toBe(
      true,
    );
    expect(await fileExists(activeDir)).toBe(true);
  });

  it('returns graded findings for a slug from completed specs', async () => {
    await writeSpec('TASK_2026_F', {
      review: 'VERDICT: backend missed a null check',
    });

    const findings = await svc.getRecentFindings('backend-developer');
    expect(findings).toContain('backend missed a null check');

    const none = await svc.getRecentFindings('unrelated-agent');
    expect(none).toBeNull();
  });
});
