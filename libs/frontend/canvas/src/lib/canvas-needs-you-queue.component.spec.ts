import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  PermissionRequest,
  AskUserQuestionRequest,
} from '@ptah-extension/shared';
import {
  PermissionHandlerService,
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import {
  AgentPermissionResponder,
  TabManagerService,
} from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasNeedsYouQueueComponent } from './canvas-needs-you-queue.component';

describe('CanvasNeedsYouQueueComponent', () => {
  const permissions = signal<PermissionRequest[]>([]);
  const questions = signal<AskUserQuestionRequest[]>([]);
  const revision = signal(0);
  const agents = signal<MonitoredAgent[]>([]);
  const tiles = signal([{ tabId: 'a' }, { tabId: 'b' }]);
  const tabs = signal([
    { id: 'a', claudeSessionId: 's1', title: 'Alpha' },
    { id: 'b', claudeSessionId: 's2', title: 'Beta' },
  ]);
  const respondSession = jest.fn();
  const respondLane = jest.fn();
  const focusTile = jest.fn();
  const request = (id: string, tabId: string): PermissionRequest => ({
    id,
    tabId,
    toolName: 'Write',
    toolInput: {},
    description: 'Edit',
    timestamp: 1,
    timeoutAt: 0,
  });

  beforeEach(() => {
    permissions.set([]);
    questions.set([]);
    revision.set(0);
    agents.set([]);
    respondSession.mockClear();
    respondLane.mockClear();
    focusTile.mockClear();
    TestBed.configureTestingModule({
      imports: [CanvasNeedsYouQueueComponent],
      providers: [
        {
          provide: PermissionHandlerService,
          useValue: {
            permissionRequests: permissions,
            questionRequests: questions,
            routingTargetRevision: revision,
            targetTabsFor: () => [],
            questionTargetTabsFor: () => [],
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: { pendingPermissions: agents },
        },
        {
          provide: AgentPermissionResponder,
          useValue: { respondSession, respondLane },
        },
        { provide: CanvasStore, useValue: { tiles, focusTile } },
        { provide: TabManagerService, useValue: { tabs } },
      ],
    });
  });

  it('answers one of two sessions while keeping the other card', () => {
    permissions.set([request('one', 'a'), request('two', 'b')]);
    const fixture = TestBed.createComponent(CanvasNeedsYouQueueComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 need you');
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const allow = fixture.nativeElement.querySelectorAll(
      'button.btn-success',
    ) as NodeListOf<HTMLButtonElement>;
    allow[0].click();
    expect(respondSession).toHaveBeenCalledWith(permissions()[0], 'allow', 'a');
    permissions.set([permissions()[1]]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Beta');
    expect(fixture.nativeElement.textContent).not.toContain('Alpha');
    expect(fixture.nativeElement.textContent).toContain('1 need you');
  });

  it('removes a request answered elsewhere and opens a question session', () => {
    permissions.set([request('one', 'a')]);
    questions.set([
      {
        id: 'q',
        toolName: 'AskUserQuestion',
        questions: [],
        tabId: 'b',
        timestamp: 2,
        timeoutAt: 0,
      },
    ]);
    const fixture = TestBed.createComponent(CanvasNeedsYouQueueComponent);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    permissions.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(1);
    expect(
      fixture.nativeElement.querySelectorAll('button.btn-success').length,
    ).toBe(0);
    (
      fixture.nativeElement.querySelector('li button') as HTMLButtonElement
    ).click();
    expect(focusTile).toHaveBeenCalledWith('b');
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('shows All clear when no requests remain', () => {
    const fixture = TestBed.createComponent(CanvasNeedsYouQueueComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('All clear');
  });

  it('denies a lane using its request id and clears its answered state when removed', () => {
    agents.set([
      {
        agentId: 'agent',
        parentSessionId: 's2',
        displayName: 'Codex',
        permissionQueue: [
          {
            requestId: 'lane-request',
            toolName: 'bash',
            description: 'Run',
            timestamp: 1,
          },
        ],
      } as MonitoredAgent,
    ]);
    const fixture = TestBed.createComponent(CanvasNeedsYouQueueComponent);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        'button.btn-error',
      ) as HTMLButtonElement
    ).click();
    expect(respondLane).toHaveBeenCalledWith(
      'agent',
      'lane-request',
      'deny',
      'User denied',
    );
    expect(
      fixture.componentInstance.answering().has('lane:agent:lane-request'),
    ).toBe(true);
    agents.set([]);
    fixture.detectChanges();
    expect(fixture.componentInstance.answering().size).toBe(0);
  });
});
