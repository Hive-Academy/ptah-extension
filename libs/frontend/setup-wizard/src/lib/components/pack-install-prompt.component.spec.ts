import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '@ptah-extension/core';
import type {
  GenerationTargetInfo,
  PackFilePlan,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import { PackInstallStore } from '../services/pack-install.store';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { PackInstallPromptComponent } from './pack-install-prompt.component';
import {
  INSTALL_FAILED_FALLBACK,
  type PackInstallRequest,
} from './pack-install/pack-install-result';

const target: GenerationTargetInfo = {
  harnessRoot: 'D:/work/acme',
  openedFolder: 'D:/work/acme/packages/api',
  chosen: 'harness-root',
  openedIsHarnessRoot: false,
};

function plan(
  files: PackFilePlan[],
  info: GenerationTargetInfo = target,
  planToken = 'plan-1',
): WizardPlanPackInstallResult {
  return { planToken, target: info, files };
}

const fresh = (file: string): PackFilePlan => ({
  file,
  state: 'new',
  revision: `${file}-new`,
  incomingText: 'model: opus',
});
const differs = (file: string, revision = `${file}-rev`): PackFilePlan => ({
  file,
  state: 'differs',
  revision,
  localText: 'model: sonnet',
  incomingText: 'model: opus',
});
const unreadable = (file: string): PackFilePlan => ({
  file,
  state: 'unreadable',
  revision: `${file}-unreadable`,
});
const identical = (file: string): PackFilePlan => ({
  file,
  state: 'identical',
  revision: `${file}-same`,
  localText: 'model: opus',
  incomingText: 'model: opus',
});

const packRequest = (files: string[]): PackInstallRequest => ({
  source: 'https://example.com/acme.json',
  packName: 'acme-agents',
  files,
  scope: 'pack',
  target: null,
});

// jsdom lacks the native dialog methods; keep the open attribute like the NativeModal specs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('PackInstallPromptComponent', () => {
  let fixture: ComponentFixture<PackInstallPromptComponent>;
  let planPackInstall: jest.Mock;
  let installPackAgents: jest.Mock;
  let store: PackInstallStore;
  let dismissals: number;
  const SOURCE = 'https://example.com/acme.json';
  const finished = () => store.result('wizard', SOURCE);

  beforeEach(() => {
    planPackInstall = jest.fn();
    installPackAgents = jest.fn().mockResolvedValue({
      success: true,
      agentsDownloaded: 1,
      fromCache: false,
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
        {
          provide: WizardRpcService,
          useValue: { planPackInstall, installPackAgents },
        },
      ],
    });
    fixture = TestBed.createComponent(PackInstallPromptComponent);
    fixture.componentRef.setInput('scope', 'wizard');
    store = TestBed.inject(PackInstallStore);
    dismissals = 0;
    fixture.componentInstance.dismissed.subscribe(() => dismissals++);
    fixture.detectChanges();
  });

  async function open(request: PackInstallRequest): Promise<void> {
    fixture.componentRef.setInput('request', request);
    fixture.detectChanges();
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const dialog = (): HTMLDialogElement =>
    fixture.nativeElement.querySelector('dialog');
  const query = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null => fixture.nativeElement.querySelector(selector);
  const queryAll = <T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T[] => Array.from(fixture.nativeElement.querySelectorAll(selector));
  const confirm = (): HTMLButtonElement =>
    query<HTMLButtonElement>(
      '[data-testid="pack-confirm"]',
    ) as HTMLButtonElement;
  const replaceOf = (file: string): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>('[data-testid="replace-segment"]').find(
      (button) => button.getAttribute('aria-label')?.includes(file),
    );

  it('stays closed without a request', () => {
    expect(dialog()).toBeNull();
    expect(planPackInstall).not.toHaveBeenCalled();
  });

  it('opens the whole-pack prompt with the target even when no file differs', async () => {
    planPackInstall.mockResolvedValue(plan([fresh('a.md'), fresh('b.md')]));
    await open(packRequest(['a.md', 'b.md']));

    expect(planPackInstall).toHaveBeenCalledWith(
      'https://example.com/acme.json',
      ['a.md', 'b.md'],
      undefined,
    );
    expect(dialog().open).toBe(true);
    expect(query('h3')?.textContent?.trim()).toBe(
      'Install community pack "acme-agents"?',
    );
    expect(query('[data-testid="pack-scope"]')?.textContent).toContain(
      'Scope: all 2 pack files that are not installed yet.',
    );
    expect(query('[data-testid="target-radiogroup"]')).not.toBeNull();
    expect(query('[data-testid="pack-no-conflict"]')?.textContent?.trim()).toBe(
      'No file differs. All 2 pack files are new and install into the folder above.',
    );
    expect(query('[data-testid="file-decision-row"]')).toBeNull();
    expect(confirm().textContent?.trim()).toBe('Install pack');
  });

  it('scopes the prompt to one file for per-file Install and Retry', async () => {
    planPackInstall.mockResolvedValue(plan([differs('perf-tuner.md')]));
    await open({ ...packRequest(['perf-tuner.md']), scope: 'file' });

    expect(query('h3')?.textContent?.trim()).toBe(
      'Install perf-tuner.md from "acme-agents"?',
    );
    expect(query('[data-testid="pack-scope"]')?.textContent).toContain(
      'Scope: this one file only.',
    );
    expect(query('[data-testid="pack-conflicts"]')?.textContent).toContain(
      'This file exists in this folder and differs from the pack version.',
    );
    expect(query('[data-testid="bulk-decision-bar"]')).toBeNull();
    expect(queryAll('[data-testid="file-decision-row"]').length).toBe(1);
  });

  it('lists conflicts on Keep, forces Keep for an unreadable file and installs with the plan', async () => {
    planPackInstall.mockResolvedValue(
      plan([
        differs('perf-tuner.md', 'rev-1'),
        unreadable('locked.md'),
        fresh('ops-runner.md'),
        identical('api-designer.md'),
      ]),
    );
    const files = [
      'perf-tuner.md',
      'locked.md',
      'ops-runner.md',
      'api-designer.md',
    ];
    await open(packRequest(files));

    expect(query('[data-testid="pack-conflicts"]')?.textContent?.trim()).toBe(
      '2 existing files differ from the pack version in this folder.',
    );
    expect(dialog().textContent).toContain(
      '1 other file is new and installs without a question. 1 other file is already current.',
    );
    expect(queryAll('[data-testid="file-decision-row"]').length).toBe(2);
    for (const keep of queryAll('[data-testid="keep-segment"]')) {
      expect(keep.getAttribute('aria-checked')).toBe('true');
    }
    const locked = replaceOf('locked.md');
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
    locked?.click();
    replaceOf('perf-tuner.md')?.click();
    fixture.detectChanges();

    expect(confirm().textContent?.trim()).toBe('Install pack, replace 1 file');
    expect(query('[data-testid="decision-summary"]')?.textContent).toBe(
      '1 kept, 1 to replace',
    );
    confirm().click();
    // The store marks the files installing at once; the prompt closes.
    expect(dismissals).toBe(1);
    for (const file of files) {
      expect(store.fileState('wizard', SOURCE, file)).toBe('installing');
    }
    await settle();

    expect(installPackAgents).toHaveBeenCalledWith(
      'https://example.com/acme.json',
      files,
      {
        planToken: 'plan-1',
        decisions: {
          'perf-tuner.md': { decision: 'replace', revision: 'rev-1' },
        },
        target: 'harness-root',
      },
    );
    expect(finished()?.target).toEqual(target);
    expect(store.lastTarget('wizard')).toBe('harness-root');
  });

  it('applies Replace all and Keep all across many rows and skips every unreadable row (D13)', async () => {
    planPackInstall.mockResolvedValue(
      plan([
        differs('a.md', 'ra'),
        unreadable('b.md'),
        differs('c.md', 'rc'),
        unreadable('d.md'),
        differs('e.md', 're'),
      ]),
    );
    const files = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
    await open(packRequest(files));

    expect(query('[data-testid="bulk-decision-bar"]')?.textContent).toContain(
      '3 files can be replaced',
    );
    query<HTMLButtonElement>('[data-testid="bulk-replace"]')?.click();
    fixture.detectChanges();
    expect(confirm().textContent?.trim()).toBe('Install pack, replace 3 files');
    for (const file of ['b.md', 'd.md']) {
      expect(replaceOf(file)?.getAttribute('aria-checked')).toBe('false');
    }

    query<HTMLButtonElement>('[data-testid="bulk-keep"]')?.click();
    fixture.detectChanges();
    expect(confirm().textContent?.trim()).toBe('Install pack');

    query<HTMLButtonElement>('[data-testid="bulk-replace"]')?.click();
    fixture.detectChanges();
    confirm().click();
    await settle();

    const decisions = installPackAgents.mock.calls[0][2].decisions;
    expect(decisions).toEqual({
      'a.md': { decision: 'replace', revision: 'ra' },
      'c.md': { decision: 'replace', revision: 'rc' },
      'e.md': { decision: 'replace', revision: 're' },
    });
    expect(decisions).not.toHaveProperty('b.md');
    expect(decisions).not.toHaveProperty('d.md');
  });

  it('re-plans for another target and resets every choice to Keep', async () => {
    planPackInstall.mockResolvedValueOnce(plan([differs('a.md', 'r1')]));
    await open(packRequest(['a.md']));
    replaceOf('a.md')?.click();
    fixture.detectChanges();
    expect(confirm().textContent?.trim()).toBe('Install pack, replace 1 file');

    planPackInstall.mockResolvedValueOnce(
      plan(
        [differs('a.md', 'r1')],
        { ...target, chosen: 'opened-folder' },
        'plan-2',
      ),
    );
    query<HTMLButtonElement>('[data-testid="target-opened"]')?.click();
    fixture.detectChanges();
    expect(dialog().textContent).toContain(
      'Comparing pack files with the chosen folder...',
    );
    expect(confirm().disabled).toBe(true);
    await settle();

    expect(planPackInstall).toHaveBeenLastCalledWith(
      'https://example.com/acme.json',
      ['a.md'],
      'opened-folder',
    );
    expect(
      query('[data-testid="target-reset-status"]')?.textContent?.trim(),
    ).toBe(
      'Target changed. The comparison was run again and every choice is reset to Keep.',
    );
    expect(confirm().textContent?.trim()).toBe('Install pack');
    expect(query('[data-testid="opened-folder-warning"]')).not.toBeNull();

    confirm().click();
    await settle();
    expect(installPackAgents.mock.calls[0][2]).toEqual({
      planToken: 'plan-2',
      decisions: {},
      target: 'opened-folder',
    });
  });

  it('starts from the host target of the last install', async () => {
    planPackInstall.mockResolvedValue(
      plan([fresh('a.md')], { ...target, chosen: 'opened-folder' }),
    );
    await open({ ...packRequest(['a.md']), target: 'opened-folder' });

    expect(planPackInstall).toHaveBeenCalledWith(
      'https://example.com/acme.json',
      ['a.md'],
      'opened-folder',
    );
    expect(
      query('[data-testid="target-opened"]')?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows a plan failure with Try again and blocks the install', async () => {
    planPackInstall.mockRejectedValueOnce(new Error('network down'));
    await open(packRequest(['a.md']));

    expect(query('[role="alert"]')?.textContent).toContain(
      'Could not compare the pack files with the folder.',
    );
    expect(dialog().textContent).not.toContain('network down');
    expect(confirm().disabled).toBe(true);

    planPackInstall.mockResolvedValueOnce(plan([fresh('a.md')]));
    query<HTMLButtonElement>('[data-testid="plan-retry"]')?.click();
    await settle();
    expect(planPackInstall).toHaveBeenCalledTimes(2);
    expect(confirm().disabled).toBe(false);
  });

  it('drops a plan reply that arrives after Cancel', async () => {
    let resolve!: (value: WizardPlanPackInstallResult) => void;
    planPackInstall.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    fixture.componentRef.setInput('request', packRequest(['a.md']));
    fixture.detectChanges();
    queryAll<HTMLButtonElement>('[modal-footer] button')[0].click();
    expect(dismissals).toBe(1);
    resolve(plan([differs('a.md')]));
    await settle();
    expect(query('[data-testid="file-decision-row"]')).toBeNull();
    expect(installPackAgents).not.toHaveBeenCalled();
  });

  it('reports kept, failed and installed files from the install result', async () => {
    planPackInstall.mockResolvedValue(
      plan([fresh('a.md'), differs('b.md'), differs('c.md'), fresh('d.md')]),
    );
    installPackAgents.mockResolvedValue({
      success: false,
      agentsDownloaded: 1,
      fromCache: false,
      error: '1 file(s) failed to install',
      files: [
        { file: 'a.md', outcome: 'written' },
        { file: 'b.md', outcome: 'kept' },
        { file: 'c.md', outcome: 'changed-since-preview' },
        { file: 'd.md', outcome: 'failed' },
      ],
    });
    await open(packRequest(['a.md', 'b.md', 'c.md', 'd.md']));
    confirm().click();
    await settle();

    expect(finished()?.statuses).toEqual({
      'a.md': 'installed',
      'b.md': 'kept',
      'c.md': 'kept',
      'd.md': 'failed',
    });
    expect(finished()?.outcomes['c.md']).toBe('changed-since-preview');
    expect(finished()?.failure).toBe(
      'Some files could not be installed. Retry the failed files.',
    );
    expect(finished()?.primaryFailure).toBe(false);
    expect(store.fileState('wizard', SOURCE, 'b.md')).toBe('kept');
  });

  it('reports a primary failure when the install has no per-file outcome', async () => {
    planPackInstall.mockResolvedValue(plan([fresh('a.md')]));
    installPackAgents.mockRejectedValue(new Error('transport down'));
    await open(packRequest(['a.md']));
    confirm().click();
    await settle();

    expect(finished()?.primaryFailure).toBe(true);
    expect(finished()?.statuses).toEqual({ 'a.md': 'failed' });
    // The raw transport text is never surfaced (B5).
    expect(finished()?.failure).toBe(INSTALL_FAILED_FALLBACK);
    expect(store.failure('wizard', SOURCE, 'a.md')).toBe(
      INSTALL_FAILED_FALLBACK,
    );
  });
});
