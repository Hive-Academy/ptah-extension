/**
 * SessionOrganizationRpcHandlers specs (TASK_2026_580 A4.2).
 *
 * The handler is built in a tsyringe child container, the way the RPC
 * surface resolves it (`requires: []` → constructed on every host):
 *  - without `SESSION_ORGANIZATION_TOKENS.SERVICE` (the VS Code shape):
 *    construction succeeds, nothing subscribes, every method answers
 *    `organization-unavailable`;
 *  - with a fake service (the Electron/CLI shape): exactly one `onDidChange`
 *    subscription, validation before every service call, not-found,
 *    authorization, sanitized errors, the real `missing` flag, the
 *    `session:organizationChanged` push and `session:listForTasks` grouping.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SESSION_ORGANIZATION_TOKENS,
  SessionOrganizationInputError,
  type SessionOrganizationChange,
  type SessionOrganizationService,
  type StoredOrganization,
  type StoredSessionTaskLink,
} from '@ptah-extension/session-organization';
import { TASK_SPECS_TOKENS } from '@ptah-extension/task-specs';
import {
  MESSAGE_TYPES,
  type SessionOrganizationMutationResult,
  type SessionOrganizationSummary,
  type SessionTurnState,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { SessionOrganizationRpcHandlers } from './session-organization-rpc.handlers';

const WORKSPACE = '/fake/workspace';
const OTHER_WORKSPACE = '/elsewhere';
const SESSION_A = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const SESSION_B = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const SESSION_ORPHAN = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000009';
const TASK_1 = 'TASK_2026_580_9f77';
const TASK_2 = 'TASK_2026_581_aaaa';
const PR_URL = 'https://github.com/acme/repo/pull/7';

type FakeOrganization = jest.Mocked<
  Pick<
    SessionOrganizationService,
    | 'onDidChange'
    | 'isAvailable'
    | 'setOrganization'
    | 'linkSessionTask'
    | 'unlinkSessionTask'
    | 'addSessionPrLink'
    | 'removeSessionPrLink'
    | 'listTaskLinks'
    | 'queryWorkspace'
  >
>;

interface Fakes {
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  metadataStore: { get: jest.Mock; getForWorkspace: jest.Mock };
  turnState: { get: jest.Mock<SessionTurnState | undefined, [string]> };
  webviewManager: { broadcastMessage: jest.Mock };
  taskIndex: { list: jest.Mock };
  organization: FakeOrganization;
  /** The listener the handler passed to `onDidChange`, if any. */
  changeListener: () => ((change: SessionOrganizationChange) => void) | null;
}

function summary(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function okResult(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationMutationResult {
  return { ok: true, organization: summary(overrides) };
}

function createFakes(): Fakes {
  let listener: ((change: SessionOrganizationChange) => void) | null = null;
  const organization: FakeOrganization = {
    onDidChange: jest.fn((fn: (change: SessionOrganizationChange) => void) => {
      listener = fn;
      return { dispose: jest.fn() };
    }),
    isAvailable: jest.fn().mockReturnValue(true),
    setOrganization: jest.fn().mockResolvedValue(okResult()),
    linkSessionTask: jest.fn().mockResolvedValue(okResult()),
    unlinkSessionTask: jest.fn().mockResolvedValue(okResult()),
    addSessionPrLink: jest.fn().mockResolvedValue(okResult()),
    removeSessionPrLink: jest.fn().mockResolvedValue(okResult()),
    listTaskLinks: jest.fn().mockReturnValue([]),
    queryWorkspace: jest.fn().mockReturnValue(new Map()),
  } as unknown as FakeOrganization;
  return {
    logger: createMockLogger(),
    rpcHandler: createMockRpcHandler(),
    metadataStore: {
      get: jest.fn(async (sessionId: string) =>
        sessionId === SESSION_ORPHAN
          ? undefined
          : { sessionId, name: `name-${sessionId}`, workspaceId: WORKSPACE },
      ),
      getForWorkspace: jest.fn().mockResolvedValue([]),
    },
    turnState: {
      get: jest
        .fn<SessionTurnState | undefined, [string]>()
        .mockReturnValue(undefined),
    },
    webviewManager: {
      broadcastMessage: jest.fn().mockResolvedValue(undefined),
    },
    taskIndex: {
      list: jest.fn().mockResolvedValue({ tasks: [], excluded: [] }),
    },
    organization,
    changeListener: () => listener,
  };
}

/** Build in a child container; `withService: false` is the VS Code shape. */
function build(
  fakes: Fakes,
  opts: { withService: boolean; withTaskIndex?: boolean } = {
    withService: true,
  },
): SessionOrganizationRpcHandlers {
  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, fakes.logger);
  child.registerInstance(TOKENS.RPC_HANDLER, fakes.rpcHandler);
  child.registerInstance(TOKENS.WEBVIEW_MANAGER, fakes.webviewManager);
  child.registerInstance(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    createMockWorkspaceProvider({ folders: [WORKSPACE] }),
  );
  child.registerInstance(
    SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    fakes.metadataStore,
  );
  child.registerInstance(
    SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
    fakes.turnState,
  );
  if (opts.withService) {
    child.registerInstance(
      SESSION_ORGANIZATION_TOKENS.SERVICE,
      fakes.organization,
    );
  }
  if (opts.withTaskIndex ?? true) {
    child.registerInstance(
      TASK_SPECS_TOKENS.TASK_INDEX_SERVICE,
      fakes.taskIndex,
    );
  }
  child.register(SessionOrganizationRpcHandlers, {
    useClass: SessionOrganizationRpcHandlers,
  });
  const handlers = child.resolve(SessionOrganizationRpcHandlers);
  handlers.register();
  return handlers;
}

async function callRaw(
  fakes: Fakes,
  method: string,
  params: unknown,
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}> {
  return fakes.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
}

async function call<T>(fakes: Fakes, method: string, params: unknown) {
  const response = await callRaw(fakes, method, params);
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as T;
}

/** Valid params for each mutation method. */
const VALID_MUTATIONS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['session:setOrganization', { sessionId: SESSION_A, priority: 'high' }],
  [
    'session:linkTask',
    { sessionId: SESSION_A, taskId: TASK_1, role: 'primary' },
  ],
  ['session:unlinkTask', { sessionId: SESSION_A, taskId: TASK_1 }],
  ['session:addPrLink', { sessionId: SESSION_A, url: PR_URL }],
  ['session:removePrLink', { sessionId: SESSION_A, url: PR_URL }],
];

const SERVICE_METHOD: Record<string, keyof FakeOrganization> = {
  'session:setOrganization': 'setOrganization',
  'session:linkTask': 'linkSessionTask',
  'session:unlinkTask': 'unlinkSessionTask',
  'session:addPrLink': 'addSessionPrLink',
  'session:removePrLink': 'removeSessionPrLink',
};

function serviceMutations(fakes: Fakes): jest.Mock[] {
  return Object.values(SERVICE_METHOD).map(
    (key) => fakes.organization[key] as jest.Mock,
  );
}

describe('SessionOrganizationRpcHandlers', () => {
  it('owns exactly the six organization methods', () => {
    expect([...SessionOrganizationRpcHandlers.METHODS]).toEqual([
      'session:setOrganization',
      'session:linkTask',
      'session:unlinkTask',
      'session:addPrLink',
      'session:removePrLink',
      'session:listForTasks',
    ]);
  });

  describe('without the organization service (VS Code shape)', () => {
    it('constructs in a child container, subscribes to nothing and registers all methods', () => {
      const fakes = createFakes();
      expect(() => build(fakes, { withService: false })).not.toThrow();
      expect(fakes.organization.onDidChange).not.toHaveBeenCalled();
      const registered = fakes.rpcHandler.registerMethod.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(registered).toEqual([...SessionOrganizationRpcHandlers.METHODS]);
    });

    it.each(VALID_MUTATIONS)(
      '%s answers organization-unavailable',
      async (method, params) => {
        const fakes = createFakes();
        build(fakes, { withService: false });
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          method,
          params,
        );
        expect(result).toEqual({
          ok: false,
          reason: 'organization-unavailable',
          message: expect.any(String),
        });
        expect(fakes.metadataStore.get).not.toHaveBeenCalled();
      },
    );

    it('session:listForTasks answers { available: false }', async () => {
      const fakes = createFakes();
      build(fakes, { withService: false });
      await expect(
        call(fakes, 'session:listForTasks', { workspacePath: WORKSPACE }),
      ).resolves.toEqual({ available: false });
    });

    it('works without the task index and webview manager registered too', () => {
      const fakes = createFakes();
      const child = container.createChildContainer();
      child.registerInstance(TOKENS.LOGGER, fakes.logger);
      child.registerInstance(TOKENS.RPC_HANDLER, fakes.rpcHandler);
      child.registerInstance(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        createMockWorkspaceProvider({ folders: [WORKSPACE] }),
      );
      child.registerInstance(
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        fakes.metadataStore,
      );
      child.registerInstance(
        SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY,
        fakes.turnState,
      );
      child.register(SessionOrganizationRpcHandlers, {
        useClass: SessionOrganizationRpcHandlers,
      });
      expect(() => child.resolve(SessionOrganizationRpcHandlers)).not.toThrow();
    });
  });

  describe('with the organization service', () => {
    it('subscribes to onDidChange exactly once', () => {
      const fakes = createFakes();
      build(fakes);
      expect(fakes.organization.onDidChange).toHaveBeenCalledTimes(1);
    });

    it('pushes session:organizationChanged for every change', async () => {
      const fakes = createFakes();
      build(fakes);
      fakes.changeListener()?.({
        workspaceRoot: WORKSPACE,
        sessionIds: [SESSION_A],
        reason: 'user',
      });
      await Promise.resolve();
      expect(fakes.webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
        { workspaceRoot: WORKSPACE, sessionIds: [SESSION_A], reason: 'user' },
      );
    });

    it('logs a failed push and never throws it', async () => {
      const fakes = createFakes();
      fakes.webviewManager.broadcastMessage.mockRejectedValue(
        new Error('webview gone'),
      );
      build(fakes);
      expect(() =>
        fakes.changeListener()?.({
          workspaceRoot: WORKSPACE,
          sessionIds: [SESSION_A],
          reason: 'capture',
        }),
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(fakes.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to broadcast'),
        expect.any(Error),
      );
    });

    describe('validation (before any service call)', () => {
      it.each([
        ...VALID_MUTATIONS.map(([method]) => [method] as const),
        ['session:listForTasks'] as const,
      ])('%s rejects null params with INVALID_PARAMS', async (method) => {
        const fakes = createFakes();
        build(fakes);
        const response = await callRaw(fakes, method, null);
        expect(response.success).toBe(false);
        expect(response.errorCode).toBe('INVALID_PARAMS');
        for (const mutation of serviceMutations(fakes)) {
          expect(mutation).not.toHaveBeenCalled();
        }
        expect(fakes.organization.listTaskLinks).not.toHaveBeenCalled();
        expect(fakes.metadataStore.get).not.toHaveBeenCalled();
      });

      it.each<[string, string, Record<string, unknown>]>([
        [
          'a non-UUID session id',
          'session:setOrganization',
          { sessionId: 'tab_123', pinned: true },
        ],
        [
          'setOrganization with no field',
          'session:setOrganization',
          { sessionId: SESSION_A },
        ],
        [
          'an unknown priority',
          'session:setOrganization',
          { sessionId: SESSION_A, priority: 'critical' },
        ],
        [
          'linkTask claiming source agent',
          'session:linkTask',
          {
            sessionId: SESSION_A,
            taskId: TASK_1,
            role: 'primary',
            source: 'agent',
          },
        ],
        [
          'a task id that is not one path segment',
          'session:linkTask',
          { sessionId: SESSION_A, taskId: '../escape', role: 'related' },
        ],
        [
          'an unknown role',
          'session:linkTask',
          { sessionId: SESSION_A, taskId: TASK_1, role: 'owner' },
        ],
        [
          'a url over 2048 chars',
          'session:addPrLink',
          { sessionId: SESSION_A, url: `https://x.dev/${'a'.repeat(2048)}` },
        ],
        [
          'an unknown PR state',
          'session:addPrLink',
          { sessionId: SESSION_A, url: PR_URL, state: 'reopened' },
        ],
        [
          'an empty url',
          'session:removePrLink',
          { sessionId: SESSION_A, url: '' },
        ],
        [
          'listForTasks without a workspace',
          'session:listForTasks',
          { taskIds: [TASK_1] },
        ],
      ])('rejects %s', async (_label, method, params) => {
        const fakes = createFakes();
        build(fakes);
        const response = await callRaw(fakes, method, params);
        expect(response.errorCode).toBe('INVALID_PARAMS');
        for (const mutation of serviceMutations(fakes)) {
          expect(mutation).not.toHaveBeenCalled();
        }
      });
    });

    it('passes linkTask with the default source user', async () => {
      const fakes = createFakes();
      build(fakes);
      await call(fakes, 'session:linkTask', {
        sessionId: SESSION_A,
        taskId: TASK_1,
        role: 'primary',
      });
      expect(fakes.organization.linkSessionTask).toHaveBeenCalledWith({
        sessionId: SESSION_A,
        taskId: TASK_1,
        role: 'primary',
        source: 'user',
      });
    });

    it('accepts linkTask source board-start', async () => {
      const fakes = createFakes();
      build(fakes);
      await call(fakes, 'session:linkTask', {
        sessionId: SESSION_A,
        taskId: TASK_1,
        role: 'related',
        source: 'board-start',
      });
      expect(fakes.organization.linkSessionTask).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'board-start' }),
      );
    });

    it('records a webview PR link with source user', async () => {
      const fakes = createFakes();
      build(fakes);
      await call(fakes, 'session:addPrLink', {
        sessionId: SESSION_A,
        url: PR_URL,
        state: 'open',
      });
      expect(fakes.organization.addSessionPrLink).toHaveBeenCalledWith({
        sessionId: SESSION_A,
        url: PR_URL,
        state: 'open',
        source: 'user',
      });
    });

    it.each(VALID_MUTATIONS)(
      '%s calls its service mutation and returns the summary',
      async (method, params) => {
        const fakes = createFakes();
        build(fakes);
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          method,
          params,
        );
        expect(result).toEqual(okResult());
        expect(
          fakes.organization[SERVICE_METHOD[method]] as jest.Mock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it('answers session-not-found for a session without metadata', async () => {
      const fakes = createFakes();
      build(fakes);
      const result = await call<SessionOrganizationMutationResult>(
        fakes,
        'session:setOrganization',
        { sessionId: SESSION_ORPHAN, pinned: true },
      );
      expect(result).toEqual({
        ok: false,
        reason: 'session-not-found',
        message: expect.any(String),
      });
      expect(fakes.organization.setOrganization).not.toHaveBeenCalled();
    });

    it('rejects a session whose workspace is not open', async () => {
      const fakes = createFakes();
      fakes.metadataStore.get.mockResolvedValue({
        sessionId: SESSION_A,
        name: 'x',
        workspaceId: OTHER_WORKSPACE,
      });
      build(fakes);
      const response = await callRaw(fakes, 'session:setOrganization', {
        sessionId: SESSION_A,
        pinned: true,
      });
      expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
      expect(fakes.organization.setOrganization).not.toHaveBeenCalled();
    });

    it('passes a service not-ok result through unchanged', async () => {
      const fakes = createFakes();
      const unavailable: SessionOrganizationMutationResult = {
        ok: false,
        reason: 'organization-unavailable',
        message: 'store not open',
      };
      fakes.organization.unlinkSessionTask.mockResolvedValue(unavailable);
      build(fakes);
      await expect(
        call(fakes, 'session:unlinkTask', {
          sessionId: SESSION_A,
          taskId: TASK_1,
        }),
      ).resolves.toEqual(unavailable);
    });

    it('maps SessionOrganizationInputError to INVALID_PARAMS', async () => {
      const fakes = createFakes();
      fakes.organization.addSessionPrLink.mockRejectedValue(
        new SessionOrganizationInputError('url must be an https URL'),
      );
      build(fakes);
      const response = await callRaw(fakes, 'session:addPrLink', {
        sessionId: SESSION_A,
        url: 'http://insecure.dev/pull/1',
      });
      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
    });

    it('sanitizes a storage error and logs the raw one', async () => {
      const fakes = createFakes();
      const raw = new Error('SQLITE_CORRUPT: C:/Users/me/.ptah/db.sqlite');
      fakes.organization.setOrganization.mockRejectedValue(raw);
      build(fakes);
      const response = await callRaw(fakes, 'session:setOrganization', {
        sessionId: SESSION_A,
        status: 'done',
      });
      expect(response.success).toBe(false);
      expect(response.errorCode).toBeUndefined();
      expect(response.error).toBe('session:setOrganization failed');
      expect(response.error).not.toContain('SQLITE');
      expect(fakes.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('session:setOrganization failed'),
        raw,
      );
    });

    describe('missing task flag', () => {
      const linkedSummary = {
        tasks: [
          {
            taskId: TASK_1,
            role: 'primary' as const,
            source: 'user' as const,
            createdAt: 1,
            missing: false,
          },
          {
            taskId: TASK_2,
            role: 'related' as const,
            source: 'agent' as const,
            createdAt: 2,
            missing: false,
          },
        ],
      };

      it('marks linked tasks absent from the task index (one read)', async () => {
        const fakes = createFakes();
        fakes.organization.linkSessionTask.mockResolvedValue(
          okResult(linkedSummary),
        );
        fakes.taskIndex.list.mockResolvedValue({
          tasks: [{ id: TASK_1 }],
          excluded: [],
        });
        build(fakes);
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          'session:linkTask',
          { sessionId: SESSION_A, taskId: TASK_1, role: 'primary' },
        );
        expect(fakes.taskIndex.list).toHaveBeenCalledTimes(1);
        expect(fakes.taskIndex.list).toHaveBeenCalledWith(WORKSPACE);
        expect(result.ok && result.organization.tasks).toEqual([
          expect.objectContaining({ taskId: TASK_1, missing: false }),
          expect.objectContaining({ taskId: TASK_2, missing: true }),
        ]);
      });

      it('treats an excluded folder as present', async () => {
        const fakes = createFakes();
        fakes.organization.setOrganization.mockResolvedValue(
          okResult(linkedSummary),
        );
        fakes.taskIndex.list.mockResolvedValue({
          tasks: [{ id: TASK_1 }],
          excluded: [{ folderName: TASK_2 }],
        });
        build(fakes);
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          'session:setOrganization',
          { sessionId: SESSION_A, pinned: true },
        );
        expect(
          result.ok && result.organization.tasks.map((t) => t.missing),
        ).toEqual([false, false]);
      });

      it('skips the index read when the session has no task links', async () => {
        const fakes = createFakes();
        build(fakes);
        await call(fakes, 'session:setOrganization', {
          sessionId: SESSION_A,
          pinned: true,
        });
        expect(fakes.taskIndex.list).not.toHaveBeenCalled();
      });

      it('marks nothing missing when the index cannot be read', async () => {
        const fakes = createFakes();
        fakes.organization.setOrganization.mockResolvedValue(
          okResult(linkedSummary),
        );
        fakes.taskIndex.list.mockRejectedValue(new Error('index closed'));
        build(fakes);
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          'session:setOrganization',
          { sessionId: SESSION_A, pinned: true },
        );
        expect(
          result.ok && result.organization.tasks.map((t) => t.missing),
        ).toEqual([false, false]);
        expect(fakes.logger.warn).toHaveBeenCalled();
      });

      it('marks nothing missing on a host without the task index', async () => {
        const fakes = createFakes();
        fakes.organization.setOrganization.mockResolvedValue(
          okResult(linkedSummary),
        );
        build(fakes, { withService: true, withTaskIndex: false });
        const result = await call<SessionOrganizationMutationResult>(
          fakes,
          'session:setOrganization',
          { sessionId: SESSION_A, pinned: true },
        );
        expect(
          result.ok && result.organization.tasks.map((t) => t.missing),
        ).toEqual([false, false]);
      });
    });

    describe('session:listForTasks', () => {
      const link = (
        sessionId: string,
        taskId: string,
        role: 'primary' | 'related',
        createdAt: number,
      ): StoredSessionTaskLink => ({
        sessionId,
        taskId,
        role,
        source: 'user',
        createdAt,
      });

      it('groups links by task with name, live phase and PR links', async () => {
        const fakes = createFakes();
        fakes.organization.listTaskLinks.mockReturnValue([
          link(SESSION_B, TASK_1, 'related', 30),
          link(SESSION_A, TASK_1, 'primary', 10),
          link(SESSION_B, TASK_2, 'primary', 20),
          link(SESSION_ORPHAN, TASK_2, 'related', 40),
        ]);
        fakes.metadataStore.getForWorkspace.mockResolvedValue([
          { sessionId: SESSION_A, name: 'Alpha' },
          { sessionId: SESSION_B, name: 'Beta' },
        ]);
        fakes.turnState.get.mockImplementation((id: string) =>
          id === SESSION_A
            ? ({ phase: 'generating' } as SessionTurnState)
            : undefined,
        );
        const prLink = {
          url: PR_URL,
          number: 7,
          repo: 'acme/repo',
          state: 'open' as const,
          source: 'agent' as const,
          createdAt: 5,
        };
        fakes.organization.queryWorkspace.mockReturnValue(
          new Map([
            [
              SESSION_A,
              {
                sessionId: SESSION_A,
                prLinks: [prLink],
              } as unknown as StoredOrganization,
            ],
          ]),
        );
        build(fakes);

        const result = await call(fakes, 'session:listForTasks', {
          workspacePath: WORKSPACE,
          taskIds: [TASK_1, TASK_2],
        });

        expect(fakes.organization.listTaskLinks).toHaveBeenCalledWith(
          WORKSPACE,
          [TASK_1, TASK_2],
        );
        expect(result).toEqual({
          available: true,
          links: {
            [TASK_1]: [
              {
                sessionId: SESSION_A,
                name: 'Alpha',
                role: 'primary',
                source: 'user',
                livePhase: 'generating',
                prLinks: [prLink],
              },
              {
                sessionId: SESSION_B,
                name: 'Beta',
                role: 'related',
                source: 'user',
                livePhase: null,
                prLinks: [],
              },
            ],
            // The orphan link (no metadata) is left out.
            [TASK_2]: [
              expect.objectContaining({
                sessionId: SESSION_B,
                role: 'primary',
              }),
            ],
          },
        });
      });

      it('returns an empty map without reading metadata when nothing is linked', async () => {
        const fakes = createFakes();
        build(fakes);
        await expect(
          call(fakes, 'session:listForTasks', { workspacePath: WORKSPACE }),
        ).resolves.toEqual({ available: true, links: {} });
        expect(fakes.metadataStore.getForWorkspace).not.toHaveBeenCalled();
      });

      it('answers { available: false } while the store is closed', async () => {
        const fakes = createFakes();
        fakes.organization.isAvailable.mockReturnValue(false);
        build(fakes);
        await expect(
          call(fakes, 'session:listForTasks', { workspacePath: WORKSPACE }),
        ).resolves.toEqual({ available: false });
        expect(fakes.organization.listTaskLinks).not.toHaveBeenCalled();
      });

      it('rejects a workspace that is not open', async () => {
        const fakes = createFakes();
        build(fakes);
        const response = await callRaw(fakes, 'session:listForTasks', {
          workspacePath: OTHER_WORKSPACE,
        });
        expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
        expect(fakes.organization.listTaskLinks).not.toHaveBeenCalled();
      });

      it('sanitizes a read failure', async () => {
        const fakes = createFakes();
        fakes.organization.listTaskLinks.mockImplementation(() => {
          throw new Error('SQLITE_IOERR: /secret/path');
        });
        build(fakes);
        const response = await callRaw(fakes, 'session:listForTasks', {
          workspacePath: WORKSPACE,
        });
        expect(response.success).toBe(false);
        expect(response.error).toBe('session:listForTasks failed');
        expect(fakes.logger.error).toHaveBeenCalled();
      });
    });
  });
});
