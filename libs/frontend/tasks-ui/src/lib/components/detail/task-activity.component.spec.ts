import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import type {
  SessionPrLinkSummary,
  TaskLinkedSession,
} from '@ptah-extension/shared';
import { TaskAgentDiscoveryService } from '../../services/task-agent-discovery.service';
import { TaskSessionLinksService } from '../../services/task-session-links.service';
import type { TaskAgentTarget } from '../../types/task-agent.types';
import { TaskActivityComponent } from './task-activity.component';

describe('TaskActivityComponent — linked sessions (TASK_2026_580)', () => {
  let links: ReturnType<typeof signal<Map<string, TaskLinkedSession[]>>>;
  let linksFor: jest.Mock;
  let requestOpenSession: jest.Mock;
  let agents: ReturnType<typeof signal<readonly TaskAgentTarget[]>>;
  let discovery: { availableAgents: typeof agents; load: jest.Mock };

  function linked(
    overrides: Partial<TaskLinkedSession> = {},
  ): TaskLinkedSession {
    return {
      sessionId: 'sess-1',
      name: 'Board start',
      role: 'primary',
      source: 'board-start',
      livePhase: 'generating',
      prLinks: [],
      todos: null,
      ...overrides,
    };
  }

  function pr(
    overrides: Partial<SessionPrLinkSummary> = {},
  ): SessionPrLinkSummary {
    return {
      url: 'https://github.com/acme/app/pull/42',
      number: 42,
      repo: 'acme/app',
      state: 'open',
      source: 'agent',
      createdAt: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    links = signal(new Map<string, TaskLinkedSession[]>());
    linksFor = jest.fn(
      (taskId: string): readonly TaskLinkedSession[] =>
        links().get(taskId) ?? [],
    );
    requestOpenSession = jest.fn();
    agents = signal<readonly TaskAgentTarget[]>([]);
    discovery = {
      availableAgents: agents,
      load: jest.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      imports: [TaskActivityComponent],
      providers: [
        { provide: TaskSessionLinksService, useValue: { linksFor } },
        { provide: AppStateManager, useValue: { requestOpenSession } },
        { provide: TaskAgentDiscoveryService, useValue: discovery },
      ],
    });
  });

  function render(taskId = 'TASK_2026_200') {
    const fixture = TestBed.createComponent(TaskActivityComponent);
    fixture.componentRef.setInput('taskId', taskId);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const rows = (host: HTMLElement) =>
    Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="task-detail-session"]'),
    );
  const within = (el: Element | undefined, id: string) =>
    el?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;

  it('shows the todo progress and in-progress item of a linked session (TASK_2026_854)', () => {
    links.set(
      new Map([
        [
          'TASK_2026_200',
          [
            linked({
              todos: {
                done: 3,
                total: 7,
                inProgress: 'Wiring the cache',
                updatedAt: 1,
              },
            }),
            linked({ sessionId: 'sess-2', name: 'Other' }),
            linked({
              sessionId: 'sess-3',
              name: 'Empty list',
              todos: { done: 0, total: 0, inProgress: null, updatedAt: 1 },
            }),
          ],
        ],
      ]),
    );
    const { host } = render();
    const list = rows(host);

    const todos = within(list[0], 'task-detail-session-todos');
    expect(todos?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Todos 3/7 · Wiring the cache',
    );
    expect(todos?.getAttribute('title')).toBe(
      '3 of 7 todos done; in progress: Wiring the cache',
    );
    expect(within(list[1], 'task-detail-session-todos')).toBeNull();
    expect(within(list[2], 'task-detail-session-todos')).toBeNull();
  });

  it('lists every linked session with its role, source and phase in words', () => {
    links.set(
      new Map([
        [
          'TASK_2026_200',
          [
            linked({ prLinks: [pr()] }),
            linked({
              sessionId: 'sess-2',
              name: 'Review pass',
              role: 'related',
              source: 'agent',
              livePhase: 'idle',
            }),
            linked({
              sessionId: 'sess-3',
              name: '',
              role: 'related',
              source: 'user',
              livePhase: null,
            }),
          ],
        ],
      ]),
    );
    const { host } = render();
    const list = rows(host);

    expect(list).toHaveLength(3);
    expect(host.textContent).toContain('Sessions (3)');
    expect(within(list[0], 'task-detail-session-name')?.textContent).toBe(
      'Board start',
    );
    expect(
      within(list[0], 'task-detail-session-meta')?.textContent?.replace(
        /\s+/g,
        ' ',
      ),
    ).toBe('Primary · started from the board · running');
    expect(
      within(list[1], 'task-detail-session-meta')?.textContent?.replace(
        /\s+/g,
        ' ',
      ),
    ).toBe('Related · linked by an agent · idle');
    // A session not loaded in this host reads "not open", never a blank.
    expect(
      within(list[2], 'task-detail-session-meta')?.textContent?.replace(
        /\s+/g,
        ' ',
      ),
    ).toBe('Related · linked by you · not open');
    expect(within(list[2], 'task-detail-session-name')?.textContent).toBe(
      'Untitled session',
    );

    // Dots are named and differ by phase; "not open" is the hollow one.
    const dots = list.map((row) => within(row, 'task-detail-session-dot'));
    expect(dots.map((dot) => dot?.getAttribute('data-phase'))).toEqual([
      'generating',
      'idle',
      'none',
    ]);
    expect(dots[2]?.getAttribute('aria-label')).toBe('Live phase: not open');
    expect(dots[0]?.className).toContain('border-base-content/70');

    // The PR link is external, https, and opens in a new browsing context.
    const link = within(list[0], 'task-detail-session-pr') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      'https://github.com/acme/app/pull/42',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('#42');
    expect(link.getAttribute('aria-label')).toBe(
      'Open pull request #42 in acme/app, open in the browser',
    );

    // The name truncates with the full text on hover.
    expect(
      within(list[1], 'task-detail-session-name')?.getAttribute('title'),
    ).toBe('Review pass');

    // Read through the shared map, keyed by the shown task.
    expect(linksFor).toHaveBeenCalledWith('TASK_2026_200');
  });

  it('shows the no-PR state for a session with no pull request', () => {
    links.set(new Map([['TASK_2026_200', [linked()]]]));
    const { host } = render();
    const [row] = rows(host);

    expect(within(row, 'task-detail-session-pr')).toBeNull();
    expect(within(row, 'task-detail-session-no-pr')?.textContent).toContain(
      'No pull request',
    );
  });

  it('renders a quiet empty state, and no rows, when nothing is linked', () => {
    const { host } = render();
    expect(rows(host)).toHaveLength(0);
    expect(
      host.querySelector('[data-testid="task-detail-sessions-empty"]')
        ?.textContent,
    ).toContain('No sessions linked to this task');
    // Not an error: the panel renders no alert for an empty (or unavailable) map.
    expect(
      host.querySelector('[data-testid="task-detail-sessions"] .alert'),
    ).toBeNull();
  });

  it('rewrites the section in place when the map arrives after the panel opened', () => {
    const { fixture, host } = render();
    const section = host.querySelector('[data-testid="task-detail-sessions"]');
    expect(section).not.toBeNull();

    links.set(new Map([['TASK_2026_200', [linked()]]]));
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="task-detail-sessions"]')).toBe(
      section,
    );
    expect(rows(host)).toHaveLength(1);
    expect(
      host.querySelector('[data-testid="task-detail-sessions-empty"]'),
    ).toBeNull();
  });

  it('"Open session" requests the row\'s session by id and name', () => {
    links.set(
      new Map([
        [
          'TASK_2026_200',
          [
            linked(),
            linked({
              sessionId: 'sess-2',
              name: 'Review pass',
              role: 'related',
            }),
          ],
        ],
      ]),
    );
    const { host } = render();
    const button = within(
      rows(host)[1],
      'task-detail-session-open',
    ) as HTMLButtonElement;

    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Open session Review pass');
    button.click();

    expect(requestOpenSession).toHaveBeenCalledTimes(1);
    expect(requestOpenSession).toHaveBeenCalledWith({
      sessionId: 'sess-2',
      name: 'Review pass',
    });
  });

  it.each([
    ['http', 'http://github.com/acme/app/pull/7'],
    ['javascript', 'javascript:alert(1)'],
    ['relative', '/acme/app/pull/7'],
    ['unparseable', 'https://exa mple.com:99999/pull/7'],
  ])('does not render a %s PR URL as a link', (_kind, url) => {
    links.set(
      new Map([
        ['TASK_2026_200', [linked({ prLinks: [pr({ url, number: 7 })] })]],
      ]),
    );
    const { host } = render();
    const [row] = rows(host);

    expect(within(row, 'task-detail-session-pr')).toBeNull();
    expect(row.querySelector('a')).toBeNull();
    expect(host.querySelector(`[href="${url}"]`)).toBeNull();
    const text = within(row, 'task-detail-session-pr-unlinked');
    expect(text?.textContent).toContain('#7');
    expect(text?.getAttribute('title')).toContain('only https addresses open');
  });

  it('loads the Start roster and shows each CLI lane in the picker words', () => {
    const { fixture, host } = render();
    expect(discovery.load).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector('[data-testid="task-activity-lanes"]'),
    ).toBeNull();

    agents.set([
      {
        id: 'orchestrate',
        name: 'orchestrate',
        category: 'orchestrator',
        description: 'Run the full task orchestration pipeline.',
      },
      {
        id: 'specialist:frontend-developer',
        name: 'frontend-developer',
        category: 'specialist',
        description: 'UI work',
      },
      {
        id: 'lane:codex',
        name: 'Codex',
        category: 'lane',
        description: 'Run through codex v0.155.1.',
        cli: 'codex',
      },
      {
        id: 'lane:gemini',
        name: 'Gemini',
        category: 'lane',
        description: 'Run through the gemini CLI lane.',
        cli: 'gemini',
      },
    ]);
    fixture.detectChanges();

    const lanes = Array.from(
      host.querySelectorAll('[data-testid="task-activity-lane"]'),
    ).map((el) => el.textContent?.trim());
    expect(lanes).toEqual([
      'Run through codex v0.155.1.',
      'Run through the gemini CLI lane.',
    ]);
    // Text, not a control: Start stays on the board.
    expect(
      host.querySelector('[data-testid="task-activity-lanes"] button'),
    ).toBeNull();
  });
});
