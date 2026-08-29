/**
 * ChatSessionService — `chat:continue` decides SLASH before it decides RESUME
 * (TASK_2026_350).
 *
 * Pre-fix ordering: `autoResumeIfInactive` ran first and, for an inactive
 * session, started a full SDK query in `idle+streamInput` mode — it never
 * forwards the prompt, so the executor could not know a slash command was
 * coming. The router then called `executeSlashCommand`, whose first act is to
 * end that just-started session; the teardown lost the interrupt race and
 * burned the full `Interrupt timed out (5s)`, then a SECOND query started with
 * `promptMode: "string (slash command + resume)"`. One `/orchestrate` cost two
 * CLI spawns and an 8524ms handler (log.log:2292-2364).
 *
 * `SessionQueryExecutor` already serves slash+resume in ONE query, so the fix
 * is to not ask for the resume. These specs pin (slash | plain) against all
 * THREE session states — nothing registered, live, and the dead record whose
 * broadcast loop already exited — because only `no record + slash` and
 * `dead record + slash` may change; the other four must be byte-identical to
 * the old behaviour.
 */

import 'reflect-metadata';

// `ChatSessionService` imports `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively pulls `@ptah-extension/workspace-intelligence`. That lib's
// TreeSitter module evaluates `import.meta.url` at top level — a construct
// ts-jest's CJS transform cannot parse. Stub it (mirrors the sibling specs).
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

import type {
  Logger,
  ConfigManager,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  ChatContinueParams,
  IAgentAdapter,
  SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';

const OPEN_FOLDER = '/c/projects/qa3elhamor';
const SESSION_ID = 'b5399ba8-e06d-417c-bac4-aba5add0555c' as SessionId;
const TAB_ID = 'f69cb197-0798-40bc-ac0c-6f7591e0a894';
const SLASH_PROMPT = '/orchestrate  asset-audit';

interface Harness {
  service: ChatSessionService;
  resumeSession: jest.Mock;
  sendMessageToSession: jest.Mock;
  endSession: jest.Mock;
  interruptSession: jest.Mock;
  interruptCurrentTurn: jest.Mock;
  routeFollowUpSlashCommand: jest.Mock;
}

/**
 * The two adapter/broadcaster answers that define the session's state. They are
 * SEPARATE inputs, not one `live` boolean, because their third combination —
 * `registered: true, streaming: false` — is a real state with its own branch:
 * a record whose broadcast loop already exited (the "corpse" /
 * "dead record" `autoResumeIfInactive` has a cleanup for). Collapsing them made
 * that quadrant unrepresentable, which is how it went untested.
 *
 *   registered:false, streaming:false → nothing registered
 *   registered:true,  streaming:true  → live
 *   registered:true,  streaming:false → dead record
 */
interface SessionState {
  registered: boolean;
  streaming: boolean;
}

const NO_RECORD: SessionState = { registered: false, streaming: false };
const LIVE: SessionState = { registered: true, streaming: true };
const DEAD_RECORD: SessionState = { registered: true, streaming: false };

function makeHarness(opts: SessionState): Harness {
  const noop = jest.fn();
  const logger = createMockLogger();
  const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });

  const resumeSession = jest.fn().mockResolvedValue(
    (async function* () {
      /* no events */
    })(),
  );
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const endSession = jest.fn().mockResolvedValue(undefined);
  const interruptSession = jest.fn().mockResolvedValue(undefined);
  const interruptCurrentTurn = jest.fn().mockResolvedValue(true);

  const sdkAdapter = {
    isSessionActive: jest.fn().mockReturnValue(opts.registered),
    resumeSession,
    sendMessageToSession,
    endSession,
    interruptSession,
    interruptCurrentTurn,
  } as unknown as IAgentAdapter;

  // The router is terminal for every non-passthrough action, so a slash prompt
  // that reaches it never falls through to `sendMessageToSession`.
  const routeFollowUpSlashCommand = jest
    .fn()
    .mockImplementation(async (prompt: string) =>
      prompt.trim().startsWith('/')
        ? { success: true, sessionId: SESSION_ID }
        : null,
    );

  const service = new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter,
    { captureException: jest.fn() } as unknown as SentryService,
    {
      getPort: jest.fn().mockReturnValue(0),
      ensureRegisteredForSubagents: jest
        .fn()
        .mockResolvedValue({ registered: true }),
    } as never,
    {
      readSessionHistory: jest.fn().mockResolvedValue({ events: [] }),
      readHistoryAsMessages: jest.fn().mockResolvedValue([]),
    } as never,
    {
      registerFromHistoryEvents: jest.fn().mockReturnValue(0),
      getResumableBySession: jest.fn().mockReturnValue([]),
    } as unknown as SubagentRegistryService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    { getCliSessionsForRestore: jest.fn().mockResolvedValue([]) } as never,
    provider as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
      resolvePluginPaths: jest.fn().mockReturnValue([]),
    } as never,
    {
      handleContinue: jest
        .fn()
        .mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    } as never,
    {
      streamEventsToWebview: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(opts.streaming),
    } as never,
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({ prompt })),
    } as never,
    { routeFollowUpSlashCommand } as never,
    createMockModelSettings() as unknown as ModelSettings,
    {
      getProviderKey: jest.fn().mockResolvedValue(null),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
  );

  return {
    service,
    resumeSession,
    sendMessageToSession,
    endSession,
    interruptSession,
    interruptCurrentTurn,
    routeFollowUpSlashCommand,
  };
}

function params(prompt: string): ChatContinueParams {
  return {
    prompt,
    sessionId: SESSION_ID,
    tabId: TAB_ID,
    workspacePath: OPEN_FOLDER,
  };
}

describe('chat:continue — inactive session + slash command', () => {
  it('routes straight to the slash-command query: no resume, exactly one launch', async () => {
    const h = makeHarness(NO_RECORD);

    const result = await h.service.continueSession(params(SLASH_PROMPT));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    // The whole defect: this used to fire and spawn an idle+streamInput query
    // that was killed four log lines later.
    expect(h.resumeSession).not.toHaveBeenCalled();
    // The one launch, carrying the raw command.
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledWith(
      SLASH_PROMPT,
      SESSION_ID,
      TAB_ID,
      OPEN_FOLDER,
      expect.objectContaining({ prompt: SLASH_PROMPT }),
    );
  });

  it('performs no teardown of its own — nothing for the 5s interrupt to wait on', async () => {
    const h = makeHarness(NO_RECORD);

    await h.service.continueSession(params(SLASH_PROMPT));

    // `autoResumeIfInactive`'s dead-record cleanup is what used to call
    // endSession here; the slash path never enters it.
    expect(h.endSession).not.toHaveBeenCalled();
    expect(h.interruptSession).not.toHaveBeenCalled();
    expect(h.interruptCurrentTurn).not.toHaveBeenCalled();
  });

  it('does not fall through to sendMessageToSession (the router is terminal)', async () => {
    const h = makeHarness(NO_RECORD);

    await h.service.continueSession(params(SLASH_PROMPT));

    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('treats a native slash command the same way — /clear needs no resumed session either', async () => {
    const h = makeHarness(NO_RECORD);

    await h.service.continueSession(params('/clear'));

    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
  });
});

describe('chat:continue — inactive session + plain text (unchanged)', () => {
  it('resumes exactly as before and sends the message', async () => {
    const h = makeHarness(NO_RECORD);

    const result = await h.service.continueSession(
      params('check the current project'),
    );

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.resumeSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        projectPath: OPEN_FOLDER,
        tabId: TAB_ID,
        prompt: 'check the current project',
      }),
    );
    expect(h.sendMessageToSession).toHaveBeenCalledWith(
      SESSION_ID,
      'check the current project',
      { files: [], images: [] },
    );
  });

  it('surfaces a resume failure as a structured error and never reaches the router', async () => {
    const h = makeHarness(NO_RECORD);
    h.resumeSession.mockRejectedValue(new Error('boom: resume rejected'));

    const result = await h.service.continueSession(params('hello'));

    expect(result).toEqual({
      success: false,
      sessionId: SESSION_ID,
      error: 'boom: resume rejected',
    });
    expect(h.routeFollowUpSlashCommand).not.toHaveBeenCalled();
  });
});

describe('chat:continue — active session (unchanged)', () => {
  it('slash command: routes without resuming', async () => {
    const h = makeHarness(LIVE);

    const result = await h.service.continueSession(params(SLASH_PROMPT));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
    // The dead-record helper must be a no-op for a LIVE session: tearing this
    // one down would kill the stream the user is watching.
    expect(h.interruptSession).not.toHaveBeenCalled();
    expect(h.endSession).not.toHaveBeenCalled();
  });

  it('plain text: no resume, message sent', async () => {
    const h = makeHarness(LIVE);

    await h.service.continueSession(params('keep going'));

    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.sendMessageToSession).toHaveBeenCalledWith(
      SESSION_ID,
      'keep going',
      {
        files: [],
        images: [],
      },
    );
  });
});

/**
 * The fifth quadrant, added in judge round 1: `isSessionActive` true but
 * `isStreaming` false — a record whose broadcast loop already exited.
 *
 * `autoResumeIfInactive` has a cleanup for this, and the slash path skips that
 * method entirely, so without its own handling the only teardown would be
 * `executeSlashCommandQuery`'s unconditional `endSession` reaching a live `rec`
 * and running the interrupt race — the stall class this task removes.
 *
 * The teardown must be AWAITED, which is why the assertion is on
 * `interruptSession` and not `endSession`: `IAIProvider.endSession` returns
 * `void` (ai-provider.types.ts:280), so awaiting it does not wait for the
 * teardown and would leave the corpse registered for the slash query to tear
 * down a second time, concurrently.
 */
describe('chat:continue — dead record (registered, not streaming)', () => {
  it('slash command: ends the corpse via the AWAITED teardown, then routes — no resume', async () => {
    const h = makeHarness(DEAD_RECORD);

    const result = await h.service.continueSession(params(SLASH_PROMPT));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.interruptSession).toHaveBeenCalledTimes(1);
    expect(h.interruptSession).toHaveBeenCalledWith(SESSION_ID);
    // The void, fire-and-forget teardown must NOT be the one used here.
    expect(h.endSession).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
  });

  it('slash command: the corpse is dead BEFORE the router runs', async () => {
    const h = makeHarness(DEAD_RECORD);

    let interruptedFirst = false;
    h.routeFollowUpSlashCommand.mockImplementation(async () => {
      interruptedFirst = h.interruptSession.mock.calls.length === 1;
      return { success: true, sessionId: SESSION_ID };
    });

    await h.service.continueSession(params(SLASH_PROMPT));

    // Ordering is the whole point: if the teardown had not completed by now,
    // `executeSlashCommandQuery` would find the record and race it again.
    expect(interruptedFirst).toBe(true);
  });

  it('slash command: a teardown failure is non-fatal — the command still runs', async () => {
    const h = makeHarness(DEAD_RECORD);
    h.interruptSession.mockRejectedValue(new Error('corpse would not die'));

    const result = await h.service.continueSession(params(SLASH_PROMPT));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
  });

  it('plain text: unchanged — falls to autoResumeIfInactive, which owns its own corpse cleanup', async () => {
    const h = makeHarness(DEAD_RECORD);

    await h.service.continueSession(params('keep going'));

    // The slash-only helper must not fire for plain text; the resume path's
    // existing `endSession` branch handles the corpse there.
    expect(h.interruptSession).not.toHaveBeenCalled();
    expect(h.endSession).toHaveBeenCalledWith(SESSION_ID);
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
  });
});
