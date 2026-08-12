/**
 * OutputStyleEditorComponent — the create / edit sub-view.
 *
 * Signal-backed template-driven forms (`[value]="sig()"` + `(input)` →
 * `sig.set(...)`). There are no reactive forms anywhere under `libs/frontend`
 * and this component does not introduce the first ones.
 *
 * Three fields that deliberately DO NOT exist here:
 *
 *  - **The plugin-only force flag (E7)** — a valid schema key that is
 *    meaningless outside a plugin. The CLI warns about it and ignores it, so
 *    exposing it would only invite users to set a key that does nothing.
 *  - **A per-turn reminder (G7)** — not a member of the SDK's strict four-key
 *    schema. A fifth key voids the entire file, so a user-authored style can
 *    never carry one; it receives the SDK's generic reminder sentence. Nothing
 *    in this template promises style-specific per-turn reinforcement.
 *  - **A raw-HTML binding for the preview** — a style body is user-authored
 *    markdown that may contain arbitrary HTML. It renders through
 *    `ptah-markdown-block`, the single DOMPurify chokepoint.
 *
 * The keep-coding-instructions copy is the one piece of text in this batch that
 * was rewritten from a verified finding (§4.6 / G8): inside Ptah, turning it
 * OFF drops the SDK's coding-instructions section, but `PTAH_CORE_SYSTEM_PROMPT`
 * is still appended unconditionally, so Ptah's own behaviour prompt still
 * governs. The warning states that smaller, true effect — not the CLI one.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, AlertTriangle, ArrowLeft } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type {
  InvalidOutputStyle,
  OutputStyleDetail,
  OutputStyleOperationError,
  OutputStyleSaveParams,
  WritableOutputStyleTier,
} from '@ptah-extension/shared';
import { OutputStyleStore } from './output-style.store';

interface TierChoice {
  readonly value: WritableOutputStyleTier;
  readonly label: string;
  readonly explanation: string;
}

const TIER_CHOICES: readonly TierChoice[] = [
  {
    value: 'user',
    label: 'Just me',
    explanation:
      'Saved in your home folder and available in every project on this machine.',
  },
  {
    value: 'project',
    label: 'This project',
    explanation:
      'Saved inside this project and committable, so everyone who works on it gets the same style.',
  },
] as const;

@Component({
  selector: 'ptah-output-style-editor',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1.5 mb-2">
      <button
        type="button"
        class="btn btn-ghost btn-xs px-1"
        aria-label="Back to the style list"
        (click)="cancelled.emit()"
      >
        <lucide-angular
          [img]="ArrowLeftIcon"
          class="w-3.5 h-3.5"
          aria-hidden="true"
        />
      </button>
      <h3 class="text-xs font-medium uppercase tracking-wide">
        {{ heading() }}
      </h3>
    </div>

    @if (repair(); as broken) {
      <div
        class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 mb-2"
        role="status"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <p class="text-xs leading-relaxed">
          {{ broken.error.message }} Because the file did not parse, its text
          cannot be shown here — the form below starts empty. Saving replaces
          <code class="text-base-content-muted">{{ broken.relativePath }}</code>
          with what you enter. To keep the original wording, copy it out of that
          file first.
        </p>
      </div>
    }

    @if (formError(); as message) {
      <div
        class="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 mb-2"
        role="alert"
      >
        <span class="text-xs text-error flex-1">{{ message }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          (click)="formError.set(null)"
        >
          Dismiss
        </button>
      </div>
    }

    @if (conflict(); as pending) {
      <div
        class="rounded border border-warning/40 bg-warning/10 p-2 mb-2"
        role="alertdialog"
        aria-label="Confirm replacing an existing file"
      >
        <p class="text-xs">{{ pending.message }}</p>
        <div class="flex gap-1 mt-1">
          <button
            type="button"
            class="btn btn-warning btn-xs"
            [disabled]="saving()"
            (click)="confirmOverwrite()"
          >
            Replace it
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            (click)="conflict.set(null)"
          >
            Keep both — I'll rename
          </button>
        </div>
      </div>
    }

    <form class="space-y-3" (submit)="submit($event)">
      <!-- Name -->
      <div>
        <label
          class="block text-[11px] font-medium mb-1"
          for="output-style-name"
        >
          Name
        </label>
        <input
          id="output-style-name"
          type="text"
          autocomplete="off"
          class="input input-bordered input-sm w-full text-xs"
          [class.input-error]="showNameError()"
          placeholder="Simplified Technical English"
          [value]="name()"
          (input)="onNameInput($event)"
          (blur)="nameTouched.set(true)"
          [attr.aria-invalid]="showNameError()"
          [attr.aria-describedby]="
            showNameError()
              ? 'output-style-name-error'
              : 'output-style-name-hint'
          "
        />
        @if (showNameError()) {
          <p id="output-style-name-error" class="text-xs text-error mt-1">
            Give the style a name. This is the value the agent is selected by,
            so it cannot be blank.
          </p>
        } @else {
          <p
            id="output-style-name-hint"
            class="text-[10px] text-base-content-muted mt-1"
          >
            The name is what a session binds to. The filename is derived from it
            and is only storage.
          </p>
        }
      </div>

      <!-- Description -->
      <div>
        <label
          class="block text-[11px] font-medium mb-1"
          for="output-style-description"
        >
          Description
        </label>
        <input
          id="output-style-description"
          type="text"
          autocomplete="off"
          class="input input-bordered input-sm w-full text-xs"
          [class.input-error]="showDescriptionError()"
          placeholder="Short sentences, plain words, no marketing language."
          [value]="description()"
          (input)="onDescriptionInput($event)"
          (blur)="descriptionTouched.set(true)"
          [attr.aria-invalid]="showDescriptionError()"
        />
        @if (showDescriptionError()) {
          <p class="text-xs text-error mt-1">
            Add one line describing what this style does, so it is recognisable
            in the list.
          </p>
        }
      </div>

      <!-- Tier -->
      <fieldset [disabled]="tierLocked()">
        <legend class="text-[11px] font-medium mb-1">Where to save it</legend>
        <div class="space-y-1">
          @for (choice of tierChoices; track choice.value) {
            <label
              class="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-base-200/50 transition-colors cursor-pointer"
            >
              <input
                type="radio"
                name="output-style-tier"
                class="radio radio-xs mt-0.5"
                [value]="choice.value"
                [checked]="tier() === choice.value"
                (change)="tier.set(choice.value)"
              />
              <span class="flex-1">
                <span class="block text-xs font-medium">{{
                  choice.label
                }}</span>
                <span
                  class="block text-[10px] text-base-content-muted leading-relaxed"
                >
                  {{ choice.explanation }}
                </span>
              </span>
            </label>
          }
        </div>
        @if (tierLocked()) {
          <p class="text-[10px] text-base-content-muted mt-1">
            An existing style stays where it already lives. Delete it and create
            it again to move it.
          </p>
        }
      </fieldset>

      <!-- Keep coding instructions -->
      <div>
        <div
          class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
        >
          <span class="text-xs font-medium flex-1">
            Keep the default coding instructions
          </span>
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-primary"
            [checked]="keepCodingInstructions()"
            (change)="onKeepInstructionsChange($event)"
            aria-label="Keep the default coding instructions"
          />
        </div>
        @if (keepCodingInstructions()) {
          <p
            data-test="keep-instructions-on-hint"
            class="text-[10px] text-base-content-muted mt-1 px-2 leading-relaxed"
          >
            The style is added to the agent's normal coding behaviour. It
            influences how the agent writes and explains; the engineering
            guidance it already has stays in place.
          </p>
        } @else {
          <p
            data-test="keep-instructions-off-warning"
            class="text-[10px] text-warning mt-1 px-2 leading-relaxed"
          >
            Turning this off removes the SDK's built-in coding instructions.
            Ptah's own engineering behaviour is still appended to every session,
            so the effect here is smaller than in the
            <code>claude</code> CLI — but the agent loses guidance it normally
            has. Recommended only for styles that redefine the agent's whole
            role, not for adjusting tone.
          </p>
        }
      </div>

      <!-- Body -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-[11px] font-medium" for="output-style-body">
            Instructions
          </label>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            [attr.aria-pressed]="showPreview()"
            (click)="showPreview.set(!showPreview())"
          >
            {{ showPreview() ? 'Edit' : 'Preview' }}
          </button>
        </div>

        @if (showPreview()) {
          <div
            class="max-h-64 overflow-y-auto border border-base-300 rounded p-3 bg-base-200/50"
            data-test="body-preview"
          >
            @if (body().trim().length > 0) {
              <ptah-markdown-block [content]="body()" />
            } @else {
              <p class="text-[11px] text-base-content-muted">
                Nothing to preview yet.
              </p>
            }
          </div>
        } @else {
          <textarea
            id="output-style-body"
            rows="10"
            class="textarea textarea-bordered w-full text-xs font-mono leading-relaxed"
            placeholder="Write in short sentences. Prefer plain words over jargon."
            [value]="body()"
            (input)="onBodyInput($event)"
          ></textarea>
        }
        <p class="text-[10px] text-base-content-muted mt-1 leading-relaxed">
          Markdown. This text influences how the agent writes — it does not
          override Ptah's own instructions, which are always applied as well.
        </p>
      </div>

      @if (showRebindNote()) {
        <p class="text-[10px] text-base-content-muted leading-relaxed">
          This style is currently selected. Renaming it updates the selection in
          the same save, so the binding does not break.
        </p>
      }

      <div class="flex gap-1">
        <button
          type="submit"
          class="btn btn-primary btn-sm flex-1"
          [disabled]="saving()"
        >
          @if (saving()) {
            <span class="loading loading-spinner loading-xs"></span>
            Saving…
          } @else {
            Save style
          }
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="cancelled.emit()"
        >
          Cancel
        </button>
      </div>

      <p class="text-[10px] text-base-content-muted">
        Saving does not switch to this style. Select it in the list when you
        want to use it.
      </p>
    </form>
  `,
})
export class OutputStyleEditorComponent {
  private readonly store = inject(OutputStyleStore);

  /** `null` means create. Otherwise the style being edited, body and E8 stamp included. */
  readonly draft = input<OutputStyleDetail | null>(null);

  /**
   * Set when the user opened an unparseable file to rewrite it (Req 7.5). The
   * backend cannot hand us the body of a file it could not parse, so the form
   * starts empty and the banner says so.
   */
  readonly repair = input<InvalidOutputStyle | null>(null);

  /** The active selection's name, so an edit can warn about the Req 4.4 rebind. */
  readonly activeName = input<string | null>(null);

  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly AlertTriangleIcon = AlertTriangle;
  readonly ArrowLeftIcon = ArrowLeft;
  readonly tierChoices = TIER_CHOICES;

  readonly saving = this.store.saving;

  /**
   * Seeded from the draft, or from the broken file's basename in repair mode so
   * the derived filename lands back on the same file and replaces it.
   */
  readonly name = linkedSignal<string>(
    () => this.draft()?.name ?? this.repairSeedName(),
  );

  /**
   * For a style with no frontmatter `description`, discovery supplies a derived
   * one-line summary. Editing then writes that summary back as an explicit
   * description — the value shown is the value saved, which is the honest
   * behaviour for a form.
   */
  readonly description = linkedSignal<string>(
    () => this.draft()?.description ?? '',
  );

  readonly tier = linkedSignal<WritableOutputStyleTier>(() =>
    this.initialTier(),
  );

  /** Req 6.4 — ON by default, because the destructive value is the one omission gives. */
  readonly keepCodingInstructions = linkedSignal<boolean>(
    () => this.draft()?.keepCodingInstructions ?? true,
  );

  readonly body = linkedSignal<string>(() => this.draft()?.body ?? '');

  readonly showPreview = signal(false);
  readonly nameTouched = signal(false);
  readonly descriptionTouched = signal(false);
  readonly submitAttempted = signal(false);
  readonly formError = signal<string | null>(null);
  /** A `FILE_EXISTS` or `STALE_FILE` result awaiting an explicit overwrite. */
  readonly conflict = signal<OutputStyleOperationError | null>(null);

  readonly isEditing = computed(() => this.draft() !== null);

  readonly heading = computed(() => {
    if (this.repair() !== null) return 'Rewrite style file';
    return this.isEditing() ? 'Edit style' : 'New style';
  });

  /** An existing file is not moved between tiers by a save. */
  readonly tierLocked = computed(
    () => this.isEditing() || this.repair() !== null,
  );

  readonly nameInvalid = computed(() => this.name().trim().length === 0);
  readonly descriptionInvalid = computed(
    () => this.description().trim().length === 0,
  );

  readonly showNameError = computed(
    () => this.nameInvalid() && (this.nameTouched() || this.submitAttempted()),
  );
  readonly showDescriptionError = computed(
    () =>
      this.descriptionInvalid() &&
      (this.descriptionTouched() || this.submitAttempted()),
  );

  readonly showRebindNote = computed(() => {
    const original = this.draft()?.name;
    return (
      original !== undefined &&
      original === this.activeName() &&
      original !== this.name().trim()
    );
  });

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  onDescriptionInput(event: Event): void {
    this.description.set((event.target as HTMLInputElement).value);
  }

  onBodyInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  onKeepInstructionsChange(event: Event): void {
    this.keepCodingInstructions.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Req 3.5 — a blank or whitespace-only name blocks the submit with an inline
   * error and never reaches the RPC surface.
   */
  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    this.submitAttempted.set(true);
    this.formError.set(null);

    if (this.nameInvalid() || this.descriptionInvalid()) return;

    await this.persist(this.repair() !== null);
  }

  /** The user answered the `FILE_EXISTS` / `STALE_FILE` prompt with "replace". */
  async confirmOverwrite(): Promise<void> {
    this.conflict.set(null);
    await this.persist(true);
  }

  private async persist(overwrite: boolean): Promise<void> {
    const error = await this.store.save(this.buildParams(overwrite));

    if (error === null) {
      this.conflict.set(null);
      this.saved.emit();
      return;
    }

    if (error.code === 'FILE_EXISTS' || error.code === 'STALE_FILE') {
      this.conflict.set(error);
      return;
    }

    this.formError.set(error.message);
  }

  private buildParams(overwrite: boolean): OutputStyleSaveParams {
    const draft = this.draft();

    return {
      tier: this.tier(),
      name: this.name().trim(),
      description: this.description().trim(),
      keepCodingInstructions: this.keepCodingInstructions(),
      body: this.body(),
      ...(draft !== null ? { originalName: draft.name } : {}),
      ...(draft?.mtime !== undefined ? { expectedMtime: draft.mtime } : {}),
      ...(draft?.byteLength !== undefined
        ? { expectedByteLength: draft.byteLength }
        : {}),
      ...(overwrite ? { overwrite: true } : {}),
    };
  }

  private repairSeedName(): string {
    const fileName = this.repair()?.fileName;
    if (fileName === undefined) return '';
    return fileName.endsWith('.md')
      ? fileName.slice(0, -'.md'.length)
      : fileName;
  }

  private initialTier(): WritableOutputStyleTier {
    const draftTier = this.draft()?.tier;
    if (draftTier === 'user' || draftTier === 'project') return draftTier;

    const repairTier = this.repair()?.tier;
    if (repairTier === 'user' || repairTier === 'project') return repairTier;

    return 'user';
  }
}
