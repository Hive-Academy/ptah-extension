import { TestBed } from '@angular/core/testing';
import {
  CommandCenterStore,
  type CommandWorkEdge,
  type CommandWorkNode,
} from './command-center.store';

describe('CommandCenterStore', () => {
  let store: CommandCenterStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CommandCenterStore] });
    store = TestBed.inject(CommandCenterStore);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tracks session, voice, input and display state through explicit updates', () => {
    expect(store.sessionStatus()).toBe('idle');
    expect(store.voiceState()).toBe('idle');
    store.setSession('tab-a', 'sdk-a', '/workspace');
    store.setSessionStatus('running');
    store.setVoiceState('listening');
    store.setPendingInput({
      id: 'q',
      kind: 'question',
      title: 'Choose',
      description: 'Pick one',
    });
    store.setProvider({ transcription: true, synthesis: false });
    store.setToast({ message: 'Ready', tone: 'info' });
    store.setTheme('light');
    store.setReducedMotion(true);
    store.setMuted(true);

    expect(store.markedTabId()).toBe('tab-a');
    expect(store.sessionId()).toBe('sdk-a');
    expect(store.workspace()).toBe('/workspace');
    expect(store.sessionStatus()).toBe('running');
    expect(store.voiceState()).toBe('listening');
    expect(store.pendingInput()?.id).toBe('q');
    expect(store.provider()).toEqual({ transcription: true, synthesis: false });
    expect(store.toast()?.message).toBe('Ready');
    expect(store.theme()).toBe('light');
    expect(store.reducedMotion()).toBe(true);
    expect(store.muted()).toBe(true);

    store.setVoiceState('muted');
    store.setSessionStatus('stopped');
    store.setPendingInput(null);
    expect(store.voiceState()).toBe('muted');
    expect(store.sessionStatus()).toBe('stopped');
    expect(store.pendingInput()).toBeNull();
  });

  it('copies projection snapshots and excludes unrelated work', () => {
    const nodes: CommandWorkNode[] = [
      {
        id: 'child',
        parentId: 'root',
        label: 'Child',
        providerId: 'claude',
        state: 'queued',
      },
      {
        id: 'other',
        parentId: null,
        label: 'Other',
        providerId: null,
        state: 'running',
      },
      {
        id: 'root',
        parentId: null,
        label: 'Root',
        providerId: null,
        state: 'running',
      },
      {
        id: 'grandchild',
        parentId: 'child',
        label: 'Grandchild',
        providerId: 'codex',
        state: 'awaiting input',
      },
    ];
    const edges: CommandWorkEdge[] = [
      { fromId: 'root', toId: 'child' },
      { fromId: 'other', toId: 'child' },
    ];
    store.setProjection('root', nodes, edges);
    const firstNodes = store.nodes();
    const firstEdges = store.edges();
    expect(firstNodes.map((node) => node.id)).toEqual([
      'child',
      'root',
      'grandchild',
    ]);
    expect(firstEdges).toEqual([{ fromId: 'root', toId: 'child' }]);
    expect(firstNodes[0]).not.toBe(nodes[0]);
    expect(firstEdges[0]).not.toBe(edges[0]);

    store.select('child');
    expect(store.selectedId()).toBe('child');
    store.setProjection('root', [{ ...nodes[2], state: 'completed' }], []);
    expect(store.selectedId()).toBeNull();
    expect(store.nodes()).toEqual([{ ...nodes[2], state: 'completed' }]);
    expect(firstNodes[0].state).toBe('queued');
    expect(firstEdges).toEqual([{ fromId: 'root', toId: 'child' }]);
  });

  it('copies object inputs so later updates leave earlier snapshots intact', () => {
    const input = {
      id: 'a',
      kind: 'approval' as const,
      title: 'Approve',
      description: 'Action',
    };
    const provider = { transcription: true, synthesis: true };
    store.setPendingInput(input);
    store.setProvider(provider);
    const oldInput = store.pendingInput();
    const oldProvider = store.provider();
    input.title = 'Changed';
    provider.synthesis = false;
    store.setPendingInput({ ...input, id: 'b' });
    store.setProvider(provider);
    expect(oldInput).toEqual({
      id: 'a',
      kind: 'approval',
      title: 'Approve',
      description: 'Action',
    });
    expect(oldProvider).toEqual({ transcription: true, synthesis: true });
  });

  it('samples meter levels at most twice per second and clamps invalid values', () => {
    jest.useFakeTimers().setSystemTime(0);
    store.updateLevels(0.2, 0.3);
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0.2, 0.3]);
    jest.advanceTimersByTime(499);
    store.updateLevels(0.9, 0.9);
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0.2, 0.3]);
    jest.advanceTimersByTime(1);
    store.updateLevels(2, Number.NaN);
    expect([store.inputLevel(), store.outputLevel()]).toEqual([1, 0]);
    store.setMuted(true);
    expect(store.inputLevel()).toBe(0);
    jest.advanceTimersByTime(500);
    store.updateLevels(0.8, -1);
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0, 0]);
  });

  it('resets both meters immediately and accepts the next sample without waiting', () => {
    jest.useFakeTimers().setSystemTime(0);
    store.updateLevels(0.8, 0.8);
    store.resetLevels();
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0, 0]);
    store.updateLevels(0.4, 0.6);
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0.4, 0.6]);
  });
});
