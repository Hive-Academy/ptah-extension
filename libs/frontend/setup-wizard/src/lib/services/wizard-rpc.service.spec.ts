import { TestBed } from '@angular/core/testing';
import { WizardRpcService } from './wizard-rpc.service';
import { ClaudeRpcService, ModelStateService } from '@ptah-extension/core';
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

  describe('retryGenerationItem', () => {
    it('should call wizard:retry-item with the given itemId', async () => {
      rpcCall.mockResolvedValue(okResult());

      await service.retryGenerationItem('item-42');

      expect(rpcCall).toHaveBeenCalledWith('wizard:retry-item', {
        itemId: 'item-42',
      });
    });

    it('should throw when RPC fails', async () => {
      rpcCall.mockResolvedValue(errResult('not-found'));

      await expect(service.retryGenerationItem('item-42')).rejects.toThrow(
        'not-found',
      );
    });
  });
});
