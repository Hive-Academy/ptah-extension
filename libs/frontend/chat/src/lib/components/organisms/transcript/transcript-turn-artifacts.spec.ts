import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  createExecutionChatMessage,
  createExecutionNode,
  type ArtifactRecord,
  type ExecutionChatMessage,
  type ExecutionNode,
} from '@ptah-extension/shared';
import { ArtifactStore } from '../../../services/artifact.store';
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import {
  TranscriptTurnArtifacts,
  type TranscriptTurnArtifactsView,
} from './transcript-turn-artifacts';

function publishNode(id: string, artifactId: string, partial: Partial<ExecutionNode> = {}): ExecutionNode {
  return createExecutionNode({
    id,
    type: 'tool',
    status: 'complete',
    toolName: 'mcp__ptah__ptah_artifact_publish',
    toolOutput: JSON.stringify({ id: artifactId, title: `Title ${artifactId}`, revision: 1 }),
    ...partial,
  });
}

function assistant(id: string, root: ExecutionNode | null): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'assistant', streamingState: root });
}

function user(id: string): ExecutionChatMessage {
  return createExecutionChatMessage({ id, role: 'user', rawContent: 'hi' });
}

function viewOf(
  messages: readonly ExecutionChatMessage[],
  streamingBoundary = messages.length,
): TranscriptTurnArtifactsView {
  return {
    slots: messages.map((message) => ({ record: () => message })),
    streamingBoundary,
  };
}

describe('TranscriptTurnArtifacts', () => {
  const records = signal<readonly ArtifactRecord[]>([]);
  let adoptPublishResult: jest.Mock;

  beforeEach(() => {
    records.set([]);
    adoptPublishResult = jest.fn().mockResolvedValue(null);
    TestBed.configureTestingModule({
      providers: [
        DisplayDockState,
        {
          provide: ArtifactStore,
          useValue: {
            recordById: (id: string) => records().find((record) => record.id === id) ?? null,
            adoptPublishResult,
          },
        },
        // The global active tab is another tab: Open must not use it.
        { provide: TabManagerService, useValue: { activeTabId: signal('other-tab') } },
      ],
    });
  });

  function create(
    view: WritableSignal<TranscriptTurnArtifactsView>,
    tabId = 'tile-tab',
  ): TranscriptTurnArtifacts {
    return TestBed.runInInjectionContext(
      () => new TranscriptTurnArtifacts({ tabId: signal(tabId), view }),
    );
  }

  it('anchors each finalized turn\'s publishes, depth-first, at its last assistant message', () => {
    const nested = createExecutionNode({
      id: 'agent',
      type: 'agent',
      status: 'complete',
      children: [publishNode('n2', 'artifact_b')],
    });
    const root = createExecutionNode({
      id: 'root',
      type: 'message',
      status: 'complete',
      children: [publishNode('n1', 'artifact_a'), nested, publishNode('n3', 'artifact_c')],
    });
    const view = signal(
      viewOf([user('u1'), assistant('a1', root), assistant('a2', null), user('u2'), assistant('a3', null)]),
    );
    const artifacts = create(view);

    const anchors = artifacts.byEndMessage();
    expect([...anchors.keys()]).toEqual(['a2']);
    expect(anchors.get('a2')?.map((entry) => entry.id)).toEqual([
      'artifact_a',
      'artifact_b',
      'artifact_c',
    ]);
  });

  it('skips a turn still streaming, errors and other tools', () => {
    const root = createExecutionNode({
      id: 'root',
      type: 'message',
      status: 'complete',
      children: [
        publishNode('n1', 'artifact_err', { isError: true }),
        publishNode('n2', 'artifact_run', { status: 'streaming' }),
        createExecutionNode({ id: 'n3', type: 'tool', status: 'complete', toolName: 'Bash', toolOutput: '{"id":"x"}' }),
      ],
    });
    const streaming = signal(viewOf([user('u1'), assistant('a1', publishNode('p', 'artifact_live'))], 1));
    expect(create(streaming).byEndMessage().size).toBe(0);

    const settled = signal(viewOf([user('u1'), assistant('a1', root)]));
    expect(create(settled).byEndMessage().size).toBe(0);
  });

  it('adopts each published result once', () => {
    const message = assistant('a1', publishNode('n1', 'artifact_a'));
    const view = signal(viewOf([user('u1'), message]));
    create(view);
    TestBed.tick();
    expect(adoptPublishResult).toHaveBeenCalledTimes(1);
    expect(adoptPublishResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'artifact_a', revision: 1 }),
    );

    view.set(viewOf([user('u1'), message, user('u2'), assistant('a2', publishNode('n2', 'artifact_b'))]));
    TestBed.tick();
    expect(adoptPublishResult).toHaveBeenCalledTimes(2);
    expect(adoptPublishResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'artifact_b' }),
    );
  });

  it('regression (bug A): Open from a tile writes to the tile tab, not the active tab', () => {
    const dock = TestBed.inject(DisplayDockState);
    const artifacts = create(signal(viewOf([])), 'tile-tab');
    const otherBefore = dock.tab('other-tab');

    artifacts.open('artifact_a');

    expect(dock.tab('tile-tab')).toMatchObject({
      open: true,
      activeTab: 'displays',
      selection: { kind: 'artifact', artifactId: 'artifact_a' },
    });
    expect(dock.tab('other-tab')).toBe(otherBefore);
    expect(artifacts.openable).toBe(true);
  });

  it('Full screen opens the artifact and requests the full-screen viewer for its own tab', () => {
    const dock = TestBed.inject(DisplayDockState);
    const artifacts = create(signal(viewOf([])), 'tile-tab');

    artifacts.fullscreen('artifact_a');

    expect(dock.tab('tile-tab').selection).toEqual({ kind: 'artifact', artifactId: 'artifact_a' });
    expect(dock.fullscreenArtifact('tile-tab')).toBe('artifact_a');
    expect(dock.fullscreenArtifact('other-tab')).toBeNull();
  });

  it('is read-only without a dock', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ArtifactStore, useValue: { recordById: () => null, adoptPublishResult } }],
    });
    const artifacts = create(signal(viewOf([])));
    expect(artifacts.openable).toBe(false);
    expect(() => artifacts.open('artifact_a')).not.toThrow();
    expect(() => artifacts.fullscreen('artifact_a')).not.toThrow();
  });
});
