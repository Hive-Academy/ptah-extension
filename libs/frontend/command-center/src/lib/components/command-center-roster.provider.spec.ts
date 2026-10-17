import { DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { ChatStore } from '@ptah-extension/chat';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import {
  CommandCenterRosterProvider,
  isRosterIdleWithoutPendingRequest,
} from './command-center-roster.provider';

describe('CommandCenterRosterProvider', () => {
  const tabs = signal<{ id: string; status: string }[]>([
    { id: 'root-tab', status: 'loaded' },
  ]);
  const pulses = signal<ReadonlyMap<string, TerminalTurnPulse>>(new Map());
  const questions = signal<
    {
      id: string;
      tabId: string;
      sessionId?: string;
      questions: {
        question: string;
        header: string;
        options: { label: string; description: string }[];
        multiSelect: false;
      }[];
    }[]
  >([]);
  const permissions = signal<
    {
      id: string;
      tabId: string;
      sessionId?: string;
      toolName: string;
      description: string;
    }[]
  >([]);
  const send = jest.fn(async (_content: string) => true);
  const answer = jest.fn((_id: string, _key: string, _answer: string) => true);
  const voice = {
    setRosterPending: jest.fn(),
    onRosterProposal: jest.fn(),
    onRosterResolved: jest.fn(),
    onPendingPrompt: jest.fn(),
  };
  const transport = {
    answer,
    availability: jest.fn(() => ({
      lanes: [
        { laneId: 'codex#1', state: 'READY', family: 'codex', cli: 'codex' },
      ],
      disabledClis: [],
    })),
    discoveryComplete: jest.fn(async () => undefined),
    createTask: jest.fn(async () => 'task-1'),
    writeManifest: jest.fn(() => true),
    removeManifest: jest.fn(() => true),
    sendLaunchTurn: jest.fn(async () => true),
    reportFailure: jest.fn(),
    pageExit: jest.fn(),
    cancelDiscovery: jest.fn(),
  };
  let roster: CommandCenterRosterProvider;
  let store: CommandCenterStore;
  let tabService: TabManagerService;
  let chat: ChatStore;
  let coordinator: CommandCenterSessionCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue(true);
    answer.mockReturnValue(true);
    tabs.set([{ id: 'root-tab', status: 'loaded' }]);
    pulses.set(new Map());
    questions.set([]);
    permissions.set([]);
    TestBed.configureTestingModule({
      providers: [
        CommandCenterStore,
        {
          provide: TabManagerService,
          useValue: { tabs, lastTerminalPulseByTab: pulses },
        },
        {
          provide: ChatStore,
          useValue: {
            questionRequests: questions,
            permissionRequests: permissions,
          },
        },
        { provide: CommandCenterSessionCoordinator, useValue: { send } },
        { provide: CommandCenterTribunalTransport, useValue: transport },
      ],
    });
    store = TestBed.inject(CommandCenterStore);
    tabService = TestBed.inject(TabManagerService);
    chat = TestBed.inject(ChatStore);
    coordinator = TestBed.inject(CommandCenterSessionCoordinator);
    store.setSession('root-tab', 'session', '/workspace');
    roster = TestBed.runInInjectionContext(
      () =>
        new CommandCenterRosterProvider(
          store,
          tabService,
          chat,
          TestBed.inject(CommandCenterTribunalTransport),
          inject(DestroyRef),
          () => voice,
        ),
    );
    TestBed.tick();
  });

  const nonceFromSend = (): string =>
    /"nonce":"([^"]+)"/.exec(send.mock.calls.at(-1)?.[0] ?? '')?.[1] ?? '';
  const offer = (nonce: string, id = 'p1'): void => {
    const question = `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify({
      proposalId: id,
      nonce,
      rootSessionId: 'session',
      move: 'council',
      options: ['Decline', 'Confirm'],
      objective: 'Review',
      rounds: 1,
      lanes: [
        {
          laneId: 'codex#1',
          family: 'codex',
          displayName: 'Codex',
          cli: 'codex',
        },
      ],
    })}</TRIBUNAL_ROSTER_PROPOSAL>`;
    questions.set([
      {
        id: `q-${id}`,
        tabId: 'root-tab',
        questions: [
          { question, header: 'Tribunal', options: [], multiSelect: false },
        ],
      },
    ]);
    TestBed.tick();
  };
  const pulse = (seq: number): void => {
    pulses.set(
      new Map([
        [
          'root-tab',
          {
            seq,
            tabId: 'root-tab',
            sessionId: 'session',
            workspacePath: '/workspace',
            revision: seq,
            phase: 'idle',
            terminalReason: 'completed',
            lastAssistantMessage: null,
            classification: 'success',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
  };

  it('keeps a newer nonce when an older Confirm finishes', async () => {
    await roster.sendRequest('run council review', coordinator);
    const first = nonceFromSend();
    offer(first);
    expect(roster.pendingProposal()?.proposalId).toBe('p1');
    let resolveConfirm: (result: { ok: true }) => void = () => undefined;
    jest.spyOn(roster.tribunal, 'confirm').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const confirmation = roster.confirmProposal('p1');
    await roster.sendRequest('run another council review', coordinator);
    const second = nonceFromSend();
    expect(second).not.toBe(first);
    resolveConfirm({ ok: true });
    await confirmation;
    expect(roster.tribunalRequestActive()?.nonce).toBe(second);
  });

  it('starts idle grace only after a skipped pulse and cancels it on resumed activity', async () => {
    jest.useFakeTimers();
    try {
      tabs.set([{ id: 'root-tab', status: 'streaming' }]);
      await roster.sendRequest('run council review', coordinator);
      const nonce = nonceFromSend();
      jest.advanceTimersByTime(60_000);
      expect(roster.tribunalRequestActive()?.nonce).toBe(nonce);
      tabs.set([{ id: 'root-tab', status: 'loaded' }]);
      pulse(1);
      jest.advanceTimersByTime(6_000);
      tabs.set([{ id: 'root-tab', status: 'resuming' }]);
      TestBed.tick();
      jest.advanceTimersByTime(15_000);
      expect(roster.tribunalRequestActive()?.nonce).toBe(nonce);
      tabs.set([{ id: 'root-tab', status: 'loaded' }]);
      TestBed.tick();
      jest.advanceTimersByTime(12_000);
      TestBed.tick();
      expect(roster.tribunalRequestActive()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears a skipped-pulse grace when the next pulse settles the request', async () => {
    jest.useFakeTimers();
    try {
      tabs.set([{ id: 'root-tab', status: 'streaming' }]);
      await roster.sendRequest('run council review', coordinator);
      pulse(1);
      tabs.set([{ id: 'root-tab', status: 'loaded' }]);
      TestBed.tick();
      expect(roster.tribunalRequestActive()).not.toBeNull();
      pulse(2);
      expect(roster.tribunalRequestActive()).toBeNull();
      jest.advanceTimersByTime(12_000);
      expect(roster.tribunalRequestActive()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires idle status and no root question or permission', () => {
    expect(
      isRosterIdleWithoutPendingRequest(
        tabService,
        chat,
        'root-tab',
        'session',
      ),
    ).toBe(true);
    tabs.set([{ id: 'root-tab', status: 'switching' }]);
    expect(
      isRosterIdleWithoutPendingRequest(
        tabService,
        chat,
        'root-tab',
        'session',
      ),
    ).toBe(false);
    tabs.set([{ id: 'root-tab', status: 'draft' }]);
    permissions.set([
      { id: 'perm', tabId: 'root-tab', toolName: 'Write', description: 'Edit' },
    ]);
    expect(
      isRosterIdleWithoutPendingRequest(
        tabService,
        chat,
        'root-tab',
        'session',
      ),
    ).toBe(false);
  });

  it('caps automatic invalid Decline at three attempts and allows manual retry', async () => {
    jest.useFakeTimers();
    try {
      await roster.sendRequest('run council review', coordinator);
      answer.mockReturnValue(false);
      questions.set([
        {
          id: 'invalid',
          tabId: 'root-tab',
          questions: [
            {
              question: 'Proceed?',
              header: 'Council',
              options: [],
              multiSelect: false,
            },
          ],
        },
      ]);
      TestBed.tick();
      expect(store.toast()?.message).toContain('Retrying the Decline');
      jest.advanceTimersByTime(500);
      expect(answer).toHaveBeenCalledTimes(3);
      expect(store.toast()?.message).toContain('Retry the Decline');
      jest.advanceTimersByTime(5_000);
      expect(answer).toHaveBeenCalledTimes(3);
      expect(roster.undeclinedInvalidQuestionId()).toBe('invalid');
      answer.mockReturnValue(true);
      roster.retryInvalidDecline();
      expect(answer).toHaveBeenCalledTimes(4);
      expect(roster.undeclinedInvalidQuestionId()).toBeNull();
      expect(store.toast()?.message).toContain('request cancelled');
    } finally {
      jest.useRealTimers();
    }
  });
});
