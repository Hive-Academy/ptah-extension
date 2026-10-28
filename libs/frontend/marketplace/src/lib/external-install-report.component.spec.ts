import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  ExternalInstallResult,
  LocalItemFamily,
} from '@ptah-extension/shared';
import { makeLibraryAgreementFixtures } from '@ptah-extension/shared/testing';
import { ExternalInstallReportComponent } from './external-install-report.component';

/**
 * The Acme Toolkit install from design 3.3 E, named from the shared
 * agreement fixture: 9 written, 4 kept, 1 shadowed, 1 skipped.
 */
function acmeResult(
  overrides: Partial<ExternalInstallResult> = {},
): ExternalInstallResult {
  const fixtures = makeLibraryAgreementFixtures();
  const acme = fixtures.shadowedSkill.plugins.find(
    (plugin) => plugin.source === 'external',
  );
  const releaseKit = fixtures.shadowedSkill.plugins.find(
    (plugin) => plugin.source === 'bundled',
  );
  const [architect] = acme?.agentNames ?? ['missing-fixture'];
  const [apiDesign] = acme?.skillNames ?? ['missing-fixture'];
  const [ship] = acme?.commandNames ?? ['missing-fixture'];
  return {
    pluginId: acme?.id ?? 'missing-fixture',
    displayName: acme?.name ?? 'missing-fixture',
    installedVersion: '2.1.0',
    filesWritten: 9,
    skippedBinaryFiles: ['assets/logo.png'],
    collisions: [
      { skillName: 'release-notes', shadowedBy: releaseKit?.name ?? '' },
    ],
    kept: [
      {
        approvalId: 'k1',
        family: 'external',
        target: 'claude',
        relPath: `.claude/agents/${architect}.md`,
        reason: 'unowned',
      },
      {
        approvalId: 'k2',
        family: 'external',
        target: 'claude',
        relPath: `.claude/commands/${ship}.md`,
        reason: 'unowned',
      },
      {
        approvalId: 'k3',
        family: 'external',
        target: 'claude',
        relPath: '.claude/commands/deploy.md',
        reason: 'unreadable',
      },
      {
        approvalId: 'k4',
        family: 'external',
        target: 'codex',
        relPath: `.codex/skills/${apiDesign}/SKILL.md`,
        reason: 'changed-since-approval',
      },
    ],
    libraryPass: 'updated',
    ...overrides,
  };
}

describe('ExternalInstallReportComponent', () => {
  let fixture: ComponentFixture<ExternalInstallReportComponent>;
  let component: ExternalInstallReportComponent;
  let host: HTMLElement;

  const render = (report: ExternalInstallResult, notice = false): void => {
    fixture = TestBed.createComponent(ExternalInstallReportComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('report', report);
    fixture.componentRef.setInput('showLibraryNotice', notice);
    fixture.detectChanges();
  };

  const counter = (label: string): string | undefined =>
    host.querySelector(`[data-counter="${label}"] dd`)?.textContent?.trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExternalInstallReportComponent],
    });
  });

  it('shows Written / Kept / Shadowed / Skipped counters in order', () => {
    render(acmeResult());
    const labels = Array.from(host.querySelectorAll('[data-counter] dt')).map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(['Written', 'Kept', 'Shadowed', 'Skipped']);
    expect(counter('Written')).toBe('9');
    expect(counter('Kept')).toBe('4');
    expect(counter('Shadowed')).toBe('1');
    expect(counter('Skipped')).toBe('1');
  });

  it('keeps the existing header and named skipped and shadowed lists', () => {
    render(acmeResult());
    const text = host.textContent ?? '';
    expect(text).toContain('Installed Acme Toolkit 2.1.0 (9 files)');
    expect(text).toContain('Skipped (not valid UTF-8 text)');
    expect(text).toContain('assets/logo.png');
    expect(text).toContain('release-notes');
    expect(text).toContain('is shadowed by');
    expect(text).toContain('Ptah Release Kit');
  });

  it('lists every kept file with its reason, including changed since approval', () => {
    render(acmeResult());
    expect(host.textContent).toContain('Kept (your files were not changed)');
    const rows = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="kept-row"]'),
    );
    expect(rows.map((row) => row.dataset['path'])).toEqual([
      '.claude/agents/architect.md',
      '.claude/commands/ship.md',
      '.claude/commands/deploy.md',
      '.codex/skills/api-design/SKILL.md',
    ]);
    expect(rows[0].textContent).toContain('Kept');
    expect(rows[2].textContent).toContain('Could not read file');
    expect(rows[3].textContent).toContain('Kept: changed since approval');
    expect(rows[3].textContent).toContain('Install again to review it.');
  });

  it('offers no repair route for external-family items (decided in the consent dialog)', () => {
    render(acmeResult());
    expect(host.querySelector('[data-family]')).toBeNull();
  });

  it('offers "Review and replace…" per no-dialog family and emits that family', () => {
    const base = acmeResult();
    render(
      acmeResult({
        kept: [
          ...(base.kept ?? []),
          {
            approvalId: 'a1',
            family: 'plugin-agent',
            target: 'claude',
            relPath: '.claude/agents/release-manager.md',
            reason: 'owned-edited',
          },
        ],
      }),
    );
    const emitted: LocalItemFamily[] = [];
    component.reviewKept.subscribe((family) => emitted.push(family));
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-family]'),
    );
    expect(buttons.map((b) => b.dataset['family'])).toEqual(['plugin-agent']);
    expect(buttons[0].textContent?.trim()).toBe('Review and replace…');
    expect(buttons[0].getAttribute('aria-label')).toBe(
      'Review and replace kept plugin agents',
    );
    buttons[0].click();
    expect(emitted).toEqual(['plugin-agent']);
  });

  it('omits the kept section when nothing was kept', () => {
    render(acmeResult({ kept: undefined }));
    expect(host.textContent).not.toContain('Kept (your files');
    expect(counter('Kept')).toBe('0');
  });

  it('shows C10 only when enabled and the Library refresh failed', () => {
    render(acmeResult({ libraryPass: 'failed' }), true);
    const notice = host.querySelector('[data-testid="library-stale-notice"]');
    expect(notice?.textContent).toContain(
      'The Library may be out of date until its next refresh. The files were installed.',
    );
    expect(host.textContent).toContain('Installed Acme Toolkit');

    render(acmeResult({ libraryPass: 'failed' }), false);
    expect(
      host.querySelector('[data-testid="library-stale-notice"]'),
    ).toBeNull();

    render(acmeResult({ libraryPass: 'updated' }), true);
    expect(
      host.querySelector('[data-testid="library-stale-notice"]'),
    ).toBeNull();
  });

  it('emits dismissed from Dismiss', () => {
    render(acmeResult());
    const dismissed = jest.fn();
    component.dismissed.subscribe(dismissed);
    Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Dismiss')
      ?.click();
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
