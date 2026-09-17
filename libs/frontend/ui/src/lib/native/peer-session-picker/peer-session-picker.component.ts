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
 * - When a row carries `ptahTitle` (TASK_2026_449), that title is the primary
 *   label in the row and the trigger; the CLI registry `name` — the address
 *   agents use — is shown beneath it as muted monospace text. When the name no
 *   longer reflects the title (a rename after spawn), a muted hint says the
 *   address updates on the next resume.
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

/** True when the row carries a non-blank Ptah session title. */
function hasPtahTitle(session: PeerSessionRow): boolean {
  return (session.ptahTitle?.trim() ?? '') !== '';
}

/**
 * The label a user recognises: the Ptah tab title when Ptah knows the session,
 * otherwise the CLI registry name. The registry name stays visible as
 * secondary text because it is the address agents use.
 */
function primaryLabel(session: PeerSessionRow): string {
  return hasPtahTitle(session) ? (session.ptahTitle ?? '').trim() : session.name;
}

/**
 * Mirror of `slugify` in
 * `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts` (the rule
 * `buildSessionName` applies to the role). Copied, not imported: frontend libs
 * must not import backend libs. Keep the two in step.
 */
function slugifyLikeSessionName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The shortest length a registry name can have once `buildSessionName`
 * truncated its head. The composed name is capped at 64 characters; the head
 * is sliced to `64 - suffix - 1` and loses at most one trailing dash (slugs
 * never hold two in a row), so a truncated name is always at least 63 long,
 * whatever the suffix length.
 */
const TRUNCATED_NAME_MIN_LENGTH = 63;

/**
 * True when the registry name still reflects the Ptah title, i.e. the session
 * was NOT renamed since its CLI process spawned.
 *
 * The registry name is `ptah-<workspace>-<role>-<suffix>` with the head capped
 * (see `buildSessionName`). Only the ROLE is compared: matching anywhere in the
 * name let a title collide with the prefix or the workspace segment ("Ptah
 * Extension" against `ptah-ptah-extension-chat-0b8a10`) and hid a real rename.
 * Rule:
 *  1. An empty slug (e.g. an emoji-only title) is never flagged: match.
 *  2. A name that does not parse as `ptah-<workspace slug>-<role>-<suffix>`
 *     (a CLI-derived name, or a workspace label that differs from the spawn
 *     cwd) has no role to compare, so it falls back to "contains the slug".
 *  3. The role equals the slug: match.
 *  4. The name is at the cap length, so the role was cut short: match when the
 *     slug starts with the role. The cap-length guard stops a longer new title
 *     ("branch view extended") from matching a short old role ("branch-view").
 * Anything else is treated as renamed. A `-<taskId>` segment is not modelled:
 * no chat or Ptah CLI caller passes one to `buildSessionName`.
 */
function titleMatchesRegistryName(session: PeerSessionRow): boolean {
  const slug = slugifyLikeSessionName(session.ptahTitle ?? '');
  if (slug === '') {
    return true;
  }
  const prefix = `ptah-${slugifyLikeSessionName(session.workspaceLabel)}-`;
  const suffixStart = session.name.lastIndexOf('-');
  if (!session.name.startsWith(prefix) || suffixStart <= prefix.length) {
    return session.name.includes(slug);
  }
  const role = session.name.slice(prefix.length, suffixStart);
  if (role === slug) {
    return true;
  }
  return (
    session.name.length >= TRUNCATED_NAME_MIN_LENGTH && slug.startsWith(role)
  );
}

/** Show the rename hint only for a titled row whose address predates a rename. */
function showRenameHint(session: PeerSessionRow): boolean {
  return hasPtahTitle(session) && !titleMatchesRegistryName(session);
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
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="flex items-center gap-2 text-sm">
                      <span class="font-medium text-base-content truncate" data-testid="peer-session-picker-name">
                        {{ primaryLabel(session) }}
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
                    @if (hasPtahTitle(session)) {
                      <span
                        class="font-mono text-xs text-base-content-muted truncate"
                        [attr.title]="session.name"
                        data-testid="peer-session-picker-registry-name"
                      >
                        {{ session.name }}
                      </span>
                    }
                    @if (showRenameHint(session)) {
                      <span
                        class="text-xs italic text-base-content-muted"
                        data-testid="peer-session-picker-rename-hint"
                      >
                        renamed · address updates on next resume
                      </span>
                    }
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
    return selected ? primaryLabel(selected) : this.placeholder();
  });

  protected readonly triggerLabel = computed(
    () => `${this.label()} trigger`,
  );

  protected readonly listLabel = computed(() => `${this.label()} sessions`);

  protected readonly unreachableReasonText = unreachableReasonText;
  protected readonly primaryLabel = primaryLabel;
  protected readonly hasPtahTitle = hasPtahTitle;
  protected readonly showRenameHint = showRenameHint;

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
