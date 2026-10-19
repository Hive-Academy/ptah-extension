import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  SessionEmbedComponent,
  type SessionStopHandler,
} from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { SurfaceRouterService } from '@ptah-extension/core';
import type { SetupGenerationWorkflow } from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { AgentGenerationStore } from '../services/agent-generation.store';
import { GenerationHandoffStore } from '../services/generation-handoff.store';
import { GuidanceGenerationStore } from '../services/guidance-generation.store';
import { GenerationGuidancePageComponent } from './generation-guidance-page.component';
import { GenerationErrorsComponent } from './generation-errors.component';
import { GenerationStopControlComponent } from './generation-stop-control.component';
import { GenerationAgentSidebarComponent } from './generation-agent-sidebar.component';

@Component({
  selector: 'ptah-generation-workflow-shell',
  standalone: true,
  imports: [
    SessionEmbedComponent,
    GenerationErrorsComponent,
    GenerationStopControlComponent,
    GenerationGuidancePageComponent,
    GenerationAgentSidebarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .workflow-sheet-open {
        animation: workflow-sheet-in 180ms var(--ptah-ease-soft) backwards;
      }
      @keyframes workflow-sheet-in {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .workflow-sheet-open {
          animation: none;
        }
      }
    `,
  ],
  template: `
    @if (binding(); as current) {
      <section
        class="flex h-full min-h-0 flex-col"
        aria-label="Generation workflow"
      >
        <div class="sr-only" role="status">
          {{
            current.workflow === 'setup-project-prompt'
              ? guidance.status()
              : store.state()
          }}
        </div>
        <header
          class="flex shrink-0 items-center gap-2 border-b border-base-300 bg-surface-1 px-4 py-2 text-sm"
        >
          <span class="font-semibold">{{
            current.workflow === 'setup-project-prompt'
              ? 'Project guidance'
              : 'Agent generation'
          }}</span>
          <span
            class="rounded border border-base-300 px-2 py-0.5 text-xs text-base-content-muted"
            aria-label="Workspace"
            >{{ workspaceName() }}</span
          >
          <span class="ml-auto text-xs text-base-content-muted">{{
            current.workflow === 'setup-project-prompt'
              ? guidance.status()
              : store.state()
          }}</span>
        </header>
        @if (narrow()) {
          <div
            class="flex shrink-0 items-stretch border-b border-base-300 bg-surface-1"
          >
            <button
              #peekButton
              type="button"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 py-1.5 text-left focus-visible:outline-base-content"
              aria-controls="wizard-sidebar"
              [attr.aria-expanded]="sheetOpen()"
              (click)="toggleSheet()"
            >
              <span class="truncate font-semibold">{{
                current.workflow === 'setup-project-prompt'
                  ? 'Project guidance'
                  : 'Agent generation'
              }}</span>
              <span class="truncate text-xs text-base-content-muted">{{
                current.workflow === 'setup-project-prompt'
                  ? guidance.status()
                  : store.state()
              }}</span>
              @if (needsAttention()) {
                <span class="badge badge-warning badge-sm shrink-0"
                  >Needs attention</span
                >
              }
              <span class="ml-auto" aria-hidden="true">{{
                sheetOpen() ? '⌃' : '⌄'
              }}</span>
            </button>
            @if (store.isBound()) {
              <button
                type="button"
                class="btn btn-square btn-sm m-1 shrink-0 border-base-content text-state-err"
                [attr.aria-label]="
                  store.state() === 'cancelling'
                    ? 'Stopping generation'
                    : store.state() === 'stop-unconfirmed'
                      ? 'Checking generation'
                      : 'Stop generation'
                "
                [attr.aria-disabled]="
                  store.state() === 'cancelling' ||
                  store.state() === 'stop-unconfirmed'
                    ? true
                    : null
                "
                [attr.aria-busy]="store.state() === 'cancelling' ? true : null"
                [disabled]="
                  store.state() === 'cancelling' ||
                  store.state() === 'stop-unconfirmed'
                "
                (click)="store.stop()"
              >
                {{ store.state() === 'cancelling' ? '◌' : '■' }}
              </button>
            }
          </div>
        }
        <div class="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            #sheet
            id="wizard-sidebar"
            class="min-h-0 overflow-y-auto border-l border-base-300 bg-surface-1 p-3 space-y-3"
            [style.width.px]="narrow() ? null : 336"
            [class.shrink-0]="!narrow()"
            [class.absolute]="narrow()"
            [class.inset-0]="narrow()"
            [class.z-20]="narrow()"
            [class.workflow-sheet-open]="narrow() && sheetOpen()"
            [class.hidden]="narrow() && !sheetOpen()"
            [attr.role]="narrow() ? 'dialog' : null"
            [attr.aria-modal]="narrow() && sheetOpen() ? 'true' : null"
            [attr.aria-label]="narrow() ? 'Generation workflow details' : null"
            [attr.tabindex]="narrow() ? -1 : null"
            (keydown)="onSheetKeydown($event)"
          >
            @if (current.workflow === 'setup-agent-generation') {
              <ptah-generation-agent-sidebar
                [binding]="current"
                [now]="now()"
              />
            }
            @if (current.workflow === 'setup-project-prompt') {
              <ptah-generation-guidance-page />
            }
            <ptah-generation-errors
              [errors]="
                agents.error()
                  ? ['The action could not be completed. Try again.']
                  : []
              "
            />
            <ptah-generation-stop-control
              [active]="store.isBound()"
              (stopRequested)="store.stop()"
            />
            @if (store.isBound()) {
              <p class="text-sm" role="status">
                Finish or stop generation before sending a message.
              </p>
            }
          </div>
          <ptah-session-embed
            class="order-first block min-h-0 min-w-0 flex-1"
            [tabId]="current.tabId"
            chrome="bare"
            [startGuard]="startGuard"
            [stopHandler]="stopHandler"
            [attr.inert]="narrow() && sheetOpen() ? '' : null"
            [attr.aria-hidden]="narrow() && sheetOpen() ? true : null"
          />
        </div>
      </section>
    } @else {
      <p role="alert">This generation tab is unavailable in this workspace.</p>
      <button type="button" class="btn btn-ghost btn-sm" (click)="backToChat()">
        Back to chat
      </button>
    }
  `,
})
export class GenerationWorkflowShellComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly peekButton =
    viewChild<ElementRef<HTMLButtonElement>>('peekButton');
  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private resizeObserver: ResizeObserver | null = null;
  readonly hostWidth = signal(960);
  readonly narrow = computed(() => this.hostWidth() < 720);
  readonly sheetOpen = signal(false);
  private readonly paramMap = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  backToChat(): void {
    void this.surfaceRouter.navigateToSurface('chat');
  }
  readonly store = inject(GenerationWorkflowStore);
  readonly agents = inject(AgentGenerationStore);
  readonly handoff = inject(GenerationHandoffStore);
  readonly guidance = inject(GuidanceGenerationStore);
  readonly needsAttention = computed(
    () =>
      !!this.store.rejection() ||
      !!this.store.chatTurnRejection() ||
      !!this.store.startError() ||
      (this.binding()?.workflow === 'setup-project-prompt'
        ? this.guidance.actionFailed()
        : this.agents.error()),
  );
  readonly workspaceName = computed(
    () =>
      this.binding()?.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ??
      'Workspace',
  );
  toggleSheet(): void {
    const opening = !this.sheetOpen();
    this.sheetOpen.set(opening);
    if (opening) {
      afterNextRender(
        () => {
          if (!this.sheetOpen()) return;
          const sheet = this.sheet()?.nativeElement;
          const first = sheet?.querySelector<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled])',
          );
          (first ?? sheet)?.focus();
        },
        { injector: this.injector },
      );
    }
  }
  onSheetKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && this.narrow() && this.sheetOpen()) {
      event.preventDefault();
      this.sheetOpen.set(false);
      this.peekButton()?.nativeElement.focus();
    }
  }
  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }
  private discoveryKey = '';
  private combinedTabId: string | null = null;
  private combinedBaselineRevision = 0;
  private discoveredTerminalRunId: string | null = null;
  protected readonly now = signal(Date.now());
  readonly hasVerifiedResults = computed(() => {
    const result = this.store.run()?.result;
    return !!(
      result?.counts &&
      result.agentOutcomes &&
      result.propagation &&
      result.rejectedSections !== undefined &&
      result.tailoredSections !== undefined
    );
  });
  readonly binding = computed(
    () => {
      this.tabs.tabs();
      const workspacePath = this.tabs.activeWorkspacePath$();
      const tabId = this.paramMap().get('tabId');
      const workflow = this.paramMap().get('workflow');
      if (
        !workspacePath ||
        !tabId ||
        (workflow !== 'setup-agent-generation' &&
          workflow !== 'setup-project-prompt')
      )
        return null;
      const tab = this.tabs
        .getWorkspaceTabs(workspacePath)
        .find(
          (candidate) =>
            candidate.id === tabId && candidate.workflow === workflow,
        );
      return tab
        ? {
            tabId,
            workspacePath,
            workflow: workflow as SetupGenerationWorkflow,
          }
        : null;
    },
    {
      equal: (a, b) =>
        a?.tabId === b?.tabId &&
        a?.workflow === b?.workflow &&
        a?.workspacePath === b?.workspacePath,
    },
  );
  readonly startGuard = () =>
    this.store.isBound()
      ? 'Finish or stop generation before sending a message.'
      : null;
  readonly stopHandler: SessionStopHandler = (tabId) => {
    if (this.binding()?.tabId !== tabId || !this.store.isBound())
      return 'not-handled';
    this.store.stop();
    return 'handled';
  };

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      this.hostWidth.set(element.getBoundingClientRect().width || 960);
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(([entry]) =>
          this.hostWidth.set(entry.contentRect.width),
        );
        this.resizeObserver.observe(element);
      }
    });
    let lastBindingKey: string | null = null;
    effect(() => {
      const binding = this.binding();
      const key = binding
        ? `${binding.workspacePath}\u0000${binding.tabId}\u0000${binding.workflow}`
        : null;
      if (key !== lastBindingKey) {
        lastBindingKey = key;
        this.sheetOpen.set(false);
      }
    });
    effect(() => {
      if (!this.narrow() && this.sheetOpen()) this.sheetOpen.set(false);
    });
    effect(() => {
      const binding = this.binding();
      if (binding) {
        this.store.bind(binding);
        if (binding.workflow === 'setup-project-prompt') {
          this.launcher.consumeOrigin(binding.tabId);
          this.guidance.bind(binding);
        } else this.guidance.unbind();
        const key = `${binding.workspacePath}\u0000${binding.tabId}\u0000${binding.workflow}`;
        if (
          binding.workflow === 'setup-agent-generation' &&
          key !== this.discoveryKey
        ) {
          this.discoveryKey = key;
          this.combinedTabId =
            this.launcher.consumeOrigin(binding.tabId) ===
            'analysis-result-continue'
              ? binding.tabId
              : null;
          this.combinedBaselineRevision =
            this.store.acceptedRun()?.revision ?? 0;
          void this.agents.discover();
          void this.agents.checkGuidance(binding.workspacePath);
        }
      } else {
        this.discoveryKey = '';
        this.combinedTabId = null;
        this.store.unbind();
        this.guidance.unbind();
      }
    });
    effect(() => {
      const run = this.store.run();
      if (run?.binding.workflow === 'setup-project-prompt') {
        untracked(() =>
          this.guidance.adopt(
            run,
            this.store.acceptedRun()?.runId === run.binding.runId,
          ),
        );
        if (
          ['completed', 'failed', 'cancelled', 'timed-out'].includes(run.status)
        )
          untracked(() => void this.guidance.refresh());
      }
      if (
        run?.binding.workflow === 'setup-agent-generation' &&
        ['completed', 'failed', 'cancelled', 'timed-out'].includes(
          run.status,
        ) &&
        run.binding.runId !== this.discoveredTerminalRunId
      ) {
        this.discoveredTerminalRunId = run.binding.runId;
        void this.agents.discover();
      }
    });
    effect(() => {
      const run = this.store.run();
      const accepted = this.store.acceptedRun();
      if (
        run &&
        run.binding.tabId === this.combinedTabId &&
        accepted?.runId === run.binding.runId &&
        accepted.revision > this.combinedBaselineRevision &&
        run.status === 'completed' &&
        this.hasVerifiedResults() &&
        this.combinedTabId !== null
      ) {
        this.combinedTabId = null;
        this.handoff.schedule(run.binding.tabId, run.binding.workspacePath);
      }
    });
    effect((onCleanup) => {
      if (!this.handoff.pending()) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 250);
      onCleanup(() => clearInterval(timer));
    });
  }
}
