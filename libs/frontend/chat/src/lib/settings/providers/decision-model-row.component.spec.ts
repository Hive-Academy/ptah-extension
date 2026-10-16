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
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import {
  ClaudeRpcService,
  LoggingService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import type {
  AgentOrchestrationConfig,
  DecisionModelStatusDto,
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
    call = jest.fn(async (method: string) =>
      method === 'agent:getConfig'
        ? rpcSuccess({ decisionModel: current } as AgentOrchestrationConfig)
        : rpcSuccess(setConfigResult),
    );
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
    expect(byTestId('consumer-row-decision')?.className).toContain('surface-2');
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
    it('offers exactly the four kinds with Unset selected by default, and no fields for Unset', async () => {
      await create();
      await open();
      const options = Array.from(
        byTestId<HTMLSelectElement>('decision-kind')?.options ?? [],
      );
      expect(options.map((option) => option.textContent?.trim())).toEqual([
        'Unset',
        'Ollama decision model',
        'TypeSafe Jev',
        'Structured-output model',
      ]);
      expect(byTestId<HTMLSelectElement>('decision-kind')?.value).toBe('unset');
      expect(byTestId('decision-model')).toBeNull();
      expect(byTestId('decision-save')).toBeNull();
      expect(
        host().querySelector('label[for="decision-model-kind"]'),
      ).not.toBeNull();
    });

    it('Ollama: a free-text model with suggestions from the Ollama catalogue, saved as typed', async () => {
      await create();
      await open();
      await pickKind('ollama');
      expect(listModels).toHaveBeenCalledWith('ollama');
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
      const key = byTestId<HTMLInputElement>('decision-jev-key');
      expect(key?.type).toBe('password');
      expect(key?.value).toBe('');
      expect(byTestId<HTMLInputElement>('decision-model')?.value).toBe(
        'jev-1.13.0',
      );
      await type('decision-jev-key', ' sk-secret ');
      await save();
      expect(setConfigCalls()).toEqual([
        {
          decisionModel: { kind: 'jev', model: 'jev-1.13.0' },
          decisionModelJevApiKey: 'sk-secret',
        },
      ]);
      expect(byTestId<HTMLInputElement>('decision-jev-key')?.value).toBe('');
      expect(host().textContent).not.toContain('sk-secret');
      expect(feedback.toast()?.canUndo).toBe(false);
    });

    it('omits the optional model and never sends a blank key', async () => {
      await create();
      await open();
      await pickKind('jev');
      await type('decision-jev-key', '   ');
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
      await type('decision-jev-key', '');
      expect(setConfigCalls()).toEqual([]);
      byTestId<HTMLButtonElement>('decision-jev-key-remove')?.click();
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
      expect(byTestId('decision-jev-key')).not.toBeNull();
      expect(byTestId('decision-jev-key-remove')).toBeNull();
      expect(text('decision-footer')).toBe(
        'Unset saves at once and sends no decision request. Other choices save with Save. Undo puts the previous choice back; a key change has no Undo.',
      );
    });

    it('offers Remove stored key while the key state is unknown, then hides it once removed and focuses the key field', async () => {
      await create(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
        }),
      );
      await open();
      await pickKind('jev');
      expect(byTestId('decision-jev-key-remove')).not.toBeNull();
      byTestId<HTMLButtonElement>('decision-jev-key-remove')?.click();
      await flush();
      expect(setConfigCalls()).toEqual([{ decisionModelJevApiKey: '' }]);
      expect(feedback.toast()?.canUndo).toBe(false);
      expect(byTestId('decision-jev-key-remove')).toBeNull();
      expect(document.activeElement).toBe(byTestId('decision-jev-key'));
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
      listModels.mockImplementationOnce(async () => {
        throw new Error(SECRET);
      });
      await create();
      await open();
      await pickKind('ollama');
      expect(warn).toHaveBeenCalledWith(
        'DecisionModelRow',
        'model suggestions failed',
        { errorType: 'Error' },
      );
      expect(text('decision-model-help')).toBe(
        'Could not list models. Type a model name.',
      );
      listModels.mockImplementationOnce(() => Promise.reject(SECRET));
      await pickKind('jev');
      await pickKind('ollama');
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
    for (const id of ['decision-kind', 'decision-model', 'decision-jev-key'])
      expect(byTestId(id)?.className).toContain('!border-base-content-muted');
    for (const id of ['decision-model', 'decision-jev-key'])
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
});
