import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  SurfaceId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  PermissionHandlerService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { ExecutionNodeComponent } from '@ptah-extension/chat';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { createMockRpcService } from '@ptah-extension/core/testing';
import type {
  FlatStreamEventUnion,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';
import { TribunalStateService } from '../services/tribunal-state.service';
import { ConductorStripComponent } from './conductor-strip.component';

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="execution-node-stub"></div>`,
})
class ExecutionNodeStubComponent {
  @Input() node!: unknown;
  @Input() isStreaming = false;
}

const SESSION = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' as ClaudeSessionId;
const MSG_ID = 'msg-conductor-1';

function msgStart(): MessageStartEvent {
  return {
    id: 'evt-msg-start',
    eventType: 'message_start',
    timestamp: 1,
    sessionId: SESSION,
    messageId: MSG_ID,
    role: 'assistant',
    source: 'stream',
  } as MessageStartEvent;
}

function toolStart(): ToolStartEvent {
  return {
    id: 'evt-tool-start',
    eventType: 'tool_start',
    timestamp: 2,
    sessionId: SESSION,
    messageId: MSG_ID,
    toolCallId: 'tool-conductor-1',
    toolName: 'Bash',
    isTaskTool: false,
    source: 'stream',
  } as ToolStartEvent;
}

function makeTabManagerMock() {
  return {
    tabs: signal<{ id: string; claudeSessionId: string | null }[]>(
      [],
    ).asReadonly(),
    closedTab: signal<ClosedTabEvent | null>(null).asReadonly(),
    activeTabId: signal<string | null>(null).asReadonly(),
    visibleTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
    setStreamingState: jest.fn(),
  };
}

function makePermissionHandlerMock() {
  return {
    attachPromptTargets: jest.fn(),
    targetTabsFor: jest.fn(() => [] as readonly string[]),
    cancelPrompt: jest.fn(),
    handlePermissionResponse: jest.fn(),
    decisionPulse: signal(null).asReadonly(),
    questionRequests: signal<unknown[]>([]).asReadonly(),
    attachQuestionTargets: jest.fn(),
    questionTargetTabsFor: jest.fn(() => [] as readonly string[]),
    clearQuestionTargets: jest.fn(),
    cancelQuestion: jest.fn(),
    handleQuestionResponse: jest.fn(),
  };
}

describe('ConductorStripComponent', () => {
  let surface: TribunalSurfaceService;
  let router: StreamRouter;
  let liveness: SessionLivenessRegistry;
  let sessionSig: ReturnType<typeof signal<string | null>>;

  function setup(surfaceId: SurfaceId): void {
    sessionSig = signal<string | null>(null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ConductorStripComponent],
      providers: [
        TribunalSurfaceService,
        { provide: TabManagerService, useValue: makeTabManagerMock() },
        {
          provide: PermissionHandlerService,
          useValue: makePermissionHandlerMock(),
        },
        {
          provide: StreamingHandlerService,
          useValue: { cleanupSessionDeduplication: jest.fn() },
        },
        { provide: ClaudeRpcService, useValue: createMockRpcService() },
        {
          provide: VSCodeService,
          useValue: { config: signal({ panelId: '' }), postMessage: jest.fn() },
        },
        {
          provide: TribunalStateService,
          useValue: { tribunalSessionId: () => sessionSig() },
        },
      ],
    });

    TestBed.overrideComponent(ConductorStripComponent, {
      remove: { imports: [ExecutionNodeComponent] },
      add: { imports: [ExecutionNodeStubComponent] },
    });

    surface = TestBed.inject(TribunalSurfaceService);
    router = TestBed.inject(StreamRouter);
    liveness = TestBed.inject(SessionLivenessRegistry);
    surface.registerSurface(surfaceId);
  }

  function route(surfaceId: SurfaceId, event: FlatStreamEventUnion): void {
    router.routeStreamEventForSurface(event, surfaceId);
  }

  it('emits >0 execution nodes after a routed tool_start, without compaction', () => {
    const surfaceId = SurfaceId.create();
    setup(surfaceId);

    const fixture = TestBed.createComponent(ConductorStripComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Waiting for the conductor',
    );

    route(surfaceId, msgStart());
    route(surfaceId, toolStart());

    fixture.detectChanges();

    const nodes = fixture.debugElement.queryAll(
      By.css('[data-testid="execution-node-stub"]'),
    );
    expect(nodes.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).not.toContain(
      'Waiting for the conductor',
    );
  });

  it('isStreaming reflects session liveness', () => {
    const surfaceId = SurfaceId.create();
    setup(surfaceId);

    const fixture = TestBed.createComponent(ConductorStripComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Idle');

    sessionSig.set(SESSION);
    liveness.markStreaming(SESSION);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Running');

    liveness.markIdle(SESSION);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Idle');
  });
});
