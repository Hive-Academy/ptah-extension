import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
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
  type SurfaceId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  SurfaceUpdateInbox,
} from '@ptah-extension/chat-routing';
import {
  ExecutionTreeBuilderService,
  PermissionHandlerService,
} from '@ptah-extension/chat-streaming';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import {
  SURFACE_VIEW_MODEL_BUILDER,
  SurfaceRendererComponent,
  type SurfaceViewState,
} from '@ptah-extension/declarative-dashboard';
import {
  MESSAGE_TYPES,
  type AskUserQuestionRequest,
  type ExecutionNode,
  type PermissionRequest,
} from '@ptah-extension/shared';
import {
  renderSurfaceText,
  type SurfaceComponent,
  type SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  makeChart,
  makeSurfaceTextInput,
  makeTable,
} from '@ptah-extension/shared/testing';
import { AppsSessionService } from '../services/apps-session.service';
import { createSurfaceOperationId } from '../state/surface-operation-id';
import { AppsPageComponent } from './apps-page.component';
import { APPS_UNSHOWN_TEXT } from './apps-surface-panel.component';
import { AppsTranscriptComponent } from './apps-transcript.component';

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
  template: '<div data-testid="apps-permission">{{ request.id }}</div>',
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
  template: '<div data-testid="apps-question">{{ request.id }}</div>',
})
class StubQuestionCardComponent {
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input() public request!: AskUserQuestionRequest;
  @Output() public answered = new EventEmitter<unknown>();
}

function v2(
  surfaceId: string,
  components: SurfaceComponent[],
  dataModel: Record<string, unknown> = {},
): SurfaceContent {
  const content = {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: `App ${surfaceId}` },
      components,
    },
    dataModel,
  };
  return content as SurfaceContent;
}

function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const NODE: ExecutionNode = {
  id: 'agent-node-1',
  type: 'message',
  status: 'complete',
  content: 'Here is your app.',
  children: [],
  startTime: Number.MAX_SAFE_INTEGER,
} as unknown as ExecutionNode;

describe('AppsPageComponent', () => {
  let fixture: ComponentFixture<AppsPageComponent>;
  let session: AppsSessionService;
  let rpc: MockRpcService;
  let postMessage: jest.Mock;
  let inbox: SurfaceUpdateInbox;
  let permissions: PermissionHandlerService;
  let buildTree: jest.Mock;
  let chatStartResult: unknown;
  let continueResult: unknown;
  let sessionResolved: boolean;
  let warn: jest.SpyInstance;

  function configure(builder?: unknown): void {
    chatStartResult = { success: true };
    continueResult = { success: true };
    sessionResolved = false;
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
        if (method === 'chat:start')
          return Promise.resolve(rpcSuccess(chatStartResult));
        if (method === 'chat:continue')
          return Promise.resolve(rpcSuccess(continueResult));
        return Promise.resolve(rpcSuccess({ success: true }));
      },
    );
    postMessage = jest.fn();
    buildTree = jest.fn(() => [NODE]);
    const tabManager = {
      activeWorkspacePath$: signal<string | null>('/ws-a'),
      removedWorkspace$: signal(null),
      tabs: signal([]),
      activeTabId: signal(null),
      activeTabMessages: signal([]),
      activeTabStreamingState: signal(null),
    };
    TestBed.configureTestingModule({
      imports: [AppsPageComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: VSCodeService, useValue: { postMessage } },
        {
          provide: ModelStateService,
          useValue: { currentModel: signal('sonnet') },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: signal(undefined) },
        },
        { provide: TabManagerService, useValue: tabManager },
        {
          provide: ConversationRegistry,
          useValue: { getRecord: () => ({ sessions: ['session-1'] }) },
        },
        {
          provide: TabSessionBinding,
          useValue: {
            conversationForSurface: () => (sessionResolved ? 'conv-1' : null),
          },
        },
        {
          provide: SessionLivenessRegistry,
          useValue: { statuses: signal(new Map()), markIdle: jest.fn() },
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
        { provide: ExecutionTreeBuilderService, useValue: { buildTree } },
        ...(builder === undefined
          ? []
          : [{ provide: SURFACE_VIEW_MODEL_BUILDER, useValue: builder }]),
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
    permissions = TestBed.inject(PermissionHandlerService);
  }

  function mount(): HTMLElement {
    fixture = TestBed.createComponent(AppsPageComponent);
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    fixture.detectChanges();
    TestBed.tick();
    return element;
  }

  function unmount(): void {
    const element = fixture.nativeElement as HTMLElement;
    fixture.destroy();
    element.remove();
  }

  async function settle(): Promise<HTMLElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function push(surfaceId: string, revision: number, content: unknown): void {
    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: {
        routingId: session.routingId(),
        surfaceId,
        revision,
        origin: 'agent',
        change: {
          kind: 'snapshot',
          state: {
            surfaceId,
            revision,
            content,
            selection: null,
            lastSubmit: null,
          },
        },
      },
    });
  }

  function streamSomething(): void {
    // The transcript asks the tree builder only once the slot holds events.
    const state = createEmptyStreamingState();
    state.events.set('event-1', {} as never);
    const surfaceId = session.surfaceId();
    if (surfaceId === null) throw new Error('no conversation');
    TestBed.inject(StreamingSurfaceRegistry)
      .getAdapter(surfaceId)
      ?.setState(state);
  }

  function renderer(): SurfaceRendererComponent {
    return fixture.debugElement.query(
      (debug) => debug.componentInstance instanceof SurfaceRendererComponent,
    ).componentInstance as SurfaceRendererComponent;
  }

  function query<T extends Element = HTMLElement>(selector: string): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  }

  /** `query` that fails the spec when the element is missing. */
  function get<T extends Element = HTMLElement>(
    selector: string,
    root: ParentNode = fixture.nativeElement as HTMLElement,
  ): T {
    return must(root.querySelector<T>(selector), selector);
  }

  function composer(): HTMLTextAreaElement {
    return get<HTMLTextAreaElement>('[data-testid="apps-composer"]');
  }

  function type(value: string): void {
    composer().value = value;
    composer().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function transcriptText(): string {
    return query('[role="log"]')?.textContent ?? '';
  }

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (fixture) unmount();
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('shows the empty state with the request input and no conversation controls (Req 2.7)', () => {
    configure();
    mount();
    expect(query('[data-testid="apps-empty"]')?.textContent).toContain(
      'No app yet',
    );
    expect(composer().getAttribute('aria-label')).toBe(
      'Message the Apps conversation',
    );
    expect(
      query<HTMLButtonElement>('[data-testid="apps-send"]')?.disabled,
    ).toBe(true);
    expect(query('[data-testid="apps-new-conversation"]')).toBeNull();
    expect(query('[data-testid="apps-user-turn"]')).toBeNull();
    expect(query('ptah-surface-renderer')).toBeNull();
    // The host is the focus-memory landing target, never in the tab order.
    expect(
      (fixture.nativeElement as HTMLElement).getAttribute('tabindex'),
    ).toBe('-1');
    expect(query('[data-testid="apps-split-handle-slot"]')).not.toBeNull();
  });

  it('sends the draft as the first turn and clears the composer', async () => {
    configure();
    mount();
    type('Show me weekly deploy cost');
    get<HTMLButtonElement>('[data-testid="apps-send"]').click();
    await settle();
    expect(session.isActive()).toBe(true);
    expect(composer().value).toBe('');
    expect(query('[data-testid="apps-user-turn"]')?.textContent?.trim()).toBe(
      'Show me weekly deploy cost',
    );
  });

  it('keeps the draft when start() fails (B12 N4)', async () => {
    configure();
    chatStartResult = { success: false, error: 'No provider configured.' };
    mount();
    type('Build me a form');
    get<HTMLButtonElement>('[data-testid="apps-send"]').click();
    await settle();
    expect(session.isActive()).toBe(false);
    expect(composer().value).toBe('Build me a form');
    expect(query('[data-testid="apps-error"]')?.textContent).toContain(
      'No provider configured.',
    );
    expect(query('[data-testid="apps-error"]')?.getAttribute('role')).toBe(
      'alert',
    );
  });

  it('keeps the draft on a send before the session resolved (B12 N4)', async () => {
    configure();
    await session.start('first');
    // A failed continue leaves the conversation idle with a resolved session.
    sessionResolved = true;
    continueResult = { success: false, error: 'boom' };
    await session.send('second');
    expect(session.isProcessing()).toBe(false);
    // The binding goes away again: the next send is "before resolve".
    sessionResolved = false;
    mount();
    type('third');
    get<HTMLButtonElement>('[data-testid="apps-send"]').click();
    await settle();
    expect(query('[data-testid="apps-error"]')?.textContent).toContain(
      'still starting',
    );
    expect(composer().value).toBe('third');
  });

  it('renders only the prompts targeted at this page surface (Req 2.3)', async () => {
    configure();
    await session.start('hello');
    const own = must(session.surfaceId());
    permissions.handlePermissionRequest({
      id: 'perm-own',
      toolName: 'Bash',
      toolUseId: 't1',
      sessionId: 's',
      timestamp: 1,
    } as PermissionRequest);
    permissions.attachPromptTargets('perm-own', [own]);
    permissions.handlePermissionRequest({
      id: 'perm-other',
      toolName: 'Bash',
      toolUseId: 't2',
      sessionId: 's',
      timestamp: 1,
    } as PermissionRequest);
    permissions.attachPromptTargets('perm-other', ['surface-harness-1']);
    permissions.handleQuestionRequest({
      id: 'q-own',
      toolUseId: 't3',
      sessionId: 's',
      timestamp: 1,
      timeoutAt: 0,
      question: 'q',
      options: [],
    } as unknown as AskUserQuestionRequest);
    permissions.attachQuestionTargets('q-own', [own]);
    permissions.handleQuestionRequest({
      id: 'q-other',
      toolUseId: 't4',
      sessionId: 's',
      timestamp: 1,
      timeoutAt: 0,
      question: 'q',
      options: [],
    } as unknown as AskUserQuestionRequest);
    permissions.attachQuestionTargets('q-other', ['tab-live']);
    mount();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      Array.from(
        element.querySelectorAll('[data-testid="apps-permission"]'),
      ).map((e) => e.textContent),
    ).toEqual(['perm-own']);
    expect(
      Array.from(element.querySelectorAll('[data-testid="apps-question"]')).map(
        (e) => e.textContent,
      ),
    ).toEqual(['q-own']);
  });

  it('shows a rejected surface as the mono fallback with the transcript intact (Req 3.5)', async () => {
    configure();
    await session.start('Show me weekly deploy cost');
    streamSomething();
    push('a', 1, { contract: 'dashboard-spec/9' });
    mount();
    const fallback = query('[data-testid="apps-fallback"] pre');
    expect(fallback?.classList.contains('font-mono')).toBe(true);
    expect(fallback?.textContent).toBe(
      `${APPS_UNSHOWN_TEXT}\nReason: surface content names an unknown contract.`,
    );
    expect(query('ptah-surface-renderer')).toBeNull();
    expect(transcriptText()).toContain('Show me weekly deploy cost');
    expect(query('[data-testid="apps-agent-node"]')?.textContent).toBe(
      'agent-node-1',
    );
    expect(buildTree).toHaveBeenCalledWith(
      expect.anything(),
      `apps:${session.surfaceId()}`,
    );
  });

  it.each([
    [
      'a SURFACE_VIEW_MODEL_BUILDER override throws',
      () => {
        throw new Error('builder exploded');
      },
    ],
    ['the builder returns renderFailed', () => ({ renderFailed: true })],
  ])(
    'shows the mono text fallback with no renderer subtree when %s (Req 3.6)',
    async (_case, builder) => {
      configure(builder);
      await session.start('Show me weekly deploy cost');
      streamSomething();
      const content = v2('a', [makeTable(3, 2) as SurfaceComponent]);
      push('a', 1, content);
      mount();
      const element = await settle();
      expect(element.querySelector('ptah-surface-renderer')).toBeNull();
      const text =
        element.querySelector('[data-testid="apps-fallback"] pre')
          ?.textContent ?? '';
      expect(text.startsWith(`${APPS_UNSHOWN_TEXT}\nReason:`)).toBe(true);
      const entry = must(session.surfaces().entries.get('a'));
      const accepted = must(
        entry.renderable.status === 'accepted' ? entry.renderable : null,
      );
      expect(
        text.endsWith(
          renderSurfaceText({
            surfaceId: 'a',
            revision: 1,
            content: accepted.content,
            selection: null,
            lastSubmit: null,
          }),
        ),
      ).toBe(true);
      expect(transcriptText()).toContain('Show me weekly deploy cost');
      expect(composer()).not.toBeNull();
    },
  );

  it('stores the emitted view state verbatim and passes that same drafts object down', async () => {
    configure();
    await session.start('Build me a form');
    push(
      'form',
      1,
      v2('form', [makeSurfaceTextInput()], { form: { name: 'Ada' } }),
    );
    mount();
    const emitted: SurfaceViewState[] = [];
    renderer().viewStateChange.subscribe((state) => emitted.push(state));
    const input = get<HTMLInputElement>('ptah-surface-text-input input');
    input.value = 'Grace';
    input.dispatchEvent(new Event('input'));
    // Synchronous and verbatim: stored before any change detection, same object.
    const stored = must(session.surfaces().entries.get('form')).viewState;
    expect(emitted).toHaveLength(1);
    expect(stored).toBe(emitted[0]);
    expect(stored.drafts).toEqual({ name: 'Grace' });
    fixture.detectChanges();
    expect(renderer().viewState()).toBe(stored);
    expect(renderer().state()).toBe(stored);
    const textInput = fixture.debugElement.query(
      (debug) => debug.name === 'ptah-surface-text-input',
    ).componentInstance as { drafts: () => unknown };
    expect(textInput.drafts()).toBe(stored.drafts);
    expect(input.value).toBe('Grace');
  });

  it('restores the transcript, surfaces, view state, overlays and focus after destroy and re-create (Req 2.4, 7.6)', async () => {
    configure();
    await session.start('Build me a form');
    streamSomething();
    push(
      'form',
      1,
      v2(
        'form',
        [makeSurfaceTextInput(), makeTable(30, 2) as SurfaceComponent],
        { form: { name: 'Ada' } },
      ),
    );
    const routingId = must(session.routingId());
    session.updateOverlays(routingId, 'form', (overlays) =>
      overlays.add({
        operationId: createSurfaceOperationId(),
        path: 'form.name',
        value: 'Pending name',
        baseRevision: 1,
      }),
    );
    mount();
    get<HTMLInputElement>('ptah-dashboard-table input[type="search"]').value =
      'x';
    get<HTMLInputElement>(
      'ptah-dashboard-table input[type="search"]',
    ).dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const viewState: SurfaceViewState = must(
      session.surfaces().entries.get('form'),
    ).viewState;
    expect(viewState.components['slowest-tests']?.filter).toBe('x');
    composer().focus();
    expect(session.lastFocusKey()).toBe('apps:composer');

    unmount();
    mount();

    expect(document.activeElement).toBe(composer());
    expect(transcriptText()).toContain('Build me a form');
    expect(query('[data-testid="apps-agent-node"]')).not.toBeNull();
    expect(renderer().viewState()).toBe(viewState);
    expect(
      query<HTMLInputElement>('ptah-dashboard-table input[type="search"]')
        ?.value,
    ).toBe('x');
    expect(renderer().interaction().pendingValues.get('form.name')).toBe(
      'Pending name',
    );
    expect(
      query<HTMLInputElement>('ptah-surface-text-input input')?.value,
    ).toBe('Pending name');
  });

  it('sorts, filters, pages and expands with zero RPC calls and zero postMessage calls (Req 5.4)', async () => {
    configure();
    await session.start('Show me the dashboard');
    push(
      'dash',
      1,
      v2('dash', [
        makeTable(30, 2) as SurfaceComponent,
        makeChart([3]) as SurfaceComponent,
      ]),
    );
    mount();
    (rpc.call as jest.Mock).mockClear();
    postMessage.mockClear();

    const table = get('ptah-dashboard-table');
    get<HTMLButtonElement>('th button', table).click();
    fixture.detectChanges();
    const tableState = () =>
      must(session.surfaces().entries.get('dash')).viewState.components[
        'slowest-tests'
      ];
    expect(tableState()?.sort).toBeDefined();
    must(
      Array.from(table.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === 'Next',
      ),
    ).click();
    fixture.detectChanges();
    expect(tableState()?.page).toBe(1);
    get<HTMLButtonElement>('button[aria-expanded]', table).click();
    fixture.detectChanges();
    const chartExpand = get<HTMLButtonElement>(
      'button[aria-expanded]',
      get('ptah-dashboard-chart'),
    );
    chartExpand.click();
    fixture.detectChanges();
    const filter = get<HTMLInputElement>('input[type="search"]', table);
    filter.value = '1';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await settle();

    const components = must(session.surfaces().entries.get('dash')).viewState
      .components;
    expect(components['slowest-tests']).toEqual(
      expect.objectContaining({
        expanded: true,
        filter: '1',
        page: 0,
        sort: expect.anything(),
      }),
    );
    expect(components['duration']).toEqual({ expanded: true });
    expect(chartExpand.getAttribute('aria-expanded')).toBe('true');
    expect(rpc.call).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
