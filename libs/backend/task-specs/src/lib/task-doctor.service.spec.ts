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
