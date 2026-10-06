import { matchesFact } from '../matching/fact-matcher';
import {
  GREP_TOP_K,
  GrepHit,
  LAST_N_MESSAGES,
  LastNMessage,
  lastNMessagesBaseline,
  noMemoryBaseline,
  rawTranscriptGrepNewest,
  rawTranscriptGrepTopK,
  TimestampedTranscriptMessage,
} from './read-side-baselines';

function line(
  timestamp: string,
  role: 'user' | 'assistant' | 'system' | 'tool',
  text: string,
): TimestampedTranscriptMessage {
  return { role, text, timestamp };
}

const SEED_SESSIONS: readonly (readonly TimestampedTranscriptMessage[])[] = [
  [
    line(
      '2026-08-17T09:00:00.000Z',
      'user',
      'We decided pnpm is the package manager',
    ),
    line('2026-08-17T10:00:00.000Z', 'assistant', 'Noted the pnpm decision'),
  ],
  [
    line('2026-09-02T09:00:00.000Z', 'user', 'The judge threshold is now 0.8'),
    line(
      '2026-09-02T10:00:00.000Z',
      'assistant',
      'Judge threshold 0.8 recorded',
    ),
  ],
];

describe('noMemoryBaseline (design 156, 164)', () => {
  it('injects nothing', () => {
    expect(noMemoryBaseline()).toEqual([]);
  });
});

describe('lastNMessagesBaseline (design 164)', () => {
  it('concatenates the seed sessions newest-last and keeps the tail', () => {
    const window = lastNMessagesBaseline(SEED_SESSIONS, 2);
    expect(window.map((message) => message.content)).toEqual([
      'The judge threshold is now 0.8',
      'Judge threshold 0.8 recorded',
    ]);
  });

  function contentOf(window: readonly LastNMessage[]): readonly string[] {
    return window.map((message) => message.content);
  }

  it('keeps the newest 50 by default', () => {
    const many: TimestampedTranscriptMessage[] = [];
    for (let i = 0; i < 80; i += 1) {
      many.push(
        line(
          new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
          'user',
          `m${i}`,
        ),
      );
    }
    const window = lastNMessagesBaseline([many]);
    expect(window).toHaveLength(LAST_N_MESSAGES);
    expect(contentOf(window)[0]).toBe('m30');
    expect(contentOf(window)[LAST_N_MESSAGES - 1]).toBe('m79');
  });

  it('returns every message when fewer than N exist', () => {
    expect(lastNMessagesBaseline(SEED_SESSIONS)).toHaveLength(4);
  });

  it('returns nothing for N <= 0 or no sessions', () => {
    expect(lastNMessagesBaseline(SEED_SESSIONS, 0)).toEqual([]);
    expect(lastNMessagesBaseline([], 5)).toEqual([]);
  });

  it('carries the timestamp as metadata, not in the content', () => {
    const window = lastNMessagesBaseline(SEED_SESSIONS, 1);
    expect(window[0].timestamp).toBe('2026-09-02T10:00:00.000Z');
    expect(window[0].role).toBe('assistant');
    expect(window[0].content).not.toContain('2026');
  });
});

describe('rawTranscriptGrepNewest (design 156)', () => {
  it('returns the newest line containing a keyword', () => {
    const hit = rawTranscriptGrepNewest(SEED_SESSIONS, ['threshold']);
    expect(hit?.text).toBe('Judge threshold 0.8 recorded');
    expect(hit?.timestamp).toBe('2026-09-02T10:00:00.000Z');
  });

  it('prefers the later input line on equal timestamps', () => {
    const sessions: readonly (readonly TimestampedTranscriptMessage[])[] = [
      [
        line('2026-08-17T09:00:00.000Z', 'user', 'first pnpm line'),
        line('2026-08-17T09:00:00.000Z', 'user', 'second pnpm line'),
      ],
    ];
    expect(rawTranscriptGrepNewest(sessions, ['pnpm'])?.text).toBe(
      'second pnpm line',
    );
  });

  it('matches case-insensitively through the R-M4 normalisation', () => {
    expect(rawTranscriptGrepNewest(SEED_SESSIONS, ['PNPM'])?.text).toBe(
      'Noted the pnpm decision',
    );
  });

  it('renders the whole line, timestamp included, for the matcher', () => {
    const hit = rawTranscriptGrepNewest(SEED_SESSIONS, ['threshold']);
    expect(hit?.content).toBe(
      '2026-09-02T10:00:00.000Z Judge threshold 0.8 recorded',
    );
    expect(
      hit &&
        matchesFact(
          { keyTokens: [['threshold'], ['0.8']], forbiddenTokens: [] },
          hit,
        ),
    ).toBe(true);
  });

  it('finds nothing without keywords or without a matching line', () => {
    expect(rawTranscriptGrepNewest(SEED_SESSIONS, [])).toBeNull();
    expect(rawTranscriptGrepNewest(SEED_SESSIONS, ['nomatch'])).toBeNull();
    expect(rawTranscriptGrepNewest([], ['pnpm'])).toBeNull();
  });

  it('ignores blank keywords', () => {
    expect(rawTranscriptGrepNewest(SEED_SESSIONS, ['  '])).toBeNull();
  });
});

describe('rawTranscriptGrepTopK (design 164)', () => {
  function hitsOf(hits: readonly GrepHit[]): readonly string[] {
    return hits.map((hit) => hit.text);
  }

  it('ranks by keyword hits and keeps the newest on ties', () => {
    const sessions: readonly (readonly TimestampedTranscriptMessage[])[] = [
      [
        line('2026-08-01T00:00:00.000Z', 'user', 'alpha beta'),
        line('2026-08-03T00:00:00.000Z', 'user', 'alpha only'),
        line('2026-08-02T00:00:00.000Z', 'user', 'alpha beta too'),
      ],
    ];
    const hits = rawTranscriptGrepTopK(sessions, ['alpha', 'beta'], 3);
    expect(hitsOf(hits)).toEqual([
      'alpha beta too', // 2 hits, the newer of the two 2-hit lines
      'alpha beta', // 2 hits, the older
      'alpha only', // 1 hit
    ]);
    expect(hits[0].keywordHits).toBe(2);
    expect(hits[2].keywordHits).toBe(1);
  });

  it('keeps the default top 5', () => {
    const many: TimestampedTranscriptMessage[] = [];
    for (let i = 0; i < 8; i += 1) {
      many.push(
        line(`2026-08-0${i + 1}T00:00:00.000Z`, 'user', `grep target ${i}`),
      );
    }
    const hits = rawTranscriptGrepTopK([many], ['grep']);
    expect(hits).toHaveLength(GREP_TOP_K);
    // all lines tie on hits; the newer timestamps come first, so the newest
    // five of the eight days survive, newest first
    expect(hitsOf(hits)[0]).toBe('grep target 7');
    expect(hitsOf(hits)[4]).toBe('grep target 3');
  });

  it('falls back to input order when hits and timestamp are equal', () => {
    const sessions: readonly (readonly TimestampedTranscriptMessage[])[] = [
      [
        line('2026-08-01T00:00:00.000Z', 'user', 'first tie'),
        line('2026-08-01T00:00:00.000Z', 'user', 'second tie'),
      ],
    ];
    const hits = rawTranscriptGrepTopK(sessions, ['tie'], 2);
    expect(hitsOf(hits)).toEqual(['first tie', 'second tie']);
  });

  it('returns nothing for K <= 0, no keywords or no matches', () => {
    expect(rawTranscriptGrepTopK(SEED_SESSIONS, ['pnpm'], 0)).toEqual([]);
    expect(rawTranscriptGrepTopK(SEED_SESSIONS, [])).toEqual([]);
    expect(rawTranscriptGrepTopK([], ['pnpm'])).toEqual([]);
    expect(rawTranscriptGrepTopK(SEED_SESSIONS, ['nomatch'])).toEqual([]);
  });

  it('counts a keyword once no matter how often the line repeats it', () => {
    const sessions: readonly (readonly TimestampedTranscriptMessage[])[] = [
      [line('2026-08-01T00:00:00.000Z', 'user', 'pnpm pnpm pnpm')],
    ];
    const hits = rawTranscriptGrepTopK(sessions, ['pnpm']);
    expect(hits).toHaveLength(1);
    expect(hits[0].keywordHits).toBe(1);
  });
});
