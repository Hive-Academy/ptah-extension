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

  it('listSuggestions() calls skillSynthesis:listSuggestions and returns the suggestions array', async () => {
    rpcCall.mockResolvedValue(okResult({ suggestions: [{ id: 'sg-1' }] }));

    const result = await service.listSuggestions();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:listSuggestions',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual([{ id: 'sg-1' }]);
  });

  it('acceptSuggestion() calls skillSynthesis:acceptSuggestion with id and returns data', async () => {
    const payload = { accepted: true, filePath: '/skills/sg-1/SKILL.md' };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.acceptSuggestion('sg-1');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:acceptSuggestion',
      { id: 'sg-1' },
      expect.any(Object),
    );
    expect(result).toEqual(payload);
  });

  it('dismissSuggestion() with a reason forwards both id and reason', async () => {
    rpcCall.mockResolvedValue(okResult({ dismissed: true }));

    const result = await service.dismissSuggestion('sg-1', 'not-reusable');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:dismissSuggestion',
      { id: 'sg-1', reason: 'not-reusable' },
      expect.any(Object),
    );
    expect(result).toBe(true);
  });

  it('dismissSuggestion() without a reason forwards id only', async () => {
    rpcCall.mockResolvedValue(okResult({ dismissed: true }));

    await service.dismissSuggestion('sg-1');

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:dismissSuggestion',
      { id: 'sg-1' },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when listSuggestions fails', async () => {
    rpcCall.mockResolvedValue(errResult('store-unavailable'));

    await expect(service.listSuggestions()).rejects.toThrow(
      'store-unavailable',
    );
  });

  it('queue() calls skillSynthesis:queue and returns both halves of the payload', async () => {
    const payload = {
      items: [{ id: 'q-1', stage: 'archaeology' }],
      recentRuns: [{ id: 'run-1', tier: 'nightly' }],
    };
    rpcCall.mockResolvedValue(okResult(payload));

    const result = await service.queue();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:queue',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toEqual(payload);
  });

  it('queue() forwards only the limits it was given', async () => {
    rpcCall.mockResolvedValue(okResult({ items: [], recentRuns: [] }));

    await service.queue({ runLimit: 5 });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:queue',
      { runLimit: 5 },
      expect.any(Object),
    );
  });

  it('queue() forwards both limits when both are given', async () => {
    rpcCall.mockResolvedValue(okResult({ items: [], recentRuns: [] }));

    await service.queue({ limit: 50, runLimit: 10 });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:queue',
      { limit: 50, runLimit: 10 },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when queue fails', async () => {
    rpcCall.mockResolvedValue(errResult('queue-store-unavailable'));

    await expect(service.queue()).rejects.toThrow('queue-store-unavailable');
  });

  // ── The weekly digest, and the flag that decides whether it spends ────────

  it('digest() sends an EMPTY payload when nothing was asked for', async () => {
    // B4.8. `allowRewrite` is omitted rather than sent as `false`, because this
    // wrapper must not manufacture a value the caller did not choose — the
    // backend's `runDigest` is where an omitted flag becomes `false`, and that
    // is the one place it should happen. The state service, which is what the
    // UI actually calls, resolves the flag explicitly before it gets here.
    rpcCall.mockResolvedValue(okResult({ items: [] }));

    await service.digest();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:digest',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it.each([true, false] as const)(
    'digest() forwards an explicit allowRewrite:%s',
    async (allowRewrite: boolean) => {
      rpcCall.mockResolvedValue(okResult({ items: [] }));

      await service.digest({ allowRewrite });

      expect(rpcCall).toHaveBeenCalledWith(
        'skillSynthesis:digest',
        { allowRewrite },
        expect.any(Object),
      );
    },
  );

  it('digest() keeps an explicit empty workspaceRoot distinct from omitting it', async () => {
    rpcCall.mockResolvedValue(okResult({ items: [] }));

    await service.digest({ workspaceRoot: '', allowRewrite: false });

    // `''` is the cross-project feed; `??`, not `||`, on this path.
    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:digest',
      { workspaceRoot: '', allowRewrite: false },
      expect.any(Object),
    );
  });

  it('throws with the RPC error string when digest fails', async () => {
    rpcCall.mockResolvedValue(errResult('digest-sweep-failed'));

    await expect(service.digest()).rejects.toThrow('digest-sweep-failed');
  });

  // ── Lanes + model catalogue (TASK_2026_180 B1.10.3) ───────────────────────

  it('getLanes() calls skillSynthesis:getLanes and unwraps the lanes map', async () => {
    const lanes = { archaeologist: { id: 'archaeologist' } };
    rpcCall.mockResolvedValue(okResult({ lanes }));

    const result = await service.getLanes();

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:getLanes',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toBe(lanes);
  });

  it('throws with the RPC error string when getLanes fails', async () => {
    rpcCall.mockResolvedValue(errResult('lanes-unreadable'));

    await expect(service.getLanes()).rejects.toThrow('lanes-unreadable');
  });

  it('setLanes() forwards the sparse patch untouched under a `lanes` key', async () => {
    rpcCall.mockResolvedValue(okResult({ lanes: {} }));

    await service.setLanes({ judge: { model: 'some-model-id' } });

    expect(rpcCall).toHaveBeenCalledWith(
      'skillSynthesis:setLanes',
      { lanes: { judge: { model: 'some-model-id' } } },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('setLanes() sends only the touched lane, leaving the other three absent', async () => {
    rpcCall.mockResolvedValue(okResult({ lanes: {} }));

    await service.setLanes({ synthesis: { provider: '' } });

    const payload = rpcCall.mock.calls[0][1] as {
      lanes: Record<string, unknown>;
    };
    expect(Object.keys(payload.lanes)).toEqual(['synthesis']);
  });

  it('throws with the RPC error string when setLanes fails', async () => {
    rpcCall.mockResolvedValue(errResult('lane-write-rejected'));

    await expect(service.setLanes({ replay: {} })).rejects.toThrow(
      'lane-write-rejected',
    );
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

  it('throws with the RPC error string when listModels fails', async () => {
    rpcCall.mockResolvedValue(errResult('no-provider-configured'));

    await expect(service.listModels()).rejects.toThrow(
      'no-provider-configured',
    );
  });
});
