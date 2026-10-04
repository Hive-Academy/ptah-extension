/**
 * The fixture is a sanitized, read-only extraction of a 2026-10-03
 * `code-logic-reviewer` subagent transcript of TASK_2026_597 (session
 * 8af2d859): record types and timestamps, and for assistant lines the
 * `message.id`, model and the four usage numbers. User content is a
 * placeholder; no prompt, tool or response content is in the file. The
 * sibling `.meta.json` keeps `agentType` only.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  readClaudeTranscript,
  type ClaudeRequest,
  type ClaudeTranscriptSummary,
} from './claude-transcript.reader';
import {
  claudeSubagentMetrics,
  formatSubagentRow,
  formatSubagentSummary,
  selectSubagents,
  spread,
  summariseSubagents,
  SUBAGENT_TABLE_HEADER,
} from './subagent-metrics';

const FIXTURE = path.join(
  __dirname,
  '__fixtures__',
  'claude-session',
  'subagents',
  'agent-code-logic-reviewer.jsonl',
);

const T0 = Date.parse('2026-10-03T10:00:00Z');

const request = (
  atMs: number | null,
  cacheCreation: number,
  extra: Partial<ClaudeRequest> = {},
): ClaudeRequest => ({
  atMs,
  input: 10,
  cacheRead: 1000,
  cacheCreation,
  output: 5,
  ...extra,
});

const summary = (
  overrides: Partial<ClaudeTranscriptSummary> = {},
): ClaudeTranscriptSummary => ({
  file: path.join('p', 'sess-1', 'subagents', 'agent-x.jsonl'),
  id: 'agent-x',
  kind: 'subagent',
  agentType: 'backend-developer',
  cwd: 'repo',
  startedAt: '2026-10-03T10:00:00.000Z',
  model: 'claude-x',
  requestInputs: [],
  requests: [request(T0, 100)],
  missingUsage: 0,
  cached: 0,
  output: 0,
  compactions: 0,
  largestToolOutput: null,
  hasLaneMarker: false,
  badLines: 0,
  ...overrides,
});

describe('claudeSubagentMetrics on the sanitized fixture', () => {
  it('reproduces the measured row of the real subagent', () => {
    const row = claudeSubagentMetrics(readClaudeTranscript(FIXTURE));
    expect(row).toMatchObject({
      sessionId: 'claude-session',
      agentType: 'code-logic-reviewer',
      startedAt: '2026-10-03T14:26:52.111Z',
      requests: 28,
      prefix: 39607,
      cacheRead: 2918449,
      cacheCreation: 353847,
      output: 41714,
    });
    expect(row.lateRequests).toEqual([
      expect.objectContaining({ gapSeconds: 549, cacheCreation: 77735 }),
      expect.objectContaining({ gapSeconds: 379, cacheCreation: 118051 }),
    ]);
    expect(formatSubagentRow(row)).toContain('code-logic-reviewer');
    expect(SUBAGENT_TABLE_HEADER).toContain('prefix');
  });
});

describe('claudeSubagentMetrics', () => {
  it('flags a gap over 300 s, not one of exactly 300 s', () => {
    const row = claudeSubagentMetrics(
      summary({
        requests: [
          request(T0, 40_000, { cacheRead: 0 }),
          request(T0 + 300_000, 50),
          request(T0 + 601_000, 9_000),
        ],
      }),
    );
    expect(row.prefix).toBe(40_010);
    expect(row.requests).toBe(3);
    expect(row.lateRequests).toEqual([
      {
        at: new Date(T0 + 601_000).toISOString(),
        gapSeconds: 301,
        cacheCreation: 9_000,
        cacheRead: 1000,
      },
    ]);
    expect(row).toMatchObject({
      cacheRead: 2000,
      cacheCreation: 49_050,
      output: 15,
      sessionId: 'sess-1',
    });
  });

  it('skips zero-context responses and breaks the gap chain on a missing time', () => {
    const row = claudeSubagentMetrics(
      summary({
        requests: [
          request(T0, 0, { input: 0, cacheRead: 0, output: 0 }),
          request(T0 + 1_000, 100),
          request(null, 100),
          request(T0 + 900_000, 100),
        ],
      }),
    );
    expect(row.requests).toBe(3);
    expect(row.prefix).toBe(1_110);
    expect(row.lateRequests).toEqual([]);
  });

  it('marks an unknown agent type with ?', () => {
    expect(claudeSubagentMetrics(summary({ agentType: null })).agentType).toBe(
      '?',
    );
  });
});

describe('selectSubagents', () => {
  const transcripts = [
    summary({ id: 'a', startedAt: '2026-10-03T09:00:00.000Z' }),
    summary({
      id: 'b',
      file: path.join('p', 'sess-2', 'subagents', 'agent-b.jsonl'),
      startedAt: '2026-10-03T11:00:00.000Z',
    }),
    summary({ id: 'c', startedAt: null }),
    summary({ id: 'd', requests: [] }),
    summary({ id: 'main', kind: 'session' }),
  ];

  it('keeps subagents with requests, oldest first', () => {
    expect(selectSubagents(transcripts).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('applies since (inclusive), until (exclusive) and session prefixes', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(
      selectSubagents(transcripts, {
        sinceMs: at('2026-10-03T09:00:00Z'),
      }).map((r) => r.id),
    ).toEqual(['a', 'b']);
    expect(
      selectSubagents(transcripts, {
        untilMs: at('2026-10-03T11:00:00Z'),
      }).map((r) => r.id),
    ).toEqual(['a']);
    expect(
      selectSubagents(transcripts, { sessions: ['sess-2'] }).map((r) => r.id),
    ).toEqual(['b']);
  });
});

describe('spread and summariseSubagents', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(spread([])).toBeNull();
    expect(spread([5, 1, 3])).toEqual({ count: 3, min: 1, median: 3, max: 5 });
    expect(spread([4, 1, 3, 2])).toMatchObject({ median: 2.5 });
  });

  it('summarises the prefix per type and the late resumes', () => {
    const rows = [
      claudeSubagentMetrics(
        summary({
          requests: [request(T0, 30_000), request(T0 + 400_000, 200)],
        }),
      ),
      claudeSubagentMetrics(
        summary({
          requests: [request(T0, 40_000), request(T0 + 700_000, 600)],
        }),
      ),
      claudeSubagentMetrics(
        summary({ agentType: 'Explore', requests: [request(T0, 20_000)] }),
      ),
    ];
    const result = summariseSubagents(rows);
    expect(result.subagents).toBe(3);
    expect(result.prefixByType).toEqual([
      {
        agentType: 'backend-developer',
        prefix: { count: 2, min: 31_010, median: 36_010, max: 41_010 },
      },
      {
        agentType: 'Explore',
        prefix: { count: 1, min: 21_010, median: 21_010, max: 21_010 },
      },
    ]);
    expect(result.lateResumes).toMatchObject({
      count: 2,
      cacheCreationSum: 800,
      cacheCreation: { median: 400 },
    });
    const lines = formatSubagentSummary(result);
    expect(lines[lines.length - 1]).toBe(
      'resumes after > 5 min: count=2 cache_write sum=800 median=400',
    );
  });
});

describe('reader inputs for the subagent view', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm-subagent-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('times a request by the tool result it answers, not its own line', () => {
    const file = path.join(tmp, 's', 'subagents', 'agent-1.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const usage = { input_tokens: 1, cache_read_input_tokens: 9 };
    fs.writeFileSync(
      file,
      [
        { type: 'user', timestamp: '2026-10-03T10:00:00Z' },
        {
          type: 'assistant',
          timestamp: '2026-10-03T10:00:30Z',
          message: { id: 'r1', usage },
        },
        {
          type: 'assistant',
          timestamp: '2026-10-03T10:04:00Z',
          message: { id: 'r1', usage: { ...usage, output_tokens: 7 } },
        },
        { type: 'user', timestamp: '2026-10-03T10:06:00Z' },
        {
          type: 'assistant',
          timestamp: '2026-10-03T10:06:20Z',
          message: { id: 'r2', usage },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
    );
    const row = claudeSubagentMetrics(readClaudeTranscript(file));
    // Send times 10:00:00 and 10:06:00: 360 s apart.
    expect(row.lateRequests.map((r) => r.gapSeconds)).toEqual([360]);
    expect(row.output).toBe(7);
  });
});
