import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  class MarkdownModule {}
  class MarkdownComponent {}
  class MarkdownService {}
  return {
    MarkdownModule,
    MarkdownComponent,
    MarkdownService,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  VSCodeService,
  type RpcCallOptions,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  TabManagerService,
  TabSessionBinding,
  type LivenessStatus,
  type SurfaceId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  SurfaceUpdateInbox,
} from '@ptah-extension/chat-routing';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import {
  MESSAGE_TYPES,
  type AskUserQuestionRequest,
  type ExecutionNode,
  type PermissionRequest,
} from '@ptah-extension/shared';
import type { SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  APPS_RESET_KEPT_NOTICE,
  AppsSessionService,
} from '../services/apps-session.service';
import { AppsSurfaceOperations } from '../services/apps-surface-operations.service';
import { AppsPageComponent } from './apps-page.component';
import { AppsTranscriptComponent } from './apps-transcript.component';

/**
 * Page-level pins of the conversation controls (B15 fix round 1): "New
 * conversation" ownership and abort failure (codex B1), submitted-bubble
 * order (codex S1) and the second-turn send window (M2). Kept apart from
 * `apps-page.component.spec.ts`, which is at its size limit.
 */

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<div data-testid="apps-agent-node">{{ nodeId }}</div>',
})
class StubExecutionNodeComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public node!: ExecutionNode;
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public isStreaming = false;
  public get nodeId(): string {
    return this.node.id;
  }
}

@Component({
  selector: 'ptah-permission-request-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class StubPermissionRequestCardComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public request!: PermissionRequest;
  @Output() public responded = new EventEmitter<unknown>();
}

@Component({
  selector: 'ptah-question-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '',
})
class StubQuestionCardComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public request!: AskUserQuestionRequest;
  @Output() public answered = new EventEmitter<unknown>();
}

const SESSION = 'session-1';

/** A form with one valid input and a `surface.submit` action labelled "Send". */
const FORM = {
  contract: 'dashboard-spec/2',
  surface: {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'form',
    title: { text: 'Profile' },
    components: [
      {
        kind: 'card',
        id: 'profile-card',
        children: [
          { kind: 'text', id: 'name', label: 'Name', path: 'form.name' },
        ],
        actions: [
          { id: 'send', action: 'surface.submit', label: { text: 'Send' } },
        ],
      },
    ] as unknown as SurfaceComponent[],
  },
  dataModel: { form: { name: 'Ada' } },
};

function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

describe('AppsPageComponent — conversation controls', () => {
  let fixture: ComponentFixture<AppsPageComponent> | null;
  let session: AppsSessionService;
  let rpc: MockRpcService;
  let inbox: SurfaceUpdateInbox;
  let activePath: WritableSignal<string | null>;
  let statuses: WritableSignal<ReadonlyMap<string, LivenessStatus>>;
  let tree: ExecutionNode[];
  let abortResolvers: ((data: unknown) => void)[];
  let actionResolvers: ((data: unknown) => void)[];
  let changeResolvers: ((data: unknown) => void)[];
  let warn: jest.SpyInstance;

  function configure(): void {
    abortResolvers = [];
    actionResolvers = [];
    changeResolvers = [];
    tree = [];
    fixture = null;
    rpc = createMockRpcService();
    (rpc.call as jest.Mock).mockImplementation(
      (method: string, _params: unknown, options?: RpcCallOptions) => {
        if (method === 'surface:read') {
          return new Promise((resolve) =>
            options?.signal?.addEventListener('abort', () =>
              resolve(rpcSuccess({ status: 'not-found' })),
            ),
          );
        }
        // Held open until the spec answers it.
        if (method === 'chat:abort')
          return new Promise((resolve) =>
            abortResolvers.push((data) => resolve(rpcSuccess(data))),
          );
        if (method === 'surface:action')
          return new Promise((resolve) =>
            actionResolvers.push((data) => resolve(rpcSuccess(data))),
          );
        if (method === 'surface:change')
          return new Promise((resolve) =>
            changeResolvers.push((data) => resolve(rpcSuccess(data))),
          );
        return Promise.resolve(rpcSuccess({ success: true }));
      },
    );
    activePath = signal<string | null>('/ws-a');
    statuses = signal<ReadonlyMap<string, LivenessStatus>>(new Map());
    TestBed.configureTestingModule({
      imports: [AppsPageComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: VSCodeService, useValue: { postMessage: jest.fn() } },
        {
          provide: ModelStateService,
          useValue: { currentModel: signal('sonnet') },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: signal(undefined) },
        },
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath$: activePath,
            removedWorkspace$: signal(null),
          },
        },
        {
          provide: ConversationRegistry,
          useValue: { getRecord: () => ({ sessions: [SESSION] }) },
        },
        {
          provide: TabSessionBinding,
          useValue: { conversationForSurface: () => 'conv-1' },
        },
        {
          provide: SessionLivenessRegistry,
          useValue: { statuses, markIdle: jest.fn() },
        },
        {
          provide: StreamRouter,
          useFactory: () => {
            const surfaces = inject(StreamingSurfaceRegistry);
            return {
              onSurfaceCreated: jest.fn(),
              onSurfaceClosed: jest.fn((id: SurfaceId) =>
                surfaces.unregister(id),
              ),
            };
          },
        },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: () => tree },
        },
      ],
    });
    TestBed.overrideComponent(AppsTranscriptComponent, {
      set: {
        imports: [
          StubExecutionNodeComponent,
          StubPermissionRequestCardComponent,
          StubQuestionCardComponent,
        ],
      },
    });
    session = TestBed.inject(AppsSessionService);
    inbox = TestBed.inject(SurfaceUpdateInbox);
    TestBed.tick();
  }

  function mount(): HTMLElement {
    fixture = TestBed.createComponent(AppsPageComponent);
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    fixture.detectChanges();
    return element;
  }

  async function settle(): Promise<HTMLElement> {
    const current = must(fixture, 'fixture');
    // No TestBed.tick() once mounted: the zone's own tick flushes the root
    // effects, and a manual tick inside it re-enters (NG0101).
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    current.detectChanges();
    await current.whenStable();
    current.detectChanges();
    return current.nativeElement as HTMLElement;
  }

  function query<T extends Element = HTMLElement>(selector: string): T | null {
    return (
      must(fixture, 'fixture').nativeElement as HTMLElement
    ).querySelector<T>(selector);
  }

  function abortCalls(): number {
    return (rpc.call as jest.Mock).mock.calls.filter(
      ([method]) => method === 'chat:abort',
    ).length;
  }

  /** Before `mount()` this flushes the effects; after it, `settle()` does. */
  function setLiveness(status: LivenessStatus): void {
    statuses.set(new Map([[SESSION, status]]));
    if (fixture === null) TestBed.tick();
  }

  function streamSomething(): void {
    const state = createEmptyStreamingState();
    state.events.set('event-1', {} as never);
    TestBed.inject(StreamingSurfaceRegistry)
      .getAdapter(must(session.surfaceId(), 'surface id'))
      ?.setState(state);
  }

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (fixture !== null) {
      const element = fixture.nativeElement as HTMLElement;
      fixture.destroy();
      element.remove();
    }
    jest.restoreAllMocks();
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('New conversation (codex B1)', () => {
    it('discards the conversation it was pressed for, not the workspace shown when the abort resolves', async () => {
      configure();
      activePath.set('/ws-b');
      await session.start('Build in B');
      const routingB = must(session.routingId());
      activePath.set('/ws-a');
      await session.start('Build in A');
      const routingA = must(session.routingId());
      mount();
      expect(session.isProcessing()).toBe(true);

      must(
        query<HTMLButtonElement>('[data-testid="apps-new-conversation"]'),
      ).click();
      await settle();
      expect(abortCalls()).toBe(1);

      // The user switches workspace while the abort is still in flight.
      activePath.set('/ws-b');
      abortResolvers[0]({ success: true });
      await settle();

      // B, shown now, is untouched.
      expect(session.routingId()).toBe(routingB);
      expect(session.userBubbles().map((bubble) => bubble.text)).toEqual([
        'Build in B',
      ]);
      expect(inbox.isClaimed(routingB)).toBe(true);
      // A, the conversation the button was pressed for, is gone.
      expect(inbox.isClaimed(routingA)).toBe(false);
      activePath.set('/ws-a');
      await settle();
      expect(session.isActive()).toBe(false);
      expect(query('[data-testid="apps-empty"]')).not.toBeNull();
    });

    it('keeps the conversation and shows a role="status" notice when the abort fails', async () => {
      configure();
      await session.start('Build me a form');
      const routingId = must(session.routingId());
      mount();

      must(
        query<HTMLButtonElement>('[data-testid="apps-new-conversation"]'),
      ).click();
      await settle();
      abortResolvers[0]({ success: false, error: 'Agent busy.' });
      const element = await settle();

      expect(session.isActive()).toBe(true);
      expect(session.routingId()).toBe(routingId);
      expect(inbox.isClaimed(routingId)).toBe(true);
      expect(session.userBubbles().map((bubble) => bubble.text)).toEqual([
        'Build me a form',
      ]);
      const notice = must(
        element.querySelector('[data-testid="apps-conversation-notice"]'),
        'notice',
      );
      expect(notice.getAttribute('role')).toBe('status');
      expect(notice.textContent).toContain(APPS_RESET_KEPT_NOTICE);
      expect(notice.textContent).toContain('Agent busy.');
      // The notice is not an error alert, and it can be dismissed.
      expect(element.querySelector('[data-testid="apps-error"]')).toBeNull();
      must(
        notice.querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss notice"]',
        ),
      ).click();
      await settle();
      expect(query('[data-testid="apps-conversation-notice"]')).toBeNull();
      expect(session.isActive()).toBe(true);
    });

    it('leaves a conversation that replaced the original during the abort alone', async () => {
      configure();
      await session.start('First');
      mount();
      must(
        query<HTMLButtonElement>('[data-testid="apps-new-conversation"]'),
      ).click();
      await settle();

      // Another caller replaces the conversation while the abort is pending.
      session.discard();
      await session.start('Second');
      const replacement = must(session.routingId());
      abortResolvers[0]({ success: true });
      await settle();

      expect(session.routingId()).toBe(replacement);
      expect(inbox.isClaimed(replacement)).toBe(true);
      expect(session.userBubbles().map((bubble) => bubble.text)).toEqual([
        'Second',
      ]);
    });

    it('discards at once, with no chat:abort, when no turn is running', async () => {
      configure();
      await session.start('Build');
      setLiveness('idle');
      expect(session.isProcessing()).toBe(false);
      const routingId = must(session.routingId());
      mount();
      must(
        query<HTMLButtonElement>('[data-testid="apps-new-conversation"]'),
      ).click();
      await settle();
      expect(abortCalls()).toBe(0);
      expect(session.isActive()).toBe(false);
      expect(inbox.isClaimed(routingId)).toBe(false);
    });
  });

  function pushForm(): void {
    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: {
        routingId: session.routingId(),
        surfaceId: 'form',
        revision: 1,
        origin: 'agent',
        change: {
          kind: 'snapshot',
          state: {
            surfaceId: 'form',
            revision: 1,
            content: FORM,
            selection: null,
            lastSubmit: null,
          },
        },
      },
    });
  }

  it('stores every keystroke verbatim while a change is in flight and a submit waits, with no extra RPC or timer (codex fix-list 5)', async () => {
    configure();
    await session.start('Build me a form');
    setLiveness('idle'); // the first turn ended
    pushForm();
    mount();
    await settle();
    const ops = TestBed.inject(AppsSurfaceOperations);
    const entry = () => must(session.surfaces().entries.get('form'), 'entry');
    const methods = () =>
      (rpc.call as jest.Mock).mock.calls.map(([method]) => method as string);

    // A committed change is in flight; the submit waits behind it.
    ops.change('form', { componentId: 'name', value: 'Grace' });
    ops.submit('form', { actionId: 'send' });
    await settle();
    expect(changeResolvers).toHaveLength(1);
    expect(methods().filter((m) => m === 'surface:action')).toHaveLength(0);
    const overlays = entry().overlays;
    const callsBefore = methods().length;
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

    const input = must(
      query<HTMLInputElement>('ptah-surface-text-input input'),
      'text input',
    );
    const keystrokes = ['G', 'Gr', 'Gra', 'Grac', 'Grace H'];
    for (const value of keystrokes) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      // Stored synchronously, before any change detection.
      expect(entry().viewState.drafts).toEqual({ name: value });
      const stored = entry().viewState;
      must(fixture).detectChanges();
      expect(entry().viewState).toBe(stored);
      // The write-back itself sends nothing, moves no revision and touches
      // no overlay: reconcile re-ran and left the lane and the submit alone.
      expect(methods().length).toBe(callsBefore);
      expect(entry().materializedRevision).toBe(1);
      expect(entry().overlays).toBe(overlays);
    }
    // The only timer armed is the text input's own idle debounce, re-armed
    // once per keystroke: no lane, sync or submit wait timer was added.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(keystrokes.length);
    expect(input.value).toBe('Grace H');

    // Its debounced commit is a real user commit: it queues behind the
    // change in flight and sends nothing yet; the submit still waits.
    await settle();
    expect(methods().length).toBe(callsBefore);
    expect(entry().overlays.pendingValues().get('form.name')).toBe('Grace H');
  });

  it('shows a submitted bubble before the reply it caused, even when the result lands after the reply (codex S1)', async () => {
    configure();
    const now = jest.spyOn(Date, 'now').mockReturnValue(500);
    await session.start('Build me a form');
    setLiveness('idle'); // the first turn ended
    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: {
        routingId: session.routingId(),
        surfaceId: 'form',
        revision: 1,
        origin: 'agent',
        change: {
          kind: 'snapshot',
          state: {
            surfaceId: 'form',
            revision: 1,
            content: FORM,
            selection: null,
            lastSubmit: null,
          },
        },
      },
    });
    mount();

    now.mockReturnValue(1_000); // surface:action is SENT here
    TestBed.inject(AppsSurfaceOperations).submit('form', { actionId: 'send' });
    await settle();
    expect(actionResolvers).toHaveLength(1);

    // The host-started turn streams its reply before the result arrives.
    tree = [
      {
        id: 'reply',
        type: 'message',
        status: 'streaming',
        content: 'Thanks, Ada.',
        children: [],
        startTime: 1_200,
      } as unknown as ExecutionNode,
    ];
    streamSomething();
    now.mockReturnValue(2_000); // the result arrives late
    actionResolvers[0]({
      status: 'applied',
      operationId: 'x',
      surfaceState: { kind: 'not-recorded' },
    });
    const element = await settle();

    const order = Array.from(
      element.querySelectorAll(
        '[data-testid="apps-user-turn"], [data-testid="apps-agent-node"]',
      ),
    ).map((item) => item.textContent?.trim());
    expect(order).toEqual(['Build me a form', 'Submitted: Send', 'reply']);
    expect(order.filter((text) => text === 'Submitted: Send')).toHaveLength(1);
  });

  it('keeps Send disabled after a second turn until liveness reports it (M2)', async () => {
    configure();
    await session.start('Build');
    setLiveness('idle'); // the first turn ended
    mount();
    const composer = must(
      query<HTMLTextAreaElement>('[data-testid="apps-composer"]'),
    );
    const sendButton = () =>
      must(query<HTMLButtonElement>('[data-testid="apps-send"]'));
    const type = (text: string) => {
      composer.value = text;
      composer.dispatchEvent(new Event('input'));
      must(fixture).detectChanges();
    };

    type('More');
    sendButton().click();
    await settle();
    // chat:continue resolved, the session id is known, liveness still says
    // idle: the turn is pending, so a freshly typed message cannot be sent.
    type('Even more');
    expect(session.isProcessing()).toBe(true);
    expect(sendButton().disabled).toBe(true);

    setLiveness('streaming');
    await settle();
    expect(sendButton().disabled).toBe(true);
    setLiveness('idle');
    await settle();
    expect(session.isProcessing()).toBe(false);
    expect(sendButton().disabled).toBe(false);
  });
});
