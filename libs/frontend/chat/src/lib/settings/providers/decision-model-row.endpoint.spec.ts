/**
 * DecisionModelRowComponent, TASK_2026_684 C13: the Ollama Cloud and custom endpoint editors, the filtered picker
 * (`agent:listDecisionModels`) and the custom endpoint key. Covers: Ollama Cloud has no key input and a setup action;
 * the picker lists decision-capable models, says when the filter could not be applied, and never preselects; free
 * text is accepted (4.4); custom endpoint field hints mirror the host's URL rule and D4, block Save, and the key goes
 * in `decisionModelCustomApiKey`; Remove stored key follows `apiKeyStored`; host fixed sentences are repeated by
 * equality only; a newer suggestions request wins.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import {
  ClaudeRpcService,
  LoggingService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  type AgentListDecisionModelsResult,
  type AgentOrchestrationConfig,
  type DecisionModelStatusDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { DecisionModelRowComponent } from './decision-model-row.component';

/** Inline hints carry no "Could not save" lead: nothing was saved yet (P4 visual 3). */
const URL_HINT =
  'Base URL must be an absolute http or https URL without credentials, query or fragment.';
const HTTPS_HINT =
  'An API key needs an https base URL unless the endpoint is on this machine.';
const SAVE_FAILED =
  'Could not save the decision model. The saved choice is unchanged.';
const PARTIAL =
  'Some models could not be checked for decision support, so they are not listed. Type a model name to use one.';
const UNAVAILABLE = 'Could not check decision support. Type a model name.';

const status = (
  overrides: Partial<DecisionModelStatusDto> = {},
): DecisionModelStatusDto => ({
  selection: { kind: 'unset' },
  locality: null,
  reportsConfidence: false,
  state: 'unset',
  detail: null,
  ...overrides,
});

describe('DecisionModelRowComponent: Ollama Cloud and custom endpoint (TASK_2026_684 C13)', () => {
  let fixture: ComponentFixture<DecisionModelRowComponent>;
  let call: jest.Mock;
  let listModels: jest.Mock;
  let feedback: SettingsSaveFeedbackService;
  let current: DecisionModelStatusDto;
  let catalog: () => Promise<unknown>;
  let setConfigResult: { success: boolean; error?: string };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const text = (id: string): string =>
    byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const setConfigCalls = (): unknown[] =>
    call.mock.calls
      .filter(([method]) => method === 'agent:setConfig')
      .map(([, params]) => params);
  const suggestionIds = (): (string | null)[] =>
    Array.from(
      host().querySelectorAll('#decision-model-suggestions option'),
    ).map((option) => option.getAttribute('value'));
  const saveButton = (): HTMLButtonElement | null =>
    byTestId<HTMLButtonElement>('decision-save');
  const catalogResult = (
    result: AgentListDecisionModelsResult,
  ): (() => Promise<unknown>) => {
    return async () => rpcSuccess(result);
  };

  /** Microtasks only: a save starts the toast's dismiss timer, which `whenStable()` would wait out. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }

  async function create(initial: DecisionModelStatusDto = status()) {
    current = initial;
    fixture = TestBed.createComponent(DecisionModelRowComponent);
    fixture.componentRef.setInput('providers', [
      { id: 'anthropic', name: 'Anthropic' },
    ]);
    await flush();
  }

  async function open(): Promise<void> {
    byTestId<HTMLButtonElement>('consumer-edit-decision')?.click();
    await flush();
  }

  async function pickKind(kind: string): Promise<void> {
    const select = byTestId<HTMLSelectElement>('decision-kind');
    if (!select) throw new Error('kind picker missing');
    select.value = kind;
    select.dispatchEvent(new Event('change'));
    await flush();
  }

  async function type(id: string, value: string): Promise<void> {
    const field = byTestId<HTMLInputElement>(id);
    if (!field) throw new Error(`${id} missing`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await flush();
  }

  async function save(): Promise<void> {
    saveButton()?.click();
    await flush();
  }

  beforeEach(() => {
    setConfigResult = { success: true };
    catalog = catalogResult({
      models: ['clef:27b-cloud', 'clef-mini:4b-cloud'],
      filter: 'applied',
      undetermined: 0,
    });
    call = jest.fn(async (method: string) => {
      if (method === 'agent:getConfig')
        return rpcSuccess({
          decisionModel: current,
        } as AgentOrchestrationConfig);
      if (method === 'agent:listDecisionModels') return catalog();
      return rpcSuccess(setConfigResult);
    });
    listModels = jest.fn(async () => ({ models: [], totalCount: 0 }));
    TestBed.configureTestingModule({
      imports: [DecisionModelRowComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels } },
        { provide: LoggingService, useValue: { warn: jest.fn() } },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        { provide: VSCodeService, useValue: { isElectron: true } },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });

  afterEach(() => fixture?.destroy());

  describe('Ollama Cloud', () => {
    it('has no key input, says which key it uses, and its setup action asks for the Ollama Cloud wizard', async () => {
      await create();
      const emitted: string[] = [];
      fixture.componentInstance.setupProviderRequested.subscribe((id) =>
        emitted.push(id),
      );
      await open();
      await pickKind('ollama-cloud');
      expect(byTestId('decision-api-key')).toBeNull();
      expect(text('decision-cloud-help')).toContain(
        'Ollama Cloud provider key',
      );
      expect(text('decision-cloud-help')).toContain(
        'share one Ollama Cloud plan',
      );
      byTestId<HTMLButtonElement>('decision-cloud-setup')?.click();
      await flush();
      expect(emitted).toEqual(['ollama-cloud']);
      expect(byTestId('consumer-editor-decision')).toBeNull();
    });

    it('lists only decision-capable models and never preselects one (4.1, 4.5)', async () => {
      await create();
      await open();
      await pickKind('ollama-cloud');
      expect(call).toHaveBeenCalledWith(
        'agent:listDecisionModels',
        { source: 'ollama-cloud' },
        { timeout: 5000 },
      );
      expect(listModels).not.toHaveBeenCalled();
      expect(suggestionIds()).toEqual(['clef:27b-cloud', 'clef-mini:4b-cloud']);
      expect(byTestId<HTMLInputElement>('decision-model')?.value).toBe('');
      expect(saveButton()?.disabled).toBe(true);
      expect(text('decision-model-help')).toBe(
        'Suggestions list the Ollama Cloud models that support decisions. Any model name works.',
      );
    });

    it('accepts a model that is not suggested, saved as typed with Undo (4.4)', async () => {
      await create(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
        }),
      );
      await open();
      await pickKind('ollama-cloud');
      await type('decision-model', ' my-own:7b-cloud ');
      await save();
      expect(setConfigCalls()).toEqual([
        { decisionModel: { kind: 'ollama-cloud', model: 'my-own:7b-cloud' } },
      ]);
      expect(feedback.toast()?.canUndo).toBe(true);
    });

    it.each([
      ['partial', ['clef:27b-cloud'], 2, PARTIAL],
      ['partial', [], 1, PARTIAL],
      ['unavailable', [], 0, UNAVAILABLE],
    ] as const)(
      'says so when the filter is %s (models %j, undetermined %d)',
      async (filter, models, undetermined, help) => {
        catalog = catalogResult({
          models: [...models],
          filter,
          undetermined,
        });
        await create();
        await open();
        await pickKind('ollama-cloud');
        expect(suggestionIds()).toEqual([...models]);
        expect(text('decision-model-help')).toBe(help);
      },
    );

    it('a failed catalog read says decision support could not be checked and never blocks saving', async () => {
      catalog = async () => rpcError('RPC timeout: agent:listDecisionModels');
      await create();
      await open();
      await pickKind('ollama');
      expect(text('decision-model-help')).toBe(UNAVAILABLE);
      await type('decision-model', 'clef:27b');
      expect(saveButton()?.disabled).toBe(false);
    });

    it.each([
      [
        'models not an array',
        { models: 'clef', filter: 'applied', undetermined: 0 },
      ],
      [
        'a null model id',
        { models: [null], filter: 'applied', undetermined: 0 },
      ],
      [
        'a blank model id among valid ones',
        { models: ['clef:27b-cloud', ' '], filter: 'applied', undetermined: 0 },
      ],
      [
        'an unknown filter',
        { models: ['clef:27b-cloud'], filter: 'all', undetermined: 0 },
      ],
      [
        'no undetermined count',
        { models: ['clef:27b-cloud'], filter: 'applied' },
      ],
      [
        'a negative undetermined count',
        { models: ['clef:27b-cloud'], filter: 'applied', undetermined: -1 },
      ],
      [
        'unavailable with a model listed',
        { models: ['clef:27b-cloud'], filter: 'unavailable', undetermined: 0 },
      ],
      [
        'unavailable with an undetermined count',
        { models: [], filter: 'unavailable', undetermined: 1 },
      ],
      [
        'applied with an undetermined count',
        { models: [], filter: 'applied', undetermined: 1 },
      ],
      [
        'partial with no undetermined count',
        { models: ['clef:27b-cloud'], filter: 'partial', undetermined: 0 },
      ],
    ])(
      'drops an answer that is not a catalog result (%s)',
      async (_label, answer) => {
        catalog = async () => rpcSuccess(answer);
        await create();
        await open();
        await pickKind('ollama-cloud');
        expect(suggestionIds()).toEqual([]);
        expect(text('decision-model-help')).toBe(UNAVAILABLE);
      },
    );

    it('a newer request wins: a slow listing never fills the list of a later kind', async () => {
      let resolveSlow: (value: unknown) => void = () => undefined;
      catalog = () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        });
      await create();
      await open();
      await pickKind('ollama-cloud');
      expect(text('decision-model-help')).toBe('Loading model suggestions…');
      await pickKind('custom');
      resolveSlow(
        rpcSuccess({ models: ['late'], filter: 'applied', undetermined: 0 }),
      );
      await flush();
      expect(suggestionIds()).toEqual([]);
      expect(text('decision-model-help')).toBe(
        'Type the model name this endpoint serves.',
      );
    });

    it('offers the row-level setup link when the host reports no credential', async () => {
      await create(
        status({
          selection: { kind: 'ollama-cloud', model: 'clef:27b-cloud' },
          locality: 'remote',
          state: 'no-credential',
        }),
      );
      const emitted: string[] = [];
      fixture.componentInstance.setupProviderRequested.subscribe((id) =>
        emitted.push(id),
      );
      expect(text('decision-setup')).toBe('Set up Ollama Cloud');
      byTestId<HTMLButtonElement>('decision-setup')?.click();
      expect(emitted).toEqual(['ollama-cloud']);
    });
  });

  describe('custom endpoint', () => {
    it('has base URL, free-text model and key fields, with no suggestions', async () => {
      await create();
      await open();
      await pickKind('custom');
      expect(byTestId('decision-base-url')).not.toBeNull();
      expect(byTestId('decision-model')).not.toBeNull();
      expect(byTestId<HTMLInputElement>('decision-api-key')?.type).toBe(
        'password',
      );
      expect(
        host().querySelector('label[for="decision-model-api-key"]')
          ?.textContent,
      ).toContain('Endpoint API key (optional)');
      expect(suggestionIds()).toEqual([]);
      expect(
        call.mock.calls.some(
          ([method]) => method === 'agent:listDecisionModels',
        ),
      ).toBe(false);
      expect(text('decision-base-url-help')).toContain(
        'unless the endpoint is on this machine',
      );
    });

    it('marks an invalid base URL inline and keeps Save disabled; an empty field shows no hint', async () => {
      await create();
      await open();
      await pickKind('custom');
      expect(byTestId('decision-base-url-error')).toBeNull();
      await type('decision-model', 'm1');
      await type('decision-base-url', 'ftp://decide.example.com');
      const field = byTestId<HTMLInputElement>('decision-base-url');
      expect(text('decision-base-url-error')).toBe(URL_HINT);
      expect(text('decision-base-url-error')).not.toContain('Could not save');
      expect(byTestId('decision-base-url-error')?.getAttribute('role')).toBe(
        'alert',
      );
      expect(field?.getAttribute('aria-invalid')).toBe('true');
      expect(field?.getAttribute('aria-describedby')).toBe(
        'decision-model-base-url-help decision-model-base-url-error',
      );
      expect(saveButton()?.disabled).toBe(true);
    });

    it('reserves the hint slot so the editor height does not change when a hint appears (P4 re-review 7)', async () => {
      await create();
      await open();
      await pickKind('custom');
      const slot = byTestId('decision-base-url-error-slot');
      expect(slot?.className).toContain('min-h-8');
      // Empty slot: nothing to announce, and the field does not point at it.
      expect(slot?.textContent?.trim()).toBe('');
      expect(slot?.querySelector('[role="alert"]')).toBeNull();
      expect(
        byTestId('decision-base-url')?.getAttribute('aria-describedby'),
      ).toBe('decision-model-base-url-help');
      await type('decision-base-url', 'ftp://decide.example.com');
      expect(byTestId('decision-base-url-error-slot')).toBe(slot);
      expect(slot?.contains(byTestId('decision-base-url-error'))).toBe(true);
      // A narrow panel clamps the hint to the reserved lines; the title keeps the full sentence.
      const hint = byTestId('decision-base-url-error');
      expect(hint?.className).toContain('line-clamp-2');
      expect(hint?.getAttribute('title')).toBe(hint?.textContent?.trim());
      await type('decision-base-url', 'https://decide.example.com');
      expect(byTestId('decision-base-url-error-slot')).toBe(slot);
      expect(byTestId('decision-base-url-error')).toBeNull();
    });

    it('allows plain http without a key, but needs https for a key unless the host is loopback (D4)', async () => {
      await create();
      await open();
      await pickKind('custom');
      await type('decision-base-url', 'http://192.168.1.20:11434');
      await type('decision-model', 'clef:27b');
      expect(byTestId('decision-base-url-error')).toBeNull();
      expect(saveButton()?.disabled).toBe(false);
      await type('decision-api-key', 'sk-secret');
      expect(text('decision-base-url-error')).toBe(HTTPS_HINT);
      expect(saveButton()?.disabled).toBe(true);
      for (const loopback of [
        'http://localhost:8080',
        'http://127.0.0.5:11434',
        'http://[::1]:11434',
      ]) {
        await type('decision-base-url', loopback);
        expect(byTestId('decision-base-url-error')).toBeNull();
      }
      await type('decision-base-url', 'http://127.0.0.1.evil.com');
      expect(text('decision-base-url-error')).toBe(HTTPS_HINT);
    });

    it('sends the typed key in decisionModelCustomApiKey with the selection, then clears it (no Undo)', async () => {
      await create();
      await open();
      await pickKind('custom');
      await type('decision-base-url', 'https://decide.example.com/gw/');
      await type('decision-model', 'm1');
      await type('decision-api-key', ' sk-secret ');
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: {
            kind: 'custom',
            baseUrl: 'https://decide.example.com/gw/',
            model: 'm1',
          },
          decisionModelCustomApiKey: 'sk-secret',
        },
      ]);
      expect(host().textContent).not.toContain('sk-secret');
      expect(feedback.toast()?.canUndo).toBe(false);
    });

    it('a key typed for Jev is never sent for the custom endpoint', async () => {
      await create();
      await open();
      await pickKind('jev');
      await type('decision-api-key', 'sk-jev');
      await pickKind('custom');
      expect(byTestId<HTMLInputElement>('decision-api-key')?.value).toBe('');
      await type('decision-base-url', 'https://decide.example.com');
      await type('decision-model', 'm1');
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: {
            kind: 'custom',
            baseUrl: 'https://decide.example.com',
            model: 'm1',
          },
        },
      ]);
    });

    it('a stored key counts for D4 on its own origin and is removed only through Remove stored key', async () => {
      await create(
        status({
          selection: {
            kind: 'custom',
            baseUrl: 'http://decide.example.com/v1',
            model: 'm1',
          },
          locality: 'remote',
          state: 'ready',
          apiKeyStored: true,
        }),
      );
      await open();
      expect(byTestId<HTMLInputElement>('decision-api-key')?.value).toBe('');
      await type('decision-base-url', 'http://decide.example.com/v2');
      expect(text('decision-base-url-error')).toBe(HTTPS_HINT);
      expect(saveButton()?.disabled).toBe(true);
      await type('decision-base-url', 'https://decide.example.com');
      expect(byTestId('decision-base-url-error')).toBeNull();
      expect(setConfigCalls()).toEqual([]);
      byTestId<HTMLButtonElement>('decision-api-key-remove')?.click();
      await flush();
      expect(setConfigCalls()).toEqual([{ decisionModelCustomApiKey: '' }]);
    });

    it('a stored key is not carried to another origin: a keyless http edit there may be saved (D4)', async () => {
      await create(
        status({
          selection: {
            kind: 'custom',
            baseUrl: 'https://decide.example.com',
            model: 'm1',
          },
          locality: 'remote',
          state: 'ready',
          apiKeyStored: true,
        }),
      );
      await open();
      for (const other of [
        'http://other.example.com',
        'http://decide.example.com',
      ]) {
        await type('decision-base-url', other);
        expect(byTestId('decision-base-url-error')).toBeNull();
        expect(saveButton()?.disabled).toBe(false);
      }
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: {
            kind: 'custom',
            baseUrl: 'http://decide.example.com',
            model: 'm1',
          },
        },
      ]);
    });

    it('hides Remove stored key when the host reports none', async () => {
      await create(
        status({
          selection: {
            kind: 'custom',
            baseUrl: 'http://192.168.1.20:11434',
            model: 'm1',
          },
          locality: 'remote',
          state: 'ready',
          apiKeyStored: false,
        }),
      );
      await open();
      expect(byTestId('decision-api-key')).not.toBeNull();
      expect(byTestId('decision-api-key-remove')).toBeNull();
    });

    it('offers no Remove stored key on a fresh profile, where the host reports no custom key (P4 visual 4)', async () => {
      await create();
      await open();
      await pickKind('custom');
      expect(byTestId('decision-api-key')).not.toBeNull();
      expect(byTestId('decision-api-key-remove')).toBeNull();
    });

    it('repeats a host fixed sentence by equality, and any other host text as the fixed save failure', async () => {
      await create();
      await open();
      await pickKind('custom');
      await type('decision-base-url', 'https://decide.example.com');
      await type('decision-model', 'm1');
      setConfigResult = {
        success: false,
        error: DECISION_MODEL_KEY_NEEDS_HTTPS,
      };
      await save();
      expect(feedback.toast()?.message).toBe(DECISION_MODEL_KEY_NEEDS_HTTPS);
      setConfigResult = { success: false, error: '<b>raw host text</b>' };
      await type('decision-model', 'm2');
      await save();
      expect(feedback.toast()?.message).toBe(SAVE_FAILED);
    });

    it.each([
      ['an empty object', {}],
      ['a non-boolean success', { success: 'yes' }],
    ])(
      'treats %s as a failed save, never as saved',
      async (_label, response) => {
        await create();
        await open();
        await pickKind('custom');
        await type('decision-base-url', 'https://decide.example.com');
        await type('decision-model', 'm1');
        call.mockImplementation(async (method: string) => {
          if (method === 'agent:getConfig')
            return rpcSuccess({
              decisionModel: current,
            } as AgentOrchestrationConfig);
          return rpcSuccess(response);
        });
        await save();
        expect(setConfigCalls()).toHaveLength(1);
        expect(feedback.toast()?.message).toBe(SAVE_FAILED);
      },
    );

    it('names the endpoint host in the cell and the locality line', async () => {
      await create(
        status({
          selection: {
            kind: 'custom',
            baseUrl: 'https://decide.example.com/gw',
            model: 'm1',
          },
          locality: 'remote',
          state: 'ready',
          apiKeyStored: true,
        }),
      );
      expect(text('consumer-summary-decision')).toBe('decide.example.com · m1');
      expect(text('decision-locality')).toBe(
        'The request text and lane data are sent to decide.example.com.',
      );
    });
  });
});
