import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
  inject,
} from '@angular/core';
import {
  LucideAngularModule,
  Maximize2,
  ChevronDown,
  ChevronUp,
} from 'lucide-angular';
import { CompactSessionHeaderComponent } from './compact-session-header.component';
import { CompactSessionStatsComponent } from './compact-session-stats.component';
import { CompactSessionActivityComponent } from './compact-session-activity.component';
import { CompactSessionTextComponent } from './compact-session-text.component';
import { CompactSessionInputComponent } from './compact-session-input.component';
import type { TabState, StreamingState } from '../../../services/chat.types';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '../../../services/tab-manager.service';
import { ExecutionTreeBuilderService } from '../../../services/execution-tree-builder.service';

/**
 * CompactSessionCardComponent - Condensed card view of a session.
 *
 * Renders a collapsible card with:
 * - Header: session title + status indicator
 * - Stats: inline token/cost/agent badges
 * - Activity: last N tool/agent events from flat streaming state
 * - Text: truncated latest assistant output
 * - Input: mini textarea for quick follow-ups
 *
 * Separate component tree from the full chat view — does NOT use
 * MessageBubble, ExecutionNode, or any chat-view internal components.
 *
 * Complexity Level: 3 (Organism-level composition with state coordination)
 * Patterns: Signal composition, standalone components, DaisyUI, OnPush
 */
@Component({
  selector: 'ptah-compact-session-card',
  standalone: true,
  imports: [
    LucideAngularModule,
    CompactSessionHeaderComponent,
    CompactSessionStatsComponent,
    CompactSessionActivityComponent,
    CompactSessionTextComponent,
    CompactSessionInputComponent,
  ],
  template: `
    <div
      class="rounded-lg border overflow-hidden transition-colors duration-150"
      [class.border-primary/30]="isStreaming()"
      [class.border-base-content/10]="!isStreaming()"
      [class.bg-base-200/30]="true"
    >
      <!-- Header (always visible) -->
      <ptah-compact-session-header
        [title]="tab().title"
        [status]="tab().status"
      />

      @if (!isCollapsed()) {
        <!-- Stats bar -->
        @if (hasStats()) {
          <ptah-compact-session-stats
            [messages]="tab().messages"
            [preloadedStats]="tab().preloadedStats ?? null"
            [liveModelStats]="tab().liveModelStats ?? null"
          />
        }

        <!-- Activity feed -->
        <ptah-compact-session-activity
          [streamingState]="tab().streamingState"
          [maxEntries]="5"
        />

        <!-- Latest text -->
        <ptah-compact-session-text
          [streamingState]="tab().streamingState"
          [lastMessageContent]="lastAssistantText()"
        />

        <!-- Mini input -->
        <ptah-compact-session-input
          [isStreaming]="isStreaming()"
          (messageSent)="onSend($event)"
          (stopRequested)="onStop()"
        />
      }

      <!-- Footer: collapse toggle + expand to full button -->
      <div
        class="flex items-center justify-between px-3 py-1 bg-base-300/30 border-t border-base-content/5"
      >
        <button
          class="btn btn-ghost btn-xs gap-1 text-[10px] text-base-content/50 hover:text-base-content/80"
          (click)="isCollapsed.set(!isCollapsed())"
          type="button"
        >
          <lucide-angular
            [img]="isCollapsed() ? ChevronDownIcon : ChevronUpIcon"
            class="w-3 h-3"
          />
          {{ isCollapsed() ? 'Expand' : 'Collapse' }}
        </button>
        <button
          class="btn btn-ghost btn-xs gap-1 text-[10px] text-base-content/50 hover:text-primary"
          (click)="expandToFull.emit()"
          title="Switch to full view"
          type="button"
        >
          <lucide-angular [img]="MaximizeIcon" class="w-3 h-3" />
          Full View
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionCardComponent {
  private readonly chatStore = inject(ChatStore);
  private readonly tabManager = inject(TabManagerService);

  readonly tab = input.required<TabState>();
  readonly expandToFull = output<void>();

  protected readonly MaximizeIcon = Maximize2;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronUpIcon = ChevronUp;

  /** Local collapse state: streaming sessions start expanded, completed start collapsed */
  readonly isCollapsed = signal(false);

  readonly isStreaming = computed(() => {
    const s = this.tab().status;
    return s === 'streaming' || s === 'resuming';
  });

  readonly hasStats = computed(() => {
    const tab = this.tab();
    return (
      tab.messages.length > 0 ||
      tab.preloadedStats != null ||
      tab.liveModelStats != null
    );
  });

  /** Extract last assistant message text for display when not streaming */
  readonly lastAssistantText = computed((): string | null => {
    const messages = this.tab().messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.rawContent) {
        return msg.rawContent;
      }
    }
    return null;
  });

  onSend(message: string): void {
    const tabId = this.tab().id;
    this.chatStore.sendOrQueueMessage(message, { tabId });
  }

  onStop(): void {
    this.chatStore.abortWithConfirmation();
  }
}
