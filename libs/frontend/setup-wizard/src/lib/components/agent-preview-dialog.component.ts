import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  FileDecision,
  GenerationPreviewAgent,
  GenerationPreviewFile,
  GenerationTargetChoice,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { BulkDecisionBarComponent } from './preview-decisions/bulk-decision-bar.component';
import { FileDecisionRowComponent } from './preview-decisions/file-decision-row.component';
import { ModelOriginNoteComponent } from './preview-decisions/model-origin-note.component';
import {
  confirmLabel,
  decisionCounts,
  summaryText,
  targetFolder,
  type DecisionRow,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';
import { TargetRootChoiceComponent } from './preview-decisions/target-root-choice.component';

/** One keep/replace choice the dialog reports to its owner. */
export interface PreviewRowDecision {
  readonly id: string;
  readonly decision: FileDecision;
}

/** What the dialog renders for one selected agent. */
interface AgentBlock {
  readonly agent: GenerationPreviewAgent;
  /** The Claude source-file row with its keep/replace control, if any. */
  readonly row: DecisionRow | null;
  /** Certainty of the source file, shown before the row. */
  readonly certainty: string | null;
  /** Files listed as information only (rival CLIs, conditional copies). */
  readonly infoFiles: readonly GenerationPreviewFile[];
}

let nextDialogId = 0;

/**
 * Generation sidebar preview dialog (TASK_2026_701_9e4b F3).
 *
 * Presentational: the owner (`agent-selection-list`) holds the preview and the
 * shared decision snapshot and reacts to `decisionChange`, `applyAll`,
 * `targetChange` and `confirm`. Every existing-file row starts on Keep (R1-4).
 */
@Component({
  selector: 'ptah-agent-preview-dialog',
  standalone: true,
  imports: [
    BulkDecisionBarComponent,
    FileDecisionRowComponent,
    ModelOriginNoteComponent,
    TargetRootChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <!-- Top layer (showModal): no app-shell stacking context or containing
           block can cover or clip it (the Electron glass header is z-30). -->
      <dialog
        #dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        aria-describedby="preview-description"
        tabindex="-1"
        class="fixed inset-0 m-0 grid h-full max-h-none w-full max-w-none place-items-center border-0 bg-neutral/60 p-3 text-base-content backdrop:bg-transparent"
        (keydown)="onKeydown($event)"
        (cancel)="onCancel($event)"
      >
        <section
          class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col rounded-xl border border-base-300 bg-base-100 p-4 shadow-xl"
        >
          <h2 id="preview-title" class="shrink-0 text-lg font-bold">
            Review generation targets
          </h2>
          <p
            id="preview-description"
            class="shrink-0 text-sm text-base-content-muted"
          >
            Definite targets will hold generated content. Conditional targets
            depend on the stated condition.
          </p>
          <!-- Only the body scrolls; the title and the actions stay visible. -->
          <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            @if (model() && model() !== 'unknown') {
              <p
                class="flex flex-wrap items-baseline gap-x-1 text-sm"
                data-testid="writing-model"
              >
                Writing model: <strong>{{ model() }}</strong>
                <span class="text-base-content-muted"
                  >(writes the content)</span
                >
              </p>
            }
            @if (preview()?.target; as info) {
              <p
                class="mt-2 flex flex-wrap items-center gap-1.5 text-xs"
                data-testid="target-line"
              >
                <span>Target:</span>
                <code class="font-mono [overflow-wrap:anywhere]">{{
                  targetPath()
                }}</code>
                <span class="text-base-content-muted">{{
                  targetSuffix()
                }}</span>
                @if (!info.openedIsHarnessRoot) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    data-testid="target-change"
                    [attr.aria-expanded]="changeOpen()"
                    [attr.aria-controls]="changePanelId"
                    (click)="changeOpen.set(!changeOpen())"
                  >
                    Change
                  </button>
                }
              </p>
              @if (!info.openedIsHarnessRoot) {
                <div
                  [id]="changePanelId"
                  [hidden]="!changeOpen()"
                  data-testid="target-change-panel"
                >
                  <ptah-target-root-choice
                    [target]="info"
                    [selected]="selectedTarget()"
                    [isElectron]="isElectron()"
                    [reloading]="loading()"
                    (targetChange)="targetChange.emit($event)"
                  />
                </div>
              }
            }
            @if (snapshot()?.status; as status) {
              <p
                role="status"
                class="alert alert-info my-2 text-xs"
                data-testid="target-reset-status"
              >
                {{ status }}
              </p>
            }
            @if (changed()) {
              <p role="alert" class="alert alert-warning my-2">
                Targets changed. Review the new list and confirm again.
              </p>
            }
            @if (loading()) {
              <div aria-busy="true" class="my-2 space-y-1.5">
                <p role="status" class="text-xs text-base-content-muted">
                  Checking targets...
                </p>
                <div
                  class="h-2.5 w-3/5 rounded bg-base-300 motion-safe:animate-pulse"
                ></div>
                <div
                  class="h-2.5 w-5/6 rounded bg-base-300 motion-safe:animate-pulse"
                ></div>
              </div>
            }
            @if (error()) {
              <p role="alert" class="alert alert-warning my-2">
                @if (retryOnError()) { Preview failed. Retry the comparison to continue. }
                @else { Targets could not be checked. Review the agents folder after generation. }
              </p>
            }
            @if (!loading() && preview(); as current) {
              @if (current.warning) {
                <p role="alert" class="alert alert-warning my-2">
                  {{ current.warning }}
                </p>
              }
              <ptah-bulk-decision-bar
                [rows]="rows()"
                kind="wizard"
                (applyAll)="applyAll.emit($event)"
              />
              @for (block of blocks(); track block.agent.agentId) {
                <h3
                  class="mt-3 flex flex-wrap items-center gap-1.5 text-sm font-semibold"
                >
                  @if (block.certainty) {
                    <span class="badge badge-sm font-normal">{{
                      block.certainty
                    }}</span>
                  }
                  {{ block.agent.agentId }}
                </h3>
                @if (block.row; as row) {
                  <ptah-file-decision-row
                    [row]="row"
                    [isElectron]="isElectron()"
                    (decisionChange)="
                      decisionChange.emit({ id: row.id, decision: $event })
                    "
                  >
                    @if (block.agent.agentModel; as agentModel) {
                      <ptah-model-origin-note
                        [model]="agentModel"
                        [isElectron]="isElectron()"
                      />
                    }
                  </ptah-file-decision-row>
                }
                @if (block.infoFiles.length) {
                  <div
                    class="rounded-lg border border-dashed border-surface-border px-2.5 py-2 text-xs"
                    data-testid="info-only-targets"
                  >
                    @if (block.row) {
                      <p class="mb-1 text-[11px] text-base-content-muted">
                        Other CLIs (information only)
                      </p>
                    }
                    <ul class="space-y-1">
                      @for (
                        file of block.infoFiles;
                        track file.target + file.relPath
                      ) {
                        <li class="[overflow-wrap:anywhere]">
                          <span class="badge badge-sm">{{
                            file.certainty
                          }}</span>
                          <code class="font-mono">{{ file.relPath }}</code>
                          @if (file.condition) {
                            <span class="text-base-content-muted">
                              ({{ file.condition }})</span
                            >
                          }
                        </li>
                      }
                    </ul>
                  </div>
                }
              }
            }
          </div>
          <div
            class="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2"
          >
            @if (summary(); as text) {
              <span
                role="status"
                aria-live="polite"
                class="mr-auto text-xs text-base-content-muted max-sm:basis-full"
                data-testid="decision-summary"
                >{{ text }}</span
              >
            }
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="dismissed.emit()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm max-sm:basis-full"
              data-testid="preview-confirm"
              [disabled]="loading()"
              (click)="confirm.emit()"
            >
              {{ error() && retryOnError() ? 'Retry comparison' : confirmText() }}
            </button>
          </div>
        </section>
      </dialog>
    }
  `,
})
export class AgentPreviewDialogComponent {
  readonly open = input(false);
  readonly retryOnError = input(false);
  readonly loading = input(false);
  readonly changed = input(false);
  readonly error = input(false);
  readonly model = input<string | null>(null);
  readonly preview = input<WizardPreviewGenerationResponse | null>(null);
  /** Shared keep/replace state from `preview-decisions.state.ts`. */
  readonly snapshot = input<DecisionSnapshot | null>(null);
  /** Electron shows Library notes; VS Code has no Library (D3). */
  readonly isElectron = input(true);
  readonly dismissed = output<void>();
  readonly confirm = output<void>();
  readonly decisionChange = output<PreviewRowDecision>();
  readonly applyAll = output<FileDecision>();
  readonly targetChange = output<GenerationTargetChoice>();

  protected readonly changePanelId = `ptah-preview-target-${++nextDialogId}`;
  protected readonly changeOpen = signal(false);

  protected readonly rows = computed<readonly DecisionRow[]>(
    () => this.snapshot()?.rows ?? [],
  );
  protected readonly selectedTarget = computed<GenerationTargetChoice>(
    () =>
      this.snapshot()?.target ??
      this.preview()?.target?.chosen ??
      'harness-root',
  );
  protected readonly targetPath = computed(() => {
    const info = this.preview()?.target;
    if (!info) return '';
    return targetFolder(
      info,
      info.openedIsHarnessRoot ? 'harness-root' : this.selectedTarget(),
    );
  });
  protected readonly targetSuffix = computed(() => {
    const info = this.preview()?.target;
    return !info?.openedIsHarnessRoot &&
      this.selectedTarget() === 'opened-folder'
      ? '(opened folder only)'
      : '(project root)';
  });
  protected readonly blocks = computed<AgentBlock[]>(() => {
    const current = this.preview();
    if (!current) return [];
    const byId = new Map(this.rows().map((row) => [row.id, row] as const));
    // R1-5: rival rows only when they were worked out; the other two
    // states carry their own warning and list no rival rows.
    const rivalsListed =
      current.rivalStatus === undefined || current.rivalStatus === 'listed';
    return current.agents.map((agent) => {
      const row = byId.get(agent.agentId) ?? null;
      const source = row
        ? agent.files.find(
            (file) =>
              file.target === 'claude' &&
              file.certainty === 'definite' &&
              file.relPath === row.path,
          )
        : undefined;
      const infoFiles = agent.files.filter(
        (file) => file !== source && (rivalsListed || file.target === 'claude'),
      );
      return {
        agent,
        row,
        certainty: source?.certainty ?? null,
        infoFiles,
      };
    });
  });
  protected readonly summary = computed(() => summaryText(this.rows()));
  protected readonly confirmText = computed(() =>
    confirmLabel('sidebar-dialog', decisionCounts(this.rows()).toReplace),
  );

  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        this.changeOpen.set(false);
        queueMicrotask(() => this.focusFirst());
      } else if (this.opener) {
        // Leave the top layer first: while the modal is open the rest of the
        // page is inert and the opener cannot take focus.
        untracked(this.dialog)?.nativeElement.close();
        this.opener.focus();
        this.opener = null;
      }
    });
    // Promote the rendered <dialog> to the top layer, then apply the
    // dialog's own first-focus rule (showModal picks its own target).
    effect(() => {
      const element = this.dialog()?.nativeElement;
      if (!element || element.open) return;
      element.showModal();
      this.focusFirst();
    });
    // A target change disables the target buttons while the comparison
    // reloads, which drops focus to <body>. Put it back inside the dialog so
    // the trap keeps working once the new list arrives.
    effect(() => {
      if (this.loading() || !untracked(this.open)) return;
      queueMicrotask(() => {
        const host = this.dialog()?.nativeElement;
        if (!host || host.contains(document.activeElement)) return;
        const checked = host.querySelector<HTMLButtonElement>(
          '[role="radio"][aria-checked="true"]:not(:disabled)',
        );
        if (checked && this.isReachable(checked)) checked.focus();
        else this.focusFirst();
      });
    });
  }

  /**
   * Escape with focus on the <dialog> itself reaches the native `cancel`
   * request. The owner closes the dialog through `open`, so only report it.
   */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.dismissed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismissed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = this.focusable();
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    const inside = buttons.some((button) => button === active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Tab stops inside the dialog: enabled buttons that are not roving
   * `tabindex=-1` radios and not inside a collapsed (`hidden`) region.
   */
  private focusable(): HTMLButtonElement[] {
    const host = this.dialog()?.nativeElement;
    if (!host) return [];
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter((button) => this.isReachable(button));
  }

  private isReachable(button: HTMLButtonElement): boolean {
    return button.tabIndex !== -1 && !button.closest('[hidden]');
  }

  private focusFirst(): void {
    const first = this.focusable()[0];
    if (first) first.focus();
    else this.dialog()?.nativeElement.focus();
  }
}
