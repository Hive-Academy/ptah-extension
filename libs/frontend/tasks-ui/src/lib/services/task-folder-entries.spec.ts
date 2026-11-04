import type { TaskSpecDetail } from '@ptah-extension/shared';
import {
  buildNestedFolderEntries,
  buildRootFolderEntries,
  folderBreadcrumbs,
  isDirectChildName,
  isOpenableRootFile,
  isValidFolderDirectory,
  parseFolderEntries,
  rootEntriesOf,
  type TaskFolderRawEntry,
} from './task-folder-entries';

function detail(
  partial: Pick<TaskSpecDetail, 'artifacts'> & Partial<TaskSpecDetail>,
): TaskSpecDetail {
  return {
    id: 'TASK_2026_001',
    folderName: 'TASK_2026_001',
    status: 'backlog',
    type: 'FEATURE',
    title: 'A task',
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    body: '',
    ...partial,
  };
}

const file = (name: string): TaskFolderRawEntry => ({ name, kind: 'file' });

describe('isDirectChildName', () => {
  it.each(['context.md', 'prototype', 'a.b-c_d.md'])('accepts %s', (name) => {
    expect(isDirectChildName(name)).toBe(true);
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'C:x', '%2e%2e', 'a\0b'])(
    'rejects %j',
    (name) => {
      expect(isDirectChildName(name)).toBe(false);
    },
  );
});

describe('isValidFolderDirectory', () => {
  it('accepts the root and nested paths up to the depth limit', () => {
    expect(isValidFolderDirectory('')).toBe(true);
    expect(isValidFolderDirectory('prototype')).toBe(true);
    expect(isValidFolderDirectory('a/b/c/d')).toBe(true);
  });

  it('rejects traversal, empty segments and paths deeper than four', () => {
    expect(isValidFolderDirectory('a/../b')).toBe(false);
    expect(isValidFolderDirectory('a//b')).toBe(false);
    expect(isValidFolderDirectory('/a')).toBe(false);
    expect(isValidFolderDirectory('a/b/c/d/e')).toBe(false);
  });
});

describe('folderBreadcrumbs', () => {
  it('builds one crumb per segment with cumulative paths', () => {
    expect(folderBreadcrumbs('TASK_1', 'prototype/assets')).toEqual([
      { label: 'TASK_1', path: '' },
      { label: 'prototype', path: 'prototype' },
      { label: 'assets', path: 'prototype/assets' },
    ]);
  });
});

describe('parseFolderEntries', () => {
  it('drops malformed, unsafe and duplicate entries', () => {
    expect(
      parseFolderEntries([
        { name: 'ok.md', kind: 'file' },
        { name: '../x', kind: 'file' },
        { name: 'bad-kind', kind: 'socket' },
        { name: 5, kind: 'file' },
        null,
        { name: 'ok.md', kind: 'directory' },
      ]),
    ).toEqual([{ name: 'ok.md', kind: 'file' }]);
    expect(parseFolderEntries('nope')).toEqual([]);
  });
});

describe('rootEntriesOf', () => {
  it('prefers typed entries', () => {
    expect(
      rootEntriesOf(
        detail({
          artifacts: ['context.md'],
          entries: [{ name: 'prototype', kind: 'directory' }],
        }),
      ),
    ).toEqual([{ name: 'prototype', kind: 'directory' }]);
  });

  it('falls back to artifacts as files', () => {
    expect(rootEntriesOf(detail({ artifacts: ['context.md'] }))).toEqual([
      file('context.md'),
    ]);
  });
});

describe('buildRootFolderEntries', () => {
  it('lists actual entries and the expected workflow documents that are missing', () => {
    const rows = buildRootFolderEntries([
      file('task.md'),
      file('context.md'),
      file('decisions.md'),
      file('Notes.TXT'),
      { name: 'prototype', kind: 'directory' },
      { name: 'link.md', kind: 'symlink' },
    ]);

    const carrier = rows[0];
    expect(carrier).toMatchObject({
      name: 'task.md',
      role: 'carrier',
      readable: false,
      openable: true,
    });

    const context = rows.find((row) => row.name === 'context.md');
    expect(context).toMatchObject({
      presence: 'present',
      role: 'workflow',
      readable: true,
      openable: true,
    });

    const plan = rows.find((row) => row.name === 'implementation-plan.md');
    expect(plan).toMatchObject({
      presence: 'missing',
      role: 'workflow',
      readable: false,
      openable: false,
    });

    expect(rows.find((row) => row.name === 'decisions.md')).toMatchObject({
      role: 'extra',
      readable: true,
    });
    // Ineligible names and non-files stay visible, without the reader.
    expect(rows.find((row) => row.name === 'Notes.TXT')).toMatchObject({
      readable: false,
      openable: true,
    });
    expect(rows.find((row) => row.name === 'link.md')).toMatchObject({
      kind: 'symlink',
      readable: false,
      openable: false,
    });
    // Directories come last.
    expect(rows[rows.length - 1]).toMatchObject({
      name: 'prototype',
      kind: 'directory',
    });
  });

  it('lets legacy tasks.md satisfy the batch stage', () => {
    const rows = buildRootFolderEntries([file('tasks.md')]);
    expect(rows.find((row) => row.name === 'batches.md')).toBeUndefined();
    expect(rows.find((row) => row.name === 'tasks.md')).toMatchObject({
      role: 'legacy',
      presence: 'present',
      readable: true,
    });
  });

  it('shows a missing batches.md when neither batch file exists', () => {
    const rows = buildRootFolderEntries([]);
    expect(rows.find((row) => row.name === 'batches.md')).toMatchObject({
      presence: 'missing',
    });
    expect(rows.some((row) => row.presence === 'present')).toBe(false);
  });
});

describe('buildNestedFolderEntries', () => {
  it('offers navigation only', () => {
    expect(
      buildNestedFolderEntries([
        { name: 'assets', kind: 'directory' },
        file('index.md'),
      ]),
    ).toEqual([
      expect.objectContaining({ name: 'index.md', readable: false, openable: false }),
      expect.objectContaining({ name: 'assets', kind: 'directory' }),
    ]);
  });
});

describe('isOpenableRootFile', () => {
  it('accepts a listed direct-child file only', () => {
    const d = detail({
      artifacts: ['context.md'],
      entries: [
        { name: 'context.md', kind: 'file' },
        { name: 'prototype', kind: 'directory' },
      ],
    });
    expect(isOpenableRootFile(d, 'context.md')).toBe(true);
    expect(isOpenableRootFile(d, 'prototype')).toBe(false);
    expect(isOpenableRootFile(d, '../context.md')).toBe(false);
    expect(isOpenableRootFile(d, 'missing.md')).toBe(false);
  });
});
