import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersEffectiveRoute, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { MainAgentSectionComponent, routeStatus } from './main-agent-section.component';

function ready<T>(data: T): ProvidersSettingsSection<T> { return { status: 'ready', data, error: null }; }
function loading<T>(): ProvidersSettingsSection<T> { return { status: 'loading', data: null, error: null }; }
function failed<T>(): ProvidersSettingsSection<T> { return { status: 'error', data: null, error: 'Could not load this section. Retry.' }; }

const ROUTE: ProvidersEffectiveRoute = {
  route: 'cli', ready: true, blockers: [], driverProviderId: 'claude-cli', resolvedAuthModality: 'cli',
  resolvedModel: { kind: 'unresolved' }, storedAuthMethodScope: 'global',
  providers: [{ id: 'claude-cli', type: 'cli', status: 'connected' }],
  lastSuccessfulProbeAt: null, lastFailedProbeAt: null, probedAt: '2026-10-29T10:00:00Z', fromCache: false,
};

class StateStub {
  readonly route = signal<ProvidersSettingsSection<ProvidersEffectiveRoute>>(ready(ROUTE));
  readonly effort = signal<ProvidersSettingsSection<{ effort?: string }>>(ready({ effort: 'medium' }));
  readonly connections = signal(ready([{ id: 'claude-cli', name: 'Claude (Subscription)' }]));
  readonly refreshRoute = jest.fn(async () => undefined);
}

@Component({
  standalone: true,
  imports: [MainAgentSectionComponent],
  template: `<ptah-main-agent-section (reassignRequested)="reassigned = reassigned + 1"
    ><button main-agent-badges type="button" data-testid="badge">Workspace override</button></ptah-main-agent-section>`,
})
class HostComponent {
  reassigned = 0;
}

describe('routeStatus', () => {
  it.each([
    [ready(ROUTE), 'success', 'Operational'],
    [ready({ ...ROUTE, ready: false }), 'warning', 'Needs attention'],
    [loading<ProvidersEffectiveRoute>(), 'neutral', 'Checking…'],
    [failed<ProvidersEffectiveRoute>(), 'warning', 'Route unavailable'],
  ] as const)('%# → %s %s ("Operational" exactly when route.ready)', (route, tone, text) => {
    expect(routeStatus(route)).toEqual({ tone, text });
  });
});

describe('MainAgentSectionComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  let state: StateStub;
  const query = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }],
    });
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('is a card-less block titled "Main agent" (the page owns the card), with an "Operational" status that follows route.ready', () => {
    const section = query('main-agent-section');
    expect(section?.tagName.toLowerCase()).toBe('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('main-agent-heading');
    expect(element.querySelector('ptah-surface-section, [data-glass-surface="chrome"]')).toBeNull();
    expect(query('routing-node-title')?.tagName.toLowerCase()).toBe('h2');
    expect(query('routing-node-title')?.textContent?.trim()).toBe('Main agent');
    expect(query('main-agent-route-status')?.getAttribute('role')).toBe('status');
    expect(query('main-agent-route-status')?.textContent?.trim()).toBe('Operational');
    state.route.set(ready({ ...ROUTE, ready: false }));
    fixture.detectChanges();
    expect(query('main-agent-route-status')?.textContent?.trim()).toBe('Needs attention');
  });

  it('shows the next request\'s provider, model and effort, and the projected D16 badges in its header', () => {
    expect(query('routing-main-provider')?.textContent?.trim()).toBe('Claude (Subscription)');
    expect(query('routing-main-model')?.textContent?.trim()).toBe('Default (chosen by Claude)');
    expect(query('routing-node-footer')?.textContent?.trim()).toBe('Effort: medium');
    expect(query('routing-node-status')?.textContent?.trim()).toBe('Active');
    const badges = query('routing-node-badges');
    expect(badges?.contains(query('routing-node-status'))).toBe(true);
    expect(badges?.contains(query('badge'))).toBe(true);
    // Batch 52.6: the title is one line and never shrinks; the pill and the badges are items of the same wrapping
    // row (the badge wrapper is display: contents), so a badge that does not fit moves under the title, whole.
    expect(badges?.className).toContain('contents');
    expect(badges?.parentElement?.className).toContain('flex-wrap');
    expect(query('routing-node-title')?.className).toContain('whitespace-nowrap');
    expect(query('routing-node-title')?.parentElement?.className).toContain('shrink-0');
    // Batch 28b: the full value, never truncated; a long one wraps in its own column.
    for (const value of ['routing-main-provider', 'routing-main-model']) {
      expect(query(value)?.className).not.toMatch(/truncate|text-ellipsis|line-clamp/);
      expect(query(value)?.className).toContain('break-words');
    }
  });

  it.each([
    [{ kind: 'model', id: 'claude-opus-4' }, 'claude-opus-4'],
    [{ kind: 'tier', tier: 'sonnet' }, 'sonnet tier'],
  ] as const)('names the resolved model %j', (resolvedModel, text) => {
    state.route.set(ready({ ...ROUTE, resolvedModel }));
    fixture.detectChanges();
    expect(query('routing-main-model')?.textContent?.trim()).toBe(text);
  });

  it('a driver that is not ready "Needs attention"; no driver says to choose one', () => {
    state.route.set(ready({ ...ROUTE, ready: false }));
    fixture.detectChanges();
    expect(query('routing-node-status')?.textContent?.trim()).toBe('Needs attention');
    state.route.set(ready({ ...ROUTE, driverProviderId: null }));
    fixture.detectChanges();
    expect(query('routing-node-status')?.textContent?.trim()).toBe('Not set');
    expect(query('routing-node-main-agent')?.textContent).toContain('Choose a provider to start the main agent.');
  });

  it('"Reassign" is a primary btn-sm stretched over the block, and asks the page to open the Main Agent popover', () => {
    const reassign = query('routing-node-action');
    expect(reassign?.textContent?.trim()).toBe('Reassign');
    expect(reassign?.classList.contains('btn-primary')).toBe(true);
    expect(reassign?.classList.contains('btn-sm')).toBe(true);
    expect(reassign?.classList.contains('after:inset-0')).toBe(true);
    reassign?.click();
    expect(fixture.componentInstance.reassigned).toBe(1);
  });

  it('a loading route shows the skeleton; a failed one offers Retry of the route read', () => {
    state.route.set(loading());
    fixture.detectChanges();
    expect(query('routing-node-skeleton')).not.toBeNull();
    state.route.set(failed());
    fixture.detectChanges();
    query('routing-node-retry')?.click();
    expect(state.refreshRoute).toHaveBeenCalledTimes(1);
  });
});
