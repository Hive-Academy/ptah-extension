import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { CronSchedulerTabComponent } from './cron-scheduler-tab.component';

describe('CronSchedulerTabComponent', () => {
  function configure(isElectron: boolean): CronSchedulerTabComponent {
    const vscodeMock: Partial<VSCodeService> = {
      config: signal({ isElectron }) as VSCodeService['config'],
    };
    const rpcMock: Partial<ClaudeRpcService> = {
      call: jest.fn().mockResolvedValue({
        isSuccess: () => true,
        success: true,
        data: { jobs: [] },
      }) as unknown as ClaudeRpcService['call'],
    };
    const appStateMock: Partial<AppStateManager> = {};
    const modelStateMock: Partial<ModelStateService> = {};

    TestBed.configureTestingModule({
      imports: [CronSchedulerTabComponent],
      providers: [
        { provide: VSCodeService, useValue: vscodeMock },
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: AppStateManager, useValue: appStateMock },
        { provide: ModelStateService, useValue: modelStateMock },
      ],
    });
    const fixture = TestBed.createComponent(CronSchedulerTabComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders without crashing in Electron mode', () => {
    const cmp = configure(true);
    expect(cmp).toBeTruthy();
    expect(cmp.isElectron()).toBe(true);
  });

  it('renders the VS Code placeholder when not on Electron', () => {
    const cmp = configure(false);
    expect(cmp.isElectron()).toBe(false);
  });

  it('describes a known cron expression via the validator', () => {
    const cmp = configure(true);
    expect(cmp.describeExpr('*/5 * * * *')).toBe('Every 5 minutes');
  });
});
