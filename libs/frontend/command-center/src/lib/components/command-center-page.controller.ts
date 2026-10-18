import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  CommandCenterVoiceSessionService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ChatStore } from '@ptah-extension/chat';
import {
  AppStateManager,
  ClaudeRpcService,
  ThemeService,
} from '@ptah-extension/core';
import { CommandCenterStore } from '../model/command-center.store';
import { summarizeVoiceProviders } from '../model/voice-provider-summary';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { buildStatusContext } from '../model/status-context';
import {
  computeAgesMs,
  projectOwnedWork,
  rootWorkState,
} from '../model/work-projection';
import { CommandVoiceLoop } from '../voice/command-voice-loop';
import { hasTribunalIntent } from './command-center-tribunal-intent';
import { commandCenterClock } from './command-center-clock';
import {
  CommandCenterRosterProvider,
  isRosterIdleWithoutPendingRequest,
} from './command-center-roster.provider';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import { CommandCenterProjectionSource } from './command-center-projection.source';
import {
  shownSessionStatus,
  trackMarkedTabVisibility,
  trackTurnStatus,
} from './command-center-turn-status';
import { trackWorkspaceBinding } from './command-center-workspace-binding';

/** State and transport owned by one routed page lifetime. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterPageController {
  public readonly store = inject(CommandCenterStore);
  public readonly tabs = inject(TabManagerService);
  public readonly coordinator = inject(CommandCenterSessionCoordinator);
  private readonly workspaceBinding = trackWorkspaceBinding(
    this.tabs,
    this.store,
    this.coordinator,
  );
  private readonly rpc = inject(ClaudeRpcService);
  private readonly theme = inject(ThemeService, { optional: true });
  private readonly appState = inject(AppStateManager, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly chat = inject(ChatStore);
  private readonly voiceSessions = inject(CommandCenterVoiceSessionService);
  private readonly tribunalTransport = inject(CommandCenterTribunalTransport);
  private readonly projectionSource = inject(CommandCenterProjectionSource);
  private readonly now = commandCenterClock();
  private readonly roster: CommandCenterRosterProvider =
    new CommandCenterRosterProvider(
      this.store,
      this.tabs,
      this.chat,
      this.tribunalTransport,
      this.destroyRef,
      (): CommandVoiceLoop => this.voice,
    );
  public readonly tribunal = this.roster.tribunal;
  public readonly pendingProposal = this.roster.pendingProposal;
  public readonly rosterTimedOut = this.roster.rosterTimedOut;
  public readonly turnAbortable = computed(() => {
    const tabId = this.store.markedTabId();
    return (
      !!tabId &&
      this.tabs
        .tabs()
        .some((tab) => tab.id === tabId && tab.status === 'streaming')
    );
  });
  public readonly shownSessionStatus = shownSessionStatus(
    this.tabs,
    this.store,
  );
  public readonly canvasUnavailable = signal(false);
  public readonly hoveredNodeId = signal<string | null>(null);
  public readonly recordWriteFailure =
    this.tabs.commandCenterRecordWriteFailure;
  public readonly latestReply = computed(() => {
    const tabId = this.store.markedTabId();
    const pulse = tabId
      ? this.tabs.lastTerminalPulseByTab().get(tabId)
      : undefined;
    return pulse?.classification === 'success'
      ? (pulse.lastAssistantMessage ?? null)
      : null;
  });
  private readonly voiceTurnToken = signal<number | null>(null);
  /** Each entry belongs to the tab active at send time, even after a rebind. */
  private readonly armedTurns: {
    tabId: string;
    token: number;
    minPulseSeq: number;
    graceEligible: boolean;
  }[] = [];
  private deliveredPulseSeq = 0;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private stoppedTabId: string | null = null;
  private voicePreSendSeq: number | null = null;
  private previousMarkedTabId: string | null = null;
  public readonly ordinaryQuestion = this.roster.ordinaryQuestion;
  public readonly ordinaryChoices = this.roster.ordinaryChoices;
  public readonly permissionRequest = this.roster.permissionRequest;
  public readonly shownInput = this.roster.shownInput;
  public readonly shownProposal = this.roster.shownProposal;
  public readonly undeclinedInvalidQuestionId =
    this.roster.undeclinedInvalidQuestionId;
  public readonly projection = computed(() => {
    const tabId = this.store.markedTabId();
    const root = this.tabs.tabs().find((tab) => tab.id === tabId);
    const rootSessionId = root?.claudeSessionId ?? this.store.sessionId();
    if (!root) return { nodes: [], edges: [] };
    const rootQuestionPending = this.chat
      .questionRequests()
      .some(
        (request) =>
          request.tabId === root.id ||
          (!!rootSessionId && request.sessionId === rootSessionId),
      );
    if (!rootSessionId)
      return {
        nodes: [
          {
            id: `root:${root.id}`,
            kind: 'root' as const,
            parentId: null,
            label: 'Ptah',
            providerId: null,
            state: rootWorkState(root.status, rootQuestionPending),
          },
        ],
        edges: [],
      };
    return projectOwnedWork({
      ...this.projectionSource.input(
        { tabId: root.id, sessionId: rootSessionId },
        this.now(),
      ),
      rootTabStatus: root.status,
      rootQuestionPending,
    });
  });
  public readonly voice: CommandVoiceLoop = new CommandVoiceLoop(
    this.store,
    this.coordinator,
    this.rpc,
    {
      answerOrdinaryQuestion: (transcript) => {
        const request = this.ordinaryQuestion();
        return request
          ? this.answerOrdinaryQuestion(request.id, transcript)
          : false;
      },
      onVoiceSend: (token, minPulseSeq) => {
        const tabId = this.store.markedTabId() ?? '';
        this.armedTurns.push({
          tabId,
          token,
          minPulseSeq:
            minPulseSeq ??
            this.voicePreSendSeq ??
            Math.max(
              this.deliveredPulseSeq,
              this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0,
            ),
          graceEligible: false,
        });
        if (minPulseSeq === undefined) this.voicePreSendSeq = null;
        this.voiceTurnToken.set(this.armedTurns[0]?.token ?? null);
      },
      onTurnsAbandoned: () => this.clearArmedTurns(),
      sendTranscript: (transcript) => this.sendCommand(transcript, 'voice'),
    },
  );

  public constructor() {
    effect(() =>
      this.store.setTheme(this.theme?.isDarkMode() ? 'dark' : 'light'),
    );
    if (typeof window !== 'undefined' && window.matchMedia) {
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => this.store.setReducedMotion(motion.matches);
      update();
      motion.addEventListener('change', update);
      this.destroyRef.onDestroy(() =>
        motion.removeEventListener('change', update),
      );
    }
    this.coordinator.setStatusContextProvider(() =>
      buildStatusContext(
        this.store.nodes(),
        computeAgesMs(this.store.nodes(), Date.now()),
      ),
    );
    trackMarkedTabVisibility(this.tabs, this.store);
    effect(() => {
      const projection = this.projection();
      const rootId = projection.nodes[0]?.id;
      if (!rootId) return;
      this.store.setProjection(rootId, projection.nodes, projection.edges);
      this.voice.onProjection(rootId);
    });
    effect(() => {
      const tabId = this.store.markedTabId();
      if (this.previousMarkedTabId && tabId !== this.previousMarkedTabId) {
        this.voiceSessions.deactivate(this.previousMarkedTabId);
        this.deliveredPulseSeq = 0;
        this.teardownSessionState(false);
        // degradation-audit: reported — voice exit failure is shown through the safe toast
        void this.voice.exit().catch(() =>
          this.store.setToast({
            message: 'Could not stop voice capture.',
            tone: 'error',
          }),
        );
      }
      this.previousMarkedTabId = tabId;
    });
    trackTurnStatus(this.tabs, this.store, this.turnAbortable);
    effect(() => {
      const tabId = this.store.markedTabId();
      const token = this.voiceTurnToken();
      if (!tabId || token === null) return;
      const armed = this.armedTurns[0];
      if (!armed || armed.tabId !== tabId) return;
      const candidate = this.tabs.lastTerminalPulseByTab().get(tabId);
      const pulse =
        candidate &&
        candidate.seq > armed.minPulseSeq &&
        candidate.seq > this.deliveredPulseSeq
          ? candidate
          : null;
      if (!pulse) return;
      this.clearGraceTimer();
      this.deliveredPulseSeq = pulse.seq;
      this.armedTurns.shift();
      this.voiceTurnToken.set(this.armedTurns[0]?.token ?? null);
      if (pulse.classification === 'success')
        this.voice.onTurnBoundary(pulse.lastAssistantMessage ?? '', token);
      else
        this.voice.abandonTurn(
          token,
          this.stoppedTabId === tabId ||
            pulse.terminalReason === 'aborted_streaming' ||
            pulse.terminalReason === 'aborted_tools'
            ? 'aborted'
            : 'failed',
        );
      this.stoppedTabId = null;
    });
    effect(() => {
      this.voiceTurnToken();
      const armed = this.armedTurns[0];
      const tabId = this.store.markedTabId();
      const idle = isRosterIdleWithoutPendingRequest(
        this.tabs,
        this.chat,
        tabId,
        this.store.sessionId(),
      );
      if (!armed || armed.tabId !== tabId) {
        this.clearGraceTimer();
        return;
      }
      if (!idle) {
        const status = this.tabs.tabs().find((tab) => tab.id === tabId)?.status;
        if (
          status &&
          status !== 'loaded' &&
          status !== 'fresh' &&
          status !== 'draft'
        )
          armed.graceEligible = true;
        this.clearGraceTimer();
        return;
      }
      if (!armed.graceEligible) {
        this.clearGraceTimer();
        return;
      }
      const pulseSeq = this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0;
      if (pulseSeq > armed.minPulseSeq) {
        this.clearGraceTimer();
        return;
      }
      if (this.graceTimer) return;
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (
          this.armedTurns[0] !== armed ||
          this.store.markedTabId() !== tabId ||
          !isRosterIdleWithoutPendingRequest(
            this.tabs,
            this.chat,
            tabId,
            this.store.sessionId(),
          )
        )
          return;
        this.armedTurns.shift();
        this.voiceTurnToken.set(this.armedTurns[0]?.token ?? null);
        this.voice.abandonTurn(armed.token, 'timed-out');
      }, 12_000);
    });
    this.destroyRef.onDestroy(() => {
      this.clearGraceTimer();
      const tabId = this.store.markedTabId();
      if (tabId) this.voiceSessions.deactivate(tabId);
    });
  }

  public async open(): Promise<string | null> {
    const tabId = await this.workspaceBinding.open();
    void this.tribunalTransport.open().catch(() => {
      this.store.setToast({
        message: 'Tribunal is unavailable right now.',
        tone: 'error',
      });
    });
    try {
      const response = await this.rpc.call(
        'voice:getProviderConfig',
        {},
        { timeout: 10_000 },
      );
      this.store.setProvider(
        summarizeVoiceProviders(
          response.success && response.data?.ok ? response.data.config : null,
        ),
      );
    } catch {
      // degradation-audit: reported — voice remains unavailable; text and graph stay usable
      this.store.setProvider(summarizeVoiceProviders(null));
    }
    return tabId;
  }
  public startVoice(): Promise<boolean> {
    const rootTabId = this.store.markedTabId();
    this.stoppedTabId = null;
    if (this.store.voiceError()) {
      this.store.setVoiceError(null);
      this.store.setToast(null);
    }
    return this.voice.start().then((started) => {
      if (started && rootTabId && this.store.markedTabId() === rootTabId)
        this.voiceSessions.activate(rootTabId);
      return started;
    });
  }
  public muteVoice(): Promise<void> {
    const tabId = this.store.markedTabId();
    if (tabId) this.voiceSessions.deactivate(tabId);
    this.clearArmedTurns();
    return this.voice.mute();
  }
  public toggleMuteVoice(): Promise<void | boolean> {
    return this.store.muted() ? this.startVoice() : this.muteVoice();
  }
  public stopVoice(): Promise<void> {
    this.stoppedTabId = this.store.markedTabId();
    if (this.stoppedTabId) this.voiceSessions.deactivate(this.stoppedTabId);
    const active = this.armedTurns[0];
    if (active) this.voice.abandonTurn(active.token, 'aborted');
    this.clearArmedTurns();
    return this.voice.stop();
  }
  public interruptSpeech(): void {
    this.voice.interruptSpeech();
  }
  public openVoiceSettings(): void {
    this.appState?.setCurrentView('settings');
  }
  public retrySpeech(): void {
    this.voice.retrySpeech();
  }
  public answerOrdinaryQuestion(id: string, answer: string): boolean {
    const request = this.ordinaryQuestion();
    const question = request?.questions[0];
    if (!request || !question || request.id !== id) return false;
    if (
      this.roster.tribunalRequestActive() &&
      question.options.some((option) => /\bconfirm\b/i.test(option.label)) &&
      /^(confirm|yes|approve|go ahead)\b/i.test(answer.trim())
    )
      return false;
    this.coordinator.answerQuestion({
      id,
      answers: { [question.question]: answer },
    });
    return true;
  }
  public answerPermission(id: string, answer: string): boolean {
    const request = this.permissionRequest();
    if (
      !request ||
      request.id !== id ||
      (answer !== 'Approve' && answer !== 'Deny')
    )
      return false;
    this.chat.handlePermissionResponse({
      id,
      decision: answer === 'Approve' ? 'allow' : 'deny',
    });
    return true;
  }
  public async sendCommand(
    content: string,
    source: 'text' | 'voice' = 'text',
  ): Promise<boolean> {
    if (!this.workspaceBinding.canSend()) return false;
    if (this.undeclinedInvalidQuestionId()) {
      this.store.setToast({
        message:
          'Invalid Tribunal proposal is awaiting Decline. Retry the Decline before sending.',
        tone: 'error',
        action: 'retry-decline',
      });
      return false;
    }
    this.stoppedTabId = null;
    const tabId = this.store.markedTabId();
    const minPulseSeq = tabId
      ? (this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0)
      : 0;
    if (source === 'voice') this.voicePreSendSeq = minPulseSeq;
    if (!hasTribunalIntent(content)) {
      const sent = await this.coordinator.send(content);
      if (!sent && source === 'voice') this.voicePreSendSeq = null;
      if (sent && source === 'text') this.voice.armTypedTurn(minPulseSeq);
      return sent;
    }
    const sent = await this.roster.sendRequest(content, this.coordinator);
    if (!sent && source === 'voice') this.voicePreSendSeq = null;
    if (sent && source === 'text') this.voice.armTypedTurn(minPulseSeq);
    return sent;
  }
  public confirmProposal(id: string): Promise<void> {
    if (!this.workspaceBinding.canSend()) return Promise.resolve();
    return this.roster.confirmProposal(id);
  }
  public declineProposal(id: string): void {
    this.roster.declineProposal(id);
  }
  public timeoutProposal(id: string): void {
    this.roster.timeoutProposal(id);
  }
  public retryInvalidDecline(): void {
    this.roster.retryInvalidDecline();
  }
  public getLatencyMarks(): ReturnType<CommandVoiceLoop['getLatencyMarks']> {
    return this.voice.getLatencyMarks();
  }
  public exit(): Promise<void> {
    const tabId = this.store.markedTabId();
    if (tabId) this.voiceSessions.deactivate(tabId);
    this.teardownSessionState(true);
    return this.voice.exit();
  }
  private teardownSessionState(pageLeave: boolean): void {
    this.clearArmedTurns();
    this.roster.teardown(pageLeave);
  }
  private clearArmedTurns(): void {
    this.clearGraceTimer();
    this.armedTurns.length = 0;
    this.voiceTurnToken.set(null);
  }
  private clearGraceTimer(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }
}
