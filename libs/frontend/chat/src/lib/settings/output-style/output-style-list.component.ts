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
 *  - **A23**: Inline alert banners for write error, missing-active, collision, fallback,
 *    and unreadable invalid files list with "Rewrite it here".
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
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  AlertCircle,
  AlertTriangle,
  Check,
  Pencil,
  RotateCcw,
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

const OUTPUT_STYLE_ACTIVATE_FAILED = 'Could not change the active output style.';
const OUTPUT_STYLE_DELETE_FAILED = 'Could not delete the output style.';
const OUTPUT_STYLE_COPY_FAILED = 'Could not copy the output style to the project.';

@Component({
  selector: 'ptah-output-style-list',
  standalone: true,
  imports: [LucideAngularModule, OutputStyleParitySectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Write / Operation Error Alert -->
    @if (error()) {
      <div
        class="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 mb-3 text-xs text-base-content"
        role="alert"
        data-testid="output-style-error"
      >
        <lucide-angular
          [img]="AlertCircleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-error"
          aria-hidden="true"
        />
        <span class="flex-1">{{ fixedErrorMessage() }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-base-content"
          (click)="dismissError.emit()"
        >
          Dismiss
        </button>
      </div>
    }

    <!-- Missing-active banner (E5/N1) -->
    @if (activeMissing()) {
      <div
        class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-missing-banner"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div class="flex-1">
          <p class="text-xs">
            The selected style
            <code class="text-base-content-muted">{{ activeName() }}</code>
            {{ missingActiveExplanation() }}
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs mt-1 gap-1 text-base-content"
            (click)="onSelectNull()"
            [disabled]="saving()"
            data-testid="output-style-clear-selection"
          >
            <lucide-angular
              [img]="RotateCcwIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            Clear the selection
          </button>
        </div>
      </div>
    }

    <!-- Collision banner (E4) -->
    @if (hasCollision()) {
      <div
        class="rounded border border-warning/40 bg-warning/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-collision-banner"
      >
        <p class="text-xs">
          More than one file uses the name
          {{ collidingNames().join(', ') }}. A style is selected by name, so the
          higher-priority copy wins: a project file beats a user file, and any
          file beats a built-in of the same name. Rename one of them to remove
          the ambiguity.
        </p>
      </div>
    }

    <!-- Fallback injection banner (Req 5.4) -->
    @if (usingFallback()) {
      <div
        class="rounded border border-info/40 bg-info/10 p-2 mb-3 text-xs text-base-content"
        role="status"
        data-testid="output-style-fallback-banner"
      >
        <p class="text-xs">
          This provider does not read style files from your home folder, so Ptah
          adds
          <code class="text-base-content-muted">{{ activeName() }}</code>
          to each new session directly instead. Copying it into this project
          removes the need for that.
        </p>
        @if (activeName(); as name) {
          <button
            type="button"
            class="btn btn-ghost btn-xs mt-1 text-base-content"
            (click)="copyToProject.emit(name)"
            [disabled]="saving()"
            data-testid="output-style-copy-to-project"
          >
            Copy to this project
          </button>
        }
      </div>
    }

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
                    [disabled]="saving() || isShadowed(style)"
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

                <!-- Description Column + Notes + Delete Confirmation -->
                <td class="align-middle text-xs text-base-content-muted">
                  <div>{{ style.description }}</div>
                  @if (shadowNote(style); as note) {
                    <p class="text-[10px] text-base-content-muted mt-0.5" [id]="shadowNoteId(i)">
                      {{ note }}
                    </p>
                  }
                  @if (immutableNote(style); as note) {
                    <p class="text-[10px] text-base-content-muted mt-0.5">
                      {{ note }}
                    </p>
                  }
                  @if (isPendingDelete(style)) {
                    <div
                      class="flex items-center gap-2 mt-1.5 rounded border border-error/40 bg-error/10 px-2 py-1.5 text-base-content"
                      role="alertdialog"
                      [attr.aria-label]="'Confirm deleting ' + style.name"
                      data-testid="output-style-delete-confirm"
                    >
                      <span class="text-[11px] flex-1">
                        Delete
                        <code class="text-base-content-muted">{{
                          style.fileName ?? style.name
                        }}</code
                        >? This removes the file from disk.
                      </span>
                      <button
                        type="button"
                        class="btn btn-error btn-xs"
                        [disabled]="saving()"
                        (click)="confirmDelete(style)"
                        data-testid="output-style-confirm-delete"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-base-content"
                        (click)="pendingDelete.set(null)"
                      >
                        Cancel
                      </button>
                    </div>
                  }
                </td>

                <!-- Actions Column -->
                <td class="text-right align-middle whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square disabled:bg-transparent disabled:border-transparent disabled:opacity-40 text-base-content"
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
                      type="button"
                      class="btn btn-ghost btn-xs btn-square disabled:bg-transparent disabled:border-transparent disabled:opacity-40 text-base-content"
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
            }
          </tbody>
        </table>
      </div>

      <!-- Invalid Files List (A23) -->
      @if (invalid().length > 0) {
        <div class="mt-3" data-testid="output-style-invalid-section">
          <h3 class="text-[11px] font-medium uppercase tracking-wide mb-1 text-base-content">
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
                <p class="text-[11px] text-base-content-muted mt-1 leading-relaxed">
                  {{ entry.error.message }}
                </p>
                <code class="text-[10px] text-base-content-muted break-all">
                  {{ entry.relativePath }}
                </code>
                <p class="text-[10px] text-base-content-muted mt-0.5">
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
    <p class="text-[10px] text-base-content-muted mt-2 leading-relaxed">
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
  readonly error = input<string | null>(null);
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
  readonly copyToProject = output<string>();
  readonly dismissError = output<void>();
  readonly dismissParity = output<void>();

  readonly AlertCircleIcon = AlertCircle;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckIcon = Check;
  readonly PencilIcon = Pencil;
  readonly RotateCcwIcon = RotateCcw;
  readonly Trash2Icon = Trash2;

  /** View state: which row is showing its delete confirmation. */
  readonly pendingDelete = signal<string | null>(null);

  readonly parityTiers = PARITY_TIERS;

  /** OPT-IN, DEFAULT OFF (R6). Untouched → no settings file is ever written. */
  readonly parityEnabled = signal(false);

  /** The committable tier is the one that serves parity (§4.2). */
  readonly parityTier = signal<SettingsTier>('project');

  /** Style name pending confirmation before parity write (A24, S-confirm). */
  readonly pendingParitySelection = signal<string | null | undefined>(undefined);

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

  /** Fixed error message mapper to ensure host error text is never exposed (D15). */
  readonly fixedErrorMessage = computed<string | null>(() => {
    const raw = this.error();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.includes('delete')) return OUTPUT_STYLE_DELETE_FAILED;
    if (lower.includes('copy')) return OUTPUT_STYLE_COPY_FAILED;
    return OUTPUT_STYLE_ACTIVATE_FAILED;
  });

  private readonly instanceId = `output-style-${listInstanceCounter++}`;

  /** E5/N1 explanation of why the active style stopped resolving. */
  readonly missingActiveExplanation = computed<string>(() =>
    this.invalid().length === 0
      ? 'is no longer available. Its file was removed or renamed outside Ptah, so new sessions run with the default behaviour.'
      : 'is no longer available. Its file was either removed outside Ptah, or it is one of the files Ptah could not read, listed below — repairing that file brings the style back. Until then, new sessions run with the default behaviour.',
  );

  onSelectStyle(style: OutputStyleEntry): void {
    if (this.saving() || this.isShadowed(style)) return;
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

  cancelParitySelection(): void {
    this.pendingParitySelection.set(undefined);
  }

  emitSelection(name: string | null): void {
    this.activate.emit(
      this.parityEnabled()
        ? { name, parity: { enabled: true, tier: this.parityTier() } }
        : { name },
    );
  }

  onParityToggled(checked: boolean): void {
    this.parityEnabled.set(checked);
    this.pendingParitySelection.set(undefined);
  }

  onParityToggle(event: Event): void {
    this.onParityToggled((event.target as HTMLInputElement).checked);
  }

  onParityTierChanged(tier: SettingsTier): void {
    this.parityTier.set(tier);
  }

  onParityTierChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const match = PARITY_TIERS.find((option) => option.tier === value);
    if (match !== undefined) this.parityTier.set(match.tier);
  }

  isActive(style: OutputStyleEntry): boolean {
    const selected = this.activeName();
    return selected === null
      ? style.name === 'default'
      : selected === style.name && style.shadowed !== true;
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

  immutableNote(style: OutputStyleEntry): string | null {
    if (style.editable) return null;

    const reason = style.immutableReason ?? '';
    if (reason.startsWith('plugin:')) {
      return `Provided by the plugin ${reason.slice('plugin:'.length)} — Ptah can read it but not change it.`;
    }
    return 'Built into the agent — Ptah can select it but not change it.';
  }

  actionTitle(style: OutputStyleEntry, verb: string): string {
    return style.editable
      ? `${verb} ${style.name}`
      : (this.immutableNote(style) ?? `${verb} is unavailable`);
  }

  isPendingDelete(style: OutputStyleEntry): boolean {
    return this.pendingDelete() === this.rowKey(style);
  }

  askDelete(style: OutputStyleEntry): void {
    this.pendingDelete.set(this.rowKey(style));
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
