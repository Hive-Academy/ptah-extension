import type { CommandWorkNode } from '../model/command-center.store';
import type { SceneRenderSnapshot } from './command-scene-renderer';
import {
  BREATHING_NODE_LIMIT,
  BREATHING_NODE_STILL,
  breathScale,
  RUNNING_RING_RAD_PER_MS,
  waitingHaloAlpha,
} from './command-scene-status';
import type { SceneNode } from './scene-layout';

const sceneNode = (
  state: CommandWorkNode['state'],
  kind: SceneNode['kind'] = 'delegate',
): SceneNode => ({
  node: {
    id: 'cli:a',
    kind: kind === 'root' ? 'root' : 'agent',
    parentId: kind === 'root' ? null : 'root:r',
    label: 'a',
    providerId: null,
    state,
  },
  x: 0,
  y: 0,
  radius: 29,
  scale: 1,
  kind,
  label: 'a',
  labelRect: null,
  phases: [],
});
const snapshot = (reducedMotion: boolean): SceneRenderSnapshot =>
  ({ reducedMotion }) as SceneRenderSnapshot;

describe('scene liveness motion', () => {
  it('breathes a running delegate between 1.00 and 1.04 every 2.4s', () => {
    const running = sceneNode('running');
    expect(breathScale(running, 0, snapshot(false), 1)).toBeCloseTo(1);
    expect(breathScale(running, 1200, snapshot(false), 1)).toBeCloseTo(1.04);
    expect(breathScale(running, 2400, snapshot(false), 1)).toBeCloseTo(1);
  });

  it('holds still under reduced motion, for the root, idle nodes and crowded stages', () => {
    expect(breathScale(sceneNode('running'), 1200, snapshot(true), 1)).toBe(1);
    expect(
      breathScale(sceneNode('running', 'root'), 1200, snapshot(false), 1),
    ).toBe(1);
    expect(breathScale(sceneNode('completed'), 1200, snapshot(false), 1)).toBe(
      1,
    );
    expect(
      breathScale(
        sceneNode('running'),
        1200,
        snapshot(false),
        BREATHING_NODE_STILL,
      ),
    ).toBe(1);
  });

  it('ramps the breathing depth down progressively past eight running nodes', () => {
    const peak = (count: number) =>
      breathScale(sceneNode('running'), 1200, snapshot(false), count);
    expect(peak(BREATHING_NODE_LIMIT)).toBeCloseTo(1.04);
    expect(peak(BREATHING_NODE_LIMIT + 1)).toBeCloseTo(1.035);
    expect(peak(12)).toBeCloseTo(1.02);
    expect(peak(BREATHING_NODE_STILL - 1)).toBeCloseTo(1.005);
    expect(peak(BREATHING_NODE_STILL + 4)).toBe(1);
    for (let n = BREATHING_NODE_LIMIT; n < BREATHING_NODE_STILL; n++)
      expect(peak(n + 1)).toBeLessThan(peak(n));
  });

  it('pulses the waiting halo between 0.15 and 0.35 over 1.6s, fixed when reduced', () => {
    expect(waitingHaloAlpha(0, false)).toBeCloseTo(0.15);
    expect(waitingHaloAlpha(800, false)).toBeCloseTo(0.35);
    expect(waitingHaloAlpha(800, true)).toBe(0.3);
  });

  it('turns the running ring 0.15 turn per second', () => {
    expect((RUNNING_RING_RAD_PER_MS * 1000) / (Math.PI * 2)).toBeCloseTo(0.15);
  });
});
