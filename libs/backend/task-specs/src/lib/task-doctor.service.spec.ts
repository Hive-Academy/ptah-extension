/**
 * `TaskDoctorService` — the four properties that make the doctor safe to ship.
 *
 * These are not coverage tests. Each one pins a property whose failure mode is
 * silent data loss in a GITIGNORED tree, where there is no `git checkout` to
 * fall back on:
 *
 *   1. A failed journal write mutates NOTHING.
 *   2. Finished work adopts as finished, and always says the status was guessed.
 *   3. `apply()` → `undo()` restores the tree byte-for-byte, deletions included.
 *   4. An unreadable contract stamp refuses to run rather than guessing.
 */
import * as path from 'path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { NoOpTaskIndexNotifier } from './task-index.port';
import { parseTaskFile } from './task-frontmatter';
import { TaskWriterService } from './task-writer.service';
import { TaskDoctorService } from './task-doctor.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const ROOT = 'd:/tmp/ws-doctor';
const SPECS = path.join(normalizeWorkspaceRoot(ROOT), '.ptah', 'specs');

function makeDoctor() {
  const fs = createMockFileSystemProvider();
  const writer = new TaskWriterService(
    fs,
    makeLogger(),
    new NoOpTaskIndexNotifier(),
  );
  const doctor = new TaskDoctorService(fs, makeLogger(), writer);
  return { fs, writer, doctor };
}

function specPath(folder: string, file: string): string {
  return path.join(SPECS, folder, file);
}

/** Snapshot every file in the mock FS as `path → bytes`, for byte comparison. */
function snapshot(fs: ReturnType<typeof createMockFileSystemProvider>) {
  const out = new Map<string, string>();
  for (const [key, bytes] of fs.__state.files) {
    out.set(key, Buffer.from(bytes).toString('base64'));
  }
  return out;
}

describe('TaskDoctorService.plan', () => {
  it('never writes anything', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_155', 'context.md'), '# Orphan\n');
    fs.writeFile.mockClear();
    fs.writeFileBytes.mockClear();
    fs.delete.mockClear();

    const result = await doctor.plan(ROOT);

    expect(result.ok).toBe(true);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.writeFileBytes).not.toHaveBeenCalled();
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('infers `done` — NOT `backlog` — for a folder carrying a test report', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_160', 'context.md'), '# Shipped\n');
    await fs.writeFile(
      specPath('TASK_2026_160', 'test-report.md'),
      'all green',
    );

    const result = await doctor.plan(ROOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_160',
    );
    expect(action).toBeDefined();
    if (action?.kind !== 'adopt') return;
    expect(action.status).toBe('done');
    expect(action.inferredFrom).toContain('test-report.md');
    expect(action.title).toBe('Shipped');
  });

  it('infers `done` for a folder carrying only a review document', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(
      specPath('TASK_2026_161', 'code-logic-review.md'),
      'reviewed',
    );

    const result = await doctor.plan(ROOT);
    if (!result.ok) return;
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_161',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.status).toBe('done');
  });

  it('leaves a mismatched frontmatter id as a WARNING with no action', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(
      specPath('TASK_2026_176', 'task.md'),
      [
        '---',
        'id: TASK_2026_178',
        'status: in_progress',
        'type: FEATURE',
        'title: Declared a different id',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );

    const result = await doctor.plan(ROOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.warnings).toContainEqual(
      expect.objectContaining({
        folderName: 'TASK_2026_176',
        code: 'id_mismatch',
      }),
    );
    // The mismatch is information, not a defect to repair.
    expect(result.plan.actions).toHaveLength(0);
  });

  /**
   * Cross-file warnings (TASK_2026_181).
   *
   * The doctor reports all four and repairs none. The assertion that matters
   * most is the last one: `actions` stays empty. A "normalize metadata" action
   * would rewrite carriers the user never asked about, in a tree with no undo
   * outside the journal.
   */
  it('reports the four cross-file problems and repairs NONE of them', async () => {
    const { fs, doctor } = makeDoctor();

    function carrier(folder: string, extra: readonly string[]): string {
      return [
        '---',
        'status: backlog',
        'type: FEATURE',
        `title: ${folder}`,
        ...extra,
        '---',
        '',
        'body',
        '',
      ].join('\n');
    }

    // A 2-cycle no single carrier can prove on its own.
    await fs.writeFile(
      specPath('TASK_2026_140', 'task.md'),
      carrier('TASK_2026_140', ['parent: TASK_2026_141']),
    );
    await fs.writeFile(
      specPath('TASK_2026_141', 'task.md'),
      carrier('TASK_2026_141', ['parent: TASK_2026_140']),
    );
    // A parent naming nothing.
    await fs.writeFile(
      specPath('TASK_2026_142', 'task.md'),
      carrier('TASK_2026_142', ['parent: TASK_2026_999']),
    );
    // A two-level parent claim: 144 -> 143 -> 142.
    await fs.writeFile(
      specPath('TASK_2026_143', 'task.md'),
      carrier('TASK_2026_143', ['parent: TASK_2026_142']),
    );
    await fs.writeFile(
      specPath('TASK_2026_144', 'task.md'),
      carrier('TASK_2026_144', ['parent: TASK_2026_143']),
    );
    // A relation entry naming nothing.
    await fs.writeFile(
      specPath('TASK_2026_145', 'task.md'),
      carrier('TASK_2026_145', ['relates_to:', '  - TASK_2026_998']),
    );

    const before = snapshot(fs);
    const result = await doctor.plan(ROOT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byFolder = new Map(
      result.plan.warnings.map((w) => [w.folderName, w.code]),
    );
    expect(byFolder.get('TASK_2026_140')).toBe('parent_cycle');
    expect(byFolder.get('TASK_2026_141')).toBe('parent_cycle');
    expect(byFolder.get('TASK_2026_142')).toBe('dangling_parent');
    expect(byFolder.get('TASK_2026_144')).toBe('parent_depth_exceeded');
    expect(byFolder.get('TASK_2026_145')).toBe('dangling_relation');
    // 143's own claim is honoured — it is not the one making a bad claim.
    expect(byFolder.has('TASK_2026_143')).toBe(false);

    // Reported, never repaired, and `plan()` is READ-ONLY.
    expect(result.plan.actions).toHaveLength(0);
    expect(snapshot(fs)).toEqual(before);
  });

  it('REFUSES to run when the contract stamp exists but is unreadable (fail-closed)', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_155', 'context.md'), '# Orphan\n');
    await fs.writeFile(
      path.join(SPECS, '.ptah-spec-contract.json'),
      '{ this is not json',
    );

    const result = await doctor.plan(ROOT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STAMP_UNREADABLE');
  });
});

// ---------------------------------------------------------------------------
// The defect batch found by the first production run — 2026-08-09
// ---------------------------------------------------------------------------

/**
 * Every case below is a real folder from this workspace's adoption run, not a
 * constructed edge. The doctor got each of them wrong the first time it was
 * pointed at real data, which is the only reason these tests exist.
 */
describe('TaskDoctorService.plan — evidence the doctor used to discard', () => {
  it('D1: a NON-CANONICAL review filename still proves the work finished', async () => {
    const { fs, doctor } = makeDoctor();
    // `TASK_2026_161`, verbatim. None of these three names is in `DOC_FILES`,
    // so intersecting with that closed set yielded no evidence at all and the
    // doctor planned `backlog` for a task with three shipped commits.
    await fs.writeFile(
      specPath('TASK_2026_161', 'batch2-logic-review.md'),
      'x',
    );
    await fs.writeFile(specPath('TASK_2026_161', 'batch1-report.md'), 'x');
    await fs.writeFile(specPath('TASK_2026_161', 'batch3-report.md'), 'x');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_161',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');

    expect(action.status).toBe('done');
    // Every matching file is cited, so `--plan` output shows WHY.
    expect(action.inferredFrom).toEqual([
      'batch1-report.md',
      'batch2-logic-review.md',
      'batch3-report.md',
    ]);
  });

  it('D1: a folder with no evidence at all is still `backlog`', async () => {
    // The control. Without it, "match a pattern" could degenerate into
    // "call everything done", which fails in the opposite direction.
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_900', 'notes.md'), 'x');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_900',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.status).toBe('backlog');
    expect(action.inferredFrom).toEqual([]);
  });

  it('D2: lifts `type` from a frontmatter block at the head of context.md', async () => {
    const { fs, doctor } = makeDoctor();
    // `TASK_2026_164` / `166` open exactly like this. The doctor read straight
    // past it and proposed FEATURE for all twelve folders.
    await fs.writeFile(
      specPath('TASK_2026_164', 'context.md'),
      [
        '---',
        'id: TASK_2026_164',
        'status: in_progress',
        'type: CREATIVE',
        'title: Reshape the admin dashboard into a task-oriented console',
        '---',
        '',
        '# TASK_2026_164 — Context',
        '',
        'prose',
        '',
      ].join('\n'),
    );
    await fs.writeFile(specPath('TASK_2026_164', 'visual-review.md'), 'x');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_164',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');

    expect(action.type).toBe('CREATIVE');
    expect(action.title).toBe(
      'Reshape the admin dashboard into a task-oriented console',
    );
    // The declared `in_progress` is IGNORED: the artifacts are evidence, the
    // prose is a claim, and `164`'s claim was stale by two commits.
    expect(action.status).toBe('done');
  });

  it('D2: falls back to a `**Type**:` line when there is no frontmatter', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(
      specPath('TASK_2026_170', 'context.md'),
      ['# Real title here', '', '**Type**: BUGFIX', ''].join('\n'),
    );

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_170',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.type).toBe('BUGFIX');
  });

  it('D2: defaults to FEATURE when nothing declares a type', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_901', 'context.md'), '# Untyped\n');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_901',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.type).toBe('FEATURE');
  });

  it('D3: rejects the "<id> — Context" H1 and reads the next prose file', async () => {
    const { fs, doctor } = makeDoctor();
    // The literal shape of `TASK_2026_170/context.md` and
    // `TASK_2026_VOICE_PROVIDERS/context.md`. Proposing it as a title puts a
    // row on the board that restates the id and says nothing.
    await fs.writeFile(
      specPath('TASK_2026_170', 'context.md'),
      '# TASK_2026_170 — Context\n\nprose\n',
    );
    await fs.writeFile(
      specPath('TASK_2026_170', 'code-logic-review.md'),
      '# Guard payload validation across every controller\n\nreview\n',
    );

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_170',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.title).toBe(
      'Guard payload validation across every controller',
    );
  });

  it('D3: with no context.md, takes the H1 from the only file present', async () => {
    const { fs, doctor } = makeDoctor();
    // `TASK_WORKSPACE_SCOPING_REVIEW`: one file, a perfectly serviceable H1,
    // and the doctor proposed the bare folder name.
    await fs.writeFile(
      specPath('TASK_WORKSPACE_SCOPING_REVIEW', 'code-logic-review.md'),
      '# Workspace scoping is applied inconsistently across the read paths\n',
    );

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) =>
        a.kind === 'adopt' && a.folderName === 'TASK_WORKSPACE_SCOPING_REVIEW',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.title).toBe(
      'Workspace scoping is applied inconsistently across the read paths',
    );
  });

  it('D3: the folder name survives as a LAST resort', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_902', 'context.md'), 'no heading\n');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    const action = result.plan.actions.find(
      (a) => a.kind === 'adopt' && a.folderName === 'TASK_2026_902',
    );
    if (action?.kind !== 'adopt') throw new Error('expected an adopt action');
    expect(action.title).toBe('TASK_2026_902');
  });

  /**
   * D — the drift class that produced D1 one layer up.
   *
   * `TASK_2026_179`'s own batch file carried `PENDING` markers for three
   * batches that had shipped. Nothing compared the claim to the disk, so the
   * drift survived until a human looked. This warning is the machine-checkable
   * half of that: a carrier saying `backlog` next to a review has no innocent
   * reading.
   */
  it('warns when a carrier says `backlog` while the folder holds a review', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(
      specPath('TASK_2026_903', 'task.md'),
      [
        '---',
        'id: TASK_2026_903',
        'status: backlog',
        'type: FEATURE',
        'title: Claims to be unstarted',
        'depends_on: []',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );
    await fs.writeFile(
      specPath('TASK_2026_903', 'batch2-logic-review.md'),
      'x',
    );

    const before = snapshot(fs);
    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');

    const warning = result.plan.warnings.find(
      (w) => w.folderName === 'TASK_2026_903',
    );
    expect(warning?.code).toBe('status_contradicted_by_artifacts');
    expect(warning?.message).toContain('batch2-logic-review.md');
    // REPORTED, never repaired — no action, and not one byte moved.
    expect(result.plan.actions).toHaveLength(0);
    expect(snapshot(fs)).toEqual(before);
  });

  it('stays SILENT for `in_progress` next to a review — ordinary mid-flight state', async () => {
    // The false-positive control. A diagnostic that fires on normal work gets
    // ignored, and an ignored diagnostic is worse than none.
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(
      specPath('TASK_2026_904', 'task.md'),
      [
        '---',
        'id: TASK_2026_904',
        'status: in_progress',
        'type: FEATURE',
        'title: Mid-flight',
        'depends_on: []',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );
    await fs.writeFile(specPath('TASK_2026_904', 'code-logic-review.md'), 'x');

    const result = await doctor.plan(ROOT);
    if (!result.ok) throw new Error('plan failed');
    expect(
      result.plan.warnings.filter(
        (w) => w.code === 'status_contradicted_by_artifacts',
      ),
    ).toEqual([]);
  });
});

describe('TaskDoctorService.apply — D4', () => {
  it('forwards a plan-supplied description onto the written carrier', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_905', 'context.md'), '# Adopt me\n');

    const planned = await doctor.plan(ROOT);
    if (!planned.ok) throw new Error('plan failed');

    // The human-in-the-loop contract: the caller edits the plan and hands it
    // back. Before D4 the field was declared nowhere on `AdoptAction`, so a
    // description could not survive the trip even though `adoptFolder` and
    // `renderTaskMd` both accept one.
    const description =
      'A description with a colon: braces {"a": 1} and it\'s "quoted".';
    for (const action of planned.plan.actions) {
      if (action.kind === 'adopt') action.description = description;
    }

    const applied = await doctor.apply(planned.plan);
    expect(applied.ok).toBe(true);

    const raw = await fs.readFile(specPath('TASK_2026_905', 'task.md'));
    const parsed = parseTaskFile('TASK_2026_905', raw);
    if (parsed.kind !== 'task') {
      throw new Error(`carrier excluded: ${parsed.excluded.reason}`);
    }
    expect(parsed.task.description).toBe(description);
    // Adoption ALWAYS says the status was guessed, description or not.
    expect(raw).toContain('status_inferred: true');
  });
});

describe('TaskDoctorService.apply', () => {
  it('mutates NOTHING when the journal write fails (fail-closed, R7)', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_155', 'context.md'), '# Orphan\n');
    await fs.writeFile(specPath('TASK_2026_155', 'tasks.md'), 'legacy batches');

    const planned = await doctor.plan(ROOT);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.actions.length).toBeGreaterThan(0);

    const before = snapshot(fs);

    // The journal is the ONLY undo. If it cannot be written, no mutation is
    // permitted to happen at all.
    const realWriteFile = fs.writeFile.getMockImplementation();
    if (!realWriteFile) throw new Error('mock writeFile missing');
    fs.writeFile.mockImplementation(async (target: string, content: string) => {
      if (target.endsWith('.doctor-journal.json')) {
        throw new Error('EACCES: journal write denied');
      }
      return realWriteFile(target, content) as Promise<void>;
    });
    fs.writeFileBytes.mockClear();
    fs.delete.mockClear();

    const result = await doctor.apply(planned.plan);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('JOURNAL_WRITE_FAILED');
    expect(result.applied).toEqual([]);

    // ZERO filesystem mutations — assert on the bytes, not on call counts.
    fs.writeFile.mockImplementation(realWriteFile);
    expect(snapshot(fs)).toEqual(before);
    expect(fs.writeFileBytes).not.toHaveBeenCalled();
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('adopts an orphan as `done` with an explicit status_inferred tag', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_164', 'context.md'), '# Finished\n');
    await fs.writeFile(specPath('TASK_2026_164', 'test-report.md'), 'green');

    const planned = await doctor.plan(ROOT);
    if (!planned.ok) return;
    const result = await doctor.apply(planned.plan);
    expect(result.ok).toBe(true);

    const raw = await fs.readFile(specPath('TASK_2026_164', 'task.md'));
    expect(raw).toContain('status_inferred: true');

    const parsed = parseTaskFile('TASK_2026_164', raw);
    expect(parsed.kind).toBe('task');
    if (parsed.kind !== 'task') return;
    expect(parsed.task.status).toBe('done');
    // The inferred tag must not degrade the carrier into a warning state.
    expect(parsed.task.validationIssues).toEqual([]);
  });

  it('renames the legacy batch file and stamps the contract version', async () => {
    const { fs, doctor } = makeDoctor();
    await fs.writeFile(specPath('TASK_2026_165', 'task.md'), carrier());
    await fs.writeFile(specPath('TASK_2026_165', 'tasks.md'), '# Batches\n');

    const planned = await doctor.plan(ROOT);
    if (!planned.ok) return;
    expect(planned.plan.stampVersion).toBeNull();

    await doctor.apply(planned.plan);

    expect(await fs.readFile(specPath('TASK_2026_165', 'batches.md'))).toBe(
      '# Batches\n',
    );
    expect(await fs.exists(specPath('TASK_2026_165', 'tasks.md'))).toBe(false);
    expect(await fs.exists(path.join(SPECS, '.ptah-spec-contract.json'))).toBe(
      true,
    );
  });
});

describe('TaskDoctorService.undo', () => {
  it('restores the tree byte-for-byte, including the bytes of a deleted file', async () => {
    const { fs, doctor } = makeDoctor();

    // An orphan to adopt (a CREATION) …
    await fs.writeFile(specPath('TASK_2026_166', 'context.md'), '# Orphan\n');
    // … and a legacy batch file to rename (a creation AND a deletion whose
    // bytes only the journal can bring back).
    await fs.writeFile(specPath('TASK_2026_167', 'task.md'), carrier());
    const legacyBytes = '# Batches\r\n\r\nCRLF and trailing spaces   \n';
    await fs.writeFile(specPath('TASK_2026_167', 'tasks.md'), legacyBytes);

    const before = snapshot(fs);

    const planned = await doctor.plan(ROOT);
    if (!planned.ok) return;
    const applied = await doctor.apply(planned.plan);
    expect(applied.ok).toBe(true);

    // Sanity: the tree really did change.
    expect(snapshot(fs)).not.toEqual(before);

    const undone = await doctor.undo(ROOT);
    expect(undone.ok).toBe(true);
    expect(undone.reverted).toBeGreaterThan(0);

    // Byte-for-byte, and the journal itself is gone.
    expect(snapshot(fs)).toEqual(before);
    expect(await fs.readFile(specPath('TASK_2026_167', 'tasks.md'))).toBe(
      legacyBytes,
    );
    expect(await fs.exists(path.join(SPECS, '.doctor-journal.json'))).toBe(
      false,
    );
  });

  it('reports JOURNAL_NOT_FOUND rather than silently succeeding', async () => {
    const { doctor } = makeDoctor();
    const result = await doctor.undo(ROOT);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('JOURNAL_NOT_FOUND');
  });
});

function carrier(): string {
  return [
    '---',
    'status: in_progress',
    'type: FEATURE',
    'title: Existing carrier',
    '---',
    '',
    'body',
    '',
  ].join('\n');
}
