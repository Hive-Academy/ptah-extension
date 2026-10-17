import type { CommandWorkNode, CommandWorkState } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import { placeScene } from './scene-placement';

const root: CommandWorkNode = { id: 'root', kind: 'root', parentId: null, label: 'Root', providerId: null, state: 'running' };

function node(id: string, state: CommandWorkState = 'queued', parentId = 'root', kind: CommandWorkNode['kind'] = 'child'): CommandWorkNode {
  return { id, kind, parentId, state, label: id, providerId: null };
}

function projection(nodes: CommandWorkNode[]): ProjectionResult {
  return { nodes, edges: [] };
}

describe('placeScene', () => {
  it('returns an empty model without a root', () => {
    expect(placeScene(projection([node('orphan')]))).toEqual({
      placed: [], overflow: { completed: 0, other: 0 }, activeCount: 0,
      counts: { inProgress: 0, waiting: 0, finished: 0, other: 0 },
    });
  });

  it('caps at 23, promotes selected and urgent nodes, then restores projection order', () => {
    const bulk = Array.from({ length: 25 }, (_, i) => node(`n${i}`, 'queued'));
    const nodes = [root, ...bulk, node('done', 'completed'), node('failed', 'failed')];
    const result = placeScene(projection(nodes), 'n24');
    expect(result.placed).toHaveLength(23);
    expect(result.placed.map((item) => item.id)).toEqual([
      ...bulk.slice(0, 21).map((item) => item.id), 'n24', 'failed',
    ]);
    expect(result.overflow).toEqual({ completed: 1, other: 3 });
    expect(result.counts).toEqual({ inProgress: 0, waiting: 0, finished: 1, other: 26 });
  });

  it('includes valid ancestors and skips broken or cyclic chains', () => {
    const nodes = [
      root, node('parent', 'completed'), node('child', 'failed', 'parent'),
      node('lost', 'failed', 'missing'), node('a', 'failed', 'b'), node('b', 'queued', 'a'),
    ];
    const result = placeScene(projection(nodes));
    expect(result.placed.map((item) => item.id)).toEqual(['parent', 'child']);
    expect(result.overflow).toEqual({ completed: 0, other: 3 });
  });

  it('excludes phases from counts and provides each tribunal its own phases', () => {
    const nodes = [
      root, node('tribunal-a', 'running', 'root', 'tribunal'),
      node('a-1', 'completed', 'tribunal-a', 'phase'),
      node('a-2', 'running', 'tribunal-a', 'phase'),
      node('tribunal-b', 'awaiting input', 'root', 'tribunal'),
      node('b-1', 'completed', 'tribunal-b', 'phase'),
      node('b-2', 'completed', 'tribunal-b', 'phase'),
      node('lane', 'starting', 'tribunal-b', 'lane'),
      node('finished', 'completed'), node('failed', 'failed'),
    ];
    const result = placeScene(projection(nodes));
    expect(result.placed.map((item) => item.id)).toEqual(['tribunal-a', 'tribunal-b', 'lane', 'finished', 'failed']);
    expect(result.placed[0].phases.map((phase) => phase.id)).toEqual(['a-1', 'a-2']);
    expect(result.placed[1].phases.map((phase) => phase.id)).toEqual(['b-1', 'b-2']);
    expect(result.counts).toEqual({ inProgress: 2, waiting: 1, finished: 1, other: 1 });
    expect(result.activeCount).toBe(2);
  });
});
