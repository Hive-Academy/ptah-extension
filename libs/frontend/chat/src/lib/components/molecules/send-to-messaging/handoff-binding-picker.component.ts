import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, MessageSquare } from 'lucide-angular';
import type { GatewayBindingDto } from '@ptah-extension/shared';

/** A binding row in the hand-off picker, joined with its adapter's run state. */
export interface HandoffBindingRow {
  readonly binding: GatewayBindingDto;
  /** "Telegram · Ops room" — platform plus display name when present. */
  readonly label: string;
  readonly platformLabel: string;
  /**
   * Whether this binding's adapter is currently running. When the adapter run
   * state is unknown (the `gateway:status` probe failed) every row is treated
   * as selectable — the backend rejects an offline attach anyway.
   */
  readonly online: boolean;
}

/** Attach failure pinned to the row that produced it. */
export interface HandoffRowError {
  readonly bindingId: string;
  readonly message: string;
}

/**
 * HandoffBindingPickerComponent — the panel inside the hand-off popover.
 *
 * Purely presentational: it renders the loading / error / empty / list states,
 * greys out bindings whose adapter is stopped, and arms the inline
 * "Continue?" confirmation. It owns no RPC and no in-flight state — the
 * container (`SendToMessagingComponent`) drives all of it through inputs and
 * reacts to the four outputs.
 */
@Component({
  selector: 'ptah-handoff-binding-picker',
  imports: [LucideAngularModule],
  template: `
    <div
      role="listbox"
      [attr.aria-label]="heading()"
      data-testid="handoff-picker"
    >
      <div class="border-b border-base-300 px-2 pt-1.5 pb-2">
        <div class="text-xs font-semibold text-base-content">
          {{ heading() }}
        </div>
        <p class="mt-0.5 text-[11px] leading-snug text-base-content-muted">
          The platform you pick takes over this tab. It stays read-only here
          until you resolve it back.
        </p>
      </div>

      <div class="p-1">
        @if (loading()) {
          <div
            class="flex items-center gap-2 px-3 py-3 text-sm text-base-content-muted"
            data-testid="handoff-picker-loading"
          >
            <span class="loading loading-spinner loading-xs"></span>
            <span>Loading bindings…</span>
          </div>
        } @else if (loadError(); as msg) {
          <div
            class="px-3 py-3 text-xs text-error"
            role="alert"
            data-testid="handoff-picker-load-error"
          >
            <p>{{ msg }}</p>
            <button
              class="btn btn-ghost btn-xs mt-1.5 px-2"
              type="button"
              (click)="retry.emit()"
              data-testid="handoff-picker-retry"
            >
              Retry
            </button>
          </div>
        } @else if (rows().length === 0) {
          <div
            class="px-3 py-3 text-sm text-base-content-muted"
            data-testid="handoff-picker-empty"
          >
            No approved bindings. Approve one in the Gateway tab first.
          </div>
        } @else {
          @for (row of rows(); track row.binding.id) {
            <button
              class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              [disabled]="!row.online || attaching()"
              (click)="pick.emit(row)"
              type="button"
              role="option"
              [attr.aria-selected]="pendingConfirmId() === row.binding.id"
              [attr.data-testid]="'handoff-row-' + row.binding.id"
            >
              <lucide-angular
                [img]="MessageSquareIcon"
                class="w-3.5 h-3.5 flex-shrink-0 text-base-content-muted"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ row.label }}</span>
                @if (!row.online) {
                  <span
                    class="block truncate text-[10px] text-warning"
                    data-testid="handoff-row-offline"
                  >
                    {{ OFFLINE_NOTE }}
                  </span>
                }
              </span>
            </button>

            @if (pendingConfirmId() === row.binding.id) {
              <div
                class="mx-1 mb-1 rounded-md bg-base-200 px-2 py-1.5"
                data-testid="handoff-confirm"
              >
                <p class="text-[11px] leading-snug text-base-content">
                  {{ confirmPrompt(row) }}
                </p>
                <div class="mt-1.5 flex items-center gap-1">
                  <button
                    class="btn btn-primary btn-xs gap-1"
                    type="button"
                    [disabled]="attaching()"
                    (click)="confirmPick.emit(row.binding)"
                    data-testid="handoff-confirm-continue"
                  >
                    @if (attaching()) {
                      <span class="loading loading-spinner loading-xs"></span>
                    }
                    Continue
                  </button>
                  <button
                    class="btn btn-ghost btn-xs"
                    type="button"
                    [disabled]="attaching()"
                    (click)="cancelPick.emit()"
                    data-testid="handoff-confirm-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }

            @if (rowErrorFor(row.binding.id); as msg) {
              <p
                class="mx-1 mb-1 rounded-md bg-error/10 px-2 py-1.5 text-[11px] leading-snug text-error"
                role="alert"
                [attr.data-testid]="'handoff-row-error-' + row.binding.id"
              >
                {{ msg }}
              </p>
            }
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandoffBindingPickerComponent {
  readonly MessageSquareIcon = MessageSquare;
  readonly OFFLINE_NOTE = 'platform offline — start it in Gateway tab';

  /** Panel title; mirrors the trigger's label. */
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly HandoffBindingRow[]>();
  readonly loading = input.required<boolean>();
  readonly loadError = input.required<string | null>();
  /** Binding id whose inline "Continue?" confirmation is armed. */
  readonly pendingConfirmId = input.required<string | null>();
  readonly attaching = input.required<boolean>();
  readonly rowError = input.required<HandoffRowError | null>();

  /** Re-run the failed picker load. */
  readonly retry = output<void>();
  /** A row was chosen — arm the confirmation. */
  readonly pick = output<HandoffBindingRow>();
  /** The armed confirmation was accepted. */
  readonly confirmPick = output<GatewayBindingDto>();
  /** The armed confirmation was dismissed. */
  readonly cancelPick = output<void>();

  /** The attach error for a given row, if that row is the one that failed. */
  rowErrorFor(bindingId: string): string | null {
    const err = this.rowError();
    return err && err.bindingId === bindingId ? err.message : null;
  }

  /** The inline consequence + confirm sentence for a row. */
  confirmPrompt(row: HandoffBindingRow): string {
    return `This tab becomes read-only and is driven from ${row.label}. Continue?`;
  }
}
