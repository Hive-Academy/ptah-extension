// The memory-curator barrel loads tsyringe (needs the reflect polyfill) and,
// through vscode-core, the `vscode` module, which has no runtime outside the
// editor. These specs only read config constants, so `vscode` is stubbed.
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });
import {
  DAY_MS,
  MEMORY_LIFECYCLE_DEFAULTS,
} from '@ptah-extension/memory-curator';
import {
  ageOnlyPolicy,
  DEFAULT_RETENTION_POLICY_SETTINGS,
  MemoryFactKind,
  noLifecyclePolicy,
  oracleRetentionPolicy,
  RetentionPolicyRow,
  RetentionDecision,
  RetentionTier,
} from './retention-policies';

const NOW = 1_800_000_000_000;

function row(overrides: Partial<RetentionPolicyRow>): RetentionPolicyRow {
  return {
    id: 'row-0',
    tier: 'recall',
    workspaceRoot: 'ws://main',
    lastUsedAtMs: NOW,
    archivedAtMs: null,
    pinned: false,
    hits: 0,
    kind: 'fact',
    useful: false,
    ...overrides,
  };
}

const TIERS: readonly RetentionTier[] = ['core', 'recall', 'archival'];
const KINDS: readonly MemoryFactKind[] = [
  'fact',
  'preference',
  'event',
  'entity',
];

describe('settings (design 190)', () => {
  it('reads the 30/60/25,000 defaults from the product lifecycle config', () => {
    expect(DEFAULT_RETENTION_POLICY_SETTINGS).toEqual({
      archiveAfterDays: 30,
      deleteAfterDays: 60,
      maxPerWorkspace: 25_000,
    });
    expect(DEFAULT_RETENTION_POLICY_SETTINGS.archiveAfterDays).toBe(
      MEMORY_LIFECYCLE_DEFAULTS.archiveAfterDays,
    );
    expect(DEFAULT_RETENTION_POLICY_SETTINGS.deleteAfterDays).toBe(
      MEMORY_LIFECYCLE_DEFAULTS.deleteAfterDays,
    );
    expect(DEFAULT_RETENTION_POLICY_SETTINGS.maxPerWorkspace).toBe(
      MEMORY_LIFECYCLE_DEFAULTS.maxPerWorkspace,
    );
  });
});

describe('noLifecyclePolicy (design 190)', () => {
  it('never archives, deletes or evicts anything', () => {
    const rows = [
      row({ id: 'old-recall', lastUsedAtMs: NOW - 400 * DAY_MS }),
      row({
        id: 'old-archival',
        tier: 'archival',
        archivedAtMs: NOW - 400 * DAY_MS,
      }),
    ];
    expect(noLifecyclePolicy(rows, NOW)).toEqual({
      archived: [],
      deleted: [],
      evicted: [],
    });
  });
});

describe('ageOnlyPolicy (design 190, the current product policy)', () => {
  it('archives recall rows older than archiveAfterDays and not at the boundary', () => {
    const rows = [
      row({ id: 'old', lastUsedAtMs: NOW - (30 * DAY_MS + 1) }),
      row({ id: 'boundary', lastUsedAtMs: NOW - 30 * DAY_MS }),
      row({ id: 'fresh', lastUsedAtMs: NOW - 29 * DAY_MS }),
    ];
    expect(ageOnlyPolicy(rows, NOW)).toEqual({
      archived: ['old'],
      deleted: [],
      evicted: [],
    });
  });

  it('deletes archival rows archived longer than deleteAfterDays and not at the boundary', () => {
    const rows = [
      row({
        id: 'delete-me',
        tier: 'archival',
        archivedAtMs: NOW - (60 * DAY_MS + 1),
      }),
      row({
        id: 'boundary',
        tier: 'archival',
        archivedAtMs: NOW - 60 * DAY_MS,
      }),
      row({
        id: 'young-archive',
        tier: 'archival',
        archivedAtMs: NOW - 59 * DAY_MS,
      }),
    ];
    expect(ageOnlyPolicy(rows, NOW)).toEqual({
      archived: [],
      deleted: ['delete-me'],
      evicted: [],
    });
  });

  it('never touches pinned rows or core-tier rows, any age', () => {
    const rows = [
      row({
        id: 'pinned-recall',
        pinned: true,
        lastUsedAtMs: NOW - 400 * DAY_MS,
      }),
      row({
        id: 'pinned-archival',
        tier: 'archival',
        pinned: true,
        archivedAtMs: NOW - 400 * DAY_MS,
      }),
      row({ id: 'core', tier: 'core', lastUsedAtMs: NOW - 400 * DAY_MS }),
    ];
    expect(ageOnlyPolicy(rows, NOW)).toEqual({
      archived: [],
      deleted: [],
      evicted: [],
    });
  });

  it('keeps an archival row without archived_at, like NULL in the product SQL', () => {
    const rows = [
      row({ id: 'no-stamp', tier: 'archival', archivedAtMs: null }),
    ];
    expect(ageOnlyPolicy(rows, NOW)).toEqual({
      archived: [],
      deleted: [],
      evicted: [],
    });
  });

  it('honours custom settings when the suite varies the thresholds', () => {
    const rows = [row({ id: 'old', lastUsedAtMs: NOW - 40 * DAY_MS })];
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 10,
        deleteAfterDays: 20,
        maxPerWorkspace: 25_000,
      }).archived,
    ).toEqual(['old']);
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 50,
        deleteAfterDays: 100,
        maxPerWorkspace: 25_000,
      }).archived,
    ).toEqual([]);
  });

  it('evicts the oldest rows over the cap, archival before recall', () => {
    const rows = [
      row({
        id: 'arch-ancient',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 90 * DAY_MS,
      }),
      row({
        id: 'arch-young',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 40 * DAY_MS,
      }),
      row({ id: 'recall-mid', lastUsedAtMs: NOW - 20 * DAY_MS }),
      row({ id: 'recall-new', lastUsedAtMs: NOW - DAY_MS }),
    ];
    // four removable rows, cap two: excess two, both from the archival tier,
    // oldest last_used_at first; the recall tier alone is not over the cap
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 2,
      }),
    ).toEqual({
      archived: [],
      deleted: [],
      evicted: ['arch-ancient', 'arch-young'],
    });
  });

  it('keeps archival rows inside the eviction grace, even over the cap', () => {
    const rows = [
      row({ id: 'graced', tier: 'archival', archivedAtMs: NOW - DAY_MS }),
      row({ id: 'recall', lastUsedAtMs: NOW - DAY_MS }),
    ];
    // total two, cap one, but the only archival row is inside the grace and
    // the recall tier alone is not over the cap: the run evicts nothing, the
    // workspace stays over the cap until the grace passes — as the product run
    // does
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 1,
      }).evicted,
    ).toEqual([]);
  });

  it('thins the recall tier only when it alone is over the cap', () => {
    const rows = [
      row({
        id: 'graced-archival',
        tier: 'archival',
        archivedAtMs: NOW - DAY_MS,
      }),
      row({ id: 'recall-old', lastUsedAtMs: NOW - 10 * DAY_MS }),
      row({ id: 'recall-new', lastUsedAtMs: NOW - DAY_MS }),
    ];
    // total three, cap one: the graced archival row cannot go, and the recall
    // tier (two rows) alone exceeds the cap by one, oldest last_used_at first
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 1,
      }).evicted,
    ).toEqual(['recall-old']);
  });

  it('does not evict a row archived this step: the grace covers fresh archives', () => {
    const rows = [
      row({ id: 'just-aged', lastUsedAtMs: NOW - 90 * DAY_MS }),
      row({ id: 'fresh', lastUsedAtMs: NOW - DAY_MS }),
    ];
    const decision = ageOnlyPolicy(rows, NOW, {
      archiveAfterDays: 30,
      deleteAfterDays: 60,
      maxPerWorkspace: 1,
    });
    expect(decision.archived).toEqual(['just-aged']);
    // the just-archived row counts toward the cap but sits in the grace; the
    // recall tier alone is not over the cap
    expect(decision.evicted).toEqual([]);
  });

  it('evicts per workspace, never across them', () => {
    const rows = [
      row({
        id: 'a-old',
        workspaceRoot: 'ws://a',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 10 * DAY_MS,
      }),
      row({
        id: 'a-new',
        workspaceRoot: 'ws://a',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - DAY_MS,
      }),
      row({
        id: 'b-only',
        workspaceRoot: 'ws://b',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 90 * DAY_MS,
      }),
    ];
    // workspace a is over the cap by one and evicts its oldest; workspace b
    // sits alone at its cap
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 1,
      }),
    ).toEqual({
      archived: [],
      deleted: [],
      evicted: ['a-old'],
    });
  });

  it('breaks eviction ties by input order', () => {
    const rows = [
      row({
        id: 'first',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 10 * DAY_MS,
      }),
      row({
        id: 'second',
        tier: 'archival',
        archivedAtMs: NOW - 40 * DAY_MS,
        lastUsedAtMs: NOW - 10 * DAY_MS,
      }),
    ];
    expect(
      ageOnlyPolicy(rows, NOW, {
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 1,
      }).evicted,
    ).toEqual(['first']);
  });
});

describe('oracleRetentionPolicy (design 190, the ceiling)', () => {
  const settings = {
    archiveAfterDays: 30,
    deleteAfterDays: 60,
    maxPerWorkspace: 25_000,
  };

  it('protects labelled-useful rows of every kind from archive and delete', () => {
    for (const kind of KINDS) {
      const rows = [
        row({
          id: `useful-recall-${kind}`,
          kind,
          useful: true,
          lastUsedAtMs: NOW - 400 * DAY_MS,
        }),
        row({
          id: `useful-archival-${kind}`,
          kind,
          useful: true,
          tier: 'archival',
          archivedAtMs: NOW - 400 * DAY_MS,
        }),
        row({
          id: `disposable-${kind}`,
          kind,
          lastUsedAtMs: NOW - 400 * DAY_MS,
        }),
      ];
      expect(oracleRetentionPolicy(rows, NOW, settings)).toEqual({
        archived: [`disposable-${kind}`],
        deleted: [],
        evicted: [],
      });
    }
  });

  it('protects rows with hits > 0 even when labelled disposable', () => {
    const rows = [
      row({ id: 'hit-recall', hits: 3, lastUsedAtMs: NOW - 400 * DAY_MS }),
      row({
        id: 'hit-archival',
        hits: 1,
        tier: 'archival',
        archivedAtMs: NOW - 400 * DAY_MS,
      }),
      row({ id: 'cold', lastUsedAtMs: NOW - 400 * DAY_MS }),
    ];
    expect(oracleRetentionPolicy(rows, NOW, settings)).toEqual({
      archived: ['cold'],
      deleted: [],
      evicted: [],
    });
  });

  it('still removes disposable zero-hit rows exactly like age-only', () => {
    const rows = [
      row({ id: 'old', lastUsedAtMs: NOW - 400 * DAY_MS }),
      row({
        id: 'old-archival',
        tier: 'archival',
        archivedAtMs: NOW - 400 * DAY_MS,
      }),
    ];
    expect(oracleRetentionPolicy(rows, NOW, settings)).toEqual(
      ageOnlyPolicy(rows, NOW, settings),
    );
  });

  it('does not count protected rows toward the per-workspace cap', () => {
    const rows = [
      row({
        id: 'useful',
        useful: true,
        lastUsedAtMs: NOW - 400 * DAY_MS,
      }),
      row({
        id: 'hit',
        hits: 2,
        lastUsedAtMs: NOW - 400 * DAY_MS,
      }),
    ];
    expect(
      oracleRetentionPolicy(rows, NOW, { ...settings, maxPerWorkspace: 1 }),
    ).toEqual({
      archived: [],
      deleted: [],
      evicted: [],
    });
  });

  it('evicts an unprotected row over the cap while a protected row survives', () => {
    const rows = [
      row({
        id: 'protected',
        useful: true,
        lastUsedAtMs: NOW - 100 * DAY_MS,
      }),
      row({ id: 'unprotected-old', lastUsedAtMs: NOW - 10 * DAY_MS }),
      row({ id: 'unprotected-fresh', lastUsedAtMs: NOW - DAY_MS }),
    ];
    // the protected row does not count: two removable rows against a cap of
    // one, oldest last_used_at first
    const decision = oracleRetentionPolicy(rows, NOW, {
      ...settings,
      maxPerWorkspace: 1,
    });
    expect(decision.evicted).toEqual(['unprotected-old']);
    expect(decision.archived).toEqual([]);
  });

  it('is deterministic: the same rows and nowMs decide the same way', () => {
    const rows = TIERS.flatMap((tier) =>
      KINDS.map((kind, index) =>
        row({
          id: `${tier}-${kind}`,
          tier,
          kind,
          useful: index % 2 === 0,
          hits: index,
          lastUsedAtMs: NOW - (index + 1) * 7 * DAY_MS,
          archivedAtMs:
            tier === 'archival' ? NOW - (index + 1) * 7 * DAY_MS : null,
          workspaceRoot: index % 2 === 0 ? 'ws://a' : 'ws://b',
        }),
      ),
    );
    const first: RetentionDecision = oracleRetentionPolicy(rows, NOW);
    const second: RetentionDecision = oracleRetentionPolicy(rows, NOW);
    expect(first).toEqual(second);
  });
});
