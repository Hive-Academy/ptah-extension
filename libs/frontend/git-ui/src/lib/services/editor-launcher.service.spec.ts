import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { EditorLauncherService } from './editor-launcher.service';
const rpc = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  ...jest.requireActual('@ptah-extension/core'),
  rpcCall: (...args: unknown[]) => rpc(...args),
}));
describe('EditorLauncherService', () => {
  beforeEach(() => {
    rpc.mockReset();
    TestBed.configureTestingModule({
      providers: [
        EditorLauncherService,
        { provide: VSCodeService, useValue: {} },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('single-flights detection and surfaces launch errors', async () => {
    rpc.mockResolvedValueOnce({
      success: true,
      data: { targets: [{ id: 'kiro', displayName: 'Kiro' }] },
    });
    const service = TestBed.inject(EditorLauncherService);
    await Promise.all([service.detect(), service.detect()]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(service.targets()[0].id).toBe('kiro');
    rpc.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'boom' },
    });
    await service.openFile('kiro', '/ws', 'a.ts');
    expect(service.launchStatus()).toEqual({ kind: 'error', message: 'boom' });
  });

  it('opens a blocked viewer path with the external-link policy', async () => {
    rpc.mockResolvedValue({ success: true, data: { success: true } });
    const service = TestBed.inject(EditorLauncherService);
    await service.openLinkedFile({
      target: 'kiro',
      path: 'C:\\outside\\a.ts',
      line: 12,
    });
    expect(rpc).toHaveBeenCalledWith({}, 'editor:openFile', {
      target: 'kiro',
      path: 'C:\\outside\\a.ts',
      line: 12,
      scope: 'external-link',
    });
    expect(service.launchStatus()?.kind).toBe('success');
  });

  describe('openMerge (TASK_2026_576 Batch 54)', () => {
    it('sends editor:openMerge and reports a launch', async () => {
      rpc.mockResolvedValue({ success: true, data: { status: 'ok' } });
      const service = TestBed.inject(EditorLauncherService);

      await expect(
        service.openMerge('vscode', '/ws', 'src/a.ts'),
      ).resolves.toEqual({ status: 'ok' });
      expect(rpc).toHaveBeenCalledWith({}, 'editor:openMerge', {
        target: 'vscode',
        path: 'src/a.ts',
        workspaceRoot: '/ws',
      });
      expect(service.launchStatus()?.kind).toBe('success');
    });

    it('leaves the status alone for unsupported, so the caller can fall back', async () => {
      rpc.mockResolvedValue({ success: true, data: { status: 'unsupported' } });
      const service = TestBed.inject(EditorLauncherService);

      await expect(
        service.openMerge('zed', '/ws', 'src/a.ts'),
      ).resolves.toEqual({ status: 'unsupported' });
      expect(service.launchStatus()).toBeNull();
    });

    it('passes a typed failure through and shows its copy', async () => {
      const failed = {
        status: 'failed',
        reason: 'not-mergeable',
        error: 'Open its folder instead.',
      };
      rpc.mockResolvedValue({ success: true, data: failed });
      const service = TestBed.inject(EditorLauncherService);

      await expect(
        service.openMerge('vscode', '/ws', 'src/a.ts'),
      ).resolves.toEqual(failed);
      expect(service.launchStatus()).toEqual({
        kind: 'error',
        message: 'Open its folder instead.',
      });
    });

    it.each([
      [
        'an RPC failure',
        () => rpc.mockResolvedValue({ success: false, error: 'x' }),
      ],
      [
        'a malformed reply',
        () =>
          rpc.mockResolvedValue({ success: true, data: { status: 'maybe' } }),
      ],
      [
        'an unknown reason',
        () =>
          rpc.mockResolvedValue({
            success: true,
            data: { status: 'failed', reason: 'odd', error: 'e' },
          }),
      ],
      [
        'a thrown transport error',
        () => rpc.mockRejectedValue(new Error('offline')),
      ],
    ])('reads %s as failed', async (_label, arrange) => {
      arrange();
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const service = TestBed.inject(EditorLauncherService);

      const result = await service.openMerge('vscode', '/ws', 'src/a.ts');

      expect(result).toEqual({
        status: 'failed',
        reason: 'failed',
        error: 'The merge view could not be opened.',
      });
      expect(service.launchStatus()?.kind).toBe('error');
      spy.mockRestore();
    });
  });
});
