import type { ReviewCanvasFile } from './file-diff-section.component';
import { collapsedCarrier } from './review-canvas-position';

function file(
  comparison: 'worktree' | 'staged',
  path: string,
): ReviewCanvasFile {
  return {
    id: `${comparison}\u0000${path}\u0000${path}`,
    path,
    status: 'M',
    additions: 1,
    deletions: 0,
    comparison,
    request: null,
    label: null,
  };
}

describe('collapsedCarrier', () => {
  const worktree = file('worktree', 'src/a.ts');
  const staged = file('staged', 'src/a.ts');
  const other = file('worktree', 'src/b.ts');

  it('moves a collapsed id to the new id staging gave its file', () => {
    const carry = collapsedCarrier();
    carry(new Set(), [worktree, other]);
    expect(carry(new Set([worktree.id]), [staged, other])).toEqual(
      new Set([staged.id]),
    );
  });

  it('partially staged -> fully staged: a collapsed worktree section collapses the surviving staged one', () => {
    const carry = collapsedCarrier();
    carry(new Set(), [worktree, staged, other]);
    expect(carry(new Set([worktree.id]), [staged, other])).toEqual(
      new Set([staged.id]),
    );
  });

  it('partially staged -> fully unstaged: a collapsed staged section collapses the surviving worktree one', () => {
    const carry = collapsedCarrier();
    carry(new Set(), [worktree, staged, other]);
    expect(carry(new Set([staged.id]), [worktree, other])).toEqual(
      new Set([worktree.id]),
    );
  });

  it('keeps a merged section collapsed when both sections were', () => {
    const carry = collapsedCarrier();
    carry(new Set(), [worktree, staged]);
    expect(carry(new Set([worktree.id, staged.id]), [staged])).toEqual(
      new Set([staged.id]),
    );
  });

  it('changes nothing when no collapsed id left the list, or its path left too', () => {
    const carry = collapsedCarrier();
    carry(new Set(), [worktree, other]);
    expect(carry(new Set([other.id]), [worktree, other])).toBeNull();
    expect(carry(new Set([worktree.id]), [other])).toBeNull();
  });
});
