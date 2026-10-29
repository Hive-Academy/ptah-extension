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
import { CommandCenterProjectionSource } from '../components/command-center-projection.source';
import type {
  ProjectionInput,
  ProjectionResult,
} from '../model/work-projection';
import { CommandSceneComponent } from '../scene/command-scene.component';
import {
  RAIL_STUB_OVERRIDE,
  railStubProviders,
} from '../components/command-rail.testing';

@Component({
  selector: 'ptah-command-scene',
  standalone: true,
  template: '<canvas></canvas>',
})
export class SceneStubComponent {
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly theme = input('dark');
  public readonly voiceState = input('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly reservedTop = input(72);
  public readonly reservedBottom = input(62);
  public readonly selection = output<string>();
  public readonly hoveredNodeId = output<string | null>();
  public readonly canvasUnavailable = output<boolean>();
  public readonly layout = signal({
    // Integration tests exercise the work list; empty scene nodes keep the overlay hidden.
    nodes: [],
    overflowCompleted: 0,
    overflowOther: 0,
  });
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
    findTabByIdAcrossWorkspaces: (id: string) => {
      const tab = tabs().find((candidate) => candidate.id === id);
      return tab ? { tab, workspacePath: '/repo' } : null;
    },
    commandCenterRecordWriteFailure: recordWriteFailure,
    switchTab: jest.fn(),
    createCommandCenterTab: jest.fn(() => root.id),
    attachSession: jest.fn(),
    findTabBySessionId: jest.fn(() => null),
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
  const projectionInput = signal<ProjectionInput>({
    rootTabId: root.id,
    rootSessionId: root.claudeSessionId,
    children: [],
    persistedChildren: [],
    agents: [],
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
      ...railStubProviders(),
    ],
  });
  TestBed.overrideComponent(CommandCenterPageComponent, {
    remove: {
      imports: [CommandSceneComponent, ...RAIL_STUB_OVERRIDE.remove],
      providers: [
        CommandCenterProjectionSource,
      ],
    },
    add: {
      imports: [SceneStubComponent, ...RAIL_STUB_OVERRIDE.add],
      providers: [
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
