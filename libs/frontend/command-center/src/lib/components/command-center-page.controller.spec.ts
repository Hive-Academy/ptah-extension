import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ChatStore } from '@ptah-extension/chat';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { CommandCenterPageController } from './command-center-page.controller';
import { CommandCenterTribunalTransport } from './command-center-tribunal.transport';
import { CommandCenterProjectionSource } from './command-center-projection.source';

describe('CommandCenterPageController', () => {
  const recordWriteFailure = signal<{
    workspacePath: string;
    record: 'lastSession';
  } | null>(null);
  const tabs = signal([]);
  const terminalTurnPulses = signal<readonly TerminalTurnPulse[]>([]);
  const questionRequests = signal<
    readonly {
      id: string;
      tabId: string;
      questions: {
        question: string;
        header: string;
        options: [];
        multiSelect: false;
      }[];
    }[]
  >([]);
  const coordinator = {
    openOrResume: jest.fn(async () => 'root-tab'),
    setStatusContextProvider: jest.fn(),
    answerQuestion: jest.fn(),
    send: jest.fn(async () => true),
    sendLaunchTurn: jest.fn(async () => true),
    mute: jest.fn(),
    stop: jest.fn(async () => undefined),
  };
  let page: CommandCenterPageController;
  const transport = {
    open: jest.fn(async () => undefined),
    answer: jest.fn(() => true),
    availability: jest.fn(() => ({
      lanes: [
        { laneId: 'codex#1', state: 'READY', family: 'codex', cli: 'codex' },
        { laneId: 'codex#2', state: 'READY', family: 'codex', cli: 'codex' },
        { laneId: 'codex#3', state: 'READY', family: 'codex', cli: 'codex' },
        {
          laneId: 'copilot#1',
          state: 'READY',
          family: 'copilot',
          cli: 'copilot',
        },
      ],
      disabledClis: [],
    })),
    discoveryComplete: jest.fn(async () => undefined),
    createTask: jest.fn(async () => 'task-1'),
    writeManifest: jest.fn(() => true),
    removeManifest: jest.fn(() => true),
    sendLaunchTurn: jest.fn(async () => true),
    reportFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transport.answer.mockImplementation(() => true);
    transport.writeManifest.mockImplementation(() => true);
    transport.sendLaunchTurn.mockImplementation(async () => true);
    recordWriteFailure.set(null);
    terminalTurnPulses.set([]);
    questionRequests.set([]);
    TestBed.configureTestingModule({
      providers: [
        CommandCenterPageController,
        CommandCenterStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            terminalTurnPulses,
            commandCenterRecordWriteFailure: recordWriteFailure,
          },
        },
        { provide: CommandCenterSessionCoordinator, useValue: coordinator },
        { provide: ChatStore, useValue: { questionRequests } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        { provide: CommandCenterTribunalTransport, useValue: transport },
        {
          provide: CommandCenterProjectionSource,
          useValue: {
            input: jest.fn(() => ({
              rootTabId: 'root-tab',
              rootSessionId: 'session',
              children: [],
              persistedChildren: [],
              agents: [],
              runs: [],
            })),
          },
        },
      ],
    });
    page = TestBed.inject(CommandCenterPageController);
  });

  it('routes start, mute, and stop controls to the voice loop', async () => {
    const start = jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    const mute = jest.spyOn(page.voice, 'mute').mockResolvedValue(undefined);
    const stop = jest.spyOn(page.voice, 'stop').mockResolvedValue(undefined);
    await page.startVoice();
    await page.muteVoice();
    await page.stopVoice();
    expect(start).toHaveBeenCalledTimes(1);
    expect(mute).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('exits voice transport on page teardown', async () => {
    const exit = jest.spyOn(page.voice, 'exit').mockResolvedValue(undefined);
    await page.exit();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('provides timestamp ages in explicit status context', () => {
    page.store.setSession('tab', 'session', '/workspace');
    page.store.setProjection(
      'root:session',
      [
        {
          id: 'root:session',
          parentId: null,
          label: 'Ptah',
          providerId: null,
          state: 'running',
          updatedAt: Date.now() - 5_000,
        },
      ],
      [],
    );
    const provider =
      coordinator.setStatusContextProvider.mock.calls.at(-1)?.[0];
    expect(provider?.()).toContain('root:session | running | 5s');
  });

  it('delivers one settled boundary and ignores a pulse predating the voice send', () => {
    const boundary = jest
      .spyOn(page.voice, 'onTurnBoundary')
      .mockImplementation();
    page.store.setSession('root-tab', 'session', '/workspace');
    const pulse = (seq: number, text: string): TerminalTurnPulse => ({
      seq,
      tabId: 'root-tab',
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: seq,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: text,
      classification: 'success',
      title: 'Command Center',
      occurredAt: Date.now(),
    });
    terminalTurnPulses.set([pulse(1, 'Old reply')]);
    TestBed.tick();
    page.voice['options'].onVoiceSend?.(2);
    TestBed.tick();
    expect(boundary).not.toHaveBeenCalled();
    terminalTurnPulses.set([pulse(1, 'Old reply'), pulse(2, 'New reply')]);
    TestBed.tick();
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary).toHaveBeenCalledWith('New reply', 2);
  });

  it('exposes a safe record write failure notice signal', () => {
    recordWriteFailure.set({
      workspacePath: '/workspace',
      record: 'lastSession',
    });
    expect(page.recordWriteFailure()?.record).toBe('lastSession');
  });

  it('answers an ordinary question with its full prompt as the question key', () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    questionRequests.set([
      {
        id: 'q1',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Which branch should I use?',
            header: 'Branch',
            options: [],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.answerOrdinaryQuestion('q1', 'main')).toBe(true);
    expect(coordinator.answerQuestion).toHaveBeenCalledWith({
      id: 'q1',
      answers: { 'Which branch should I use?': 'main' },
    });
  });

  const roster = (
    nonce: string,
    rootSessionId = 'session',
    proposalId = 'p1',
    move: 'council' | 'relay' = 'council',
  ): string =>
    `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify({
      proposalId,
      nonce,
      rootSessionId,
      move,
      options: ['Decline', 'Confirm'],
      objective: 'Review',
      rounds: 1,
      lanes:
        move === 'relay'
          ? [
              {
                laneId: 'codex#1',
                family: 'codex',
                displayName: 'Codex',
                cli: 'codex',
                role: 'plan',
              },
              {
                laneId: 'codex#2',
                family: 'codex',
                displayName: 'Codex',
                cli: 'codex',
                role: 'architect',
              },
              {
                laneId: 'codex#3',
                family: 'codex',
                displayName: 'Codex',
                cli: 'codex',
                role: 'implement',
              },
              {
                laneId: 'copilot#1',
                family: 'copilot',
                displayName: 'Copilot',
                cli: 'copilot',
                role: 'review',
              },
            ]
          : [
              {
                laneId: 'codex#1',
                family: 'codex',
                displayName: 'Codex',
                cli: 'codex',
              },
            ],
    })}</TRIBUNAL_ROSTER_PROPOSAL>`;
  const offer = (question: string, id = 'q-roster'): void => {
    questionRequests.set([
      {
        id,
        tabId: 'root-tab',
        questions: [
          { question, header: 'Tribunal', options: [], multiSelect: false },
        ],
      },
    ]);
    TestBed.tick();
  };

  it('frames typed move words with a fresh page nonce and root id; ordinary text stays unchanged', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    coordinator.send.mockClear();
    await page.sendCommand('Review with Council');
    const framed = coordinator.send.mock.calls.at(-1)?.[0] ?? '';
    expect(framed).toContain('<COMMAND_CENTER_TRIBUNAL_REQUEST>');
    expect(framed).toContain('"rootSessionId":"session"');
    expect(framed).toMatch(/"nonce":"[0-9a-f-]{36}"/);
    await page.sendCommand('Just discuss the work');
    expect(coordinator.send).toHaveBeenLastCalledWith('Just discuss the work');
  });

  it('opens a matching roster and rejects wrong nonce or root', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const announce = jest
      .spyOn(page.voice, 'onRosterProposal')
      .mockImplementation();
    await page.sendCommand('Council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster('wrong'), 'q-wrong');
    expect(page.pendingProposal()).toBeNull();
    offer(roster(nonce, 'wrong'), 'q-root');
    expect(page.pendingProposal()).toBeNull();
    offer(roster(nonce), 'q-good');
    expect(page.pendingProposal()?.proposalId).toBe('p1');
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('Tribunal council'),
      true,
    );
  });

  it('confirms once and launches after the manifest without affirmative answer text', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('Relay review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce, 'session', 'p1', 'relay'));
    const order: string[] = [];
    transport.answer.mockImplementation(() => {
      order.push('answer');
      return true;
    });
    transport.writeManifest.mockImplementation(() => {
      order.push('manifest');
      return true;
    });
    transport.createTask.mockImplementation(async () => {
      order.push('task');
      return 'task-1';
    });
    transport.sendLaunchTurn.mockImplementation(async () => {
      order.push('launch');
      return true;
    });
    await page.confirmProposal('p1');
    await page.confirmProposal('p1');
    expect(order).toEqual(['answer', 'task', 'manifest', 'launch']);
    expect(transport.answer.mock.calls[0]?.[2]).not.toMatch(
      /confirm|yes|approve/i,
    );
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
  });

  it('declines and times out proposals with Decline, then resolves voice', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const resolved = jest
      .spyOn(page.voice, 'onRosterResolved')
      .mockImplementation();
    await page.sendCommand('Council review');
    const first =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(first));
    page.declineProposal('p1');
    await page.sendCommand('Forge review');
    const second =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(second, 'session', 'p2'), 'q-two');
    page.timeoutProposal('p2');
    expect(
      transport.answer.mock.calls.filter((call) => call[2] === 'Decline'),
    ).toHaveLength(2);
    expect(resolved).toHaveBeenCalledTimes(2);
  });

  it('calls pageExit before voice exit', async () => {
    const order: string[] = [];
    jest.spyOn(page.tribunal, 'pageExit').mockImplementation(() => {
      order.push('pageExit');
    });
    jest.spyOn(page.voice, 'exit').mockImplementation(async () => {
      order.push('voiceExit');
    });
    await page.exit();
    expect(order).toEqual(['pageExit', 'voiceExit']);
  });

  it('clears a pending roster timer and card on exit', async () => {
    jest.useFakeTimers();
    try {
      page.store.setSession('root-tab', 'session', '/workspace');
      await page.sendCommand('Council review');
      const nonce =
        /"nonce":"([^"]+)"/.exec(
          coordinator.send.mock.calls.at(-1)?.[0] ?? '',
        )?.[1] ?? '';
      offer(roster(nonce));
      expect(page.pendingProposal()?.proposalId).toBe('p1');
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      jest.spyOn(page.voice, 'exit').mockResolvedValue(undefined);
      await page.exit();
      expect(page.pendingProposal()).toBeNull();
      transport.answer.mockClear();
      jest.advanceTimersByTime(120_000);
      expect(transport.answer).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
