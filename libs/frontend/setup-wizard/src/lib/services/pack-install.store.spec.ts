import { TestBed } from '@angular/core/testing';
import type {
  GenerationTargetInfo,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import { INSTALL_FAILED_FALLBACK } from '../components/pack-install/pack-install-result';
import { PackInstallStore, type PackInstallJob } from './pack-install.store';
import { WizardRpcService } from './wizard-rpc.service';

const target: GenerationTargetInfo = {
  harnessRoot: '/repo',
  openedFolder: '/repo/packages/api',
  chosen: 'opened-folder',
  openedIsHarnessRoot: false,
};

const plan: WizardPlanPackInstallResult = {
  planToken: 'plan-1',
  target,
  files: [
    { file: 'a.md', state: 'new', revision: 'a-r' },
    { file: 'b.md', state: 'new', revision: 'b-r' },
  ],
};

const job: PackInstallJob = {
  request: {
    source: 'community',
    packName: 'Tools',
    files: ['a.md', 'b.md'],
    scope: 'pack',
    target: null,
  },
  plan,
  decisions: {},
};

describe('PackInstallStore', () => {
  let installPackAgents: jest.Mock;
  let store: PackInstallStore;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    installPackAgents = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: WizardRpcService, useValue: { installPackAgents } },
      ],
    });
    store = TestBed.inject(PackInstallStore);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('marks files installing synchronously and settles per-file outcomes', async () => {
    let resolve!: (result: WizardInstallPackAgentsResult) => void;
    installPackAgents.mockReturnValue(
      new Promise<WizardInstallPackAgentsResult>((r) => {
        resolve = r;
      }),
    );
    const running = store.install('sidebar', job);
    expect(store.fileState('sidebar', 'community', 'a.md')).toBe('installing');
    expect(store.isInstalling('sidebar')).toBe(true);
    expect(store.isInstalling('sidebar', 'other')).toBe(false);
    expect(store.isInstalling('wizard')).toBe(false);
    expect(installPackAgents).toHaveBeenCalledWith(
      'community',
      ['a.md', 'b.md'],
      {
        planToken: 'plan-1',
        decisions: {},
        target: 'opened-folder',
      },
    );

    resolve({
      success: true,
      agentsDownloaded: 1,
      fromCache: false,
      files: [
        { file: 'a.md', outcome: 'written' },
        { file: 'b.md', outcome: 'changed-since-preview' },
      ],
    });
    const finished = await running;

    expect(finished.outcomes).toEqual({
      'a.md': 'written',
      'b.md': 'changed-since-preview',
    });
    expect(store.fileState('sidebar', 'community', 'a.md')).toBe('installed');
    expect(store.fileState('sidebar', 'community', 'b.md')).toBe('kept');
    expect(store.isInstalling('sidebar')).toBe(false);
    expect(store.installedCount('sidebar')).toBe(1);
    expect(store.lastTarget('sidebar')).toBe('opened-folder');
    expect(store.targetInfo('sidebar')).toEqual(target);
    expect(store.result('sidebar', 'community')).toBe(finished);
    // Scopes are separate: the wizard saw nothing.
    expect(store.result('wizard', 'community')).toBeNull();
  });

  it.each([
    'token=sk-live-SECRET at https://internal.example/x?key=abc',
    '<img src=x onerror="alert(1)">',
  ])(
    'turns a rejected transport into a terminal failure with safe copy %#',
    async (raw) => {
      installPackAgents.mockRejectedValue(new Error(raw));
      const finished = await store.install('wizard', job);

      expect(finished.primaryFailure).toBe(true);
      expect(finished.failure).toBe(INSTALL_FAILED_FALLBACK);
      expect(store.fileState('wizard', 'community', 'a.md')).toBe('failed');
      expect(store.failure('wizard', 'community', 'b.md')).toBe(
        INSTALL_FAILED_FALLBACK,
      );
      expect(store.isInstalling('wizard')).toBe(false);
      // The raw detail goes to the diagnostic log only.
      expect(warn).toHaveBeenCalledWith(
        '[PackInstallStore] pack install failed',
        { source: 'community', error: raw },
      );
    },
  );

  it('gives a partially failed file the failure copy even when the run succeeded', async () => {
    installPackAgents.mockResolvedValue({
      success: true,
      agentsDownloaded: 1,
      fromCache: false,
      error: '1 file(s) failed to install',
      files: [
        { file: 'a.md', outcome: 'written' },
        { file: 'b.md', outcome: 'failed' },
      ],
    });
    await store.install('wizard', job);
    expect(store.failure('wizard', 'community', 'a.md')).toBe('');
    expect(store.failure('wizard', 'community', 'b.md')).toBe(
      'Some files could not be installed. Retry the failed files.',
    );
  });
});
