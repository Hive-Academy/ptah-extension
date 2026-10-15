import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { buildStatusContext } from '../model/status-context';
import { computeAgesMs, projectOwnedWork } from '../model/work-projection';
import { CommandVoiceLoop } from '../voice/command-voice-loop';
import { TRIBUNAL_MOVES } from '@ptah-extension/tribunal-panel/phase';
import { TribunalRunCoordinator } from '../model/tribunal-run-coordinator';
import type { TribunalRosterProposal } from '../model/tribunal-roster-proposal';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import { CommandCenterProjectionSource } from './command-center-projection.source';

/** State and transport owned by one routed page lifetime. */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped provider
@Injectable()
export class CommandCenterPageController {
  public readonly store = inject(CommandCenterStore);
  public readonly tabs = inject(TabManagerService);
  public readonly coordinator = inject(CommandCenterSessionCoordinator);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly chat = inject(ChatStore);
  private readonly tribunalTransport = inject(CommandCenterTribunalTransport);
  private readonly projectionSource = inject(CommandCenterProjectionSource);
  public readonly tribunal = new TribunalRunCoordinator(this.tribunalTransport);
  public readonly pendingProposal = signal<TribunalRosterProposal | null>(null);
  private readonly expectedRequest = signal<{
    nonce: string;
    rootSessionId: string;
  } | null>(null);
  private handledRosterQuestionId: string | null = null;
  private rosterTimeout: ReturnType<typeof setTimeout> | null = null;
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
  private readonly armedTurns: { token: number; minPulseSeq: number }[] = [];
  private deliveredPulseSeq = 0;
  private readonly spokenRequestIds = new Set<string>();
  public readonly ordinaryQuestion = computed(() => {
    const tabId = this.store.markedTabId();
    const sessionId = this.store.sessionId();
    return (
      this.chat
        .questionRequests()
        .find(
          (request) =>
            (request.tabId === tabId || request.sessionId === sessionId) &&
            !!request.questions[0] &&
            !request.questions[0].question.includes(
              '<TRIBUNAL_ROSTER_PROPOSAL>',
            ),
        ) ?? null
    );
  });
  public readonly permissionRequest = computed(() => {
    const tabId = this.store.markedTabId();
    const sessionId = this.store.sessionId();
    return (
      this.chat
        .permissionRequests()
        .find((request) =>
          request.tabId
            ? request.tabId === tabId
            : !!sessionId && request.sessionId === sessionId,
        ) ?? null
    );
  });
  public readonly shownInput = computed(() => {
    const permission = this.permissionRequest();
    if (permission)
      return {
        id: permission.id,
        kind: 'approval' as const,
        title: `${permission.toolName} permission`,
        description: permission.description,
        prompt: `${permission.toolName} requests permission. Use the card to approve or deny.`,
      };
    const proposal = this.pendingProposal();
    if (proposal && this.handledRosterQuestionId)
      return {
        id: this.handledRosterQuestionId,
        kind: 'question' as const,
        title: 'Tribunal proposal',
        description: 'Review the roster before launch.',
        prompt: `Tribunal ${proposal.move} proposal. Review the pending card.`,
      };
    const request = this.ordinaryQuestion();
    const question = request?.questions[0];
    return request && question
      ? {
          id: request.id,
          kind: 'question' as const,
          title: question.header,
          description: question.question,
          prompt: question.question,
        }
      : null;
  });
  public readonly shownProposal = computed(() =>
    this.shownInput()?.kind === 'question' &&
    this.shownInput()?.id === this.handledRosterQuestionId
      ? this.pendingProposal()
      : null,
  );
  public readonly projection = computed(() => {
    const tabId = this.store.markedTabId();
    const root = this.tabs.tabs().find((tab) => tab.id === tabId);
    const rootSessionId = root?.claudeSessionId ?? this.store.sessionId();
    if (!root || !rootSessionId) return { nodes: [], edges: [] };
    return projectOwnedWork(
      this.projectionSource.input({ tabId: root.id, sessionId: rootSessionId }),
    );
  });
  public readonly voice = new CommandVoiceLoop(
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
      onVoiceSend: (token) => {
        const tabId = this.store.markedTabId();
        const minPulseSeq = Math.max(
          this.deliveredPulseSeq,
          tabId ? (this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0) : 0,
        );
        this.armedTurns.push({ token, minPulseSeq });
        this.voiceTurnToken.set(this.armedTurns[0]?.token ?? null);
      },
      sendTranscript: (transcript) => this.sendCommand(transcript, 'voice'),
    },
  );

  public constructor() {
    this.coordinator.setStatusContextProvider(() =>
      buildStatusContext(
        this.store.nodes(),
        computeAgesMs(this.store.nodes(), Date.now()),
      ),
    );
    effect(() => {
      const projection = this.projection();
      const rootId = projection.nodes[0]?.id;
      if (!rootId) return;
      this.store.setProjection(rootId, projection.nodes, projection.edges);
      this.voice.onProjection(rootId);
    });
    effect(() => {
      const tabId = this.store.markedTabId();
      const rootSessionId = this.store.sessionId();
      const expected = this.expectedRequest();
      const request = this.chat
        .questionRequests()
        .find(
          (item) =>
            item.tabId === tabId &&
            !!item.questions[0]?.question.includes(
              '<TRIBUNAL_ROSTER_PROPOSAL>',
            ),
        );
      const question = request?.questions[0];
      if (
        !request ||
        !question ||
        request.id === this.handledRosterQuestionId ||
        !tabId
      )
        return;
      this.handledRosterQuestionId = request.id;
      const proposal = this.tribunal.receive(question.question, {
        questionId: request.id,
        questionKey: question.question,
        rootSdkId: rootSessionId ?? '',
        rootTabId: tabId,
        workspace: this.store.workspace() ?? '',
        nonce: expected?.rootSessionId === rootSessionId ? expected.nonce : '',
        availability: this.tribunalTransport.availability(),
      });
      if (!proposal || !expected || expected.rootSessionId !== rootSessionId) {
        this.pendingProposal.set(null);
        this.store.setToast({
          message: 'Invalid Tribunal proposal. It was declined.',
          tone: 'error',
        });
        this.voice.onRosterProposal('Invalid Tribunal proposal.', false);
        this.voice.onRosterResolved();
        return;
      }
      this.pendingProposal.set(proposal);
      this.clearRosterTimeout();
      this.rosterTimeout = setTimeout(
        () => this.timeoutProposal(proposal.proposalId),
        120_000,
      );
    });
    effect(() => {
      const shown = this.shownInput();
      this.store.setPendingInput(
        shown
          ? {
              id: shown.id,
              kind: shown.kind,
              title: shown.title,
              description: shown.description,
            }
          : null,
      );
      if (shown && !this.spokenRequestIds.has(shown.id)) {
        this.spokenRequestIds.add(shown.id);
        if (shown.id === this.handledRosterQuestionId && this.pendingProposal())
          this.voice.onRosterProposal(shown.prompt, true);
        else this.voice.onPendingPrompt(shown.prompt);
      }
    });
    effect(() => {
      const tabId = this.store.markedTabId();
      const token = this.voiceTurnToken();
      if (!tabId || token === null) return;
      const candidate = this.tabs.lastTerminalPulseByTab().get(tabId);
      const pulse =
        candidate &&
        candidate.seq > (this.armedTurns[0]?.minPulseSeq ?? 0) &&
        candidate.seq > this.deliveredPulseSeq &&
        candidate.classification === 'success' &&
        candidate.lastAssistantMessage
          ? candidate
          : null;
      if (!pulse?.lastAssistantMessage) return;
      this.deliveredPulseSeq = pulse.seq;
      this.armedTurns.shift();
      this.voiceTurnToken.set(this.armedTurns[0]?.token ?? null);
      this.voice.onTurnBoundary(pulse.lastAssistantMessage, token);
    });
  }

  public async open(): Promise<string | null> {
    const tabId = await this.coordinator.openOrResume();
    void this.tribunalTransport.open();
    try {
      const response = await this.rpc.call(
        'voice:getProviderConfig',
        {},
        { timeout: 10_000 },
      );
      if (response.success && response.data?.ok) {
        const { sttProvider, ttsProvider, local, elevenlabs } =
          response.data.config;
        const ready = (provider: string, direction: 'stt' | 'tts'): boolean =>
          provider === 'local'
            ? direction === 'stt'
              ? local.sttDownloaded
              : local.ttsDownloaded
            : provider === 'elevenlabs' && elevenlabs.apiKeyConfigured;
        this.store.setProvider({
          transcription: ready(sttProvider, 'stt'),
          synthesis: ready(ttsProvider, 'tts'),
        });
      }
    } catch {
      // degradation-audit: reported — voice remains unavailable; text and graph stay usable
      this.store.setProvider({ transcription: false, synthesis: false });
    }
    return tabId;
  }
  public startVoice(): Promise<boolean> {
    return this.voice.start();
  }
  public muteVoice(): Promise<void> {
    return this.voice.mute();
  }
  public toggleMuteVoice(): Promise<void | boolean> {
    return this.store.muted() ? this.voice.start() : this.voice.mute();
  }
  public stopVoice(): Promise<void> {
    return this.voice.stop();
  }
  public retrySpeech(): void {
    this.voice.retrySpeech();
  }
  public answerOrdinaryQuestion(id: string, answer: string): boolean {
    const request = this.ordinaryQuestion();
    const question = request?.questions[0];
    if (!request || !question || request.id !== id) return false;
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
    const movePattern = new RegExp(
      `\\b(?:${TRIBUNAL_MOVES.join('|')})\\b`,
      'i',
    );
    if (!movePattern.test(content)) {
      const sent = await this.coordinator.send(content);
      if (sent && source === 'text') this.voice.armTypedTurn();
      return sent;
    }
    const rootSessionId = this.store.sessionId();
    if (!rootSessionId) {
      this.store.setToast({
        message: 'Start a Command Center session before requesting Tribunal.',
        tone: 'error',
      });
      return false;
    }
    const nonce = crypto.randomUUID();
    this.expectedRequest.set({ nonce, rootSessionId });
    const sent = await this.coordinator.send(
      `${content}\n\n<COMMAND_CENTER_TRIBUNAL_REQUEST>\n${JSON.stringify({ nonce, rootSessionId })}\n</COMMAND_CENTER_TRIBUNAL_REQUEST>`,
    );
    if (sent && source === 'text') this.voice.armTypedTurn();
    return sent;
  }
  public async confirmProposal(id: string): Promise<void> {
    if (this.pendingProposal()?.proposalId !== id) return;
    this.clearRosterTimeout();
    const result = await this.tribunal.confirm(id);
    if (result.ok) this.pendingProposal.set(null);
    this.voice.onRosterResolved();
  }
  public declineProposal(id: string): void {
    if (this.pendingProposal()?.proposalId !== id) return;
    this.clearRosterTimeout();
    this.tribunal.decline(id);
    this.tribunal.pageExit();
    this.tribunalTransport.cancelDiscovery();
    this.pendingProposal.set(null);
    this.voice.onRosterResolved();
  }
  public timeoutProposal(id: string): void {
    if (this.pendingProposal()?.proposalId !== id) return;
    this.clearRosterTimeout();
    this.tribunal.timeout(id);
    this.pendingProposal.set(null);
    this.voice.onRosterResolved();
  }
  public getLatencyMarks(): ReturnType<CommandVoiceLoop['getLatencyMarks']> {
    return this.voice.getLatencyMarks();
  }
  public exit(): Promise<void> {
    this.clearRosterTimeout();
    this.tribunal.pageExit();
    this.tribunalTransport.pageExit();
    this.pendingProposal.set(null);
    this.voice.onRosterResolved();
    return this.voice.exit();
  }
  private clearRosterTimeout(): void {
    if (this.rosterTimeout !== null) clearTimeout(this.rosterTimeout);
    this.rosterTimeout = null;
  }
}
