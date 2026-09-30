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
function failed<T>(): ProvidersSettingsSection<T> { return { status: 'error', data: null, error: 'x' }; }

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
  readonly lanes = signal<ProvidersSettingsSection<Record<string, { provider: string }>>>(ready({
    archaeologist: { provider: '' }, synthesis: { provider: '' }, judge: { provider: 'moonshot' }, replay: { provider: '' },
  }));
  readonly judging = signal<ProvidersSettingsSection<{ judgeProvider: string }>>(ready({ judgeProvider: '' }));
  readonly orchestration = signal<ProvidersSettingsSection<unknown>>(ready({
    detectedClis: DETECTED, disabledClis: ['copilot'], preferredAgentOrder: ['codex', 'antigravity', 'glm-instance-1', 'copilot'],
  }));
  readonly connections = signal(ready([
    { id: 'claude-cli', name: 'Claude (Subscription)' }, { id: 'openai-codex', name: 'OpenAI Codex' }, { id: 'moonshot', name: 'Moonshot (Kimi)' },
  ]));
  readonly refreshRoute = jest.fn(async () => undefined);
  readonly refreshMemory = jest.fn(async () => undefined);
  readonly refreshLanes = jest.fn(async () => undefined);
  readonly refreshJudging = jest.fn(async () => undefined);
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
  it('backgroundRolesPreview splits the six roles into explicit ones (with connection names) and followers', () => {
    const preview = backgroundRolesPreview('openai-codex', { judge: { provider: 'moonshot' }, synthesis: { provider: ' ' } }, '',
      (id) => ({ 'openai-codex': 'OpenAI Codex', moonshot: 'Moonshot (Kimi)' })[id] ?? id);
    expect(preview).toEqual({
      explicit: [{ label: 'Memory curator', provider: 'OpenAI Codex' }, { label: 'Judge lane', provider: 'Moonshot (Kimi)' }],
      following: 4, total: 6,
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
      // The badge group never gives way; the title wraps instead of pushing the badges to their own row.
      expect(badges?.className).toContain('flex-none');
      expect(node('main-agent').querySelector('h3')?.className).not.toContain('whitespace-nowrap');
      for (const row of ['routing-main-provider-row', 'routing-main-model-row']) {
        expect(within('main-agent', row)?.className).not.toContain('flex-wrap');
      }
      expect(within('main-agent', 'routing-main-model')?.className).toContain('truncate');
      expect(within('main-agent', 'routing-main-model')?.getAttribute('title')).toBe('Default (chosen by Claude)');
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
    it('previews the two explicit roles with their connection and how many follow the main agent', () => {
      const rows = Array.from(node('background-roles').querySelectorAll('li'))
        .map((row) => Array.from(row.querySelectorAll('span')).map((span) => span.textContent?.trim()));
      expect(rows).toEqual([['Memory curator', 'OpenAI Codex'], ['Judge lane', 'Moonshot (Kimi)'], ['4 roles', 'Follow main agent']]);
      expect(within('background-roles', 'routing-node-status')?.textContent?.trim()).toBe('6 roles');
      expect(within('background-roles', 'routing-node-footer')?.textContent?.trim()).toBe('2 set · 4 following');
    });

    it('more than two explicit roles adds "N more set"', () => {
      state.judging.set(ready({ judgeProvider: 'moonshot' }));
      state.lanes.set(ready({ archaeologist: { provider: 'moonshot' }, synthesis: { provider: '' }, judge: { provider: 'moonshot' }, replay: { provider: '' } }));
      fixture.detectChanges();
      expect(within('background-roles', 'routing-background-more')?.textContent?.trim()).toBe('2 more set');
    });

    it('Inspect opens Agent Orchestration at the background models', () => {
      within('background-roles', 'routing-node-action')?.click();
      expect(appState.requestSettingsTab).toHaveBeenCalledWith({ tab: 'orchestration', section: 'background-models' });
      expect(fixture.componentInstance.activated).toEqual(['background-roles']);
    });

    it('loads with a skeleton until all three reads land; Retry re-reads only the failed ones', () => {
      state.lanes.set(loading());
      fixture.detectChanges();
      expect(within('background-roles', 'routing-node-skeleton')).not.toBeNull();
      state.lanes.set(failed());
      fixture.detectChanges();
      within('background-roles', 'routing-node-retry')?.click();
      expect(state.refreshLanes).toHaveBeenCalledTimes(1);
      expect(state.refreshMemory).not.toHaveBeenCalled();
      expect(state.refreshJudging).not.toHaveBeenCalled();
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
