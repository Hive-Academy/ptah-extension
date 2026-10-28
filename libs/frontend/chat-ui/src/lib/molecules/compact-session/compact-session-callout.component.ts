import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { AttentionPermissionActionsComponent, type AttentionItem } from '@ptah-extension/core';
import type {
  CompactCallout,
  CompactPermissionCallout,
  CompactPermissionDecision,
} from './compact-lane.types';

/** Fixed-height attention slot for the compact card. */
@Component({
  selector: 'ptah-compact-session-callout',
  standalone: true,
  imports: [AttentionPermissionActionsComponent],
  host: { class: 'block min-h-20 min-w-0 shrink-0' },
  template: `
    @if (permission(); as request) {
      <div
        class="flex min-h-20 min-w-0 flex-col gap-1.5 rounded border border-warning/30 bg-warning/10 p-2 text-xs"
        role="group"
        aria-label="Permission request"
        data-testid="cs-callout-permission"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate" [title]="request.text">{{
            request.text
          }}</span>
          @if (request.moreCount) {
            <span class="shrink-0 text-base-content-muted"
              >+{{ request.moreCount }} more</span
            >
          }
        </div>
        <div class="flex min-w-0 flex-wrap items-start gap-1.5">
          @for (item of permissionItems(); track item.key) {
            <ptah-attention-permission-actions class="min-w-0" [item]="item" [compact]="true" (selected)="choose(request, $event.actionId, $event.reason)" />
          }
          <button
            type="button"
            class="btn btn-sm btn-ghost min-h-7 h-7 px-2"
            (click)="openRequest.emit(request)"
          >
            Open
          </button>
        </div>
      </div>
    } @else if (question(); as request) {
      <div
        class="flex h-20 min-w-0 flex-col gap-1.5 rounded border border-warning/30 bg-warning/10 p-2 text-xs"
        role="group"
        aria-label="Question request"
        data-testid="cs-callout-question"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate" [title]="request.text">{{
            request.text
          }}</span>
          @if (request.moreCount) {
            <span class="shrink-0 text-base-content-muted"
              >+{{ request.moreCount }} more</span
            >
          }
        </div>
        <button
          type="button"
          class="btn btn-xs btn-primary self-start"
          (click)="answer.emit()"
        >
          Answer
        </button>
      </div>
    } @else if (error(); as issue) {
      <div
        class="flex h-20 min-w-0 flex-col gap-1.5 rounded border border-error/30 bg-error/10 p-2 text-xs"
        role="group"
        aria-label="Session error"
        data-testid="cs-callout-error"
      >
        <span class="truncate text-error" [title]="issue.text">{{
          issue.text
        }}</span>
        <div class="flex gap-1.5">
          @if (issue.canRetry) {
            <button
              type="button"
              class="btn btn-xs btn-outline"
              (click)="retry.emit()"
            >
              Retry
            </button>
          }
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="showOutput.emit()"
          >
            Show output
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionCalloutComponent {
  readonly callout = input<CompactCallout>(null);
  readonly decide = output<CompactPermissionDecision>();
  readonly answer = output<void>();
  readonly openRequest = output<CompactPermissionCallout>();
  readonly retry = output<void>();
  readonly showOutput = output<void>();

  readonly permission = computed(() => {
    const value = this.callout();
    return value?.kind === 'permission' ? value : null;
  });
  /** The shared permission controls, so the compact tile offers the bell's options; lanes only accept allow and deny. */
  readonly permissionItem = computed<AttentionItem | null>(() => {
    const request = this.permission();
    if (!request) return null;
    const session = request.source === 'session';
    return {
      key: `compact:${request.requestId}`, generation: 1,
      kind: session ? 'permission' : 'lane-permission', source: 'chat',
      workspacePath: '', workspaceName: '', severity: 'warning', title: request.text,
      actionable: true, soundEligible: false,
      actions: [
        { id: 'allow', label: 'Allow' },
        ...(session ? [{ id: 'always_allow', label: 'Always allow' }] : []),
        { id: 'deny', label: 'Deny' },
        ...(session ? [{ id: 'deny_with_message', label: 'Deny with message' }] : []),
      ],
    };
  });
  /** Keyed by request, so an open menu or a typed reason never carries over to the next request. */
  readonly permissionItems = computed(() => { const item = this.permissionItem(); return item ? [item] : []; });
  readonly question = computed(() => {
    const value = this.callout();
    return value?.kind === 'question' ? value : null;
  });
  choose(callout: CompactPermissionCallout, actionId: string, reason?: string): void {
    this.decide.emit({ callout, decision: actionId as CompactPermissionDecision['decision'], reason });
  }
  readonly error = computed(() => {
    const value = this.callout();
    return value?.kind === 'error' ? value : null;
  });
}
