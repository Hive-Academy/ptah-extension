/**
 * SetupHubComponent
 *
 * Premium configuration dashboard that surfaces both the Setup Wizard
 * (workspace analysis) and the AI Team Builder (multi-agent orchestration)
 * from a single entry point. Shown as a standalone view in both VS Code
 * and Electron apps.
 *
 * Layout:
 *   - Hero section with gradient background and decorative elements
 *   - Primary action cards (Workspace Analysis, AI Team Builder, New Project)
 *   - Two secondary info cards (Saved Presets, Active Configuration)
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  Wrench,
  FileText,
  Bookmark,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
  Rocket,
  Scale,
  X,
  PlayCircle,
} from 'lucide-angular';
import {
  ClaudeRpcService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import type {
  SetupStatusGetResponse,
  HarnessPreset,
  NewProjectAudience,
  NewProjectIntake,
  NewProjectPlatform,
  NewProjectStack,
} from '@ptah-extension/shared';
import {
  isNewProjectStack,
  stackOptionsForPlatform,
} from '@ptah-extension/shared';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessWorkflowService } from '../services/harness-workflow.service';
import {
  NEW_PROJECT_AUDIENCE_OPTIONS,
  NEW_PROJECT_PLATFORM_OPTIONS,
} from '../services/new-project-intake';

/**
 * The platform an intake means when it says nothing.
 *
 * The chip starts here and the payload OMITS it when it is still here, so a
 * user who never looks at the platform question sends exactly the payload they
 * sent before the question existed.
 */
const DEFAULT_PLATFORM: NewProjectPlatform = 'node-ts';

@Component({
  selector: 'ptah-setup-hub',
  standalone: true,
  imports: [LucideAngularModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      @keyframes icon-glow-pulse {
        0%,
        100% {
          box-shadow:
            0 0 12px oklch(var(--s) / 0.15),
            0 0 24px oklch(var(--s) / 0.05);
        }
        50% {
          box-shadow:
            0 0 20px oklch(var(--s) / 0.3),
            0 0 40px oklch(var(--s) / 0.1);
        }
      }

      @keyframes icon-glow-pulse-blue {
        0%,
        100% {
          box-shadow:
            0 0 12px rgba(37, 99, 235, 0.15),
            0 0 24px rgba(37, 99, 235, 0.05);
        }
        50% {
          box-shadow:
            0 0 20px rgba(37, 99, 235, 0.3),
            0 0 40px rgba(37, 99, 235, 0.1);
        }
      }

      @keyframes ring-pulse {
        0%,
        100% {
          opacity: 0.8;
        }
        50% {
          opacity: 1;
        }
      }

      @keyframes card-enter {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes dot-drift {
        0%,
        100% {
          transform: translate(0, 0);
        }
        50% {
          transform: translate(3px, -3px);
        }
      }

      @keyframes status-breathe {
        0%,
        100% {
          opacity: 0.5;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.3);
        }
      }

      .icon-glow {
        animation: icon-glow-pulse 3s ease-in-out infinite;
      }
      .icon-glow-blue {
        animation: icon-glow-pulse-blue 3s ease-in-out infinite;
      }
      .ring-pulse {
        animation: ring-pulse 2s ease-in-out infinite;
      }
      .card-enter {
        animation: card-enter 0.5s ease-out forwards;
        opacity: 0;
      }
      .card-enter-delay-1 {
        animation-delay: 0.1s;
      }
      .card-enter-delay-2 {
        animation-delay: 0.2s;
      }
      .card-enter-delay-3 {
        animation-delay: 0.3s;
      }
      .card-enter-delay-4 {
        animation-delay: 0.4s;
      }
      .dot-grid {
        animation: dot-drift 8s ease-in-out infinite;
      }
      .status-dot-breathe {
        animation: status-breathe 2s ease-in-out infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .icon-glow,
        .icon-glow-blue,
        .ring-pulse,
        .card-enter,
        .dot-grid,
        .status-dot-breathe {
          animation: none !important;
          opacity: 1 !important;
        }
      }
    `,
  ],
  template: `
    <!-- Header -->
    <header
      class="flex items-center justify-between px-6 py-3 border-b border-base-300 bg-base-100 shrink-0"
    >
      <div class="flex items-center gap-3">
        <button
          class="btn btn-ghost btn-sm btn-circle"
          (click)="goBack()"
          aria-label="Back to chat"
        >
          <lucide-angular
            [img]="ArrowLeftIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
        </button>
        <h1 class="text-base font-bold text-base-content">Setup Hub</h1>
      </div>
      <button
        class="btn btn-ghost btn-sm gap-1"
        (click)="refreshStatus()"
        [disabled]="isLoading()"
        aria-label="Refresh status"
      >
        <lucide-angular
          [img]="RefreshIcon"
          class="w-4 h-4"
          [class.animate-spin]="isLoading()"
          aria-hidden="true"
        />
        Refresh
      </button>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto p-6">
      <!-- Loading state -->
      @if (isLoading() && !hasLoadedOnce()) {
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <lucide-angular
              [img]="Loader2Icon"
              class="w-8 h-8 animate-spin text-primary mx-auto"
              aria-hidden="true"
            />
            <p class="mt-3 text-sm text-base-content-muted">
              Loading configuration status...
            </p>
          </div>
        </div>
      } @else {
        <!-- Error banner -->
        @if (loadError()) {
          <div class="alert alert-error mb-6">
            <lucide-angular
              [img]="AlertCircleIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            <span>{{ loadError() }}</span>
            <button class="btn btn-sm btn-ghost" (click)="refreshStatus()">
              Retry
            </button>
          </div>
        }

        <div class="max-w-4xl mx-auto">
          <!-- ═══ Hero Section ═══ -->
          <section
            class="relative overflow-hidden rounded-2xl border border-base-300/50 mb-8 card-enter"
          >
            <!-- Decorative: gold radial glow -->
            <div
              class="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-secondary/[0.06] blur-3xl pointer-events-none"
            ></div>
            <!-- Decorative: blue radial glow -->
            <div
              class="absolute -bottom-16 -left-16 w-48 h-48 rounded-full bg-primary/[0.04] blur-3xl pointer-events-none"
            ></div>
            <!-- Decorative: dot grid -->
            <div
              class="absolute inset-0 text-base-content opacity-[0.03] dot-grid pointer-events-none"
              style="background-image: radial-gradient(circle, currentColor 1px, transparent 1px); background-size: 24px 24px"
            ></div>

            <!-- Hero content -->
            <div
              class="relative z-10 px-8 py-10 bg-gradient-to-br from-base-200 via-base-200 to-base-300"
            >
              <div class="flex items-start justify-between">
                <div class="max-w-lg">
                  <h2 class="text-2xl font-bold text-base-content">
                    Configure Your Workspace
                  </h2>
                  <p
                    class="text-sm text-base-content-muted mt-2 leading-relaxed"
                  >
                    Analyze your workspace, assemble your AI team, or start a
                    brand-new project. Get AI-powered recommendations tailored
                    to your project.
                  </p>
                </div>
                <div
                  class="hidden md:block w-16 h-0.5 bg-gradient-to-r from-secondary/40 to-transparent mt-4"
                ></div>
              </div>
            </div>
          </section>

          <!-- ═══ Section: Quick Actions ═══ -->
          <div class="flex items-center gap-3 mb-4 mt-2">
            <span
              class="text-xs font-semibold uppercase tracking-wider text-base-content-muted"
              >Quick Actions</span
            >
            <div class="flex-1 h-px bg-base-300/50"></div>
          </div>

          <!-- Primary cards grid -->
          <div
            class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-2"
          >
            <!-- ── Card 1: Workspace Analysis ── -->
            <div
              class="group relative rounded-xl p-px cursor-pointer
                     bg-gradient-to-br from-secondary/20 via-base-300/50 to-secondary/10
                     hover:from-secondary/40 hover:via-secondary/15 hover:to-secondary/30
                     transition-all duration-300 ease-out
                     hover:shadow-[0_0_30px_oklch(var(--s)/0.08)]
                     card-enter card-enter-delay-1"
              (click)="openSetupWizard()"
              (keydown.enter)="openSetupWizard()"
              role="button"
              tabindex="0"
              aria-label="Open Workspace Analysis setup wizard"
            >
              <div
                class="rounded-[11px] bg-base-200 p-5 h-full flex flex-col gap-4
                       transition-colors duration-300 ease-out group-hover:bg-base-200/80"
              >
                <!-- Header row: icon + status -->
                <div class="flex items-start justify-between">
                  <div class="relative">
                    <div
                      class="absolute -inset-1 rounded-xl bg-secondary/10 blur-sm icon-glow"
                    ></div>
                    <div
                      class="relative w-11 h-11 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="SearchIcon"
                        class="w-5 h-5 text-secondary"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  @if (setupStatus()) {
                    <div class="flex items-center gap-2">
                      @if (setupStatus()!.isConfigured) {
                        <div class="relative flex items-center justify-center">
                          <span
                            class="w-2 h-2 rounded-full bg-success status-dot-breathe"
                          ></span>
                          <span
                            class="absolute w-2 h-2 rounded-full bg-success/30 animate-ping"
                          ></span>
                        </div>
                        <span class="text-xs font-medium text-success"
                          >Configured</span
                        >
                      } @else {
                        <span
                          class="w-2 h-2 rounded-full bg-base-content/20"
                        ></span>
                        <span
                          class="text-xs font-medium text-base-content-muted"
                          >Not configured</span
                        >
                      }
                    </div>
                  }
                </div>

                <!-- Title + description -->
                <div>
                  <h2 class="text-lg font-bold text-base-content">
                    Workspace Analysis
                  </h2>
                  <p class="text-sm text-base-content-muted mt-1">
                    Analyze your project and configure agents with AI-powered
                    recommendations.
                  </p>
                </div>

                <!-- Progress ring -->
                <div class="flex items-center gap-3 mt-1">
                  <svg
                    class="w-8 h-8 -rotate-90"
                    viewBox="0 0 32 32"
                    aria-hidden="true"
                  >
                    <circle
                      cx="16"
                      cy="16"
                      r="12"
                      fill="none"
                      stroke="currentColor"
                      class="text-base-300"
                      stroke-width="2.5"
                    />
                    <circle
                      cx="16"
                      cy="16"
                      r="12"
                      fill="none"
                      stroke="currentColor"
                      class="text-secondary ring-pulse"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      [attr.stroke-dasharray]="75.4"
                      [attr.stroke-dashoffset]="progressOffset()"
                    />
                  </svg>
                  <div class="flex flex-col">
                    <span class="text-xs font-semibold text-base-content">
                      {{ setupStatus()?.isConfigured ? '100%' : '0%' }}
                      Complete
                    </span>
                    <span class="text-[10px] text-base-content-muted">
                      {{
                        setupStatus()?.isConfigured
                          ? 'All systems configured'
                          : 'Setup required'
                      }}
                    </span>
                  </div>
                </div>

                <!-- Stats row -->
                @if (setupStatus()?.isConfigured) {
                  <div
                    class="flex items-center gap-3 text-xs text-base-content-muted pt-2 border-t border-base-300/30"
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="w-1 h-1 rounded-full bg-secondary/50"></span>
                      <span>{{ setupStatus()!.agentCount }} agents</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-1 h-1 rounded-full bg-primary/50"></span>
                      <span>{{ setupStatus()!.ruleCount }} rules</span>
                    </div>
                    @if (setupStatus()!.lastUpdated) {
                      <span class="ml-auto text-base-content-muted">{{
                        setupStatus()!.lastUpdated
                      }}</span>
                    }
                  </div>
                }

                <!-- CTA button -->
                <button
                  class="btn btn-sm w-full mt-auto gap-1
                         bg-gradient-to-r from-secondary/10 to-secondary/5
                         border border-secondary/20
                         hover:border-secondary/40 hover:from-secondary/20 hover:to-secondary/10
                         text-secondary font-medium transition-all duration-200"
                >
                  {{
                    setupStatus()?.isConfigured ? 'Reconfigure' : 'Get Started'
                  }}
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <!-- ── Card 2: Harness Builder ── -->
            <div
              class="group relative rounded-xl p-px cursor-pointer
                     bg-gradient-to-br from-primary/20 via-base-300/50 to-primary/10
                     hover:from-primary/40 hover:via-primary/15 hover:to-primary/30
                     transition-all duration-300 ease-out
                     hover:shadow-[0_0_30px_rgba(37,99,235,0.08)]
                     card-enter card-enter-delay-2"
              (click)="openHarnessBuilder()"
              (keydown.enter)="openHarnessBuilder()"
              role="button"
              tabindex="0"
              aria-label="Open AI Team Builder"
            >
              <div
                class="rounded-[11px] bg-base-200 p-5 h-full flex flex-col gap-4
                       transition-colors duration-300 ease-out group-hover:bg-base-200/80"
              >
                <!-- Header row: icon + status -->
                <div class="flex items-start justify-between">
                  <div class="relative">
                    <div
                      class="absolute -inset-1 rounded-xl bg-primary/10 blur-sm icon-glow-blue"
                    ></div>
                    <div
                      class="relative w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="WrenchIcon"
                        class="w-5 h-5 text-primary"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (hasClaudeMd()) {
                      <div class="relative flex items-center justify-center">
                        <span
                          class="w-2 h-2 rounded-full bg-success status-dot-breathe"
                        ></span>
                        <span
                          class="absolute w-2 h-2 rounded-full bg-success/30 animate-ping"
                        ></span>
                      </div>
                      <span class="text-xs font-medium text-success"
                        >Active</span
                      >
                    } @else {
                      <span
                        class="w-2 h-2 rounded-full bg-base-content/20"
                      ></span>
                      <span class="text-xs font-medium text-base-content-muted"
                        >No team yet</span
                      >
                    }
                  </div>
                </div>

                <!-- Title + description -->
                <div>
                  <h2 class="text-lg font-bold text-base-content">
                    AI Team Builder
                  </h2>
                  <p class="text-sm text-base-content-muted mt-1">
                    Design your AI team — agents, skills, and MCP tools — and
                    apply it to your workspace as CLAUDE.md, agents, and skills.
                  </p>
                </div>

                <!-- Status bar -->
                <div class="mt-1">
                  <div
                    class="flex items-center justify-between text-[10px] text-base-content-muted mb-1.5"
                  >
                    <span>Team status</span>
                    <span>{{ hasClaudeMd() ? 'Active' : 'Not created' }}</span>
                  </div>
                  <div
                    class="h-1 w-full rounded-full bg-base-300 overflow-hidden"
                  >
                    <div
                      class="h-full rounded-full transition-all duration-500 ease-out"
                      [class.w-full]="hasClaudeMd()"
                      [class.w-0]="!hasClaudeMd()"
                      [class.bg-primary]="hasClaudeMd()"
                      [class.bg-base-300]="!hasClaudeMd()"
                    ></div>
                  </div>
                </div>

                <!-- CTA button -->
                <button
                  class="btn btn-sm w-full mt-auto gap-1
                         bg-gradient-to-r from-primary/10 to-primary/5
                         border border-primary/20
                         hover:border-primary/40 hover:from-primary/20 hover:to-primary/10
                         text-primary font-medium transition-all duration-200"
                >
                  {{ hasClaudeMd() ? 'Edit AI Team' : 'Create AI Team' }}
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            <!-- ── Card 3: New Project ── -->
            <div
              class="group relative rounded-xl p-px cursor-pointer
                     bg-gradient-to-br from-secondary/20 via-base-300/50 to-secondary/10
                     hover:from-secondary/40 hover:via-secondary/15 hover:to-secondary/30
                     transition-all duration-300 ease-out
                     card-enter card-enter-delay-3"
              (click)="onNewProjectCardActivate()"
              (keydown.enter)="onNewProjectCardActivate()"
              role="button"
              tabindex="0"
              data-testid="new-project-card"
              [attr.aria-label]="
                hasActiveNewProject()
                  ? 'Resume the New Project workflow already in progress'
                  : 'Start a new project with guided setup'
              "
            >
              <div
                class="rounded-[11px] bg-base-200 p-5 h-full flex flex-col gap-4
                       transition-colors duration-300 ease-out group-hover:bg-base-200/80"
              >
                <div class="flex items-start justify-between">
                  <div class="relative">
                    <div
                      class="relative w-11 h-11 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="RocketIcon"
                        class="w-5 h-5 text-secondary"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  @if (hasActiveNewProject()) {
                    <div class="flex items-center gap-2">
                      <div class="relative flex items-center justify-center">
                        <span
                          class="w-2 h-2 rounded-full bg-secondary status-dot-breathe"
                        ></span>
                        <span
                          class="absolute w-2 h-2 rounded-full bg-secondary/30 animate-ping"
                        ></span>
                      </div>
                      <span class="text-xs font-medium text-secondary">
                        {{ newProjectStatusLabel() }}
                      </span>
                    </div>
                  }
                </div>

                <div>
                  <h2 class="text-lg font-bold text-base-content">
                    New Project
                  </h2>
                  <p class="text-sm text-base-content-muted mt-1">
                    @if (hasActiveNewProject()) {
                      A New Project workflow is already running in this
                      workspace. Pick up where you left off — starting again
                      would abandon it.
                    } @else {
                      Plan and scaffold a brand-new SaaS workspace with a
                      generated roadmap and its own AI team.
                    }
                  </p>
                </div>

                @if (hasActiveNewProject()) {
                  <button
                    class="btn btn-sm w-full mt-auto gap-1
                           bg-gradient-to-r from-secondary/20 to-secondary/10
                           border border-secondary/30
                           hover:border-secondary/50 hover:from-secondary/30 hover:to-secondary/20
                           text-secondary font-medium transition-all duration-200"
                    type="button"
                    data-testid="new-project-resume"
                    (click)="resumeNewProject(); $event.stopPropagation()"
                  >
                    <lucide-angular
                      [img]="PlayCircleIcon"
                      class="w-3.5 h-3.5"
                      aria-hidden="true"
                    />
                    Resume New Project
                  </button>
                } @else {
                  <button
                    class="btn btn-sm w-full mt-auto gap-1
                           bg-gradient-to-r from-secondary/10 to-secondary/5
                           border border-secondary/20
                           hover:border-secondary/40 hover:from-secondary/20 hover:to-secondary/10
                           text-secondary font-medium transition-all duration-200"
                    type="button"
                    data-testid="new-project-start"
                    (click)="openIntake(); $event.stopPropagation()"
                  >
                    Start New Project
                    <lucide-angular
                      [img]="ChevronRightIcon"
                      class="w-3.5 h-3.5"
                      aria-hidden="true"
                    />
                  </button>
                }
              </div>
            </div>

            <!-- ── Card 4: Tribunal ── -->
            <div
              class="group relative rounded-xl p-px cursor-pointer
                     bg-gradient-to-br from-accent/20 via-base-300/50 to-accent/10
                     hover:from-accent/40 hover:via-accent/15 hover:to-accent/30
                     transition-all duration-300 ease-out
                     card-enter card-enter-delay-4"
              (click)="conveneTribunal()"
              (keydown.enter)="conveneTribunal()"
              role="button"
              tabindex="0"
              aria-label="Convene a Tribunal"
            >
              <div
                class="rounded-[11px] bg-base-200 p-5 h-full flex flex-col gap-4
                       transition-colors duration-300 ease-out group-hover:bg-base-200/80"
              >
                <div class="flex items-start justify-between">
                  <div class="relative">
                    <div
                      class="relative w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="ScaleIcon"
                        class="w-5 h-5 text-accent"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 class="text-lg font-bold text-base-content">Tribunal</h2>
                  <p class="text-sm text-base-content-muted mt-1">
                    Put your AI vendors on one panel — run a Council, Forge, or
                    Race and compare them side by side.
                  </p>
                </div>

                <button
                  class="btn btn-sm w-full mt-auto gap-1
                         bg-gradient-to-r from-accent/10 to-accent/5
                         border border-accent/20
                         hover:border-accent/40 hover:from-accent/20 hover:to-accent/10
                         text-accent font-medium transition-all duration-200"
                >
                  Convene a Tribunal
                  <lucide-angular
                    [img]="ChevronRightIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
          </div>

          <!-- ═══ Section: Configuration ═══ -->
          <div class="flex items-center gap-3 mb-4 mt-8">
            <span
              class="text-xs font-semibold uppercase tracking-wider text-base-content-muted"
              >Configuration</span
            >
            <div class="flex-1 h-px bg-base-300/50"></div>
          </div>

          <!-- Secondary cards grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- ── Card 3: Saved Presets ── -->
            <div
              class="rounded-xl bg-base-200/60 border border-base-300/40 p-4
                     hover:border-base-300 hover:bg-base-200/80
                     transition-all duration-200 card-enter card-enter-delay-3"
            >
              <!-- Header row -->
              <div class="flex items-start justify-between mb-3">
                <div
                  class="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center"
                >
                  <lucide-angular
                    [img]="BookmarkIcon"
                    class="w-4 h-4 text-accent"
                    aria-hidden="true"
                  />
                </div>
                <div
                  class="px-2 py-0.5 rounded-full bg-base-300/50 text-[10px] font-medium text-base-content-muted"
                >
                  {{ presets().length }} saved
                </div>
              </div>

              <h3 class="text-sm font-semibold text-base-content">
                Saved Presets
              </h3>
              <p class="text-xs text-base-content-muted mt-1">
                Reusable AI team configurations for different workflows.
              </p>

              @if (presets().length > 0) {
                <div class="flex flex-col gap-1.5 mt-3">
                  @for (preset of presets().slice(0, 3); track preset.id) {
                    <div
                      class="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg
                             bg-base-100/50 border border-base-300/20"
                    >
                      <span
                        class="w-1 h-1 rounded-full bg-accent/50 shrink-0"
                      ></span>
                      <span
                        class="truncate font-medium text-base-content-muted"
                        >{{ preset.name }}</span
                      >
                    </div>
                  }
                  @if (presets().length > 3) {
                    <span
                      class="text-[10px] text-base-content-muted text-center mt-0.5"
                    >
                      +{{ presets().length - 3 }} more
                    </span>
                  }
                </div>
              } @else {
                <p class="text-xs text-base-content-muted italic mt-3">
                  No presets yet. Save an AI team configuration to create one.
                </p>
              }
            </div>

            <!-- ── Card 4: Active Configuration ── -->
            <div
              class="rounded-xl bg-base-200/60 border border-base-300/40 p-4
                     hover:border-base-300 hover:bg-base-200/80
                     transition-all duration-200 card-enter card-enter-delay-4"
            >
              <!-- Header row -->
              <div class="flex items-start justify-between mb-3">
                <div
                  class="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center"
                >
                  <lucide-angular
                    [img]="FileTextIcon"
                    class="w-4 h-4 text-info"
                    aria-hidden="true"
                  />
                </div>
                @if (hasClaudeMd()) {
                  <div
                    class="px-2 py-0.5 rounded-full bg-info/10 text-[10px] font-medium text-info"
                  >
                    CLAUDE.md
                  </div>
                }
              </div>

              <h3 class="text-sm font-semibold text-base-content">
                Active Configuration
              </h3>
              <p class="text-xs text-base-content-muted mt-1">
                Current workspace configuration files and settings.
              </p>

              <div class="flex flex-col gap-2 mt-3">
                <div class="flex items-center gap-2 text-xs">
                  <div
                    class="w-4 h-4 rounded-full flex items-center justify-center"
                    [class.bg-success/15]="hasClaudeMd()"
                    [class.bg-base-300/30]="!hasClaudeMd()"
                  >
                    <lucide-angular
                      [img]="hasClaudeMd() ? CheckCircleIcon : AlertCircleIcon"
                      class="w-3 h-3"
                      [class.text-success]="hasClaudeMd()"
                      [class.text-base-content-muted]="!hasClaudeMd()"
                      aria-hidden="true"
                    />
                  </div>
                  <span class="text-base-content-muted">
                    CLAUDE.md
                    {{ hasClaudeMd() ? 'present' : 'missing' }}
                  </span>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <div
                    class="w-4 h-4 rounded-full flex items-center justify-center"
                    [class.bg-success/15]="setupStatus()?.isConfigured"
                    [class.bg-base-300/30]="!setupStatus()?.isConfigured"
                  >
                    <lucide-angular
                      [img]="
                        setupStatus()?.isConfigured
                          ? CheckCircleIcon
                          : AlertCircleIcon
                      "
                      class="w-3 h-3"
                      [class.text-success]="setupStatus()?.isConfigured"
                      [class.text-base-content-muted]="
                        !setupStatus()?.isConfigured
                      "
                      aria-hidden="true"
                    />
                  </div>
                  <span class="text-base-content-muted">
                    Agent config
                    {{ setupStatus()?.isConfigured ? 'active' : 'pending' }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    </main>

    @if (showIntake()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-intake-title"
        data-testid="new-project-intake"
      >
        <div
          class="bg-base-100 border border-base-300 rounded-2xl shadow-2xl w-full max-w-xl max-h-full overflow-y-auto"
        >
          <div
            class="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-base-300/60"
          >
            <div>
              <h2
                id="new-project-intake-title"
                class="text-lg font-bold text-base-content"
              >
                Tell me about your project
              </h2>
              <p class="text-sm text-base-content-muted mt-1">
                A few answers up front so discovery starts from what you already
                know — not from scratch.
              </p>
            </div>
            <button
              class="btn btn-ghost btn-sm btn-circle shrink-0"
              type="button"
              (click)="closeIntake()"
              aria-label="Cancel new project"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          <div class="px-6 py-5 flex flex-col gap-5">
            <div>
              <label
                class="block text-sm font-medium text-base-content mb-1.5"
                for="intake-what"
              >
                What are you building?
                <span class="text-error" aria-hidden="true">*</span>
              </label>
              <textarea
                id="intake-what"
                class="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[92px]"
                placeholder="A scheduling tool for physiotherapy clinics — patients book online, clinicians manage availability, admins see billing."
                data-testid="intake-what"
                required
                [(ngModel)]="intakeWhat"
                (ngModelChange)="onIntakeWhatChange($event)"
              ></textarea>
            </div>

            <fieldset>
              <legend class="block text-sm font-medium text-base-content mb-2">
                Who is it for?
              </legend>
              <div class="flex flex-wrap gap-2">
                @for (option of audienceOptions; track option.value) {
                  <button
                    class="btn btn-sm rounded-full"
                    type="button"
                    [class.btn-primary]="audience() === option.value"
                    [class.btn-outline]="audience() !== option.value"
                    [attr.aria-pressed]="audience() === option.value"
                    [attr.data-testid]="'intake-audience-' + option.value"
                    (click)="selectAudience(option.value)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
            </fieldset>

            <div>
              <label
                class="block text-sm font-medium text-base-content mb-1.5"
                for="intake-constraints"
              >
                Must-haves / constraints
                <span class="text-base-content-muted font-normal"
                  >(optional)</span
                >
              </label>
              <textarea
                id="intake-constraints"
                class="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[72px]"
                placeholder="Must run on-premise, needs audit logs, launch in 6 weeks…"
                data-testid="intake-constraints"
                [(ngModel)]="intakeConstraints"
              ></textarea>
            </div>

            <fieldset>
              <legend class="block text-sm font-medium text-base-content mb-2">
                What platform is it built on?
              </legend>
              <div class="flex flex-wrap gap-2">
                @for (option of platformOptions; track option.value) {
                  <button
                    class="btn btn-sm rounded-full"
                    type="button"
                    [class.btn-primary]="platform() === option.value"
                    [class.btn-outline]="platform() !== option.value"
                    [attr.aria-pressed]="platform() === option.value"
                    [attr.data-testid]="'intake-platform-' + option.value"
                    (click)="selectPlatform(option.value)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
            </fieldset>

            <fieldset>
              <legend class="block text-sm font-medium text-base-content mb-2">
                Tech stack preference
              </legend>
              <div class="flex flex-wrap gap-2">
                @for (option of stackOptions(); track option.value) {
                  <button
                    class="btn btn-sm rounded-full"
                    type="button"
                    [class.btn-primary]="stack() === option.value"
                    [class.btn-outline]="stack() !== option.value"
                    [attr.aria-pressed]="stack() === option.value"
                    [attr.data-testid]="'intake-stack-' + option.value"
                    (click)="selectStack(option.value)"
                  >
                    {{ option.label }}
                  </button>
                }
              </div>
              @if (stack() === 'other') {
                <input
                  class="input input-bordered input-sm w-full mt-3 text-sm"
                  type="text"
                  placeholder="Which stack?"
                  aria-label="Describe your preferred stack"
                  data-testid="intake-stack-other"
                  [(ngModel)]="intakeStackOther"
                  (ngModelChange)="onStackOtherChange($event)"
                />
              }
            </fieldset>

            @if (intakeError()) {
              <div class="alert alert-error text-sm" role="alert">
                <span>{{ intakeError() }}</span>
              </div>
            }
          </div>

          <div
            class="flex items-center justify-end gap-2 px-6 py-4 border-t border-base-300/60 bg-base-200/40"
          >
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              (click)="closeIntake()"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary btn-sm gap-1"
              type="button"
              data-testid="intake-start"
              [disabled]="!canStartPlanning()"
              (click)="submitIntake()"
            >
              @if (isStarting()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Start planning
            </button>
          </div>
        </div>
      </div>
    }

    @if (showDiscardConfirm()) {
      <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-base-300/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-discard-title"
        data-testid="new-project-discard-confirm"
      >
        <div
          class="bg-base-100 border border-base-300 rounded-lg shadow-xl p-5 max-w-sm w-full"
        >
          <h2
            id="new-project-discard-title"
            class="text-base font-semibold text-base-content mb-2"
          >
            Discard the running AI Team Builder workflow?
          </h2>
          <p class="text-sm text-base-content-muted mb-4">
            An AI Team Builder workflow is still running. Starting a new project
            stops it and clears its transcript and configuration.
          </p>
          <div class="flex justify-end gap-2">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              (click)="cancelDiscard()"
            >
              Keep it running
            </button>
            <button
              class="btn btn-error btn-sm"
              type="button"
              data-testid="new-project-discard-confirm-button"
              (click)="confirmDiscardAndStart()"
            >
              Discard and start
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SetupHubComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly harnessRpc = inject(HarnessRpcService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly workflow = inject(HarnessWorkflowService);
  protected readonly SearchIcon = Search;
  protected readonly WrenchIcon = Wrench;
  protected readonly FileTextIcon = FileText;
  protected readonly BookmarkIcon = Bookmark;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly Loader2Icon = Loader2;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly CheckCircleIcon = CheckCircle2;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly RocketIcon = Rocket;
  protected readonly ScaleIcon = Scale;
  protected readonly XIcon = X;
  protected readonly PlayCircleIcon = PlayCircle;
  private readonly _isLoading = signal(false);
  private readonly _hasLoadedOnce = signal(false);
  private readonly _loadError = signal<string | null>(null);
  private readonly _setupStatus = signal<SetupStatusGetResponse | null>(null);
  private readonly _presets = signal<HarnessPreset[]>([]);

  readonly isLoading = this._isLoading.asReadonly();
  readonly hasLoadedOnce = this._hasLoadedOnce.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly setupStatus = this._setupStatus.asReadonly();
  readonly presets = this._presets.asReadonly();

  readonly hasClaudeMd = computed(
    () => this._setupStatus()?.hasClaudeConfig ?? false,
  );

  // ==========================================================================
  // NEW PROJECT — intake + resume
  // ==========================================================================

  protected readonly audienceOptions = NEW_PROJECT_AUDIENCE_OPTIONS;
  protected readonly platformOptions = NEW_PROJECT_PLATFORM_OPTIONS;

  private readonly _showIntake = signal(false);
  private readonly _showDiscardConfirm = signal(false);
  private readonly _audience = signal<NewProjectAudience>('unsure');
  private readonly _platform = signal<NewProjectPlatform>(DEFAULT_PLATFORM);
  private readonly _stack = signal<NewProjectStack>('recommend');
  private readonly _isStarting = signal(false);
  private readonly _intakeError = signal<string | null>(null);
  /** Mirrors `intakeWhat` so the submit button's enablement is reactive. */
  private readonly _whatFilled = signal(false);
  private readonly _stackOtherFilled = signal(false);

  protected intakeWhat = '';
  protected intakeConstraints = '';
  protected intakeStackOther = '';

  readonly showIntake = this._showIntake.asReadonly();
  readonly showDiscardConfirm = this._showDiscardConfirm.asReadonly();
  readonly audience = this._audience.asReadonly();
  readonly platform = this._platform.asReadonly();
  readonly stack = this._stack.asReadonly();

  /**
   * The stack chips for the selected platform — the whole platform-to-stack
   * derivation, delegated to the registry.
   *
   * There is no local list to keep in step: picking `.NET` re-renders these
   * from `STACK_PROFILES`, and a platform with no profile (`Other`) falls back
   * to the two platform-independent chips.
   */
  readonly stackOptions = computed(() =>
    stackOptionsForPlatform(this.platform()),
  );
  readonly isStarting = this._isStarting.asReadonly();
  readonly intakeError = this._intakeError.asReadonly();

  /**
   * A New Project run is already claimed. Starting another would open a second
   * agent session against the same workspace, so the card offers Resume.
   */
  readonly hasActiveNewProject = computed(
    () =>
      this.workflow.isActive() && this.workflow.viewMode() === 'new-project',
  );

  readonly newProjectStatusLabel = computed(() =>
    this.workflow.isProcessing() ? 'Running' : 'In progress',
  );

  /**
   * A workflow in the OTHER mode holds the surface. Starting a New Project
   * would tear it down, so the user is asked first rather than having a
   * Configure Harness run vanish under them.
   */
  readonly hasConflictingWorkflow = computed(
    () =>
      this.workflow.isActive() && this.workflow.viewMode() !== 'new-project',
  );

  readonly canStartPlanning = computed(() => {
    if (this._isStarting()) return false;
    if (!this._whatFilled()) return false;
    if (this._stack() === 'other' && !this._stackOtherFilled()) return false;
    return true;
  });

  /** SVG progress ring offset: 0 = full circle, 75.4 = empty circle */
  readonly progressOffset = computed(() => {
    const circumference = 2 * Math.PI * 12; // 75.4
    const isConfigured = this._setupStatus()?.isConfigured ?? false;
    return isConfigured ? 0 : circumference;
  });

  ngOnInit(): void {
    this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    this._isLoading.set(true);
    this._loadError.set(null);

    try {
      const [statusResult, presetsResult] = await Promise.all([
        this.rpc.call('setup-status:get-status', {}),
        this.rpc.call('harness:load-presets', {}),
      ]);

      if (statusResult.isSuccess() && statusResult.data) {
        this._setupStatus.set(statusResult.data);
      }

      // Guard the shape: a reply without `presets` (malformed adapter, mocked
      // transport) must not leave the signal `undefined` — every
      // `presets().length` binding in the template would throw on each CD
      // pass and freeze the rest of this component's bindings.
      if (
        presetsResult.isSuccess() &&
        Array.isArray(presetsResult.data?.presets)
      ) {
        this._presets.set(presetsResult.data.presets);
      }

      this._hasLoadedOnce.set(true);
    } catch (err) {
      this._loadError.set(
        err instanceof Error
          ? err.message
          : 'Failed to load configuration status',
      );
    } finally {
      this._isLoading.set(false);
    }
  }

  openSetupWizard(): void {
    this.navigation.navigateToView('setup-wizard');
  }

  openHarnessBuilder(): void {
    this.navigation.navigateToView('harness-builder');
  }

  conveneTribunal(): void {
    this.navigation.navigateToView('tribunal');
  }

  /** Card body click: resume when one is running, otherwise collect intake. */
  onNewProjectCardActivate(): void {
    if (this.hasActiveNewProject()) {
      this.resumeNewProject();
      return;
    }
    this.openIntake();
  }

  resumeNewProject(): void {
    this.navigation.navigateToView('harness-builder');
  }

  openIntake(): void {
    this._intakeError.set(null);
    this._showIntake.set(true);
  }

  closeIntake(): void {
    this._showIntake.set(false);
  }

  protected onIntakeWhatChange(value: string): void {
    this._whatFilled.set(value.trim().length > 0);
  }

  protected onStackOtherChange(value: string): void {
    this._stackOtherFilled.set(value.trim().length > 0);
  }

  selectAudience(value: NewProjectAudience): void {
    this._audience.set(value);
  }

  /**
   * Pick a platform, and reset the stack answer with it.
   *
   * The reset is not optional: `aspnetcore-blazor` is meaningless once the user
   * switches back to Node, and leaving it selected would submit a stack that
   * has no chip on screen. `recommend` is in every profile's options, so it is
   * always a legal landing place.
   */
  selectPlatform(value: NewProjectPlatform): void {
    if (this._platform() === value) return;
    this._platform.set(value);
    this._stack.set('recommend');
    this.intakeStackOther = '';
    this._stackOtherFilled.set(false);
  }

  /**
   * Take a chip's value as the stack answer.
   *
   * Accepts `string` because that is what `StackOption.value` is — the registry
   * is plain data. `isNewProjectStack` is the one narrowing point, so a chip
   * whose value is not on the wire union is ignored rather than cast through.
   */
  selectStack(value: string): void {
    if (!isNewProjectStack(value)) return;
    this._stack.set(value);
    if (value !== 'other') {
      this.intakeStackOther = '';
      this._stackOtherFilled.set(false);
    }
  }

  /** Build the intake payload from the form. Null when it isn't complete. */
  private buildIntake(): NewProjectIntake | null {
    const what = this.intakeWhat.trim();
    if (!what) return null;
    const stack = this._stack();
    const stackOther = this.intakeStackOther.trim();
    if (stack === 'other' && !stackOther) return null;
    const constraints = this.intakeConstraints.trim();
    const platform = this._platform();

    return {
      what,
      audience: this._audience(),
      // Omitted at the default. Absence already means Node/TypeScript on the
      // wire, so a user who never touched the platform question sends the
      // payload they sent before the question existed — which is what keeps
      // the existing New Project e2e suite a valid regression bar.
      ...(platform === DEFAULT_PLATFORM ? {} : { platform }),
      stack,
      ...(constraints ? { constraints } : {}),
      ...(stack === 'other' ? { stackOther } : {}),
    };
  }

  async submitIntake(): Promise<void> {
    const intake = this.buildIntake();
    if (!intake || this._isStarting()) return;

    // A run in the other mode is about to be destroyed — get consent first.
    if (this.hasConflictingWorkflow()) {
      this._showDiscardConfirm.set(true);
      return;
    }
    await this.startNewProject(intake);
  }

  protected cancelDiscard(): void {
    this._showDiscardConfirm.set(false);
  }

  /**
   * The user accepted losing the Configure Harness run. Stop its agent and
   * release the surface BEFORE asking the backend to open the new workflow —
   * otherwise the open request races the still-claimed surface.
   */
  protected async confirmDiscardAndStart(): Promise<void> {
    this._showDiscardConfirm.set(false);
    const intake = this.buildIntake();
    if (!intake || this._isStarting()) return;

    this._isStarting.set(true);
    this._intakeError.set(null);
    try {
      await this.workflow.abortAndDispose();
    } catch (err: unknown) {
      this._intakeError.set(
        err instanceof Error
          ? `Could not stop the running workflow: ${err.message}`
          : 'Could not stop the running workflow',
      );
      this._isStarting.set(false);
      return;
    }
    this._isStarting.set(false);
    await this.startNewProject(intake);
  }

  private async startNewProject(intake: NewProjectIntake): Promise<void> {
    this._isStarting.set(true);
    this._intakeError.set(null);
    try {
      const result = await this.harnessRpc.startNewProject(intake);
      if (!result.success) {
        this._intakeError.set(result.error ?? 'Failed to start new project');
        return;
      }
      // The backend broadcast navigates to the builder; drop the modal so the
      // hub isn't left with a dialog over it when the user comes back.
      this._showIntake.set(false);
    } catch (err: unknown) {
      this._intakeError.set(
        err instanceof Error ? err.message : 'Failed to start new project',
      );
    } finally {
      this._isStarting.set(false);
    }
  }

  goBack(): void {
    this.navigation.navigateToView('chat');
  }
}
