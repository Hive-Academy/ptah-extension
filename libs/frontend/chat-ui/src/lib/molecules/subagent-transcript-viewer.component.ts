import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  LucideAngularModule,
  ScrollText,
  RefreshCw,
  X,
  Inbox,
  AlertTriangle,
} from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { SubagentTranscriptMessage } from '@ptah-extension/shared';

/**
 * SubagentTranscriptViewerComponent — presentational viewer for a subagent's
 * full historical transcript.
 *
 * Purely presentational: the smart wrapper (in `@ptah-extension/chat`) owns the
 * open-state, fires the `subagent:transcript` RPC, and feeds `messages` /
 * `loading` / `error` down. This component only renders and echoes `closed` /
 * `refresh` intents back up.
 *
 * Distinct from the live execution tree (which streams a running agent's output
 * inline). This shows the COMPLETE saved conversation — usable after the agent
 * finished or to backfill output that was never streamed. Per the backend
 * contract an empty `messages` array means "no transcript yet", not an error,
 * so the empty state is shown for both a fresh agent and a not-yet-flushed one.
 *
 * AI-generated text is rendered ONLY through {@link MarkdownBlockComponent}
 * (never `[innerHTML]`) so it flows through the DOMPurify chokepoint.
 */
@Component({
  selector: 'ptah-subagent-transcript-viewer',
  standalone: true,
  imports: [NgClass, LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col max-h-[70vh] min-h-[240px]">
      <!-- Header -->
      <div
        class="flex items-center justify-between gap-2 pb-3 border-b border-base-300 flex-shrink-0"
      >
        <div class="flex items-center gap-2 min-w-0">
          <lucide-angular
            [img]="ScrollTextIcon"
            class="w-4 h-4 text-primary flex-shrink-0"
            aria-hidden="true"
          />
          <h3 class="font-semibold text-sm truncate" [title]="agentName()">
            {{ agentName() || 'Subagent' }}
            <span class="text-base-content/50 font-normal">— Transcript</span>
          </h3>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            (click)="refresh.emit()"
            [disabled]="loading()"
            title="Refresh transcript"
            aria-label="Refresh transcript"
            data-testid="subagent-transcript-refresh"
          >
            <lucide-angular
              [img]="RefreshIcon"
              class="w-3.5 h-3.5"
              [class.animate-spin]="loading()"
            />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            (click)="closed.emit()"
            title="Close"
            aria-label="Close transcript"
            data-testid="subagent-transcript-close"
          >
            <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Body -->
      <div
        class="flex-1 overflow-y-auto py-3"
        data-testid="subagent-transcript-body"
      >
        @if (loading() && messages().length === 0) {
          <!-- Loading state -->
          <div
            class="flex items-center justify-center gap-2 py-12 text-sm text-base-content/60"
            data-testid="subagent-transcript-loading"
          >
            <span class="loading loading-spinner loading-sm"></span>
            <span>Loading transcript…</span>
          </div>
        } @else if (error()) {
          <!-- Error state -->
          <div
            class="flex flex-col items-center gap-2 py-12 text-center"
            role="alert"
            data-testid="subagent-transcript-error"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="w-6 h-6 text-error"
              aria-hidden="true"
            />
            <p class="text-sm text-error max-w-xs">{{ error() }}</p>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              (click)="refresh.emit()"
            >
              Try again
            </button>
          </div>
        } @else if (messages().length === 0) {
          <!-- Empty state -->
          <div
            class="flex flex-col items-center gap-2 py-12 text-center text-base-content/50"
            data-testid="subagent-transcript-empty"
          >
            <lucide-angular
              [img]="InboxIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
            <p class="text-sm max-w-xs">
              No transcript yet — this agent hasn't produced a saved transcript.
            </p>
          </div>
        } @else {
          <!-- Conversation -->
          <div class="flex flex-col gap-3">
            @for (msg of messages(); track $index) {
              <div
                class="flex flex-col gap-1"
                [ngClass]="msg.role === 'user' ? 'items-end' : 'items-start'"
                [attr.data-role]="msg.role"
                data-testid="subagent-transcript-message"
              >
                <div
                  class="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-base-content/40 px-1"
                >
                  <span>{{ msg.role === 'user' ? 'User' : 'Assistant' }}</span>
                  @if (msg.timestamp) {
                    <span aria-hidden="true">·</span>
                    <span>{{ msg.timestamp }}</span>
                  }
                </div>
                <div
                  class="rounded-lg px-3 py-2 text-sm max-w-[85%] break-words"
                  [ngClass]="
                    msg.role === 'user'
                      ? 'bg-primary/10 border border-primary/20'
                      : 'bg-base-200 border border-base-300'
                  "
                >
                  <ptah-markdown-block [content]="msg.text" />
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class SubagentTranscriptViewerComponent {
  /** Display name shown in the header (agent type / description). */
  readonly agentName = input<string>('');
  /** Normalized transcript messages in chronological order. */
  readonly messages = input<readonly SubagentTranscriptMessage[]>([]);
  /** Whether a transcript fetch is in flight. */
  readonly loading = input<boolean>(false);
  /** Error text to surface, or null when there is no error. */
  readonly error = input<string | null>(null);

  /** Emitted when the user dismisses the viewer. */
  readonly closed = output<void>();
  /** Emitted when the user requests a re-fetch of the transcript. */
  readonly refresh = output<void>();

  protected readonly ScrollTextIcon = ScrollText;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly XIcon = X;
  protected readonly InboxIcon = Inbox;
  protected readonly AlertIcon = AlertTriangle;
}
