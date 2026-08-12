import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChevronRight, LucideAngularModule, Search } from 'lucide-angular';
import { KeyboardNavigationService } from '@ptah-extension/ui';
import {
  TASK_PALETTE_GROUP_LABELS,
  type TaskPaletteAction,
  type TaskPaletteEntry,
} from './palette-entries';
import { rankPaletteMatches } from './palette-match';

/**
 * How many ranked entries are rendered at once.
 *
 * The catalogue holds one entry per indexed task, so on this workspace it is
 * comfortably past a hundred rows before a single character is typed. Rendering
 * all of them costs a DOM node each for results nobody will scroll to; the cap
 * is announced in the footer ("N more — keep typing") so a user whose entry is
 * past the cut is told that it exists and how to reach it, rather than
 * concluding the palette does not know about it.
 */
const MAX_VISIBLE_RESULTS = 50;

/** Per-instance suffix so two palettes could never collide on option ids. */
let paletteInstanceCounter = 0;

/**
 * TaskCommandPaletteComponent — the board's keyboard command surface (FR-C6).
 *
 * ## Local to `tasks-ui`, on purpose (FR-C6.8, R11)
 *
 * `libs/frontend/editor/src/lib/quick-open/quick-open.component.ts` is prior
 * art that was READ and not imported. The only thing shared with it is
 * `KeyboardNavigationService` from `@ptah-extension/ui`, which is
 * `scope:webview` + `type:ui` — an edge the boundary lint genuinely permits
 * from `type:feature`. The edge the lint would ALSO permit, and must not
 * exist, is `tasks-ui → editor`; that one is held by the source ratchet in
 * `no-editor-dependency.spec.ts`.
 *
 * ## Accessibility (FR-C6.4, FR-C6.5)
 *
 * `role="dialog"` with an accessible name; the results are a `role="listbox"`
 * whose `aria-activedescendant` tracks `KeyboardNavigationService.activeIndex`,
 * and the active option is scrolled into view on every move. Focus moves into
 * the input on open and returns to whatever held it before the palette opened
 * when this component is destroyed.
 *
 * `aria-modal="true"` is claimed and honoured: this dialog contains exactly ONE
 * focusable element — the query input — so swallowing `Tab` is a complete
 * focus trap rather than a partial one. Options are not focusable by design;
 * they are addressed through `aria-activedescendant`, which is what lets the
 * user type and navigate at the same time.
 *
 * ## Disabled entries are LISTED (FR-C6.6)
 *
 * A selection-scoped action with no selection is rendered in full, states its
 * reason on its own line, and is refused when run. It is NOT dimmed: the reason
 * sentence is the point of listing it, and an opacity modifier was what made
 * that sentence illegible on three of the four mandated themes. Hiding the
 * entry instead would teach a user that the palette is missing a command rather
 * than that their selection is empty.
 */
@Component({
  selector: 'ptah-task-command-palette',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [KeyboardNavigationService],
  template: `
    <div class="fixed inset-0 z-50 flex items-start justify-center">
      <!-- Backdrop. A real button element, so the click affordance is carried
           by something that natively has one — and tabindex="-1", so it stays
           out of the tab order and the dialog keeps its single focusable
           element. A SIBLING of the dialog rather than its parent, so
           dismissing does not depend on a stopPropagation inside it. -->
      <button
        type="button"
        tabindex="-1"
        class="absolute inset-0 bg-black/40 cursor-default"
        aria-label="Close the command palette"
        data-testid="task-palette-backdrop"
        (click)="requestClose()"
      ></button>
      <div
        class="relative mt-[8vh] w-full max-w-xl mx-3 rounded-lg border border-base-content/10 bg-base-200 shadow-xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Task board command palette"
        data-testid="task-palette-dialog"
      >
        <div
          class="flex items-center gap-2 px-3 py-2 border-b border-base-content/10"
        >
          <lucide-angular
            [img]="SearchIcon"
            class="w-4 h-4 shrink-0 text-base-content"
            aria-hidden="true"
          />
          <input
            #queryInput
            type="text"
            class="bg-transparent w-full text-sm outline-none"
            placeholder="Type a command or a task id"
            role="combobox"
            aria-label="Filter board commands"
            aria-autocomplete="list"
            aria-expanded="true"
            [attr.aria-controls]="listboxId"
            [attr.aria-activedescendant]="activeOptionId()"
            [ngModel]="query()"
            (ngModelChange)="onQueryChange($event)"
            (keydown)="onKeyDown($event)"
          />
        </div>

        <!-- Options are real button elements carrying role="option", with
             tabindex="-1". Two things fall out of that. The click affordance
             sits on an element that natively has one, so it needs no synthetic
             key handler to be operable — the keyboard path for this listbox is
             the input's arrow keys plus aria-activedescendant, which is the
             pattern's whole point. And nothing here joins the tab order, so the
             dialog's single-focusable-element trap still holds. -->
        <div
          class="max-h-[50vh] overflow-y-auto py-1"
          role="listbox"
          [id]="listboxId"
          aria-label="Board commands"
          data-testid="task-palette-listbox"
        >
          <!-- WHAT MARKS THE ACTIVE ROW, and why it is not a colour.
               The first row is highlighted the moment this dialog opens, before
               the user has done anything, so its treatment is the most exposed
               contrast decision on the surface. bg-primary + text-primary-content
               computed to 4.144:1 on anubis — the app default — against a 4.5:1
               gate, and it was the same primary/primary-content pair Batch 7
               recorded. Changing the pair is TASK_2026_183's; changing the
               USAGE is this batch's.

               Nor can an accent carry it. Measured across the four mandated
               bases, the gold secondary against base-300 is 7.29 / 3.40 / 2.71 /
               6.28 — under the 3:1 non-text gate on daisyUI light — and the
               base-200 → base-300 step is 1.05–1.13 on every theme. That is
               Batch 9's finding reproduced: no accent clears the boundary gate
               on the light themes and no base-ramp step delimits a block.

               So the active state is carried by TEXT and SHAPE, all of it plain
               base-content: a leading chevron, a semibold label, and a literal
               "Enter to run" affordance. The last one does the real work — it
               has to read as ARMED while DOM focus is still in the query input,
               and a sentence naming the key that fires it says so outright
               where a tint can only imply it. bg-base-300 stays as decorative
               reinforcement and is explicitly NOT load-bearing at 1.05–1.13. -->
          @for (entry of visibleResults(); track entry.id; let i = $index) {
            <button
              type="button"
              tabindex="-1"
              class="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-base-content"
              role="option"
              [id]="optionId(i)"
              [attr.aria-selected]="i === activeIndex()"
              [attr.aria-disabled]="entry.disabledReason !== null"
              [attr.data-testid]="
                entry.disabledReason === null
                  ? 'task-palette-option'
                  : 'task-palette-option-disabled'
              "
              [class.bg-base-300]="i === activeIndex()"
              (click)="runEntry(entry)"
              (mouseenter)="onHover(i)"
            >
              <span class="flex w-full items-baseline gap-2">
                <span class="w-3 shrink-0" aria-hidden="true">
                  @if (i === activeIndex()) {
                    <lucide-angular [img]="ChevronRightIcon" class="w-3 h-3" />
                  }
                </span>
                <!-- The label is the only thing allowed to truncate: it holds
                     the untrusted text and can be arbitrarily long, while both
                     trailing elements are short and fixed. min-w-0 is what
                     lets it shrink at all inside a flex row. -->
                <span
                  class="min-w-0 flex-1 truncate text-sm"
                  [class.font-semibold]="i === activeIndex()"
                  >{{ entry.label }}</span
                >
                @if (i === activeIndex() && entry.disabledReason === null) {
                  <span
                    class="shrink-0 whitespace-nowrap text-[11px]"
                    data-testid="task-palette-enter-hint"
                    >Enter to run</span
                  >
                } @else {
                  <span class="shrink-0 whitespace-nowrap text-[11px]">{{
                    groupLabel(entry)
                  }}</span>
                }
              </span>
              @if (entry.disabledReason; as reason) {
                <!-- FR-C6.6's sentence, on its own line and at FULL opacity.
                     It was opacity-60 sharing the label's flex row, which
                     failed 4.5:1 at rest on three of the four mandated bases
                     (4.278 / 3.900 / 3.554) and on ALL FOUR in the reachable
                     active+disabled compound (2.42–3.24) — an explanation
                     nobody can read is not an explanation, and this one is the
                     whole reason a disabled entry is LISTED rather than hidden.
                     Its own line also removes the flex competition entirely,
                     so neither the label nor the reason can crowd the other
                     out. De-emphasis now comes from size and weight, per the
                     Batch 7 sweep: 11px regular under a 14px label that only
                     goes semibold when the row is both active and runnable. -->
                <span
                  class="pl-5 text-[11px] leading-tight"
                  data-testid="task-palette-reason"
                  >{{ reason }}</span
                >
              }
            </button>
          }
        </div>

        @if (visibleResults().length === 0) {
          <!-- Outside the listbox on purpose: an empty listbox is the honest
               ARIA statement, and a "nothing matched" sentence dressed as an
               option would be announced as a command the user could run. -->
          <p
            class="px-3 py-4 text-center text-xs text-base-content"
            data-testid="task-palette-no-results"
          >
            No command matches what you typed.
          </p>
        }

        @if (overflowCount() > 0) {
          <p
            class="px-3 py-1.5 text-[11px] text-base-content border-t border-base-content/10"
            data-testid="task-palette-overflow"
          >
            {{ overflowCount() }} more match — keep typing to narrow them.
          </p>
        }
      </div>
    </div>
  `,
})
export class TaskCommandPaletteComponent {
  /** The whole catalogue; this component filters and ranks it, never builds it. */
  public readonly entries = input.required<readonly TaskPaletteEntry[]>();

  /** An enabled entry was activated. The host decides what it means. */
  public readonly run = output<TaskPaletteAction>();
  /** The palette asked to close. The host owns whether it is rendered. */
  public readonly closed = output<void>();

  private readonly keyboardNav = inject(KeyboardNavigationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly queryInput =
    viewChild.required<ElementRef<HTMLInputElement>>('queryInput');

  private readonly instance = (paletteInstanceCounter += 1);
  protected readonly listboxId = `ptah-task-palette-list-${this.instance}`;

  protected readonly query = signal('');
  protected readonly activeIndex = this.keyboardNav.activeIndex;
  protected readonly SearchIcon = Search;
  protected readonly ChevronRightIcon = ChevronRight;

  /** Every matching entry, best first. */
  private readonly results = computed(() =>
    rankPaletteMatches(this.entries(), this.query()),
  );

  protected readonly visibleResults = computed(() =>
    this.results().slice(0, MAX_VISIBLE_RESULTS),
  );

  protected readonly overflowCount = computed(() =>
    Math.max(0, this.results().length - MAX_VISIBLE_RESULTS),
  );

  protected readonly activeOptionId = computed(() => {
    const index = this.activeIndex();
    return index >= 0 && index < this.visibleResults().length
      ? this.optionId(index)
      : null;
  });

  /**
   * Whatever held focus when the palette opened.
   *
   * Captured in the constructor, which runs during the change-detection pass
   * that the trigger's own click/keydown started — the trigger is still the
   * active element at that moment. Restored on destroy, which is the palette's
   * close: the host renders this component inside an `@if`, so there is exactly
   * one close path and it cannot be forgotten on one of them.
   */
  private readonly returnFocusTo: Element | null =
    typeof document === 'undefined' ? null : document.activeElement;

  public constructor() {
    effect(() => {
      this.keyboardNav.configure({
        itemCount: this.visibleResults().length,
        wrap: true,
      });
    });

    afterNextRender(() => this.queryInput().nativeElement.focus());

    inject(DestroyRef).onDestroy(() => this.restoreFocus());
  }

  protected groupLabel(entry: TaskPaletteEntry): string {
    return TASK_PALETTE_GROUP_LABELS[entry.group];
  }

  protected optionId(index: number): string {
    return `ptah-task-palette-option-${this.instance}-${index}`;
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    // Re-configured and reset EAGERLY rather than waiting for the effect: a
    // narrowed list whose active index is still pointing at the old row would
    // run the wrong command for anyone who types and immediately presses
    // Enter, which is the fastest and therefore the most common way to use
    // this. Reading `visibleResults()` here pulls the fresh computed.
    this.keyboardNav.configure({
      itemCount: this.visibleResults().length,
      wrap: true,
    });
    this.keyboardNav.setActiveIndex(0);
    this.scrollActiveIntoView();
  }

  protected onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (this.keyboardNav.handleKeyDown(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.scrollActiveIntoView();
      return;
    }

    switch (event.key) {
      case 'Enter': {
        const entry = this.visibleResults()[this.activeIndex()];
        event.preventDefault();
        event.stopPropagation();
        if (entry !== undefined) this.runEntry(entry);
        return;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.requestClose();
        return;
      case 'Tab':
        // The complete trap described in the class docblock: one focusable
        // element means "keep focus here" is the whole of it.
        event.preventDefault();
        return;
      default:
        // Everything else is typing. It is deliberately NOT stopped: the
        // characters have to reach the input, and the view's host shortcut
        // ignores any key whose target is a text field anyway.
        return;
    }
  }

  /**
   * Run one entry, refusing the disabled ones.
   *
   * The refusal is silent and leaves the palette open, because the reason is
   * already rendered on the row the user just pressed Enter on — a toast
   * repeating it would cover the list it is describing.
   */
  protected runEntry(entry: TaskPaletteEntry): void {
    if (entry.disabledReason !== null) return;
    this.run.emit(entry.action);
  }

  protected requestClose(): void {
    this.closed.emit();
  }

  /**
   * Keep the active option visible (FR-C6.5).
   *
   * Queried off the rendered list rather than held in a `viewChildren`, because
   * the only moment this is needed is immediately after an index change and the
   * elements are already in the DOM — the arrow keys move a highlight, they do
   * not add or remove rows.
   */
  private scrollActiveIntoView(): void {
    const index = this.activeIndex();
    if (index < 0) return;
    const options =
      this.host.nativeElement.querySelectorAll<HTMLElement>('[role="option"]');
    const option = options[index];
    // jsdom does not implement `scrollIntoView`, so the guard is what keeps
    // every keyboard test in this suite from failing on a layout API that has
    // nothing to do with what they assert. The spec stubs it and asserts the
    // call, so the guard cannot hide a regression in the behaviour itself.
    if (option !== undefined && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }

  private restoreFocus(): void {
    const target = this.returnFocusTo;
    if (
      target instanceof HTMLElement &&
      target.isConnected &&
      typeof target.focus === 'function'
    ) {
      target.focus();
    }
  }
}
