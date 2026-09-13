import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  PeerSessionRow,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { PeerSessionPickerComponent } from '@ptah-extension/ui';

/**
 * PeerSessionSendDialogComponent — presentational modal dialog for composing
 * and dispatching a message to another peer session.
 *
 * Requirements & Invariants (TASK_2026_402 §11):
 * - Criterion 4: The outcome is reported strictly as 'accepted' or 'refused',
 *   NEVER 'delivered'. The mandatory `acceptanceCaveat` string is rendered
 *   prominently to the user in full, not logged and not dropped. No identifier,
 *   CSS class, or user-facing string is named for delivery, receipt, or
 *   acknowledgement.
 * - Criterion 5: The two costs (`costsATurn` and `modelMayDecline`) are explicitly
 *   disclosed to the user BEFORE sending:
 *     1. Consumes a turn in the active session.
 *     2. The model mediates the send and may rephrase or decline outright.
 * - Criterion 6: Delegates picker open events to `pickerOpened` so the host
 *   refreshes the list on open.
 * - Stateless / dumb component: pure `input()` and `output()` signals,
 *   no injected services, ChangeDetectionStrategy.OnPush.
 */
@Component({
  selector: 'ptah-peer-session-send-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PeerSessionPickerComponent],
  template: `
    @if (isOpen()) {
      <dialog class="modal modal-open" data-testid="peer-session-send-dialog">
        <div class="modal-box max-w-lg">
          <div
            class="flex items-center justify-between pb-3 border-b border-base-300"
          >
            <h3
              class="font-bold text-base text-base-content"
              data-testid="peer-session-dialog-title"
            >
              Message Peer Session
            </h3>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-circle"
              (click)="onClose()"
              [disabled]="isSending()"
              aria-label="Close dialog"
              data-testid="peer-session-dialog-close-btn"
            >
              ✕
            </button>
          </div>

          <div class="py-3 flex flex-col gap-3">
            <!-- Target session picker -->
            <div class="flex flex-col gap-1">
              <span class="text-xs font-semibold text-base-content-muted">
                Target Peer Session
              </span>
              <ptah-peer-session-picker
                [sessions]="sessions()"
                [selectedSessionId]="selectedSessionId()"
                (opened)="pickerOpened.emit()"
                (selectionChange)="sessionSelected.emit($event)"
              />
            </div>

            <!-- Selected session details -->
            @if (selectedSession(); as target) {
              <div
                class="text-xs text-base-content-muted bg-base-200/50 p-2 rounded flex items-center justify-between"
                data-testid="peer-session-target-details"
              >
                <span>Workspace: {{ target.workspaceLabel }}</span>
                <span
                  class="badge badge-xs"
                  [class.badge-success]="target.reachability === 'reachable'"
                  [class.badge-error]="target.reachability === 'unreachable'"
                >
                  {{ target.reachability }}
                </span>
              </div>
            }

            <!-- Message input textarea -->
            <div class="flex flex-col gap-1">
              <label
                for="peer-session-message-input"
                class="text-xs font-semibold text-base-content-muted"
              >
                Message
              </label>
              <textarea
                id="peer-session-message-input"
                class="textarea textarea-bordered w-full h-24 text-sm resize-none"
                placeholder="Type a message or instruction for the peer session..."
                [value]="message()"
                (input)="onMessageInput($event)"
                [disabled]="isSending() || sendResult() !== null"
                data-testid="peer-session-message-input"
              ></textarea>
            </div>

            <!-- Criterion 5: Cost disclosure notice BEFORE sending -->
            <div
              class="p-2.5 rounded border border-warning/30 bg-warning/10 text-xs text-base-content"
              data-testid="peer-session-cost-disclosure"
            >
              <div
                class="font-semibold text-warning-content flex items-center gap-1 mb-1"
              >
                <span>Notice before sending</span>
              </div>
              <ul
                class="list-disc list-inside space-y-0.5 text-base-content-muted"
              >
                <li data-testid="peer-cost-consumes-turn">
                  <strong>Consumes a turn:</strong> Sending this message consumes
                  a turn in this session.
                </li>
                <li data-testid="peer-cost-model-may-decline">
                  <strong>Model-mediated:</strong> The model executes the send
                  and may rephrase or decline outright.
                </li>
              </ul>
            </div>

            <!-- Cannot send warning if applicable -->
            @if (!canSend() && cannotSendReason()) {
              <div
                class="alert alert-warning text-xs"
                data-testid="peer-session-cannot-send-warning"
              >
                <span>{{ cannotSendReason() }}</span>
              </div>
            }

            <!-- Criterion 4: Outcome presentation (Accepted or Refused) -->
            @if (sendResult(); as res) {
              <div
                class="p-3 rounded border text-xs"
                [class.border-info/40]="res.outcome === 'accepted'"
                [class.bg-info/10]="res.outcome === 'accepted'"
                [class.border-error/40]="res.outcome === 'refused'"
                [class.bg-error/10]="res.outcome === 'refused'"
                data-testid="peer-session-outcome-panel"
              >
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="font-semibold text-xs uppercase tracking-wide">
                    Status:
                  </span>
                  @if (res.outcome === 'accepted') {
                    <span
                      class="badge badge-info badge-sm font-medium"
                      data-testid="peer-session-outcome"
                    >
                      Accepted
                    </span>
                  } @else {
                    <span
                      class="badge badge-error badge-sm font-medium"
                      data-testid="peer-session-outcome"
                    >
                      Refused
                    </span>
                  }
                  @if (res.target?.name) {
                    <span
                      class="text-base-content-muted"
                      data-testid="peer-session-target-name"
                    >
                      Target: {{ res.target?.name }}
                    </span>
                  }
                </div>

                @if (res.reason) {
                  <div
                    class="text-error font-medium mb-1"
                    data-testid="peer-session-refusal-reason"
                  >
                    Reason: {{ res.reason }}
                  </div>
                }
                @if (res.detail) {
                  <div
                    class="text-base-content-muted mb-1"
                    data-testid="peer-session-refusal-detail"
                  >
                    {{ res.detail }}
                  </div>
                }

                <!-- Required acceptanceCaveat rendered prominently to the user -->
                <div
                  class="mt-2 pt-2 border-t border-base-content/10 text-base-content-muted font-mono text-[11px] leading-relaxed"
                  data-testid="peer-session-acceptance-caveat"
                >
                  {{ res.acceptanceCaveat }}
                </div>
              </div>
            }

            <!-- General error alert -->
            @if (sendError()) {
              <div
                class="alert alert-error text-xs"
                data-testid="peer-session-error-alert"
              >
                <span>{{ sendError() }}</span>
              </div>
            }
          </div>

          <!-- Action buttons -->
          <div class="modal-action mt-2 pt-2 border-t border-base-300">
            @if (sendResult()) {
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                (click)="resetOutcome.emit()"
                data-testid="peer-session-reset-btn"
              >
                Send another
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                (click)="onClose()"
                data-testid="peer-session-done-btn"
              >
                Done
              </button>
            } @else {
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                (click)="onClose()"
                [disabled]="isSending()"
                data-testid="peer-session-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                [disabled]="isActionDisabled()"
                (click)="sendRequested.emit()"
                data-testid="peer-session-submit-btn"
              >
                @if (isSending()) {
                  <span class="loading loading-spinner loading-xs"></span>
                  <span>Sending...</span>
                } @else {
                  <span>Send</span>
                }
              </button>
            }
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button type="button" (click)="onClose()" [disabled]="isSending()">
            close
          </button>
        </form>
      </dialog>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PeerSessionSendDialogComponent {
  readonly isOpen = input.required<boolean>();
  readonly sessions = input.required<readonly PeerSessionRow[]>();
  readonly selectedSessionId = input<string | null>(null);
  readonly message = input<string>('');
  readonly isSending = input<boolean>(false);
  readonly sendResult = input<PeerSessionSendResult | null>(null);
  readonly sendError = input<string | null>(null);
  readonly canSend = input<boolean>(true);
  readonly cannotSendReason = input<string | null>(null);

  readonly pickerOpened = output<void>();
  readonly sessionSelected = output<PeerSessionRow>();
  readonly messageChange = output<string>();
  readonly sendRequested = output<void>();
  readonly closed = output<void>();
  readonly resetOutcome = output<void>();

  protected readonly selectedSession = computed(() => {
    const id = this.selectedSessionId();
    return this.sessions().find((s) => s.sessionId === id) ?? null;
  });

  protected readonly isActionDisabled = computed(() => {
    if (!this.canSend() || this.isSending()) {
      return true;
    }
    const session = this.selectedSession();
    if (!session || session.reachability === 'unreachable') {
      return true;
    }
    return this.message().trim().length === 0;
  });

  protected onMessageInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.messageChange.emit(target?.value ?? '');
  }

  protected onClose(): void {
    if (!this.isSending()) {
      this.closed.emit();
    }
  }
}
