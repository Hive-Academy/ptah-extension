import 'reflect-metadata';
import type { TaskSpecSummary } from '@ptah-extension/shared';
import { TaskSweepService, type ISweepGitProbe } from './task-sweep.service';

const ROOT = 'D:\\ws';
const NOW = Date.parse('2026-08-11T12:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function task(
  id: string,
  status: TaskSpecSummary['status'],
  updated: string | null,
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title: id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated,
    frontmatterValid: true,
    validationIssues: [],
  };
}

interface Harness {
  service: TaskSweepService;
  deleted: string[];
  deleteMock: jest.Mock;
  showFile: jest.Mock;
}

function build(committed: (taskId: string) => boolean = () => true): Harness {
  const deleted: string[] = [];
  const deleteMock = jest.fn(async (p: string) => {
    deleted.push(p);
  });
  const fs = { delete: deleteMock } as never;
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  } as never;
  const showFile = jest.fn(async (_root: string, relative: string) => {
    const id = relative.split('/')[2] ?? '';
    return { content: committed(id) ? 'id: x\n' : '' };
  });
  const git: ISweepGitProbe = { showFile };
  return {
    service: new TaskSweepService(fs, logger, git),
    deleted,
    deleteMock,
    showFile: showFile as unknown as jest.Mock,
  };
}

describe('TaskSweepService', () => {
  // ---------------------------------------------------------------------------
  // The policy
  // ---------------------------------------------------------------------------

  it('matches only finished tasks past the age boundary', async () => {
    const h = build();
    const result = await h.service.sweep(
      ROOT,
      [
        task('TASK_A', 'done', daysAgo(30)),
        task('TASK_B', 'cancelled', daysAgo(8)),
        task('TASK_C', 'done', daysAgo(3)), // too recent
        task('TASK_D', 'in_review', daysAgo(90)), // live work, any age
        task('TASK_E', 'backlog', daysAgo(400)),
        task('TASK_F', 'blocked', daysAgo(400)),
      ],
      7,
      false,
      NOW,
    );

    expect(result.candidates.map((c) => c.taskId)).toEqual([
      'TASK_B',
      'TASK_A',
    ]);
  });

  /**
   * There is no safe default for an unusable stamp. Treating absent as "old"
   * deletes the carriers whose frontmatter is already damaged — exactly the
   * ones a user is most likely to want to look at.
   */
  it.each([
    ['null', null],
    ['empty', ''],
    ['unparseable', 'not-a-date'],
  ])('never sweeps a task whose updated stamp is %s', async (_l, updated) => {
    const h = build();
    const result = await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', updated)],
      7,
      true,
      NOW,
    );
    expect(result.candidates).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(h.deleteMock).not.toHaveBeenCalled();
  });

  it('treats the boundary itself as old enough', async () => {
    const h = build();
    const result = await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(7))],
      7,
      false,
      NOW,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].ageDays).toBe(7);
  });

  it('orders the preview newest first — the closest call is the one to check', async () => {
    const h = build();
    const result = await h.service.sweep(
      ROOT,
      [
        task('TASK_OLD', 'done', daysAgo(90)),
        task('TASK_NEW', 'done', daysAgo(8)),
        task('TASK_MID', 'done', daysAgo(30)),
      ],
      7,
      false,
      NOW,
    );
    expect(result.candidates.map((c) => c.taskId)).toEqual([
      'TASK_NEW',
      'TASK_MID',
      'TASK_OLD',
    ]);
  });

  // ---------------------------------------------------------------------------
  // Preview writes nothing
  // ---------------------------------------------------------------------------

  it('writes nothing on a preview, and says so', async () => {
    const h = build();
    const result = await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(30))],
      7,
      false,
      NOW,
    );
    expect(result.previewOnly).toBe(true);
    expect(result.deleted).toEqual([]);
    expect(h.deleteMock).not.toHaveBeenCalled();
  });

  /**
   * Preview and apply are the SAME scan. If they could disagree, the list the
   * user confirmed would not be the list that gets deleted.
   */
  it('applies exactly the candidate set the preview reported', async () => {
    const tasks = [
      task('TASK_A', 'done', daysAgo(30)),
      task('TASK_B', 'cancelled', daysAgo(9)),
      task('TASK_C', 'done', daysAgo(2)),
    ];
    const preview = await build().service.sweep(ROOT, tasks, 7, false, NOW);
    const applied = await build().service.sweep(ROOT, tasks, 7, true, NOW);

    expect(applied.candidates.map((c) => c.taskId)).toEqual(
      preview.candidates.map((c) => c.taskId),
    );
    expect(applied.deleted.sort()).toEqual(['TASK_A', 'TASK_B']);
    expect(applied.previewOnly).toBe(false);
  });

  it('deletes the folder recursively, under the spec root', async () => {
    const h = build();
    await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(30))],
      7,
      true,
      NOW,
    );
    expect(h.deleteMock).toHaveBeenCalledTimes(1);
    const [target, options] = h.deleteMock.mock.calls[0];
    expect(String(target)).toContain('TASK_A');
    expect(String(target)).toContain('specs');
    expect(options).toEqual({ recursive: true });
  });

  // ---------------------------------------------------------------------------
  // The safety refusal — this is the property that makes deletion reversible
  // ---------------------------------------------------------------------------

  /**
   * `.ptah/specs` is tracked, so a committed folder survives its own deletion
   * via `git show`. A folder git has never seen has no such copy, and deleting
   * it destroys work outright.
   */
  it('refuses to delete a folder git has never seen, and reports it', async () => {
    const h = build((id) => id !== 'TASK_NEW');
    const result = await h.service.sweep(
      ROOT,
      [
        task('TASK_OLD', 'done', daysAgo(30)),
        task('TASK_NEW', 'done', daysAgo(30)),
      ],
      7,
      true,
      NOW,
    );

    expect(result.deleted).toEqual(['TASK_OLD']);
    expect(result.skipped).toEqual([
      { taskId: 'TASK_NEW', reason: 'uncommitted' },
    ]);
    expect(h.deleted.some((p) => p.includes('TASK_NEW'))).toBe(false);
  });

  it('reports committed=false in the PREVIEW, before anything is deleted', async () => {
    const h = build(() => false);
    const result = await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(30))],
      7,
      false,
      NOW,
    );
    expect(result.candidates[0].committed).toBe(false);
  });

  /**
   * Outside a repo, or with git unavailable, NOTHING is committed and therefore
   * nothing is deletable. Failing closed is the only safe direction here.
   */
  it('deletes nothing when the git probe throws', async () => {
    const h = build();
    h.showFile.mockRejectedValue(new Error('not a git repository'));
    const result = await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(30))],
      7,
      true,
      NOW,
    );
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([
      { taskId: 'TASK_A', reason: 'uncommitted' },
    ]);
  });

  it('probes git with a POSIX pathspec, never a Windows path', async () => {
    const h = build();
    await h.service.sweep(
      ROOT,
      [task('TASK_A', 'done', daysAgo(30))],
      7,
      false,
      NOW,
    );
    const [, relative] = h.showFile.mock.calls[0];
    expect(relative).toBe('.ptah/specs/TASK_A/task.md');
    expect(String(relative)).not.toContain('\\');
  });

  // ---------------------------------------------------------------------------
  // Partial failure
  // ---------------------------------------------------------------------------

  /**
   * One locked folder must not abandon the rest of the run with no way to tell
   * which of sixty were swept.
   */
  it('continues past a failed delete and names the one that failed', async () => {
    const h = build();
    h.deleteMock.mockImplementation(async (p: string) => {
      if (p.includes('TASK_B')) throw new Error('EBUSY');
      h.deleted.push(p);
    });

    const result = await h.service.sweep(
      ROOT,
      [
        task('TASK_A', 'done', daysAgo(30)),
        task('TASK_B', 'done', daysAgo(31)),
        task('TASK_C', 'done', daysAgo(32)),
      ],
      7,
      true,
      NOW,
    );

    expect(result.deleted.sort()).toEqual(['TASK_A', 'TASK_C']);
    expect(result.skipped).toEqual([
      { taskId: 'TASK_B', reason: 'delete_failed' },
    ]);
  });
});
