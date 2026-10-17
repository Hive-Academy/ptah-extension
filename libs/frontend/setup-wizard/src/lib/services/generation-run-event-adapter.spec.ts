import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import { GenerationRunEventAdapter } from './generation-run-event-adapter';
import { GenerationWorkflowStore } from './generation-workflow.store';

const binding = {
  tabId: 'tab',
  workspacePath: '/ws',
  workflow: 'setup-agent-generation' as const,
  runId: 'generator-run',
};
const activeRun = {
  binding,
  status: 'running',
  source: { kind: 'verified-analysis', analysisDir: '/private/analysis' },
};

describe('GenerationRunEventAdapter', () => {
  const setup = () => {
    const run = signal(activeRun);
    const busy = signal(true);
    const tab = {
      claudeSessionId: 'real-chat-session',
      lastTurnStateRevision: 42,
      queuedContent: null,
      status: 'streaming',
    };
    const processStreamEvent = jest.fn(
      (event: { eventType: string; phase?: string; revision?: number }) => {
        if (event.eventType === 'turn_state' && event.revision !== undefined) {
          // Match the tab applier: same-floor ordered terminal heals, while a
          // subsequent normal turn needs a strictly newer generating revision.
          if (
            event.phase === 'idle' &&
            event.revision >= tab.lastTurnStateRevision
          ) {
            busy.set(false);
            tab.status = 'loaded';
            tab.lastTurnStateRevision = event.revision;
          } else if (
            event.phase === 'generating' &&
            event.revision > tab.lastTurnStateRevision
          ) {
            busy.set(true);
            tab.status = 'streaming';
            tab.lastTurnStateRevision = event.revision;
          }
        }
        return null;
      },
    );
    const refresh = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        GenerationRunEventAdapter,
        {
          provide: GenerationWorkflowStore,
          useValue: {
            binding: () => binding,
            run,
            isBound: () => busy(),
            refresh,
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({ tab, workspacePath: '/ws' }),
          },
        },
        { provide: StreamingHandlerService, useValue: { processStreamEvent } },
      ],
    });
    const adapter = TestBed.inject(GenerationRunEventAdapter);
    TestBed.flushEffects();
    return { adapter, run, busy, tab, processStreamEvent, refresh };
  };

  it('routes sanitized text and tool labels to the exact tab with no nested or flat generator IDs', () => {
    const { adapter, processStreamEvent } = setup();
    const payload = {
      tabBinding: binding,
      kind: 'tool_start',
      content: '<b>/private/analysis</b>',
      toolName: '<img>Read</img>',
      sessionId: 'generator-sdk-session',
      runId: 'generator-run',
      flatEvent: { sessionId: 'nested-sdk-session', runId: 'generator-run' },
    };
    expect(adapter.accept(payload)).toBe(true);
    expect(processStreamEvent).toHaveBeenCalledTimes(2);
    for (const [event, tabId, sessionId, options] of processStreamEvent.mock
      .calls) {
      expect(tabId).toBe('tab');
      expect(sessionId).toBeUndefined();
      expect(options).toEqual({ fanOut: false });
      expect(JSON.stringify(event)).not.toMatch(
        /generator-run|generator-sdk-session|nested-sdk-session|private\/analysis/,
      );
    }
    expect(processStreamEvent.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        eventType: 'tool_start',
        toolName: 'Read',
      }),
    );
    expect(
      adapter.accept({
        ...payload,
        kind: 'text',
        content: '<i>/private/analysis</i>',
      }),
    ).toBe(true);
    expect(processStreamEvent.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        eventType: 'text_delta',
        delta: '[analysis source]',
      }),
    );
  });

  it('ignores wrong tab, workspace, workflow and run, then ignores a late event after terminal', () => {
    const { adapter, run, busy, processStreamEvent } = setup();
    for (const change of [
      { tabId: 'other' },
      { workspacePath: '/other' },
      { workflow: 'setup-project-prompt' },
      { runId: 'other' },
    ]) {
      expect(
        adapter.accept({
          tabBinding: { ...binding, ...change },
          kind: 'text',
          content: 'bad',
        }),
      ).toBe(false);
    }
    expect(processStreamEvent).not.toHaveBeenCalled();
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'safe' }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'completed' });
    TestBed.flushEffects();
    expect(busy()).toBe(false);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'late' }),
    ).toBe(false);
  });

  it('uses a same-floor terminal heal and admits the next ordinary chat turn', () => {
    const { adapter, run, tab, busy, processStreamEvent } = setup();
    expect(
      adapter.accept({
        tabBinding: binding,
        kind: 'text',
        content: 'generator output',
      }),
    ).toBe(true);
    run.set({ ...activeRun, status: 'cancelled' });
    TestBed.flushEffects();
    expect(busy()).toBe(false);
    const terminal = processStreamEvent.mock.calls.at(-1)?.[0];
    expect(terminal).toEqual(
      expect.objectContaining({
        eventType: 'turn_state',
        sessionId: 'real-chat-session',
        revision: 42,
        phase: 'idle',
      }),
    );
    expect(tab.lastTurnStateRevision).toBe(42);
    processStreamEvent({
      eventType: 'turn_state',
      phase: 'generating',
      revision: 43,
    });
    expect(busy()).toBe(true);
    expect(tab.status).toBe('streaming');
    processStreamEvent({
      eventType: 'turn_state',
      phase: 'idle',
      revision: 44,
    });
    expect(busy()).toBe(false);
    expect(tab.status).toBe('loaded');
    expect(tab.lastTurnStateRevision).toBe(44);
    expect(tab.queuedContent).toBeNull();
  });

  it('rereads a matching completion and closes a run found terminal by lookup', () => {
    const { adapter, run, refresh, processStreamEvent } = setup();
    adapter.handleMessage({
      type: 'setup-wizard:generation-complete',
      payload: { tabBinding: binding },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      adapter.accept({ tabBinding: binding, kind: 'text', content: 'late' }),
    ).toBe(false);
    run.set({ ...activeRun, status: 'failed' });
    TestBed.flushEffects();
    expect(processStreamEvent.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        eventType: 'turn_state',
        phase: 'idle',
      }),
    );
  });
});
