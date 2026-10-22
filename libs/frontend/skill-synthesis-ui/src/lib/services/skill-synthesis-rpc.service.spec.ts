/**
 * SkillSynthesisRpcService — RPC roundtrip tests.
 *
 * Stubs `ClaudeRpcService.call` so each method is exercised against the
 * actual `skillSynthesis:*` RPC names without standing up the message bus.
 * Locks: method name, payload shape, success-data unwrap, error throw.
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SkillSynthesisRpcService,
  SkillsPausedError,
} from './skill-synthesis-rpc.service';

describe('SkillSynthesisRpcService', () => {
  let service: SkillSynthesisRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        SkillSynthesisRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(SkillSynthesisRpcService);
  });

  const okResult = <T>(data: T) => ({
    success: true,
    isSuccess: () => true,
    data,
  });
  const errResult = (error: string) => ({
    success: false,
    isSuccess: () => false,
    error,
  });

  it('listModels() calls the GENERIC provider:listModels with no provider id', async () => {
    const payload = { models: [], totalCount: 0, isStatic: true };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.listModels();

    expect(rpcCall).toHaveBeenCalledWith(
      'provider:listModels',
      { toolUseOnly: false },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toBe(payload);
  });

  it('listModels(providerId) forwards the id it was handed', async () => {
    rpcCall.mockResolvedValue(okResult({ models: [], totalCount: 0 }));

    await service.listModels('some-registry-id');

    expect(rpcCall).toHaveBeenCalledWith(
      'provider:listModels',
      { toolUseOnly: false, providerId: 'some-registry-id' },
      expect.any(Object),
    );
  });

  it('listModels("") omits providerId rather than sending an empty string', async () => {
    rpcCall.mockResolvedValue(okResult({ models: [], totalCount: 0 }));

    // `''` is the picker's "inherit" sentinel, not a provider id. Forwarding it
    // would ask the backend to resolve a provider named the empty string.
    await service.listModels('');

    expect(rpcCall).toHaveBeenCalledWith(
      'provider:listModels',
      { toolUseOnly: false },
      expect.any(Object),
    );
  });

  it('listQuarantinedAgents() calls skillSynthesis:listQuarantinedAgents with {} and returns the listing untouched', async () => {
    const listing = {
      workspaceRoot: '/ws',
      agentSync: 'disabled',
      recordUnreadable: true,
      quarantined: [
        {
          slug: 'reviewer',
          state: 'quarantined',
          quarantinedAt: null,
          hasSnapshot: true,
          sourcePath: '/ws/.claude/agents/reviewer.md',
        },
      ],
      notOwned: ['planner'],
    };
    rpcCall.mockResolvedValue(okResult(listing));

    const result = await service.listQuarantinedAgents();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:listQuarantinedAgents',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toBe(listing);
  });

  it('listQuarantinedAgents() keeps the no-folder answer (workspaceRoot: null) distinct from an empty quarantine', async () => {
    rpcCall.mockResolvedValue(
      okResult({
        workspaceRoot: null,
        agentSync: 'unknown',
        quarantined: [],
        notOwned: [],
      }),
    );

    const result = await service.listQuarantinedAgents();

    expect(result.workspaceRoot).toBeNull();
  });

  it('listQuarantinedAgents() throws the RPC error rather than returning an empty listing', async () => {
    rpcCall.mockResolvedValue({
      ...errResult('Quarantine record could not be read'),
      errorCode: 'PERSISTENCE_UNAVAILABLE',
    });

    await expect(service.listQuarantinedAgents()).rejects.toThrow(
      'Quarantine record could not be read',
    );
  });

  it('getAgentOutcomeSignals() calls agent:outcomeSignals and returns the result', async () => {
    const payload = {
      signals: {
        planner: {
          slug: 'planner',
          windowDays: 30,
          runCount: 5,
          delivered: { numerator: 4, denominator: 5 },
          reviewPass: { numerator: 3, denominator: 4 },
          avgReviseRounds: 1.5,
          topFailureClass: 'timeout' as const,
        },
      },
      windowDays: 30,
      persistent: true,
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.getAgentOutcomeSignals([
      'planner',
      'reviewer',
    ]);

    expect(rpcCall).toHaveBeenCalledWith(
      'agent:outcomeSignals',
      { slugs: ['planner', 'reviewer'] },
      expect.objectContaining({ timeout: 10_000 }),
    );
    expect(result).toEqual(payload);
  });

  it('getAgentOutcomeSignals() throws the RPC error instead of an empty map', async () => {
    rpcCall.mockResolvedValue(errResult('store down'));

    await expect(service.getAgentOutcomeSignals(['planner'])).rejects.toThrow(
      'store down',
    );
  });

  describe('PAUSED refusals from the manual runs', () => {
    const paused = {
      ...errResult('Skill synthesis is paused'),
      errorCode: 'PAUSED',
    };

    it.each([
      [
        'previewEnhancement',
        (s: SkillSynthesisRpcService) => s.previewEnhancement('skill', 'x'),
      ],
    ])('%s() throws SkillsPausedError', async (_name, run) => {
      rpcCall.mockResolvedValue(paused);

      const call = run(service);
      await expect(call).rejects.toBeInstanceOf(SkillsPausedError);
      await expect(call).rejects.toThrow('Skill synthesis is paused');
    });

    it('keeps any other failure a plain Error', async () => {
      rpcCall.mockResolvedValue(errResult('model down'));

      const call = service.previewEnhancement('skill', 'x');
      await expect(call).rejects.not.toBeInstanceOf(SkillsPausedError);
      await expect(call).rejects.toThrow('model down');
    });
  });

  it('restoreQuarantinedAgent(slug) sends exactly { slug } and returns every outcome as data', async () => {
    const outcome = {
      outcome: 'conflict',
      path: '/ws/.claude/agents/reviewer.md',
      reason: 'a different file already exists',
      agentSync: 'enabled',
    };
    rpcCall.mockResolvedValue(okResult(outcome));

    const result = await service.restoreQuarantinedAgent('reviewer');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:restoreQuarantinedAgent',
      { slug: 'reviewer' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toBe(outcome);
  });

  it('restoreQuarantinedAgent() throws on INVALID_PARAMS (no open folder) instead of reporting success', async () => {
    rpcCall.mockResolvedValue({
      ...errResult('Open a workspace folder to restore a quarantined agent.'),
      errorCode: 'INVALID_PARAMS',
    });

    await expect(service.restoreQuarantinedAgent('reviewer')).rejects.toThrow(
      'Open a workspace folder to restore a quarantined agent.',
    );
  });

  it('restoreQuarantinedAgent() falls back to its own message when the error carries no text', async () => {
    rpcCall.mockResolvedValue({
      success: false,
      isSuccess: () => false,
      errorCode: 'PERSISTENCE_UNAVAILABLE',
    });

    await expect(service.restoreQuarantinedAgent('reviewer')).rejects.toThrow(
      'Failed to restore quarantined agent',
    );
  });

  it('getAgentModels() sends {} and returns the result untouched', async () => {
    const payload = { workspaceRoot: '/ws', machine: null, workspace: null };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.getAgentModels();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:getAgentModels',
      {},
      { timeout: 20_000 },
    );
    expect(result).toBe(payload);
  });

  it('accepts a model list that arrives after ten seconds', async () => {
    jest.useFakeTimers();
    try {
      const payload = { workspaceRoot: '/ws', machine: null, workspace: null };
      rpcCall.mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve(okResult(payload)), 15_500);
      }));
      const pending = service.getAgentModels();
      await jest.advanceTimersByTimeAsync(15_500);
      await expect(pending).resolves.toBe(payload);
      expect(rpcCall).toHaveBeenCalledWith(
        'skillSynthesis:getAgentModels', {}, { timeout: 20_000 },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes a draft source hash to the explicit clone save', async () => {
    const payload = { kind: 'agent', slug: 'reviewer', historyTs: 'saved' };
    rpcCall.mockResolvedValue(okResult(payload));
    await expect(service.saveCloneBody('agent', 'reviewer', 'new body', 'sha256:abc'))
      .resolves.toBe(payload);
    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:saveCloneBody',
      { kind: 'agent', slug: 'reviewer', body: 'new body', expectedSourceHash: 'sha256:abc' },
      { timeout: 20_000 },
    );
  });

  it('passes enhancement origin only for an explicit enhancement save', async () => {
    rpcCall.mockResolvedValue(okResult({ kind: 'skill', slug: 'draft', historyTs: 'saved' }));
    await service.saveCloneBody('skill', 'draft', '# enhanced', undefined, 'enhancement');
    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:saveCloneBody',
      { kind: 'skill', slug: 'draft', body: '# enhanced', origin: 'enhancement' },
      { timeout: 20_000 },
    );
  });

  it('getAgentModels() throws the RPC error', async () => {
    rpcCall.mockResolvedValue(errResult('no agent model settings'));

    await expect(service.getAgentModels()).rejects.toThrow(
      'no agent model settings',
    );
  });

  it('setAgentModel() sends the params verbatim and wraps the result', async () => {
    const data = { classification: 'listed', machine: null, workspace: {} };
    rpcCall.mockResolvedValue(okResult(data));
    const params = {
      workspaceRoot: '/ws',
      slug: 'reviewer',
      provider: 'codex' as const,
      scope: 'workspace' as const,
      value: 'o3',
      confirmUnlisted: true,
    };

    const outcome = await service.setAgentModel(params);

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:setAgentModel',
      params,
      { timeout: 20_000 },
    );
    expect(outcome).toEqual({ ok: true, result: data });
  });

  it('setAgentModel() returns a refusal with its code instead of throwing', async () => {
    rpcCall.mockResolvedValue({
      ...errResult('needs confirmation'),
      errorCode: 'MODEL_NOT_AVAILABLE',
    });

    const outcome = await service.setAgentModel({
      workspaceRoot: '/ws',
      slug: 'reviewer',
      provider: 'codex',
      scope: 'workspace',
      value: 'gpt-6',
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'MODEL_NOT_AVAILABLE',
      message: 'needs confirmation',
    });
  });

  it('setAgentModel() reports a code-less failure with code null and its own message', async () => {
    rpcCall.mockResolvedValue({ success: false, isSuccess: () => false });

    const outcome = await service.setAgentModel({
      workspaceRoot: '/ws',
      slug: '*',
      provider: 'opencode',
      scope: 'machine',
      value: null,
    });

    expect(outcome).toEqual({
      ok: false,
      code: null,
      message: 'Failed to save the agent model',
    });
  });

  it('listCliModels() and getAgentLaneConfig() call the agent methods with no params', async () => {
    rpcCall.mockResolvedValue(okResult({ codex: [] }));
    await service.listCliModels();
    expect(rpcCall).toHaveBeenLastCalledWith(
      'agent:listCliModels',
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );

    rpcCall.mockResolvedValue(okResult({ codexModel: '' }));
    await service.getAgentLaneConfig();
    expect(rpcCall).toHaveBeenLastCalledWith(
      'agent:getConfig',
      undefined,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('throws with the RPC error string when listModels fails', async () => {
    rpcCall.mockResolvedValue(errResult('no-provider-configured'));

    await expect(service.listModels()).rejects.toThrow(
      'no-provider-configured',
    );
  });
});
