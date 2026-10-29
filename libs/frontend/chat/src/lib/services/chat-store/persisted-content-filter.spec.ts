import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { PersistedContentFilter, type BlockSignature, type PersistedContentFilterOptions } from './persisted-content-filter';

let next = 0;
function e(eventType: string, fields: Record<string, unknown> = {}): FlatStreamEventUnion {
  return { id: `e${++next}`, timestamp: next, messageId: 'X', source: 'stream',
    eventType, ...fields } as FlatStreamEventUnion;
}
const start = (source = 'stream') => e('message_start', { source, role: 'assistant' });
const text = (delta: string, source = 'stream', blockIndex = 0) =>
  e('text_delta', { delta, source, blockIndex });
const thinking = (delta: string, source = 'stream', blockIndex = 0) =>
  e('thinking_delta', { delta, source, blockIndex });
const tool = (toolCallId: string, source = 'stream') =>
  e('tool_start', { toolCallId, toolName: 'Read', isTaskTool: false, source });
const end = (source = 'complete') => e('message_complete', { source });
const h = (...blocks: BlockSignature[]) => new Map([['X', blocks]]);
const block = (kind: BlockSignature['kind'], value: string): BlockSignature => ({ kind, value });

function fixture(overrides: Partial<PersistedContentFilterOptions> = {}) {
  const delivered: FlatStreamEventUnion[] = [];
  const reconcile = jest.fn(() => true);
  const options: PersistedContentFilterOptions = {
    tabId: 'tab-A', sessionId: 'S', history: h(block('text', 'a')),
    historyToolResults: new Map(), historyToolIds: new Set(), prefixMark: null,
    seedMessageIds: new Set(), seedStartK: new Map(), seedBlockKeys: new Set(),
    deliverToTab: (event) => delivered.push(event),
    reconcileHistoryToolResult: reconcile, ...overrides,
  };
  return { filter: new PersistedContentFilter(options), delivered, reconcile };
}

describe('PersistedContentFilter', () => {
  beforeEach(() => { next = 0; jest.restoreAllMocks(); });

  it('keeps filtering after an identity-only terminal retirement', () => {
    const { filter } = fixture();
    expect(filter.decide(e('turn_state', { phase: 'idle', retirementOnly: true }), 1)).toBe('keep');
    expect(filter.decide(start(), 2)).toBe('hold');
  });

  it('P drops only pre-snapshot seed copies and seed anchors', () => {
    const { filter } = fixture({ prefixMark: 5, seedMessageIds: new Set(['X']),
      seedBlockKeys: new Set(['X|text|1', 'X|tool|t']) });
    expect(filter.decide(start(), 1)).toBe('drop');
    expect(filter.decide(text('old', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(e('tool_delta', { toolCallId: 't', delta: '{}' }), 3)).toBe('drop');
    expect(filter.decide(text('other', 'stream', 0), 4)).toBe('keep');
    expect(filter.decide(text('later', 'stream', 1), 5)).toBe('keep');
    expect(filter.decide(text('complete', 'complete', 1), 1)).toBe('keep');
  });

  it('P2 drops a pre-snapshot complete batch for an untracked seeded X', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a'), block('text', 'b')),
      seedStartK: new Map([['X', 2]]) });
    expect(filter.decide(start('complete'), 1)).toBe('hold');
    expect(filter.decide(text('b', 'complete', 1), 2)).toBe('drop');
    expect(filter.decide(end(), 3)).toBe('drop');
    expect(delivered).toEqual([]);
    expect(filter.decide(start(), 10)).toBe('keep');
  });

  it('P2 keeps an unmatched complete block and flushes the pre-snapshot anchor first', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, seedStartK: new Map([['X', 1]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    const head = start('complete');
    expect(filter.decide(head, 2)).toBe('hold');
    expect(filter.decide(text('different', 'complete'), 3)).toBe('keep');
    expect(delivered).toEqual([anchor, head]);
  });

  it('P3 absorbs a truncated pre-snapshot prefix and P2 discards it on a complete copy', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a'), block('text', 'partial done')),
      seedStartK: new Map([['X', 2]]) });
    expect(filter.decide(start(), 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(start('complete'), 3)).toBe('hold');
    expect(filter.decide(text('partial done', 'complete', 1), 4)).toBe('drop');
    expect(filter.decide(end(), 5)).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('P3 rebuilds a divergent prefix before keeping its next delta', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'partial done')),
      seedStartK: new Map([['X', 0]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('par'), 2)).toBe('drop');
    expect(filter.decide(text('tX'), 3)).toBe('keep');
    expect(delivered[0]).toBe(anchor);
    expect(delivered[1]).toMatchObject({ eventType: 'text_delta', delta: 'par', blockIndex: 0 });
  });

  it('T keeps synthetic or changed real results, reconciles history, then drops an exact redelivery', () => {
    const { filter, reconcile } = fixture({ historyToolIds: new Set(['t']),
      historyToolResults: new Map([['t', { output: '[Agent completed]', isError: false, synthetic: true }]]) });
    const result = e('tool_result', { toolCallId: 't', output: { error: 'real' }, isError: true });
    expect(filter.decide(result)).toBe('keep');
    expect(reconcile).toHaveBeenCalledWith(result);
    expect(filter.decide(result)).toBe('drop');
  });

  it('T structurally compares persisted JSON and keeps results for unknown tools', () => {
    const { filter, reconcile } = fixture({ historyToolResults: new Map([['t',
      { output: { a: 1, b: [2] }, isError: false, synthetic: false }]]) });
    expect(filter.decide(e('tool_result', { toolCallId: 't', output: { b: [2], a: 1 }, isError: false }))).toBe('drop');
    expect(filter.decide(e('tool_result', { toolCallId: 'other', output: 'x', isError: false }))).toBe('keep');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('T reconciles a changed persisted result and a history tool with no prior result', () => {
    const { filter, reconcile } = fixture({ historyToolIds: new Set(['t', 'new']),
      historyToolResults: new Map([['t', { output: 'old', isError: false, synthetic: false }]]) });
    const changed = e('tool_result', { toolCallId: 't', output: 'new', isError: true });
    const first = e('tool_result', { toolCallId: 'new', output: 'first', isError: false });
    expect(filter.decide(changed)).toBe('keep');
    expect(filter.decide(first)).toBe('keep');
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(filter.decide(changed)).toBe('drop');
    expect(filter.decide(first)).toBe('drop');
  });

  it('R keeps a terminal and releases an unresolved loose prefix before it', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'part one')),
      seedStartK: new Map([['X', 1]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(e('turn_state', { messageId: 'turn', phase: 'idle' }))).toBe('keep');
    expect(delivered[0]).toBe(anchor);
    expect(delivered[1]).toMatchObject({ eventType: 'text_delta', delta: 'par' });
    expect(filter.decide(text('later'))).toBe('keep');
  });

  it('O keeps unscoped events and user starts', () => {
    const { filter } = fixture();
    expect(filter.decide(e('turn_state', { messageId: 'turn', phase: 'generating' }))).toBe('keep');
    expect(filter.decide(e('message_start', { role: 'user' }))).toBe('keep');
  });

  it('I passes through an older-host seed id and a non-anchor first event', () => {
    const older = fixture({ seedMessageIds: new Set(['X']) }).filter;
    expect(older.decide(start())).toBe('keep');
    expect(older.decide(text('a'))).toBe('keep');
    expect(fixture().filter.decide(text('a'))).toBe('keep');
    expect(fixture({ history: new Map() }).filter.decide(start())).toBe('keep');
  });

  it('I tracks a seeded start at k0 and H drops its exact next block', () => {
    const { filter, delivered } = fixture({ history: h(block('text', 'a'), block('text', 'partial')),
      seedStartK: new Map([['X', 1]]), seedMessageIds: new Set(['X']) });
    expect(filter.decide(start())).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1))).toBe('drop');
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(filter.decide(text('partial', 'complete', 1))).toBe('drop');
    expect(filter.decide(end())).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('S flushes a pending anchor on beyond-history content and drops a history tool by identity', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('tool', 't')),
      seedStartK: new Map([['X', 1]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(tool('t'), 10)).toBe('drop');
    expect(filter.decide(e('tool_delta', { toolCallId: 't', delta: '{}' }))).toBe('drop');
    expect(filter.decide(text('next', 'stream', 1))).toBe('keep');
    expect(delivered).toEqual([anchor]);
  });

  it('H absorbs a stream prefix and drops its exact complete batch without a live partial', () => {
    const { filter, delivered } = fixture({ history: h(block('text', 'partial done')) });
    expect(filter.decide(start())).toBe('hold');
    expect(filter.decide(text('par'))).toBe('drop');
    expect(filter.decide(text('tial done'))).toBe('drop');
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(filter.decide(text('partial done', 'complete'))).toBe('drop');
    expect(filter.decide(end())).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('H releases merged text and the held batch head on a complete mismatch', () => {
    const { filter, delivered } = fixture({ history: h(block('text', 'n1 n2')) });
    const anchor = start(); const head = start('complete');
    expect(filter.decide(anchor)).toBe('hold');
    expect(filter.decide(text('n1'))).toBe('drop');
    expect(filter.decide(head)).toBe('hold');
    expect(filter.decide(text('n1 n3', 'complete'))).toBe('keep');
    expect(delivered.map((x) => x.eventType)).toEqual(['message_start', 'text_delta', 'message_start']);
    expect(delivered[0]).toBe(anchor);
    expect(delivered[1]).toMatchObject({ delta: 'n1' });
    expect(delivered[2]).toBe(head);
  });

  it('H fails open immediately on a stream mismatch and warns once', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { filter, delivered } = fixture({ history: h(block('text', 'a')) });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    expect(filter.decide(text('z'))).toBe('keep');
    expect(delivered).toEqual([anchor]);
    expect(filter.decide(text('more'))).toBe('keep');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('H handles three history records in one complete batch then passes later blocks', () => {
    const { filter } = fixture({ history: h(block('thinking', 't'), block('text', 'a'), block('tool', 'u')) });
    expect(filter.decide(start())).toBe('hold');
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(filter.decide(thinking('t', 'complete'))).toBe('drop');
    expect(filter.decide(text('a', 'complete'))).toBe('drop');
    expect(filter.decide(tool('u', 'complete'))).toBe('drop');
    expect(filter.decide(end())).toBe('drop');
    expect(filter.decide(text('next', 'stream', 3))).toBe('keep');
  });

  it('H keeps subagent thinking outside the compared sequence', () => {
    const { filter } = fixture();
    expect(filter.decide(e('message_start', { role: 'assistant', parentToolUseId: 'parent' }))).toBe('hold');
    expect(filter.decide(e('thinking_delta', { delta: 'private', blockIndex: 0, parentToolUseId: 'parent' }))).toBe('keep');
    expect(filter.decide(e('message_start', { source: 'complete', role: 'assistant', parentToolUseId: 'parent' }))).toBe('hold');
    expect(filter.decide(e('thinking_delta', { source: 'complete', delta: 'private', blockIndex: 0, parentToolUseId: 'parent' }))).toBe('keep');
    expect(filter.decide(e('text_delta', { source: 'complete', delta: 'a', blockIndex: 1, parentToolUseId: 'parent' }))).toBe('drop');
  });

  it('S releases a loose block on its next stream delta beyond the page', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'partial')),
      seedStartK: new Map([['X', 1]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(start(), 10)).toBe('hold');
    expect(filter.decide(text('tial', 'stream', 1), 11)).toBe('keep');
    expect(delivered[0]).toBe(anchor);
    expect(delivered[2]).toMatchObject({ eventType: 'text_delta', delta: 'par' });
  });

  it('loose blocks continue at ks after a deferred anchor and are discarded by an exact complete copy', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a'), block('text', 'partial done')),
      seedStartK: new Map([['X', 1]]) });
    expect(filter.decide(start(), 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(start(), 10)).toBe('hold');
    expect(filter.decide(text('tial', 'stream', 1), 11)).toBe('drop');
    expect(filter.decide(start('complete'), 12)).toBe('hold');
    expect(filter.decide(text('partial done', 'complete', 1), 13)).toBe('drop');
    expect(filter.decide(end(), 14)).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('loose blocks are discarded by a kept complete copy in passthrough', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'partial')),
      seedStartK: new Map([['X', 1]]) });
    expect(filter.decide(start(), 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(start(), 10)).toBe('hold');
    expect(filter.decide(text('partial', 'complete', 1), 11)).toBe('keep');
    filter.retire();
    expect(delivered.filter((x) => x.eventType === 'text_delta')).toEqual([]);
  });

  it('retirement discards an earlier loose prefix and an exact last loose block', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'part one'), block('text', 'second')),
      seedStartK: new Map([['X', 2]]) });
    expect(filter.decide(start(), 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 0), 2)).toBe('drop');
    expect(filter.decide(text('second', 'stream', 1), 3)).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('retirement rebuilds an earlier loose block without a pre-snapshot history prefix', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'partial'), block('text', 'other')),
      seedStartK: new Map([['X', 0]]) });
    expect(filter.decide(start(), 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 0), 2)).toBe('drop');
    expect(filter.decide(text('oth', 'stream', 1), 3)).toBe('drop');
    filter.retire();
    expect(delivered.map((x) => x.eventType)).toEqual(['message_start', 'text_delta', 'text_delta']);
  });

  it('a malformed queue warns once and fails open', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { filter, delivered } = fixture({ history: h(block('text', 'a')) });
    expect(filter.decide(start())).toBe('hold');
    for (let i = 0; i < 7; i++) expect(filter.decide(e('message_delta', { tokenUsage: { input: i, output: 0 } }))).toBe('hold');
    expect(filter.decide(e('message_delta', { tokenUsage: { input: 8, output: 0 } }))).toBe('keep');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveLength(8);
  });

  it('R-B3d keeps a non-history tool against thinking and releases the anchor', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { filter, delivered } = fixture({ history: h(block('thinking', 't')) });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    expect(filter.decide(tool('toolu_9'))).toBe('keep');
    expect(delivered).toEqual([anchor]);
    expect(filter.decide(e('tool_delta', { toolCallId: 'toolu_9', delta: '{}' }))).toBe('keep');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('P3 keeps a non-history tool instead of absorbing a thinking prefix', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('thinking', 't')),
      seedStartK: new Map([['X', 0]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(tool('toolu_9'), 2)).toBe('keep');
    expect(delivered).toEqual([anchor]);
    expect(filter.decide(e('tool_delta', { toolCallId: 'toolu_9', delta: '{}' }), 3)).toBe('keep');
  });

  it.each([
    ['different tool', () => tool('toolu_7')],
    ['different text', () => text('zz')],
  ])('R-B3d keeps an early %s mismatch', (_name, mismatched) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { filter, delivered } = fixture({ history: h(block('text', 'n1'), block('tool', 'toolu_9')) });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    expect(filter.decide(mismatched())).toBe('keep');
    expect(delivered).toEqual([anchor]);
    expect(filter.decide(text('later', 'stream', 2))).toBe('keep');
  });

  it('S flushes a tracked anchor before a stream block beyond history', () => {
    const { filter, delivered } = fixture({ history: h(block('text', 'a')) });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    expect(filter.decide(text('a'))).toBe('drop');
    expect(filter.decide(text('next', 'stream', 1))).toBe('keep');
    expect(delivered).toEqual([anchor]);
  });

  it('S rebuilds a loose block before a tracked block beyond history', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a')),
      seedStartK: new Map([['X', 0]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('a', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(text('a', 'stream', 0), 10)).toBe('drop');
    expect(filter.decide(text('next', 'stream', 1), 11)).toBe('keep');
    expect(delivered[0]).toBe(anchor);
    expect(delivered[1]).toMatchObject({ delta: 'a', blockIndex: 1 });
  });

  it('R-B1s(c) keeps an unpersisted pre-snapshot prefix and its continuation', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a')),
      seedStartK: new Map([['X', 1]]) });
    const anchor = start();
    const prefix = text('par', 'stream', 1);
    const tail = text('tial', 'stream', 1);
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(prefix, 2)).toBe('keep');
    expect(filter.decide(tail, 10)).toBe('keep');
    expect(delivered).toEqual([anchor]);
  });

  it('R-B1s(a) drops the completed pre-snapshot block and passes later content', () => {
    const { filter, delivered } = fixture({ prefixMark: 10,
      history: h(block('text', 'a'), block('text', 'partial done')),
      seedStartK: new Map([['X', 2]]) });
    const anchor = start();
    const deferred = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('partial', 'stream', 1), 2)).toBe('drop');
    expect(filter.decide(start('complete'), 3)).toBe('hold');
    expect(filter.decide(text('partial done', 'complete', 1), 4)).toBe('drop');
    expect(filter.decide(end(), 5)).toBe('drop');
    expect(filter.decide(deferred, 10)).toBe('hold');
    expect(filter.decide(text('next', 'stream', 2), 11)).toBe('keep');
    expect(delivered).toEqual([anchor, deferred]);
    expect(filter.decide(e('turn_state', { phase: 'idle' }))).toBe('keep');
    expect(delivered).toEqual([anchor, deferred]);
  });

  it('R-B6 releases the head before an uncovered text suffix and keeps the tail', () => {
    const { filter, delivered } = fixture({ history: h(block('thinking', 't')) });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    const head = start('complete');
    expect(filter.decide(head)).toBe('hold');
    expect(filter.decide(thinking('t', 'complete'))).toBe('drop');
    expect(filter.decide(text('b', 'complete', 1))).toBe('keep');
    expect(delivered).toEqual([anchor, head]);
    expect(filter.decide(end())).toBe('keep');
  });

  it('R-B5 drops stream subagent text after keeping its thinking', () => {
    const { filter } = fixture();
    expect(filter.decide(e('message_start', { parentToolUseId: 'parent', role: 'assistant' }))).toBe('hold');
    expect(filter.decide(e('thinking_delta', { delta: 'private', blockIndex: 0, parentToolUseId: 'parent' }))).toBe('keep');
    expect(filter.decide(e('text_delta', { delta: 'a', blockIndex: 1, parentToolUseId: 'parent' }))).toBe('drop');
  });

  it.each(['n1 n2', 'n1 n3'])('R-B3c handles a large prefix followed by complete %s', (complete) => {
    const { filter, delivered } = fixture({ history: h(block('text', 'n1 n2')) });
    expect(filter.decide(start())).toBe('hold');
    for (let i = 0; i < 2500; i++) expect(filter.decide(text(i === 0 ? 'n1 n2' : ''))).toBe('drop');
    expect(delivered).toEqual([]);
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(filter.decide(text(complete, 'complete'))).toBe(complete === 'n1 n2' ? 'drop' : 'keep');
    expect(filter.decide(end())).toBe(complete === 'n1 n2' ? 'drop' : 'keep');
    expect(filter.decide(e('turn_state', { phase: 'idle' }))).toBe('keep');
    expect(delivered.some((event) => event.eventType === 'text_delta')).toBe(complete !== 'n1 n2');
  });

  it('H rebuilds thinking start, one merged delta with a fresh id, then signature', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { filter, delivered } = fixture({ history: h(block('thinking', 'think')) });
    expect(filter.decide(start())).toBe('hold');
    const begin = e('thinking_start', { blockIndex: 0 });
    const first = thinking('thi');
    const signature = e('signature_delta', { blockIndex: 0, signature: 'sig' });
    expect(filter.decide(begin)).toBe('drop');
    expect(filter.decide(first)).toBe('drop');
    expect(filter.decide(thinking('n'))).toBe('drop');
    expect(filter.decide(signature)).toBe('drop');
    expect(filter.decide(thinking('X'))).toBe('keep');
    expect(delivered.map((event) => event.eventType)).toEqual([
      'message_start', 'thinking_start', 'thinking_delta', 'signature_delta',
    ]);
    expect(delivered[2]).toMatchObject({ delta: 'thin' });
    expect(delivered[2].id).not.toBe(first.id);
  });

  it('P3 absorbs a first thinking_start and signature and passes a mismatched block', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('thinking', 'think')),
      seedStartK: new Map([['X', 0]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(e('thinking_start', { blockIndex: 0 }), 2)).toBe('drop');
    expect(filter.decide(e('signature_delta', { blockIndex: 0, signature: 'sig' }), 3)).toBe('drop');
    expect(filter.decide(thinking('bad'), 4)).toBe('keep');
    expect(filter.decide(thinking('more'), 5)).toBe('keep');
    expect(delivered[0]).toBe(anchor);
  });

  it('H advances tool identity positions for stream and complete events', () => {
    const { filter, delivered } = fixture({ history: h(block('tool', 't'), block('text', 'a')) });
    expect(filter.decide(start())).toBe('hold');
    expect(filter.decide(tool('t'))).toBe('drop');
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(filter.decide(tool('t', 'complete'))).toBe('drop');
    expect(filter.decide(text('a', 'stream', 1))).toBe('drop');
    expect(filter.decide(text('a', 'complete', 1))).toBe('drop');
    expect(filter.decide(end())).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('P2 drops an agent_start inside an otherwise dropped pre-snapshot batch', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('tool', 't')),
      seedStartK: new Map([['X', 1]]) });
    expect(filter.decide(start('complete'), 1)).toBe('hold');
    expect(filter.decide(tool('t', 'complete'), 2)).toBe('drop');
    expect(filter.decide(e('agent_start', { source: 'complete', toolCallId: 't' }), 3)).toBe('drop');
    expect(filter.decide(end(), 4)).toBe('drop');
    expect(delivered).toEqual([]);
  });

  it('P2 drops the head and tail of a zero-block pre-snapshot batch', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, seedStartK: new Map([['X', 0]]) });
    expect(filter.decide(start('complete'), 1)).toBe('hold');
    expect(filter.decide(end(), 2)).toBe('drop');
    filter.retire();
    expect(delivered).toEqual([]);
  });

  it('R releases a queued delta before the terminal after kept content', () => {
    const { filter, delivered } = fixture({ prefixMark: 10, history: h(block('text', 'a')),
      seedStartK: new Map([['X', 0]]) });
    expect(filter.decide(tool('other'), 1)).toBe('keep');
    const queued = e('message_delta', { tokenUsage: { input: 1, output: 1 } });
    expect(filter.decide(queued, 2)).toBe('hold');
    expect(filter.decide(e('turn_state', { phase: 'idle' }))).toBe('keep');
    expect(delivered).toEqual([queued]);
  });

  it('R releases unresolved loose blocks before returning the terminal', () => {
    const { filter, delivered } = fixture({ prefixMark: 10,
      history: h(block('text', 'partial'), block('text', 'other')),
      seedStartK: new Map([['X', 0]]) });
    const anchor = start();
    expect(filter.decide(anchor, 1)).toBe('hold');
    expect(filter.decide(text('par', 'stream', 0), 2)).toBe('drop');
    expect(filter.decide(text('oth', 'stream', 1), 3)).toBe('drop');
    expect(filter.decide(e('turn_state', { phase: 'idle' }))).toBe('keep');
    expect(delivered[0]).toBe(anchor);
    expect(delivered.slice(1).map((event) => event.eventType)).toEqual(['text_delta', 'text_delta']);
    expect(delivered.slice(1).map((event) => (event as Extract<FlatStreamEventUnion, { eventType: 'text_delta' }>).delta))
      .toEqual(['par', 'oth']);
  });

  it('T detects isError-only and structural output changes', () => {
    const outputs: [unknown, unknown][] = [
      [[1], { 0: 1 }], [{ a: 1 }, { a: 1, b: 2 }], [{ a: undefined }, {}],
    ];
    for (const [before, after] of outputs) {
      const { filter, reconcile } = fixture({ historyToolIds: new Set(['t']),
        historyToolResults: new Map([['t', { output: before, isError: false, synthetic: false }]]) });
      expect(filter.decide(e('tool_result', { toolCallId: 't', output: after, isError: false }))).toBe('keep');
      expect(reconcile).toHaveBeenCalledTimes(1);
    }
    const { filter } = fixture({ historyToolIds: new Set(['t']),
      historyToolResults: new Map([['t', { output: 'same', isError: false, synthetic: false }]]) });
    expect(filter.decide(e('tool_result', { toolCallId: 't', output: 'same', isError: true }))).toBe('keep');
  });

  it('T keeps redeliveries when reconciliation found no history node', () => {
    const reconcile = jest.fn(() => false);
    const { filter } = fixture({ historyToolIds: new Set(['t']), reconcileHistoryToolResult: reconcile });
    const result = e('tool_result', { toolCallId: 't', output: 'real', isError: false });
    expect(filter.decide(result)).toBe('keep');
    expect(filter.decide(result)).toBe('keep');
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('T reconciles changed history tool results after retirement and always keeps them', () => {
    const { filter, reconcile } = fixture({ historyToolIds: new Set(['t']) });
    filter.retire();
    const result = e('tool_result', { toolCallId: 't', output: 'real', isError: false });
    expect(filter.decide(result)).toBe('keep');
    expect(filter.decide(result)).toBe('keep');
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(filter.decide(e('tool_result', { toolCallId: 't', output: 'changed', isError: false }))).toBe('keep');
    expect(reconcile).toHaveBeenCalledTimes(2);
    const discarded = fixture({ historyToolIds: new Set(['t']) });
    discarded.filter.retire(true);
    expect(discarded.filter.decide(result)).toBe('keep');
    expect(discarded.reconcile).not.toHaveBeenCalled();
  });

  it('delivery failure does not requeue a flushed anchor', () => {
    const delivered: FlatStreamEventUnion[] = [];
    const delivery = jest.fn((event: FlatStreamEventUnion) => {
      delivered.push(event);
      if (delivered.length === 1) throw new Error('delivery failed');
    });
    const { filter } = fixture({ deliverToTab: delivery });
    const anchor = start();
    expect(filter.decide(anchor)).toBe('hold');
    expect(() => filter.decide(e('thinking_delta', { delta: 'private', blockIndex: 0,
      parentToolUseId: 'parent' }))).toThrow('delivery failed');
    expect(filter.decide(e('thinking_delta', { delta: 'more', blockIndex: 0,
      parentToolUseId: 'parent' }))).toBe('keep');
    expect(delivered).toEqual([anchor]);
  });

  it('delivery failure does not requeue a released block or earlier anchor', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const delivered: FlatStreamEventUnion[] = [];
    const delivery = jest.fn((event: FlatStreamEventUnion) => {
      delivered.push(event);
      if (delivered.length === 2) throw new Error('delivery failed');
    });
    const { filter } = fixture({ history: h(block('text', 'ab')), deliverToTab: delivery });
    expect(filter.decide(start())).toBe('hold');
    expect(filter.decide(text('a'))).toBe('drop');
    expect(filter.decide(start('complete'))).toBe('hold');
    expect(() => filter.decide(text('ac', 'complete'))).toThrow('delivery failed');
    expect(filter.decide(text('next', 'stream', 1))).toBe('keep');
    expect(delivered.map((event) => event.eventType)).toEqual(['message_start', 'text_delta', 'message_start']);
  });
});
