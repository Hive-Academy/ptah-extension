/**
 * AppShellComponent hosts the previous-sessions modal instead of a session
 * sidebar (TASK_2026_679, plan component 10).
 *
 * Covered here: no sidebar chrome is left (Req 7.1); the VS Code shell shows
 * the navbar and the canvas container only, with no tab bar, layout toggle,
 * navbar Previous sessions button or main chat view (TASK_2026_705); the
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
 * open state, the opener and the focus restore are real. The modal's only
 * opener is the canvas Rail footer button, which lives inside the canvas in
 * the retained row; the canvas is not mounted here, so a stand-in trigger
 * button is placed in the canvas container and the modal is opened through
 * `PreviousSessionsDialogService.open()` with that button focused. The fixture
 * uses `autoDetectChanges()` (D54): in the app the shell view is attached to
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
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { AgentFollowUpQueueService } from '../../services/agent-follow-up-queue.service';
import { PreviousSessionsDialogService } from '../../services/session-list/previous-sessions-dialog.service';
import { SessionOrganizerService } from '../../services/session-list/session-organizer.service';

const SHELL_TEMPLATE = join(
  __dirname,
  'app-shell.component.html',
);

/** The canvas content container (bare `ptahSurfaceActive`). */
const CANVAS_CONTAINER = '[ptahSurfaceActive]';
const MODAL = 'ptah-previous-sessions-modal';
const EDITOR = 'ptah-session-organization-editor';
/** Any accessible name for a sessions panel or session sidebar control. */
const SESSION_PANEL_NAME = /sessions? (panel|sidebar)/i;

interface Host {
  readonly isElectron: boolean;
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
  let requestNewCanvasSession: jest.Mock<void, [string]>;
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
    requestNewCanvasSession = jest.fn<void, [string]>();
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
            thothFirstRunDismissed: signal(true),
            setCurrentView: jest.fn(),
            dismissThothFirstRun: jest.fn(),
            requestNewCanvasSession,
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
  /**
   * Stand-in for the canvas Rail footer "Previous sessions" button: a trigger
   * inside the canvas container, so it sits in the retained row like the
   * real one. Created once per mount.
   */
  function railTrigger(): HTMLButtonElement {
    const existing = page.querySelector<HTMLButtonElement>(
      '[data-testid="rail-previous-sessions"]',
    );
    if (existing) return existing;
    const container = page.querySelector(CANVAS_CONTAINER);
    if (!container) throw new Error('canvas container missing');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('data-testid', 'rail-previous-sessions');
    trigger.setAttribute('data-previous-sessions-trigger', '');
    trigger.textContent = 'Previous sessions';
    container.appendChild(trigger);
    return trigger;
  }

  /** Focus the Rail stand-in and open the modal the way its click does. */
  async function openFromRail(): Promise<HTMLButtonElement> {
    const trigger = railTrigger();
    trigger.focus();
    dialog().open();
    await settle();
    return trigger;
  }

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
    beforeEach(() => mount({ isElectron: false }));

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

  describe('VS Code shell (TASK_2026_705)', () => {
    beforeEach(() => mount({ isElectron: false }));

    it('shows the navbar and the canvas container only', () => {
      const navbar = page.querySelector<HTMLElement>('.navbar');
      expect(navbar).not.toBeNull();
      expect(navbar?.classList).not.toContain('hidden');
      const container = page.querySelector<HTMLElement>(CANVAS_CONTAINER);
      expect(container).not.toBeNull();
      expect(container?.closest('.hidden')).toBeNull();
      // ORCHESTRA_CANVAS_COMPONENT is unbound here, so the spinner fallback is
      // the only content.
      expect(container?.querySelector('.loading-spinner')).not.toBeNull();
      expect(page.querySelectorAll(CANVAS_CONTAINER)).toHaveLength(1);
    });

    it('renders no tab bar, layout toggle, navbar Previous sessions or main chat view', () => {
      // Element tag names, upper-cased as the HTML DOM reports them.
      const tags = Array.from(page.querySelectorAll('*'), (el) => el.tagName);
      expect(tags).not.toContain('PTAH-TAB-BAR');
      expect(tags).not.toContain('PTAH-CHAT-VIEW');
      // The removed Canvas layout toggle was labelled after the canvas grid.
      expect(page.querySelector('[aria-label*="canvas grid" i]')).toBeNull();
      expect(
        page.querySelector('[data-testid="navbar-previous-sessions"]'),
      ).toBeNull();
      expect(
        page.querySelector('.navbar [aria-label="Previous sessions"]'),
      ).toBeNull();
    });

    it('labels the header "Orchestra Canvas"', () => {
      const navbar = page.querySelector<HTMLElement>('.navbar');
      const labels = Array.from(
        navbar?.querySelectorAll('span') ?? [],
        (span) => span.textContent?.trim(),
      );
      expect(labels).toContain('Orchestra Canvas');
    });

    it('creates a new session as a canvas tile', async () => {
      const create = Array.from(
        page.querySelectorAll<HTMLButtonElement>('ptah-native-popover button'),
      ).find((element) => element.textContent?.trim() === 'Create');
      if (!create) throw new Error('Create button missing');
      create.click();
      await settle();
      expect(requestNewCanvasSession).toHaveBeenCalledTimes(1);
      expect(requestNewCanvasSession).toHaveBeenCalledWith(
        expect.stringMatching(/\S/),
      );
    });
  });

  describe('Electron shell', () => {
    beforeEach(() => mount({ isElectron: true }));

    it('hides the header and keeps the canvas container visible', () => {
      expect(page.querySelector('.navbar')?.classList).toContain('hidden');
      const container = page.querySelector<HTMLElement>(CANVAS_CONTAINER);
      expect(container).not.toBeNull();
      expect(container?.closest('.hidden')).toBeNull();
    });
  });

  describe('while open', () => {
    beforeEach(() => mount({ isElectron: false }));

    it('creates the modal and makes the shell row inert (DP-8)', async () => {
      expect(page.querySelector(MODAL)).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(false);

      const trigger = await openFromRail();

      expect(page.querySelector(MODAL)).not.toBeNull();
      // The modal is outside the inert row.
      expect(page.querySelector(MODAL)?.closest('[inert]')).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(true);
      expect(trigger.closest('[inert]')).toBe(shellRow());
    });

    it('destroys the modal on close, drops inert and returns focus to the Rail trigger', async () => {
      const trigger = await openFromRail();

      dialog().close();
      await settle();

      expect(page.querySelector(MODAL)).toBeNull();
      expect(shellRow()?.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(trigger);
    });

    it('creates a fresh modal on every open (DP-2)', async () => {
      await openFromRail();
      const first = page.querySelector(MODAL);
      dialog().close();
      await settle();
      await openFromRail();
      const second = page.querySelector(MODAL);
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it('closes without a focus restore when a standalone surface replaces chat (DP-9)', async () => {
      await openFromRail();
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
      mount({ isElectron: false }, { manualDefer: true, realModal: true }),
    );

    /** The Previous sessions block: the second @defer in the template. */
    async function previousSessionsBlock(): Promise<DeferBlockFixture> {
      const blocks = await fixture.getDeferBlocks();
      const block = blocks[1];
      if (!block) throw new Error('previous sessions @defer missing');
      return block;
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
      await openFromRail();
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
      await openFromRail();
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
        await openFromRail();
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
      'Close closes, drops inert and returns focus to the Rail trigger (%s)',
      async (_name, state) => {
        const previous = await openFromRail();
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
      const previous = await openFromRail();
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
      await openFromRail();
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

    beforeEach(() => mount({ isElectron: false }));

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
