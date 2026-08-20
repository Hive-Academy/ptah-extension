import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { ExternalPluginListing } from '@ptah-extension/shared';
import { ExternalPluginRowComponent } from './external-plugin-row.component';

const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';

function makeListing(
  overrides: Partial<ExternalPluginListing> = {},
): ExternalPluginListing {
  return {
    id: PLUGIN_ID,
    name: 'dotnet-test',
    description: 'Run and debug .NET tests',
    source: 'dotnet/skills',
    path: 'skills/dotnet-test',
    version: '1.2.0',
    installed: false,
    ...overrides,
  };
}

describe('ExternalPluginRowComponent', () => {
  let fixture: ComponentFixture<ExternalPluginRowComponent>;
  let component: ExternalPluginRowComponent;
  let host: HTMLElement;

  const render = (listing: ExternalPluginListing): void => {
    fixture = TestBed.createComponent(ExternalPluginRowComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('listing', listing);
    fixture.detectChanges();
  };

  const installButton = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>('[data-testid="external-install"]');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ExternalPluginRowComponent] });
  });

  it('tags the row with the plugin id VERBATIM', () => {
    render(makeListing());

    // The id carries colons and slashes; it must not be escaped or rewritten.
    expect(
      host.querySelector(`[data-testid="external-plugin-${PLUGIN_ID}"]`),
    ).toBeTruthy();
  });

  it('renders name, version and description', () => {
    render(makeListing());

    expect(host.textContent).toContain('dotnet-test');
    expect(host.textContent).toContain('1.2.0');
    expect(host.textContent).toContain('Run and debug .NET tests');
  });

  it('falls back when the marketplace advertises no description', () => {
    render(makeListing({ description: '' }));

    expect(host.textContent).toContain('No description provided');
  });

  it('offers Install and no Uninstall when not installed', () => {
    render(makeListing({ installed: false }));

    expect(installButton()?.textContent?.trim()).toBe('Install');
    expect(host.textContent).not.toContain('Uninstall');
  });

  it('shows an Installed state with Uninstall when installed', () => {
    render(makeListing({ installed: true, installedVersion: '1.2.0' }));

    expect(host.textContent).toContain('Installed');
    expect(host.textContent).toContain('Uninstall');
    expect(installButton()?.textContent?.trim()).toBe('Reinstall');
    // Same version installed and advertised → no upgrade hint.
    expect(component.upgradeLabel()).toBeNull();
  });

  it('calls out a newer advertised version on an installed row', () => {
    render(
      makeListing({
        installed: true,
        installedVersion: '1.1.0',
        version: '1.2.0',
      }),
    );

    expect(component.upgradeLabel()).toBe(
      'Installed 1.1.0 · 1.2.0 available — reinstall to update.',
    );
    expect(host.textContent).toContain('1.2.0 available');
  });

  it('emits installRequested on click and performs no install itself', () => {
    render(makeListing());
    const requested: number[] = [];
    component.installRequested.subscribe(() => requested.push(1));

    installButton()?.click();

    expect(requested.length).toBe(1);
  });

  it('emits uninstallRequested from the Uninstall button', () => {
    render(makeListing({ installed: true }));
    const requested: number[] = [];
    component.uninstallRequested.subscribe(() => requested.push(1));

    const uninstall = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === 'Uninstall');
    uninstall?.click();

    expect(requested.length).toBe(1);
  });

  it('disables the install button while a plan request is in flight', () => {
    render(makeListing());
    fixture.componentRef.setInput('installing', true);
    fixture.detectChanges();

    expect(installButton()?.disabled).toBe(true);
  });
});
