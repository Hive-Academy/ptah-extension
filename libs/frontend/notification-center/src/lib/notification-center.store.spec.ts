import { Component, NgModule, signal } from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({ selector: 'ptah-markdown-stub', standalone: true, template: '' })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
  };
});
import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { NOTIFICATION_FOCUS_ROUTER } from '@ptah-extension/core';
import type { PermissionRequest } from '@ptah-extension/shared';
import {
  deriveOutcomeLabel,
  NotificationCenterStore,
} from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

describe('NotificationCenterStore', () => {
  const pulses = signal<readonly TerminalTurnPulse[]>([]);
  const permissions = signal<PermissionRequest[]>([]);
  const questions = signal<never[]>([]);
  const routingRevision = signal(0);
  const targets = new Map<string, readonly string[]>();
  const focus = jest.fn();
  const playBurst = jest.fn();
  let store: NotificationCenterStore;

  const tab = {
    id: 'tab-1',
    title: 'Build release',
    name: 'Build release',
    claudeSessionId: 'session-1',
  };
  const secondTab = {
    id: 'tab-2',
    title: 'Second build',
    name: 'Second build',
    claudeSessionId: 'session-2',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    pulses.set([]);
    permissions.set([]);
    routingRevision.set(0);
    targets.clear();
    focus.mockReset().mockResolvedValue({ success: true, outcome: 'focused' });
    playBurst.mockReset();
    TestBed.configureTestingModule({
      providers: [
        NotificationCenterStore,
        {
          provide: TabManagerService,
          useValue: {
            terminalTurnPulses: pulses,
            takeTerminalTurnPulses: () => {
              const queued = pulses();
              pulses.set([]);
              return queued;
            },
            findTabByIdAcrossWorkspaces: (id: string) => {
              const found = [tab, secondTab].find(
                (candidate) => candidate.id === id,
              );
              return found
                ? { tab: found, workspacePath: '/workspace/a' }
                : null;
            },
            findTabBySessionIdAcrossWorkspaces: (id: string) =>
              id === tab.claudeSessionId
                ? { tab, workspacePath: '/workspace/a' }
                : null,
          },
        },
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: permissions,
            questionRequests: questions,
            routingTargetRevision: routingRevision,
            targetTabsFor: (id: string) => targets.get(id) ?? [],
            questionTargetTabsFor: () => [],
          },
        },
        { provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } },
        { provide: NotificationSoundService, useValue: { playBurst } },
      ],
    });
    store = TestBed.inject(NotificationCenterStore);
    TestBed.flushEffects();
  });

  afterEach(() => jest.useRealTimers());

  function emit(seq: number, overrides: Partial<TerminalTurnPulse> = {}): void {
    pulses.update((queued) => [
      ...queued,
      {
        seq,
        tabId: 'tab-1',
        sessionId: `session-${seq}`,
        workspacePath: '/workspace/a',
        revision: seq,
        phase: 'idle',
        terminalReason: 'completed',
        lastAssistantMessage: null,
        classification: 'success',
        title: `Run ${seq}`,
        occurredAt: seq * 100,
        ...overrides,
      },
    ]);
    TestBed.flushEffects();
  }

  it('deduplicates session+revision and bounds completion history to 75', () => {
    for (let seq = 1; seq <= 80; seq += 1) emit(seq);
    expect(store.completionEntries()).toHaveLength(75);
    const latest = store.completionEntries().at(-1);
    pulses.set(
      latest
        ? [
            {
              seq: 81,
              tabId: latest.tabId,
              sessionId: latest.sessionId,
              workspacePath: latest.workspacePath,
              revision: latest.revision,
              phase: latest.phase,
              terminalReason: latest.terminalReason,
              lastAssistantMessage: latest.lastAssistantMessage,
              classification: latest.classification,
              title: latest.title,
              occurredAt: latest.occurredAt,
            },
          ]
        : [],
    );
    TestBed.flushEffects();
    expect(store.completionEntries()).toHaveLength(75);
  });

  it('records two terminal turns emitted in one synchronous batch', () => {
    pulses.set([
      {
        seq: 1,
        tabId: 'tab-1',
        sessionId: 'session-1',
        workspacePath: '/workspace/a',
        revision: 1,
        phase: 'idle',
        terminalReason: 'completed',
        lastAssistantMessage: null,
        classification: 'success',
        title: 'Run 1',
        occurredAt: 100,
      },
      {
        seq: 2,
        tabId: 'tab-2',
        sessionId: 'session-2',
        workspacePath: '/workspace/a',
        revision: 1,
        phase: 'idle',
        terminalReason: 'completed',
        lastAssistantMessage: null,
        classification: 'success',
        title: 'Run 2',
        occurredAt: 101,
      },
    ]);

    TestBed.flushEffects();

    expect(store.completionEntries().map((entry) => entry.sessionId)).toEqual([
      'session-1',
      'session-2',
    ]);
  });

  it('groups a workspace burst without erasing individual targets', () => {
    emit(1, { occurredAt: 1000 });
    emit(2, { occurredAt: 1300 });
    expect(store.completionGroups()).toHaveLength(1);
    expect(store.completionGroups()[0]?.entries).toHaveLength(2);
    expect(
      store.completionGroups()[0]?.entries.map((entry) => entry.target),
    ).toHaveLength(2);
  });

  it('derives prompts from live state and removes them with the source', () => {
    const request: PermissionRequest = {
      id: 'permission-1',
      toolName: 'Bash',
      toolInput: {},
      timestamp: 1,
      description: 'Run tests',
      timeoutAt: 0,
      sessionId: 'mismatched-session',
    };
    permissions.set([request]);
    targets.set(request.id, ['tab-1']);
    routingRevision.update((value) => value + 1);
    expect(store.pendingEntries()[0]?.target?.tabId).toBe('tab-1');
    permissions.set([]);
    expect(store.pendingEntries()).toEqual([]);
  });

  it('counts one prompt source whether its target is unavailable or fanned out', () => {
    const request: PermissionRequest = {
      id: 'permission-count',
      toolName: 'Bash',
      toolInput: {},
      timestamp: 1,
      description: 'Run tests',
      timeoutAt: 0,
    };
    permissions.set([request]);
    expect(store.pendingEntries()[0]?.target).toBeNull();
    expect(store.unreadCount()).toBe(1);

    targets.set(request.id, ['tab-1', 'tab-2']);
    routingRevision.update((value) => value + 1);
    expect(store.pendingEntries()).toHaveLength(2);
    expect(store.unreadCount()).toBe(1);
  });

  it('does not count a dismissed completion as unread', () => {
    emit(1);
    const entry = store.completionEntries()[0];
    expect(store.unreadCount()).toBe(1);
    expect(entry).toBeDefined();
    if (!entry) return;

    store.dismissCompletion(entry.id);

    expect(store.unreadCount()).toBe(0);
  });

  it('counts the same completed turn only once', () => {
    emit(1);
    emit(2, { sessionId: 'session-1', revision: 1 });

    expect(store.completionEntries()).toHaveLength(1);
    expect(store.unreadCount()).toBe(1);
  });

  it('marks completions read only after successful focus and never hides prompts', async () => {
    emit(1);
    const entry = store.completionEntries()[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    focus.mockResolvedValueOnce({ success: false, outcome: 'missing' });
    await store.activateCompletion(entry);
    expect(store.completionEntries()[0]?.readAt).toBeNull();
    focus.mockResolvedValueOnce({ success: true, outcome: 'focused' });
    await store.activateCompletion(entry);
    expect(store.completionEntries()[0]?.readAt).not.toBeNull();
  });

  it('keeps twelve storm records and emits one burst side effect', () => {
    for (let seq = 1; seq <= 12; seq += 1) emit(seq);
    expect(store.completionEntries()).toHaveLength(12);
    jest.advanceTimersByTime(350);
    expect(store.announcement()).toBe('12 sessions finished');
    expect(playBurst).toHaveBeenCalledTimes(1);
  });

  it('carries the recap text onto the completion entry', () => {
    emit(1, { lastAssistantMessage: 'All tests pass.' });
    expect(store.completionEntries()[0]?.lastAssistantMessage).toBe(
      'All tests pass.',
    );
  });

  it('leaves the recap null when the turn state carried none', () => {
    emit(1, { lastAssistantMessage: null });
    expect(store.completionEntries()[0]?.lastAssistantMessage).toBeNull();
  });

  describe('deriveOutcomeLabel', () => {
    it.each([
      ['completed', 'Finished'],
      ['max_turns', 'Hit the turn limit'],
      ['budget_exhausted', 'Out of budget'],
      ['blocking_limit', 'Rate limited'],
      ['rapid_refill_breaker', 'Rate limited'],
      ['api_error', 'Provider error'],
      ['model_error', 'Provider error'],
      ['image_error', 'Provider error'],
      ['prompt_too_long', 'Prompt too long'],
      ['aborted_streaming', 'Stopped'],
      ['aborted_tools', 'Stopped'],
      ['stop_hook_prevented', 'Stopped by a hook'],
      ['hook_stopped', 'Stopped by a hook'],
      ['tool_deferred', 'Waiting on a tool'],
      ['tool_deferred_unavailable', 'Waiting on a tool'],
      ['background_requested', 'Moved to the background'],
      ['malformed_tool_use_exhausted', 'Gave up retrying'],
      ['structured_output_retry_exhausted', 'Gave up retrying'],
      ['turn_setup_failed', 'Could not start'],
      [null, 'Finished (unknown outcome)'],
    ] as const)('maps %s to %s', (reason, label) => {
      expect(deriveOutcomeLabel(reason, 'idle')).toBe(label);
    });

    // `terminal_reason` is optional on the result message, so a turn the
    // StopFailure hook already marked `failed` can settle with a null reason.
    // Captioning that red row "Finished" is the defect this task exists to fix.
    it('captions a failed phase with no reason as Failed, not Finished', () => {
      expect(deriveOutcomeLabel(null, 'failed')).toBe('Failed');
    });

    it('still prefers a known reason over the phase', () => {
      expect(deriveOutcomeLabel('api_error', 'failed')).toBe('Provider error');
    });
  });

  it('derives the outcome label on the completion entry from the pulse reason', () => {
    emit(1, { terminalReason: 'max_turns', classification: 'error' });
    expect(store.completionEntries()[0]?.outcomeLabel).toBe(
      'Hit the turn limit',
    );
  });
});
