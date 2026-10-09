import 'reflect-metadata';

// `ChatSessionService` imports `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively evaluates TreeSitter's ESM-only `import.meta.url` module. Stub the
// workspace-intelligence barrel before importing the service, as the sibling
// budget spec does, so ts-jest can load this focused unit test.
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

import type { IAgentAdapter } from '@ptah-extension/shared';

import { ChatSessionService } from './chat-session.service';

const TAB_ID = '11111111-2222-4333-8444-555555555555';

function handoverService(): {
  readonly service: ChatSessionService;
  readonly startAgentChildSession: jest.Mock;
  readonly sendMessageToSession: jest.Mock;
  readonly enqueueTransferInputs: jest.Mock;
  readonly endSession: jest.Mock;
} {
  const service = Object.create(ChatSessionService.prototype) as ChatSessionService;
  const startAgentChildSession = jest.fn().mockResolvedValue({ success: true });
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const enqueueTransferInputs = jest.fn().mockResolvedValue(undefined);
  const endSession = jest.fn();
  jest.spyOn(service, 'startAgentChildSession').mockImplementation(
    startAgentChildSession,
  );
  Object.defineProperty(service, 'sdkAdapter', {
    value: { sendMessageToSession, enqueueTransferInputs, endSession } as Pick<
      IAgentAdapter,
      'sendMessageToSession' | 'enqueueTransferInputs' | 'endSession'
    >,
  });
  return {
    service,
    startAgentChildSession,
    sendMessageToSession,
    enqueueTransferInputs,
    endSession,
  };
}

describe('ChatSessionService successor handover', () => {
  it('starts the successor with its seed before the coordinator delivers its FIFO', async () => {
    const h = handoverService();

    await expect(h.service.startHandoverSuccessor({
      tabId: TAB_ID,
      workspaceRoot: '/repo',
      worktreePath: '/repo/.ptah/worktrees/successor',
      seed: 'handoff seed',
      model: 'claude-sonnet',
      effort: 'medium',
      permissionLevel: 'auto-edit',
    })).resolves.toEqual({ success: true });

    expect(h.startAgentChildSession).toHaveBeenCalledWith({
      tabId: TAB_ID,
      workspaceRoot: '/repo',
      worktreePath: '/repo/.ptah/worktrees/successor',
      prompt: 'handoff seed',
      sessionName: 'Session handover',
      model: 'claude-sonnet',
      effort: 'medium',
      permissionLevel: 'auto-edit',
    });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('ends an unacknowledged successor during cleanup', async () => {
    const h = handoverService();

    await h.service.stopHandoverSuccessor(TAB_ID);

    expect(h.endSession).toHaveBeenCalledWith(TAB_ID);
  });

  it('preserves held input origins when delivering to the successor', async () => {
    const h = handoverService();
    const origin = { kind: 'peer', from: 'parent-session' } as const;

    await h.service.deliverHandoverInputs(TAB_ID, [{ content: 'peer update', origin }]);

    expect(h.enqueueTransferInputs).toHaveBeenCalledWith(TAB_ID, [
      { content: 'peer update', origin },
    ]);
  });

  it('forwards full-auto permission to the SDK launch', async () => {
    const h = handoverService();

    await h.service.startHandoverSuccessor({
      tabId: TAB_ID,
      workspaceRoot: '/repo',
      worktreePath: '/repo/.ptah/worktrees/successor',
      seed: 'handoff seed',
      permissionLevel: 'yolo',
    });

    expect(h.startAgentChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionLevel: 'yolo' }),
    );
  });
});
