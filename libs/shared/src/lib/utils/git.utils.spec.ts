/**
 * Unit tests for `parseWorktreeList`.
 *
 * Covers:
 *   - empty input
 *   - single worktree (main, branch, HEAD)
 *   - multiple worktrees (main vs non-main flag)
 *   - detached HEAD
 *   - bare repository
 *   - refs/heads/ prefix stripping
 *   - branch name without refs/heads/ prefix
 *   - Windows CRLF line endings
 *   - missing HEAD / branch lines (fallback to 'HEAD')
 *   - blocks with extra blank lines and whitespace
 */

import { parseWorktreeList } from './git.utils';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';

describe('parseWorktreeList', () => {
  it('returns [] for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('   ')).toEqual([]);
    expect(parseWorktreeList('\n\n\n')).toEqual([]);
  });

  it('parses a single main worktree with branch', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD abcdef1234567890',
      'branch refs/heads/main',
    ].join('\n');

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(1);
    const [wt] = result;
    expectNormalizedPath(wt.path, '/home/user/project');
    expect(wt.head).toBe('abcdef12'); // Truncated to 8 chars
    expect(wt.branch).toBe('main');
    expect(wt.isMain).toBe(true);
    expect(wt.isBare).toBe(false);
  });

  it('parses multiple worktrees, marks only the first as main', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD abcdef1234567890',
      'branch refs/heads/main',
      '',
      'worktree /home/user/project-feature',
      'HEAD 1234567890abcdef',
      'branch refs/heads/feature/x',
    ].join('\n');

    const result = parseWorktreeList(output);

    expect(result).toHaveLength(2);
    expect(result[0].isMain).toBe(true);
    expect(result[1].isMain).toBe(false);
    expect(result[0].branch).toBe('main');
    expect(result[1].branch).toBe('feature/x');
    expect(result[1].head).toBe('12345678');
  });

  it('marks detached HEAD with special branch label', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD abcdef1234567890',
      'detached',
    ].join('\n');

    const [wt] = parseWorktreeList(output);
    expect(wt.branch).toBe('HEAD (detached)');
  });

  it('marks bare worktrees with isBare=true', () => {
    const output = [
      'worktree /home/user/project.git',
      'HEAD abcdef1234567890',
      'bare',
    ].join('\n');

    const [wt] = parseWorktreeList(output);
    expect(wt.isBare).toBe(true);
    // No branch line → default fallback "HEAD"
    expect(wt.branch).toBe('HEAD');
  });

  it('keeps branch ref untouched when it lacks the refs/heads/ prefix', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD abcdef1234567890',
      'branch feature/no-prefix',
    ].join('\n');

    const [wt] = parseWorktreeList(output);
    expect(wt.branch).toBe('feature/no-prefix');
  });

  it('handles CRLF line endings (Windows `git.exe` output)', () => {
    const output =
      'worktree C:\\Users\\dev\\project\r\n' +
      'HEAD abcdef1234567890\r\n' +
      'branch refs/heads/main\r\n' +
      '\r\n' +
      'worktree C:\\Users\\dev\\project-wt2\r\n' +
      'HEAD 9876543210abcdef\r\n' +
      'branch refs/heads/topic\r\n';

    const result = parseWorktreeList(output);
    expect(result).toHaveLength(2);
    expectNormalizedPath(result[0].path, 'C:/Users/dev/project');
    expectNormalizedPath(result[1].path, 'C:/Users/dev/project-wt2');
    expect(result[0].branch).toBe('main');
    expect(result[1].branch).toBe('topic');
  });

  it('falls back to branch "HEAD" when neither branch nor detached is present', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD abcdef1234567890',
    ].join('\n');

    const [wt] = parseWorktreeList(output);
    expect(wt.branch).toBe('HEAD');
  });

  it('skips blocks that have no worktree path', () => {
    // A block with only HEAD/branch and no `worktree` line is dropped.
    const output = ['HEAD abcdef1234567890', 'branch refs/heads/main'].join(
      '\n',
    );

    expect(parseWorktreeList(output)).toEqual([]);
  });

  it('ignores blank blocks between entries', () => {
    const output = [
      'worktree /home/user/a',
      'HEAD aaaaaaaabbbbbbbb',
      'branch refs/heads/a',
      '',
      '',
      '',
      'worktree /home/user/b',
      'HEAD ccccccccdddddddd',
      'branch refs/heads/b',
    ].join('\n');

    const result = parseWorktreeList(output);
    // Note: `'\n\n\n'.split('\n\n')` yields ['', '\n', ''] — the empty and
    // whitespace-only blocks are skipped by the `!block.trim()` guard.
    expect(result.map((w) => w.branch)).toEqual(['a', 'b']);
  });

  it('truncates the HEAD hash to 8 characters regardless of input length', () => {
    const output = [
      'worktree /home/user/project',
      'HEAD 0123456789abcdef0123456789abcdef01234567',
      'branch refs/heads/main',
    ].join('\n');

    const [wt] = parseWorktreeList(output);
    expect(wt.head).toBe('01234567');
    expect(wt.head).toHaveLength(8);
  });

  it('still produces an entry when the HEAD line is missing (head empty)', () => {
    const output = [
      'worktree /home/user/project',
      'branch refs/heads/main',
    ].join('\n');
    const [wt] = parseWorktreeList(output);
    expect(wt.head).toBe('');
    expect(wt.branch).toBe('main');
  });
});
