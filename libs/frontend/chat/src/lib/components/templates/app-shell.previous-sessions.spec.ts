/**
 * AppShellComponent hosts the previous-sessions modal instead of a session
 * sidebar (TASK_2026_679, plan component 10).
 *
 * Covered here: no sidebar chrome is left (Req 7.1); the navbar "Previous
 * sessions" button sits right after `New` in VS Code single layout only
 * (Req 1.3, F-1) and opens the modal by click, Enter and Space (Req 1.7); the
 * shell row is inert while the modal is open (DP-8); the modal is created per
 * open; it closes without a focus restore when a standalone surface replaces
 * the chat view (DP-9); the organization editor renders what
 * `SessionOrganizerService` shows; while the modal chunk loads or after it
 * fails, a stand-in surface outside the inert row offers Close (S1, D73).
 *
 * **How this is tested.** The REAL template and class render with every child
 * component left as an unknown element (`NO_ERRORS_SCHEMA`, imports reduced to
 * the retained-row directive), so no chat transcript, canvas or RPC bridge is
 * mounted. `PreviousSessionsDialogService` is the real root service, so the
 * open state, the opener and the focus restore are real. The fixture uses
 * `autoDetectChanges()` (D54): in the app the shell view is attached to
 * `ApplicationRef`, so the restore runs after the render that drops `inert`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApplicationRef,
  NO_ERRORS_SCHEMA,
  signal,
  type WritableSignal,
} from '@angular/core';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  type ComponentFixture,
  type DeferBlockFixture,
} from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  BootStatusService,
  ClaudeRpcService,
  LoggingService,
  RetainedViewDirective,
  SurfaceRouterService,
  ThemeService,
  VSCodeService,
} from '@ptah-extension/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { AppShellComponent } from './app-shell.component';
import { PreviousSessionsLoadStateComponent } from '../organisms/previous-sessions/previous-sessions-load-state.component';
import { PreviousSessionsModalComponent } from '../organisms/previous-sessions/previous-sessions-modal.component';
import { ChatStore } from '../../services/chat.store';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';
import { SessionListViewStore } from '../../services/session-list/session-list-view.store';
import { SessionRowActionsService } from '../../services/session-list/session-row-actions.service';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { AgentFollowUpQueueService } from '../../services/agent-follow-up-queue.service';
import { PreviousSessionsDialogService } from '../../services/session-list/previous-sessions-dialog.service';
import { SessionOrganizerService } from '../../services/session-list/session-organizer.service';

const SHELL_TEMPLATE = join(
  process.cwd(),
  'libs/frontend/chat/src/lib/components/templates/app-shell.component.html',
);

const BUTTON = '[data-testid="navbar-previous-sessions"]';
const MODAL = 'ptah-previous-sessions-modal';
const EDITOR = 'ptah-session-organization-editor';
/** Any accessible name for a sessions panel or session sidebar control. */
const SESSION_PANEL_NAME = /sessions? (panel|sidebar)/i;

interface Host {
  readonly isElectron: boolean;
  readonly layout: 'single' | 'grid';
}

interface OrganizerStub {
  readonly available: WritableSignal<boolean>;
  readonly isOpen: WritableSignal<boolean>;
  readonly session: WritableSignal<ChatSessionSummary | null>;
  readonly close: jest.Mock<void, []>;
}

describe('AppShellComponent — previous sessions (TASK_2026_679)', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let page: HTMLElement;
  let currentView: WritableSignal<string>;
  let layoutMode: WritableSignal<'single' | 'grid'>;
  let organizer: OrganizerStub;

  /**
   * `manualDefer` drives the defer blocks by hand and renders the real
   * load-state surface (Fix round P3); otherwise defer blocks play through.
   */
  function mount(
    host: Host,
    { manualDefer = false, realModal = false } = {},
  ): void {
    currentView = signal('chat');
    layoutMode = signal(host.layout);
    organizer = {
      available: signal(false),
      isOpen: signal(false),
      session: signal<ChatSessionSummary | null>(null),
      close: jest.fn<void, []>(),
    };

    TestBed.configureTestingModule({
      deferBlockBehavior: manualDefer
        ? DeferBlockBehavior.Manual
        : DeferBlockBehavior.Playthrough,
      providers: [
        {
          provide: AppStateManager,
          useValue: {
            currentView,
            layoutMode,
            thothFirstRunDismissed: signal(true),
            setCurrentView: jest.fn(),
            dismissThothFirstRun: jest.fn(),
            toggleLayoutMode: jest.fn(),
            requestNewCanvasSession: jest.fn(),
          },
        },
        {
          provide: VSCodeService,
          useValue: { isElectron: host.isElectron },
        },
        {
          provide: AuthStateService,
          useValue: {
            loadAuthStatus: () => Promise.resolve(),
            isLoaded: () => false,
            hasAnyAuth: () => true,
          },
        },
        {
          provide: SurfaceRouterService,
          useValue: { pendingSurface: () => null },
        },
        { provide: BootStatusService, useValue: { isBooting: signal(false) } },
        {
          provide: AgentMonitorStore,
          useValue: { shouldSuggestEditorPanel: () => false },
        },
        {
          provide: TabManagerService,
          useValue: {
            activeTab: signal(null),
            findTabBySessionId: () => null,
            workflowForSession: () => null,
          },
        },
        { provide: ClaudeRpcService, useValue: {} },
        {
          provide: ChatStore,
          useValue: {
            sessions: signal<readonly ChatSessionSummary[]>([]),
            currentSession: signal<ChatSessionSummary | null>(null),
            hasMoreSessions: signal(false),
            totalSessions: signal(0),
            isLoadingMoreSessions: signal(false),
          },
        },
        {
          provide: SessionListViewStore,
          useValue: {
            filteredSessions: signal<readonly ChatSessionSummary[]>([]),
            organizationAvailable: signal(false),
            listQuery: signal({ sort: 'lastActive' }),
            searchQuery: signal(''),
            dateFrom: signal(''),
            dateTo: signal(''),
            dateFilterOpen: signal(false),
            hasActiveFilters: signal(false),
            hasServerFilters: signal(false),
            hasClientFilters: signal(false),
          },
        },
        { provide: SessionRowActionsService, useValue: {} },
        {
          provide: SessionDisplayUtils,
          useValue: { formatRelativeDate: () => 'today' },
        },
        { provide: LoggingService, useValue: { error: jest.fn() } },
        {
          provide: ConfirmationDialogService,
          useValue: { isOpen: signal(false) },
        },
        {
          provide: SubagentTranscriptViewerService,
          useValue: { open: signal(false) },
        },
        { provide: SessionOrganizerService, useValue: organizer },
        // Created eagerly by the shell; covered by their own specs.
        { provide: KeyboardShortcutsService, useValue: {} },
        { provide: ClosedTabSessionEnderService, useValue: {} },
        { provide: AgentFollowUpQueueService, useValue: {} },
        { provide: ThemeService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(AppShellComponent, {
      set: {
        imports: manualDefer
          ? realModal
            ? [
                RetainedViewDirective,
                PreviousSessionsLoadStateComponent,
                PreviousSessionsModalComponent,
              ]
            : [RetainedViewDirective, PreviousSessionsLoadStateComponent]
          : [RetainedViewDirective],
        providers: [],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });

    fixture = TestBed.createComponent(AppShellComponent);
    fixture.autoDetectChanges();
    page = fixture.nativeElement as HTMLElement;
    document.body.appendChild(page);
    render();
  }

  /** Refresh the view and run the after-render hooks (focus moves). */
  function render(): void {
    fixture.detectChanges();
    TestBed.inject(ApplicationRef).tick();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    render();
  }

  const dialog = (): PreviousSessionsDialogService =>
    TestBed.inject(PreviousSessionsDialogService);
  const button = (): HTMLButtonElement | null =>
    page.querySelector<HTMLButtonElement>(BUTTON);
  /** The retained shell row: the navbar's row ancestor. */
  const shellRow = (): HTMLElement | null =>
    page.querySelector<HTMLElement>('.navbar')?.closest('.bg-surface-0') ??
    null;

  afterEach(() => {
    // Leave no modal open in the root service for the next test.
    dialog().close({ restoreFocus: false });
    fixture.destroy();
    page.remove();
  });

  describe('sidebar removal (Req 7.1)', () => {
    beforeEach(() => mount({ isElectron: false, layout: 'single' }));

    it('renders no session sidebar, sessions tab or resize handle', () => {
      expect(page.querySelector('aside')).toBeNull();
      expect(page.querySelector('ptah-sidebar-tab')).toBeNull();
      expect(page.querySelector('[role="separator"]')).toBeNull();
      // Neither the sessions tab toggle nor the width handle is named here.
      const names = Array.from(page.querySelectorAll('[aria-label]')).map(
        (element) => element.getAttribute('aria-label') ?? '',
      );
      expect(names.filter((name) => SESSION_PANEL_NAME.test(name))).toEqual([]);
      expect(page.querySelector('[id^="session-group-"]')).toBeNull();
    });

    it('keeps the sidebar markup out of the template source', () => {
      expect(existsSync(SHELL_TEMPLATE)).toBe(true);
      const source = readFileSync(SHELL_TEMPLATE, 'utf8');
      expect(source).not.toMatch(/<aside\b/);
      expect(source).not.toMatch(/<ptah-sidebar-tab\b/);
      expect(source).not.toContain('#shellRow');
    });
  });

  describe('navbar button placement (Req 1.3, F-1)', () => {
    it('sits directly after New in VS Code single layout', () => {
      mount({ isElectron: false, layout: 'single' });
      const previous = button();
      expect(previous).not.toBeNull();
      const popover = page.querySelector('ptah-native-popover');
      expect(
        popover?.querySelector('[aria-label="New Session"]'),
      ).not.toBeNull();
      expect(popover?.nextElementSibling).toBe(previous);
    });

    it('is a native dialog trigger named "Previous sessions"', () => {
      mount({ isElectron: false, layout: 'single' });
      const previous = button();
      expect(previous?.tagName).toBe('BUTTON');
      expect(previous?.type).toBe('button');
      expect(previous?.getAttribute('aria-label')).toBe('Previous sessions');
      expect(previous?.getAttribute('title')).toBe('Previous sessions');
      expect(previous?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(previous?.getAttribute('aria-expanded')).toBe('false');
      expect(previous?.hasAttribute('aria-controls')).toBe(false);
      expect(previous?.hasAttribute('data-previous-sessions-trigger')).toBe(
        true,
      );
      expect(
        previous?.querySelector('lucide-angular')?.getAttribute('aria-hidden'),
      ).toBe('true');
      expect(
        previous?.querySelector('span.icon-btn-label')?.textContent?.trim(),
      ).toBe('Previous sessions');
    });

    it('is absent in VS Code grid layout (the Rail footer carries it)', () => {
      mount({ isElectron: false, layout: 'grid' });
      expect(button()).toBeNull();
      // New stays in the navbar in grid layout (F-1).
      expect(page.querySelector('[aria-label="New Session"]')).not.toBeNull();
    });

    it('leaves the navbar when the layout switches to grid', async () => {
      mount({ isElectron: false, layout: 'single' });
      expect(button()).not.toBeNull();
      layoutMode.set('grid');
      await settle();
      expect(button()).toBeNull();
    });

    it('is absent in Electron', () => {
      mount({ isElectron: true, layout: 'single' });
      expect(button()).toBeNull();
    });
  });

  describe('opening (Req 1.7)', () => {
    beforeEach(() => mount({ isElectron: false, layout: 'single' }));

    it('opens the modal on click', async () => {
      const open = jest.spyOn(dialog(), 'open');
      button()?.click();
      await settle();
      expect(open).toHaveBeenCalledTimes(1);
      expect(dialog().isOpen()).toBe(true);
    });

    it.each([
      ['Enter', 'keydown'],
      [' ', 'keyup'],
    ])(
      'leaves %p to the native button activation, which opens the modal',
      async (key, type) => {
        const previous = button();
        if (!previous) throw new Error('navbar button missing');
        previous.focus();
        const event = new KeyboardEvent(type, {
          key,
          bubbles: true,
          cancelable: true,
        });
        previous.dispatchEvent(event);
        // Nothing on the path cancels the key, and the control is an enabled
        // native button, so the browser turns the key into a click.
        expect(event.defaultPrevented).toBe(false);
        expect(previous.disabled).toBe(false);
        const open = jest.spyOn(dialog(), 'open');
        previous.click();
        await settle();
        expect(open).toHaveBeenCalledTimes(1);
        expect(dialog().isOpen()).toBe(true);
      },
    );
  });

  describe('while open', () => {
    beforeEach(() => mount({ isElectron: false, layout: 'single' }));

    async function openFromButton(): Promise<HTMLButtonElement> {
      const previous = button();
      if (!previous) throw new Error('navbar button missing');
      previous.focus();
      previous.click();
      await settle();
      return previous;
    }

    it('creates the modal and makes the shell row inert (DP-8)', async () => {
      expect(page.querySelector(MODAL)).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(false);

      const previous = await openFromButton();

      expect(page.querySelector(MODAL)).not.toBeNull();
      // The modal is outside the inert row.
      expect(page.querySelector(MODAL)?.closest('[inert]')).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(true);
      expect(previous.closest('[inert]')).toBe(shellRow());
      expect(previous.getAttribute('aria-expanded')).toBe('true');
      expect(previous.getAttribute('aria-controls')).toBe(
        'previous-sessions-dialog',
      );
    });

    it('destroys the modal on close, drops inert and returns focus to the button', async () => {
      const previous = await openFromButton();

      dialog().close();
      await settle();

      expect(page.querySelector(MODAL)).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(false);
      expect(previous.getAttribute('aria-expanded')).toBe('false');
      expect(previous.hasAttribute('aria-controls')).toBe(false);
      expect(document.activeElement).toBe(previous);
    });

    it('creates a fresh modal on every open (DP-2)', async () => {
      await openFromButton();
      const first = page.querySelector(MODAL);
      dialog().close();
      await settle();
      await openFromButton();
      const second = page.querySelector(MODAL);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it('closes without a focus restore when a standalone surface replaces chat (DP-9)', async () => {
      await openFromButton();
      const close = jest.spyOn(dialog(), 'close');
      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      elsewhere.focus();

      currentView.set('settings');
      await settle();

      expect(close).toHaveBeenCalledWith({ restoreFocus: false });
      expect(dialog().isOpen()).toBe(false);
      expect(page.querySelector(MODAL)).toBeNull();
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('does not reopen or close anything on a standalone surface while closed', async () => {
      const close = jest.spyOn(dialog(), 'close');
      currentView.set('settings');
      await settle();
      expect(close).not.toHaveBeenCalled();
      expect(dialog().isOpen()).toBe(false);
    });
  });

  describe('modal chunk loading or failed (S1, D73)', () => {
    const SURFACE = '[data-testid="previous-sessions-load-state"]';
    const CLOSE = '[data-testid="previous-sessions-load-close"]';

    beforeEach(() =>
      mount(
        { isElectron: false, layout: 'single' },
        { manualDefer: true, realModal: true },
      ),
    );

    /** The Previous sessions block: the third @defer in the template. */
    async function previousSessionsBlock(): Promise<DeferBlockFixture> {
      const blocks = await fixture.getDeferBlocks();
      const block = blocks[2];
      if (!block) throw new Error('previous sessions @defer missing');
      return block;
    }

    async function openFromButton(): Promise<HTMLButtonElement> {
      const previous = button();
      if (!previous) throw new Error('navbar button missing');
      previous.focus();
      previous.click();
      await settle();
      return previous;
    }

    async function showState(
      state: DeferBlockState.Loading | DeferBlockState.Error,
    ): Promise<void> {
      await (await previousSessionsBlock()).render(state);
      await settle();
    }

    const surface = (): HTMLElement | null =>
      page.querySelector<HTMLElement>(SURFACE);
    const closeButton = (): HTMLButtonElement | null =>
      page.querySelector<HTMLButtonElement>(CLOSE);

    it('hands focus from Loading Close to the Complete modal search', async () => {
      await openFromButton();
      await showState(DeferBlockState.Loading);
      expect(document.activeElement).toBe(closeButton());

      await (await previousSessionsBlock()).render(DeferBlockState.Complete);
      await settle();

      const search = page.querySelector<HTMLInputElement>(
        '[data-previous-sessions-search]',
      );
      expect(surface()).toBeNull();
      expect(search).not.toBeNull();
      expect(document.activeElement).toBe(search);
    });

    it('does not focus a Loading Close destroyed before its first render callback', async () => {
      await openFromButton();
      const abandoned = TestBed.createComponent(
        PreviousSessionsLoadStateComponent,
      );
      abandoned.componentRef.setInput('state', 'loading');
      const focus = jest.spyOn(HTMLElement.prototype, 'focus');
      abandoned.destroy();
      render();
      expect(
        focus.mock.instances.some((element) => element.matches(CLOSE)),
      ).toBe(false);
      focus.mockRestore();
      expect(surface()).toBeNull();
    });

    it.each([
      ['Loading', DeferBlockState.Loading, 'Loading previous sessions...'],
      [
        'Error',
        DeferBlockState.Error,
        'Previous sessions could not load. Close this and reload the window to try again.',
      ],
    ] as const)(
      'renders a named dialog outside the inert row with focus on Close (%s)',
      async (_name, state, message) => {
        await openFromButton();
        await showState(state);

        const panel = surface()?.querySelector<HTMLElement>('[role="dialog"]');
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('aria-modal')).toBe('true');
        const titleId = panel?.getAttribute('aria-labelledby') ?? '';
        expect(document.getElementById(titleId)?.textContent?.trim()).toBe(
          'Previous sessions',
        );
        const messageId = panel?.getAttribute('aria-describedby') ?? '';
        expect(
          document
            .getElementById(messageId)
            ?.textContent?.replace(/\s+/g, ' ')
            .trim(),
        ).toBe(message);
        expect(surface()?.classList).toContain('z-[990]');
        expect(surface()?.closest('[inert]')).toBeNull();
        expect(shellRow()?.hasAttribute('inert')).toBe(true);
        expect(page.querySelector(MODAL)).toBeNull();
        expect(closeButton()?.getAttribute('aria-label')).toBe(
          'Close previous sessions',
        );
        expect(document.activeElement).toBe(closeButton());
        // No Retry: a failed defer load is cached per template.
        expect(surface()?.querySelectorAll('button')).toHaveLength(1);
      },
    );

    it.each([
      ['Loading', DeferBlockState.Loading],
      ['Error', DeferBlockState.Error],
    ] as const)(
      'Close closes, drops inert and returns focus to the navbar trigger (%s)',
      async (_name, state) => {
        const previous = await openFromButton();
        await showState(state);

        closeButton()?.click();
        await settle();

        expect(dialog().isOpen()).toBe(false);
        expect(surface()).toBeNull();
        expect(shellRow()?.hasAttribute('inert')).toBe(false);
        expect(document.activeElement).toBe(previous);
      },
    );

    it('Escape closes and does not propagate', async () => {
      const previous = await openFromButton();
      await showState(DeferBlockState.Error);
      const outside = jest.fn();
      document.addEventListener('keydown', outside);
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });

      closeButton()?.dispatchEvent(event);
      await settle();
      document.removeEventListener('keydown', outside);

      expect(outside).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(dialog().isOpen()).toBe(false);
      expect(surface()).toBeNull();
      expect(document.activeElement).toBe(previous);
    });

    it('keeps Tab on the Close button', async () => {
      await openFromButton();
      await showState(DeferBlockState.Loading);
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      closeButton()?.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(closeButton());
    });

    it('renders nothing for Loading or Error while the modal is closed', async () => {
      await showState(DeferBlockState.Loading);
      expect(surface()).toBeNull();
      await showState(DeferBlockState.Error);
      expect(surface()).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(false);
    });
  });

  describe('organization editor host', () => {
    const summary = {
      id: 'session-1',
      name: 'Build release',
    } as ChatSessionSummary;

    beforeEach(() => mount({ isElectron: false, layout: 'single' }));

    it('renders nothing on hosts without organization', async () => {
      organizer.isOpen.set(true);
      organizer.session.set(summary);
      await settle();
      expect(page.querySelector(EDITOR)).toBeNull();
    });

    it('renders the session the organizer shows and closes through it', async () => {
      organizer.available.set(true);
      await settle();
      expect(page.querySelector(EDITOR)).toBeNull();

      organizer.isOpen.set(true);
      organizer.session.set(summary);
      await settle();

      const editor = page.querySelector<
        HTMLElement & { session?: ChatSessionSummary | null }
      >(EDITOR);
      expect(editor?.session).toBe(summary);
      // Outside the shell row, so it stays usable over an inert row.
      expect(editor?.closest('.navbar')).toBeNull();

      editor?.dispatchEvent(new CustomEvent('closed'));
      expect(organizer.close).toHaveBeenCalledTimes(1);
    });
  });
});
