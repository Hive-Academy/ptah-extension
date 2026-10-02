import 'reflect-metadata';
import { SkillSuggestionStore } from './skill-suggestion.store';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { NewSuggestionInput } from './types';
import {
  resolveOpener,
  type TestDatabase,
} from './queue/queue-db.test-support';

const sql0025SkillSuggestions =
  MIGRATIONS.find((m) => m.version === 25)?.sql ?? '';
const sql0051SkillLifecycle =
  MIGRATIONS.find((m) => m.version === 51)?.sql ?? '';

const warn = jest.fn();
const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn,
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillSuggestionStore>[0];

// `better-sqlite3` if it loads in this runner, else the built-in `node:sqlite`.
const opener = resolveOpener();

const maybe = opener ? describe : describe.skip;

function newInput(
  overrides: Partial<NewSuggestionInput> = {},
): NewSuggestionInput {
  return {
    name: 'add-error-handling',
    description: 'Wrap risky calls in try/catch',
    body: '## Description\n...',
    memberSessionIds: ['s1', 's2'],
    memberCandidateIds: ['c1', 'c2'],
    clusterSize: 2,
    technologyFingerprint: 'edit,bash',
    judgeScore: 7.5,
    ...overrides,
  };
}

maybe('SkillSuggestionStore', () => {
  let db: TestDatabase;

  beforeEach(() => warn.mockClear());

  function makeStore(): SkillSuggestionStore {
    db = (opener as (file: string) => TestDatabase)(':memory:');
    db.exec(sql0025SkillSuggestions);
    db.exec(sql0051SkillLifecycle);
    const connection = { db } as unknown as SqliteConnectionService;
    return new SkillSuggestionStore(noopLogger, connection);
  }

  it('inserts a pending suggestion and reads it back', () => {
    const store = makeStore();
    const row = store.insert(newInput(), 'pending');
    expect(row.status).toBe('pending');
    expect(row.memberCandidateIds).toEqual(['c1', 'c2']);
    expect(row.decidedAt).toBeNull();
    expect(row.mergedInto).toBeNull();
    expect(row.promotedCandidateId).toBeNull();
    expect(row.references).toEqual([]);
    expect(store.findById(row.id)?.id).toBe(row.id);
  });

  describe('lineage (0051)', () => {
    it('insert(dismissed) writes decided_at and the dismissed status', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'dismissed');
      expect(row.status).toBe('dismissed');
      expect(row.decidedAt).toBe(row.createdAt);
      expect(store.listByStatus('pending')).toHaveLength(0);
    });

    it('insert(pending) leaves decided_at null', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      expect(row.status).toBe('pending');
      expect(row.decidedAt).toBeNull();
    });

    it('round-trips references', () => {
      const store = makeStore();
      const references = [
        { name: 'testing', body: '# Testing\nRun jest.' },
        { name: 'lint', body: '# Lint\nRun eslint.' },
      ];
      const row = store.insert(newInput({ references }), 'pending');
      expect(row.references).toEqual(references);
      expect(store.findById(row.id)?.references).toEqual(references);
    });

    it('reads a corrupt references_json as [] and warns', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      db.prepare(
        `UPDATE skill_suggestions SET references_json = ? WHERE id = ?`,
      ).run('{not json', row.id);

      const read = store.findById(row.id);

      expect(read?.references).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('references_json is not valid JSON'),
        expect.objectContaining({ id: row.id }),
      );
    });

    it('reads a non-array references_json as [] and warns', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      db.prepare(
        `UPDATE skill_suggestions SET references_json = ? WHERE id = ?`,
      ).run('{"name":"x","body":"y"}', row.id);

      expect(store.findById(row.id)?.references).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('not an array'),
        expect.objectContaining({ id: row.id }),
      );
    });

    it('drops malformed reference entries and keeps the valid ones', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      db.prepare(
        `UPDATE skill_suggestions SET references_json = ? WHERE id = ?`,
      ).run(
        JSON.stringify([{ name: 'ok', body: 'b' }, { name: 1 }, 'x', null]),
        row.id,
      );

      expect(store.findById(row.id)?.references).toEqual([
        { name: 'ok', body: 'b' },
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('malformed entries'),
        expect.objectContaining({ id: row.id, dropped: 3 }),
      );
    });

    it('accept records the promoted candidate id', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      const accepted = store.accept(row.id, 'cand-42');
      expect(accepted?.status).toBe('accepted');
      expect(accepted?.promotedCandidateId).toBe('cand-42');
    });

    it('accept with null leaves promoted_candidate_id null', () => {
      const store = makeStore();
      const row = store.insert(newInput(), 'pending');
      expect(store.accept(row.id, null)?.promotedCandidateId).toBeNull();
    });

    it('markMerged dismisses pending rows with merged_into and returns the count', () => {
      const store = makeStore();
      const a = store.insert(newInput(), 'pending');
      const b = store.insert(newInput(), 'pending');
      const umbrella = store.insert(newInput({ name: 'umbrella' }), 'pending');

      const changed = store.markMerged([a.id, b.id, a.id], umbrella.id);

      expect(changed).toBe(2);
      for (const id of [a.id, b.id]) {
        const row = store.findById(id);
        expect(row?.status).toBe('dismissed');
        expect(row?.mergedInto).toBe(umbrella.id);
        expect(row?.decidedAt).not.toBeNull();
      }
      expect(store.findById(umbrella.id)?.status).toBe('pending');
    });

    it('markMerged leaves non-pending rows untouched', () => {
      const store = makeStore();
      const accepted = store.insert(newInput(), 'pending');
      store.accept(accepted.id, 'cand-1');
      const dismissed = store.insert(newInput(), 'pending');
      store.dismiss(dismissed.id);
      const pending = store.insert(newInput(), 'pending');

      const changed = store.markMerged(
        [accepted.id, dismissed.id, pending.id],
        'umbrella-1',
      );

      expect(changed).toBe(1);
      expect(store.findById(accepted.id)?.status).toBe('accepted');
      expect(store.findById(accepted.id)?.mergedInto).toBeNull();
      expect(store.findById(dismissed.id)?.mergedInto).toBeNull();
      expect(store.findById(pending.id)?.mergedInto).toBe('umbrella-1');
    });

    it('markMerged never merges the umbrella into itself', () => {
      const store = makeStore();
      const member = store.insert(newInput(), 'pending');
      const umbrella = store.insert(newInput({ name: 'umbrella' }), 'pending');

      const changed = store.markMerged([umbrella.id, member.id], umbrella.id);

      expect(changed).toBe(1);
      const umbrellaRow = store.findById(umbrella.id);
      expect(umbrellaRow?.status).toBe('pending');
      expect(umbrellaRow?.mergedInto).toBeNull();
      expect(umbrellaRow?.decidedAt).toBeNull();
      expect(store.findById(member.id)?.mergedInto).toBe(umbrella.id);
      expect(store.markMerged([umbrella.id], umbrella.id)).toBe(0);
      expect(store.findById(umbrella.id)?.status).toBe('pending');
    });

    it('markMerged with no ids changes nothing', () => {
      const store = makeStore();
      store.insert(newInput(), 'pending');
      expect(store.markMerged([], 'umbrella-1')).toBe(0);
    });

    it('listMemberCandidateIds unions members across all statuses by default', () => {
      const store = makeStore();
      store.insert(newInput({ memberCandidateIds: ['c1', 'c2'] }), 'pending');
      const acc = store.insert(
        newInput({ memberCandidateIds: ['c2', 'c3'] }),
        'pending',
      );
      store.accept(acc.id, null);
      store.insert(newInput({ memberCandidateIds: ['c4'] }), 'dismissed');

      expect([...store.listMemberCandidateIds()].sort()).toEqual([
        'c1',
        'c2',
        'c3',
        'c4',
      ]);
    });

    it('listMemberCandidateIds filters by the given statuses', () => {
      const store = makeStore();
      store.insert(newInput({ memberCandidateIds: ['c1'] }), 'pending');
      const acc = store.insert(
        newInput({ memberCandidateIds: ['c2'] }),
        'pending',
      );
      store.accept(acc.id, null);
      store.insert(newInput({ memberCandidateIds: ['c3'] }), 'dismissed');

      expect(
        [
          ...store.listMemberCandidateIds({
            statuses: ['pending', 'accepted'],
          }),
        ].sort(),
      ).toEqual(['c1', 'c2']);
      expect([
        ...store.listMemberCandidateIds({ statuses: ['dismissed'] }),
      ]).toEqual(['c3']);
      expect(store.listMemberCandidateIds({ statuses: [] }).size).toBe(0);
    });

    it('listAcceptedWithoutPromotedCandidate returns only unlinked accepted rows', () => {
      const store = makeStore();
      const unlinked = store.insert(newInput(), 'pending');
      store.accept(unlinked.id, null);
      const linked = store.insert(newInput(), 'pending');
      store.accept(linked.id, 'cand-9');
      store.insert(newInput(), 'pending');

      const rows = store.listAcceptedWithoutPromotedCandidate();

      expect(rows.map((r) => r.id)).toEqual([unlinked.id]);
    });

    describe('linkPromotedCandidate', () => {
      it('links an accepted, unlinked row once and returns true', () => {
        const store = makeStore();
        const row = store.insert(newInput(), 'pending');
        store.accept(row.id, null);

        expect(store.linkPromotedCandidate(row.id, 'cand-1')).toBe(true);
        expect(store.findById(row.id)?.promotedCandidateId).toBe('cand-1');
        expect(store.listAcceptedWithoutPromotedCandidate()).toEqual([]);
      });

      it('returns false on a second call', () => {
        const store = makeStore();
        const row = store.insert(newInput(), 'pending');
        store.accept(row.id, null);
        store.linkPromotedCandidate(row.id, 'cand-1');

        expect(store.linkPromotedCandidate(row.id, 'cand-1')).toBe(false);
      });

      it('returns false for a pending or a dismissed row and writes nothing', () => {
        const store = makeStore();
        const pending = store.insert(newInput(), 'pending');
        const dismissed = store.insert(newInput(), 'pending');
        store.dismiss(dismissed.id);

        expect(store.linkPromotedCandidate(pending.id, 'cand-1')).toBe(false);
        expect(store.linkPromotedCandidate(dismissed.id, 'cand-1')).toBe(false);
        expect(store.findById(pending.id)?.promotedCandidateId).toBeNull();
        expect(store.findById(dismissed.id)?.promotedCandidateId).toBeNull();
      });

      it('returns false for an already-linked row and keeps its link', () => {
        const store = makeStore();
        const row = store.insert(newInput(), 'pending');
        store.accept(row.id, 'cand-original');

        expect(store.linkPromotedCandidate(row.id, 'cand-other')).toBe(false);
        expect(store.findById(row.id)?.promotedCandidateId).toBe(
          'cand-original',
        );
      });
    });
  });

  it('lists by status', () => {
    const store = makeStore();
    store.insert(newInput(), 'pending');
    store.insert(newInput({ technologyFingerprint: 'jest' }), 'pending');
    expect(store.listByStatus('pending')).toHaveLength(2);
    expect(store.listByStatus('accepted')).toHaveLength(0);
  });

  it('accept transitions pending → accepted with decided_at', () => {
    const store = makeStore();
    const row = store.insert(newInput(), 'pending');
    const accepted = store.accept(row.id, null);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.decidedAt).not.toBeNull();
  });

  it('dismiss transitions pending → dismissed', () => {
    const store = makeStore();
    const row = store.insert(newInput(), 'pending');
    const dismissed = store.dismiss(row.id);
    expect(dismissed?.status).toBe('dismissed');
  });

  it('does not re-transition a non-pending row', () => {
    const store = makeStore();
    const row = store.insert(newInput(), 'pending');
    store.accept(row.id, null);
    const again = store.dismiss(row.id);
    expect(again?.status).toBe('accepted');
  });

  // updatePending — added for feature coverage
  it('updatePending: updates all three editable fields on a pending row', () => {
    const store = makeStore();
    const row = store.insert(newInput(), 'pending');
    const updated = store.updatePending(row.id, {
      name: 'new-name',
      description: 'new description',
      body: '## New body',
    });
    expect(updated?.name).toBe('new-name');
    expect(updated?.description).toBe('new description');
    expect(updated?.body).toBe('## New body');
    expect(updated?.status).toBe('pending');
  });

  it('updatePending: partial update preserves unspecified fields', () => {
    const store = makeStore();
    const row = store.insert(
      newInput({ name: 'orig', description: 'orig desc', body: 'orig body' }),
      'pending',
    );
    const updated = store.updatePending(row.id, { name: 'changed' });
    expect(updated?.name).toBe('changed');
    expect(updated?.description).toBe('orig desc');
    expect(updated?.body).toBe('orig body');
  });

  it('updatePending: returns null and does not throw for unknown id', () => {
    const store = makeStore();
    const result = store.updatePending('does-not-exist', { name: 'x' });
    expect(result).toBeNull();
  });

  it('updatePending: returns row unchanged (no mutation) when already accepted', () => {
    const store = makeStore();
    const row = store.insert(newInput({ name: 'original' }), 'pending');
    store.accept(row.id, null);
    const result = store.updatePending(row.id, { name: 'changed' });
    expect(result?.name).toBe('original');
    expect(result?.status).toBe('accepted');
  });

  it('updatePending: returns row unchanged (no mutation) when already dismissed', () => {
    const store = makeStore();
    const row = store.insert(newInput({ name: 'original' }), 'pending');
    store.dismiss(row.id);
    const result = store.updatePending(row.id, { name: 'changed' });
    expect(result?.name).toBe('original');
    expect(result?.status).toBe('dismissed');
  });

  it('updatePending: empty fields object leaves row unchanged', () => {
    const store = makeStore();
    const row = store.insert(newInput({ name: 'keep-me' }), 'pending');
    const updated = store.updatePending(row.id, {});
    expect(updated?.name).toBe('keep-me');
  });
});
