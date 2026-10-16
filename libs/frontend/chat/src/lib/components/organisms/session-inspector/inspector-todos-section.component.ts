import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState, TabState } from '@ptah-extension/chat-types';
import {
  parseTodoList,
  summarizeTodos,
  type CompactTodoState,
} from '@ptah-extension/chat-ui';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  TodoItem,
} from '@ptah-extension/shared';
import { Check, LucideAngularModule } from 'lucide-angular';
import type { TodosSectionData } from '../../../services/session-inspector';

/** Items shown before `+N more`. */
const VISIBLE_TODOS = 8;

let nextTodosId = 0;

/** The newest finalized top-level `TodoWrite` under `node`; agents are skipped. */
function latestTodoWriteNode(node: ExecutionNode): ExecutionNode | null {
  if (node.type === 'agent') return null;
  for (let i = node.children.length - 1; i >= 0; i--) {
    const found = latestTodoWriteNode(node.children[i]);
    if (found) return found;
  }
  return node.type === 'tool' && node.toolName === 'TodoWrite' ? node : null;
}

/**
 * The input of the session's latest `TodoWrite`, in the order
 * `summarizeTodos` reads it: the live stream's marker first, then the newest
 * finalized assistant message, stopping at the last compaction. `undefined`
 * when there is none (or only one before the compaction).
 */
function latestTodoWriteInput(
  messages: readonly ExecutionChatMessage[],
  streaming: StreamingState | null,
  compactionCompletedAt: number,
): unknown {
  const marker = streaming?.latestTodoWrite;
  if (streaming && marker) {
    for (const event of streaming.events.values()) {
      if (
        event.eventType === 'tool_start' &&
        event.toolCallId === marker.toolCallId &&
        !event.parentToolUseId &&
        event.toolInput &&
        Object.keys(event.toolInput).length > 0
      ) {
        return event.toolInput;
      }
    }
    return marker.input;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.timestamp < compactionCompletedAt) return undefined;
    if (message.role !== 'assistant' || !message.streamingState) continue;
    const todo = latestTodoWriteNode(message.streamingState);
    if (todo) return todo.toolInput;
  }
  return undefined;
}

/** In-progress items first; every other item keeps its list order. */
function inProgressFirst(items: readonly TodoItem[]): readonly TodoItem[] {
  return [
    ...items.filter((item) => item.status === 'in_progress'),
    ...items.filter((item) => item.status !== 'in_progress'),
  ];
}

function sectionData(
  items: readonly TodoItem[] | null,
  summary: CompactTodoState,
): TodosSectionData | null {
  if (items !== null && items.length > 0) {
    const active = items.find((item) => item.status === 'in_progress');
    return {
      items: inProgressFirst(items),
      done: items.filter((item) => item.status === 'completed').length,
      total: items.length,
      activeTitle: active ? active.activeForm || active.content : null,
    };
  }
  if (summary.kind === 'known') {
    // Count-only fallback: the counts parse, the items do not.
    return {
      items: null,
      done: summary.done,
      total: summary.total,
      activeTitle: summary.active,
    };
  }
  return null;
}

/**
 * The inspector TODOS section (design 4.3): the per-item list of the
 * session's latest `TodoWrite` (`parseTodoList`), in-progress items first,
 * eight at rest; the count-only fallback of `summarizeTodos` when the items
 * cannot be parsed; the empty state otherwise. Always rendered so the layout
 * stays stable.
 */
@Component({
  selector: 'ptah-inspector-todos-section',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border-t border-surface-border p-4"
      [attr.aria-labelledby]="headingId"
      [attr.aria-busy]="restoring() ? 'true' : null"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 [id]="headingId" class="sec-label text-[10.5px] font-semibold uppercase">TODOS</h3>
        @if (data(); as d) {
          <span class="text-[11px] tabular-nums text-base-content-muted">{{ d.done }} of {{ d.total }}</span>
        }
      </div>
      @if (restoring()) {
        <div class="grid gap-2" aria-hidden="true">
          <span class="h-3.5 w-48 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"></span>
          <span class="h-3.5 w-40 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"></span>
        </div>
      } @else if (data(); as d) {
        @if (d.items; as items) {
          <ul>
            @for (item of visibleItems(); track $index) {
              <li class="flex items-start gap-[9px] py-1 text-[13px] leading-[1.4]">
                @switch (item.status) {
                  @case ('completed') {
                    <span class="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-state-done bg-state-done" aria-hidden="true">
                      <lucide-angular [img]="CheckIcon" class="size-2.5 text-base-100" [strokeWidth]="3.5" />
                    </span>
                    <span class="min-w-0 text-base-content-muted line-through [overflow-wrap:anywhere]"><span class="sr-only">Done: </span>{{ item.content }}</span>
                  }
                  @case ('in_progress') {
                    <span class="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-state-run" aria-hidden="true">
                      <span class="size-1.5 rounded-full bg-state-run"></span>
                    </span>
                    <span class="min-w-0 font-medium [overflow-wrap:anywhere]"><span class="sr-only">In progress: </span>{{ item.content }}</span>
                  }
                  @default {
                    <span class="mt-[3px] size-3.5 shrink-0 rounded-[3px] border-[1.5px] border-[var(--ptah-check-edge)]" aria-hidden="true"></span>
                    <span class="min-w-0 [overflow-wrap:anywhere]"><span class="sr-only">Pending: </span>{{ item.content }}</span>
                  }
                }
              </li>
            }
          </ul>
          @if (items.length > visibleLimit) {
            <button
              type="button"
              class="mt-1 inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium text-base-content underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              [attr.aria-expanded]="expanded()"
              [attr.aria-label]="'Show ' + (items.length - visibleLimit) + ' more todos'"
              (click)="expanded.set(!expanded())"
            >
              +{{ items.length - visibleLimit }} more
            </button>
          }
        } @else {
          <p class="text-xs text-base-content-muted">
            Todo details unavailable@if (d.activeTitle) {<span>: {{ d.activeTitle }}</span>}
          </p>
        }
      } @else {
        <p class="text-xs text-base-content-muted">
          No todos for this session. The orchestrator lists its plan here.
        </p>
      }
    </section>
  `,
})
export class InspectorTodosSectionComponent {
  private readonly tabs = inject(TabManagerService);

  readonly tabId = input.required<string>();

  protected readonly CheckIcon = Check;
  protected readonly visibleLimit = VISIBLE_TODOS;
  protected readonly headingId = `ptah-todos-h-${++nextTodosId}`;
  protected readonly expanded = signal(false);

  private readonly tab = computed<TabState | null>(
    () => this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab ?? null,
  );

  /** The tab is still restoring its history (no messages yet). */
  protected readonly restoring = computed(
    () => this.tab()?.status === 'switching',
  );

  /** Count summary, as the Rail details card read it. */
  private readonly todos = computed(() => {
    const tab = this.tab();
    return tab
      ? summarizeTodos(
          tab.messages ?? [],
          tab.streamingState ?? null,
          tab.lastCompactionAt ?? 0,
        )
      : ({ kind: 'none' } satisfies CompactTodoState);
  });

  private readonly items = computed(() => {
    const tab = this.tab();
    if (!tab) return null;
    return parseTodoList(
      latestTodoWriteInput(
        tab.messages ?? [],
        tab.streamingState ?? null,
        tab.lastCompactionAt ?? 0,
      ),
    );
  });

  protected readonly data = computed(() =>
    sectionData(this.items(), this.todos()),
  );

  protected readonly visibleItems = computed(() => {
    const items = this.data()?.items ?? [];
    return this.expanded() ? items : items.slice(0, VISIBLE_TODOS);
  });
}
