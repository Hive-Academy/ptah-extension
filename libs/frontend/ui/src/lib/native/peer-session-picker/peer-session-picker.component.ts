/**
 * PeerSessionPickerComponent - presentational selector for addressable peer sessions.
 *
 * Takes a list of {@link PeerSessionRow} records as an input and emits the one
 * the user chooses. It does not fetch the list itself; a host facade or
 * orchestrator passes the rows in and uses the `opened` event to refresh them.
 *
 * Compliance with Requirement 11:
 * - Every row is rendered, including unreachable rows. They are shown disabled
 *   with the reason the backend supplied (criterion 2).
 * - Rows from another workspace carry a visible badge driven by
 *   `inCurrentWorkspace` (criterion 3).
 * - Opening the picker emits `opened` so the host can reload the list (criterion 6).
 *
 * Built on the existing `native/dropdown` and `native/option` primitives; no new
 * overlay mechanism is introduced.
 *
 * @example
 * ```html
 * <ptah-peer-session-picker
 *   [sessions]="sessions()"
 *   [selectedSessionId]="selectedId()"
 *   (opened)="refreshSessions()"
 *   (selectionChange)="sendToSession($event)"
 * />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  PeerSessionRow,
  PeerSessionUnreachableReason,
} from '@ptah-extension/shared';

import { NativeDropdownComponent } from '../dropdown';
import { NativeOptionComponent } from '../option';

/** Human-readable text for the backend's unreachable reason codes. */
function unreachableReasonText(
  reason: PeerSessionUnreachableReason | undefined,
): string {
  switch (reason) {
    case 'process-not-running':
      return 'process not running';
    case 'process-identity-mismatch':
      return 'process identity mismatch';
    case 'liveness-unverified':
      return 'liveness unverified';
    case 'other-host':
      return 'other host';
    case 'no-messaging-channel':
      return 'no messaging channel';
    case 'record-unreadable':
      return 'record unreadable';
    default:
      return 'unreachable';
  }
}

@Component({
  selector: 'ptah-peer-session-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeDropdownComponent, NativeOptionComponent],
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      placement="bottom-start"
      [hasBackdrop]="true"
      backdropClass="transparent"
      [closeOnBackdropClick]="true"
      (closed)="close()"
    >
      <button
        trigger
        type="button"
        class="btn btn-sm btn-outline"
        [attr.aria-label]="triggerLabel()"
        (click)="toggle()"
      >
        {{ triggerText() }}
      </button>

      <div
        content
        class="w-80 max-h-80 overflow-y-auto p-1"
        role="listbox"
        [attr.aria-label]="listLabel()"
      >
        @if (sessions().length === 0) {
          <p
            class="px-3 py-2 text-sm text-base-content-muted"
            data-testid="peer-session-picker-empty"
          >
            No peer sessions available.
          </p>
        } @else {
          <ul class="flex flex-col gap-0.5" role="none">
            @for (session of sessions(); track session.sessionId) {
              <li role="none">
                <ptah-native-option
                  [optionId]="'peer-session-' + session.sessionId"
                  [value]="session"
                  [disabled]="session.reachability === 'unreachable'"
                  [isActive]="activeIndex() === $index"
                  (selected)="select(session)"
                  (hovered)="setActive($index)"
                >
                  <div class="flex flex-col gap-0.5">
                    <div class="flex items-center gap-2 text-sm">
                      <span class="font-medium text-base-content" data-testid="peer-session-picker-name">
                        {{ session.name }}
                      </span>
                      @if (!session.inCurrentWorkspace) {
                        <span
                          class="badge badge-xs badge-ghost"
                          data-testid="peer-session-picker-cross-workspace"
                        >
                          other workspace
                        </span>
                      }
                    </div>
                    <div class="flex items-center gap-2 text-xs text-base-content-muted">
                      <span data-testid="peer-session-picker-workspace">
                        {{ session.workspaceLabel }}
                      </span>
                      @if (session.reachability === 'unreachable') {
                        <span
                          class="text-error"
                          data-testid="peer-session-picker-reason"
                        >
                          {{ unreachableReasonText(session.unreachableReason) }}
                        </span>
                      }
                    </div>
                  </div>
                </ptah-native-option>
              </li>
            }
          </ul>
        }
      </div>
    </ptah-native-dropdown>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
    `,
  ],
})
export class PeerSessionPickerComponent {
  /** Rows to render. Unreachable rows are shown, not filtered out. */
  readonly sessions = input.required<readonly PeerSessionRow[]>();

  /** Optional id of the row that should be reflected as the current selection. */
  readonly selectedSessionId = input<string | null>(null);

  /** Visible label used for ARIA and the default placeholder. */
  readonly label = input<string>('Peer session');

  /** Text shown in the trigger when no row is selected. */
  readonly placeholder = input<string>('Select a peer session');

  /** Emitted when the user chooses a reachable session. */
  readonly selectionChange = output<PeerSessionRow>();

  /** Emitted whenever the picker is opened so the host can refresh the list. */
  readonly opened = output<void>();

  private readonly _isOpen = signal(false);
  private readonly _activeIndex = signal<number>(-1);

  protected readonly isOpen = this._isOpen.asReadonly();
  protected readonly activeIndex = this._activeIndex.asReadonly();

  protected readonly selectedSession = computed<PeerSessionRow | null>(() => {
    const id = this.selectedSessionId();
    return this.sessions().find((s) => s.sessionId === id) ?? null;
  });

  protected readonly triggerText = computed(() => {
    const selected = this.selectedSession();
    return selected ? selected.name : this.placeholder();
  });

  protected readonly triggerLabel = computed(
    () => `${this.label()} trigger`,
  );

  protected readonly listLabel = computed(() => `${this.label()} sessions`);

  protected readonly unreachableReasonText = unreachableReasonText;

  constructor() {
    effect(() => {
      const sessions = this.sessions();
      const selectedId = this.selectedSessionId();
      const selectedIndex = sessions.findIndex(
        (s) => s.sessionId === selectedId,
      );
      if (selectedIndex >= 0) {
        this._activeIndex.set(selectedIndex);
        return;
      }
      const firstReachable = sessions.findIndex(
        (s) => s.reachability === 'reachable',
      );
      this._activeIndex.set(firstReachable >= 0 ? firstReachable : -1);
    });
  }

  protected toggle(): void {
    if (this._isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  protected open(): void {
    this._isOpen.set(true);
    this.opened.emit();
  }

  protected close(): void {
    this._isOpen.set(false);
    this._activeIndex.set(-1);
  }

  protected setActive(index: number): void {
    this._activeIndex.set(index);
  }

  protected select(session: PeerSessionRow): void {
    if (session.reachability === 'unreachable') {
      return;
    }
    this.selectionChange.emit(session);
    this.close();
  }
}
