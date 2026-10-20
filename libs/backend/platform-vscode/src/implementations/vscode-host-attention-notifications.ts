import * as vscode from 'vscode';
import { inject, injectable } from 'tsyringe';
import type { AttentionOpenTargetPayload } from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { PLATFORM_TOKENS, type IHostAttentionNotifications, type IPtahViewVisibility, type SafeHostAttentionNotice } from '@ptah-extension/platform-core';
import { TOKENS, type Logger, WebviewManager } from '@ptah-extension/vscode-core';

@injectable()
export class VscodeHostAttentionNotifications implements IHostAttentionNotifications {
  private readonly active = new Map<string, SafeHostAttentionNotice>();
  private route?: (payload: AttentionOpenTargetPayload) => void;
  private disposed = false;
  private burstUntil = 0;
  private readonly burstKeys: string[] = [];

  constructor(
    @inject(PLATFORM_TOKENS.PTAH_VIEW_VISIBILITY) private readonly visibility: IPtahViewVisibility,
    @inject(TOKENS.WEBVIEW_MANAGER) private readonly manager: WebviewManager,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  isEligible(): boolean {
    return !this.disposed && !this.visibility.anyPtahViewVisible();
  }

  activeNotices(): ReadonlyArray<{ readonly key: string; readonly generation: number }> {
    return [...this.active.values()].map(({ key, generation }) => ({ key, generation }));
  }

  setRouteDispatcher(dispatcher: (payload: AttentionOpenTargetPayload) => void): vscode.Disposable {
    this.route = dispatcher;
    return { dispose: () => {
      if (this.route === dispatcher) this.route = undefined;
    } };
  }

  present(notice: SafeHostAttentionNotice): void {
    if (!this.isEligible()) return;
    const previous = this.active.get(notice.key);
    if (previous && previous.generation >= notice.generation) return;
    this.active.set(notice.key, notice);
    if (Date.now() >= this.burstUntil) this.burstKeys.length = 0;
    this.burstKeys.push(notice.key);
    this.burstUntil = Date.now() + 350;
    const burstKeys = [...this.burstKeys];
    const message = this.burstKeys.length > 1
      ? `${this.burstKeys.length} requests need you — ${notice.sessionTitle}`
      : `${notice.label} — ${notice.sessionTitle}`;
    const show = notice.severity === 'error' ? vscode.window.showErrorMessage
      : notice.kind === 'question' ? vscode.window.showInformationMessage
      : vscode.window.showWarningMessage;
    void show(message, notice.actionLabel).then((selection) => {
      if (selection === notice.actionLabel) {
        const current = burstKeys.reverse().map((key) => this.active.get(key)).find((value) => !!value);
        if (current) this.open({ key: current.key, generation: current.generation, target: current.target });
        else this.open({ key: notice.key, generation: notice.generation, target: notice.target });
      }
    }, (error: unknown) => {
      this.logger.warn(`Host attention notification failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    });
  }

  resolve(key: string, generation: number): void {
    if (this.active.get(key)?.generation === generation) this.active.delete(key);
  }

  open(payload: AttentionOpenTargetPayload): void {
    const current = this.active.get(payload.key);
    if (!current || current.generation !== payload.generation || current.target.workspaceId !== payload.target.workspaceId || current.target.sessionId !== payload.target.sessionId) {
      void vscode.commands.executeCommand('ptah.main.focus').then(() => vscode.window.showInformationMessage('Already answered'), (error: unknown) => {
        this.logger.warn(`Host attention reveal failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
      });
      return;
    }
    void vscode.commands.executeCommand('ptah.main.focus').then(undefined, (error: unknown) => {
      this.logger.warn(`Host attention reveal failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
    });
    if (this.route) {
      this.route(payload);
    } else {
      void this.manager.broadcastMessage(MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload).catch((error: unknown) => {
        this.logger.warn(`Host attention route failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active.clear();
    this.route = undefined;
  }
}
