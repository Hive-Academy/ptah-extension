import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
  inject,
  viewChild,
  ElementRef,
  afterRenderEffect,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  LucideAngularModule,
  Check,
  AlertCircle,
  ChevronDown as ChevronDownIcon2,
  ChevronRight as ChevronRightIcon2,
  Copy,
  Brain,
} from 'lucide-angular';
import { Clipboard } from '@angular/cdk/clipboard';
import { MarkdownModule } from 'ngx-markdown';
import { TypingCursorComponent } from '../../atoms/typing-cursor.component';
import { PermissionRequestCardComponent } from '../permissions/permission-request-card.component';
import { QuestionCardComponent } from '../question-card.component';
import {
  CompactToolRowComponent,
  type CompactToolRow,
} from './compact-tool-row.component';
import { generateAgentColor } from '../../utils/agent-color.utils';
import type {
  StreamingState,
  AgentContentBlock,
} from '@ptah-extension/chat-types';
import { AccumulatorKeys } from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
  PermissionRequest,
  PermissionResponse,
  AskUserQuestionRequest,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';
import {
  isReadToolInput,
  isWriteToolInput,
  isEditToolInput,
  isBashToolInput,
  isGrepToolInput,
  isGlobToolInput,
  isWebFetchToolInput,
  isWebSearchToolInput,
} from '@ptah-extension/shared';

interface AgentEntry {
  type: 'agent';
  name: string;
  description?: string;
  status: 'running' | 'complete' | 'error';
  agentId?: string;
  toolCallId: string;
  textContent?: string;
  toolCount?: number;
  agentType?: string;
  tokenUsage?: { input: number; output: number };
  cost?: number;
  duration?: number;
}

interface ToolGroupEntry {
  type: 'tool-group';
  total: number;
  running: number;
  errors: number;
  tools: CompactToolRow[];
}

interface TextEntry {
  type: 'text';
  textContent: string;
  isStreaming?: boolean;
}

interface ThinkingEntry {
  type: 'thinking';
  textContent: string;
  isStreaming?: boolean;
}

interface PermissionEntry {
  type: 'permission';
  request: PermissionRequest;
}

interface QuestionEntry {
  type: 'question';
  request: AskUserQuestionRequest;
}

type FeedEntry =
  | AgentEntry
  | ToolGroupEntry
  | TextEntry
  | ThinkingEntry
  | PermissionEntry
  | QuestionEntry;

/**
 * CompactSessionActivityComponent - Agent-focused compacted feed.
 *
 * Shows agent messages prominently with their descriptions and text output.
 * Groups tool calls into summary counts. Displays the latest assistant text.
 * Fills all available vertical space from the parent.
 *
 * Two data paths:
 * 1. Live streaming: builds from StreamingState events
 * 2. Completed sessions: builds from finalized ExecutionNode trees in messages
 *
 * Complexity Level: 2 (Molecule with event parsing logic)
 * Patterns: Signal inputs, computed signals, OnPush, auto-scroll
 */
@Component({
  selector: 'ptah-compact-session-activity',
  standalone: true,
  imports: [
    LucideAngularModule,
    MarkdownModule,
    TypingCursorComponent,
    DecimalPipe,
    PermissionRequestCardComponent,
    QuestionCardComponent,
    CompactToolRowComponent,
  ],
  host: { class: 'flex flex-col min-h-0' },
  styles: [
    `
      :host ::ng-deep .compact-markdown .markdown-body,
      :host ::ng-deep .compact-markdown markdown {
        font-size: 0.75rem;
        line-height: 1.5;
      }
      :host ::ng-deep .compact-markdown pre {
        font-size: 0.65rem;
        padding: 0.5rem;
        margin: 0.25rem 0;
        border-radius: 0.25rem;
      }
      :host ::ng-deep .compact-markdown code:not(pre code) {
        font-size: 0.7rem;
        padding: 0.1rem 0.25rem;
        border-radius: 0.125rem;
      }
      :host ::ng-deep .compact-markdown p {
        margin: 0.25rem 0;
      }
      :host ::ng-deep .compact-markdown h1,
      :host ::ng-deep .compact-markdown h2,
      :host ::ng-deep .compact-markdown h3 {
        font-size: 0.8rem;
        margin: 0.35rem 0 0.15rem;
      }
      :host ::ng-deep .compact-markdown ul,
      :host ::ng-deep .compact-markdown ol {
        padding-left: 1rem;
        margin: 0.25rem 0;
      }
      /* Retro terminal aesthetic for the thinking block body */
      :host ::ng-deep .thinking-terminal .compact-markdown .markdown-body,
      :host ::ng-deep .thinking-terminal .compact-markdown markdown,
      :host ::ng-deep .thinking-terminal .compact-markdown p,
      :host ::ng-deep .thinking-terminal .compact-markdown li {
        font-family:
          ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        color: oklch(var(--su) / 0.85);
        letter-spacing: 0.01em;
      }
      :host .thinking-terminal {
        background-image: repeating-linear-gradient(
          oklch(var(--su) / 0.05) 0px,
          oklch(var(--su) / 0.05) 1px,
          transparent 1px,
          transparent 3px
        );
      }
    `,
  ],
  template: `
    <div
      #feedContainer
      class="flex-1 flex flex-col gap-1 px-3 py-2 overflow-y-auto min-h-0"
    >
      @if (feedEntries().length > 0) {
        @for (entry of feedEntries(); track $index) {
          @switch (entry.type) {
            @case ('agent') {
              <div
                class="flex flex-col gap-1 py-1.5 px-2 rounded-md bg-base-300/40 border border-base-content/5"
              >
                <div class="flex items-center gap-1.5 text-xs">
                  @if (entry.status === 'running') {
                    <span
                      class="loading loading-spinner loading-xs text-primary flex-shrink-0"
                    ></span>
                  } @else if (entry.status === 'error') {
                    <lucide-angular
                      [img]="AlertCircleIcon"
                      class="w-3.5 h-3.5 text-error flex-shrink-0"
                    />
                  } @else {
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-3.5 h-3.5 text-success/60 flex-shrink-0"
                    />
                  }
                  <span
                    class="w-2 h-2 rounded-full flex-shrink-0"
                    [style.background-color]="getAgentColor(entry.agentType)"
                  ></span>
                  <span class="font-semibold text-base-content/80 text-xs">{{
                    entry.name
                  }}</span>
                  @if (entry.description) {
                    <span
                      class="truncate text-base-content/40 text-[10px]"
                      [title]="entry.description"
                    >
                      — {{ entry.description }}
                    </span>
                  }
                  @if (entry.toolCount) {
                    <span
                      class="ml-auto text-[9px] font-mono text-base-content/30 flex-shrink-0"
                    >
                      {{ entry.toolCount }} tool{{
                        entry.toolCount !== 1 ? 's' : ''
                      }}
                    </span>
                  }
                </div>
                @if (entry.textContent) {
                  <div
                    class="text-xs text-base-content/60 leading-relaxed line-clamp-6 pl-5 compact-markdown"
                  >
                    <markdown [data]="entry.textContent" />
                  </div>
                }
                @if (entry.cost || entry.duration || entry.tokenUsage) {
                  <div
                    class="flex items-center gap-1.5 pl-5 text-[9px] font-mono text-base-content/30"
                  >
                    @if (entry.tokenUsage) {
                      <span
                        >{{
                          entry.tokenUsage.input + entry.tokenUsage.output
                            | number
                        }}
                        tok</span
                      >
                    }
                    @if (entry.cost) {
                      <span>\${{ entry.cost | number: '1.4-4' }}</span>
                    }
                    @if (entry.duration) {
                      <span
                        >{{ entry.duration / 1000 | number: '1.1-1' }}s</span
                      >
                    }
                  </div>
                }
              </div>
            }
            @case ('tool-group') {
              <div
                class="flex flex-col rounded-md bg-base-300/30 border border-base-content/5 px-2 py-1"
              >
                @if (entry.tools.length <= toolCollapseThreshold) {
                  @for (row of entry.tools; track $index) {
                    <ptah-compact-tool-row [row]="row" />
                  }
                } @else {
                  @for (row of visibleToolRows(entry, $index); track $index) {
                    <ptah-compact-tool-row [row]="row" />
                  }
                  <button
                    type="button"
                    class="flex items-center gap-1.5 py-0.5 text-[10px] font-mono text-base-content/40 hover:text-base-content/70 transition-colors cursor-pointer"
                    (click)="toggleToolGroup($index)"
                  >
                    <lucide-angular
                      [img]="
                        expandedToolGroups().has($index)
                          ? ChevronDownIcon2
                          : ChevronRightIcon2
                      "
                      class="w-2.5 h-2.5 flex-shrink-0"
                    />
                    @if (expandedToolGroups().has($index)) {
                      <span>Show fewer</span>
                    } @else {
                      <span
                        >{{ entry.tools.length - toolPreviewCount }} more tool{{
                          entry.tools.length - toolPreviewCount !== 1 ? 's' : ''
                        }}</span
                      >
                    }
                    @if (entry.errors > 0) {
                      <span class="text-error/60"
                        >· {{ entry.errors }} failed</span
                      >
                    }
                  </button>
                }
              </div>
            }
            @case ('thinking') {
              <div
                class="thinking-terminal flex flex-col rounded-md bg-base-300/50 border border-success/20 overflow-hidden"
              >
                <button
                  type="button"
                  class="flex items-center gap-1.5 py-1 px-2 text-[10px] font-mono text-success/70 hover:bg-success/5 transition-colors cursor-pointer w-full text-left"
                  (click)="toggleThinking($index)"
                >
                  <lucide-angular
                    [img]="BrainIcon"
                    class="w-3 h-3 flex-shrink-0"
                    [class.animate-pulse]="
                      entry.isStreaming && isSessionStreaming()
                    "
                  />
                  <span class="uppercase tracking-wider">Thinking</span>
                  @if (entry.isStreaming && isSessionStreaming()) {
                    <span class="text-success/50 normal-case tracking-normal"
                      >· reasoning…</span
                    >
                  }
                  <lucide-angular
                    [img]="
                      expandedThinking().has($index)
                        ? ChevronDownIcon2
                        : ChevronRightIcon2
                    "
                    class="w-2.5 h-2.5 flex-shrink-0 ml-auto"
                  />
                </button>
                @if (expandedThinking().has($index)) {
                  <div class="px-2 pb-1.5 compact-markdown">
                    <markdown [data]="entry.textContent" />
                    @if (entry.isStreaming && isSessionStreaming()) {
                      <ptah-typing-cursor colorClass="text-success/50" />
                    }
                  </div>
                }
              </div>
            }
            @case ('text') {
              <div class="group relative py-1.5">
                <div
                  class="text-xs text-base-content/70 leading-relaxed compact-markdown"
                >
                  <markdown [data]="entry.textContent" />
                  @if (entry.isStreaming && isSessionStreaming()) {
                    <ptah-typing-cursor colorClass="text-base-content/40" />
                  }
                </div>
                <button
                  type="button"
                  class="absolute top-1 right-1 btn btn-xs btn-ghost btn-square opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  [class.text-success]="copiedIndex() === $index"
                  (click)="copyText(entry.textContent, $index)"
                  [title]="copiedIndex() === $index ? 'Copied!' : 'Copy'"
                >
                  <lucide-angular
                    [img]="copiedIndex() === $index ? CheckIcon : CopyIcon"
                    class="w-3 h-3"
                  />
                </button>
              </div>
            }
            @case ('permission') {
              <div class="py-1">
                <ptah-permission-request-card
                  [request]="entry.request"
                  (responded)="permissionResponded.emit($event)"
                />
              </div>
            }
            @case ('question') {
              <div class="py-1">
                <ptah-question-card
                  [request]="entry.request"
                  (answered)="questionAnswered.emit($event)"
                />
              </div>
            }
          }
        }
      } @else {
        <div
          class="flex-1 flex items-center justify-center text-xs text-base-content/25 italic"
        >
          Waiting for activity...
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionActivityComponent {
  readonly streamingState = input<StreamingState | null>(null);
  readonly messages = input<ExecutionChatMessage[]>([]);
  readonly maxEntries = input<number>(50);
  readonly isSessionStreaming = input<boolean>(false);
  readonly permissionRequests = input<PermissionRequest[]>([]);
  readonly questionRequests = input<AskUserQuestionRequest[]>([]);

  readonly permissionResponded = output<PermissionResponse>();
  readonly questionAnswered = output<AskUserQuestionResponse>();

  protected readonly CheckIcon = Check;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly ChevronDownIcon2 = ChevronDownIcon2;
  protected readonly ChevronRightIcon2 = ChevronRightIcon2;
  protected readonly CopyIcon = Copy;
  protected readonly BrainIcon = Brain;

  /** Groups larger than this collapse their tail behind a "show more" toggle. */
  protected readonly toolCollapseThreshold = 6;
  /** How many tool rows stay visible when a large group is collapsed. */
  protected readonly toolPreviewCount = 5;

  private readonly clipboard = inject(Clipboard);

  /** Tracks which large tool groups are fully expanded, by feed index */
  protected readonly expandedToolGroups = signal<Set<number>>(new Set());

  /** Tracks which thinking blocks are expanded, by feed index */
  protected readonly expandedThinking = signal<Set<number>>(new Set());

  /** Tracks which text entry just had its content copied (for visual feedback) */
  protected readonly copiedIndex = signal<number | null>(null);

  protected toggleToolGroup(index: number): void {
    this.expandedToolGroups.update((set) => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  protected toggleThinking(index: number): void {
    this.expandedThinking.update((set) => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** Visible rows for a large (collapsible) tool group at a given feed index. */
  protected visibleToolRows(
    entry: ToolGroupEntry,
    index: number,
  ): CompactToolRow[] {
    if (this.expandedToolGroups().has(index)) return entry.tools;
    return entry.tools.slice(0, this.toolPreviewCount);
  }

  protected copyText(text: string, index: number): void {
    const success = this.clipboard.copy(text);
    if (success) {
      this.copiedIndex.set(index);
      setTimeout(() => this.copiedIndex.set(null), 2000);
    }
  }

  /** Get agent color from shared utility */
  protected getAgentColor(agentType?: string): string {
    return generateAgentColor(agentType || '');
  }

  private readonly feedContainer =
    viewChild<ElementRef<HTMLDivElement>>('feedContainer');

  constructor() {
    afterRenderEffect(() => {
      this.feedEntries();
      const container = this.feedContainer()?.nativeElement;
      if (!container) return;

      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        50;
      if (isNearBottom) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  readonly feedEntries = computed((): FeedEntry[] => {
    const state = this.streamingState();
    let entries: FeedEntry[];
    if (state && state.events.size > 0) {
      entries = this.buildFeedFromEvents(state);
    } else {
      entries = this.buildFeedFromMessages();
    }

    for (const req of this.permissionRequests()) {
      entries.push({ type: 'permission', request: req });
    }
    for (const req of this.questionRequests()) {
      entries.push({ type: 'question', request: req });
    }

    return entries;
  });

  /**
   * Build feed from finalized ExecutionNode trees in messages.
   * Used for completed sessions where streamingState is cleared.
   */
  private buildFeedFromMessages(): FeedEntry[] {
    const msgs = this.messages();
    if (!msgs || msgs.length === 0) return [];

    const entries: FeedEntry[] = [];

    for (const msg of msgs) {
      if (msg.role !== 'assistant' || !msg.streamingState) continue;
      this.walkExecutionTree(msg.streamingState, entries);
    }

    return entries.slice(-this.maxEntries());
  }

  private walkExecutionTree(node: ExecutionNode, entries: FeedEntry[]): void {
    if (node.type === 'agent') {
      const textParts: string[] = [];
      let toolCount = 0;

      for (const child of node.children) {
        if (child.type === 'text' && child.content) {
          textParts.push(child.content);
        } else if (child.type === 'tool') {
          toolCount++;
        }
      }

      const textContent =
        node.summaryContent?.trim() || textParts.join('\n').trim() || undefined;

      entries.push({
        type: 'agent',
        name: node.agentType || 'agent',
        description: node.agentDescription,
        status:
          node.status === 'error'
            ? 'error'
            : node.status === 'streaming'
              ? 'running'
              : 'complete',
        toolCallId: node.toolCallId || '',
        agentId: node.agentId,
        textContent: textContent ? this.truncate(textContent, 500) : undefined,
        toolCount: toolCount || undefined,
        agentType: node.agentType,
        tokenUsage: node.tokenUsage
          ? { input: node.tokenUsage.input, output: node.tokenUsage.output }
          : undefined,
        cost: node.cost,
        duration: node.duration,
      });
      return;
    }

    if (node.type === 'text' && node.content?.trim()) {
      entries.push({
        type: 'text',
        textContent: this.truncate(node.content, 1000),
      });
      return;
    }

    if (node.type === 'thinking' && node.content?.trim()) {
      entries.push({
        type: 'thinking',
        textContent: this.truncate(node.content, 4000),
      });
      return;
    }
    if (
      node.type === 'message' ||
      node.type === 'system' ||
      node.children.length > 0
    ) {
      let pendingTools: CompactToolRow[] = [];

      const flushTools = () => {
        if (pendingTools.length === 0) return;
        entries.push(this.makeToolGroup(pendingTools));
        pendingTools = [];
      };

      for (const child of node.children) {
        if (child.type === 'tool') {
          const status: CompactToolRow['status'] =
            child.status === 'error'
              ? 'error'
              : child.status === 'streaming' || child.status === 'pending'
                ? 'running'
                : 'complete';
          pendingTools.push(
            this.deriveToolRow(
              child.toolName || 'tool',
              child.toolInput,
              status,
            ),
          );
        } else {
          flushTools();
          this.walkExecutionTree(child, entries);
        }
      }

      flushTools();
    }
  }

  /** Assemble a ToolGroupEntry from a run of derived rows (with tallies). */
  private makeToolGroup(tools: CompactToolRow[]): ToolGroupEntry {
    const running = tools.filter((t) => t.status === 'running').length;
    const errors = tools.filter((t) => t.status === 'error').length;
    return {
      type: 'tool-group',
      total: tools.length,
      running,
      errors,
      tools,
    };
  }

  /**
   * Build the feed from live streaming events.
   *
   * Iterates `state.events` in insertion order — which is the true arrival
   * order of content blocks — so assistant text is interleaved inline with
   * tool and agent activity, exactly like the finalized tree walk. Text
   * blocks are keyed by messageId+blockIndex and emitted once (at the
   * position of their first delta) with the full accumulated content, so the
   * prose grows chunk-by-chunk on every RAF flush instead of only appearing
   * as a single trailing blob once the turn completes.
   */
  private buildFeedFromEvents(state: StreamingState): FeedEntry[] {
    const entries: FeedEntry[] = [];
    const toolResults = new Map<string, ToolResultEvent>();

    for (const event of state.events.values()) {
      if (event.eventType === 'tool_result') {
        const result = event as ToolResultEvent;
        toolResults.set(result.toolCallId, result);
      }
    }

    let pendingTools: CompactToolRow[] = [];

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      entries.push(this.makeToolGroup(pendingTools));
      pendingTools = [];
    };

    const seenTextBlocks = new Set<string>();
    const seenThinkingBlocks = new Set<string>();

    for (const event of state.events.values()) {
      if (event.eventType === 'text_delta') {
        const delta = event as TextDeltaEvent;
        const blockKey = AccumulatorKeys.textBlock(
          delta.messageId,
          delta.blockIndex ?? 0,
        );
        if (seenTextBlocks.has(blockKey)) continue;
        seenTextBlocks.add(blockKey);

        const content = state.textAccumulators.get(blockKey);
        if (!content || !content.trim()) continue;

        flushTools();
        entries.push({
          type: 'text',
          textContent: this.truncate(content, 1000),
          isStreaming: false,
        });
      } else if (
        event.eventType === 'thinking_start' ||
        event.eventType === 'thinking_delta'
      ) {
        // Interleave thinking in arrival order. Emitted once, at the position
        // of its first thinking event, with the full accumulated reasoning so
        // it grows chunk-by-chunk on each RAF flush (mirrors text handling).
        const blockIndex = (event as ThinkingDeltaEvent).blockIndex ?? 0;
        const blockKey = AccumulatorKeys.thinkingBlock(
          event.messageId,
          blockIndex,
        );
        if (seenThinkingBlocks.has(blockKey)) continue;
        seenThinkingBlocks.add(blockKey);

        const content = state.textAccumulators.get(blockKey);
        if (!content || !content.trim()) continue;

        flushTools();
        entries.push({
          type: 'thinking',
          textContent: this.truncate(content, 4000),
          isStreaming: false,
        });
      } else if (event.eventType === 'tool_start') {
        const tool = event as ToolStartEvent;
        if (tool.isTaskTool) continue;

        const result = toolResults.get(tool.toolCallId);
        const status: CompactToolRow['status'] = result
          ? result.isError
            ? 'error'
            : 'complete'
          : 'running';
        const toolInput = this.resolveStreamingToolInput(state, tool);
        pendingTools.push(this.deriveToolRow(tool.toolName, toolInput, status));
      } else if (event.eventType === 'agent_start') {
        flushTools();
        const agent = event as AgentStartEvent;
        const result = toolResults.get(agent.toolCallId);
        const textContent = this.getAgentText(state, agent);
        entries.push({
          type: 'agent',
          name: agent.agentType,
          description: agent.agentDescription,
          status: result ? (result.isError ? 'error' : 'complete') : 'running',
          agentId: agent.agentId,
          toolCallId: agent.toolCallId,
          textContent,
          agentType: agent.agentType,
        });
      }
    }

    flushTools();

    // Attach the "live" flag to the last streamable block (text or thinking)
    // while the session is still streaming, so the newest content reads as
    // live (cursor on text, pulsing label on the collapsed thinking header).
    if (this.isSessionStreaming()) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.type === 'text' || entry.type === 'thinking') {
          entry.isStreaming = true;
          break;
        }
      }
    }

    return entries.slice(-this.maxEntries());
  }

  /**
   * Resolve the tool input for a live tool_start event. The event may already
   * carry the parsed input; otherwise the streamed JSON is accumulated in
   * `state.toolInputAccumulators` keyed by `${toolCallId}-input`. Parse it
   * defensively since it can be partial mid-stream.
   */
  private resolveStreamingToolInput(
    state: StreamingState,
    tool: ToolStartEvent,
  ): Record<string, unknown> | undefined {
    if (tool.toolInput && Object.keys(tool.toolInput).length > 0) {
      return tool.toolInput;
    }
    const raw = state.toolInputAccumulators.get(
      AccumulatorKeys.toolInput(tool.toolCallId),
    );
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch (error: unknown) {
        // Partial JSON mid-stream — fall back to whatever the event carries.
        void error;
      }
    }
    return tool.toolInput;
  }

  /**
   * Derive a render-ready tool row from a tool name + input.
   *
   * Verb map: Read→"Read", Write→"Wrote", Edit/MultiEdit/NotebookEdit→
   * "Updated", Bash→"Ran", Grep/WebSearch→"Searched", Glob→"Explored",
   * WebFetch→"Fetched", Task/Agent→"Delegated", TodoWrite→"Planned".
   *
   * File badges come from `file_path` basenames. Diff stats are only emitted
   * when honestly derivable: Write → `+<lines in content>`; Edit → a real
   * line-level LCS diff of old_string vs new_string. Never fabricated.
   */
  private deriveToolRow(
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    status: CompactToolRow['status'],
  ): CompactToolRow {
    const row: CompactToolRow = {
      toolName,
      verb: this.toolVerb(toolName),
      status,
      files: [],
    };

    if (isWriteToolInput(toolInput)) {
      row.files = [this.basename(toolInput.file_path)];
      const added = toolInput.content
        ? toolInput.content.split('\n').length
        : 0;
      if (added > 0) row.added = added;
    } else if (isEditToolInput(toolInput)) {
      row.files = [this.basename(toolInput.file_path)];
      const diff = this.lineDiff(toolInput.old_string, toolInput.new_string);
      if (diff) {
        if (diff.added > 0) row.added = diff.added;
        if (diff.removed > 0) row.removed = diff.removed;
      }
    } else if (isReadToolInput(toolInput)) {
      row.files = [this.basename(toolInput.file_path)];
    } else if (isBashToolInput(toolInput)) {
      row.command = this.truncate(
        toolInput.description || toolInput.command,
        60,
      );
    } else if (isGrepToolInput(toolInput)) {
      row.detail = this.truncate(toolInput.pattern, 40);
    } else if (isGlobToolInput(toolInput)) {
      row.detail = this.truncate(toolInput.pattern, 40);
    } else if (isWebFetchToolInput(toolInput)) {
      row.detail = this.truncate(toolInput.url, 48);
    } else if (isWebSearchToolInput(toolInput)) {
      row.detail = this.truncate(toolInput.query, 40);
    } else {
      // Generic fallback: surface a file_path badge if one exists.
      const filePath = this.readStringField(toolInput, 'file_path');
      if (filePath) row.files = [this.basename(filePath)];
    }

    return row;
  }

  /** Map a tool name to a human verb. */
  private toolVerb(toolName: string): string {
    switch (toolName) {
      case 'Read':
        return 'Read';
      case 'Write':
        return 'Wrote';
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return 'Updated';
      case 'Bash':
        return 'Ran';
      case 'Grep':
      case 'WebSearch':
        return 'Searched';
      case 'Glob':
        return 'Explored';
      case 'WebFetch':
        return 'Fetched';
      case 'Task':
      case 'Agent':
        return 'Delegated';
      case 'TodoWrite':
        return 'Planned';
      default: {
        // Clean up Ptah MCP tool names (mcp__ptah__x / ptah-ptah_x) → "x".
        const mcp = toolName.match(/^mcp__[^_]+__(.+)$/);
        if (mcp) return mcp[1].replace(/_/g, ' ');
        return toolName;
      }
    }
  }

  /** Read a string field from an unknown tool-input record. */
  private readStringField(
    input: Record<string, unknown> | undefined,
    field: string,
  ): string | undefined {
    if (input && typeof input[field] === 'string') {
      return input[field] as string;
    }
    return undefined;
  }

  /** Last path segment (basename) from a Windows or POSIX path. */
  private basename(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  /**
   * Honest line-level added/removed counts via an LCS diff of two strings.
   * Bounded to keep it cheap; returns undefined for oversized inputs.
   */
  private lineDiff(
    oldStr: string,
    newStr: string,
  ): { added: number; removed: number } | undefined {
    const a = oldStr.split('\n');
    const b = newStr.split('\n');
    const m = a.length;
    const n = b.length;
    if (m * n > 250_000) return undefined;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      new Array<number>(n + 1).fill(0),
    );
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] =
          a[i] === b[j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const lcs = dp[0][0];
    return { added: n - lcs, removed: m - lcs };
  }

  private getAgentText(
    state: StreamingState,
    agent: AgentStartEvent,
  ): string | undefined {
    if (agent.agentId && state.agentContentBlocksMap.size > 0) {
      const blocks = state.agentContentBlocksMap.get(agent.agentId);
      if (blocks) {
        const text = blocks
          .filter((b: AgentContentBlock) => b.type === 'text' && b.text)
          .map((b: AgentContentBlock) => b.text!)
          .join('\n');
        if (text.trim()) return this.truncate(text, 500);
      }
    }

    if (state.agentSummaryAccumulators.size > 0) {
      const summary = state.agentSummaryAccumulators.get(agent.toolCallId);
      if (summary?.trim()) return this.truncate(summary, 500);
    }

    return undefined;
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }
}
