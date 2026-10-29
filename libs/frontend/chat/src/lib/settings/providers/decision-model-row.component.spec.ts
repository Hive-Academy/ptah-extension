/**
 * DecisionModelRowComponent (TASK_2026_646 Batch 22, Req 1): the seventh Background Model Roles card.
 * Covers the kind switch, the five states with their detail text, the locality and no-confidence sentences, the
 * `agent:setConfig` payload per kind, the write-only Jev key (never echoed, explicit delete), a status read that
 * fails ("not reachable", saving still open) and the save error path through SettingsSaveFeedbackService.
 * Batch 40b (P4 fix round): an unread selection offers no Undo, logs carry only an error type, the structured list is
 * unfiltered with matching help text, Remove stored key follows the known key state, and the footer claims no false Undo.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  NativePopoverComponent,
  PROVIDER_MODELS_LOADER,
} from '@ptah-extension/ui';
import {
  ClaudeRpcService,
  LoggingService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import {
  DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
  type AgentOrchestrationConfig,
  type DecisionModelStatusDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { DecisionModelRowComponent } from './decision-model-row.component';

const SAVE_FAILED =
  'Could not save the decision model. The saved choice is unchanged.';

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

describe('DecisionModelRowComponent', () => {
  let fixture: ComponentFixture<DecisionModelRowComponent>;
  let call: jest.Mock;
  let listModels: jest.Mock;
  let warn: jest.Mock;
  let feedback: SettingsSaveFeedbackService;
  let current: DecisionModelStatusDto;
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

  /** Microtasks only: a save starts the toast's dismiss timer, which `whenStable()` would wait out. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }

  async function create(
    initial: DecisionModelStatusDto = status(),
    providers = [{ id: 'anthropic', name: 'Anthropic' }],
  ): Promise<void> {
    current = initial;
    fixture = TestBed.createComponent(DecisionModelRowComponent);
    fixture.componentRef.setInput('providers', providers);
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
    byTestId<HTMLButtonElement>('decision-save')?.click();
    await flush();
  }

  beforeEach(() => {
    setConfigResult = { success: true };
    call = jest.fn(async (method: string) => {
      if (method === 'agent:getConfig')
        return rpcSuccess({
          decisionModel: current,
        } as AgentOrchestrationConfig);
      if (method === 'agent:listDecisionModels')
        return rpcSuccess({
          models: ['tev1', 'laya'],
          filter: 'applied',
          undetermined: 0,
        });
      return rpcSuccess(setConfigResult);
    });
    listModels = jest.fn(async (providerId?: string) => ({
      models:
        providerId === 'ollama'
          ? [
              { id: 'tev1', name: 'tev1', supportsToolUse: false },
              { id: 'laya', name: 'laya', supportsToolUse: false },
            ]
          : [
              { id: 'with-tools', name: 'With tools', supportsToolUse: true },
              { id: 'no-tools', name: 'No tools', supportsToolUse: false },
            ],
      totalCount: 2,
    }));
    warn = jest.fn();
    TestBed.configureTestingModule({
      imports: [DecisionModelRowComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels } },
        { provide: LoggingService, useValue: { warn } },
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

  it('reads its status from agent:getConfig and renders as a role card', async () => {
    await create();
    expect(call).toHaveBeenCalledWith('agent:getConfig', undefined, {
      timeout: 5000,
    });
    expect(text('consumer-name-decision')).toBe('Decision model');
    expect(text('consumer-tier-decision')).toBe('unset');
    expect(text('consumer-summary-decision')).toBe('Unset · code ranking');
    expect(byTestId('consumer-row-decision')?.className).toContain('border-base-content/10');
  });

  describe('the five states (Req 1.5), with the host detail as plain text', () => {
    it.each([
      [status(), 'unset', 'no decision request is sent', null],
      [
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
          detail: 'last call failed: timeout',
        }),
        'ready',
        'Ollama is ready to answer routing questions.',
        null,
      ],
      [
        status({
          selection: {
            kind: 'structured',
            providerId: 'anthropic',
            model: 'm',
          },
          locality: 'remote',
          state: 'no-credential',
        }),
        'no credential',
        'has no credential. Set it up to use it.',
        'anthropic',
      ],
      [
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'remote',
          state: 'unreachable',
          detail: 'ECONNREFUSED',
        }),
        'not reachable',
        'Could not reach Ollama.',
        'ollama',
      ],
      [
        status({
          selection: { kind: 'ollama', model: 'laya' },
          locality: 'local',
          state: 'unsupported-endpoint',
          detail: 'Ollama 0.34.2 < 0.35.0',
        }),
        'not supported',
        'It needs Ollama 0.35 or later.',
        'ollama',
      ],
    ] as const)('%#: badge "%s"', async (initial, badge, message, setup) => {
      await create(initial);
      expect(text('consumer-tier-decision')).toBe(badge);
      expect(text('decision-state')).toContain(message);
      if (initial.detail)
        expect(text('decision-detail')).toBe(`Detail: ${initial.detail}`);
      else expect(byTestId('decision-detail')).toBeNull();
      const link = byTestId<HTMLButtonElement>('decision-setup');
      if (!setup) {
        expect(link).toBeNull();
        return;
      }
      const requested: string[] = [];
      fixture.componentInstance.setupProviderRequested.subscribe((id) =>
        requested.push(id),
      );
      link?.click();
      expect(requested).toEqual([setup]);
      expect(byTestId('decision-state')?.getAttribute('role')).toBe('alert');
    });

    it('never renders host detail as markup', async () => {
      await create(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          state: 'ready',
          detail: '<b id="x">bold</b>',
        }),
      );
      expect(text('decision-detail')).toBe('Detail: <b id="x">bold</b>');
      expect(host().querySelector('#x')).toBeNull();
    });
  });

  it('states where the data goes (Req 1.4)', async () => {
    await create(
      status({
        selection: { kind: 'ollama', model: 'tev1' },
        locality: 'local',
        state: 'ready',
      }),
    );
    expect(text('decision-locality')).toBe(
      'Runs on this machine: the request text and lane data stay on this machine.',
    );
    fixture.destroy();
    await create(
      status({
        selection: { kind: 'jev', model: 'jev-1.13.0' },
        locality: 'remote',
        state: 'ready',
      }),
    );
    expect(text('decision-locality')).toBe(
      'The request text and lane data are sent to TypeSafe Jev.',
    );
  });

  it('says a structured-output model reports no confidence (Req 1.8)', async () => {
    await create(
      status({
        selection: { kind: 'structured', providerId: 'anthropic', model: 'm' },
        locality: 'remote',
        state: 'ready',
      }),
    );
    expect(text('decision-confidence')).toBe(
      'This model reports no confidence, so its answers carry no confidence score.',
    );
  });

  describe('the kind picker (Req 1.2)', () => {
    it('offers every kind with Unset selected by default, and no fields for Unset', async () => {
      await create();
      await open();
      const options = Array.from(
        byTestId<HTMLSelectElement>('decision-kind')?.options ?? [],
      );
      expect(options.map((option) => option.textContent?.trim())).toEqual([
        'Unset',
        'Ollama decision model',
        'Ollama Cloud',
        'TypeSafe Jev',
        'Custom endpoint (/v1/systemone)',
        'Structured-output model',
      ]);
      expect(byTestId<HTMLSelectElement>('decision-kind')?.value).toBe('unset');
      expect(byTestId('decision-model')).toBeNull();
      expect(byTestId('decision-save')).toBeNull();
      expect(
        host().querySelector('label[for="decision-model-kind"]'),
      ).not.toBeNull();
    });

    it('Ollama: a free-text model with decision-capable suggestions from agent:listDecisionModels, saved as typed', async () => {
      await create();
      await open();
      await pickKind('ollama');
      expect(call).toHaveBeenCalledWith(
        'agent:listDecisionModels',
        { source: 'ollama' },
        { timeout: 5000 },
      );
      expect(listModels).not.toHaveBeenCalled();
      const suggestions = Array.from(
        host().querySelectorAll('#decision-model-suggestions option'),
      ).map((o) => o.getAttribute('value'));
      expect(suggestions).toEqual(['tev1', 'laya']);
      expect(text('decision-footer')).toBe(
        'Unset saves at once and sends no decision request. Other choices save with Save. Undo puts the previous choice back.',
      );
      expect(byTestId<HTMLButtonElement>('decision-save')?.disabled).toBe(true);
      await type('decision-model', 'clef-flash');
      await save();
      expect(setConfigCalls()).toEqual([
        { decisionModel: { kind: 'ollama', model: 'clef-flash' } },
      ]);
      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved decision model.',
        canUndo: true,
      });
    });

    it('Structured: a configured provider, then any model of its catalogue, with help text that matches the list (P4 M-4)', async () => {
      await create();
      await open();
      await pickKind('structured');
      const provider = byTestId<HTMLSelectElement>('decision-provider');
      expect(Array.from(provider?.options ?? []).map((o) => o.value)).toEqual([
        '',
        'anthropic',
      ]);
      if (provider) {
        provider.value = 'anthropic';
        provider.dispatchEvent(new Event('change'));
      }
      await flush();
      expect(listModels).toHaveBeenCalledWith('anthropic');
      expect(
        Array.from(
          host().querySelectorAll('#decision-model-suggestions option'),
        ).map((o) => o.getAttribute('value')),
      ).toEqual(['with-tools', 'no-tools']);
      expect(text('decision-model-help')).toBe(
        "Suggestions list this provider's models. Pick one that supports structured output (JSON schema); not every listed model does.",
      );
      expect(text('decision-model-help')).not.toContain('tool use');
      await type('decision-model', 'with-tools');
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: {
            kind: 'structured',
            providerId: 'anthropic',
            model: 'with-tools',
          },
        },
      ]);
    });

    it('Unset saves at once, with Undo back to the saved choice', async () => {
      await create(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
        }),
      );
      await open();
      await pickKind('unset');
      expect(setConfigCalls()).toEqual([{ decisionModel: { kind: 'unset' } }]);
      await feedback.undo();
      await flush();
      expect(setConfigCalls()[1]).toEqual({
        decisionModel: { kind: 'ollama', model: 'tev1' },
      });
    });
  });

  describe('the TypeSafe Jev key (write-only)', () => {
    it('is a password field that is never prefilled, sent once with the selection, then cleared (no Undo)', async () => {
      await create(
        status({
          selection: { kind: 'jev', model: 'jev-1.13.0' },
          locality: 'remote',
          state: 'ready',
        }),
      );
      await open();
      const key = byTestId<HTMLInputElement>('decision-api-key');
      expect(key?.type).toBe('password');
      expect(key?.value).toBe('');
      expect(byTestId<HTMLInputElement>('decision-model')?.value).toBe(
        'jev-1.13.0',
      );
      await type('decision-api-key', ' sk-secret ');
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: { kind: 'jev', model: 'jev-1.13.0' },
          decisionModelJevApiKey: 'sk-secret',
        },
      ]);
      expect(byTestId<HTMLInputElement>('decision-api-key')?.value).toBe('');
      expect(host().textContent).not.toContain('sk-secret');
      expect(feedback.toast()?.canUndo).toBe(false);
    });

    it('omits the optional model and never sends a blank key', async () => {
      await create();
      await open();
      await pickKind('jev');
      await type('decision-api-key', '   ');
      await save();
      expect(setConfigCalls()).toEqual([{ decisionModel: { kind: 'jev' } }]);
    });

    it('deletes the stored key only through the explicit Remove action', async () => {
      await create(
        status({
          selection: { kind: 'jev', model: 'jev-1.13.0' },
          locality: 'remote',
          state: 'ready',
        }),
      );
      await open();
      await type('decision-api-key', '');
      expect(setConfigCalls()).toEqual([]);
      byTestId<HTMLButtonElement>('decision-api-key-remove')?.click();
      await flush();
      expect(setConfigCalls()).toEqual([{ decisionModelJevApiKey: '' }]);
    });

    it('hides Remove stored key when the host reports no stored key, and says a key change has no Undo (P4 visual Minors)', async () => {
      await create(
        status({
          selection: { kind: 'jev', model: 'jev-1.13.0' },
          locality: 'remote',
          state: 'no-credential',
        }),
      );
      await open();
      expect(byTestId('decision-api-key')).not.toBeNull();
      expect(byTestId('decision-api-key-remove')).toBeNull();
      expect(text('decision-footer')).toBe(
        'Unset saves at once and sends no decision request. Other choices save with Save. Undo puts the previous choice back; a key change has no Undo.',
      );
    });

    it('offers no Remove stored key while the host cannot say a key is stored, e.g. a fresh profile (P4 visual 4)', async () => {
      await create(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
        }),
      );
      await open();
      await pickKind('jev');
      expect(byTestId('decision-api-key')).not.toBeNull();
      expect(byTestId('decision-api-key-remove')).toBeNull();
      await type('decision-api-key', 'sk-typed-not-saved');
      expect(byTestId('decision-api-key-remove')).toBeNull();
    });

    it('offers Remove stored key while the host reports one, then hides it once removed and focuses the key field', async () => {
      const jev = {
        selection: { kind: 'jev', model: 'jev-1.13.0' },
        locality: 'remote',
        state: 'ready',
      } as const;
      await create(status({ ...jev, apiKeyStored: true }));
      await open();
      expect(byTestId('decision-api-key-remove')).not.toBeNull();
      current = status({ ...jev, state: 'no-credential', apiKeyStored: false });
      byTestId<HTMLButtonElement>('decision-api-key-remove')?.click();
      await flush();
      expect(setConfigCalls()).toEqual([{ decisionModelJevApiKey: '' }]);
      expect(feedback.toast()?.canUndo).toBe(false);
      expect(byTestId('decision-api-key-remove')).toBeNull();
      expect(document.activeElement).toBe(byTestId('decision-api-key'));
    });
  });

  it('a save the host refuses alerts through the feedback toast with a fixed sentence, never host text', async () => {
    setConfigResult = { success: false, error: 'host detail' };
    await create();
    await open();
    await pickKind('ollama');
    await type('decision-model', 'tev1');
    await save();
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: SAVE_FAILED,
      canUndo: false,
    });
    expect(text('consumer-summary-decision')).toBe('Unset · code ranking');
  });

  it('says the key may have changed when the host could not restore it, not "unchanged"', async () => {
    setConfigResult = {
      success: false,
      error: DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
    };
    await create();
    await open();
    await pickKind('jev');
    await type('decision-api-key', 'sk-new');
    await save();
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
      canUndo: false,
    });
  });

  it('a status read that fails shows "not reachable" with Retry, and saving still works', async () => {
    call.mockImplementationOnce(async () =>
      rpcError('RPC timeout: agent:getConfig'),
    );
    await create(
      status({ selection: { kind: 'ollama', model: 'tev1' }, state: 'ready' }),
    );
    expect(text('consumer-tier-decision')).toBe('not reachable');
    expect(text('decision-state')).toContain(
      'You can still choose and save a decision model.',
    );
    expect(byTestId('decision-retry')).not.toBeNull();
    await open();
    await pickKind('ollama');
    await type('decision-model', 'nimble');
    await save();
    expect(setConfigCalls()).toEqual([
      { decisionModel: { kind: 'ollama', model: 'nimble' } },
    ]);
    // The write re-reads the status, which now answers.
    expect(text('consumer-tier-decision')).toBe('ready');
  });

  it('treats an unset selection the host could not read as not read: Retry, and a save offers no Undo that writes unset (40a D1)', async () => {
    await create(
      status({
        state: 'unreachable',
        detail: 'The saved decision model could not be read. It is unchanged.',
      }),
    );
    expect(text('consumer-tier-decision')).toBe('not reachable');
    expect(text('consumer-summary-decision')).toBe('Status not reachable');
    expect(text('decision-state')).toContain(
      'You can still choose and save a decision model.',
    );
    expect(byTestId('decision-retry')).not.toBeNull();
    await open();
    expect(text('decision-footer')).toContain(
      'The saved choice could not be read, so a save offers no Undo.',
    );
    await pickKind('ollama');
    await type('decision-model', 'tev1');
    await save();
    expect(setConfigCalls()).toEqual([
      { decisionModel: { kind: 'ollama', model: 'tev1' } },
    ]);
    expect(feedback.toast()?.canUndo).toBe(false);
    await feedback.undo();
    await flush();
    expect(setConfigCalls()).toHaveLength(1);
    expect(setConfigCalls()).not.toContainEqual({
      decisionModel: { kind: 'unset' },
    });
  });

  describe('logs carry a fixed message and an error type, never the raw error (P4 S-3)', () => {
    const SECRET = 'Bearer sk-secret-123 from the endpoint body';
    const logged = (): string => JSON.stringify(warn.mock.calls);

    it('a status read that throws', async () => {
      call.mockImplementationOnce(async () => {
        throw new Error(SECRET);
      });
      await create();
      expect(warn).toHaveBeenCalledWith(
        'DecisionModelRow',
        'agent:getConfig failed',
        { errorType: 'Error' },
      );
      expect(logged()).not.toContain('sk-secret');
      expect(host().textContent).not.toContain('sk-secret');
    });

    it('a save that throws', async () => {
      await create();
      await open();
      await pickKind('ollama');
      await type('decision-model', 'tev1');
      call.mockImplementationOnce(async () => {
        throw new TypeError(SECRET);
      });
      await save();
      expect(warn).toHaveBeenCalledWith(
        'DecisionModelRow',
        'agent:setConfig failed',
        { errorType: 'TypeError' },
      );
      expect(feedback.toast()?.message).toBe(SAVE_FAILED);
      expect(logged()).not.toContain('sk-secret');
    });

    it('a model listing that throws, or rejects with a non-Error', async () => {
      await create();
      await open();
      call.mockImplementationOnce(async () => {
        throw new Error(SECRET);
      });
      await pickKind('ollama');
      expect(warn).toHaveBeenCalledWith(
        'DecisionModelRow',
        'model suggestions failed',
        { errorType: 'Error' },
      );
      expect(text('decision-model-help')).toBe(
        'Could not check decision support. Type a model name.',
      );
      listModels.mockImplementationOnce(() => Promise.reject(SECRET));
      await pickKind('structured');
      const provider = byTestId<HTMLSelectElement>('decision-provider');
      if (!provider) throw new Error('provider picker missing');
      provider.value = 'anthropic';
      provider.dispatchEvent(new Event('change'));
      await flush();
      expect(text('decision-model-help')).toBe(
        'Could not list models. Type a model name.',
      );
      expect(warn).toHaveBeenLastCalledWith(
        'DecisionModelRow',
        'model suggestions failed',
        { errorType: 'string' },
      );
      expect(logged()).not.toContain('sk-secret');
    });
  });

  it('forces a readable control border and placeholder over the light-theme input rule (P4 visual S1, S2)', async () => {
    await create();
    await open();
    await pickKind('jev');
    for (const id of ['decision-kind', 'decision-model', 'decision-api-key'])
      expect(byTestId(id)?.className).toContain('!border-base-content-muted');
    for (const id of ['decision-model', 'decision-api-key'])
      expect(byTestId(id)?.className).toContain(
        'placeholder:!text-base-content-muted',
      );
  });

  it('closes on Close and returns focus to the cell', async () => {
    await create();
    await open();
    expect(byTestId('consumer-editor-decision')?.getAttribute('role')).toBe(
      'dialog',
    );
    byTestId<HTMLButtonElement>('consumer-close-decision')?.click();
    await flush();
    expect(byTestId('consumer-editor-decision')).toBeNull();
    expect(document.activeElement).toBe(byTestId('consumer-edit-decision'));
  });

  describe('the editor popover (P4 visual 1, 2, 5)', () => {
    const tab = (target: HTMLElement, shiftKey = false): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };

    it('repositions the popover when the kind changes, so a grown editor re-flips or re-shifts at once', async () => {
      await create();
      await open();
      const popover = fixture.debugElement.query(
        By.directive(NativePopoverComponent),
      ).componentInstance as NativePopoverComponent;
      const reposition = jest.spyOn(popover, 'reposition');
      await pickKind('custom');
      expect(reposition).toHaveBeenCalledTimes(1);
    });

    it('is a modal dialog capped to the viewport, with a fixed kind picker and a scrolling body', async () => {
      await create();
      await open();
      const editor = byTestId('consumer-editor-decision');
      expect(editor?.getAttribute('aria-modal')).toBe('true');
      expect(editor?.style.maxHeight).toMatch(/^\d+px$/);
      const body = byTestId('decision-editor-body');
      expect(body?.className).toContain('overflow-y-auto');
      // Short-window fallback: the body keeps 4rem and the whole editor scrolls, so Save stays reachable.
      expect(body?.className).toContain('min-h-16');
      expect(editor?.className).toContain('overflow-y-auto');
      // Opted into vertical shift, so a floored editor is pulled back inside a short viewport.
      const popover = fixture.debugElement.query(
        By.directive(NativePopoverComponent),
      );
      expect(
        (popover.componentInstance as NativePopoverComponent).keepInViewport(),
      ).toBe(true);
      expect(body?.contains(byTestId('decision-kind'))).toBe(false);
      expect(body?.contains(byTestId('decision-footer'))).toBe(false);
    });

    it('keeps Save and its footer text in a fixed footer after the scrolling body (P4 re-review 8)', async () => {
      await create();
      await open();
      await pickKind('ollama');
      const editor = byTestId('consumer-editor-decision');
      const body = byTestId('decision-editor-body');
      const save = byTestId('decision-save');
      const footer = byTestId('decision-footer');
      if (!editor || !body || !save || !footer)
        throw new Error('editor parts missing');
      // Direct children of the flex-column dialog, outside the body that scrolls (and shrinks to 4rem) first.
      for (const part of [save, footer]) {
        expect(part.parentElement).toBe(editor);
        expect(body.contains(part)).toBe(false);
        expect(
          body.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
      expect(editor.className).toContain('flex-col');
      expect(body.className).toContain('min-h-16');
    });

    it('puts the footer Save last in the Tab wrap: Tab on Save goes to Close, Shift+Tab on Close to Save', async () => {
      await create();
      await open();
      await pickKind('ollama');
      const model = byTestId<HTMLInputElement>('decision-model');
      if (!model) throw new Error('model field missing');
      model.value = 'clef:27b';
      model.dispatchEvent(new Event('input'));
      await flush();
      const save = byTestId<HTMLButtonElement>('decision-save');
      const close = byTestId<HTMLButtonElement>('consumer-close-decision');
      if (!save || !close) throw new Error('editor controls missing');
      expect(save.disabled).toBe(false);
      expect(tab(model).defaultPrevented).toBe(false);
      expect(tab(save).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);
      expect(tab(close, true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(save);
    });

    it('keeps Tab inside the editor: the last control wraps to Close, Shift+Tab on Close wraps back', async () => {
      await create();
      await open();
      await pickKind('ollama');
      const close = byTestId<HTMLButtonElement>('consumer-close-decision');
      const model = byTestId<HTMLInputElement>('decision-model');
      if (!close || !model) throw new Error('editor controls missing');
      // Save is disabled with an empty model, so the model field is the last stop.
      const forward = tab(model);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);
      const back = tab(close, true);
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(model);
      const inside = tab(byTestId<HTMLSelectElement>('decision-kind') ?? close);
      expect(inside.defaultPrevented).toBe(false);
    });

    it('moves focus into the dialog once the popover opens, and Shift+Tab there wraps to the last control', async () => {
      await create();
      await open();
      const editor = byTestId('consumer-editor-decision');
      if (!editor) throw new Error('editor missing');
      expect(editor.getAttribute('tabindex')).toBe('-1');
      // The popover focuses its own panel, then reports `opened`; the row hands focus on to the dialog.
      editor.parentElement?.focus();
      fixture.debugElement
        .query(By.directive(NativePopoverComponent))
        .componentInstance.opened.emit();
      expect(document.activeElement).toBe(editor);
      const back = tab(editor, true);
      expect(back.defaultPrevented).toBe(true);
      // Unset: the kind picker is the last enabled control.
      expect(document.activeElement).toBe(byTestId('decision-kind'));
    });

    it('closes on Escape from the focused dialog and returns focus to the cell', async () => {
      await create();
      await open();
      const editor = byTestId('consumer-editor-decision');
      fixture.debugElement
        .query(By.directive(NativePopoverComponent))
        .componentInstance.opened.emit();
      editor?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await flush();
      expect(byTestId('consumer-editor-decision')).toBeNull();
      expect(document.activeElement).toBe(byTestId('consumer-edit-decision'));
    });

    it('shows a model placeholder for Ollama Cloud and the custom endpoint, never a value (D3)', async () => {
      await create();
      await open();
      await pickKind('ollama-cloud');
      const model = (): HTMLInputElement | null =>
        byTestId<HTMLInputElement>('decision-model');
      expect(model()?.placeholder).toBe('e.g. clef:27b-cloud');
      expect(model()?.value).toBe('');
      await pickKind('custom');
      expect(model()?.placeholder).toBe('model id');
      expect(model()?.value).toBe('');
    });
  });
});
