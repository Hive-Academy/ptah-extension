import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, MessageSquare } from 'lucide-angular';
import type {
  PeerSessionRow,
  PeerSessionSendResult,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { PeerSessionFacade } from '@ptah-extension/core';
import { ChatStore } from '../../../services/chat.store';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { PeerSessionSendDialogComponent } from './peer-session-send-dialog.component';

/**
 * PeerSessionSendComponent — smart orchestrator molecule providing the
 * "Peer" send affordance in a chat session.
 *
 * Requirements & Invariants (TASK_2026_402 §11):
 * - Criterion 4: The outcome is reported strictly as 'accepted' or 'refused',
 *   NEVER 'delivered'. `acceptanceCaveat` is carried on the result and rendered
 *   prominently by the dialog.
 * - Criterion 5: Surfaces the two costs (`costsATurn`, `modelMayDecline`)
 *   BEFORE the send.
 * - Criterion 6: On picker open (`opened` event), refreshes the list via
 *   `PeerSessionFacade.refreshSessions()` excluding the current session.
 * - Host surface: chat orchestrator scoped to active tab / SESSION_CONTEXT.
 */
@Component({
  selector: 'ptah-peer-session-send',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, PeerSessionSendDialogComponent],
  template: `
    <!-- Trigger button in session controls bar -->
    <button
      type="button"
      class="btn btn-ghost btn-xs px-1.5 min-h-0 h-5 gap-1 text-[10px] font-medium text-base-content-muted hover:text-base-content"
      (click)="open()"
      [title]="triggerTooltip()"
      data-testid="peer-session-send-trigger"
    >
      <lucide-angular [img]="MessageSquareIcon" class="w-3 h-3" />
      <span>Peer</span>
    </button>

    <!-- Presentational dialog -->
    <ptah-peer-session-send-dialog
      [isOpen]="isOpen()"
      [sessions]="sessions()"
      [selectedSessionId]="selectedSessionId()"
      [message]="message()"
      [isSending]="isSending()"
      [sendResult]="lastResult()"
      [sendError]="sendError()"
      [canSend]="canSend()"
      [cannotSendReason]="cannotSendReason()"
      (pickerOpened)="onPickerOpened()"
      (sessionSelected)="onSessionSelected($event)"
      (messageChange)="onMessageChange($event)"
      (sendRequested)="onSendRequested()"
      (closed)="close()"
      (resetOutcome)="resetOutcome()"
    />
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
    `,
  ],
})
export class PeerSessionSendComponent {
  private readonly peerSessionFacade = inject(PeerSessionFacade);
  private readonly tabManager = inject(TabManagerService);
  private readonly chatStore = inject(ChatStore);
  private readonly sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });

  readonly MessageSquareIcon = MessageSquare;

  private readonly _isOpen = signal(false);
  private readonly _selectedSessionId = signal<string | null>(null);
  private readonly _message = signal('');
  private readonly _lastResult = signal<PeerSessionSendResult | null>(null);
  private readonly _sendError = signal<string | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly selectedSessionId = this._selectedSessionId.asReadonly();
  readonly message = this._message.asReadonly();
  readonly lastResult = this._lastResult.asReadonly();
  readonly sendError = this._sendError.asReadonly();

  readonly sessions = this.peerSessionFacade.sessions;
  readonly isSending = this.peerSessionFacade.isSending;

  private readonly resolvedTabId = computed(
    () => this.sessionContext?.() ?? this.tabManager.activeTabId(),
  );

  private readonly resolvedTab = computed(() => {
    const tabId = this.resolvedTabId();
    if (!tabId) return null;
    return this.tabManager.tabs().find((t) => t.id === tabId) ?? null;
  });

  /**
   * The sending session id that will pay the turn for the model-mediated send.
   */
  readonly fromSessionId = computed<string | null>(() => {
    return (
      this.resolvedTab()?.claudeSessionId ??
      this.chatStore.currentSessionId() ??
      null
    );
  });

  /** True when attached to messaging (e.g. Telegram / Discord). */
  readonly attachedReadOnly = computed(
    () => this.resolvedTab()?.attachedBinding != null,
  );

  /** Whether sending is allowed from this tab/session context. */
  readonly canSend = computed(() => {
    return this.fromSessionId() !== null && !this.attachedReadOnly();
  });

  /** Explanation when sending cannot proceed. */
  readonly cannotSendReason = computed<string | null>(() => {
    if (this.attachedReadOnly()) {
      return 'Session is attached to external messaging — read-only.';
    }
    if (!this.fromSessionId()) {
      return 'No active session in this tab yet — send a prompt first to start a session.';
    }
    return null;
  });

  readonly triggerTooltip = computed(() => {
    const reason = this.cannotSendReason();
    return reason
      ? `Message peer session (${reason})`
      : 'Message another peer session';
  });

  open(): void {
    this._isOpen.set(true);
    this._sendError.set(null);
    this._lastResult.set(null);
    void this.onPickerOpened();
  }

  close(): void {
    this._isOpen.set(false);
  }

  /**
   * Criterion 6: Refreshes the session list unconditionally whenever the picker
   * or dialog opens, excluding the sender session so it cannot address itself.
   */
  async onPickerOpened(): Promise<void> {
    const fromId = this.fromSessionId();
    await this.peerSessionFacade.refreshSessions(
      fromId ? { excludeSessionId: fromId } : undefined,
    );
  }

  onSessionSelected(session: PeerSessionRow): void {
    this._selectedSessionId.set(session.sessionId);
  }

  onMessageChange(msg: string): void {
    this._message.set(msg);
  }

  resetOutcome(): void {
    this._lastResult.set(null);
    this._sendError.set(null);
    this._message.set('');
  }

  async onSendRequested(): Promise<void> {
    const fromSessionId = this.fromSessionId();
    const targetSessionId = this._selectedSessionId();
    const text = this._message().trim();

    if (!fromSessionId || !targetSessionId || !text || this.isSending()) {
      return;
    }

    this._sendError.set(null);
    try {
      const result = await this.peerSessionFacade.send({
        sessionId: targetSessionId,
        fromSessionId,
        message: text,
      });
      this._lastResult.set(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to send to peer session';
      this._sendError.set(message);
    }
  }
}
