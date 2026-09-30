/**
 * ProviderConnectionCardComponent specs — TASK_2026_555 Batch 24 (compact card, plan :627-636).
 *
 * The state table itself (label, copy, tone, dot, primary action) is pinned in
 * `provider-connection-card.state.spec.ts`. These specs pin what the component renders from it:
 * - the whole card is one activation target: click, Enter and Space emit `detailsRequested`, a click
 *   on the inline action never does (RUX-4: every card opens its drawer);
 * - two rows: initials avatar, name, provenance, auth-modality badge; status dot + label, at most one
 *   inline action (`btn-xs`), "Used by N";
 * - each state's single inline action emits its own output, with an accessible name naming the
 *   provider; Active and Checking carry none;
 * - the state-table copy is the card's accessible name and tooltip;
 * - never Connected without confirmed evidence; a blocked main route says it needs attention;
 * - colour on the dot, avatar and badges only; the kept testids (provider-connection-card,
 *   provider-name, status-copy, auth-modality) are present;
 * - a D16 scope badge forwards its intents; "Used by" is hidden while unknown.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ProviderConnectionCardComponent } from './provider-connection-card.component';
import type { SettingScopeDisplay } from './setting-scope-row.component';

type CardInputs = {
  [K in keyof ProviderConnectionCardComponent]: unknown;
};

function createComponent(
  inputs: Partial<CardInputs> = {},
): ComponentFixture<ProviderConnectionCardComponent> {
  const fixture = TestBed.createComponent(ProviderConnectionCardComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

function query(
  fixture: ComponentFixture<ProviderConnectionCardComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

/** The card's activation surface (`NativeCardComponent` root, role=button). */
function surface(fixture: ComponentFixture<ProviderConnectionCardComponent>): HTMLElement {
  const root = fixture.nativeElement.querySelector('[role="button"]') as HTMLElement | null;
  if (!root) throw new Error('No card surface');
  return root;
}

/** Buttons inside the card surface (the surface itself is role=button, not a <button>). */
function buttons(fixture: ComponentFixture<ProviderConnectionCardComponent>): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
}

const MOONSHOT = { providerId: 'moonshot', providerName: 'Moonshot (Kimi)', authModality: 'apiKey' };

describe('ProviderConnectionCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderConnectionCardComponent],
    }).compileComponents();
  });

  describe('whole-card trigger (RUX-4)', () => {
    it('a click, Enter or Space on the card emits detailsRequested', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true });
      const emitted = jest.fn();
      fixture.componentInstance.detailsRequested.subscribe(emitted);
      query(fixture, 'provider-name')?.click();
      surface(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      surface(fixture).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      expect(emitted).toHaveBeenCalledTimes(3);
      expect(surface(fixture).getAttribute('tabindex')).toBe('0');
    });

    it('the inline action emits its own output, never detailsRequested', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true });
      const details = jest.fn();
      const activate = jest.fn();
      fixture.componentInstance.detailsRequested.subscribe(details);
      fixture.componentInstance.activateMainRequested.subscribe(activate);
      (query(fixture, 'btn-activate-main') as HTMLButtonElement).click();
      expect(activate).toHaveBeenCalledTimes(1);
      expect(details).not.toHaveBeenCalled();
    });

    it('its accessible name and tooltip carry the status and the state-table copy', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'unreachable' });
      expect(surface(fixture).getAttribute('aria-label')).toBe(
        'Moonshot (Kimi): Unreachable. Could not reach Moonshot (Kimi); check the connection and retry. Open connection details.',
      );
      expect(query(fixture, 'provider-connection-card')?.getAttribute('title')).toBe(
        'Could not reach Moonshot (Kimi); check the connection and retry.',
      );
    });
  });

  describe('compact layout (≤ 80 px, prototype .conn-card)', () => {
    it('renders the avatar, name, provenance and auth-modality badge on row 1', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true, sourceLabel: 'Key stored on this machine' });
      expect(query(fixture, 'card-avatar')?.textContent?.trim()).toBe('MK');
      expect(query(fixture, 'card-avatar')?.className).toContain('text-base-content');
      expect(query(fixture, 'provider-name')?.textContent?.trim()).toBe('Moonshot (Kimi)');
      expect(query(fixture, 'card-subtitle')?.textContent?.trim()).toBe('Key stored on this machine');
      expect(query(fixture, 'auth-modality')?.textContent?.trim()).toBe('API key');
    });

    it('falls back to the last connected / failed time, then the full modality, for the provenance line', () => {
      expect(query(createComponent({ ...MOONSHOT, lastConnectedText: '2 hours ago' }), 'card-subtitle')?.textContent?.trim())
        .toBe('Last connected 2 hours ago');
      expect(query(createComponent({ ...MOONSHOT, lastFailedText: '5 minutes ago' }), 'card-subtitle')?.textContent?.trim())
        .toBe('Last check failed 5 minutes ago');
      const cli = createComponent({ providerId: 'claude-cli', providerName: 'Claude (Subscription)', authModality: 'cli' });
      expect(query(cli, 'card-subtitle')?.textContent?.trim()).toBe('CLI subscription');
      expect(query(cli, 'auth-modality')?.textContent?.trim()).toBe('CLI');
      expect(query(createComponent({ providerId: 'x', providerName: 'X' }), 'card-subtitle')).toBeNull();
    });

    it('a preformatted modality (the page passes "Custom" for a custom gateway) replaces the badge text', () => {
      expect(query(createComponent({ ...MOONSHOT, authModalityText: 'Custom' }), 'auth-modality')?.textContent?.trim()).toBe('Custom');
    });

    it('never truncates the name or the modality', () => {
      const fixture = createComponent({ ...MOONSHOT, providerName: 'A very long provider name that wraps', status: 'connected' });
      for (const id of ['provider-name', 'auth-modality']) {
        expect(query(fixture, id)?.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
      }
    });

    it('row 2 holds the status dot and label, the inline action and "Used by N"', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true, usedByCount: 2 });
      expect(query(fixture, 'status-copy')?.textContent?.trim()).toBe('Connected');
      expect(query(fixture, 'status-badge')?.querySelector('.bg-success')).not.toBeNull();
      expect(query(fixture, 'status-badge')?.className).toContain('text-base-content');
      expect(query(fixture, 'used-by-count')?.textContent?.trim()).toBe('Used by 2');
    });

    it('"Used by" is hidden while the count is unknown, and shows 0 when known and unused', () => {
      expect(query(createComponent({ ...MOONSHOT, usedByCount: null }), 'used-by-count')).toBeNull();
      expect(query(createComponent({ ...MOONSHOT, usedByCount: 0 }), 'used-by-count')?.textContent?.trim()).toBe('Used by 0');
    });
  });

  describe('one inline action per state (every other action lives in the drawer)', () => {
    it.each([
      ['connected', { positiveProbeEvidence: true }, 'btn-activate-main', 'activateMainRequested', 'Use Moonshot (Kimi) for main agent'],
      ['needs-key', {}, 'btn-add-key', 'addKeyRequested', 'Add API key for Moonshot (Kimi)'],
      ['unauthenticated', {}, 'btn-replace-key', 'replaceKeyRequested', 'Replace key for Moonshot (Kimi)'],
      ['unauthenticated', { authModality: 'oauth' }, 'btn-sign-in', 'signInRequested', 'Sign in to Moonshot (Kimi)'],
      ['unreachable', {}, 'btn-retry', 'retryRequested', 'Retry connection to Moonshot (Kimi)'],
      ['not-installed', { cliName: 'Claude CLI' }, 'btn-check-again', 'checkAgainRequested', 'Check again for Claude CLI'],
      ['not-configured', {}, 'btn-setup', 'setupRequested', 'Set up Moonshot (Kimi)'],
      ['unknown', { canActivateMain: false }, 'btn-check-connection', 'checkConnectionRequested', 'Check connection for Moonshot (Kimi)'],
      ['unknown', {}, 'btn-activate-main', 'activateMainRequested', 'Use Moonshot (Kimi) for main agent'],
      ['skipped', { canActivateMain: false }, 'btn-retry', 'retryRequested', 'Retry connection to Moonshot (Kimi)'],
    ] as const)('%s %j → %s', (status, extra, testId, outputName, ariaLabel) => {
      const fixture = createComponent({ ...MOONSHOT, status, ...extra });
      const card = fixture.componentInstance as unknown as Record<string, { subscribe(fn: () => void): unknown }>;
      const emitted = jest.fn();
      card[outputName].subscribe(emitted);
      expect(buttons(fixture)).toHaveLength(1);
      const action = query(fixture, testId) as HTMLButtonElement;
      expect(action.getAttribute('aria-label')).toBe(ariaLabel);
      expect(action.className).toContain('btn-xs');
      expect(action.className).toContain('focus-visible:outline-2');
      action.click();
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it.each(['active', 'checking'] as const)('%s carries no inline action', (status) => {
      expect(buttons(createComponent({ ...MOONSHOT, status }))).toHaveLength(0);
    });

    it('a checkable Not checked connection is checked first, not activated (RUX-7, unchanged)', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: false });
      expect(query(fixture, 'btn-activate-main')).toBeNull();
      expect(query(fixture, 'btn-check-connection')).not.toBeNull();
    });

    it('no longer renders Manage, Change main provider, Edit connection or Installation instructions', () => {
      for (const status of ['active', 'connected', 'unreachable', 'not-installed', 'not-checked'] as const) {
        const fixture = createComponent({ ...MOONSHOT, status, positiveProbeEvidence: true });
        for (const id of ['btn-manage', 'btn-change-main', 'btn-edit-connection', 'btn-install-instructions']) {
          expect(query(fixture, id)).toBeNull();
        }
      }
    });
  });

  describe('never Connected without confirmed evidence', () => {
    it.each([
      ['unknown', null, 'Not checked'],
      ['skipped', null, 'Check unavailable'],
      ['missing', null, 'Not configured'],
      ['connected', false, 'Not checked'],
      ['active', false, 'Not checked'],
      ['reachable', null, 'Not checked'],
      ['reachable', true, 'Connected'],
    ] as const)('%s (evidence %s) reads %s', (status, positiveProbeEvidence, label) => {
      const fixture = createComponent({ ...MOONSHOT, status, positiveProbeEvidence });
      expect(query(fixture, 'status-copy')?.textContent?.trim()).toBe(label);
    });
  });

  describe('main agent', () => {
    it('the active card has the secondary spine and "Active for main agent"', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true, isActive: true });
      expect(query(fixture, 'status-copy')?.textContent?.trim()).toBe('Active for main agent');
      expect(query(fixture, 'native-card-spine')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('secondary');
    });

    it('a blocked main route says it needs attention, with a warning tone, never the healthy label', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'unreachable', isActive: true });
      expect(query(fixture, 'blocked-main-badge')?.textContent).toContain('Main agent · Needs attention');
      expect(query(fixture, 'status-copy')?.textContent?.trim()).toBe('Unreachable');
      expect(fixture.nativeElement.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('warning');
      expect(surface(fixture).getAttribute('aria-label')).toContain('main agent needs attention');
    });

    it('isBlocked alone marks the card', () => {
      const fixture = createComponent({ ...MOONSHOT, status: 'connected', positiveProbeEvidence: true, isBlocked: true });
      expect(query(fixture, 'blocked-main-badge')).not.toBeNull();
    });
  });

  describe('scope badge (D16)', () => {
    it('shows an overridden scope as a badge and forwards its popover actions', () => {
      const fixture = createComponent({
        ...MOONSHOT, scope: 'workspace' as SettingScopeDisplay, hasOverride: true, supportedTargets: ['global', 'workspace'],
      });
      const clear = jest.fn();
      fixture.componentInstance.scopeClearRequested.subscribe(clear);
      const badge = query(fixture, 'scope-badge') as HTMLButtonElement;
      expect(badge.getAttribute('data-field')).toBe('Moonshot (Kimi)');
      badge.click();
      fixture.detectChanges();
      (query(fixture, 'scope-clear-override') as HTMLButtonElement).click();
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it('an inherited scope renders nothing', () => {
      const fixture = createComponent({ ...MOONSHOT, scope: 'global' as SettingScopeDisplay, supportedTargets: ['global', 'workspace'] });
      expect(query(fixture, 'scope-badge')).toBeNull();
    });
  });
});
