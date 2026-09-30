/**
 * SettingScopeRowComponent specs — TASK_2026_555 Batch 23 (design-spec §3.2, plan D16, RUX-6).
 *
 * Coverage:
 *   - nothing renders while a value is inherited (every scope, every target set)
 *   - an override renders `data-testid="scope-badge"` with a non-empty `data-field` and the text
 *     "{short field} · {Workspace|App}", falling back to the full field name
 *   - a mixed or unknown source renders a neutral "Mixed sources" badge, never a guessed scope
 *   - colour sits on the badge border, fill and icon; the text stays text-base-content (deviation 6)
 *   - the popover is headed by the full field name, lists the layers with the winning one marked,
 *     and holds the Clear override / Use global value / Copy global actions with the clear preview
 *   - each action closes the popover and emits its intent (the host owns review and writes)
 *   - global-only keys offer no action; a disabled host keeps the badge, disables the actions and
 *     keeps its reason visible
 *   - the credential line stays separate from scope
 *   - accessible names include the field name; popover actions keep 36 px and the focus outline
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SettingScopeRowComponent } from './setting-scope-row.component';

type RowInputs = {
  [K in keyof SettingScopeRowComponent]: unknown;
};

const ALL_TARGETS = ['global', 'app', 'workspace'];
const WORKSPACE_OVERRIDE = {
  fieldName: 'Reasoning effort',
  shortFieldName: 'Effort',
  scope: 'workspace',
  hasOverride: true,
  supportedTargets: ALL_TARGETS,
  workspaceName: 'ptah-extension',
  fallbackPreview: { scope: 'global', value: 'medium' },
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

/** Badge text without the screen-reader suffix. */
function badgeText(fixture: ComponentFixture<SettingScopeRowComponent>): string | undefined {
  const badge = query(fixture, 'scope-badge');
  if (!badge) return undefined;
  const clone = badge.cloneNode(true) as HTMLElement;
  clone.querySelector('.sr-only')?.remove();
  return clone.textContent?.trim();
}

function openPopover(fixture: ComponentFixture<SettingScopeRowComponent>): void {
  button(fixture, 'scope-badge')?.click();
  fixture.detectChanges();
}

describe('SettingScopeRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingScopeRowComponent],
    }).compileComponents();
  });

  describe('inherited values render nothing (RUX-6)', () => {
    it.each([
      ['global', ALL_TARGETS],
      ['workspace', ALL_TARGETS],
      ['app', ['global', 'app']],
      [null, ALL_TARGETS],
      ['global', ['global']],
    ])('scope %s with targets %j and no override', (scope, supportedTargets) => {
      const fixture = createComponent({ fieldName: 'Main agent model', scope, supportedTargets, hasOverride: false });
      expect(fixture.nativeElement.textContent.trim()).toBe('');
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
    });
  });

  describe('badge (D16)', () => {
    it('names the field and the scope: "{short} · Workspace", with a non-empty data-field', () => {
      const fixture = createComponent(WORKSPACE_OVERRIDE);
      const badge = query(fixture, 'scope-badge');
      expect(badge?.tagName).toBe('BUTTON');
      expect(badge?.getAttribute('data-field')).toBe('Reasoning effort');
      expect(badgeText(fixture)).toBe('Effort · Workspace');
    });

    it('an App override reads "{short} · App"', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, fieldName: 'Main agent provider', shortFieldName: 'Provider', scope: 'app' });
      expect(badgeText(fixture)).toBe('Provider · App');
    });

    it('falls back to the full field name when no short name is given', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, shortFieldName: null });
      expect(badgeText(fixture)).toBe('Reasoning effort · Workspace');
    });

    it('a mixed or unknown source is a neutral "Mixed sources" badge, never a guessed scope', () => {
      const fixture = createComponent({ fieldName: 'Judge lane provider', scope: 'mixed', supportedTargets: ['global'] });
      expect(badgeText(fixture)).toBe('Judge lane provider · Mixed sources');
      expect(query(fixture, 'scope-badge')?.className).toContain('border-base-content-muted');
      openPopover(fixture);
      expect(query(fixture, 'scope-mixed-note')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[aria-current="true"]')).toBeNull();
      expect(button(fixture, 'scope-clear-override')).toBeNull();
    });

    it('puts colour on the border, fill and icon only; the text stays text-base-content (deviation 6)', () => {
      const workspace = createComponent(WORKSPACE_OVERRIDE);
      const badge = query(workspace, 'scope-badge');
      expect(badge?.className).toContain('border-secondary/40');
      expect(badge?.className).toContain('bg-secondary/10');
      expect(badge?.className).toContain('text-base-content');
      expect(badge?.className).not.toMatch(/(^|\s)text-(secondary|info)(\s|$)/);
      // lucide-angular applies its `class` input to the rendered <svg>.
      expect(badge?.querySelector('lucide-angular')?.innerHTML).toContain('text-secondary');

      const app = createComponent({ ...WORKSPACE_OVERRIDE, scope: 'app' });
      expect(query(app, 'scope-badge')?.className).toContain('border-info/40');
    });

    it('its accessible name starts with the visible text and names the field', () => {
      const fixture = createComponent(WORKSPACE_OVERRIDE);
      const badge = query(fixture, 'scope-badge');
      expect(badge?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Effort · Workspace, Reasoning effort scope details');
      expect(badge?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(badge?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('popover', () => {
    it('opens from the badge, headed by the full field name, with the layers and the winning one marked', () => {
      const fixture = createComponent(WORKSPACE_OVERRIDE);
      expect(query(fixture, 'scope-popover')).toBeNull();
      openPopover(fixture);
      expect(query(fixture, 'scope-badge')?.getAttribute('aria-expanded')).toBe('true');
      expect(query(fixture, 'scope-popover-title')?.textContent?.trim()).toBe('Reasoning effort');
      const layers = Array.from(fixture.nativeElement.querySelectorAll('[data-layer]')) as HTMLElement[];
      expect(layers.map((layer) => layer.getAttribute('data-layer'))).toEqual(['global', 'app', 'workspace']);
      expect(layers[2].textContent).toContain('Workspace · ptah-extension');
      expect(layers[2].getAttribute('aria-current')).toBe('true');
      expect(layers[2].textContent).toContain('In use');
      expect(layers[0].textContent).toContain('Used after clear');
    });

    it('lists only the layers that can hold the value', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, supportedTargets: ['global', 'workspace'] });
      openPopover(fixture);
      const layers = Array.from(fixture.nativeElement.querySelectorAll('[data-layer]')) as HTMLElement[];
      expect(layers.map((layer) => layer.getAttribute('data-layer'))).toEqual(['global', 'workspace']);
    });

    it('marks a cross-app workspace source', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, workspaceCrossApp: true });
      openPopover(fixture);
      expect(fixture.nativeElement.querySelector('[data-layer="workspace"]')?.textContent).toContain('(All Ptah apps)');
    });

    it('Clear override shows the fallback preview, closes the popover and emits clearRequested', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, fallbackPreview: { scope: 'global', value: 'claude-opus-4' } });
      const emitted = jest.fn();
      fixture.componentInstance.clearRequested.subscribe(emitted);
      openPopover(fixture);
      expect(query(fixture, 'scope-clear-preview')?.textContent?.trim()).toBe('Will use claude-opus-4 from Global.');
      button(fixture, 'scope-clear-override')?.click();
      fixture.detectChanges();
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(query(fixture, 'scope-popover')).toBeNull();
    });

    it('renders the host-supplied fallback value label verbatim, and neutral copy for a non-primitive value', () => {
      const labelled = createComponent({ ...WORKSPACE_OVERRIDE, fallbackPreview: { scope: 'global', value: 'apiKey' }, fallbackValueLabel: 'CLI subscription' });
      openPopover(labelled);
      expect(query(labelled, 'scope-clear-preview')?.textContent?.trim()).toBe('Will use CLI subscription from Global.');

      const nested = createComponent({ ...WORKSPACE_OVERRIDE, fallbackPreview: { scope: 'app', value: { nested: true } } });
      openPopover(nested);
      expect(query(nested, 'scope-clear-preview')?.textContent?.trim()).toBe('Will use the previous value from the Desktop app.');
    });

    it('Use global value appears only above an App layer; Copy global only when offered; each emits', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, hasIntermediateAppLayer: true, showCopyGlobal: true,
        fallbackPreview: { scope: 'app', value: 'sonnet' } });
      const useGlobal = jest.fn();
      const copyGlobal = jest.fn();
      fixture.componentInstance.useGlobalRequested.subscribe(useGlobal);
      fixture.componentInstance.copyGlobalRequested.subscribe(copyGlobal);
      openPopover(fixture);
      button(fixture, 'scope-use-global')?.click();
      fixture.detectChanges();
      openPopover(fixture);
      button(fixture, 'scope-copy-global')?.click();
      expect(useGlobal).toHaveBeenCalledTimes(1);
      expect(copyGlobal).toHaveBeenCalledTimes(1);

      const plain = createComponent(WORKSPACE_OVERRIDE);
      openPopover(plain);
      expect(button(plain, 'scope-use-global')).toBeNull();
      expect(button(plain, 'scope-copy-global')).toBeNull();
    });

    it('a global-only key offers no action', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, supportedTargets: ['global'] });
      openPopover(fixture);
      expect(button(fixture, 'scope-clear-override')).toBeNull();
      expect(query(fixture, 'scope-clear-preview')).toBeNull();
    });

    it('a busy host keeps the badge, disables the actions and shows why', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, hasIntermediateAppLayer: true, disabled: true, disabledReason: 'Saving…' });
      expect(button(fixture, 'scope-badge')?.disabled).toBe(false);
      openPopover(fixture);
      expect(button(fixture, 'scope-clear-override')?.disabled).toBe(true);
      expect(button(fixture, 'scope-use-global')?.disabled).toBe(true);
      expect(query(fixture, 'scope-disabled-reason')?.textContent?.trim()).toBe('Saving…');
    });
  });

  describe('credential line', () => {
    it('shows the machine secret store line, or the host description, separately from scope', () => {
      const stored = createComponent({ ...WORKSPACE_OVERRIDE, credentialSource: 'machine-secret-store' });
      openPopover(stored);
      expect(query(stored, 'scope-credential')?.textContent?.trim()).toBe('Credential: stored on this machine');

      const host = createComponent({ ...WORKSPACE_OVERRIDE, credentialSource: 'host-supplied', credentialDescription: 'Credential: managed by the CLI login' });
      openPopover(host);
      expect(query(host, 'scope-credential')?.textContent?.trim()).toBe('Credential: managed by the CLI login');
    });

    it('shows no credential line for a plain setting', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, credentialSource: 'not-a-secret' });
      openPopover(fixture);
      expect(query(fixture, 'scope-credential')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('includes the field name in every action\'s accessible name', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, hasIntermediateAppLayer: true, showCopyGlobal: true });
      openPopover(fixture);
      expect(button(fixture, 'scope-clear-override')?.getAttribute('aria-label')).toBe('Clear override: Reasoning effort');
      expect(button(fixture, 'scope-use-global')?.getAttribute('aria-label')).toBe('Use global value: Reasoning effort');
      expect(button(fixture, 'scope-copy-global')?.getAttribute('aria-label')).toBe('Copy global value to this workspace: Reasoning effort');
      expect(query(fixture, 'scope-popover')?.getAttribute('aria-label')).toBe('Reasoning effort scope');
    });

    it('gives every popover action the 36 px minimum height and the 2 px focus outline', () => {
      const fixture = createComponent({ ...WORKSPACE_OVERRIDE, hasIntermediateAppLayer: true, showCopyGlobal: true });
      openPopover(fixture);
      const actions = Array.from(query(fixture, 'scope-popover')?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
      expect(actions.length).toBe(3);
      for (const element of actions) {
        expect(element.className).toContain('min-h-9');
        expect(element.className).toContain('focus-visible:outline-2');
        expect(element.className).toContain('focus-visible:outline-base-content');
      }
      expect(query(fixture, 'scope-badge')?.className).toContain('focus-visible:outline-2');
    });
  });
});
