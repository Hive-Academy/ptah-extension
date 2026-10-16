import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { HarnessRpcService } from './harness-rpc.service';

describe('HarnessRpcService workspace targeting', () => {
  const originalRoot = '\\\\wsl.localhost\\Ubuntu\\home\\User\\Proj';
  const call = jest.fn().mockResolvedValue({
    isSuccess: () => true,
    data: { workspaceRoot: originalRoot, proposal: null },
  });

  beforeEach(() => {
    call.mockClear();
    TestBed.configureTestingModule({
      providers: [
        HarnessRpcService,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
  });

  it('sends the pinned root for initialization and proposal reads', async () => {
    const rpc = TestBed.inject(HarnessRpcService);
    await rpc.initialize(originalRoot);
    await rpc.getProposal('session-a', originalRoot);
    expect(call).toHaveBeenNthCalledWith(1, 'harness:initialize', {
      workspaceRoot: originalRoot,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'harness:get-proposal', {
      sessionId: 'session-a',
      workspaceRoot: originalRoot,
    });
  });

  it('keeps optional RPC roots absent for callers without one', async () => {
    const rpc = TestBed.inject(HarnessRpcService);
    await rpc.initialize();
    await rpc.getProposal('session-a');
    expect(call).toHaveBeenNthCalledWith(1, 'harness:initialize', {});
    expect(call).toHaveBeenNthCalledWith(2, 'harness:get-proposal', {
      sessionId: 'session-a',
    });
  });
});
