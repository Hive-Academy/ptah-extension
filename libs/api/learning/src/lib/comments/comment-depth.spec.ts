import { resolveParentForDepthTwo, wasDepthRepaired } from './comment-depth';

/**
 * R2.5.2 → R1.3.3, RK-12.
 *
 * ⚠️ THE RK-12 CASE BELOW IS CARRIED IN THE SAME WORDS AS
 * `libs/api/forum/src/lib/posts/posts.service.spec.ts`, deliberately, so that a
 * `grep` for the requirement finds both implementations. See
 * `comment-depth.ts`'s docblock for the reuse-vs-reimplement decision and its
 * reasoning.
 */

describe('RK-12 — depth is capped at 2 by REPAIR, not by rejection', () => {
  it('a depth-3 reply attempt attaches at DEPTH 2, re-pointed to the parent of the parent', () => {
    // The member replied to `depth-2-comment`, whose own parent is
    // `depth-1-comment`. The new comment becomes a SIBLING of the one it
    // replied to, not a child of it.
    const depthTwoParent = {
      id: 'depth-2-comment',
      parentId: 'depth-1-comment',
    };

    expect(resolveParentForDepthTwo(depthTwoParent)).toBe('depth-1-comment');
  });

  it('a reply to a TOP-LEVEL comment attaches to it, unchanged', () => {
    // The negative control. A repair that fired on every reply would flatten
    // the thread to one level and pass the case above.
    const topLevel = { id: 'depth-1-comment', parentId: null };

    expect(resolveParentForDepthTwo(topLevel)).toBe('depth-1-comment');
  });

  it('reports whether the repair fired, so a client CAN say "replying to the thread"', () => {
    expect(
      wasDepthRepaired(
        { id: 'depth-2-comment', parentId: 'depth-1-comment' },
        'depth-1-comment',
      ),
    ).toBe(true);

    expect(
      wasDepthRepaired(
        { id: 'depth-1-comment', parentId: null },
        'depth-1-comment',
      ),
    ).toBe(false);
  });
});

describe('the induction that makes ONE hop sufficient', () => {
  it('every parentId this function writes is null-parented, so nothing is ever deeper than 2', () => {
    // 🔴 THE PROPERTY, ASSERTED RATHER THAN ASSUMED. A loop that walked to the
    // root would be dead code dressed as caution; this is the reason it is
    // dead. Modelled as a small thread that grows by repeatedly replying to
    // whatever the previous step produced.
    const thread = new Map<string, string | null>([['root', null]]);
    let replyTarget = 'root';

    for (let i = 0; i < 20; i++) {
      const parent = {
        id: replyTarget,
        parentId: thread.get(replyTarget) ?? null,
      };
      const resolved = resolveParentForDepthTwo(parent);
      const id = `c${i}`;
      thread.set(id, resolved);
      // Always reply to the newest comment — the adversarial walk, which is the
      // one that would produce depth 3 if the rule were wrong.
      replyTarget = id;
    }

    // Depth of every stored comment: 1 if parentId is null, else 1 + depth(parent).
    const depthOf = (id: string): number => {
      const parentId = thread.get(id) ?? null;
      return parentId === null ? 1 : 1 + depthOf(parentId);
    };

    for (const id of thread.keys()) {
      expect(depthOf(id)).toBeLessThanOrEqual(2);
    }
  });

  it('is idempotent — repairing an already-repaired parent changes nothing further', () => {
    const parent = { id: 'depth-2', parentId: 'depth-1' };
    const once = resolveParentForDepthTwo(parent);
    const twice = resolveParentForDepthTwo({ id: once, parentId: null });

    expect(twice).toBe(once);
  });
});

describe('what this function is NOT for', () => {
  it('is pure — it takes the row, never an id, and never reads', () => {
    // The caller has already read the parent, scoped to the lesson and filtered
    // by NOT_DELETED, which is where a parent in ANOTHER lesson or a
    // tombstoned parent becomes a 404. Those are not depth questions and this
    // function deliberately cannot express them.
    expect(resolveParentForDepthTwo).toHaveLength(1);
    expect(resolveParentForDepthTwo({ id: 'a', parentId: 'b' })).toBe(
      resolveParentForDepthTwo({ id: 'a', parentId: 'b' }),
    );
  });
});
