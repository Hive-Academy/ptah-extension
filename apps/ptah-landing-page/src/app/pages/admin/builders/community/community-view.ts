import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MessagesSquare } from 'lucide-angular';

import {
  AdminBuildersApiService,
  AdminCommunityTopic,
  ReviewQueueItem,
} from '../../../../services/admin-builders-api.service';
import { EmptyState } from '../../components/empty-state/empty-state';
import { StatTile } from '../../components/stat-tile/stat-tile';

/** A topic row with its Discourse deep link precomputed. */
interface TopicRow extends AdminCommunityTopic {
  href: string | null;
}

/**
 * CommunityView — read-only triage surface over the Builders Discourse forum.
 * Route: `/admin/builders/community`.
 *
 * ⚠️ THERE ARE NO MODERATION CONTROLS HERE, BY DECISION, NOT BY OMISSION.
 * All Discourse moderation stays in Discourse's own admin panel, where the
 * admin already has full rights and — more importantly — the context an action
 * needs (post body, author history, prior flags, trust level) plus undo. The
 * server side has no write endpoint to call: `AdminCommunityController` exposes
 * only `@Get` handlers, asserted by a structural test.
 *
 * So this view answers exactly two questions — "is anything happening?" and
 * "does anything need me?" — then hands off to Discourse via deep links. It is
 * named `CommunityView` rather than `CommunityModeration` so the name cannot
 * imply a capability it does not have.
 *
 * Its existence is nonetheless the point of the task: it reads the same forum
 * data as `GET /api/v1/community/summary`, but through `AdminGuard` instead of
 * the Builders membership gate, so a staff admin holding no paid membership can
 * see member community content. The member endpoint is untouched.
 */
@Component({
  selector: 'ptah-admin-community-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, EmptyState, StatTile],
  templateUrl: './community-view.html',
})
export class CommunityView {
  private readonly api = inject(AdminBuildersApiService);

  protected readonly CommunityIcon = MessagesSquare;

  protected readonly topics = signal<AdminCommunityTopic[]>([]);
  protected readonly communityUrl = signal<string | null>(null);
  /** False when Discourse is not configured on this server. */
  protected readonly enabled = signal<boolean>(true);
  protected readonly topicsLoading = signal<boolean>(false);
  protected readonly topicsError = signal<string | null>(null);
  protected readonly topicsLoaded = signal<boolean>(false);

  protected readonly reviewItems = signal<ReviewQueueItem[]>([]);
  protected readonly reviewCount = signal<number>(0);
  protected readonly reviewUrl = signal<string | null>(null);
  protected readonly reviewLoading = signal<boolean>(false);
  protected readonly reviewError = signal<string | null>(null);

  /**
   * Topic rows with `{communityUrl}/t/{slug}/{id}` precomputed. `href` is null
   * when Discourse is unconfigured, in which case the title renders as plain
   * text rather than a dead link.
   */
  protected readonly topicRows = computed<TopicRow[]>(() => {
    const base = this.communityUrl()?.replace(/\/+$/, '') ?? null;
    return this.topics().map((t) => ({
      ...t,
      href: base ? `${base}/t/${t.slug}/${t.id}` : null,
    }));
  });

  /** Discourse is configured but has nothing to show — distinct from "off". */
  protected readonly showEmptyTopics = computed<boolean>(
    () => this.topicsLoaded() && this.enabled() && this.topics().length === 0,
  );

  /** Discourse is switched off on this server. */
  protected readonly showDisabled = computed<boolean>(
    () => this.topicsLoaded() && !this.enabled(),
  );

  protected readonly reviewTone = computed<'warning' | 'neutral'>(() =>
    this.reviewCount() > 0 ? 'warning' : 'neutral',
  );

  public constructor() {
    this.fetch();
  }

  protected fetch(): void {
    this.fetchTopics();
    this.fetchReviewQueue();
  }

  protected fetchTopics(): void {
    this.topicsLoading.set(true);
    this.topicsError.set(null);
    this.api.listCommunityTopics({ limit: 20 }).subscribe({
      next: (res) => {
        this.topics.set(res.topics);
        this.communityUrl.set(res.communityUrl);
        this.enabled.set(res.enabled);
        this.topicsLoading.set(false);
        this.topicsLoaded.set(true);
      },
      error: (err: unknown) => {
        this.topicsLoading.set(false);
        this.topicsError.set(
          this.extractErrorMessage(err, 'Failed to load community topics.'),
        );
      },
    });
  }

  protected fetchReviewQueue(): void {
    this.reviewLoading.set(true);
    this.reviewError.set(null);
    this.api.getReviewQueue().subscribe({
      next: (res) => {
        this.reviewItems.set(res.items);
        this.reviewCount.set(res.count);
        this.reviewUrl.set(res.reviewUrl);
        this.reviewLoading.set(false);
      },
      error: (err: unknown) => {
        this.reviewLoading.set(false);
        this.reviewError.set(
          this.extractErrorMessage(err, 'Failed to load the review queue.'),
        );
      },
    });
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as {
        error?: { message?: string | string[] };
        message?: string;
      };
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return fallback;
  }
}
