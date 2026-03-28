import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ChevronDown,
  ChevronUp,
  LucideAngularModule,
  Terminal,
} from 'lucide-angular';
import {
  ExecutionNodeComponent,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * AnalysisTranscriptComponent - Live agent transcript during analysis
 *
 * Purpose:
 * - Display streaming SDK messages in real-time during agentic workspace analysis
 * - Renders ExecutionNode tree from flat streaming events via ExecutionTreeBuilderService
 * - Provide an expand/collapse toggle to manage screen real estate
 * - Auto-scroll to bottom on new messages unless user has scrolled up
 * - Skeleton loading state when no events have arrived
 *
 * Architecture (TASK_2025_229):
 * - Backend emits FlatStreamEventUnion events via AnalysisStreamPayload.flatEvent
 * - SetupWizardStateService accumulates events into per-phase StreamingState maps
 * - This component calls buildTree() at render time via computed signal
 * - ExecutionNodeComponent handles recursive rendering of the tree
 *
 * Usage:
 * ```html
 * <ptah-analysis-transcript />
 * ```
 */
@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  imports: [LucideAngularModule, ExecutionNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-base-200 rounded-lg overflow-hidden h-full max-h-[70vh] flex flex-col"
    >
      <!-- Header with toggle -->
      <button
        type="button"
        class="w-full flex items-center justify-between p-3 hover:bg-base-300 transition-colors"
        [attr.aria-expanded]="isExpanded()"
        aria-controls="analysis-transcript-content"
        (click)="toggleExpanded()"
      >
        <span class="flex items-center gap-2">
          <lucide-angular
            [img]="TerminalIcon"
            class="w-4 h-4 text-primary"
            aria-hidden="true"
          />
          <span class="text-sm font-medium">Agent Transcript</span>
          <span class="badge badge-sm badge-ghost">
            {{ messageCount() }}
          </span>
        </span>
        <lucide-angular
          [img]="isExpanded() ? ChevronUpIcon : ChevronDownIcon"
          class="w-4 h-4 text-base-content/60"
          aria-hidden="true"
        />
      </button>

      <!-- Scrollable content -->
      @if (isExpanded()) {
        <div
          id="analysis-transcript-content"
          #scrollContainer
          class="overflow-y-auto flex-1 min-h-0 p-3 space-y-2 border-t border-base-300"
          (scroll)="onUserScroll()"
        >
          @for (phase of allPhaseTrees(); track phase.phaseKey) {
            @for (node of phase.nodes; track node.id) {
              <ptah-execution-node
                [node]="node"
                [isStreaming]="phase.isActive"
              />
            }
          } @empty {
            <div class="space-y-3 py-4">
              <div class="flex items-center gap-2">
                <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
                <div class="skeleton h-3 w-3/4"></div>
              </div>
              <div class="skeleton h-12 w-full rounded-md"></div>
              <div class="flex items-center gap-2">
                <div class="skeleton w-4 h-4 rounded-full shrink-0"></div>
                <div class="skeleton h-3 w-1/2"></div>
              </div>
              <div class="skeleton h-8 w-full rounded-md"></div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class AnalysisTranscriptComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  // Icons
  protected readonly TerminalIcon = Terminal;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ChevronDownIcon = ChevronDown;

  // UI state
  protected readonly isExpanded = signal(true);
  private readonly userHasScrolledUp = signal(false);
  protected readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  /** Message count for badge - use analysis stream length for continuity */
  protected readonly messageCount = computed(
    () => this.wizardState.analysisStream().length,
  );

  /**
   * Build execution trees for ALL phases (completed + active).
   * Each phase gets its own tree so users can see the full analysis history.
   */
  protected readonly allPhaseTrees = computed(() => {
    const statesMap = this.wizardState.phaseStreamingStates();
    const scanProgress = this.wizardState.scanProgress();
    const currentPhase = scanProgress?.currentPhase;
    const currentPhaseKey = currentPhase
      ? `wizard-phase-${currentPhase}`
      : null;

    const result: Array<{
      phaseKey: string;
      nodes: ReturnType<ExecutionTreeBuilderService['buildTree']>;
      isActive: boolean;
    }> = [];

    for (const [phaseKey, state] of statesMap) {
      if (state.events.size === 0) continue;
      result.push({
        phaseKey,
        nodes: this.treeBuilder.buildTree(state, phaseKey),
        isActive: phaseKey === currentPhaseKey,
      });
    }

    return result;
  });

  /** Whether the current phase is actively streaming */
  protected readonly isPhaseActive = computed(() => {
    const phaseStatuses = this.wizardState.phaseStatuses();
    if (!phaseStatuses || phaseStatuses.length === 0) return false;
    return phaseStatuses.some((s) => s.status === 'running');
  });

  public constructor() {
    // Auto-scroll effect: scroll to bottom when execution trees change
    // unless the user has manually scrolled up
    effect(() => {
      const phases = this.allPhaseTrees();
      if (phases.length === 0) return;

      if (!this.userHasScrolledUp()) {
        requestAnimationFrame(() => {
          const container = this.scrollContainer()?.nativeElement;
          if (container) {
            container.scrollTop = container.scrollHeight;
          }
        });
      }
    });
  }

  /** Toggle expand/collapse state */
  protected toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
    // Reset scroll tracking when re-expanding
    if (this.isExpanded()) {
      this.userHasScrolledUp.set(false);
    }
  }

  /** Handle user scroll to detect manual scroll-up */
  protected onUserScroll(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (!container) return;

    // Consider "scrolled to bottom" if within 30px of the bottom
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      30;

    this.userHasScrolledUp.set(!isAtBottom);
  }
}
