import 'reflect-metadata';
import { SkillSuggestionStore } from './skill-suggestion.store';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { NewSuggestionInput } from './types';

const sql0025SkillSuggestions =
  MIGRATIONS.find((m) => m.version === 25)?.sql ?? '';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillSuggestionStore>[0];

let nativeAvailable = false;
let Database: (new (file: string) => unknown) | null = null;
try {
  require.resolve('better-sqlite3');
  Database = require('better-sqlite3');
  const probe = new (Database as new (f: string) => { close(): void })(
    ':memory:',
  );
  probe.close();
  nativeAvailable = true;
} catch {
  nativeAvailable = false;
}

const maybe = nativeAvailable ? describe : describe.skip;

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
  function makeStore(): SkillSuggestionStore {
    const db = new (Database as new (f: string) => { exec(s: string): void })(
      ':memory:',
    );
    db.exec(sql0025SkillSuggestions);
    const connection = { db } as unknown as SqliteConnectionService;
    return new SkillSuggestionStore(noopLogger, connection);
  }

  it('inserts a pending suggestion and reads it back', () => {
    const store = makeStore();
    const row = store.insertPending(newInput());
    expect(row.status).toBe('pending');
    expect(row.memberCandidateIds).toEqual(['c1', 'c2']);
    expect(row.decidedAt).toBeNull();
    expect(store.findById(row.id)?.id).toBe(row.id);
  });

  it('lists by status', () => {
    const store = makeStore();
    store.insertPending(newInput());
    store.insertPending(newInput({ technologyFingerprint: 'jest' }));
    expect(store.listByStatus('pending')).toHaveLength(2);
    expect(store.listByStatus('accepted')).toHaveLength(0);
  });

  it('accept transitions pending → accepted with decided_at', () => {
    const store = makeStore();
    const row = store.insertPending(newInput());
    const accepted = store.accept(row.id);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.decidedAt).not.toBeNull();
  });

  it('dismiss transitions pending → dismissed', () => {
    const store = makeStore();
    const row = store.insertPending(newInput());
    const dismissed = store.dismiss(row.id);
    expect(dismissed?.status).toBe('dismissed');
  });

  it('does not re-transition a non-pending row', () => {
    const store = makeStore();
    const row = store.insertPending(newInput());
    store.accept(row.id);
    const again = store.dismiss(row.id);
    expect(again?.status).toBe('accepted');
  });

  it('hasExistingForCluster matches on fingerprint', () => {
    const store = makeStore();
    store.insertPending(newInput({ technologyFingerprint: 'edit,bash' }));
    expect(store.hasExistingForCluster('edit,bash', ['x'])).toBe(true);
    expect(store.hasExistingForCluster('other', ['x'])).toBe(false);
  });

  it('hasExistingForCluster matches on member candidate overlap', () => {
    const store = makeStore();
    store.insertPending(
      newInput({ technologyFingerprint: 'a', memberCandidateIds: ['c1'] }),
    );
    expect(store.hasExistingForCluster('b', ['c1', 'c9'])).toBe(true);
    expect(store.hasExistingForCluster('b', ['c8', 'c9'])).toBe(false);
  });

  it('dismissed rows still block re-proposal (kept for dedup)', () => {
    const store = makeStore();
    const row = store.insertPending(newInput({ technologyFingerprint: 'z' }));
    store.dismiss(row.id);
    expect(store.hasExistingForCluster('z', ['new'])).toBe(true);
  });
});
