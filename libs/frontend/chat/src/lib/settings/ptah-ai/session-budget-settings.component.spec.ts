import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SESSION_BUDGET_SETTINGS,
  type SessionBudgetConfig,
  type SessionBudgetNumberSetting,
} from '@ptah-extension/shared';
import { SessionBudgetSettingsComponent } from './session-budget-settings.component';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

type Key = keyof SessionBudgetConfig;
type RpcReply = { success: boolean; data?: unknown; error?: string };

const DEFAULTS: Record<string, unknown> = Object.fromEntries(
  Object.values(SESSION_BUDGET_SETTINGS).map((setting) => [
    setting.key,
    setting.default,
  ]),
);

const NUMBER_KEYS = (Object.keys(SESSION_BUDGET_SETTINGS) as Key[]).filter(
  (key) => SESSION_BUDGET_SETTINGS[key].kind === 'number',
);

describe('SessionBudgetSettingsComponent', () => {
  let fixture: ComponentFixture<SessionBudgetSettingsComponent>;
  let stored: Record<string, unknown>;
  let readFails: boolean;
  let writeReply: () => Promise<RpcReply>;
  const tabManager = { clearSessionBudgets: jest.fn() };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const field = (key: Key): HTMLInputElement =>
    byTestId<HTMLInputElement>(`session-budget-${key}`) as HTMLInputElement;
  const writes = (): Array<{ key: string; value: unknown }> =>
    mockRpcCall.mock.calls
      .filter((call) => call[1] === 'settings:set')
      .map((call) => call[2] as { key: string; value: unknown });
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(SessionBudgetSettingsComponent);
    fixture.detectChanges();
    await settle();
  }

  /** Types into a number field, then commits it (blur / Enter fire `change`). */
  async function enter(key: Key, text: string): Promise<void> {
    const input = field(key);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new Event('change'));
    await settle();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    stored = { ...DEFAULTS };
    readFails = false;
    writeReply = async () => ({ success: true, data: { success: true } });
    mockRpcCall.mockImplementation(
      async (
        _vscode: unknown,
        method: string,
        params: { key: string; value?: unknown },
      ): Promise<RpcReply> => {
        if (method === 'settings:get') {
          return readFails
            ? { success: false, error: 'unreadable' }
            : {
                success: true,
                data: { success: true, value: stored[params.key] },
              };
        }
        const reply = await writeReply();
        if (reply.success && (reply.data as { success?: boolean })?.success) {
          stored[params.key] = params.value;
        }
        return reply;
      },
    );
    TestBed.configureTestingModule({
      imports: [SessionBudgetSettingsComponent],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: TabManagerService, useValue: tabManager },
      ],
    });
  });

  afterEach(() => fixture?.destroy());

  describe('load', () => {
    it('reads all ten sessionBudget keys and shows the saved values (TOKENS, 50M default)', async () => {
      await create();
      const read = mockRpcCall.mock.calls
        .filter((call) => call[1] === 'settings:get')
        .map((call) => (call[2] as { key: string }).key)
        .sort();
      expect(read).toEqual(
        Object.values(SESSION_BUDGET_SETTINGS)
          .map((setting) => setting.key)
          .sort(),
      );
      expect(read).toHaveLength(10);
      expect(field('tokens').value).toBe('50000000');
      expect(field('tightenPercent').value).toBe('50');
      expect(field('handoffPercent').value).toBe('80');
      expect(field('tightenWindowTokens').value).toBe('');
      expect(byTestId<HTMLSelectElement>('session-budget-unit')?.value).toBe(
        'tokens',
      );
      expect(field('enabled').checked).toBe(true);
      expect(field('blockAtLimit').checked).toBe(true);
      expect(writes()).toEqual([]);
    });

    it('bounds each settings read so an unanswered host RPC reaches the Retry state', async () => {
      await create();
      const readTimeouts = mockRpcCall.mock.calls
        .filter((call) => call[1] === 'settings:get')
        .map((call) => call[3]);
      expect(readTimeouts).toEqual(Array(10).fill(5_000));
    });

    it('shows a load error with Retry when a read fails, and Retry reads again', async () => {
      readFails = true;
      await create();
      expect(byTestId('session-budget-load-error')).not.toBeNull();
      expect(byTestId('session-budget-tokens')).toBeNull();

      readFails = false;
      byTestId<HTMLButtonElement>('session-budget-retry')?.click();
      await settle();
      expect(byTestId('session-budget-load-error')).toBeNull();
      expect(field('tokens').value).toBe('50000000');
    });

    it('says when a hand-edited stored value is out of bounds and the default applies', async () => {
      stored['sessionBudget.tokens'] = 5;
      await create();
      expect(byTestId('session-budget-tokens-stored')?.textContent).toContain(
        'Ptah uses the default (50,000,000)',
      );
    });
  });

  describe('bounds (SESSION_BUDGET_SETTINGS)', () => {
    it.each(NUMBER_KEYS)(
      '%s: below min and above max show an inline error and are not written',
      async (key) => {
        await create();
        const setting = SESSION_BUDGET_SETTINGS[
          key
        ] as SessionBudgetNumberSetting;
        const step = setting.integer ? 1 : 0.01;

        await enter(key, String(setting.min - step));
        expect(field(key).getAttribute('aria-invalid')).toBe('true');
        expect(byTestId(`session-budget-${key}-error`)?.textContent).toContain(
          'Enter a value from',
        );

        await enter(key, String(setting.max + step));
        expect(byTestId(`session-budget-${key}-error`)?.textContent).toContain(
          'Enter a value from',
        );
        expect(writes()).toEqual([]);
      },
    );

    // Handoff's minimum (20) is below the saved tighten (50), so its in-range edge here is the maximum.
    it.each(NUMBER_KEYS)(
      '%s: an in-range edge value is written',
      async (key) => {
        await create();
        const setting = SESSION_BUDGET_SETTINGS[
          key
        ] as SessionBudgetNumberSetting;
        const value = key === 'handoffPercent' ? setting.max : setting.min;
        await enter(key, String(value));
        expect(byTestId(`session-budget-${key}-error`)).toBeNull();
        expect(writes()).toEqual([{ key: setting.key, value }]);
      },
    );

    it('rejects fractions for whole-number settings and text for any', async () => {
      await create();
      await enter('handoffAfterCompactions', '2.5');
      expect(
        byTestId('session-budget-handoffAfterCompactions-error')?.textContent,
      ).toContain('whole number');
      await enter('usd', 'ten');
      expect(byTestId('session-budget-usd-error')?.textContent).toContain(
        'Enter a number',
      );
      expect(writes()).toEqual([]);
    });

    it('accepts grouped digits and writes the number', async () => {
      await create();
      await enter('tokens', '20,000,000');
      expect(writes()).toEqual([
        { key: 'sessionBudget.tokens', value: 20_000_000 },
      ]);
      expect(field('tokens').value).toBe('20000000');
    });

    it('a required field cannot be emptied', async () => {
      await create();
      await enter('tokens', '');
      expect(byTestId('session-budget-tokens-error')?.textContent).toContain(
        'Enter a value',
      );
      expect(writes()).toEqual([]);
    });
  });

  describe('tighten < handoff (isSessionBudgetPercentOrderValid)', () => {
    it('refuses a tighten percent at or above the saved handoff percent', async () => {
      await create();
      await enter('tightenPercent', '80');
      expect(
        byTestId('session-budget-tightenPercent-error')?.textContent,
      ).toContain('below Handoff at (80%)');
      expect(writes()).toEqual([]);
    });

    it('refuses a handoff percent at or below the saved tighten percent', async () => {
      await create();
      await enter('handoffPercent', '50');
      expect(
        byTestId('session-budget-handoffPercent-error')?.textContent,
      ).toContain('above Tighten at (50%)');
      expect(writes()).toEqual([]);
    });

    it('checks against the newly saved partner value', async () => {
      await create();
      await enter('handoffPercent', '95');
      await enter('tightenPercent', '90');
      expect(writes()).toEqual([
        { key: 'sessionBudget.handoffPercent', value: 95 },
        { key: 'sessionBudget.tightenPercent', value: 90 },
      ]);
    });

    it('revalidates and saves a pending tighten draft after its handoff partner changes', async () => {
      await create();
      await enter('tightenPercent', '85');
      expect(byTestId('session-budget-tightenPercent-error')).not.toBeNull();

      await enter('handoffPercent', '95');

      expect(byTestId('session-budget-tightenPercent-error')).toBeNull();
      expect(writes()).toEqual([
        { key: 'sessionBudget.handoffPercent', value: 95 },
        { key: 'sessionBudget.tightenPercent', value: 85 },
      ]);
    });

    it('does not save a partner draft the user is still typing in (focused), only re-validates it', async () => {
      await create();
      await enter('tightenPercent', '85');
      expect(byTestId('session-budget-tightenPercent-error')).not.toBeNull();

      // Handoff commits while focus has already moved into the tighten field.
      const handoff = field('handoffPercent');
      handoff.value = '95';
      handoff.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      handoff.dispatchEvent(new Event('change'));
      handoff.dispatchEvent(new FocusEvent('blur'));
      field('tightenPercent').dispatchEvent(new FocusEvent('focus'));
      await settle();

      expect(writes()).toEqual([
        { key: 'sessionBudget.handoffPercent', value: 95 },
      ]);
      expect(byTestId('session-budget-tightenPercent-error')).toBeNull();
      expect(field('tightenPercent').value).toBe('85');

      // Its own blur / Enter then saves it.
      field('tightenPercent').dispatchEvent(new Event('change'));
      await settle();
      expect(writes()).toEqual([
        { key: 'sessionBudget.handoffPercent', value: 95 },
        { key: 'sessionBudget.tightenPercent', value: 85 },
      ]);
    });
  });

  describe('tightenWindowTokens', () => {
    it('explains "advisory only until set", and an empty field writes null', async () => {
      stored['sessionBudget.tightenWindowTokens'] = 400_000;
      await create();
      expect(
        host().querySelector('#session-budget-tightenWindowTokens-help')
          ?.textContent,
      ).toContain('advisory only until set');
      await enter('tightenWindowTokens', '');
      expect(writes()).toEqual([
        { key: 'sessionBudget.tightenWindowTokens', value: null },
      ]);
    });
  });

  describe('failed write', () => {
    it('a refused write keeps the saved value, keeps the typed text and says so', async () => {
      writeReply = async () => ({
        success: true,
        data: { success: false, error: 'disk full' },
      });
      await create();
      await enter('tokens', '2000000');
      expect(byTestId('session-budget-tokens-error')?.textContent).toContain(
        'Could not save Token budget. The saved setting is unchanged.',
      );
      expect(byTestId('session-budget-status')?.textContent).toContain(
        'Could not save Token budget',
      );
      expect(field('tokens').value).toBe('2000000');
      expect(stored['sessionBudget.tokens']).toBe(50_000_000);
    });

    it('bounds each settings write with a timeout', async () => {
      await create();
      await enter('tokens', '2000000');
      const writeTimeouts = mockRpcCall.mock.calls
        .filter((call) => call[1] === 'settings:set')
        .map((call) => call[3]);
      expect(writeTimeouts).toEqual([5_000]);
    });

    it('a timed-out write frees the card and says the save is unconfirmed', async () => {
      writeReply = async () => ({
        success: false,
        error: 'RPC timeout: settings:set',
      });
      await create();
      await enter('tokens', '2000000');
      expect(byTestId('session-budget-tokens-error')?.textContent).toContain(
        'Could not confirm saving Token budget',
      );
      expect(field('tokens').getAttribute('aria-disabled')).toBeNull();
      expect(field('tokens').value).toBe('2000000');

      // Not busy: the next edit is written.
      writeReply = async () => ({ success: true, data: { success: true } });
      await enter('tokens', '3000000');
      expect(writes()).toEqual([
        { key: 'sessionBudget.tokens', value: 2_000_000 },
        { key: 'sessionBudget.tokens', value: 3_000_000 },
      ]);
      expect(byTestId('session-budget-tokens-error')).toBeNull();
    });

    it('a transport failure on a toggle leaves the box at the saved value', async () => {
      writeReply = async () => {
        throw new Error('timeout');
      };
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
        /* expected */
      });
      await create();
      const box = field('enabled');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(box.checked).toBe(true);
      expect(byTestId('session-budget-status')?.textContent).toContain(
        'Could not save',
      );
      warn.mockRestore();
    });
  });

  describe('toggles and unit', () => {
    it('writes a toggle and shows the read-back value', async () => {
      await create();
      const box = field('blockAtLimit');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(writes()).toEqual([
        { key: 'sessionBudget.blockAtLimit', value: false },
      ]);
      expect(box.checked).toBe(false);
      expect(byTestId('session-budget-status')?.textContent).toContain('Saved');
      expect(tabManager.clearSessionBudgets).not.toHaveBeenCalled();
    });

    // TASK_2026_614 F.4 / F-D: turning the budget off clears every tab's banner.
    it('clears the budget on every tab once "enabled" is saved off', async () => {
      await create();
      const box = field('enabled');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(tabManager.clearSessionBudgets).toHaveBeenCalledTimes(1);
    });

    it('keeps the tab budgets when turning the budget off is not saved', async () => {
      writeReply = async () => ({ success: true, data: { success: false } });
      await create();
      const box = field('enabled');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(tabManager.clearSessionBudgets).not.toHaveBeenCalled();
    });

    it('writes the unit', async () => {
      await create();
      const select = byTestId<HTMLSelectElement>(
        'session-budget-unit',
      ) as HTMLSelectElement;
      select.value = 'cost';
      select.dispatchEvent(new Event('change'));
      await settle();
      expect(writes()).toEqual([{ key: 'sessionBudget.unit', value: 'cost' }]);
      expect(select.value).toBe('cost');
    });
  });
});
