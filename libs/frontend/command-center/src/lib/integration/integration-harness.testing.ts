import { Component, computed, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { jest } from '@jest/globals';
import { ChatStore, MessageSenderService } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { CommandCenterPageComponent } from '../components/command-center-page.component';
import { CommandCenterTribunalTransport } from '../components/command-center-tribunal.transport';
import { CommandCenterProjectionSource } from '../components/command-center-projection.source';
import type {
  ProjectionInput,
  ProjectionResult,
} from '../model/work-projection';
import { CommandSceneComponent } from '../scene/command-scene.component';
import type { SceneGeometry } from '../scene/connector-geometry';
import type { PlateReservation } from '../components/command-overlay-placement';

@Component({
  selector: 'ptah-command-scene',
  standalone: true,
  template: '<div data-scene-stage></div>',
})
export class SceneStubComponent {
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly theme = input('dark');
  public readonly voiceState = input('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly reducedMotion = input(false);
  public readonly now = input(Date.now());
  public readonly activeId = input<string | null>(null);
  public readonly pinnedId = input<string | null>(null);
  public readonly plateReservation = input<PlateReservation>({ pinnedId: null, anchorKind: null, inlineSlotHeight: 0, reservedHeight: 0 });
  public readonly selection = output<string>();
  public readonly hoveredNodeId = output<string | null>();
  public readonly activate = output<string>();
  public readonly escape = output<string>();
  public readonly focusWorkList = output<string>();
  public readonly geometryChange = output<SceneGeometry | null>();
  public requestMeasure(): void { this.geometryChange.emit(null); }
}

export function createHarness(
  options: { realProjectionSource?: boolean } = {},
) {
  const tabs = signal([root]);
  const questions = signal<readonly Question[]>([]);
  const recordWriteFailure = signal(null);
  const pulses = signal<
    {
      tabId: string;
      seq: number;
      classification: 'success' | 'error';
      lastAssistantMessage?: string;
    }[]
  >([]);
  const lastTerminalPulseByTab = computed(
    () => new Map(pulses().map((pulse) => [pulse.tabId, pulse] as const)),
  );
  const visibleTabIds = signal<ReadonlySet<string>>(new Set());
  const tabService = {
    activeWorkspacePath: '/repo',
    activeWorkspacePath$: signal<string | null>('/repo'),
    tabs,
    visibleTabIds,
    registerVisibleTab: jest.fn((id: string) =>
      visibleTabIds.update((set) => new Set(set).add(id)),
    ),
    unregisterVisibleTab: jest.fn((id: string) =>
      visibleTabIds.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      }),
    ),
    terminalTurnPulses: pulses,
    lastTerminalPulseByTab,
    commandCenterRecordWriteFailure: recordWriteFailure,
    switchTab: jest.fn(),
    createCommandCenterTab: jest.fn(() => root.id),
    attachSession: jest.fn(),
    findTabBySessionId: jest.fn(() => null),
    findTabByIdAcrossWorkspaces: jest.fn(() => ({ tab: root })),
  };
  const records = {
    readActiveTabId: jest.fn(() => root.id),
    readLastSession: jest.fn(),
    readRunManifests: jest.fn((): object[] => []),
  };
  const agents = signal<MonitoredAgent[]>([]);
  const subagents = signal(new Map());
  const monitor = { agents, subagents };
  const rpc = { call: jest.fn(async () => ({ success: true, data: null })) };
  const sender = {
    send: jest.fn(async (_content: string, _options?: object) => ({
      success: true,
    })),
  };
  const chat = {
    questionRequests: questions,
    permissionRequests: signal([]),
    sessions: signal([]),
    switchSession: jest.fn(async () => undefined),
    handleQuestionResponse: jest.fn(),
    handlePermissionResponse: jest.fn(),
  };
  const transport = {
    open: jest.fn(async () => undefined),
    pageExit: jest.fn(),
    cancelDiscovery: jest.fn(),
    answer: jest.fn(
      (_questionId: string, _questionKey: string, _answer: string) => true,
    ),
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
    createTask: jest.fn(async (_proposal?: object) => 'task-1'),
    writeManifest: jest.fn((_workspace?: string, _manifest?: object) => true),
    removeManifest: jest.fn((_workspace?: string, _runId?: string) => true),
    sendLaunchTurn: jest.fn(async (_content?: string) => true),
    reportFailure: jest.fn(),
  };
  const projectionInput = signal<ProjectionInput>({
    rootTabId: root.id,
    rootSessionId: root.claudeSessionId,
    children: [],
    persistedChildren: [],
    agents: [],
    runs: [],
  });
  TestBed.configureTestingModule({
    imports: [CommandCenterPageComponent],
    providers: [
      CommandCenterSendLockService,
      { provide: TabManagerService, useValue: tabService },
      { provide: CommandCenterRecordsService, useValue: records },
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: MessageSenderService, useValue: sender },
      { provide: ChatStore, useValue: chat },
      { provide: AgentMonitorStore, useValue: monitor },
    ],
  });
  TestBed.overrideComponent(CommandCenterPageComponent, {
    remove: {
      imports: [CommandSceneComponent],
      providers: [
        CommandCenterTribunalTransport,
        CommandCenterProjectionSource,
      ],
    },
    add: {
      imports: [SceneStubComponent],
      providers: [
        { provide: CommandCenterTribunalTransport, useValue: transport },
        ...(options.realProjectionSource
          ? [CommandCenterProjectionSource]
          : [
              {
                provide: CommandCenterProjectionSource,
                useValue: { input: jest.fn(() => projectionInput()) },
              },
            ]),
      ],
    },
  });
  const fixture = TestBed.createComponent(CommandCenterPageComponent);
  fixture.detectChanges();
  return {
    fixture,
    tabs,
    questions,
    sender,
    rpc,
    transport,
    projectionInput,
    chat,
    records,
    monitor,
    pulses,
  };
}

interface Question {
  id: string;
  tabId: string;
  questions: {
    question: string;
    header: string;
    options: [];
    multiSelect: false;
  }[];
}

const root = {
  id: '22222222-2222-4222-8222-222222222222',
  claudeSessionId: '11111111-1111-4111-8111-111111111111',
  messages: [{}],
  hasLiveSession: false,
  commandCenterOrigin: { workspaceId: '/repo', createdAt: 1, version: 1 },
};
