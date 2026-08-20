import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SkillDiagnosticsRpcService } from './skill-diagnostics-rpc.service';

describe('SkillDiagnosticsRpcService', () => {
  let service: SkillDiagnosticsRpcService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        SkillDiagnosticsRpcService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    service = TestBed.inject(SkillDiagnosticsRpcService);
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

  it('diagnostics() calls skillSynthesis:diagnostics with empty params by default', async () => {
    const payload = {
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
      totalCandidates: 0,
      totalPromoted: 0,
      totalRejected: 0,
      totalInvocations: 0,
      activeSkills: 0,
      eligibilityHistogram: {
        prefilterTooThin: 0,
        prefilterRejected: 0,
        accepted: 0,
      },
      recentEvents: [],
      triggers: { sessionEnd: true, idleMs: 600_000, bootScan: true },
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.diagnostics();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:diagnostics',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('analyzeNow() forwards sessionId + workspaceRoot + force', async () => {
    const payload = {
      success: true,
      startedAt: 1,
      completedAt: 2,
      candidateId: 'cand-1',
      reason: null,
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.analyzeNow({
      sessionId: 'sess-1',
      workspaceRoot: '/ws',
      force: true,
    });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:analyzeNow',
      { sessionId: 'sess-1', workspaceRoot: '/ws', force: true },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('setTriggers() wraps the partial dto', async () => {
    const triggers = { sessionEnd: true, idleMs: 600_000, bootScan: false };
    rpcCall.mockResolvedValue(okResult({ triggers }));

    const result = await service.setTriggers({ bootScan: false });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:setTriggers',
      { triggers: { bootScan: false } },
      expect.any(Object),
    );
    expect(result.triggers).toEqual(triggers);
  });

  it('getTriggers() returns the triggers dto on success', async () => {
    const triggers = { sessionEnd: true, idleMs: 600_000, bootScan: true };
    rpcCall.mockResolvedValue(okResult({ triggers }));

    const result = await service.getTriggers();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:getTriggers',
      {},
      expect.any(Object),
    );
    expect(result.triggers).toEqual(triggers);
  });

  it('throws when diagnostics() returns failure', async () => {
    rpcCall.mockResolvedValue(errResult('boom'));
    await expect(service.diagnostics()).rejects.toThrow('boom');
  });

  it('throws when analyzeNow() returns failure with default message', async () => {
    rpcCall.mockResolvedValue({ isSuccess: () => false });
    await expect(
      service.analyzeNow({ sessionId: 's', workspaceRoot: '/w' }),
    ).rejects.toThrow('skillSynthesis:analyzeNow failed');
  });
});
