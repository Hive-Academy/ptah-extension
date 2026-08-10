/**
 * OutputStyleListComponent — the picker half of the output-style section.
 *
 * Purely presentational: every input arrives from `OutputStyleConfigComponent`,
 * every action leaves as an output. It holds exactly one piece of local state,
 * the pending delete confirmation, because that is view state and nothing else
 * needs to know about it.
 *
 * Copy rules baked into this template, all of them load-bearing:
 *
 *  - **R1** — a style *influences* how the agent writes. Ptah's own engineering
 *    prompt is appended to every session unconditionally and is the stronger
 *    voice, so nothing here may claim a style governs or guarantees behaviour.
 *  - **Req 4.2** — an immutable style shows a *disabled* control plus the
 *    reason, never a silently missing button.
 *  - **E4/M1** — a *shadowed* row gets that same treatment. The name it carries
 *    resolves to the winning entry under SDK merge order, so a click on the
 *    losing row would light up a DIFFERENT row. Rather than give misleading
 *    feedback, the row is disabled and says which copy wins and why.
 *  - **E5/N1** — the missing-active banner must not claim the file was removed.
 *    `resolveActive` sets `missing` whenever the name is absent from the winners
 *    map, which is ALSO true when the file is still on disk but no longer
 *    parses. The copy names both causes, and only the cause the list can
 *    actually corroborate.
 *  - **Req 5.4 (rev 2)** — the fallback banner's trigger is only "user-tier
 *    style file + localhost provider", and it says the provider does not read
 *    user-level style FILES. It must not say settings are ignored: the settings
 *    key rides the flag tier and always applies.
 *  - **Req 2.5** — the footer states the change lands on the next session.
 *
 * ## The CLI-parity control (B7, §4.1/§4.2, R6)
 *
 * The checkbox is default OFF and its state lives here, in the view, because
 * it is a property of THIS activation and not of the style. A user who never
 * touches it emits `parity: undefined`, the backend calls no settings writer,
 * and no `.claude/settings*.json` is created or modified.
 *
 * Two copy rules on top of the ones above:
 *
 *  - **R6/E2** — the label names the EXACT file before it is written, and that
 *    name is a relative display path (`.claude/settings.json`,
 *    `.claude/settings.local.json`, `~/.claude/settings.json`). No absolute
 *    host path is ever rendered (Req 7.6).
 *  - **§4.1** — the outcome is reported as a plain note or a warning, never as
 *    an error. A parity failure does not mean the style failed to apply, and
 *    the copy must not imply the user should try their selection again.
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
  AlertTriangle,
  Check,
  Pencil,
  Plus,
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

/** A style the user asked to edit or delete, identified the only way that binds (E1). */
export interface OutputStyleRef {
  readonly name: string;
  readonly tier: WritableOutputStyleTier;
}

/**
 * One selection request: the style, plus whether to also mirror it for the
 * command line. `parity` is absent unless the user ticked the box, which is
 * what makes "no opt-in, no settings file" true at the wire level and not just
 * in the backend's branching.
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

/**
 * How the WINNER of a shadowed name is described in prose (E4/M1).
 *
 * The badge labels above are noun-phrase-hostile — "the You copy" does not read
 * — so the sentence form is spelled out separately instead of reusing them.
 */
const SHADOW_WINNER_LABELS: Readonly<Record<OutputStyleTier, string>> = {
  builtin: 'the built-in style of the same name',
  user: 'your own copy of the same name',
  project: "this project's copy of the same name",
  plugin: 'a plugin copy of the same name',
};

/** Distinguishes the `aria-describedby` targets of two lists on one page. */
let listInstanceCounter = 0;

/**
 * The exact file each parity tier writes, as a display path (E2, Req 7.6).
 *
 * These are the same three strings `ClaudeSettingsWriter` reports back in
 * `writtenPath`, so the name the user reads BEFORE the write is the name they
 * read after it. Relative and `~`-relative by construction — the frontend never
 * learns an absolute host path and could not render one if it wanted to.
 */
const PARITY_TIERS: ReadonlyArray<{
  readonly tier: SettingsTier;
  readonly displayPath: string;
  readonly scope: string;
}> = [
  {
    tier: 'project',
    displayPath: '.claude/settings.json',
    scope: 'this project, shared with anyone who clones it',
  },
  {
    tier: 'local',
    displayPath: '.claude/settings.local.json',
    scope: 'this project, only on this machine',
  },
  {
    tier: 'user',
    displayPath: '~/.claude/settings.json',
    scope: 'every project on this machine',
  },
];

@Component({
  selector: 'ptah-output-style-list',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as message) {
      <div
        class="flex items-start gap-2 rounded border border-error/40 bg-error/10 p-2 mb-2"
        role="alert"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-error"
          aria-hidden="true"
        />
        <span class="text-xs text-error flex-1">{{ message }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          (click)="dismissError.emit()"
        >
          Dismiss
        </button>
      </div>
    }

    @if (activeMissing()) {
      <div
        class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 mb-2"
        role="status"
      >
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div class="flex-1">
          <p class="text-xs">
            The selected style
            <code class="text-base-content/80">{{ activeName() }}</code>
            {{ missingActiveExplanation() }}
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs mt-1 gap-1"
            (click)="emitSelection(null)"
            [disabled]="saving()"
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

    @if (hasCollision()) {
      <div
        class="rounded border border-warning/40 bg-warning/10 p-2 mb-2"
        role="status"
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

    @if (usingFallback()) {
      <div
        class="rounded border border-info/40 bg-info/10 p-2 mb-2"
        role="status"
      >
        <p class="text-xs">
          This provider does not read style files from your home folder, so Ptah
          adds
          <code class="text-base-content/80">{{ activeName() }}</code>
          to each new session directly instead. Copying it into this project
          removes the need for that.
        </p>
        @if (activeName(); as name) {
          <button
            type="button"
            class="btn btn-ghost btn-xs mt-1"
            (click)="copyToProject.emit(name)"
            [disabled]="saving()"
          >
            Copy to this project
          </button>
        }
      </div>
    }

    <div class="flex items-center justify-between mb-1.5">
      <span class="text-[11px] text-base-content/50">
        {{ styles().length }} available
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        (click)="create.emit()"
        [disabled]="saving()"
      >
        <lucide-angular [img]="PlusIcon" class="w-3 h-3" aria-hidden="true" />
        New style
      </button>
    </div>

    @if (loading()) {
      <div class="flex items-center gap-2 py-3 text-xs text-base-content/50">
        <span class="loading loading-spinner loading-xs"></span>
        Reading your style files…
      </div>
    } @else {
      <ul
        class="rounded border border-base-300 divide-y divide-base-300/50"
        role="radiogroup"
        aria-label="Active output style"
      >
        @for (
          style of styles();
          track style.tier + '/' + style.name;
          let i = $index
        ) {
          <li class="p-2" role="presentation">
            <div class="flex items-start gap-2">
              <button
                type="button"
                role="radio"
                class="flex-1 min-w-0 text-left rounded px-1 py-0.5 hover:bg-base-200/60 transition-colors disabled:cursor-not-allowed"
                [attr.aria-checked]="isActive(style)"
                [attr.title]="shadowNote(style)"
                [attr.aria-describedby]="
                  isShadowed(style) ? shadowNoteId(i) : null
                "
                [disabled]="saving() || isShadowed(style)"
                (click)="emitSelection(selectionValue(style))"
              >
                <span class="flex items-center gap-1.5 flex-wrap">
                  @if (isActive(style)) {
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-3.5 h-3.5 text-success shrink-0"
                      aria-hidden="true"
                    />
                    <span class="sr-only">Active style:</span>
                  }
                  <span class="text-xs font-medium">{{ style.name }}</span>
                  <span
                    class="badge badge-xs"
                    [class.badge-primary]="style.tier === 'project'"
                    [class.badge-secondary]="style.tier === 'user'"
                    [class.badge-ghost]="
                      style.tier === 'builtin' || style.tier === 'plugin'
                    "
                  >
                    {{ tierLabel(style.tier) }}
                  </span>
                  @if (style.shadowed) {
                    <span class="badge badge-xs badge-warning">
                      Overridden
                    </span>
                  }
                  @if (!style.keepCodingInstructions) {
                    <span class="badge badge-xs badge-outline">
                      Drops the default coding instructions
                    </span>
                  }
                </span>
                <span
                  class="block text-[11px] text-base-content/60 mt-0.5 leading-relaxed"
                >
                  {{ style.description }}
                </span>
              </button>

              <div class="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  [disabled]="!style.editable || saving()"
                  [attr.aria-label]="'Edit ' + style.name"
                  [attr.title]="actionTitle(style, 'Edit')"
                  (click)="emitEdit(style)"
                >
                  <lucide-angular
                    [img]="PencilIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs px-1"
                  [disabled]="!style.deletable || saving()"
                  [attr.aria-label]="'Delete ' + style.name"
                  [attr.title]="actionTitle(style, 'Delete')"
                  (click)="askDelete(style)"
                >
                  <lucide-angular
                    [img]="Trash2Icon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>

            @if (shadowNote(style); as note) {
              <p
                class="text-[10px] text-base-content/60 mt-1 pl-1"
                [id]="shadowNoteId(i)"
              >
                {{ note }}
              </p>
            }

            @if (immutableNote(style); as note) {
              <p class="text-[10px] text-base-content/50 mt-1 pl-1">
                {{ note }}
              </p>
            }

            @if (isPendingDelete(style)) {
              <div
                class="flex items-center gap-2 mt-1.5 rounded border border-error/40 bg-error/10 px-2 py-1.5"
                role="alertdialog"
                [attr.aria-label]="'Confirm deleting ' + style.name"
              >
                <span class="text-[11px] flex-1">
                  Delete
                  <code class="text-base-content/80">{{
                    style.fileName ?? style.name
                  }}</code
                  >? This removes the file from disk.
                </span>
                <button
                  type="button"
                  class="btn btn-error btn-xs"
                  [disabled]="saving()"
                  (click)="confirmDelete(style)"
                >
                  Delete
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  (click)="pendingDelete.set(null)"
                >
                  Cancel
                </button>
              </div>
            }
          </li>
        }
      </ul>

      @if (invalid().length > 0) {
        <div class="mt-3">
          <h3 class="text-[11px] font-medium uppercase tracking-wide mb-1">
            Files Ptah could not read
          </h3>
          <ul
            class="rounded border border-warning/40 divide-y divide-base-300/50"
          >
            @for (entry of invalid(); track entry.relativePath) {
              <li class="p-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <lucide-angular
                    [img]="AlertTriangleIcon"
                    class="w-3.5 h-3.5 text-warning shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-xs font-medium">{{ entry.fileName }}</span>
                  <span class="badge badge-xs badge-ghost">
                    {{ tierLabel(entry.tier) }}
                  </span>
                </div>
                <p
                  class="text-[11px] text-base-content/70 mt-1 leading-relaxed"
                >
                  {{ entry.error.message }}
                </p>
                <code class="text-[10px] text-base-content/50 break-all">
                  {{ entry.relativePath }}
                </code>
                <p class="text-[10px] text-base-content/50 mt-0.5">
                  It is listed here rather than hidden, and it cannot be
                  selected until it parses.
                </p>
                @if (entry.openable) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs mt-1"
                    (click)="openInvalid.emit(entry)"
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

    <div class="mt-3 rounded border border-base-300 p-2">
      <label class="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          class="checkbox checkbox-xs mt-0.5"
          [checked]="parityEnabled()"
          (change)="onParityToggle($event)"
        />
        <span class="flex-1">
          <span class="text-xs">
            Also apply this style when I run <code>claude</code> in this project
          </span>
          <span
            class="block text-[11px] text-base-content/60 mt-0.5 leading-relaxed"
          >
            Ptah applies your choice on its own. Tick this to additionally write
            <code class="text-base-content/80">{{ parityDisplayPath() }}</code>
            so the command-line tool picks up the same style. Ptah keeps every
            other setting in that file as it is.
          </span>
        </span>
      </label>

      @if (parityEnabled()) {
        <div class="mt-2 pl-6">
          <label
            class="block text-[11px] text-base-content/70 mb-1"
            for="output-style-parity-tier"
          >
            Where to write it
          </label>
          <select
            id="output-style-parity-tier"
            class="select select-bordered select-xs w-full max-w-xs"
            [value]="parityTier()"
            (change)="onParityTierChange($event)"
          >
            @for (option of parityTiers; track option.tier) {
              <option [value]="option.tier">
                {{ option.displayPath }} — {{ option.scope }}
              </option>
            }
          </select>
          <p class="text-[10px] text-base-content/50 mt-1 leading-relaxed">
            The file is written the next time you pick a style. Nothing is
            written while this box is unticked.
          </p>
        </div>
      }

      @if (parityWrittenPath(); as written) {
        <p
          class="text-[11px] text-success mt-2 pl-6 leading-relaxed"
          role="status"
        >
          Saved to <code>{{ written }}</code
          >.
        </p>
      }

      @if (parityWarning(); as warning) {
        <div
          class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 mt-2"
          role="status"
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div class="flex-1">
            <p class="text-[11px] leading-relaxed">{{ warning }}</p>
            <p class="text-[10px] text-base-content/60 mt-0.5">
              Your chosen style is still active in Ptah — only the extra copy
              for the command line was skipped.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            (click)="dismissParity.emit()"
          >
            Dismiss
          </button>
        </div>
      }
    </div>

    <p class="text-[10px] text-base-content/50 mt-2 leading-relaxed">
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

  /**
   * A style selection, plus the opt-in parity request when the box is ticked.
   * `name: null` clears the selection and returns the SDK to unmodified
   * behaviour.
   */
  readonly activate = output<OutputStyleSelectionRequest>();
  readonly create = output<void>();
  readonly edit = output<OutputStyleRef>();
  readonly remove = output<OutputStyleRef>();
  readonly openInvalid = output<InvalidOutputStyle>();
  readonly copyToProject = output<string>();
  readonly dismissError = output<void>();
  readonly dismissParity = output<void>();

  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckIcon = Check;
  readonly PencilIcon = Pencil;
  readonly PlusIcon = Plus;
  readonly RotateCcwIcon = RotateCcw;
  readonly Trash2Icon = Trash2;

  /** View state only: which row is showing its delete confirmation. */
  readonly pendingDelete = signal<string | null>(null);

  readonly parityTiers = PARITY_TIERS;

  /** OPT-IN, DEFAULT OFF (R6). Untouched → no settings file is ever written. */
  readonly parityEnabled = signal(false);

  /** The committable tier is the one that serves parity (§4.2). */
  readonly parityTier = signal<SettingsTier>('project');

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

  /** Suffix that keeps this instance's `aria-describedby` targets its own. */
  private readonly instanceId = `output-style-${listInstanceCounter++}`;

  /**
   * E5/N1 — why the active style stopped resolving, stated to the limit of what
   * is knowable here and no further.
   *
   * `missing` means only "the active name is absent from the winners map". Two
   * things produce that: the file is gone, or the file is still there and no
   * longer parses. The second case is exactly the case that puts a file in
   * `invalid`, so an EMPTY invalid list rules it out and removal can be named
   * outright; a non-empty one cannot single out a cause, and the copy says so
   * rather than guessing. Matching the active name against `InvalidOutputStyle`
   * is not available as a tiebreak: an unparseable file has no frontmatter
   * `name` to match on, and its filename need not equal the style name (E1).
   */
  readonly missingActiveExplanation = computed<string>(() =>
    this.invalid().length === 0
      ? 'is no longer available. Its file was removed or renamed outside Ptah, so new sessions run with the default behaviour.'
      : 'is no longer available. Its file was either removed outside Ptah, or it is one of the files Ptah could not read, listed below — repairing that file brings the style back. Until then, new sessions run with the default behaviour.',
  );

  /**
   * The one place a selection leaves this component.
   *
   * `parity` is OMITTED, not sent as `{ enabled: false }`, when the box is
   * unticked — the absent field is what guarantees the backend's settings
   * writer is never reached on the default path.
   */
  emitSelection(name: string | null): void {
    this.activate.emit(
      this.parityEnabled()
        ? { name, parity: { enabled: true, tier: this.parityTier() } }
        : { name },
    );
  }

  onParityToggle(event: Event): void {
    this.parityEnabled.set((event.target as HTMLInputElement).checked);
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

  /**
   * `default` is the SDK's null sentinel rather than a style object, so picking
   * it clears the key instead of writing a name.
   */
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

  /**
   * E4/M1 — the reason a shadowed row cannot be picked.
   *
   * A style is selected BY NAME, and this row loses that name. Emitting it would
   * activate the winner, putting the checkmark on a different row from the one
   * clicked, so the control is disabled with its reason instead — the same
   * disabled-plus-reason shape Req 4.2 already uses for immutable styles.
   *
   * The winner needs no merge-order knowledge to identify: discovery marks every
   * loser `shadowed`, so the one entry sharing this name that is NOT shadowed is
   * the winner by construction. When it somehow is not in the list, the sentence
   * degrades to naming no tier rather than naming a wrong one.
   */
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

  /** Req 4.2 — the reason an immutable style has no edit or delete action. */
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

  /** Only the two writable tiers can be edited or deleted (Req 4.1/4.2). */
  private toRef(style: OutputStyleEntry): OutputStyleRef | null {
    return style.tier === 'user' || style.tier === 'project'
      ? { name: style.name, tier: style.tier }
      : null;
  }
}
