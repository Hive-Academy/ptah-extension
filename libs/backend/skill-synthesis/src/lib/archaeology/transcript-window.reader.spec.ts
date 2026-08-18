/**
 * TranscriptWindowReader unit tests.
 *
 * The reader is the retrieval engine the archaeologist's multi-pass loop runs
 * on, so the properties under test are the three the loop depends on: turn
 * indices are exact (the verdict cites them), every path is bounded by
 * `maxInputChars` and truncates at the DOCUMENTED end, and the whole thing is
 * deterministic and free of I/O once `open()` has run.
 *
 * The transcript is built directly through `fromTurns` / `fromMessages` for the
 * pure paths; only the `open()` block goes through a two-method fake reader.
 */
import {
  MAX_SEARCH_PROBE_CHARS,
  OMITTED_TURNS_MARKER_PREFIX,
  TRUNCATED_TURN_MARKER,
  TranscriptWindowReader,
  type TranscriptTurn,
} from './transcript-window.reader';

/** `index` is reassigned by `fromTurns`, so the value here is a placeholder. */
const turn = (role: 'user' | 'assistant', text: string): TranscriptTurn => ({
  index: 0,
  role,
  text,
});

/** N turns of identical shape: `turn 0 body`, `turn 1 body`, … */
const session = (count: number, maxInputChars = 100_000) =>
  TranscriptWindowReader.fromTurns(
    Array.from({ length: count }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i} body`),
    ),
    maxInputChars,
  );

const userMessage = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
});
const assistantMessage = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: text },
});

describe('TranscriptWindowReader', () => {
  describe('turn-index addressing', () => {
    it('head(n) serves the first n turns, ascending', () => {
      const w = session(10).head(3);
      expect(w.turnIndices).toEqual([0, 1, 2]);
      expect(w.omittedTurnIndices).toEqual([]);
      expect(w.truncated).toBe(false);
      expect(w.totalTurns).toBe(10);
    });

    it('tail(n) serves the last n turns, ascending', () => {
      const w = session(10).tail(3);
      expect(w.turnIndices).toEqual([7, 8, 9]);
      expect(w.truncated).toBe(false);
    });

    it('range(from,to) is inclusive at both ends', () => {
      expect(session(10).range(2, 5).turnIndices).toEqual([2, 3, 4, 5]);
    });

    it('labels every served turn with its index and role', () => {
      const text = session(4).range(1, 2).text;
      expect(text).toContain('[#1 assistant]');
      expect(text).toContain('[#2 user]');
      expect(text).not.toContain('[#0 ');
      expect(text).not.toContain('[#3 ');
    });

    it('numbers turns over role-bearing, non-empty messages only', () => {
      const reader = TranscriptWindowReader.fromMessages(
        [
          userMessage('first'),
          { type: 'system', message: { role: 'system', content: 'ignored' } },
          assistantMessage(''),
          { not: 'a message' },
          assistantMessage('second'),
        ],
        100_000,
      );
      expect(reader.totalTurns).toBe(2);
      const w = reader.head(2);
      expect(w.turnIndices).toEqual([0, 1]);
      expect(w.text).toContain('[#0 user]\nfirst');
      expect(w.text).toContain('[#1 assistant]\nsecond');
    });

    it('renders tool_use and tool_result blocks as markers', () => {
      const reader = TranscriptWindowReader.fromMessages(
        [
          {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'running the suite' },
                {
                  type: 'tool_use',
                  name: 'Bash',
                  input: { command: 'nx test' },
                },
              ],
            },
          },
          {
            type: 'user',
            message: {
              role: 'user',
              content: [{ type: 'tool_result', content: 'all tests passed' }],
            },
          },
        ],
        100_000,
      );
      const text = reader.head(2).text;
      expect(text).toContain('[tool:Bash nx test]');
      expect(text).toContain('[tool_result: all tests passed]');
    });
  });

  describe('out-of-range and inverted requests', () => {
    it('swaps an inverted range instead of rejecting it', () => {
      const reader = session(10);
      expect(reader.range(5, 2)).toEqual(reader.range(2, 5));
    });

    it('clamps a range that overhangs either end of the session', () => {
      const reader = session(10);
      expect(reader.range(-4, 2).turnIndices).toEqual([0, 1, 2]);
      expect(reader.range(8, 60).turnIndices).toEqual([8, 9]);
    });

    it('returns an empty window for a range entirely outside the session', () => {
      const w = session(10).range(50, 60);
      expect(w.turnIndices).toEqual([]);
      expect(w.text).toBe('');
      expect(w.totalTurns).toBe(10);
    });

    it('floors non-integer bounds', () => {
      expect(session(10).range(2.9, 5.1).turnIndices).toEqual([2, 3, 4, 5]);
    });

    it('returns an empty window for a non-finite bound', () => {
      expect(session(10).range(Number.NaN, 3).turnIndices).toEqual([]);
    });

    it('serves the whole session when the window is larger than it', () => {
      const reader = session(3);
      expect(reader.head(50).turnIndices).toEqual([0, 1, 2]);
      expect(reader.tail(50).turnIndices).toEqual([0, 1, 2]);
      expect(reader.head(50).truncated).toBe(false);
    });

    it('returns an empty window for a non-positive count', () => {
      expect(session(10).head(0).turnIndices).toEqual([]);
      expect(session(10).tail(-3).turnIndices).toEqual([]);
    });

    it('serves nothing from an empty session without throwing', () => {
      const reader = TranscriptWindowReader.fromTurns([], 1000);
      expect(reader.totalTurns).toBe(0);
      expect(reader.head(5).turnIndices).toEqual([]);
      expect(reader.tail(5).turnIndices).toEqual([]);
      expect(reader.range(0, 4).turnIndices).toEqual([]);
      expect(reader.search('anything').turnIndices).toEqual([]);
    });
  });

  describe('search — an untrusted-probe boundary', () => {
    it('serves every matching turn, ascending', () => {
      expect(session(10).search('turn 3').turnIndices).toEqual([3]);
    });

    it('matches a literal probe case-insensitively', () => {
      expect(session(10).search('TURN 4').turnIndices).toEqual([4]);
    });

    it('serves every turn when the probe matches everything', () => {
      const w = session(10).search('body');
      expect(w.turnIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(w.truncated).toBe(false);
    });

    it('serves an empty window when the probe matches nothing', () => {
      const w = session(10).search('nothing-matches-this');
      expect(w.turnIndices).toEqual([]);
      expect(w.text).toBe('');
    });

    it('does not compile a string probe — regex metacharacters are literal', () => {
      const reader = TranscriptWindowReader.fromTurns(
        [turn('user', 'plain aaaa text'), turn('assistant', 'has a+ literal')],
        100_000,
      );
      // Compiled, `a+` would match turn 0 too. As a literal it matches only the
      // turn that actually contains the two characters.
      expect(reader.search('a+').turnIndices).toEqual([1]);
    });

    it('bounds a catastrophically-backtracking string probe by never compiling it', () => {
      const reader = TranscriptWindowReader.fromTurns(
        [turn('user', `${'a'.repeat(4000)}!`)],
        100_000,
      );
      const started = Date.now();
      // Compiled, this is the classic exponential-backtracking pattern.
      const w = reader.search('(a+)+b');
      expect(w.turnIndices).toEqual([]);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('rejects a blank probe and one over the length cap', () => {
      const reader = session(10);
      expect(reader.search('   ').turnIndices).toEqual([]);
      expect(
        reader.search('t'.repeat(MAX_SEARCH_PROBE_CHARS + 1)).turnIndices,
      ).toEqual([]);
      expect(
        reader.search('turn 3'.padEnd(MAX_SEARCH_PROBE_CHARS, ' ')).turnIndices,
      ).toEqual([3]);
    });

    it('honours a trusted RegExp probe', () => {
      expect(session(10).search(/TURN 4\b/i).turnIndices).toEqual([4]);
    });

    it('is order-independent for a sticky/global RegExp', () => {
      const reader = session(10);
      const probe = /turn \d body/g;
      const first = reader.search(probe);
      const second = reader.search(probe);
      expect(first.turnIndices).toHaveLength(10);
      expect(second).toEqual(first);
    });
  });

  describe('maxInputChars bounding', () => {
    it('head() drops from the TAIL and marks the omission at the end', () => {
      const w = session(10, 150).head(10);
      expect(w.turnIndices).toEqual([0, 1]);
      expect(w.omittedTurnIndices).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(w.truncated).toBe(true);
      expect(w.text.length).toBeLessThanOrEqual(150);
      expect(w.text).toContain(
        `${OMITTED_TURNS_MARKER_PREFIX} 8 turns omitted`,
      );
      expect(w.text.trimEnd().endsWith('…]')).toBe(true);
      expect(w.text.startsWith('[#0 user]')).toBe(true);
    });

    it('tail() drops from the HEAD and marks the omission at the start', () => {
      const w = session(10, 150).tail(10);
      expect(w.turnIndices).toEqual([8, 9]);
      expect(w.omittedTurnIndices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(w.text.length).toBeLessThanOrEqual(150);
      expect(w.text.startsWith(OMITTED_TURNS_MARKER_PREFIX)).toBe(true);
      expect(w.text.trimEnd().endsWith('turn 9 body')).toBe(true);
    });

    it('re-bounds an over-large range() from the tail, keeping the anchor', () => {
      const w = session(20, 150).range(4, 19);
      expect(w.turnIndices[0]).toBe(4);
      expect(w.truncated).toBe(true);
      expect(w.omittedTurnIndices[0]).toBe(
        w.turnIndices[w.turnIndices.length - 1] + 1,
      );
      expect(w.omittedTurnIndices[w.omittedTurnIndices.length - 1]).toBe(19);
      expect(w.text.length).toBeLessThanOrEqual(150);
      expect(w.text).toContain(OMITTED_TURNS_MARKER_PREFIX);
    });

    it('re-bounds search() to an ascending prefix of the match list', () => {
      const w = session(10, 150).search('body');
      expect(w.turnIndices).toEqual([0, 1]);
      expect(w.omittedTurnIndices).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
      expect(w.text.length).toBeLessThanOrEqual(150);
    });

    it('clamps a per-call budget to the lane ceiling and never above it', () => {
      const reader = session(10, 100);
      const w = reader.head(10, 1_000_000);
      expect(w.maxInputChars).toBe(100);
      expect(w.text.length).toBeLessThanOrEqual(100);
    });

    it('honours a tighter per-call budget — the pass-1 tail/head split', () => {
      const reader = session(40, 1000);
      const tail = reader.tail(reader.totalTurns, 400);
      const head = reader.head(reader.totalTurns, 100);
      expect(tail.maxInputChars).toBe(400);
      expect(head.maxInputChars).toBe(100);
      expect(tail.text.length).toBeLessThanOrEqual(400);
      expect(head.text.length).toBeLessThanOrEqual(100);
      // Tail-first: the newest turn is always present, the oldest always is.
      expect(tail.turnIndices).toContain(39);
      expect(head.turnIndices).toContain(0);
    });

    it('drops the omission marker, not the content, on a budget too small for both', () => {
      const w = session(40, 100).head(40);
      expect(w.turnIndices[0]).toBe(0);
      expect(w.turnIndices.length).toBeGreaterThan(0);
      expect(w.text).not.toContain(OMITTED_TURNS_MARKER_PREFIX);
      // The machine-readable half still reports every dropped turn.
      expect(w.omittedTurnIndices).toContain(39);
      expect(w.truncated).toBe(true);
      expect(w.text.length).toBeLessThanOrEqual(100);
    });

    it('character-truncates a single turn larger than the whole budget rather than serving nothing', () => {
      const reader = TranscriptWindowReader.fromTurns(
        [turn('user', 'x'.repeat(5000))],
        200,
      );
      const w = reader.head(1);
      expect(w.turnIndices).toEqual([0]);
      expect(w.truncatedTurnIndex).toBe(0);
      expect(w.truncated).toBe(true);
      expect(w.text.length).toBeLessThanOrEqual(200);
      expect(w.text.startsWith('[#0 user]')).toBe(true);
      expect(w.text.endsWith(TRUNCATED_TURN_MARKER)).toBe(true);
    });

    it('character-truncates the newest turn on a tail() over an oversized turn', () => {
      const reader = TranscriptWindowReader.fromTurns(
        [turn('user', 'short'), turn('assistant', 'y'.repeat(5000))],
        200,
      );
      const w = reader.tail(2);
      expect(w.turnIndices).toEqual([1]);
      expect(w.truncatedTurnIndex).toBe(1);
      expect(w.omittedTurnIndices).toEqual([0]);
      expect(w.text.length).toBeLessThanOrEqual(200);
    });

    it('keeps text within budget on every accessor, including a budget of 0', () => {
      const reader = TranscriptWindowReader.fromTurns(
        Array.from({ length: 30 }, (_, i) =>
          turn(i % 2 === 0 ? 'user' : 'assistant', 'z'.repeat(200)),
        ),
        0,
      );
      for (const w of [
        reader.head(30),
        reader.tail(30),
        reader.range(0, 29),
        reader.search('z'),
      ]) {
        expect(w.text).toBe('');
        expect(w.maxInputChars).toBe(0);
      }
    });
  });

  describe('purity and determinism', () => {
    it('returns identical windows for identical calls', () => {
      const reader = session(30, 400);
      expect(reader.tail(30)).toEqual(reader.tail(30));
      expect(reader.range(3, 25)).toEqual(reader.range(3, 25));
      expect(reader.search('body')).toEqual(reader.search('body'));
    });

    it('performs no further reads after open()', async () => {
      const jsonl = {
        findSessionsDirectory: jest.fn().mockResolvedValue('/sessions/ws'),
        readJsonlMessages: jest
          .fn()
          .mockResolvedValue([userMessage('a'), assistantMessage('b')]),
      };
      const reader = await TranscriptWindowReader.open(
        jsonl,
        { sessionId: 's1', workspaceRoot: '/ws' },
        1000,
      );
      reader.head(2);
      reader.tail(2);
      reader.search('a');
      expect(jsonl.readJsonlMessages).toHaveBeenCalledTimes(1);
      expect(jsonl.findSessionsDirectory).toHaveBeenCalledTimes(1);
    });
  });

  describe('open()', () => {
    const messages = [userMessage('hello'), assistantMessage('there')];

    it('resolves the JSONL by session id under the workspace sessions dir', async () => {
      const jsonl = {
        findSessionsDirectory: jest.fn().mockResolvedValue('/sessions/ws'),
        readJsonlMessages: jest.fn().mockResolvedValue(messages),
      };
      const reader = await TranscriptWindowReader.open(
        jsonl,
        { sessionId: 's1', workspaceRoot: '/ws' },
        1000,
      );
      expect(jsonl.findSessionsDirectory).toHaveBeenCalledWith('/ws');
      expect(jsonl.readJsonlMessages).toHaveBeenCalledWith(
        '/sessions/ws/s1.jsonl',
      );
      expect(reader.totalTurns).toBe(2);
      expect(reader.maxInputChars).toBe(1000);
    });

    it('reads an explicit transcript path without resolving a sessions dir', async () => {
      const jsonl = {
        findSessionsDirectory: jest.fn(),
        readJsonlMessages: jest.fn().mockResolvedValue(messages),
      };
      await TranscriptWindowReader.open(
        jsonl,
        {
          sessionId: 's1',
          workspaceRoot: '/ws',
          transcriptPath: '/sessions/ws/s0/subagents/agent-1.jsonl',
        },
        1000,
      );
      expect(jsonl.findSessionsDirectory).not.toHaveBeenCalled();
      expect(jsonl.readJsonlMessages).toHaveBeenCalledWith(
        '/sessions/ws/s0/subagents/agent-1.jsonl',
      );
    });

    it('throws when the sessions directory cannot be resolved', async () => {
      const jsonl = {
        findSessionsDirectory: jest.fn().mockResolvedValue(null),
        readJsonlMessages: jest.fn(),
      };
      await expect(
        TranscriptWindowReader.open(
          jsonl,
          { sessionId: 's1', workspaceRoot: '/ws' },
          1000,
        ),
      ).rejects.toThrow('no sessions directory');
      expect(jsonl.readJsonlMessages).not.toHaveBeenCalled();
    });

    it('propagates a read failure instead of flattening it to an empty session', async () => {
      const jsonl = {
        findSessionsDirectory: jest.fn().mockResolvedValue('/sessions/ws'),
        readJsonlMessages: jest
          .fn()
          .mockRejectedValue(new Error('Session file too large (61MB)')),
      };
      await expect(
        TranscriptWindowReader.open(
          jsonl,
          { sessionId: 's1', workspaceRoot: '/ws' },
          1000,
        ),
      ).rejects.toThrow('too large');
    });
  });
});
