import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Check, LucideAngularModule } from 'lucide-angular';
import { MARKETPLACE_RPC_TIMEOUTS } from '@ptah-extension/chat-ui';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  FileDecision,
  KeptItem,
  KeptItemReason,
  LocalItemFamily,
  PluginsReplaceKeptItemsResult,
} from '@ptah-extension/shared';

// ── Copy shared by the consent dialog, the install report and this prompt ────

/** Keep segment label for a file on disk. */
export const KEEP_FILE_LABEL = 'Keep my file';

/** C10 copy after a successful write whose Library refresh failed. */
export const LIBRARY_STALE_NOTE =
  'The Library may be out of date until its next refresh. The files were installed.';

/** Note under a forced-Keep row. */
export const UNREADABLE_KEPT_NOTE =
  'Ptah could not compare this file, so it was kept. Replace is not available for it.';

/**
 * Families whose kept items `plugins:replace-kept-items` accepts (the actions
 * with no consent dialog, R1-3). An external install decides its items in the
 * consent dialog, so the backend refuses an `external` id on this route.
 */
export const REPAIRABLE_FAMILIES: readonly LocalItemFamily[] = [
  'skills-sh',
  'plugin-enable',
  'plugin-agent',
];

/** True when kept items of `family` can be replaced from the repair prompt. */
export function isRepairableFamily(family: LocalItemFamily): boolean {
  return REPAIRABLE_FAMILIES.includes(family);
}

/** Replace segment label that names the family's source (design 3.4). */
export function familyReplaceLabel(family: LocalItemFamily): string {
  return family === 'skills-sh'
    ? 'Replace with skills.sh version'
    : 'Replace with plugin version';
}

/** What a "Review and replace…" button reviews, for its accessible name. */
export function familyName(family: LocalItemFamily): string {
  switch (family) {
    case 'external':
      return 'marketplace plugin files';
    case 'skills-sh':
      return 'skills.sh files';
    case 'plugin-enable':
      return 'plugin files';
    case 'plugin-agent':
      return 'plugin agents';
  }
}

/** Badge text for why an item was kept. */
export function keptReasonLabel(reason: KeptItemReason): string {
  switch (reason) {
    case 'unowned':
      return 'Not created by Ptah';
    case 'owned-edited':
      return 'Edited since Ptah wrote it';
    case 'unreadable':
      return 'Could not read file';
    case 'shadowed':
      return 'Shadowed';
    case 'changed-since-approval':
      return 'Kept: changed since approval';
  }
}

/** Confirm label of the repair prompt for `count` replacements. */
export function repairConfirmLabel(count: number): string {
  if (count === 0) return 'Close without replacing';
  return `Replace ${count} ${count === 1 ? 'file' : 'files'}`;
}

/**
 * Marketplace-local copy of C1 KeepReplaceControl (Assumption A-share: it
 * moves to `@ptah-extension/ui` at a third use; the wizard owns the first).
 *
 * A radiogroup of two `<button role="radio">` with a roving tab stop. Arrow
 * keys move and select; a forced-keep Replace is `aria-disabled`, skipped by
 * the arrows and ignored by click.
 */
@Component({
  selector: 'ptah-marketplace-keep-replace',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="radiogroup"
      class="inline-flex rounded-md border border-[var(--surface-border-strong)]"
      [attr.aria-label]="'Keep or replace ' + path()"
      [attr.aria-describedby]="describedBy()"
      (keydown)="onKeydown($event)"
    >
      <button
        #keepButton
        type="button"
        role="radio"
        data-testid="keep-segment"
        class="relative inline-flex h-[26px] items-center gap-1 rounded-l-[5px] px-2.5 text-xs font-semibold focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50"
        [class.text-base-content]="decision() !== 'keep'"
        [class.bg-base-content]="decision() === 'keep'"
        [class.text-base-100]="decision() === 'keep'"
        [attr.aria-checked]="decision() === 'keep'"
        [attr.aria-label]="keepLabel() + ' ' + path()"
        [tabindex]="keepTabIndex()"
        [disabled]="disabled()"
        (click)="choose('keep')"
      >
        @if (decision() === 'keep') {
          <lucide-angular
            [img]="CheckIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
        }
        {{ keepLabel() }}
      </button>
      <button
        #replaceButton
        type="button"
        role="radio"
        data-testid="replace-segment"
        class="relative inline-flex h-[26px] items-center gap-1 rounded-r-[5px] border-l border-[var(--surface-border-strong)] px-2.5 text-xs font-semibold focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-[.55]"
        [class.text-base-content]="decision() !== 'replace'"
        [class.bg-warning]="decision() === 'replace'"
        [class.text-warning-content]="decision() === 'replace'"
        [attr.aria-checked]="decision() === 'replace'"
        [attr.aria-disabled]="forcedKeep() ? 'true' : null"
        [attr.aria-label]="replaceAria()"
        [tabindex]="keepTabIndex() === 0 ? -1 : 0"
        [disabled]="disabled()"
        (click)="choose('replace')"
      >
        @if (decision() === 'replace') {
          <lucide-angular
            [img]="CheckIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
        }
        {{ replaceLabel() }}
      </button>
    </div>
  `,
})
export class MarketplaceKeepReplaceComponent {
  /** Path shown to the user; part of every accessible name. */
  public readonly path = input.required<string>();
  public readonly keepLabel = input(KEEP_FILE_LABEL);
  public readonly replaceLabel = input.required<string>();
  public readonly decision = input<FileDecision>('keep');
  /** Unreadable item: Replace is not available. */
  public readonly forcedKeep = input(false);
  public readonly disabled = input(false);
  /** Id of the note that explains a forced Keep. */
  public readonly describedBy = input<string | null>(null);

  public readonly decisionChange = output<FileDecision>();

  protected readonly CheckIcon = Check;

  protected readonly replaceAria = computed(() => {
    const base = `${this.replaceLabel()}: ${this.path()}`;
    return this.forcedKeep()
      ? `${base} (not available: file could not be read)`
      : base;
  });

  /** Roving tab stop: Keep unless a controllable Replace is checked. */
  protected readonly keepTabIndex = computed(() =>
    this.decision() === 'replace' && !this.forcedKeep() ? -1 : 0,
  );

  private readonly keepButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('keepButton');
  private readonly replaceButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('replaceButton');

  protected choose(decision: FileDecision): void {
    if (this.disabled()) return;
    if (decision === 'replace' && this.forcedKeep()) return;
    if (decision === this.decision()) return;
    this.decisionChange.emit(decision);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const next: FileDecision =
          this.decision() === 'keep' ? 'replace' : 'keep';
        if (next === 'replace' && this.forcedKeep()) return;
        this.choose(next);
        this.buttonFor(next).focus();
        return;
      }
      case ' ':
      case 'Enter': {
        const target = event.target;
        if (target === this.keepButton().nativeElement) {
          event.preventDefault();
          this.choose('keep');
        } else if (target === this.replaceButton().nativeElement) {
          event.preventDefault();
          this.choose('replace');
        }
        return;
      }
      default:
        return;
    }
  }

  private buttonFor(decision: FileDecision): HTMLButtonElement {
    return decision === 'keep'
      ? this.keepButton().nativeElement
      : this.replaceButton().nativeElement;
  }
}

/**
 * Modal keyboard contract shared by the consent dialog and this prompt:
 * focus the first tab stop on open, wrap Tab / Shift+Tab inside the box, and
 * give focus back to the opener on close.
 */
export class ModalFocusTrap {
  private opener: HTMLElement | null =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  public constructor(
    private readonly box: () => HTMLElement | undefined,
    destroyRef: DestroyRef,
  ) {
    afterNextRender(() => this.focusFirst());
    destroyRef.onDestroy(() => {
      const target = this.opener;
      this.opener = null;
      if (target?.isConnected) target.focus();
    });
  }

  /** Wraps Tab inside the box. Returns nothing; non-Tab keys are ignored. */
  public onTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const stops = this.focusable();
    if (stops.length === 0) {
      event.preventDefault();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    const inside = stops.some((stop) => stop === active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLButtonElement[] {
    const host = this.box();
    if (!host) return [];
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => button.tabIndex !== -1 && !button.closest('[hidden]'));
  }

  private focusFirst(): void {
    const first = this.focusable()[0];
    if (first) first.focus();
    else this.box()?.focus();
  }
}

/** One row of the repair result. */
interface RepairResultRow {
  readonly approvalId: string;
  readonly relPath: string;
  readonly outcome: string;
  readonly failed: boolean;
}

/**
 * KeptItemsRepairPromptComponent (design 3.4, R1-3): "Review and replace…"
 * for the kept items of ONE installer family.
 *
 * The prompt is bound to the family that opened it: rows are the kept items
 * of that family only, and the Replace label names that family's source.
 * Every choice starts at Keep; an unreadable item is forced Keep. Confirm
 * calls `plugins:replace-kept-items` with a decision per shown item, then
 * shows each item as replaced or kept with its reason. At zero replacements
 * the confirm closes without a call.
 */
@Component({
  selector: 'ptah-kept-items-repair-prompt',
  standalone: true,
  imports: [MarketplaceKeepReplaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      class="modal modal-open"
      data-testid="kept-items-repair"
      aria-modal="true"
      aria-labelledby="kept-items-repair-title"
      [attr.data-family]="family()"
      (keydown)="onKeydown($event)"
    >
      <div
        #box
        class="modal-box max-w-2xl"
        tabindex="-1"
        [attr.aria-busy]="busy() ? 'true' : null"
      >
        <h3
          id="kept-items-repair-title"
          class="text-sm font-semibold text-base-content"
        >
          Replace kept files?
        </h3>
        <p class="text-[11px] text-base-content-muted mt-0.5 mb-3">
          Nothing is replaced until you confirm. Choices start at Keep.
        </p>

        <div class="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
          @if (result(); as done) {
            <ul class="space-y-1" data-testid="kept-items-repair-result">
              @for (row of resultRows(); track row.approvalId) {
                <li
                  class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-200/40 p-2"
                >
                  <code
                    class="grow text-[11px] font-mono [overflow-wrap:anywhere]"
                    >{{ row.relPath }}</code
                  >
                  <span
                    class="badge badge-sm shrink-0"
                    [class.badge-success]="
                      !row.failed && row.outcome === 'Replaced'
                    "
                    [class.badge-error]="row.failed"
                    [class.badge-ghost]="
                      !row.failed && row.outcome !== 'Replaced'
                    "
                    >{{ row.outcome }}</span
                  >
                </li>
              }
            </ul>
            @if (showLibraryNotice() && done.libraryPass === 'failed') {
              <div
                class="alert alert-warning block text-xs"
                role="status"
                data-testid="library-stale-notice"
              >
                The Library may be out of date until its next refresh. The files
                were replaced.
              </div>
            }
          } @else {
            @if (controllableCount() > 0) {
              <div
                class="flex items-center gap-2 rounded-lg border border-base-300 bg-base-200/40 p-2"
                role="group"
                aria-label="Apply to all kept files"
              >
                <span class="grow text-[11px] font-semibold text-base-content">
                  {{ controllableCount() }}
                  {{ controllableCount() === 1 ? 'file can' : 'files can' }} be
                  replaced
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  [disabled]="busy()"
                  (click)="setAll('keep')"
                >
                  Keep all
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  [disabled]="busy()"
                  (click)="setAll('replace')"
                >
                  Replace all
                </button>
              </div>
            }
            <ul class="space-y-1.5">
              @for (item of familyItems(); track item.approvalId) {
                <li
                  class="rounded-lg border border-base-300 bg-base-200/40 p-2 space-y-1.5"
                  data-testid="kept-item-row"
                  [attr.data-path]="item.relPath"
                >
                  <div class="flex items-start gap-2">
                    <code
                      class="grow text-[11px] font-mono [overflow-wrap:anywhere]"
                      >{{ item.relPath }}</code
                    >
                    <span class="badge badge-sm badge-ghost shrink-0">{{
                      reasonLabel(item.reason)
                    }}</span>
                  </div>
                  @if (isForced(item)) {
                    <p
                      class="text-[11px] text-base-content-muted"
                      [id]="noteId(item)"
                    >
                      {{ unreadableNote }}
                    </p>
                  }
                  <ptah-marketplace-keep-replace
                    [path]="item.relPath"
                    [replaceLabel]="replaceLabel()"
                    [decision]="decisionOf(item)"
                    [forcedKeep]="isForced(item)"
                    [disabled]="busy()"
                    [describedBy]="isForced(item) ? noteId(item) : null"
                    (decisionChange)="setDecision(item, $event)"
                  />
                </li>
              }
            </ul>
          }

          @if (errorMessage(); as message) {
            <div class="alert alert-error py-1 px-2 block" role="alert">
              <span class="text-xs">
                Could not replace the files: {{ message }} Check the files
                above, then press Replace again to retry.
              </span>
            </div>
          }
        </div>

        <div class="modal-action mt-3">
          @if (result()) {
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="kept-items-repair-done"
              (click)="closed.emit()"
            >
              Done
            </button>
          } @else {
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              [disabled]="busy()"
              (click)="closed.emit()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="kept-items-repair-confirm"
              [disabled]="busy()"
              (click)="confirm()"
            >
              @if (busy()) {
                <span class="loading loading-spinner loading-xs"></span>
                Replacing…
              } @else {
                {{ confirmText() }}
              }
            </button>
          }
        </div>
      </div>
    </dialog>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class KeptItemsRepairPromptComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);
  private destroyed = false;

  /** The installer family whose "Review and replace…" opened the prompt. */
  public readonly family = input.required<LocalItemFamily>();
  /** Kept items from that action's report; other families are ignored. */
  public readonly items = input.required<readonly KeptItem[]>();
  /** C10 is Electron only; the parent decides. */
  public readonly showLibraryNotice = input(false);

  /** The replace call answered; the parent updates its kept list. */
  public readonly replaced = output<PluginsReplaceKeptItemsResult>();
  /** Closed by Cancel, Escape, "Close without replacing" or Done. */
  public readonly closed = output<void>();

  protected readonly unreadableNote = UNREADABLE_KEPT_NOTE;

  /** Rows of the opening family only (R1-3). */
  public readonly familyItems = computed(() =>
    this.items().filter((item) => item.family === this.family()),
  );

  /** Explicit choices; reset to Keep whenever the rows change. */
  private readonly decisions = linkedSignal<
    readonly KeptItem[],
    Readonly<Record<string, FileDecision>>
  >({
    source: this.familyItems,
    computation: () => ({}),
  });

  public readonly busy = signal(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly result = signal<PluginsReplaceKeptItemsResult | null>(null);

  protected readonly replaceLabel = computed(() =>
    familyReplaceLabel(this.family()),
  );

  protected readonly controllableCount = computed(
    () => this.familyItems().filter((item) => !this.isForced(item)).length,
  );

  public readonly replaceCount = computed(
    () =>
      this.familyItems().filter((item) => this.decisionOf(item) === 'replace')
        .length,
  );

  protected readonly confirmText = computed(() =>
    repairConfirmLabel(this.replaceCount()),
  );

  protected readonly resultRows = computed<RepairResultRow[]>(() => {
    const done = this.result();
    if (done === null) return [];
    return [
      ...done.replaced.map((item) => ({
        approvalId: item.approvalId,
        relPath: item.relPath,
        outcome: 'Replaced',
        failed: false,
      })),
      ...done.kept.map((item) => ({
        approvalId: item.approvalId,
        relPath: item.relPath,
        outcome:
          item.error !== undefined
            ? 'Kept: could not replace'
            : keptReasonLabel(item.reason),
        failed: item.error !== undefined,
      })),
    ];
  });

  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly trap = new ModalFocusTrap(
    () => this.box()?.nativeElement,
    this.destroyRef,
  );

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  protected reasonLabel(reason: KeptItemReason): string {
    return keptReasonLabel(reason);
  }

  protected noteId(item: KeptItem): string {
    return `kept-note-${item.approvalId}`;
  }

  public isForced(item: KeptItem): boolean {
    return item.reason === 'unreadable';
  }

  public decisionOf(item: KeptItem): FileDecision {
    if (this.isForced(item)) return 'keep';
    return this.decisions()[item.approvalId] ?? 'keep';
  }

  public setDecision(item: KeptItem, decision: FileDecision): void {
    if (this.isForced(item) || this.busy()) return;
    this.decisions.update((prev) => ({ ...prev, [item.approvalId]: decision }));
  }

  /** C4: sets every controllable row; forced-keep rows never change. */
  public setAll(decision: FileDecision): void {
    if (this.busy()) return;
    const next: Record<string, FileDecision> = {};
    for (const item of this.familyItems()) {
      if (!this.isForced(item)) next[item.approvalId] = decision;
    }
    this.decisions.set(next);
  }

  /** Replace the chosen items, or close when none is chosen. */
  public async confirm(): Promise<void> {
    if (this.busy()) return;
    if (this.replaceCount() === 0) {
      this.closed.emit();
      return;
    }
    const decisions: Record<string, FileDecision> = {};
    for (const item of this.familyItems()) {
      decisions[item.approvalId] = this.decisionOf(item);
    }
    this.busy.set(true);
    this.errorMessage.set(null);
    try {
      const response = await this.rpc.call(
        'plugins:replace-kept-items',
        { decisions },
        { timeout: MARKETPLACE_RPC_TIMEOUTS.PLUGIN_INSTALL_MS },
      );
      if (this.destroyed) return;
      if (!response.isSuccess()) {
        this.errorMessage.set(
          response.error ?? 'the replace request did not complete.',
        );
        return;
      }
      this.result.set(response.data);
      this.replaced.emit(response.data);
    } catch {
      // A thrown transport error carries no user-facing text; fixed copy only.
      if (this.destroyed) return;
      this.errorMessage.set('the replace request did not complete.');
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.busy()) this.closed.emit();
      return;
    }
    this.trap.onTab(event);
  }
}
