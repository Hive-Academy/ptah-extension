/**
 * Specs for buildOrchestrationNamespace.
 *
 * The orchestration namespace persists workflow state to
 *   <workspaceRoot>/task-tracking/<taskId>/.orchestration-state.json
 * and drives a small state machine that decides the next action.
 *
 * We use a real tmp workspace for each test (with `fs.mkdtemp`) so that the
 * real fs IO is exercised end-to-end. This matches the design of the SUT,
 * which uses the fs module directly and does not accept an injected adapter.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildOrchestrationNamespace,
  type OrchestrationNamespaceDependencies,
} from './orchestration-namespace.builder';
import type { OrchestrationState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-spec-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeDeps(): OrchestrationNamespaceDependencies {
  return { workspaceRoot: tmpRoot };
}

async function writeState(
  taskId: string,
  state: OrchestrationState,
): Promise<void> {
  const dir = path.join(tmpRoot, 'task-tracking', taskId);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, '.orchestration-state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildOrchestrationNamespace — shape', () => {
  it('exposes getState / setState / getNextAction', () => {
    const ns = buildOrchestrationNamespace(makeDeps());
    expect(typeof ns.getState).toBe('function');
    expect(typeof ns.setState).toBe('function');
    expect(typeof ns.getNextAction).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// getState / setState
// ---------------------------------------------------------------------------

describe('buildOrchestrationNamespace — state persistence', () => {
  it('getState returns null when no state file exists', async () => {
    const ns = buildOrchestrationNamespace(makeDeps());
    await expect(ns.getState('TASK_2099_001')).resolves.toBeNull();
  });

  it('setState creates the task folder and writes state to .orchestration-state.json', async () => {
    const ns = buildOrchestrationNamespace(makeDeps());
    await ns.setState('TASK_2099_002', {
      phase: 'design',
      strategy: 'FEATURE',
      metadata: { key: 'value' },
    });

    const disk = await ns.getState('TASK_2099_002');
    expect(disk?.phase).toBe('design');
    expect(disk?.strategy).toBe('FEATURE');
    expect(disk?.metadata).toEqual({ key: 'value' });
    expect(disk?.taskId).toBe('TASK_2099_002');
  });

  it('setState merges with existing state instead of replacing it', async () => {
    const ns = buildOrchestrationNamespace(makeDeps());
    await ns.setState('TASK_A', {
      phase: 'planning',
      strategy: 'FEATURE',
      metadata: { a: 1 },
    });
    await ns.setState('TASK_A', { metadata: { b: 2 } });

    const final = await ns.getState('TASK_A');
    expect(final?.metadata).toEqual({ a: 1, b: 2 });
    expect(final?.strategy).toBe('FEATURE'); // untouched
  });
});

// ---------------------------------------------------------------------------
// getNextAction — state machine
// ---------------------------------------------------------------------------

describe('buildOrchestrationNamespace — getNextAction', () => {
  it('recommends project-manager when state does not exist', async () => {
    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction('TASK_NEW');
    expect(action.action).toBe('invoke-agent');
    expect(action.agent).toBe('project-manager');
    expect(action.context).toEqual(
      expect.objectContaining({ isNewTask: true }),
    );
  });

  it('returns complete when phase is already complete', async () => {
    await writeState('TASK_DONE', {
      taskId: 'TASK_DONE',
      phase: 'complete',
      currentAgent: null,
      lastCheckpoint: { type: null, status: 'pending', timestamp: '' },
      pendingActions: [],
      strategy: 'FEATURE',
      metadata: {},
    });

    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction('TASK_DONE');
    expect(action.action).toBe('complete');
  });

  it('requests a checkpoint when current phase requires one but it is missing', async () => {
    await writeState('TASK_CP', {
      taskId: 'TASK_CP',
      phase: 'planning',
      currentAgent: null,
      lastCheckpoint: { type: null, status: 'pending', timestamp: '' },
      pendingActions: [],
      strategy: 'FEATURE',
      metadata: {},
    });

    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction('TASK_CP');
    expect(action.action).toBe('present-checkpoint');
    expect(action.checkpointType).toBe('requirements');
  });

  it('re-invokes the current phase agent when last checkpoint is rejected', async () => {
    await writeState('TASK_REJ', {
      taskId: 'TASK_REJ',
      phase: 'design',
      currentAgent: null,
      lastCheckpoint: {
        type: 'architecture',
        status: 'rejected',
        timestamp: '',
      },
      pendingActions: [],
      strategy: 'FEATURE',
      metadata: {},
    });

    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction('TASK_REJ');
    expect(action.action).toBe('invoke-agent');
    expect(action.agent).toBe('software-architect');
  });

  it('advances to the next phase when checkpoint approved and required docs exist', async () => {
    const taskId = 'TASK_ADV';
    await writeState(taskId, {
      taskId,
      phase: 'planning',
      currentAgent: null,
      lastCheckpoint: {
        type: 'requirements',
        status: 'approved',
        timestamp: '',
      },
      pendingActions: [],
      strategy: 'FEATURE',
      metadata: {},
    });
    // Satisfy planning phase requirement
    await fs.promises.writeFile(
      path.join(tmpRoot, 'task-tracking', taskId, 'task-description.md'),
      '# Desc',
      'utf8',
    );

    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction(taskId);
    expect(action.action).toBe('invoke-agent');
    expect(action.agent).toBe('software-architect');
    expect(action.context?.['nextPhase']).toBe('design');
  });

  it('re-invokes current-phase agent when required docs are missing', async () => {
    await writeState('TASK_MISS', {
      taskId: 'TASK_MISS',
      phase: 'planning',
      currentAgent: null,
      lastCheckpoint: {
        type: 'requirements',
        status: 'approved',
        timestamp: '',
      },
      pendingActions: [],
      strategy: 'FEATURE',
      metadata: {},
    });

    const ns = buildOrchestrationNamespace(makeDeps());
    const action = await ns.getNextAction('TASK_MISS');
    expect(action.action).toBe('invoke-agent');
    expect(action.agent).toBe('project-manager');
    expect(action.requiredInputs).toEqual(['task-context']);
  });
});
