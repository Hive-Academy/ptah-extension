import { DestroyRef, Injectable, inject } from '@angular/core';
import { ChatStore, MessageSenderService } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  CommandCenterSendLockService,
  TabId,
  TabManagerService,
  commandCenterPersonaFor,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { CommandCenterStore } from './command-center.store';
import { buildStatusContext } from './status-context';

/** Owns only the marked tab for one Command Center page lifetime. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped, provided by the Command Center page component.
@Injectable()
export class CommandCenterSessionCoordinator {
  private readonly tabs = inject(TabManagerService);
  private readonly records = inject(CommandCenterRecordsService);
  private readonly lock = inject(CommandCenterSendLockService);
  private readonly sender = inject(MessageSenderService);
  private readonly chat = inject(ChatStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly store = inject(CommandCenterStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ownerToken = crypto.randomUUID();
  private opening: Promise<string | null> | null = null;
  private statusContextProvider: (() => string | null) | null = () =>
    buildStatusContext(this.store.nodes());

  public constructor() {
    this.destroyRef.onDestroy(() => this.releaseVoice());
  }

  public setStatusContextProvider(
    provider: (() => string | null) | null,
  ): void {
    this.statusContextProvider = provider;
  }

  public openOrResume(): Promise<string | null> {
    if (this.opening) return this.opening;
    const opening = this.openOrResumeInternal();
    this.opening = opening;
    // degradation-audit: reported — the caller receives the original promise and handles its rejection
    void opening
      .finally(() => {
        if (this.opening === opening) this.opening = null;
      })
      .catch(() => undefined);
    return opening;
  }

  private async openOrResumeInternal(): Promise<string | null> {
    const workspace = this.tabs.activeWorkspacePath;
    if (!workspace) {
      this.fail('Open a workspace to use Command Center.');
      return null;
    }
    this.store.setSessionStatus('starting');
    const activeId = this.records.readActiveTabId(workspace);
    const existing =
      activeId &&
      this.tabs
        .tabs()
        .find(
          (tab) =>
            tab.id === activeId &&
            tab.commandCenterOrigin?.workspaceId === workspace &&
            commandCenterPersonaFor(tab) !== undefined,
        );
    if (existing) {
      this.tabs.switchTab(existing.id);
      this.store.setSession(
        existing.id,
        existing.claudeSessionId ?? null,
        workspace,
      );
      if (
        existing.claudeSessionId &&
        existing.messages.length === 0 &&
        !existing.hasLiveSession
      ) {
        try {
          await this.chat.switchSession(existing.claudeSessionId, {
            targetTabId: existing.id,
          });
        } catch {
          // degradation-audit: reported — the restore failure is shown through the safe fail message
          this.fail('Could not restore the Command Center session.');
          return null;
        }
      }
      this.store.setSessionStatus(
        existing.status === 'streaming' ||
          existing.status === 'awaiting-background' ||
          existing.status === 'sleeping'
          ? 'running'
          : 'idle',
      );
      return existing.id;
    }
    const last = this.records.readLastSession(workspace);
    const exists = last
      ? await this.sessionExists(last.sdkSessionId, workspace)
      : false;
    if (exists === null) {
      this.fail('Could not check the previous Command Center session.');
      return null;
    }
    if (last && exists) {
      const openTab = this.tabs.findTabBySessionId(last.sdkSessionId);
      if (openTab) {
        this.tabs.switchTab(openTab.id);
        this.fail(
          'This session is already open in another tab. Close it there to resume it in Command Center.',
        );
        return null;
      }
      const tabId = this.tabs.createCommandCenterTab('Command Center');
      this.tabs.attachSession(tabId, last.sdkSessionId);
      this.tabs.switchTab(tabId);
      try {
        await this.chat.switchSession(SessionId.from(last.sdkSessionId), {
          targetTabId: TabId.from(tabId),
        });
        this.store.setSession(tabId, last.sdkSessionId, workspace);
        const restored = this.tabs.tabs().find((tab) => tab.id === tabId);
        this.store.setSessionStatus(
          restored?.status === 'streaming' ||
            restored?.status === 'awaiting-background' ||
            restored?.status === 'sleeping'
            ? 'running'
            : 'idle',
        );
        return tabId;
      } catch {
        // degradation-audit: reported — restore failure is shown through the safe fail message
        this.fail('Could not restore the Command Center session.');
        return null;
      }
    }
    return this.newCommandCenter();
  }

  private async sessionExists(
    sessionId: string,
    workspace: string,
  ): Promise<boolean | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const result = await this.rpc.call(
          'session:list',
          { workspacePath: workspace },
          { signal: controller.signal },
        );
        if (result.success && Array.isArray(result.data?.sessions)) {
          return result.data.sessions.some(
            (session) => session.id === sessionId,
          );
        }
      } catch {
        // Only this read is retried; writes and sends must never be repeated.
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < 2)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1)),
        );
    }
    return null;
  }

  public newCommandCenter(): string | null {
    const workspace = this.tabs.activeWorkspacePath;
    if (!workspace) {
      this.fail('Open a workspace to use Command Center.');
      return null;
    }
    this.stopVoiceLocally();
    const tabId = this.tabs.createCommandCenterTab('Command Center');
    this.tabs.switchTab(tabId);
    this.store.setSession(tabId, null, workspace);
    this.store.setSessionStatus('idle');
    return tabId;
  }

  public startVoice(): void {
    const tabId = this.store.markedTabId();
    if (!tabId) return;
    this.lock.engage(tabId, this.store.sessionId(), this.ownerToken);
    this.store.setMuted(false);
    this.store.setVoiceState('listening');
  }

  public mute(): void {
    this.releaseVoice();
    this.store.setMuted(true);
    this.store.setVoiceState('muted');
    this.store.resetLevels();
  }

  private stopVoiceLocally(): void {
    this.releaseVoice();
    this.store.setVoiceState('idle');
    this.store.resetLevels();
  }

  private releaseVoice(): void {
    this.lock.release(this.ownerToken);
  }

  public async stop(): Promise<void> {
    const tabId = this.store.markedTabId();
    const sessionId =
      (tabId &&
        this.tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.claudeSessionId) ??
      this.store.sessionId();
    this.releaseVoice();
    this.store.setVoiceState('stopped');
    this.store.resetLevels();
    this.store.setSessionStatus('stopped');
    if (!sessionId) return;
    try {
      const result = await this.rpc.call('chat:abort', {
        sessionId: SessionId.from(sessionId),
      });
      if (!result.success) this.fail('Could not stop the session.');
    } catch {
      this.fail('Could not stop the session.');
    }
  }

  public async send(content: string): Promise<boolean> {
    if (
      this.store.markedTabId() &&
      this.store.workspace() !== this.tabs.activeWorkspacePath
    ) {
      this.store.setToast({
        message:
          'Command Center is switching to the selected workspace. Send again when it is ready.',
        tone: 'error',
      });
      return false;
    }
    const workspaceAtStart = this.tabs.activeWorkspacePath;
    const markedTabId = this.store.markedTabId();
    const tabId = markedTabId ?? (await this.openOrResume());
    if (!markedTabId && this.tabs.activeWorkspacePath !== workspaceAtStart) {
      this.store.setToast({
        message:
          'Command Center is switching to the selected workspace. Send again when it is ready.',
        tone: 'error',
      });
      return false;
    }
    if (!tabId) return false;
    const workspace = this.store.workspace();
    const bindingIsCurrent = () =>
      this.store.markedTabId() === tabId &&
      this.store.workspace() === workspace;
    try {
      const result = await this.sender.send(content, {
        tabId,
        ownerToken: this.ownerToken,
      });
      if (!result.success) {
        if (bindingIsCurrent())
          this.fail('Could not send the Command Center message.');
        return false;
      }
      if (!bindingIsCurrent()) return true;
      const sessionId =
        this.tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.claudeSessionId ??
        null;
      this.store.setSession(tabId, sessionId, workspace);
      this.store.setSessionStatus('running');
      return true;
    } catch {
      // degradation-audit: reported — send failure is shown through the safe fail message
      if (bindingIsCurrent())
        this.fail('Could not send the Command Center message.');
      return false;
    }
  }

  public sendStatusTurn(content: string): Promise<boolean> {
    const block = this.statusContextProvider?.();
    return this.send(block ? `${block}\n\n${content}` : content);
  }

  /** Called once by the proposal owner after registration; this method never answers Confirm. */
  public sendLaunchTurn(content: string): Promise<boolean> {
    return this.send(content);
  }

  public answerQuestion(
    response: Parameters<ChatStore['handleQuestionResponse']>[0],
  ): void {
    const tabId = this.store.markedTabId();
    if (tabId) this.chat.handleQuestionResponse(response, tabId);
  }

  private fail(message: string): void {
    this.store.setSessionStatus('error');
    this.store.setToast({ message, tone: 'error' });
  }
}
