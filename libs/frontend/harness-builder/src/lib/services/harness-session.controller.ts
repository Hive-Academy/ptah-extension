import {
  computed,
  effect,
  inject,
  Injectable,
  Injector,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { SessionId, type NewProjectIntake } from '@ptah-extension/shared';
import {
  canonicalHarnessRoot,
  HarnessBuilderRecordsService,
  type HarnessBuilderMode,
  type HarnessSessionRecord,
} from './harness-builder-records.service';
import { HarnessRpcService } from './harness-rpc.service';
import { formatIntakeSummary } from './new-project-intake';

export type HarnessSessionPhase =
  'idle' | 'sending' | 'busy' | 'cancelling' | 'failed' | 'done';
export interface HarnessApplyReceipt {
  readonly revisionId: string;
  readonly appliedPaths: readonly string[];
  readonly warnings: readonly string[];
  readonly appliedAt: string;
}
export type HarnessSessionStart =
  | {
      readonly mode: 'new-project';
      readonly workspaceRoot: string;
      readonly intake: NewProjectIntake;
    }
  | {
      readonly mode: 'configure-harness';
      readonly workspaceRoot: string;
      readonly intent: string;
    };
export type HarnessSessionStartOutcome =
  | { readonly kind: 'started' | 'reused'; readonly tabId: string }
  | {
      readonly kind: 'conflict';
      readonly otherMode: HarnessBuilderMode;
      readonly otherTabId: string;
    }
  | { readonly kind: 'failed'; readonly error: string };
export type HarnessRestoreOutcome =
  | 'ready'
  | 'restore-draft'
  | 'missing'
  | 'workspace-mismatch'
  | 'wrong-mode'
  | 'proposal-unavailable';
export interface HarnessModeSession {
  readonly mode: HarnessBuilderMode;
  readonly record: Signal<HarnessSessionRecord | null>;
  readonly phase: Signal<HarnessSessionPhase>;
  readonly error: Signal<string | null>;
  readonly latestAssistantMessage: Signal<{
    readonly id: string;
    readonly text: string;
  } | null>;
  start(request: HarnessSessionStart): Promise<HarnessSessionStartOutcome>;
  restore(tabId: string): Promise<HarnessRestoreOutcome>;
  send(text: string): Promise<boolean>;
  retrySend(): Promise<boolean>;
  stop(): Promise<'stopped' | 'uncertain'>;
  attachView(): () => void;
  recordApply(receipt: HarnessApplyReceipt): void;
}

const workflow = (mode: HarnessBuilderMode) =>
  mode === 'new-project' ? 'harness-new-project' : 'harness-configure';

/** Session ownership lives here, independently of a mounted transcript. */
@Injectable({ providedIn: 'root' })
export class HarnessSessionController {
  private readonly tabs = inject(TabManagerService);
  private readonly chat = inject(ChatStore);
  private readonly chatRpc = inject(ClaudeRpcService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly logger = inject(LoggingService);
  private readonly injector = inject(Injector);
  private readonly sessions = new Map<HarnessBuilderMode, HarnessModeSession>();
  private readonly inFlight = new Set<string>();
  private readonly starts = new Map<
    string,
    Promise<HarnessSessionStartOutcome>
  >();
  private readonly failedBubbles = new Map<string, string>();

  session(mode: HarnessBuilderMode): HarnessModeSession {
    const existing = this.sessions.get(mode);
    if (existing) return existing;
    const record = signal<HarnessSessionRecord | null>(null);
    const phase = signal<HarnessSessionPhase>('idle');
    const error = signal<string | null>(null);
    const session: HarnessModeSession = {
      mode,
      record: record.asReadonly(),
      phase: phase.asReadonly(),
      error: error.asReadonly(),
      latestAssistantMessage: computed(() => {
        const tabId = record()?.tabId;
        const tab = this.tabs.tabs().find((item) => item.id === tabId);
        const message = tab?.messages
          .filter((item) => item.role === 'assistant')
          .at(-1);
        return message
          ? { id: message.id, text: message.rawContent ?? '' }
          : null;
      }),
      start: (request) => this.start(mode, request, record, phase, error),
      restore: (tabId) => this.restore(mode, tabId, record, phase),
      send: (text) => this.send(mode, text, record, phase, error),
      retrySend: () => this.retrySend(mode, record, phase, error),
      stop: () => this.stop(record, phase, error),
      attachView: () => {
        const tabId = record()?.tabId;
        if (!tabId) return () => undefined;
        this.tabs.registerVisibleTab(tabId);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.tabs.unregisterVisibleTab(tabId);
        };
      },
      recordApply: (receipt) => {
        const current = record();
        if (!current) {
          error.set('The apply receipt could not be saved. Try again.');
          this.log(
            'Could not save apply receipt',
            new Error('No active session'),
          );
          return;
        }
        const next = {
          ...current,
          appliedRevisionId: receipt.revisionId,
          applyReceipt: {
            ...receipt,
            appliedPaths: [...receipt.appliedPaths],
            warnings: [...receipt.warnings],
          },
        };
        if (this.records.writeSession(next)) {
          record.set(next);
          error.set(null);
        } else {
          error.set('The apply receipt could not be saved. Try again.');
          this.log(
            'Could not save apply receipt',
            new Error('Session record write failed'),
          );
        }
      },
    };
    effect(
      () => {
        const current = record();
        const tab = this.tabs.tabs().find((item) => item.id === current?.tabId);
        if (current && !this.tabs.findTabByIdAcrossWorkspaces(current.tabId)) {
          this.clearFailedBubbles(current.tabId);
          record.set(null);
          return;
        }
        if (
          !current ||
          !tab?.claudeSessionId ||
          current.sessionId === tab.claudeSessionId
        )
          return;
        const next = { ...current, sessionId: tab.claudeSessionId };
        if (this.records.writeSession(next)) record.set(next);
      },
      { injector: this.injector },
    );
    this.sessions.set(mode, session);
    return session;
  }

  activeSessionIn(
    workspaceRoot: string,
  ): { mode: HarnessBuilderMode; tabId: string } | null {
    const root = canonicalHarnessRoot(workspaceRoot);
    for (const tab of this.tabs.tabs()) {
      const mode =
        tab.workflow === 'harness-new-project'
          ? 'new-project'
          : tab.workflow === 'harness-configure'
            ? 'configure-harness'
            : null;
      if (
        mode &&
        tab.id !== this.records.readDraft(root, mode)?.tabId &&
        canonicalHarnessRoot(
          this.tabs.findTabByIdAcrossWorkspaces(tab.id)?.workspacePath ??
            this.tabs.activeWorkspacePath ??
            '',
        ) === root
      )
        return { mode, tabId: tab.id };
    }
    return null;
  }

  async leave(
    mode: HarnessBuilderMode,
    choice: 'save' | 'discard',
  ): Promise<'left' | 'uncertain' | 'save-failed'> {
    const session = this.session(mode);
    const current = session.record();
    if (!current) return 'left';
    if ((await session.stop()) === 'uncertain') return 'uncertain';
    if (
      choice === 'save' &&
      !this.records.replaceDraft(current.workspacePath, mode, current.tabId)
    )
      return 'save-failed';
    if (choice === 'discard') {
      await this.tabs.closeTab(current.tabId);
      this.records.clearTab(current.workspacePath, current.tabId);
      this.clearFailedBubbles(current.tabId);
    }
    return 'left';
  }

  private async start(
    mode: HarnessBuilderMode,
    request: HarnessSessionStart,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<HarnessSessionStartOutcome> {
    const key = canonicalHarnessRoot(request.workspaceRoot);
    const pending = this.starts.get(key);
    if (pending) {
      await pending;
      return this.start(mode, request, record, phase, error);
    }
    const task = this.startInternal(mode, request, record, phase, error);
    this.starts.set(key, task);
    try {
      return await task;
    } finally {
      this.starts.delete(key);
    }
  }

  private async startInternal(
    mode: HarnessBuilderMode,
    request: HarnessSessionStart,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<HarnessSessionStartOutcome> {
    record.set(null);
    phase.set('idle');
    error.set(null);
    const root = canonicalHarnessRoot(request.workspaceRoot);
    if (!root || request.mode !== mode)
      return { kind: 'failed', error: 'Open a workspace before starting.' };
    const content =
      request.mode === 'new-project'
        ? formatIntakeSummary(request.intake)
        : request.intent.trim();
    const hash = this.hash(content);
    const active = this.activeSessionIn(root);
    if (active && active.mode !== mode)
      return {
        kind: 'conflict',
        otherMode: active.mode,
        otherTabId: active.tabId,
      };
    if (active) {
      const saved = this.records.readSession(root, active.tabId);
      if (saved) {
        record.set(saved);
        if (saved.intakeHash === hash) {
          this.reconcile(saved, record, phase);
          return { kind: 'reused', tabId: active.tabId };
        }
        return {
          kind: 'failed',
          error: 'This session already has a different brief.',
        };
      }
    }
    try {
      const started =
        request.mode === 'new-project'
          ? await this.rpc.startNewProject(request.intake)
          : null;
      if (request.mode === 'new-project' && (!started || !started.success))
        return {
          kind: 'failed',
          error: 'Could not start New Project. Try again.',
        };
      const preamble =
        request.mode === 'configure-harness'
          ? (
              await this.rpc.workflowPrompt({
                mode: 'configure-harness',
                contextOnly: true,
              })
            ).prompt
          : started?.success
            ? started.seedPrompt
            : '';
      if (canonicalHarnessRoot(this.tabs.activeWorkspacePath ?? '') !== root)
        return { kind: 'failed', error: 'The workspace changed. Try again.' };
      const tabId = this.tabs.createTab(
        mode === 'new-project' ? 'New Project' : 'AI Team Builder',
      );
      this.tabs.setWorkflow(tabId, workflow(mode));
      this.tabs.setFirstMessagePreamble(tabId, preamble);
      const next: HarnessSessionRecord = {
        version: 1,
        tabId,
        mode,
        workspacePath: root,
        intakeHash: hash,
        sendAttempt: { count: 0 },
        ...(request.mode === 'new-project'
          ? { intake: request.intake }
          : { teamIntent: content }),
      };
      if (!this.records.writeSession(next)) {
        await this.tabs.closeTab(tabId);
        return {
          kind: 'failed',
          error: 'Could not save this session. Try again.',
        };
      }
      record.set(next);
      if (started?.success)
        this.records.writeStackProfile(root, tabId, started);
      if (
        content &&
        !(await this.firstSend(next, content, record, phase, error))
      )
        return {
          kind: 'failed',
          error: error() ?? 'The first message could not be sent. Retry send.',
        };
      return { kind: 'started', tabId };
    } catch (cause: unknown) {
      this.log('Could not start harness session', cause);
      phase.set('failed');
      error.set('The builder could not be opened. Try again.');
      return {
        kind: 'failed',
        error: error() ?? 'The builder could not be opened. Try again.',
      };
    }
  }

  private async firstSend(
    current: HarnessSessionRecord,
    content: string,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<boolean> {
    const key = `${current.tabId}\u0000${current.intakeHash}`;
    if (this.inFlight.has(key)) return false;
    if (this.reconcile(current, record, phase)) return true;
    this.inFlight.add(key);
    phase.set('sending');
    error.set(null);
    let before: Set<string> | null = null;
    try {
      const ready = await this.waitReady(current);
      if (!ready) throw new Error('Tab readiness timeout');
      before = new Set(ready.messages.map((item) => item.id));
      const attempt = {
        ...current,
        sendAttempt: { count: current.sendAttempt.count + 1 },
      };
      if (!this.records.writeSession(attempt))
        throw new Error('Session record write failed');
      record.set(attempt);
      const result = await this.chat.sendOrQueueMessage(content, {
        tabId: current.tabId,
      });
      if (!result.success) throw new Error('Chat send rejected');
      const accepted = {
        ...attempt,
        sendAttempt: {
          ...attempt.sendAttempt,
          ackedAt: new Date().toISOString(),
        },
      };
      this.records.writeSession(accepted);
      record.set(accepted);
      phase.set('busy');
      return true;
    } catch (cause: unknown) {
      // degradation-audit: reported — the failed phase and retry message are shown in the session UI.
      const seen = before;
      if (seen) {
        const after =
          this.tabs.findTabByIdAcrossWorkspaces(current.tabId)?.tab.messages ??
          [];
        const failed = after
          .filter((item) => item.role === 'user' && !seen.has(item.id))
          .at(-1);
        if (failed) this.failedBubbles.set(key, failed.id);
      }
      this.log('First send failed', cause);
      phase.set('failed');
      error.set('The first message could not be sent. Retry send.');
      return false;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async waitReady(current: HarnessSessionRecord) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = this.tabs.findTabByIdAcrossWorkspaces(current.tabId);
      const root = canonicalHarnessRoot(
        found?.workspacePath ?? this.tabs.activeWorkspacePath ?? '',
      );
      if (
        found &&
        root === current.workspacePath &&
        found.tab.status !== 'switching' &&
        found.tab.status !== 'resuming'
      )
        return found.tab;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  private reconcile(
    current: HarnessSessionRecord,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
  ): boolean {
    const tab = this.tabs.findTabByIdAcrossWorkspaces(current.tabId)?.tab;
    const content =
      current.mode === 'new-project' && current.intake
        ? formatIntakeSummary(current.intake)
        : (current.teamIntent ?? '');
    const failed = this.failedBubbles.get(
      `${current.tabId}\u0000${current.intakeHash}`,
    );
    const accepted =
      !!current.sendAttempt.ackedAt ||
      !!tab?.claudeSessionId ||
      tab?.status === 'streaming' ||
      !!tab?.messages.some(
        (item) =>
          item.role === 'user' &&
          item.rawContent === content &&
          item.id !== failed,
      );
    if (accepted) {
      this.failedBubbles.delete(`${current.tabId}\u0000${current.intakeHash}`);
      const next = current.sendAttempt.ackedAt
        ? current
        : {
            ...current,
            sessionId: tab?.claudeSessionId ?? current.sessionId,
            sendAttempt: {
              ...current.sendAttempt,
              ackedAt: new Date().toISOString(),
            },
          };
      if (next !== current) this.records.writeSession(next);
      record.set(next);
      phase.set(tab?.status === 'streaming' ? 'busy' : 'done');
    }
    return accepted;
  }

  private async retrySend(
    mode: HarnessBuilderMode,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<boolean> {
    const current = record();
    if (
      !current ||
      current.mode !== mode ||
      this.reconcile(current, record, phase)
    )
      return false;
    const tab = this.tabs.findTabByIdAcrossWorkspaces(current.tabId)?.tab;
    if (
      !tab ||
      canonicalHarnessRoot(
        this.tabs.findTabByIdAcrossWorkspaces(current.tabId)?.workspacePath ??
          this.tabs.activeWorkspacePath ??
          '',
      ) !== current.workspacePath
    )
      return false;
    const key = `${current.tabId}\u0000${current.intakeHash}`;
    const failedId = this.failedBubbles.get(key);
    if (failedId) {
      this.tabs.setMessages(
        current.tabId,
        tab.messages.filter((item) => item.id !== failedId),
      );
      this.failedBubbles.delete(key);
    }
    const text =
      mode === 'new-project' && current.intake
        ? formatIntakeSummary(current.intake)
        : (current.teamIntent ?? '');
    return !!text && this.firstSend(current, text, record, phase, error);
  }

  private async restore(
    mode: HarnessBuilderMode,
    tabId: string,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
  ): Promise<HarnessRestoreOutcome> {
    const root = canonicalHarnessRoot(this.tabs.activeWorkspacePath ?? '');
    const found = this.tabs.findTabByIdAcrossWorkspaces(tabId);
    if (found && canonicalHarnessRoot(found.workspacePath ?? root) !== root)
      return 'workspace-mismatch';
    if (found && found.tab.workflow !== workflow(mode)) {
      record.set(null);
      this.clearFailedBubbles(tabId);
      return 'wrong-mode';
    }
    const saved = this.records.readSession(root, tabId);
    if (!saved) {
      record.set(null);
      this.clearFailedBubbles(tabId);
      return this.records.readDraft(root, mode)?.tabId === tabId
        ? 'restore-draft'
        : 'missing';
    }
    if (saved.mode !== mode) {
      record.set(null);
      this.clearFailedBubbles(tabId);
      return 'wrong-mode';
    }
    if (!found) {
      record.set(null);
      this.clearFailedBubbles(tabId);
      return this.records.readDraft(root, mode)?.tabId === tabId
        ? 'restore-draft'
        : 'missing';
    }
    if (saved.sessionId) {
      try {
        const proposal = await this.rpc.getProposal(saved.sessionId, root);
        if (!proposal.proposal) return 'proposal-unavailable';
      } catch (cause: unknown) {
        // degradation-audit: reported — restore returns proposal-unavailable for the recovery screen and logs the cause.
        this.log('Proposal restore failed', cause);
        return 'proposal-unavailable';
      }
    }
    record.set(saved);
    this.reconcile(saved, record, phase);
    return 'ready';
  }

  private async send(
    mode: HarnessBuilderMode,
    text: string,
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<boolean> {
    const current = record();
    if (!current || current.mode !== mode || !text.trim()) return false;
    try {
      const result = await this.chat.sendOrQueueMessage(text, {
        tabId: current.tabId,
      });
      if (!result.success) throw new Error('Chat send rejected');
      phase.set('busy');
      error.set(null);
      return true;
    } catch (cause: unknown) {
      // degradation-audit: reported — the failed phase and retry message are shown in the session UI.
      this.log('Chat send failed', cause);
      phase.set('failed');
      error.set('The message could not be sent. Try again.');
      return false;
    }
  }

  private async stop(
    record: WritableSignal<HarnessSessionRecord | null>,
    phase: WritableSignal<HarnessSessionPhase>,
    error: WritableSignal<string | null>,
  ): Promise<'stopped' | 'uncertain'> {
    const current = record();
    if (!current) return 'stopped';
    const tab = this.tabs.findTabByIdAcrossWorkspaces(current.tabId)?.tab;
    const running = tab?.status === 'streaming' || tab?.status === 'resuming';
    if (
      !running &&
      (tab?.status === 'loaded' ||
        (phase() === 'done' && !!(tab?.claudeSessionId ?? current.sessionId)) ||
        (phase() === 'idle' && !current.sendAttempt.ackedAt))
    ) {
      phase.set('done');
      error.set(null);
      return 'stopped';
    }
    const sessionId = tab?.claudeSessionId ?? current.sessionId;
    if (!sessionId) {
      if (
        current.sendAttempt.ackedAt ||
        phase() === 'busy' ||
        phase() === 'sending' ||
        tab?.status === 'streaming'
      ) {
        phase.set('failed');
        error.set(
          'The agent may still be running. Retry stop or keep current.',
        );
        return 'uncertain';
      }
      phase.set('done');
      return 'stopped';
    }
    if (!SessionId.validate(sessionId)) {
      phase.set('failed');
      error.set('The agent may still be running. Retry stop or keep current.');
      return 'uncertain';
    }
    phase.set('cancelling');
    try {
      const result = await this.chatRpc.call('chat:abort', { sessionId });
      if (!result.success || result.data?.success === false)
        throw new Error('Chat abort failed');
      phase.set('done');
      error.set(null);
      return 'stopped';
    } catch (cause: unknown) {
      // degradation-audit: reported — the failed phase and uncertain-stop message are shown in the session UI.
      this.log('Chat abort failed', cause);
      phase.set('failed');
      error.set('The agent may still be running. Retry stop or keep current.');
      return 'uncertain';
    }
  }

  private hash(text: string): string {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++)
      value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
  }
  private clearFailedBubbles(tabId: string): void {
    for (const key of this.failedBubbles.keys())
      if (key.startsWith(`${tabId}\u0000`)) this.failedBubbles.delete(key);
  }
  private log(message: string, cause: unknown): void {
    this.logger.error(
      'HarnessSessionController',
      message,
      cause instanceof Error ? cause : new Error(String(cause)),
    );
  }
}
