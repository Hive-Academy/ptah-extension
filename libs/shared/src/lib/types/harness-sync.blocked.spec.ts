/**
 * `blockedTargetPaths` — the `missing ∩ foreign` derivation (TASK_2026_306,
 * Batch 6 / Task 6.1).
 *
 * It lives in `shared`, beside `summarizeHarnessHealth`, for that function's
 * exact reason: more than one consumer reads it and they must never disagree.
 * The reconciler's blocked-path log is one; the webview health card's blocked
 * disclosure is another, and a frontend lib cannot import `harness-sync`. So
 * the rules it encodes are pinned here rather than in either of them.
 *
 * The reconciler-level behaviour that consumes it lives in
 * `harness-sync/.../reconciler/harness-reconciler.blocked-logging.spec.ts`.
 */

import {
  blockedTargetPaths,
  type HarnessFacetMatrix,
  type HarnessTargetHealth,
} from './harness-sync.types';

const FACETS: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'supported',
  mcp: 'supported',
};

function targetHealth(
  overrides: Partial<HarnessTargetHealth> & {
    missing: string[];
    foreign: string[];
  },
): HarnessTargetHealth {
  return {
    target: 'claude',
    detected: true,
    facets: FACETS,
    expected: 0,
    found: 0,
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
    ...overrides,
  };
}

describe('blockedTargetPaths', () => {
  it('returns the intersection when missing and foreign overlap partially', () => {
    const blocked = blockedTargetPaths(
      targetHealth({
        // `.claude/commands/absent.md` is a planned write: missing, not foreign.
        missing: ['.claude/skills/alpha', '.claude/commands/absent.md'],
        // `.claude/skills/mine` is the user's own skill: foreign, not desired.
        foreign: ['.claude/skills/alpha', '.claude/skills/mine'],
      }),
    );

    expect(blocked).toEqual(['.claude/skills/alpha']);
  });

  it('returns an empty set when missing and foreign are disjoint', () => {
    const blocked = blockedTargetPaths(
      targetHealth({
        missing: ['.claude/skills/alpha', '.claude/skills/beta'],
        foreign: ['.claude/skills/mine', '.claude/skills/notes'],
      }),
    );

    expect(blocked).toEqual([]);
  });

  it('returns an empty set when both lists are empty', () => {
    expect(
      blockedTargetPaths(targetHealth({ missing: [], foreign: [] })),
    ).toEqual([]);
  });

  it('returns an empty set when only foreign is populated — a foreign path nobody wanted is not a gap', () => {
    const blocked = blockedTargetPaths(
      targetHealth({ missing: [], foreign: ['.claude/skills/mine'] }),
    );

    expect(blocked).toEqual([]);
  });

  it('returns an empty set when only missing is populated — a plain unwritten path is a gap, not a refusal', () => {
    const blocked = blockedTargetPaths(
      targetHealth({ missing: ['.claude/skills/alpha'], foreign: [] }),
    );

    expect(blocked).toEqual([]);
  });

  it('returns every member when missing is wholly contained in foreign', () => {
    const missing = ['.claude/skills/alpha', '.claude/skills/beta'];
    const blocked = blockedTargetPaths(
      targetHealth({ missing, foreign: [...missing, '.claude/skills/mine'] }),
    );

    expect(blocked).toEqual(missing);
  });

  it('preserves the order of `missing` and collapses duplicates', () => {
    const blocked = blockedTargetPaths(
      targetHealth({
        missing: [
          '.claude/skills/zeta',
          '.claude/skills/alpha',
          '.claude/skills/zeta',
        ],
        foreign: ['.claude/skills/alpha', '.claude/skills/zeta'],
      }),
    );

    expect(blocked).toEqual(['.claude/skills/zeta', '.claude/skills/alpha']);
  });

  it('scales to the captured cold-start COUNTS (missing=13 inside foreign=19) without dropping a member', () => {
    // Honest about what this does and does not prove. `coldstart-306.log:844`
    // carries COUNTS only — `expected=27, found=14, missing=13, foreign=19` on
    // the claude slice — and no paths, so the thirteen `legacy-i` names below
    // are NOMINAL. Nothing here reproduces the real workspace or establishes
    // the provenance of the real thirteen (which is unknown; see this lib's
    // `harness-sync/CLAUDE.md`). What it does pin is that the derivation
    // returns the whole overlap at that size, with the six non-desired foreign
    // paths excluded — i.e. that the number a user sees would be 13 and not 19.
    const blockedPaths = Array.from(
      { length: 13 },
      (_, i) => `.claude/skills/legacy-${i}`,
    );
    const unwantedForeign = Array.from(
      { length: 6 },
      (_, i) => `.claude/skills/users-own-${i}`,
    );

    const derived = blockedTargetPaths(
      targetHealth({
        expected: 27,
        found: 14,
        missing: blockedPaths,
        foreign: [...blockedPaths, ...unwantedForeign],
      }),
    );

    expect(derived).toHaveLength(13);
    expect(derived).toEqual(blockedPaths);
  });
});
