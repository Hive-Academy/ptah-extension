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
 */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

let nextEditorId = 0;

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
        (ngModelChange)="draft.set($event)"
      ></textarea>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-xs"
          data-testid="clone-body-editor-save"
          [disabled]="saving()"
          (click)="save.emit(draft())"
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

  protected readonly textareaId = `clone-body-editor-${nextEditorId++}`;

  /**
   * The draft. Re-seeds if the source body changes underneath (a reload after a
   * successful save), and is otherwise owned by the textarea.
   */
  protected readonly draft = linkedSignal(() => this.value());

  private readonly textarea =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('editorTextarea');

  /** The editor is created on entering edit mode, so focus belongs here. */
  public ngAfterViewInit(): void {
    this.textarea().nativeElement.focus();
  }
}
