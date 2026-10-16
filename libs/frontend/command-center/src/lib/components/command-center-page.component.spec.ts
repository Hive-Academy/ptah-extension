import { Component, computed, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TabManagerService } from '@ptah-extension/chat-state';
import { CommandCenterStore } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import type { TribunalRosterProposal } from '../model/tribunal-roster-proposal';
import { CommandSceneComponent } from '../scene/command-scene.component';
import { CommandOverlayComponent } from './command-overlay.component';
import { CommandPendingInputComponent } from './command-pending-input.component';
import { CommandWorkListComponent } from './command-work-list.component';
import { CommandCenterPageComponent } from './command-center-page.component';
import { CommandCenterPageController } from './command-center-page.controller';

@Component({ selector: 'ptah-command-scene', standalone: true, template: '' })
class SceneStubComponent {
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
  const hoveredNodeId = signal<string | null>(null);
  const canvasUnavailable = signal(false);
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
    coordinator: { newCommandCenter: jest.fn(), sendStatusTurn: jest.fn() },
    open: jest.fn(async () => 'root-tab'),
    exit: jest.fn(async () => undefined),
    confirmProposal: jest.fn(async (_id: string) => undefined),
    declineProposal: jest.fn((_id: string) => undefined),
    answerOrdinaryQuestion: jest.fn(),
    answerPermission: jest.fn(),
    startVoice: jest.fn(),
    stopVoice: jest.fn(),
    toggleMuteVoice: jest.fn(),
    retrySpeech: jest.fn(),
    interruptSpeech: jest.fn(),
    openVoiceSettings: jest.fn(),
    sendCommand: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    hoveredNodeId.set(null);
    canvasUnavailable.set(false);
    pendingProposal.set(null);
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

  it('shows dismissible toasts by the voice controls and expires only non-error tones', () => {
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
      expect(infoAlert.closest('[aria-label="Command dock"]')).not.toBeNull();
      expect(infoAlert.nextElementSibling?.tagName.toLowerCase()).toBe(
        'ptah-command-voice-hud',
      );
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
});
