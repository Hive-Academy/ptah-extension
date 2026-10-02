import type { GitBranchInfo, GitFileStatus } from '@ptah-extension/shared';
import { parseStatusV2Z } from './git-status-parser';

const MODES = '100644 100644 100644';
const HASHES =
  '1111111111111111111111111111111111111111 2222222222222222222222222222222222222222';
const UNMERGED_MODES = '100644 100644 100644 100644';
const UNMERGED_HASHES =
  '1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333';

/** `1 <XY> ...` record for `path`, NUL-terminated. */
const ordinary = (xy: string, path: string): string =>
  `1 ${xy} N... ${MODES} ${HASHES} ${path}\0`;

/** `2 <XY> ...` record plus its origPath field, both NUL-terminated. */
const renamed = (xy: string, path: string, origPath: string): string =>
  `2 ${xy} N... ${MODES} ${HASHES} R100 ${path}\0${origPath}\0`;

const unmerged = (
  xy: string,
  path: string,
  sub = 'N...',
  modes = UNMERGED_MODES,
): string => `u ${xy} ${sub} ${modes} ${UNMERGED_HASHES} ${path}\0`;

const EMPTY_BRANCH: GitBranchInfo = {
  branch: '',
  upstream: null,
  ahead: 0,
  behind: 0,
};

describe('parseStatusV2Z', () => {
  describe('file records', () => {
    const cases: Array<{
      name: string;
      output: string;
      files: GitFileStatus[];
    }> = [
      {
        name: 'non-ASCII Latin name (café.txt)',
        output: ordinary('.M', 'café.txt'),
        files: [{ path: 'café.txt', status: 'M', staged: false }],
      },
      {
        name: 'CJK name',
        output: ordinary('A.', '文档/报告.md'),
        files: [{ path: '文档/报告.md', status: 'A', staged: true }],
      },
      {
        name: 'Arabic name',
        output: ordinary('.D', 'ملف.txt'),
        files: [{ path: 'ملف.txt', status: 'D', staged: false }],
      },
      {
        name: 'double quote in name (a"b)',
        output: ordinary('M.', 'a"b'),
        files: [{ path: 'a"b', status: 'M', staged: true }],
      },
      {
        name: 'backslash in name (a\\b)',
        output: ordinary('.M', 'a\\b'),
        files: [{ path: 'a\\b', status: 'M', staged: false }],
      },
      {
        name: 'leading space in name',
        output: ordinary('.M', ' lead.txt'),
        files: [{ path: ' lead.txt', status: 'M', staged: false }],
      },
      {
        name: 'trailing space in name',
        output: ordinary('.M', 'trail.txt '),
        files: [{ path: 'trail.txt ', status: 'M', staged: false }],
      },
      {
        name: 'spaces inside name',
        output: ordinary('.M', 'dir name/my file.txt'),
        files: [{ path: 'dir name/my file.txt', status: 'M', staged: false }],
      },
      {
        name: 'staged and unstaged sides of one path',
        output: ordinary('MM', 'both.ts'),
        files: [
          { path: 'both.ts', status: 'M', staged: true },
          { path: 'both.ts', status: 'M', staged: false },
        ],
      },
      {
        name: 'type change T is reported as T',
        output: ordinary('T.', 'link'),
        files: [{ path: 'link', status: 'T', staged: true }],
      },
      {
        name: 'submodule with a new commit is flagged',
        output: `1 .M SC.. 160000 160000 160000 ${HASHES} libs/vendor\0`,
        files: [
          {
            path: 'libs/vendor',
            status: 'M',
            staged: false,
            submodule: true,
          },
        ],
      },
      {
        name: 'staged rename with origPath from the next NUL field',
        output: renamed('R.', 'new name.ts', 'old name.ts'),
        files: [
          {
            path: 'new name.ts',
            status: 'R',
            staged: true,
            origPath: 'old name.ts',
          },
        ],
      },
      {
        name: 'rename with non-ASCII paths and a worktree edit',
        output: renamed('RM', 'café-新.txt', ' ملف '),
        files: [
          {
            path: 'café-新.txt',
            status: 'R',
            staged: true,
            origPath: ' ملف ',
          },
          {
            path: 'café-新.txt',
            status: 'M',
            staged: false,
            origPath: ' ملف ',
          },
        ],
      },
      {
        name: 'unmerged UU row is a content conflict',
        output: unmerged('UU', 'conflict file.txt'),
        files: [
          {
            path: 'conflict file.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'content' },
          },
        ],
      },
      {
        name: 'unmerged DU row is delete-modify',
        output: unmerged('DU', 'gone.txt'),
        files: [
          {
            path: 'gone.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'delete-modify' },
          },
        ],
      },
      {
        name: 'unmerged UD row is delete-modify',
        output: unmerged('UD', 'gone.txt'),
        files: [
          {
            path: 'gone.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'delete-modify' },
          },
        ],
      },
      {
        name: 'unmerged AA row is add-add',
        output: unmerged('AA', 'both added.txt'),
        files: [
          {
            path: 'both added.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'add-add' },
          },
        ],
      },
      {
        name: 'unmerged UA row is a content conflict',
        output: unmerged('UA', 'theirs.txt'),
        files: [
          {
            path: 'theirs.txt',
            status: 'U',
            staged: false,
            conflict: { kind: 'content' },
          },
        ],
      },
      {
        name: 'unmerged row with a symlink stage is a symlink conflict',
        output: unmerged('UU', 'link', 'N...', '100644 120000 100644 120000'),
        files: [
          {
            path: 'link',
            status: 'U',
            staged: false,
            conflict: { kind: 'symlink' },
          },
        ],
      },
      {
        name: 'unmerged submodule wins over add-add',
        output: unmerged(
          'AA',
          'libs/vendor',
          'S...',
          '160000 160000 160000 160000',
        ),
        files: [
          {
            path: 'libs/vendor',
            status: 'U',
            staged: false,
            conflict: { kind: 'submodule' },
            submodule: true,
          },
        ],
      },
      {
        name: 'untracked file',
        output: '? new file.txt\0',
        files: [{ path: 'new file.txt', status: '??', staged: false }],
      },
      {
        name: 'untracked directory',
        output: '? build out/\0',
        files: [
          {
            path: 'build out',
            status: '??',
            staged: false,
            isDirectory: true,
          },
        ],
      },
      {
        name: 'ignored file',
        output: '! debug.log\0',
        files: [{ path: 'debug.log', status: '!', staged: false }],
      },
      {
        name: 'ignored directory',
        output: '! node_modules/\0',
        files: [
          {
            path: 'node_modules',
            status: '!',
            staged: false,
            isDirectory: true,
          },
        ],
      },
    ];

    it.each(cases)('$name', ({ output, files }) => {
      const result = parseStatusV2Z(output);
      expect(result.files).toEqual(files);
      expect(result.skippedRecords).toBe(0);
    });
  });

  describe('branch headers', () => {
    const cases: Array<{
      name: string;
      output: string;
      branch: GitBranchInfo;
    }> = [
      {
        name: 'upstream with ahead and behind',
        output:
          '# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +3 -12\0',
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 3,
          behind: 12,
        },
      },
      {
        name: 'detached HEAD',
        output: '# branch.oid abc123\0# branch.head (detached)\0',
        branch: { branch: 'HEAD', upstream: null, ahead: 0, behind: 0 },
      },
      {
        name: 'no upstream',
        output: '# branch.oid abc123\0# branch.head feature/x\0',
        branch: { branch: 'feature/x', upstream: null, ahead: 0, behind: 0 },
      },
      {
        name: 'initial commit',
        output: '# branch.oid (initial)\0# branch.head main\0',
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      },
      {
        name: 'stash header is accepted and ignored',
        output: '# branch.head main\0# stash 2\0',
        branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      },
    ];

    it.each(cases)('$name', ({ output, branch }) => {
      const result = parseStatusV2Z(output);
      expect(result.branch).toEqual(branch);
      expect(result.files).toEqual([]);
      expect(result.skippedRecords).toBe(0);
    });
  });

  it('returns an empty result for empty output', () => {
    expect(parseStatusV2Z('')).toEqual({
      branch: EMPTY_BRANCH,
      files: [],
      skippedRecords: 0,
    });
  });

  it('parses a full status in order', () => {
    const output =
      '# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -0\0' +
      ordinary('M.', 'src/a.ts') +
      renamed('R.', 'b2.ts', 'b1.ts') +
      unmerged('AA', 'c.ts') +
      '? d.txt\0';

    const result = parseStatusV2Z(output);

    expect(result.branch).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
    });
    expect(result.files).toEqual([
      { path: 'src/a.ts', status: 'M', staged: true },
      { path: 'b2.ts', status: 'R', staged: true, origPath: 'b1.ts' },
      {
        path: 'c.ts',
        status: 'U',
        staged: false,
        conflict: { kind: 'add-add' },
      },
      { path: 'd.txt', status: '??', staged: false },
    ]);
    expect(result.skippedRecords).toBe(0);
  });

  it('parses a final record that lacks its NUL terminator', () => {
    const result = parseStatusV2Z('? tail.txt');
    expect(result.files).toEqual([
      { path: 'tail.txt', status: '??', staged: false },
    ]);
    expect(result.skippedRecords).toBe(0);
  });

  describe('unparseable records are skipped and counted', () => {
    const cases: Array<{
      name: string;
      output: string;
      files: GitFileStatus[];
      skipped: number;
    }> = [
      {
        name: 'unknown record type between valid records',
        output: '? a.txt\0zzz garbage\0? b.txt\0',
        files: [
          { path: 'a.txt', status: '??', staged: false },
          { path: 'b.txt', status: '??', staged: false },
        ],
        skipped: 1,
      },
      {
        name: 'type 1 record with too few fields',
        output: '1 .M N... 100644\0',
        files: [],
        skipped: 1,
      },
      {
        name: 'type 1 record with an unknown XY code',
        output: ordinary('.Z', 'x.txt'),
        files: [],
        skipped: 1,
      },
      {
        name: 'type 2 record missing its origPath field',
        output: `2 R. N... ${MODES} ${HASHES} R100 new.ts\0`,
        files: [],
        skipped: 1,
      },
      {
        name: 'malformed branch.ab header',
        output: '# branch.head main\0# branch.ab +x -1\0',
        files: [],
        skipped: 1,
      },
      {
        name: 'empty record and record without a separator',
        output: '\0?\0? ok.txt\0',
        files: [{ path: 'ok.txt', status: '??', staged: false }],
        skipped: 2,
      },
      {
        name: 'untracked record with an empty path',
        output: '? \0',
        files: [],
        skipped: 1,
      },
    ];

    it.each(cases)('$name', ({ output, files, skipped }) => {
      const result = parseStatusV2Z(output);
      expect(result.files).toEqual(files);
      expect(result.skippedRecords).toBe(skipped);
    });

    it('does not read a malformed rename origPath as its own record', () => {
      const output = `2 R. N... ${MODES}\0? not-a-record\0? real.txt\0`;
      const result = parseStatusV2Z(output);
      expect(result.files).toEqual([
        { path: 'real.txt', status: '??', staged: false },
      ]);
      expect(result.skippedRecords).toBe(1);
    });
  });
});
