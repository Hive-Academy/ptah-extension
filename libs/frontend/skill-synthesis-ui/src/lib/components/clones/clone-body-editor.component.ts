/**
 * CloneBodyEditorComponent — the in-place body editor for one Library entry.
 *
 * Strictly presentational, like the drawer that hosts it: the draft text is
 * local, and the only way out is `save` (the edited text) or `cancelled` (nothing
 * at all). The RPC call stays in the smart view.
 *
 * NEVER `[innerHTML]`. The editor half is a plain `<textarea>` bound as text;
 * the read-only half stays `ptah-markdown-block`. A clone body is
 * model-generated content and the repository has exactly one sanitising
 * chokepoint for it — this is not a second one.
 *
 * While `saving()` is true both buttons are disabled, so a double submit cannot
 * race the backend's per-slug lock.
 *
 * DRAFT OWNERSHIP. The draft is seeded from `value()` ONCE, when the editor
 * appears, and from then on it belongs to the user. An incoming `value()` change
 * is adopted only while the draft is still untouched (the post-save reload); if
 * the user has typed, their text stays and the fact that the stored body moved
 * underneath is STATED rather than silently applied. Before this, any background
 * reload — applying an enhancement proposal to the open entry, for one — threw
 * the typed text away with no prompt.
 *
 * EMPTY DRAFT. `SkillSaveCloneBodyParamsSchema` enforces `.min(1)` and must: an
 * emptied clone would be reconciled outward as an empty skill into every harness
 * directory. That refusal is correct but its wording is for developers, so the
 * floor is mirrored here — Save is disabled on a blank draft with the reason
 * rendered, not merely greyed out.
 */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { cloneBodyDraftRefusal } from './clone-action-gating';

let nextEditorId = 0;

/**
 * The editor's whole state: what the user has, what it was seeded from, and the
 * latest stored body seen. Held as ONE value so the seed can never drift out of
 * step with the text it explains.
 */
interface DraftState {
  /** What the textarea holds. Owned by the user after the first seed. */
  readonly text: string;
  /** The body `text` was seeded from. `text === seed` means "untouched". */
  readonly seed: string;
  /** The most recent `value()` seen, adopted or not. */
  readonly incoming: string;
}

/** What it means that the stored body moved while the user was typing. */
export const BODY_CHANGED_UNDERNEATH =
  'The stored body changed while you were editing it. Your text is kept and ' +
  'nothing has been overwritten: Save replaces the new stored body with yours, ' +
  'and Cancel discards your edit and shows the new one.';

@Component({
  selector: 'ptah-clone-body-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="space-y-2" data-testid="clone-body-editor">
      <label
        class="block text-[11px] text-base-content-muted"
        [attr.for]="textareaId"
      >
        Editing the body of {{ label() }}
      </label>
      <textarea
        #editorTextarea
        class="textarea textarea-bordered h-72 w-full font-mono text-xs leading-relaxed"
        data-testid="clone-body-editor-textarea"
        [attr.id]="textareaId"
        [disabled]="saving()"
        [ngModel]="draft()"
        [ngModelOptions]="{ standalone: true }"
        (ngModelChange)="onDraftChange($event)"
      ></textarea>

      <!--
        Announced on appearance: it reports something that happened without the
        user's involvement, while their edit is still unsaved.
      -->
      @if (bodyChangedUnderneath()) {
        <p
          [attr.id]="conflictId"
          class="rounded-lg bg-warning/10 px-3 py-2 text-[11px] text-warning"
          role="alert"
          data-testid="clone-body-editor-conflict"
        >
          {{ bodyChangedCopy }}
        </p>
      }

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-xs"
          data-testid="clone-body-editor-save"
          [attr.aria-describedby]="saveDescribedBy()"
          [disabled]="!canSave()"
          (click)="onSave()"
        >
          {{ saving() ? 'Saving…' : 'Save' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="clone-body-editor-cancel"
          [disabled]="saving()"
          (click)="cancelled.emit()"
        >
          Cancel
        </button>
      </div>

      <!--
        role=status so the reason reaches a screen reader on its own: a DISABLED
        button takes no focus, so an aria-describedby alone would never be read
        out, and the greyed state says nothing about why.
      -->
      @if (emptyReason(); as reason) {
        <p
          [attr.id]="emptyReasonId"
          class="text-[11px] text-base-content-muted"
          role="status"
          data-testid="clone-body-editor-empty-reason"
        >
          {{ reason }}
        </p>
      }
    </div>
  `,
})
export class CloneBodyEditorComponent implements AfterViewInit {
  /** The body to seed the draft from. */
  public readonly value = input.required<string>();
  /** Names the entry being edited, for the textarea's visible label. */
  public readonly label = input<string>('this entry');
  /** A save for this entry is in flight. */
  public readonly saving = input<boolean>(false);

  /** The edited text. Emitted only when the user presses Save. */
  public readonly save = output<string>();
  /**
   * Discard. Carries no payload, so no write can follow from it.
   *
   * ⚠️ NAMED `cancelled`, NOT `cancel`. `@angular-eslint/no-output-native`
   * rejects an output that shadows a standard DOM event, and `cancel` is one.
   * The repository's settled spelling for this intent is `cancelled`.
   */
  public readonly cancelled = output<void>();

  private readonly instanceId = `clone-body-editor-${nextEditorId++}`;
  protected readonly textareaId = this.instanceId;
  protected readonly emptyReasonId = `${this.instanceId}-empty-reason`;
  protected readonly conflictId = `${this.instanceId}-conflict`;

  protected readonly bodyChangedCopy = BODY_CHANGED_UNDERNEATH;

  /**
   * Seeded once, then owned by the user.
   *
   * The computation adopts an incoming body ONLY while the draft is untouched
   * (`text === seed`), which is exactly the post-save reload this component was
   * built around. Once the user has typed, their text is kept and the incoming
   * body is merely recorded, so {@link bodyChangedUnderneath} can say so.
   */
  private readonly state = linkedSignal<string, DraftState>({
    source: this.value,
    computation: (incoming, previous) => {
      const prev = previous?.value;
      if (prev === undefined || prev.text === prev.seed) {
        return { text: incoming, seed: incoming, incoming };
      }
      return { ...prev, incoming };
    },
  });

  /** What the textarea shows. */
  protected readonly draft = computed<string>(() => this.state().text);

  /**
   * The stored body has MOVED off the seed, and to something other than what
   * the user holds. Both halves matter:
   *
   * - `incoming !== seed` — the stored body actually changed. A user who simply
   *   emptied the textarea has diverged from the seed too, and that is not a
   *   conflict with anything.
   * - `incoming !== text` — there is something to lose. The reload that follows
   *   the user's OWN save arrives equal to their text.
   *
   * A clean draft can never satisfy the first half: it adopts each incoming
   * body as its new seed.
   */
  protected readonly bodyChangedUnderneath = computed<boolean>(() => {
    const s = this.state();
    return s.incoming !== s.seed && s.incoming !== s.text;
  });

  /**
   * The refusal for the current draft, or null. Decided by
   * {@link cloneBodyDraftRefusal} — the rule is not re-spelled here, only
   * rendered.
   */
  protected readonly emptyReason = computed<string | null>(() =>
    cloneBodyDraftRefusal(this.draft()),
  );

  protected readonly canSave = computed<boolean>(
    () => !this.saving() && this.emptyReason() === null,
  );

  /** Every reason the Save control currently carries, for assistive tech. */
  protected readonly saveDescribedBy = computed<string | null>(() => {
    const ids: string[] = [];
    if (this.emptyReason() !== null) ids.push(this.emptyReasonId);
    if (this.bodyChangedUnderneath()) ids.push(this.conflictId);
    return ids.length === 0 ? null : ids.join(' ');
  });

  private readonly textarea =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('editorTextarea');

  protected onDraftChange(text: string): void {
    this.state.update((s) => ({ ...s, text }));
  }

  /**
   * Emit only what the gating above allows. The disabled attribute is the
   * affordance; this is the guarantee — a programmatic click, or an Enter on a
   * control mid-update, must not push an empty body at the RPC.
   */
  protected onSave(): void {
    if (!this.canSave()) return;
    this.save.emit(this.draft());
  }

  /** The editor is created on entering edit mode, so focus belongs here. */
  public ngAfterViewInit(): void {
    this.textarea().nativeElement.focus();
  }
}
