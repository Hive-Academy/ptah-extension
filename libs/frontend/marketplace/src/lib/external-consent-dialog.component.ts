import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ShieldAlert,
  Terminal,
  FileWarning,
  Layers,
  X,
} from 'lucide-angular';
import type {
  ExternalConsentReason,
  ExternalInstallPlan,
  ExternalLocalItem,
  FileDecision,
} from '@ptah-extension/shared';
import {
  KEEP_FILE_LABEL,
  MarketplaceKeepReplaceComponent,
  ModalFocusTrap,
} from './kept-items-repair-prompt.component';

/** Badge, note and C1 labels of one local-item row (design 3.3). */
interface LocalItemCopy {
  readonly badge: string;
  readonly note: string | null;
  readonly keepLabel: string;
  readonly replaceLabel: string;
}

const PLUGIN_LABELS = {
  keepLabel: KEEP_FILE_LABEL,
  replaceLabel: 'Replace with plugin version',
} as const;

function localItemCopy(item: ExternalLocalItem): LocalItemCopy {
  switch (item.kind) {
    case 'unowned':
      return { ...PLUGIN_LABELS, badge: 'Not created by Ptah', note: null };
    case 'owned-edited':
      return {
        ...PLUGIN_LABELS,
        badge: 'Edited since Ptah wrote it',
        note:
          item.recordedVersion !== undefined
            ? `Ptah copied this on ${item.recordedVersion}. The file on disk has changed since.`
            : 'The file on disk has changed since Ptah wrote it.',
      };
    case 'unreadable':
      return {
        ...PLUGIN_LABELS,
        badge: 'Could not read file',
        note: 'Ptah could not compare this file, so it is treated as different and will be kept. Replace is not available for it.',
      };
    case 'library-clone':
      return {
        badge: 'Edited Library copy',
        note: 'If you replace, Ptah runs a Library rebase after install. Your edits stay in the rebase history. If you keep, the copy is marked "Diverged: plugin update".',
        keepLabel: 'Keep my copy',
        replaceLabel: 'Replace (rebase)',
      };
    case 'agent-source':
      return {
        ...PLUGIN_LABELS,
        badge: 'Workspace agent',
        note: "An agent in this workspace has the same name as the plugin's agent. If you keep it, the plugin's agent stays shadowed.",
      };
  }
}

/**
 * ExternalConsentDialogComponent — the consent gate of the two-call external
 * plugin install.
 *
 * PURELY PRESENTATIONAL. It fires no RPC and owns no install state: it renders
 * an {@link ExternalInstallPlan} the parent already obtained from the FIRST
 * `plugins:install-external` call (the one made WITHOUT a consent token, which
 * by contract writes nothing), and emits `confirmed` / `cancelled`. The parent
 * is what echoes `plan.consentToken` back on the second call.
 *
 * Everything the security model requires the user to see before a byte lands on
 * disk is rendered here, unconditionally when non-empty:
 *
 *  - identity + resolved version, flagged as an UPGRADE when `installedVersion`
 *    is present (a token minted for another version will not validate, so a
 *    version change always re-enters this dialog);
 *  - the skill names and the file/byte footprint;
 *  - `scriptFiles` — the executable surface — as an explicit warning;
 *  - `mcpServers`, each `commandLine` rendered VERBATIM inside `<code>` via text
 *    interpolation. It is never truncated, ellipsized, reformatted, or passed
 *    through `[innerHTML]`: it is untrusted remote text, and a user asked to
 *    approve a command line must see the exact command line. Installing does NOT
 *    register or run these servers — the copy says so;
 *  - `skippedBinaryFiles`, which the installer refuses as non-text;
 *  - `collisions`, so a skill that will be shadowed (and therefore never take
 *    effect) is disclosed before install rather than discovered after. The
 *    backend fills this in the RPC layer, so it carries real data — a shadowed
 *    skill is installed but never runs, which the user must know BEFORE paying
 *    for the install.
 *
 *  - `localItems` (design 3.3, after the shadowed block and before the
 *    error): "Local files this install would replace (N)", one keep/replace
 *    row per item, every row starting at Keep. An unreadable item is forced
 *    Keep. A new plan (re-approval) resets every choice to Keep. `confirmed`
 *    emits a decision per item keyed by its server-issued `approvalId`.
 *
 * Keyboard: focus moves into the dialog on open, Tab wraps inside it, Escape
 * cancels (not while the install runs), and focus returns to the opener.
 *
 * When `reason` is `approval-expired` an extra banner explains that a token was
 * presented and rejected. Deliberately does NOT claim upstream changed: the
 * backend returns that reason for a lapsed plan TTL, a host restart that lost
 * the pending plan, OR changed content. All the UI can honestly say is that the
 * earlier approval no longer counts and the plan below is freshly built.
 *
 * Complexity Level: 2 — inputs and two outputs; the only internal state is
 * the per-item keep/replace choice.
 */
@Component({
  selector: 'ptah-external-consent-dialog',
  standalone: true,
  imports: [LucideAngularModule, MarketplaceKeepReplaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      class="modal modal-open"
      data-testid="external-consent"
      aria-modal="true"
      aria-labelledby="external-consent-title"
      (keydown)="onKeydown($event)"
    >
      <div
        #box
        class="modal-box max-w-2xl"
        tabindex="-1"
        [attr.aria-busy]="busy() ? 'true' : null"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-start gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-lg bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0"
            >
              <lucide-angular
                [img]="ShieldAlertIcon"
                class="w-5 h-5 text-warning"
                aria-hidden="true"
              />
            </div>
            <div class="min-w-0">
              <h3
                id="external-consent-title"
                class="text-sm font-semibold text-base-content"
              >
                {{ isUpgrade() ? 'Update' : 'Install' }}
                {{ plan().displayName }}?
              </h3>
              <p class="text-[11px] text-base-content-muted mt-0.5 break-all">
                {{ plan().source }} · version {{ plan().version }}
                @if (isUpgrade()) {
                  <span class="badge badge-xs badge-warning ml-1">
                    upgrade from {{ plan().installedVersion }}
                  </span>
                }
              </p>
            </div>
          </div>
          <button
            class="btn btn-sm btn-circle btn-ghost shrink-0"
            type="button"
            [disabled]="busy()"
            (click)="cancelled.emit()"
            aria-label="Cancel install"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div class="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          <!-- Re-consent: a token was presented and rejected. -->
          @if (isReApproval()) {
            <div
              class="rounded-lg border border-warning/40 bg-warning/10 p-2.5"
              role="status"
            >
              <p class="text-[11px] text-base-content">
                Your earlier approval is no longer valid — it may have timed
                out, Ptah may have restarted, or this plugin's contents may have
                changed. The details below are current. Review them and approve
                again.
                @if (localItems().length > 0) {
                  Every choice is reset to Keep.
                }
              </p>
            </div>
          }

          <!-- Footprint -->
          <div
            class="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-1.5"
          >
            <div class="flex items-center gap-3 flex-wrap text-[11px]">
              <span class="text-base-content-muted">
                <span class="font-semibold text-base-content">{{
                  plan().fileCount
                }}</span>
                files
              </span>
              <span class="text-base-content-muted">
                <span class="font-semibold text-base-content">{{
                  formattedSize()
                }}</span>
                on disk
              </span>
              <span class="text-base-content-muted">
                <span class="font-semibold text-base-content">{{
                  plan().skills.length
                }}</span>
                {{ plan().skills.length === 1 ? 'skill' : 'skills' }}
              </span>
            </div>
            @if (plan().skills.length > 0) {
              <div class="flex gap-1 flex-wrap">
                @for (skill of plan().skills; track $index) {
                  <span
                    class="badge badge-xs badge-ghost font-mono text-[10px]"
                  >
                    {{ skill }}
                  </span>
                }
              </div>
            }
          </div>

          <!-- Executable surface -->
          @if (plan().scriptFiles.length > 0) {
            <div
              class="rounded-lg border border-warning/40 bg-warning/10 p-2.5 space-y-1.5"
            >
              <div class="flex items-center gap-1.5">
                <lucide-angular
                  [img]="FileWarningIcon"
                  class="w-3.5 h-3.5 text-warning shrink-0"
                  aria-hidden="true"
                />
                <span class="text-xs font-semibold text-base-content">
                  This plugin ships executable scripts
                </span>
              </div>
              <p class="text-[11px] text-base-content-muted">
                These files will be written to disk. Review them before running
                anything that invokes them.
              </p>
              <ul class="space-y-0.5">
                @for (file of plan().scriptFiles; track $index) {
                  <li class="text-[10px] font-mono break-all">
                    <code class="bg-base-300/60 rounded px-1 py-0.5">{{
                      file
                    }}</code>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Declared MCP servers: shown verbatim, never registered. -->
          @if (plan().mcpServers.length > 0) {
            <div
              class="rounded-lg border border-warning/40 bg-warning/10 p-2.5 space-y-2"
            >
              <div class="flex items-center gap-1.5">
                <lucide-angular
                  [img]="TerminalIcon"
                  class="w-3.5 h-3.5 text-warning shrink-0"
                  aria-hidden="true"
                />
                <span class="text-xs font-semibold text-base-content">
                  This plugin declares MCP servers
                </span>
              </div>
              <p class="text-[11px] text-base-content-muted">
                Ptah will NOT register or run these servers. Installing only
                puts the plugin's files on disk. Nothing below executes unless
                you add it yourself.
              </p>
              @for (server of plan().mcpServers; track $index) {
                <div class="space-y-1">
                  <div class="text-[10px] font-medium text-base-content-muted">
                    {{ server.name }}
                  </div>
                  <pre
                    class="text-[10px] leading-relaxed bg-base-300/60 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all"
                  ><code>{{ server.commandLine }}</code></pre>
                  @if (envKeysOf(server.env); as envKeys) {
                    @if (envKeys.length > 0) {
                      <div
                        class="text-[10px] text-base-content-muted break-all"
                      >
                        Sets environment: <code>{{ envKeys.join(', ') }}</code>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }

          <!-- Non-text payload the installer refuses -->
          @if (plan().skippedBinaryFiles.length > 0) {
            <div
              class="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-1.5"
            >
              <span class="text-xs font-semibold text-base-content">
                These files will be skipped (not valid UTF-8 text)
              </span>
              <ul class="space-y-0.5">
                @for (file of plan().skippedBinaryFiles; track $index) {
                  <li class="text-[10px] font-mono break-all">
                    <code class="bg-base-300/60 rounded px-1 py-0.5">{{
                      file
                    }}</code>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Shadowed skills -->
          @if (plan().collisions.length > 0) {
            <div
              class="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-1.5"
            >
              <div class="flex items-center gap-1.5">
                <lucide-angular
                  [img]="LayersIcon"
                  class="w-3.5 h-3.5 text-base-content-muted shrink-0"
                  aria-hidden="true"
                />
                <span class="text-xs font-semibold text-base-content">
                  Some skills will not take effect
                </span>
              </div>
              <ul class="space-y-0.5">
                @for (collision of plan().collisions; track $index) {
                  <li class="text-[11px] text-base-content-muted break-all">
                    skill
                    <code class="font-mono">{{ collision.skillName }}</code
                    >&nbsp;will be shadowed by
                    <code class="font-mono">{{ collision.shadowedBy }}</code>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Local files this install would replace (design 3.3) -->
          @if (localItems().length > 0) {
            <section
              class="rounded-lg border border-base-300 bg-base-200/40 p-2.5 space-y-2"
              aria-labelledby="external-consent-local-title"
              data-testid="external-consent-local-items"
            >
              <div>
                <h4
                  id="external-consent-local-title"
                  class="text-xs font-semibold text-base-content"
                >
                  Local files this install would replace ({{
                    localItems().length
                  }})
                </h4>
                <p class="text-[11px] text-base-content-muted">
                  Ptah keeps these files unless you choose to replace them.
                  Cancel changes nothing.
                </p>
              </div>
              @if (controllableCount() > 0) {
                <div
                  class="flex items-center gap-2"
                  role="group"
                  aria-label="Apply to all differing files"
                >
                  <span
                    class="grow text-[11px] font-semibold text-base-content"
                  >
                    {{ controllableCount() }}
                    {{ controllableCount() === 1 ? 'file can' : 'files can' }}
                    be replaced
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
                @for (row of localRows(); track row.item.approvalId) {
                  <li
                    class="rounded-md border border-base-300 bg-base-100/60 p-2 space-y-1.5"
                    data-testid="external-consent-local-row"
                    [attr.data-kind]="row.item.kind"
                  >
                    <div class="flex items-start gap-2">
                      <code
                        class="grow text-[11px] font-mono [overflow-wrap:anywhere]"
                        >{{ row.path }}</code
                      >
                      <span class="badge badge-sm badge-ghost shrink-0">{{
                        row.copy.badge
                      }}</span>
                    </div>
                    @if (row.copy.note; as note) {
                      <p
                        class="text-[11px] text-base-content-muted"
                        [id]="row.noteId"
                      >
                        {{ note }}
                      </p>
                    }
                    <ptah-marketplace-keep-replace
                      [path]="row.path"
                      [keepLabel]="row.copy.keepLabel"
                      [replaceLabel]="row.copy.replaceLabel"
                      [decision]="row.decision"
                      [forcedKeep]="row.forced"
                      [disabled]="busy()"
                      [describedBy]="row.forced ? row.noteId : null"
                      (decisionChange)="setDecision(row.item, $event)"
                    />
                  </li>
                }
              </ul>
            </section>
          }

          @if (installFailed()) {
            <div
              class="alert alert-error alert-sm py-1 px-2"
              role="alert"
              data-testid="external-consent-error"
            >
              <span class="text-xs">
                <strong>Install failed.</strong> Ptah removes what it wrote for
                this install where it can. Check the files listed in the install
                report, then retry.
              </span>
            </div>
          }
        </div>

        <div class="modal-action mt-3">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            [disabled]="busy()"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary btn-sm"
            type="button"
            data-testid="external-consent-confirm"
            [disabled]="busy()"
            (click)="confirm()"
          >
            @if (busy()) {
              <span class="loading loading-spinner loading-xs"></span>
              Installing…
            } @else {
              {{ confirmText() }}
            }
          </button>
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
export class ExternalConsentDialogComponent {
  /** The plan returned by the tokenless `plugins:install-external` call. */
  public readonly plan = input.required<ExternalInstallPlan>();
  /**
   * Why consent is being asked for. `approval-expired` means a token WAS
   * presented and rejected, so the dialog explains itself instead of silently
   * re-appearing.
   */
  public readonly reason = input<ExternalConsentReason>('not-yet-approved');
  /** True while the parent's authorized second call is in flight. */
  public readonly busy = input(false);
  /**
   * The second call failed: fixed copy without dismissing the dialog. No
   * reason is passed in, so host error text cannot reach the dialog.
   */
  public readonly installFailed = input(false);

  /**
   * User authorized the install — the parent echoes back `plan.consentToken`
   * with these keep/replace decisions, one per local item, keyed by its
   * server-issued `approvalId` (empty when the plan lists no local item).
   */
  public readonly confirmed = output<Record<string, FileDecision>>();
  /** User declined. The parent must fire NO RPC in response. */
  public readonly cancelled = output<void>();

  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly TerminalIcon = Terminal;
  protected readonly FileWarningIcon = FileWarning;
  protected readonly LayersIcon = Layers;
  protected readonly XIcon = X;

  /** True when this dialog is re-asking after a token was rejected. */
  public readonly isReApproval = computed(
    () => this.reason() === 'approval-expired',
  );

  /** True when a different version of this plugin is already installed. */
  public readonly isUpgrade = computed(
    () => (this.plan().installedVersion ?? '').length > 0,
  );

  /** `totalBytes` rendered in the largest unit that keeps it readable. */
  public readonly formattedSize = computed(() =>
    formatBytes(this.plan().totalBytes),
  );

  /** Local items in the way, in plan order. */
  public readonly localItems = computed<readonly ExternalLocalItem[]>(
    () => this.plan().localItems ?? [],
  );

  /**
   * Explicit choices by `approvalId`. A new plan (first ask or re-approval)
   * resets every row to Keep: the ids belong to the plan that issued them.
   */
  private readonly decisions = linkedSignal<
    ExternalInstallPlan,
    Readonly<Record<string, FileDecision>>
  >({
    source: this.plan,
    computation: () => ({}),
  });

  public readonly localRows = computed(() =>
    this.localItems().map((item) => ({
      item,
      path:
        item.kind === 'library-clone'
          ? `Library copy: ${item.relPath}`
          : item.relPath,
      noteId: `local-note-${item.approvalId}`,
      copy: localItemCopy(item),
      forced: this.isForced(item),
      decision: this.decisionOf(item),
    })),
  );

  protected readonly controllableCount = computed(
    () => this.localItems().filter((item) => !this.isForced(item)).length,
  );

  public readonly replaceCount = computed(
    () =>
      this.localItems().filter((item) => this.decisionOf(item) === 'replace')
        .length,
  );

  /**
   * "Install X" / "Update X", with "and replace N files" only when N > 0;
   * "Retry install" after a failed confirm.
   */
  public readonly confirmText = computed(() => {
    if (this.installFailed()) return 'Retry install';
    const verb = this.isUpgrade() ? 'Update' : 'Install';
    const base = `${verb} ${this.plan().displayName}`;
    const n = this.replaceCount();
    if (n === 0) return base;
    return `${base} and replace ${n} ${n === 1 ? 'file' : 'files'}`;
  });

  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly trap = new ModalFocusTrap(
    () => this.box()?.nativeElement,
    inject(DestroyRef),
  );

  public isForced(item: ExternalLocalItem): boolean {
    return item.kind === 'unreadable';
  }

  public decisionOf(item: ExternalLocalItem): FileDecision {
    if (this.isForced(item)) return 'keep';
    return this.decisions()[item.approvalId] ?? 'keep';
  }

  public setDecision(item: ExternalLocalItem, decision: FileDecision): void {
    if (this.isForced(item) || this.busy()) return;
    this.decisions.update((prev) => ({ ...prev, [item.approvalId]: decision }));
  }

  /** C4: sets every controllable row; forced-keep rows never change. */
  public setAll(decision: FileDecision): void {
    if (this.busy()) return;
    const next: Record<string, FileDecision> = {};
    for (const item of this.localItems()) {
      if (!this.isForced(item)) next[item.approvalId] = decision;
    }
    this.decisions.set(next);
  }

  /** Emit one decision per local item, keyed by `approvalId`. */
  public confirm(): void {
    if (this.busy()) return;
    const decisions: Record<string, FileDecision> = {};
    for (const item of this.localItems()) {
      decisions[item.approvalId] = this.decisionOf(item);
    }
    this.confirmed.emit(decisions);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.busy()) this.cancelled.emit();
      return;
    }
    this.trap.onTab(event);
  }

  /** Environment variable NAMES a declared server sets (values stay hidden). */
  public envKeysOf(env: Record<string, string> | undefined): string[] {
    return env ? Object.keys(env) : [];
  }
}

/** Human-readable byte count. Deterministic — no locale-dependent formatting. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
