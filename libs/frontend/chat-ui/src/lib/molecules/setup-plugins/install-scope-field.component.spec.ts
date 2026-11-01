/**
 * InstallScopeFieldComponent — the shared install-scope radios (design-spec
 * §2 "Shared control"). Axes:
 *
 *   - **Native semantics**: a `fieldset` named by its `legend`, two native
 *     radios sharing one name, no `role="radiogroup"`, help as description.
 *   - **Workspace default**: the caller's `'workspace'` is drawn checked.
 *   - **No folder (AC4)**: This workspace is disabled, nothing is checked,
 *     the help is a `role=status` line, and only an explicit All workspaces
 *     selects anything. `effectiveInstallScope` never yields `'workspace'`.
 *   - **Copy**: the per-kind help lines and the skills button labels.
 */

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  INSTALL_SCOPE_NO_FOLDER_HELP,
  InstallScopeFieldComponent,
  defaultInstallScope,
  effectiveInstallScope,
  installScopeButtonLabel,
  type InstallScopeChoice,
  type InstallScopeItemKind,
} from './install-scope-field.component';

@Component({
  standalone: true,
  imports: [InstallScopeFieldComponent],
  template: `
    <ptah-install-scope-field
      [legend]="legend()"
      [itemKind]="itemKind()"
      [workspaceName]="workspaceName()"
      [disabled]="disabled()"
      [noFolderHelp]="noFolderHelp()"
      [(scope)]="scope"
    />
    <ptah-install-scope-field
      legend="Second"
      itemKind="skill"
      workspaceName="other"
      [(scope)]="otherScope"
    />
  `,
})
class HostComponent {
  readonly legend = signal('Install to');
  readonly itemKind = signal<InstallScopeItemKind>('skill');
  readonly workspaceName = signal<string | null>('acme-app');
  readonly disabled = signal(false);
  readonly noFolderHelp = signal<string | null>(null);
  readonly scope = signal<InstallScopeChoice>('workspace');
  readonly otherScope = signal<InstallScopeChoice>('workspace');
}

describe('InstallScopeFieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const field = (): HTMLFieldSetElement =>
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLFieldSetElement>(
      '[data-testid="install-scope-field"]',
    )[0];
  const radios = (): HTMLInputElement[] =>
    Array.from(field().querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const workspaceRadio = (): HTMLInputElement => radios()[0];
  const globalRadio = (): HTMLInputElement => radios()[1];
  const help = (): HTMLElement =>
    field().querySelector<HTMLElement>('[data-testid="install-scope-help"]')!;
  const render = (): void => fixture.detectChanges();

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    render();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('is a native fieldset named by its legend, with two native radios in one group', () => {
    expect(field().tagName).toBe('FIELDSET');
    expect(field().querySelector('legend')?.textContent?.trim()).toBe(
      'Install to',
    );
    expect(field().querySelector('[role="radiogroup"]')).toBeNull();
    expect(field().getAttribute('role')).toBeNull();
    expect(radios()).toHaveLength(2);
    const names = new Set(radios().map((radio) => radio.name));
    expect(names.size).toBe(1);
    const labels = radios().map((radio) =>
      radio.closest('label')?.textContent?.trim(),
    );
    expect(labels).toEqual(['This workspace', 'All workspaces']);
    expect(field().getAttribute('aria-describedby')).toBe(help().id);
  });

  it('gives each field instance its own radio group and help id', () => {
    const fields = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="install-scope-field"]',
    );
    const second = fields[1] as HTMLElement;
    const secondRadio = second.querySelector<HTMLInputElement>('input')!;
    expect(secondRadio.name).not.toBe(workspaceRadio().name);
    expect(second.getAttribute('aria-describedby')).not.toBe(help().id);
  });

  it('draws the workspace default as checked and primary', () => {
    expect(workspaceRadio().checked).toBe(true);
    expect(globalRadio().checked).toBe(false);
    expect(workspaceRadio().closest('label')?.classList).toContain(
      'btn-primary',
    );
    expect(help().textContent?.trim()).toBe(
      'Only acme-app will get this skill. You can make it global later.',
    );
    expect(help().getAttribute('role')).toBeNull();
  });

  it('writes an explicit All workspaces choice back to the caller', () => {
    globalRadio().click();
    render();

    expect(host.scope()).toBe('global');
    expect(globalRadio().checked).toBe(true);
    expect(help().textContent?.trim()).toBe(
      'Every workspace will get this skill.',
    );
  });

  it('uses the MCP help lines for a server install', () => {
    host.itemKind.set('server');
    render();
    expect(help().textContent?.trim()).toBe(
      'This workspace writes only project files. Tools that keep settings in your home folder need All workspaces.',
    );

    host.scope.set('global');
    render();
    expect(help().textContent?.trim()).toBe(
      'Every workspace will get this server.',
    );
  });

  it('with no folder open: This workspace disabled, nothing selected, status help', () => {
    host.workspaceName.set(null);
    render();

    expect(workspaceRadio().disabled).toBe(true);
    expect(globalRadio().disabled).toBe(false);
    expect(radios().every((radio) => !radio.checked)).toBe(true);
    expect(help().getAttribute('role')).toBe('status');
    expect(help().textContent?.trim()).toBe(INSTALL_SCOPE_NO_FOLDER_HELP);
  });

  it('with no folder open: only an explicit All workspaces selects anything', () => {
    host.workspaceName.set(null);
    host.scope.set(null);
    render();

    workspaceRadio().click();
    render();
    expect(host.scope()).toBeNull();

    globalRadio().click();
    render();
    expect(host.scope()).toBe('global');
    expect(globalRadio().checked).toBe(true);
    expect(help().getAttribute('role')).toBeNull();
  });

  it('lets a surface replace the no-folder help line', () => {
    host.workspaceName.set(null);
    host.noFolderHelp.set(
      'No folder is open, so these servers will be skipped.',
    );
    render();

    expect(help().textContent?.trim()).toBe(
      'No folder is open, so these servers will be skipped.',
    );
  });

  it('disables both options while the caller is busy', () => {
    host.disabled.set(true);
    render();

    expect(field().disabled).toBe(true);
  });

  describe('pure helpers', () => {
    it('defaults to This workspace with a folder, to nothing without one', () => {
      expect(defaultInstallScope(true)).toBe('workspace');
      expect(defaultInstallScope(false)).toBeNull();
    });

    it('never lets a workspace choice through with no folder open', () => {
      expect(effectiveInstallScope('workspace', true)).toBe('workspace');
      expect(effectiveInstallScope('workspace', false)).toBeNull();
      expect(effectiveInstallScope('global', false)).toBe('global');
      expect(effectiveInstallScope(null, true)).toBeNull();
    });

    it('labels the skills primary button by scope', () => {
      expect(installScopeButtonLabel('workspace')).toBe(
        'Install to this workspace',
      );
      expect(installScopeButtonLabel('global')).toBe(
        'Install to all workspaces',
      );
    });
  });
});
