import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  MessageSquare,
  MessagesSquare,
  LucideAngularModule,
} from 'lucide-angular';

import type { HubSection, HubTopicSummary } from '@ptah-contracts/community';

import { HubSectionCard } from './hub-section-card';

/**
 * CommunityActivityCard — recent and unread community topics (R6.1).
 *
 * Deliberately SUMMARIES, not detail: no body, no posts, no author email. The
 * hub is a launcher — the card links to `/members/community/topics/:slug` and
 * the thread is fetched on navigation. Sending bodies here would inflate the
 * one request R6.2 caps the hub at.
 *
 * Rows are rendered inline rather than through a shared `ThreadRow`. Plan §5.3
 * schedules `ThreadRow` for promotion into `@ptah-web/panel-ui`, but under the
 * rule that governs that lib a primitive earns its place when a SECOND panel
 * actually renders it — the admin community view is rebuilt onto native topics
 * in phase 2, so the promotion belongs to phase 2, not to a speculative
 * extraction now.
 */
@Component({
  selector: 'ptah-community-activity-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HubSectionCard, RouterLink, DatePipe, LucideAngularModule],
  template: `
    <ptah-hub-section-card
      title="Community activity"
      [status]="section().status"
      [emptyIcon]="MessagesSquareIcon"
      emptyMessage="No community activity yet."
      emptyHint="The native community replaces the old forum in phase 2. Threads you follow will appear here."
      unavailableMessage="Community activity could not be loaded."
      link="/members/community"
      linkLabel="View all"
    >
      <ul class="divide-y divide-hairline">
        @for (topic of topics(); track topic.id) {
          <li>
            <a
              [routerLink]="['/members/community/topics', topic.slug]"
              class="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-3 transition-colors hover:bg-surface-high"
            >
              <span class="flex items-start gap-2">
                @if (topic.pinned) {
                  <span
                    class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                }
                <span class="flex-1 text-sm font-semibold text-base-content">
                  {{ topic.title }}
                </span>
                @if (topic.unreadCount > 0) {
                  <span class="badge badge-primary badge-sm font-mono">
                    {{ topic.unreadCount }} new
                  </span>
                }
              </span>

              <span
                class="flex flex-wrap items-center gap-2 font-mono text-xs text-base-content/60"
              >
                <lucide-angular
                  [img]="MessageSquareIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
                {{ topic.replyCount }} replies
                <span aria-hidden="true">·</span>
                <span class="badge badge-ghost badge-xs">
                  {{ topic.categoryName }}
                </span>
                <span aria-hidden="true">·</span>
                <time [attr.datetime]="topic.lastPostedAt">
                  {{ topic.lastPostedAt | date: 'MMM d, HH:mm' }}
                </time>
              </span>
            </a>
          </li>
        }
      </ul>
    </ptah-hub-section-card>
  `,
})
export class CommunityActivityCard {
  public readonly section = input.required<HubSection<HubTopicSummary[]>>();

  protected readonly MessagesSquareIcon = MessagesSquare;
  protected readonly MessageSquareIcon = MessageSquare;

  /**
   * `[]` unless the section reports `'ok'`. The contract guarantees an array
   * payload even for `'unavailable'` so every renderer runs one code path, but
   * an unavailable section's array is not content we were told to trust.
   */
  protected readonly topics = computed<readonly HubTopicSummary[]>(() => {
    const section = this.section();
    return section.status === 'ok' ? section.data : [];
  });
}
