import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import { LucideAngularModule, Unlink } from 'lucide-angular';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';

import {
  HandoffBindingPickerComponent,
  type HandoffBindingRow,
  type HandoffRowError,
} from './handoff-binding-picker.component';

/** Outcome line shown next to the control (success or failure). */
interface HandoffResult {
  readonly ok: boolean;
  readonly message: string;
}

/** How long a success line stays on screen before it clears itself. */
const SUCCESS_LINE_MS = 3000;

const RESULT_BASE_CLASS =
  'absolute top-full right-0 mt-1 z-30 w-56 rounded-md border px-2 py-1 text-xs shadow-lg';

/**
 * SendToMessagingComponent — session HAND-OFF control for a single tab,
 * rendered in the Orchestra Canvas tile header.
 *
 * This is not a share action: picking a binding hands control of the tab's
 * live SDK session to a messaging platform and makes the tab READ-ONLY in the
 * webview until it is resolved back. The affordance, the picker header and the
 * inline confirm all say so before anything is committed.
 *
 * Two mutually-exclusive states:
 *  1. Detached — "Hand off session to…" trigger plus the approved-binding
 *     picker (`gateway:listBindings` + `gateway:status` → `gateway:attachSession`).
 *     The trigger stays VISIBLE but disabled when hand-off is impossible, with
 *     a tooltip naming the reason.
 *  2. Attached — platform indicator plus the "Resolve back to webview" detach
 *     action (`gateway:detachSession`), which is confirm-free.
 *
 * The panel itself is `HandoffBindingPickerComponent`; this class owns the
 * transport, the in-flight guards and the outcome lines.
 *
 * Electron-only; renders nothing in other runtimes.
 */
@Component({
  selector: 'ptah-send-to-messaging',
  imports: [
    LucideAngularModule,
    NativePopoverComponent,
    HandoffBindingPickerComponent,
  ],
  template: `
    @if (isElectron) {
      <div class="relative inline-flex items-center">
        @if (attachedReadOnly()) {
          <!-- Attached: platform indicator + resolve back to webview -->
          <button
            class="btn btn-ghost btn-xs px-1 min-h-0 h-5 gap-1 text-info hover:text-info"
            [disabled]="detaching()"
            (click)="detachBinding()"
            type="button"
            [title]="detachTooltip()"
            data-testid="tile-resolve-back-btn"
          >
            @if (detaching()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular [img]="UnlinkIcon" class="w-3 h-3" />
            }
            <span class="text-[10px]">{{ attachedPlatformLabel() }}</span>
          </button>
        } @else {
          <!-- Detached: hand this session off to a messaging platform -->
          <ptah-native-popover
            [isOpen]="pickerOpen()"
            placement="bottom-end"
            [hasBackdrop]="true"
            backdropClass="transparent"
            (closed)="closePicker()"
          >
            <span trigger [title]="triggerTooltip()">
              <button
                class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-[10px] font-medium text-base-content-muted hover:text-base-content"
                type="button"
                [disabled]="!canHandOff()"
                [attr.aria-label]="HANDOFF_LABEL"
                aria-haspopup="listbox"
                [attr.aria-expanded]="pickerOpen()"
                (click)="togglePicker()"
                data-testid="tile-send-to-messaging-btn"
              >
                Hand off
              </button>
            </span>

            <div content class="w-72 text-left">
              <ptah-handoff-binding-picker
                [heading]="HANDOFF_LABEL"
                [rows]="bindingRows()"
                [loading]="bindingsLoading()"
                [loadError]="loadError()"
                [pendingConfirmId]="pendingConfirmId()"
                [attaching]="attaching()"
                [rowError]="rowError()"
                (retry)="reloadPicker()"
                (pick)="requestConfirm($event)"
                (confirmPick)="attachToBinding($event)"
                (cancelPick)="cancelConfirm()"
              />
            </div>
          </ptah-native-popover>
        }

        <!-- Outcome line: attach/detach success and detach failure -->
        @if (actionResult(); as r) {
          <div
            [class]="resultClass(r.ok)"
            [attr.role]="r.ok ? 'status' : 'alert'"
            aria-live="polite"
            data-testid="handoff-result"
          >
            {{ r.message }}
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendToMessagingComponent {
  private readonly tabManager = inject(TabManagerService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  /** The tab whose session may be handed off to a messaging binding. */
  readonly tabId = input.required<string>();

  readonly UnlinkIcon = Unlink;
  readonly HANDOFF_LABEL = 'Hand off session to…';

  readonly isElectron = this.vscodeService.isElectron;

  /** Whether the binding picker popover is open. */
  private readonly _pickerOpen = signal(false);
  readonly pickerOpen = this._pickerOpen.asReadonly();

  /** Approved bindings loaded for the picker. */
  private readonly _approvedBindings = signal<GatewayBindingDto[]>([]);

  /**
   * Which adapters are running, or `null` when the probe has not resolved.
   * `null` means "unknown" and every row stays selectable.
   */
  private readonly _runningPlatforms = signal<Readonly<
    Set<GatewayPlatformId>
  > | null>(null);

  /** Whether the approved-binding list is loading. */
  private readonly _bindingsLoading = signal(false);
  readonly bindingsLoading = this._bindingsLoading.asReadonly();

  /** Failure to populate the picker at all (list RPC failed). */
  private readonly _loadError = signal<string | null>(null);
  readonly loadError = this._loadError.asReadonly();

  /** Binding awaiting the inline "Continue?" confirmation. */
  private readonly _pendingConfirmId = signal<string | null>(null);
  readonly pendingConfirmId = this._pendingConfirmId.asReadonly();

  /** In-flight guard for the attach action. */
  private readonly _attaching = signal(false);
  readonly attaching = this._attaching.asReadonly();

  /** In-flight guard for the detach ("Resolve back to webview") action. */
  private readonly _detaching = signal(false);
  readonly detaching = this._detaching.asReadonly();

  /** Attach failure shown against the row that produced it. */
  private readonly _rowError = signal<HandoffRowError | null>(null);
  readonly rowError = this._rowError.asReadonly();

  /** Success / failure line rendered next to the control. */
  private readonly _actionResult = signal<HandoffResult | null>(null);
  readonly actionResult = this._actionResult.asReadonly();
  private _successTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearSuccessTimer());
  }

  private readonly resolvedTab = computed(
    () => this.tabManager.tabs().find((t) => t.id === this.tabId()) ?? null,
  );

  /** The messaging binding this tab's session is attached to, or null. */
  private readonly attachedBinding = computed(
    () => this.resolvedTab()?.attachedBinding ?? null,
  );

  /** True when this tab's session is attached to a messaging binding. */
  readonly attachedReadOnly = computed(() => this.attachedBinding() != null);

  /** Human-readable platform label for the attached indicator. */
  readonly attachedPlatformLabel = computed(() => {
    const platform = this.attachedBinding()?.platform;
    return platform ? this.platformLabel(platform) : '';
  });

  /** Tooltip for the detach button. */
  readonly detachTooltip = computed(
    () =>
      `Session is driven from ${this.attachedPlatformLabel()} — resolve it back to the webview`,
  );

  /**
   * Why hand-off is unavailable, or `null` when it is available. Drives the
   * disabled state AND the tooltip, so the trigger is never silently missing.
   */
  readonly unavailableReason = computed<string | null>(() => {
    const tab = this.resolvedTab();
    if (!tab) return 'this tile has no chat tab yet';
    if (tab.attachedBinding != null) {
      return 'this session is already handed off';
    }
    if (!tab.claudeSessionId) {
      return 'no session yet — send a message first';
    }
    return null;
  });

  /** Whether the hand-off trigger can be used. */
  readonly canHandOff = computed(
    () => this.isElectron && this.unavailableReason() === null,
  );

  /** Tooltip on the trigger: the action, or the exact reason it is blocked. */
  readonly triggerTooltip = computed(() => {
    const reason = this.unavailableReason();
    return reason ? `Hand off unavailable — ${reason}` : this.HANDOFF_LABEL;
  });

  /** Approved bindings joined with their adapter run state. */
  readonly bindingRows = computed<HandoffBindingRow[]>(() => {
    const running = this._runningPlatforms();
    return this._approvedBindings().map((binding) => ({
      binding,
      label: this.bindingLabel(binding),
      platformLabel: this.platformLabel(binding.platform),
      online: running === null || running.has(binding.platform),
    }));
  });

  /** Tone the outcome line by success/failure. */
  resultClass(ok: boolean): string {
    return ok
      ? `${RESULT_BASE_CLASS} border-success/30 bg-success/10 text-success`
      : `${RESULT_BASE_CLASS} border-error/30 bg-error/10 text-error`;
  }

  /** Map a platform id to a display label for the picker / indicator. */
  private platformLabel(platform: GatewayPlatformId): string {
    switch (platform) {
      case 'telegram':
        return 'Telegram';
      case 'discord':
        return 'Discord';
      case 'slack':
        return 'Slack';
    }
  }

  /** Display label for a binding row in the picker. */
  bindingLabel(binding: GatewayBindingDto): string {
    const platform = this.platformLabel(binding.platform);
    const name = binding.displayName?.trim();
    return name ? `${platform} · ${name}` : platform;
  }

  /**
   * Resolve the workspace root for THIS tab's session (not just the active
   * workspace). The tab's session is registered to a workspace in the
   * partition reverse index — look it up by the tab's SDK session id.
   */
  private resolveTabWorkspaceRoot(sessionId: string): string | null {
    const lookup =
      this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId);
    return lookup?.workspacePath ?? this.tabManager.activeWorkspacePath ?? null;
  }

  /** Toggle the picker from the trigger button. */
  togglePicker(): void {
    if (this._pickerOpen()) {
      this.closePicker();
      return;
    }
    void this.openPicker();
  }

  /**
   * Open the hand-off picker: load approved bindings and the adapter run
   * state together, so offline platforms can be greyed out immediately.
   */
  async openPicker(): Promise<void> {
    if (!this.canHandOff()) return;
    this._pickerOpen.set(true);
    this._actionResult.set(null);
    await this.loadPicker();
  }

  /** Retry the picker load after a failure, without closing the popover. */
  async reloadPicker(): Promise<void> {
    await this.loadPicker();
  }

  /** Fetch approved bindings + adapter status for the picker. */
  private async loadPicker(): Promise<void> {
    this._bindingsLoading.set(true);
    this._loadError.set(null);
    this._rowError.set(null);
    this._pendingConfirmId.set(null);
    try {
      const [bindings, running] = await Promise.all([
        this.fetchApprovedBindings(),
        this.fetchRunningPlatforms(),
      ]);
      this._runningPlatforms.set(running);
      if (bindings === null) {
        this._approvedBindings.set([]);
        this._loadError.set('Couldn’t load messaging bindings.');
      } else {
        this._approvedBindings.set(bindings);
      }
    } finally {
      this._bindingsLoading.set(false);
    }
  }

  /** `gateway:listBindings({status:'approved'})`; `null` on failure. */
  private async fetchApprovedBindings(): Promise<GatewayBindingDto[] | null> {
    try {
      const result = await this.rpcService.call('gateway:listBindings', {
        status: 'approved',
      });
      if (result.isSuccess() && result.data) {
        return result.data.bindings ?? [];
      }
      return null;
    } catch (error: unknown) {
      console.error('[SendToMessaging] listBindings failed:', error);
      return null;
    }
  }

  /**
   * `gateway:status` — which adapters are actually running. Returns `null`
   * when the probe fails, which the picker reads as "unknown" and leaves
   * every row selectable rather than blocking the user on a probe error.
   */
  private async fetchRunningPlatforms(): Promise<Readonly<
    Set<GatewayPlatformId>
  > | null> {
    try {
      const result = await this.rpcService.call('gateway:status', {});
      if (result.isSuccess() && result.data) {
        return new Set(
          result.data.adapters
            .filter((adapter) => adapter.running)
            .map((adapter) => adapter.platform),
        );
      }
      return null;
    } catch (error: unknown) {
      console.error('[SendToMessaging] status failed:', error);
      return null;
    }
  }

  /** Close the picker and drop any pending confirmation / row error. */
  closePicker(): void {
    this._pickerOpen.set(false);
    this._pendingConfirmId.set(null);
    this._rowError.set(null);
  }

  /** Arm the inline confirm for a row. Offline rows are not selectable. */
  requestConfirm(row: HandoffBindingRow): void {
    if (!row.online || this._attaching()) return;
    this._rowError.set(null);
    this._pendingConfirmId.set(row.binding.id);
  }

  /** Dismiss the inline confirm without attaching. */
  cancelConfirm(): void {
    if (this._attaching()) return;
    this._pendingConfirmId.set(null);
  }

  /**
   * Attach this tab's session to the confirmed binding via
   * `gateway:attachSession`. On success the backend pushes
   * `gateway:sessionAttached`, which flips the tab to read-only; we show a
   * brief "Attached to {platform}" line across that transition.
   *
   * On failure the picker STAYS OPEN and the mapped reason renders against
   * the row that failed.
   */
  async attachToBinding(binding: GatewayBindingDto): Promise<void> {
    if (this._attaching()) return;
    const tab = this.resolvedTab();
    const sessionUuid = tab?.claudeSessionId;
    if (!tab || !sessionUuid) {
      this.setRowError(
        binding.id,
        'This tab has no session yet — send a message first, then hand off.',
      );
      return;
    }
    const workspaceRoot = this.resolveTabWorkspaceRoot(sessionUuid);
    if (!workspaceRoot) {
      this.setRowError(
        binding.id,
        'Couldn’t resolve this tab’s workspace folder. Open the tab’s project folder in Ptah, or reopen the tab from its workspace, then try again.',
      );
      return;
    }

    this._attaching.set(true);
    this._rowError.set(null);
    try {
      const result = await this.rpcService.call('gateway:attachSession', {
        bindingId: binding.id,
        sessionUuid,
        workspaceRoot,
        externalConversationId: 'default',
      });
      if (result.isSuccess() && result.data?.ok) {
        this.closePicker();
        this.showSuccess(`Attached to ${this.platformLabel(binding.platform)}`);
      } else {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.setRowError(binding.id, this.attachErrorLabel(reason, binding));
      }
    } catch (error: unknown) {
      console.error('[SendToMessaging] attachSession failed:', error);
      this.setRowError(
        binding.id,
        'Couldn’t hand off the session. Check the Gateway tab, then try again.',
      );
    } finally {
      this._attaching.set(false);
    }
  }

  /**
   * "Resolve back to webview" — detach the binding via
   * `gateway:detachSession`. Confirm-free (it only ever restores control),
   * but it does report its outcome.
   */
  async detachBinding(): Promise<void> {
    if (this._detaching()) return;
    const bindingId = this.attachedBinding()?.bindingId;
    if (!bindingId) return;

    this._detaching.set(true);
    try {
      const result = await this.rpcService.call('gateway:detachSession', {
        bindingId,
      });
      if (result.isSuccess() && result.data?.ok) {
        // The `gateway:sessionDetached` push clears `attachedBinding`.
        this.showSuccess('Resolved back to webview');
      } else {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.showFailure(this.detachErrorLabel(reason));
      }
    } catch (error: unknown) {
      console.error('[SendToMessaging] detachSession failed:', error);
      this.showFailure(
        'Couldn’t resolve this session back to the webview. Check the Gateway tab, then try again.',
      );
    } finally {
      this._detaching.set(false);
    }
  }

  /**
   * Map a typed attach error to a user-facing message that names the concrete
   * condition and the next step. Unrecognised reasons (including any new
   * backend error code) fall through to a generic, still-actionable line.
   */
  private attachErrorLabel(
    reason: string | undefined,
    binding: GatewayBindingDto,
  ): string {
    switch (reason) {
      case 'binding-not-approved':
        return 'That binding isn’t approved yet — approve it in the Gateway tab, then try again.';
      case 'session-not-resumable':
        return 'This session has no saved turn yet, so it can’t be resumed from a messaging app. Send a message and wait for the reply, then hand off.';
      case 'binding-not-found':
        return 'That binding no longer exists — close and reopen this list to refresh it.';
      case 'adapter-not-running':
        return `${this.platformLabel(binding.platform)} isn’t running — start it in the Gateway tab, then try again.`;
      default:
        return reason
          ? `Couldn’t hand off the session: ${reason}`
          : 'Couldn’t hand off the session. Check the Gateway tab, then try again.';
    }
  }

  /** Map a typed detach error to a user-facing message. */
  private detachErrorLabel(reason: string | undefined): string {
    if (reason === 'binding-not-found') {
      return 'That binding no longer exists — this tab is already back on the webview.';
    }
    return reason
      ? `Couldn’t resolve back to the webview: ${reason}`
      : 'Couldn’t resolve this session back to the webview.';
  }

  /** Pin an attach failure to its row; the picker stays open. */
  private setRowError(bindingId: string, message: string): void {
    this._rowError.set({ bindingId, message });
  }

  /** Show a transient success line next to the control. */
  private showSuccess(message: string): void {
    this.clearSuccessTimer();
    this._actionResult.set({ ok: true, message });
    this._successTimeout = setTimeout(() => {
      this._actionResult.set(null);
      this._successTimeout = null;
    }, SUCCESS_LINE_MS);
  }

  /** Show a failure line next to the control. Stays until the next action. */
  private showFailure(message: string): void {
    this.clearSuccessTimer();
    this._actionResult.set({ ok: false, message });
  }

  private clearSuccessTimer(): void {
    if (this._successTimeout) {
      clearTimeout(this._successTimeout);
      this._successTimeout = null;
    }
  }
}
