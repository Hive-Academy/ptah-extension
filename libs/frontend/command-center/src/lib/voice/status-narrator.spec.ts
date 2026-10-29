import type { CommandWorkNode } from '../model/command-center.store';
import { StatusNarrator } from './status-narrator';

const node = (
  id: string,
  parentId: string | null,
  state: CommandWorkNode['state'],
): CommandWorkNode => ({
  id,
  kind: id.startsWith('root:') ? 'root' : id.startsWith('child:') ? 'child' : 'agent',
  parentId,
  state,
  label: 'Worker',
  providerId: null,
});

describe('StatusNarrator', () => {
  it('waits for the root before taking a silent baseline', () => {
    const narrator = new StatusNarrator();
    narrator.observe('root:a', [node('child:c', 'root:a', 'running')]);
    expect(narrator.drain()).toEqual([]);
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

  it('uses the first observation as a silent baseline, then narrates a transition once', () => {
    const narrator = new StatusNarrator();
    const nodes = [
      node('root:a', null, 'running'),
      node('cli:one', 'root:a', 'running'),
    ];
    narrator.observe('root:a', nodes);
    narrator.observe('root:a', nodes);
    expect(narrator.drain()).toEqual([]);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('cli:one', 'root:a', 'completed'),
    ]);
    expect(narrator.drain()).toEqual(['Worker completed.']);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('cli:one', 'root:a', 'completed'),
    ]);
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
    expect(narrator.drain()).toEqual([]);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'running'),
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

  it('uses a root change as a silent baseline', () => {
    const narrator = new StatusNarrator();
    narrator.observe('root:a', [node('root:a', null, 'running')]);
    narrator.observe('root:b', [
      node('root:b', null, 'running'),
      node('child:c', 'root:b', 'completed'),
    ]);
    expect(narrator.drain()).toEqual([]);
    narrator.observe('root:b', [
      node('root:b', null, 'running'),
      node('child:c', 'root:b', 'failed'),
    ]);
    expect(narrator.drain()).toEqual(['Worker failed.']);
  });

  it('uses the next observation after clear as a silent baseline', () => {
    const narrator = new StatusNarrator();
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'running'),
    ]);
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'completed'),
    ]);
    narrator.clear();
    narrator.observe('root:a', [
      node('root:a', null, 'running'),
      node('child:c', 'root:a', 'completed'),
    ]);
    expect(narrator.drain()).toEqual([]);
  });
});
