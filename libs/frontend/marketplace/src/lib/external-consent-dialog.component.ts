import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
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
} from '@ptah-extension/shared';

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
 * When `reason` is `approval-expired` an extra banner explains that a token was
 * presented and rejected. Deliberately does NOT claim upstream changed: the
 * backend returns that reason for a lapsed plan TTL, a host restart that lost
 * the pending plan, OR changed content. All the UI can honestly say is that the
 * earlier approval no longer counts and the plan below is freshly built.
 *
 * Complexity Level: 1 — inputs and two outputs, zero internal state beyond
 * derived display helpers.
 */
@Component({
  selector: 'ptah-external-consent-dialog',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      class="modal modal-open"
      data-testid="external-consent"
      aria-modal="true"
      aria-labelledby="external-consent-title"
      (keydown.escape)="cancelled.emit()"
    >
      <div class="modal-box max-w-2xl">
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

          @if (errorMessage()) {
            <div class="alert alert-error alert-sm py-1 px-2" role="alert">
              <span class="text-xs">{{ errorMessage() }}</span>
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
            (click)="confirmed.emit()"
          >
            @if (busy()) {
              <span class="loading loading-spinner loading-xs"></span>
              Installing…
            } @else {
              {{ isUpgrade() ? 'Update' : 'Install' }}
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
  /** Failure from the second call, rendered without dismissing the dialog. */
  public readonly errorMessage = input<string | null>(null);

  /** User authorized the install — the parent echoes back `plan.consentToken`. */
  public readonly confirmed = output<void>();
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
