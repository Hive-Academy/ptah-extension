import { DestroyRef, computed, effect, signal } from '@angular/core';
import {
  COMMAND_CENTER_TRIBUNAL_REQUEST_TAG,
  TRIBUNAL_ROSTER_PROPOSAL_TAG,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ChatStore } from '@ptah-extension/chat';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { TribunalRunCoordinator } from '../model/tribunal-run-coordinator';
import { type TribunalRosterProposal } from '../model/tribunal-roster-proposal';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';

type RosterVoicePort = {
  setRosterPending(pending: boolean): void;
  onRosterProposal(prompt: string, valid: boolean): void;
  onRosterResolved(): void;
  onPendingPrompt(prompt: string): void;
};

/** A root is idle only when no interaction is waiting for an answer. */
export function isRosterIdleWithoutPendingRequest(
  tabs: TabManagerService,
  chat: ChatStore,
  tabId: string | null,
  sessionId: string | null,
): boolean {
  const status = tabs.tabs().find((tab) => tab.id === tabId)?.status;
  if (status !== 'loaded' && status !== 'fresh' && status !== 'draft')
    return false;
  const belongs = (request: { tabId?: string; sessionId?: string }) =>
    request.tabId === tabId || (!!sessionId && request.sessionId === sessionId);
  return (
    !chat.questionRequests().some(belongs) &&
    !chat.permissionRequests().some(belongs)
  );
}

/** One page lifetime owns all Tribunal request and pending-input state. */
export class CommandCenterRosterProvider {
  public readonly tribunal: TribunalRunCoordinator;
  public readonly pendingProposal = signal<TribunalRosterProposal | null>(null);
  public readonly rosterTimedOut = signal(false);
  public readonly undeclinedInvalidQuestionId = signal<string | null>(null);
  private readonly expectedRequest = signal<{
    nonce: string;
    rootSessionId: string;
    minPulseSeq: number;
    skipNextPulse: boolean;
    graceEligible: boolean;
  } | null>(null);
  public readonly tribunalRequestActive = computed(() => {
    const expected = this.expectedRequest();
    return expected?.rootSessionId === this.store.sessionId() ? expected : null;
  });
  private handledRosterQuestionId: string | null = null;
  private rosterTimeout: ReturnType<typeof setTimeout> | null = null;
  private idleGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private idleGraceNonce: string | null = null;
  private readonly spokenRequestIds = new Set<string>();
  private readonly invalidRosterQuestionIds = new Set<string>();
  private invalidDeclineAttempts = 0;
  private invalidDeclineTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly invalidRosterQuestion = computed(() => {
    if (!this.tribunalRequestActive()) return null;
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
              `<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
            ),
        ) ?? null
    );
  });
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
              `<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
            ) &&
            !this.invalidRosterQuestionIds.has(request.id) &&
            request.id !== this.invalidRosterQuestion()?.id,
        ) ?? null
    );
  });
  public readonly ordinaryChoices = computed(() => {
    const options = this.ordinaryQuestion()?.questions[0]?.options ?? [];
    const hasConfirm =
      !!this.tribunalRequestActive() &&
      options.some((option) => /\bconfirm\b/i.test(option.label));
    return options
      .filter(
        (option) =>
          !hasConfirm ||
          !/^(confirm|yes|approve|go ahead)\b/i.test(option.label),
      )
      .map((option) => option.label);
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

  public constructor(
    private readonly store: CommandCenterStore,
    private readonly tabs: TabManagerService,
    private readonly chat: ChatStore,
    private readonly transport: CommandCenterTribunalTransport,
    private readonly destroyRef: DestroyRef,
    private readonly voice: () => RosterVoicePort,
  ) {
    this.tribunal = new TribunalRunCoordinator(transport);
    destroyRef.onDestroy(() => {
      this.clearInvalidDeclineTimer();
      this.clearRosterTimeout();
      this.clearIdleGrace();
    });
    effect(() => {
      const pendingId = this.undeclinedInvalidQuestionId();
      if (
        pendingId &&
        !this.chat.questionRequests().some((item) => item.id === pendingId)
      )
        this.clearInvalidDecline();
      const request = this.invalidRosterQuestion();
      const question = request?.questions[0];
      if (
        !request ||
        !question ||
        pendingId ||
        this.invalidRosterQuestionIds.has(request.id)
      )
        return;
      this.invalidDeclineAttempts = 0;
      this.tryInvalidDecline(request.id, question.question);
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
              `<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
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
        availability: this.transport.availability(),
      });
      if (!proposal || !expected || expected.rootSessionId !== rootSessionId) {
        this.expectedRequest.set(null);
        this.pendingProposal.set(null);
        this.store.setToast({
          message: 'Invalid Tribunal proposal. It was declined.',
          tone: 'error',
        });
        this.voice().onRosterProposal('Invalid Tribunal proposal.', false);
        this.voice().onRosterResolved();
        return;
      }
      this.pendingProposal.set(proposal);
      this.rosterTimedOut.set(false);
      this.clearIdleGrace();
    });
    effect(() => {
      const expected = this.tribunalRequestActive();
      const tabId = this.store.markedTabId();
      const pulse = tabId
        ? this.tabs.lastTerminalPulseByTab().get(tabId)
        : undefined;
      if (
        !expected ||
        !pulse ||
        pulse.seq <= expected.minPulseSeq ||
        this.pendingProposal()
      )
        return;
      if (
        this.chat
          .questionRequests()
          .some(
            (request) =>
              (request.tabId === tabId ||
                request.sessionId === expected.rootSessionId) &&
              !!request.questions[0]?.question.includes(
                `<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
              ),
          )
      )
        return;
      if (expected.skipNextPulse) {
        this.expectedRequest.set({
          ...expected,
          minPulseSeq: pulse.seq,
          skipNextPulse: false,
          graceEligible: true,
        });
        return;
      }
      this.expectedRequest.set(null);
    });
    effect(() => {
      const expected = this.tribunalRequestActive();
      const tabId = this.store.markedTabId();
      const sessionId = this.store.sessionId();
      const idle = isRosterIdleWithoutPendingRequest(
        this.tabs,
        this.chat,
        tabId,
        sessionId,
      );
      if (
        expected &&
        !idle &&
        !expected.graceEligible &&
        this.tabs.tabs().some((tab) => tab.id === tabId)
      )
        this.expectedRequest.set({ ...expected, graceEligible: true });
      if (
        !expected ||
        !idle ||
        expected.skipNextPulse ||
        !expected.graceEligible ||
        this.pendingProposal()
      ) {
        this.clearIdleGrace();
        return;
      }
      // Grace starts only after the skipped pulse; an active discovery turn has no expiry.
      if (this.idleGraceNonce === expected.nonce) return;
      this.clearIdleGrace();
      this.idleGraceNonce = expected.nonce;
      this.idleGraceTimer = setTimeout(() => {
        if (
          this.expectedRequest()?.nonce === expected.nonce &&
          isRosterIdleWithoutPendingRequest(
            this.tabs,
            this.chat,
            tabId,
            sessionId,
          )
        )
          this.expectedRequest.set(null);
        this.clearIdleGrace();
      }, 12_000);
    });
    effect(() => {
      const shown = this.shownInput();
      const proposal = this.pendingProposal();
      const rosterShown =
        !!proposal && shown?.id === this.handledRosterQuestionId;
      this.voice().setRosterPending(rosterShown);
      if (!rosterShown) this.clearRosterTimeout();
      else if (this.rosterTimeout === null)
        this.rosterTimeout = setTimeout(
          () => this.timeoutProposal(proposal.proposalId),
          120_000,
        );
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
          this.voice().onRosterProposal(shown.prompt, true);
        else this.voice().onPendingPrompt(shown.prompt);
      }
    });
  }

  public async sendRequest(
    content: string,
    coordinator: CommandCenterSessionCoordinator,
  ): Promise<boolean> {
    const rootSessionId = this.store.sessionId();
    if (!rootSessionId) {
      this.store.setToast({
        message: 'Start a Command Center session before requesting Tribunal.',
        tone: 'error',
      });
      return false;
    }
    const nonce = crypto.randomUUID();
    const tabId = this.store.markedTabId();
    const minPulseSeq = tabId
      ? (this.tabs.lastTerminalPulseByTab().get(tabId)?.seq ?? 0)
      : 0;
    const skipNextPulse = this.tabs
      .tabs()
      .some((tab) => tab.id === tabId && tab.status === 'streaming');
    this.clearIdleGrace();
    this.expectedRequest.set({
      nonce,
      rootSessionId,
      minPulseSeq,
      skipNextPulse,
      graceEligible: false,
    });
    const sent = await coordinator.send(
      `${content}\n\n<${COMMAND_CENTER_TRIBUNAL_REQUEST_TAG}>\n${JSON.stringify({ nonce, rootSessionId })}\n</${COMMAND_CENTER_TRIBUNAL_REQUEST_TAG}>`,
    );
    if (!sent && this.expectedRequest()?.nonce === nonce)
      this.expectedRequest.set(null);
    return sent;
  }
  public async confirmProposal(id: string): Promise<void> {
    if (this.pendingProposal()?.proposalId !== id) return;
    const nonce = this.expectedRequest()?.nonce;
    this.clearRosterTimeout();
    const result = await this.tribunal.confirm(id);
    if (this.expectedRequest()?.nonce === nonce) this.expectedRequest.set(null);
    if (
      this.pendingProposal()?.proposalId === id &&
      (result.ok || !result.retryable)
    )
      this.pendingProposal.set(null);
    this.voice().onRosterResolved();
  }
  public declineProposal(id: string): void {
    if (this.pendingProposal()?.proposalId !== id) return;
    this.clearRosterTimeout();
    this.expectedRequest.set(null);
    this.tribunal.decline(id);
    this.tribunal.pageExit();
    this.transport.cancelDiscovery();
    this.pendingProposal.set(null);
    this.voice().onRosterResolved();
  }
  public timeoutProposal(id: string): void {
    if (this.pendingProposal()?.proposalId !== id) return;
    this.clearRosterTimeout();
    this.expectedRequest.set(null);
    this.rosterTimedOut.set(true);
    this.store.setToast({
      message: 'Tribunal proposal timed out. Request a new roster.',
      tone: 'error',
    });
    this.tribunal.timeout(id);
    this.pendingProposal.set(null);
    this.voice().onRosterResolved();
  }
  public teardown(pageLeave: boolean): void {
    this.clearInvalidDecline();
    this.clearRosterTimeout();
    this.clearIdleGrace();
    this.expectedRequest.set(null);
    this.tribunal.pageExit();
    if (pageLeave) this.transport.pageExit();
    else this.transport.cancelDiscovery();
    this.pendingProposal.set(null);
    this.rosterTimedOut.set(false);
    this.voice().onRosterResolved();
  }
  private tryInvalidDecline(id: string, question: string): void {
    this.invalidDeclineAttempts += 1;
    if (!this.transport.answer(id, question, 'Decline')) {
      this.undeclinedInvalidQuestionId.set(id);
      this.store.setToast({
        message:
          this.invalidDeclineAttempts < 3
            ? 'Invalid Tribunal proposal could not be declined. Retrying the Decline.'
            : 'Invalid Tribunal proposal could not be declined. Retry the Decline before sending.',
        tone: 'error',
        action: this.invalidDeclineAttempts >= 3 ? 'retry-decline' : undefined,
      });
      if (this.invalidDeclineAttempts < 3) {
        this.clearInvalidDeclineTimer();
        this.invalidDeclineTimer = setTimeout(
          () => this.retryInvalidDecline(),
          250,
        );
      }
      return;
    }
    this.clearInvalidDecline();
    this.invalidRosterQuestionIds.add(id);
    this.expectedRequest.set(null);
    this.store.setToast({
      message:
        'Invalid Tribunal proposal. It was declined. Tribunal request cancelled - ask again.',
      tone: 'error',
    });
    this.voice().onRosterProposal('Invalid Tribunal proposal.', false);
    this.voice().onRosterResolved();
  }
  public retryInvalidDecline(): void {
    const id = this.undeclinedInvalidQuestionId();
    if (!id) return;
    this.clearInvalidDeclineTimer();
    const question = this.chat.questionRequests().find((item) => item.id === id)
      ?.questions[0]?.question;
    if (!question) {
      this.clearInvalidDecline();
      return;
    }
    this.tryInvalidDecline(id, question);
  }
  private clearInvalidDecline(): void {
    this.clearInvalidDeclineTimer();
    this.undeclinedInvalidQuestionId.set(null);
    this.invalidDeclineAttempts = 0;
  }
  private clearInvalidDeclineTimer(): void {
    if (this.invalidDeclineTimer !== null)
      clearTimeout(this.invalidDeclineTimer);
    this.invalidDeclineTimer = null;
  }
  private clearRosterTimeout(): void {
    if (this.rosterTimeout !== null) clearTimeout(this.rosterTimeout);
    this.rosterTimeout = null;
  }
  private clearIdleGrace(): void {
    if (this.idleGraceTimer !== null) clearTimeout(this.idleGraceTimer);
    this.idleGraceTimer = null;
    this.idleGraceNonce = null;
  }
}
