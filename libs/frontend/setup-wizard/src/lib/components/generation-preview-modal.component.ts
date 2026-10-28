import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
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
import { NativeModalComponent } from '@ptah-extension/ui';
import type { PreviewRowDecision } from './agent-preview-dialog.component';
import { BulkDecisionBarComponent } from './preview-decisions/bulk-decision-bar.component';
import { FileDecisionRowComponent } from './preview-decisions/file-decision-row.component';
import { ModelOriginNoteComponent } from './preview-decisions/model-origin-note.component';
import {
  confirmLabel,
  decisionCounts,
  summaryText,
  type DecisionRow,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';
import { TargetRootChoiceComponent } from './preview-decisions/target-root-choice.component';

/** What the modal renders for one selected agent. */
interface AgentBlock {
  readonly agent: GenerationPreviewAgent;
  /** The Claude source-file row with its keep/replace control, if any. */
  readonly row: DecisionRow | null;
  /** Definite files listed as information only (rival CLIs). */
  readonly definiteInfo: readonly GenerationPreviewFile[];
  /** Conditional files, listed with their condition. */
  readonly conditionalInfo: readonly GenerationPreviewFile[];
}

/**
 * Wizard-view preview modal "Preview agent generation"
 * (TASK_2026_701_9e4b F2, design-spec 3.1).
 *
 * Presentational: `AgentSelectionComponent` owns the preview, the shared
 * decision snapshot and the submit, and reacts to `decisionChange`,
 * `applyAll`, `targetChange`, `confirm` and `dismissed`. Every existing file
 * starts on Keep; rival-CLI files are information only and never carry a
 * control (C12). The native modal supplies the focus trap, Escape and focus
 * restore.
 */
@Component({
  selector: 'ptah-generation-preview-modal',
  standalone: true,
  imports: [
    NativeModalComponent,
    BulkDecisionBarComponent,
    FileDecisionRowComponent,
    ModelOriginNoteComponent,
    TargetRootChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Warning copy in this modal uses a solid warning fill with
         warning-content text (5.67:1 light, 6.61:1 dark): bare text-warning
         on base-100 is 2.46:1 in the light theme. -->
    <ptah-native-modal
      [isOpen]="open()"
      ariaLabel="Preview agent generation"
      size="lg"
      (closed)="dismissed.emit()"
    >
      <h3 modal-header class="mb-1 text-sm font-semibold">
        Preview agent generation
      </h3>
      <div #body>
        <p class="text-xs text-base-content-muted">
          Nothing is written until you confirm.
        </p>
        @if (preview()?.target; as info) {
          <ptah-target-root-choice
            [target]="info"
            [selected]="selectedTarget()"
            [isElectron]="isElectron()"
            [reloading]="loading()"
            (targetChange)="targetChange.emit($event)"
          />
        }
        @if (snapshot()?.status; as status) {
          <p
            role="status"
            class="alert alert-info my-2 py-1.5 text-xs"
            data-testid="target-reset-status"
          >
            {{ status }}
          </p>
        }
        @if (loading()) {
          <div aria-busy="true" class="my-2 space-y-1.5">
            <p role="status" class="text-xs text-base-content-muted">
              Checking generation targets...
            </p>
            <div
              class="h-2.5 w-3/5 rounded bg-base-300 motion-safe:animate-pulse"
            ></div>
            <div
              class="h-2.5 w-5/6 rounded bg-base-300 motion-safe:animate-pulse"
            ></div>
          </div>
        }
        @if (changed()) {
          <p
            role="alert"
            class="mb-2 rounded bg-warning px-2 py-1 text-xs text-warning-content"
          >
            Targets changed since preview. Review the new list and confirm
            again.
          </p>
        }
        @if (error()) {
          <p
            role="alert"
            class="mb-2 rounded bg-warning px-2 py-1 text-xs text-warning-content"
          >
            Preview unavailable. You can still generate without a preview. Files
            that already exist and differ will be kept; only missing files are
            created.
          </p>
        }
        @if (!loading() && preview(); as current) {
          @if (warning(); as text) {
            <p
              role="alert"
              class="mb-2 rounded bg-warning px-2 py-1 text-xs text-warning-content"
              data-testid="preview-warning"
            >
              {{ text }}
            </p>
          }
          <ptah-bulk-decision-bar
            [rows]="rows()"
            kind="wizard"
            [disabled]="generating()"
            (applyAll)="applyAll.emit($event)"
          />
          @for (block of blocks(); track block.agent.agentId) {
            <section class="mb-3" [attr.data-agent]="block.agent.agentId">
              <h4 class="mb-1.5 text-xs font-medium">
                {{ block.agent.agentId }}
              </h4>
              @if (block.row; as row) {
                <ptah-file-decision-row
                  [row]="row"
                  [isElectron]="isElectron()"
                  [disabled]="generating()"
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
              @if (block.definiteInfo.length || block.conditionalInfo.length) {
                <div
                  class="rounded-lg border border-dashed border-surface-border px-2.5 py-2 text-xs"
                  data-testid="info-only-targets"
                >
                  <p class="mb-1 text-[11px] text-base-content-muted">
                    Also copied for other CLIs (information only; not controlled
                    by Keep or Replace)
                  </p>
                  @if (block.definiteInfo.length) {
                    <ul class="space-y-1">
                      @for (
                        file of block.definiteInfo;
                        track file.target + file.relPath
                      ) {
                        <li class="[overflow-wrap:anywhere]">
                          <span class="badge badge-sm">definite</span>
                          <code class="font-mono">{{ file.relPath }}</code>
                        </li>
                      }
                    </ul>
                  }
                  @if (block.conditionalInfo.length) {
                    <ul class="mt-1 space-y-1" data-testid="conditional-files">
                      @for (
                        file of block.conditionalInfo;
                        track file.target + file.relPath
                      ) {
                        <li class="[overflow-wrap:anywhere]">
                          <p class="text-base-content-muted">
                            May also write, if {{ file.condition }}
                          </p>
                          <span class="badge badge-sm">conditional</span>
                          <code class="font-mono">{{ file.relPath }}</code>
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
            </section>
          }
        }
      </div>
      <div
        modal-footer
        class="mt-4 flex flex-wrap items-center justify-end gap-2"
      >
        @if (!error() && summary(); as text) {
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
          [disabled]="loading() || generating()"
          [attr.aria-busy]="loading()"
          (click)="confirm.emit()"
        >
          {{ confirmText() }}
        </button>
      </div>
    </ptah-native-modal>
  `,
})
export class GenerationPreviewModalComponent {
  readonly open = input(false);
  readonly loading = input(false);
  /** The confirm-time re-preview differs from what the user reviewed. */
  readonly changed = input(false);
  /** The preview failed; confirm becomes "Generate without preview". */
  readonly error = input(false);
  /** Generation is starting; decisions are frozen. */
  readonly generating = input(false);
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

  protected readonly rows = computed<readonly DecisionRow[]>(
    () => this.snapshot()?.rows ?? [],
  );
  protected readonly selectedTarget = computed<GenerationTargetChoice>(
    () =>
      this.snapshot()?.target ??
      this.preview()?.target?.chosen ??
      'harness-root',
  );
  /**
   * The backend warning. The opened-folder ("Other CLIs sync agents from a
   * different folder...") warning shows only for the opened-folder target
   * (R1-5); the harness-unavailable and CLI-detection warnings always show.
   */
  protected readonly warning = computed<string | null>(() => {
    const current = this.preview();
    if (!current?.warning) return null;
    if (
      current.rivalStatus === 'opened-folder-elsewhere' &&
      this.selectedTarget() !== 'opened-folder'
    )
      return null;
    return current.warning;
  });
  protected readonly blocks = computed<AgentBlock[]>(() => {
    const current = this.preview();
    if (!current) return [];
    const byId = new Map(this.rows().map((row) => [row.id, row] as const));
    // R1-5: rival rows only when they were worked out; the other states carry
    // their own warning and list no rival rows.
    const rivalsListed =
      current.rivalStatus === undefined || current.rivalStatus === 'listed';
    return current.agents.map((agent) => {
      const row = byId.get(agent.agentId) ?? null;
      const info = agent.files.filter(
        (file) =>
          !(row && file.target === 'claude' && file.relPath === row.path) &&
          (rivalsListed || file.target === 'claude'),
      );
      return {
        agent,
        row,
        definiteInfo: info.filter((file) => file.certainty === 'definite'),
        conditionalInfo: info.filter(
          (file) => file.certainty === 'conditional',
        ),
      };
    });
  });
  protected readonly summary = computed(() => summaryText(this.rows()));
  protected readonly confirmText = computed(() =>
    this.error()
      ? 'Generate without preview'
      : confirmLabel('wizard-modal', decisionCounts(this.rows()).toReplace),
  );

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  constructor() {
    // A target change disables the target buttons while the comparison
    // reloads, which drops focus out of the modal body. Put it back on the
    // checked target once the new list arrives so keyboard users keep their
    // place.
    effect(() => {
      if (this.loading() || !untracked(this.open)) return;
      queueMicrotask(() => {
        const host = this.body()?.nativeElement;
        const active = document.activeElement;
        if (!host || (active && active !== document.body)) return;
        host
          .querySelector<HTMLButtonElement>(
            '[role="radio"][aria-checked="true"]:not(:disabled)',
          )
          ?.focus();
      });
    });
  }
}
