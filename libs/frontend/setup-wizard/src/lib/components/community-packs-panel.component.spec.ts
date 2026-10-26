import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService, VSCodeService } from '@ptah-extension/core';
import type {
  AgentPackInfoDto,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import { PackInstallStore } from '../services/pack-install.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { CommunityPacksPanelComponent } from './community-packs-panel.component';

const target = {
  harnessRoot: '/repo',
  openedFolder: '/repo/packages/web',
  chosen: 'harness-root' as const,
  openedIsHarnessRoot: false,
};

const packs: AgentPackInfoDto[] = [
  {
    source: 'community',
    name: 'Tools',
    description: 'Extra agents',
    version: '1.0.0',
    agents: [
      { file: 'a.md', name: 'Agent A', description: 'A', category: 'qa' },
      { file: 'b.md', name: 'Agent B', description: 'B', category: 'qa' },
    ],
  },
];

function planFor(
  files: string[],
  chosen: 'harness-root' | 'opened-folder' = 'harness-root',
): WizardPlanPackInstallResult {
  return {
    planToken: `plan-${chosen}`,
    target: { ...target, chosen },
    files: files.map((file) => ({ file, state: 'new', revision: `${file}-r` })),
  };
}

// jsdom lacks the native dialog methods; keep the open attribute like the NativeModal specs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('CommunityPacksPanelComponent', () => {
  let fixture: ComponentFixture<CommunityPacksPanelComponent>;
  let listAgentPacks: jest.Mock;
  let planPackInstall: jest.Mock;
  let installPackAgents: jest.Mock;

  function setUp(isElectron = true): void {
    const communityPacks = signal<AgentPackInfoDto[]>([]);
    listAgentPacks = jest.fn().mockResolvedValue(packs);
    planPackInstall = jest
      .fn()
      .mockImplementation(
        (_source: string, files: string[], chosen?: 'opened-folder') =>
          Promise.resolve(planFor(files, chosen ?? 'harness-root')),
      );
    installPackAgents = jest
      .fn()
      .mockImplementation(
        (
          _source: string,
          files: string[],
        ): Promise<WizardInstallPackAgentsResult> =>
          Promise.resolve({
            success: true,
            agentsDownloaded: files.length,
            fromCache: false,
            files: files.map((file) => ({ file, outcome: 'written' as const })),
          }),
      );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SetupWizardStateService,
          useValue: {
            communityPacks,
            setCommunityPacks: communityPacks.set.bind(communityPacks),
          },
        },
        {
          provide: WizardRpcService,
          useValue: { listAgentPacks, planPackInstall, installPackAgents },
        },
        { provide: VSCodeService, useValue: { isElectron } },
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
      ],
    });
    fixture = TestBed.createComponent(CommunityPacksPanelComponent);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    // Render first so the prompt's request effect starts the plan call.
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function browseAndExpand(): Promise<void> {
    fixture.nativeElement.querySelector('button').click();
    await settle();
    fixture.nativeElement.querySelector('[aria-expanded]').click();
    fixture.detectChanges();
  }

  const byTestId = (id: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const byText = (text: string): HTMLButtonElement[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>,
    ).filter((button) => button.textContent?.trim() === text);
  const prompt = (): HTMLDialogElement =>
    fixture.nativeElement.querySelector('dialog');

  it('loads packs only on browse and installs one agent through the prompt', async () => {
    setUp();
    expect(listAgentPacks).not.toHaveBeenCalled();
    await browseAndExpand();
    expect(listAgentPacks).toHaveBeenCalledTimes(1);

    byText('Install')[0].click();
    await settle();
    expect(planPackInstall).toHaveBeenCalledWith(
      'community',
      ['a.md'],
      undefined,
    );
    expect(installPackAgents).not.toHaveBeenCalled();
    expect(prompt().open).toBe(true);
    expect(prompt().textContent).toContain('Install a.md from "Tools"?');
    // The target choice shows even though no file differs.
    expect(byTestId('target-root')).not.toBeNull();

    byTestId('pack-confirm').click();
    await settle();
    expect(installPackAgents).toHaveBeenCalledWith('community', ['a.md'], {
      planToken: 'plan-harness-root',
      decisions: {},
      target: 'harness-root',
    });
    expect(prompt()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Installed');
  });

  it('opens the whole-pack prompt from Install All and from Change', async () => {
    setUp();
    await browseAndExpand();

    byTestId('pack-install-all').click();
    await settle();
    expect(planPackInstall).toHaveBeenLastCalledWith(
      'community',
      ['a.md', 'b.md'],
      undefined,
    );
    expect(prompt().textContent).toContain('Install community pack "Tools"?');
    byText('Cancel')[0].click();
    fixture.detectChanges();
    expect(prompt()).toBeNull();

    byTestId('pack-change-target').click();
    await settle();
    expect(prompt().open).toBe(true);
    expect(planPackInstall).toHaveBeenCalledTimes(2);
  });

  it('shows Kept for a kept file and offers Retry only for a failed one', async () => {
    setUp();
    installPackAgents.mockResolvedValueOnce({
      success: false,
      agentsDownloaded: 0,
      fromCache: false,
      error: '1 file(s) failed to install',
      files: [
        { file: 'a.md', outcome: 'kept' },
        { file: 'b.md', outcome: 'failed' },
      ],
    });
    await browseAndExpand();
    byTestId('pack-install-all').click();
    await settle();
    byTestId('pack-confirm').click();
    await settle();

    expect(byTestId('pack-agent-kept')?.textContent?.trim()).toBe('Kept');
    expect(fixture.nativeElement.textContent).toContain(
      'Your file was not changed. Origin stays Workspace file.',
    );
    expect(byTestId('pack-agent-failure')?.textContent).toContain(
      'Some files could not be installed. Retry the failed files.',
    );
    expect(byTestId('pack-result')?.textContent).toContain(
      '0 Installed · 1 Kept (your file) · 1 Failed',
    );
    const retry = byText('Retry');
    expect(retry.length).toBe(1);

    retry[0].click();
    await settle();
    expect(planPackInstall).toHaveBeenLastCalledWith(
      'community',
      ['b.md'],
      'harness-root',
    );
    expect(prompt().textContent).toContain('Install b.md from "Tools"?');
  });

  it.each([
    [
      true,
      'These agents are in packages/web/.claude/agents. They will not reach other CLIs and will not appear in the Library.',
    ],
    [
      false,
      'These agents are in packages/web/.claude/agents. They will not reach other CLIs.',
    ],
  ])(
    'shows the opened-folder notice per host (Electron %s)',
    async (isElectron, notice) => {
      setUp(isElectron);
      await browseAndExpand();
      byText('Install')[0].click();
      await settle();
      byTestId('target-opened').click();
      await settle();
      byTestId('pack-confirm').click();
      await settle();

      expect(installPackAgents.mock.calls[0][2].target).toBe('opened-folder');
      expect(byTestId('pack-opened-folder-notice')?.textContent?.trim()).toBe(
        notice,
      );
      expect(byTestId('pack-install-to')?.textContent).toContain(
        '/repo/packages/web/.claude/agents',
      );
      expect(byTestId('pack-install-to')?.textContent).toContain(
        '(opened folder only)',
      );
    },
  );

  describe('install outlives the panel (B2, B4)', () => {
    function pendingInstall(): (result: WizardInstallPackAgentsResult) => void {
      let resolve!: (result: WizardInstallPackAgentsResult) => void;
      installPackAgents.mockReturnValueOnce(
        new Promise<WizardInstallPackAgentsResult>((r) => {
          resolve = r;
        }),
      );
      return (result) => resolve(result);
    }

    async function recreate(): Promise<void> {
      fixture.destroy();
      fixture = TestBed.createComponent(CommunityPacksPanelComponent);
      fixture.detectChanges();
      await browseAndExpand();
    }

    it('restores a success that settled while the panel was destroyed', async () => {
      setUp();
      const finish = pendingInstall();
      await browseAndExpand();
      byText('Install')[0].click();
      await settle();
      byTestId('pack-confirm').click();
      await settle();
      expect(fixture.nativeElement.textContent).toContain('Installing');

      fixture.destroy();
      finish({
        success: true,
        agentsDownloaded: 1,
        fromCache: false,
        files: [{ file: 'a.md', outcome: 'written' }],
      });
      const store = TestBed.inject(PackInstallStore);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.fileState('sidebar', 'community', 'a.md')).toBe('installed');
      expect(store.isInstalling('sidebar')).toBe(false);

      fixture = TestBed.createComponent(CommunityPacksPanelComponent);
      fixture.detectChanges();
      await browseAndExpand();
      expect(fixture.nativeElement.textContent).toContain('Installed');
      expect(byTestId('pack-result')?.textContent).toContain('1 Installed');
      // Nothing is stranded disabled: b.md and Install All stay usable.
      expect(byText('Install')[0].disabled).toBe(false);
      expect(byTestId('pack-install-all').disabled).toBe(false);
    });

    it('restores Kept and a safe failure after re-creation, and a new prompt starts on Keep', async () => {
      setUp();
      const finish = pendingInstall();
      await browseAndExpand();
      byTestId('pack-install-all').click();
      await settle();
      byTestId('pack-confirm').click();
      await settle();

      await recreate();
      expect(byTestId('pack-install-all').disabled).toBe(true);
      finish({
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: 'EACCES: permission denied, open /home/me/.secret/token',
        files: [
          { file: 'a.md', outcome: 'kept' },
          { file: 'b.md', outcome: 'failed' },
        ],
      });
      await settle();

      expect(byTestId('pack-agent-kept')?.textContent?.trim()).toBe('Kept');
      const failure = byTestId('pack-agent-failure')?.textContent ?? '';
      expect(failure).toContain('permission denied');
      expect(failure).not.toContain('.secret');
      expect(byText('Retry')[0].disabled).toBe(false);
      expect(byTestId('pack-install-all').disabled).toBe(false);

      await recreate();
      expect(byTestId('pack-agent-kept')?.textContent?.trim()).toBe('Kept');
      planPackInstall.mockResolvedValueOnce({
        planToken: 'plan-again',
        target,
        files: [
          {
            file: 'a.md',
            state: 'differs',
            revision: 'a-r2',
            localText: 'mine',
            incomingText: 'theirs',
          },
          { file: 'b.md', state: 'new', revision: 'b-r2' },
        ],
      });
      byTestId('pack-install-all').click();
      await settle();
      const keep = fixture.nativeElement.querySelector(
        '[data-testid="keep-segment"]',
      ) as HTMLElement | null;
      expect(keep?.getAttribute('aria-checked')).toBe('true');
    });

    it.each([
      'token=sk-live-SECRET123 at https://internal.example/api?key=abc',
      '<img src=x onerror="alert(1)"><b>boom</b>',
    ])('never renders the raw install error %#', async (raw) => {
      setUp();
      installPackAgents.mockResolvedValueOnce({
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: raw,
      });
      await browseAndExpand();
      byText('Install')[0].click();
      await settle();
      byTestId('pack-confirm').click();
      await settle();

      const html: string = fixture.nativeElement.innerHTML;
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('The install could not be completed. Try again.');
      for (const leak of [
        'sk-live',
        'internal.example',
        'key=abc',
        'onerror',
        'boom',
      ]) {
        expect(text).not.toContain(leak);
        expect(html).not.toContain(leak);
      }
      expect(fixture.nativeElement.querySelector('img')).toBeNull();
    });
  });
});
