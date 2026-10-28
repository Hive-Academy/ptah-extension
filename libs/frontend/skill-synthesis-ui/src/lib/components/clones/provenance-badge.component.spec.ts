import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provenanceLabel,
  type LibraryProvenance,
} from '@ptah-extension/shared';
import { makeLibraryAgreementFixtures } from '@ptah-extension/shared/testing';

import { ProvenanceBadgeComponent } from './provenance-badge.component';

describe('ProvenanceBadgeComponent', () => {
  let fixture: ComponentFixture<ProvenanceBadgeComponent>;

  const q = (testId: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );

  function render(provenance: LibraryProvenance | null | undefined): void {
    fixture = TestBed.createComponent(ProvenanceBadgeComponent);
    fixture.componentRef.setInput('provenance', provenance);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProvenanceBadgeComponent] });
  });

  it.each<[LibraryProvenance | null | undefined, string]>([
    [{ kind: 'setup-wizard' }, 'Setup wizard'],
    [
      { kind: 'plugin', pluginId: 'p', name: 'Acme Toolkit', state: 'active' },
      'Plugin: Acme Toolkit',
    ],
    [{ kind: 'skills-sh', source: 'acme/skills' }, 'skills.sh: acme/skills'],
    [{ kind: 'workspace' }, 'Workspace file'],
    [null, 'Workspace file'],
    [undefined, 'Workspace file'],
  ])('labels %j as "%s" via provenanceLabel', (provenance, label) => {
    render(provenance);
    expect(q('provenance-badge')?.textContent?.trim()).toBe(label);
    expect(q('provenance-badge')?.textContent?.trim()).toBe(
      provenanceLabel(provenance),
    );
  });

  it('gives a plugin badge the primary border and other origins the strong surface border', () => {
    render({ kind: 'plugin', pluginId: 'p', name: 'X', state: 'active' });
    expect(q('provenance-badge')?.classList).toContain('border-primary');

    render({ kind: 'setup-wizard' });
    const cls = q('provenance-badge')?.classList;
    expect(cls).not.toContain('border-primary');
    expect(cls).toContain('border-[color:var(--surface-border-strong)]');
    expect(cls).toContain('badge');
    expect(cls).toContain('bg-base-300');
  });

  it('adds no plugin-state word for an active plugin or a non-plugin origin', () => {
    render({ kind: 'plugin', pluginId: 'p', name: 'X', state: 'active' });
    expect(q('provenance-plugin-state')).toBeNull();
    render({ kind: 'workspace' });
    expect(q('provenance-plugin-state')).toBeNull();
  });

  it('keeps the former plugin label and says "Orphaned" once the plugin is uninstalled', () => {
    const { uninstalledPluginEditedClone } = makeLibraryAgreementFixtures();
    const entry = uninstalledPluginEditedClone.listClones.clones[0];
    render(entry.provenance);
    expect(q('provenance-badge')?.textContent?.trim()).toBe(
      uninstalledPluginEditedClone.expectedLabels['agent:legacy-linter'],
    );
    expect(q('provenance-plugin-state')?.textContent?.trim()).toBe('Orphaned');
  });

  it('says "Plugin turned off" for a turned-off plugin copy', () => {
    const { disabledPluginEditedClone } = makeLibraryAgreementFixtures();
    render(disabledPluginEditedClone.listClones.clones[0].provenance);
    expect(q('provenance-badge')?.textContent?.trim()).toBe(
      'Plugin: Old Helper',
    );
    expect(q('provenance-plugin-state')?.textContent?.trim()).toBe(
      'Plugin turned off',
    );
  });

  it('agrees with every shared agreement fixture label', () => {
    for (const scenario of Object.values(makeLibraryAgreementFixtures())) {
      for (const c of scenario.listClones.clones) {
        render(c.provenance);
        expect(q('provenance-badge')?.textContent?.trim()).toBe(
          scenario.expectedLabels[`${c.kind}:${c.slug}`],
        );
      }
    }
  });
});
