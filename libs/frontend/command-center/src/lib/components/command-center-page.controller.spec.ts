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
  const lastTerminalPulseByTab = signal<ReadonlyMap<string, TerminalTurnPulse>>(
    new Map(),
  );
  const permissionRequests = signal<
    readonly {
      id: string;
      tabId: string;
      toolName: string;
      description: string;
    }[]
  >([]);
  const handlePermissionResponse = jest.fn();
  const rpc = { call: jest.fn() };
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
    send: jest.fn(async (_content: string) => true),
    sendLaunchTurn: jest.fn(async () => true),
    mute: jest.fn(),
    stop: jest.fn(async () => undefined),
  };
  let page: CommandCenterPageController;
  const transport = {
    open: jest.fn(async () => undefined),
    answer: jest.fn((_id: string, _key: string, _answer: string) => true),
    pageExit: jest.fn(),
    cancelDiscovery: jest.fn(),
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
    discoveryComplete: jest.fn(async (): Promise<void> => undefined),
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
    lastTerminalPulseByTab.set(new Map());
    permissionRequests.set([]);
    rpc.call.mockReset();
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
            lastTerminalPulseByTab,
            commandCenterRecordWriteFailure: recordWriteFailure,
          },
        },
        { provide: CommandCenterSessionCoordinator, useValue: coordinator },
        {
          provide: ChatStore,
          useValue: {
            questionRequests,
            permissionRequests,
            handlePermissionResponse,
          },
        },
        { provide: ClaudeRpcService, useValue: rpc },
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

  it.each(['muteVoice', 'stopVoice', 'exit'] as const)(
    'clears armed turns on %s',
    async (action) => {
      page.voice['options'].onVoiceSend?.(1);
      expect(page['armedTurns']).toHaveLength(1);
      jest
        .spyOn(
          page.voice,
          action === 'muteVoice'
            ? 'mute'
            : action === 'stopVoice'
              ? 'stop'
              : 'exit',
        )
        .mockResolvedValue(undefined);
      await page[action]();
      expect(page['armedTurns']).toHaveLength(0);
      expect(page['voiceTurnToken']()).toBeNull();
    },
  );

  it('provides timestamp ages in explicit status context', () => {
    page.store.setSession('tab', 'session', '/workspace');
    page.store.setProjection(
      'root:session',
      [
        {
          id: 'root:session',
          kind: 'root',
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

  it('delivers a settled boundary from the snapshot after another reader consumes the queue', () => {
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
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(1, 'Old reply')]]));
    TestBed.tick();
    page.voice['options'].onVoiceSend?.(2);
    TestBed.tick();
    expect(boundary).not.toHaveBeenCalled();
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(2, 'New reply')]]));
    terminalTurnPulses.set([]);
    TestBed.tick();
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary).toHaveBeenCalledWith('New reply', 2);
    expect(page.latestReply()).toBe('New reply');
  });

  it('arms a typed send during voice and delivers its pulse boundary once', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    page.voice['active'] = true;
    page.voice['speak'] = jest.fn();
    const boundary = jest.spyOn(page.voice, 'onTurnBoundary');
    expect(await page.sendCommand('Summarize')).toBe(true);
    const pulse: TerminalTurnPulse = {
      seq: 1,
      tabId: 'root-tab',
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: 1,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: 'Typed reply',
      classification: 'success',
      title: 'Command Center',
      occurredAt: Date.now(),
    };
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse]]));
    TestBed.tick();
    TestBed.tick();
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary).toHaveBeenCalledWith('Typed reply', 1);
    expect(page.voice['lastReply']).toBe('Typed reply');
  });

  it('abandons a failed pulse so the next typed reply uses its own token', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    page.voice['active'] = true;
    page.voice['speak'] = jest.fn();
    page.voice['turnGeneration'] = page.voice['generation'];
    page.voice['awaitingBoundary'] = true;
    page.voice['awaitingTurnToken'] = 1;
    page.voice['nextVoiceTurnToken'] = 1;
    page.voice['options'].onVoiceSend?.(1);
    const pulse = (
      seq: number,
      classification: TerminalTurnPulse['classification'],
      lastAssistantMessage: string | null,
    ): TerminalTurnPulse => ({
      seq,
      tabId: 'root-tab',
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: seq,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage,
      classification,
      title: 'Command Center',
      occurredAt: Date.now(),
    });
    lastTerminalPulseByTab.set(
      new Map([['root-tab', pulse(1, 'error', null)]]),
    );
    TestBed.tick();
    expect(page['armedTurns']).toHaveLength(0);
    expect(await page.sendCommand('Next turn')).toBe(true);
    lastTerminalPulseByTab.set(
      new Map([['root-tab', pulse(2, 'success', 'Next reply')]]),
    );
    TestBed.tick();
    expect(page.voice['lastReply']).toBe('Next reply');
  });

  it('does not deliver a typed pulse boundary while voice is inactive', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const boundary = jest.spyOn(page.voice, 'onTurnBoundary');
    expect(await page.sendCommand('Summarize')).toBe(true);
    lastTerminalPulseByTab.set(
      new Map([
        [
          'root-tab',
          {
            seq: 1,
            tabId: 'root-tab',
            sessionId: 'session',
            workspacePath: '/workspace',
            revision: 1,
            phase: 'idle',
            terminalReason: 'completed',
            lastAssistantMessage: 'Quiet reply',
            classification: 'success',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
    expect(boundary).not.toHaveBeenCalled();
  });

  it('settles voice pulse 5 before typed pulse 6 with separate turn tokens', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    page.voice['active'] = true;
    page.voice['speak'] = jest.fn();
    const boundary = jest.spyOn(page.voice, 'onTurnBoundary');
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
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(4, 'Old')]]));
    TestBed.tick();
    page.voice['turnGeneration'] = page.voice['generation'];
    page.voice['awaitingBoundary'] = true;
    page.voice['awaitingTurnToken'] = 1;
    page.voice['nextVoiceTurnToken'] = 1;
    page.voice['options'].onVoiceSend?.(1);
    expect(await page.sendCommand('Typed request')).toBe(true);
    expect(page.voice['awaitingTurnToken']).toBe(1);
    lastTerminalPulseByTab.set(
      new Map([['root-tab', pulse(5, 'Voice reply')]]),
    );
    TestBed.tick();
    expect(boundary).toHaveBeenCalledWith('Voice reply', 1);
    expect(page.voice['awaitingTurnToken']).toBe(2);
    lastTerminalPulseByTab.set(
      new Map([['root-tab', pulse(6, 'Typed reply')]]),
    );
    TestBed.tick();
    expect(boundary).toHaveBeenCalledWith('Typed reply', 2);
    expect(boundary).toHaveBeenCalledTimes(2);
  });

  it('shows only the marked tab permission and handles Approve and Deny once by request id', () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    permissionRequests.set([
      {
        id: 'other',
        tabId: 'other-tab',
        toolName: 'Bash',
        description: 'Other',
      },
    ]);
    TestBed.tick();
    expect(page.store.pendingInput()).toBeNull();
    permissionRequests.set([
      {
        id: 'p1',
        tabId: 'root-tab',
        toolName: 'Write',
        description: 'Edit file',
      },
    ]);
    TestBed.tick();
    expect(page.store.pendingInput()).toMatchObject({
      id: 'p1',
      kind: 'approval',
    });
    expect(page.answerPermission('p1', 'Approve')).toBe(true);
    expect(handlePermissionResponse).toHaveBeenCalledWith({
      id: 'p1',
      decision: 'allow',
    });
    permissionRequests.set([
      {
        id: 'p2',
        tabId: 'root-tab',
        toolName: 'Bash',
        description: 'Run command',
      },
    ]);
    TestBed.tick();
    expect(page.answerPermission('p2', 'Deny')).toBe(true);
    expect(handlePermissionResponse).toHaveBeenLastCalledWith({
      id: 'p2',
      decision: 'deny',
    });
    expect(handlePermissionResponse).toHaveBeenCalledTimes(2);
    expect(page.answerPermission('p2', 'yes')).toBe(false);
    expect(handlePermissionResponse).toHaveBeenCalledTimes(2);
  });

  it('keeps a spoken yes from answering a marked permission', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    permissionRequests.set([
      {
        id: 'p-voice',
        tabId: 'root-tab',
        toolName: 'Bash',
        description: 'Run command',
      },
    ]);
    TestBed.tick();
    rpc.call.mockResolvedValue({
      success: true,
      data: { ok: true, transcript: 'yes' },
    });
    page.voice['active'] = true;
    await page.voice['onClip']({
      audioBase64: 'AA==',
      mimeType: 'audio/wav',
    });
    expect(handlePermissionResponse).not.toHaveBeenCalled();
    expect(coordinator.send).not.toHaveBeenCalled();
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

  it('keeps approval shown when a roster arrives and shows roster after permission resolves', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const prompt = jest
      .spyOn(page.voice, 'onPendingPrompt')
      .mockImplementation();
    permissionRequests.set([
      {
        id: 'permission-1',
        tabId: 'root-tab',
        toolName: 'Write',
        description: 'Edit',
      },
    ]);
    TestBed.tick();
    await page.sendCommand('Council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    expect(page['rosterTimeout']).toBeNull();
    expect(page.voice['pendingRoster']).toBe(false);
    expect(page.store.pendingInput()).toMatchObject({
      id: 'permission-1',
      kind: 'approval',
    });
    expect(page.shownProposal()).toBeNull();
    expect(page.answerPermission('permission-1', 'Approve')).toBe(true);
    permissionRequests.set([]);
    TestBed.tick();
    expect(page['rosterTimeout']).not.toBeNull();
    expect(page.voice['pendingRoster']).toBe(true);
    expect(page.store.pendingInput()).toMatchObject({
      id: 'q-roster',
      kind: 'question',
    });
    expect(page.shownProposal()?.proposalId).toBe('p1');
    permissionRequests.set([
      {
        id: 'permission-1',
        tabId: 'root-tab',
        toolName: 'Write',
        description: 'Edit',
      },
    ]);
    TestBed.tick();
    expect(page.store.pendingInput()).toMatchObject({
      id: 'permission-1',
      kind: 'approval',
    });
    expect(page.shownProposal()).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('restores approval after declining a roster while permission remains current and speaks its id once', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const prompt = jest
      .spyOn(page.voice, 'onPendingPrompt')
      .mockImplementation();
    permissionRequests.set([
      {
        id: 'permission-1',
        tabId: 'root-tab',
        toolName: 'Write',
        description: 'Edit',
      },
    ]);
    TestBed.tick();
    await page.sendCommand('Council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    page.declineProposal('p1');
    TestBed.tick();
    expect(page.store.pendingInput()).toMatchObject({
      id: 'permission-1',
      kind: 'approval',
    });
    expect(page.shownProposal()).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

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

  it('cancels an answered confirmation when Decline is used before launch', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('Council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    let rejectDiscovery: ((reason: Error) => void) | null = null;
    transport.discoveryComplete.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDiscovery = reject;
        }),
    );
    transport.cancelDiscovery.mockImplementationOnce(() => {
      rejectDiscovery?.(new Error('Discovery cancelled'));
    });
    const confirmation = page.confirmProposal('p1');
    page.declineProposal('p1');
    await confirmation;
    expect(page.pendingProposal()).toBeNull();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
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
