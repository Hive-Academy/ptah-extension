/**
 * SkillSynthesisRpcService — RPC roundtrip tests.
 *
 * Stubs `ClaudeRpcService.call` so each method is exercised against the
 * actual `skillSynthesis:*` RPC names without standing up the message bus.
 * Locks: method name, payload shape, success-data unwrap, error throw.
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

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

  it('listCandidates() calls skillSynthesis:listCandidates and returns the candidates array', async () => {
    rpcCall.mockResolvedValue(okResult({ candidates: [{ id: 'c-1' }] }));

    const result = await service.listCandidates({ status: 'pending' });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:listCandidates',
      { status: 'pending' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual([{ id: 'c-1' }]);
  });

  it('promote() calls skillSynthesis:promote with id and returns data', async () => {
    const payload = { promoted: true, skillId: 's-1' };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.promote('c-1');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:promote',
      { id: 'c-1' },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('reject() with a reason forwards both id and reason', async () => {
    rpcCall.mockResolvedValue(okResult({ rejected: true }));

    const result = await service.reject('c-1', 'too-shallow');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:reject',
      { id: 'c-1', reason: 'too-shallow' },
      expect.any(Object),
    );
    expect(result).toBe(true);
  });

  it('invocations() forwards the optional limit', async () => {
    rpcCall.mockResolvedValue(okResult({ invocations: [] }));

    await service.invocations('s-1', 25);

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:invocations',
      { skillId: 's-1', limit: 25 },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when promote fails', async () => {
    rpcCall.mockResolvedValue(errResult('write-failed'));

    await expect(service.promote('c-1')).rejects.toThrow('write-failed');
  });
});
