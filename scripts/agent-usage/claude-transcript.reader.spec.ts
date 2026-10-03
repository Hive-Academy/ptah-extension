import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  claudeLaneMetrics,
  readClaudeStore,
  readClaudeTranscript,
} from './claude-transcript.reader';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm-claude-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const usage = {
  input_tokens: 10,
  cache_read_input_tokens: 80,
  cache_creation_input_tokens: 10,
  output_tokens: 4,
};

function writeTranscript(rel: string, records: unknown[]): string {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    records.map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n',
  );
  return file;
}

describe('readClaudeTranscript', () => {
  it('counts a response once across its per-block lines', () => {
    const file = writeTranscript('proj/sess/subagents/agent-1.jsonl', [
      {
        type: 'user',
        cwd: '/w/repo',
        timestamp: '2026-10-03T10:00:00Z',
        message: { content: 'task\n\n## Before you exit\nx' },
      },
      {
        type: 'assistant',
        message: {
          id: 'r1',
          model: 'claude-x',
          usage,
          content: [{ type: 'text', text: 'ok' }],
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'r1',
          model: 'claude-x',
          usage,
          content: [{ type: 'tool_use', id: 't1', name: 'Read' }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'z'.repeat(70) },
          ],
        },
      },
      { type: 'system', subtype: 'compact_boundary' },
      {
        type: 'assistant',
        message: {
          id: 'r2',
          model: 'claude-x',
          usage: { ...usage, cache_read_input_tokens: 200 },
        },
      },
    ]);
    const summary = readClaudeTranscript(file);
    const lane = claudeLaneMetrics(summary);

    expect(summary.kind).toBe('subagent');
    expect(summary.cwd).toBe('repo');
    expect(summary.badLines).toBe(1);
    expect(lane).toMatchObject({
      isPtahLane: true,
      requests: 2,
      firstInput: 100,
      peakInput: 220,
      totalInput: 320,
      cached: 280,
      output: 8,
      compactions: 1,
      largestToolOutput: { tool: 'Read', chars: 70 },
    });
    expect(lane.startedAt).toBe('2026-10-03T10:00:00.000Z');
  });

  it('takes the final streamed usage of a 3-line response, counted once', () => {
    const line = (output: number, content: unknown[]) => ({
      type: 'assistant',
      message: {
        id: 'r1',
        model: 'claude-x',
        usage: { ...usage, output_tokens: output },
        content,
      },
    });
    const file = writeTranscript('p/stream.jsonl', [
      { type: 'user', message: { content: 'task\n\n## Before you exit\nx' } },
      line(2, [{ type: 'thinking' }]),
      line(9, [{ type: 'text', text: 'ok' }]),
      line(57, [{ type: 'tool_use', id: 't1', name: 'Read' }]),
    ]);
    const lane = claudeLaneMetrics(readClaudeTranscript(file));
    expect(lane).toMatchObject({
      requests: 1,
      firstInput: 100,
      totalInput: 100,
      cached: 80,
      output: 57,
    });
  });

  it('keeps an earlier field a later line omits', () => {
    const file = writeTranscript('p/partial.jsonl', [
      { type: 'assistant', message: { id: 'r1', usage } },
      {
        type: 'assistant',
        message: { id: 'r1', usage: { output_tokens: 30 } },
      },
    ]);
    expect(claudeLaneMetrics(readClaudeTranscript(file))).toMatchObject({
      totalInput: 100,
      cached: 80,
      output: 30,
    });
  });

  it('does not close the first-request window on a zero-usage line', () => {
    const file = writeTranscript('p/synthetic.jsonl', [
      { type: 'user', message: { content: 'hi' } },
      {
        type: 'assistant',
        message: {
          id: 's',
          model: '<synthetic>',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      { type: 'user', message: { content: 'task\n\n## Before you exit\nx' } },
      { type: 'assistant', message: { id: 'r', usage } },
    ]);
    expect(claudeLaneMetrics(readClaudeTranscript(file)).isPtahLane).toBe(true);
  });
});

describe('readClaudeStore', () => {
  it('reports a missing store as skipped', () => {
    const report = readClaudeStore(path.join(tmp, 'none'));
    expect(report.transcripts).toEqual([]);
    expect(report.skipped[0]?.vendor).toBe('claude');
  });

  it('drops transcripts with no requests and lists bad lines', () => {
    writeTranscript('p/a.jsonl', [
      { type: 'user', message: { content: 'hi' } },
    ]);
    writeTranscript('p/b.jsonl', [
      { type: 'assistant', message: { id: 'x', usage } },
    ]);
    const report = readClaudeStore(tmp);
    expect(report.transcripts.map((t) => t.id)).toEqual(['b']);
    expect(report.skipped).toHaveLength(2);
  });
});
