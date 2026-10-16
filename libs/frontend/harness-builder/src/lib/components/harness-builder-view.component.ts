import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  SessionEmbedComponent,
  WorkflowBadgeComponent,
} from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
  SurfaceRouterService,
} from '@ptah-extension/core';
import { HarnessBuilderSidebarComponent } from './harness-builder-sidebar.component';
import {
  HarnessBuilderLeaveDialogComponent,
  type HarnessLeaveChoice,
  type HarnessLeaveContext,
} from './harness-builder-leave-dialog.component';
import {
  HarnessBuilderRecordsService,
  canonicalHarnessRoot,
  type HarnessBuilderMode,
} from '../services/harness-builder-records.service';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessProposalHydrationService } from '../services/harness-proposal-hydration.service';
import { HarnessWorkflowRequestService } from '../services/harness-workflow-request.service';
import { HarnessRpcService } from '../services/harness-rpc.service';

@Component({
  selector: 'ptah-harness-builder-view',
  standalone: true,
  imports: [
    SessionEmbedComponent,
    WorkflowBadgeComponent,
    HarnessBuilderSidebarComponent,
    HarnessBuilderLeaveDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        position: relative;
      }
    `,
  ],
  template: `
    @if (pageState() === 'missing' || pageState() === 'wrong') {
      <div class="flex h-full min-h-0 items-center justify-center p-4">
        <div
          role="status"
          class="surface-2 max-w-md rounded-lg p-5 text-center"
        >
          @if (pageState() === 'missing') {
            <h1 class="text-base font-semibold">
              This builder session is no longer open.
            </h1>
          } @else {
            <h1 class="text-base font-semibold">
              This session is not a
              {{ mode() === 'new-project' ? 'New Project' : 'AI Team Builder' }}
              session.
            </h1>
            <p class="mt-2 text-sm text-base-content-muted">
              It is open as a normal chat.
            </p>
            <button
              type="button"
              class="btn btn-outline btn-sm mt-4 mr-2"
              (click)="openChat()"
            >
              Open in chat
            </button>
          }
          <button
            type="button"
            class="btn btn-primary btn-sm mt-4"
            (click)="backToHub()"
          >
            Back to Setup Hub
          </button>
        </div>
      </div>
    } @else {
      <div class="shrink-0" [attr.inert]="dialogOpen() ? '' : null">
        <header
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2 min-[720px]:px-4 min-[720px]:py-3 border-b border-base-300 bg-base-100 shrink-0"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <h1 class="text-base font-bold text-base-content">
              {{
                mode() === 'new-project'
                  ? 'New Project Setup'
                  : 'AI Team Builder'
              }}
            </h1>
            <span class="min-[720px]:hidden"
              ><ptah-workflow-badge
                [workflow]="tab()?.workflow"
                variant="compact"
            /></span>
            <span class="hidden min-[720px]:inline"
              ><ptah-workflow-badge [workflow]="tab()?.workflow"
            /></span>
            @if (state.configSummary() !== 'No configuration yet') {
              <span
                class="hidden min-[720px]:inline text-xs text-base-content-muted"
                >{{ state.configSummary() }}</span
              >
            }
            @if (workspaceSwitched()) {
              <span
                role="status"
                class="badge badge-sm max-w-[200px] gap-1 truncate bg-warning/12 border-warning/45 text-state-need"
                title="You switched workspaces mid-build. This configuration will still be applied to the workspace this build started in."
                >Targeting {{ workspaceName() }}</span
              >
            }
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="btn btn-ghost btn-sm hidden min-[720px]:inline-flex"
              [attr.aria-expanded]="panelOpen()"
              aria-controls="builder-sidebar"
              [attr.aria-label]="
                panelOpen()
                  ? 'Hide configuration panel'
                  : 'Show configuration panel'
              "
              [class.btn-active]="panelOpen()"
              (click)="panelOpen.set(!panelOpen())"
            >
              {{ panelOpen() ? 'Hide panel' : 'Show panel' }}
            </button>
            <button
              #startOver
              type="button"
              class="btn btn-ghost btn-sm"
              aria-label="Start over: leave this workflow"
              (click)="requestStartOver(startOver)"
            >
              <span class="hidden min-[720px]:inline">Start over</span
              ><span class="min-[720px]:hidden" aria-hidden="true">↻</span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square"
              aria-label="Back to chat. This session keeps running."
              (click)="openChat()"
            >
              ×
            </button>
          </div>
        </header>
        @if (entryError()) {
          <div
            role="alert"
            class="shrink-0 border-b border-state-err/55 bg-error/10 px-4 py-2.5 text-xs"
          >
            <strong class="text-[13px]"
              >The first New Project message could not be sent</strong
            >
            <p>{{ entryError() }}</p>
            <button
              type="button"
              class="btn btn-outline btn-sm mt-2"
              [disabled]="retryingEntry()"
              (click)="retryEntry()"
            >
              {{ retryingEntry() ? 'Retrying…' : 'Retry message' }}
            </button>
          </div>
        }
        @if (draftNotice()) {
          <div
            role="status"
            class="shrink-0 border-b border-base-300 bg-surface-1 px-4 py-2.5 text-xs"
          >
            Draft resumed. The agent is paused. Send a message to continue.
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="draftNotice.set(false)"
            >
              Dismiss
            </button>
          </div>
        }
        @if (narrow()) {
          <button
            #peekButton
            type="button"
            class="flex shrink-0 min-h-11 w-full items-center gap-2 border-b border-base-300 bg-surface-1 px-4 py-1.5"
            aria-controls="builder-sidebar"
            [attr.aria-expanded]="sheetOpen()"
            (click)="toggleSheet()"
          >
            <span class="text-xs font-semibold">Configuration</span>
            <span class="text-[11px] text-base-content-muted">{{
              state.configSummary()
            }}</span>
            <span class="ml-auto" aria-hidden="true">{{
              sheetOpen() ? '⌃' : '⌄'
            }}</span>
          </button>
        }
      </div>
      <div class="relative flex flex-1 min-h-0 overflow-hidden">
        <main
          class="flex-1 min-w-0 min-h-0 overflow-hidden"
          [attr.inert]="dialogOpen() || (narrow() && sheetOpen()) ? '' : null"
          [attr.aria-hidden]="narrow() && sheetOpen() ? true : null"
        >
          <ptah-session-embed [tabId]="tabId()" chrome="bare" />
        </main>
        @if (!narrow() && panelOpen()) {
          <div
            class="h-full min-h-0 shrink-0 border-l border-base-300"
            [attr.inert]="dialogOpen() ? '' : null"
          >
            <ptah-harness-builder-sidebar
              [tabId]="tabId()"
              [workspaceRoot]="pinnedWorkspaceRoot()"
              [mode]="mode()"
              [initialized]="initialized()"
              [initError]="initError()"
              [agentBusy]="agentBusy()"
              [statsSnapshot]="tab()?.sessionStats ?? null"
              [liveModelStats]="tab()?.liveModelStats ?? null"
              (retrySetup)="initializeBuilder()"
            />
          </div>
        }
        @if (narrow() && sheetOpen()) {
          <div
            class="absolute inset-0 z-20 min-h-0 overflow-hidden bg-surface-1"
            [attr.inert]="dialogOpen() ? '' : null"
          >
            <ptah-harness-builder-sidebar
              [tabId]="tabId()"
              [workspaceRoot]="pinnedWorkspaceRoot()"
              [mode]="mode()"
              [initialized]="initialized()"
              [initError]="initError()"
              [agentBusy]="agentBusy()"
              [statsSnapshot]="tab()?.sessionStats ?? null"
              [liveModelStats]="tab()?.liveModelStats ?? null"
              [sheet]="true"
              (retrySetup)="initializeBuilder()"
            />
          </div>
        }
      </div>
      @if (dialogOpen()) {
        <ptah-harness-builder-leave-dialog
          [context]="leaveContext()"
          [mode]="mode()"
          [agentRunning]="agentBusy()"
          [sessionStarted]="!!tab()?.claudeSessionId"
          [saving]="leaving()"
          [saveFailed]="saveFailed()"
          [existingDraftAt]="existingDraftAt()"
          [trigger]="leaveTrigger()"
          (choice)="chooseLeave($event)"
        />
      }
    }
  `,
})
export class HarnessBuilderViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly tabs = inject(TabManagerService);
  private readonly router = inject(SurfaceRouterService);
  private readonly appState = inject(AppStateManager);
  private readonly rpc = inject(HarnessRpcService);
  private readonly chatRpc = inject(ClaudeRpcService);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly hydration = inject(HarnessProposalHydrationService);
  private readonly requests = inject(HarnessWorkflowRequestService);
  private readonly logger = inject(LoggingService);
  readonly state = inject(HarnessBuilderStateService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly peekButton =
    viewChild<ElementRef<HTMLButtonElement>>('peekButton');
  private readonly pinnedRoots = new Map<string, string>();
  private resizeObserver: ResizeObserver | null = null;
  private transition = false;
  private hydrationKey = '';
  private initKey = '';
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly mode = computed<HarnessBuilderMode>(() =>
    this.params().get('mode') === 'new-project'
      ? 'new-project'
      : 'configure-harness',
  );
  readonly tabId = computed(() => this.params().get('tabId') ?? '');
  readonly hostWidth = signal(960);
  readonly narrow = computed(() => this.hostWidth() < 720);
  readonly panelOpen = signal(true);
  readonly sheetOpen = signal(false);
  readonly initialized = signal(false);
  readonly initError = signal(false);
  readonly dialogOpen = signal(false);
  readonly leaving = signal(false);
  readonly saveFailed = signal(false);
  readonly retryingEntry = signal(false);
  readonly draftNotice = signal(false);
  readonly leaveContext = signal<HarnessLeaveContext>('start-over');
  readonly leaveTrigger = signal<HTMLElement | null>(null);
  readonly lookup = computed(() => {
    this.tabs.tabs();
    return this.tabId()
      ? this.tabs.findTabByIdAcrossWorkspaces(this.tabId())
      : null;
  });
  readonly tab = computed(() => this.lookup()?.tab ?? null);
  readonly pinnedWorkspaceRoot = computed(() => {
    const tabId = this.tabId();
    const lookup = this.lookup();
    if (!tabId || !lookup) return '';
    const known = this.pinnedRoots.get(tabId);
    if (known) return known;
    const root = lookup.workspacePath ?? this.requests.workspaceRoot;
    if (root) this.pinnedRoots.set(tabId, root);
    return root;
  });
  readonly pinnedRoot = computed(() =>
    canonicalHarnessRoot(this.pinnedWorkspaceRoot()),
  );
  readonly pageState = computed<'ready' | 'missing' | 'wrong'>(() => {
    const tab = this.tab();
    if (!tab) return 'missing';
    const expected =
      this.mode() === 'new-project'
        ? 'harness-new-project'
        : 'harness-configure';
    const validMode =
      this.params().get('mode') === 'configure-harness' ||
      this.params().get('mode') === 'new-project';
    return validMode && tab.workflow === expected && !!this.pinnedRoot()
      ? 'ready'
      : 'wrong';
  });
  readonly workspaceName = computed(
    () =>
      this.pinnedWorkspaceRoot().split(/[\\/]/).filter(Boolean).at(-1) ??
      'workspace',
  );
  readonly workspaceSwitched = computed(() => {
    this.tabs.tabs();
    return (
      this.pinnedRoot() !== canonicalHarnessRoot(this.requests.workspaceRoot)
    );
  });
  readonly agentBusy = computed(
    () =>
      this.tab()?.status === 'streaming' ||
      this.tabs.streamingTabIds().has(this.tabId()),
  );
  readonly entryError = computed(
    () => this.requests.entryErrors()[this.tabId()] ?? null,
  );
  readonly existingDraftAt = computed(() => {
    const draft = this.records.readDraft(this.pinnedRoot(), this.mode());
    return draft && draft.tabId !== this.tabId() ? 'an earlier session' : null;
  });

  constructor() {
    afterNextRender(() => {
      this.hostWidth.set(
        this.host.nativeElement.getBoundingClientRect().width || 960,
      );
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(([entry]) =>
          this.hostWidth.set(entry.contentRect.width),
        );
        this.resizeObserver.observe(this.host.nativeElement);
      }
    });
    effect(() => {
      if (!this.narrow() && this.sheetOpen()) this.sheetOpen.set(false);
    });
    effect(() => {
      if (this.pageState() !== 'ready') return;
      const root = this.pinnedRoot();
      const tabId = this.tabId();
      const sessionId = this.tab()?.claudeSessionId ?? '';
      const key = `${root}:${tabId}:${sessionId}`;
      if (key !== this.hydrationKey) {
        this.hydrationKey = key;
        void this.hydration.bind(
          this.pinnedWorkspaceRoot(),
          tabId,
          sessionId ? [sessionId] : [],
          this.records.readSnapshot(root, tabId),
        );
      }
      if (this.initKey !== `${root}:${tabId}`) {
        this.initKey = `${root}:${tabId}`;
        if (this.appState.layoutMode() === 'grid') {
          this.appState.requestCanvasTab(
            tabId,
            this.pinnedWorkspaceRoot(),
            this.mode() === 'new-project' ? 'New Project' : 'AI Team Builder',
          );
        }
        this.state.bindTab(this.pinnedWorkspaceRoot(), tabId);
        this.draftNotice.set(
          this.records.readDraft(root, this.mode())?.tabId === tabId,
        );
        void this.initializeBuilder();
      }
    });
    effect(() => {
      const intent = this.requests.pendingIntent();
      if (
        intent?.sourceTabId === this.tabId() &&
        this.pageState() === 'ready' &&
        !this.dialogOpen()
      ) {
        this.leaveContext.set(
          intent.targetMode === 'new-project' ? 'new-project' : 'switch',
        );
        this.dialogOpen.set(true);
      }
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (
      !this.transition &&
      this.dialogOpen() &&
      this.requests.pendingIntent()?.sourceTabId === this.tabId()
    ) {
      this.requests.cancelPendingIntent();
    }
  }
  async initializeBuilder(): Promise<void> {
    const root = this.pinnedRoot();
    const tabId = this.tabId();
    this.initError.set(false);
    try {
      const response = await this.rpc.initialize(this.pinnedWorkspaceRoot());
      if (!response.workspaceRoot) {
        throw new Error('Builder setup returned no workspace root');
      }
      if (
        this.pinnedRoot() !== root ||
        this.tabId() !== tabId ||
        canonicalHarnessRoot(response.workspaceRoot) !== root
      ) {
        throw new Error('Workspace changed during builder setup');
      }
      this.state.initialize(response);
      this.initialized.set(true);
    } catch (cause: unknown) {
      this.logger.error(
        'HarnessBuilderViewComponent',
        'Builder setup failed',
        cause instanceof Error ? cause : new Error(String(cause)),
      );
      this.initError.set(true);
      this.initialized.set(false);
    }
  }
  toggleSheet(): void {
    this.sheetOpen.update((open) => !open);
  }
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.sheetOpen() && !this.dialogOpen()) {
      this.sheetOpen.set(false);
      this.peekButton()?.nativeElement.focus();
    }
  }
  requestStartOver(trigger: HTMLElement): void {
    if (this.transition || this.dialogOpen()) return;
    this.leaveTrigger.set(trigger);
    this.leaveContext.set('start-over');
    this.dialogOpen.set(true);
  }
  async chooseLeave(choice: HarnessLeaveChoice): Promise<void> {
    if (this.transition) return;
    if (choice === 'cancel') {
      this.dialogOpen.set(false);
      this.saveFailed.set(false);
      this.requests.cancelPendingIntent();
      return;
    }
    this.transition = true;
    this.leaving.set(true);
    const root = this.pinnedRoot();
    const tabId = this.tabId();
    const oldDraft = this.records.readDraft(root, this.mode());
    try {
      if (choice === 'save') {
        if (
          !this.tab()?.claudeSessionId ||
          !this.records.replaceDraft(root, this.mode(), tabId)
        ) {
          this.saveFailed.set(true);
          return;
        }
      }
      if (
        this.tabs.activeWorkspacePath &&
        canonicalHarnessRoot(this.tabs.activeWorkspacePath) !== root
      ) {
        this.tabs.switchWorkspace(this.pinnedWorkspaceRoot());
      }
      const sessionId = this.tab()?.claudeSessionId;
      if (sessionId) {
        try {
          const result = await this.chatRpc.call('chat:abort', { sessionId });
          if (!result.success || result.data?.success === false)
            throw new Error('Chat abort failed');
        } catch (cause: unknown) {
          this.requests.reportAbortFailure(cause);
        }
      }
      this.tabs.markTabIdle(tabId);
      this.tabs.markLoaded(tabId);
      if (choice === 'discard') {
        this.tabs.resetTabToFresh(tabId);
        await this.tabs.closeTab(tabId);
        this.records.clearTab(root, tabId);
      }
      if (choice === 'save' && oldDraft && oldDraft.tabId !== tabId) {
        this.tabs.resetTabToFresh(oldDraft.tabId);
        await this.tabs.closeTab(oldDraft.tabId);
      }
      this.state.reset();
      this.dialogOpen.set(false);
      if (this.requests.pendingIntent()?.sourceTabId === tabId)
        await this.requests.completePendingIntent();
      else await this.backToHub();
    } catch (cause: unknown) {
      this.logger.error(
        'HarnessBuilderViewComponent',
        'Could not leave builder',
        cause instanceof Error ? cause : new Error(String(cause)),
      );
      this.saveFailed.set(true);
    } finally {
      this.transition = false;
      this.leaving.set(false);
    }
  }
  async retryEntry(): Promise<void> {
    if (this.retryingEntry()) return;
    this.retryingEntry.set(true);
    try {
      await this.requests.retryFirstSend(this.tabId());
    } catch (cause: unknown) {
      this.logger.error(
        'HarnessBuilderViewComponent',
        'Could not retry first message',
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    } finally {
      this.retryingEntry.set(false);
    }
  }
  async openChat(): Promise<void> {
    if (
      this.tabs.activeWorkspacePath &&
      canonicalHarnessRoot(this.tabs.activeWorkspacePath) !== this.pinnedRoot()
    ) {
      this.tabs.switchWorkspace(this.pinnedWorkspaceRoot());
    }
    if (this.tabId()) this.tabs.switchTab(this.tabId());
    await this.router.navigateToSurface('chat');
  }
  async backToHub(): Promise<void> {
    await this.router.navigateToSurface('setup-hub');
  }
}
