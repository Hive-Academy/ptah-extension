import { TestBed } from '@angular/core/testing';
import { WizardRpcService } from './wizard-rpc.service';
import { ClaudeRpcService, ModelStateService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AgentSelection } from './setup-wizard-state.service';

/**
 * WizardRpcService tests.
 *
 * The service is a thin facade over {@link ClaudeRpcService}, so the tests
 * stub `ClaudeRpcService.call` and assert the RPC method names + payload
 * shapes, then verify the service translates `{ success, error }` results
 * into resolved values / thrown errors as designed.
 */
describe('WizardRpcService', () => {
  let service: WizardRpcService;
  let rpcCall: jest.Mock;
  let mockRpcService: Partial<ClaudeRpcService>;
  let mockModelState: Partial<ModelStateService>;

  beforeEach(() => {
    rpcCall = jest.fn();
    mockRpcService = {
      call: rpcCall as unknown as ClaudeRpcService['call'],
    };
    mockModelState = {
      currentModel: jest.fn().mockReturnValue(null),
    } as unknown as Partial<ModelStateService>;

    TestBed.configureTestingModule({
      providers: [
        WizardRpcService,
        { provide: ClaudeRpcService, useValue: mockRpcService },
        { provide: ModelStateService, useValue: mockModelState },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: jest.fn(),
            getWorkspaceTabs: jest.fn().mockReturnValue([]),
          },
        },
      ],
    });

    service = TestBed.inject(WizardRpcService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /** Factory for a success-shape RPC result (both `success` and `isSuccess()`). */
  const okResult = (data?: unknown) => ({
    success: true,
    isSuccess: () => true,
    data,
  });

  /** Factory for a failure-shape RPC result. */
  const errResult = (error: string) => ({
    success: false,
    isSuccess: () => false,
    error,
  });

  it('lets onboarding distinguish saved-list RPC failure while legacy callers still receive an empty list', async () => {
    rpcCall.mockResolvedValue(errResult('private host detail'));
    await expect(service.listAnalyses()).resolves.toEqual([]);
    await expect(service.listAnalyses({ throwOnError: true })).rejects.toThrow('Saved analyses could not be loaded.');
    rpcCall.mockResolvedValue(okResult({ analyses: [] }));
    await expect(service.listAnalyses({ throwOnError: true })).resolves.toEqual([]);
  });

  it('uses the bound guidance tab model and preserves tabless Settings calls', async () => {
    rpcCall.mockResolvedValue(okResult({ accepted: { runId: 'r' } }));
    const binding = {
      tabId: 'guidance',
      workflow: 'setup-project-prompt' as const,
      workspacePath: '/ws',
    };
    const tabs = TestBed.inject(TabManagerService);
    jest.spyOn(tabs, 'findTabByIdAcrossWorkspaces').mockReturnValue({
      workspacePath: '/ws',
      tab: { overrideModel: 'tab-model' },
    } as ReturnType<TabManagerService['findTabByIdAcrossWorkspaces']>);
    await service.startBoundGuidance(binding);
    expect(rpcCall).toHaveBeenCalledWith(
      'enhancedPrompts:runWizard',
      { workspacePath: '/ws', tabBinding: binding, model: 'tab-model' },
      { timeout: 300_000 },
    );
    rpcCall.mockClear();
    await service.regenerateBoundGuidance(binding);
    expect(rpcCall).toHaveBeenCalledWith(
      'enhancedPrompts:regenerate',
      {
        workspacePath: '/ws',
        tabBinding: binding,
        force: true,
        model: 'tab-model',
      },
      { timeout: 300_000 },
    );
    rpcCall.mockClear();
    await service.regenerateEnhancedPrompts('/ws');
    expect(rpcCall).toHaveBeenCalledWith(
      'enhancedPrompts:regenerate',
      { workspacePath: '/ws', force: true },
      { timeout: 300_000 },
    );
  });

  it('passes the VS Code active tab override model for all bound starts', async () => {
    rpcCall.mockResolvedValue(okResult({ accepted: { runId: 'r' } }));
    const tabs = TestBed.inject(TabManagerService);
    jest.spyOn(tabs, 'findTabByIdAcrossWorkspaces').mockReturnValue({
      workspacePath: null,
      tab: { overrideModel: 'tab-model' },
    } as ReturnType<TabManagerService['findTabByIdAcrossWorkspaces']>);
    jest
      .spyOn(tabs, 'getWorkspaceTabs')
      .mockReturnValue([{ id: 'tab' }] as ReturnType<
        TabManagerService['getWorkspaceTabs']
      >);
    const agentBinding = {
      tabId: 'tab',
      workflow: 'setup-agent-generation' as const,
      workspacePath: '/ws',
    };
    const guidanceBinding = {
      ...agentBinding,
      workflow: 'setup-project-prompt' as const,
    };
    await service.startBoundAgents(agentBinding, ['agent']);
    await service.startBoundGuidance(guidanceBinding);
    await service.regenerateBoundGuidance(guidanceBinding);
    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      'wizard:submit-selection',
      expect.objectContaining({ model: 'tab-model' }),
      expect.any(Object),
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      'enhancedPrompts:runWizard',
      expect.objectContaining({ model: 'tab-model' }),
      expect.any(Object),
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      3,
      'enhancedPrompts:regenerate',
      expect.objectContaining({ model: 'tab-model' }),
      expect.any(Object),
    );
    expect(tabs.getWorkspaceTabs).toHaveBeenCalledWith('/ws');
  });

  describe('launchWizard', () => {
    it('should call setup-wizard:launch RPC method', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.launchWizard();

      expect(rpcCall).toHaveBeenCalledWith('setup-wizard:launch', {});
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('boom'));

      await expect(service.launchWizard()).rejects.toThrow('boom');
    });
  });

  describe('previewGeneration', () => {
    it('sends a tab binding only when provided', async () => {
      rpcCall.mockResolvedValue(okResult({ agents: [] }));
      const binding = { tabId: 'agent-tab', workspacePath: '/workspace', workflow: 'setup-agent-generation' } as const;
      await service.previewGeneration(['a'], undefined, binding);
      expect(rpcCall).toHaveBeenCalledWith('wizard:preview-generation', { selectedAgentIds: ['a'], tabBinding: binding }, { timeout: 10_000 });
    });
    it('calls wizard:preview-generation with selectedAgentIds and returns the preview', async () => {
      const preview = { agents: [] };
      rpcCall.mockResolvedValue(okResult(preview));
      await expect(service.previewGeneration(['a', 'b'])).resolves.toEqual(
        preview,
      );
      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:preview-generation',
        { selectedAgentIds: ['a', 'b'] },
        { timeout: 10_000 },
      );
    });

    it('throws the preview RPC failure reason', async () => {
      rpcCall.mockResolvedValue(errResult('preview denied'));
      await expect(service.previewGeneration(['a'])).rejects.toThrow(
        'preview denied',
      );
    });

    it('sends the chosen target only when one is given', async () => {
      rpcCall.mockResolvedValue(okResult({ agents: [] }));
      await service.previewGeneration(['a'], 'opened-folder');
      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:preview-generation',
        { selectedAgentIds: ['a'], target: 'opened-folder' },
        { timeout: 10_000 },
      );
    });

    it('propagates a rejected preview transport error', async () => {
      rpcCall.mockRejectedValue(new Error('transport down'));
      await expect(service.previewGeneration(['a'])).rejects.toThrow(
        'transport down',
      );
    });
  });

  describe('submitAgentSelection', () => {
    const agents: AgentSelection[] = [
      {
        id: '1',
        name: 'Agent 1',
        selected: true,
        score: 90,
        reason: 'Test',
        autoInclude: false,
      },
    ];

    it('should call wizard:submit-selection with selected agent ids', async () => {
      rpcCall.mockResolvedValue(okResult({ success: true }));

      await service.submitAgentSelection(agents);

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:submit-selection',
        expect.objectContaining({ selectedAgentIds: ['1'] }),
        expect.any(Object),
      );
    });

    it('should resolve with ack payload on success', async () => {
      const ack = { success: true };
      rpcCall.mockResolvedValue(okResult(ack));

      const result = await service.submitAgentSelection(agents);

      expect(result).toEqual(ack);
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('denied'));

      await expect(service.submitAgentSelection(agents)).rejects.toThrow(
        'denied',
      );
    });

    it('sends the preview token, replace decisions and target of a confirmed preview', async () => {
      rpcCall.mockResolvedValue(okResult({ success: true }));

      await service.submitAgentSelection(agents, '/analysis', {
        previewToken: 'tok-1',
        fileDecisions: { '1': { decision: 'replace', revision: 'r1' } },
        target: 'opened-folder',
      });

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:submit-selection',
        {
          selectedAgentIds: ['1'],
          analysisDir: '/analysis',
          model: undefined,
          previewToken: 'tok-1',
          fileDecisions: { '1': { decision: 'replace', revision: 'r1' } },
          target: 'opened-folder',
        },
        { timeout: 300_000 },
      );
    });

    it('sends no decision fields for a submit without a preview', async () => {
      rpcCall.mockResolvedValue(okResult({ success: true }));

      await service.submitAgentSelection(agents, '/analysis');

      const params = rpcCall.mock.calls[0][1];
      expect(params).not.toHaveProperty('previewToken');
      expect(params).not.toHaveProperty('fileDecisions');
      expect(params).not.toHaveProperty('target');
    });

    it('returns a preview-required rejection to the caller', async () => {
      const ack = { success: false, rejection: { reason: 'preview-required' } };
      rpcCall.mockResolvedValue(okResult(ack));

      await expect(service.submitAgentSelection(agents)).resolves.toEqual(ack);
    });
  });

  describe('planPackInstall', () => {
    it('calls wizard:plan-pack-install and returns the plan', async () => {
      const plan = {
        planToken: 'plan-1',
        target: {
          harnessRoot: '/repo',
          openedFolder: '/repo',
          chosen: 'harness-root',
          openedIsHarnessRoot: true,
        },
        files: [],
      };
      rpcCall.mockResolvedValue(okResult(plan));

      await expect(
        service.planPackInstall('src', ['a.md'], 'opened-folder'),
      ).resolves.toEqual(plan);
      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:plan-pack-install',
        { source: 'src', agentFiles: ['a.md'], target: 'opened-folder' },
        { timeout: 60_000 },
      );
    });

    it('omits the target when none is given', async () => {
      rpcCall.mockResolvedValue(
        okResult({ planToken: 't', target: {}, files: [] }),
      );
      await service.planPackInstall('src', ['a.md']);
      expect(rpcCall.mock.calls[0][1]).toEqual({
        source: 'src',
        agentFiles: ['a.md'],
      });
    });

    it('throws the plan failure reason', async () => {
      rpcCall.mockResolvedValue(errResult('download failed'));
      await expect(service.planPackInstall('src', ['a.md'])).rejects.toThrow(
        'download failed',
      );
    });
  });

  describe('installPackAgents', () => {
    it('sends the plan token, decisions and target', async () => {
      rpcCall.mockResolvedValue(
        okResult({ success: true, agentsDownloaded: 1, fromCache: false }),
      );

      await service.installPackAgents('src', ['a.md', 'b.md'], {
        planToken: 'plan-1',
        decisions: { 'a.md': { decision: 'replace', revision: 'r1' } },
        target: 'harness-root',
      });

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:install-pack-agents',
        {
          source: 'src',
          agentFiles: ['a.md', 'b.md'],
          planToken: 'plan-1',
          decisions: { 'a.md': { decision: 'replace', revision: 'r1' } },
          target: 'harness-root',
        },
        { timeout: 60_000 },
      );
    });

    it('sends only source and files without a plan', async () => {
      rpcCall.mockResolvedValue(
        okResult({ success: true, agentsDownloaded: 1, fromCache: false }),
      );
      await service.installPackAgents('src', ['a.md']);
      expect(rpcCall.mock.calls[0][1]).toEqual({
        source: 'src',
        agentFiles: ['a.md'],
      });
    });

    it('turns an RPC failure into an unsuccessful result', async () => {
      rpcCall.mockResolvedValue(errResult('Replacing a file needs a plan'));
      await expect(service.installPackAgents('src', ['a.md'])).resolves.toEqual(
        {
          success: false,
          agentsDownloaded: 0,
          fromCache: false,
          error: 'Replacing a file needs a plan',
        },
      );
    });
  });

  describe('cancelWizard', () => {
    it('should call wizard:cancel with saveProgress=true by default', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.cancelWizard();

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:cancel',
        expect.objectContaining({ saveProgress: true }),
      );
    });

    it('should honor explicit saveProgress=false', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.cancelWizard(false);

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:cancel',
        expect.objectContaining({ saveProgress: false }),
      );
    });

    it('should log warning on RPC failure but not throw', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* silence */
      });
      rpcCall.mockResolvedValue(errResult('timeout'));

      await expect(service.cancelWizard()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('cancelAnalysis', () => {
    it('should call wizard:cancel-analysis RPC method', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.cancelAnalysis();

      expect(rpcCall).toHaveBeenCalledWith('wizard:cancel-analysis', {});
    });

    it('should swallow errors (best-effort cancel)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* silence */
      });
      rpcCall.mockRejectedValue(new Error('offline'));

      await expect(service.cancelAnalysis()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('deepAnalyze', () => {
    it('should call wizard:deep-analyze without a resume flag by default', async () => {
      rpcCall.mockResolvedValue(okResult({ isMultiPhase: true }));

      await service.deepAnalyze();

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:deep-analyze',
        expect.not.objectContaining({ resume: true }),
        expect.any(Object),
      );
    });

    it('should pass resume: true when asked to continue a prior run', async () => {
      rpcCall.mockResolvedValue(okResult({ isMultiPhase: true }));

      await service.deepAnalyze({ resume: true });

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:deep-analyze',
        expect.objectContaining({ resume: true }),
        expect.any(Object),
      );
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('no MCP'));

      await expect(service.deepAnalyze()).rejects.toThrow('no MCP');
    });
  });

  describe('getResumableRun', () => {
    it('should call wizard:get-resumable-run and return the response', async () => {
      const response = { analysis: null, generation: { runId: 'run-1' } };
      rpcCall.mockResolvedValue(okResult(response));

      const result = await service.getResumableRun();

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:get-resumable-run',
        {},
        expect.any(Object),
      );
      expect(result).toEqual(response);
    });

    it('should return an empty response when the RPC fails (best-effort)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* silence */
      });
      rpcCall.mockResolvedValue(errResult('offline'));

      await expect(service.getResumableRun()).resolves.toEqual({
        analysis: null,
        generation: null,
      });
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should swallow a thrown transport error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* silence */
      });
      rpcCall.mockRejectedValue(new Error('transport down'));

      await expect(service.getResumableRun()).resolves.toEqual({
        analysis: null,
        generation: null,
      });

      warnSpy.mockRestore();
    });
  });

  describe('resumeGeneration', () => {
    it('should call wizard:submit-selection with resume and an empty selection', async () => {
      rpcCall.mockResolvedValue(okResult({ success: true }));

      await service.resumeGeneration();

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:submit-selection',
        { selectedAgentIds: [], resume: true },
        expect.any(Object),
      );
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('no checkpoint'));

      await expect(service.resumeGeneration()).rejects.toThrow('no checkpoint');
    });
  });

  it('sends the preview token, replace decisions and target with a bound agent start', async () => {
    rpcCall.mockResolvedValue(okResult({ accepted: { runId: 'r' } }));
    const agentBinding = {
      tabId: 'tab',
      workflow: 'setup-agent-generation' as const,
      workspacePath: '/ws',
    };
    await service.startBoundAgents(agentBinding, ['tester'], false, {
      previewToken: 'token-1',
      fileDecisions: { tester: { decision: 'replace', revision: 'rev-1' } },
      target: 'opened-folder',
    });
    await service.startBoundAgents(agentBinding, ['tester']);
    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      'wizard:submit-selection',
      expect.objectContaining({
        tabBinding: agentBinding,
        selectedAgentIds: ['tester'],
        previewToken: 'token-1',
        fileDecisions: { tester: { decision: 'replace', revision: 'rev-1' } },
        target: 'opened-folder',
      }),
      { timeout: 300_000 },
    );
    const plain = rpcCall.mock.calls[1][1] as Record<string, unknown>;
    expect(plain).not.toHaveProperty('previewToken');
    expect(plain).not.toHaveProperty('fileDecisions');
    expect(plain).not.toHaveProperty('target');
    expect(plain).not.toHaveProperty('resume');
  });

  it('reports an unavailable selected model without exposing host error text', async () => {
    rpcCall.mockResolvedValue(
      errResult(
        'The selected model is unavailable for this provider. private-host-detail',
      ),
    );
    await expect(
      service.startBoundAgents(
        {
          tabId: 'tab',
          workspacePath: '/ws',
          workflow: 'setup-agent-generation',
        },
        ['a'],
      ),
    ).rejects.toThrow('The selected model is not available for this provider.');
  });

  describe('retryGenerationItem', () => {
    it('uses the exact bound run for retry and rejects an unsuccessful result', async () => {
      const tabBinding = {
        tabId: 'tab',
        workspacePath: '/ws',
        workflow: 'setup-agent-generation' as const,
        runId: 'run',
      };
      rpcCall
        .mockResolvedValueOnce(okResult({ success: true }))
        .mockResolvedValueOnce(okResult({ success: false }));
      await service.retryGenerationItem('agent', tabBinding);
      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:retry-item',
        { itemId: 'agent', tabBinding },
        { timeout: 300_000 },
      );
      await expect(
        service.retryGenerationItem('agent', tabBinding),
      ).rejects.toThrow('Failed to retry generation item');
    });
    it('should call wizard:retry-item with the given itemId', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.retryGenerationItem('item-42');

      expect(rpcCall).toHaveBeenCalledWith(
        'wizard:retry-item',
        {
          itemId: 'item-42',
        },
        { timeout: 300_000 },
      );
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('not-found'));

      await expect(service.retryGenerationItem('item-42')).rejects.toThrow(
        'Failed to retry generation item',
      );
    });
  });

  it('sends the tab picker model on bound submit and resume', async () => {
    const tabBinding = {
      tabId: 'tab',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation' as const,
    };
    const tabs = TestBed.inject(TabManagerService);
    jest.spyOn(tabs, 'findTabByIdAcrossWorkspaces').mockReturnValue({
      workspacePath: '/ws',
      tab: { overrideModel: 'opus' },
    } as ReturnType<TabManagerService['findTabByIdAcrossWorkspaces']>);
    rpcCall.mockResolvedValue(okResult({ accepted: { runId: 'run' } }));
    await service.startBoundAgents(tabBinding, ['a']);
    await service.startBoundAgents(tabBinding, [], true);
    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      'wizard:submit-selection',
      expect.objectContaining({ model: 'opus', selectedAgentIds: ['a'] }),
      expect.any(Object),
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      'wizard:submit-selection',
      expect.objectContaining({ model: 'opus', resume: true }),
      expect.any(Object),
    );
  });

  it('looks up and stops a tab-bound run using its exact identity', async () => {
    const binding = {
      tabId: 'tab',
      workspacePath: '/ws',
      workflow: 'setup-agent-generation' as const,
    };
    rpcCall
      .mockResolvedValueOnce(okResult({ run: null }))
      .mockResolvedValueOnce(okResult({ cancelled: true }));
    await expect(service.getBoundRunState(binding, 'run')).resolves.toBeNull();
    expect(rpcCall).toHaveBeenCalledWith(
      'wizard:get-generation-run-state',
      { tabBinding: binding, runId: 'run' },
      expect.anything(),
    );
    await expect(
      service.cancelBoundRun({ ...binding, runId: 'run' }),
    ).resolves.toBe(true);
    expect(rpcCall).toHaveBeenCalledWith(
      'wizard:cancel',
      { tabBinding: { ...binding, runId: 'run' } },
      expect.anything(),
    );
  });
});
