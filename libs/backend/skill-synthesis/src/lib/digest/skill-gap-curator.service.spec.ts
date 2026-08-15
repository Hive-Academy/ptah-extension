/**
 * `SkillGapCuratorService` — the four sweeps (task B4.2.2).
 *
 * TWO ASSERTIONS IN THIS FILE ARE THE REASON IT EXISTS, and both were
 * mutation-tested (break the behaviour, watch the test fail, restore):
 *
 *  1. **`null` is never `0` in the ranking.** A skill with an unmeasured win
 *     rate must rank BELOW a skill measured at `0`, not above it. Written as an
 *     ordering assertion plus `toBeNull()` / `not.toBe(0)` on the evidence,
 *     because a falsiness check would pass against both values and prove
 *     nothing — the same trap `win-rate.spec.ts` documents at the store.
 *  2. **An absent verdict table yields `[]`, not a rejected promise.** Phase 4
 *     ships on hosts where phase 2 never ran (the C2 ⇢ C4 soft edge), so the
 *     empty-table case AND the missing-table case both have to resolve. The
 *     missing-table case is the one that catches a removed guard; an empty
 *     table alone would pass against unguarded code.
 *
 * WHICH BINDING. `better-sqlite3` is rebuilt against Electron's ABI by
 * postinstall here, so it cannot load in the Jest/Node runner; `resolveOpener`
 * falls back to Node's built-in `node:sqlite`. Every bundled migration's base
 * `sql` is applied in ascending order, so the sweeps run against the real
 * lineage rather than a hand-written fixture that could drift from it. A
 * SKIPPED run of this file proves nothing, which is why the binding guard below
 * is a plain `it` that FAILS rather than a gated one that goes quiet.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IMemoryReader } from '@ptah-extension/memory-contracts';
import type { Logger } from '@ptah-extension/vscode-core';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { CandidateId } from '../types';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import type { EvidenceClass } from '../archaeology/session-verdict.types';
import { SkillSuggestionStore } from '../skill-suggestion.store';
import {
  resolveOpener,
  noopLogger,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  DIGEST_TRIGGER_CLAUSE_PREFIX,
  DIGEST_WIN_RATE_UNMEASURED,
  SkillGapCuratorService,
  scoreForWinRate,
} from './skill-gap-curator.service';
import { DIGEST_WIN_EVIDENCE_CLASSES, type DigestItem } from './digest.types';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const WORKSPACE = '/ws';

/** Every bundled migration's base SQL, ascending — the real lineage. */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [...MIGRATIONS].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.sql) db.exec(migration.sql);
  }
  return db;
}

interface Harness {
  readonly db: TestDatabase;
  readonly candidates: SkillCandidateStore;
  readonly verdicts: SessionVerdictStore;
  readonly suggestions: SkillSuggestionStore;
  readonly curator: SkillGapCuratorService;
}

function makeHarness(db: TestDatabase, memory: IMemoryReader | null): Harness {
  const connection = { db, vecExtensionLoaded: false, isOpen: true } as never;
  const vecStatus = {
    available: false,
    getStatus: () => ({ available: false, reason: 'binary-missing' }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  } as never;
  const candidates = new SkillCandidateStore(
    noopLogger as never,
    connection,
    vecStatus,
  );
  const verdicts = new SessionVerdictStore(noopLogger as never, connection);
  const suggestions = new SkillSuggestionStore(noopLogger as never, connection);
  return {
    db,
    candidates,
    verdicts,
    suggestions,
    curator: new SkillGapCuratorService(
      noopLogger as Logger,
      candidates,
      verdicts,
      suggestions,
      memory,
    ),
  };
}

/** A promoted skill in the library, through the real store path. */
function promoteSkill(
  h: Harness,
  name: string,
  description: string,
): CandidateId {
  const { candidate } = h.candidates.registerCandidate({
    name,
    description,
    bodyPath: `/skills/${name}/SKILL.md`,
    sourceSessionIds: [],
    trajectoryHash: `hash-${name}`,
    embedding: null,
    createdAt: 1,
  });
  h.candidates.updateStatus(candidate.id, 'promoted', { promotedAt: 2 });
  return candidate.id;
}

function invoke(h: Harness, slug: string, sessionId: string, at: number): void {
  h.candidates.recordSkillEvent({
    skillSlug: slug,
    sessionId,
    workspaceRoot: WORKSPACE,
    contextId: null,
    source: 'tool-use',
    succeeded: true,
    isError: false,
    invokedAt: at,
  });
}

function saveVerdict(
  h: Harness,
  sessionId: string,
  evidenceClass: EvidenceClass | null,
  fields: {
    intent?: string;
    outcome?: string;
    friction?: Array<{
      turnIndex: number;
      kind: 'correction' | 'retry';
      note: string;
    }>;
  } = {},
): void {
  h.verdicts.save(
    {
      sessionId,
      workspaceRoot: WORKSPACE,
      intent: fields.intent ?? null,
      outcome: fields.outcome ?? null,
      evidenceClass,
      frictionMap: fields.friction ?? [],
      turnCount: 8,
    },
    10,
  );
}

function byKind(items: readonly DigestItem[], kind: string): DigestItem[] {
  return items.filter((i) => i.kind === kind);
}

const RESEARCH_DESCRIPTION =
  'Research a library across documentation sources and summarize findings';
const RESEARCH_INTENT =
  'Research the sqlite library documentation and summarize the findings';
const FRICTION_NOTE = 'migration lock timed out during prisma deploy';

const memoryReaderStub = (
  hits: number,
): IMemoryReader & { search: jest.Mock } => ({
  search: jest.fn().mockResolvedValue({
    hits: Array.from({ length: hits }, (_, i) => ({
      memoryId: `m-${i}`,
      subject: 'Prisma migrations lock in CI',
      content: 'The prisma migrate deploy step locks whenever CI reruns.',
      chunkText: 'The prisma migrate deploy step locks whenever CI reruns.',
      score: 0.9 - i * 0.1,
      tier: 'core',
    })),
    bm25Only: false,
  }),
});

describe('SkillGapCuratorService', () => {
  it('has a working SQLite binding (this file proves nothing when skipped)', () => {
    expect(opener).not.toBeNull();
  });

  describe('the win-evidence partition', () => {
    it('mirrors the getWinRates SQL member for member', () => {
      // `DIGEST_WIN_EVIDENCE_CLASSES` is a LOCAL copy of the partition the
      // store's query owns, because this batch may not edit that file. A copy
      // that drifts is worse than no copy: the digest would call a session a
      // success that the win rate counts as a loss. Scanned from source rather
      // than re-derived, so the pin cannot be satisfied by the copy itself.
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'skill-candidate.store.ts'),
        'utf8',
      );
      const query = source.slice(source.indexOf('getWinRates()'));
      for (const cls of DIGEST_WIN_EVIDENCE_CLASSES) {
        expect(query).toContain(`'${cls}'`);
      }
      // `no-correction` is weak evidence and belongs to NEITHER bucket.
      expect(DIGEST_WIN_EVIDENCE_CLASSES).not.toContain('no-correction');
    });
  });

  describe('scoreForWinRate — the null rule, in isolation', () => {
    it('scores an unmeasured skill BELOW every measured one, including a perfect one', () => {
      expect(scoreForWinRate(null)).toBe(DIGEST_WIN_RATE_UNMEASURED);
      expect(scoreForWinRate(null)).toBeLessThan(scoreForWinRate(1));
      expect(scoreForWinRate(null)).toBeLessThan(scoreForWinRate(0));
    });

    it('does NOT treat null as 0 — a measured loser outranks the unmeasured skill', () => {
      // The assertion the batch exists for, stated at the function. `0` is the
      // WORST measured rate and therefore the TOP of the sweep; `null` is not a
      // rate at all and must sit at the bottom.
      expect(scoreForWinRate(0)).toBeGreaterThan(scoreForWinRate(null));
      expect(scoreForWinRate(null)).not.toBe(scoreForWinRate(0));
    });

    it('orders measured rates worst-first and clamps out-of-range input', () => {
      expect(scoreForWinRate(0)).toBeGreaterThan(scoreForWinRate(0.5));
      expect(scoreForWinRate(0.5)).toBeGreaterThan(scoreForWinRate(1));
      expect(scoreForWinRate(-1)).toBe(scoreForWinRate(0));
      expect(scoreForWinRate(2)).toBe(scoreForWinRate(1));
    });
  });

  describe('sweep (a) — a relevant skill existed and was never invoked', () => {
    maybe('files a missed trigger citing the succeeded session', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
        saveVerdict(h, 's-research', 'tests-green', {
          intent: RESEARCH_INTENT,
        });

        const items = byKind(
          await h.curator.runDigest({ workspaceRoot: WORKSPACE }),
          'missed-trigger',
        );
        expect(items).toHaveLength(1);
        expect(items[0].evidence.sessionIds).toEqual(['s-research']);
        expect(items[0].evidence.counts.missedSessions).toBe(1);
        expect(items[0].title).toContain('deep-research');
      } finally {
        db.close();
      }
    });

    maybe(
      'files nothing when the skill WAS invoked in that session',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });
          invoke(h, 'deep-research', 's-research', 20);

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(byKind(items, 'missed-trigger')).toEqual([]);
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'files nothing for a skill the session has nothing to do with',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          promoteSkill(
            h,
            'notarize-desktop-installer',
            'Build and notarize the desktop installer bundle',
          );
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(byKind(items, 'missed-trigger')).toEqual([]);
        } finally {
          db.close();
        }
      },
    );

    maybe('files nothing for a session that did NOT succeed', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
        // `no-correction` is weak evidence, not a success — the sweep is about
        // work that WORKED and still did not reach for the skill.
        saveVerdict(h, 's-research', 'no-correction', {
          intent: RESEARCH_INTENT,
        });

        const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
        expect(byKind(items, 'missed-trigger')).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe('sweep (a) — the description rewrite goes through updatePending', () => {
    maybe(
      'appends the missed intent to a PENDING suggestion, once',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });
          const suggestion = h.suggestions.insertPending({
            name: 'deep-research',
            description: 'Research things.',
            body: '# body',
            memberSessionIds: ['s-old'],
            memberCandidateIds: ['c-old'],
            clusterSize: 3,
            technologyFingerprint: 'ts',
            judgeScore: 8,
          });

          const first = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          const after = h.suggestions.findById(suggestion.id);
          expect(after?.description).toContain(DIGEST_TRIGGER_CLAUSE_PREFIX);
          expect(after?.description).toContain(RESEARCH_INTENT);
          expect(
            byKind(first, 'missed-trigger')[0].evidence.counts
              .descriptionRewrites,
          ).toBe(1);

          // Idempotent: a weekly pass must not grow the field without bound.
          await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          const second = h.suggestions.findById(suggestion.id);
          expect(second?.description).toBe(after?.description);
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'never touches a decided suggestion and never files a new one',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });
          const accepted = h.suggestions.insertPending({
            name: 'deep-research',
            description: 'Research things.',
            body: '# body',
            memberSessionIds: ['s-old'],
            memberCandidateIds: ['c-old'],
            clusterSize: 3,
            technologyFingerprint: 'ts',
            judgeScore: 8,
          });
          h.suggestions.accept(accepted.id);

          await h.curator.runDigest({ workspaceRoot: WORKSPACE });

          const row = h.suggestions.findById(accepted.id);
          expect(row?.description).toBe('Research things.');
          expect(row?.status).toBe('accepted');
          // The autonomy boundary: no second suggestion-writing path exists here,
          // so the pass cannot conjure a proposal the user never asked for.
          const total = db
            .prepare('SELECT COUNT(*) AS c FROM skill_suggestions')
            .get() as { c: number };
          expect(Number(total.c)).toBe(1);
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'leaves candidate status alone — it ranks, it does not promote',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          const id = promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });

          await h.curator.runDigest({ workspaceRoot: WORKSPACE });

          const row = h.candidates.findById(id);
          expect(row?.status).toBe('promoted');
          expect(row?.residency).toBe('resident');
        } finally {
          db.close();
        }
      },
    );
  });

  describe('sweep (b) — friction clusters with no success', () => {
    maybe(
      'clusters two failing sessions that went wrong the same way',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          for (const sessionId of ['s-f1', 's-f2']) {
            saveVerdict(h, sessionId, 'unverified', {
              intent: 'Ship the migration',
              friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
            });
          }

          const items = byKind(
            await h.curator.runDigest({ workspaceRoot: WORKSPACE }),
            'friction-opportunity',
          );
          expect(items).toHaveLength(1);
          expect([...items[0].evidence.sessionIds].sort()).toEqual([
            's-f1',
            's-f2',
          ]);
          expect(items[0].evidence.counts.sessions).toBe(2);
          expect(items[0].evidence.counts.retry).toBe(2);
          // No skill exists for this hole, so there is nothing measured.
          expect(items[0].evidence.winRate).toBeNull();
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'drops a cluster in which any session eventually succeeded',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          for (const sessionId of ['s-f1', 's-f2']) {
            saveVerdict(h, sessionId, 'unverified', {
              friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
            });
          }
          saveVerdict(h, 's-won', 'tests-green', {
            friction: [{ turnIndex: 1, kind: 'retry', note: FRICTION_NOTE }],
          });

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(byKind(items, 'friction-opportunity')).toEqual([]);
        } finally {
          db.close();
        }
      },
    );

    maybe('needs a repeat — one bad session is not a pattern', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        saveVerdict(h, 's-f1', 'unverified', {
          friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
        });

        const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
        expect(byKind(items, 'friction-opportunity')).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe('sweep (c) — per-skill win rate, and the null that is not a zero', () => {
    maybe('ranks a measured loser ABOVE an unmeasured skill', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        promoteSkill(h, 'measured-loser', 'Runs the release checklist');
        promoteSkill(h, 'unmeasured', 'Drafts the release notes');
        invoke(h, 'measured-loser', 's-lost', 10);
        invoke(h, 'unmeasured', 's-unknown', 20);
        // `no-correction` stays IN the denominator and out of the numerator:
        // a measured 0. The other session has no verdict row at all.
        saveVerdict(h, 's-lost', 'no-correction');

        const items = byKind(
          await h.curator.runDigest({ workspaceRoot: WORKSPACE }),
          'win-rate',
        );
        const loser = items.find((i) => i.title.includes('measured-loser'));
        const unmeasured = items.find((i) => i.title.includes('unmeasured'));
        if (!loser || !unmeasured) throw new Error('both items expected');

        expect(loser.evidence.winRate).toBe(0);
        // `toBeNull`, never `toBeFalsy`: both values are falsy, and a falsiness
        // check would sail straight through the regression this pins.
        expect(unmeasured.evidence.winRate).toBeNull();
        expect(unmeasured.evidence.winRate).not.toBe(0);
        expect(loser.score).toBeGreaterThan(unmeasured.score);
        expect(items.indexOf(loser)).toBeLessThan(items.indexOf(unmeasured));
      } finally {
        db.close();
      }
    });

    maybe('cites the sessions the skill actually ran in', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        promoteSkill(h, 'measured-loser', 'Runs the release checklist');
        invoke(h, 'measured-loser', 's-lost', 10);
        saveVerdict(h, 's-lost', 'no-correction');

        const items = byKind(
          await h.curator.runDigest({ workspaceRoot: WORKSPACE }),
          'win-rate',
        );
        expect(items[0].evidence.sessionIds).toEqual(['s-lost']);
        expect(items[0].evidence.counts).toEqual({
          invocations: 1,
          wins: 0,
          unknown: 0,
        });
      } finally {
        db.close();
      }
    });
  });

  describe('sweep (d) — memory-conditioned relevance', () => {
    maybe(
      'cites the memory hits that corroborate a friction cluster',
      async () => {
        const db = createDb();
        try {
          const reader = memoryReaderStub(2);
          const h = makeHarness(db, reader);
          for (const sessionId of ['s-f1', 's-f2']) {
            saveVerdict(h, sessionId, 'unverified', {
              friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
            });
          }

          const items = byKind(
            await h.curator.runDigest({ workspaceRoot: WORKSPACE }),
            'memory-signal',
          );
          expect(items).toHaveLength(1);
          expect([...items[0].evidence.sessionIds].sort()).toEqual([
            's-f1',
            's-f2',
          ]);
          expect(items[0].evidence.counts.memoryHits).toBe(2);
          expect(items[0].evidence.winRate).toBeNull();
          expect(reader.search).toHaveBeenCalledWith(
            FRICTION_NOTE,
            expect.any(Number),
            WORKSPACE,
          );
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'is silent — not broken — on a host with no memory reader',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, null);
          for (const sessionId of ['s-f1', 's-f2']) {
            saveVerdict(h, sessionId, 'unverified', {
              friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
            });
          }

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(byKind(items, 'memory-signal')).toEqual([]);
          // The rest of the digest is unaffected by memory being absent.
          expect(byKind(items, 'friction-opportunity')).toHaveLength(1);
        } finally {
          db.close();
        }
      },
    );

    maybe('resolves when the memory reader itself throws', async () => {
      const db = createDb();
      try {
        const reader: IMemoryReader = {
          search: jest.fn().mockRejectedValue(new Error('index offline')),
        };
        const h = makeHarness(db, reader);
        for (const sessionId of ['s-f1', 's-f2']) {
          saveVerdict(h, sessionId, 'unverified', {
            friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
          });
        }

        const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
        expect(byKind(items, 'memory-signal')).toEqual([]);
        expect(byKind(items, 'friction-opportunity')).toHaveLength(1);
      } finally {
        db.close();
      }
    });
  });

  describe('the C2 ⇢ C4 soft edge', () => {
    maybe(
      'resolves with no friction items when the verdict table is EMPTY',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, memoryReaderStub(1));
          promoteSkill(h, 'measured-loser', 'Runs the release checklist');
          invoke(h, 'measured-loser', 's-lost', 10);

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(byKind(items, 'friction-opportunity')).toEqual([]);
          expect(byKind(items, 'missed-trigger')).toEqual([]);
          // The win-rate sweep does not read verdicts through the store, so it
          // still answers — with `null`, because nothing settled the outcome.
          expect(byKind(items, 'win-rate')[0].evidence.winRate).toBeNull();
        } finally {
          db.close();
        }
      },
    );

    maybe(
      'RESOLVES rather than throwing when the verdict table is MISSING',
      async () => {
        // A host still on a pre-`0034` schema: the query THROWS rather than
        // returning nothing. This is the case that catches a removed guard — the
        // empty-table test above passes against unguarded code, because an empty
        // table is a successful query.
        //
        // Every sweep goes quiet here, the win-rate one included: `getWinRates()`
        // LEFT JOINs the same missing table, so its read degrades too. That is
        // the honest answer — a digest with no evidence files no items — and it
        // is very different from a rejected promise, which is what the caller
        // would have to handle if the guards were gone.
        const db = createDb();
        try {
          db.exec('DROP TABLE skill_session_verdicts');
          const h = makeHarness(db, memoryReaderStub(1));
          promoteSkill(h, 'measured-loser', 'Runs the release checklist');
          invoke(h, 'measured-loser', 's-lost', 10);

          await expect(
            h.curator.runDigest({ workspaceRoot: WORKSPACE }),
          ).resolves.toEqual([]);
        } finally {
          db.close();
        }
      },
    );

    maybe('resolves on a completely empty database', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        await expect(
          h.curator.runDigest({ workspaceRoot: WORKSPACE }),
        ).resolves.toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  describe('the whole pass', () => {
    maybe(
      'produces all four kinds, each with receipts, ranked descending',
      async () => {
        const db = createDb();
        try {
          const h = makeHarness(db, memoryReaderStub(3));
          // (a) a relevant skill that never fired on a succeeded session…
          promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
          saveVerdict(h, 's-research', 'tests-green', {
            intent: RESEARCH_INTENT,
          });
          // …(c) but which did run, unmeasured, somewhere else.
          invoke(h, 'deep-research', 's-elsewhere', 30);
          // (b) + (d) a friction cluster nobody solved.
          for (const sessionId of ['s-f1', 's-f2']) {
            saveVerdict(h, sessionId, 'unverified', {
              friction: [{ turnIndex: 3, kind: 'retry', note: FRICTION_NOTE }],
            });
          }

          const items = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
          expect(new Set(items.map((i) => i.kind))).toEqual(
            new Set([
              'missed-trigger',
              'friction-opportunity',
              'win-rate',
              'memory-signal',
            ]),
          );
          for (const item of items) {
            expect(item.evidence.sessionIds.length).toBeGreaterThan(0);
            expect(item.rationale.length).toBeGreaterThan(0);
          }
          const scores = items.map((i) => i.score);
          expect([...scores].sort((a, b) => b - a)).toEqual(scores);
        } finally {
          db.close();
        }
      },
    );

    maybe('honours the limit and keeps the highest-scoring items', async () => {
      const db = createDb();
      try {
        const h = makeHarness(db, null);
        promoteSkill(h, 'deep-research', RESEARCH_DESCRIPTION);
        saveVerdict(h, 's-research', 'tests-green', {
          intent: RESEARCH_INTENT,
        });
        invoke(h, 'deep-research', 's-elsewhere', 30);

        const all = await h.curator.runDigest({ workspaceRoot: WORKSPACE });
        expect(all.length).toBeGreaterThan(1);
        const capped = await h.curator.runDigest({
          workspaceRoot: WORKSPACE,
          limit: 1,
        });
        expect(capped).toEqual([all[0]]);
      } finally {
        db.close();
      }
    });
  });
});
