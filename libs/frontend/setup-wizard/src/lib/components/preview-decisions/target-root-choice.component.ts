import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import type {
  GenerationTargetChoice,
  GenerationTargetInfo,
} from '@ptah-extension/shared';
import { agentsFolder, targetFolder } from './preview-decisions.state';

let nextTargetHeadingId = 0;

/**
 * C5 TargetRootChoice: "Where should the agents be written?" as a radiogroup
 * of two button cards (buttons, so dialog focus traps include them).
 *
 * Project root is the default. Choosing the opened folder shows the solid
 * warning. When the opened folder is the project root there is no choice and
 * only the "Writing to" line is shown. The surface reloads the comparison on
 * `targetChange` and passes `reloading` meanwhile.
 */
@Component({
  selector: 'ptah-target-root-choice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let info = target();
    @if (!info.openedIsHarnessRoot) {
      <h4 class="mb-1.5 mt-3 text-xs font-semibold" [id]="headingId">
        Where should the agents be written?
      </h4>
      <div
        role="radiogroup"
        data-testid="target-radiogroup"
        [attr.aria-labelledby]="headingId"
        [attr.aria-busy]="reloading() ? 'true' : null"
        (keydown)="onKeydown($event)"
      >
        <button
          #rootCard
          type="button"
          role="radio"
          data-testid="target-root"
          class="mb-1.5 flex w-full cursor-pointer items-start gap-2.5 rounded-lg border bg-transparent px-2.5 py-2 text-left text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50"
          [class.border-base-content]="selected() === 'harness-root'"
          [class.border-base-content/20]="selected() !== 'harness-root'"
          [class.bg-surface-1]="selected() === 'harness-root'"
          [attr.aria-checked]="selected() === 'harness-root'"
          [tabindex]="selected() === 'harness-root' ? 0 : -1"
          [disabled]="reloading()"
          (click)="choose('harness-root')"
        >
          <span
            aria-hidden="true"
            class="mt-0.5 h-3.5 w-3.5 flex-none rounded-full border-2"
            [class.border-base-content]="selected() === 'harness-root'"
            [class.bg-base-content]="selected() === 'harness-root'"
            [class.border-base-content-muted]="selected() !== 'harness-root'"
          ></span>
          <span class="min-w-0">
            <strong>Project root (recommended)</strong>
            <span class="badge badge-ghost badge-sm ml-1">Default</span>
            <code class="block font-mono [overflow-wrap:anywhere]">{{
              rootFolder()
            }}</code>
            <span class="block text-base-content-muted">{{
              rootHelper()
            }}</span>
          </span>
        </button>
        <button
          #openedCard
          type="button"
          role="radio"
          data-testid="target-opened"
          class="mb-1.5 flex w-full cursor-pointer items-start gap-2.5 rounded-lg border bg-transparent px-2.5 py-2 text-left text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50"
          [class.border-base-content]="selected() === 'opened-folder'"
          [class.border-base-content/20]="selected() !== 'opened-folder'"
          [class.bg-surface-1]="selected() === 'opened-folder'"
          [attr.aria-checked]="selected() === 'opened-folder'"
          [tabindex]="selected() === 'opened-folder' ? 0 : -1"
          [disabled]="reloading()"
          (click)="choose('opened-folder')"
        >
          <span
            aria-hidden="true"
            class="mt-0.5 h-3.5 w-3.5 flex-none rounded-full border-2"
            [class.border-base-content]="selected() === 'opened-folder'"
            [class.bg-base-content]="selected() === 'opened-folder'"
            [class.border-base-content-muted]="selected() !== 'opened-folder'"
          ></span>
          <span class="min-w-0">
            <strong>Opened folder only</strong>
            <code class="block font-mono [overflow-wrap:anywhere]">{{
              openedFolder()
            }}</code>
          </span>
        </button>
      </div>
      @if (selected() === 'opened-folder') {
        <p
          role="alert"
          class="mb-2 rounded bg-warning px-2 py-1 text-xs text-warning-content"
          data-testid="opened-folder-warning"
        >
          {{ openedWarning() }}
        </p>
      }
    }
    <p
      class="mb-2 mt-1 flex flex-wrap items-center gap-1.5 text-xs"
      data-testid="writing-to"
    >
      <span class="text-base-content-muted">Writing to</span>
      <code class="font-mono [overflow-wrap:anywhere]">{{
        writingTo()
      }}</code>
    </p>
  `,
})
export class TargetRootChoiceComponent {
  /** Both candidate roots, from the preview or pack plan. */
  public readonly target = input.required<GenerationTargetInfo>();
  /** The choice the surface currently compares against. */
  public readonly selected = input<GenerationTargetChoice>('harness-root');
  public readonly isElectron = input(true);
  /** True while the comparison reloads after a change. */
  public readonly reloading = input(false);

  public readonly targetChange = output<GenerationTargetChoice>();

  protected readonly headingId = `ptah-target-heading-${++nextTargetHeadingId}`;

  protected readonly rootFolder = computed(() =>
    agentsFolder(this.target().harnessRoot),
  );
  protected readonly openedFolder = computed(() =>
    agentsFolder(this.target().openedFolder),
  );
  protected readonly writingTo = computed(() => {
    const info = this.target();
    return targetFolder(
      info,
      info.openedIsHarnessRoot ? 'harness-root' : this.selected(),
    );
  });
  protected readonly rootHelper = computed(() =>
    this.isElectron()
      ? 'The Library, other CLIs and model settings read this folder.'
      : 'Other CLIs and model settings read this folder.',
  );
  protected readonly openedWarning = computed(() =>
    this.isElectron()
      ? 'Agents written to the opened folder will not reach other CLIs and will not appear in the Library.'
      : 'Agents written to the opened folder will not reach other CLIs.',
  );

  private readonly rootCard =
    viewChild<ElementRef<HTMLButtonElement>>('rootCard');
  private readonly openedCard =
    viewChild<ElementRef<HTMLButtonElement>>('openedCard');

  protected choose(choice: GenerationTargetChoice): void {
    if (this.reloading() || choice === this.selected()) return;
    this.targetChange.emit(choice);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowDown'
    )
      return;
    event.preventDefault();
    if (this.reloading()) return;
    const next: GenerationTargetChoice =
      this.selected() === 'harness-root' ? 'opened-folder' : 'harness-root';
    this.choose(next);
    const card = next === 'harness-root' ? this.rootCard() : this.openedCard();
    card?.nativeElement.focus();
  }
}
