import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CommandCenterVoiceSessionService,
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
import { CommandOverlayComponent } from './command-overlay.component';

describe('CommandCenterPageController', () => {
  const recordWriteFailure = signal<{
    workspacePath: string;
    record: 'lastSession';
  } | null>(null);
  const tabs = signal<
    {
      id: string;
      status: string;
      claudeSessionId?: string;
      hasLiveSession?: boolean;
      lastTerminalReason?: 'completed' | 'api_error' | 'aborted_streaming';
    }[]
  >([]);
  const activeWorkspacePath = signal<string | null>('/workspace');
  const terminalTurnPulses = signal<readonly TerminalTurnPulse[]>([]);
  const lastTerminalPulseByTab = signal<ReadonlyMap<string, TerminalTurnPulse>>(
    new Map(),
  );
  const visibleTabIds = signal<ReadonlySet<string>>(new Set());
  const registrationCounts = new Map<string, number>();
  const registerVisibleTab = jest.fn((id: string) => {
    registrationCounts.set(id, (registrationCounts.get(id) ?? 0) + 1);
    visibleTabIds.update((ids) => new Set([...ids, id]));
  });
  const unregisterVisibleTab = jest.fn((id: string) => {
    const count = registrationCounts.get(id) ?? 0;
    if (count > 1) {
      registrationCounts.set(id, count - 1);
      return;
    }
    registrationCounts.delete(id);
    visibleTabIds.update((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  });
  const permissionRequests = signal<
    readonly {
      id: string;
      tabId: string;
      sessionId?: string;
      toolName: string;
      description: string;
    }[]
  >([]);
  const handlePermissionResponse = jest.fn();
  const voiceSessions = { activate: jest.fn(), deactivate: jest.fn() };
  const rpc = { call: jest.fn() };
  const questionRequests = signal<
    readonly {
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
  const coordinator = {
    openOrResume: jest.fn(async () => 'root-tab'),
    newCommandCenter: jest.fn(() => {
      page.store.setSession('new-tab', null, '/workspace');
      page.store.setSessionStatus('idle');
      return 'new-tab';
    }),
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
    visibleTabIds.set(new Set());
    registrationCounts.clear();
    tabs.set([]);
    activeWorkspacePath.set('/workspace');
    permissionRequests.set([]);
    rpc.call.mockReset();
    questionRequests.set([]);
    TestBed.configureTestingModule({
      providers: [
        CommandCenterPageController,
        CommandCenterStore,
        { provide: CommandCenterVoiceSessionService, useValue: voiceSessions },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeWorkspacePath$: activeWorkspacePath,
            get activeWorkspacePath() {
              return activeWorkspacePath();
            },
            terminalTurnPulses,
            lastTerminalPulseByTab,
            findTabByIdAcrossWorkspaces: (id: string) => {
              const tab = tabs().find((candidate) => candidate.id === id);
              return tab ? { tab, workspacePath: activeWorkspacePath() } : null;
            },
            visibleTabIds,
            registerVisibleTab,
            unregisterVisibleTab,
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

  it('loads local provider models and download status on open', async () => {
    rpc.call.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        config: {
          sttProvider: 'local',
          ttsProvider: 'local',
          local: {
            modelSource: 'curated',
            whisperModel: 'whisper-base',
            sttDownloaded: true,
            ttsDownloaded: false,
            ttsVoice: 'af_heart',
          },
          elevenlabs: {
            apiKeyConfigured: false,
            sttModelId: 'scribe_v1',
            ttsModelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3',
          },
        },
      },
    });
    await page.open();
    expect(page.store.provider()).toMatchObject({
      transcription: true,
      synthesis: false,
      stt: {
        providerId: 'local',
        providerLabel: 'Local',
        modelLabel: 'whisper-base',
        ready: true,
        status: 'Ready',
      },
      tts: {
        providerId: 'local',
        providerLabel: 'Local',
        modelLabel: 'af_heart',
        ready: false,
        status: 'Not downloaded',
      },
    });
  });

  it('loads ElevenLabs model and fallback voice with key status', async () => {
    rpc.call.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        config: {
          sttProvider: 'elevenlabs',
          ttsProvider: 'elevenlabs',
          local: {
            modelSource: 'curated',
            whisperModel: 'whisper-base',
            sttDownloaded: false,
            ttsDownloaded: false,
            ttsVoice: 'af_heart',
          },
          elevenlabs: {
            apiKeyConfigured: false,
            sttModelId: 'scribe_v1',
            ttsModelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3',
          },
        },
      },
    });
    await page.open();
    expect(page.store.provider()).toMatchObject({
      transcription: false,
      synthesis: false,
      stt: {
        providerId: 'elevenlabs',
        providerLabel: 'ElevenLabs',
        modelLabel: 'scribe_v1',
        ready: false,
        status: 'No key',
      },
      tts: {
        providerId: 'elevenlabs',
        providerLabel: 'ElevenLabs',
        modelLabel: 'No voice chosen',
        ready: false,
        status: 'No key',
      },
    });
  });

  it('clears provider details when config loading fails', async () => {
    rpc.call.mockRejectedValue(new Error('unavailable'));
    await page.open();
    expect(page.store.provider()).toMatchObject({
      transcription: false,
      synthesis: false,
      stt: null,
      tts: null,
    });
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

  it('shows the idle Ptah root before the first SDK session exists', () => {
    tabs.set([{ id: 'root-tab', status: 'loaded' }]);
    page.store.setSession('root-tab', null, '/workspace');
    expect(page.projection().nodes).toEqual([
      expect.objectContaining({
        id: 'root:root-tab',
        kind: 'root',
        label: 'Ptah',
        state: 'idle',
      }),
    ]);
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    expect(page.projection().nodes[0]?.state).toBe('running');
    questionRequests.set([
      {
        id: 'question-1',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Which branch?',
            header: 'Branch',
            options: [],
            multiSelect: false,
          },
        ],
      },
    ]);
    expect(page.projection().nodes[0]?.state).toBe('awaiting input');
  });

  it('keeps root selection and the pinned card when the SDK ID arrives', () => {
    tabs.set([{ id: 'root-tab', status: 'loaded' }]);
    page.store.setSession('root-tab', null, '/workspace');
    TestBed.tick();
    const rootId = page.projection().nodes[0]?.id;
    expect(rootId).toBe('root:root-tab');
    const fixture = TestBed.createComponent(CommandOverlayComponent);
    fixture.componentRef.setInput('projection', page.projection());
    fixture.detectChanges();
    fixture.componentInstance.pin('root:root-tab');
    fixture.detectChanges();
    tabs.set([
      { id: 'root-tab', status: 'loaded', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    TestBed.tick();
    fixture.componentRef.setInput('projection', page.projection());
    fixture.detectChanges();
    expect(page.projection().nodes[0]?.id).toBe(rootId);
    expect(page.store.selectedId()).toBe(rootId);
    expect(fixture.componentInstance.pinnedNodeId()).toBe(rootId);
    fixture.destroy();
  });

  it('clears a voice error and its toast before retrying Start voice', async () => {
    page.store.setVoiceError({
      kind: 'worklet',
      message: 'Voice capture could not start.',
    });
    page.store.setToast({
      message: 'Voice capture could not start.',
      tone: 'error',
    });
    jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    await page.startVoice();
    expect(page.store.voiceError()).toBeNull();
    expect(page.store.toast()).toBeNull();
  });

  it('does not turn an untouched microphone into an Unmute action', async () => {
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    page.store.setSession('root-tab', null, '/workspace');
    const start = jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    await page.toggleMuteVoice();
    expect(page.store.muted()).toBe(false);
    expect(page.store.voiceState()).toBe('idle');
    expect(start).not.toHaveBeenCalled();
  });

  it('allows Stop for a streaming typed turn and settles status at the terminal pulse', () => {
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    // Binding flushes before the turn can end, as it does in the app.
    TestBed.tick();
    expect(page.turnAbortable()).toBe(true);
    tabs.set([
      { id: 'root-tab', status: 'loaded', claudeSessionId: 'session' },
    ]);
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
            lastAssistantMessage: 'Done',
            classification: 'success',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
    expect(page.turnAbortable()).toBe(false);
    expect(page.store.sessionStatus()).toBe('idle');
    expect(page.latestReply()).toBe('Done');
  });

  it('keeps running when an older terminal pulse arrives during a second turn', () => {
    const pulse = (seq: number): TerminalTurnPulse => ({
      seq,
      tabId: 'root-tab',
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: seq,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: `Reply ${seq}`,
      classification: 'success',
      title: 'Command Center',
      occurredAt: Date.now(),
    });
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(1)]]));
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('running');
    tabs.set([
      {
        id: 'root-tab',
        status: 'loaded',
        claudeSessionId: 'session',
        lastTerminalReason: 'completed',
      },
    ]);
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse(2)]]));
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('idle');
  });

  it('settles without a terminal pulse when the root stops streaming', () => {
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    tabs.set([
      { id: 'root-tab', status: 'loaded', claudeSessionId: 'session' },
    ]);
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('idle');
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
            lastAssistantMessage: 'Done',
            classification: 'success',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('idle');
    expect(page.store.toast()).toBeNull();
  });

  it('reports a failed session start using the tab state and fixed text', () => {
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    page.store.setSession('root-tab', null, '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    tabs.set([{ id: 'root-tab', status: 'loaded', hasLiveSession: false }]);
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('error');
    expect(page.store.toast()).toEqual({
      message: 'The Command Center turn could not finish.',
      tone: 'error',
    });
  });

  it.each([true, undefined])(
    'settles a root without a session ID when hasLiveSession is %s',
    (hasLiveSession) => {
      tabs.set([{ id: 'root-tab', status: 'streaming' }]);
      page.store.setSession('root-tab', null, '/workspace');
      page.store.setSessionStatus('running');
      TestBed.tick();
      tabs.set([{ id: 'root-tab', status: 'loaded', hasLiveSession }]);
      TestBed.tick();
      expect(page.store.sessionStatus()).toBe('idle');
      expect(page.store.toast()).toBeNull();
    },
  );

  it('rebinds on workspace changes and refuses stale sends', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    TestBed.tick();
    activeWorkspacePath.set('/other');
    coordinator.openOrResume.mockImplementationOnce(async () => {
      page.store.setSession('other-tab', null, '/other');
      return 'other-tab';
    });
    expect(await page.sendCommand('Hello')).toBe(false);
    expect(coordinator.send).not.toHaveBeenCalled();
    expect(coordinator.openOrResume).toHaveBeenCalled();
    TestBed.tick();
    await Promise.resolve();
    expect(page.store.workspace()).toBe('/other');
    expect(page.store.markedTabId()).toBe('other-tab');
    activeWorkspacePath.set(null);
    TestBed.tick();
    expect(page.store.markedTabId()).toBeNull();
    expect(page.store.toast()?.message).toBe(
      'Open a workspace to use Command Center.',
    );
    expect(await page.sendCommand('Hello')).toBe(false);
  });

  it('settles a failed root as error without a terminal pulse', () => {
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    tabs.set([
      {
        id: 'root-tab',
        status: 'loaded',
        claudeSessionId: 'session',
        lastTerminalReason: 'api_error',
      },
    ]);
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('error');
    expect(page.store.toast()).toEqual({
      message: 'The Command Center turn could not finish.',
      tone: 'error',
    });
  });

  it('shows stopped and send error even while a stale tab remains streaming', () => {
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    expect(page.shownSessionStatus()).toBe('running');
    page.store.setSessionStatus('stopped');
    expect(page.shownSessionStatus()).toBe('stopped');
    page.store.setSessionStatus('error');
    expect(page.shownSessionStatus()).toBe('error');
  });

  it('shows a fixed error toast when a real failure emits a terminal pulse', () => {
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    tabs.set([
      {
        id: 'root-tab',
        status: 'loaded',
        claudeSessionId: 'session',
        lastTerminalReason: 'api_error',
      },
    ]);
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
            terminalReason: 'api_error',
            lastAssistantMessage: null,
            classification: 'error',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
    expect(page.shownSessionStatus()).toBe('error');
    expect(page.store.toast()).toEqual({
      message: 'The Command Center turn could not finish.',
      tone: 'error',
    });
  });

  it('shows the live tab status after resume and on a later stream without send', () => {
    tabs.set([{ id: 'root-tab', status: 'loaded' }]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();
    expect(page.shownSessionStatus()).toBe('idle');

    page.store.setSessionStatus('idle');
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    TestBed.tick();
    expect(page.shownSessionStatus()).toBe('running');

    tabs.set([{ id: 'root-tab', status: 'awaiting-background' }]);
    TestBed.tick();
    expect(page.shownSessionStatus()).toBe('running');
    tabs.set([{ id: 'root-tab', status: 'sleeping' }]);
    TestBed.tick();
    expect(page.shownSessionStatus()).toBe('running');
  });

  it('keeps background work running when streaming ends or a pulse arrives', () => {
    tabs.set([{ id: 'root-tab', status: 'streaming' }]);
    page.store.setSession('root-tab', 'session', '/workspace');
    page.store.setSessionStatus('running');
    TestBed.tick();

    tabs.set([{ id: 'root-tab', status: 'awaiting-background' }]);
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('running');
    const pulse: TerminalTurnPulse = {
      tabId: 'root-tab',
      seq: 1,
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: 1,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: null,
      classification: 'success',
      title: 'Command Center',
      occurredAt: Date.now(),
    };
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse]]));
    TestBed.tick();
    expect(page.store.sessionStatus()).toBe('running');
    expect(page.shownSessionStatus()).toBe('running');
  });

  it('ends the voice loop and clears mute when the marked session changes', async () => {
    tabs.set([{ id: 'root-tab', status: 'loaded' }]);
    page.store.setSession('root-tab', null, '/workspace');
    TestBed.tick();
    page.voice['muted'] = true;
    page.store.setMuted(true);
    page.store.setVoiceState('muted');
    tabs.set([{ id: 'new-tab', status: 'loaded' }]);
    page.store.setSession('new-tab', null, '/workspace');
    page.store.setSessionStatus('idle');
    TestBed.tick();
    await Promise.resolve();
    expect(page.store.muted()).toBe(false);
    expect(page.store.voiceState()).toBe('idle');
    expect(page.voice['muted']).toBe(false);
  });

  it('reports a voice exit failure on marked-tab change', async () => {
    page.store.setSession('root-tab', null, '/workspace');
    TestBed.tick();
    jest
      .spyOn(page.voice, 'exit')
      .mockRejectedValue(new Error('capture stop failed'));
    page.store.setSession('new-tab', null, '/workspace');
    TestBed.tick();
    await Promise.resolve();
    expect(page.store.toast()?.message).toBe('Could not stop voice capture.');
  });

  it('registers the marked tab for this page lifetime and releases it on change and destroy', () => {
    page.store.setSession('first-tab', null, '/workspace');
    TestBed.tick();
    expect(registerVisibleTab).toHaveBeenCalledWith('first-tab');
    expect(visibleTabIds().has('first-tab')).toBe(true);

    page.store.setSession('second-tab', null, '/workspace');
    TestBed.tick();
    expect(unregisterVisibleTab).toHaveBeenCalledWith('first-tab');
    expect(visibleTabIds().has('first-tab')).toBe(false);
    expect(visibleTabIds().has('second-tab')).toBe(true);

    TestBed.resetTestingModule();
    expect(unregisterVisibleTab).toHaveBeenCalledWith('second-tab');
    expect(visibleTabIds().has('second-tab')).toBe(false);
  });

  it('keeps a marked tab visible when an older owner unregisters after page registration', () => {
    registerVisibleTab('shared-tab');
    page.store.setSession('shared-tab', null, '/workspace');
    TestBed.tick();
    expect(registerVisibleTab).toHaveBeenCalledTimes(2);

    unregisterVisibleTab('shared-tab');
    expect(visibleTabIds().has('shared-tab')).toBe(true);

    page.store.setSession('owned-tab', null, '/workspace');
    TestBed.tick();
    expect(visibleTabIds().has('shared-tab')).toBe(false);
    expect(visibleTabIds().has('owned-tab')).toBe(true);

    TestBed.resetTestingModule();
    expect(visibleTabIds().has('owned-tab')).toBe(false);
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

  it('declines an untagged Tribunal choice and rejects click and spoken approval', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    questionRequests.set([
      {
        id: 'q-untagged',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Approve the Tribunal roster?',
            header: 'Tribunal',
            options: [
              { label: 'Decline', description: '' },
              { label: 'Confirm', description: '' },
            ],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.ordinaryQuestion()).toBeNull();
    expect(page.ordinaryChoices()).not.toContain('Confirm');
    expect(transport.answer).toHaveBeenCalledWith(
      'q-untagged',
      'Approve the Tribunal roster?',
      'Decline',
    );
    expect(page.store.toast()?.message).toContain('Invalid Tribunal proposal');
    expect(page.answerOrdinaryQuestion('q-untagged', 'Confirm')).toBe(false);
    expect(page.voice['options'].answerOrdinaryQuestion?.('confirm')).toBe(
      false,
    );
    expect(page.voice['options'].answerOrdinaryQuestion?.('yes')).toBe(false);
    expect(coordinator.answerQuestion).not.toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({
          'Approve the Tribunal roster?':
            expect.stringMatching(/^(confirm|yes)/i),
        }),
      }),
    );
  });

  it('offers Confirm and accepts Confirm or yes on an ordinary question without Tribunal', () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    questionRequests.set([
      {
        id: 'q-choice',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Proceed?',
            header: 'Choice',
            multiSelect: false,
            options: [
              { label: 'Decline', description: '' },
              { label: 'Confirm now', description: '' },
            ],
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.ordinaryChoices()).toEqual(['Decline', 'Confirm now']);
    expect(page.answerOrdinaryQuestion('q-choice', 'Confirm')).toBe(true);
    expect(page.answerOrdinaryQuestion('q-choice', 'yes')).toBe(true);
    expect(coordinator.answerQuestion).toHaveBeenCalledTimes(2);
    expect(coordinator.answerQuestion).toHaveBeenCalledWith({
      id: 'q-choice',
      answers: { 'Proceed?': 'yes' },
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

  const offerOrdinaryConfirm = (): void => {
    questionRequests.set([
      {
        id: 'q-later',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Overwrite config?',
            header: 'Config',
            options: [
              { label: 'Cancel', description: '' },
              { label: 'Confirm', description: '' },
            ],
            multiSelect: false,
          },
        ],
      },
    ]);
    TestBed.tick();
  };

  it('restores ordinary Confirm after a proposal resolves', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    page.declineProposal('p1');
    transport.answer.mockClear();
    offerOrdinaryConfirm();
    expect(page.ordinaryChoices()).toContain('Confirm');
    expect(page.answerOrdinaryQuestion('q-later', 'yes')).toBe(true);
    expect(transport.answer).not.toHaveBeenCalled();
  });

  it('restores ordinary Confirm after a request turn ends without a proposal', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    const pulse: TerminalTurnPulse = {
      seq: 1,
      tabId: 'root-tab',
      sessionId: 'session',
      workspacePath: '/workspace',
      revision: 1,
      phase: 'idle',
      terminalReason: 'completed',
      lastAssistantMessage: 'No proposal',
      classification: 'success',
      title: 'Command Center',
      occurredAt: Date.now(),
    };
    lastTerminalPulseByTab.set(new Map([['root-tab', pulse]]));
    TestBed.tick();
    offerOrdinaryConfirm();
    expect(page.ordinaryChoices()).toContain('Confirm');
    expect(page.answerOrdinaryQuestion('q-later', 'Confirm')).toBe(true);
    expect(transport.answer).not.toHaveBeenCalled();
  });

  it('keeps a Tribunal request through the terminal pulse of a turn already running at send', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    tabs.set([
      { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
    ]);
    await page.sendCommand('run a council on X');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
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
            lastAssistantMessage: 'Earlier turn complete',
            classification: 'success',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    TestBed.tick();
    offer(roster(nonce));
    expect(page.pendingProposal()?.proposalId).toBe('p1');
    expect(page.store.toast()?.message ?? '').not.toContain(
      'Invalid Tribunal proposal',
    );
    expect(transport.answer).not.toHaveBeenCalledWith(
      'q-roster',
      expect.any(String),
      'Decline',
    );
  });

  it('declines deviating untagged output on the root session while Tribunal is outstanding', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    questionRequests.set([
      {
        id: 'q-deviating',
        tabId: 'other-tab',
        sessionId: 'session',
        questions: [
          {
            question: 'Launch council?',
            header: 'Council',
            multiSelect: false,
            options: [
              { label: 'Proceed', description: '' },
              { label: 'Cancel', description: '' },
            ],
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.ordinaryQuestion()).toBeNull();
    expect(transport.answer).toHaveBeenCalledWith(
      'q-deviating',
      'Launch council?',
      'Decline',
    );
    expect(coordinator.answerQuestion).not.toHaveBeenCalled();
  });

  it('blocks text and voice sends after a failed Decline until an explicit retry succeeds', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    transport.answer.mockReturnValueOnce(false);
    const request = {
      id: 'q-deviating',
      tabId: 'root-tab',
      questions: [
        {
          question: 'Proceed?',
          header: 'Council',
          multiSelect: false as const,
          options: [{ label: 'Proceed', description: '' }],
        },
      ],
    };
    questionRequests.set([request]);
    TestBed.tick();
    expect(page.store.toast()?.message).toContain('could not be declined');
    expect(transport.answer).toHaveBeenCalledTimes(1);
    coordinator.send.mockClear();
    expect(await page.sendCommand('yes')).toBe(false);
    expect(await page.voice['options'].sendTranscript('yes')).toBe(false);
    expect(coordinator.send).not.toHaveBeenCalled();
    expect(page.store.toast()?.message).toContain('Retry the Decline');
    expect(page.store.toast()?.action).toBe('retry-decline');
    page.retryInvalidDecline();
    expect(transport.answer).toHaveBeenCalledTimes(2);
    expect(page.store.toast()?.message).toContain('It was declined');
    expect(page.undeclinedInvalidQuestionId()).toBeNull();
    expect(page.ordinaryQuestion()).toBeNull();
    expect(await page.sendCommand('status')).toBe(true);
  });

  it('clears a failed Decline and its retry timer on exit', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    transport.answer.mockReturnValue(false);
    questionRequests.set([
      {
        id: 'q-deviating',
        tabId: 'root-tab',
        questions: [
          {
            question: 'Proceed?',
            header: 'Council',
            multiSelect: false,
            options: [],
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(page.undeclinedInvalidQuestionId()).toBe('q-deviating');
    await page.exit();
    expect(page.undeclinedInvalidQuestionId()).toBeNull();
    expect(page.pendingProposal()).toBeNull();
  });

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
    await page.sendCommand('run council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    expect(page.voice['pendingRoster']).toBe(false);
    expect(page.store.pendingInput()).toMatchObject({
      id: 'permission-1',
      kind: 'approval',
    });
    expect(page.shownProposal()).toBeNull();
    expect(page.answerPermission('permission-1', 'Approve')).toBe(true);
    permissionRequests.set([]);
    TestBed.tick();
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
    await page.sendCommand('run council review');
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

  it('frames explicit Tribunal intent with a fresh page nonce and root id; ordinary text stays unchanged', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    coordinator.send.mockClear();
    await page.sendCommand('run a Council review');
    const framed = coordinator.send.mock.calls.at(-1)?.[0] ?? '';
    expect(framed).toContain('<COMMAND_CENTER_TRIBUNAL_REQUEST>');
    expect(framed).toContain('"rootSessionId":"session"');
    expect(framed).toMatch(/"nonce":"[0-9a-f-]{36}"/);
    await page.sendCommand('Just discuss the work');
    expect(coordinator.send).toHaveBeenLastCalledWith('Just discuss the work');
    await page.sendCommand('fix the race condition');
    expect(coordinator.send).toHaveBeenLastCalledWith('fix the race condition');
  });

  it('sends incidental move words without a session as ordinary text', async () => {
    page.store.setSession('root-tab', null, '/workspace');
    expect(await page.sendCommand('fix the race condition')).toBe(true);
    expect(coordinator.send).toHaveBeenLastCalledWith('fix the race condition');
  });

  it('opens a matching roster and rejects wrong nonce or root', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    const announce = jest
      .spyOn(page.voice, 'onRosterProposal')
      .mockImplementation();
    await page.sendCommand('run council review');
    offer(roster('wrong'), 'q-wrong');
    expect(page.pendingProposal()).toBeNull();
    await page.sendCommand('run council review');
    let nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce, 'wrong'), 'q-root');
    expect(page.pendingProposal()).toBeNull();
    await page.sendCommand('run council review');
    nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce), 'q-good');
    expect(page.pendingProposal()?.proposalId).toBe('p1');
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('Tribunal council'),
      true,
    );
  });

  it('confirms once and launches after the manifest without affirmative answer text', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run relay review');
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

  it('keeps a retryable roster card and clears one that cannot launch', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
    const nonce =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(nonce));
    transport.writeManifest.mockReturnValueOnce(false);
    await page.confirmProposal('p1');
    expect(page.pendingProposal()?.proposalId).toBe('p1');
    transport.availability.mockReturnValueOnce({
      lanes: [],
      disabledClis: [],
    });
    await page.confirmProposal('p1');
    expect(page.pendingProposal()).toBeNull();
    const reports = transport.reportFailure.mock.calls.length;
    await page.confirmProposal('p1');
    expect(transport.reportFailure).toHaveBeenCalledTimes(reports);
  });

  it('cancels an answered confirmation when Decline is used before launch', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    await page.sendCommand('run council review');
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
    await page.sendCommand('run council review');
    const first =
      /"nonce":"([^"]+)"/.exec(
        coordinator.send.mock.calls.at(-1)?.[0] ?? '',
      )?.[1] ?? '';
    offer(roster(first));
    page.declineProposal('p1');
    await page.sendCommand('run forge review');
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

  it('cancels discovery on Start new and exits transport only on page exit', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    TestBed.tick();

    page.coordinator.newCommandCenter();
    TestBed.tick();
    expect(transport.cancelDiscovery).toHaveBeenCalledTimes(1);
    expect(transport.pageExit).not.toHaveBeenCalled();

    jest.spyOn(page.voice, 'exit').mockResolvedValue(undefined);
    await page.exit();
    expect(transport.pageExit).toHaveBeenCalledTimes(1);
  });

  it('clears a pending roster timer and card on exit', async () => {
    jest.useFakeTimers();
    try {
      page.store.setSession('root-tab', 'session', '/workspace');
      await page.sendCommand('run council review');
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

  it('clears the old roster card on Start new and ignores its later Confirm', async () => {
    jest.useFakeTimers();
    try {
      tabs.set([{ id: 'root-tab', status: 'loaded' }]);
      page.store.setSession('root-tab', 'session', '/workspace');
      TestBed.tick();
      await page.sendCommand('run council review');
      const nonce =
        /"nonce":"([^"]+)"/.exec(
          coordinator.send.mock.calls.at(-1)?.[0] ?? '',
        )?.[1] ?? '';
      offer(roster(nonce));
      expect(page.shownProposal()?.proposalId).toBe('p1');

      tabs.set([{ id: 'new-tab', status: 'loaded' }]);
      page.coordinator.newCommandCenter();
      TestBed.tick();
      expect(page.pendingProposal()).toBeNull();
      expect(page.shownProposal()).toBeNull();
      expect(page.shownInput()?.title).not.toBe('Tribunal proposal');
      transport.answer.mockClear();
      await page.confirmProposal('p1');
      jest.advanceTimersByTime(120_000);
      expect(transport.answer).not.toHaveBeenCalled();
      expect(page.rosterTimedOut()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  it('keeps the pre-send sequence when a pulse arrives before send resolves', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    page.voice['active'] = true;
    let finishSend: ((value: boolean) => void) | undefined;
    coordinator.send.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishSend = resolve;
        }),
    );
    const pending = page.sendCommand('Review');
    lastTerminalPulseByTab.set(
      new Map([
        [
          'root-tab',
          {
            tabId: 'root-tab',
            seq: 1,
            sessionId: 'session',
            workspacePath: '/workspace',
            revision: 1,
            phase: 'idle',
            terminalReason: 'completed',
            classification: 'success',
            lastAssistantMessage: 'Done',
            title: 'Command Center',
            occurredAt: Date.now(),
          },
        ],
      ]),
    );
    finishSend?.(true);
    expect(await pending).toBe(true);
    expect(
      page.voice['queuedTypedTurns'][0] ?? page['armedTurns'][0]?.minPulseSeq,
    ).toBe(0);
  });

  it('expires an idle armed turn once and ignores its late pulse', () => {
    jest.useFakeTimers();
    try {
      page.store.setSession('root-tab', 'session', '/workspace');
      tabs.set([
        { id: 'root-tab', status: 'loaded', claudeSessionId: 'session' },
      ]);
      const abandon = jest
        .spyOn(page.voice, 'abandonTurn')
        .mockImplementation();
      page.voice['options'].onVoiceSend?.(1, 0);
      TestBed.tick();
      jest.advanceTimersByTime(12_000);
      expect(abandon).not.toHaveBeenCalled();
      tabs.set([
        { id: 'root-tab', status: 'streaming', claudeSessionId: 'session' },
      ]);
      TestBed.tick();
      tabs.set([
        { id: 'root-tab', status: 'loaded', claudeSessionId: 'session' },
      ]);
      TestBed.tick();
      jest.advanceTimersByTime(12_000);
      expect(abandon).toHaveBeenCalledWith(1, 'timed-out');
      expect(page['armedTurns']).toHaveLength(0);
      lastTerminalPulseByTab.set(
        new Map([
          [
            'root-tab',
            {
              tabId: 'root-tab',
              seq: 1,
              sessionId: 'session',
              workspacePath: '/workspace',
              revision: 1,
              phase: 'idle',
              terminalReason: 'completed',
              classification: 'success',
              lastAssistantMessage: 'Late',
              title: 'Command Center',
              occurredAt: Date.now(),
            },
          ],
        ]),
      );
      TestBed.tick();
      expect(abandon).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['aborted_streaming', 'aborted'],
    ['aborted_tools', 'aborted'],
    ['api_error', 'failed'],
  ] as const)(
    'classifies %s pulse as %s for voice',
    (terminalReason, outcome) => {
      page.store.setSession('root-tab', 'session', '/workspace');
      const abandon = jest
        .spyOn(page.voice, 'abandonTurn')
        .mockImplementation();
      page.voice['options'].onVoiceSend?.(1, 0);
      TestBed.tick();
      lastTerminalPulseByTab.set(
        new Map([
          [
            'root-tab',
            {
              tabId: 'root-tab',
              seq: 1,
              sessionId: 'session',
              workspacePath: '/workspace',
              revision: 1,
              phase: 'idle',
              terminalReason,
              classification: 'error',
              lastAssistantMessage: null,
              title: 'Command Center',
              occurredAt: Date.now(),
            },
          ],
        ]),
      );
      TestBed.tick();
      expect(abandon).toHaveBeenCalledWith(1, outcome);
    },
  );

  it('marks the root voice session only after capture starts and clears it on stop', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    jest.spyOn(page.voice, 'stop').mockResolvedValue(undefined);
    expect(await page.startVoice()).toBe(true);
    expect(voiceSessions.activate).toHaveBeenCalledWith('root-tab');
    await page.stopVoice();
    expect(voiceSessions.deactivate).toHaveBeenCalledWith('root-tab');
  });

  it('deactivates the root voice flag on mute and reactivates on unmute', async () => {
    page.store.setSession('root-tab', 'session', '/workspace');
    jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    jest.spyOn(page.voice, 'mute').mockResolvedValue(undefined);
    expect(await page.startVoice()).toBe(true);
    await page.muteVoice();
    expect(voiceSessions.deactivate).toHaveBeenCalledWith('root-tab');
    page.store.setMuted(true);
    await page.toggleMuteVoice();
    expect(voiceSessions.activate).toHaveBeenCalledTimes(2);
  });
});
