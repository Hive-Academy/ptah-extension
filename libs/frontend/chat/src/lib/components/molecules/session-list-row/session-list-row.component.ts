/**
 * SessionListRowComponent — one row of the previous-sessions list
 * (TASK_2026_679, plan component 8b, design 3.6-3.10).
 *
 * Presentational: the modal owns the rename draft, the verbs and focus after
 * a verb; the row renders one session and reports what the user did.
 *
 * The host is the list item itself (`li[ptah-session-list-row]`), so the
 * current and open-in-a-tab highlight is painted on the whole `li`: the row
 * button and the organization chips line under it share one fill and one
 * left accent (D12). The two state classes are host classes styled here, not
 * in `styles.css` (plan DP-4).
 *
 * Inline rename: Enter or blur reports `renameCommitted` (with what ended
 * it, so the modal moves focus only after Enter), Escape reports
 * `renameCancelled` and stops there, so a document-level Escape listener
 * (canvas) or the modal's own Escape does not also run.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, Pencil, Tag, Trash2 } from 'lucide-angular';
import type { WorkflowKind } from '@ptah-extension/chat-types';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { SessionDisplayUtils } from '../../../services/session-display-utils.service';
import { SESSION_NAME_MAX_LENGTH } from '../../../services/session-list/session-row-actions.service';
import { WorkflowBadgeComponent } from '../../atoms/workflow-badge.component';
import { SessionLivePhaseIndicatorComponent } from '../../atoms/session-organization-chips/session-live-phase-indicator.component';
import { SessionOrganizationChipsComponent } from '../../atoms/session-organization-chips/session-organization-chips.component';

/** What ended an inline rename that saves. */
export type SessionRenameCommitTrigger = 'enter' | 'blur';

/**
 * The app's keyboard focus ring (`styles.css` `:focus-visible`). daisyUI's
 * `.input` focus outline is a 20% tint and wins over the global rule, so the
 * rename field restates it as utilities.
 */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]';

const ACTION_BUTTON =
  'btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 rounded text-base-content-muted';

let nextId = 0;

/**
 * Row host styles (plan DP-4). Exported so the spec can pin D12: the jest
 * preset strips component styles, so the rendered sheet is not in the DOM.
 */
export const SESSION_LIST_ROW_STYLES = `
  :host {
    display: block;
    position: relative;
    border-radius: 0.375rem;
    transition: background-color 120ms
      var(--ptah-ease-soft, cubic-bezier(0.22, 0.61, 0.36, 1));
  }
  /* Hover paints the whole row, but never replaces the current fill. */
  :host(:not(.session-row-current):hover) {
    background-color: var(--surface-2);
  }
  /* D12: fill and 2 px inset accent on the li, so the chips line is inside
     the highlight. Colour is not the only signal: the title is semibold
     and the row button carries aria-current. */
  :host(.session-row-current) {
    background-color: var(--surface-3);
    box-shadow: inset 2px 0 0 var(--ptah-link);
  }
  /* Open in a tab, not current: accent only (70% is the lowest round alpha
     that keeps 3:1 in both Anubis themes), plus sr-only text. */
  :host(.session-row-open-tab) {
    box-shadow: inset 2px 0 0
      color-mix(in srgb, var(--ptah-link) 70%, transparent);
  }
  /* An inset shadow follows the corner radius, so on rounded left corners
     the accent curves like a bracket. Square left corners keep it a
     straight bar the full height of the li (FU-9); the right corners and
     the fill stay as they are. */
  :host(.session-row-current),
  :host(.session-row-open-tab) {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  /* Inset ring: the scrolling list would clip an outer one. */
  .session-row-open:focus-visible {
    outline-offset: -2px;
  }
  /* Actions stay focusable while transparent; Tab reaches them after the
     row button and focus reveals them. */
  .session-row-actions {
    opacity: 0;
    transition: opacity 120ms
      var(--ptah-ease-soft, cubic-bezier(0.22, 0.61, 0.36, 1));
  }
  :host(:hover) .session-row-actions,
  :host(:focus-within) .session-row-actions {
    opacity: 1;
  }
  /* A touch user has no hover: show them always. */
  @media (hover: none) {
    .session-row-actions {
      opacity: 1;
    }
  }
`;

@Component({
  // A native li keeps the list's role=list semantics without a wrapper node.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[ptah-session-list-row]',
  standalone: true,
  imports: [
    NgClass,
    LucideAngularModule,
    WorkflowBadgeComponent,
    SessionLivePhaseIndicatorComponent,
    SessionOrganizationChipsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.session-row-current]': 'isCurrent()',
    '[class.session-row-open-tab]': 'openInTabOnly()',
    '[class.ml-3]': 'depth() === 1',
    '[class.ml-6]': 'depth() === 2',
    '[class.ml-9]': 'depth() >= 3',
    '[attr.data-depth]': 'depth() > 0 ? depth() : null',
    '[attr.data-session-id]': 'session().id',
  },
  styles: SESSION_LIST_ROW_STYLES,
  template: `
    @if (editing()) {
      <div class="bg-surface-2 rounded-md">
        <div
          class="flex items-center gap-2 min-h-[52px] py-1.5 pr-2.5"
          [ngClass]="organizationAvailable() ? 'pl-[34px]' : 'pl-2.5'"
        >
          <input
            #renameInput
            type="text"
            class="input input-xs input-bordered flex-1 min-w-0 h-7 text-[13px] rounded-md bg-surface-0 border-[color:var(--surface-border-strong)] ${FOCUS_RING}"
            [attr.maxlength]="nameMaxLength"
            aria-label="Edit session name"
            [attr.aria-describedby]="renameDescribedBy()"
            [value]="editingName()"
            (input)="onRenameInput($event)"
            (keydown)="onRenameKeydown($event)"
            (blur)="onRenameBlur()"
            data-testid="session-rename-input"
          />
          <span
            [id]="renameHintId"
            class="sr-only sm:not-sr-only whitespace-nowrap text-[11px] text-base-content-muted"
            >Enter to save · Esc to cancel</span
          >
        </div>
        @if (renameError(); as error) {
          <!-- Not a live region: the modal announces the same text once. -->
          <p
            [id]="renameErrorId"
            class="-mt-1 pb-1.5 pr-2.5 text-xs text-error"
            [ngClass]="organizationAvailable() ? 'pl-[34px]' : 'pl-2.5'"
            data-testid="session-rename-error"
          >
            {{ error }}
          </p>
        }
      </div>
    } @else {
      <button
        type="button"
        class="session-row-open grid w-full min-h-[52px] px-2.5 py-2 text-left rounded-md"
        [ngClass]="
          organizationAvailable()
            ? 'grid-cols-[16px_minmax(0,1fr)] gap-x-2'
            : 'grid-cols-1 gap-x-0'
        "
        [attr.aria-current]="isCurrent() ? 'true' : null"
        (click)="opened.emit()"
        data-action="open"
      >
        @if (organizationAvailable()) {
          <!-- Idle keeps the 16 px column (the host is invisible), so a live
               row and an idle row align. -->
          <ptah-session-live-phase-indicator
            class="mt-px self-start"
            [session]="session()"
          />
        }
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex h-[18px] min-w-0 items-center gap-1.5">
            @if (depth() > 0) {
              <span class="sr-only">Child session:</span>
            }
            <span
              class="truncate text-[13px] leading-[18px]"
              [ngClass]="titleClasses()"
              [title]="session().name"
              data-testid="session-row-title"
            >
              {{ displayName() }}
            </span>
            <ptah-workflow-badge class="shrink-0" [workflow]="workflow()" />
          </span>
          <span
            class="flex items-center gap-1.5 whitespace-nowrap overflow-hidden text-[11px] leading-4 text-base-content-muted"
            [ngClass]="organizationAvailable() ? 'pr-[92px]' : 'pr-[56px]'"
            data-testid="session-row-meta"
          >
            <span>{{ relativeTime() }}</span>
            @if (session().messageCount > 0) {
              <span>{{ session().messageCount }} msgs</span>
            }
            @if (expired()) {
              <span
                class="italic"
                [title]="expiredHint()"
                data-testid="session-row-expired"
                >transcript expired</span
              >
            }
            @if (openInTabOnly()) {
              <span class="sr-only">Open in a tab</span>
            }
          </span>
        </span>
      </button>

      <div class="session-row-actions absolute right-2 top-6 flex gap-0.5">
        @if (organizationAvailable() && session().organization) {
          <button
            type="button"
            class="${ACTION_BUTTON} hover:text-base-content hover:bg-surface-3"
            title="Organize session"
            aria-haspopup="dialog"
            [attr.aria-label]="'Organize session: ' + displayName()"
            (click)="organizeRequested.emit()"
            data-action="organize"
            data-testid="session-organize"
          >
            <lucide-angular
              [img]="TagIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        }
        <button
          type="button"
          class="${ACTION_BUTTON} hover:text-base-content hover:bg-surface-3"
          title="Rename session"
          [attr.aria-label]="'Rename session: ' + displayName()"
          (click)="renameRequested.emit()"
          data-action="rename"
        >
          <lucide-angular
            [img]="PencilIcon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="${ACTION_BUTTON} hover:text-state-err hover:bg-error/10"
          title="Delete session"
          [attr.aria-label]="'Delete session: ' + displayName()"
          (click)="deleteRequested.emit()"
          data-action="delete"
        >
          <lucide-angular
            [img]="Trash2Icon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
        </button>
      </div>

      @if (organizationAvailable()) {
        <!-- The chips sit beside the row button, not inside it: a list is
             not phrasing content, and the chips would otherwise all be read
             as part of the button's name. Left edge 34 px = row padding 10 +
             marker 16 + gap 8, so the chips share the title's edge. With
             chips, -mt-1 takes back the button's bottom padding. -->
        <div class="pl-[34px] pr-2.5 has-[li]:-mt-1 has-[li]:pb-2">
          <ptah-session-organization-chips [session]="session()" />
        </div>
      }
    }
  `,
})
export class SessionListRowComponent {
  private readonly displayUtils = inject(SessionDisplayUtils);

  readonly session = input.required<ChatSessionSummary>();
  /** Nesting depth under a parent (`By parent`); 0 for a top-level row. */
  readonly depth = input(0);
  /** Organization host: live-phase marker, chips and Organize. */
  readonly organizationAvailable = input(false);
  /** The session shown in the active tab. */
  readonly isCurrent = input(false);
  /** The session is open in some tab. */
  readonly isOpenInTab = input(false);
  readonly workflow = input<WorkflowKind | null | undefined>(null);
  /** The row shows the inline rename field. */
  readonly editing = input(false);
  /** The rename draft (owned by the modal). */
  readonly editingName = input('');
  /** Inline error under the rename field after a failed save; '' for none. */
  readonly renameError = input('');
  /** Tooltip on `transcript expired`. */
  readonly expiredHint = input('');

  /** The row button was activated. */
  readonly opened = output<void>();
  readonly organizeRequested = output<void>();
  readonly renameRequested = output<void>();
  /** The rename draft as typed. */
  readonly renameNameChange = output<string>();
  /** Enter or blur: save the draft. */
  readonly renameCommitted = output<SessionRenameCommitTrigger>();
  /** Escape: drop the draft. */
  readonly renameCancelled = output<void>();
  readonly deleteRequested = output<void>();

  protected readonly TagIcon = Tag;
  protected readonly PencilIcon = Pencil;
  protected readonly Trash2Icon = Trash2;

  protected readonly nameMaxLength = SESSION_NAME_MAX_LENGTH;
  private readonly rowId = nextId++;
  protected readonly renameHintId = `session-rename-hint-${this.rowId}`;
  protected readonly renameErrorId = `session-rename-error-${this.rowId}`;
  /** The hint, plus the inline error while there is one. */
  protected readonly renameDescribedBy = computed(() =>
    this.renameError()
      ? `${this.renameHintId} ${this.renameErrorId}`
      : this.renameHintId,
  );

  private readonly renameInput =
    viewChild<ElementRef<HTMLInputElement>>('renameInput');

  protected readonly displayName = computed(() =>
    this.displayUtils.getSessionDisplayName(this.session()),
  );
  protected readonly relativeTime = computed(() =>
    this.displayUtils.formatRelativeDate(this.session().lastActivityAt),
  );
  /** The metadata row survives Claude's transcript retention; the history does not. */
  protected readonly expired = computed(
    () => this.session().hasTranscript === false,
  );
  /** The open-in-a-tab marker only applies when the row is not current. */
  protected readonly openInTabOnly = computed(
    () => this.isOpenInTab() && !this.isCurrent(),
  );
  protected readonly titleClasses = computed(() => {
    const weight = this.isCurrent() ? 'font-semibold' : 'font-medium';
    return this.expired() ? `${weight} text-base-content-muted` : weight;
  });

  constructor() {
    // A new rename field (each time editing starts) gets focus with its
    // text selected, after it is in the DOM.
    afterRenderEffect(() => {
      const field = this.renameInput()?.nativeElement;
      if (!field) return;
      field.focus();
      field.select();
    });
  }

  protected onRenameInput(event: Event): void {
    this.renameNameChange.emit((event.target as HTMLInputElement).value);
  }

  protected onRenameKeydown(event: KeyboardEvent): void {
    // An IME composition uses Enter and Escape for itself.
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.editing()) this.renameCommitted.emit('enter');
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // Only the rename ends: not the modal, not a document listener (R4).
      event.stopPropagation();
      if (this.editing()) this.renameCancelled.emit();
    }
  }

  protected onRenameBlur(): void {
    // The field also blurs while it is removed after Enter or Escape; the
    // row has left edit mode by then, so that blur reports nothing.
    if (this.editing()) this.renameCommitted.emit('blur');
  }
}
