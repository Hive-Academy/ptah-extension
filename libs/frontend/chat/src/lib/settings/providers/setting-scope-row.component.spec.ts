/**
 * SettingScopeRowComponent specs — TASK_2026_523_c3df, group D1 (scope row).
 *
 * Coverage (design-spec.md, "Scope affordance spec" and implementation plan
 * Decision 6 / Testability pin 6):
 *   - source badge text and icon per scope, including the Workspace
 *     "(Desktop)" / "(All Ptah apps)" variants
 *   - "Mixed sources" instead of a guessed group scope
 *   - "App default · Not configured" (or the host's default copy) when
 *     nothing is stored
 *   - the override control hidden entirely when supportedTargets is
 *     ['global'] — scope is honest about writes
 *   - the override control shown for inherited values, labelled by target
 *   - "Clear override" with the "Will use {value} from {source}." preview
 *   - "Use global value" only when an intermediate App layer remains
 *   - the credential line separate from scope, and absent for non-secrets
 *   - disabled controls keep their explanatory text
 *   - accessible names include the field name
 *   - 36 px control height and the 2 px focus outline on every button
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SettingScopeRowComponent } from './setting-scope-row.component';

type RowInputs = {
  [K in keyof SettingScopeRowComponent]: unknown;
};

function createComponent(
  inputs: Partial<RowInputs> = {},
): ComponentFixture<SettingScopeRowComponent> {
  const fixture = TestBed.createComponent(SettingScopeRowComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

function query(
  fixture: ComponentFixture<SettingScopeRowComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function button(
  fixture: ComponentFixture<SettingScopeRowComponent>,
  testId: string,
): HTMLButtonElement | null {
  return query(fixture, testId) as HTMLButtonElement | null;
}

describe('SettingScopeRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingScopeRowComponent],
    }).compileComponents();
  });

  describe('source badge', () => {
    it('renders the Global source badge with the Globe icon', () => {
      const fixture = createComponent({ scope: 'global' });
      const badge = query(fixture, 'scope-source-badge');
      expect(badge?.textContent?.trim()).toBe('From Global · All Ptah apps');
      expect(badge?.querySelector('lucide-angular')).not.toBeNull();
    });

    it('renders the App source badge with the Cpu icon', () => {
      const fixture = createComponent({ scope: 'app' });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'From App · Desktop',
      );
    });

    it('renders the Workspace source badge with the workspace name and Desktop suffix', () => {
      const fixture = createComponent({
        scope: 'workspace',
        workspaceName: 'ptah-extension',
      });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'From Workspace · ptah-extension (Desktop)',
      );
    });

    it('renders the All Ptah apps suffix when the workspace source is cross-app', () => {
      const fixture = createComponent({
        scope: 'workspace',
        workspaceName: 'ptah-extension',
        workspaceCrossApp: true,
      });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'From Workspace · ptah-extension (All Ptah apps)',
      );
    });

    it('renders Mixed sources when the group does not share one scope', () => {
      const fixture = createComponent({ scope: 'mixed' });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'Mixed sources',
      );
      expect(button(fixture, 'scope-override')).toBeNull();
      expect(button(fixture, 'scope-clear-override')).toBeNull();
    });

    it('renders the App default badge when nothing is stored', () => {
      const fixture = createComponent({ scope: null });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'App default · Not configured',
      );
    });

    it('renders the host-supplied default copy when nothing is stored', () => {
      const fixture = createComponent({
        scope: null,
        defaultLabel: 'App default · 120 seconds',
      });
      expect(query(fixture, 'scope-source-badge')?.textContent?.trim()).toBe(
        'App default · 120 seconds',
      );
    });
  });

  describe('override control', () => {
    it('hides every override and clear control when supportedTargets is [global]', () => {
      const fixture = createComponent({
        scope: 'global',
        hasOverride: true,
        supportedTargets: ['global'],
      });
      expect(button(fixture, 'scope-override')).toBeNull();
      expect(button(fixture, 'scope-clear-override')).toBeNull();
      expect(button(fixture, 'scope-use-global')).toBeNull();
      expect(button(fixture, 'scope-copy-global')).toBeNull();
    });

    it('hides the override control when the targets are unknown', () => {
      const fixture = createComponent({ scope: 'global', supportedTargets: [] });
      expect(button(fixture, 'scope-override')).toBeNull();
    });

    it('shows Override for this workspace for an inherited value and emits the intent', () => {
      const fixture = createComponent({
        scope: 'global',
        supportedTargets: ['global', 'app', 'workspace'],
      });
      const emitted = jest.fn();
      fixture.componentInstance.overrideRequested.subscribe(emitted);
      button(fixture, 'scope-override')?.click();
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('emits clearRequested from the Clear override button', () => {
      const fixture = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        fallbackPreview: { scope: 'global', value: 'sonnet' },
      });
      const emitted = jest.fn();
      fixture.componentInstance.clearRequested.subscribe(emitted);
      button(fixture, 'scope-clear-override')?.click();
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('emits useGlobalRequested and copyGlobalRequested from their buttons', () => {
      const fixture = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        hasIntermediateAppLayer: true,
        showCopyGlobal: true,
        fallbackPreview: { scope: 'app', value: 'sonnet' },
      });
      const useGlobalEmitted = jest.fn();
      const copyGlobalEmitted = jest.fn();
      fixture.componentInstance.useGlobalRequested.subscribe(useGlobalEmitted);
      fixture.componentInstance.copyGlobalRequested.subscribe(copyGlobalEmitted);
      button(fixture, 'scope-use-global')?.click();
      button(fixture, 'scope-copy-global')?.click();
      expect(useGlobalEmitted).toHaveBeenCalledTimes(1);
      expect(copyGlobalEmitted).toHaveBeenCalledTimes(1);
    });

    it('labels the override control for the app target when workspace is unsupported', () => {
      const fixture = createComponent({
        scope: 'global',
        supportedTargets: ['global', 'app'],
      });
      expect(button(fixture, 'scope-override')?.textContent?.trim()).toBe(
        'Override for this app',
      );
    });

    it('disables the override control while the host is busy', () => {
      const fixture = createComponent({
        scope: 'global',
        supportedTargets: ['global', 'app', 'workspace'],
        disabled: true,
        disabledReason: 'Saving…',
      });
      const override = button(fixture, 'scope-override');
      expect(override?.disabled).toBe(true);
      expect(
        query(fixture, 'scope-disabled-reason')?.textContent?.trim(),
      ).toBe('Saving…');
    });
  });

  describe('clear override', () => {
    it('shows Clear override with the fallback preview before the action is taken', () => {
      const fixture = createComponent({
        scope: 'workspace',
        workspaceName: 'ptah-extension',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        fallbackPreview: { scope: 'global', value: 'claude-opus-4' },
      });
      expect(query(fixture, 'scope-clear-preview')?.textContent?.trim()).toBe(
        'Will use claude-opus-4 from Global.',
      );
      expect(button(fixture, 'scope-clear-override')).not.toBeNull();
      expect(button(fixture, 'scope-override')).toBeNull();
    });

    it('renders the host-supplied fallback value label verbatim', () => {
      const fixture = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        fallbackPreview: { scope: 'global', value: 'apiKey' },
        fallbackValueLabel: 'CLI subscription',
      });
      expect(query(fixture, 'scope-clear-preview')?.textContent?.trim()).toBe(
        'Will use CLI subscription from Global.',
      );
    });

    it('renders a neutral copy for a non-primitive fallback value', () => {
      const fixture = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        fallbackPreview: { scope: 'app', value: { nested: true } },
      });
      expect(query(fixture, 'scope-clear-preview')?.textContent?.trim()).toBe(
        'Will use the previous value from the Desktop app.',
      );
    });

    it('shows Use global value only when an intermediate App layer remains', () => {
      const withLayer = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        hasIntermediateAppLayer: true,
        fallbackPreview: { scope: 'app', value: 'sonnet' },
      });
      expect(button(withLayer, 'scope-use-global')).not.toBeNull();

      const withoutLayer = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        hasIntermediateAppLayer: false,
      });
      expect(button(withoutLayer, 'scope-use-global')).toBeNull();
    });

    it('shows Copy global value to this workspace only when the host offers it', () => {
      const offered = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        showCopyGlobal: true,
      });
      expect(button(offered, 'scope-copy-global')).not.toBeNull();

      const notOffered = createComponent({
        scope: 'workspace',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        showCopyGlobal: false,
      });
      expect(button(notOffered, 'scope-copy-global')).toBeNull();
    });
  });

  describe('credential line', () => {
    it('shows the machine secret store line separately from scope', () => {
      const fixture = createComponent({
        scope: 'workspace',
        supportedTargets: ['global', 'app', 'workspace'],
        credentialSource: 'machine-secret-store',
      });
      expect(query(fixture, 'scope-credential')?.textContent?.trim()).toBe(
        'Credential: stored on this machine',
      );
    });

    it('shows the host-supplied credential description when given', () => {
      const fixture = createComponent({
        scope: 'workspace',
        supportedTargets: ['global', 'app', 'workspace'],
        credentialSource: 'host-supplied',
        credentialDescription: 'Credential: managed by the CLI login',
      });
      expect(query(fixture, 'scope-credential')?.textContent?.trim()).toBe(
        'Credential: managed by the CLI login',
      );
    });

    it('shows no credential line for a plain setting', () => {
      const fixture = createComponent({
        scope: 'global',
        supportedTargets: ['global', 'app', 'workspace'],
        credentialSource: 'not-a-secret',
      });
      expect(query(fixture, 'scope-credential')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('includes the field name in button accessible names', () => {
      const fixture = createComponent({
        scope: 'global',
        supportedTargets: ['global', 'app', 'workspace'],
        fieldName: 'Model for everyday work',
      });
      const override = button(fixture, 'scope-override');
      expect(override?.getAttribute('aria-label')).toBe(
        'Override for this workspace: Model for everyday work',
      );
    });

    it('gives every button the 36 px minimum height and the 2 px focus outline', () => {
      const fixture = createComponent({
        scope: 'workspace',
        workspaceName: 'ptah-extension',
        hasOverride: true,
        supportedTargets: ['global', 'app', 'workspace'],
        hasIntermediateAppLayer: true,
        showCopyGlobal: true,
      });
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ) as HTMLButtonElement[];
      expect(buttons.length).toBe(3);
      for (const element of buttons) {
        expect(element.className).toContain('min-h-9');
        expect(element.className).toContain('focus-visible:outline-2');
        expect(element.className).toContain(
          'focus-visible:outline-base-content',
        );
      }
    });

    it('keeps the mixed-sources badge outside the control flow', () => {
      const fixture = createComponent({ scope: 'mixed' });
      expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
    });
  });
});