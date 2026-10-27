import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionStatus } from '@ptah-extension/chat-types';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import {
  SESSION_HANDOFF_COMMAND,
  SESSION_WRAP_UP_PROMPT,
  SessionBudgetActionsService,
  buildHandoffCommand,
  buildWrapUpPrompt,
} from './session-budget-actions.service';

/** `autocomplete:commands` result listing the given command names. */
function commandsResult(...names: string[]) {
  return {
    success: true,
    data: {
      commands: names.map((name) => ({
        name,
        description: '',
        scope: 'project',
      })),
    },
  };
}

const SESSION = '11111111-1111-4111-8111-111111111111';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION,
  stage: 'handoff',
  unit: 'tokens',
  measure: 'tokens',
  used: 41_200_000,
  limit: 50_000_000,
  percent: 82.4,
  lowerBound: false,
  revision: 9,
  compactions: 0,
  autoHandoff: false,
};

describe('SessionBudgetActionsService', () => {
  function setup(budget: SessionBudgetState | null = BUDGET) {
    const sendOrQueueMessageMock = jest
      .fn()
      .mockResolvedValue({ success: true });
    const showErrorMock = jest.fn();
    const tab = signal<{
      sessionBudget: SessionBudgetState | null;
      status?: SessionStatus;
      liveBudgetStage?: 'handoff' | 'limit' | null;
    }>({ sessionBudget: budget, status: 'loaded' });
    const tabId = signal<string | null>('tab-abc');
    // Default: the workspace has no `session-handoff` skill.
    const rpcCallMock = jest.fn().mockResolvedValue(commandsResult());

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        {
          provide: ActionBannerService,
          useValue: { showError: showErrorMock },
        },
        {
          provide: ChatStore,
          useValue: { sendOrQueueMessage: sendOrQueueMessageMock },
        },
        { provide: ClaudeRpcService, useValue: { call: rpcCallMock } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/ws/a' }) },
        },
      ],
    });
    const service = TestBed.inject(SessionBudgetActionsService);
    service.connect({
      activeTab: tab,
      tabId,
      sessionId: signal<string | null>(SESSION),
    });
    return {
      service,
      tab,
      tabId,
      sendOrQueueMessageMock,
      showErrorMock,
      rpcCallMock,
    };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  describe('display stage', () => {
    it('is the authoritative stage while idle', () => {
      const { service } = setup();
      expect(service.displayStage()).toBe('handoff');
    });

    it('takes the higher live stage only while the turn streams', () => {
      const { service, tab } = setup({ ...BUDGET, stage: 'tighten' });
      tab.set({
        sessionBudget: { ...BUDGET, stage: 'tighten' },
        status: 'streaming',
        liveBudgetStage: 'limit',
      });
      expect(service.displayStage()).toBe('limit');

      tab.update((current) => ({ ...current, status: 'loaded' }));
      expect(service.displayStage()).toBe('tighten');
    });

    it('is null without a budget', () => {
      const { service } = setup(null);
      expect(service.displayStage()).toBeNull();
    });
  });

  describe('dismiss', () => {
    it('records the shown stage for the session; a new stage is not dismissed', () => {
      const { service, tab } = setup();
      service.dismiss();
      expect(service.dismissedStage()).toBe('handoff');

      tab.set({
        sessionBudget: { ...BUDGET, stage: 'limit' },
        status: 'loaded',
      });
      expect(service.dismissedStage()).toBe('handoff');
      expect(service.displayStage()).toBe('limit');
    });

    it('is per session', () => {
      const { service, tab } = setup();
      service.dismiss();
      tab.set({
        sessionBudget: { ...BUDGET, sessionId: 'other-session' },
        status: 'loaded',
      });
      expect(service.dismissedStage()).toBeNull();
    });
  });

  describe('sendWrapUp', () => {
    it('sends the wrap-up prompt through the composer send path, once', async () => {
      const { service, sendOrQueueMessageMock } = setup();

      await service.sendWrapUp();
      await service.sendWrapUp();

      expect(sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildWrapUpPrompt(BUDGET),
        { tabId: 'tab-abc' },
      );
      expect(service.wrapUpSent()).toBe(true);
    });

    it('fills in the formatted usage figure', () => {
      const prompt = buildWrapUpPrompt(BUDGET);
      expect(prompt.startsWith('This session has used 41.2M tokens.')).toBe(
        true,
      );
      expect(prompt).toContain('`HANDOFF.md`');
      expect(prompt).not.toContain('{used}');
      expect(SESSION_WRAP_UP_PROMPT).toContain('{used}');
    });

    it('lets running lanes report on their own instead of waiting for them', () => {
      expect(SESSION_WRAP_UP_PROMPT).toContain('Do not poll or call wait tools');
      expect(SESSION_WRAP_UP_PROMPT).toContain('completion signal with its final status');
      expect(SESSION_WRAP_UP_PROMPT).not.toMatch(/wait until every running/i);
    });

    it('reads a cost budget as an amount', () => {
      const prompt = buildWrapUpPrompt({
        ...BUDGET,
        unit: 'cost',
        measure: 'cost',
        used: 8.96,
        limit: 10,
      });
      expect(
        prompt.startsWith('This session has used $8.96 worth of tokens.'),
      ).toBe(true);
    });

    it('re-enables the button when the send is not accepted', async () => {
      const { service, sendOrQueueMessageMock, showErrorMock } = setup();
      sendOrQueueMessageMock.mockResolvedValueOnce({
        success: false,
        error: 'not sent',
      });

      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
      // The send path already reports its own failure in the transcript.
      expect(showErrorMock).not.toHaveBeenCalled();
    });

    it('re-enables the button and reports a thrown send', async () => {
      const { service, sendOrQueueMessageMock, showErrorMock } = setup();
      sendOrQueueMessageMock.mockRejectedValueOnce(new Error('boom'));

      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
      expect(showErrorMock).toHaveBeenCalledWith(
        'Could not send the wrap-up request: boom',
        'tab-abc',
      );
    });

    it('sends nothing without a tab or a budget', async () => {
      const { service, tabId, sendOrQueueMessageMock } = setup();
      tabId.set(null);
      await service.sendWrapUp();
      expect(sendOrQueueMessageMock).not.toHaveBeenCalled();
    });
  });

  describe('sendWrapUp with the session-handoff skill (TASK_2026_655)', () => {
    it('builds the slash command with the usage figure', () => {
      expect(SESSION_HANDOFF_COMMAND).toBe('/session-handoff');
      expect(buildHandoffCommand(BUDGET)).toBe(
        '/session-handoff This session has used 41.2M tokens.',
      );
    });

    it('probes the workspace commands and sends /session-handoff once when the skill exists', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock } = setup();
      rpcCallMock.mockResolvedValue(
        commandsResult('session-handoff-notes', 'session-handoff'),
      );

      await service.sendWrapUp();
      await service.sendWrapUp();

      expect(rpcCallMock).toHaveBeenCalledTimes(1);
      expect(rpcCallMock).toHaveBeenCalledWith('autocomplete:commands', {
        query: 'session-handoff',
        maxResults: 10,
        workspaceRoot: '/ws/a',
      });
      expect(sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildHandoffCommand(BUDGET),
        { tabId: 'tab-abc' },
      );
      expect(service.wrapUpSent()).toBe(true);
    });

    it('sends the inline prompt when only a similarly named command exists', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock } = setup();
      rpcCallMock.mockResolvedValue(commandsResult('session-handoff-notes'));

      await service.sendWrapUp();

      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildWrapUpPrompt(BUDGET),
        { tabId: 'tab-abc' },
      );
    });

    it('sends the inline prompt when the probe fails', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock } = setup();
      rpcCallMock.mockResolvedValue({ success: false, error: 'nope' });

      await service.sendWrapUp();

      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildWrapUpPrompt(BUDGET),
        { tabId: 'tab-abc' },
      );
    });

    it('sends the inline prompt when the probe throws, without an error banner', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock, showErrorMock } =
        setup();
      rpcCallMock.mockRejectedValue(new Error('timeout'));

      await service.sendWrapUp();

      expect(sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildWrapUpPrompt(BUDGET),
        { tabId: 'tab-abc' },
      );
      expect(showErrorMock).not.toHaveBeenCalled();
      expect(service.wrapUpSent()).toBe(true);
    });

    it('a second click while the probe is in flight sends nothing more', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock } = setup();
      let resolveProbe!: (value: unknown) => void;
      rpcCallMock.mockReturnValue(
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
      );

      const first = service.sendWrapUp();
      // The button is already disabled while the probe runs.
      expect(service.wrapUpSent()).toBe(true);
      await service.sendWrapUp();
      resolveProbe(commandsResult('session-handoff'));
      await first;

      expect(rpcCallMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildHandoffCommand(BUDGET),
        { tabId: 'tab-abc' },
      );
    });

    it('re-enables the button when the slash command is not accepted', async () => {
      const { service, sendOrQueueMessageMock, rpcCallMock } = setup();
      rpcCallMock.mockResolvedValue(commandsResult('session-handoff'));
      sendOrQueueMessageMock.mockResolvedValueOnce({ success: false });

      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
    });
  });
});
