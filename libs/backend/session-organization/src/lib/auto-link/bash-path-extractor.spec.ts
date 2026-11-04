import { extractBashPaths } from './bash-path-extractor';

describe('extractBashPaths', () => {
  it('only reads commands in command position', () => {
    expect(extractBashPaths('echo cd /wrong; git -C /right status')).toEqual(['/right']);
  });
  it('keeps quoted paths and tracks cd for relative worktrees', () => {
    expect(extractBashPaths('cd "my folder" && git worktree add -b feat/x --detach ../next main')).toEqual(['my folder', 'my folder/../next']);
  });
  it('accepts multiple worktree flags', () => {
    expect(extractBashPaths('git worktree add --quiet --reason="task one" -b feature/x ./tree main')).toEqual(['./tree']);
  });
  it('rejects unparseable quotes', () => {
    expect(extractBashPaths('git worktree add "broken')).toEqual([]);
  });
  it('resets relative resolution after separators other than &&', () => {
    expect(extractBashPaths('cd /missing; git worktree add .claude-worktrees/x main')).toEqual(['/missing', '.claude-worktrees/x']);
    expect(extractBashPaths('cd a || git -C b status')).toEqual(['a', 'b']);
    expect(extractBashPaths('cd a | git -C b status')).toEqual(['a', 'b']);
    expect(extractBashPaths('cd a\ngit -C b status')).toEqual(['a', 'b']);
  });
});
