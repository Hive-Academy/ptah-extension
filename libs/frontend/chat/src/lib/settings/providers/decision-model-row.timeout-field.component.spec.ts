/**
 * DecisionModelTimeoutFieldComponent: the decision-model request timeout (`agentOrchestration.decisionModelTimeoutMs`),
 * shown in seconds and stored in milliseconds through `settings:get` / `settings:set`.
 */
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  LoggingService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { rpcSuccess } from '@ptah-extension/core/testing';
import { DECISION_MODEL_TIMEOUT_SETTING_KEY } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  DecisionModelTimeoutFieldComponent,
  decisionTimeoutText,
  parseDecisionTimeoutSeconds,
} from './decision-model-row.timeout-field.component';

describe('parseDecisionTimeoutSeconds', () => {
  it('clears the setting for an empty field', () => {
    expect(parseDecisionTimeoutSeconds('  ')).toEqual({ ok: true, ms: null });
  });

  it.each([
    ['1', 1_000],
    ['30', 30_000],
    [' 60 ', 60_000],
  ])('reads %p seconds as %p ms', (text, ms) => {
    expect(parseDecisionTimeoutSeconds(text)).toEqual({ ok: true, ms });
  });

  it.each(['0', '61', '2.5', '-3', 'abc', '1e3'])('rejects %p', (text) => {
    expect(parseDecisionTimeoutSeconds(text).ok).toBe(false);
  });
});

describe('decisionTimeoutText', () => {
  it.each<[unknown, string]>([
    [undefined, ''],
    [null, ''],
    ['15000', ''],
    [0, ''],
    [15_000, '15'],
    [500, '1'],
    [120_000, '60'],
  ])('shows %p as %p', (value, text) => {
    expect(decisionTimeoutText(value)).toBe(text);
  });
});

describe('DecisionModelTimeoutFieldComponent', () => {
  let fixture: ComponentFixture<DecisionModelTimeoutFieldComponent>;
  let call: jest.Mock;
  let stored: unknown;

  const field = (): HTMLInputElement => {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[data-testid="decision-timeout"]',
    );
    if (!input) throw new Error('timeout field missing');
    return input;
  };
  const setCalls = (): unknown[] =>
    call.mock.calls.filter(([method]) => method === 'settings:set').map(([, params]) => params);

  async function flush(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      fixture.detectChanges();
      for (let j = 0; j < 8; j += 1) await Promise.resolve();
    }
    fixture.detectChanges();
  }

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(DecisionModelTimeoutFieldComponent);
    await flush();
  }

  async function commit(value: string): Promise<void> {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    field().dispatchEvent(new Event('change'));
    await flush();
  }

  beforeEach(() => {
    stored = null;
    call = jest.fn(async (method: string, params: { value?: unknown }) => {
      if (method === 'settings:get') return rpcSuccess({ success: true, value: stored });
      stored = params.value;
      return rpcSuccess({ success: true });
    });
    TestBed.configureTestingModule({
      imports: [DecisionModelTimeoutFieldComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: { warn: jest.fn() } },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        SettingsSaveFeedbackService,
      ],
    });
  });

  afterEach(() => fixture?.destroy());

  it('reads the stored value in seconds', async () => {
    stored = 12_000;
    await create();
    expect(call).toHaveBeenCalledWith(
      'settings:get',
      { key: DECISION_MODEL_TIMEOUT_SETTING_KEY },
      { timeout: 5000 },
    );
    expect(field().value).toBe('12');
    expect(field().disabled).toBe(false);
  });

  it('saves a committed value in milliseconds', async () => {
    await create();
    await commit('25');
    expect(setCalls()).toEqual([{ key: DECISION_MODEL_TIMEOUT_SETTING_KEY, value: 25_000 }]);
    expect(TestBed.inject(SettingsSaveFeedbackService).toast()?.message).toBe(
      'Saved decision request timeout.',
    );
  });

  it('clears the setting when the field is emptied', async () => {
    stored = 12_000;
    await create();
    await commit('');
    expect(setCalls()).toEqual([{ key: DECISION_MODEL_TIMEOUT_SETTING_KEY, value: null }]);
  });

  it('shows a hint and writes nothing for an invalid value', async () => {
    await create();
    await commit('90');
    expect(setCalls()).toEqual([]);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="decision-timeout-error"]')?.textContent,
    ).toContain('Not saved. Enter whole seconds from 1 to 60');
  });

  it('locks the field and says so when the stored value cannot be read', async () => {
    call.mockImplementation(async () => rpcSuccess({ success: false }));
    await create();
    expect(field().disabled).toBe(true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="decision-timeout-read-error"]'),
    ).not.toBeNull();
  });

  it('writes nothing when the value is unchanged', async () => {
    stored = 12_000;
    await create();
    await commit('12');
    expect(setCalls()).toEqual([]);
  });
});
