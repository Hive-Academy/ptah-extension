import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ExternalLink, LucideAngularModule } from 'lucide-angular';
import { CommunityTopic } from '@ptah-web/core';

/**
 * Time divisions for {@link formatRelativeTime}, walked coarsest-last so the
 * loop stops at the first unit whose magnitude the duration fits inside.
 */
const RELATIVE_DIVISIONS: ReadonlyArray<{
  readonly amount: number;
  readonly unit: Intl.RelativeTimeFormatUnit;
}> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/**
 * Pure, locale-aware relative time, e.g. "2 days ago" / "just now". Returns
 * `''` for a null/unparseable timestamp so callers can drop the segment
 * without special-casing. Uses the viewer's browser locale via
 * `Intl.RelativeTimeFormat`.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  let duration = (date.getTime() - Date.now()) / 1000;
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return '';
}

/** A topic prepared for display: SSO deep-link + a single muted meta line. */
interface CommunityTopicRow {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly meta: string;
}

/**
 * CommunityTopicListComponent — presentational list of the latest forum
 * topics on the members Community card. Each row is a one-click SSO deep-link
 * that lands an authenticated Builder inside the topic already logged into the
 * forum (`/session/sso?return_path=/t/<slug>/<id>`). The Discourse origin is
 * derived from the injected `communityUrl` — never hardcoded.
 */
@Component({
  selector: 'ptah-community-topic-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <ul class="mt-4 border-t border-secondary/10 divide-y divide-secondary/10">
      @for (row of rows(); track row.id) {
        <li>
          <a
            [href]="row.url"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex items-start gap-3 -mx-2 px-2 py-3 rounded-lg transition-colors hover:bg-base-300/40"
            [attr.aria-label]="'Open ' + row.title + ' in the community'"
          >
            <div class="flex-1 min-w-0">
              <p
                class="text-sm font-medium truncate transition-colors group-hover:text-secondary"
              >
                {{ row.title }}
              </p>
              @if (row.meta) {
                <p class="mt-0.5 text-xs text-neutral-content">
                  {{ row.meta }}
                </p>
              }
            </div>
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="w-3.5 h-3.5 mt-0.5 shrink-0 text-neutral-content transition-colors group-hover:text-secondary"
              aria-hidden="true"
            />
          </a>
        </li>
      }
    </ul>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CommunityTopicListComponent {
  protected readonly ExternalLinkIcon = ExternalLink;

  /** Discourse origin (no trailing slash) — used to build each SSO link. */
  public readonly communityUrl = input.required<string>();
  public readonly topics = input.required<readonly CommunityTopic[]>();

  /** Cap at 5, newest first (the API already orders them), with view meta. */
  protected readonly rows = computed<CommunityTopicRow[]>(() => {
    const origin = this.communityUrl();
    return this.topics()
      .slice(0, 5)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        url: `${origin}/session/sso?return_path=${encodeURIComponent(
          `/t/${topic.slug}/${topic.id}`,
        )}`,
        meta: buildMeta(topic),
      }));
  });
}

/** "General · 2 days ago · 5 posts" — empty segments dropped. */
function buildMeta(topic: CommunityTopic): string {
  const parts: string[] = [];
  if (topic.categoryName) parts.push(topic.categoryName);
  const relative = formatRelativeTime(topic.lastPostedAt);
  if (relative) parts.push(relative);
  parts.push(
    `${topic.postsCount} ${topic.postsCount === 1 ? 'post' : 'posts'}`,
  );
  return parts.join(' · ');
}
