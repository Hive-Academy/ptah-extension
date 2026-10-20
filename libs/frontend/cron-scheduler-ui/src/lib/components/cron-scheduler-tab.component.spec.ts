import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { CronSchedulerTabComponent } from './cron-scheduler-tab.component';

describe('CronSchedulerTabComponent', () => {
  function configure(
    isElectron: boolean,
  ): ComponentFixture<CronSchedulerTabComponent> {
    const vscodeMock: Partial<VSCodeService> = {
      config: signal({ isElectron }) as unknown as VSCodeService['config'],
    };
    const rpcMock: Partial<ClaudeRpcService> = {
      call: jest.fn().mockResolvedValue({
        isSuccess: () => true,
        success: true,
        data: { jobs: [] },
      }) as unknown as ClaudeRpcService['call'],
    };
    const appStateMock: Partial<AppStateManager> = {
      // CronStateService reads workspaceInfo() at construction (baseline
      // capture) and inside its switch effect — provide the signal the real
      // AppStateManager exposes so the store instantiates.
      workspaceInfo: signal(null) as AppStateManager['workspaceInfo'],
    };
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
    return fixture;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders without crashing in Electron mode', () => {
    const cmp = configure(true).componentInstance;
    expect(cmp).toBeTruthy();
    expect(cmp.isElectron()).toBe(true);
  });

  it('renders the VS Code placeholder when not on Electron', () => {
    const cmp = configure(false).componentInstance;
    expect(cmp.isElectron()).toBe(false);
  });

  it('describes a known cron expression via the validator', () => {
    const cmp = configure(true).componentInstance;
    expect(cmp.describeExpr('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('uses a container-sized grid for cron statistics', () => {
    const fixture = configure(true);
    const grid = fixture.nativeElement.querySelector(
      '[aria-label="Cron statistics"]',
    ) as HTMLElement;

    expect(grid.classList.contains('grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]')).toBe(true);
    expect(grid.className).not.toContain('xl:grid-cols-');
    expect(grid.children).toHaveLength(4);
  });
});
