import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Bot, CornerLeftUp, LucideAngularModule } from 'lucide-angular';
import type { TabAgentOrigin } from '@ptah-extension/chat-types';

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
      class="bg-base-300/30 rounded border border-info/40"
      role="note"
      aria-label="Agent-started session"
      data-test="agent-origin-banner"
    >
      <div class="py-1.5 px-2 flex items-center gap-1.5 text-[11px]">
        <lucide-angular
          [img]="BotIcon"
          class="w-3 h-3 text-base-content-muted flex-shrink-0"
          aria-hidden="true"
        />
        <span class="font-semibold text-base-content-muted truncate">
          Started by {{ parentName() }}
        </span>
        <span class="flex-1"></span>
        @if (parentTitle() !== null) {
          <button
            type="button"
            class="btn btn-xs btn-ghost gap-0.5 px-2"
            (click)="openParent.emit(origin().parentTabId)"
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
      </div>
      <p class="px-2 pb-1.5 text-[11px] text-base-content-muted leading-snug">
        Via ptah_session_start on branch
        <span class="font-mono">{{ origin().branch }}</span>
        (<span class="font-mono break-all">{{ origin().worktreePath }}</span
        >). You can type here.
        <span class="hidden sm:inline" data-test="agent-origin-policy-inline">{{
          policy
        }}</span>
      </p>
      <!-- Narrow panels: the policy sits behind a native disclosure so the
           note stays short above the transcript. -->
      <details
        class="sm:hidden px-2 pb-1.5 text-[11px] text-base-content-muted"
        data-test="agent-origin-policy-disclosure"
      >
        <summary
          class="cursor-pointer select-none w-fit rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          How this session runs
        </summary>
        <p class="mt-1 leading-snug">{{ policy }}</p>
      </details>
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

  protected readonly parentName = computed(() => {
    const title = this.parentTitle();
    return title !== null
      ? `"${title}"`
      : 'an agent session whose tab is closed';
  });

  /** How the session runs unattended; inline when wide, disclosed when narrow. */
  protected readonly policy =
    'Runs unattended: edits inside the worktree and allowlisted commands run ' +
    'without asking; other actions wait here for your approval for a limited ' +
    'time, then are denied. The parent is notified each time this session ' +
    'goes idle.';

  protected readonly BotIcon = Bot;
  protected readonly OpenParentIcon = CornerLeftUp;
}
