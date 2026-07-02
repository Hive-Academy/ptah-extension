import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import {
  LucideAngularModule,
  Share2,
  MessageSquare,
  Unlink,
} from 'lucide-angular';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';

/**
 * SendToMessagingComponent — messaging-attachment control for a single tab,
 * rendered in the Orchestra Canvas tile header.
 *
 * Two mutually-exclusive states:
 *  1. Detached — shows the "Send to messaging" trigger + approved-binding
 *     picker (`gateway:listBindings` → `gateway:attachSession`).
 *  2. Attached — shows the platform indicator + "Resolve back to webview"
 *     detach action (`gateway:detachSession`).
 *
 * Electron-only; renders nothing in other runtimes. Extracted from
 * `ChatInputComponent` (TASK move-to-tile-header) — the composer now only
 * gates its input on the attached state, while this owns the affordances.
 */
@Component({
  selector: 'ptah-send-to-messaging',
  imports: [LucideAngularModule],
  template: `
    @if (isElectron) {
      <div class="relative">
        @if (attachedReadOnly()) {
          <!-- Attached: platform indicator + resolve back to webview -->
          <button
            class="btn btn-ghost btn-xs px-1 min-h-0 h-5 gap-1 text-info hover:text-info"
            [disabled]="detaching()"
            (click)="detachBinding()"
            type="button"
            [title]="
              'Session attached to ' +
              attachedPlatformLabel() +
              ' — resolve back to webview'
            "
            data-testid="tile-resolve-back-btn"
          >
            @if (detaching()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular [img]="UnlinkIcon" class="w-3 h-3" />
            }
            <span class="text-[10px]">{{ attachedPlatformLabel() }}</span>
          </button>
        } @else if (canSendToMessaging()) {
          <!-- Detached: send this session to a messaging app -->
          <button
            class="btn btn-ghost btn-xs px-1 min-h-0 h-5 text-base-content/60 hover:text-base-content"
            (click)="
              showBindingPicker() ? closeBindingPicker() : openBindingPicker()
            "
            type="button"
            title="Send this session to a messaging app"
            data-testid="tile-send-to-messaging-btn"
          >
            <lucide-angular [img]="SendToMessagingIcon" class="w-3 h-3" />
          </button>

          @if (showBindingPicker()) {
            <div
              class="absolute top-full right-0 mt-1 z-30 w-64 rounded-lg border border-base-300 bg-base-100 shadow-lg p-1 text-left"
              role="listbox"
              aria-label="Approved messaging bindings"
            >
              @if (bindingsLoading()) {
                <div
                  class="flex items-center gap-2 px-3 py-3 text-sm text-base-content/60"
                >
                  <span class="loading loading-spinner loading-xs"></span>
                  <span>Loading bindings…</span>
                </div>
              } @else if (approvedBindings().length === 0) {
                <div class="px-3 py-3 text-sm text-base-content/60">
                  No approved bindings. Approve one in the Gateway tab first.
                </div>
              } @else {
                @for (binding of approvedBindings(); track binding.id) {
                  <button
                    class="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-base-200 disabled:opacity-50 flex items-center gap-2"
                    [disabled]="attaching()"
                    (click)="attachToBinding(binding)"
                    type="button"
                    role="option"
                    [attr.aria-selected]="false"
                  >
                    <lucide-angular
                      [img]="MessageSquareIcon"
                      class="w-3.5 h-3.5 flex-shrink-0 text-base-content/50"
                    />
                    <span class="truncate">{{ bindingLabel(binding) }}</span>
                  </button>
                }
              }
            </div>
          }
        }

        <!-- Transient error toast (attach/detach failures) -->
        @if (actionError(); as err) {
          @if (!showBindingPicker()) {
            <div
              class="absolute top-full right-0 mt-1 z-30 w-56 rounded-md border border-error/30 bg-error/10 px-2 py-1 text-xs text-error shadow-lg"
              role="alert"
              aria-live="polite"
            >
              {{ err }}
            </div>
          }
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

  readonly SendToMessagingIcon = Share2;
  readonly MessageSquareIcon = MessageSquare;
  readonly UnlinkIcon = Unlink;

  readonly isElectron = this.vscodeService.isElectron;

  /** Whether the binding picker popover is open. */
  private readonly _showBindingPicker = signal(false);
  readonly showBindingPicker = this._showBindingPicker.asReadonly();

  /** Approved bindings loaded for the picker. */
  private readonly _approvedBindings = signal<GatewayBindingDto[]>([]);
  readonly approvedBindings = this._approvedBindings.asReadonly();

  /** Whether the approved-binding list is loading. */
  private readonly _bindingsLoading = signal(false);
  readonly bindingsLoading = this._bindingsLoading.asReadonly();

  /** In-flight guard for the attach action. */
  private readonly _attaching = signal(false);
  readonly attaching = this._attaching.asReadonly();

  /** In-flight guard for the detach ("Resolve back to webview") action. */
  private readonly _detaching = signal(false);
  readonly detaching = this._detaching.asReadonly();

  /** Transient error surfaced near the control. */
  private readonly _actionError = signal<string | null>(null);
  readonly actionError = this._actionError.asReadonly();
  private _actionErrorTimeout: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Whether the "Send to messaging" trigger is available: an Electron-only
   * affordance that requires a real SDK session and an un-attached tab.
   */
  readonly canSendToMessaging = computed(() => {
    if (!this.isElectron) return false;
    const tab = this.resolvedTab();
    if (!tab) return false;
    if (tab.attachedBinding != null) return false;
    return !!tab.claudeSessionId;
  });

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

  /**
   * Open the binding picker: fetch the approved bindings via
   * `gateway:listBindings({ status: 'approved' })`.
   */
  async openBindingPicker(): Promise<void> {
    if (!this.canSendToMessaging()) return;
    this._showBindingPicker.set(true);
    this._bindingsLoading.set(true);
    try {
      const result = await this.rpcService.call('gateway:listBindings', {
        status: 'approved',
      });
      if (result.isSuccess() && result.data) {
        this._approvedBindings.set(result.data.bindings ?? []);
      } else {
        this._approvedBindings.set([]);
        this.showActionError(
          result.error || 'Failed to load messaging bindings',
        );
      }
    } catch (error) {
      console.error('[SendToMessaging] listBindings failed:', error);
      this._approvedBindings.set([]);
      this.showActionError('Failed to load messaging bindings');
    } finally {
      this._bindingsLoading.set(false);
    }
  }

  /** Close the binding picker popover. */
  closeBindingPicker(): void {
    this._showBindingPicker.set(false);
  }

  /**
   * Attach this tab's session to the chosen binding via
   * `gateway:attachSession`. On success the backend pushes
   * `gateway:sessionAttached`, which flips the tab to read-only.
   */
  async attachToBinding(binding: GatewayBindingDto): Promise<void> {
    if (this._attaching()) return;
    const tab = this.resolvedTab();
    const sessionUuid = tab?.claudeSessionId;
    if (!tab || !sessionUuid) {
      this.showActionError('No session to attach yet');
      return;
    }
    const workspaceRoot = this.resolveTabWorkspaceRoot(sessionUuid);
    if (!workspaceRoot) {
      this.showActionError('Could not resolve this tab’s workspace');
      return;
    }

    this._attaching.set(true);
    try {
      const result = await this.rpcService.call('gateway:attachSession', {
        bindingId: binding.id,
        sessionUuid,
        workspaceRoot,
        externalConversationId: 'default',
      });
      if (result.isSuccess() && result.data?.ok) {
        // Success — backend push (`gateway:sessionAttached`) sets read-only.
        this.closeBindingPicker();
      } else {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.showActionError(this.attachErrorLabel(reason));
      }
    } catch (error) {
      console.error('[SendToMessaging] attachSession failed:', error);
      this.showActionError('Failed to attach session to messaging');
    } finally {
      this._attaching.set(false);
    }
  }

  /**
   * "Resolve back to webview" — detach the binding via
   * `gateway:detachSession`. The backend clears the link and pushes
   * `gateway:sessionDetached`, which re-enables the composer.
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
      if (!(result.isSuccess() && result.data?.ok)) {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.showActionError(
          reason === 'binding-not-found'
            ? 'Messaging binding no longer exists'
            : reason || 'Failed to resolve session back to webview',
        );
      }
      // On success the `gateway:sessionDetached` push clears `attachedBinding`.
    } catch (error) {
      console.error('[SendToMessaging] detachSession failed:', error);
      this.showActionError('Failed to resolve session back to webview');
    } finally {
      this._detaching.set(false);
    }
  }

  /** Map a typed attach error to a short user-facing message. */
  private attachErrorLabel(reason: string | undefined): string {
    switch (reason) {
      case 'binding-not-approved':
        return 'That messaging binding is not approved yet';
      case 'session-not-resumable':
        return 'This session can’t be resumed for messaging';
      case 'binding-not-found':
        return 'Messaging binding no longer exists';
      default:
        return reason || 'Failed to attach session to messaging';
    }
  }

  /** Surface a transient error near the control. Auto-clears after 4s. */
  private showActionError(message: string): void {
    if (this._actionErrorTimeout) {
      clearTimeout(this._actionErrorTimeout);
    }
    this._actionError.set(message);
    this._actionErrorTimeout = setTimeout(() => {
      this._actionError.set(null);
      this._actionErrorTimeout = null;
    }, 4000);
  }
}
