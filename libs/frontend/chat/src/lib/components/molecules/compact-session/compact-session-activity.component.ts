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
} from 'lucide-angular';
import { Clipboard } from '@angular/cdk/clipboard';
import { MarkdownModule } from 'ngx-markdown';
import { TypingCursorComponent } from '../../atoms/typing-cursor.component';
import { PermissionRequestCardComponent } from '../permissions/permission-request-card.component';
import { QuestionCardComponent } from '../question-card.component';
import { generateAgentColor } from '../../../utils/agent-color.utils';
import type {
  StreamingState,
  AgentContentBlock,
} from '@ptah-extension/chat-types';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
  PermissionRequest,
  PermissionResponse,
  AskUserQuestionRequest,
  AskUserQuestionResponse,
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

interface ToolSummaryEntry {
  type: 'tool-summary';
  total: number;
  complete: number;
  running: number;
  errors: number;
  names: string[];
  tools: { name: string; status: 'running' | 'complete' | 'error' }[];
}

interface TextEntry {
  type: 'text';
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
  | ToolSummaryEntry
  | TextEntry
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
            @case ('tool-summary') {
              <button
                type="button"
                class="flex items-center gap-2 py-1 px-2 text-[10px] font-mono text-base-content/40 w-full text-left hover:bg-base-300/30 rounded transition-colors cursor-pointer"
                (click)="toggleToolSummary($index)"
              >
                @if (entry.running > 0) {
                  <span
                    class="loading loading-spinner w-2.5 h-2.5 text-primary flex-shrink-0"
                  ></span>
                } @else {
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-2.5 h-2.5 text-success/50 flex-shrink-0"
                  />
                }
                <lucide-angular
                  [img]="
                    expandedToolSummaries().has($index)
                      ? ChevronDownIcon2
                      : ChevronRightIcon2
                  "
                  class="w-2.5 h-2.5 flex-shrink-0"
                />
                <span>
                  {{ entry.total }} tool{{ entry.total !== 1 ? 's' : '' }}
                  @if (entry.running > 0) {
                    <span class="text-primary/60"
                      >· {{ entry.running }} running</span
                    >
                  }
                  @if (entry.errors > 0) {
                    <span class="text-error/60"
                      >· {{ entry.errors }} failed</span
                    >
                  }
                </span>
                @if (!expandedToolSummaries().has($index)) {
                  <span class="truncate text-base-content/25">{{
                    entry.names.join(', ')
                  }}</span>
                }
              </button>
              @if (expandedToolSummaries().has($index)) {
                <div class="pl-7 pr-2 pb-1 space-y-0.5">
                  @for (tool of entry.tools; track $index) {
                    <div
                      class="flex items-center gap-1.5 text-[10px] font-mono text-base-content/40"
                    >
                      @if (tool.status === 'running') {
                        <span
                          class="loading loading-spinner w-2 h-2 text-primary"
                        ></span>
                      } @else if (tool.status === 'error') {
                        <lucide-angular
                          [img]="AlertCircleIcon"
                          class="w-2.5 h-2.5 text-error/60"
                        />
                      } @else {
                        <lucide-angular
                          [img]="CheckIcon"
                          class="w-2.5 h-2.5 text-success/40"
                        />
                      }
                      <span>{{ tool.name }}</span>
                    </div>
                  }
                </div>
              }
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

  private readonly clipboard = inject(Clipboard);

  /** Tracks which tool summary entries are expanded by feed index */
  protected readonly expandedToolSummaries = signal<Set<number>>(new Set());

  /** Tracks which text entry just had its content copied (for visual feedback) */
  protected readonly copiedIndex = signal<number | null>(null);

  protected toggleToolSummary(index: number): void {
    this.expandedToolSummaries.update((set) => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
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

    // For message/container nodes, recurse but group top-level tools
    if (
      node.type === 'message' ||
      node.type === 'system' ||
      node.children.length > 0
    ) {
      let pendingTools: string[] = [];

      const flushTools = () => {
        if (pendingTools.length === 0) return;
        const names = [...new Set(pendingTools)];
        entries.push({
          type: 'tool-summary',
          total: pendingTools.length,
          complete: pendingTools.length,
          running: 0,
          errors: 0,
          names,
          tools: pendingTools.map((n) => ({
            name: n,
            status: 'complete' as const,
          })),
        });
        pendingTools = [];
      };

      for (const child of node.children) {
        if (child.type === 'tool') {
          pendingTools.push(child.toolName || 'tool');
        } else {
          flushTools();
          this.walkExecutionTree(child, entries);
        }
      }

      flushTools();
    }
  }

  private buildFeedFromEvents(state: StreamingState): FeedEntry[] {
    const entries: FeedEntry[] = [];
    const toolResults = new Map<string, ToolResultEvent>();

    for (const event of state.events.values()) {
      if (event.eventType === 'tool_result') {
        const result = event as ToolResultEvent;
        toolResults.set(result.toolCallId, result);
      }
    }

    let pendingTools: {
      name: string;
      status: 'running' | 'complete' | 'error';
    }[] = [];

    const flushTools = () => {
      if (pendingTools.length === 0) return;
      const running = pendingTools.filter((t) => t.status === 'running').length;
      const errors = pendingTools.filter((t) => t.status === 'error').length;
      const complete = pendingTools.length - running - errors;
      const names = [...new Set(pendingTools.map((t) => t.name))];
      entries.push({
        type: 'tool-summary',
        total: pendingTools.length,
        complete,
        running,
        errors,
        names,
        tools: [...pendingTools],
      });
      pendingTools = [];
    };

    for (const eventId of state.messageEventIds) {
      const event = state.events.get(eventId);
      if (!event) continue;

      if (event.eventType === 'tool_start') {
        const tool = event as ToolStartEvent;
        if (tool.isTaskTool) continue;

        const result = toolResults.get(tool.toolCallId);
        pendingTools.push({
          name: tool.toolName,
          status: result ? (result.isError ? 'error' : 'complete') : 'running',
        });
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

    // Append accumulated assistant text
    if (state.textAccumulators.size > 0) {
      let latestText = '';
      for (const text of state.textAccumulators.values()) {
        latestText = text;
      }
      if (latestText.trim()) {
        entries.push({
          type: 'text',
          textContent: latestText.substring(0, 1000),
          isStreaming: true,
        });
      }
    }

    return entries.slice(-this.maxEntries());
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
