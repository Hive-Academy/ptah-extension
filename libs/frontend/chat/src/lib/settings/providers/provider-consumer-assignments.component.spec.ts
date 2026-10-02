/**
 * ProviderConsumerAssignmentsComponent specs — TASK_2026_523_c3df (Batch D-i, Part 5), restyled in TASK_2026_555 Batch 35.
 *
 * Requirements covered:
 * 1. Six background-consumer rows in exact fixed order, the heading copy, and the Judging & enhancement helper copy.
 * 2. Sentinel translation pinned in BOTH directions: read 'inherit' -> '', write '' -> 'inherit'.
 * 3. One reassignment popover at a time (the shared provider/model picker); a choice saves at once through
 *    SettingsSaveFeedbackService with Undo (D2); `assignmentSaved` comes from each write's own result (Batch 17);
 *    a failed write reverts the picker and alerts with fixed sentences (D15); D3 while another save runs.
 * 4. Unavailable provider: the fixed readiness sentence, nothing written, the choice kept, "Set up" emits
 *    setupProviderRequested; an uncheckable provider is only an advisory note and still saves.
 * 5. Enhancement time limit beneath Judging & enhancement, bounds from the backend only.
 * 6. table-xs density, "Follows main agent →" chips, scope provenance, dialog semantics.
 * 7. Honest loading states; the deep link opens the role's popover; Esc returns focus to the row cell.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
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
import { ProviderConsumerAssignmentsComponent } from './provider-consumer-assignments.component';
import { toBackendJudgeModel, toPickerModel, type BackgroundConsumerId } from './provider-consumer-rows';

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

  /** Resolves the per-call result: `false` = refused because another save is in flight (nothing written). */
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
    query(fixture, `picker-${id}`)?.querySelector('[data-testid="provider-model-picker-provider"]') as HTMLSelectElement;
  const modelSelect = (id: BackgroundConsumerId) =>
    query(fixture, `picker-${id}`)?.querySelector('[data-testid="provider-model-picker-model"]') as HTMLSelectElement;
  /**
   * A picker choice, as the user makes it; the popover saves on it. Microtasks only: a saved choice starts the
   * toast's dismiss timer, which `whenStable()` would wait out.
   */
  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    for (let i = 0; i < 3; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }
  function setJudging(judgeProvider: string, judgeModel: string): void {
    mockState.judgingStore.set({
      status: 'ready',
      data: { judgeProvider, judgeModel, enhanceTimeoutMs: { value: 120000, default: 120000, min: 15000, max: 600000 } },
      error: null,
    });
    fixture.detectChanges();
  }

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
        SettingsSaveFeedbackService,
      ],
    }).compileComponents();
    feedback = TestBed.inject(SettingsSaveFeedbackService);

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

    it('READ direction: adapts stored "inherit" to picker sentinel "" for Judging & enhancement', async () => {
      setJudging('', 'inherit');
      await openRow('judging-enhancement');
      expect(modelSelect('judging-enhancement').value).toBe('');
    });

    it('READ direction: preserves explicit model name when stored in Judging & enhancement', async () => {
      setJudging('anthropic', 'claude-3-5-haiku');
      await openRow('judging-enhancement');
      expect(modelSelect('judging-enhancement').value).toBe('claude-3-5-haiku');
    });

    it('WRITE direction: a picked "" (inherit) saves the backend "inherit" at once', async () => {
      setJudging('anthropic', 'claude-3-5-sonnet');
      await openRow('judging-enhancement');
      await choose(modelSelect('judging-enhancement'), '');
      expect(mockState.saveSettings).toHaveBeenCalledWith(
        { judging: { judgeProvider: 'anthropic', judgeModel: 'inherit' } }, // 'inherit', NEVER ''
        expect.any(Object),
      );
    });

    it('WRITE direction: a picked explicit model saves that model string at once', async () => {
      setJudging('anthropic', 'inherit');
      await openRow('judging-enhancement');
      await choose(modelSelect('judging-enhancement'), 'claude-3-5-sonnet');
      expect(mockState.saveSettings).toHaveBeenCalledWith(
        { judging: { judgeProvider: 'anthropic', judgeModel: 'claude-3-5-sonnet' } },
        expect.any(Object),
      );
    });
  });

  describe('3. Reassignment Popover (save on selection, Undo)', () => {
    it('opens one row popover at a time; switching rows closes the previous one', async () => {
      await openRow('memory-curator');
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeTruthy();
      expect(query(fixture, 'consumer-editor-archaeologist')).toBeNull();
      await openRow('archaeologist');
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-editor-archaeologist')).toBeTruthy();
    });

    it('closes from its Close button, writes nothing, and returns focus to the row cell', async () => {
      await openRow('synthesis');
      button(fixture, 'consumer-close-synthesis')?.click();
      await settle();
      expect(query(fixture, 'consumer-editor-synthesis')).toBeNull();
      expect(mockState.saveSettings).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button(fixture, 'consumer-edit-synthesis'));
    });

    it('a provider choice saves the lane at once, with a toast and an Undo that writes the previous value back', async () => {
      const saved = jest.fn();
      component.assignmentSaved.subscribe(saved);
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), 'anthropic');
      expect(mockState.saveSettings).toHaveBeenCalledWith(
        { lanes: { archaeologist: { provider: 'anthropic', model: '' } } }, { scopeKey: 'test-scope', activePath: '/workspace' });
      expect(feedback.toast()?.message).toBe('Saved Archaeologist lane assignment to All Ptah apps.');
      expect(feedback.toast()?.canUndo).toBe(true);
      expect(saved).toHaveBeenCalledWith({ id: 'archaeologist', provider: 'anthropic', model: '' });
      await feedback.undo();
      expect(mockState.saveSettings).toHaveBeenLastCalledWith(
        { lanes: { archaeologist: { provider: '', model: '' } } }, expect.any(Object));
      expect(saved).toHaveBeenLastCalledWith({ id: 'archaeologist', provider: '', model: '' });
    });

    it('saves the memory curator to the memory patch', async () => {
      await openRow('memory-curator');
      await choose(providerSelect('memory-curator'), 'anthropic');
      expect(mockState.saveSettings).toHaveBeenCalledWith(
        { memory: { curatorProvider: 'anthropic', curatorModel: '' } }, expect.any(Object));
    });

    it('D15: a write that did not save emits nothing, shows a fixed-sentence alert and puts the picker back', async () => {
      const saved = jest.fn();
      component.assignmentSaved.subscribe(saved);
      mockState.saveSettings.mockImplementationOnce(async () => {
        mockState.commitState.set({ status: 'failed', saved: [], unsaved: ['Archaeologist lane provider'], unconfirmed: [], refreshFailed: false, message: null });
        return true;
      });
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), 'anthropic');
      expect(saved).not.toHaveBeenCalled();
      expect(feedback.toast()).toEqual({
        tone: 'alert', canUndo: false,
        message: 'Could not save Archaeologist lane assignment. Not saved: Archaeologist lane provider.',
      });
      expect(providerSelect('archaeologist').value).toBe('');
    });

    it('a refused write (another save running) emits nothing and claims no save', async () => {
      const saved = jest.fn();
      component.assignmentSaved.subscribe(saved);
      mockState.saveSettings.mockResolvedValueOnce(false);
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), 'anthropic');
      expect(saved).not.toHaveBeenCalled();
      expect(feedback.toast()?.message).toBe('Another change is still saving.');
    });

    it('writes nothing while another save runs (D3): the cells are disabled', async () => {
      mockState.commitState.set({ status: 'saving', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null });
      await settle();
      expect(button(fixture, 'consumer-edit-judge')?.disabled).toBe(true);
    });
  });

  describe('4. Unavailable Provider and Draft Preservation', () => {
    it('keeps an uncheckable (unknown/skipped) provider: an advisory note, and the choice still saves', async () => {
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), 'openai'); // 'unknown': the host cannot check it, it has not failed
      expect(query(fixture, 'readiness-alert-archaeologist')?.getAttribute('role')).toBe('status');
      expect(query(fixture, 'readiness-message-archaeologist')?.textContent?.trim()).toBe(
        'Ptah cannot check OpenAI before use. If requests fail, check that it is running and reachable.');
      expect(button(fixture, 'readiness-setup-archaeologist')).toBeNull();
      expect(mockState.saveSettings).toHaveBeenCalledWith({ lanes: { archaeologist: { provider: 'openai', model: '' } } }, expect.any(Object));
    });

    it('"Follow main agent" needs no note when the active provider comes from the effective route', async () => {
      await openRow('archaeologist');
      expect(query(fixture, 'readiness-alert-archaeologist')).toBeNull();
    });

    it('a provider that is not ready is not saved; the choice is kept and Set up emits setupProviderRequested', async () => {
      const setupSpy = jest.fn();
      component.setupProviderRequested.subscribe(setupSpy);
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), 'ollama'); // 'needs-key'
      expect(mockState.saveSettings).not.toHaveBeenCalled();
      expect(query(fixture, 'readiness-alert-archaeologist')?.getAttribute('role')).toBe('alert');
      expect(query(fixture, 'readiness-message-archaeologist')?.textContent?.trim()).toBe('Add an API key to connect Ollama. Not saved.');
      expect(providerSelect('archaeologist').value).toBe('ollama');
      button(fixture, 'readiness-setup-archaeologist')?.click();
      expect(setupSpy).toHaveBeenCalledWith('ollama');
    });

    it.each([
      ['custom-cli', 'Install custom-cli to use this connection. Not saved.'],
      ['remote-bedrock', 'Could not reach remote-bedrock; check the connection and retry. Not saved.'],
      ['expired-auth', 'Your credential is missing or expired; authenticate again. Not saved.'],
    ])('renders the fixed readiness sentence for %s and saves nothing', async (provider, message) => {
      await openRow('archaeologist');
      await choose(providerSelect('archaeologist'), provider);
      expect(query(fixture, 'readiness-message-archaeologist')?.textContent?.trim()).toBe(message);
      expect(mockState.saveSettings).not.toHaveBeenCalled();
    });
  });

  describe('5. Enhancement Time Limit Control', () => {
    it('displays effective seconds before editing from backend data', () => {
      expect(query(fixture, 'timeout-effective-display')?.textContent?.trim()).toBe('Time limit: 120 seconds');
    });

    it('sits in its own table row directly beneath Judging & enhancement', () => {
      const judgingRow = query(fixture, 'consumer-row-judging-enhancement');
      expect(judgingRow?.nextElementSibling?.getAttribute('data-testid')).toBe('enhancement-timeout-section');
    });

    it('derives bounds from backend enhanceTimeoutMs rather than inventing range', async () => {
      button(fixture, 'timeout-edit-button')?.click();
      await settle();
      expect(query(fixture, 'timeout-range-helper')?.textContent?.trim()).toContain('Allowed: 15–600 seconds (default 120 seconds)');
      const input = inputEl(fixture, 'timeout-input');
      expect(input?.min).toBe('15');
      expect(input?.max).toBe('600');
      expect(document.activeElement).toBe(input);
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
      expect(query(fixture, 'timeout-validation-error')?.textContent?.trim()).toBe('Must be between 15 and 600 seconds.');
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
      await settle();
      expect(mockState.saveSettings).toHaveBeenCalledWith({ judging: { enhanceTimeoutMs: 180000 } }, expect.any(Object));
      expect(timeoutSavedSpy).toHaveBeenCalledWith(180);
    });

    it('a refused timeout save emits nothing', async () => {
      const timeoutSavedSpy = jest.fn();
      component.timeoutSaved.subscribe(timeoutSavedSpy);
      mockState.saveSettings.mockResolvedValueOnce(false);
      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();
      const input = inputEl(fixture, 'timeout-input');
      if (input) {
        input.value = '180';
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
      button(fixture, 'timeout-save-button')?.click();
      await settle();
      expect(timeoutSavedSpy).not.toHaveBeenCalled();
      expect(query(fixture, 'timeout-editor')).toBeTruthy();
    });

    it('handles timeoutNotice by showing alert and Retry/Change time limit links', () => {
      fixture.componentRef.setInput('timeoutNotice', { seconds: 37 });
      fixture.detectChanges();
      expect(query(fixture, 'timeout-notice-alert')).toBeTruthy();
      expect(query(fixture, 'timeout-notice-text')?.textContent?.trim()).toBe('Enhancement stopped after 37 seconds. No changes were saved.');
      const retrySpy = jest.fn();
      component.retryEnhancementRequested.subscribe(retrySpy);
      button(fixture, 'timeout-retry-button')?.click();
      expect(retrySpy).toHaveBeenCalled();
      button(fixture, 'timeout-change-limit-button')?.click();
      fixture.detectChanges();
      expect(query(fixture, 'timeout-editor')).toBeTruthy();
    });
  });

  describe('6. Table Density, Chips and Accessibility', () => {
    it('renders the roles as a table-xs with Role, Provider & model, Tier and Scope columns', () => {
      const table = query(fixture, 'consumer-table');
      expect(table?.tagName).toBe('TABLE');
      expect(table?.className).toContain('table-xs');
      const headers = Array.from(table?.querySelectorAll('thead th') ?? []).map((th) => th.textContent?.trim());
      expect(headers).toEqual(['Role', 'Provider & model', 'Tier', 'Scope']);
      expect(table?.querySelector('caption')?.textContent?.trim()).toBe('Background model roles');
    });

    it('shows "Follows main agent →" for a role without its own provider, and "{provider} · {model}" otherwise', () => {
      expect(query(fixture, 'consumer-summary-archaeologist')?.textContent?.trim()).toBe('Follows main agent → anthropic');
      expect(query(fixture, 'consumer-summary-synthesis')?.textContent?.trim()).toBe('anthropic · claude-3-5-sonnet');
      expect(query(fixture, 'consumer-tier-archaeologist')?.textContent?.trim()).toBe('haiku tier');
      expect(query(fixture, 'consumer-tier-synthesis')?.textContent?.trim()).toBe('direct model');
    });

    it('names each cell with the full route for screen readers, as a dialog trigger', () => {
      const cell = button(fixture, 'consumer-edit-memory-curator');
      expect(cell?.getAttribute('aria-label')).toBe('Memory curator: Follows main agent → anthropic · api-key → Default (haiku tier). Reassign');
      expect(cell?.getAttribute('aria-haspopup')).toBe('dialog');
      expect(cell?.getAttribute('aria-expanded')).toBe('false');
      expect(cell?.className).toContain('focus-visible:outline-2');
    });

    it('keeps each cell on one line: the label truncates, the full route is its title, the icon follows it (R1)', () => {
      const cell = button(fixture, 'consumer-edit-archaeologist');
      expect(cell?.className).toContain('whitespace-nowrap');
      expect(cell?.className).toContain('max-w-[15rem]');
      expect(cell?.getAttribute('title')).toBe('Follows main agent → anthropic · api-key → Default (haiku tier)');
      const label = query(fixture, 'consumer-summary-archaeologist');
      expect(label?.className).toContain('truncate');
      expect(label?.nextElementSibling?.tagName.toLowerCase()).toBe('lucide-angular');
      expect(button(fixture, 'consumer-edit-synthesis')?.getAttribute('title')).toBe('anthropic · claude-3-5-sonnet');
    });

    it('renders scope row for provider, model, and timeout', () => {
      expect(query(fixture, 'scope-row-provider-memory-curator')).toBeTruthy();
      expect(query(fixture, 'scope-row-model-memory-curator')).toBeTruthy();
      expect(query(fixture, 'scope-row-timeout')).toBeTruthy();
    });

    it('names the popover dialog "Reassign {role}"; the picker header (the role name) is its only visible title', async () => {
      await openRow('judge');
      const dialog = query(fixture, 'consumer-editor-judge');
      expect(dialog?.getAttribute('role')).toBe('dialog');
      expect(dialog?.getAttribute('aria-label')).toBe('Reassign Judge lane');
      expect(dialog?.querySelectorAll('h2, h3')).toHaveLength(0);
      expect(dialog?.querySelector('[data-testid="provider-model-picker-label"]')?.textContent?.trim()).toBe('Judge lane');
      expect(button(fixture, 'consumer-close-judge')?.getAttribute('aria-label')).toBe('Close');
      expect(button(fixture, 'consumer-edit-judge')?.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('7. Honest Section Loading and Provenance', () => {
    it('renders a not-loaded state with retry when a section read has not landed', () => {
      mockState.memoryStore.set({ status: 'unloaded', data: null, error: null });
      fixture.detectChanges();
      expect(query(fixture, 'consumer-row-memory-curator')).toBeTruthy();
      expect(query(fixture, 'consumer-row-archaeologist')).toBeTruthy();
      expect(query(fixture, 'consumer-row-judging-enhancement')).toBeTruthy();
      expect(query(fixture, 'consumer-summary-memory-curator')).toBeNull();
      expect(button(fixture, 'consumer-edit-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-notloaded-memory-curator')?.textContent).toContain('Could not load this section. Retry.');
      button(fixture, 'consumer-retry-memory-curator')?.click();
      fixture.detectChanges();
      expect(mockState.refreshMemory).toHaveBeenCalled();
      expect(mockState.refreshLanes).not.toHaveBeenCalled();
      expect(mockState.refreshJudging).not.toHaveBeenCalled();
    });

    it('renders Loading without retry while a section is loading', () => {
      mockState.memoryStore.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();
      expect(query(fixture, 'consumer-notloaded-memory-curator')?.textContent).toContain('Loading…');
      expect(button(fixture, 'consumer-retry-memory-curator')).toBeNull();
    });

    it('keeps the values and offers Retry when a later refresh of a loaded section failed', () => {
      mockState.lanesStore.update((section) => ({ ...section, status: 'error', error: 'Could not load this section. Retry.' }));
      fixture.detectChanges();
      expect(query(fixture, 'consumer-summary-synthesis')?.textContent?.trim()).toBe('anthropic · claude-3-5-sonnet');
      expect(query(fixture, 'consumer-reload-copy-synthesis')?.textContent?.trim()).toBe('Could not load this section. Retry.');
      button(fixture, 'consumer-retry-synthesis')?.click();
      expect(mockState.refreshLanes).toHaveBeenCalled();
    });

    it('renders an effective empty assignment when the section is loaded and empty', () => {
      // Default mock state: ready with empty strings — loaded and empty, which is not the same as not loaded.
      expect(query(fixture, 'consumer-notloaded-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-summary-memory-curator')?.textContent?.trim()).toBe('Follows main agent → anthropic');
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
        data: { judgeProvider: '', judgeModel: 'inherit', enhanceTimeoutMs: { value: 60000, default: 45000, min: 30000, max: 90000 } },
        error: null,
      });
      fixture.detectChanges();
      expect(query(fixture, 'timeout-effective-display')?.textContent?.trim()).toBe('Time limit: 60 seconds');
      button(fixture, 'timeout-edit-button')?.click();
      fixture.detectChanges();
      expect(query(fixture, 'timeout-range-helper')?.textContent?.trim()).toContain('Allowed: 30–90 seconds (default 45 seconds)');
    });

    it('renders Mixed sources when the scope source is unknown, and nothing for an inherited global value (D16)', () => {
      // memory keys have scope entries (global, inherited); the lane and timeout keys do not.
      expect(query(fixture, 'scope-row-provider-memory-curator')?.querySelector('[data-testid="scope-badge"]')).toBeNull();
      const laneBadge = query(fixture, 'scope-row-provider-archaeologist')?.querySelector('[data-testid="scope-badge"]');
      expect(laneBadge?.textContent).toContain('· Mixed sources');
      expect(laneBadge?.getAttribute('data-field')).toBeTruthy();
      const timeoutBadge = query(fixture, 'scope-row-timeout')?.querySelector('[data-testid="scope-badge"]');
      expect(timeoutBadge?.textContent).toContain('Enhancement time limit · Mixed sources');
    });

    it('applies the deep-link input reactively after mount: the role\'s popover opens', async () => {
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();
      fixture.componentRef.setInput('initialEditingConsumerId', 'memory-curator');
      await settle();
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeTruthy();
      fixture.componentRef.setInput('initialEditingConsumerId', 'judge');
      await settle();
      expect(query(fixture, 'consumer-editor-memory-curator')).toBeNull();
      expect(query(fixture, 'consumer-editor-judge')).toBeTruthy();
    });

    it('a role deep-linked again after the target was cleared (a later visit) opens its popover again', async () => {
      fixture.componentRef.setInput('initialEditingConsumerId', 'judge');
      await settle();
      button(fixture, 'consumer-close-judge')?.click();
      await settle();
      expect(query(fixture, 'consumer-editor-judge')).toBeNull();
      fixture.componentRef.setInput('initialEditingConsumerId', null);
      await settle();
      expect(query(fixture, 'consumer-editor-judge')).toBeNull();
      fixture.componentRef.setInput('initialEditingConsumerId', 'judge');
      await settle();
      expect(query(fixture, 'consumer-editor-judge')).toBeTruthy();
    });

    it('a deep-linked popover closed with Esc returns focus to its row cell', async () => {
      fixture.componentRef.setInput('initialEditingConsumerId', 'judge');
      await settle();
      const dialog = query(fixture, 'consumer-editor-judge');
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(query(fixture, 'consumer-editor-judge')).toBeNull();
      expect(document.activeElement).toBe(button(fixture, 'consumer-edit-judge'));
    });
  });
});
