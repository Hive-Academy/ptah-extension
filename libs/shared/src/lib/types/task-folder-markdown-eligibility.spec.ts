import { isReadableTaskFolderMarkdownName } from './task-folder-markdown-eligibility';

describe('task folder markdown eligibility', () => {
  it('accepts direct lowercase markdown names', () => {
    expect(isReadableTaskFolderMarkdownName('decisions.md')).toBe(true);
    expect(isReadableTaskFolderMarkdownName('review-1.md')).toBe(true);
  });
  it.each(['../secret.md', 'foo/bar.md', 'FOO.md', 'foo.MD', 'foo%2e%2e.md', 'foo bar.md', 'a..md', 'x.md\0'])('rejects %s', (name) => {
    expect(isReadableTaskFolderMarkdownName(name)).toBe(false);
  });
});
