import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ExternalInstallPlan } from '@ptah-extension/shared';
import { ExternalConsentDialogComponent } from './external-consent-dialog.component';

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

  it('states that Ptah will not register or run declared MCP servers', () => {
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

    const text = dialog()?.textContent ?? '';
    expect(text).toContain('NOT register or run');
    expect(text).toContain('files on disk');
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
    fixture.componentRef.setInput('errorMessage', 'consent token expired');
    fixture.detectChanges();

    expect(dialog()).toBeTruthy();
    expect(dialog()?.textContent).toContain('consent token expired');
  });
});
