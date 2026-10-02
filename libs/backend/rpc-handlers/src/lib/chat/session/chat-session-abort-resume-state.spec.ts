/**
 * ChatSessionService — `chat:abort` and the durable resumable-subagent list
 * (TASK_2026_592 Batch 4).
 *
 * Closing an idle tab now sends `chat:abort` for a session that may have no
 * live SDK record. `abortSession` persists `getResumableBySession(sessionId)`
 * through `SessionMetadataStore.saveResumeState`, which REPLACES the stored
 * list. These specs pin, with the REAL `SubagentRegistryService` and the REAL
 * `SessionMetadataStore` (over a mock state storage), what each abort writes:
 *
 *  (a) live session with a running subagent, then a second (idle) abort;
 *  (b) restart: durable list present, in-memory registry empty because the
 *      tab was restored from localStorage and never sent `chat:resume`;
 *  (c) interrupted records older than the registry TTL.
 *
 * Only the SDK adapter and the Ptah CLI service are faked. The fake adapter
 * models `SessionControl.endRecord`: for a live record it marks the
 * session's subagents interrupted and fires the session-end callback (the
 * second writer, `subscribeToSessionEnd`); without a record it is a no-op,
 * exactly as `endSession` returns `'already-ended'`.
 */

import 'reflect-metadata';

// Same reason as `chat-session-auth.spec.ts`: `ChatSessionService` transitively
// pulls `@ptah-extension/workspace-intelligence`, whose TreeSitter module
// evaluates `import.meta.url` at top level — a construct ts-jest's CJS
// transform cannot parse.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import {
  SubagentRegistryService,
  type ConfigManager,
  type Logger,
  type SentryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import type { SessionId, SubagentRecord } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const SESSION = 'sess-1' as SessionId;
const WORKSPACE = '/workspace/project';
/** Mirrors `TTL_MS` in `subagent-state-store.ts` (24 h). */
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

type SessionEndListener = (event: {
  sessionId: string;
  workspaceRoot: string;
}) => Promise<void> | void;

interface Harness {
  service: ChatSessionService;
  registry: SubagentRegistryService;
  store: SessionMetadataStore;
  /** Session ids that have a live SDK record (what `isSessionActive` sees). */
  live: Set<string>;
  interruptSession: jest.Mock;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const stub = { then: undefined } as unknown;
  const registry = new SubagentRegistryService(logger as unknown as Logger);
  const store = new SessionMetadataStore(
    createMockStateStorage(),
    logger as unknown as Logger,
  );
  const live = new Set<string>();

  let onSessionEnd: SessionEndListener | null = null;
  const sessionEndEvents = {
    register: jest.fn((cb: SessionEndListener) => {
      onSessionEnd = cb;
      return () => undefined;
    }),
  };

  // Models SessionControl.endSession → endRecord: only a registered record is
  // torn down (markAllInterrupted, then the SessionEnd notification).
  const interruptSession = jest.fn(async (sessionId: string) => {
    if (!live.has(sessionId)) return;
    registry.markAllInterrupted(sessionId);
    live.delete(sessionId);
    await onSessionEnd?.({ sessionId, workspaceRoot: WORKSPACE });
  });

  const sdkAdapter = {
    interruptSession,
    isSessionActive: (sessionId: string) => live.has(sessionId),
  };

  const service = new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter as never,
    { captureException: jest.fn() } as unknown as SentryService,
    stub as never,
    stub as never,
    registry,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    store,
    createMockWorkspaceProvider({
      folders: [WORKSPACE],
    }) as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    stub as never,
    {
      handleAbort: jest.fn().mockResolvedValue({
        success: false,
        error: '__NOT_PTAH_CLI__',
      }),
    } as never,
    stub as never,
    stub as never,
    stub as never,
    createMockModelSettings() as unknown as ModelSettings,
    {
      getProviderKey: jest.fn().mockResolvedValue(undefined),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as never,
    {
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    sessionEndEvents as never,
  );

  return { service, registry, store, live, interruptSession };
}

function interruptedRecord(
  overrides: Partial<SubagentRecord> = {},
): SubagentRecord {
  return {
    toolCallId: 'tool-1',
    agentType: 'backend',
    agentId: 'agent-1',
    status: 'interrupted',
    startedAt: Date.now(),
    interruptedAt: Date.now(),
    parentSessionId: SESSION as string,
    ...overrides,
  };
}

async function durableList(
  store: SessionMetadataStore,
): Promise<readonly SubagentRecord[] | undefined> {
  return (await store.get(SESSION as string))?.resumableSdkSubagents;
}

describe('ChatSessionService.abortSession — durable resumable-subagent list', () => {
  it('(a) a live abort persists the interrupted subagent, and a second idle abort keeps it', async () => {
    const h = makeHarness();
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    h.registry.register({
      toolCallId: 'tool-1',
      agentType: 'backend',
      agentId: 'agent-1',
      startedAt: Date.now(),
      parentSessionId: SESSION as string,
    });
    h.live.add(SESSION as string);

    const first = await h.service.abortSession({ sessionId: SESSION });

    expect(first.success).toBe(true);
    expect(first.resumableSubagents?.map((r) => r.toolCallId)).toEqual([
      'tool-1',
    ]);
    expect((await durableList(h.store))?.map((r) => r.toolCallId)).toEqual([
      'tool-1',
    ]);

    // The tab-close path may send a second abort for the same, now idle,
    // session. The registry still holds the interrupted record this run.
    const second = await h.service.abortSession({ sessionId: SESSION });

    expect(second.success).toBe(true);
    expect((await durableList(h.store))?.map((r) => r.toolCallId)).toEqual([
      'tool-1',
    ]);
  });

  it('(b) an idle abort after a restart does not wipe the durable list the registry never restored', async () => {
    const h = makeHarness();
    const durable = interruptedRecord();
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    await h.store.saveResumeState(SESSION as string, {
      resumableSdkSubagents: [durable],
    });
    // Fresh process: registry empty, no live record, no chat:resume yet (a
    // background tab restored from localStorage and closed unopened).
    expect(h.registry.getResumableBySession(SESSION as string)).toEqual([]);

    const result = await h.service.abortSession({ sessionId: SESSION });

    expect(result).toEqual({ success: true });
    expect(await durableList(h.store)).toEqual([durable]);

    // The list is still usable: a later chat:resume restores it.
    expect(
      h.registry.restoreResumableBySession(
        SESSION as string,
        (await durableList(h.store)) ?? [],
      ),
    ).toBe(1);
  });

  it('(b) after chat:resume restored the durable list, an idle abort writes the same list back', async () => {
    const h = makeHarness();
    const durable = interruptedRecord();
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    await h.store.saveResumeState(SESSION as string, {
      resumableSdkSubagents: [durable],
    });
    h.registry.restoreResumableBySession(SESSION as string, [durable]);

    const result = await h.service.abortSession({ sessionId: SESSION });

    expect(result.resumableSubagents?.map((r) => r.toolCallId)).toEqual([
      'tool-1',
    ]);
    expect(await durableList(h.store)).toEqual([durable]);
  });

  it('(c) a TTL-expired durable record is left in place by an idle abort but is never restored', async () => {
    const h = makeHarness();
    const expired = interruptedRecord({
      startedAt: Date.now() - REGISTRY_TTL_MS - 60_000,
    });
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    await h.store.saveResumeState(SESSION as string, {
      resumableSdkSubagents: [expired],
    });

    await h.service.abortSession({ sessionId: SESSION });

    expect(await durableList(h.store)).toEqual([expired]);
    // Harmless: the only reader path (chat:resume) refuses expired records.
    expect(
      h.registry.restoreResumableBySession(SESSION as string, [expired]),
    ).toBe(0);
    expect(h.registry.getResumableBySession(SESSION as string)).toEqual([]);
  });

  it('(c) a live abort whose interrupted subagent is past the TTL writes an empty list from both writers', async () => {
    const h = makeHarness();
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    h.registry.register({
      toolCallId: 'tool-old',
      agentType: 'backend',
      agentId: 'agent-old',
      startedAt: Date.now() - REGISTRY_TTL_MS - 60_000,
      parentSessionId: SESSION as string,
    });
    h.live.add(SESSION as string);
    const saveSpy = jest.spyOn(h.store, 'saveResumeState');

    await h.service.abortSession({ sessionId: SESSION });

    // Session-end subscriber first, then abortSession itself: both read the
    // registry, which filters the expired record out.
    expect(saveSpy).toHaveBeenCalledTimes(2);
    expect(await durableList(h.store)).toEqual([]);
  });

  it('a live abort still clears a stale durable list when nothing is resumable any more', async () => {
    const h = makeHarness();
    await h.store.create(SESSION as string, WORKSPACE, 'parent');
    await h.store.saveResumeState(SESSION as string, {
      resumableSdkSubagents: [interruptedRecord()],
    });
    // The session was resumed and its interrupted agent finished this run.
    h.live.add(SESSION as string);

    await h.service.abortSession({ sessionId: SESSION });

    expect(h.interruptSession).toHaveBeenCalledWith(SESSION);
    expect(await durableList(h.store)).toEqual([]);
  });
});
