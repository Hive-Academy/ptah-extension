import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SessionGitStatsStore, TabManagerService } from '@ptah-extension/chat';
import type { CompactGitState } from '@ptah-extension/chat-ui';
import { VSCodeService } from '@ptah-extension/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { CanvasSessionDetailsComponent } from './canvas-session-details.component';

describe('CanvasSessionDetailsComponent', () => {
  const tabs = signal<{ id: string; [key: string]: unknown }[]>([]);
  const gitState = signal<CompactGitState>({ kind: 'none' });
  const release = jest.fn();
  const track = jest.fn(() => release);
  const stateFor = jest.fn((_root: string | null) => gitState());
  const findTabByIdAcrossWorkspaces = jest.fn((_tabId: string) => ({
    workspacePath: '/partition',
  }));

  function row(
    fixture: ReturnType<
      typeof TestBed.createComponent<CanvasSessionDetailsComponent>
    >,
    label: string,
  ): HTMLElement {
    const terms = Array.from(
      fixture.nativeElement.querySelectorAll('dt'),
    ) as HTMLElement[];
    const term = terms.find((item) => item.textContent?.trim() === label);
    if (!term?.nextElementSibling) throw new Error(`Missing ${label} row`);
    return term.nextElementSibling as HTMLElement;
  }

  function todoMessage(input: Record<string, unknown>): ExecutionChatMessage {
    return {
      id: 'message',
      role: 'assistant',
      timestamp: 0,
      streamingState: {
        id: 'root',
        type: 'message',
        status: 'complete',
        content: null,
        isCollapsed: false,
        children: [
          {
            id: 'todo',
            type: 'tool',
            status: 'complete',
            content: null,
            isCollapsed: false,
            children: [],
            toolName: 'TodoWrite',
            toolInput: input,
          },
        ],
      },
    };
  }

  beforeEach(() => {
    tabs.set([]);
    gitState.set({ kind: 'none' });
    release.mockClear();
    track.mockClear();
    stateFor.mockClear();
    findTabByIdAcrossWorkspaces.mockClear();
    TestBed.configureTestingModule({
      imports: [CanvasSessionDetailsComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: { tabs, findTabByIdAcrossWorkspaces },
        },
        { provide: SessionGitStatsStore, useValue: { track, stateFor } },
        {
          provide: VSCodeService,
          useValue: { config: signal({ workspaceRoot: '/fallback' }) },
        },
      ],
    });
  });

  it('shows unavailable values without inventing session metrics', () => {
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Context');
    expect(text).toContain('Todos');
    expect(text).toContain('Git');
    expect(text).not.toContain('Agents');
    expect(
      fixture.nativeElement
        .querySelector('progress')
        .getAttribute('aria-valuetext'),
    ).toBe('Unavailable');
  });

  it('reads context and lifetime accounting from the selected tab', () => {
    tabs.set([
      {
        id: 'a',
        liveModelStats: { contextKnown: true, contextPercent: 62.4 },
        sessionStats: { tokenCount: 1234, totalCost: 0.25, messageCount: 7 },
        agentOrigin: {
          parentTabId: 'p',
          parentSessionId: null,
          label: 'Test',
          branch: 'feat/test',
          worktreePath: '/worktree',
          startedAt: 0,
        },
        messages: [],
        streamingState: null,
      },
    ]);
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('62%');
    expect(text).toContain('1,234');
    expect(text).toContain('$0.25');
    expect(text).toContain('feat/test');
  });

  it('shows known todo progress and uncommitted line counts', () => {
    tabs.set([
      {
        id: 'a',
        messages: [
          todoMessage({
            todos: [
              { content: 'Done', activeForm: 'Done', status: 'completed' },
              {
                content: 'Build canvas',
                activeForm: 'Building a very long canvas board',
                status: 'in_progress',
              },
            ],
          }),
        ],
        streamingState: null,
      },
    ]);
    gitState.set({ kind: 'known', additions: 12, deletions: 3, partial: true });
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    expect(row(fixture, 'Todos').textContent).toContain('1/2');
    expect(row(fixture, 'Todos').textContent).toContain(
      'Building a very long canvas board',
    );
    expect(row(fixture, 'Todos').title).toBe(
      'Building a very long canvas board',
    );
    expect(row(fixture, 'Todos').querySelector('.truncate')).not.toBeNull();
    expect(row(fixture, 'Changes').textContent).toContain('+12 −3+');
    expect(row(fixture, 'Changes').title).toBe(
      'Some files could not be counted',
    );
    expect(
      row(fixture, 'Changes').querySelector('.text-success'),
    ).not.toBeNull();
    expect(row(fixture, 'Changes').querySelector('.text-error')).not.toBeNull();
  });

  it('labels absent and unknown values', () => {
    tabs.set([{ id: 'a', messages: [], streamingState: null }]);
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    expect(row(fixture, 'Todos').textContent?.trim()).toBe('—');
    expect(row(fixture, 'Todos').title).toBe('No todos');
    expect(row(fixture, 'Changes').textContent?.trim()).toBe('—');
    expect(row(fixture, 'Changes').title).toBe('Git changes unknown');

    tabs.set([
      {
        id: 'a',
        messages: [todoMessage({ todos: 'invalid' })],
        streamingState: null,
      },
    ]);
    gitState.set({ kind: 'unknown', reason: 'failed' });
    fixture.detectChanges();
    expect(row(fixture, 'Todos').textContent?.trim()).toBe('—');
    expect(row(fixture, 'Todos').title).toBe('Todos unknown');
    expect(row(fixture, 'Changes').textContent?.trim()).toBe('—');
    expect(row(fixture, 'Changes').title).toBe('Could not read git status');
  });

  it('tracks the selected root and releases it on tab change and destroy', () => {
    tabs.set([
      {
        id: 'a',
        messages: [],
        streamingState: null,
        agentOrigin: {
          parentTabId: 'p',
          parentSessionId: null,
          label: 'Test',
          branch: 'feat/test',
          worktreePath: '/worktree',
          startedAt: 0,
        },
      },
      { id: 'b', messages: [], streamingState: null },
    ]);
    const fixture = TestBed.createComponent(CanvasSessionDetailsComponent);
    fixture.componentRef.setInput('tabId', 'a');
    fixture.detectChanges();
    expect(track).toHaveBeenCalledWith('/worktree', 'a');
    fixture.componentRef.setInput('tabId', 'b');
    fixture.detectChanges();
    expect(release).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('/partition', 'b');
    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(2);
  });
});
