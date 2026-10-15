import type { CommandWorkNode } from '../model/command-center.store';
import { StatusNarrator } from './status-narrator';

const node = (
  id: string,
  parentId: string | null,
  state: CommandWorkNode['state'],
): CommandWorkNode => ({
  id,
  kind: id.startsWith('root:')
    ? 'root'
    : id.startsWith('tribunal:')
      ? 'tribunal'
      : id.startsWith('phase:')
        ? 'phase'
        : id.startsWith('lane:')
          ? 'lane'
          : id.startsWith('child:')
            ? 'child'
            : 'agent',
  parentId,
  state,
  label: 'Worker',
  providerId: null,
});

describe('StatusNarrator', () => {
  it('deduplicates owned transitions and speaks only at a boundary', () => {
    const narrator = new StatusNarrator();
    const nodes = [
      node('root:a', null, 'running'),
      node('lane:run:one', 'root:a', 'running'),
    ];
    narrator.observe('root:a', nodes);
    narrator.observe('root:a', nodes);
    expect(narrator.drain()).toEqual(['Worker started.']);
    narrator.observe('root:a', nodes);
    expect(narrator.drain()).toEqual([]);
  });

  it('revokes stale queued states before delivery', () => {
    const narrator = new StatusNarrator();
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'running'),
    ]);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'failed'),
    ]);
    expect(narrator.drain()).toEqual(['Worker failed.']);
  });

  it('speaks started once across starting and running boundaries, then completes', () => {
    const narrator = new StatusNarrator();
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'starting'),
    ]);
    expect(narrator.drain()).toEqual(['Worker started.']);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'running'),
    ]);
    expect(narrator.drain()).toEqual([]);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'completed'),
    ]);
    expect(narrator.drain()).toEqual(['Worker completed.']);
  });
});
