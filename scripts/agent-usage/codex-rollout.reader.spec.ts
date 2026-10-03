/**
 * The 74-turn fixture is a sanitized, read-only extraction of the 2026-10-03
 * `backend-developer` lane rollout (TASK_2026_597 R1.1): `session_meta` keys
 * with redacted values (originator and source kept), `turn_context`
 * model/effort, `task_started` boundaries and every `token_count` with its
 * numbers. The one user message and the role part are placeholders standing
 * where the real ones were; no prompt or tool content is in the file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  codexLaneMetrics,
  readCodexRollout,
  readCodexStore,
  resumedRoleVerdict,
  rolloutIdFromFileName,
  rolloutStartInstant,
} from './codex-rollout.reader';
import { ROLE_BLOCK_HEADER } from './lane-metrics';

const FIXTURE = path.join(
  __dirname,
  '__fixtures__',
  'rollout-2026-10-03T13-26-45-74-turn-lane.jsonl',
);

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm-codex-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const line = (type: string, payload: Record<string, unknown>): string =>
  JSON.stringify({ type, payload });

const tokenCount = (last: number, total: number): string =>
  line('event_msg', {
    type: 'token_count',
    info: {
      last_token_usage: { input_tokens: last },
      total_token_usage: {
        input_tokens: total,
        cached_input_tokens: Math.floor(total / 2),
        output_tokens: 7,
        total_tokens: total + 7,
      },
    },
    rate_limits: { primary: { used_percent: 1 } },
  });

const message = (role: string, text: string): string =>
  line('response_item', {
    type: 'message',
    role,
    content: [{ type: 'input_text', text }],
  });

function writeRollout(name: string, lines: string[]): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

describe('readCodexRollout on the 74-turn lane fixture (R1.1)', () => {
  const summary = readCodexRollout(FIXTURE);
  const lane = codexLaneMetrics(summary);

  it('reproduces first 27,464, peak 183,759 and total 9.59M', () => {
    expect(lane.firstInput).toBe(27_464);
    expect(lane.peakInput).toBe(183_759);
    expect(Math.abs(lane.totalInput - 9_590_000)).toBeLessThanOrEqual(10_000);
    expect(lane.requests).toBe(74);
  });

  it('agrees between the per-request sum and the running total', () => {
    const sum = summary.requestInputs.reduce((a, b) => a + b, 0);
    expect(sum).toBe(summary.totals?.input);
  });

  it('identifies it as a Ptah lane with its model, effort and resume', () => {
    expect(lane.isPtahLane).toBe(true);
    expect(lane.model).toBe('gpt-6-astra');
    expect(lane.effort).toBe('medium');
    // The file name is local time; startedAt is the UTC instant it denotes.
    expect(lane.startedAt).toBe(new Date(2026, 9, 3, 13, 26, 45).toISOString());
    expect(summary.turns).toBe(2);
    expect(summary.badLines).toBe(0);
    expect(resumedRoleVerdict(summary).verdict).toBe('once');
  });
});

describe('readCodexRollout on synthetic rollouts', () => {
  it('counts a re-emitted token_count once, tool outputs, compactions and bad lines', () => {
    const file = writeRollout('rollout-2026-10-03T10-00-00-x.jsonl', [
      line('session_meta', { originator: 'codex_sdk_ts', source: 'exec' }),
      line('event_msg', { type: 'task_started' }),
      message('user', 'do it\n\n## Before you exit\nreport'),
      tokenCount(100, 100),
      tokenCount(100, 100), // rate-limit-only re-emission
      line('response_item', {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'c1',
      }),
      line('response_item', {
        type: 'custom_tool_call_output',
        call_id: 'c1',
        output: 'x'.repeat(500),
      }),
      line('response_item', {
        type: 'function_call',
        name: 'mcp__ptah__read',
        call_id: 'c2',
      }),
      line('response_item', {
        type: 'function_call_output',
        call_id: 'c2',
        output: { text: 'y'.repeat(50) },
      }),
      '{"type":"event_msg","payload":{"type":"tok', // torn line
      line('compacted', { message: '' }),
      line('event_msg', { type: 'context_compacted' }),
      tokenCount(300, 400),
    ]);
    const summary = readCodexRollout(file);
    const lane = codexLaneMetrics(summary);

    expect(summary.requestInputs).toEqual([100, 300]);
    expect(lane.totalInput).toBe(400);
    expect(lane.peakInput).toBe(300);
    // The checkpoint and its legacy event are one compaction.
    expect(lane.compactions).toBe(1);
    expect(lane.largestToolOutput).toEqual({ tool: 'exec', chars: 500 });
    expect(summary.toolCalls).toEqual({ exec: 1, mcp__ptah__read: 1 });
    expect(summary.badLines).toBe(1);
    expect(lane.isPtahLane).toBe(true);
  });

  it('counts a legacy compaction event that has no checkpoint before it', () => {
    const file = writeRollout('rollout-2026-10-03T10-00-02-x.jsonl', [
      line('event_msg', { type: 'task_started' }),
      line('compacted', { message: '' }),
      line('event_msg', { type: 'context_compacted' }),
      line('event_msg', { type: 'task_started' }),
      line('event_msg', { type: 'context_compacted' }),
      line('compacted', { message: '' }),
    ]);

    expect(readCodexRollout(file).compactions).toBe(3);
  });

  it('does not take a marker that first appears after the first request', () => {
    const file = writeRollout('rollout-2026-10-03T10-00-01-x.jsonl', [
      line('session_meta', { originator: 'codex_sdk_ts', source: 'exec' }),
      message('user', 'hello'),
      tokenCount(10, 10),
      message('user', '## Before you exit'),
    ]);
    expect(codexLaneMetrics(readCodexRollout(file)).isPtahLane).toBe(false);
  });

  it('counts only the text parts of a content-item tool output', () => {
    const file = writeRollout('rollout-2026-10-03T10-00-03-x.jsonl', [
      line('response_item', {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'c1',
      }),
      line('response_item', {
        type: 'custom_tool_call_output',
        call_id: 'c1',
        output: [
          { type: 'input_text', text: 'a'.repeat(30) },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,' + 'A'.repeat(9000),
          },
          { type: 'input_text', text: 'b'.repeat(12) },
        ],
      }),
    ]);
    expect(readCodexRollout(file).largestToolOutput).toEqual({
      tool: 'exec',
      chars: 42,
    });
  });
});

describe('AS6 resumed role verdicts', () => {
  const ROLE = '## Role: backend-developer\n\nYou are running as the role.';
  const PERMISSIONS = '<permissions instructions>p</permissions instructions>';
  const head = [
    line('session_meta', { originator: 'codex_sdk_ts', source: 'exec' }),
    line('event_msg', { type: 'task_started' }),
  ];
  const firstRequest = [
    message('user', '## Before you exit'),
    tokenCount(10, 10),
  ];
  const resume = line('event_msg', { type: 'task_started' });

  const verdictOf = (name: string, lines: string[]) => {
    const summary = readCodexRollout(writeRollout(name, lines));
    return { summary, ...resumedRoleVerdict(summary) };
  };

  it('once: role in the first turn, kept, not recorded on resume', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-10-x.jsonl', [
      ...head,
      message('developer', ROLE),
      message('developer', PERMISSIONS),
      ...firstRequest,
      resume,
      message('developer', '<skills_instructions>s</skills_instructions>'),
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('once');
    expect(r.summary.role).toMatchObject({ parts: 1, partsInResumedTurns: 0 });
  });

  it('twice: role recorded again in a resumed turn while still in history', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-11-x.jsonl', [
      ...head,
      message('developer', ROLE),
      ...firstRequest,
      resume,
      message('developer', ROLE),
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('twice');
    expect(r.summary.role).toMatchObject({
      parts: 2,
      partsInResumedTurns: 1,
      duplicateParts: 1,
      reinjectedWhileInHistory: 1,
    });
  });

  it('two different role-free developer parts are not "twice"', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-12-x.jsonl', [
      ...head,
      message('developer', ROLE),
      message('developer', 'plain developer note one'),
      message('developer', 'plain developer note two'),
      ...firstRequest,
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('once');
    expect(r.summary.role.untaggedDeveloperParts).toBe(2);
  });

  it('absent: a summary compaction drops the role before the resume', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-13-x.jsonl', [
      ...head,
      message('developer', ROLE),
      ...firstRequest,
      line('compacted', { message: 'summary' }),
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('absent');
    expect(r.summary.role.resumesWithoutRole).toBe(1);
  });

  it('once: a compaction whose replacement history keeps the role', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-14-x.jsonl', [
      ...head,
      message('developer', ROLE),
      ...firstRequest,
      line('compacted', {
        message: '',
        replacement_history: [
          {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: ROLE }],
          },
        ],
      }),
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('once');
  });

  it('inconclusive: no role block anywhere (spawned without a role)', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-15-x.jsonl', [
      ...head,
      message('developer', PERMISSIONS),
      ...firstRequest,
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('inconclusive');
    expect(r.reason).toMatch(/spawned without a role/);
  });

  it('inconclusive: an unrecognised developer part may hold the role', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-16-x.jsonl', [
      ...head,
      message('developer', '# Backend Developer\nrules'),
      ...firstRequest,
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('inconclusive');
    expect(r.reason).toMatch(/1 unrecognised developer part/);
  });

  it('inconclusive: not resumed', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-17-x.jsonl', [
      ...head,
      message('developer', ROLE),
      ...firstRequest,
    ]);
    expect(r).toMatchObject({ verdict: 'inconclusive', reason: 'not resumed' });
  });

  it('finds a role block that starts with "<"-prefixed text before it, or in the user message', () => {
    const r = verdictOf('rollout-2026-10-03T10-00-18-x.jsonl', [
      ...head,
      message('user', `<context>x</context>\n${ROLE}\n\n## Before you exit`),
      tokenCount(10, 10),
      resume,
      tokenCount(20, 30),
    ]);
    expect(r.verdict).toBe('once');
    expect(r.summary.role.userChannelParts).toBe(1);
  });
});

describe('role block header', () => {
  // `renderRoleBlock` loads `@ptah-extension/*` aliases the scripts Jest
  // config cannot resolve, so the pin reads the renderer's source instead:
  // the template M matches must be the one the renderer emits.
  it('matches the header renderRoleBlock emits', () => {
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts',
      ),
      'utf8',
    );
    const fn = source.slice(source.indexOf('export function renderRoleBlock('));
    expect(fn.length).toBeLessThan(source.length);
    expect(fn).toContain('`' + ROLE_BLOCK_HEADER + '${role.name}\\n\\n`');
  });
});

describe('readCodexStore', () => {
  it('reports a missing store as a skipped source and still returns', () => {
    const report = readCodexStore(path.join(tmp, 'missing'));
    expect(report.rollouts).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.vendor).toBe('codex');
  });

  it('selects rollouts by start date from the file name', () => {
    const day = path.join(tmp, '2026', '10', '03');
    fs.mkdirSync(day, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(day, path.basename(FIXTURE)));
    fs.copyFileSync(
      FIXTURE,
      path.join(day, 'rollout-2026-10-02T23-59-59-other.jsonl'),
    );
    const report = readCodexStore(tmp, { date: '2026-10-03' });
    expect(report.rollouts.map((r) => r.id)).toEqual(['2026-10-03T13-26-45']);
    expect(report.skipped).toEqual([]);
  });

  it('never writes to the store it reads', () => {
    const before = fs.readFileSync(FIXTURE);
    readCodexRollout(FIXTURE);
    expect(fs.readFileSync(FIXTURE).equals(before)).toBe(true);
  });
});

describe('rolloutIdFromFileName', () => {
  it('extracts the local start timestamp', () => {
    expect(
      rolloutIdFromFileName('/x/rollout-2026-10-03T13-26-45-01a1.jsonl'),
    ).toBe('2026-10-03T13-26-45');
    expect(rolloutIdFromFileName('/x/other.jsonl')).toBe('other');
  });
});

describe('rolloutStartInstant', () => {
  it('turns the local-time id into a UTC instant', () => {
    expect(rolloutStartInstant('2026-10-02T23-30-00')).toBe(
      new Date(2026, 9, 2, 23, 30, 0).toISOString(),
    );
    expect(rolloutStartInstant('other')).toBeNull();
  });
});
