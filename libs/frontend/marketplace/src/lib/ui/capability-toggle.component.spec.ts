/**
 * CapabilityToggleComponent specs (TASK_2026_560, Tasks 13.2 and 13.3).
 *
 * The accessible name carries the item name and its state and the control is a
 * native checkbox (AC-1.5); the scope-of-write text (AC-2.2); the badges,
 * including the workspace override (AC-2.4); the ptah-OFF warning (AC-4.6);
 * the next-session note (AC-4.9).
 *
 * The "not enforced" expectations are DERIVED from `CAPABILITY_ENFORCEMENT`
 * (AC-4.8, R6): when a provider starts enforcing, its row flips there and
 * these specs follow with no edit.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  CAPABILITY_ENFORCEMENT,
  PTAH_MCP_SERVER_NAME,
  defaultEnabled,
  type CapabilityDefaultInput,
  type CapabilityDefaultReason,
  type CapabilityEntry,
  type CapabilityKind,
  type CapabilityScope,
} from '@ptah-extension/shared';

import {
  CAPABILITY_SCOPE_TEXT,
  CapabilityToggleComponent,
  NEXT_SESSION_NOTE,
  PTAH_OFF_WARNING,
  capabilityBadges,
  capabilityControlState,
  notEnforcedProviders,
} from './capability-toggle.component';

function entry(overrides: Partial<CapabilityEntry> = {}): CapabilityEntry {
  return {
    kind: 'mcp',
    id: 'github',
    label: 'github',
    sources: [{ scope: 'global', path: '/home/u/.claude.json' }],
    effectiveEnabled: true,
    inheritedFrom: 'default',
    defaultReason: 'user-scope',
    ...overrides,
  };
}

/** The provider labels the table marks not-enforced for `kind`. */
function expectedNotEnforced(kind: CapabilityKind): string[] {
  return CAPABILITY_ENFORCEMENT.filter(
    (row) => row.kind === kind && row.status === 'not-enforced',
  ).map((row) => row.label);
}

describe('CapabilityToggleComponent', () => {
  let fixture: ComponentFixture<CapabilityToggleComponent>;
  let element: HTMLElement;
  let emitted: boolean[];

  function render(
    value: CapabilityEntry,
    scope: CapabilityScope = 'workspace',
    extra: { pending?: boolean; error?: string | null } = {},
  ): void {
    fixture = TestBed.createComponent(CapabilityToggleComponent);
    fixture.componentRef.setInput('entry', value);
    fixture.componentRef.setInput('scope', scope);
    if (extra.pending !== undefined) {
      fixture.componentRef.setInput('pending', extra.pending);
    }
    if (extra.error !== undefined) {
      fixture.componentRef.setInput('error', extra.error);
    }
    emitted = [];
    fixture.componentInstance.toggled.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const control = (): HTMLInputElement =>
    element.querySelector(
      '[data-testid="capability-toggle-input"]',
    ) as HTMLInputElement;

  const byTestId = (id: string): HTMLElement | null =>
    element.querySelector(`[data-testid="${id}"]`);

  // ── Accessible name and keyboard (AC-1.5) ──────────────────────────────────

  describe('accessible name and keyboard', () => {
    it('names the item and its on state', () => {
      render(entry());

      expect(control().getAttribute('aria-label')).toBe(
        'github: on (This workspace only)',
      );
      expect(control().checked).toBe(true);
    });

    it('names the item and its off state', () => {
      render(entry({ effectiveEnabled: false }));

      expect(control().getAttribute('aria-label')).toBe(
        'github: off (This workspace only)',
      );
      expect(control().checked).toBe(false);
    });

    it('is a native checkbox, so Tab reaches it and Space toggles it', () => {
      render(entry());

      expect(control().tagName).toBe('INPUT');
      expect(control().type).toBe('checkbox');
      expect(control().tabIndex).toBe(0);
      expect(control().disabled).toBe(false);
    });

    it('emits the value asked for and keeps showing the row until it changes', () => {
      render(entry());

      control().click();

      expect(emitted).toEqual([false]);
      expect(control().checked).toBe(true);
    });

    it('follows the row once it changes', () => {
      render(entry());

      fixture.componentRef.setInput(
        'entry',
        entry({ effectiveEnabled: false }),
      );
      fixture.detectChanges();

      expect(control().checked).toBe(false);
      expect(control().getAttribute('aria-label')).toBe(
        'github: off (This workspace only)',
      );
    });

    it('is disabled and busy while a write is in flight', () => {
      render(entry(), 'workspace', { pending: true });

      expect(control().disabled).toBe(true);
      expect(control().getAttribute('aria-busy')).toBe('true');
    });

    it('describes itself with the scope, badges and notes', () => {
      render(entry());

      const describedBy = control().getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = element.querySelector(`#${describedBy}`);
      expect(description?.textContent).toContain(
        CAPABILITY_SCOPE_TEXT.workspace,
      );
      expect(description?.textContent).toContain(NEXT_SESSION_NOTE);
    });
  });

  // ── Each scope shows its own value (AC-2.2, AC-2.4) ────────────────────────

  describe('scope value with a workspace override', () => {
    const globalOnWorkspaceOff = entry({
      effectiveEnabled: false,
      globalEnabled: true,
      workspaceEnabled: false,
      inheritedFrom: 'workspace',
    });
    const globalOffWorkspaceOn = entry({
      effectiveEnabled: true,
      globalEnabled: false,
      workspaceEnabled: true,
      inheritedFrom: 'workspace',
    });

    it('global on + workspace off: the workspace control is off', () => {
      render(globalOnWorkspaceOff, 'workspace');

      expect(control().checked).toBe(false);
      expect(control().getAttribute('aria-label')).toBe(
        'github: off (This workspace only)',
      );
      expect(byTestId('capability-toggle-scope')?.textContent).toContain(
        'This workspace only',
      );
    });

    it('global on + workspace off: the global control is on', () => {
      render(globalOnWorkspaceOff, 'global');

      expect(control().checked).toBe(true);
      expect(control().getAttribute('aria-label')).toBe(
        'github: on (All workspaces)',
      );
      expect(byTestId('capability-toggle-scope')?.textContent).toContain(
        'All workspaces',
      );
      expect(byTestId('capability-badge-override')).not.toBeNull();
    });

    it('global off + workspace on: the workspace control is on', () => {
      render(globalOffWorkspaceOn, 'workspace');

      expect(control().checked).toBe(true);
      expect(control().getAttribute('aria-label')).toBe(
        'github: on (This workspace only)',
      );
    });

    it('global off + workspace on: the global control is off, and toggling it asks for on', () => {
      render(globalOffWorkspaceOn, 'global');

      expect(control().checked).toBe(false);
      expect(control().getAttribute('aria-label')).toBe(
        'github: off (All workspaces)',
      );

      control().click();
      expect(emitted).toEqual([true]);
    });

    it('a global control with nothing recorded globally shows the default under an override', () => {
      const repoOverride = entry({
        effectiveEnabled: true,
        workspaceEnabled: true,
        inheritedFrom: 'workspace',
        defaultReason: 'repository-only',
      });

      expect(capabilityControlState(repoOverride, 'global')).toEqual({
        value: false,
        text: 'off',
      });
    });

    it('a global control while the policy is unreadable shows only a recorded global value', () => {
      expect(
        capabilityControlState(
          entry({ effectiveEnabled: null, globalEnabled: true }),
          'global',
        ),
      ).toEqual({ value: true, text: 'on' });
      expect(
        capabilityControlState(entry({ effectiveEnabled: null }), 'global'),
      ).toEqual({ value: null, text: 'state unknown' });
    });
  });

  // ── Default drift guard ────────────────────────────────────────────────────

  describe('global default matches the shared defaultEnabled rule', () => {
    /**
     * One minimal `defaultEnabled` input per reason. A `Record` over the
     * union, so a new `CapabilityDefaultReason` fails to compile here until it
     * is covered.
     */
    const INPUT_FOR_REASON: Record<
      CapabilityDefaultReason,
      CapabilityDefaultInput
    > = {
      ptah: { kind: 'mcp', id: PTAH_MCP_SERVER_NAME, scopes: [] },
      'user-scope': { kind: 'mcp', id: 'github', scopes: ['global'] },
      'repository-only': { kind: 'mcp', id: 'repo', scopes: ['workspace'] },
      undeclared: { kind: 'mcp', id: 'ghost', scopes: [] },
      skill: { kind: 'skill', id: 'review' },
      'plugin-opt-out': { kind: 'plugin', id: 'toolkit', source: 'harness' },
      'plugin-opt-in': { kind: 'plugin', id: 'toolkit', source: 'bundled' },
    };
    const reasons = Object.keys(INPUT_FOR_REASON) as CapabilityDefaultReason[];

    it.each(reasons)('%s', (reason) => {
      const shared = defaultEnabled(INPUT_FOR_REASON[reason]);
      expect(shared.reason).toBe(reason);

      // A global control with nothing recorded globally, under a workspace
      // override that disagrees, can only show the default from its table.
      const overridden = entry({
        kind: INPUT_FOR_REASON[reason].kind,
        effectiveEnabled: !shared.enabled,
        workspaceEnabled: !shared.enabled,
        inheritedFrom: 'workspace',
        defaultReason: reason,
      });

      expect(capabilityControlState(overridden, 'global').value).toBe(
        shared.enabled,
      );
    });
  });

  // ── Scope of write (AC-2.2) and next session (AC-4.9) ──────────────────────

  describe('scope-of-write text', () => {
    it('says "This workspace only" for a workspace control', () => {
      render(entry(), 'workspace');

      expect(byTestId('capability-toggle-scope')?.textContent).toContain(
        'This workspace only',
      );
    });

    it('says "All workspaces" for a global control', () => {
      render(entry(), 'global');

      expect(byTestId('capability-toggle-scope')?.textContent).toContain(
        'All workspaces',
      );
    });

    it('says that changes apply to the next session', () => {
      render(entry());

      expect(byTestId('capability-toggle-scope')?.textContent).toContain(
        'Changes apply to the next session.',
      );
    });
  });

  // ── Badges ─────────────────────────────────────────────────────────────────

  describe('badges', () => {
    it('shows the workspace override (AC-2.4)', () => {
      render(
        entry({
          effectiveEnabled: false,
          workspaceEnabled: false,
          globalEnabled: true,
          inheritedFrom: 'workspace',
        }),
      );

      expect(byTestId('capability-badge-override')?.textContent).toContain(
        'Workspace override',
      );
      expect(byTestId('capability-badge-inheriting')).toBeNull();
    });

    it('shows "Follows global" on a workspace control that inherits', () => {
      render(entry({ inheritedFrom: 'global', globalEnabled: true }));

      expect(byTestId('capability-badge-inheriting')?.textContent).toContain(
        'Follows global',
      );
    });

    it('shows no inheriting badge on a global control', () => {
      render(entry({ inheritedFrom: 'global' }), 'global');

      expect(byTestId('capability-badge-inheriting')).toBeNull();
    });

    it('marks a repository-only server that is not yet decided as new', () => {
      render(
        entry({
          id: 'repo-server',
          label: 'repo-server',
          effectiveEnabled: false,
          defaultReason: 'repository-only',
        }),
      );

      expect(
        byTestId('capability-badge-new-workspace-server')?.textContent,
      ).toContain('New in this workspace');
    });

    it('marks an imported value', () => {
      render(entry({ inheritedFrom: 'imported', importedFromClaude: true }));

      expect(byTestId('capability-badge-imported')?.textContent).toContain(
        'Imported',
      );
    });

    it('marks a skill held off by its plugin, naming the plugin', () => {
      const skill = entry({
        kind: 'skill',
        id: 'toolkit:review',
        label: 'review',
        parentId: 'toolkit',
        effectiveEnabled: false,
        inheritedFrom: 'parent-plugin',
        defaultReason: 'skill',
      });

      expect(capabilityBadges(skill, 'workspace')).toEqual([
        expect.objectContaining({
          id: 'parent-off',
          detail: 'Off because its plugin toolkit is off.',
        }),
      ]);
    });

    it('marks an unknown state and shows the recorded value', () => {
      render(
        entry({
          effectiveEnabled: null,
          workspaceEnabled: false,
          inheritedFrom: 'workspace',
        }),
      );

      expect(byTestId('capability-badge-unknown')?.textContent).toContain(
        'Unknown',
      );
      expect(control().checked).toBe(false);
      expect(control().indeterminate).toBe(false);
      expect(control().getAttribute('aria-label')).toBe(
        'github: set off, effective state unknown (This workspace only)',
      );
    });

    it('is indeterminate when the state is unknown and nothing is recorded', () => {
      render(entry({ effectiveEnabled: null }));

      expect(control().indeterminate).toBe(true);
      expect(control().getAttribute('aria-label')).toBe(
        'github: state unknown (This workspace only)',
      );

      control().click();
      expect(emitted).toEqual([true]);
    });
  });

  // ── Not enforced (AC-4.8, R6) ──────────────────────────────────────────────

  describe('not-enforced labels', () => {
    const kinds: CapabilityKind[] = ['mcp', 'skill', 'plugin'];

    it.each(kinds)(
      'lists exactly the %s providers CAPABILITY_ENFORCEMENT marks not-enforced',
      (kind) => {
        const expected = expectedNotEnforced(kind);

        expect(notEnforcedProviders({ kind })).toEqual(expected);

        render(entry({ kind, id: `${kind}-item`, label: `${kind}-item` }));
        const label = byTestId('capability-not-enforced');
        if (expected.length === 0) {
          expect(label).toBeNull();
        } else {
          expect(label?.textContent?.trim()).toBe(
            `Not enforced for ${expected.join(', ')}`,
          );
        }
      },
    );

    it('leaves the note to the caller when showNotEnforced is false', () => {
      render(entry({ kind: 'mcp' }));
      fixture.componentRef.setInput('showNotEnforced', false);
      fixture.detectChanges();

      expect(byTestId('capability-not-enforced')).toBeNull();
    });
  });

  // ── ptah OFF (AC-4.6) ──────────────────────────────────────────────────────

  describe('ptah OFF warning', () => {
    const ptah = (enabled: boolean | null): CapabilityEntry =>
      entry({
        id: PTAH_MCP_SERVER_NAME,
        label: 'Ptah',
        effectiveEnabled: enabled,
        defaultReason: 'ptah',
        ...(enabled === false
          ? { workspaceEnabled: false, inheritedFrom: 'workspace' }
          : {}),
      });

    it('warns that agent lanes, memory and browser become unavailable when ptah is off', () => {
      render(ptah(false));

      const warning = byTestId('capability-ptah-off-warning');
      expect(warning?.textContent?.trim()).toBe(PTAH_OFF_WARNING);
      expect(warning?.textContent).toContain('agent lanes');
      expect(warning?.textContent).toContain('memory');
      expect(warning?.textContent).toContain('browser');
    });

    it('shows no warning while ptah is on', () => {
      render(ptah(true));

      expect(byTestId('capability-ptah-off-warning')).toBeNull();
    });

    it('warns on a global control that has ptah off, even where this workspace keeps it on', () => {
      render(
        entry({
          id: PTAH_MCP_SERVER_NAME,
          label: 'Ptah',
          effectiveEnabled: true,
          globalEnabled: false,
          workspaceEnabled: true,
          inheritedFrom: 'workspace',
          defaultReason: 'ptah',
        }),
        'global',
      );

      expect(byTestId('capability-ptah-off-warning')).not.toBeNull();
    });

    it('shows no warning for another server that is off', () => {
      render(entry({ effectiveEnabled: false }));

      expect(byTestId('capability-ptah-off-warning')).toBeNull();
    });
  });

  // ── Error (AC-1.4) ─────────────────────────────────────────────────────────

  describe('error', () => {
    it('shows the row error as an alert', () => {
      render(entry(), 'workspace', {
        error: "Couldn't turn github off: EACCES",
      });

      const error = byTestId('capability-toggle-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent?.trim()).toBe(
        "Couldn't turn github off: EACCES",
      );
    });

    it('shows nothing without an error', () => {
      render(entry());

      expect(byTestId('capability-toggle-error')).toBeNull();
    });
  });
});
