/**
 * The sidebar's session organization (TASK_2026_580, Batch C1.2).
 *
 * Renders the REAL sidebar markup — the `<aside>` and the editor mount, cut
 * from `app-shell.component.html` — against the REAL component class, with
 * the store behind it stubbed. The rest of the 700-line shell (chat view, tab
 * bar, canvas) is left out, as the sibling `app-shell.*.spec.ts` files do.
 *
 * Covers:
 *  - AC7: without organization (VS Code) the sidebar is today's — local search
 *    box, date filter, plain rows; no filter bar, chips, Organize action or
 *    group headers, and nothing is sent to the server;
 *  - with organization: the filter bar replaces the search box and its text
 *    goes to the server, the date filter stays local, chips and the Organize
 *    action render, headers follow `groupBy`, children nest for `parent`;
 *  - `groupSessionRows`, the pure grouping behind the headers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  AppStateManager,
  AuthStateService,
  BootStatusService,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { SkeletonBlockComponent } from '@ptah-extension/chat-ui';
import type {
  ChatSessionSummary,
  SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { AppShellComponent } from './app-shell.component';
import { groupSessionRows } from './session-row-groups';
import { ChatStore } from '../../services/chat.store';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import type { SessionListQuery } from '../../services/chat-store/session-loader.service';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';
import { SessionFilterBarComponent } from '../molecules/session-filter-bar/session-filter-bar.component';
import { SessionOrganizationEditorComponent } from '../molecules/session-organization-editor/session-organization-editor.component';
import { SessionOrganizationChipsComponent } from '../atoms/session-organization-chips/session-organization-chips.component';

const SHELL_TEMPLATE = join(
  process.cwd(),
  'libs/frontend/chat/src/lib/components/templates/app-shell.component.html',
);

/** The sidebar and the editor mount, exactly as the shell template has them. */
function sidebarTemplate(): string {
  const html = readFileSync(SHELL_TEMPLATE, 'utf8');
  const start = html.indexOf('<aside');
  const end = html.indexOf('</aside>') + '</aside>'.length;
  const editor = html.match(
    /@if \(organizationAvailable\(\)\) \{\s*@defer \([^)]*\)[^{]*\{\s*<ptah-session-organization-editor[\s\S]*?\/>\s*\}\s*\}/,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(editor).not.toBeNull();
  return `${editor?.[0] ?? ''}\n${html.slice(start, end)}`;
}

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 2, 12).getTime();

function session(
  id: string,
  name: string,
  extra: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    id,
    name,
    createdAt: NOW - 3 * DAY,
    lastActivityAt: NOW,
    messageCount: 0,
    isActive: false,
    ...extra,
  } as ChatSessionSummary;
}

interface StoreStub {
  sessions: WritableSignal<readonly ChatSessionSummary[]>;
  organizationAvailable: WritableSignal<boolean>;
  listQuery: WritableSignal<SessionListQuery>;
  setListQuery: jest.Mock;
}

function createStore(): StoreStub {
  const listQuery = signal<SessionListQuery>({ sort: 'lastActive' });
  return {
    sessions: signal<readonly ChatSessionSummary[]>([]),
    organizationAvailable: signal(false),
    listQuery,
    setListQuery: jest.fn((query: SessionListQuery) => listQuery.set(query)),
  };
}

function configure(store: StoreStub): ComponentFixture<AppShellComponent> {
  TestBed.configureTestingModule({
    providers: [
      ...provideSurfaceRouterTesting(),
      AppStateManager,
      {
        provide: AuthStateService,
        useValue: {
          loadAuthStatus: jest.fn(() => new Promise<void>(() => undefined)),
          isLoaded: () => false,
          hasAnyAuth: () => true,
        },
      },
      { provide: KeyboardShortcutsService, useValue: {} },
      {
        provide: SessionDisplayUtils,
        useValue: {
          formatRelativeDate: () => 'today',
          getSessionDisplayName: (s: ChatSessionSummary) => s.name,
        },
      },
      { provide: ConfirmationDialogService, useValue: { confirm: jest.fn() } },
      {
        provide: ClaudeRpcService,
        useValue: {
          call: jest.fn().mockResolvedValue({ success: false, error: 'stub' }),
        },
      },
      { provide: AgentMonitorStore, useValue: {} },
      // The shell creates this eagerly; its behaviour is covered by
      // closed-tab-session-ender.service.spec.ts.
      { provide: ClosedTabSessionEnderService, useValue: {} },
      {
        provide: TabManagerService,
        useValue: { activeTab: signal(null), findTabBySessionId: () => null },
      },
      {
        provide: ChatStore,
        useValue: {
          ...store,
          currentSession: signal(null),
          hasMoreSessions: signal(false),
          totalSessions: signal(0),
          isLoadingMoreSessions: signal(false),
          loadMoreSessions: jest.fn(),
        },
      },
      {
        provide: BootStatusService,
        useValue: { isBooting: signal(false), phase: signal('ready') },
      },
      {
        provide: VSCodeService,
        useValue: { isElectron: true, getPtahIconUri: () => '' },
      },
    ],
  });
  TestBed.overrideComponent(AppShellComponent, {
    set: {
      template: sidebarTemplate(),
      imports: [
        NgTemplateOutlet,
        NgClass,
        FormsModule,
        LucideAngularModule,
        SkeletonBlockComponent,
        SessionFilterBarComponent,
        SessionOrganizationChipsComponent,
        SessionOrganizationEditorComponent,
      ],
      providers: [],
    },
  });
  const fixture = TestBed.createComponent(AppShellComponent);
  fixture.detectChanges();
  return fixture;
}

function query<T extends Element = HTMLElement>(
  fixture: ComponentFixture<AppShellComponent>,
  selector: string,
): T | null {
  return (fixture.nativeElement as HTMLElement).querySelector<T>(
    selector as never,
  ) as T | null;
}

function queryAll(
  fixture: ComponentFixture<AppShellComponent>,
  selector: string,
): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      selector,
    ),
  );
}

/** Names of the rendered rows, in order. */
function rowNames(fixture: ComponentFixture<AppShellComponent>): string[] {
  return queryAll(fixture, 'li.group span[title]').map(
    (el) => el.textContent?.trim() ?? '',
  );
}

/**
 * The organization editor sits in a `@defer` block (kept out of the initial
 * bundle); let it load and render before asserting.
 */
async function settle(
  fixture: ComponentFixture<AppShellComponent>,
): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('AppShell sidebar organization (TASK_2026_580)', () => {
  let store: StoreStub;

  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  describe('organization unavailable (VS Code shape, AC7)', () => {
    it("renders today's controls only", () => {
      store.sessions.set([
        session('a', 'Alpha', { organization: organization() }),
      ]);
      const fixture = configure(store);
      fixture.detectChanges();

      expect(query(fixture, '[data-testid="session-search-local"]')).not.toBe(
        null,
      );
      expect(
        query(fixture, 'button[aria-label="Toggle date filter"]'),
      ).not.toBe(null);
      expect(query(fixture, 'ptah-session-filter-bar')).toBe(null);
      expect(query(fixture, 'ptah-session-organization-chips')).toBe(null);
      expect(query(fixture, 'ptah-session-organization-editor')).toBe(null);
      expect(query(fixture, '[data-testid="session-organize"]')).toBe(null);
      expect(query(fixture, '[data-testid="session-group"]')).toBe(null);
      expect(query(fixture, '[data-depth]')).toBe(null);

      // Today's row: rename and delete only, the original right padding.
      const row = query(fixture, 'li.group');
      expect(row?.querySelector('button')?.classList).toContain('pr-16');
      // ...and the action cluster still centred on the row.
      const actions = row?.querySelector('div.absolute');
      expect(actions?.classList).toContain('top-1/2');
      expect(actions?.classList).toContain('-translate-y-1/2');
      expect(actions?.classList).not.toContain('bottom-1.5');
      expect(
        row?.querySelector('button span.text-xs')?.classList,
      ).not.toContain('whitespace-nowrap');
      expect(
        Array.from(row?.querySelectorAll('[aria-label]') ?? []).map((el) =>
          el.getAttribute('aria-label'),
        ),
      ).toEqual(['Rename session: Alpha', 'Delete session: Alpha']);
    });

    it('filters by name locally and sends nothing to the server', async () => {
      store.sessions.set([session('a', 'Alpha'), session('b', 'Beta')]);
      const fixture = configure(store);

      const search = query<HTMLInputElement>(
        fixture,
        '[data-testid="session-search-local"]',
      );
      type(search as HTMLInputElement, 'alp');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(rowNames(fixture)).toEqual(['Alpha']);
      expect(store.setListQuery).not.toHaveBeenCalled();
    });
  });

  describe('organization available', () => {
    async function available(
      sessions: ChatSessionSummary[],
    ): Promise<ComponentFixture<AppShellComponent>> {
      store.organizationAvailable.set(true);
      store.sessions.set(sessions);
      const fixture = configure(store);
      await settle(fixture);
      return fixture;
    }

    it('replaces the search box with the filter bar and keeps the date filter', async () => {
      const fixture = await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);

      expect(query(fixture, 'ptah-session-filter-bar')).not.toBe(null);
      expect(query(fixture, '[data-testid="session-search-local"]')).toBe(null);
      expect(
        query(fixture, 'button[aria-label="Toggle date filter"]'),
      ).not.toBe(null);
    });

    it('sends the search text to the server, not to the local filter', async () => {
      const fixture = await available([
        session('a', 'Alpha', { organization: organization() }),
        session('b', 'Beta', { organization: organization() }),
      ]);
      // After the shell settled: the filter bar's debounce is the only timer
      // this test drives.
      jest.useFakeTimers();

      type(
        query<HTMLInputElement>(
          fixture,
          '[data-testid="session-filter-text"]',
        ) as HTMLInputElement,
        'zzz',
      );
      jest.advanceTimersByTime(250);
      fixture.detectChanges();

      expect(store.setListQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'zzz', sort: 'lastActive' }),
      );
      // The rows are the server's answer; the text is not applied again here.
      expect(rowNames(fixture)).toEqual(['Alpha', 'Beta']);
    });

    it('keeps the date filter on the loaded rows', async () => {
      const fixture = await available([
        session('old', 'Old', {
          lastActivityAt: NOW - 30 * DAY,
          organization: organization(),
        }),
        session('new', 'New', { organization: organization() }),
      ]);
      const from = new Date(NOW - DAY);
      const pad = (n: number): string => String(n).padStart(2, '0');
      fixture.componentInstance.setDateFrom(
        `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      );
      fixture.detectChanges();

      expect(rowNames(fixture)).toEqual(['New']);
      expect(store.setListQuery).not.toHaveBeenCalled();
    });

    it('renders chips and the Organize action per row', async () => {
      const fixture = await available([
        session('a', 'Alpha', {
          organization: organization({ priority: 'urgent' }),
        }),
      ]);

      expect(
        query(fixture, '[data-testid="session-chip-priority"]')?.getAttribute(
          'aria-label',
        ),
      ).toBe('Priority: Urgent');
      // Chips sit beside the row button, never inside it.
      expect(
        query(fixture, 'li.group button ptah-session-organization-chips'),
      ).toBe(null);
      expect(
        query(fixture, '[data-testid="session-organize"]')?.getAttribute(
          'aria-label',
        ),
      ).toBe('Organize session: Alpha');

      // The title keeps the row's width: the actions anchor to the bottom
      // line, which reserves room for them instead of the title.
      const row = query(fixture, 'li.group');
      const button = row?.querySelector('button');
      expect(button?.classList).not.toContain('pr-16');
      const actions = row?.querySelector('div.absolute');
      expect(actions?.classList).toContain('bottom-1.5');
      expect(actions?.classList).not.toContain('top-1/2');
      const meta = button?.querySelector('span.text-xs');
      expect(meta?.classList).toContain('whitespace-nowrap');
      expect(meta?.classList).toContain('pr-20');
    });

    it('still renders the sidebar when the store holds no list at all', async () => {
      // Regression (PR #623 E2E): an undefined list threw inside change
      // detection and aborted the whole shell render.
      const fixture = await available(
        undefined as unknown as ChatSessionSummary[],
      );

      expect(query(fixture, 'ptah-session-filter-bar')).not.toBe(null);
      expect(fixture.nativeElement.textContent).toContain('No sessions yet');
    });

    it('offers no Organize action for a row without an organization record', async () => {
      const fixture = await available([session('fork', 'Fresh fork')]);
      expect(query(fixture, '[data-testid="session-organize"]')).toBe(null);
    });

    it('opens the editor for the row and closes it on `closed`', async () => {
      const fixture = await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);

      query<HTMLButtonElement>(
        fixture,
        '[data-testid="session-organize"]',
      )?.click();
      fixture.detectChanges();
      await settle(fixture);
      const dialog = query(
        fixture,
        '[data-testid="session-organization-editor"]',
      );
      expect(dialog).not.toBe(null);
      expect(dialog?.textContent).toContain('Alpha');

      query<HTMLButtonElement>(
        fixture,
        '[data-testid="session-org-close"]',
      )?.click();
      fixture.detectChanges();
      expect(
        query(fixture, '[data-testid="session-organization-editor"]'),
      ).toBe(null);
    });

    it('keeps the editor open with the last copy when its row leaves the list', async () => {
      const alpha = session('a', 'Alpha', { organization: organization() });
      const fixture = await available([alpha]);
      fixture.componentInstance.openOrganizer(new Event('click'), alpha);
      fixture.detectChanges();
      await settle(fixture);

      store.sessions.set([]);
      fixture.detectChanges();

      expect(fixture.componentInstance.organizingSession()?.id).toBe('a');
      expect(
        query(fixture, '[data-testid="session-organization-editor"]'),
      ).not.toBe(null);
    });

    it('draws a header per status group', async () => {
      store.listQuery.set({ sort: 'lastActive', groupBy: 'status' });
      const fixture = await available([
        session('a', 'Alpha', {
          organization: organization({ status: 'waiting' }),
        }),
        session('b', 'Beta', {
          organization: organization({ status: 'waiting' }),
        }),
        session('c', 'Gamma', { organization: organization() }),
      ]);

      const groups = queryAll(fixture, '[data-testid="session-group"]');
      expect(
        groups.map((g) => g.querySelector('h3 span')?.textContent?.trim()),
      ).toEqual(['Waiting', 'Active']);
      const list = groups[0].querySelector('ul');
      expect(list?.getAttribute('aria-labelledby')).toBe(
        groups[0].querySelector('h3')?.id,
      );
      expect(list?.querySelectorAll('li.group')).toHaveLength(2);
    });

    it('nests children under their parent when grouping by parent', async () => {
      store.listQuery.set({ sort: 'lastActive', groupBy: 'parent' });
      const fixture = await available([
        session('p', 'Parent', { organization: organization() }),
        session('c', 'Child', {
          organization: organization({ parentSessionId: 'p' }),
        }),
        session('o', 'Other', { organization: organization() }),
      ]);

      expect(rowNames(fixture)).toEqual(['Parent', 'Child', 'Other']);
      const child = queryAll(fixture, 'li.group')[1];
      expect(child.getAttribute('data-depth')).toBe('1');
      expect(child.classList).toContain('ml-3');
      expect(child.querySelector('.sr-only')?.textContent).toContain(
        'Child session',
      );
      expect(query(fixture, '[data-testid="session-group"]')).toBe(null);
    });

    it('says "No matching sessions" when server filters empty the list, and clears filters only', async () => {
      store.listQuery.set({
        status: ['done'],
        sort: 'priority',
        groupBy: 'status',
      });
      const fixture = await available([]);

      expect(fixture.nativeElement.textContent).toContain(
        'No matching sessions',
      );
      const clear = queryAll(fixture, 'li[role="presentation"] button').find(
        (b) => b.textContent?.trim() === 'Clear filters',
      );
      clear?.click();

      expect(store.setListQuery).toHaveBeenCalledWith({
        sort: 'priority',
        groupBy: 'status',
      });
    });
  });
});

describe('groupSessionRows', () => {
  const org = organization;

  it('returns no group for no rows', () => {
    expect(groupSessionRows([], 'status')).toEqual([]);
    expect(groupSessionRows([], 'none')).toEqual([]);
  });

  it('reads a missing list as empty instead of throwing (runs in change detection)', () => {
    expect(groupSessionRows(undefined, 'none')).toEqual([]);
    expect(groupSessionRows(null, 'parent')).toEqual([]);
  });

  it('groups by primary task, then first task, then "No task", in arrival order', () => {
    const groups = groupSessionRows(
      [
        session('a', 'A'),
        session('b', 'B', {
          organization: org({
            tasks: [
              {
                taskId: 'T1',
                role: 'related',
                source: 'user',
                createdAt: 0,
                missing: false,
              },
              {
                taskId: 'T2',
                role: 'primary',
                source: 'user',
                createdAt: 0,
                missing: false,
              },
            ],
          }),
        }),
        session('c', 'C', {
          organization: org({
            tasks: [
              {
                taskId: 'T1',
                role: 'related',
                source: 'agent',
                createdAt: 0,
                missing: true,
              },
            ],
          }),
        }),
      ],
      'task',
    );

    expect(
      groups.map((g) => [g.label, g.rows.map((r) => r.session.id)]),
    ).toEqual([
      ['No task', ['a']],
      ['T2', ['b']],
      ['T1', ['c']],
    ]);
  });

  it('keeps a child whose parent is not loaded at the top, and survives a cycle', () => {
    const rows = groupSessionRows(
      [
        session('orphan', 'Orphan', {
          organization: org({ parentSessionId: 'gone' }),
        }),
        session('x', 'X', { organization: org({ parentSessionId: 'y' }) }),
        session('y', 'Y', { organization: org({ parentSessionId: 'x' }) }),
      ],
      'parent',
    )[0].rows;

    expect(rows.map((r) => [r.session.id, r.depth])).toEqual([
      ['orphan', 0],
      ['x', 0],
      ['y', 1],
    ]);
  });
});
