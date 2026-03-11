import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { AnalysisStreamPayload } from '@ptah-extension/shared';
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Code,
  Info,
  LucideAngularModule,
  Terminal,
} from 'lucide-angular';
import { MarkdownModule } from 'ngx-markdown';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { ToolOutputFormatterService } from '../services/tool-output-formatter.service';

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
 * Groups tool_start + tool_input + tool_result into a single collapsible unit.
 * Identified by shared toolCallId.
 */
interface ToolCallGroup {
  kind: 'tool_group';
  toolCallId: string;
  toolName: string;
  messages: GroupedMessage[];
  isComplete: boolean;
  isError: boolean;
  timestamp: number;
}

/**
 * Union type for displayable items in the transcript.
 */
type TranscriptItem = GroupedMessage | ToolCallGroup;

/**
 * AnalysisTranscriptComponent - Live agent transcript during analysis
 *
 * Purpose:
 * - Display streaming SDK messages in real-time during agentic workspace analysis
 * - Show text output, tool calls, thinking previews, errors, and status messages
 * - Provide an expand/collapse toggle to manage screen real estate
 * - Auto-scroll to bottom on new messages unless user has scrolled up
 * - Render markdown content with syntax highlighting via ngx-markdown
 * - Group tool calls by toolCallId into collapsible sections
 *
 * Features:
 * - Renders all 7 message kinds with distinct visual styling
 * - Consecutive text messages are merged into a single block
 * - Tool calls with same toolCallId grouped into collapsible units
 * - All tool groups collapsed by default; user clicks to expand
 * - Focus on tool RESULTS (prominent); tool inputs de-emphasized (collapsed)
 * - Content processing pipeline: MCP extraction, system-reminder stripping, line number removal
 * - Auto-scroll with user scroll detection
 * - Markdown rendering with prose styling and language detection
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
  imports: [LucideAngularModule, MarkdownModule],
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
        @for (item of transcriptItems(); track $index) { @if (isToolGroup(item))
        {
        <!-- Tool Call Group (collapsible) -->
        <div class="bg-base-200/30 rounded border border-base-300/50 my-1">
          <!-- Group Header -->
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-base-300/30 transition-colors text-xs"
            (click)="toggleToolGroup(item.toolCallId)"
            [attr.aria-expanded]="!isToolGroupCollapsed(item)"
          >
            <lucide-angular
              [img]="ChevronDownIcon"
              class="w-3 h-3 shrink-0 text-base-content/50 transition-transform"
              [class.-rotate-90]="isToolGroupCollapsed(item)"
              aria-hidden="true"
            />
            <lucide-angular
              [img]="TerminalIcon"
              class="w-3 h-3 shrink-0"
              [class.text-info]="!item.isComplete"
              [class.text-success]="item.isComplete && !item.isError"
              [class.text-error]="item.isError"
              aria-hidden="true"
            />
            <span class="font-medium">{{ getToolGroupLabel(item) }}</span>
            @if (!item.isComplete) {
            <span class="badge badge-xs badge-info badge-outline animate-pulse"
              >running</span
            >
            } @else if (item.isError) {
            <span class="badge badge-xs badge-error badge-outline">error</span>
            } @else {
            <span class="badge badge-xs badge-success badge-outline">done</span>
            }
          </button>

          <!-- Group Content (collapsible) -->
          @if (!isToolGroupCollapsed(item)) {
          <div class="px-3 pb-2 pt-1 border-t border-base-300/30 space-y-1">
            <!-- Tool Result (prominent, shown first) -->
            @for (subItem of item.messages; track $index) { @if (subItem.kind
            === 'tool_result') {
            <div
              class="rounded-md overflow-hidden"
              [class]="subItem.isError ? 'bg-error/5' : ''"
            >
              <div class="px-2 pb-2 max-h-48 overflow-y-auto">
                <markdown
                  [data]="getFormattedToolResult(subItem)"
                  class="prose prose-xs prose-invert max-w-none
                                       [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                                       [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-xs"
                />
              </div>
            </div>
            } }
            <!-- Tool Input (de-emphasized, collapsed below result) -->
            @for (subItem of item.messages; track $index) { @if (subItem.kind
            === 'tool_input') {
            <div class="bg-base-100/50 rounded-md overflow-hidden">
              <button
                type="button"
                class="w-full flex items-center gap-2 px-2 py-1 text-[10px] text-base-content/40 hover:bg-base-200/50 transition-colors"
                (click)="toggleToolInput(subItem.timestamp)"
                [attr.aria-expanded]="isToolInputExpanded(subItem.timestamp)"
              >
                <lucide-angular
                  [img]="CodeIcon"
                  class="w-2.5 h-2.5 shrink-0"
                  aria-hidden="true"
                />
                <span>Input</span>
                <lucide-angular
                  [img]="
                    isToolInputExpanded(subItem.timestamp)
                      ? ChevronUpIcon
                      : ChevronDownIcon
                  "
                  class="w-2.5 h-2.5 ml-auto"
                  aria-hidden="true"
                />
              </button>
              @if (isToolInputExpanded(subItem.timestamp)) {
              <div class="px-2 pb-2 max-h-32 overflow-y-auto">
                <markdown
                  [data]="getFormattedToolInput(subItem)"
                  class="prose prose-xs prose-invert max-w-none
                                       [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                                       [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-[10px]"
                />
              </div>
              }
            </div>
            } }
          </div>
          }
        </div>
        } @else {
        <!-- Non-grouped messages (text, thinking, error, status, ungrouped tools) -->
        @switch (item.kind) { @case ('text') {
        <div class="bg-base-100 rounded-md px-3 py-2">
          <markdown
            [data]="getFormattedTextContent(item)"
            class="prose prose-sm prose-invert max-w-none
                           [&_pre]:my-1 [&_pre]:text-xs [&_code]:text-xs
                           [&_p]:my-1 [&_p]:text-sm [&_p]:text-base-content/80
                           [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm
                           [&_ul]:my-1 [&_ol]:my-1 [&_li]:text-sm"
          />
        </div>
        } @case ('tool_start') {
        <div class="flex items-center gap-2 py-1">
          <lucide-angular
            [img]="TerminalIcon"
            class="w-3.5 h-3.5 text-info shrink-0"
            aria-hidden="true"
          />
          <span class="badge badge-sm badge-info badge-outline">{{
            item.toolName || 'tool'
          }}</span>
          <span class="text-xs text-base-content/50">started</span>
        </div>
        } @case ('tool_input') {
        <div class="bg-base-100 rounded-md overflow-hidden">
          <button
            type="button"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-base-content/60 hover:bg-base-200 transition-colors"
            (click)="toggleToolInput(item.timestamp)"
            [attr.aria-expanded]="isToolInputExpanded(item.timestamp)"
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
          <div class="px-3 pb-2 max-h-40 overflow-y-auto">
            <markdown
              [data]="getFormattedToolInput(item)"
              class="prose prose-xs prose-invert max-w-none
                               [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                               [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-[10px]"
            />
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
          class="rounded-md overflow-hidden"
          [class]="item.isError ? 'border-l-2 border-error/20' : ''"
        >
          <div class="flex items-center gap-2 px-3 py-1.5">
            <lucide-angular
              [img]="item.isError ? AlertTriangleIcon : CheckCircleIcon"
              class="w-3.5 h-3.5 shrink-0"
              [class.text-error]="item.isError"
              [class.text-success]="!item.isError"
              aria-hidden="true"
            />
            <span class="text-xs font-medium" [class.text-error]="item.isError">
              {{ item.toolName || 'Result' }}
            </span>
            <span
              class="badge badge-xs"
              [class.badge-error]="item.isError"
              [class.badge-success]="!item.isError"
            >
              {{ item.isError ? 'error' : 'success' }}
            </span>
          </div>
          @if (item.content) {
          <div class="px-3 pb-2 max-h-32 overflow-y-auto">
            <markdown
              [data]="getFormattedToolResult(item)"
              class="prose prose-xs prose-invert max-w-none
                               [&_pre]:my-0 [&_pre]:rounded-sm [&_code]:text-[10px]
                               [&_pre]:bg-base-300/50 [&_p]:my-1 [&_p]:text-xs"
            />
          </div>
          }
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
        } } } } @empty {
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
  private readonly formatter = inject(ToolOutputFormatterService);

  /** Stream messages to display. Falls back to analysis stream from state service if not provided. */
  public readonly messages = input<AnalysisStreamPayload[]>();

  /** Effective messages source: external input or state service fallback */
  protected readonly effectiveMessages = computed(
    () => this.messages() ?? this.wizardState.analysisStream()
  );

  /** Lucide icon references */
  protected readonly TerminalIcon = Terminal;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly BrainIcon = Brain;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;
  protected readonly CodeIcon = Code;

  /** Whether the transcript panel is expanded */
  protected readonly isExpanded = signal(true);

  /** Whether the user has manually scrolled up (disables auto-scroll) */
  private readonly userHasScrolledUp = signal(false);

  /** Track which tool input blocks are expanded */
  private readonly expandedToolInputs = signal<Set<number>>(new Set());

  /** Track which tool inputs show full content */
  private readonly fullToolInputs = signal<Set<number>>(new Set());

  /** Track which tool groups the user has expanded (by toolCallId) */
  private readonly expandedToolGroups = signal<Set<string>>(new Set());

  /** Reference to the scrollable container element */
  protected readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  /** Total message count for the badge */
  protected readonly messageCount = computed(
    () => this.effectiveMessages().length
  );

  /**
   * Processed transcript items with text merging and tool call grouping.
   * - Consecutive text messages are merged
   * - Tool messages with same toolCallId are grouped into ToolCallGroup
   */
  protected readonly transcriptItems = computed<TranscriptItem[]>(() => {
    const raw = this.effectiveMessages();
    if (raw.length === 0) return [];

    // Step 1: Merge consecutive text messages (existing logic)
    const grouped: GroupedMessage[] = [];
    let currentTextGroup: GroupedMessage | null = null;

    for (const msg of raw) {
      if (msg.kind === 'text') {
        if (currentTextGroup !== null) {
          const merged: GroupedMessage = {
            ...currentTextGroup,
            content: currentTextGroup.content + msg.content,
          };
          currentTextGroup = merged;
          grouped[grouped.length - 1] = merged;
        } else {
          currentTextGroup = {
            kind: 'text',
            content: msg.content,
            timestamp: msg.timestamp,
          };
          grouped.push(currentTextGroup);
        }
      } else {
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

    // Step 1.5: Filter out noise text groups (JSON fragments, bracket noise, garbled tokens)
    const filtered = grouped.filter((msg) => {
      if (msg.kind !== 'text') return true;
      const trimmed = msg.content.trim();
      if (trimmed.length === 0) return false;
      // Filter out text that's mostly JSON syntax (quotes, brackets, numbers, colons)
      const alphaChars = trimmed.replace(/[^a-zA-Z]/g, '').length;
      if (trimmed.length > 5 && alphaChars / trimmed.length < 0.3) return false;
      // Filter out very short noise (single brackets, punctuation)
      if (trimmed.length < 3 && /^[[\]{}",:.\s]+$/.test(trimmed)) return false;
      return true;
    });

    // Step 2: Group tool messages by toolCallId into ToolCallGroups
    const items: TranscriptItem[] = [];
    const toolGroupMap = new Map<string, ToolCallGroup>();

    for (const msg of filtered) {
      if (
        msg.toolCallId &&
        (msg.kind === 'tool_start' ||
          msg.kind === 'tool_input' ||
          msg.kind === 'tool_result')
      ) {
        let group = toolGroupMap.get(msg.toolCallId);
        if (!group) {
          group = {
            kind: 'tool_group',
            toolCallId: msg.toolCallId,
            toolName: msg.toolName || 'tool',
            messages: [],
            isComplete: false,
            isError: false,
            timestamp: msg.timestamp,
          };
          toolGroupMap.set(msg.toolCallId, group);
          items.push(group);
        }
        group.messages.push(msg);
        if (msg.kind === 'tool_result') {
          group.isComplete = true;
          group.isError = !!msg.isError;
        }
        if (msg.toolName) {
          group.toolName = msg.toolName;
        }
      } else {
        items.push(msg);
      }
    }

    return items;
  });

  public constructor() {
    // Auto-scroll effect: scroll to bottom when new messages arrive
    // unless the user has manually scrolled up
    effect(() => {
      // Read the signal to track changes
      const messages = this.effectiveMessages();
      if (messages.length === 0) return;

      // Only auto-scroll if user hasn't scrolled up
      if (!this.userHasScrolledUp()) {
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

  /** Toggle a tool group's collapsed state */
  protected toggleToolGroup(toolCallId: string): void {
    this.expandedToolGroups.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(toolCallId)) {
        newSet.delete(toolCallId);
      } else {
        newSet.add(toolCallId);
      }
      return newSet;
    });
  }

  /** Check if a tool group is collapsed. Auto-expands the last incomplete group. */
  protected isToolGroupCollapsed(group: ToolCallGroup): boolean {
    // The set tracks user-expanded groups (toggled open)
    if (this.expandedToolGroups().has(group.toolCallId)) {
      return false; // User explicitly expanded
    }
    // Auto-expand the last incomplete tool group (shows live activity)
    const items = this.transcriptItems();
    const lastIncomplete = [...items]
      .reverse()
      .find(
        (item): item is ToolCallGroup =>
          this.isToolGroup(item) && !item.isComplete
      );
    if (lastIncomplete && lastIncomplete.toolCallId === group.toolCallId) {
      return false;
    }
    return true; // Default: collapsed
  }

  /** Type guard to check if a transcript item is a ToolCallGroup */
  protected isToolGroup(item: TranscriptItem): item is ToolCallGroup {
    return 'kind' in item && item.kind === 'tool_group';
  }

  /**
   * Format tool input as markdown with language detection.
   * Delegates to ToolOutputFormatterService.
   */
  protected getFormattedToolInput(item: GroupedMessage): string {
    const content = this.getToolInputContent(item);
    return this.formatter.formatToolInput(content, item.content);
  }

  /**
   * Format tool result content as markdown.
   * Delegates to ToolOutputFormatterService with tool-type-aware formatting.
   */
  protected getFormattedToolResult(item: GroupedMessage): string {
    return this.formatter.formatToolResult(item.content, item.toolName);
  }

  /**
   * Get a human-readable label for a tool group.
   * Searches the group's messages for a tool_input to extract ptah API call patterns.
   * Falls back to the raw tool name.
   */
  protected getToolGroupLabel(group: ToolCallGroup): string {
    const toolInputMsg = group.messages.find((m) => m.kind === 'tool_input');
    const toolInputContent = toolInputMsg?.content;
    return this.formatter.getToolGroupLabel(group.toolName, toolInputContent);
  }

  /**
   * Format text content for markdown rendering.
   * Delegates to ToolOutputFormatterService to unescape string literals.
   */
  protected getFormattedTextContent(item: GroupedMessage): string {
    return this.formatter.formatTextContent(item.content);
  }
}
