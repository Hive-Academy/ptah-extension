import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import { CompactSessionCardComponent } from './compact-session-card.component';

function tab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    status: 'loaded',
    claudeSessionId: 'session-1',
    messages: [],
    streamingState: null,
    preloadedStats: null,
    liveModelStats: null,
    ...overrides,
  } as unknown as TabState;
}

function permission(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'permission-1',
    toolName: 'Bash',
    toolInput: {},
    timestamp: 1,
    description: 'Run the verification command?',
    timeoutAt: 0,
    sessionId: 'session-1',
    ...overrides,
  };
}

function question(
  overrides: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest {
  return {
    id: 'question-1',
    toolName: 'AskUserQuestion',
    questions: [
      {
        question: 'Choose a deployment target',
        header: 'Target',
        options: [],
        multiSelect: false,
      },
    ],
    timestamp: 1,
    timeoutAt: 0,
    sessionId: 'session-1',
    ...overrides,
  };
}

describe(CompactSessionCardComponent.name, () => {
  const permissions = signal<readonly PermissionRequest[]>([]);
  const questions = signal<readonly AskUserQuestionRequest[]>([]);
  const routingRevision = signal(0);
  const permissionTargets = new Map<string, readonly string[]>();
  const questionTargets = new Map<string, readonly string[]>();
  const tabs = new Map<string, { tab: TabState; workspacePath: string }>();
  const sessions = new Map<string, { tab: TabState; workspacePath: string }>();
  const compaction = signal({
    inFlight: false,
    lastCompactionAt: null,
    trigger: null,
    preTokens: null,
    startedAt: null,
  });
  const marker = signal<{
    summary: string | null;
    preTokens: number | null;
    postTokens: number | null;
    durationMs: number | null;
    completedAt: number;
  } | null>(null);

  const permissionHandler = {
    permissionRequests: permissions.asReadonly(),
    questionRequests: questions.asReadonly(),
    routingTargetRevision: routingRevision.asReadonly(),
    targetTabsFor: (id: string) => permissionTargets.get(id) ?? [],
    questionTargetTabsFor: (id: string) => questionTargets.get(id) ?? [],
  };
  const tabManager = {
    findTabByIdAcrossWorkspaces: (id: string) => tabs.get(id) ?? null,
    findTabBySessionIdAcrossWorkspaces: (id: string) =>
      sessions.get(id) ?? null,
  };
  const sessionBinding = { conversationFor: () => 'conversation-1' };
  const conversations = {
    compactionStateFor: () => compaction(),
    compactionMarkerFor: () => marker(),
  };

  beforeEach(() => {
    permissions.set([]);
    questions.set([]);
    routingRevision.set(0);
    permissionTargets.clear();
    questionTargets.clear();
    tabs.clear();
    sessions.clear();
    compaction.set({
      inFlight: false,
      lastCompactionAt: null,
      trigger: null,
      preTokens: null,
      startedAt: null,
    });
    marker.set(null);
    TestBed.configureTestingModule({
      imports: [CompactSessionCardComponent],
      providers: [
        { provide: PermissionHandlerService, useValue: permissionHandler },
        { provide: TabManagerService, useValue: tabManager },
        { provide: TabSessionBinding, useValue: sessionBinding },
        { provide: ConversationRegistry, useValue: conversations },
      ],
    });
  });

  function render(value = tab()) {
    tabs.set(value.id, { tab: value, workspacePath: 'C:\\work\\ptah' });
    if (value.claudeSessionId) {
      sessions.set(value.claudeSessionId, {
        tab: value,
        workspacePath: 'C:\\work\\ptah',
      });
    }
    const fixture = TestBed.createComponent(CompactSessionCardComponent);
    fixture.componentRef.setInput('tab', value);
    fixture.detectChanges();
    return fixture;
  }

  it('uses router metadata before a mismatched session id', () => {
    const value = tab();
    const request = permission({ sessionId: 'different-session' });
    permissions.set([request]);
    permissionTargets.set(request.id, [value.id]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain('Needs input');
    expect(fixture.nativeElement.textContent).toContain(
      'Run the verification command?',
    );
  });

  it('falls back to session id only when no target metadata exists', () => {
    const value = tab();
    permissions.set([permission()]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain('Needs input');
  });

  it('omits attached surface-only or stale targets instead of leaking by session id', () => {
    const request = permission();
    permissions.set([request]);
    permissionTargets.set(request.id, ['surface:harness']);

    const fixture = render();

    expect(fixture.nativeElement.textContent).not.toContain('Needs input');
    expect(fixture.nativeElement.textContent).not.toContain(
      request.description,
    );
  });

  it('shows the oldest question and count before permissions', () => {
    const value = tab();
    const older = question({ id: 'older', timestamp: 1 });
    const newer = question({
      id: 'newer',
      timestamp: 2,
      questions: [
        { question: 'Newer', header: 'New', options: [], multiSelect: false },
      ],
    });
    questions.set([newer, older]);
    permissions.set([permission({ timestamp: 0 })]);
    questionTargets.set(older.id, [value.id]);
    questionTargets.set(newer.id, [value.id]);
    permissionTargets.set('permission-1', [value.id]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain(
      'Choose a deployment target',
    );
    expect(fixture.nativeElement.textContent).toContain('+2 more');
  });

  it('renders a newly routed blocking prompt within one animation frame', async () => {
    const value = tab();
    const fixture = render(value);
    const request = permission({ sessionId: 'mismatched' });

    permissions.set([request]);
    permissionTargets.set(request.id, [value.id]);
    routingRevision.update((revision) => revision + 1);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(request.description);
    expect(
      fixture.nativeElement.querySelector('button')?.textContent,
    ).toContain('Open full view');
  });

  it('projects conversation-scoped compaction and marker data', () => {
    compaction.update((value) => ({
      ...value,
      inFlight: true,
      preTokens: 200,
    }));
    marker.set({
      summary: 'Retained the implementation decisions',
      preTokens: 200,
      postTokens: 80,
      durationMs: 15,
      completedAt: 10,
    });

    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('Compacting');
  });

  it('uses stable session identity color and owning workspace label', () => {
    const first = render(tab());
    const firstDot = first.nativeElement.querySelector(
      '[data-zone="status"] span',
    );
    const firstColor = firstDot.getAttribute('style');
    expect(first.nativeElement.textContent).toContain('ptah');

    const second = render(tab());
    expect(
      second.nativeElement
        .querySelector('[data-zone="status"] span')
        .getAttribute('style'),
    ).toBe(firstColor);
  });

  it('emits expand and keeps the fixed-height summary-only contract', () => {
    const request = question();
    questions.set([request]);
    questionTargets.set(request.id, ['tab-1']);
    const fixture = render();
    const emitted = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(emitted);

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.innerHTML).toContain('h-full');
    expect(fixture.nativeElement.innerHTML).toContain('overflow-hidden');
    expect(fixture.nativeElement.innerHTML).not.toContain('overflow-auto');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Collapse');
    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-header'),
    ).toBeNull();
  });
});
