import { derivePhase } from './tribunal-phase-derivation';
import type { VendorLane } from '../types/tribunal-ui.types';

const lanes: readonly VendorLane[] = [
  {
    laneId: 'codex#0',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    role: 'plan',
  },
];
const laneBindings = { lanes, bound: new Map() };

describe('derivePhase', () => {
  it('reports missing artifacts with a reason', () => {
    expect(
      derivePhase({
        move: 'relay',
        specTaskId: 'TASK_1',
        laneBindings,
        agents: [],
        artifacts: null,
      }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'Phase unavailable: artifacts for TASK_1 could not be read.',
    });
  });

  it('shows tagged work without a registered lane as provisional', () => {
    const progress = derivePhase({
      move: 'relay',
      specTaskId: 'TASK_1',
      laneBindings: { lanes: [], bound: new Map() },
      agents: [{ task: '[tribunal:codex#9] (plan) work', status: 'running' }],
      artifacts: { names: new Set() },
    });
    expect(progress.kind).toBe('relay');
    if (progress.kind !== 'relay') return;
    expect(progress.phases[0].laneId).toBe('codex#9');
    expect(progress.runningIndex).toBe(0);
  });

  it('derives the four relay phases from artifact names', () => {
    const progress = derivePhase({
      move: 'relay',
      specTaskId: 'TASK_1',
      laneBindings,
      agents: [],
      artifacts: { names: new Set(['task-description.md']) },
    });
    expect(progress.kind).toBe('relay');
    if (progress.kind !== 'relay') return;
    expect(progress.phases).toHaveLength(4);
    expect(progress.phases[0].status).toBe('complete');
    expect(progress.phases[1].status).toBe('pending');
    expect(progress.runningIndex).toBeNull();
  });
});
