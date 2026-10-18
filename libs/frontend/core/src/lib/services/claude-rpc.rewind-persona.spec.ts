import { TestBed } from '@angular/core/testing';
import { SessionId } from '@ptah-extension/shared';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

describe('ClaudeRpcService rewind persona', () => {
  let service: ClaudeRpcService;
  let call: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ClaudeRpcService, { provide: VSCodeService, useValue: {} }],
    });
    service = TestBed.inject(ClaudeRpcService);
    call = jest.spyOn(service, 'call').mockResolvedValue(new RpcResult(false));
  });

  it('omits the systemPrompt key for an unmarked rewind', async () => {
    await service.rewindFiles(SessionId.create(), 'message', true);
    expect(call.mock.calls[0]?.[0]).toBe('session:rewindFiles');
    expect(call.mock.calls[0]?.[1]).not.toHaveProperty('systemPrompt');
    expect(call.mock.calls[0]?.[2]).toEqual({ timeout: 15000 });
  });

  it('forwards the persona on dry run and commit', async () => {
    const sessionId = SessionId.create();
    await service.rewindFiles(sessionId, 'message', true, undefined, 'persona');
    await service.rewindFiles(
      sessionId,
      'message',
      false,
      undefined,
      'persona',
    );
    expect(call).toHaveBeenNthCalledWith(
      1,
      'session:rewindFiles',
      expect.objectContaining({ systemPrompt: 'persona', dryRun: true }),
      { timeout: 15000 },
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      'session:rewindFiles',
      expect.objectContaining({ systemPrompt: 'persona', dryRun: false }),
      { timeout: 60000 },
    );
  });
});
