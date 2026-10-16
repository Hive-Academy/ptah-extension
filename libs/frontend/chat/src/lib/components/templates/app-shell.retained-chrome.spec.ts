/**
 * The shell row (chat chrome and canvas) is retained, not re-created, across
 * standalone surfaces (TASK_2026_524 batch 3, 3a-T9…T11), and the work that
 * must go on while it is detached does go on.
 *
 * The row is the `<div>` carrying `*ptahRetainWhile="!isStandaloneView()"`. On a standalone
 * surface the row leaves the DOM and change detection, but its embedded view —
 * and with it the canvas and the canvas's component-scoped providers — lives
 * until the shell is destroyed. Notification processing is NOT in the row: it
 * is the root `NotificationLedgerService`, which the shell creates eagerly, and
 * its live region is rendered outside the row.
 *
 * **How this is tested.** Two halves, because the 800-line template cannot be
 * mounted without Monaco, the chat transcript and an RPC bridge:
 * - structural assertions on the REAL template: what is inside the row and
 *   what must stay outside it, by matching the row's `<div>` to its closing
 *   tag; and the directive in the REAL `imports`;
 * - a rendered round trip runs the REAL class, the REAL `AppStateManager` and
 *   Router, the REAL directive, the REAL bell and announcer and the REAL
 *   ledger, over a template reduced to the outlet wrapper, the announcer and
 *   the retained row hosting the canvas outlet and the bell.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  BootStatusService,
  ClaudeRpcService,
  ORCHESTRA_CANVAS_COMPONENT,
  RetainedViewDirective,
  SurfaceRouterService,
  ThemeService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  provideSurfaceRouterTesting,
  settleSurfaceNavigation,
} from '@ptah-extension/core/testing';
import {
  AgentMonitorStore,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import {
  ConfirmationDialogService,
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import {
  NotificationAnnouncerComponent,
  NotificationCenterComponent,
  NotificationLedgerService,
} from '@ptah-extension/notification-center';
import type { PermissionRequest } from '@ptah-extension/shared';
import { AppShellComponent } from './app-shell.component';
import { ChatStore } from '../../services/chat.store';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { AgentFollowUpQueueService } from '../../services/agent-follow-up-queue.service';

const TEMPLATES_DIR = join(
  process.cwd(),
  'libs/frontend/chat/src/lib/components/templates',
);
const SHELL_TEMPLATE = join(TEMPLATES_DIR, 'app-shell.component.html');
const SHELL_CLASS = join(TEMPLATES_DIR, 'app-shell.component.ts');
/** Longer than the ledger's 350 ms burst window. */
const AFTER_BURST_MS = 400;

/** Construction log for the stub canvas and its component-scoped provider. */
const log = {
  canvases: [] as StubCanvasComponent[],
  probes: 0,
};

/** Stands in for `CanvasStore`: provided on the canvas component itself. */
@Injectable()
class CanvasProbe {
  constructor() {
    log.probes++;
  }
}

@Component({
  selector: 'ptah-stub-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p class="stub-canvas">canvas</p>',
  providers: [CanvasProbe],
})
class StubCanvasComponent {
  readonly probe = inject(CanvasProbe);

  constructor() {
    log.canvases.push(this);
  }
}

/**
 * The real template's outlet wrapper, announcer and retained row, with the row
 * reduced to the canvas outlet and the bell it hosts. The bindings are copied
 * verbatim; the structural assertions below fail if the real template stops
 * carrying them or moves a child across the row boundary.
 */
const REDUCED_TEMPLATE = `
  <div class="h-full w-full" data-testid="outlet-wrapper" [class.hidden]="!isStandaloneView()">
    <router-outlet />
  </div>
  @if (!isElectron) {
    <ptah-notification-announcer />
  }
  <div *ptahRetainWhile="!isStandaloneView()" class="flex h-full bg-surface-0" data-testid="shell-row">
    <ng-container *ngComponentOutlet="orchestraCanvasComponent" />
    <ptah-notification-center />
  </div>
`;

const pulses = signal<readonly TerminalTurnPulse[]>([]);
const permissionRequests = signal<readonly PermissionRequest[]>([]);
/**
 * What the ledger announces for one completion plus one prompt. It is set in
 * the same burst callback that plays the sound, so seeing it proves the burst
 * fired.
 */
const BURST_ANNOUNCEMENT = '1 session finished; 1 need attention';

function pulse(seq: number): TerminalTurnPulse {
  return {
    seq,
    tabId: 'tab-1',
    sessionId: 'session-1',
    workspacePath: '/workspace/a',
    revision: seq,
    phase: 'idle',
    terminalReason: 'completed',
    lastAssistantMessage: null,
    classification: 'success',
    title: 'Build release',
    occurredAt: seq * 1000,
  };
}

const permission: PermissionRequest = {
  id: 'permission-1',
  toolName: 'Bash',
  toolInput: {},
  timestamp: 1,
  description: 'Run tests',
  timeoutAt: 0,
  sessionId: 'session-1',
};

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ClosedTabSessionEnderService, useValue: {} },
      // Created eagerly by the shell; covered by theme.service.spec.ts and
      // agent-follow-up-queue.service.spec.ts.
      { provide: ThemeService, useValue: {} },
      { provide: AgentFollowUpQueueService, useValue: {} },
      ...provideSurfaceRouterTesting(),
      AppStateManager,
      {
        provide: AuthStateService,
        useValue: {
          loadAuthStatus: jest.fn(() => Promise.resolve()),
          isLoaded: () => true,
          hasAnyAuth: () => true,
        },
      },
      { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: StubCanvasComponent },
      { provide: KeyboardShortcutsService, useValue: {} },
      { provide: SessionDisplayUtils, useValue: {} },
      { provide: ConfirmationDialogService, useValue: { confirm: jest.fn() } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: AgentMonitorStore, useValue: {} },
      {
        provide: TabManagerService,
        useValue: {
          activeTab: signal(null),
          terminalTurnPulses: pulses,
          takeTerminalTurnPulses: (): readonly TerminalTurnPulse[] => {
            const queued = pulses();
            pulses.set([]);
            return queued;
          },
          findTabByIdAcrossWorkspaces: (id: string) =>
            id === 'tab-1'
              ? {
                  tab: {
                    id: 'tab-1',
                    claudeSessionId: 'session-1',
                    title: 'Build release',
                  },
                  workspacePath: '/workspace/a',
                }
              : null,
          findTabBySessionIdAcrossWorkspaces: () => null,
        },
      },
      {
        provide: PermissionHandlerService,
        useValue: {
          permissionRequests,
          questionRequests: signal([]),
          routingTargetRevision: signal(0),
          targetTabsFor: () => ['tab-1'],
          questionTargetTabsFor: () => [],
        },
      },
      { provide: ChatStore, useValue: { sessions: signal([]) } },
      {
        provide: BootStatusService,
        useValue: { isBooting: signal(false), phase: signal('ready') },
      },
      {
        provide: VSCodeService,
        useValue: { isElectron: false, getPtahIconUri: () => '' },
      },
    ],
  });
  TestBed.overrideComponent(AppShellComponent, {
    set: {
      template: REDUCED_TEMPLATE,
      imports: [
        RouterOutlet,
        NgComponentOutlet,
        RetainedViewDirective,
        NotificationCenterComponent,
        NotificationAnnouncerComponent,
      ],
      providers: [],
    },
  });
}

/** Navigate, then let the navigation, the effects and both render passes land. */
async function navigate(
  fixture: ComponentFixture<AppShellComponent>,
  surface: Parameters<SurfaceRouterService['navigateToSurface']>[0],
): Promise<void> {
  await TestBed.inject(SurfaceRouterService).navigateToSurface(surface);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

/** Let the burst timer fire and the announcer re-render. */
async function afterBurst(
  fixture: ComponentFixture<AppShellComponent>,
): Promise<void> {
  await fixture.whenStable();
  await new Promise<void>((resolve) => setTimeout(resolve, AFTER_BURST_MS));
  await fixture.whenStable();
}

function query(
  fixture: ComponentFixture<AppShellComponent>,
  selector: string,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(selector);
}

function byTestId(
  fixture: ComponentFixture<AppShellComponent>,
  testId: string,
): HTMLElement | null {
  return query(fixture, `[data-testid="${testId}"]`);
}

function liveRegionText(fixture: ComponentFixture<AppShellComponent>): string {
  return query(fixture, '[role="status"]')?.textContent?.trim() ?? '';
}

/** The structural directive that marks the retained shell row. */
const SHELL_ROW_MARKER = '*ptahRetainWhile';

/**
 * Source span of the element carrying `*ptahRetainWhile`, from its `<div` to
 * its matching `</div>`, found by counting nested `<div>` open and close tags.
 */
function shellRowSpan(html: string): { start: number; end: number } {
  const ref = html.indexOf(SHELL_ROW_MARKER);
  if (ref < 0) throw new Error('the retained shell row was not found');
  // One retained row: a second marker would make the span ambiguous.
  if (html.indexOf(SHELL_ROW_MARKER, ref + 1) >= 0) {
    throw new Error('more than one *ptahRetainWhile row');
  }
  const start = html.lastIndexOf('<div', ref);
  const tags = /<div\b[^>]*>|<\/div\s*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    if (match[0].startsWith('</')) depth--;
    else if (!match[0].endsWith('/>')) depth++;
    if (depth === 0) return { start, end: match.index };
  }
  throw new Error('the retained shell row is never closed');
}

describe('AppShellComponent retained chrome row (TASK_2026_524 batch 3)', () => {
  describe('real template and class', () => {
    it('reads the real shell sources', () => {
      expect(existsSync(SHELL_TEMPLATE)).toBe(true);
      expect(existsSync(SHELL_CLASS)).toBe(true);
    });

    const html = existsSync(SHELL_TEMPLATE)
      ? readFileSync(SHELL_TEMPLATE, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
      : '';
    const source = existsSync(SHELL_CLASS)
      ? readFileSync(SHELL_CLASS, 'utf8')
      : '';
    const inRow = (marker: string): boolean => {
      const { start, end } = shellRowSpan(html);
      const at = html.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      return at > start && at < end;
    };

    it('retains the shell row with *ptahRetainWhile instead of hiding it with a class', () => {
      const { start } = shellRowSpan(html);
      const tag = html.slice(start, html.indexOf('>', start) + 1);
      expect(tag).toContain('*ptahRetainWhile="!isStandaloneView()"');
      expect(tag).not.toContain('[class.hidden]');
    });

    it('hosts the canvas outlet and the bell inside the retained row', () => {
      expect(inRow('*ngComponentOutlet="orchestraCanvasComponent"')).toBe(true);
      expect(inRow('<ptah-notification-center')).toBe(true);
    });

    it('keeps the outlet and the notification live region outside the row', () => {
      expect(inRow('<router-outlet')).toBe(false);
      expect(inRow('<ptah-notification-announcer')).toBe(false);
    });

    it('imports RetainedViewDirective and creates the notification ledger eagerly', () => {
      expect(source).toMatch(/imports:\s*\[[^\]]*\bRetainedViewDirective\b/);
      expect(source).toMatch(/=\s*inject\(NotificationLedgerService\)/);
    });

    it('creates the theme service and the agent follow-up queue eagerly', () => {
      // Both used to be reached only through components in the retained row,
      // which a standalone-first boot does not build and a standalone surface
      // detaches from change detection.
      expect(source).toMatch(/=\s*inject\(ThemeService\)/);
      expect(source).toMatch(/=\s*inject\(AgentFollowUpQueueService\)/);
    });
  });

  describe('rendered round trip', () => {
    beforeEach(() => {
      log.canvases = [];
      log.probes = 0;
      pulses.set([]);
      permissionRequests.set([]);
      configure();
    });

    afterEach(() => {
      TestBed.resetTestingModule();
      jest.restoreAllMocks();
    });

    it('T9: chat -> settings -> chat keeps one canvas and the same provider instance', async () => {
      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      await navigate(fixture, 'chat');

      expect(log.canvases).toHaveLength(1);
      const [canvas] = log.canvases;
      const canvasNode = byTestId(fixture, 'shell-row')?.querySelector(
        '.stub-canvas',
      );
      expect(canvasNode).toBeTruthy();

      await navigate(fixture, 'settings');
      await navigate(fixture, 'chat');
      await navigate(fixture, 'settings');
      await navigate(fixture, 'chat');

      expect(log.canvases).toEqual([canvas]);
      expect(log.probes).toBe(1);
      expect(log.canvases[0].probe).toBe(canvas.probe);
      const row = byTestId(fixture, 'shell-row');
      expect(row?.querySelector('.stub-canvas')).toBe(canvasNode);
      expect(row?.style.display).toBe('');
    });

    it('T10: on settings the row is out of the DOM and the outlet wrapper is shown', async () => {
      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      await navigate(fixture, 'chat');
      const row = byTestId(fixture, 'shell-row');
      expect(row).not.toBeNull();
      expect(byTestId(fixture, 'outlet-wrapper')?.classList).toContain(
        'hidden',
      );

      await navigate(fixture, 'settings');

      expect(byTestId(fixture, 'shell-row')).toBeNull();
      expect(document.contains(row)).toBe(false);
      expect(byTestId(fixture, 'outlet-wrapper')?.classList).not.toContain(
        'hidden',
      );
    });

    it('T11: with settings as the initial surface the canvas is built only on the first chat visit', async () => {
      await TestBed.inject(SurfaceRouterService).navigateToSurface('settings');
      await settleSurfaceNavigation();
      expect(TestBed.inject(AppStateManager).currentView()).toBe('settings');

      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(log.canvases).toHaveLength(0);
      expect(byTestId(fixture, 'shell-row')).toBeNull();

      await navigate(fixture, 'chat');

      expect(log.canvases).toHaveLength(1);
      expect(log.probes).toBe(1);
      expect(byTestId(fixture, 'shell-row')).not.toBeNull();
    });

    it('processes a completion and a prompt that arrive before the first chat visit', async () => {
      await TestBed.inject(SurfaceRouterService).navigateToSurface('settings');
      await settleSurfaceNavigation();
      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(byTestId(fixture, 'notification-center-bell')).toBeNull();

      pulses.set([pulse(1)]);
      permissionRequests.set([permission]);
      await afterBurst(fixture);

      // Drained and announced with no bell built anywhere.
      expect(pulses()).toEqual([]);
      expect(liveRegionText(fixture)).toBe(BURST_ANNOUNCEMENT);
      const ledger = TestBed.inject(NotificationLedgerService);
      expect(ledger.completionEntries()).toHaveLength(1);
      expect(ledger.unreadCount()).toBe(2);

      // The bell built on the first chat visit shows what was processed.
      await navigate(fixture, 'chat');
      expect(
        byTestId(fixture, 'notification-center-bell')?.getAttribute(
          'aria-label',
        ),
      ).toBe('Notifications, 2 unread');
    });

    it('processes a completion and a prompt that arrive while settings is shown', async () => {
      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      await navigate(fixture, 'chat');
      const bell = byTestId(fixture, 'notification-center-bell');
      expect(bell).not.toBeNull();

      await navigate(fixture, 'settings');
      expect(document.contains(bell)).toBe(false);

      pulses.set([pulse(1)]);
      permissionRequests.set([permission]);
      await afterBurst(fixture);

      expect(pulses()).toEqual([]);
      expect(liveRegionText(fixture)).toBe(BURST_ANNOUNCEMENT);
      expect(TestBed.inject(NotificationLedgerService).unreadCount()).toBe(2);

      await navigate(fixture, 'chat');
      expect(byTestId(fixture, 'notification-center-bell')).toBe(bell);
      expect(bell?.getAttribute('aria-label')).toBe('Notifications, 2 unread');
    });
  });
});
