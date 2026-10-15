import { Component, input, output, signal } from '@angular/core';
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
      parentId: null,
      label: 'Root',
      providerId: null,
      state: 'running',
    },
    {
      id: 'child:one',
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
    recordWriteFailure,
    latestReply: signal<string | null>(null),
    coordinator: { newCommandCenter: jest.fn(), sendStatusTurn: jest.fn() },
    open: jest.fn(async () => 'root-tab'),
    exit: jest.fn(async () => undefined),
    confirmProposal: jest.fn(async (_id: string) => undefined),
    declineProposal: jest.fn((_id: string) => undefined),
    answerOrdinaryQuestion: jest.fn(),
    startVoice: jest.fn(),
    stopVoice: jest.fn(),
    toggleMuteVoice: jest.fn(),
    retrySpeech: jest.fn(),
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
        providers: [CommandCenterPageController],
      },
      add: {
        imports: [SceneStubComponent],
        providers: [
          { provide: CommandCenterPageController, useValue: controller },
        ],
      },
    });
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

  it('selects a work list row and unpins the overlay without selecting on pinNode', () => {
    const fixture = TestBed.createComponent(CommandCenterPageComponent);
    fixture.detectChanges();
    const overlay = fixture.debugElement.query(
      By.directive(CommandOverlayComponent),
    ).componentInstance as CommandOverlayComponent;
    overlay.pin('root:session');
    fixture.detectChanges();
    expect(store.selectedId()).toBeNull();
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
      '[role="status"]',
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
      expect(
        fixture.nativeElement.querySelector('#command-node-card'),
      ).not.toBeNull();
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
});
