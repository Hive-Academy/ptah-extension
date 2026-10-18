import { Component, computed, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TabManagerService } from '@ptah-extension/chat-state';
import { sessionContextCue } from '@ptah-extension/chat-ui';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CommandCenterStore } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import type { TribunalRosterProposal } from '../model/tribunal-roster-proposal';
import { CommandSceneComponent } from '../scene/command-scene.component';
import { CommandOverlayComponent } from './command-overlay.component';
import { CommandPendingInputComponent } from './command-pending-input.component';
import { CommandSessionControlsComponent } from './command-session-controls.component';
import { CommandCenterStartComponent } from './command-center-start.component';
import { CommandVoiceHudComponent } from './command-voice-hud.component';
import { CommandWorkListComponent } from './command-work-list.component';
import { CommandCenterPageComponent } from './command-center-page.component';
import { CommandCenterPageController } from './command-center-page.controller';
import { CommandNodeDetailComponent } from './command-node-detail.component';
import { CommandSessionStatsComponent } from './command-session-stats.component';

@Component({ selector: 'ptah-command-scene', standalone: true, template: '' })
class SceneStubComponent {
  public readonly setOverlayLabels = jest.fn();
  public readonly setCardAnchor = jest.fn();
  public readonly layout = signal({
    nodes: [],
    overflowCompleted: 0,
    overflowOther: 0,
    overflowChip: null,
  });
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly theme = input('dark');
  public readonly voiceState = input('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly selection = output<string>();
  public readonly hoveredNodeId = output<string | null>();
  public readonly canvasUnavailable = output<boolean>();
}

describe('CommandCenterPageComponent', () => {
  const nodes: ProjectionResult['nodes'] = [
    {
      id: 'root:session',
      kind: 'root',
      parentId: null,
      label: 'Root',
      providerId: null,
      state: 'running',
    },
    {
      id: 'child:one',
      kind: 'child',
      parentId: 'root:session',
      label: 'Child',
      providerId: null,
      state: 'running',
    },
  ];
  const projection = signal<ProjectionResult>({ nodes, edges: [] });
  type LiveContext = NonNullable<Parameters<typeof sessionContextCue>[0]>;
  const tabs = signal<
    {
      id: string;
      liveModelStats?: LiveContext | null;
      sessionStats?: SessionStatsEntry | null;
    }[]
  >([]);
  const stats: SessionStatsEntry = {
    sessionId: 'root',
    model: null,
    totalCost: 0.2,
    tokens: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
    tokenCount: 12,
    messageCount: 3,
    status: 'ok',
  };
  const verifiedContext = (percent: number): LiveContext => ({
    model: 'claude',
    contextKnown: true,
    contextCapacity: {
      tokens: 200_000,
      source: 'sdk-native',
      providerId: null,
      model: 'claude',
    },
    contextUsed: percent * 2_000,
    contextWindow: 200_000,
    contextPercent: percent,
  });
  const hoveredNodeId = signal<string | null>(null);
  const canvasUnavailable = signal(false);
  const now = signal(1_000);
  const pendingProposal = signal<TribunalRosterProposal | null>(null);
  const recordWriteFailure = signal<{
    workspacePath: string;
    record: 'lastSession';
  } | null>(null);
  const store = new CommandCenterStore();
  const controller = {
    store,
    projection,
    hoveredNodeId,
    canvasUnavailable,
    now,
    pendingProposal,
    shownProposal: computed(() =>
      store.pendingInput()?.kind === 'approval' ? null : pendingProposal(),
    ),
    recordWriteFailure,
    latestReply: signal<string | null>(null),
    turnAbortable: signal(false),
    shownSessionStatus: computed(() => store.sessionStatus()),
    rosterTimedOut: signal(false),
    ordinaryQuestion: signal(null),
    ordinaryChoices: signal<readonly string[]>([]),
    coordinator: {
      newCommandCenter: jest.fn(),
      sendStatusTurn: jest.fn(),
      sessions: signal([]),
      listStatus: signal('ready'),
      showAll: signal(false),
      choosing: signal(false),
      currentTabId: signal<string | null>(null),
      currentSessionId: signal(null),
      recordedSessionId: signal(null),
      chooseSession: jest.fn(),
      chooseCurrentTab: jest.fn(),
      refreshSessions: jest.fn(),
    },
    tabs: { activeWorkspacePath: '/workspace', tabs },
    open: jest.fn(async (): Promise<string | null> => 'root-tab'),
    exit: jest.fn(async () => undefined),
    confirmProposal: jest.fn(async (_id: string) => undefined),
    declineProposal: jest.fn((_id: string) => undefined),
    answerOrdinaryQuestion: jest.fn(),
    answerPermission: jest.fn(),
    startVoice: jest.fn(),
    stopVoice: jest.fn(),
    toggleMuteVoice: jest.fn(),
    retrySpeech: jest.fn(),
    retryInvalidDecline: jest.fn(),
    interruptSpeech: jest.fn(),
    openVoiceSettings: jest.fn(),
    sendCommand: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    store.setSession('root-tab', null, '/workspace');
    tabs.set([]);
    controller.coordinator.currentTabId.set(null);
    projection.set({ nodes, edges: [] });
    controller.sendCommand.mockResolvedValue(true);
    hoveredNodeId.set(null);
    canvasUnavailable.set(false);
    now.set(1_000);
    pendingProposal.set(null);
    store.setPendingInput(null);
    store.setVoiceError(null);
    recordWriteFailure.set(null);
    store.setProjection('root:session', nodes, []);
    store.select(null);
    store.setProvider({
      transcription: false,
      synthesis: false,
      stt: null,
      tts: null,
    });
    TestBed.configureTestingModule({
      imports: [CommandCenterPageComponent],
      providers: [
        {
          provide: TabManagerService,
          useValue: { commandCenterRecordWriteFailure: recordWriteFailure },
        },
      ],
    });
    TestBed.overrideComponent(CommandCenterPageComponent, {
      remove: {
        imports: [CommandSceneComponent],
        providers: [CommandCenterPageController, CommandCenterStore],
      },
      add: {
        imports: [SceneStubComponent],
        providers: [
          { provide: CommandCenterPageController, useValue: controller },
          { provide: CommandCenterStore, useValue: store },
        ],
      },
    });
  });

  it('shows verified context from the marked root tab only', () => {
    tabs.set([
      { id: 'other-tab', liveModelStats: verifiedContext(91) },
      { id: 'root-tab', liveModelStats: verifiedContext(42) },
    ]);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      'header .badge:last-of-type',
    ) as HTMLElement;
    expect(chip.textContent).toContain('Context 42%');
    expect(chip.textContent).not.toContain('91%');
    expect(chip.classList.contains('text-base-content-muted')).toBe(true);
    fixture.destroy();
  });

  it('uses the root snapshot for the stage strip and exact child tab for shared details', () => {
    tabs.set([
      { id: 'root-tab', sessionStats: stats },
      {
        id: 'child-tab',
        sessionStats: {
          ...stats,
          sessionId: 'child',
          messageCount: 7,
          tokenCount: 30,
        },
      },
      { id: 'unrelated', sessionStats: { ...stats, messageCount: 99 } },
    ]);
    projection.set({
      nodes: [
        nodes[0],
        { ...nodes[1], tabId: 'child-tab', task: '<b>Work</b>' },
      ],
      edges: [],
    });
    store.select('child:one');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const strip = fixture.debugElement.query(
      By.directive(CommandSessionStatsComponent),
    ).componentInstance as CommandSessionStatsComponent;
    expect(strip.snapshot()?.sessionId).toBe('root');
    const rail = fixture.nativeElement.querySelector(
      '[aria-label="Selected work"]',
    ) as HTMLElement;
    expect(rail.querySelector('ptah-command-node-detail')).not.toBeNull();
    expect(rail.textContent).toContain('7 messages');
    expect(rail.textContent).not.toContain('99 messages');
    expect(rail.textContent).toContain('<b>Work</b>');
    expect(rail.querySelector('b')).toBeNull();
    const detail = fixture.debugElement.query(
      By.directive(CommandNodeDetailComponent),
    ).componentInstance as CommandNodeDetailComponent;
    expect(detail.childStats()?.tokens).toBe(30);
    fixture.destroy();
  });

  it('keeps the provisional marker and omits unloaded zero child messages', () => {
    tabs.set([
      { id: 'root-tab', sessionStats: stats },
      {
        id: 'child-tab',
        sessionStats: {
          ...stats,
          sessionId: 'child',
          provisional: true,
          messageCount: 0,
          tokenCount: 12_345,
          totalCost: 0.012345678,
        },
      },
    ]);
    projection.set({
      nodes: [nodes[0], { ...nodes[1], tabId: 'child-tab' }],
      edges: [],
    });
    store.select('child:one');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const rail = fixture.nativeElement.querySelector(
      '[aria-label="Selected work"]',
    ) as HTMLElement;
    expect(rail.textContent).toContain('~12.3k tokens');
    expect(rail.textContent).toContain('~$0.01');
    expect(rail.textContent).not.toContain('0 messages');
    fixture.destroy();
  });

  it('shows unknown context without a zero or warning', () => {
    tabs.set([
      {
        id: 'root-tab',
        liveModelStats: {
          ...verifiedContext(0),
          contextCapacity: undefined,
        },
      },
    ]);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      'header .badge:last-of-type',
    ) as HTMLElement;
    expect(chip.textContent).toContain('Context unknown');
    expect(chip.textContent).not.toContain('0%');
    expect(chip.textContent).not.toContain('Warning');
    fixture.destroy();
  });

  it('keeps the context chip and stage counts out of the start view', () => {
    tabs.set([{ id: 'root-tab', liveModelStats: verifiedContext(42) }]);
    store.setSession(null, null, '/workspace');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-command-center-start'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('header')?.textContent,
    ).not.toContain('Context');
    expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
    fixture.destroy();
  });

  it('passes the controller clock to the start view', () => {
    store.setSession(null, null, '/workspace');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const start = fixture.debugElement.query(
      By.directive(CommandCenterStartComponent),
    ).componentInstance as CommandCenterStartComponent;
    expect(start.now()).toBe(1_000);
    now.set(31_000);
    fixture.detectChanges();
    expect(start.now()).toBe(31_000);
    fixture.destroy();
  });

  it('passes the current tab snapshot to the start row without borrowing another tab', () => {
    store.setSession(null, null, '/workspace');
    tabs.set([{ id: 'other-tab', sessionStats: stats }, { id: 'current-tab' }]);
    controller.coordinator.currentTabId.set('current-tab');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const start = fixture.debugElement.query(
      By.directive(CommandCenterStartComponent),
    ).componentInstance as CommandCenterStartComponent;
    expect(start.currentStats()).toBeNull();
    tabs.set([
      { id: 'other-tab', sessionStats: stats },
      {
        id: 'current-tab',
        sessionStats: { ...stats, sessionId: 'current', totalCost: 0.4 },
      },
    ]);
    fixture.detectChanges();
    expect(start.currentStats()?.sessionId).toBe('current');
    expect(start.currentStats()?.totalCost).toBe(0.4);
    controller.coordinator.currentTabId.set(null);
    fixture.detectChanges();
    expect(start.currentStats()).toBeNull();
    fixture.destroy();
  });

  it('passes the existing output level signal to the voice HUD', () => {
    store.setVoiceState('speaking');
    store.resetLevels();
    store.updateLevels(0, 0.7);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const hud = fixture.debugElement.query(
      By.directive(CommandVoiceHudComponent),
    ).componentInstance as CommandVoiceHudComponent;
    expect(hud.outputLevel()).toBe(0.7);
    expect(
      fixture.nativeElement
        .querySelector('[role="meter"][aria-label="Speaker"]')
        ?.getAttribute('aria-valuenow'),
    ).toBe('70');
    fixture.destroy();
  });

  it('passes the controller clock to the overlay and work list', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const overlay = fixture.debugElement.query(
      By.directive(CommandOverlayComponent),
    ).componentInstance as CommandOverlayComponent;
    const list = fixture.debugElement.query(
      By.directive(CommandWorkListComponent),
    ).componentInstance as CommandWorkListComponent;
    expect(overlay.now()).toBe(1_000);
    expect(list.now()).toBe(1_000);
    now.set(31_000);
    fixture.detectChanges();
    expect(overlay.now()).toBe(31_000);
    expect(list.now()).toBe(31_000);
    fixture.destroy();
  });

  it('passes scene overflow counts to the work list and clears them without a scene', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const scene = fixture.debugElement.query(By.directive(SceneStubComponent))
      .componentInstance as SceneStubComponent;
    const list = fixture.debugElement.query(
      By.directive(CommandWorkListComponent),
    ).componentInstance as CommandWorkListComponent;
    expect(list.overflowCompleted()).toBe(0);
    expect(list.overflowOther()).toBe(0);
    scene.layout.set({
      nodes: [],
      overflowCompleted: 3,
      overflowOther: 2,
      overflowChip: null,
    });
    fixture.detectChanges();
    expect(list.overflowCompleted()).toBe(3);
    expect(list.overflowOther()).toBe(2);
    scene.canvasUnavailable.emit(true);
    fixture.detectChanges();
    expect(list.overflowCompleted()).toBe(0);
    expect(list.overflowOther()).toBe(0);
    fixture.destroy();
  });

  it.each([69, 70])('warns at 70 percent, checking %i percent', (percent) => {
    tabs.set([{ id: 'root-tab', liveModelStats: verifiedContext(percent) }]);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      'header .badge:last-of-type',
    ) as HTMLElement;
    expect(chip.textContent).toContain(`Context ${percent}%`);
    expect(chip.textContent?.includes('Warning')).toBe(percent === 70);
    expect(chip.classList.contains('text-state-need')).toBe(percent === 70);
    fixture.destroy();
  });

  it('counts running and awaiting-input nodes, not starting ones, in the scene caption', () => {
    projection.set({
      nodes: [
        nodes[0],
        { ...nodes[1], state: 'starting' },
        {
          ...nodes[1],
          id: 'phase:one',
          kind: 'phase',
          state: 'awaiting input',
        },
        { ...nodes[1], id: 'child:two', state: 'awaiting input' },
        { ...nodes[1], id: 'child:three', state: 'running' },
      ],
      edges: [],
    });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const caption = fixture.nativeElement.querySelector(
      '.stage .left-5.top-5 p:nth-child(2)',
    ) as HTMLElement;
    expect(caption.textContent).toContain('5 nodes');
    expect(caption.textContent).toContain('1 running');
    expect(caption.textContent).toContain('1 waiting');
    projection.set({ nodes: [{ ...nodes[0], state: 'completed' }], edges: [] });
    fixture.detectChanges();
    expect(caption.textContent).toContain('1 nodes');
    expect(caption.textContent).not.toContain('running');
    expect(caption.textContent).not.toContain('waiting');
    fixture.destroy();
  });

  it.each([
    [true, ''],
    [false, 'Review release'],
  ])(
    'keeps the draft only when send resolves %s',
    async (accepted, expected) => {
      controller.sendCommand.mockResolvedValueOnce(accepted);
      const fixture = TestBed.createComponent(CommandCenterPageComponent);
      fixture.detectChanges();
      const controls = fixture.debugElement.query(
        By.directive(CommandSessionControlsComponent),
      ).componentInstance as CommandSessionControlsComponent;
      controls.draft.set('Review release');
      fixture.detectChanges();
      (
        fixture.nativeElement.querySelector(
          'ptah-command-session-controls form',
        ) as HTMLFormElement
      ).dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(controller.sendCommand).toHaveBeenCalledWith('Review release');
      expect(controls.draft()).toBe(expected);
      fixture.destroy();
    },
  );

  it('keeps the draft and shows a toast when the send throws', async () => {
    controller.sendCommand.mockRejectedValueOnce(new Error('boom'));
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    await page.submitCommand('Review release');
    expect(store.toast()).toEqual({
      message: 'Could not send the Command Center message.',
      tone: 'error',
    });
    fixture.destroy();
  });

  it('does not send the same draft twice while a send is in flight', async () => {
    let resolveSend: (accepted: boolean) => void = () => undefined;
    controller.sendCommand.mockReturnValueOnce(
      new Promise<boolean>((resolve) => (resolveSend = resolve)),
    );
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    const first = page.submitCommand('Review release');
    await page.submitCommand('Review release');
    expect(controller.sendCommand).toHaveBeenCalledTimes(1);
    resolveSend(true);
    await first;
    fixture.destroy();
  });

  it('keeps the two-column rail bounded as the single scroller', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const styles = readFileSync(
      join(__dirname, 'command-center-page.component.ts'),
      'utf8',
    );
    const rail = styles.match(/\.rail[^{}]*\{([^}]*)\}/)?.[1];
    const workList = styles.match(/\.work-list-region[^{}]*\{([^}]*)\}/)?.[1];
    expect(rail).toContain(
      'max-height: clamp(420px, calc(100vh - 280px), 620px)',
    );
    expect(rail).toContain('overflow-y: auto');
    expect(rail).not.toContain('overscroll-behavior: contain');
    expect(rail).not.toContain('overflow: hidden');
    expect(workList).toContain('flex: none');
    expect(workList).not.toMatch(/overflow-y:\s*auto/);
    fixture.destroy();
  });

  it('scrolls a newly pending card into view once per identity', async () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(
      'ptah-command-pending-input',
    ) as HTMLElement;
    const scrollIntoView = jest.fn();
    card.scrollIntoView = scrollIntoView;
    store.setPendingInput({
      id: 'question-1',
      kind: 'question',
      title: 'Choose',
      description: 'Pick an option',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const cue = fixture.nativeElement.querySelector(
      '.pending-cue',
    ) as HTMLButtonElement;
    expect(cue.textContent).toContain('Question waiting');
    cue.click();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' });
    fixture.destroy();
  });

  it('keeps microphone denial recovery in the page header with one live status', () => {
    store.setVoiceError({ kind: 'mic-denied', message: 'Microphone blocked' });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    const recovery = [...header.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Voice settings'),
    ) as HTMLButtonElement;
    expect(header.textContent).toContain('Microphone access blocked');
    expect(recovery).toBeDefined();
    expect(recovery.parentElement?.hasAttribute('role')).toBe(false);
    recovery.click();
    expect(controller.openVoiceSettings).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('shows both voice models, status and opens settings from the chip', () => {
    store.setProvider({
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
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      'header button[title]',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain('Local · whisper-base / af_heart');
    expect(chip.getAttribute('aria-label')).toContain(
      'speech-to-text Local whisper-base, ready; text-to-speech Local af_heart, not downloaded',
    );
    expect(chip.querySelector('.bg-warning')).not.toBeNull();
    chip.click();
    expect(controller.openVoiceSettings).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('names both providers when speech directions differ', () => {
    store.setProvider({
      transcription: true,
      synthesis: true,
      stt: {
        providerId: 'local',
        providerLabel: 'Local',
        modelLabel: 'whisper-base',
        ready: true,
        status: 'Ready',
      },
      tts: {
        providerId: 'elevenlabs',
        providerLabel: 'ElevenLabs',
        modelLabel: 'ElevenLabs voice',
        ready: true,
        status: 'Ready',
      },
    });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector(
      'header button[title]',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain('Local STT · ElevenLabs TTS');
    expect(chip.getAttribute('aria-label')).toContain(
      'text-to-speech ElevenLabs ElevenLabs voice, ready',
    );
    expect(chip.querySelector('.bg-success')).not.toBeNull();
    fixture.destroy();
  });

  it('passes scene hoveredNodeId to the overlay input', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const scene = fixture.debugElement.query(By.directive(SceneStubComponent))
      .componentInstance as SceneStubComponent;
    scene.hoveredNodeId.emit('child:one');
    fixture.detectChanges();
    const overlay = fixture.debugElement.query(
      By.directive(CommandOverlayComponent),
    ).componentInstance as CommandOverlayComponent;
    expect(overlay.hoveredNodeId()).toBe('child:one');
    fixture.destroy();
  });

  it('places the controls in a dock and shows a selected-node summary', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.className).toContain('overflow-y-auto');
    expect(fixture.nativeElement.className).toContain('min-h-0');
    const dock = fixture.nativeElement.querySelector(
      '[aria-label="Command dock"]',
    ) as HTMLElement;
    expect(dock.className).toContain('dock');
    expect(dock.parentElement?.className).toContain('layout');
    const rail = fixture.nativeElement.querySelector('.rail') as HTMLElement;
    expect(
      dock.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rail
        .querySelector('[aria-label="Delegated work list"]')
        ?.getAttribute('tabindex'),
    ).toBe('0');
    expect(dock.querySelector('ptah-command-voice-hud')).not.toBeNull();
    expect(dock.querySelector('ptah-command-session-controls')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Selected work"]')
        ?.textContent,
    ).toContain('Root');
    const settings = [
      ...fixture.nativeElement.querySelectorAll('header button'),
    ].find((button: HTMLButtonElement) =>
      button.textContent?.includes('Voice settings'),
    ) as HTMLButtonElement;
    settings.click();
    expect(controller.openVoiceSettings).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('shows dismissible toasts outside the dock and expires only non-error tones', () => {
    jest.useFakeTimers();
    try {
      store.setToast({ tone: 'info', message: 'Ready' });
      const fixture = TestBed.createComponent(CommandCenterPageComponent);
      fixture.detectChanges();
      const infoAlert = fixture.nativeElement.querySelector(
        '.alert',
      ) as HTMLElement;
      expect(infoAlert.textContent).toContain('Ready');
      expect(infoAlert.className).toContain('bg-base-100');
      expect(infoAlert.className).toContain('text-base-content');
      // The toast floats outside the dock flow so it never shifts the input.
      expect(infoAlert.closest('[aria-label="Command dock"]')).toBeNull();
      expect(infoAlert.className).toContain('absolute');
      expect(infoAlert.closest('.stage-column')).toBeNull();
      expect(infoAlert.closest('header')).toBeNull();
      jest.advanceTimersByTime(5000);
      fixture.detectChanges();
      expect(store.toast()).toBeNull();
      store.setToast({
        tone: 'error',
        message: 'Retry needed',
        action: 'retry-speech',
      });
      fixture.detectChanges();
      jest.advanceTimersByTime(5000);
      fixture.detectChanges();
      expect(store.toast()?.message).toBe('Retry needed');
      const errorAlert = fixture.nativeElement.querySelector(
        '.alert',
      ) as HTMLElement;
      expect(errorAlert.className).toContain('border-l-error');
      expect(
        errorAlert.querySelector('[aria-hidden="true"]')?.className,
      ).toContain('text-error');
      const retry = [
        ...fixture.nativeElement.querySelectorAll('.alert button'),
      ].find((button: HTMLButtonElement) =>
        button.textContent?.includes('Retry speech'),
      ) as HTMLButtonElement;
      retry.click();
      expect(controller.retrySpeech).toHaveBeenCalledTimes(1);
      (
        fixture.nativeElement.querySelector(
          '[aria-label="Dismiss notification"]',
        ) as HTMLButtonElement
      ).click();
      expect(store.toast()).toBeNull();
      fixture.destroy();
    } finally {
      store.setToast(null);
      jest.useRealTimers();
    }
  });

  it('selects a pinned node and unpins when a work list row is selected', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const overlay = fixture.debugElement.query(
      By.directive(CommandOverlayComponent),
    ).componentInstance as CommandOverlayComponent;
    overlay.pin('root:session');
    fixture.detectChanges();
    expect(store.selectedId()).toBe('root:session');
    expect(overlay.pinnedNodeId()).toBe('root:session');
    const list = fixture.debugElement.query(
      By.directive(CommandWorkListComponent),
    ).componentInstance as CommandWorkListComponent;
    list.selection.emit('child:one');
    fixture.detectChanges();
    expect(store.selectedId()).toBe('child:one');
    expect(overlay.pinnedNodeId()).toBeNull();
    fixture.destroy();
  });

  it('keeps the work list and text controls in list-only mode', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const scene = fixture.debugElement.query(By.directive(SceneStubComponent))
      .componentInstance as SceneStubComponent;
    scene.canvasUnavailable.emit(true);
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(SceneStubComponent)),
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.directive(CommandWorkListComponent)),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-command-session-controls'),
    ).not.toBeNull();
    fixture.destroy();
  });

  it('renders a safe record-write-failure notice', () => {
    recordWriteFailure.set({
      workspacePath: '<img src=x onerror=alert(1)>',
      record: 'lastSession',
    });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const notice = fixture.nativeElement.querySelector(
      'aside p[role="status"]',
    ) as HTMLElement | null;
    expect(notice?.textContent).toContain(
      'The session pointer could not be saved',
    );
    expect(notice?.innerHTML).not.toContain('<img');
    fixture.destroy();
  });

  it('passes the roster proposal to the pending card and routes confirm and decline', () => {
    const proposal: TribunalRosterProposal = {
      proposalId: 'p1',
      nonce: 'nonce',
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
    };
    pendingProposal.set(proposal);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const card = fixture.debugElement.query(
      By.directive(CommandPendingInputComponent),
    ).componentInstance as CommandPendingInputComponent;
    expect(card.proposal()).toBe(proposal);
    card.confirm.emit(proposal);
    card.decline.emit('p1');
    expect(controller.confirmProposal).toHaveBeenCalledWith('p1');
    expect(controller.declineProposal).toHaveBeenCalledWith('p1');
    fixture.destroy();
  });

  it('routes approval card decisions to permission response only', () => {
    store.setPendingInput({
      id: 'permission-1',
      kind: 'approval',
      title: 'Write permission',
      description: 'Edit a file',
    });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const card = fixture.debugElement.query(
      By.directive(CommandPendingInputComponent),
    ).componentInstance as CommandPendingInputComponent;
    card.response.emit({ id: 'permission-1', answer: 'Approve' });
    card.response.emit({ id: 'permission-1', answer: 'Deny' });
    expect(controller.answerPermission).toHaveBeenNthCalledWith(
      1,
      'permission-1',
      'Approve',
    );
    expect(controller.answerPermission).toHaveBeenNthCalledWith(
      2,
      'permission-1',
      'Deny',
    );
    expect(controller.answerOrdinaryQuestion).not.toHaveBeenCalled();
    fixture.destroy();
    store.setPendingInput(null);
  });

  it('exits on destroy and leaves no overlay card or pending timer', () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(CommandCenterPageComponent);
      fixture.detectChanges();
      const overlay = fixture.debugElement.query(
        By.directive(CommandOverlayComponent),
      ).componentInstance as CommandOverlayComponent;
      overlay.pin('root:session');
      fixture.detectChanges();
      expect(overlay.pinnedNodeId()).toBe('root:session');
      const timersBeforeDestroy = jest.getTimerCount();
      fixture.destroy();
      expect(controller.exit).toHaveBeenCalledTimes(1);
      expect(overlay.pinnedNodeId()).toBeNull();
      expect(overlay.activeNodeId()).toBeNull();
      expect(jest.getTimerCount()).toBeLessThanOrEqual(timersBeforeDestroy);
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes a rejected ordinary answer result back to the pending card', () => {
    store.setPendingInput({
      id: 'q-reject',
      kind: 'question',
      title: 'Choice',
      description: 'Choose',
    });
    controller.answerOrdinaryQuestion
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const card = fixture.debugElement.query(
      By.directive(CommandPendingInputComponent),
    ).componentInstance as CommandPendingInputComponent;
    card.respond('q-reject', 'yes');
    fixture.detectChanges();
    expect(card.rejectedId()).toBe('q-reject');
    expect(card.respondedIds().has('q-reject')).toBe(false);
    card.respond('q-reject', 'Decline');
    fixture.detectChanges();
    expect(card.respondedIds().has('q-reject')).toBe(true);
    expect(controller.answerOrdinaryQuestion).toHaveBeenCalledTimes(2);
    fixture.destroy();
    store.setPendingInput(null);
  });
  it('offers the Decline retry action and catches initial open failures with fixed text', async () => {
    controller.open.mockRejectedValueOnce(new Error('secret detail'));
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    await Promise.resolve();
    expect(store.toast()?.message).toBe(
      'Could not open the Command Center session.',
    );
    expect(store.toast()?.message).not.toContain('secret');
    store.setToast({
      tone: 'error',
      message: 'Retry the Decline.',
      action: 'retry-decline',
    });
    fixture.detectChanges();
    const button = [
      ...fixture.nativeElement.querySelectorAll('.alert button'),
    ].find((item: HTMLButtonElement) =>
      item.textContent?.includes('Retry Decline'),
    ) as HTMLButtonElement;
    button.click();
    expect(controller.retryInvalidDecline).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('reopens for an explicit Status click before sending', async () => {
    store.setSession('old-tab', 'old-session', '/other');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    controller.open.mockImplementationOnce(async () => {
      store.setSession('root-tab', 'session', '/workspace');
      return 'root-tab';
    });
    await fixture.componentInstance.requestStatus();
    expect(controller.open).toHaveBeenCalled();
    expect(controller.coordinator.sendStatusTurn).toHaveBeenCalledWith(
      'Status',
    );
    fixture.destroy();
  });

  it('shows an error toast on the start view', () => {
    store.setSession(null, null, '/workspace');
    store.setToast({
      message: 'Could not restore the Command Center session.',
      tone: 'error',
    });
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-command-center-start'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.page-toast[role="alert"]')
        ?.textContent,
    ).toContain('Could not restore the Command Center session.');
    fixture.destroy();
  });

  it('creates a new session for Status from the start view', async () => {
    store.setSession(null, null, '/workspace');
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    controller.open.mockResolvedValueOnce(null);
    controller.coordinator.newCommandCenter.mockImplementationOnce(() => {
      store.setSession('root-tab', null, '/workspace');
      return 'root-tab';
    });
    await fixture.componentInstance.requestStatus();
    expect(controller.coordinator.newCommandCenter).toHaveBeenCalled();
    expect(controller.coordinator.sendStatusTurn).toHaveBeenCalledWith(
      'Status',
    );
    fixture.destroy();
  });
});
