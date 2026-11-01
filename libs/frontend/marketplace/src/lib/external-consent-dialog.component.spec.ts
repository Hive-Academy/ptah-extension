import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  ExternalInstallPlan,
  ExternalLocalItem,
} from '@ptah-extension/shared';
import { makeLibraryAgreementFixtures } from '@ptah-extension/shared/testing';
import {
  ExternalConsentDialogComponent,
  type ExternalConsentApproval,
} from './external-consent-dialog.component';

/** A plan with every disclosure empty — tests opt IN to the parts they assert. */
function makePlan(
  overrides: Partial<ExternalInstallPlan> = {},
): ExternalInstallPlan {
  return {
    pluginId: 'external:dotnet/skills/dotnet-test',
    source: 'dotnet/skills',
    plugin: 'dotnet-test',
    displayName: '.NET Test',
    version: '1.2.0',
    skills: [],
    fileCount: 0,
    totalBytes: 0,
    scriptFiles: [],
    skippedBinaryFiles: [],
    mcpServers: [],
    collisions: [],
    consentToken: 'token-abc',
    ...overrides,
  };
}

describe('ExternalConsentDialogComponent', () => {
  let fixture: ComponentFixture<ExternalConsentDialogComponent>;
  let component: ExternalConsentDialogComponent;
  let host: HTMLElement;

  const render = (plan: ExternalInstallPlan): void => {
    fixture = TestBed.createComponent(ExternalConsentDialogComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('plan', plan);
    fixture.detectChanges();
  };

  const dialog = (): HTMLElement | null =>
    host.querySelector('[data-testid="external-consent"]');
  const confirmButton = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      '[data-testid="external-consent-confirm"]',
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExternalConsentDialogComponent],
    });
  });

  it('renders the dialog root under the e2e testid', () => {
    render(makePlan());
    expect(dialog()).toBeTruthy();
  });

  it('shows the display name and resolved version', () => {
    render(makePlan({ displayName: '.NET Test', version: '1.2.0' }));

    expect(dialog()?.textContent).toContain('.NET Test');
    expect(dialog()?.textContent).toContain('1.2.0');
    // No installedVersion → this is a fresh install, not an upgrade.
    expect(component.isUpgrade()).toBe(false);
    expect(dialog()?.textContent).toContain('Install');
  });

  it('labels a re-install as an upgrade and names the installed version', () => {
    render(makePlan({ version: '2.0.0', installedVersion: '1.2.0' }));

    expect(component.isUpgrade()).toBe(true);
    expect(dialog()?.textContent).toContain('Update');
    expect(dialog()?.textContent).toContain('1.2.0');
    expect(dialog()?.textContent).toContain('2.0.0');
  });

  it('shows the skill count, every skill name, and the file/byte footprint', () => {
    render(
      makePlan({
        skills: ['dotnet-build', 'dotnet-test'],
        fileCount: 17,
        totalBytes: 2048,
      }),
    );

    const text = dialog()?.textContent ?? '';
    expect(text).toContain('2');
    expect(text).toContain('skills');
    expect(text).toContain('dotnet-build');
    expect(text).toContain('dotnet-test');
    expect(text).toContain('17');
    expect(text).toContain('2.0 KB');
  });

  it('warns that the plugin ships executable scripts and lists them', () => {
    render(
      makePlan({
        scriptFiles: ['skills/build/scripts/run.sh', 'scripts/x.ps1'],
      }),
    );

    const text = dialog()?.textContent ?? '';
    expect(text).toContain('executable scripts');
    expect(text).toContain('skills/build/scripts/run.sh');
    expect(text).toContain('scripts/x.ps1');
  });

  it('omits the script warning entirely when the plugin ships none', () => {
    render(makePlan({ scriptFiles: [] }));

    expect(dialog()?.textContent).not.toContain('executable scripts');
  });

  it('renders every declared MCP command line VERBATIM inside a code element', () => {
    const commandLine =
      'dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease --verbosity diagnostic';
    render(
      makePlan({
        mcpServers: [
          {
            name: 'binlog',
            command: 'dotnet',
            args: [
              'dnx',
              'Microsoft.AITools.BinlogMcp',
              '--yes',
              '--prerelease',
              '--verbosity',
              'diagnostic',
            ],
            commandLine,
          },
        ],
      }),
    );

    const codes = Array.from(dialog()?.querySelectorAll('code') ?? []).map(
      (el) => el.textContent,
    );
    // Exact match: never truncated, ellipsized or reformatted.
    expect(codes).toContain(commandLine);
    expect(dialog()?.textContent).toContain('binlog');
  });

  it('states that Ptah adds declared MCP servers in the chosen scope', () => {
    render(
      makePlan({
        mcpServers: [
          {
            name: 'binlog',
            command: 'dotnet',
            args: ['dnx'],
            commandLine: 'dotnet dnx',
          },
        ],
      }),
    );

    const copy = host.querySelector(
      '[data-testid="external-consent-mcp-copy"]',
    );
    expect(copy?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Ptah adds these servers to the scope you choose below. Review each command before you continue.',
    );
    // The false claim is gone: the consented install DOES register them.
    const text = dialog()?.textContent ?? '';
    expect(text).not.toContain('NOT register or run');
    expect(text).not.toContain('Nothing below executes');
    // Command line still verbatim.
    expect(
      Array.from(dialog()?.querySelectorAll('code') ?? []).map(
        (el) => el.textContent,
      ),
    ).toContain('dotnet dnx');
  });

  it('discloses env variable NAMES a declared server sets', () => {
    render(
      makePlan({
        mcpServers: [
          {
            name: 'binlog',
            command: 'dotnet',
            args: [],
            env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
            commandLine: 'dotnet',
          },
        ],
      }),
    );

    expect(dialog()?.textContent).toContain('DOTNET_CLI_TELEMETRY_OPTOUT');
    expect(component.envKeysOf(undefined)).toEqual([]);
  });

  it('lists files that will be skipped as non-UTF-8 text', () => {
    render(makePlan({ skippedBinaryFiles: ['assets/logo.png'] }));

    const text = dialog()?.textContent ?? '';
    expect(text).toContain('skipped');
    expect(text).toContain('assets/logo.png');
  });

  it('names each shadowed skill and what shadows it', () => {
    render(
      makePlan({
        collisions: [{ skillName: 'run-tests', shadowedBy: 'ptah-core' }],
      }),
    );

    const text = dialog()?.textContent ?? '';
    expect(text).toContain('run-tests');
    expect(text).toContain('ptah-core');
    expect(text).toContain('shadowed');
  });

  it('emits confirmed from the confirm testid and cancelled from Cancel', () => {
    render(makePlan());
    const confirmed: number[] = [];
    const cancelled: number[] = [];
    component.confirmed.subscribe(() => confirmed.push(1));
    component.cancelled.subscribe(() => cancelled.push(1));

    const confirmButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="external-consent-confirm"]',
    );
    expect(confirmButton).toBeTruthy();
    confirmButton?.click();
    expect(confirmed.length).toBe(1);

    const cancelButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Cancel');
    cancelButton?.click();
    expect(cancelled.length).toBe(1);
  });

  it('disables both actions while the authorized call is in flight', () => {
    render(makePlan());
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    const confirmButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="external-consent-confirm"]',
    );
    expect(confirmButton?.disabled).toBe(true);
  });

  it('renders an error without dismissing the dialog', () => {
    render(makePlan());
    fixture.componentRef.setInput('installFailed', true);
    fixture.detectChanges();

    expect(dialog()).toBeTruthy();
    const alert = host.querySelector('[data-testid="external-consent-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Install failed. Ptah removes what it wrote for this install where it ' +
        'can. Check the files listed in the install report, then retry.',
    );
    // Outside the scrolling body, right above the actions, so a long
    // local-files list cannot push it below the fold.
    expect(alert?.closest('.overflow-y-auto')).toBeNull();
    expect(alert?.nextElementSibling?.classList.contains('modal-action')).toBe(
      true,
    );
  });

  it('shows a failed confirm as "Install failed" with "Retry install"', () => {
    render(makePlan());
    fixture.componentRef.setInput('installFailed', true);
    fixture.detectChanges();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Install failed.');
    expect(alert?.textContent).toContain(
      'Ptah removes what it wrote for this install where it can.',
    );
    expect(confirmButton()?.textContent?.trim()).toBe('Retry install');
  });

  it('shows no failure before a failed confirm', () => {
    render(makePlan());
    expect(
      host.querySelector('[data-testid="external-consent-error"]'),
    ).toBeNull();
    expect(confirmButton()?.textContent?.trim()).toBe('Install .NET Test');
  });

  // ── Local files this install would replace (design 3.3) ────────────────────

  describe('local files section', () => {
    /** Acme Toolkit update from design 3.3 C, named from the shared fixture. */
    function acmePlan(): ExternalInstallPlan {
      const acme = makeLibraryAgreementFixtures().shadowedSkill.plugins.find(
        (plugin) => plugin.source === 'external',
      );
      const [architect, reviewer] = acme?.agentNames ?? [];
      const [apiDesign] = acme?.skillNames ?? [];
      const [ship] = acme?.commandNames ?? [];
      const items: ExternalLocalItem[] = [
        {
          approvalId: 'a-architect',
          target: 'claude',
          relPath: `.claude/agents/${architect}.md`,
          family: 'external',
          kind: 'unowned',
        },
        {
          approvalId: 'a-api',
          target: 'codex',
          relPath: `.codex/skills/${apiDesign}/SKILL.md`,
          family: 'external',
          kind: 'owned-edited',
          recordedVersion: '2.0.3',
        },
        {
          approvalId: 'a-ship',
          target: 'claude',
          relPath: `.claude/commands/${ship}.md`,
          family: 'external',
          kind: 'unowned',
        },
        {
          approvalId: 'a-deploy',
          target: 'claude',
          relPath: '.claude/commands/deploy.md',
          family: 'external',
          kind: 'unreadable',
        },
        {
          approvalId: 'a-reviewer',
          relPath: `${reviewer}`,
          family: 'external',
          kind: 'library-clone',
        },
      ];
      return makePlan({
        displayName: acme?.name ?? 'missing-fixture',
        installedVersion: '2.0.3',
        version: '2.1.0',
        collisions: [
          { skillName: 'release-notes', shadowedBy: 'Ptah Release Kit' },
        ],
        localItems: items,
      });
    }

    const section = (): HTMLElement | null =>
      host.querySelector('[data-testid="external-consent-local-items"]');
    const rows = (): HTMLElement[] =>
      Array.from(
        host.querySelectorAll<HTMLElement>(
          '[data-testid="external-consent-local-row"]',
        ),
      );
    const replaceOf = (row: HTMLElement): HTMLButtonElement | null =>
      row.querySelector<HTMLButtonElement>('[data-testid="replace-segment"]');
    const keepOf = (row: HTMLElement): HTMLButtonElement | null =>
      row.querySelector<HTMLButtonElement>('[data-testid="keep-segment"]');

    it('is absent when the plan lists no local item, and the label has no suffix', () => {
      render(makePlan());
      expect(section()).toBeNull();
      expect(confirmButton()?.textContent?.trim()).toBe('Install .NET Test');
    });

    it('sits after the shadowed block and before the error', () => {
      render(acmePlan());
      fixture.componentRef.setInput('installFailed', true);
      fixture.detectChanges();
      const text = dialog()?.textContent ?? '';
      const shadowed = text.indexOf('Some skills will not take effect');
      const local = text.indexOf('Local files this install would replace (5)');
      const error = text.indexOf('Install failed.');
      expect(shadowed).toBeGreaterThan(-1);
      expect(local).toBeGreaterThan(shadowed);
      expect(error).toBeGreaterThan(local);
    });

    it('renders each reason badge, the edited note and the Library copy labels', () => {
      render(acmePlan());
      const [architect, api, , deploy, reviewer] = rows();
      expect(architect.textContent).toContain('Not created by Ptah');
      expect(api.textContent).toContain('Edited since Ptah wrote it');
      expect(api.textContent).toContain(
        'Ptah copied this on 2.0.3. The file on disk has changed since.',
      );
      expect(deploy.textContent).toContain('Could not read file');
      expect(reviewer.textContent).toContain('Edited Library copy');
      expect(reviewer.textContent).toContain('Library copy: reviewer');
      expect(keepOf(reviewer)?.textContent?.trim()).toBe('Keep my copy');
      expect(replaceOf(reviewer)?.textContent?.trim()).toBe('Replace (rebase)');
      expect(replaceOf(architect)?.textContent?.trim()).toBe(
        'Replace with plugin version',
      );
      for (const row of rows()) {
        expect(keepOf(row)?.getAttribute('aria-checked')).toBe('true');
      }
    });

    it('forces Keep for an unreadable item, also through Replace all', () => {
      render(acmePlan());
      const deploy = rows()[3];
      expect(replaceOf(deploy)?.getAttribute('aria-disabled')).toBe('true');
      replaceOf(deploy)?.click();
      fixture.detectChanges();
      expect(component.replaceCount()).toBe(0);

      component.setAll('replace');
      fixture.detectChanges();
      expect(component.replaceCount()).toBe(4);
      expect(keepOf(rows()[3])?.getAttribute('aria-checked')).toBe('true');
      expect(confirmButton()?.textContent?.trim()).toBe(
        'Update Acme Toolkit and replace 4 files',
      );
    });

    it('emits a decision per item keyed by approvalId', () => {
      render(acmePlan());
      const emitted: Record<string, string>[] = [];
      component.confirmed.subscribe(({ localItemDecisions, mcpScope }) => {
        expect(mcpScope).toBeUndefined();
        emitted.push(localItemDecisions);
      });
      replaceOf(rows()[1])?.click();
      fixture.detectChanges();
      expect(confirmButton()?.textContent?.trim()).toBe(
        'Update Acme Toolkit and replace 1 file',
      );
      confirmButton()?.click();
      expect(emitted).toEqual([
        {
          'a-architect': 'keep',
          'a-api': 'replace',
          'a-ship': 'keep',
          'a-deploy': 'keep',
          'a-reviewer': 'keep',
        },
      ]);
    });

    it('resets every choice to Keep on re-approval with a new plan', () => {
      render(acmePlan());
      component.setAll('replace');
      fixture.detectChanges();
      expect(component.replaceCount()).toBe(4);

      fixture.componentRef.setInput('reason', 'approval-expired');
      fixture.componentRef.setInput('plan', acmePlan());
      fixture.detectChanges();

      expect(component.replaceCount()).toBe(0);
      expect(dialog()?.textContent).toContain('Every choice is reset to Keep.');
      for (const row of rows()) {
        expect(keepOf(row)?.getAttribute('aria-checked')).toBe('true');
      }
    });

    it('disables every choice while the install runs and sets aria-busy', () => {
      render(acmePlan());
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      expect(host.querySelector('.modal-box')?.getAttribute('aria-busy')).toBe(
        'true',
      );
      for (const row of rows()) {
        expect(replaceOf(row)?.disabled).toBe(true);
      }
    });
  });

  // ── Modal keyboard contract ────────────────────────────────────────────────

  describe('keyboard trap', () => {
    const key = (init: KeyboardEventInit): void => {
      dialog()?.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    };
    const stops = (): HTMLButtonElement[] =>
      Array.from(
        dialog()?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        ) ?? [],
      ).filter((button) => button.tabIndex !== -1);

    it('wraps Tab and Shift+Tab inside the dialog', () => {
      render(makePlan());
      const all = stops();
      const last = all[all.length - 1];
      last.focus();
      key({ key: 'Tab' });
      expect(document.activeElement).toBe(all[0]);
      key({ key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('cancels on Escape, but not while the install runs', () => {
      render(makePlan());
      const cancelled = jest.fn();
      component.cancelled.subscribe(cancelled);
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      key({ key: 'Escape' });
      expect(cancelled).not.toHaveBeenCalled();

      fixture.componentRef.setInput('busy', false);
      fixture.detectChanges();
      key({ key: 'Escape' });
      expect(cancelled).toHaveBeenCalledTimes(1);
    });

    it('returns focus to the opener when the dialog closes', () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      render(makePlan());
      fixture.destroy();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });
  });
  describe('MCP server scope (F-D4)', () => {
    const servers: ExternalInstallPlan['mcpServers'] = [
      {
        name: 'binlog',
        command: 'dotnet',
        args: ['dnx'],
        commandLine: 'dotnet dnx',
      },
      {
        name: 'tracer',
        command: 'npx',
        args: ['tracer'],
        commandLine: 'npx tracer',
      },
    ];

    const renderWith = (
      plan: ExternalInstallPlan,
      workspaceName: string | null,
    ): void => {
      fixture = TestBed.createComponent(ExternalConsentDialogComponent);
      component = fixture.componentInstance;
      host = fixture.nativeElement as HTMLElement;
      fixture.componentRef.setInput('plan', plan);
      fixture.componentRef.setInput('workspaceName', workspaceName);
      fixture.detectChanges();
    };
    const field = (): HTMLElement | null =>
      host.querySelector('[data-testid="external-consent-mcp-scope"]');
    const radio = (label: string): HTMLInputElement | null =>
      Array.from(field()?.querySelectorAll('label') ?? [])
        .find((el) => el.textContent?.includes(label))
        ?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
    const help = (): string =>
      (
        field()?.querySelector('[data-testid="install-scope-help"]')
          ?.textContent ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    const emitted = (): ExternalConsentApproval[] => {
      const out: ExternalConsentApproval[] = [];
      component.confirmed.subscribe((approval) => out.push(approval));
      return out;
    };

    it('is absent when the plan declares no MCP servers', () => {
      renderWith(makePlan(), 'my-app');
      const out = emitted();
      expect(field()).toBeNull();
      confirmButton()?.click();
      expect(out).toEqual([{ localItemDecisions: {} }]);
    });

    it('renders after the server list with the legend "Install servers for"', () => {
      renderWith(makePlan({ mcpServers: servers }), 'my-app');
      expect(field()?.querySelector('legend')?.textContent?.trim()).toBe(
        'Install servers for',
      );
      const lastCommand = Array.from(
        dialog()?.querySelectorAll('pre') ?? [],
      ).pop();
      expect(
        lastCommand &&
          field() &&
          lastCommand.compareDocumentPosition(field() as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('defaults to This workspace and sends it with the consent', () => {
      renderWith(makePlan({ mcpServers: servers }), 'my-app');
      const out = emitted();
      expect(radio('This workspace')?.checked).toBe(true);
      expect(radio('All workspaces')?.checked).toBe(false);
      confirmButton()?.click();
      expect(out).toEqual([{ localItemDecisions: {}, mcpScope: 'workspace' }]);
    });

    it('sends global only after the user picks All workspaces', () => {
      renderWith(makePlan({ mcpServers: servers }), 'my-app');
      const out = emitted();
      radio('All workspaces')?.click();
      fixture.detectChanges();
      expect(radio('All workspaces')?.checked).toBe(true);
      confirmButton()?.click();
      expect(out).toEqual([{ localItemDecisions: {}, mcpScope: 'global' }]);
    });

    it('with no folder keeps consent enabled, names skipped servers and sends no scope', () => {
      renderWith(makePlan({ mcpServers: servers }), null);
      const out = emitted();
      expect(radio('This workspace')?.disabled).toBe(true);
      expect(radio('This workspace')?.checked).toBe(false);
      expect(radio('All workspaces')?.checked).toBe(false);
      expect(help()).toBe(
        'No folder is open, so Ptah skips these servers: binlog, tracer. The plugin files still install. Choose All workspaces to add the servers for every workspace.',
      );
      expect(confirmButton()?.disabled).toBe(false);
      confirmButton()?.click();
      expect(out).toEqual([{ localItemDecisions: {} }]);
    });

    it('with no folder sends global after the explicit All workspaces choice', () => {
      renderWith(makePlan({ mcpServers: servers }), null);
      const out = emitted();
      radio('All workspaces')?.click();
      fixture.detectChanges();
      expect(help()).not.toContain('skips');
      confirmButton()?.click();
      expect(out).toEqual([{ localItemDecisions: {}, mcpScope: 'global' }]);
    });

    it('disables the scope radios while the install runs', () => {
      renderWith(makePlan({ mcpServers: servers }), 'my-app');
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      expect(field()?.querySelector('fieldset')?.hasAttribute('disabled')).toBe(
        true,
      );
    });
  });
});
