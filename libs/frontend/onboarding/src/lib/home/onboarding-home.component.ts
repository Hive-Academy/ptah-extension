import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { AppStateManager, ONBOARDING_QUERY } from '@ptah-extension/core';
import {
  BookOpen,
  CircleCheck,
  CircleDashed,
  FolderOpen,
  FolderPlus,
  ListChecks,
  LucideAngularModule,
  RefreshCw,
  Route,
  ScanSearch,
  Users,
  WandSparkles,
} from 'lucide-angular';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { ClaudeReadinessBannerComponent } from '../ready/claude-readiness-banner.component';
import { ClaudeReadinessStore } from '../ready/claude-readiness.store';
import { ReadyStripComponent } from '../ready/ready-strip.component';
import { readyStripSettingsWord } from '../ready/ready-strip-state';
import { onboardingStepLink } from '../shell/onboarding-step-link';
import { WorkspaceHeaderComponent } from '../shell/workspace-header.component';
import { OnboardingWorkspaceStore } from '../shell/onboarding-workspace.store';
import { AnalysisFoundCardComponent } from './analysis-found-card.component';
import { OnboardingPathTileComponent } from './path-tile.component';
import {
  OnboardingResumeStore,
  type OnboardingResumeItem,
} from './onboarding-resume.store';
import { ResumeBannerComponent } from './resume-banner.component';

const NO_WORKSPACE_REASON = 'Open a folder to use this path.';

/** A known status check shown as a chip on the Analyze tile. */
interface StatusChip {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
}

/**
 * Onboarding Home (`/onboarding`): the three paths and the way out.
 *
 * Status chips come from the shared `SetupStatusStore`. A failed status read
 * replaces only the chips ("Status unavailable" with Retry) and leaves the
 * tiles usable; no open workspace disables the tiles with an inline reason.
 */
@Component({
  selector: 'ptah-onboarding-home',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    OnboardingPathTileComponent,
    ReadyStripComponent,
    ClaudeReadinessBannerComponent,
    ResumeBannerComponent,
    WorkspaceHeaderComponent,
    AnalysisFoundCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'onboarding-home' },
  template: `
    <section aria-labelledby="onboarding-home-title">
      @if (readyAvailable) {
        <ptah-ready-strip
          class="mb-5"
          [current]="3"
          [claude]="readiness().state"
          [settings]="settingsWord()"
        />
      }
      <div class="flex items-center gap-3 max-[480px]:gap-2.5">
        <span
          class="grid size-11 flex-none place-items-center rounded-xl border border-base-300 bg-base-200 max-[480px]:size-[38px]"
          data-glass-surface="tile"
          aria-hidden="true"
        >
          <lucide-angular
            [img]="icons.route"
            class="size-[1.35rem]"
            aria-hidden="true"
          />
        </span>
        <h1
          id="onboarding-home-title"
          tabindex="-1"
          class="text-[1.7rem] font-semibold leading-tight tracking-tight outline-none max-[720px]:text-[1.35rem]"
        >
          Set up Ptah for your work
        </h1>
      </div>
      <p class="mt-2 max-w-[62ch] text-base-content-muted">
        Pick the situation you are in. Each path walks you through the steps and
        shows what is happening; you never need to read an agent transcript.
      </p>
      <ptah-workspace-header class="mt-5 block" [canSwitch]="true" />
      <ptah-analysis-found-card />

      @if (readyAvailable) {
        <ptah-claude-readiness-banner
          class="mt-5"
          placement="home"
          [state]="readiness().state"
        />
      }

      @if (resume.items().length > 0) {
        <div class="mt-5 grid gap-3" data-testid="onboarding-resume-banners">
          @for (item of resume.items(); track item.id) {
            <ptah-resume-banner
              [title]="item.title"
              [detail]="item.detail"
              (resumeRequested)="resumeItem(item)"
            />
          }
        </div>
      }

      @if (status.workspaceNotOpen()) {
        <div
          class="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200 px-4 py-3 text-sm"
          data-glass-surface="content"
          data-testid="onboarding-no-workspace"
        >
          <span>No folder is open. Open one to start a path.</span>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="onboarding-open-folder"
            (click)="openFolder()"
          >
            <lucide-angular
              [img]="icons.folderOpen"
              class="size-4"
              aria-hidden="true"
            />
            Open folder
          </button>
          @if (status.folderError(); as folderError) {
            <span class="text-state-err" role="alert">{{ folderError }}</span>
          }
        </div>
      }

      <div
        class="mt-6 grid grid-cols-1 gap-4 min-[721px]:grid-cols-[1.35fr_1fr] min-[721px]:grid-rows-2"
      >
        <ptah-onboarding-path-tile
          class="min-[721px]:row-span-2"
          testId="analyze"
          title="Analyze current project"
          description="Best when you already have code. Ptah reads your workspace, recommends agents, writes them and prepares project guidance."
          callToAction="Start analysis"
          [icon]="icons.scanSearch"
          [link]="analyzeLink"
          [primary]="true"
          [loading]="loading()"
          [disabledReason]="disabledReason()"
        >
          <ol class="grid gap-1.5 text-sm text-base-content-muted">
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="icons.scanSearch"
                class="size-4 text-base-content"
                aria-hidden="true"
              />
              Analyze workspace
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="icons.listChecks"
                class="size-4 text-base-content"
                aria-hidden="true"
              />
              Choose agents
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="icons.wandSparkles"
                class="size-4 text-base-content"
                aria-hidden="true"
              />
              Generate agents
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="icons.bookOpen"
                class="size-4 text-base-content"
                aria-hidden="true"
              />
              Project guidance
            </li>
          </ol>
          <button type="button" class="relative z-10 mt-2 w-fit text-sm link" (click)="analyzeAnotherProject()">Analyze another project</button>

          @if (statusUnavailable()) {
            <div
              class="relative z-10 flex flex-wrap items-center gap-2 text-xs"
              data-testid="onboarding-status-unavailable"
            >
              <span class="text-base-content-muted">Status unavailable</span>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                (click)="retryStatus()"
              >
                <lucide-angular
                  [img]="icons.refresh"
                  class="size-3.5"
                  aria-hidden="true"
                />
                Retry
              </button>
            </div>
          } @else if (chips().length > 0) {
            <ul
              class="flex flex-wrap gap-2"
              aria-label="Project status"
              data-testid="onboarding-status-chips"
            >
              @for (chip of chips(); track chip.id) {
                <li
                  class="inline-flex items-center gap-1.5 rounded-full border border-base-300 px-2.5 py-0.5 text-xs"
                  [class.text-state-done]="chip.done"
                  [class.text-state-idle]="!chip.done"
                  data-glass-surface="tile"
                >
                  <lucide-angular
                    [img]="chip.done ? icons.circleCheck : icons.circleDashed"
                    class="size-[1.1em]"
                    aria-hidden="true"
                  />
                  {{ chip.label }}
                </li>
              }
            </ul>
          }

          @if (!disabledReason()) {
            <p class="relative z-10 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <a
                class="link link-hover"
                [routerLink]="agentsOnlyLink.commands"
                [queryParams]="agentsOnlyLink.queryParams"
                data-testid="onboarding-link-agents-only"
                >Only generate agents</a
              >
              <a
                class="link link-hover"
                [routerLink]="guidanceOnlyLink.commands"
                [queryParams]="guidanceOnlyLink.queryParams"
                data-testid="onboarding-link-guidance-only"
                >Only regenerate guidance</a
              >
            </p>
          }
        </ptah-onboarding-path-tile>

        <ptah-onboarding-path-tile
          testId="new-project"
          title="New project"
          description="Answer five short questions and review a proposed agent, skill and toolchain setup."
          callToAction="Start a project"
          [icon]="icons.folderPlus"
          [link]="newProjectLink"
          [loading]="loading()"
          [disabledReason]="disabledReason()"
        />

        <ptah-onboarding-path-tile
          testId="team-builder"
          title="AI team builder"
          description="Describe the team you want and tune the proposed configuration with the agent."
          callToAction="Build a team"
          [icon]="icons.users"
          [link]="teamBuilderLink"
          [loading]="loading()"
          [disabledReason]="disabledReason()"
        />
      </div>

      <div
        class="mt-6 flex flex-wrap items-center justify-between gap-4 text-sm"
      >
        <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span class="text-base-content-muted">
            Reopen this anytime from the configuration menu: Setup.
          </span>
          @if (readyAvailable) {
            <a
              class="link"
              routerLink="/onboarding/ready"
              data-testid="onboarding-review-ready"
              >Review Claude Code and settings</a
            >
          }
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-testid="onboarding-skip"
          (click)="skip()"
        >
          Skip for now
        </button>
      </div>
    </section>
  `,
})
export class OnboardingHomeComponent {
  protected readonly status = inject(SetupStatusStore);
  private readonly flag = inject(OnboardingFlagService);
  private readonly appState = inject(AppStateManager);
  private readonly readinessStore = inject(ClaudeReadinessStore);
  protected readonly resume = inject(OnboardingResumeStore);
  private readonly router = inject(Router);
  private readonly workspace = inject(OnboardingWorkspaceStore);

  /** The Get ready strip, banner and footer link exist only in Electron. */
  protected readonly readyAvailable = this.readinessStore.available;
  protected readonly readiness = this.readinessStore.view;
  protected readonly settingsWord = computed(() =>
    readyStripSettingsWord(this.flag.flag().ready, true),
  );

  protected readonly icons = {
    route: Route,
    scanSearch: ScanSearch,
    listChecks: ListChecks,
    wandSparkles: WandSparkles,
    bookOpen: BookOpen,
    folderPlus: FolderPlus,
    folderOpen: FolderOpen,
    users: Users,
    circleCheck: CircleCheck,
    circleDashed: CircleDashed,
    refresh: RefreshCw,
  } as const;

  protected readonly analyzeLink = onboardingStepLink('analyze', 'analyze', {});
  protected readonly agentsOnlyLink = {
    commands: ['/onboarding', 'analyze', 'agents'],
    queryParams: { [ONBOARDING_QUERY.source]: 'catalog' },
  };
  protected readonly guidanceOnlyLink = onboardingStepLink(
    'guidance-only',
    'guidance-only',
    {},
  );
  protected readonly newProjectLink = onboardingStepLink(
    'new-project',
    'new-project',
    {},
  );
  protected readonly teamBuilderLink = onboardingStepLink(
    'team-builder',
    'team-builder',
    {},
  );

  /** Skeleton tiles until the first status answer for this workspace. */
  protected readonly loading = computed(
    () =>
      this.status.isLoading() &&
      this.status.status() === null &&
      !this.status.workspaceNotOpen(),
  );

  protected readonly disabledReason = computed(() =>
    this.status.workspaceNotOpen() ? NO_WORKSPACE_REASON : null,
  );

  protected readonly statusUnavailable = computed(
    () =>
      !this.status.workspaceNotOpen() &&
      (this.status.error() !== null || this.status.scanError() !== null),
  );

  /** The checks that are known; an unknown check shows no chip. */
  protected readonly chips = computed<readonly StatusChip[]>(() => {
    const chips: StatusChip[] = [];
    const scanned = this.status.scanReady();
    if (scanned !== null) {
      chips.push({
        id: 'scan',
        label: scanned ? 'Workspace analyzed' : 'Not analyzed yet',
        done: scanned,
      });
    }
    const agents = this.status.status();
    if (this.status.agentsReady() !== null && agents) {
      chips.push({
        id: 'agents',
        label: agents.isConfigured
          ? `${agents.agentCount} ${agents.agentCount === 1 ? 'agent' : 'agents'} set up`
          : 'No agents yet',
        done: agents.isConfigured,
      });
    }
    return chips;
  });

  constructor() {
    // The store refreshes on workspace changes itself; Home asks once more on
    // entry so the chips are current. Concurrent reads are de-duplicated.
    void this.status.refresh();
    // Re-read Claude Code on every visit so the banner is never stale; it
    // clears without a flag write once the read returns ready.
    if (this.readyAvailable) void this.readinessStore.refresh(false);
    effect(() => {
      const path = this.workspace.activePath();
      if (!path || !this.workspace.readyForActivePath()) {
        this.resume.clear();
        return;
      }
      void this.resume.refresh();
    });
  }

  protected resumeItem(item: OnboardingResumeItem): void {
    void this.router.navigate(['/onboarding', ...item.target.subPath], {
      queryParams: { ...item.target.queryParams },
    });
  }

  protected retryStatus(): void {
    void this.status.retry();
  }

  protected openFolder(): void {
    void this.status.openFolder();
  }

  protected async analyzeAnotherProject(): Promise<void> {
    const before = this.workspace.activePath();
    if (this.workspace.isElectron) await this.workspace.openFolder();
    else await this.status.openFolder();
    if (this.workspace.activePath() !== before) {
      void this.router.navigate(['/onboarding', 'analyze']);
    }
  }

  protected skip(): void {
    this.flag.markDismissed();
    this.appState.setCurrentView('chat');
  }
}
