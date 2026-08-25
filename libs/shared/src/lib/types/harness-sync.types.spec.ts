/**
 * `summarizeHarnessHealth` — the one definition of "is the harness healthy".
 *
 * Three consumers read it and must never disagree: the Marketplace badge,
 * `ptah harness doctor`'s exit code, and the `harness:healthChanged` push. That
 * is the whole reason it is a pure function in `shared` rather than three
 * inline reductions, so the rules it encodes are pinned here rather than in any
 * one of them.
 */

import {
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessTargetHealth,
} from './harness-sync.types';

function target(
  overrides: Partial<HarnessTargetHealth> = {},
): HarnessTargetHealth {
  return {
    target: 'claude',
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'source-managed',
      mcp: 'supported',
    },
    expected: 4,
    found: 4,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 3,
    ...overrides,
  };
}

function health(overrides: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: 'D:/ws',
    generatedAt: '2026-08-18T00:00:00.000Z',
    mode: 'full',
    reason: 'spec',
    sources: 'ok',
    collisions: [],
    targets: [target()],
    ...overrides,
  };
}

describe('summarizeHarnessHealth', () => {
  describe('level', () => {
    it('is ok when every detected target carries what was asked of it', () => {
      expect(summarizeHarnessHealth(health()).level).toBe('ok');
    });

    it('is unknown for a null report rather than throwing', () => {
      // Every consumer renders this — no workspace open, or no pass yet.
      const summary = summarizeHarnessHealth(null);

      expect(summary.level).toBe('unknown');
      expect(summary.expected).toBe(0);
      expect(summary.label).toMatch(/no harness reconcile/i);
    });

    it('is degraded when a detected target is missing entries', () => {
      const summary = summarizeHarnessHealth(
        health({
          targets: [target({ found: 3, missing: ['.claude/skills/a'] })],
        }),
      );

      expect(summary.level).toBe('degraded');
      expect(summary.missing).toBe(1);
    });

    it('is degraded when the sources themselves were unavailable', () => {
      expect(
        summarizeHarnessHealth(health({ sources: 'sources-missing' })).level,
      ).toBe('degraded');
      expect(
        summarizeHarnessHealth(health({ sources: 'pending-download' })).level,
      ).toBe('degraded');
    });

    it('is error when a write failed — Ptah tried and the filesystem refused', () => {
      const summary = summarizeHarnessHealth(
        health({
          targets: [
            target({
              writeFailed: [{ relPath: '.claude/skills/a', reason: 'EPERM' }],
            }),
          ],
        }),
      );

      expect(summary.level).toBe('error');
    });

    it('ranks a write failure above missing entries', () => {
      const summary = summarizeHarnessHealth(
        health({
          targets: [
            target({
              missing: ['.claude/skills/a'],
              writeFailed: [{ relPath: '.claude/skills/b', reason: 'EBUSY' }],
            }),
          ],
        }),
      );

      expect(summary.level).toBe('error');
    });
  });

  describe('what does NOT raise the level', () => {
    it('ignores collisions — a source-authoring problem, not a malfunction', () => {
      const summary = summarizeHarnessHealth(
        health({
          collisions: [
            {
              slug: 'run-tests',
              shadowedSource: 'D:/x/run-tests',
              reason: 'duplicate-slug',
            },
          ],
        }),
      );

      expect(summary.level).toBe('ok');
      expect(summary.collisions).toBe(1);
    });

    it('ignores foreign paths — files Ptah is correctly refusing to touch', () => {
      const summary = summarizeHarnessHealth(
        health({ targets: [target({ foreign: ['.claude/skills/mine'] })] }),
      );

      expect(summary.level).toBe('ok');
      expect(summary.foreign).toBe(1);
    });
  });

  describe('undetected targets', () => {
    it('excludes them from every count — an uninstalled CLI is not a gap', () => {
      const summary = summarizeHarnessHealth(
        health({
          targets: [
            target(),
            {
              ...target({ target: 'codex' }),
              detected: false,
              expected: 0,
              found: 0,
              missing: ['.agents/skills/a'],
            },
          ],
        }),
      );

      expect(summary.level).toBe('ok');
      expect(summary.detectedTargets).toBe(1);
      expect(summary.missing).toBe(0);
      expect(summary.expected).toBe(4);
    });
  });

  describe('label', () => {
    it('names the sources problem rather than a misleading missing count', () => {
      expect(
        summarizeHarnessHealth(health({ sources: 'pending-download' })).label,
      ).toMatch(/download/i);
    });

    it('pluralizes the target count', () => {
      expect(summarizeHarnessHealth(health()).label).toContain('1 target');
      expect(
        summarizeHarnessHealth(
          health({ targets: [target(), target({ target: 'cursor' })] }),
        ).label,
      ).toContain('2 targets');
    });
  });
});
