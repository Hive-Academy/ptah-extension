import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
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
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  SurfaceUpdateInbox,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  SurfaceComponent,
  SurfaceContent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { makeTable } from '@ptah-extension/shared/testing';
import { APPS_SYSTEM_PROMPT } from '../apps-system-prompt';
import { AppsSessionService, APPS_SESSION_NAME } from './apps-session.service';
import { APPS_SURFACE_READ_TIMEOUT_MS } from './apps-surface-sync';
import { APPS_IMPLICIT_WORKSPACE } from './apps-workspace-slice';

function content(surfaceId: string): SurfaceContent {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: 'Profile' },
      components: [makeTable(3, 2) as SurfaceComponent],
    },
    dataModel: {},
  };
}

function snapshot(routingId: string, surfaceId: string, revision: number) {
  return {
    routingId,
    surfaceId,
    revision,
    origin: 'agent',
    change: {
      kind: 'snapshot',
      state: {
        surfaceId,
        revision,
        content: content(surfaceId),
        selection: null,
        lastSubmit: null,
      },
    },
  };
}

interface RpcCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly options: RpcCallOptions | undefined;
  /** Whether the inbox already held the routing id when the call was made. */
  readonly inboxClaimed: boolean;
}

/**
 * `TabManagerService` stand-in. Reads of the two workspace signals (and the
 * path getter) are served; ANY other prototype member touched is recorded as
 * a violation, which proves the service never mutates the tab manager.
 */
function createTabManagerProbe(initialPath: string | null) {
  const activeWorkspacePath$ = signal<string | null>(initialPath);
  const removedWorkspace$ = signal<{ path: string; seq: number } | null>(null);
  const violations: string[] = [];
  const members = new Set(
    Object.getOwnPropertyNames(TabManagerService.prototype).filter(
      (name) => name !== 'constructor',
    ),
  );
  const allowed: Record<string, unknown> = {
    activeWorkspacePath$: activeWorkspacePath$.asReadonly(),
    removedWorkspace$: removedWorkspace$.asReadonly(),
  };
  const tabManager = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        if (property in allowed) return allowed[property];
        if (property === 'activeWorkspacePath') return activeWorkspacePath$();
        if (members.has(property)) {
          violations.push(property);
          return jest.fn();
        }
        return undefined;
      },
      set(_target, property) {
        violations.push(`set ${String(property)}`);
        return true;
      },
    },
  ) as TabManagerService;
  return { tabManager, activeWorkspacePath$, removedWorkspace$, violations };
}

describe('AppsSessionService', () => {
  let service: AppsSessionService;
  let rpc: MockRpcService;
  let calls: RpcCall[];
  let readResolvers: ((value: unknown) => void)[];
  let chatStartResult: unknown;
  let inbox: SurfaceUpdateInbox;
  let registry: StreamingSurfaceRegistry;
  let claims: WorkflowSessionClaimService;
  let streamRouter: { onSurfaceCreated: jest.Mock; onSurfaceClosed: jest.Mock };
  let tabs: ReturnType<typeof createTabManagerProbe>;
  let warn: jest.SpyInstance;
  let sessionResolved: boolean;
  let markIdle: jest.Mock;

  function push(payload: unknown): void {
    inbox.handleMessage({ type: MESSAGE_TYPES.SURFACE_UPDATED, payload });
  }

  function callsOf(method: string): RpcCall[] {
    return calls.filter((call) => call.method === method);
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  }

  beforeEach(() => {
    calls = [];
    readResolvers = [];
    chatStartResult = { success: true };
    sessionResolved = false;
    markIdle = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    rpc = createMockRpcService();
    (rpc.call as jest.Mock).mockImplementation(
      (
        method: string,
        params: Record<string, unknown>,
        options?: RpcCallOptions,
      ) => {
        const routingId =
          typeof params['tabId'] === 'string'
            ? params['tabId']
            : typeof params['routingId'] === 'string'
              ? params['routingId']
              : '';
        calls.push({
          method,
          params,
          options,
          inboxClaimed: inbox.isClaimed(routingId),
        });
        if (method === 'surface:read') {
          // Deferred: stays in flight until the spec resolves it, or until
          // the caller aborts it (as ClaudeRpcService does).
          return new Promise((resolve) => {
            readResolvers.push((data) => resolve(rpcSuccess(data)));
            options?.signal?.addEventListener('abort', () =>
              resolve(rpcSuccess({ status: 'not-found' })),
            );
          });
        }
        if (method === 'chat:start')
          return Promise.resolve(rpcSuccess(chatStartResult));
        return Promise.resolve(rpcSuccess({ success: true }));
      },
    );

    tabs = createTabManagerProbe('/ws-a');
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: ModelStateService,
          useValue: { currentModel: signal('sonnet') },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: signal(undefined) },
        },
        { provide: TabManagerService, useValue: tabs.tabManager },
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
          useValue: {
            statuses: signal(new Map()),
            markIdle: (...args: unknown[]) => markIdle(...args),
          },
        },
        {
          provide: StreamRouter,
          useFactory: () => {
            const surfaces = inject(StreamingSurfaceRegistry);
            streamRouter = {
              onSurfaceCreated: jest.fn(),
              // Mirrors stream-router.service.ts:271-283: closing a surface
              // unregisters its adapter.
              onSurfaceClosed: jest.fn((id) => surfaces.unregister(id)),
            };
            return streamRouter;
          },
        },
      ],
    });
    inbox = TestBed.inject(SurfaceUpdateInbox);
    registry = TestBed.inject(StreamingSurfaceRegistry);
    claims = TestBed.inject(WorkflowSessionClaimService);
    TestBed.inject(StreamRouter);
    service = TestBed.inject(AppsSessionService);
    TestBed.tick();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe('start', () => {
    it('registers an interactive surface: isInteractive is true after start (Req 2.2)', async () => {
      await service.start('Build me a dashboard');

      const surfaceId = service.surfaceId();
      expect(surfaceId).not.toBeNull();
      expect(surfaceId !== null && registry.isInteractive(surfaceId)).toBe(
        true,
      );
      expect(
        surfaceId !== null && registry.getAdapter(surfaceId),
      ).not.toBeNull();
      expect(service.isActive()).toBe(true);
      expect(service.isProcessing()).toBe(true);
      expect(service.userBubbles().map((b) => b.text)).toEqual([
        'Build me a dashboard',
      ]);
    });

    it('claims the inbox BEFORE chat:start and sends the Apps start params', async () => {
      await service.start('Build me a dashboard');

      const [start] = callsOf('chat:start');
      const routingId = service.routingId();
      expect(start.inboxClaimed).toBe(true);
      expect(start.params['tabId']).toBe(routingId);
      expect(start.params['name']).toBe(APPS_SESSION_NAME);
      expect(start.params['workspacePath']).toBe('/ws-a');
      expect(start.params['surfaceMode']).toBe(true);
      expect(start.params['options']).toEqual({
        model: 'sonnet',
        systemPrompt: APPS_SYSTEM_PROMPT,
      });
      expect(routingId !== null && claims.surfaceFor(routingId)).toBe(
        service.surfaceId(),
      );
      expect(streamRouter.onSurfaceCreated).toHaveBeenCalledWith(
        service.surfaceId(),
      );
    });

    it('rolls a failed chat:start back: inbox, claims, surface and sync released', async () => {
      chatStartResult = { success: false, error: 'No provider configured.' };

      await service.start('Build me a dashboard');

      const [start] = callsOf('chat:start');
      const routingId = start.params['tabId'] as string;
      const surfaceId = claims.surfaceFor(routingId);
      expect(inbox.isClaimed(routingId)).toBe(false);
      expect(surfaceId).toBeNull();
      expect(streamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      expect(registry.size()).toBe(0);
      expect(service.isActive()).toBe(false);
      expect(service.error()).toBe('No provider configured.');
      // A push for the rolled-back routing id reaches nothing.
      push(snapshot(routingId, 'profile', 1));
      expect(service.surfaces().entries.size).toBe(0);
    });

    it('rolls back when the chat:start RPC fails at transport level', async () => {
      (rpc.call as jest.Mock).mockImplementationOnce(
        (method: string, params: Record<string, unknown>) => {
          calls.push({
            method,
            params,
            options: undefined,
            inboxClaimed: inbox.isClaimed(params['tabId'] as string),
          });
          return Promise.reject(new Error('socket closed'));
        },
      );

      await expect(service.start('Build')).resolves.toBeUndefined();

      const [start] = callsOf('chat:start');
      const routingId = start.params['tabId'] as string;
      expect(start.inboxClaimed).toBe(true);
      expect(inbox.isClaimed(routingId)).toBe(false);
      expect(service.isActive()).toBe(false);
      expect(service.error()).toBe('socket closed');
    });
  });

  describe('discard', () => {
    it('getAdapter is null and the inbox is released after discard() (Req 2.5)', async () => {
      await service.start('Build');
      const surfaceId = service.surfaceId();
      const routingId = service.routingId();
      if (surfaceId === null || routingId === null)
        throw new Error('not started');
      push(snapshot(routingId, 'profile', 1));
      service.requestSurfaceRead(routingId, 'stale-revision');
      const readSignal = callsOf('surface:read')[0].options?.signal;

      service.discard();

      expect(registry.getAdapter(surfaceId)).toBeNull();
      expect(registry.isInteractive(surfaceId)).toBe(false);
      expect(inbox.isClaimed(routingId)).toBe(false);
      expect(claims.surfaceFor(routingId)).toBeNull();
      expect(streamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(readSignal?.aborted).toBe(true);
      expect(service.isActive()).toBe(false);
      expect(service.surfaces().entries.size).toBe(0);
      expect(service.userBubbles()).toEqual([]);
    });

    it('a late read result after discard() changes nothing', async () => {
      await service.start('Build');
      const routingId = service.routingId() as string;
      service.requestSurfaceRead(routingId, 'stale-revision');

      service.discard();
      readResolvers[0]({
        status: 'found',
        routingId,
        surfaces: [snapshot(routingId, 'profile', 3).change.state],
      });
      await flush();

      expect(service.surfaces().entries.size).toBe(0);
      expect(service.syncNotice()).toBeNull();
    });
  });

  describe('surface intake', () => {
    it('a push for its routing id reaches the slice; one for another routing id never does (Req 3.3)', async () => {
      await service.start('Build in A');
      const routingA = service.routingId() as string;
      tabs.activeWorkspacePath$.set('/ws-b');
      await service.start('Build in B');
      const routingB = service.routingId() as string;
      tabs.activeWorkspacePath$.set('/ws-a');

      push(snapshot(routingB, 'orders', 1));
      push(snapshot('tab-unclaimed', 'profile', 1));

      expect(service.routingId()).toBe(routingA);
      expect(service.surfaces().entries.size).toBe(0);
      tabs.activeWorkspacePath$.set('/ws-b');
      expect([...service.surfaces().entries.keys()]).toEqual(['orders']);

      tabs.activeWorkspacePath$.set('/ws-a');
      push(snapshot(routingA, 'profile', 1));
      expect([...service.surfaces().entries.keys()]).toEqual(['profile']);
    });

    it('an ops push for an unknown surface asks for one surface:read with a 10 s timeout', async () => {
      await service.start('Build');
      const routingId = service.routingId() as string;

      push({
        routingId,
        surfaceId: 'profile',
        revision: 2,
        origin: 'agent',
        change: { kind: 'ops', fromRevision: 1, ops: [] },
      });
      push({
        routingId,
        surfaceId: 'orders',
        revision: 2,
        origin: 'agent',
        change: { kind: 'ops', fromRevision: 1, ops: [] },
      });

      const reads = callsOf('surface:read');
      expect(reads).toHaveLength(1);
      expect(reads[0].params).toEqual({ routingId });
      expect(reads[0].options?.timeout).toBe(APPS_SURFACE_READ_TIMEOUT_MS);

      readResolvers[0]({
        status: 'found',
        routingId,
        surfaces: [snapshot(routingId, 'profile', 2).change.state],
      });
      await flush();
      expect(
        service.surfaces().entries.get('profile')?.materializedRevision,
      ).toBe(2);
      // The coalesced trigger sends exactly one follow-up read.
      expect(callsOf('surface:read')).toHaveLength(2);
    });

    it('an acknowledged revision is expected, never materialized (Rule 1)', async () => {
      await service.start('Build');
      const routingId = service.routingId() as string;
      push(snapshot(routingId, 'profile', 1));

      service.expectSurfaceRevision(routingId, 'profile', 4);

      expect(
        service.surfaces().entries.get('profile')?.materializedRevision,
      ).toBe(1);
    });
  });

  describe('workspace slices', () => {
    it('a focus record on a never-started workspace leaves the slices map unchanged', () => {
      const before = service['_slices']();
      service.recordFocusKey('composer');
      expect(service['_slices']()).toBe(before);
      expect(service['_slices']().has('/ws-a')).toBe(false);
      expect(service.lastFocusKey()).toBeNull();
    });

    it('drops the implicit slice on two separate implicit-to-real transitions', async () => {
      for (const path of ['/ws-b', '/ws-c']) {
        tabs.activeWorkspacePath$.set(null);
        TestBed.tick();
        await service.start('Implicit prompt');
        const routingId = service.routingId() as string;
        const surfaceId = service.surfaceId();
        tabs.activeWorkspacePath$.set(path);
        TestBed.tick();
        expect(service['_slices']().has(APPS_IMPLICIT_WORKSPACE)).toBe(false);
        expect(inbox.isClaimed(routingId)).toBe(false);
        expect(claims.surfaceFor(routingId)).toBeNull();
        expect(surfaceId !== null && registry.getAdapter(surfaceId)).toBeNull();
      }
      expect(streamRouter.onSurfaceClosed).toHaveBeenCalledTimes(2);
    });

    it.each(['implicit drop', 'discard', 'workspace removal'] as const)(
      'aborts a successful pending start after %s without recreating state or claims',
      async (release) => {
        if (release === 'implicit drop') {
          tabs.activeWorkspacePath$.set(null);
          TestBed.tick();
        }
        let resolveStart!: (value: unknown) => void;
        (rpc.call as jest.Mock).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStart = resolve;
            }),
        );
        const pending = service.start('Pending prompt');
        const routingId = service.routingId() as string;
        const surfaceId = service.surfaceId();
        if (release === 'implicit drop') {
          tabs.activeWorkspacePath$.set('/ws-b');
        } else if (release === 'discard') {
          service.discard();
        } else {
          tabs.removedWorkspace$.set({ path: '/ws-a', seq: 1 });
        }
        TestBed.tick();
        const afterRelease = service['_slices']();
        // Exercise both the returned host ID and the routing-ID fallback.
        resolveStart(
          rpcSuccess(
            release === 'discard'
              ? { success: true }
              : { success: true, sessionId: 'late-host-session' },
          ),
        );
        await expect(pending).resolves.toBeUndefined();
        expect(callsOf('chat:abort').map((call) => call.params)).toEqual([
          {
            sessionId: release === 'discard' ? routingId : 'late-host-session',
          },
        ]);
        expect(service['_slices']()).toBe(afterRelease);
        expect(service['_slices']().has(APPS_IMPLICIT_WORKSPACE)).toBe(false);
        expect(service.isActive()).toBe(false);
        expect(inbox.isClaimed(routingId)).toBe(false);
        expect(claims.surfaceFor(routingId)).toBeNull();
        expect(surfaceId !== null && registry.getAdapter(surfaceId)).toBeNull();
        expect(streamRouter.onSurfaceClosed).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['transport', 'refusal'] as const)(
      'keeps a newer slice unchanged when late-start abort fails by %s',
      async (failure) => {
        let resolveStart!: (value: unknown) => void;
        (rpc.call as jest.Mock).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveStart = resolve;
            }),
        );
        const pending = service.start('Old prompt');
        service.discard();
        await service.start('New prompt');
        const newer = service['_slices']();
        if (failure === 'transport') {
          (rpc.call as jest.Mock).mockRejectedValueOnce(
            new Error('private payload'),
          );
        } else {
          (rpc.call as jest.Mock).mockResolvedValueOnce(
            rpcSuccess({ success: false, error: 'private payload' }),
          );
        }
        resolveStart(
          rpcSuccess({ success: true, sessionId: 'private-session' }),
        );
        await expect(pending).resolves.toBeUndefined();
        expect(service['_slices']()).toBe(newer);
        expect(service.isActive()).toBe(true);
        expect(inbox.isClaimed(service.routingId() as string)).toBe(true);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
      },
    );

    it('records focus only in the active workspace slice and restores each key', async () => {
      await service.start('Build in A');
      expect(service.lastFocusKey()).toBeNull();
      expect(() => service.recordFocusKey('composer')).not.toThrow();
      tabs.activeWorkspacePath$.set('/ws-b');
      expect(service.lastFocusKey()).toBeNull();
      await service.start('Build in B');
      service.recordFocusKey('table-filter');
      tabs.activeWorkspacePath$.set('/ws-a');
      expect(service.lastFocusKey()).toBe('composer');
      tabs.activeWorkspacePath$.set('/ws-b');
      expect(service.lastFocusKey()).toBe('table-filter');
      service.recordFocusKey(null);
      expect(service.lastFocusKey()).toBeNull();
    });

    it('releases the boot-window conversation and drops the implicit slice on first real workspace (N2)', async () => {
      tabs.activeWorkspacePath$.set(null);
      service = TestBed.runInInjectionContext(() => new AppsSessionService());
      TestBed.tick();
      await service.start('Boot prompt');
      const routingId = service.routingId() as string;
      const surfaceId = service.surfaceId();
      service.requestSurfaceRead(routingId, 'stale-revision');
      const readSignal = callsOf('surface:read')[0].options?.signal;
      service.expectSurfaceRevision(routingId, 'profile', 2);
      const sync = service['_slices']().get(APPS_IMPLICIT_WORKSPACE)?.sync;
      if (!sync) throw new Error('Missing implicit sync');
      const dispose = jest.spyOn(sync, 'dispose');

      tabs.activeWorkspacePath$.set('/ws-a');
      TestBed.tick();

      expect(inbox.isClaimed(routingId)).toBe(false);
      expect(claims.surfaceFor(routingId)).toBeNull();
      expect(surfaceId !== null && registry.getAdapter(surfaceId)).toBeNull();
      expect(streamRouter.onSurfaceClosed).toHaveBeenCalledWith(surfaceId);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(readSignal?.aborted).toBe(true);
      expect(service['_slices']().has(APPS_IMPLICIT_WORKSPACE)).toBe(false);
      expect(service.isActive()).toBe(false);
      tabs.activeWorkspacePath$.set('/ws-b');
      TestBed.tick();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('discard on a workspace that never started creates no empty slice (N3)', () => {
      const before = service['_slices']();
      service.discard();
      expect(service['_slices']()).toBe(before);
      expect(service['_slices']().has('/ws-a')).toBe(false);
      expect(streamRouter.onSurfaceClosed).not.toHaveBeenCalled();
    });

    it('a workspace switch shows the other slice, and switching back restores it (Req 2.6)', async () => {
      await service.start('Build in A');
      const routingA = service.routingId() as string;
      const surfaceA = service.surfaceId();
      push(snapshot(routingA, 'profile', 1));

      tabs.activeWorkspacePath$.set('/ws-b');
      expect(service.workspaceKey()).toBe('/ws-b');
      expect(service.isActive()).toBe(false);
      expect(service.surfaceId()).toBeNull();
      expect(service.surfaces().entries.size).toBe(0);
      expect(service.userBubbles()).toEqual([]);

      tabs.activeWorkspacePath$.set('/ws-a');
      expect(service.surfaceId()).toBe(surfaceA);
      expect(service.surfaces().entries.has('profile')).toBe(true);
      expect(service.userBubbles().map((b) => b.text)).toEqual(['Build in A']);
      // A switch never tears the other conversation down.
      expect(inbox.isClaimed(routingA)).toBe(true);
    });

    it('discard() only affects the active workspace', async () => {
      await service.start('Build in A');
      const routingA = service.routingId() as string;
      tabs.activeWorkspacePath$.set('/ws-b');
      await service.start('Build in B');
      const routingB = service.routingId() as string;

      service.discard();

      expect(inbox.isClaimed(routingB)).toBe(false);
      expect(inbox.isClaimed(routingA)).toBe(true);
    });

    it('a removed workspace releases its conversation and drops its slice', async () => {
      await service.start('Build in A');
      const routingA = service.routingId() as string;
      const surfaceA = service.surfaceId();
      tabs.activeWorkspacePath$.set('/ws-b');

      tabs.removedWorkspace$.set({ path: '/ws-a', seq: 1 });
      TestBed.tick();

      expect(inbox.isClaimed(routingA)).toBe(false);
      expect(surfaceA !== null && registry.getAdapter(surfaceA)).toBeNull();
      tabs.activeWorkspacePath$.set('/ws-a');
      expect(service.isActive()).toBe(false);
    });

    it('ownedRoutingIds lists every slice conversation, shown or not, and drops a removed or discarded one', async () => {
      await service.start('Build in A');
      const routingA = service.routingId() as string;
      tabs.activeWorkspacePath$.set('/ws-b');
      await service.start('Build in B');
      const routingB = service.routingId() as string;
      expect([...service.ownedRoutingIds()].sort()).toEqual(
        [routingA, routingB].sort(),
      );

      const before = service.ownedRoutingIds();
      service.recordFocusKey('name'); // no conversation changed
      expect(service.ownedRoutingIds()).toBe(before);

      tabs.removedWorkspace$.set({ path: '/ws-a', seq: 1 });
      TestBed.tick();
      expect([...service.ownedRoutingIds()]).toEqual([routingB]);

      service.discard();
      expect(service.ownedRoutingIds().size).toBe(0);
    });

    it('uses the implicit slice before a workspace path is known', () => {
      tabs.activeWorkspacePath$.set(null);
      expect(service.workspaceKey()).toBe(APPS_IMPLICIT_WORKSPACE);
    });
  });

  describe('lifetime', () => {
    @Component({
      selector: 'ptah-apps-session-probe',
      template: '<span>{{ session.surfaceId() }}</span>',
    })
    class SessionProbeComponent {
      public readonly session = inject(AppsSessionService);
    }

    it('state survives component destroy and re-create (Req 2.4)', async () => {
      const first = TestBed.createComponent(SessionProbeComponent);
      await first.componentInstance.session.start('Build');
      const routingId = service.routingId() as string;
      push(snapshot(routingId, 'profile', 1));
      first.detectChanges();
      const rendered = (first.nativeElement as HTMLElement).textContent;
      first.destroy();

      // An event that arrives while the page is away is not lost.
      push(snapshot(routingId, 'orders', 1));
      const second = TestBed.createComponent(SessionProbeComponent);
      second.detectChanges();

      expect(second.componentInstance.session).toBe(service);
      expect((second.nativeElement as HTMLElement).textContent).toBe(rendered);
      expect([...service.surfaces().entries.keys()].sort()).toEqual([
        'orders',
        'profile',
      ]);
      expect(inbox.isClaimed(routingId)).toBe(true);
      second.destroy();
    });
  });

  describe('Req 2.1', () => {
    it('never mutates TabManagerService (start, send, abort, discard, switch)', async () => {
      await service.start('Build');
      sessionResolved = true;
      await service.send('More');
      await service.abort();
      tabs.activeWorkspacePath$.set('/ws-b');
      await service.start('Build in B');
      service.discard();
      tabs.removedWorkspace$.set({ path: '/ws-a', seq: 1 });
      TestBed.tick();

      expect(callsOf('chat:continue')).toHaveLength(1);
      expect(callsOf('chat:abort')).toHaveLength(1);
      expect(tabs.violations).toEqual([]);
    });
  });

  describe('turns', () => {
    it('send() starts the conversation when there is none', async () => {
      await service.send('Hello');
      expect(callsOf('chat:start')).toHaveLength(1);
      expect(callsOf('chat:continue')).toHaveLength(0);
    });

    it('send() continues the resolved session with chat:continue; abort() marks it idle', async () => {
      await service.start('Build');
      sessionResolved = true;

      await service.send('More');
      await service.abort();

      const [turn] = callsOf('chat:continue');
      expect(turn.params).toEqual({
        sessionId: 'session-1',
        tabId: service.routingId(),
        prompt: 'More',
        surfaceMode: true,
      });
      expect(service.userBubbles().map((b) => b.text)).toEqual([
        'Build',
        'More',
      ]);
      expect(callsOf('chat:abort')[0].params).toEqual({
        sessionId: 'session-1',
      });
      expect(markIdle).toHaveBeenCalledWith('session-1', '/ws-a');
    });

    it('a failed chat:continue only sets the error; the conversation stays', async () => {
      await service.start('Build');
      sessionResolved = true;
      (rpc.call as jest.Mock).mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'Agent busy.' }),
      );

      await service.send('More');

      expect(service.error()).toBe('Agent busy.');
      expect(service.isActive()).toBe(true);
      expect(inbox.isClaimed(service.routingId() as string)).toBe(true);
    });

    it('send() before the session resolves reports an error and sends nothing', async () => {
      await service.start('Build');
      await service.send('More');

      expect(callsOf('chat:continue')).toHaveLength(0);
      expect(service.error()).not.toBeNull();
      service.clearError();
      expect(service.error()).toBeNull();
    });
  });
});
