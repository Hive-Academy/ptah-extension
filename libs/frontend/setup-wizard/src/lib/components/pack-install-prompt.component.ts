import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type {
  FileDecision,
  GenerationTargetChoice,
  GenerationTargetInfo,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { BulkDecisionBarComponent } from './preview-decisions/bulk-decision-bar.component';
import { FileDecisionRowComponent } from './preview-decisions/file-decision-row.component';
import {
  agentsFolder,
  confirmLabel,
  decisionCounts,
  decisionEntries,
  hasControl,
  nextSnapshot,
  setAllDecisions,
  setDecision,
  summaryText,
  buildPackRows,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';
import { TargetRootChoiceComponent } from './preview-decisions/target-root-choice.component';

/** One pack install the user asked for, from any entry point. */
export interface PackInstallRequest {
  readonly source: string;
  readonly packName: string;
  /** Pack file names in scope: the whole pack or one file. */
  readonly files: readonly string[];
  readonly scope: 'pack' | 'file';
  /** Root to compare against first; null = the server default. */
  readonly target: GenerationTargetChoice | null;
}

/** Terminal per-file status a host shows after an install. */
export type PackFileStatus = 'installed' | 'kept' | 'failed';

/** Emitted when the user confirms and the install starts. */
export interface PackInstallStart {
  readonly source: string;
  readonly files: readonly string[];
}

/** Emitted when the install RPC settles. */
export interface PackInstallFinished {
  readonly source: string;
  readonly packName: string;
  readonly files: readonly string[];
  /** Roots of the plan; `chosen` is the root the install wrote to. */
  readonly target: GenerationTargetInfo;
  readonly statuses: Readonly<Record<string, PackFileStatus>>;
  /** Failure reason for failed files, or null. */
  readonly error: string | null;
  /** The install failed before any per-file outcome (download, validation). */
  readonly primaryFailure: boolean;
}

export const KEPT_PACK_NOTE =
  'Your file was not changed. Origin stays Workspace file.';
export const INSTALL_FAILED_FALLBACK = 'The install could not be completed.';

/**
 * Per-file status from an install result. `written`/`unchanged` are
 * installed; `kept` and `changed-since-preview` keep the user's file; a host
 * without per-file outcomes reports every file by the overall success.
 */
export function packFileStatuses(
  files: readonly string[],
  result: WizardInstallPackAgentsResult,
): Record<string, PackFileStatus> {
  const statuses: Record<string, PackFileStatus> = {};
  const outcomes = new Map(
    (result.files ?? []).map((entry) => [entry.file, entry.outcome] as const),
  );
  for (const file of files) {
    const outcome = outcomes.get(file);
    if (outcome === undefined) {
      statuses[file] = result.success && !result.files ? 'installed' : 'failed';
    } else if (outcome === 'written' || outcome === 'unchanged') {
      statuses[file] = 'installed';
    } else if (outcome === 'kept' || outcome === 'changed-since-preview') {
      statuses[file] = 'kept';
    } else {
      statuses[file] = 'failed';
    }
  }
  return statuses;
}

/** Installed / kept / failed counters for a results line. */
export function packResultCounts(
  statuses: Readonly<Record<string, PackFileStatus>>,
): Record<PackFileStatus, number> {
  const counts: Record<PackFileStatus, number> = {
    installed: 0,
    kept: 0,
    failed: 0,
  };
  for (const status of Object.values(statuses)) counts[status]++;
  return counts;
}

/** `<opened>/.claude/agents` relative to the project root when inside it. */
function openedAgentsRelative(info: GenerationTargetInfo): string {
  const root = info.harnessRoot.replace(/[\\/]+$/, '');
  const opened = info.openedFolder.replace(/[\\/]+$/, '');
  const folder = agentsFolder(opened);
  const inside =
    opened.length > root.length &&
    opened.toLowerCase().startsWith(root.toLowerCase()) &&
    /[\\/]/.test(opened.charAt(root.length));
  return inside ? folder.slice(root.length + 1).replace(/\\/g, '/') : folder;
}

/**
 * Opened-folder completion notice per host (design section 5), or null when
 * the install went to the project root.
 */
export function openedFolderNotice(
  info: GenerationTargetInfo,
  isElectron: boolean,
): string | null {
  if (info.chosen !== 'opened-folder' || info.openedIsHarnessRoot) return null;
  const where = `These agents are in ${openedAgentsRelative(info)}.`;
  return isElectron
    ? `${where} They will not reach other CLIs and will not appear in the Library.`
    : `${where} They will not reach other CLIs.`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

let nextPromptId = 0;

/**
 * Community-pack install prompt (TASK_2026_701_9e4b F4, design-spec 3.2).
 *
 * One prompt for every pack entry point (Install All, Choose location,
 * per-file Install and Retry, in the wizard and the sidebar). Setting
 * `request` plans the install (`wizard:plan-pack-install`, read-only) and
 * opens the prompt with the target choice, which shows even when no file
 * differs. A target change re-plans and resets every choice to Keep. Confirm
 * closes the prompt, emits `installStarted`, installs with the plan token,
 * the Replace decisions and the target, and emits `installFinished`. Nothing
 * is written before Confirm; an unreadable file is forced Keep.
 */
@Component({
  selector: 'ptah-pack-install-prompt',
  standalone: true,
  imports: [
    NativeModalComponent,
    BulkDecisionBarComponent,
    FileDecisionRowComponent,
    TargetRootChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Rendered only while open: hosts keep the prompt mounted so an
         install that outlives the closed prompt still reports its result. -->
    @if (open()) {
      <ptah-native-modal
        [isOpen]="open()"
        [ariaLabelledby]="titleId"
        size="lg"
        (closed)="dismiss()"
      >
        <h3 modal-header class="mb-1 text-sm font-semibold" [id]="titleId">
          {{ title() }}
        </h3>
        <p class="text-xs text-base-content-muted" data-testid="pack-scope">
          Nothing is written until you confirm. {{ scopeLine() }}
        </p>
        @if (plan(); as current) {
          <ptah-target-root-choice
            [target]="current.target"
            [selected]="selectedTarget()"
            [isElectron]="isElectron()"
            [reloading]="loading()"
            (targetChange)="changeTarget($event)"
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
              Comparing pack files with the chosen folder...
            </p>
            <div
              class="h-2.5 w-3/5 rounded bg-base-300 motion-safe:animate-pulse"
            ></div>
            <div
              class="h-2.5 w-5/6 rounded bg-base-300 motion-safe:animate-pulse"
            ></div>
          </div>
        }
        @if (planError()) {
          <div role="alert" class="alert alert-error my-2 py-2 text-xs">
            <span
              >Could not compare the pack files with the folder. Check your
              connection and try again.</span
            >
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              data-testid="plan-retry"
              (click)="retryPlan()"
            >
              Try again
            </button>
          </div>
        }
        @if (!loading() && snapshot(); as current) {
          @if (conflictCount() > 0) {
            <p class="mb-2 text-xs" data-testid="pack-conflicts">
              {{ conflictLine() }}
            </p>
            @if (request()?.scope === 'pack') {
              <ptah-bulk-decision-bar
                [rows]="current.rows"
                kind="pack"
                (applyAll)="applyAll($event)"
              />
            }
            @for (row of current.rows; track row.id) {
              @if (hasControl(row)) {
                <ptah-file-decision-row
                  [row]="row"
                  [isElectron]="isElectron()"
                  (decisionChange)="decide(row.id, $event)"
                />
              }
            }
            @if (otherLine(); as text) {
              <p class="text-xs text-base-content-muted">{{ text }}</p>
            }
          } @else {
            <p class="text-xs" data-testid="pack-no-conflict">
              {{ noConflictLine() }}
            </p>
          }
        }
        <div
          modal-footer
          class="mt-4 flex flex-wrap items-center justify-end gap-2"
        >
          @if (!loading() && conflictCount() > 0 && summary(); as text) {
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
            (click)="dismiss()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm max-sm:basis-full"
            data-testid="pack-confirm"
            [disabled]="loading() || planError() || !plan()"
            (click)="confirmInstall()"
          >
            {{ confirmText() }}
          </button>
        </div>
      </ptah-native-modal>
    }
  `,
})
export class PackInstallPromptComponent {
  private readonly rpc = inject(WizardRpcService);

  /** The install to prompt for; null closes the prompt. */
  readonly request = input<PackInstallRequest | null>(null);
  /** Electron shows Library copy; VS Code has no Library (D3). */
  readonly isElectron = input(true);

  /** Cancel, Escape or backdrop: the host clears `request`. */
  readonly dismissed = output<void>();
  readonly installStarted = output<PackInstallStart>();
  readonly installFinished = output<PackInstallFinished>();

  protected readonly titleId = `ptah-pack-prompt-title-${++nextPromptId}`;
  protected readonly hasControl = hasControl;

  protected readonly plan = signal<WizardPlanPackInstallResult | null>(null);
  protected readonly snapshot = signal<DecisionSnapshot | null>(null);
  protected readonly loading = signal(false);
  protected readonly planError = signal(false);
  /** Confirmed: the prompt closes while the install runs. */
  private readonly submitted = signal(false);
  private sequence = 0;

  protected readonly open = computed(
    () => this.request() !== null && !this.submitted(),
  );
  protected readonly selectedTarget = computed<GenerationTargetChoice>(
    () =>
      this.snapshot()?.target ??
      this.plan()?.target.chosen ??
      this.request()?.target ??
      'harness-root',
  );
  protected readonly title = computed(() => {
    const request = this.request();
    if (!request) return '';
    return request.scope === 'file'
      ? `Install ${request.files[0] ?? ''} from "${request.packName}"?`
      : `Install community pack "${request.packName}"?`;
  });
  protected readonly scopeLine = computed(() => {
    const request = this.request();
    if (!request) return '';
    if (request.scope === 'file') return 'Scope: this one file only.';
    const count = request.files.length;
    return `Scope: ${plural(count, 'the 1 pack file', `all ${count} pack files`)} that ${plural(count, 'is', 'are')} not installed yet.`;
  });
  private readonly counts = computed(() => {
    const rows = this.snapshot()?.rows ?? [];
    return {
      conflicts: rows.filter(hasControl).length,
      fresh: rows.filter((row) => row.state === 'new').length,
      identical: rows.filter((row) => row.state === 'identical').length,
    };
  });
  protected readonly conflictCount = computed(() => this.counts().conflicts);
  protected readonly conflictLine = computed(() => {
    const { conflicts } = this.counts();
    if (this.request()?.scope === 'file') {
      return 'This file exists in this folder and differs from the pack version. Your file is kept unless you choose to replace it.';
    }
    return `${conflicts} existing ${plural(conflicts, 'file differs', 'files differ')} from the pack version in this folder.`;
  });
  protected readonly otherLine = computed<string | null>(() => {
    const { fresh, identical } = this.counts();
    const parts: string[] = [];
    if (fresh > 0) {
      parts.push(
        `${fresh} other ${plural(fresh, 'file is', 'files are')} new and install${plural(fresh, 's', '')} without a question.`,
      );
    }
    if (identical > 0) {
      parts.push(
        `${identical} other ${plural(identical, 'file is', 'files are')} already current.`,
      );
    }
    return parts.length ? parts.join(' ') : null;
  });
  protected readonly noConflictLine = computed(() => {
    const { fresh, identical } = this.counts();
    const request = this.request();
    if (request?.scope === 'file') {
      const file = request.files[0] ?? '';
      return identical > 0
        ? `${file} is already current in this folder.`
        : `${file} is new in this folder and installs into the folder above.`;
    }
    if (identical === 0) {
      return `No file differs. All ${fresh} pack ${plural(fresh, 'file is', 'files are')} new and install into the folder above.`;
    }
    return `No file differs. ${fresh} new ${plural(fresh, 'file installs', 'files install')} into the folder above; ${identical} ${plural(identical, 'is', 'are')} already current.`;
  });
  protected readonly summary = computed(() =>
    summaryText(this.snapshot()?.rows ?? []),
  );
  protected readonly confirmText = computed(() =>
    confirmLabel('pack', decisionCounts(this.snapshot()?.rows ?? []).toReplace),
  );

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => this.reset(request));
    });
  }

  protected dismiss(): void {
    if (!this.open()) return;
    // Drop any plan reply still in flight.
    this.sequence++;
    this.loading.set(false);
    this.dismissed.emit();
  }

  protected decide(id: string, decision: FileDecision): void {
    if (this.loading()) return;
    this.snapshot.update((current) =>
      current ? setDecision(current, id, decision) : current,
    );
  }

  protected applyAll(decision: FileDecision): void {
    if (this.loading()) return;
    this.snapshot.update((current) =>
      current ? setAllDecisions(current, decision) : current,
    );
  }

  /** Another root re-plans; every choice resets to Keep. */
  protected async changeTarget(choice: GenerationTargetChoice): Promise<void> {
    const request = this.request();
    if (!request || this.loading() || choice === this.selectedTarget()) return;
    await this.load(request, choice);
  }

  protected async retryPlan(): Promise<void> {
    const request = this.request();
    if (!request || this.loading()) return;
    await this.load(request, this.snapshot()?.target ?? request.target);
  }

  protected async confirmInstall(): Promise<void> {
    const request = this.request();
    const plan = this.plan();
    const snapshot = this.snapshot();
    if (
      !request ||
      !plan ||
      !snapshot ||
      this.loading() ||
      this.planError() ||
      this.submitted()
    )
      return;
    this.submitted.set(true);
    const files = [...request.files];
    const target = plan.target;
    this.installStarted.emit({ source: request.source, files });
    let result: WizardInstallPackAgentsResult;
    try {
      result = await this.rpc.installPackAgents(request.source, files, {
        planToken: plan.planToken,
        decisions: decisionEntries(snapshot.rows),
        target: target.chosen,
      });
    } catch (error: unknown) {
      // degradation-audit: reported - a transport failure becomes a failed
      // result that every host shows per file with Retry.
      result = {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: error instanceof Error ? error.message : INSTALL_FAILED_FALLBACK,
      };
    }
    this.installFinished.emit({
      source: request.source,
      packName: request.packName,
      files,
      target,
      statuses: packFileStatuses(files, result),
      error: result.success ? null : (result.error ?? INSTALL_FAILED_FALLBACK),
      primaryFailure: !result.success && !result.files?.length,
    });
  }

  private reset(request: PackInstallRequest | null): void {
    this.sequence++;
    this.submitted.set(false);
    this.plan.set(null);
    this.snapshot.set(null);
    this.planError.set(false);
    this.loading.set(false);
    if (request) void this.load(request, request.target);
  }

  private async load(
    request: PackInstallRequest,
    target: GenerationTargetChoice | null,
  ): Promise<void> {
    const sequence = ++this.sequence;
    const previous = this.snapshot();
    this.loading.set(true);
    this.planError.set(false);
    try {
      const plan = await this.rpc.planPackInstall(
        request.source,
        [...request.files],
        target ?? undefined,
      );
      if (sequence !== this.sequence) return;
      this.plan.set(plan);
      this.snapshot.set(
        nextSnapshot(previous, buildPackRows(plan), plan.target.chosen),
      );
    } catch {
      // degradation-audit: reported - the failure is shown via planError with
      // "Try again"; the early return only drops a superseded reply.
      if (sequence !== this.sequence) return;
      this.planError.set(true);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }
}
