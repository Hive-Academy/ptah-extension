/**
 * Ref guard table (TASK_2026_576 RC14).
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git/git-ref-guard.ts
 */

import {
  assertSafeRef,
  assertSafeRevision,
  GitInvalidRefError,
} from './git-ref-guard';

const REFUSED_BY_BOTH: Array<[string, string]> = [
  ['', 'empty'],
  ['-b', 'leading -'],
  ['--output=/tmp/x', 'option with a value'],
  ['--upload-pack=touch x', 'option with whitespace'],
  ['-', 'a lone dash'],
  ['main\n', 'newline'],
  ['ma\tin', 'tab'],
  ['ma\u0000in', 'NUL'],
  ['ma\u007fin', 'DEL'],
  ['my branch', 'space'],
  ['main x', 'non-breaking space'],
  ['a..b', '".."'],
  ['main@{1}', '"@{" reflog'],
  ['@{-1}', '"@{" previous branch'],
  ['a:b', 'colon'],
  ['a?b', 'question mark'],
  ['a*b', 'asterisk'],
  ['a[b', 'open bracket'],
  ['a\\b', 'backslash'],
  ['stash@{0}x', 'stash ordinal with trailing text'],
  ['stash@{-1}', 'negative stash ordinal'],
];

describe('assertSafeRef', () => {
  it.each(REFUSED_BY_BOTH)('refuses %j (%s)', (ref) => {
    expect(() => assertSafeRef(ref)).toThrow(GitInvalidRefError);
  });

  it.each([
    ['HEAD~1', 'tilde'],
    ['HEAD^', 'caret'],
    ['main^{commit}', 'peel suffix'],
  ])('refuses %j (%s) in a branch name', (ref) => {
    expect(() => assertSafeRef(ref)).toThrow(GitInvalidRefError);
  });

  it.each([
    'main',
    'feature/x-1',
    'release/v1.2.3',
    'HEAD',
    'a-b_c.d',
    'origin/main',
    'café',
    'stash@{0}',
    'stash@{12}',
    '0123456789abcdef0123456789abcdef01234567',
  ])('allows %j', (ref) => {
    expect(() => assertSafeRef(ref)).not.toThrow();
  });

  it('names the ref and the reason in the error', () => {
    expect(() => assertSafeRef('-b')).toThrow(
      'Invalid git ref "-b": starts with "-"',
    );
  });

  it('refuses a non-string value arriving from an untyped payload', () => {
    expect(() => assertSafeRef(undefined as unknown as string)).toThrow(
      GitInvalidRefError,
    );
  });
});

describe('assertSafeRevision', () => {
  it.each(REFUSED_BY_BOTH)('refuses %j (%s)', (revision) => {
    expect(() => assertSafeRevision(revision)).toThrow(GitInvalidRefError);
  });

  it.each([
    ['~1', 'suffix with no ref'],
    ['^{commit}', 'peel with no ref'],
    ['HEAD^{tree}', 'peel to a non-commit'],
    ['HEAD~1..main', 'range'],
    ['-HEAD~1', 'leading dash before a suffix'],
    ['main:file.txt', 'tree path'],
  ])('refuses %j (%s)', (revision) => {
    expect(() => assertSafeRevision(revision)).toThrow(GitInvalidRefError);
  });

  it.each([
    'HEAD',
    'HEAD~1',
    'HEAD~',
    'HEAD^',
    'HEAD^2',
    'HEAD~2^1',
    'main^{commit}',
    'main^{}',
    'v1.2.3',
    'feature/x',
    'abc1234',
    '0123456789abcdef0123456789abcdef01234567',
    'stash@{0}',
    'stash@{0}^1',
  ])('allows %j', (revision) => {
    expect(() => assertSafeRevision(revision)).not.toThrow();
  });
});
