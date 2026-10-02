import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  LucideAngularModule,
  ShieldCheck,
} from 'lucide-angular';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import type {
  DiagnosticsGoVetConsentGetResult,
  DiagnosticsGoVetConsentSetError,
  GoVetConsentStaleReasonDto,
} from '@ptah-extension/shared';

/** Why a stored consent no longer holds (User Decision 25), in the user's words. */
const STALE_REASON_TEXT: Record<GoVetConsentStaleReasonDto, string> = {
  'root-moved': 'the workspace folder now points to a different location',
  'root-replaced':
    'the workspace folder was replaced (deleted and re-created, or re-cloned)',
  'go-changed': 'the Go toolchain changed since consent was given',
};

/** One fixed message per SET refusal (O2 §3); no host text reaches the UI. */
const SET_ERROR_TEXT: Record<DiagnosticsGoVetConsentSetError, string> = {
  'invalid-params': 'The request was rejected as malformed. Nothing changed.',
  unsupported: 'This app cannot store per-workspace consent. Nothing changed.',
  'no-workspace': 'No workspace folder is open. Nothing changed.',
  'workspace-changed':
    'The active workspace changed before the change was saved. Nothing changed; the card now shows the current workspace.',
  'go-changed':
    'The Go toolchain changed after this card was shown. Nothing changed; review the toolchain now shown and enable again.',
  'no-go-binary':
    'No Go toolchain was found on PATH outside this workspace. Nothing changed.',
  'persist-failed':
    'The change could not be saved and verified. The card shows what is stored now.',
};

const TRANSPORT_SET_ERROR =
  'Could not reach the app host. The card shows what is stored now.';
const LOAD_ERROR = 'Could not read the go vet setting for this workspace.';
const SUCCESS_MESSAGE_MS = 3000;

/**
 * "Run `go vet` for this workspace" (TASK_2026_559 Batch 37b2, O2 §5.1).
 *
 * Electron-only card (mounted inside `@if (isElectron)`; the host capability
 * `goVetDiagnostics` is off on VS Code). Reads consent through
 * `diagnostics:go-vet-consent-get` on init and on every `scopeKey()` change,
 * discarding a response whose scope or request has been superseded. Enabling
 * opens an explicit confirmation that names the exact workspace root; the SET
 * carries that displayed root as `workspaceRoot` so the host can refuse a
 * stale view (`workspace-changed`). The toggle is optimistic and reverts on any
 * failure; every failure also re-reads the host state. A `stale` consent
 * (folder moved or replaced, Go binary changed) is shown with its reason and is
 * never shown as on. Renders nothing while support is unknown or when the host
 * answers `supported: false`.
 */
@Component({
  selector: 'ptah-go-vet-consent-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '[class.mt-4]': 'visible()' },
  template: `
    @if (visible()) {
      <!-- P2 section card (pattern map V26-V29). -->
      <section
        class="card bg-base-200 border border-base-300 p-3"
        aria-labelledby="go-vet-consent-title"
        data-testid="go-vet-consent-card"
      >
        <div>
          <div class="flex items-center gap-1.5 mb-2">
            <lucide-angular
              [img]="ShieldCheckIcon"
              class="w-4 h-4 text-secondary"
              aria-hidden="true"
            />
            <h2
              id="go-vet-consent-title"
              class="text-xs font-bold uppercase tracking-wider text-base-content"
            >
              Diagnostics: <code class="normal-case">go vet</code>
            </h2>
          </div>

          <p class="text-sm text-base-content-muted mb-2">
            When on, Ptah's diagnostics tools run your installed Go toolchain
            (<code>go vet</code>) on the Go packages they are asked to check. It
            reads the module source and module cache and writes the build cache.
            It does not run go:generate, tests, build scripts, custom vet tools,
            downloaded toolchains, network fetches, git or C compilers. Turning
            this on authorises that run for this folder only; it is not a
            sandbox. Consent ends when the folder moves or is replaced, or when
            the Go binary changes.
          </p>

          <!-- P4 detail rows (V26) + the "On" row (V27). -->
          <table class="table table-xs" data-testid="go-vet-consent-table">
            <tbody>
              @if (consent(); as c) {
                <tr>
                  <th
                    scope="row"
                    class="w-24 align-top font-medium text-base-content"
                  >
                    Workspace
                  </th>
                  <td
                    class="align-top font-mono break-all text-base-content"
                    data-testid="go-vet-consent-root"
                  >
                    {{ c.workspace?.root ?? 'No workspace folder is open' }}
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    class="w-24 align-top font-medium text-base-content"
                  >
                    Go binary
                  </th>
                  <td
                    class="align-top font-mono break-all text-base-content"
                    data-testid="go-vet-consent-binary"
                  >
                    {{ c.goBinary ?? 'none found on PATH' }}
                  </td>
                </tr>
              }
              <!-- The switch row spans both columns so its label reads on one
                   line while Workspace / Go binary keep the narrow label column. -->
              <tr>
                <td colspan="2" class="align-middle">
                  <div class="flex items-center justify-between gap-3">
                    <label
                      for="go-vet-consent-toggle"
                      class="font-medium whitespace-nowrap text-base-content"
                    >
                      Allow <code>go vet</code> in this workspace
                    </label>
                    <div class="flex items-center gap-2">
                      <!-- P10: plain text state; the colour is carried by the
                           dot only. -->
                      <span
                        class="inline-flex items-center gap-1 whitespace-nowrap text-base-content"
                        data-testid="go-vet-consent-state"
                      >
                        <span
                          class="inline-block w-1.5 h-1.5 rounded-full"
                          [class.bg-success]="badgeView() === 'on'"
                          [class.bg-warning]="badgeView() === 'stale'"
                          [class.bg-info]="badgeView() === 'pending'"
                          [class.bg-base-content-muted]="badgeView() === 'off'"
                          aria-hidden="true"
                        ></span>
                        {{ badgeLabel() }}
                      </span>
                      <!-- 24×24 px hit area around the switch (WCAG 2.5.8);
                           role="switch" keeps the on/off semantics (G1). -->
                      <label
                        class="inline-flex items-center justify-center min-w-6 min-h-6"
                        [class.cursor-pointer]="!toggleDisabled()"
                        data-testid="go-vet-consent-toggle-target"
                      >
                        <input
                          #toggle
                          id="go-vet-consent-toggle"
                          type="checkbox"
                          role="switch"
                          class="toggle toggle-sm toggle-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [checked]="toggleChecked()"
                          [attr.aria-checked]="toggleChecked()"
                          [disabled]="toggleDisabled()"
                          aria-describedby="go-vet-consent-status"
                          (change)="onToggle($event)"
                          data-testid="go-vet-consent-toggle"
                        />
                      </label>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <div id="go-vet-consent-status" aria-live="polite" class="mt-1">
            @if (loading()) {
              <p
                class="text-xs text-base-content-muted"
                data-testid="go-vet-consent-loading"
              >
                Checking the go vet setting…
              </p>
            }
            <!-- V29: the stale reason is safety-relevant, so it stays in the
                 card rather than only in a toast. -->
            @if (staleText(); as reason) {
              <p
                class="flex items-start gap-1 text-xs text-base-content"
                data-testid="go-vet-consent-stale"
              >
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3.5 h-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span>
                  Consent is out of date: {{ reason }}. go vet does not run
                  until you turn it on again.
                </span>
              </p>
            }
            @if (successMessage(); as message) {
              <p
                class="flex items-start gap-1 text-xs text-base-content"
                data-testid="go-vet-consent-success"
              >
                <lucide-angular
                  [img]="CheckCircleIcon"
                  class="w-3.5 h-3.5 shrink-0 text-success"
                  aria-hidden="true"
                />
                <span>{{ message }}</span>
              </p>
            }
          </div>

          @if (errorMessage(); as message) {
            <!-- P2 inline alert: colour on the icon and border only. -->
            <div
              class="mt-2 flex items-start gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content"
              role="alert"
              data-testid="go-vet-consent-error"
            >
              <lucide-angular
                [img]="AlertCircleIcon"
                class="w-3.5 h-3.5 shrink-0 text-error"
                aria-hidden="true"
              />
              <span>{{ message }}</span>
            </div>
          }

          @if (confirmingRoot(); as root) {
            <!-- P8 inline confirm (V28): names the exact root; Cancel gets
                 initial focus, Esc cancels, focus returns to the switch. -->
            <div
              class="mt-2 space-y-2 rounded border border-base-300 p-3"
              role="group"
              aria-labelledby="go-vet-confirm-title"
              aria-describedby="go-vet-confirm-root"
              (keydown.escape)="cancelEnable($event)"
              data-testid="go-vet-consent-confirm"
            >
              <p
                id="go-vet-confirm-title"
                class="flex items-center gap-1.5 text-xs font-medium text-base-content"
              >
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3.5 h-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                Allow go vet to run in this folder?
              </p>
              <p
                id="go-vet-confirm-root"
                class="text-xs font-mono break-all text-base-content"
                data-testid="go-vet-consent-confirm-root"
              >
                {{ root }}
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  (click)="confirmEnable()"
                  data-testid="go-vet-consent-allow"
                >
                  Allow go vet
                </button>
                <button
                  #cancelButton
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="cancelEnable()"
                  data-testid="go-vet-consent-cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class GoVetConsentConfigComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly scope = inject(WorkspaceScopeService);
  private readonly injector = inject(Injector);

  readonly ShieldCheckIcon = ShieldCheck;
  readonly AlertCircleIcon = AlertCircle;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckCircleIcon = CheckCircle;

  /** Last applied GET answer; `null` until the first one arrives. */
  readonly consent = signal<DiagnosticsGoVetConsentGetResult | null>(null);
  /** At least one GET has settled (answer or failure). */
  readonly settled = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  /** Root named in the open enable confirmation, or `null` when closed. */
  readonly confirmingRoot = signal<string | null>(null);
  /** The GET `confirmToken` captured when the confirmation opened. */
  private confirmingToken: string | undefined;
  /** Toggle position while a SET is in flight; `null` shows the host state. */
  readonly optimisticEnabled = signal<boolean | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  private readonly toggleRef =
    viewChild<ElementRef<HTMLInputElement>>('toggle');
  private readonly cancelButtonRef =
    viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  /** Hidden while support is unknown and when the host answers unsupported. */
  readonly visible = computed(
    () => this.settled() && this.consent()?.supported !== false,
  );
  /**
   * What the badge shows. While the enable confirmation is open or a SET is in
   * flight the switch shows the pending choice, so the badge says "pending"
   * too instead of the committed state (the two must never disagree).
   */
  readonly badgeView = computed<'on' | 'off' | 'stale' | 'pending'>(() =>
    this.confirmingRoot() !== null || this.saving()
      ? 'pending'
      : (this.consent()?.state ?? 'off'),
  );
  readonly badgeLabel = computed(() => {
    switch (this.badgeView()) {
      case 'on':
        return 'On';
      case 'stale':
        return 'Out of date';
      case 'pending':
        return this.saving() ? 'Saving…' : 'Confirm to enable';
      default:
        return 'Off';
    }
  });
  readonly staleText = computed(() => {
    const c = this.consent();
    if (c?.state !== 'stale') return null;
    return c.staleReason
      ? STALE_REASON_TEXT[c.staleReason]
      : 'the stored consent no longer matches this folder';
  });
  readonly toggleChecked = computed(
    () =>
      this.optimisticEnabled() ??
      (this.confirmingRoot() !== null || this.consent()?.state === 'on'),
  );
  readonly toggleDisabled = computed(
    () =>
      this.loading() ||
      this.saving() ||
      !this.consent()?.supported ||
      !this.consent()?.workspace,
  );

  private getSeq = 0;
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.scope.scopeKey();
      untracked(() => {
        // A new workspace: nothing shown for the previous one still applies.
        this.confirmingRoot.set(null);
        this.errorMessage.set(null);
        this.clearSuccess();
        void this.load();
      });
    });
    inject(DestroyRef).onDestroy(() => this.clearSuccess());
  }

  /** GET; applied only if no newer GET started and the scope is unchanged. */
  async load(): Promise<void> {
    const seq = ++this.getSeq;
    const key = this.scope.scopeKey();
    const isCurrent = (): boolean =>
      seq === this.getSeq && key === this.scope.scopeKey();
    this.loading.set(true);
    try {
      const result = await this.rpc.call(
        'diagnostics:go-vet-consent-get',
        {} as Record<string, never>,
      );
      if (!isCurrent()) return;
      if (result.isSuccess()) {
        this.consent.set(result.data);
      } else {
        this.consent.set(null);
        this.errorMessage.set(LOAD_ERROR);
      }
    } catch {
      // The RPC layer resolves failures as results; a throw is a broken
      // transport and gets the same fixed message.
      if (isCurrent()) {
        this.consent.set(null);
        this.errorMessage.set(LOAD_ERROR);
      }
    } finally {
      if (seq === this.getSeq) {
        this.loading.set(false);
        this.settled.set(true);
      }
    }
  }

  onToggle(event: Event): void {
    const wanted = (event.target as HTMLInputElement).checked;
    const root = this.consent()?.workspace?.root;
    if (!root) return;
    if (wanted) {
      this.openConfirm(root);
      return;
    }
    if (this.confirmingRoot() !== null) {
      this.cancelEnable();
      return;
    }
    void this.submit(false, root);
  }

  confirmEnable(): void {
    const root = this.confirmingRoot();
    if (!root) return;
    // The identity of the root and binary the confirmation displayed.
    const token = this.confirmingToken;
    this.confirmingRoot.set(null);
    this.confirmingToken = undefined;
    this.focusToggle();
    void this.submit(true, root, token);
  }

  /** Cancel and Esc close the confirm; Esc stops here only when it closed it (P8). */
  cancelEnable(event?: Event): void {
    if (this.confirmingRoot() === null) return;
    event?.stopPropagation();
    this.confirmingRoot.set(null);
    this.confirmingToken = undefined;
    this.focusToggle();
  }

  private openConfirm(root: string): void {
    this.errorMessage.set(null);
    this.clearSuccess();
    this.confirmingToken = this.consent()?.confirmToken;
    this.confirmingRoot.set(root);
    afterNextRender(() => this.cancelButtonRef()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private focusToggle(): void {
    afterNextRender(() => this.toggleRef()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /** SET with the displayed root; success only as the host read it back. */
  private async submit(
    enabled: boolean,
    workspaceRoot: string,
    confirmToken?: string,
  ): Promise<void> {
    const key = this.scope.scopeKey();
    this.errorMessage.set(null);
    this.clearSuccess();
    this.saving.set(true);
    this.optimisticEnabled.set(enabled);
    try {
      const result = await this.rpc.call('diagnostics:go-vet-consent-set', {
        enabled,
        workspaceRoot,
        ...(confirmToken !== undefined ? { confirmToken } : {}),
        source: 'settings-ui',
      });
      // A workspace switch already triggered a fresh GET for the new scope.
      if (key !== this.scope.scopeKey()) return;
      if (!result.isSuccess()) {
        this.fail(TRANSPORT_SET_ERROR);
        return;
      }
      const answer = result.data;
      if (!answer.success) {
        this.fail(SET_ERROR_TEXT[answer.error] ?? TRANSPORT_SET_ERROR);
        return;
      }
      this.applyReadBack(answer.state, answer.goBinary);
    } catch {
      if (key === this.scope.scopeKey()) this.fail(TRANSPORT_SET_ERROR);
    } finally {
      this.optimisticEnabled.set(null);
      this.saving.set(false);
    }
  }

  /** Revert (by dropping the optimistic value) and re-read the host state. */
  private fail(message: string): void {
    this.optimisticEnabled.set(null);
    this.errorMessage.set(message);
    void this.load();
  }

  private applyReadBack(state: 'on' | 'off', committedBinary?: string): void {
    const current = this.consent();
    if (current) {
      // An enable shows the binary the host committed, not the one on screen.
      const goBinary = committedBinary ?? current.goBinary;
      this.consent.set({
        supported: current.supported,
        workspace: current.workspace,
        state,
        ...(goBinary !== undefined ? { goBinary } : {}),
        ...(current.confirmToken !== undefined
          ? { confirmToken: current.confirmToken }
          : {}),
      });
    }
    this.successMessage.set(
      state === 'on'
        ? 'go vet is on for this workspace.'
        : 'go vet is off for this workspace.',
    );
    this.successTimer = setTimeout(() => {
      this.successTimer = null;
      this.successMessage.set(null);
    }, SUCCESS_MESSAGE_MS);
  }

  private clearSuccess(): void {
    if (this.successTimer !== null) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
    this.successMessage.set(null);
  }
}
