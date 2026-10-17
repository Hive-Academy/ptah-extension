import type { CommandWorkNode } from '../model/command-center.store';
import {
  layoutScene,
  SCENE_LABEL_CANDIDATE_LIMIT,
  type SceneRect,
} from './scene-layout';

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
const measure = jest.fn((_nodeId: string, text: string) => ({
  width: Math.max(40, text.length * 6),
  height: 20,
}));

describe('layoutScene', () => {
  beforeEach(() => measure.mockClear());

  it('caps each label search independently of viewport area', () => {
    expect(SCENE_LABEL_CANDIDATE_LIMIT).toBe(452);
  });

  it.each([900, 1440, 1600])(
    'keeps dense root labels nearby with bounded search at %ipx',
    (width) => {
      const nodes = [
        root,
        ...Array.from({ length: 23 }, (_, i) => node(`cli:${i}`)),
      ];
      let calls = 0;
      const measured = (_id: string, _text: string) => {
        calls++;
        return { width: 72, height: 24 };
      };
      const result = layoutScene(
        { nodes, edges: [] },
        { width, height: 800 },
        measured,
      );
      const hero = result.nodes[0];
      expect(result.nodes).toHaveLength(24);
      expect(calls).toBe(24);
      expect(hero.labelRect).not.toBeNull();
      const plate = hero.labelRect;
      if (!plate) throw new Error('Missing root plate');
      expect(
        Math.hypot(
          plate.x + plate.width / 2 - hero.x,
          plate.y + plate.height / 2 - hero.y,
        ),
      ).toBeLessThan(300);
      for (const orb of result.nodes) {
        const dx = Math.max(plate.x - orb.x, 0, orb.x - plate.x - plate.width);
        const dy = Math.max(plate.y - orb.y, 0, orb.y - plate.y - plate.height);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(
          orb.radius + (orb.kind === 'root' ? 32 : 12),
        );
      }
    },
  );

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

  it.each([460, 320])('keeps 24 sphere bodies clear at 600x%i', (height) => {
    const nodes = [
      root,
      ...Array.from({ length: 23 }, (_, i) => node(`cli:${i}`)),
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 600, height },
      measure,
    );
    expect(result.nodes).toHaveLength(24);
    const hero = result.nodes[0];
    for (let i = 1; i < result.nodes.length; i++) {
      const current = result.nodes[i];
      expect(current.radius).toBeGreaterThanOrEqual(12);
      expect(
        Math.hypot(current.x - hero.x, current.y - hero.y),
      ).toBeGreaterThanOrEqual(hero.radius + 16 + 12 + current.radius);
      for (let j = i + 1; j < result.nodes.length; j++) {
        const other = result.nodes[j];
        expect(
          Math.hypot(current.x - other.x, current.y - other.y),
        ).toBeGreaterThanOrEqual(current.radius + other.radius);
      }
    }
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

  it('keeps root, selected, awaiting and failed plates ahead of ordinary plates in a crowded scene', () => {
    const nodes = [
      root,
      ...Array.from({ length: 15 }, (_, i) => node(`cli:${i}`)),
      node('cli:failed', 'failed'),
      node('cli:awaiting', 'awaiting input'),
      node('cli:selected'),
    ];
    const result = layoutScene(
      { nodes, edges: [] },
      { width: 2200, height: 1400 },
      measure,
      'cli:selected',
    );
    for (const id of [root.id, 'cli:selected', 'cli:awaiting', 'cli:failed']) {
      expect(
        result.nodes.find((entry) => entry.node.id === id)?.labelRect,
      ).not.toBeNull();
    }
    expect(
      result.nodes.find((entry) => entry.node.id === 'cli:14')?.labelRect,
    ).toBeNull();
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

  it.each([1440, 600])(
    'keeps the root plate visible and all plates separate at %ipx with 24 nodes',
    (width) => {
      const nodes = [
        root,
        ...Array.from({ length: 23 }, (_, i) => node(`cli:${i}`)),
      ];
      const measured = jest.fn((id: string) => ({
        width: id === root.id ? 160 : 132,
        height: 44,
      }));
      const result = layoutScene(
        { nodes, edges: [] },
        { width, height: 600 },
        measured,
      );
      expect(result.nodes).toHaveLength(24);
      expect(
        result.nodes.find((entry) => entry.kind === 'root')?.labelRect,
      ).not.toBeNull();
      expect(measured.mock.calls.map(([id]) => id)).toEqual(
        expect.arrayContaining(nodes.map((entry) => entry.id)),
      );
      const plates = result.nodes.flatMap((entry) =>
        entry.labelRect ? [entry.labelRect] : [],
      );
      for (let i = 0; i < plates.length; i++) {
        for (let j = i + 1; j < plates.length; j++) {
          const a = plates[i];
          const b = plates[j];
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
        }
      }
    },
  );
});
