/**
 * OutputStyleListComponent — the matrix picker half of the output-style section (A19-A24).
 *
 * Rebuilt as a P4 matrix (`table table-xs`) with an Active radio column (G7) and
 * collapsed Command-line parity `<details>` (P9):
 *  - **A19**: P4 matrix with Active (radio), Name, Tier, Description, Actions columns.
 *    Retains `role="radiogroup"` on the table.
 *  - **A20**: Status/tier badges in outline form (`badge badge-outline badge-xs text-base-content`),
 *    preserving deviation #6 (colour on dot/border only).
 *  - **A22**: Edit opens drawer D-OS; Delete opens P8 inline confirm in the row.
 *  - **A23**: Inline alert banners for write error, missing-active, collision and fallback (in
 *    {@link OutputStyleNoticesComponent}), and the unreadable invalid files list with "Rewrite it here".
 *  - **A24**: Command-line parity in a closed `<details>` (P9); S-confirm before writing
 *    settings file outside Ptah, with exact display path before write and no Undo.
 *
 * Copy rules baked into this template (load-bearing):
 *  - **R1** — style influences how the agent writes; Ptah's prompt is always appended.
 *  - **Req 4.2** — immutable style shows disabled control + reason.
 *  - **E4/M1** — shadowed row shows disabled control + winner reason.
 *  - **E5/N1** — missing-active banner names both causes unless invalid list is empty.
 *  - **Req 5.4** — fallback banner triggered for user-tier + localhost provider.
 *  - **Req 2.5** — footer states change lands on the next session.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  AlertTriangle,
  Check,
  Pencil,
  Trash2,
} from 'lucide-angular';
import type {
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleEntry,
  OutputStyleParityRequest,
  OutputStyleTier,
  SettingsTier,
  WritableOutputStyleTier,
} from '@ptah-extension/shared';
import {
  OutputStyleParitySectionComponent,
  PARITY_TIERS,
  type ParityTierOption,
} from './output-style-parity-section.component';
import type { OutputStyleFailedOperation } from './output-style.store';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { OutputStyleNoticesComponent } from './output-style-notices.component';

export { PARITY_TIERS, type ParityTierOption };

/** A style the user asked to edit or delete, identified the only way that binds (E1). */
export interface OutputStyleRef {
  readonly name: string;
  readonly tier: WritableOutputStyleTier;
}

/**
 * One selection request: the style, plus whether to also mirror it for the
 * command line. `parity` is absent unless the user ticked the box.
 */
export interface OutputStyleSelectionRequest {
  readonly name: string | null;
  readonly parity?: OutputStyleParityRequest;
}

const TIER_LABELS: Readonly<Record<OutputStyleTier, string>> = {
  builtin: 'Built-in',
  user: 'You',
  project: 'Project',
  plugin: 'Plugin',
};

const SHADOW_WINNER_LABELS: Readonly<Record<OutputStyleTier, string>> = {
  builtin: 'the built-in style of the same name',
  user: 'your own copy of the same name',
  project: "this project's copy of the same name",
  plugin: 'a plugin copy of the same name',
};

let listInstanceCounter = 0;

function isActiveStyle(style: OutputStyleEntry, selected: string | null): boolean {
  return selected === null ? style.name === 'default' : selected === style.name && style.shadowed !== true;
}

const BUILT_IN_NOTE = 'Built into the agent — Ptah can select it but not change it.';

@Component({
  selector: 'ptah-output-style-list',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, LucideAngularModule, OutputStyleNoticesComponent, OutputStyleParitySectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-output-style-notices
      [failedOperation]="failedOperation()"
      [activeName]="activeName()"
      [activeMissing]="activeMissing()"
      [invalidCount]="invalid().length"
      [hasCollision]="hasCollision()"
      [collidingNames]="collidingNames()"
      [usingFallback]="usingFallback()"
      [styles]="styles()"
      [saving]="saving()"
      (dismissError)="dismissError.emit()"
      (clearSelection)="onSelectNull()"
      (copyToProject)="copyToProject.emit($event)"
    />

    <!-- Matrix Table (A19, A20, A22, G7) -->
    @if (loading()) {
      <div class="flex items-center gap-2 py-3 text-xs text-base-content-muted" role="status">
        <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
        Reading your style files…
      </div>
    } @else {
      <div class="overflow-x-auto">
        <table
          class="table table-xs w-full"
          role="radiogroup"
          aria-label="Active output style"
          data-testid="output-style-matrix"
        >
          <thead>
            <tr>
              <th class="w-12 text-center" scope="col">Active</th>
              <th scope="col">Name</th>
              <th scope="col">Tier</th>
              <th scope="col">Description</th>
              <th class="text-right" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (
              style of styles();
              track style.tier + '/' + style.name;
              let i = $index
            ) {
              <tr
                [class.opacity-60]="isShadowed(style)"
                [attr.data-testid]="'output-style-row-' + style.name"
              >
                <!-- Active Radio Column -->
                <td class="text-center align-middle">
                  <input
                    type="radio"
                    name="active-output-style"
                    role="radio"
                    class="radio radio-xs radio-primary cursor-pointer disabled:cursor-not-allowed"
                    [checked]="isActive(style)"
                    [ptahBusyDisabled]="saving() || isShadowed(style)"
                    [attr.aria-checked]="isActive(style)"
                    [attr.aria-label]="'Activate ' + style.name"
                    [attr.title]="shadowNote(style)"
                    [attr.aria-describedby]="isShadowed(style) ? shadowNoteId(i) : null"
                    (click)="onSelectStyle(style)"
                  />
                </td>

                <!-- Name Column -->
                <td class="font-medium align-middle whitespace-nowrap text-base-content">
                  <div class="flex items-center gap-1.5">
                    @if (isActive(style)) {
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-3.5 h-3.5 text-success shrink-0"
                        aria-hidden="true"
                      />
                      <span class="sr-only">Active style:</span>
                    }
                    <span>{{ style.name }}</span>
                  </div>
                </td>

                <!-- Tier Column (A20: outline badges, colour on dot/border only) -->
                <td class="align-middle whitespace-nowrap">
                  <div class="flex items-center gap-1 flex-wrap">
                    <span
                      class="badge badge-outline badge-xs text-base-content"
                      [class.border-primary]="style.tier === 'project'"
                      [class.border-secondary]="style.tier === 'user'"
                      [attr.title]="style.tier === 'builtin' ? builtInNote : null"
                    >
                      {{ tierLabel(style.tier) }}
                    </span>
                    @if (style.shadowed) {
                      <span class="badge badge-outline badge-xs border-warning text-base-content">
                        Overridden
                      </span>
                    }
                    @if (!style.keepCodingInstructions) {
                      <span class="badge badge-outline badge-xs text-base-content">
                        Drops default coding instructions
                      </span>
                    }
                  </div>
                </td>

                <!-- Description Column + Notes (the built-in note is the badge title and one footnote, M4) -->
                <td class="align-middle text-xs text-base-content-muted">
                  <div>{{ style.description }}</div>
                  @if (shadowNote(style); as note) {
                    <p class="text-xs text-base-content-muted mt-0.5" [id]="shadowNoteId(i)">
                      {{ note }}
                    </p>
                  }
                  @if (pluginNote(style); as note) {
                    <p class="text-xs text-base-content-muted mt-0.5">
                      {{ note }}
                    </p>
                  }
                </td>

                <!-- Actions Column -->
                <td class="text-right align-middle whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square disabled:bg-transparent disabled:border-transparent disabled:opacity-50 text-base-content"
                      [disabled]="!style.editable || saving()"
                      [attr.aria-label]="'Edit ' + style.name"
                      [attr.title]="actionTitle(style, 'Edit')"
                      (click)="emitEdit(style)"
                      data-testid="output-style-edit-button"
                    >
                      <lucide-angular
                        [img]="PencilIcon"
                        class="w-3.5 h-3.5"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      #deleteBtn
                      type="button"
                      class="btn btn-ghost btn-xs btn-square disabled:bg-transparent disabled:border-transparent disabled:opacity-50 text-base-content"
                      [disabled]="!style.deletable || saving()"
                      [attr.aria-label]="'Delete ' + style.name"
                      [attr.title]="actionTitle(style, 'Delete')"
                      (click)="askDelete(style)"
                      data-testid="output-style-delete-button"
                    >
                      <lucide-angular
                        [img]="Trash2Icon"
                        class="w-3.5 h-3.5"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </td>
              </tr>
              <!-- D5 / P8: the delete confirm spans the table under its row -->
              @if (isPendingDelete(style)) {
                <tr>
                  <td colspan="5">
                    <div
                      class="flex flex-wrap items-center gap-2 rounded border border-base-300 p-2 text-xs text-base-content"
                      role="alertdialog"
                      [attr.aria-label]="'Confirm deleting ' + style.name"
                      data-testid="output-style-delete-confirm"
                      (keydown.escape)="cancelDelete(deleteBtn, $event)"
                    >
                      <span class="flex-1">
                        Delete
                        <code class="text-base-content-muted">{{ style.fileName ?? style.name }}</code>?
                        This removes the file from disk.
                      </span>
                      <button
                        type="button"
                        class="btn btn-outline btn-xs border-error text-base-content"
                        [ptahBusyDisabled]="saving()"
                        (click)="confirmDelete(style)"
                        data-testid="output-style-confirm-delete"
                      >
                        Delete
                      </button>
                      <button
                        #deleteCancel
                        type="button"
                        class="btn btn-ghost btn-xs text-base-content"
                        (click)="cancelDelete(deleteBtn)"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      @if (hasBuiltIn()) {
        <p class="text-xs text-base-content-muted mt-1" data-testid="output-style-builtin-note">
          Built-in styles are part of the agent — Ptah can select them but not change them.
        </p>
      }

      <!-- Invalid Files List (A23) -->
      @if (invalid().length > 0) {
        <div class="mt-3" data-testid="output-style-invalid-section">
          <h3 class="text-xs font-medium uppercase tracking-wide mb-1 text-base-content">
            Files Ptah could not read
          </h3>
          <ul class="rounded border border-warning/40 divide-y divide-base-300/50">
            @for (entry of invalid(); track entry.relativePath) {
              <li class="p-2 text-xs text-base-content">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <lucide-angular
                    [img]="AlertTriangleIcon"
                    class="w-3.5 h-3.5 text-warning shrink-0"
                    aria-hidden="true"
                  />
                  <span class="font-medium text-base-content">{{ entry.fileName }}</span>
                  <span class="badge badge-outline badge-xs text-base-content">
                    {{ tierLabel(entry.tier) }}
                  </span>
                </div>
                <p class="text-xs text-base-content-muted mt-1 leading-relaxed">
                  {{ entry.error.message }}
                </p>
                <code class="text-xs text-base-content-muted break-all">
                  {{ entry.relativePath }}
                </code>
                <p class="text-xs text-base-content-muted mt-0.5">
                  It is listed here rather than hidden, and it cannot be selected until it parses.
                </p>
                @if (entry.openable) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs mt-1 text-base-content"
                    (click)="openInvalid.emit(entry)"
                    data-testid="output-style-rewrite-button"
                  >
                    Rewrite it here
                  </button>
                }
              </li>
            }
          </ul>
        </div>
      }
    }

    <!-- Command-Line Parity Section (A24, P9) -->
    <ptah-output-style-parity-section
      [parityEnabled]="parityEnabled()"
      [parityTier]="parityTier()"
      [parityDisplayPath]="parityDisplayPath()"
      [pendingParitySelection]="pendingParitySelection()"
      [parityWrittenPath]="parityWrittenPath()"
      [parityWarning]="parityWarning()"
      [saving]="saving()"
      (parityToggled)="onParityToggled($event)"
      (tierChanged)="onParityTierChanged($event)"
      (confirmed)="confirmParitySelection()"
      (cancelled)="cancelParitySelection()"
      (dismissParity)="dismissParity.emit()"
    />

    <!-- Footer Note (Req 2.5) -->
    <p class="text-xs text-base-content-muted mt-2 leading-relaxed">
      A style applies from your next session onwards — a conversation that is
      already running keeps the style it started with. Styles influence tone and
      structure; Ptah's own engineering instructions still apply on top.
    </p>
  `,
})
export class OutputStyleListComponent {
  readonly styles = input.required<readonly OutputStyleEntry[]>();
  readonly invalid = input.required<readonly InvalidOutputStyle[]>();
  readonly active = input<ActiveOutputStyleState | null>(null);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly failedOperation = input<OutputStyleFailedOperation | null>(null);
  readonly hasCollision = input(false);
  readonly collidingNames = input<readonly string[]>([]);
  readonly usingFallback = input(false);
  /** Set only after a parity write succeeded; names the file it changed (E2). */
  readonly parityWrittenPath = input<string | null>(null);
  /** A parity failure. A WARNING — the selection itself succeeded (§4.1). */
  readonly parityWarning = input<string | null>(null);

  /** Style selection event, including parity opt-in when configured. */
  readonly activate = output<OutputStyleSelectionRequest>();
  readonly create = output<void>();
  readonly edit = output<OutputStyleRef>();
  readonly remove = output<OutputStyleRef>();
  readonly openInvalid = output<InvalidOutputStyle>();
  /** `overwrite` only after the user confirmed replacing a project style of the same name (item 16). */
  readonly copyToProject = output<{ readonly name: string; readonly overwrite: boolean }>();
  readonly dismissError = output<void>();
  readonly dismissParity = output<void>();

  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckIcon = Check;
  readonly PencilIcon = Pencil;
  readonly Trash2Icon = Trash2;
  readonly builtInNote = BUILT_IN_NOTE;

  /** View state: which row is showing its delete confirmation. */
  readonly pendingDelete = signal<string | null>(null);

  /** OPT-IN, DEFAULT OFF (R6). Untouched → no settings file is ever written. */
  readonly parityEnabled = signal(false);

  /** The committable tier is the one that serves parity (§4.2). */
  readonly parityTier = signal<SettingsTier>('project');

  /** Style name pending confirmation before parity write (A24, S-confirm). */
  readonly pendingParitySelection = signal<string | null | undefined>(undefined);

  /** The parity tier of the last selection that activated; re-picking the active style only re-asks when this differs. */
  private readonly parityRequestedTier = signal<SettingsTier | null>(null);

  /** The exact file the current tier would write, named before any write. */
  readonly parityDisplayPath = computed<string>(
    () =>
      PARITY_TIERS.find((option) => option.tier === this.parityTier())
        ?.displayPath ?? PARITY_TIERS[0].displayPath,
  );

  readonly activeName = computed<string | null>(
    () => this.active()?.name ?? null,
  );
  readonly activeMissing = computed(() => this.active()?.missing === true);

  readonly hasBuiltIn = computed(() => this.styles().some((style) => style.tier === 'builtin'));

  private readonly instanceId = `output-style-${listInstanceCounter++}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly deleteCancel = viewChild<ElementRef<HTMLButtonElement>>('deleteCancel');

  constructor() {
    // P8: an opened delete confirm takes focus on Cancel, so Esc reaches it.
    effect(() => this.deleteCancel()?.nativeElement.focus());
  }

  onSelectStyle(style: OutputStyleEntry): void {
    if (this.saving() || this.isShadowed(style)) return;
    // Moderate 6: the active radio rewrites nothing, unless parity for the current tier was never written.
    if (this.isActive(style) && !this.parityWriteOutstanding()) {
      this.pendingParitySelection.set(undefined);
      return;
    }
    const name = this.selectionValue(style);
    if (this.parityEnabled()) {
      this.pendingParitySelection.set(name);
    } else {
      this.emitSelection(name);
    }
  }

  onSelectNull(): void {
    if (this.saving()) return;
    if (this.parityEnabled()) {
      this.pendingParitySelection.set(null);
    } else {
      this.emitSelection(null);
    }
  }

  confirmParitySelection(): void {
    const name = this.pendingParitySelection();
    this.pendingParitySelection.set(undefined);
    if (name !== undefined) {
      this.emitSelection(name);
    }
  }

  /** Cancel, Esc or collapsing the section: the radios go back to the saved style, which takes focus. */
  cancelParitySelection(): void {
    this.pendingParitySelection.set(undefined);
    this.syncActiveRadios();
    this.host.nativeElement
      .querySelector<HTMLInputElement>('input[name="active-output-style"]:checked')
      ?.focus();
  }

  /**
   * OnPush keeps a `[checked]` binding whose value did not change, so a refused or cancelled choice would stay
   * checked on screen: put the radio elements back on the saved style (D15).
   */
  syncActiveRadios(selected: string | null = this.activeName()): void {
    const radios = this.host.nativeElement.querySelectorAll<HTMLInputElement>('input[name="active-output-style"]');
    this.styles().forEach((style, index) => {
      const radio = radios.item(index);
      if (radio) radio.checked = isActiveStyle(style, selected);
    });
  }

  emitSelection(name: string | null): void {
    if (!this.parityEnabled()) {
      this.activate.emit({ name });
      return;
    }
    this.activate.emit({ name, parity: { enabled: true, tier: this.parityTier() } });
  }

  /**
   * The config reports an activation with parity that succeeded; only then is the tier's file counted as
   * requested, so a failed activation does not suppress the next parity prompt (N3).
   */
  parityActivated(tier: SettingsTier): void {
    this.parityRequestedTier.set(tier);
  }

  onParityToggled(checked: boolean): void {
    this.parityEnabled.set(checked);
    this.parityRequestedTier.set(null);
    this.pendingParitySelection.set(undefined);
    this.syncActiveRadios();
  }

  onParityTierChanged(tier: SettingsTier): void {
    this.parityTier.set(tier);
  }

  isActive(style: OutputStyleEntry): boolean {
    return isActiveStyle(style, this.activeName());
  }

  selectionValue(style: OutputStyleEntry): string | null {
    return style.name === 'default' ? null : style.name;
  }

  tierLabel(tier: OutputStyleTier): string {
    return TIER_LABELS[tier];
  }

  isShadowed(style: OutputStyleEntry): boolean {
    return style.shadowed === true;
  }

  shadowNoteId(index: number): string {
    return `${this.instanceId}-shadow-note-${index}`;
  }

  shadowNote(style: OutputStyleEntry): string | null {
    if (!this.isShadowed(style)) return null;

    const winner =
      this.styles().find(
        (candidate) =>
          candidate.name === style.name && candidate.shadowed !== true,
      ) ?? null;
    const winnerLabel =
      winner === null
        ? 'another file of the same name'
        : SHADOW_WINNER_LABELS[winner.tier];

    return `Selecting this name activates ${winnerLabel}, which outranks this file, so this row cannot be chosen on its own. Rename this file to make it selectable.`;
  }

  /** Plugin rows keep their own note, since it names the plugin; the built-in note is shown once (M4). */
  pluginNote(style: OutputStyleEntry): string | null {
    const reason = style.immutableReason ?? '';
    if (style.editable || !reason.startsWith('plugin:')) return null;
    return `Provided by the plugin ${reason.slice('plugin:'.length)} — Ptah can read it but not change it.`;
  }

  actionTitle(style: OutputStyleEntry, verb: string): string {
    if (style.editable) return `${verb} ${style.name}`;
    return this.pluginNote(style) ?? BUILT_IN_NOTE;
  }

  /** Parity is on and its file for the current tier was not written by the last selection (or that write failed). */
  private parityWriteOutstanding(): boolean {
    return (
      this.parityEnabled() &&
      (this.parityRequestedTier() !== this.parityTier() || this.parityWarning() !== null)
    );
  }

  isPendingDelete(style: OutputStyleEntry): boolean {
    return this.pendingDelete() === this.rowKey(style);
  }

  askDelete(style: OutputStyleEntry): void {
    this.pendingDelete.set(this.rowKey(style));
  }

  /** Cancel and Esc close the confirm and return focus to the row's Delete button (P8). */
  cancelDelete(opener: HTMLButtonElement, event?: Event): void {
    event?.stopPropagation();
    this.pendingDelete.set(null);
    opener.focus();
  }

  confirmDelete(style: OutputStyleEntry): void {
    const ref = this.toRef(style);
    if (ref === null) return;
    this.pendingDelete.set(null);
    this.remove.emit(ref);
  }

  emitEdit(style: OutputStyleEntry): void {
    const ref = this.toRef(style);
    if (ref !== null) this.edit.emit(ref);
  }

  private rowKey(style: OutputStyleEntry): string {
    return `${style.tier}/${style.name}`;
  }

  private toRef(style: OutputStyleEntry): OutputStyleRef | null {
    return style.tier === 'user' || style.tier === 'project'
      ? { name: style.name, tier: style.tier }
      : null;
  }
}
