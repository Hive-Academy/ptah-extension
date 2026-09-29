import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ClaudeRpcService, RpcResult, ProvidersSettingsStateService, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { OrchestrationSettingsComponent } from './orchestration-settings.component';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { PtahCliConfigComponent } from './ptah-cli-config.component';
import {
  ProviderConsumerAssignmentsComponent, type BackgroundConsumerId,
} from '../providers/provider-consumer-assignments.component';

@Component({ selector: 'ptah-agent-orchestration-config', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Orchestration policy</p>' })
class OrchestrationPolicyStub {}

@Component({ selector: 'ptah-provider-consumer-assignments', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Background roles</p>' })
class ConsumerStub {
  readonly disabled = input(false);
  readonly initialEditingConsumerId = input<BackgroundConsumerId | null>(null);
  readonly setupProviderRequested = output<string>();
  readonly assignmentSaved = output<{ id: BackgroundConsumerId; provider: string; model: string }>();
  readonly timeoutSaved = output<number>();
}

@Component({ selector: 'ptah-cli-config', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<h2 id="providers-cli-heading" data-focus="cli-agents" tabindex="-1">CLI agents</h2>' })
class CliConfigStub {}

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };

/** The container's own reads plus what the real PtahCliConfigComponent reads. */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly connections = signal(ready([{ id: 'first', name: 'first' }]));
  readonly scopes = signal(ready({ activePath: '/workspace', entries: [] }));
  readonly cliAgents = signal<ProvidersSettingsSection<unknown[]>>(ready([]));
  readonly cliModels = signal<ProvidersSettingsSection<Record<string, unknown>>>(ready({}));
  readonly cliTest = signal({ status: 'unloaded', data: null, error: null });
  readonly orchestration = signal<ProvidersSettingsSection<Record<string, string>>>(ready({
    codexModel: '', copilotModel: '', cursorModel: '', antigravityModel: '', opencodeModel: '', piModel: '',
    codexReasoningEffort: '', copilotReasoningEffort: '', piReasoningEffort: '',
  }));
  readonly delegatedModelOptions = signal({ status: 'unloaded', data: null, error: null });
  readonly refreshDelegatedModelOptions = jest.fn(async () => undefined);
  readonly open = jest.fn(async () => undefined);
  readonly refresh = jest.fn(async () => undefined);
  readonly refreshJudging = jest.fn(async () => undefined);
  readonly refreshCliAgents = jest.fn(async () => undefined);
  readonly refreshCliModels = jest.fn(async () => undefined);
  readonly refreshOrchestration = jest.fn(async () => undefined);
  readonly scopeEntry = jest.fn(() => null);
  readonly reviewContext = jest.fn(() => ({ scopeKey: 'workspace', activePath: '/workspace' }));
  readonly saveSettings = jest.fn(async () => undefined);
  readonly testCliConnection = jest.fn(async () => undefined);
  readonly saveCursorCredential = jest.fn(async () => undefined);
}

function button(element: HTMLElement, label: string): HTMLButtonElement {
  const result = Array.from(element.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

describe('OrchestrationSettingsComponent (interim container)', () => {
  let fixture: ComponentFixture<OrchestrationSettingsComponent>;
  let element: HTMLElement;
  let state: StateStub;

  beforeEach(async () => {
    state = new StateStub();
    await TestBed.configureTestingModule({
      imports: [OrchestrationSettingsComponent],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }],
    }).overrideComponent(OrchestrationSettingsComponent, {
      remove: { imports: [AgentOrchestrationConfigComponent, ProviderConsumerAssignmentsComponent, PtahCliConfigComponent] },
      add: { imports: [OrchestrationPolicyStub, ConsumerStub, CliConfigStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrchestrationSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  const consumer = () => fixture.debugElement.query(By.directive(ConsumerStub)).injector.get(ConsumerStub);

  it('opens the shared state once when mounted alone (a user can land here first)', async () => {
    await render();
    await render();
    expect(state.open).toHaveBeenCalledTimes(1);
  });

  it('mounts the orchestration policy, the background roles and the CLI agents, in that order', async () => {
    await render();
    const order = ['ptah-agent-orchestration-config', 'ptah-provider-consumer-assignments', 'ptah-cli-config']
      .map((selector) => element.querySelector(selector));
    expect(order.every(Boolean)).toBe(true);
    expect(order[0]?.compareDocumentPosition(order[1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order[1]?.compareDocumentPosition(order[2] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('forwards a background-role target to the assignments and focuses the background section', async () => {
    fixture.componentRef.setInput('focusTarget', 'judging-enhancement'); await render();
    expect(consumer().initialEditingConsumerId()).toBe('judging-enhancement');
    expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
  });

  it('focuses the section without preselecting a role for background-models', async () => {
    fixture.componentRef.setInput('focusTarget', 'background-models'); await render();
    expect(consumer().initialEditingConsumerId()).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
  });

  it('focuses the CLI agents heading for cli-agents', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(document.activeElement).toBe(element.querySelector('#providers-cli-heading'));
  });

  it('re-focuses a target requested again after being cleared', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    (document.activeElement as HTMLElement).blur();
    fixture.componentRef.setInput('focusTarget', null); await render();
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(document.activeElement).toBe(element.querySelector('#providers-cli-heading'));
  });

  it('hands a provider-setup request up (the wizard lives on Providers) and refreshes after saves', async () => {
    await render();
    const requested: string[] = [];
    fixture.componentInstance.providerSetupRequested.subscribe((id) => requested.push(id));
    consumer().setupProviderRequested.emit('moonshot');
    consumer().assignmentSaved.emit({ id: 'judge', provider: 'moonshot', model: 'kimi' });
    consumer().timeoutSaved.emit(30);
    expect(requested).toEqual(['moonshot']);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.refreshJudging).toHaveBeenCalledTimes(1);
  });

  it('disables the assignments while a save is in flight', async () => {
    state.commit.set({ ...idle, status: 'saving' }); await render();
    expect(consumer().disabled()).toBe(true);
  });

  it('shows commit feedback naming saved, unsaved and unconfirmed fields', async () => {
    state.commit.set({ ...idle, status: 'unconfirmed', saved: ['CLI instance'], unsaved: ['Tier'], unconfirmed: ['Key'] });
    await render();
    const feedback = element.querySelector('[data-testid="providers-commit-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('Saved: CLI instance.');
    expect(feedback?.textContent).toContain('Not saved: Tier.');
    expect(feedback?.textContent).toContain('Save not confirmed: Key.');
  });

  it('retries only the failed CLI read', async () => {
    state.cliModels.set({ status: 'error', data: {}, error: 'Could not load this section. Retry.' });
    await render();
    button(element, 'Retry CLI instance models').click(); await render();
    expect(state.refreshCliModels).toHaveBeenCalledTimes(1);
    expect(state.refreshCliAgents).not.toHaveBeenCalled();
    expect(element.querySelector('ptah-cli-config')).not.toBeNull();
  });
});

/** Moved with the CLI instance manager from the Providers page spec (D14). */
describe('OrchestrationSettingsComponent with the real CLI instance manager', () => {
  let fixture: ComponentFixture<OrchestrationSettingsComponent>;
  let element: HTMLElement;
  let state: StateStub;

  beforeEach(async () => {
    state = new StateStub();
    await TestBed.configureTestingModule({
      imports: [OrchestrationSettingsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: ClaudeRpcService, useValue: { call: jest.fn(async () => new RpcResult(true, { models: [] })) } },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn(async () => new RpcResult(true, { models: [] })) } },
      ],
    }).overrideComponent(OrchestrationSettingsComponent, {
      remove: { imports: [AgentOrchestrationConfigComponent, ProviderConsumerAssignmentsComponent] },
      add: { imports: [OrchestrationPolicyStub, ConsumerStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrchestrationSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }

  it('retains a masked CLI setup draft after an unconfirmed write and discards it on cancel', async () => {
    state.saveSettings.mockImplementation(async () => { state.commit.set({ ...idle, status: 'unconfirmed', unconfirmed: ['CLI instance'] }); });
    await render(); button(element, 'Add CLI agent').click(); await render();
    for (const [id, value] of [['providers-cli-name', 'Worker'], ['providers-cli-key', 'private-cli-key']]) {
      const field = element.querySelector<HTMLInputElement>(`#${id}`);
      if (!field) throw new Error('Missing CLI input');
      field.value = value; field.dispatchEvent(new Event('input'));
    }
    const provider = element.querySelector<HTMLSelectElement>('#providers-cli-provider');
    if (!provider) throw new Error('Missing provider input');
    provider.value = 'first'; provider.dispatchEvent(new Event('change')); await render();
    button(element, 'Create CLI agent').click(); await render();
    expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'create', params: { name: 'Worker', providerId: 'first', apiKey: 'private-cli-key' } }] }, { scopeKey: 'workspace', activePath: '/workspace' });
    expect(element.querySelector<HTMLInputElement>('#providers-cli-key')?.type).toBe('password');
    expect(element.textContent).not.toContain('private-cli-key');
    expect(element.querySelector('[data-testid="providers-commit-feedback"]')?.textContent).toContain('Save not confirmed: CLI instance');
    button(element, 'Cancel CLI setup').click(); await render();
    button(element, 'Add CLI agent').click(); await render();
    expect(element.querySelector<HTMLInputElement>('#providers-cli-key')?.value).toBe('');
  });

  it('shows the empty CLI instance list when there are no agents', async () => {
    await render();
    expect(element.textContent).toContain('No CLI agents configured.');
  });
});
