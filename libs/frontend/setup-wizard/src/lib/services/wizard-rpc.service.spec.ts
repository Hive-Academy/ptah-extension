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
    jest.spyOn(tabs, 'getWorkspaceTabs').mockReturnValue([
      { id: 'tab' },
    ] as ReturnType<TabManagerService['getWorkspaceTabs']>);
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
