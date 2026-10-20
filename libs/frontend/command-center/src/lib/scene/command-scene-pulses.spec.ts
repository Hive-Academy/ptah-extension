import type { CommandWorkNode } from '../model/command-center.store';
import type { SceneInks } from './command-scene-renderer';
import type { SceneLayout, SceneNode, SceneTether } from './scene-layout';
import { DelegationPulseEmitter } from './command-scene-pulses';

const inks: SceneInks = {
  run: '#abc',
  need: '#def',
  err: '#f00',
  done: '#0f0',
  idle: '#aaa',
};
const root: CommandWorkNode = {
  id: 'root',
  kind: 'root',
  parentId: null,
  label: 'Root',
  providerId: null,
  state: 'completed',
};
const sceneNode = (
  id: string,
  state: CommandWorkNode['state'],
  x: number,
  y: number,
): SceneNode => ({
  node:
    id === 'root'
      ? root
      : {
          id,
          kind: 'agent',
          parentId: root.id,
          label: id,
          providerId: null,
          state,
        },
  x,
  y,
  radius: 20,
  scale: 1,
  kind: id === 'root' ? 'root' : 'delegate',
  label: id,
  labelRect: null,
  phases: [],
});
const layout = (
  states: Record<string, CommandWorkNode['state']>,
  tethers?: readonly SceneTether[],
): SceneLayout => ({
  nodes: [
    sceneNode('root', 'completed', 10, 20),
    ...Object.entries(states).map(([id, state], index) =>
      sceneNode(id, state, 110 + index * 20, 80),
    ),
  ],
  orbitCount: 1,
  tethers,
  overflowCompleted: 0,
  overflowOther: 0,
  overflowChip: null,
});

describe('DelegationPulseEmitter', () => {
  let emitter: DelegationPulseEmitter;
  beforeEach(() => {
    emitter = new DelegationPulseEmitter();
  });

  it('seeds live children and queues only a non-live to live transition', () => {
    emitter.observe(layout({ a: 'running', b: 'completed' }), false);
    expect(emitter.pendingCount).toBe(0);
    emitter.observe(layout({ a: 'running', b: 'starting' }), false);
    emitter.observe(layout({ a: 'running', b: 'running' }), false);
    expect(emitter.pendingCount).toBe(1);
    emitter.update(0);
    expect(emitter.count).toBe(1);
  });

  it('retains a handoff observed between paints and coalesces the child', () => {
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'running' }), false);
    expect(emitter.pendingCount).toBe(1);
    emitter.update(100);
    expect(emitter.count).toBe(1);
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.update(101);
    expect(emitter.count).toBe(1);
    expect(emitter.pendingCount).toBe(1);
    emitter.update(1340);
    expect(emitter.count).toBe(1);
    expect(emitter.pendingCount).toBe(0);
  });

  it('queues a brand-new live child, but not a previously observed live child returning', () => {
    emitter.observe(layout({}), false);
    emitter.observe(layout({ a: 'starting' }), false);
    expect(emitter.pendingCount).toBe(1);
    emitter.update(0);
    emitter.observe(layout({}), false);
    expect(emitter.count).toBe(0);
    emitter.observe(layout({ a: 'running' }), false);
    expect(emitter.pendingCount).toBe(0);
  });

  it('records silent states without queueing', () => {
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'running' }), true);
    emitter.observe(layout({ a: 'running' }), false);
    expect(emitter.pendingCount).toBe(0);
  });

  it('places a mid-flight bezier head between owner and worker', () => {
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.update(0);
    const arc = jest.fn();
    const context = Object.assign({} as CanvasRenderingContext2D, {
      save: jest.fn(),
      restore: jest.fn(),
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc,
      fill: jest.fn(),
      stroke: jest.fn(),
    });
    emitter.draw(context, 360, inks);
    expect(arc).toHaveBeenCalledWith(60, 50, 2.6, 0, Math.PI * 2);
  });

  it('emits at most one per update, caps live pulses and drops oldest pending', () => {
    const states: Record<string, CommandWorkNode['state']> = {};
    for (let index = 0; index < 20; index++) states[`c${index}`] = 'completed';
    emitter.observe(layout(states), false);
    const live: Record<string, CommandWorkNode['state']> = {};
    for (const id of Object.keys(states)) live[id] = 'starting';
    emitter.observe(layout(live), false);
    expect(emitter.pendingCount).toBe(12);
    emitter.update(0);
    expect(emitter.count).toBe(1);
    const arc = jest.fn();
    const context = Object.assign({} as CanvasRenderingContext2D, {
      save: jest.fn(),
      restore: jest.fn(),
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc,
      fill: jest.fn(),
      stroke: jest.fn(),
    });
    emitter.draw(context, 360, inks);
    expect(arc).toHaveBeenCalledWith(140, 50, 2.6, 0, Math.PI * 2);
    for (let time = 1; time <= 10; time++) emitter.update(time);
    expect(emitter.count).toBe(6);
    expect(emitter.pendingCount).toBe(6);
    emitter.update(1250);
    expect(emitter.count).toBe(1);
  });

  it('drops expired pulses and clears live pulses when time goes backward', () => {
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.update(1000);
    emitter.update(2239);
    expect(emitter.count).toBe(1);
    emitter.update(2240);
    expect(emitter.count).toBe(0);
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.update(3000);
    emitter.update(10);
    expect(emitter.count).toBe(0);
  });

  it('clear removes pending work and re-seeds the next layout', () => {
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    expect(emitter.pendingCount).toBe(1);
    emitter.clear();
    expect(emitter.pendingCount).toBe(0);
    emitter.observe(layout({ a: 'running' }), false);
    emitter.update(0);
    expect(emitter.count).toBe(0);
  });

  it('requires both endpoints and a drawn link, and drops removed workers', () => {
    const wrongTether: SceneTether = {
      fromId: 'a',
      toId: 'other',
      fromX: 110,
      fromY: 80,
      toX: 10,
      toY: 20,
    };
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }, [wrongTether]), false);
    expect(emitter.pendingCount).toBe(0);
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'starting' }), false);
    emitter.update(0);
    expect(emitter.count).toBe(1);
    emitter.observe(layout({}), false);
    expect(emitter.count).toBe(0);
    const missingOwner = {
      ...layout({ a: 'completed' }),
      nodes: [sceneNode('a', 'running', 110, 80)],
    };
    emitter.observe(missingOwner, false);
    expect(emitter.pendingCount).toBe(0);
  });

  it('draws the bezier head and worker ring, preserving canvas state', () => {
    const calls: Array<{ x: number; y: number; radius: number }> = [];
    const context = Object.assign({} as CanvasRenderingContext2D, {
      globalAlpha: 0.4,
      lineWidth: 3,
      fillStyle: 'before',
      strokeStyle: 'before',
      save: jest.fn(),
      restore: jest.fn(),
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn((x: number, y: number, radius: number) =>
        calls.push({ x, y, radius }),
      ),
      fill: jest.fn(),
      stroke: jest.fn(),
    });
    let dash = [4, 2];
    let savedDash = [4, 2];
    context.setLineDash.mockImplementation((segments: number[]) => {
      dash = [...segments];
    });
    context.getLineDash = jest.fn(() => [...dash]);
    let saved: [
      number,
      number,
      string | CanvasGradient | CanvasPattern,
      string | CanvasGradient | CanvasPattern,
    ] = [0.4, 3, 'before', 'before'];
    context.save.mockImplementation(() => {
      saved = [
        context.globalAlpha,
        context.lineWidth,
        context.fillStyle,
        context.strokeStyle,
      ];
      savedDash = [...dash];
    });
    context.restore.mockImplementation(() => {
      [
        context.globalAlpha,
        context.lineWidth,
        context.fillStyle,
        context.strokeStyle,
      ] = saved;
      dash = savedDash;
    });
    emitter.observe(layout({ a: 'completed' }), false);
    emitter.observe(layout({ a: 'running' }), false);
    emitter.update(0);
    emitter.draw(context, 360, inks);
    expect(calls).toContainEqual({ x: 60, y: 50, radius: 2.6 });
    expect(context.setLineDash).toHaveBeenCalledWith([]);
    expect(context.globalAlpha).toBe(0.4);
    expect(context.lineWidth).toBe(3);
    expect(context.fillStyle).toBe('before');
    expect(context.getLineDash()).toEqual([4, 2]);
    calls.length = 0;
    emitter.draw(context, 720, inks);
    expect(calls).toContainEqual({ x: 110, y: 80, radius: 33 });
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });

  it('follows matching tether geometry as a straight line', () => {
    const tether: SceneTether = {
      fromId: 'a',
      toId: 'root',
      fromX: 100,
      fromY: 90,
      toX: 20,
      toY: 30,
    };
    const arc = jest.fn();
    const context = Object.assign({} as CanvasRenderingContext2D, {
      save: jest.fn(),
      restore: jest.fn(),
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc,
      fill: jest.fn(),
      stroke: jest.fn(),
    });
    emitter.observe(layout({ a: 'completed' }, [tether]), false);
    emitter.observe(layout({ a: 'starting' }, [tether]), false);
    emitter.update(0);
    emitter.draw(context, 360, inks);
    expect(arc).toHaveBeenCalledWith(60, 60, 2.6, 0, Math.PI * 2);
  });
});
