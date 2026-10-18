import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { ChatStore, MessageSenderService } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  CommandCenterSendLockService,
  TabId,
  TabManagerService,
  commandCenterPersonaFor,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SessionId, type ChatSessionSummary } from '@ptah-extension/shared';
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
  private sessionListRequest = 0;
  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);
  public readonly sessions = this._sessions.asReadonly();
  private readonly _listStatus = signal<'loading' | 'ready' | 'error'>(
    'loading',
  );
  public readonly listStatus = this._listStatus.asReadonly();
  public readonly showAll = signal(false);
  public readonly choosing = signal(false);
  public readonly currentTabId = signal<string | null>(null);
  public readonly currentSessionId = signal<string | null>(null);
  public readonly recordedSessionId = signal<string | null>(null);
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

  /** Enter the page without selecting a session. */
  public async openStart(): Promise<string | null> {
    const workspace = this.tabs.activeWorkspacePath;
    this.stopVoiceLocally();
    this.store.setSession(null, null, workspace);
    this.showAll.set(false);
    if (!workspace) {
      this._sessions.set([]);
      this._listStatus.set('error');
      this.currentTabId.set(null);
      this.currentSessionId.set(null);
      this.fail('Open a workspace to use Command Center.');
      return null;
    }
    this.store.setSessionStatus('idle');
    const activeId = this.records.readActiveTabId(workspace);
    const current = this.tabs
      .tabs()
      .find(
        (tab) =>
          tab.id === activeId &&
          tab.commandCenterOrigin?.workspaceId === workspace &&
          commandCenterPersonaFor(tab) !== undefined,
      );
    this.currentTabId.set(current?.id ?? null);
    this.currentSessionId.set(current?.claudeSessionId ?? null);
    this.recordedSessionId.set(
      this.records.readLastSession(workspace)?.sdkSessionId ?? null,
    );
    await this.refreshSessions(workspace);
    return null;
  }

  public async refreshSessions(
    workspace = this.tabs.activeWorkspacePath,
  ): Promise<void> {
    if (!workspace) {
      this._listStatus.set('error');
      return;
    }
    const request = ++this.sessionListRequest;
    this._listStatus.set('loading');
    try {
      const sessions: ChatSessionSummary[] = [];
      const all = this.showAll();
      const limit = all ? 50 : 10;
      let hasMore: boolean;
      do {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let result;
        try {
          result = await this.rpc.call(
            'session:list',
            { workspacePath: workspace, limit, offset: sessions.length },
            { signal: controller.signal },
          );
        } finally {
          clearTimeout(timeout);
        }
        if (
          request !== this.sessionListRequest ||
          this.tabs.activeWorkspacePath !== workspace
        )
          return;
        if (!result.success || !Array.isArray(result.data?.sessions))
          throw new Error('session list unavailable');
        sessions.push(...result.data.sessions);
        hasMore = all && result.data.hasMore && result.data.sessions.length > 0;
      } while (hasMore);
      if (
        request !== this.sessionListRequest ||
        this.tabs.activeWorkspacePath !== workspace
      )
        return;
      this._sessions.set(
        sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt),
      );
      this._listStatus.set('ready');
    } catch {
      // degradation-audit: reported — the start view shows a retry control without exposing RPC errors
      if (
        request === this.sessionListRequest &&
        this.tabs.activeWorkspacePath === workspace
      )
        this._listStatus.set('error');
    }
  }

  public openAllSessions(): void {
    this.showAll.set(true);
    void this.refreshSessions();
  }

  public async chooseSession(sessionId: string): Promise<string | null> {
    if (this.choosing()) return null;
    const workspace = this.tabs.activeWorkspacePath;
    if (!workspace) return null;
    this.choosing.set(true);
    try {
      const current = this.tabs
        .tabs()
        .find(
          (tab) =>
            tab.id === this.currentTabId() &&
            tab.claudeSessionId === sessionId &&
            tab.commandCenterOrigin?.workspaceId === workspace,
        );
      if (current) {
        this.tabs.switchTab(current.id);
        if (current.messages.length === 0 && !current.hasLiveSession) {
          try {
            await this.chat.switchSession(SessionId.from(sessionId), {
              targetTabId: TabId.from(current.id),
            });
            if (this.tabs.activeWorkspacePath !== workspace) return null;
          } catch {
            // degradation-audit: reported — restore failure is shown through a fixed message
            this.store.setSession(null, null, workspace);
            this.fail('Could not restore the Command Center session.');
            return null;
          }
        }
        this.store.setSession(current.id, sessionId, workspace);
        this.store.setSessionStatus(
          current.status === 'streaming' ||
            current.status === 'awaiting-background' ||
            current.status === 'sleeping'
            ? 'running'
            : 'idle',
        );
        return current.id;
      }
      const openTab = this.tabs.findTabBySessionId(sessionId);
      if (openTab) {
        this.tabs.switchTab(openTab.id);
        this.fail(
          'This session is already open in another tab. Close it there to resume it in Command Center.',
        );
        return null;
      }
      const tabId = this.tabs.createCommandCenterTab('Command Center');
      this.tabs.attachSession(tabId, sessionId);
      this.tabs.switchTab(tabId);
      try {
        await this.chat.switchSession(SessionId.from(sessionId), {
          targetTabId: TabId.from(tabId),
        });
        if (this.tabs.activeWorkspacePath !== workspace) return null;
        this.store.setSession(tabId, sessionId, workspace);
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
        // degradation-audit: reported — restore failure is shown through a fixed message
        this.tabs.forceCloseTab(tabId);
        this.lock.clearForRoot(tabId);
        if (this.records.readActiveTabId(workspace) === tabId)
          this.records.setActiveTabId(workspace, null);
        if (this.currentTabId() === tabId) this.currentTabId.set(null);
        this.fail('Could not restore the Command Center session.');
        return null;
      }
    } finally {
      this.choosing.set(false);
    }
  }

  public chooseCurrentTab(): string | null {
    const workspace = this.tabs.activeWorkspacePath;
    const tab = this.tabs
      .tabs()
      .find(
        (candidate) =>
          candidate.id === this.currentTabId() &&
          candidate.commandCenterOrigin?.workspaceId === workspace,
      );
    if (!tab || !workspace) return null;
    if (tab.claudeSessionId) {
      void this.chooseSession(tab.claudeSessionId);
      return tab.id;
    }
    this.tabs.switchTab(tab.id);
    this.store.setSession(tab.id, null, workspace);
    this.store.setSessionStatus('idle');
    return tab.id;
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
    const tabId = markedTabId ?? this.newCommandCenter();
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
