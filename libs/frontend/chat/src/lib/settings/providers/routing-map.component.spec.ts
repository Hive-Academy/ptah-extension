import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager, ProvidersSettingsStateService, type ProvidersEffectiveRoute, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import {
  RoutingMapComponent, backgroundRolesPreview, cliAgentsPreview, routeStatus, type RoutingNodeId,
} from './routing-map.component';

function ready<T>(data: T): ProvidersSettingsSection<T> { return { status: 'ready', data, error: null }; }
function loading<T>(): ProvidersSettingsSection<T> { return { status: 'loading', data: null, error: null }; }
function failed<T>(): ProvidersSettingsSection<T> { return { status: 'error', data: null, error: 'Could not load this section. Retry.' }; }

const ROUTE: ProvidersEffectiveRoute = {
  route: 'cli', ready: true, blockers: [], driverProviderId: 'claude-cli', resolvedAuthModality: 'cli',
  resolvedModel: { kind: 'unresolved' }, storedAuthMethodScope: 'global',
  providers: [{ id: 'claude-cli', type: 'cli', status: 'connected' }],
  lastSuccessfulProbeAt: null, lastFailedProbeAt: null, probedAt: null, fromCache: false,
} as unknown as ProvidersEffectiveRoute;

const DETECTED = [
  { cli: 'codex', installed: true },
  { cli: 'antigravity', installed: true },
  { cli: 'ptah-cli', installed: true, ptahCliId: 'glm-instance-1', ptahCliName: 'Glm' },
  { cli: 'copilot', installed: true },
  { cli: 'cursor', installed: true },
  { cli: 'gemini', installed: false },
];

class StateStub {
  readonly route = signal<ProvidersSettingsSection<ProvidersEffectiveRoute>>(ready(ROUTE));
  readonly effort = signal<ProvidersSettingsSection<{ effort?: string }>>(ready({ effort: 'medium' }));
  readonly memory = signal<ProvidersSettingsSection<{ curatorProvider: string }>>(ready({ curatorProvider: 'openai-codex' }));
  readonly enhancement = signal<ProvidersSettingsSection<{ provider: string }>>(ready({ provider: 'kimi-code' }));
  readonly orchestration = signal<ProvidersSettingsSection<unknown>>(ready({
    detectedClis: DETECTED, disabledClis: ['copilot'], preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'],
  }));
  readonly connections = signal(ready([
    { id: 'claude-cli', name: 'Claude (Subscription)' }, { id: 'openai-codex', name: 'OpenAI Codex' }, { id: 'kimi-code', name: 'Kimi Code' },
  ]));
  readonly refreshRoute = jest.fn(async () => undefined);
  readonly refreshMemory = jest.fn(async () => undefined);
  readonly refreshEnhancement = jest.fn(async () => undefined);
  readonly refreshOrchestration = jest.fn(async () => undefined);
}

@Component({
  standalone: true,
  imports: [RoutingMapComponent],
  template: `<ptah-routing-map (nodeActivated)="activated.push($event)"><button main-agent-badges type="button" data-testid="badge">Effort · Workspace</button></ptah-routing-map>`,
})
class HostComponent {
  readonly activated: RoutingNodeId[] = [];
}

describe('routing map derivations', () => {
  it('backgroundRolesPreview counts Decision and names explicit providers', () => {
    const preview = backgroundRolesPreview('openai-codex', 'kimi-code',
      (id) => ({ 'openai-codex': 'OpenAI Codex', 'kimi-code': 'Kimi Code' })[id] ?? id);
    expect(preview).toEqual({
      explicit: [{ label: 'Memory curator', provider: 'OpenAI Codex' }, { label: 'Enhancement', provider: 'Kimi Code' }],
      defaulted: ['Decision'], total: 3,
    });
  });

  it('cliAgentsPreview orders installed agents by preference, flags disabled system CLIs and counts', () => {
    const preview = cliAgentsPreview({ detectedClis: DETECTED as never, disabledClis: ['copilot'],
      preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'] });
    expect(preview.order.map((agent) => `${agent.name}${agent.disabled ? '(off)' : ''}`))
      .toEqual(['Codex', 'Antigravity', 'Glm', 'Copilot(off)', 'Cursor']);
    expect(preview.enabledSystem).toBe(3);
    expect(preview.ptahInstances).toBe(1);
  });

  it('cliAgentsPreview keeps detection order when no preference is stored', () => {
    expect(cliAgentsPreview({ detectedClis: DETECTED as never, disabledClis: [], preferredAgentOrder: [] }).order[0].name).toBe('Codex');
  });

  it.each([
    [ready(ROUTE), 'success', 'Operational'],
    [ready({ ...ROUTE, ready: false }), 'warning', 'Needs attention'],
    [loading<ProvidersEffectiveRoute>(), 'neutral', 'Checking…'],
    [failed<ProvidersEffectiveRoute>(), 'warning', 'Route unavailable'],
  ] as const)('routeStatus %# → %s %s ("Operational" exactly when route.ready)', (route, tone, text) => {
    expect(routeStatus(route as ProvidersSettingsSection<ProvidersEffectiveRoute>)).toEqual({ tone, text });
  });
});

describe('RoutingMapComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  let state: StateStub;
  let appState: { requestSettingsTab: jest.Mock };
  const query = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const node = (id: RoutingNodeId) => query(`routing-node-${id}`) as HTMLElement;
  const within = (id: RoutingNodeId, testId: string) => node(id).querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  beforeEach(() => {
    state = new StateStub();
    appState = { requestSettingsTab: jest.fn() };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, { provide: AppStateManager, useValue: appState }],
    });
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the three nodes and an "Operational" pill that follows route.ready', () => {
    expect(query('routing-map')).not.toBeNull();
    for (const id of ['main-agent', 'background-roles', 'cli-agents'] as const) expect(node(id)).not.toBeNull();
    expect(query('routing-map-status')?.textContent?.trim()).toBe('Operational');
    expect(query('routing-map-status')?.getAttribute('role')).toBe('status');
    state.route.set(ready({ ...ROUTE, ready: false }));
    fixture.detectChanges();
    expect(query('routing-map-status')?.textContent?.trim()).toBe('Needs attention');
  });

  describe('Main Agent node', () => {
    it('shows the next request\'s provider, model and effort, and the projected D16 badges in its header', () => {
      expect(within('main-agent', 'routing-main-provider')?.textContent?.trim()).toBe('Claude (Subscription)');
      expect(within('main-agent', 'routing-main-model')?.textContent?.trim()).toBe('Default (chosen by Claude)');
      expect(within('main-agent', 'routing-node-footer')?.textContent?.trim()).toBe('Effort: medium');
      expect(within('main-agent', 'routing-node-status')?.textContent?.trim()).toBe('Active');
      expect(within('main-agent', 'badge')).not.toBeNull();
    });

    it('keeps the badges on the title row and each label with its value on one line (prototype; Gate V 28)', () => {
      const badges = within('main-agent', 'routing-node-badges');
      expect(badges?.contains(within('main-agent', 'routing-node-status') ?? null)).toBe(true);
      expect(badges?.contains(within('main-agent', 'badge') ?? null)).toBe(true);
      // Batch 52.6: the title is one line and never shrinks; the pill and the badges are items of the same wrapping
      // row (the badge wrapper is display: contents), so a badge that does not fit moves under the title, whole.
      expect(badges?.className).toContain('contents');
      expect(badges?.parentElement?.className).toContain('flex-wrap');
      expect(node('main-agent').querySelector('h3')?.className).toContain('whitespace-nowrap');
      expect(node('main-agent').querySelector('h3')?.parentElement?.className).toContain('shrink-0');
      for (const row of ['routing-main-provider-row', 'routing-main-model-row']) {
        expect(within('main-agent', row)?.className).not.toContain('flex-wrap');
      }
      // Batch 28b: the full value, never truncated; a long one wraps in its own column.
      for (const value of ['routing-main-provider', 'routing-main-model']) {
        expect(within('main-agent', value)?.className).not.toMatch(/truncate|text-ellipsis|line-clamp/);
        expect(within('main-agent', value)?.className).toContain('break-words');
      }
    });

    it.each([
      [{ kind: 'model', id: 'claude-opus-4' }, 'claude-opus-4'],
      [{ kind: 'tier', tier: 'sonnet' }, 'sonnet tier'],
    ])('names the resolved model %j', (resolvedModel, text) => {
      state.route.set(ready({ ...ROUTE, resolvedModel } as ProvidersEffectiveRoute));
      fixture.detectChanges();
      expect(within('main-agent', 'routing-main-model')?.textContent?.trim()).toBe(text);
    });

    it('a driver that is not ready "Needs attention"; no driver says to choose one', () => {
      state.route.set(ready({ ...ROUTE, ready: false }));
      fixture.detectChanges();
      expect(within('main-agent', 'routing-node-status')?.textContent?.trim()).toBe('Needs attention');
      state.route.set(ready({ ...ROUTE, driverProviderId: null } as unknown as ProvidersEffectiveRoute));
      fixture.detectChanges();
      expect(within('main-agent', 'routing-node-status')?.textContent?.trim()).toBe('Not set');
      expect(node('main-agent').textContent).toContain('Choose a provider to start the main agent.');
    });

    it('Reassign emits main-agent and navigates nowhere (the page focuses its controls until Batch 26)', () => {
      within('main-agent', 'routing-node-action')?.click();
      expect(fixture.componentInstance.activated).toEqual(['main-agent']);
      expect(appState.requestSettingsTab).not.toHaveBeenCalled();
    });

    it('a loading route shows the skeleton; a failed one offers Retry of the route read', () => {
      state.route.set(loading());
      fixture.detectChanges();
      expect(within('main-agent', 'routing-node-skeleton')).not.toBeNull();
      state.route.set(failed());
      fixture.detectChanges();
      within('main-agent', 'routing-node-retry')?.click();
      expect(state.refreshRoute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Background Roles node', () => {
    it('previews the two explicit roles and default Decision', () => {
      const rows = Array.from(node('background-roles').querySelectorAll('li'))
        .map((row) => Array.from(row.querySelectorAll('span')).map((span) => span.textContent?.trim()));
      expect(rows).toEqual([['Memory curator', 'OpenAI Codex'], ['Enhancement', 'Kimi Code'], ['Decision', 'Default']]);
      expect(within('background-roles', 'routing-node-status')?.textContent?.trim()).toBe('3 roles');
      expect(within('background-roles', 'routing-node-footer')?.textContent?.trim()).toBe('2 set · 1 default');
    });

    it('shows Enhancement and Decision as defaulted when Enhancement has no provider', () => {
      state.enhancement.set(ready({ provider: '' }));
      fixture.detectChanges();
      expect(node('background-roles').querySelectorAll('[data-testid="routing-background-default"]')).toHaveLength(2);
      const rows = Array.from(node('background-roles').querySelectorAll('li'))
        .map((row) => Array.from(row.querySelectorAll('span')).map((span) => span.textContent?.trim()));
      expect(rows).toEqual([['Memory curator', 'OpenAI Codex'], ['Enhancement', 'Default'], ['Decision', 'Default']]);
    });

    it('Inspect opens Agent Orchestration at the background models', () => {
      within('background-roles', 'routing-node-action')?.click();
      expect(appState.requestSettingsTab).toHaveBeenCalledWith({ tab: 'orchestration', section: 'background-models' });
      expect(fixture.componentInstance.activated).toEqual(['background-roles']);
    });

    it('loads with a skeleton until both reads land; Retry re-reads only the failed one', () => {
      state.enhancement.set(loading());
      fixture.detectChanges();
      expect(within('background-roles', 'routing-node-skeleton')).not.toBeNull();
      state.enhancement.set(failed());
      fixture.detectChanges();
      within('background-roles', 'routing-node-retry')?.click();
      expect(state.refreshEnhancement).toHaveBeenCalledTimes(1);
      expect(state.refreshMemory).not.toHaveBeenCalled();
    });
  });

  describe('CLI Agents node', () => {
    it('previews the first four agents in preferred order (disabled ones muted) and the counts', () => {
      const order = within('cli-agents', 'routing-cli-order');
      expect(order?.textContent?.replace(/\s+/g, '')).toBe('Codex→Antigravity→Glm→Copilot(off)');
      const copilot = Array.from(order?.children ?? []).find((child) => child.textContent?.includes('Copilot'));
      expect(copilot?.className).toContain('text-base-content-muted');
      expect(order?.textContent).not.toContain('Cursor');
      expect(within('cli-agents', 'routing-node-footer')?.textContent?.trim()).toBe('3 CLIs · 1 Ptah instance');
      expect(within('cli-agents', 'routing-node-status')?.textContent?.trim()).toBe('4 enabled');
    });

    it('Manage matrix opens Agent Orchestration at the CLI agents', () => {
      within('cli-agents', 'routing-node-action')?.click();
      expect(appState.requestSettingsTab).toHaveBeenCalledWith({ tab: 'orchestration', section: 'cli-agents' });
    });

    it('no detected agent says so; a failed read retries the orchestration read', () => {
      state.orchestration.set(ready({ detectedClis: [], disabledClis: [], preferredAgentOrder: [] }));
      fixture.detectChanges();
      expect(node('cli-agents').textContent).toContain('No CLI agents detected.');
      state.orchestration.set(failed());
      fixture.detectChanges();
      within('cli-agents', 'routing-node-retry')?.click();
      expect(state.refreshOrchestration).toHaveBeenCalledTimes(1);
    });
  });
});
