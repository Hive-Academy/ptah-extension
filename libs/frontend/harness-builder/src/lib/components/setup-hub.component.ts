/**
 * SetupHubComponent
 *
 * Premium configuration dashboard that surfaces both the Setup Wizard
 * (workspace analysis) and the Harness Builder (multi-agent orchestration)
 * from a single entry point. Shown as a standalone view in both VS Code
 * and Electron apps.
 *
 * Layout:
 *   - Hero section with gradient background and decorative elements
 *   - Two prominent primary action cards (Workspace Analysis, Harness Builder)
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
} from 'lucide-angular';
import {
  ClaudeRpcService,
  WebviewNavigationService,
  AppStateManager,
} from '@ptah-extension/core';
import type {
  SetupStatusGetResponse,
  HarnessPreset,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-setup-hub',
  standalone: true,
  imports: [LucideAngularModule],
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
            0 0 12px rgba(212, 175, 55, 0.15),
            0 0 24px rgba(212, 175, 55, 0.05);
        }
        50% {
          box-shadow:
            0 0 20px rgba(212, 175, 55, 0.3),
            0 0 40px rgba(212, 175, 55, 0.1);
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
            <p class="mt-3 text-sm text-base-content/60">
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
              class="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#d4af37]/[0.06] blur-3xl pointer-events-none"
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
                  <p class="text-sm text-base-content/50 mt-2 leading-relaxed">
                    Set up workspace analysis and build multi-agent
                    orchestration harnesses. Get AI-powered recommendations
                    tailored to your project.
                  </p>
                </div>
                <div
                  class="hidden md:block w-16 h-0.5 bg-gradient-to-r from-[#d4af37]/40 to-transparent mt-4"
                ></div>
              </div>
            </div>
          </section>

          <!-- ═══ Section: Quick Actions ═══ -->
          <div class="flex items-center gap-3 mb-4 mt-2">
            <span
              class="text-xs font-semibold uppercase tracking-wider text-base-content/30"
              >Quick Actions</span
            >
            <div class="flex-1 h-px bg-base-300/50"></div>
          </div>

          <!-- Primary cards grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-2">
            <!-- ── Card 1: Workspace Analysis ── -->
            <div
              class="group relative rounded-xl p-px cursor-pointer
                     bg-gradient-to-br from-[#d4af37]/20 via-base-300/50 to-[#d4af37]/10
                     hover:from-[#d4af37]/40 hover:via-[#d4af37]/15 hover:to-[#d4af37]/30
                     transition-all duration-300 ease-out
                     hover:shadow-[0_0_30px_rgba(212,175,55,0.08)]
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
                      class="absolute -inset-1 rounded-xl bg-[#d4af37]/10 blur-sm icon-glow"
                    ></div>
                    <div
                      class="relative w-11 h-11 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="SearchIcon"
                        class="w-5 h-5 text-[#d4af37]"
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
                        <span class="text-xs font-medium text-base-content/40"
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
                  <p class="text-sm text-base-content/50 mt-1">
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
                      class="text-[#d4af37] ring-pulse"
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
                    <span class="text-[10px] text-base-content/40">
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
                    class="flex items-center gap-3 text-xs text-base-content/40 pt-2 border-t border-base-300/30"
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="w-1 h-1 rounded-full bg-[#d4af37]/50"></span>
                      <span>{{ setupStatus()!.agentCount }} agents</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="w-1 h-1 rounded-full bg-primary/50"></span>
                      <span>{{ setupStatus()!.ruleCount }} rules</span>
                    </div>
                    @if (setupStatus()!.lastUpdated) {
                      <span class="ml-auto text-base-content/30">{{
                        setupStatus()!.lastUpdated
                      }}</span>
                    }
                  </div>
                }

                <!-- CTA button -->
                <button
                  class="btn btn-sm w-full mt-auto gap-1
                         bg-gradient-to-r from-[#d4af37]/10 to-[#d4af37]/5
                         border border-[#d4af37]/20
                         hover:border-[#d4af37]/40 hover:from-[#d4af37]/20 hover:to-[#d4af37]/10
                         text-[#d4af37] font-medium transition-all duration-200"
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
              aria-label="Open Harness Builder wizard"
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
                      <span class="text-xs font-medium text-base-content/40"
                        >No harness</span
                      >
                    }
                  </div>
                </div>

                <!-- Title + description -->
                <div>
                  <h2 class="text-lg font-bold text-base-content">
                    Harness Builder
                  </h2>
                  <p class="text-sm text-base-content/50 mt-1">
                    Build multi-agent orchestration workflows with personas,
                    skills, and MCP servers.
                  </p>
                </div>

                <!-- Status bar -->
                <div class="mt-1">
                  <div
                    class="flex items-center justify-between text-[10px] text-base-content/40 mb-1.5"
                  >
                    <span>Harness status</span>
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
                  {{ hasClaudeMd() ? 'Edit Harness' : 'Create Harness' }}
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
              class="text-xs font-semibold uppercase tracking-wider text-base-content/30"
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
                  class="px-2 py-0.5 rounded-full bg-base-300/50 text-[10px] font-medium text-base-content/50"
                >
                  {{ presets().length }} saved
                </div>
              </div>

              <h3 class="text-sm font-semibold text-base-content">
                Saved Presets
              </h3>
              <p class="text-xs text-base-content/40 mt-1">
                Reusable harness configurations for different workflows.
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
                      <span class="truncate font-medium text-base-content/70">{{
                        preset.name
                      }}</span>
                    </div>
                  }
                  @if (presets().length > 3) {
                    <span
                      class="text-[10px] text-base-content/30 text-center mt-0.5"
                    >
                      +{{ presets().length - 3 }} more
                    </span>
                  }
                </div>
              } @else {
                <p class="text-xs text-base-content/30 italic mt-3">
                  No presets yet. Save a harness configuration to create one.
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
              <p class="text-xs text-base-content/40 mt-1">
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
                      [class.text-base-content/30]="!hasClaudeMd()"
                      aria-hidden="true"
                    />
                  </div>
                  <span class="text-base-content/50">
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
                      [class.text-base-content/30]="
                        !setupStatus()?.isConfigured
                      "
                      aria-hidden="true"
                    />
                  </div>
                  <span class="text-base-content/50">
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
  `,
})
export class SetupHubComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly appState = inject(AppStateManager);

  // Icons
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

  // State
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

      if (presetsResult.isSuccess() && presetsResult.data) {
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

  goBack(): void {
    this.navigation.navigateToView('chat');
  }
}
