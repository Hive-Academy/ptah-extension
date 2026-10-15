import type { CommandWorkNode } from '../model/command-center.store';
import { layoutScene, type SceneRect } from './scene-layout';

const root: CommandWorkNode = {
  id: 'root:r',
  kind: 'root',
  parentId: null,
  label: 'Ptah',
  providerId: null,
  state: 'running',
};
const node = (
  id: string,
  state: CommandWorkNode['state'] = 'running',
  parentId = root.id,
  providerId: string | null = 'codex',
): CommandWorkNode => ({
  id,
  kind: id.startsWith('tribunal:')
    ? 'tribunal'
    : id.startsWith('lane:')
      ? 'lane'
      : id.startsWith('phase:')
        ? 'phase'
        : id.startsWith('child:')
          ? 'child'
          : 'agent',
  parentId,
  label: id.split(':')[1],
  providerId,
  state,
});
const measure = jest.fn((text: string) => ({
  width: Math.max(40, text.length * 6),
  height: 20,
}));

describe('layoutScene', () => {
  beforeEach(() => measure.mockClear());

  it('positions root, delegate, Tribunal and satellites deterministically', () => {
    const nodes = [
      root,
      node('cli:a'),
      node('tribunal:run', 'running', root.id, null),
      node('lane:run:judge', 'running', 'tribunal:run'),
    ];
    const projection = { nodes, edges: [] };
    const first = layoutScene(
      projection,
      { width: 1200, height: 800 },
      measure,
    );
    expect(
      layoutScene(projection, { width: 1200, height: 800 }, measure),
    ).toEqual(first);
    expect(first.nodes.map((entry) => entry.kind)).toEqual([
      'root',
      'delegate',
      'tribunal',
      'satellite',
    ]);
    expect(first.nodes[0]).toMatchObject({ x: 600, y: 388 });
    expect(first.nodes[3].radius * 2).toBeGreaterThanOrEqual(32);
    expect(measure).toHaveBeenCalledTimes(nodes.length * 2);
  });

  it('caps visual nodes at 24 and counts hidden completed work', () => {
    const nodes = [
      root,
      ...Array.from({ length: 30 }, (_, i) =>
        node(`cli:${i}`, i < 26 ? 'completed' : 'failed'),
      ),
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 1400, height: 900 },
      measure,
    );
    expect(result.nodes).toHaveLength(24);
    expect(
      result.nodes.filter((entry) => entry.node.state === 'failed'),
    ).toHaveLength(4);
    expect(result.overflowCompleted).toBe(7);
    expect(result.overflowOther).toBe(0);
    expect(result.overflowChip?.text).toBe('+7 completed');
  });

  it('orbits Tribunal lanes around their core and attaches phase progress to it', () => {
    const tribunal = node('tribunal:run', 'running', root.id, null);
    const lanes = ['builder', 'challenger', 'judge'].map((role) =>
      node(`lane:run:${role}`, 'running', tribunal.id),
    );
    const phase = node('phase:run:round-1', 'running', tribunal.id, null);
    const projection = { nodes: [root, tribunal, ...lanes, phase], edges: [] };
    const first = layoutScene(
      projection,
      { width: 1400, height: 900 },
      measure,
    );
    expect(
      layoutScene(projection, { width: 1400, height: 900 }, measure),
    ).toEqual(first);
    const core = first.nodes.find((entry) => entry.node.id === tribunal.id);
    expect(core?.phases).toEqual([phase]);
    expect(first.nodes.some((entry) => entry.node.id === phase.id)).toBe(false);
    expect(first.nodes).toHaveLength(5);
    for (const lane of lanes) {
      const satellite = first.nodes.find((entry) => entry.node.id === lane.id);
      expect(satellite?.kind).toBe('satellite');
      expect(
        Math.hypot(
          (satellite?.x ?? 0) - (core?.x ?? 0),
          (satellite?.y ?? 0) - (core?.y ?? 0),
        ),
      ).toBeCloseTo((core?.radius ?? 0) + 16 + 12);
      expect((satellite?.radius ?? 0) * 2).toBeGreaterThanOrEqual(32);
    }
  });

  it('counts hidden running nodes and never displays a satellite without ancestors', () => {
    const tribunal = node('tribunal:run', 'completed', root.id, null);
    const lane = node('lane:run:judge', 'failed', tribunal.id);
    const agent = node('cli:agent', 'failed', lane.id);
    const nodes = [
      root,
      ...Array.from({ length: 30 }, (_, i) => node(`cli:${i}`)),
      tribunal,
      lane,
      agent,
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 1500, height: 900 },
      measure,
    );
    expect(result.nodes).toHaveLength(24);
    expect(result.overflowOther).toBeGreaterThan(0);
    expect(result.overflowChip?.text).toContain('more');
    const ids = new Set(result.nodes.map((entry) => entry.node.id));
    for (const entry of result.nodes) {
      if (entry.node.parentId && entry.node.parentId !== root.id)
        expect(ids.has(entry.node.parentId)).toBe(true);
    }
    expect(ids.has(lane.id)).toBe(true);
    expect(ids.has(tribunal.id)).toBe(true);
  });

  it('names a child from its parent provider and limits ordinary plates in a dense scene', () => {
    const nodes = [
      root,
      node('cli:parent'),
      node('child:builder', 'running', 'cli:parent', null),
      ...Array.from({ length: 13 }, (_, i) => node(`cli:${i}`)),
      node('cli:need', 'awaiting input'),
      node('cli:fail', 'failed'),
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 2200, height: 1400 },
      measure,
      'cli:12',
    );
    expect(
      result.nodes.find((entry) => entry.node.id === 'child:builder')?.label,
    ).toBe('Codex · builder');
    const ordinary = result.nodes.filter(
      (entry) =>
        entry.kind !== 'root' &&
        entry.node.id !== 'cli:12' &&
        entry.node.state !== 'awaiting input' &&
        entry.node.state !== 'failed',
    );
    expect(ordinary.filter((entry) => entry.labelRect)).toHaveLength(5);
    expect(
      result.nodes.find((entry) => entry.node.id === 'cli:need')?.labelRect,
    ).not.toBeNull();
  });

  it('keeps every placed plate outside all sphere halos by at least 12 pixels', () => {
    const nodes = [
      root,
      ...Array.from({ length: 11 }, (_, i) => node(`cli:${i}`)),
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 1500, height: 1000 },
      measure,
    );
    for (const { labelRect } of result.nodes) {
      if (!labelRect) continue;
      const rect: SceneRect = labelRect;
      for (const orb of result.nodes) {
        const dx = Math.max(rect.x - orb.x, 0, orb.x - rect.x - rect.width);
        const dy = Math.max(rect.y - orb.y, 0, orb.y - rect.y - rect.height);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(
          orb.radius + (orb.kind === 'root' ? 32 : 12),
        );
      }
    }
    expect(measure).toHaveBeenCalledTimes(nodes.length);
  });
});
