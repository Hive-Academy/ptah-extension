import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  LucideAngularModule,
} from 'lucide-angular';
import type {
  GitPrChecksSummary,
  GitPrInfo,
  GitPrStatusResult,
  GitPrUnavailableReason,
} from '@ptah-extension/shared';

/** The muted line each quiet reason shows instead of the PR details. */
const PR_UNAVAILABLE_TEXT: Record<GitPrUnavailableReason, string> = {
  'gh-missing': 'GitHub CLI not available — PR status hidden.',
  'not-authenticated': 'GitHub CLI is not signed in — PR status hidden.',
  // No remote at all, or none on GitHub (the backend maps both here).
  'not-github': 'No GitHub remote — PR status hidden.',
  'no-pr': 'No pull request found for this branch.',
  timeout: 'GitHub did not answer in time — PR status hidden.',
  failed: 'PR status could not be read.',
};

const REVIEW_DECISION_TEXT: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
};

interface PrBadge {
  readonly label: string;
  readonly classes: string;
}

/**
 * Status is a badge, never a button (design-spec §10). Merged uses an outline
 * badge and closed the corrected solid-error pairing: stock `badge-secondary`
 * and `badge-error` fail AA at this size (design-spec §0, §13a).
 */
function prBadge(pr: GitPrInfo): PrBadge {
  const state = pr.state.toUpperCase();
  if (state === 'OPEN' && pr.isDraft) {
    return { label: 'draft', classes: 'badge badge-xs badge-ghost' };
  }
  if (state === 'OPEN') {
    return {
      label: 'open',
      classes: 'badge badge-xs badge-success ok-solid-text',
    };
  }
  if (state === 'MERGED') {
    return { label: 'merged', classes: 'badge badge-xs badge-outline' };
  }
  if (state === 'CLOSED') {
    return {
      label: 'closed',
      classes: 'badge badge-xs border-error bg-error err-solid-text',
    };
  }
  return {
    label: pr.state.toLowerCase(),
    classes: 'badge badge-xs badge-ghost',
  };
}

function reviewDecisionText(decision: GitPrInfo['reviewDecision']): string {
  if (!decision) return '';
  return REVIEW_DECISION_TEXT[decision] ?? decision;
}

/** Only an `https:` URL is offered as a link (the backend filters too). */
function httpsUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    // degradation-audit: optional-capability - an unparseable URL is simply not offered as a link
    return null;
  }
}

interface PrOkView {
  readonly pr: GitPrInfo;
  readonly badge: PrBadge;
  readonly decision: string;
  readonly url: string | null;
  readonly checks: GitPrChecksSummary;
}

interface PrUnavailableView {
  readonly reason: GitPrUnavailableReason;
  readonly text: string;
}

/**
 * TaskPrPanelComponent — the Pull request panel of the Task tab
 * (design-spec §10). Presentational: the task view owns the reads and the
 * refresh timer and hands the latest result in; `null` means none yet.
 *
 * - **Found.** Number and title, a state badge, the review decision and the
 *   CI passing / failing / pending counts. "Open PR" is an anchor with
 *   `target="_blank" rel="noopener noreferrer"`, offered only for an `https:`
 *   URL; Electron routes it to the browser through the main window's
 *   window-open handler.
 * - **Unavailable.** Every reason is one muted line with no alert role or
 *   error styling (Requirement 10.4).
 */
@Component({
  selector: 'ptah-task-pr-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1' },
  template: `
    <h3 class="m-0 text-xs font-semibold">Pull request</h3>
    @if (okView(); as view) {
      <div class="flex min-w-0 items-center justify-between gap-2 text-sm">
        <span class="min-w-0 truncate font-medium" data-testid="task-pr-title"
          >#{{ view.pr.number }} {{ view.pr.title }}</span
        >
        <span [class]="view.badge.classes" data-testid="task-pr-state">{{
          view.badge.label
        }}</span>
      </div>
      @if (view.decision) {
        <p class="m-0 text-base-content-muted" data-testid="task-pr-review">
          Review: {{ view.decision }}
        </p>
      }
      <div class="flex flex-wrap items-center gap-2">
        @if (view.checks.total === 0) {
          <span class="text-base-content-muted" data-testid="task-pr-checks"
            >No checks</span
          >
        } @else {
          <span class="flex items-center gap-2" data-testid="task-pr-checks">
            <span class="flex items-center gap-0.5">
              <lucide-angular
                [img]="PassIcon"
                class="diff-add-text h-3 w-3"
                aria-hidden="true"
              />{{ view.checks.passing }} passing
            </span>
            <span class="flex items-center gap-0.5">
              <lucide-angular
                [img]="FailIcon"
                class="diff-del-text h-3 w-3"
                aria-hidden="true"
              />{{ view.checks.failing }} failing
            </span>
            <span class="flex items-center gap-0.5 text-base-content-muted">
              <lucide-angular
                [img]="PendingIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />{{ view.checks.pending }} pending
            </span>
          </span>
        }
        @if (view.url; as url) {
          <a
            class="btn btn-outline btn-xs ml-auto gap-1"
            data-testid="task-pr-open"
            target="_blank"
            rel="noopener noreferrer"
            [href]="url"
            >Open PR
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="h-3 w-3"
              aria-hidden="true"
          /></a>
        }
      </div>
    } @else if (unavailableView(); as view) {
      <p
        class="m-0 text-base-content-muted"
        data-testid="task-pr-unavailable"
        [attr.data-reason]="view.reason"
      >
        {{ view.text }}
      </p>
    } @else {
      <div
        role="status"
        aria-label="Loading pull request status"
        data-testid="task-pr-loading"
      >
        <div class="skeleton mb-1 h-4 w-48"></div>
        <div class="skeleton h-4 w-32"></div>
      </div>
    }
  `,
})
export class TaskPrPanelComponent {
  /** The latest `git:prStatus` result for the shown workspace; `null` while none. */
  readonly result = input<GitPrStatusResult | null>(null);

  protected readonly PassIcon = CircleCheck;
  protected readonly FailIcon = CircleX;
  protected readonly PendingIcon = CircleDot;
  protected readonly ExternalLinkIcon = ExternalLink;

  protected readonly okView = computed<PrOkView | null>(() => {
    const result = this.result();
    if (result?.status !== 'ok') return null;
    return {
      pr: result.pr,
      badge: prBadge(result.pr),
      decision: reviewDecisionText(result.pr.reviewDecision),
      url: httpsUrl(result.pr.url),
      checks: result.checks,
    };
  });

  protected readonly unavailableView = computed<PrUnavailableView | null>(
    () => {
      const result = this.result();
      if (result?.status !== 'unavailable') return null;
      return {
        reason: result.reason,
        text: PR_UNAVAILABLE_TEXT[result.reason] ?? PR_UNAVAILABLE_TEXT.failed,
      };
    },
  );
}
