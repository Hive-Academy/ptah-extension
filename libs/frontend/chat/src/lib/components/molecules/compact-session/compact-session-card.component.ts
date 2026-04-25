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
import { CompactSessionInputComponent } from './compact-session-input.component';
import type { TabState } from '@ptah-extension/chat-types';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '../../../services/tab-manager.service';
import type {
  PermissionResponse,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';

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
    CompactSessionInputComponent,
  ],
  host: { class: 'flex flex-col h-full' },
  template: `
    <div
      class="flex flex-col h-full border overflow-hidden transition-colors duration-150"
      [class.border-primary/30]="isStreaming()"
      [class.border-base-content/10]="!isStreaming()"
      [class.bg-base-200/30]="true"
    >
      <!-- Header (always visible) -->
      <ptah-compact-session-header
        class="shrink-0"
        [title]="tab().title"
        [status]="tab().status"
      />

      @if (!isCollapsed()) {
        <!-- Stats bar -->
        @if (hasStats()) {
          <ptah-compact-session-stats
            class="shrink-0"
            [messages]="tab().messages"
            [preloadedStats]="tab().preloadedStats ?? null"
            [liveModelStats]="tab().liveModelStats ?? null"
          />
        }

        <!-- Activity feed fills all remaining space -->
        <ptah-compact-session-activity
          class="flex-1 min-h-0"
          [streamingState]="tab().streamingState"
          [messages]="tab().messages"
          [maxEntries]="50"
          [permissionRequests]="sessionPermissions()"
          [questionRequests]="sessionQuestions()"
          [isSessionStreaming]="isStreaming()"
          (permissionResponded)="onPermissionResponse($event)"
          (questionAnswered)="onQuestionResponse($event)"
        />

        <!-- Mini input pinned at bottom -->
        <ptah-compact-session-input
          class="shrink-0"
          [isStreaming]="isStreaming()"
          (messageSent)="onSend($event)"
          (stopRequested)="onStop()"
        />
      }

      <!-- Footer: collapse toggle + expand to full button -->
      <div
        class="flex items-center justify-between px-3 py-1 bg-base-300/30 border-t border-base-content/5 shrink-0"
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

  readonly sessionPermissions = computed(() => {
    const permissions = this.chatStore.permissionRequests();
    const sessionId = this.tab().claudeSessionId;
    if (!sessionId) return permissions;
    return permissions.filter((p) => p.sessionId === sessionId);
  });

  readonly sessionQuestions = computed(() => {
    const questions = this.chatStore.questionRequests();
    const sessionId = this.tab().claudeSessionId;
    if (!sessionId) return questions;
    return questions.filter((q) => q.sessionId === sessionId);
  });

  onSend(message: string): void {
    const tabId = this.tab().id;
    this.chatStore.sendOrQueueMessage(message, { tabId });
  }

  onStop(): void {
    this.chatStore.abortWithConfirmation();
  }

  onPermissionResponse(response: PermissionResponse): void {
    this.chatStore.handlePermissionResponse(response);
  }

  onQuestionResponse(response: AskUserQuestionResponse): void {
    this.chatStore.handleQuestionResponse(response);
  }
}
