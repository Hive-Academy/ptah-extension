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
});
