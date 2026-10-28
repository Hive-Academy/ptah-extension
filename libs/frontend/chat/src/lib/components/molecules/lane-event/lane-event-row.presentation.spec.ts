import { deriveLaneEventPresentation } from './lane-event-row.presentation';
import type { LaneEventRow } from './lane-event-row.types';

const row = (overrides: Partial<LaneEventRow> = {}): LaneEventRow => ({
  rowKey: 'm1', agentId: 'a', agent: 'Agent A', cli: 'codex', peerLabel: 'peer session',
  events: [{ kind: 'report', body: 'Progress', timestamp: 1_700_000_000_000, messageId: 'm1' }],
  earlier: [], liveLane: true, ...overrides,
});

describe('deriveLaneEventPresentation', () => {
  it('shows running for a live report and pending completion in its timeline', () => {
    const result = deriveLaneEventPresentation(row());
    expect(result.chips.map(chip => [chip.label, chip.tone])).toEqual([['Running', 'run']]);
    expect(result.stats).toEqual([{ label: 'Reports', value: '1' }]);
    expect(result.timeline.at(-1)).toBe('Completion pending');
  });

  it.each([
    ['delivered', undefined, 'Completed', 'done'],
    ['no-deliverable', undefined, 'No deliverable', 'need'],
    ['unverified', undefined, 'Completed, unverified', 'need'],
    ['delivered', 'timeout', 'Failed', 'err'],
    ['delivered', 'stopped', 'Stopped', 'neutral'],
    ['custom-result', undefined, 'Custom result', 'neutral'],
  ])('maps verdict %s and status %s to %s', (verdict, status, label, tone) => {
    const result = deriveLaneEventPresentation(row({ events: [
      { kind: 'completed', verdict, status, body: 'Done', timestamp: 1_700_000_000_000, messageId: 'm2' },
    ] }));
    expect(result.chips.map(chip => [chip.label, chip.tone])).toEqual([[label, tone]]);
    expect(result.timeline).not.toContain('Completion pending');
  });

  it('combines attachments and limits the visible report timeline', () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      kind: 'report' as const, body: 'Report', timestamp: 1_700_000_000_000 + index,
      messageId: `m${index}`, files: [`/tmp/${index}.txt`], imageCount: index === 0 ? 1 : 0,
    }));
    const result = deriveLaneEventPresentation(row({ events, liveLane: false }));
    expect(result.stats).toContainEqual({ label: 'Reports', value: '5' });
    expect(result.timeline[0]).toBe('+1 earlier');
    expect(result.files).toHaveLength(5);
    expect(result.images).toBe(1);
  });

  it('parses completion envelope facts and uses the task as the summary', () => {
    const result = deriveLaneEventPresentation(row({ agent: 'Claude', cli: 'claude', liveLane: false, events: [{
      kind: 'completed', status: 'completed', verdict: 'delivered', messageId: 'done', timestamp: 1_700_000_000_000,
      body: 'Lane Claude finished: completed (exit code 0) after 22s.\nTask: Polish chat rows\nDeliverables:\n- a.md — 44 bytes\n- b.md — MISSING\nReports sent by this lane before it ended: 3.\nNext: verify.',
    }] }));
    expect(result.stats).toEqual([
      { label: 'Duration', value: '22s' }, { label: 'Exit', value: '0' },
      { label: 'Reports', value: '3' }, { label: 'Deliverables', value: '1/2 written' },
      { label: 'Verdict', value: 'Delivered' },
    ]);
    expect(result.summary).toBe('Polish chat rows');
    expect(result.cliLabel).toBeNull();
  });

  it('omits unknown completion facts and records no declared deliverables', () => {
    const result = deriveLaneEventPresentation(row({ liveLane: false, events: [{
      kind: 'completed', messageId: 'done', timestamp: 1_700_000_000_000,
      body: 'Finished.\nDeliverables: none were declared at spawn, so nothing was checked.',
    }] }));
    expect(result.stats).toEqual([{ label: 'Deliverables', value: 'none declared' }]);
    expect(result.summary).toBe('');
  });

  it('shows only reported monitor model and usage for the matching lane', () => {
    const result = deriveLaneEventPresentation(row(), {
      model: 'fallback-model', usageTotals: { model: 'claude-sonnet', totalTokens: 1250, costUsd: 0.023 },
    });
    expect(result.stats).toContainEqual({ label: 'Model', value: 'claude-sonnet' });
    expect(result.stats).toContainEqual({ label: 'Tokens', value: '1,250' });
    expect(result.stats).toContainEqual({ label: 'Cost', value: '$0.023' });
  });
});
