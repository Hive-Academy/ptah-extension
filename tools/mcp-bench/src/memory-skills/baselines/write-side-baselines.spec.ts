import {
  appendOnlySeed,
  BaselineMemoryRow,
  byteEqualSubjectMerge,
  extractAllBaseline,
  latestChunkWins,
  neverMerge,
  SlottedRow,
  tier1CaseFoldedMerge,
} from './write-side-baselines';

function message(
  role: 'user' | 'assistant' | 'system' | 'tool',
  text: string,
): { role: 'user' | 'assistant' | 'system' | 'tool'; text: string } {
  return { role, text };
}

describe('extractAllBaseline (design 128)', () => {
  it('turns every user and assistant message into one row, others into none', () => {
    const rows = extractAllBaseline([
      message('user', 'We use pnpm workspaces'),
      message('system', 'tool schema'),
      message('assistant', 'Noted: pnpm is the package manager'),
      message('tool', 'result payload'),
    ]);
    expect(rows).toEqual([
      {
        subject: 'We use pnpm workspaces',
        content: 'We use pnpm workspaces',
      },
      {
        subject: 'Noted: pnpm is the package manager',
        content: 'Noted: pnpm is the package manager',
      },
    ]);
  });

  it('uses the first non-empty line as the subject and keeps the full text as content', () => {
    const rows = extractAllBaseline([
      message('assistant', '\nJudge threshold is 0.8\nsecond line'),
    ]);
    expect(rows).toEqual([
      {
        subject: 'Judge threshold is 0.8',
        content: '\nJudge threshold is 0.8\nsecond line',
      },
    ]);
  });

  it('skips blank messages and returns an empty list for empty input', () => {
    expect(extractAllBaseline([])).toEqual([]);
    expect(extractAllBaseline([message('user', '  \n \t')])).toEqual([]);
  });
});

describe('merge policies (design 139)', () => {
  const left = { subject: 'Judge threshold' };
  const sameCase = { subject: 'Judge threshold' };
  const caseVariant = { subject: ' judge THRESHOLD ' };
  const different = { subject: 'Reranker variance' };

  it('byte-equal subject merges only on exact case-sensitive equality', () => {
    expect(byteEqualSubjectMerge(left, sameCase)).toBe(true);
    expect(byteEqualSubjectMerge(left, caseVariant)).toBe(false);
    expect(byteEqualSubjectMerge(left, different)).toBe(false);
  });

  it('tier-1 case-folded merge matches on trimmed lowercase subjects', () => {
    expect(tier1CaseFoldedMerge(left, caseVariant)).toBe(true);
    expect(tier1CaseFoldedMerge(left, different)).toBe(false);
    expect(tier1CaseFoldedMerge(left, { subject: '' })).toBe(false);
  });

  it('never merge rejects every pair', () => {
    expect(neverMerge(left, sameCase)).toBe(false);
    expect(neverMerge(left, left)).toBe(false);
  });
});

describe('latestChunkWins (design 156)', () => {
  const rows: SlottedRow<{ id: string }>[] = [
    {
      row: { id: 'old-match' },
      matchesSlot: true,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
    {
      row: { id: 'no-match' },
      matchesSlot: false,
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      row: { id: 'new-match' },
      matchesSlot: true,
      createdAt: '2026-08-17T10:00:00.000Z',
    },
  ];

  it('keeps the newest chunk among the rows matching the slot', () => {
    expect(latestChunkWins(rows)).toEqual({ id: 'new-match' });
  });

  it('returns null when no row matches the slot or the input is empty', () => {
    expect(latestChunkWins([])).toBeNull();
    expect(
      latestChunkWins([
        {
          row: { id: 'x' },
          matchesSlot: false,
          createdAt: '2026-08-17T10:00:00.000Z',
        },
      ]),
    ).toBeNull();
  });

  it('breaks timestamp ties with the later row in input order', () => {
    expect(
      latestChunkWins([
        {
          row: { id: 'first' },
          matchesSlot: true,
          createdAt: '2026-08-17T10:00:00.000Z',
        },
        {
          row: { id: 'second' },
          matchesSlot: true,
          createdAt: '2026-08-17T10:00:00.000Z',
        },
      ]),
    ).toEqual({ id: 'second' });
  });

  it('compares parsed timestamps and rejects non-ISO timestamps', () => {
    expect(
      latestChunkWins([
        {
          row: { id: 'older' },
          matchesSlot: true,
          createdAt: '2026-08-17T09:00:00Z',
        },
        {
          row: { id: 'newer' },
          matchesSlot: true,
          createdAt: '2026-08-17T09:00:00.001Z',
        },
      ]),
    ).toEqual({ id: 'newer' });
    expect(() =>
      latestChunkWins([
        { row: { id: 'bad' }, matchesSlot: true, createdAt: 'not-a-date' },
      ]),
    ).toThrow(RangeError);
  });
});

describe('appendOnlySeed (design 99)', () => {
  const first: BaselineMemoryRow = {
    subject: 'Test framework',
    content: 'The suite runs on jest',
  };
  const reseeded: BaselineMemoryRow = {
    subject: 'Test framework',
    content: 'The suite runs on vitest',
  };

  it('appends every reseed row and keeps every existing row untouched', () => {
    expect(appendOnlySeed([first], [reseeded])).toEqual([first, reseeded]);
  });

  it('never supersedes: an existing row survives a reseed of the same subject', () => {
    const result = appendOnlySeed([first], [reseeded]);
    expect(
      result.filter((row) => row.subject === 'Test framework'),
    ).toHaveLength(2);
  });

  it('returns the existing rows alone when the reseed is empty', () => {
    expect(appendOnlySeed([first], [])).toEqual([first]);
  });
});
