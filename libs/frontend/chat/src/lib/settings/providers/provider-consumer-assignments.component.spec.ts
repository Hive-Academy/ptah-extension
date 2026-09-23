/**
 * ProviderConsumerAssignmentsComponent specs — TASK_2026_523_c3df, Batch D-i, Part 5.
 *
 * Requirements covered:
 * 1. Six background-consumer rows in exact fixed order:
 *    Memory curator, Archaeologist lane, Synthesis lane, Judge lane, Replay lane, Judging & enhancement.
 * 2. Heading copy: "These assignments run background work. They do not select the main agent."
 * 3. Mandatory helper copy on Judging & enhancement only:
 *    "Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above."
 * 4. Sentinel translation pinned in BOTH directions:
 *    - Read direction: 'inherit' -> ''
 *    - Write direction: '' -> 'inherit'
 * 5. Row expansion: one inline editor expands at a time, using ProviderModelPickerComponent.
 * 6. Unavailable provider handling:
 *    - Shows inline readiness message matching design-spec.md state table.
 *    - Shows "Set up {provider}" button which emits setupProviderRequested.
 *    - Preserves the draft in memory (does not discard selection).
 *    - Save button is disabled with explanatory message visible (not unexplained).
 * 7. Enhancement time limit field:
 *    - Placed directly beneath Judging & enhancement.
 *    - Renders effective seconds before editing.
 *    - Bounds (min, max, default) derived from backend enhanceTimeoutMs, never invented.
 *    - Range validation and seconds-to-milliseconds save conversion.
 * 8. Timeout notice handling:
 *    - Renders "Enhancement stopped after {seconds} seconds. No changes were saved."
 *    - Retry button emits retryEnhancementRequested.
 *    - Change time limit button activates the timeout editor.
 * 9. Scope provenance strips on each row and timeout.
 * 10. Accessibility: min-h-9 (36 px) control heights and 2 px focus outlines.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import {
  ProvidersSettingsStateService,
  type ProvidersEditContext,
  type ProvidersEffectiveRoute,
  type ProvidersJudgingSettings,
  type ProvidersSettingsCommit,
  type ProvidersSettingsPatch,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type {
  ConfigGetScopesResult,
  ScopedSettingEntry,
  SkillLanesDto,
} from '@ptah-extension/shared';
import {
  ProviderConsumerAssignmentsComponent,
  toBackendJudgeModel,
  toPickerModel,
  type BackgroundConsumerId,
} from './provider-consumer-assignments.component';

class MockProvidersSettingsStateService {
  readonly routeStore = signal<ProvidersSettingsSection<ProvidersEffectiveRoute>>({
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
    ProvidersSettingsSection<{ curatorProvider?: string; curatorModel?: string }>
  >({
    status: 'ready',
    data: {
      curatorProvider: '',
      curatorModel: '',
    },
    error: null,
  });

  readonly lanesStore = signal<ProvidersSettingsSection<SkillLanesDto>>({
    status: 'ready',
    data: {
      archaeologist: {
        id: 'archaeologist',
        provider: '',
        model: '',
        defaultTier: 'haiku',
        structuredOutput: 'sdk',
        toolUse: 'required',
        timeoutMs: 120000,
        maxInputChars: 16000,
        maxPasses: 3,
      },
      synthesis: {
        id: 'synthesis',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        defaultTier: 'sonnet',
        structuredOutput: 'sdk',
        toolUse: 'none',
        timeoutMs: 90000,
        maxInputChars: 32000,
        maxPasses: 1,
      },
      judge: {
        id: 'judge',
        provider: '',
        model: '',
        defaultTier: 'haiku',
        structuredOutput: 'sdk',
        toolUse: 'none',
        timeoutMs: 30000,
        maxInputChars: 16000,
        maxPasses: 1,
      },
      replay: {
        id: 'replay',
        provider: '',
        model: '',
        defaultTier: 'haiku',
        structuredOutput: 'sdk',
        toolUse: 'none',
        timeoutMs: 30000,
        maxInputChars: 16000,
        maxPasses: 1,
      },
    },
    error: null,
  });

  readonly judgingStore = signal<ProvidersSettingsSection<ProvidersJudgingSettings>>({
    status: 'ready',
    data: {
      judgeProvider: '',
      judgeModel: 'inherit', // Wire value from backend
      enhanceTimeoutMs: {
        value: 120000,
        default: 120000,
        min: 15000,
        max: 600000,
      },
    },
    error: null,
  });

  readonly scopesStore = signal<ProvidersSettingsSection<ConfigGetScopesResult>>({
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
          key: 'skillSynthesis.judgeModel',
          scope: 'global',
          hasOverride: false,
          effectiveKey: 'skillSynthesis.judgeModel',
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
  readonly lanes = this.lanesStore.asReadonly();
  readonly judging = this.judgingStore.asReadonly();
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

  readonly refreshMemory = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly refreshLanes = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  readonly refreshJudging = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

  readonly saveSettings = jest
    .fn<Promise<void>, [ProvidersSettingsPatch, ProvidersEditContext]>()
    .mockImplementation(async () => {
      this.commitState.set({
        status: 'saved',
        saved: ['test'],
        unsaved: [],
        unconfirmed: [],
        refreshFailed: false,
        message: null,
      });
    });
}

function query(fixture: ComponentFixture<unknown>, testId: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function button(fixture: ComponentFixture<unknown>, testId: string): HTMLButtonElement | null {
  return query(fixture, testId) as HTMLButtonElement | null;
}

function inputEl(fixture: ComponentFixture<unknown>, testId: string): HTMLInputElement | null {
  return query(fixture, testId) as HTMLInputElement | null;
}

describe('ProviderConsumerAssignmentsComponent', () => {
  let fixture: ComponentFixture<ProviderConsumerAssignmentsComponent>;
  let component: ProviderConsumerAssignmentsComponent;
  let mockState: MockProvidersSettingsStateService;
  let mockModelsLoader: { listModels: jest.Mock };

  beforeEach(async () => {
    mockState = new MockProvidersSettingsStateService();
    mockModelsLoader = {
      listModels: jest.fn().mockResolvedValue({
        models: [
          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', supportsToolUse: true },
          { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', supportsToolUse: true },
        ],
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ProviderConsumerAssignmentsComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: mockState },
        { provide: PROVIDER_MODELS_LOADER, useValue: mockModelsLoader },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderConsumerAssignmentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('1. Fixed Order and Header Copy', () => {
    it('renders heading copy and description', () => {
      const heading = query(fixture, 'assignments-heading');
      const copy = query(fixture, 'assignments-copy');

      expect(heading?.textContent?.trim()).toBe('Background models');
      expect(copy?.textContent?.trim()).toBe(
        'These assignments run background work. They do not select the main agent.',
      );
    });

    it('renders exactly six rows in fixed canonical order', () => {
      const expectedRows: BackgroundConsumerId[] = [
        'memory-curator',
        'archaeologist',
        'synthesis',
        'judge',
        'replay',
        'judging-enhancement',
      ];

      const expectedNames = [
        'Memory curator',
        'Archaeologist lane',
        'Synthesis lane',
        'Judge lane',
        'Replay lane',
        'Judging & enhancement',
      ];

      for (let i = 0; i < expectedRows.length; i++) {
        const id = expectedRows[i];
        const rowEl = query(fixture, `consumer-row-${id}`);
        const nameEl = query(fixture, `consumer-name-${id}`);

        expect(rowEl).toBeTruthy();
        expect(nameEl?.textContent?.trim()).toBe(expectedNames[i]);
      }
    });

    it('renders mandatory helper copy on Judging & enhancement only', () => {
      const helperEl = query(fixture, 'consumer-helper-judging-enhancement');
      expect(helperEl?.textContent?.trim()).toBe(
        'Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.',
      );

      // Other rows must NOT have this helper copy
      expect(query(fixture, 'consumer-helper-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-helper-archaeologist')).toBeNull();
      expect(query(fixture, 'consumer-helper-synthesis')).toBeNull();
      expect(query(fixture, 'consumer-helper-judge')).toBeNull();
      expect(query(fixture, 'consumer-helper-replay')).toBeNull();
    });
  });

  describe('2. Sentinel Translation (Pinned in Both Directions)', () => {
    it('pure function toPickerModel maps "inherit" to empty string', () => {
      expect(toPickerModel('inherit')).toBe('');
      expect(toPickerModel('')).toBe('');
      expect(toPickerModel(undefined)).toBe('');
      expect(toPickerModel(null)).toBe('');
      expect(toPickerModel('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
    });

    it('pure function toBackendJudgeModel maps empty or whitespace string to "inherit"', () => {
      expect(toBackendJudgeModel('')).toBe('inherit');
      expect(toBackendJudgeModel('   ')).toBe('inherit');
      expect(toBackendJudgeModel(undefined)).toBe('inherit');
      expect(toBackendJudgeModel(null)).toBe('inherit');
      expect(toBackendJudgeModel('claude-3-5-sonnet')).toBe('claude-3-5-sonnet');
    });

    it('READ direction: adapts stored "inherit" to picker sentinel "" for Judging & enhancement', () => {
      mockState.judgingStore.set({
        status: 'ready',
        data: {
          judgeProvider: '',
          judgeModel: 'inherit',
          enhanceTimeoutMs: { value: 120000, default: 120000, min: 15000, max: 600000 },
        },
        error: null,
      });
      fixture.detectChanges();

      // Open edit for judging-enhancement
      button(fixture, 'consumer-edit-judging-enhancement')?.click();
      fixture.detectChanges();

      const picker = query(fixture, 'picker-judging-enhancement');
      expect(picker).toBeTruthy();

      // The model passed to currentDraft must be ''
      const select = picker?.querySelector(
        '[data-testid="provider-model-picker-model"]',
      ) as HTMLSelectElement;
      expect(select.value).toBe('');
    });

    it('READ direction: preserves explicit model name when stored in Judging & enhancement', () => {
      mockState.judgingStore.set({
        status: 'ready',
        data: {
          judgeProvider: 'anthropic',
          judgeModel: 'claude-3-5-haiku',
          enhanceTimeoutMs: { value: 120000, default: 120000, min: 15000, max: 600000 },
        },
        error: null,
      });
      fixture.detectChanges();

      button(fixture, 'consumer-edit-judging-enhancement')?.click();
      fixture.detectChanges();

      const picker = query(fixture, 'picker-judging-enhancement');
      const select = picker?.querySelector(
        '[data-testid="provider-model-picker-model"]',
      ) as HTMLSelectElement;
      expect(select.value).toBe('claude-3-5-haiku');
    });

    it('WRITE direction: maps picker "" sentinel to backend "inherit" upon save', async () => {
      // Start with explicit model stored
      mockState.judgingStore.set({
        status: 'ready',
        data: {
          judgeProvider: 'anthropic',
          judgeModel: 'claude-3-5-sonnet',
          enhanceTimeoutMs: { value: 120000, default: 120000, min: 15000, max: 600000 },
        },
        error: null,
      });
      fixture.detectChanges();

      button(fixture, 'consumer-edit-judging-enhancement')?.click();
      fixture.detectChanges();

      // User selects inherit ("") in model picker
      const modelSelect = query(
        fixture,
        'picker-judging-enhancement',
      )?.querySelector('[data-testid="provider-model-picker-model"]') as HTMLSelectElement;
      modelSelect.value = '';
      modelSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // Click Save
      button(fixture, 'save-button-judging-enhancement')?.click();
      fixture.detectChanges();

      expect(mockState.saveSettings).toHaveBeenCalledWith(
        {
          judging: {
            judgeProvider: 'anthropic',
            judgeModel: 'inherit', // Must be 'inherit' and NEVER ''
          },
        },
        expect.any(Object),
      );
    });

    it('WRITE direction: writes explicit model string when selected in picker', async () => {
      mockState.judgingStore.set({
        status: 'ready',
        data: {
          judgeProvider: 'anthropic',
          judgeModel: 'inherit',
          enhanceTimeoutMs: { value: 120000, default: 120000, min: 15000, max: 600000 },
        },
        error: null,
      });
      fixture.detectChanges();

      button(fixture, 'consumer-edit-judging-enhancement')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const modelSelect = query(
        fixture,
        'picker-judging-enhancement',
      )?.querySelector('[data-testid="provider-model-picker-model"]') as HTMLSelectElement;
      modelSelect.value = 'claude-3-5-sonnet';
      modelSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      button(fixture, 'save-button-judging-enhancement')?.click();
      fixture.detectChanges();

      expect(mockState.saveSettings).toHaveBeenCalledWith(
        {
          judging: {
            judgeProvider: 'anthropic',
            judgeModel: 'claude-3-5-sonnet',
          },
        },
        expect.any(Object),
      );
    });
  });

  describe('3. Inline Editing and Row Isolation', () => {
    it('expands one inline editor at a time and closes previous on switching', () => {
      // Open memory curator editor
      button(fixture, 'consumer-edit-memory-curator')?.click();
      fixture.detectChanges();

      expect(query(fixture, 'consumer-editor-memory-curator')).toBeTruthy();
      expect(query(fixture, 'consumer-editor-archaeologist')).toBeNull();

      // Now open archaeologist lane
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();

      // Memory curator editor must close, archaeologist must open
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-editor-archaeologist')).toBeTruthy();
    });

    it('cancels edit and discards draft when Cancel is clicked', () => {
      button(fixture, 'consumer-edit-synthesis')?.click();
      fixture.detectChanges();

      expect(query(fixture, 'consumer-editor-synthesis')).toBeTruthy();

      button(fixture, 'consumer-cancel-synthesis')?.click();
      fixture.detectChanges();

      expect(query(fixture, 'consumer-editor-synthesis')).toBeNull();
    });

    it('saves lane draft to lanes patch', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      // Select anthropic provider and haiku model
      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'anthropic';
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      button(fixture, 'save-button-archaeologist')?.click();
      fixture.detectChanges();

      expect(mockState.saveSettings).toHaveBeenCalledWith(
        {
          lanes: {
            archaeologist: {
              provider: 'anthropic',
              model: '',
            },
          },
        },
        expect.any(Object),
      );
    });

    it('saves memory curator draft to memory patch', async () => {
      button(fixture, 'consumer-edit-memory-curator')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-memory-curator',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'anthropic';
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      button(fixture, 'save-button-memory-curator')?.click();
      fixture.detectChanges();

      expect(mockState.saveSettings).toHaveBeenCalledWith(
        {
          memory: {
            curatorProvider: 'anthropic',
            curatorModel: '',
          },
        },
        expect.any(Object),
      );
    });
  });

  describe('4. Unavailable Provider and Draft Preservation', () => {
    it('keeps an uncheckable (unknown/skipped) provider saveable with an advisory note and preserves draft', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      // Select 'openai' which has status 'unknown' in mock: the host cannot check it, it has not failed.
      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'openai';
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      const alert = query(fixture, 'readiness-alert-archaeologist');
      const message = query(fixture, 'readiness-message-archaeologist');

      expect(alert?.getAttribute('role')).toBe('status');
      expect(message?.textContent?.trim()).toBe(
        'Ptah cannot check OpenAI before use. If requests fail, check that it is running and reachable.',
      );
      expect(button(fixture, 'readiness-setup-archaeologist')).toBeNull();

      // The selection in the picker must NOT be discarded
      expect(providerSelect.value).toBe('openai');

      // The note does not block saving.
      expect(button(fixture, 'save-button-archaeologist')?.disabled).toBe(false);
      expect(query(fixture, 'save-disabled-reason-archaeologist')).toBeNull();
    });

    it('allows "Follow main agent" to save when the active provider comes from the effective route', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      // Empty provider = follow the main agent; activeProviderId is 'anthropic' in the mock.
      expect(query(fixture, 'readiness-alert-archaeologist')).toBeNull();
    });

    it('emits setupProviderRequested with provider id when Set up button is clicked', async () => {
      const setupSpy = jest.fn();
      component.setupProviderRequested.subscribe(setupSpy);

      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'ollama';
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(button(fixture, 'save-button-archaeologist')?.disabled).toBe(true);
      button(fixture, 'readiness-setup-archaeologist')?.click();
      expect(setupSpy).toHaveBeenCalledWith('ollama');
    });

    it('renders needs-key readiness message for provider requiring key', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'ollama'; // has 'needs-key'
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, 'readiness-message-archaeologist');
      expect(message?.textContent?.trim()).toBe('Add an API key to connect Ollama.');
    });

    it('renders not-installed readiness message for CLI provider', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'custom-cli'; // has 'not-installed'
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, 'readiness-message-archaeologist');
      expect(message?.textContent?.trim()).toBe('Install custom-cli to use this connection.');
    });

    it('renders unreachable readiness message when probe failed', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'remote-bedrock'; // has 'unreachable'
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, 'readiness-message-archaeologist');
      expect(message?.textContent?.trim()).toBe(
        'Could not reach remote-bedrock; check the connection and retry.',
      );
    });

    it('renders unauthenticated readiness message when credential expired', async () => {
      button(fixture, 'consumer-edit-archaeologist')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const providerSelect = query(
        fixture,
        'picker-archaeologist',
      )?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
      providerSelect.value = 'expired-auth'; // has 'unauthenticated'
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      const message = query(fixture, 'readiness-message-archaeologist');
      expect(message?.textContent?.trim()).toBe(
        'Your credential is missing or expired; authenticate again.',
      );
    });
  });

  describe('5. Enhancement Time Limit Control', () => {
    it('displays effective seconds before editing from backend data', () => {
      const display = query(fixture, 'timeout-effective-display');
      expect(display?.textContent?.trim()).toBe('Time limit: 120 seconds');
    });

    it('derives bounds from backend enhanceTimeoutMs rather than inventing range', () => {
      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();

      const rangeHelper = query(fixture, 'timeout-range-helper');
      expect(rangeHelper?.textContent?.trim()).toContain(
        'Allowed: 15–600 seconds (default 120 seconds)',
      );

      const input = inputEl(fixture, 'timeout-input');
      expect(input?.min).toBe('15');
      expect(input?.max).toBe('600');
    });

    it('validates against backend bounds and shows validation error on out-of-range', () => {
      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();

      const input = inputEl(fixture, 'timeout-input');
      if (input) {
        input.value = '10'; // below min 15
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();

      const err = query(fixture, 'timeout-validation-error');
      expect(err?.textContent?.trim()).toBe('Must be between 15 and 600 seconds.');
      expect(button(fixture, 'timeout-save-button')?.disabled).toBe(true);
    });

    it('saves timeout converted to milliseconds and emits timeoutSaved', async () => {
      const timeoutSavedSpy = jest.fn();
      component.timeoutSaved.subscribe(timeoutSavedSpy);

      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();

      const input = inputEl(fixture, 'timeout-input');
      if (input) {
        input.value = '180';
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();

      button(fixture, 'timeout-save-button')?.click();
      fixture.detectChanges();

      expect(mockState.saveSettings).toHaveBeenCalledWith(
        {
          judging: {
            enhanceTimeoutMs: 180000,
          },
        },
        expect.any(Object),
      );
      expect(timeoutSavedSpy).toHaveBeenCalledWith(180);
    });

    it('handles timeoutNotice by showing alert and Retry/Change time limit links', () => {
      fixture.componentRef.setInput('timeoutNotice', { seconds: 37 });
      fixture.detectChanges();

      const alert = query(fixture, 'timeout-notice-alert');
      const text = query(fixture, 'timeout-notice-text');
      expect(alert).toBeTruthy();
      expect(text?.textContent?.trim()).toBe(
        'Enhancement stopped after 37 seconds. No changes were saved.',
      );

      // Retry button emits retryEnhancementRequested
      const retrySpy = jest.fn();
      component.retryEnhancementRequested.subscribe(retrySpy);
      button(fixture, 'timeout-retry-button')?.click();
      expect(retrySpy).toHaveBeenCalled();

      // Change time limit button opens the timeout editor
      button(fixture, 'timeout-change-limit-button')?.click();
      fixture.detectChanges();
      expect(query(fixture, 'timeout-editor')).toBeTruthy();
    });
  });

  describe('6. Scope Provenance and Accessibility', () => {
    it('renders scope row for provider, model, and timeout', () => {
      expect(query(fixture, 'scope-row-provider-memory-curator')).toBeTruthy();
      expect(query(fixture, 'scope-row-model-memory-curator')).toBeTruthy();
      expect(query(fixture, 'scope-row-timeout')).toBeTruthy();
    });

    it('complies with min-h-9 (36 px) control heights and focus outline classes on buttons', () => {
      const editBtn = button(fixture, 'consumer-edit-memory-curator');
      expect(editBtn?.className).toContain('min-h-9');
      expect(editBtn?.className).toContain('focus-visible:outline-2');
      expect(editBtn?.getAttribute('aria-label')).toBe('Edit Memory curator');

      const timeoutEditBtn = button(fixture, 'timeout-edit-button');
      expect(timeoutEditBtn?.className).toContain('min-h-9');
      expect(timeoutEditBtn?.className).toContain('focus-visible:outline-2');
    });
  });

  describe('7. Honest Section Loading and Provenance', () => {
    it('renders a not-loaded state with retry when a section read has not landed', () => {
      mockState.memoryStore.set({ status: 'unloaded', data: null, error: null });
      fixture.detectChanges();

      // All six rows stay in fixed order
      expect(query(fixture, 'consumer-row-memory-curator')).toBeTruthy();
      expect(query(fixture, 'consumer-row-archaeologist')).toBeTruthy();
      expect(query(fixture, 'consumer-row-judging-enhancement')).toBeTruthy();

      // No effective value renders for the unloaded section
      expect(query(fixture, 'consumer-summary-memory-curator')).toBeNull();
      expect(button(fixture, 'consumer-edit-memory-curator')).toBeNull();

      const notLoaded = query(fixture, 'consumer-notloaded-memory-curator');
      expect(notLoaded?.textContent).toContain('Could not load this section. Retry.');

      // Its own retry re-reads only that section
      button(fixture, 'consumer-retry-memory-curator')?.click();
      fixture.detectChanges();
      expect(mockState.refreshMemory).toHaveBeenCalled();
      expect(mockState.refreshLanes).not.toHaveBeenCalled();
      expect(mockState.refreshJudging).not.toHaveBeenCalled();
    });

    it('renders Loading without retry while a section is loading', () => {
      mockState.memoryStore.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();

      expect(query(fixture, 'consumer-notloaded-memory-curator')?.textContent).toContain(
        'Loading…',
      );
      expect(button(fixture, 'consumer-retry-memory-curator')).toBeNull();
    });

    it('renders an effective empty assignment when the section is loaded and empty', () => {
      // Default mock state: ready with empty strings — loaded and empty,
      // which is not the same as not loaded.
      expect(query(fixture, 'consumer-notloaded-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-summary-memory-curator')?.textContent?.trim()).toBe(
        'Follows main agent → anthropic · api-key → Default (haiku tier)',
      );
    });

    it('renders no timeout number while the judging read has not landed', () => {
      mockState.judgingStore.set({ status: 'unloaded', data: null, error: null });
      fixture.detectChanges();

      expect(query(fixture, 'timeout-effective-display')).toBeNull();
      expect(button(fixture, 'timeout-edit-button')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Time limit:');
      expect(fixture.nativeElement.textContent).not.toContain('120');
    });

    it('derives the timeout range and default from the backend payload only', () => {
      mockState.judgingStore.set({
        status: 'ready',
        data: {
          judgeProvider: '',
          judgeModel: 'inherit',
          enhanceTimeoutMs: { value: 60000, default: 45000, min: 30000, max: 90000 },
        },
        error: null,
      });
      fixture.detectChanges();

      expect(query(fixture, 'timeout-effective-display')?.textContent?.trim()).toBe(
        'Time limit: 60 seconds',
      );

      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();
      expect(query(fixture, 'timeout-range-helper')?.textContent?.trim()).toContain(
        'Allowed: 30–90 seconds (default 45 seconds)',
      );
    });

    it('renders Mixed sources when the scope source is unknown', () => {
      // memory keys have scope entries; the lane and timeout keys do not.
      const memoryBadge = query(fixture, 'scope-row-provider-memory-curator')?.querySelector(
        '[data-testid="scope-source-badge"]',
      );
      expect(memoryBadge?.textContent?.trim()).toBe('From Global · All Ptah apps');

      const laneBadge = query(fixture, 'scope-row-provider-archaeologist')?.querySelector(
        '[data-testid="scope-source-badge"]',
      );
      expect(laneBadge?.textContent?.trim()).toBe('Mixed sources');

      const timeoutBadge = query(fixture, 'scope-row-timeout')?.querySelector(
        '[data-testid="scope-source-badge"]',
      );
      expect(timeoutBadge?.textContent?.trim()).toBe('Mixed sources');
    });

    it('applies the deep-link input reactively after mount', () => {
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();

      fixture.componentRef.setInput('initialEditingConsumerId', 'memory-curator');
      fixture.detectChanges();
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeTruthy();

      fixture.componentRef.setInput('initialEditingConsumerId', 'judge');
      fixture.detectChanges();
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-editor-judge')).toBeTruthy();
    });
  });
});
