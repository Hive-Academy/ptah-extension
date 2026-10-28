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
    expect(result.chips.map(chip => [chip.label, chip.tone])).toEqual([['Report', 'run'], ['Running', 'run']]);
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
    expect(result.chips[0].label).toBe('Report x5');
    expect(result.timeline[0]).toBe('+1 earlier');
    expect(result.files).toHaveLength(5);
    expect(result.images).toBe(1);
  });
});
