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
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

describe('NotificationCenterStore', () => {
  const pulse = signal<TerminalTurnPulse | null>(null);
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

  beforeEach(() => {
    jest.useFakeTimers();
    pulse.set(null);
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
            terminalTurnPulse: pulse,
            findTabByIdAcrossWorkspaces: (id: string) =>
              id === tab.id ? { tab, workspacePath: '/workspace/a' } : null,
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
    pulse.set({
      seq,
      tabId: 'tab-1',
      sessionId: `session-${seq}`,
      workspacePath: '/workspace/a',
      revision: seq,
      phase: 'idle',
      terminalReason: 'completed',
      classification: 'success',
      title: `Run ${seq}`,
      occurredAt: seq * 100,
      ...overrides,
    });
    TestBed.flushEffects();
  }

  it('deduplicates session+revision and bounds completion history to 75', () => {
    for (let seq = 1; seq <= 80; seq += 1) emit(seq);
    expect(store.completionEntries()).toHaveLength(75);
    const latest = store.completionEntries().at(-1);
    const currentPulse = pulse();
    pulse.set(
      latest && currentPulse
        ? {
            ...currentPulse,
            seq: 81,
            sessionId: latest.sessionId,
            revision: latest.revision,
          }
        : null,
    );
    TestBed.flushEffects();
    expect(store.completionEntries()).toHaveLength(75);
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
});
