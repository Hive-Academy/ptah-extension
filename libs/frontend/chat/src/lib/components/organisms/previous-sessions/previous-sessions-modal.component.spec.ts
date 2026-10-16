/**
 * PreviousSessionsModalComponent (TASK_2026_679, plan component 7).
 *
 * Renders the real modal the way the shell will (created per open), with the
 * organization editor and the delete confirm beside it, and an opener behind
 * a container that is inert while the modal is open. The query and row
 * services are the real root services; the stores and the host bridge behind
 * them are stubbed.
 *
 * Carries the sidebar organization tests from `app-shell.organization.spec.ts`
 * (titles kept, retargeted to `[data-testid="previous-sessions-list"]`) and
 * adds the dialog behaviour: Req 2.1-2.9, D-1, D-10/D-11, E-1, E-2, E-4, and
 * the D30 focus order after the editor closes.
 */
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  BootStatusService,
  ClaudeRpcService,
  LoggingService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  ChatSessionSummary,
  SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import type { SessionListQuery } from '../../../services/chat-store/session-loader.service';
import { SessionDisplayUtils } from '../../../services/session-display-utils.service';
import { PreviousSessionsDialogService } from '../../../services/session-list/previous-sessions-dialog.service';
import { SessionOrganizerService } from '../../../services/session-list/session-organizer.service';
import { ConfirmationDialogComponent } from '../../molecules/confirmation-dialog.component';
import { SessionOrganizationEditorComponent } from '../../molecules/session-organization-editor/session-organization-editor.component';
import { PreviousSessionsModalComponent } from './previous-sessions-modal.component';

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

function ok<T>(data: T) {
  return { success: true, data, isSuccess: () => true };
}

function keydown(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

interface StoreStub {
  sessions: WritableSignal<readonly ChatSessionSummary[] | undefined>;
  organizationAvailable: WritableSignal<boolean>;
  listQuery: WritableSignal<SessionListQuery>;
  currentSession: WritableSignal<ChatSessionSummary | null>;
  hasMoreSessions: WritableSignal<boolean>;
  totalSessions: WritableSignal<number>;
  isLoadingMoreSessions: WritableSignal<boolean>;
  setListQuery: jest.Mock;
  removeSessionFromList: jest.Mock;
  loadMoreSessions: jest.Mock;
  switchSession: jest.Mock;
  updateSessionName: jest.Mock;
  clearCurrentSession: jest.Mock;
}

function createStore(): StoreStub {
  const sessions = signal<readonly ChatSessionSummary[] | undefined>([]);
  const listQuery = signal<SessionListQuery>({ sort: 'lastActive' });
  return {
    sessions,
    organizationAvailable: signal(false),
    listQuery,
    currentSession: signal<ChatSessionSummary | null>(null),
    hasMoreSessions: signal(false),
    totalSessions: signal(0),
    isLoadingMoreSessions: signal(false),
    setListQuery: jest.fn((query: SessionListQuery) => listQuery.set(query)),
    removeSessionFromList: jest.fn((id: string) =>
      sessions.update((list) => (list ?? []).filter((s) => s.id !== id)),
    ),
    loadMoreSessions: jest.fn().mockResolvedValue(undefined),
    switchSession: jest.fn().mockResolvedValue(undefined),
    updateSessionName: jest.fn(),
    clearCurrentSession: jest.fn(),
  };
}

/** The shell's arrangement: opener behind an inert container, layers beside the modal. */
@Component({
  selector: 'ptah-previous-sessions-modal-test-host',
  standalone: true,
  imports: [
    PreviousSessionsModalComponent,
    SessionOrganizationEditorComponent,
    ConfirmationDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="page" [attr.inert]="dialog.isOpen() ? '' : null">
      <button type="button" data-testid="opener" data-previous-sessions-trigger>
        Previous sessions
      </button>
    </div>
    @if (dialog.isOpen()) {
      <ptah-previous-sessions-modal />
    }
    <ptah-session-organization-editor
      [session]="organizer.session()"
      (closed)="organizer.close()"
    />
    <ptah-confirmation-dialog />
  `,
})
class ModalTestHostComponent {
  readonly dialog = inject(PreviousSessionsDialogService);
  readonly organizer = inject(SessionOrganizerService);
}

describe('PreviousSessionsModalComponent', () => {
  // jsdom hides `dialog:not([open])`; daisyUI's `.modal { display: grid }`
  // overrides that in the app, so the specs load the same rule.
  let daisyModal: HTMLStyleElement;
  beforeAll(() => {
    daisyModal = document.createElement('style');
    daisyModal.textContent = '.modal { display: grid; }';
    document.head.appendChild(daisyModal);
  });
  afterAll(() => daisyModal.remove());

  let store: StoreStub;
  let fixture: ComponentFixture<ModalTestHostComponent>;
  let page: HTMLElement;
  const layoutMode = signal<'single' | 'grid'>('single');
  const isBooting = signal(false);
  const requestCanvasSession = jest.fn();
  const workflowForSession = jest.fn();
  const forgetWorkflowSession = jest.fn();
  const rpc = {
    call: jest.fn(),
    renameSession: jest.fn(),
    deleteSession: jest.fn(),
  };

  beforeEach(() => {
    store = createStore();
    layoutMode.set('single');
    isBooting.set(false);
    requestCanvasSession.mockReset().mockResolvedValue(undefined);
    workflowForSession.mockReset().mockReturnValue(null);
    forgetWorkflowSession.mockReset();
    rpc.call
      .mockReset()
      .mockResolvedValue({ success: false, isSuccess: () => false });
    rpc.renameSession.mockReset().mockResolvedValue(ok({ success: true }));
    rpc.deleteSession.mockReset().mockResolvedValue(ok({ success: true }));

    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: store },
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: LoggingService,
          useValue: {
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
          },
        },
        { provide: BootStatusService, useValue: { isBooting } },
        {
          provide: AppStateManager,
          useValue: { layoutMode, requestCanvasSession },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabBySessionId: () => null,
            workflowForSession,
            forgetWorkflowSession,
            activeWorkspacePath: '/work',
            setNameAndTitle: jest.fn(),
            closeTab: jest.fn(),
          },
        },
        {
          provide: SessionDisplayUtils,
          useValue: {
            formatRelativeDate: () => 'today',
            getSessionDisplayName: (s: ChatSessionSummary) => s.name,
          },
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    page?.remove();
  });

  // ---------------------------------------------------------------- helpers

  /** Refresh the views and run the after-render hooks (focus moves). */
  const render = (): void => {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  };

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    render();
  };

  const maybe = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null => page.querySelector<T>(selector);
  const el = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = maybe<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const all = (selector: string): HTMLElement[] =>
    Array.from(page.querySelectorAll<HTMLElement>(selector));

  const opener = (): HTMLButtonElement =>
    el<HTMLButtonElement>('[data-testid="opener"]');
  const modal = (): HTMLElement | null =>
    maybe('[data-testid="previous-sessions-modal"]');
  const panel = (): HTMLElement => el('#previous-sessions-dialog');
  const list = (): HTMLElement => el('[data-testid="previous-sessions-list"]');
  const rows = (): HTMLElement[] => all('li[ptah-session-list-row]');
  const rowNames = (): string[] =>
    all('[data-testid="session-row-title"]').map(
      (title) => title.textContent?.trim() ?? '',
    );
  const action = (id: string, name: string): HTMLButtonElement =>
    el<HTMLButtonElement>(
      `li[data-session-id="${id}"] [data-action="${name}"]`,
    );
  const search = (): HTMLInputElement =>
    el<HTMLInputElement>(
      '[data-testid="session-filter-text"], [data-testid="session-search-local"]',
    );
  const status = (): string =>
    el('[data-testid="previous-sessions-status"]').textContent?.trim() ?? '';
  const isOpen = (): boolean =>
    TestBed.inject(PreviousSessionsDialogService).isOpen();

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /** Mount the host and open the modal from the focused opener. */
  async function open(sessions?: readonly ChatSessionSummary[]): Promise<void> {
    if (sessions !== undefined) store.sessions.set(sessions);
    fixture = TestBed.createComponent(ModalTestHostComponent);
    // Like the shell, the host is refreshed by every application tick: a
    // focus restore scheduled from an event handler then runs after the view
    // that drops `inert` has rendered, as it does in the app (R2).
    fixture.autoDetectChanges();
    page = fixture.nativeElement as HTMLElement;
    document.body.appendChild(page);
    render();
    await reopen();
  }

  async function reopen(): Promise<void> {
    opener().focus();
    TestBed.inject(PreviousSessionsDialogService).open();
    render();
    await settle();
  }

  async function available(
    sessions: readonly ChatSessionSummary[] | undefined,
  ): Promise<void> {
    store.organizationAvailable.set(true);
    store.sessions.set(sessions);
    await open();
  }

  // ------------------------------------------------- dialog (Req 2.1-2.9)

  describe('dialog', () => {
    it('is a modal dialog named "Previous sessions" and focuses the search (Req 2.1)', async () => {
      await open([session('a', 'Alpha')]);

      const outer = modal();
      expect(outer?.getAttribute('role')).toBe('presentation');
      expect(outer?.classList).toContain('z-[990]');
      expect(outer?.hasAttribute('aria-modal')).toBe(false);
      expect(panel().getAttribute('role')).toBe('dialog');
      expect(panel().getAttribute('aria-modal')).toBe('true');
      const titleId = panel().getAttribute('aria-labelledby');
      expect(titleId).toBe('psm-title');
      expect(el(`#${titleId}`).textContent?.trim()).toBe('Previous sessions');
      expect(
        el('[data-testid="previous-sessions-close"]').getAttribute(
          'aria-label',
        ),
      ).toBe('Close previous sessions');
      expect(document.activeElement).toBe(
        el('[data-testid="session-search-local"]'),
      );
      expect(el('[data-testid="page"]').hasAttribute('inert')).toBe(true);
    });

    it('focuses the organization search with the caret after a kept query', async () => {
      store.organizationAvailable.set(true);
      store.listQuery.set({ sort: 'lastActive', text: 'login' });
      await open([session('a', 'Alpha', { organization: organization() })]);

      const field = search();
      expect(field.getAttribute('data-testid')).toBe('session-filter-text');
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe('login');
      expect(field.selectionStart).toBe(5);
      expect(field.selectionEnd).toBe(5);
    });

    it('wraps Tab from the last control to Close, and Shift+Tab back (Req 2.2)', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      const close = el<HTMLButtonElement>(
        '[data-testid="previous-sessions-close"]',
      );
      const last = action('b', 'delete');

      last.focus();
      const forward = keydown('Tab');
      last.dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);

      const backward = keydown('Tab', { shiftKey: true });
      close.dispatchEvent(backward);
      expect(backward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(last);

      search().focus();
      const inner = keydown('Tab');
      search().dispatchEvent(inner);
      expect(inner.defaultPrevented).toBe(false);
    });

    it('closes on Escape without reaching document listeners (Req 2.3)', async () => {
      await open([session('a', 'Alpha')]);
      const documentEscape = jest.fn();
      document.addEventListener('keydown', documentEscape);
      try {
        const event = keydown('Escape');
        search().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(documentEscape).not.toHaveBeenCalled();
        expect(isOpen()).toBe(false);
      } finally {
        document.removeEventListener('keydown', documentEscape);
      }
    });

    it('ignores Escape while an IME composition is running', async () => {
      await open([session('a', 'Alpha')]);
      search().dispatchEvent(keydown('Escape', { isComposing: true }));
      expect(isOpen()).toBe(true);
    });

    it('Escape in the inline rename only cancels it (Req 2.4)', async () => {
      await open([session('a', 'Alpha')]);
      action('a', 'rename').focus();
      action('a', 'rename').click();
      render();
      const field = el<HTMLInputElement>(
        '[data-testid="session-rename-input"]',
      );
      expect(document.activeElement).toBe(field);

      type(field, 'Changed');
      field.dispatchEvent(keydown('Escape'));
      expect(isOpen()).toBe(true);
      render();

      expect(maybe('[data-testid="session-rename-input"]')).toBeNull();
      expect(document.activeElement).toBe(action('a', 'rename'));
      expect(rpc.renameSession).not.toHaveBeenCalled();
    });

    it('Escape on the Filters popover only closes the popover (Req 2.4)', async () => {
      await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);
      el<HTMLButtonElement>('[data-testid="session-filter-toggle"]').click();
      render();
      const filters = el('[data-testid="session-filter-panel"]');
      expect(panel().contains(filters)).toBe(true);

      filters.dispatchEvent(keydown('Escape'));
      render();

      expect(maybe('[data-testid="session-filter-panel"]')).toBeNull();
      expect(isOpen()).toBe(true);
    });

    describe('focus returns to the opener (Req 2.5)', () => {
      const paths: ReadonlyArray<[string, () => void]> = [
        [
          'Close',
          () =>
            el<HTMLButtonElement>(
              '[data-testid="previous-sessions-close"]',
            ).click(),
        ],
        ['Escape', () => search().dispatchEvent(keydown('Escape'))],
        [
          'backdrop',
          () => {
            const scrim = el('[data-testid="previous-sessions-scrim"]');
            scrim.dispatchEvent(
              new MouseEvent('pointerdown', { bubbles: true }),
            );
            scrim.click();
          },
        ],
        ['select', () => action('a', 'open').click()],
      ];

      it.each(paths)('after %s', async (_name, closeBy) => {
        await open([session('a', 'Alpha')]);
        expect(document.activeElement).not.toBe(opener());

        closeBy();
        render();

        expect(modal()).toBeNull();
        expect(el('[data-testid="page"]').hasAttribute('inert')).toBe(false);
        expect(document.activeElement).toBe(opener());
      });
    });

    it('closes from the backdrop only when the press started on it (Req 2.7)', async () => {
      await open([session('a', 'Alpha')]);
      const scrim = el('[data-testid="previous-sessions-scrim"]');

      // A selection dragged out of the panel.
      list().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      scrim.click();
      expect(isOpen()).toBe(true);

      scrim.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      scrim.click();
      expect(isOpen()).toBe(false);
    });

    it('keeps the query on close and reopen without asking for a new list (Req 2.9)', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      type(search(), 'alp');
      render();
      expect(rowNames()).toEqual(['Alpha']);

      el<HTMLButtonElement>('[data-testid="previous-sessions-close"]').click();
      render();
      expect(modal()).toBeNull();

      await reopen();
      expect(search().value).toBe('alp');
      expect(rowNames()).toEqual(['Alpha']);
      expect(document.activeElement).toBe(search());
      expect(search().selectionStart).toBe(3);
      expect(store.setListQuery).not.toHaveBeenCalled();
      expect(store.loadMoreSessions).not.toHaveBeenCalled();
      expect(rpc.call).not.toHaveBeenCalledWith(
        'session:list',
        expect.anything(),
      );
    });

    it('announces the result count after the query settles', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      expect(status()).toBe('');

      type(search(), 'alp');
      render();
      render();
      expect(status()).toBe('1 session');

      type(search(), '');
      render();
      render();
      expect(status()).toBe('2 sessions');
    });

    describe('keeps focus in the modal when a header button removes itself', () => {
      it.each([
        ['the search clear X', 'session-search-local-clear'],
        ['Clear', 'session-clear-all'],
      ])('after %s', async (_name, testId) => {
        await open([session('a', 'Alpha'), session('b', 'Beta')]);
        type(search(), 'alp');
        render();
        const button = el<HTMLButtonElement>(`[data-testid="${testId}"]`);
        button.focus();

        button.click();
        render();

        expect(maybe(`[data-testid="${testId}"]`)).toBeNull();
        expect(search().value).toBe('');
        expect(document.activeElement).toBe(search());
      });

      it('leaves focus on a header button that stays', async () => {
        await open([session('a', 'Alpha')]);
        const toggle = el<HTMLButtonElement>(
          '[data-testid="session-date-toggle"]',
        );
        toggle.focus();

        toggle.click();
        render();

        expect(maybe('[data-testid="session-date-panel"]')).not.toBeNull();
        expect(document.activeElement).toBe(toggle);
      });
    });
  });

  // -------------------------------------------- nested layers (Req 2.8)

  describe('nested layers (Req 2.8)', () => {
    const alpha = (): ChatSessionSummary =>
      session('a', 'Alpha', { organization: organization() });

    it('returns focus to the row Organize button after the editor closes (D30)', async () => {
      await available([
        alpha(),
        session('b', 'Beta', { organization: organization() }),
      ]);
      action('a', 'organize').focus();
      action('a', 'organize').click();
      await settle();

      const editor = el('[data-testid="session-organization-editor"]');
      expect(editor.textContent).toContain('Alpha');
      expect(panel().hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(
        el('[data-testid="session-org-close"]'),
      );

      el<HTMLButtonElement>('[data-testid="session-org-close"]').click();
      render();

      expect(maybe('[data-testid="session-organization-editor"]')).toBeNull();
      expect(panel().hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(action('a', 'organize'));
      expect(isOpen()).toBe(true);
    });

    it('falls back to the search when the organized row left the list', async () => {
      await available([alpha()]);
      action('a', 'organize').focus();
      action('a', 'organize').click();
      await settle();

      store.sessions.set([]);
      render();
      // The editor keeps its last copy while the row is gone.
      expect(
        maybe('[data-testid="session-organization-editor"]'),
      ).not.toBeNull();

      el<HTMLButtonElement>('[data-testid="session-org-close"]').click();
      render();

      expect(panel().hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(search());
    });

    it('is inert under the delete confirm, ignores the backdrop, and refocuses Delete on cancel', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      action('a', 'delete').focus();
      action('a', 'delete').click();
      render();

      expect(panel().hasAttribute('inert')).toBe(true);
      const cancel = el<HTMLButtonElement>('.modal-action button.btn-ghost');
      expect(cancel.textContent?.trim()).toBe('Cancel');
      const scrim = el('[data-testid="previous-sessions-scrim"]');
      scrim.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      scrim.click();
      expect(isOpen()).toBe(true);

      cancel.click();
      await settle();

      expect(panel().hasAttribute('inert')).toBe(false);
      expect(rpc.deleteSession).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(action('a', 'delete'));
    });

    async function deleteRow(id: string): Promise<void> {
      action(id, 'delete').focus();
      action(id, 'delete').click();
      render();
      el<HTMLButtonElement>('.modal-action button.btn-error').click();
      await settle();
    }

    it('moves focus to the next row after a delete', async () => {
      await open([
        session('a', 'Alpha'),
        session('b', 'Beta'),
        session('c', 'Gamma'),
      ]);
      await deleteRow('a');

      expect(rpc.deleteSession).toHaveBeenCalledWith('a');
      expect(store.removeSessionFromList).toHaveBeenCalledWith('a');
      expect(rowNames()).toEqual(['Beta', 'Gamma']);
      expect(document.activeElement).toBe(action('b', 'open'));
      expect(isOpen()).toBe(true);
    });

    it('moves focus to the previous row after deleting the last one, then to the search', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      await deleteRow('b');
      expect(document.activeElement).toBe(action('a', 'open'));

      await deleteRow('a');
      expect(rows()).toHaveLength(0);
      expect(document.activeElement).toBe(search());
      // A delete is not a query result: no count announcement.
      render();
      expect(status()).toBe('');
    });

    it('keeps the row and refocuses Delete when the delete fails', async () => {
      rpc.deleteSession.mockResolvedValueOnce(
        ok({ success: false, error: 'locked' }),
      );
      await open([session('a', 'Alpha')]);
      await deleteRow('a');

      expect(rowNames()).toEqual(['Alpha']);
      expect(document.activeElement).toBe(action('a', 'delete'));
    });
  });

  // ------------------------------------------------------- rows (D-1, D-2)

  describe('row verbs', () => {
    it('opens the session in the grid and closes (D-1)', async () => {
      layoutMode.set('grid');
      await open([session('a', 'Alpha')]);
      action('a', 'open').click();

      expect(requestCanvasSession).toHaveBeenCalledWith('a', 'Alpha');
      expect(store.switchSession).not.toHaveBeenCalled();
      expect(isOpen()).toBe(false);
    });

    it('switches the tab in single layout and closes (D-1)', async () => {
      await open([session('a', 'Alpha')]);
      action('a', 'open').click();

      expect(store.switchSession).toHaveBeenCalledWith('a');
      expect(requestCanvasSession).not.toHaveBeenCalled();
      expect(isOpen()).toBe(false);
    });

    it('renames on Enter, once, and returns focus to Rename', async () => {
      await open([session('a', 'Alpha')]);
      action('a', 'rename').focus();
      action('a', 'rename').click();
      render();
      const field = el<HTMLInputElement>(
        '[data-testid="session-rename-input"]',
      );
      expect(field.value).toBe('Alpha');

      type(field, '  Renamed  ');
      field.dispatchEvent(keydown('Enter'));
      // The removed field's blur must not save a second time.
      field.dispatchEvent(new FocusEvent('blur'));
      await settle();

      expect(rpc.renameSession).toHaveBeenCalledTimes(1);
      expect(rpc.renameSession).toHaveBeenCalledWith('a', 'Renamed');
      expect(store.updateSessionName).toHaveBeenCalledWith('a', 'Renamed');
      expect(maybe('[data-testid="session-rename-input"]')).toBeNull();
      expect(document.activeElement).toBe(action('a', 'rename'));
      expect(isOpen()).toBe(true);
    });

    it('saves on blur without moving focus', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);
      action('a', 'rename').click();
      render();
      const field = el<HTMLInputElement>(
        '[data-testid="session-rename-input"]',
      );
      type(field, 'Renamed');

      action('b', 'open').focus();
      field.dispatchEvent(new FocusEvent('blur'));
      await settle();

      expect(rpc.renameSession).toHaveBeenCalledWith('a', 'Renamed');
      expect(document.activeElement).toBe(action('b', 'open'));
    });

    it('sends nothing for an unchanged name', async () => {
      await open([session('a', 'Alpha')]);
      action('a', 'rename').click();
      render();
      el<HTMLInputElement>(
        '[data-testid="session-rename-input"]',
      ).dispatchEvent(keydown('Enter'));
      await settle();

      expect(rpc.renameSession).not.toHaveBeenCalled();
      expect(maybe('[data-testid="session-rename-input"]')).toBeNull();
    });

    it('orders a row as open, Organize, Rename, Delete (D-10/D-11)', async () => {
      await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);
      const buttons = Array.from(
        rows()[0].querySelectorAll<HTMLButtonElement>('button'),
      ).map((button) => button.getAttribute('data-action'));
      expect(buttons).toEqual(['open', 'organize', 'rename', 'delete']);
    });
  });

  // ------------------------------------------------- list states (E-1..E-4)

  describe('list states', () => {
    it('shows skeleton rows while booting, never the empty state (E-1)', async () => {
      isBooting.set(true);
      await open([]);

      const loading = el('[data-testid="previous-sessions-loading"]');
      expect(loading.getAttribute('role')).toBe('status');
      expect(loading.getAttribute('aria-label')).toBe('Loading sessions');
      expect(loading.querySelector('ptah-skeleton-block')).not.toBeNull();
      expect(list().getAttribute('aria-busy')).toBe('true');
      expect(list().textContent).not.toContain('No sessions yet');
    });

    it('says "No sessions yet" for an empty history (E-2)', async () => {
      await open([]);
      const empty = el('[data-testid="previous-sessions-empty"]');
      expect(empty.textContent).toContain('No sessions yet');
      expect(empty.textContent).toContain('Create one to get started');
      expect(list().hasAttribute('aria-busy')).toBe(false);
    });

    describe('Load More (E-4)', () => {
      let finishLoad: (
        more: readonly ChatSessionSummary[],
        hasMore: boolean,
      ) => void;

      beforeEach(() => {
        store.loadMoreSessions.mockImplementation(() => {
          store.isLoadingMoreSessions.set(true);
          return new Promise<void>((resolve) => {
            finishLoad = (more, hasMore) => {
              store.sessions.update((current) => [...(current ?? []), ...more]);
              store.hasMoreSessions.set(hasMore);
              store.isLoadingMoreSessions.set(false);
              resolve();
            };
          });
        });
      });

      const loadMore = (): HTMLButtonElement | null =>
        maybe<HTMLButtonElement>('[data-testid="session-load-more"]');

      it('loads pages, announces them and keeps focus, then moves to the first new row', async () => {
        store.hasMoreSessions.set(true);
        store.totalSessions.set(5);
        await open([session('a', 'Alpha'), session('b', 'Beta')]);
        expect(loadMore()?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
          'Load More (3)',
        );

        loadMore()?.focus();
        loadMore()?.click();
        render();
        expect(loadMore()?.disabled).toBe(true);
        expect(loadMore()?.getAttribute('aria-busy')).toBe('true');
        expect(loadMore()?.textContent).toContain('Loading...');
        expect(list().getAttribute('aria-busy')).toBe('true');

        finishLoad([session('c', 'Gamma'), session('d', 'Delta')], true);
        await settle();
        render();
        expect(status()).toBe('Loaded 2 more sessions. 1 remaining.');
        expect(document.activeElement).toBe(loadMore());
        expect(loadMore()?.disabled).toBe(false);

        loadMore()?.click();
        render();
        finishLoad([session('e', 'Epsilon')], false);
        await settle();
        render();
        expect(loadMore()).toBeNull();
        expect(status()).toBe('Loaded 1 more session. 0 remaining.');
        expect(document.activeElement).toBe(action('e', 'open'));
      });

      it('offers to expand a local search, and hides when it matches nothing', async () => {
        store.hasMoreSessions.set(true);
        store.totalSessions.set(5);
        await open([session('a', 'Alpha'), session('b', 'Beta')]);

        type(search(), 'alp');
        render();
        expect(loadMore()?.textContent?.trim()).toBe(
          'Load more to expand search',
        );

        type(search(), 'zzz');
        render();
        expect(loadMore()).toBeNull();
        expect(list().textContent).toContain('No matching sessions');
      });
    });
  });

  // ------------------- carried from app-shell.organization.spec.ts

  describe('organization unavailable (VS Code shape, AC7)', () => {
    it('shows a workflow badge only on the tagged session row', async () => {
      workflowForSession.mockImplementation((id: string) =>
        id === 'tagged' ? 'harness-new-project' : null,
      );
      await open([session('tagged', 'Tagged'), session('plain', 'Plain')]);

      const found = rows();
      expect(found).toHaveLength(2);
      const badge = found[0].querySelector('ptah-workflow-badge');
      expect(badge?.textContent?.trim()).toBe('Workflow: New Project');
      expect(badge?.querySelector('.sr-only')?.textContent?.trim()).toBe(
        'Workflow:',
      );
      expect(
        found[1].querySelector('ptah-workflow-badge')?.textContent?.trim(),
      ).toBe('');
      expect(workflowForSession).toHaveBeenCalledWith('tagged', '/work');
      expect(workflowForSession).toHaveBeenCalledWith('plain', '/work');
    });

    it("renders today's controls only", async () => {
      await open([session('a', 'Alpha', { organization: organization() })]);

      expect(maybe('[data-testid="session-search-local"]')).not.toBeNull();
      expect(maybe('button[aria-label="Toggle date filter"]')).not.toBeNull();
      expect(maybe('ptah-session-filter-bar')).toBeNull();
      expect(maybe('ptah-session-organization-chips')).toBeNull();
      expect(maybe('ptah-session-live-phase-indicator')).toBeNull();
      expect(maybe('[data-testid="session-organization-editor"]')).toBeNull();
      expect(maybe('[data-testid="session-organize"]')).toBeNull();
      expect(maybe('[data-testid="session-group"]')).toBeNull();
      expect(maybe('[data-depth]')).toBeNull();

      // Rename and delete only, in that order.
      expect(
        Array.from(rows()[0].querySelectorAll('[aria-label]')).map((node) =>
          node.getAttribute('aria-label'),
        ),
      ).toEqual(['Rename session: Alpha', 'Delete session: Alpha']);
    });

    it('paints one surface-1 header band over one scrolling list (A-10)', async () => {
      await open([session('a', 'Alpha')]);

      const header = el('[data-testid="previous-sessions-header"]');
      expect(header.classList).toContain('bg-surface-1');
      expect(header.classList).toContain('border-b');
      expect(header.classList).toContain('px-4');
      expect(header.contains(search())).toBe(true);

      // The list region is the panel's only scroller; the header never scrolls.
      expect(Array.from(panel().querySelectorAll('.overflow-y-auto'))).toEqual([
        list(),
      ]);
      expect(list().classList).toContain('flex-1');
      expect(list().classList).toContain('min-h-0');
      expect(list().classList).toContain('overscroll-contain');
      expect(header.contains(list())).toBe(false);

      const field = search().closest('label');
      expect(field?.classList).toContain('h-8');
      expect(field?.classList).toContain('rounded-lg');
      expect(field?.classList).toContain('bg-surface-0');
    });

    // TASK_2026_628: `transition-all` makes Chromium start `scrollbar-color`
    // transitions on every restyle (see effort-selector.component.spec.ts).
    it('rows and Load More do not use transition-all', async () => {
      store.hasMoreSessions.set(true);
      store.totalSessions.set(3);
      await open([session('a', 'Alpha')]);

      const loadMore = el('[data-testid="session-load-more"]');
      expect(loadMore.classList).toContain('transition-colors');
      expect(all('[data-action="open"]').length).toBeGreaterThan(0);
      expect(Array.from(panel().querySelectorAll('.transition-all'))).toEqual(
        [],
      );
    });

    it('filters by name locally and sends nothing to the server', async () => {
      await open([session('a', 'Alpha'), session('b', 'Beta')]);

      type(search(), 'alp');
      await settle();

      expect(rowNames()).toEqual(['Alpha']);
      expect(store.setListQuery).not.toHaveBeenCalled();
    });
  });

  describe('organization available', () => {
    it('replaces the search box with the filter bar and keeps the date filter', async () => {
      await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);

      expect(maybe('ptah-session-filter-bar')).not.toBeNull();
      expect(maybe('[data-testid="session-search-local"]')).toBeNull();
      expect(maybe('button[aria-label="Toggle date filter"]')).not.toBeNull();
    });

    it('sends the search text to the server, not to the local filter', async () => {
      await available([
        session('a', 'Alpha', { organization: organization() }),
        session('b', 'Beta', { organization: organization() }),
      ]);
      // After the modal settled: the filter bar's debounce is the only timer
      // this test drives.
      jest.useFakeTimers();

      type(search(), 'zzz');
      jest.advanceTimersByTime(250);
      render();

      expect(store.setListQuery).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'zzz', sort: 'lastActive' }),
      );
      // The rows are the server's answer; the text is not applied again here.
      expect(rowNames()).toEqual(['Alpha', 'Beta']);
    });

    it('keeps the date filter on the loaded rows', async () => {
      await available([
        session('old', 'Old', {
          lastActivityAt: NOW - 30 * DAY,
          organization: organization(),
        }),
        session('new', 'New', { organization: organization() }),
      ]);
      el<HTMLButtonElement>('[data-testid="session-date-toggle"]').click();
      render();
      const from = new Date(NOW - DAY);
      const pad = (n: number): string => String(n).padStart(2, '0');
      type(
        el<HTMLInputElement>('[data-testid="session-date-from"]'),
        `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      );
      render();

      expect(rowNames()).toEqual(['New']);
      expect(store.setListQuery).not.toHaveBeenCalled();
    });

    it('renders chips and the Organize action per row', async () => {
      await available([
        session('a', 'Alpha', {
          organization: organization({ priority: 'urgent' }),
        }),
      ]);

      expect(
        maybe('[data-testid="session-chip-priority"]')?.getAttribute(
          'aria-label',
        ),
      ).toBe('Priority: Urgent');
      // Chips sit beside the row button, never inside it.
      expect(
        maybe(
          'li[ptah-session-list-row] button ptah-session-organization-chips',
        ),
      ).toBeNull();
      expect(
        maybe('[data-testid="session-organize"]')?.getAttribute('aria-label'),
      ).toBe('Organize session: Alpha');

      // The title keeps the row's width: the actions align to the meta line,
      // which reserves room for them.
      const row = rows()[0];
      expect(row.querySelector('.session-row-actions')?.classList).toContain(
        'top-6',
      );
      expect(
        row.querySelector('[data-testid="session-row-meta"]')?.classList,
      ).toContain('pr-[92px]');
    });

    it('still renders the list when the store holds no list at all', async () => {
      // Regression (PR #623 E2E): an undefined list threw inside change
      // detection and aborted the whole shell render.
      await available(undefined);

      expect(maybe('ptah-session-filter-bar')).not.toBeNull();
      expect(list().textContent).toContain('No sessions yet');
    });

    it('offers no Organize action for a row without an organization record', async () => {
      await available([session('fork', 'Fresh fork')]);
      expect(maybe('[data-testid="session-organize"]')).toBeNull();
    });

    it('opens the editor for the row and closes it on `closed`', async () => {
      await available([
        session('a', 'Alpha', { organization: organization() }),
      ]);

      el<HTMLButtonElement>('[data-testid="session-organize"]').click();
      await settle();
      const dialog = maybe('[data-testid="session-organization-editor"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('Alpha');

      el<HTMLButtonElement>('[data-testid="session-org-close"]').click();
      render();
      expect(maybe('[data-testid="session-organization-editor"]')).toBeNull();
    });

    it('draws a header per status group', async () => {
      store.listQuery.set({ sort: 'lastActive', groupBy: 'status' });
      await available([
        session('a', 'Alpha', {
          organization: organization({ status: 'waiting' }),
        }),
        session('b', 'Beta', {
          organization: organization({ status: 'waiting' }),
        }),
        session('c', 'Gamma', { organization: organization() }),
      ]);

      const groups = all('[data-testid="session-group"]');
      expect(
        groups.map((g) => g.querySelector('h3 span')?.textContent?.trim()),
      ).toEqual(['Waiting', 'Active']);
      const header = groups[0].querySelector('h3');
      expect(header?.classList).toContain('sticky');
      expect(header?.classList).toContain('bg-surface-0');
      const groupList = groups[0].querySelector('ul');
      expect(groupList?.getAttribute('aria-labelledby')).toBe(header?.id);
      expect(
        groupList?.querySelectorAll('li[ptah-session-list-row]'),
      ).toHaveLength(2);
    });

    it('nests children under their parent when grouping by parent', async () => {
      store.listQuery.set({ sort: 'lastActive', groupBy: 'parent' });
      await available([
        session('p', 'Parent', { organization: organization() }),
        session('c', 'Child', {
          organization: organization({ parentSessionId: 'p' }),
        }),
        session('o', 'Other', { organization: organization() }),
      ]);

      expect(rowNames()).toEqual(['Parent', 'Child', 'Other']);
      const child = rows()[1];
      expect(child.getAttribute('data-depth')).toBe('1');
      expect(child.classList).toContain('ml-3');
      expect(child.querySelector('.sr-only')?.textContent).toContain(
        'Child session',
      );
      expect(maybe('[data-testid="session-group"]')).toBeNull();
    });

    it('says "No matching sessions" when server filters empty the list, and clears filters only', async () => {
      store.listQuery.set({
        status: ['done'],
        sort: 'priority',
        groupBy: 'status',
      });
      await available([]);

      expect(list().textContent).toContain('No matching sessions');
      el<HTMLButtonElement>(
        '[data-testid="previous-sessions-clear-filters"]',
      ).click();
      render();

      expect(store.setListQuery).toHaveBeenCalledWith({
        sort: 'priority',
        groupBy: 'status',
      });
      // The button left with the state: focus goes to the search.
      expect(document.activeElement).toBe(search());
    });
  });
});
