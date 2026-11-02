import { subagentActivityText } from './subagent-activity-text';

describe('subagentActivityText', () => {
  it('cuts a Windows forward-slash path to the file name', () => {
    expect(
      subagentActivityText(
        'WROTE: D:/projects/ptah-extension/.claude-worktrees/codex-removal-a/.ptah/specs/TASK_2026_714_c6a2/code-logic-review-coderabbit-881.md — APPROVE',
      ),
    ).toBe('WROTE: code-logic-review-coderabbit-881.md — APPROVE');
  });

  it('cuts Windows backslash and POSIX paths', () => {
    expect(
      subagentActivityText('Read C:\\repo\\src\\a.ts and /home/u/repo/b.ts'),
    ).toBe('Read a.ts and b.ts');
  });

  it('keeps URLs and relative paths', () => {
    expect(
      subagentActivityText(
        'See https://github.com/org/repo/pull/1 in src/app/x.ts',
      ),
    ).toBe('See https://github.com/org/repo/pull/1 in src/app/x.ts');
  });

  it('removes markdown marks and joins lines', () => {
    expect(
      subagentActivityText('## Verdict\n- **APPROVE** with `2` notes'),
    ).toBe('Verdict APPROVE with 2 notes');
  });
});
