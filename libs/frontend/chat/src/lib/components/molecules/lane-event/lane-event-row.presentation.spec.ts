import { deriveLaneEventPresentation, parseLaneCompletion } from './lane-event-row.presentation';
import type { LaneEventRow } from './lane-event-row.types';

const envelope = (lines: string[] = []) => [
  'Lane Claude finished: completed (exit code 0) after 26s.',
  'Task: Read alpha.md and report the first line.',
  ...lines,
  'Reports sent by this lane before it ended: 1.',
  'CLI Session ID: session-42 — pass it as resume_session_id to continue this lane instead of respawning it.',
  'Next: read the lane output and check its claims.',
].join('\n');
const row = (overrides: Partial<LaneEventRow> = {}): LaneEventRow => ({
  rowKey: 'm1', agentId: 'a', agent: 'Claude', cli: 'claude', peerLabel: 'claude · Claude',
  events: [{ kind: 'report', body: 'Fixed the issue.\nMore detail', timestamp: 1, messageId: 'r1' },
    { kind: 'completed', status: 'completed', verdict: 'delivered', body: envelope(['Deliverables:', '- a.md — 44 bytes']), timestamp: 2, messageId: 'c1' }],
  earlier: [], liveLane: false, ...overrides,
});

describe('parseLaneCompletion', () => {
  it('parses a delivered envelope into fields and strips resume instructions', () => {
    const result = parseLaneCompletion(envelope(['Deliverables:', '- a.md — 44 bytes']));
    expect(result).toMatchObject({
      status: 'completed', duration: '26s', exitCode: 0, reports: 1,
      task: 'Read alpha.md and report the first line.', cliSessionId: 'session-42',
      deliverables: [{ path: 'a.md', state: '44 bytes', written: true }],
      extra: [],
    });
  });

  it('shows none declared without orchestrator advice for an unverified envelope', () => {
    const result = parseLaneCompletion(envelope(['Deliverables: none were declared at spawn, so nothing was checked. Read the lane output before you trust this result, and declare "deliverables" at spawn next time.']));
    expect(result.deliverables).toBeNull();
    expect(result.extra).toEqual([]);
  });

  it('tracks a declared but missing deliverable', () => {
    expect(parseLaneCompletion(envelope(['Deliverables:', '- absent.md — MISSING'])).deliverables)
      .toEqual([{ path: 'absent.md', state: 'MISSING', written: false }]);
  });

  it('parses failure and exit 1', () => {
    expect(parseLaneCompletion('Lane Claude finished: failed (exit code 1) after 3s.'))
      .toMatchObject({ status: 'failed', exitCode: 1, duration: '3s' });
  });

  it('parses timeout', () => {
    expect(parseLaneCompletion('Lane Claude finished: timeout (exit code 124) after 2m 3s.'))
      .toMatchObject({ status: 'timeout', exitCode: 124, duration: '2m 3s' });
  });

  it('keeps multiple deliverables and their states', () => {
    expect(parseLaneCompletion(envelope(['Deliverables:', '- a.md — 44 bytes', '- b.md — EMPTY', '- c.md — 12 bytes (NOT written by this run)'])).deliverables)
      .toEqual([
        { path: 'a.md', state: '44 bytes', written: true },
        { path: 'b.md', state: 'EMPTY', written: false },
        { path: 'c.md', state: '12 bytes (NOT written by this run)', written: false },
      ]);
  });

  it('passes unknown envelope lines through as plain text', () => {
    expect(parseLaneCompletion(envelope(['Role: tester', 'MCP warning: unavailable'])).extra)
      .toEqual(['Role: tester', 'MCP warning: unavailable']);
  });

  it('strips Next, advice, and resume boilerplate', () => {
    const parsed = parseLaneCompletion(envelope(['Read the lane output before you trust this result.', 'declare "deliverables" next time.']));
    expect(parsed.extra).toEqual([]);
    expect(parsed.cliSessionId).toBe('session-42');
    expect(JSON.stringify(parsed)).not.toMatch(/Next:|resume_session_id|trust this result|declare "deliverables"/);
  });
});

describe('deriveLaneEventPresentation', () => {
  it('uses the latest report first line, never task text, and one chip', () => {
    const result = deriveLaneEventPresentation(row());
    expect(result.summary).toBe('Fixed the issue.');
    expect(result.chip.label).toBe('Completed');
    expect(result.peerTitle).toBeNull();
    expect(result.stats.map(stat => stat.compact)).toEqual(['26s', '1 report', '1/1 files']);
    expect(result.files).toEqual([]);
  });

  it.each([
    ['unverified', 'Completed · unverified'],
    ['no-deliverable', 'Incomplete · no deliverable'],
  ])('labels the %s verdict as %s with the warning tone', (verdict, label) => {
    const result = deriveLaneEventPresentation(row({ events: [{ kind: 'completed', verdict, body: envelope(['Deliverables: none were declared at spawn, so nothing was checked.']), timestamp: 2, messageId: 'c' }] }));
    expect(result.chip.label).toBe(label);
    expect(result.chip.tone).toBe('need');
    expect(result.stats.some(stat => stat.label === 'Verdict' || stat.label === 'Deliverables')).toBe(false);
  });

  it('shows concise failure and timeout status with only nonzero exit', () => {
    const failure = deriveLaneEventPresentation(row({ events: [{ kind: 'completed', status: 'failed', verdict: 'failed', body: 'Lane Claude finished: failed (exit code 1) after 3s.', timestamp: 2, messageId: 'c' }] }));
    expect(failure.chip.label).toBe('Failed');
    expect(failure.summary).toBe('Failed after 3s (exit 1)');
    expect(failure.stats.map(stat => stat.compact)).toContain('exit 1');
    const timeout = deriveLaneEventPresentation(row({ events: [{ kind: 'completed', status: 'timeout', body: 'Lane Claude finished: timeout (exit code 124) after 2m 3s.', timestamp: 2, messageId: 'c' }] }));
    expect(timeout.chip.label).toBe('Timed out');
  });

  it('ignores exit text in the task and keeps completion stats after a later report', () => {
    const result = deriveLaneEventPresentation(row({ events: [
      { kind: 'completed', status: 'completed', body: 'Lane Claude finished: completed after 4s.\nTask: Debug (exit code 1)', timestamp: 1, messageId: 'c' },
      { kind: 'report', body: 'Late result\nDetails', timestamp: 2, messageId: 'r' },
    ] }));
    expect(result.summary).toBe('Late result');
    expect(result.stats.map(stat => stat.compact)).toContain('4s');
    expect(result.stats.some(stat => stat.label === 'Exit')).toBe(false);
  });

  it('shows only real monitor lane totals and keeps a distinct peer label in title', () => {
    const result = deriveLaneEventPresentation(row({ peerLabel: 'Other sender' }), {
      model: 'fallback', usageTotals: { model: 'sonnet', totalTokens: 1250, costUsd: 0.023 },
    });
    expect(result.peerTitle).toBe('Other sender');
    expect(result.stats.map(stat => stat.label)).toEqual(expect.arrayContaining(['Lane total model', 'Lane total tokens', 'Lane total cost']));
  });
});
