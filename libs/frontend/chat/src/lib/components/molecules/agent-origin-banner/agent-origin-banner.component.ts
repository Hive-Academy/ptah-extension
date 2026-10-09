import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  Bot,
  ChevronDown,
  CornerLeftUp,
  LucideAngularModule,
} from 'lucide-angular';
import type { TabAgentOrigin } from '@ptah-extension/chat-types';

let nextDetailsId = 0;

/**
 * AgentOriginBannerComponent — note above the transcript of a tab another
 * session started with `ptah_session_start` (TASK_2026_584).
 *
 * Says who started the session, where it works, how it runs unattended, and
 * that the user can still type into it (the composer stays enabled). Offers
 * "Open parent" while the parent tab is open in this panel.
 *
 * Presentational only: the container resolves the parent's title (`null`
 * when the parent tab is gone) and handles `openParent`.
 */
@Component({
  selector: 'ptah-agent-origin-banner',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded bg-base-300/30 border-b border-base-content/10 text-[11px] text-base-content-muted"
      role="note"
      aria-label="Agent-started session"
      data-test="agent-origin-banner"
    >
      <div class="flex h-6 items-center gap-1 px-2">
        <lucide-angular
          [img]="BotIcon"
          class="w-3 h-3 text-base-content-muted flex-shrink-0"
          aria-hidden="true"
        />
        <span class="min-w-0 truncate font-semibold">
          Started by {{ parentName() }}
        </span>
        <span
          class="max-w-32 shrink truncate rounded bg-base-300 px-1 font-mono"
          [attr.title]="origin().branch"
        >
          {{ origin().branch }}
        </span>
        <span class="flex-1"></span>
        @if (parentTitle() !== null) {
          <button
            type="button"
            class="btn btn-xs btn-ghost gap-0.5 px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            (click)="$event.stopPropagation(); openParent.emit(origin().parentTabId)"
            [attr.aria-label]="'Open parent session ' + parentTitle()"
            data-test="agent-origin-open-parent"
          >
            <lucide-angular
              [img]="OpenParentIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            Open parent
          </button>
        }
        <button
          type="button"
          class="btn btn-xs btn-ghost px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
          (click)="toggleDetails()"
          [attr.aria-expanded]="detailsOpen()"
          [attr.aria-controls]="detailsOpen() ? detailsId : null"
          [attr.aria-label]="
            detailsOpen() ? 'Hide session details' : 'Show session details'
          "
          data-test="agent-origin-toggle"
        >
          <lucide-angular
            [img]="ChevronDownIcon"
            class="w-3 h-3 transition-transform"
            [class.rotate-180]="detailsOpen()"
            aria-hidden="true"
          />
        </button>
      </div>
      @if (detailsOpen()) {
        <div
          [id]="detailsId"
          class="space-y-1 px-2 pb-1.5 leading-snug"
          data-test="agent-origin-details"
        >
          <p>
            Via ptah_session_start on branch
            <span class="font-mono">{{ origin().branch }}</span>
            (<span class="font-mono break-all">{{ origin().worktreePath }}</span
            >). You can type here.
          </p>
          <p>{{ policy }}</p>
        </div>
      }
    </div>
  `,
})
export class AgentOriginBannerComponent {
  /** The tab's agent origin. */
  readonly origin = input.required<TabAgentOrigin>();
  /** The parent tab's title, or `null` when the parent tab is not open. */
  readonly parentTitle = input<string | null>(null);

  /** The user asked to switch to the parent tab; emits its tab id. */
  readonly openParent = output<string>();

  /**
   * Local disclosure state. The main panel reuses this instance across tabs,
   * so a new origin starts collapsed again.
   */
  protected readonly detailsOpen = linkedSignal({
    source: this.origin,
    computation: () => false,
  });

  /** Unique per instance: several canvas tiles can show a hint at once. */
  protected readonly detailsId = `agent-origin-details-${nextDetailsId++}`;

  protected readonly parentName = computed(() => {
    const title = this.parentTitle();
    return title !== null
      ? `"${title}"`
      : 'an agent session whose tab is closed';
  });

  /** How the session runs unattended. */
  protected readonly policy =
    'Runs unattended: edits inside the worktree and allowlisted commands run ' +
    'without asking; other actions wait here for your approval for a limited ' +
    'time, then are denied. The parent is notified each time this session ' +
    'goes idle.';

  protected readonly BotIcon = Bot;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly OpenParentIcon = CornerLeftUp;

  protected toggleDetails(): void {
    this.detailsOpen.update((open) => !open);
  }
}
