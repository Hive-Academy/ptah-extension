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
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronUp,
  Code,
  Info,
  LucideAngularModule,
  Terminal,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * Grouped message for display in the transcript.
 * Consecutive text messages are merged into a single display block
 * to reduce visual noise and improve readability.
 */
interface GroupedMessage {
  /** Display kind determines rendering style */
  kind: AnalysisStreamPayload['kind'];
  /** Accumulated content (merged for consecutive text messages) */
  content: string;
  /** Tool name when applicable */
  toolName?: string;
  /** Tool call ID for correlation */
  toolCallId?: string;
  /** Whether this is an error result */
  isError?: boolean;
  /** Timestamp of the first message in this group */
  timestamp: number;
}

/**
 * AnalysisTranscriptComponent - Live agent transcript during analysis
 *
 * Purpose:
 * - Display streaming SDK messages in real-time during agentic workspace analysis
 * - Show text output, tool calls, thinking previews, errors, and status messages
 * - Provide an expand/collapse toggle to manage screen real estate
 * - Auto-scroll to bottom on new messages unless user has scrolled up
 *
 * Features:
 * - Renders all 7 message kinds with distinct visual styling
 * - Consecutive text messages are merged into a single block
 * - Collapsible tool input JSON with truncation and show-more toggle
 * - Auto-scroll with user scroll detection
 * - DaisyUI styling consistent with the wizard theme
 * - Standalone component with OnPush change detection
 *
 * Usage:
 * ```html
 * <ptah-analysis-transcript />
 * ```
 */
@Component({
  selector: 'ptah-analysis-transcript',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-base-200 rounded-lg overflow-hidden">
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
        class="overflow-y-auto max-h-64 p-3 space-y-2 border-t border-base-300"
        (scroll)="onUserScroll()"
      >
        @for (item of groupedMessages(); track item.timestamp) { @switch
        (item.kind) { @case ('text') {
        <div class="bg-base-100 rounded-md px-3 py-2">
          <p
            class="text-sm font-mono whitespace-pre-wrap break-words text-base-content/80"
          >
            {{ item.content }}
          </p>
        </div>
        } @case ('tool_start') {
        <div class="flex items-center gap-2 py-1">
          <lucide-angular
            [img]="TerminalIcon"
            class="w-3.5 h-3.5 text-info shrink-0"
            aria-hidden="true"
          />
          <span class="badge badge-sm badge-info badge-outline">
            {{ item.toolName || 'tool' }}
          </span>
          <span class="text-xs text-base-content/50">started</span>
        </div>
        } @case ('tool_input') {
        <div class="bg-base-100 rounded-md overflow-hidden">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-base-content/60 hover:bg-base-200 transition-colors"
            (click)="toggleToolInput(item.timestamp)"
          >
            <lucide-angular
              [img]="CodeIcon"
              class="w-3 h-3 shrink-0"
              aria-hidden="true"
            />
            <span>{{ item.toolName || 'Input' }}</span>
            <lucide-angular
              [img]="
                isToolInputExpanded(item.timestamp)
                  ? ChevronUpIcon
                  : ChevronDownIcon
              "
              class="w-3 h-3 ml-auto"
              aria-hidden="true"
            />
          </button>
          @if (isToolInputExpanded(item.timestamp)) {
          <div class="px-3 pb-2">
            <pre
              class="text-xs font-mono text-base-content/70 whitespace-pre-wrap break-all max-h-40 overflow-y-auto"
              >{{ getToolInputContent(item) }}</pre
            >
            @if (item.content.length > 500) {
            <button
              type="button"
              class="text-xs text-primary hover:text-primary-focus mt-1"
              (click)="toggleFullToolInput(item.timestamp)"
            >
              {{
                isFullToolInputShown(item.timestamp) ? 'Show less' : 'Show more'
              }}
            </button>
            }
          </div>
          }
        </div>
        } @case ('tool_result') {
        <div
          class="flex items-center gap-2 py-1"
          [class.text-error]="item.isError"
        >
          <lucide-angular
            [img]="item.isError ? AlertTriangleIcon : TerminalIcon"
            class="w-3.5 h-3.5 shrink-0"
            [class.text-error]="item.isError"
            [class.text-success]="!item.isError"
            aria-hidden="true"
          />
          <span class="text-xs" [class.text-error]="item.isError">
            {{ item.toolName || 'tool' }}: {{ item.content }}
          </span>
        </div>
        } @case ('thinking') {
        <div class="flex items-start gap-2 py-1">
          <lucide-angular
            [img]="BrainIcon"
            class="w-3.5 h-3.5 text-secondary shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p class="text-xs italic text-base-content/50">{{ item.content }}</p>
        </div>
        } @case ('error') {
        <div class="alert alert-error py-2 px-3" role="alert">
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-4 h-4 shrink-0"
            aria-hidden="true"
          />
          <span class="text-xs">{{ item.content }}</span>
        </div>
        } @case ('status') {
        <div class="flex items-center gap-2 py-1">
          <lucide-angular
            [img]="InfoIcon"
            class="w-3.5 h-3.5 text-base-content/40 shrink-0"
            aria-hidden="true"
          />
          <span class="text-xs text-base-content/50">{{ item.content }}</span>
        </div>
        } } } @empty {
        <p class="text-xs text-base-content/40 text-center py-4">
          Waiting for agent messages...
        </p>
        }
      </div>
      }
    </div>
  `,
})
export class AnalysisTranscriptComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  /** Lucide icon references */
  protected readonly TerminalIcon = Terminal;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly BrainIcon = Brain;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly InfoIcon = Info;
  protected readonly CodeIcon = Code;

  /** Whether the transcript panel is expanded */
  readonly isExpanded = signal(true);

  /** Whether the user has manually scrolled up (disables auto-scroll) */
  private userHasScrolledUp = false;

  /** Track which tool input blocks are expanded */
  private readonly expandedToolInputs = signal<Set<number>>(new Set());

  /** Track which tool inputs show full content */
  private readonly fullToolInputs = signal<Set<number>>(new Set());

  /** Reference to the scrollable container element */
  readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  /** Total message count for the badge */
  protected readonly messageCount = computed(
    () => this.wizardState.analysisStream().length
  );

  /**
   * Grouped messages with consecutive text messages merged.
   * This reduces visual noise from high-frequency text_delta broadcasts.
   */
  protected readonly groupedMessages = computed<GroupedMessage[]>(() => {
    const raw = this.wizardState.analysisStream();
    if (raw.length === 0) return [];

    const grouped: GroupedMessage[] = [];
    let currentTextGroup: GroupedMessage | null = null;

    for (const msg of raw) {
      if (msg.kind === 'text') {
        if (currentTextGroup !== null) {
          // Merge consecutive text messages by appending content
          const merged: GroupedMessage = {
            kind: currentTextGroup.kind,
            content: currentTextGroup.content + msg.content,
            toolName: currentTextGroup.toolName,
            toolCallId: currentTextGroup.toolCallId,
            isError: currentTextGroup.isError,
            timestamp: currentTextGroup.timestamp,
          };
          currentTextGroup = merged;
          // Replace last item in grouped array
          grouped[grouped.length - 1] = merged;
        } else {
          // Start new text group
          currentTextGroup = {
            kind: 'text',
            content: msg.content,
            timestamp: msg.timestamp,
          };
          grouped.push(currentTextGroup);
        }
      } else {
        // Non-text message breaks the text group
        currentTextGroup = null;
        grouped.push({
          kind: msg.kind,
          content: msg.content,
          toolName: msg.toolName,
          toolCallId: msg.toolCallId,
          isError: msg.isError,
          timestamp: msg.timestamp,
        });
      }
    }

    return grouped;
  });

  constructor() {
    // Auto-scroll effect: scroll to bottom when new messages arrive
    // unless the user has manually scrolled up
    effect(() => {
      // Read the signal to track changes
      const messages = this.wizardState.analysisStream();
      if (messages.length === 0) return;

      // Only auto-scroll if user hasn't scrolled up
      if (!this.userHasScrolledUp) {
        // Use requestAnimationFrame to ensure DOM has updated
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
      this.userHasScrolledUp = false;
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

    this.userHasScrolledUp = !isAtBottom;
  }

  /** Toggle tool input expansion */
  protected toggleToolInput(timestamp: number): void {
    this.expandedToolInputs.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(timestamp)) {
        newSet.delete(timestamp);
      } else {
        newSet.add(timestamp);
      }
      return newSet;
    });
  }

  /** Check if a tool input is expanded */
  protected isToolInputExpanded(timestamp: number): boolean {
    return this.expandedToolInputs().has(timestamp);
  }

  /** Toggle showing full tool input content */
  protected toggleFullToolInput(timestamp: number): void {
    this.fullToolInputs.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(timestamp)) {
        newSet.delete(timestamp);
      } else {
        newSet.add(timestamp);
      }
      return newSet;
    });
  }

  /** Check if full tool input is shown */
  protected isFullToolInputShown(timestamp: number): boolean {
    return this.fullToolInputs().has(timestamp);
  }

  /**
   * Get the display content for a tool input, respecting truncation state.
   * Called from template with the item to determine if content should be truncated.
   */
  protected getToolInputContent(item: GroupedMessage): string {
    if (item.content.length <= 500) return item.content;
    if (this.fullToolInputs().has(item.timestamp)) return item.content;
    return item.content.substring(0, 500) + '...';
  }
}
