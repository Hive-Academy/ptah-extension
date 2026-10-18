/** Enhancement consumer row, assignment, and timeout behavior. */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { computed, signal } from '@angular/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { rpcSuccess } from '@ptah-extension/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  type ProvidersEditContext,
  type ProvidersEffectiveRoute,
  type ProvidersSettingsCommit,
  type ProvidersSettingsPatch,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type {
  AgentOrchestrationConfig,
  ConfigGetScopesResult,
  DecisionModelStatusDto,
  ScopedSettingEntry,
} from '@ptah-extension/shared';

const UNSET_DECISION: DecisionModelStatusDto = {
  selection: { kind: 'unset' },
  locality: null,
  reportsConfidence: false,
  state: 'unset',
  detail: null,
};
import { ProviderConsumerAssignmentsComponent } from './provider-consumer-assignments.component';
import {
  toBackendEnhancementModel,
  toPickerModel,
  type BackgroundConsumerId,
} from './provider-consumer-rows';
import { isDisabledControl } from '../feedback/busy-disabled.testing';

class MockProvidersSettingsStateService {
  readonly routeStore = signal<
    ProvidersSettingsSection<ProvidersEffectiveRoute>
  >({
    status: 'ready',
    data: {
      // AuthStrategyType — the backend resolves one of five strategies, never a wire id.
      route: 'api-key',
      ready: true,
      driverProviderId: 'anthropic',
      resolvedAuthModality: 'api-key',
      // Real discriminated union from AuthGetEffectiveRouteResult.
      resolvedModel: { kind: 'model', id: 'claude-3-5-sonnet' },
      storedAuthMethodScope: 'global',
      providers: [
        { id: 'anthropic', type: 'apiKey', status: 'connected' },
        { id: 'openai', type: 'apiKey', status: 'unknown' },
        { id: 'ollama', type: 'local-native', status: 'needs-key' },
        { id: 'custom-cli', type: 'cli', status: 'not-installed' },
        { id: 'remote-bedrock', type: 'apiKey', status: 'unreachable' },
        { id: 'expired-auth', type: 'apiKey', status: 'unauthenticated' },
      ],
      lastSuccessfulProbeAt: new Date().toISOString(),
      lastFailedProbeAt: null,
      probedAt: new Date().toISOString(),
      fromCache: false,
      blockers: [],
    },
    error: null,
  });

  readonly activeProviderId = computed(() => 'anthropic');

  readonly memoryStore = signal<
    ProvidersSettingsSection<{
      curatorProvider?: string;
      curatorModel?: string;
    }>
  >({
    status: 'ready',
    data: {
      curatorProvider: '',
      curatorModel: '',
    },
    error: null,
  });

  readonly enhancementStore = signal<ProvidersSettingsSection<{
    provider: string; model: string; timeoutMs: number;
  }>>({
    status: 'ready',
    data: { provider: '', model: '', timeoutMs: 120000 },
    error: null,
  });

  readonly scopesStore = signal<
    ProvidersSettingsSection<ConfigGetScopesResult>
  >({
    status: 'ready',
    data: {
      activePath: '/workspace',
      entries: [
        {
          key: 'memory.curatorProvider',
          scope: 'global',
          hasOverride: false,
          effectiveKey: 'memory.curatorProvider',
          supportedTargets: ['global'],
          fallbackPreview: null,
          credentialSource: 'not-a-secret',
        },
        {
          key: 'memory.curatorModel',
          scope: 'global',
          hasOverride: false,
          effectiveKey: 'memory.curatorModel',
          supportedTargets: ['global'],
          fallbackPreview: null,
          credentialSource: 'not-a-secret',
        },
        {
          key: 'skills.enhancement.model',
          scope: 'global',
          hasOverride: false,
          effectiveKey: 'skills.enhancement.model',
          supportedTargets: ['global'],
          fallbackPreview: null,
          credentialSource: 'not-a-secret',
        },
      ],
    },
    error: null,
  });

  readonly commitState = signal<ProvidersSettingsCommit>({
    status: 'idle',
    saved: [],
    unsaved: [],
    unconfirmed: [],
    refreshFailed: false,
    message: null,
  });

  readonly route = this.routeStore.asReadonly();
  readonly memory = this.memoryStore.asReadonly();
  readonly enhancement = this.enhancementStore.asReadonly();
  readonly scopes = this.scopesStore.asReadonly();
  readonly commit = this.commitState.asReadonly();

  scopeEntry(key: string): ScopedSettingEntry | null {
    // No fabricated fallback: a key with no entry means unknown provenance,
    // which the component must render honestly.
    return this.scopes().data?.entries.find((e) => e.key === key) ?? null;
  }

  reviewContext(): ProvidersEditContext | null {
    return { scopeKey: 'test-scope', activePath: '/workspace' };
  }

  readonly refreshMemory = jest
    .fn<Promise<void>, []>()
    .mockResolvedValue(undefined);
  readonly refreshEnhancement = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

  readonly saveSettings = jest
    .fn<Promise<boolean>, [ProvidersSettingsPatch, ProvidersEditContext]>()
    .mockImplementation(async () => {
      this.commitState.set({
        status: 'saved',
        saved: ['test'],
        unsaved: [],
        unconfirmed: [],
        refreshFailed: false,
        message: null,
      });
      return true;
    });
}

function query(
  fixture: ComponentFixture<unknown>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function button(
  fixture: ComponentFixture<unknown>,
  testId: string,
): HTMLButtonElement | null {
  return query(fixture, testId) as HTMLButtonElement | null;
}

function inputEl(
  fixture: ComponentFixture<unknown>,
  testId: string,
): HTMLInputElement | null {
  return query(fixture, testId) as HTMLInputElement | null;
}

describe('ProviderConsumerAssignmentsComponent', () => {
  let fixture: ComponentFixture<ProviderConsumerAssignmentsComponent>;
  let component: ProviderConsumerAssignmentsComponent;
  let mockState: MockProvidersSettingsStateService;
  let mockModelsLoader: { listModels: jest.Mock };
  let mockRpc: { call: jest.Mock };
  let feedback: SettingsSaveFeedbackService;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  /** Opens a row's reassignment popover from its cell. */
  async function openRow(id: BackgroundConsumerId): Promise<void> {
    button(fixture, `consumer-edit-${id}`)?.click();
    await settle();
  }
  const providerSelect = (id: BackgroundConsumerId) =>
    query(fixture, `picker-${id}`)?.querySelector(
      '[data-testid="provider-model-picker-provider"]',
    ) as HTMLSelectElement;
  const modelSelect = (id: BackgroundConsumerId) =>
    query(fixture, `picker-${id}`)?.querySelector(
      '[data-testid="provider-model-picker-model"]',
    ) as HTMLSelectElement;
  /**
   * A picker choice, as the user makes it; the popover saves on it. Microtasks only: a saved choice starts the
   * toast's dismiss timer, which `whenStable()` would wait out.
   */
  /** Microtasks only (a save starts the toast's dismiss timer, which `whenStable()` would wait out). */
  async function flushSave(): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }
  /** Opens the time-limit editor and types a value. */
  function typeTimeout(value: string): HTMLInputElement | null {
    button(fixture, 'timeout-edit-button')?.click();
    fixture.detectChanges();
    const input = inputEl(fixture, 'timeout-input');
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    return input;
  }
  async function choose(
    select: HTMLSelectElement,
    value: string,
  ): Promise<void> {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    for (let i = 0; i < 3; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }
  beforeEach(async () => {
    mockState = new MockProvidersSettingsStateService();
    mockModelsLoader = {
      listModels: jest.fn().mockResolvedValue({
        models: [
          {
            id: 'claude-3-5-sonnet',
            name: 'Claude 3.5 Sonnet',
            supportsToolUse: true,
          },
          {
            id: 'claude-3-5-haiku',
            name: 'Claude 3.5 Haiku',
            supportsToolUse: true,
          },
        ],
      }),
    };

    // The Decision model card (TASK_2026_646) reads agent:getConfig itself; its own spec covers it.
    mockRpc = {
      call: jest.fn(async () =>
        rpcSuccess({
          decisionModel: UNSET_DECISION,
        } as AgentOrchestrationConfig),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ProviderConsumerAssignmentsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: mockState },
        { provide: PROVIDER_MODELS_LOADER, useValue: mockModelsLoader },
        { provide: ClaudeRpcService, useValue: mockRpc },
        SettingsSaveFeedbackService,
      ],
    }).compileComponents();
    feedback = TestBed.inject(SettingsSaveFeedbackService);

    fixture = TestBed.createComponent(ProviderConsumerAssignmentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the two consumer rows and the decision model', async () => {
    await settle();
    expect(query(fixture, 'consumer-row-memory-curator')).toBeTruthy();
    expect(query(fixture, 'consumer-row-enhancement')).toBeTruthy();
    expect(query(fixture, 'consumer-row-judge')).toBeNull();
    expect(query(fixture, 'enhancement-timeout-section')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('ptah-decision-model-row')).toBeTruthy();
  });

  it('loads the enhancement provider and model from the new section', async () => {
    mockState.enhancementStore.set({
      status: 'ready',
      data: { provider: 'anthropic', model: 'claude-3-5-sonnet', timeoutMs: 60000 },
      error: null,
    });
    await settle();
    expect(query(fixture, 'consumer-summary-enhancement')?.textContent).toContain('anthropic');
    expect(query(fixture, 'consumer-summary-enhancement')?.textContent).toContain('claude-3-5-sonnet');
    expect(query(fixture, 'timeout-effective-display')?.textContent).toContain('60 seconds');
  });

  it('saves an enhancement provider choice with Undo', async () => {
    const saved = jest.fn();
    component.assignmentSaved.subscribe(saved);
    await openRow('enhancement');
    await choose(providerSelect('enhancement'), 'anthropic');
    expect(mockState.saveSettings).toHaveBeenCalledWith(
      { enhancement: { provider: 'anthropic', model: 'inherit' } },
      expect.any(Object),
    );
    expect(saved).toHaveBeenCalledWith({ id: 'enhancement', provider: 'anthropic', model: '' });
    expect(feedback.toast()?.canUndo).toBe(true);
    await feedback.undo();
    expect(mockState.saveSettings).toHaveBeenLastCalledWith(
      { enhancement: { provider: '', model: 'inherit' } }, expect.any(Object),
    );
  });

  it('reads inherit as the picker sentinel and writes an explicit enhancement model', async () => {
    expect(toPickerModel('inherit')).toBe('');
    expect(toBackendEnhancementModel('  ')).toBe('inherit');
    mockState.enhancementStore.set({
      status: 'ready',
      data: { provider: 'anthropic', model: 'inherit', timeoutMs: 120000 },
      error: null,
    });
    await openRow('enhancement');
    expect(modelSelect('enhancement').value).toBe('');
    await choose(modelSelect('enhancement'), 'claude-3-5-sonnet');
    expect(mockState.saveSettings).toHaveBeenCalledWith(
      { enhancement: { provider: 'anthropic', model: 'claude-3-5-sonnet' } },
      expect.any(Object),
    );
  });

  it('retries an unloaded enhancement section', async () => {
    mockState.enhancementStore.set({ status: 'unloaded', data: null, error: null });
    await settle();
    expect(query(fixture, 'consumer-notloaded-enhancement')).toBeTruthy();
    expect(query(fixture, 'timeout-effective-display')).toBeNull();
    button(fixture, 'consumer-retry-enhancement')?.click();
    expect(mockState.refreshEnhancement).toHaveBeenCalled();
  });

  it('saves the timeout through the enhancement patch and supports Undo', async () => {
    const saved = jest.fn();
    component.timeoutSaved.subscribe(saved);
    typeTimeout('180');
    button(fixture, 'timeout-save-button')?.click();
    await flushSave();
    expect(mockState.saveSettings).toHaveBeenCalledWith(
      { enhancement: { timeoutMs: 180000 } }, expect.any(Object),
    );
    expect(saved).toHaveBeenCalledWith(180);
    expect(feedback.toast()?.canUndo).toBe(true);
    await feedback.undo();
    expect(mockState.saveSettings).toHaveBeenLastCalledWith(
      { enhancement: { timeoutMs: 120000 } }, expect.any(Object),
    );
  });

  it('validates the timeout against the registered settings bounds', () => {
    typeTimeout('10');
    expect(query(fixture, 'timeout-validation-error')?.textContent).toContain('15 and 600');
    expect(isDisabledControl(button(fixture, 'timeout-save-button'))).toBe(true);
  });

  it('keeps the saved timeout on a refused write', async () => {
    mockState.saveSettings.mockResolvedValueOnce(false);
    typeTimeout('180');
    button(fixture, 'timeout-save-button')?.click();
    await flushSave();
    expect(inputEl(fixture, 'timeout-input')?.value).toBe('120');
    expect(query(fixture, 'timeout-save-error')?.textContent).toContain('was not saved');
  });

  it('does not report a failed assignment as saved', async () => {
    const saved = jest.fn();
    component.assignmentSaved.subscribe(saved);
    mockState.saveSettings.mockResolvedValueOnce(false);
    await openRow('enhancement');
    await choose(providerSelect('enhancement'), 'anthropic');
    expect(saved).not.toHaveBeenCalled();
    expect(feedback.toast()?.canUndo).toBe(false);
  });

  it('keeps the memory curator patch', async () => {
    await openRow('memory-curator');
    await choose(providerSelect('memory-curator'), 'anthropic');
    expect(mockState.saveSettings).toHaveBeenCalledWith(
      { memory: { curatorProvider: 'anthropic', curatorModel: '' } },
      expect.any(Object),
    );
  });
});
