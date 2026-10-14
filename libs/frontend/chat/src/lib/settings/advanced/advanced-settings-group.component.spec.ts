import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import {
  ADVANCED_SETTINGS,
  ADVANCED_SETTING_GROUPS,
  type AdvancedSettingGroupId,
} from '@ptah-extension/shared';
import { AdvancedSettingsGroupComponent } from './advanced-settings-group.component';

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

type RpcReply = { success: boolean; data?: unknown; error?: string };

const DEFAULTS: Record<string, unknown> = Object.fromEntries(
  ADVANCED_SETTINGS.map((setting) => [setting.key, setting.default]),
);

const keysOf = (groupId: AdvancedSettingGroupId): string[] =>
  ADVANCED_SETTINGS.filter((setting) => setting.group === groupId).map(
    (setting) => setting.key,
  );

describe('AdvancedSettingsGroupComponent', () => {
  let fixture: ComponentFixture<AdvancedSettingsGroupComponent>;
  let stored: Record<string, unknown>;
  let readFails: boolean;
  let writeReply: () => Promise<RpcReply>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const field = (key: string): HTMLInputElement =>
    byTestId<HTMLInputElement>(`advanced-setting-${key}`) as HTMLInputElement;
  const reads = (): Array<{ key: string; timeout: unknown }> =>
    mockRpcCall.mock.calls
      .filter((call) => call[1] === 'settings:get')
      .map((call) => ({
        key: (call[2] as { key: string }).key,
        timeout: call[3],
      }));
  const writes = (): Array<{ key: string; value: unknown }> =>
    mockRpcCall.mock.calls
      .filter((call) => call[1] === 'settings:set')
      .map((call) => call[2] as { key: string; value: unknown });
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  async function create(groupId: AdvancedSettingGroupId): Promise<void> {
    fixture = TestBed.createComponent(AdvancedSettingsGroupComponent);
    fixture.componentRef.setInput('groupId', groupId);
    fixture.detectChanges();
    await settle();
  }

  /** Types into a number field, then commits it (blur / Enter fire `change`). */
  async function enter(key: string, text: string): Promise<void> {
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
      imports: [AdvancedSettingsGroupComponent],
      providers: [{ provide: VSCodeService, useValue: {} }],
    });
  });

  afterEach(() => fixture?.destroy());

  describe('load', () => {
    it('reads only the group keys, in parallel with a 5 s timeout, and shows the saved values', async () => {
      await create('memory-upkeep');
      const groupKeys = keysOf('memory-upkeep');
      expect(
        reads()
          .map((read) => read.key)
          .sort(),
      ).toEqual([...groupKeys].sort());
      expect(reads().every((read) => read.timeout === 5_000)).toBe(true);
      for (const key of groupKeys) {
        expect(field(key)).not.toBeNull();
      }
      // A key of another group gets no control.
      expect(byTestId('advanced-setting-cron.maxConcurrentJobs')).toBeNull();
      expect(field('memory.retention.processedDays').value).toBe('7');
      expect(field('memory.symbolInjectionEnabled').checked).toBe(true);
      expect(writes()).toEqual([]);
    });

    it('labels the section by its heading and gives it the group test id', async () => {
      await create('memory-upkeep');
      const section = byTestId('settings-section-memory-upkeep');
      const headingId = section?.getAttribute('aria-labelledby') ?? '';
      expect(
        host().querySelector(`[id="${headingId}"]`)?.textContent,
      ).toContain('Memory upkeep');
    });

    it.each(ADVANCED_SETTING_GROUPS.map((group) => group.id))(
      'renders one labelled control per descriptor for %s',
      async (groupId) => {
        await create(groupId);
        for (const key of keysOf(groupId)) {
          const input = field(key);
          expect(input).not.toBeNull();
          expect(byTestId(`advanced-setting-${key}-field`)).not.toBeNull();
          const help = input
            .getAttribute('aria-describedby')
            ?.split(' ')
            .includes(`advanced-setting-${key}-help`);
          expect(help).toBe(true);
          if (input.type === 'checkbox') {
            expect(input.getAttribute('aria-label')).toBeTruthy();
          } else {
            expect(
              host().querySelector(`label[for="advanced-setting-${key}"]`),
            ).not.toBeNull();
          }
        }
      },
    );

    it('shows a load error with Retry when a read fails, and Retry reads again', async () => {
      readFails = true;
      await create('scheduled-jobs');
      expect(
        byTestId('advanced-group-scheduled-jobs-load-error'),
      ).not.toBeNull();
      expect(field('cron.maxConcurrentJobs')).toBeNull();

      readFails = false;
      byTestId<HTMLButtonElement>(
        'advanced-group-scheduled-jobs-retry',
      )?.click();
      await settle();
      expect(byTestId('advanced-group-scheduled-jobs-load-error')).toBeNull();
      expect(field('cron.maxConcurrentJobs').value).toBe(
        String(DEFAULTS['cron.maxConcurrentJobs']),
      );
    });

    it('shows Retry after 5 s when a read never settles (host never ready), and leaves no timer behind', async () => {
      jest.useFakeTimers();
      try {
        mockRpcCall.mockImplementation(
          () => new Promise<RpcReply>(() => undefined),
        );
        fixture = TestBed.createComponent(AdvancedSettingsGroupComponent);
        fixture.componentRef.setInput('groupId', 'scheduled-jobs');
        fixture.detectChanges();
        expect(
          byTestId('advanced-group-scheduled-jobs-loading'),
        ).not.toBeNull();

        await jest.advanceTimersByTimeAsync(4_999);
        fixture.detectChanges();
        expect(byTestId('advanced-group-scheduled-jobs-retry')).toBeNull();

        await jest.advanceTimersByTimeAsync(1);
        fixture.detectChanges();
        expect(byTestId('advanced-group-scheduled-jobs-loading')).toBeNull();
        expect(byTestId('advanced-group-scheduled-jobs-retry')).not.toBeNull();
        // Retry starts a new deadline; destroying the group clears it, so it never fires afterwards.
        byTestId<HTMLButtonElement>(
          'advanced-group-scheduled-jobs-retry',
        )?.click();
        const group = fixture.componentInstance;
        expect(group['load']()).toBe('loading');
        fixture.destroy();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(group['load']()).toBe('loading');
      } finally {
        jest.useRealTimers();
      }
    });

    it('a rejected read also reaches the Retry state', async () => {
      mockRpcCall.mockRejectedValueOnce(new Error('gone'));
      await create('scheduled-jobs');
      expect(byTestId('advanced-group-scheduled-jobs-retry')).not.toBeNull();
    });

    it('flags a hand-edited stored value the shared validator refuses', async () => {
      stored['memory.retention.stuckDays'] = 2;
      stored['memory.symbolInjectionEnabled'] = 'yes';
      await create('memory-upkeep');
      expect(
        byTestId('advanced-setting-memory.retention.stuckDays-stored')
          ?.textContent,
      ).toContain(
        'The saved value is not valid. Save a new value to replace it. Default: 14 days.',
      );
      expect(
        field('memory.retention.stuckDays').getAttribute('aria-describedby'),
      ).toContain('advanced-setting-memory.retention.stuckDays-stored');
      expect(
        byTestId('advanced-setting-memory.symbolInjectionEnabled-stored')
          ?.textContent,
      ).toContain('Default: on.');
      expect(
        byTestId('advanced-setting-memory.retention.batchSize-stored'),
      ).toBeNull();
    });
  });

  describe('help text', () => {
    it('adds the range with its unit and the apply note', async () => {
      await create('memory-upkeep');
      const help = byTestId(
        'advanced-setting-memory.retention.processedDays-field',
      );
      expect(help?.textContent).toContain('Range: 1 to 365 days.');
      expect(help?.textContent).toContain('Applies on the next cleanup run.');
    });

    it('marks a restart key with the restart note and badge', async () => {
      await create('scheduled-jobs');
      const restart = byTestId('advanced-setting-cron.maxConcurrentJobs-field');
      expect(restart?.textContent).toContain('Restart Ptah to apply.');
      expect(restart?.querySelector('.badge')?.textContent?.trim()).toBe(
        'Restart',
      );
      await create('memory-upkeep');
      expect(host().querySelector('.badge')).toBeNull();
    });

    it('names the next Codex agent for codex keys and right away for live keys', async () => {
      await create('codex-agents');
      expect(
        byTestId('advanced-setting-agentOrchestration.codexWebSearch-field')
          ?.textContent,
      ).toContain('Applies to the next Codex agent you start.');
      await create('background-queries');
      expect(
        byTestId('advanced-setting-internalQuery.maxConcurrent-field')
          ?.textContent,
      ).toContain('Applies right away.');
    });
  });

  describe('number fields', () => {
    it('a valid commit writes the exact key and number, then says Saved', async () => {
      await create('memory-upkeep');
      await enter('memory.retention.processedDays', '30');
      expect(writes()).toEqual([
        { key: 'memory.retention.processedDays', value: 30 },
      ]);
      expect(
        byTestId('advanced-group-memory-upkeep-status')?.textContent,
      ).toContain('Saved Keep processed records for.');
      expect(field('memory.retention.processedDays').value).toBe('30');
    });

    it('accepts grouped digits', async () => {
      await create('memory-upkeep');
      await enter('memory.retention.batchSize', '1,000');
      expect(writes()).toEqual([
        { key: 'memory.retention.batchSize', value: 1_000 },
      ]);
    });

    it.each([
      ['7.5', 'Use a whole number from 1 to 365 days.'],
      ['0', 'Use a whole number from 1 to 365 days.'],
      ['366', 'Use a whole number from 1 to 365 days.'],
      ['abc', 'Enter a number.'],
      ['', 'Enter a value.'],
    ])('refuses %p inline and sends nothing', async (text, message) => {
      await create('memory-upkeep');
      await enter('memory.retention.processedDays', text);
      const input = field('memory.retention.processedDays');
      expect(
        byTestId('advanced-setting-memory.retention.processedDays-error')
          ?.textContent,
      ).toContain(message);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toContain(
        'advanced-setting-memory.retention.processedDays-error',
      );
      expect(input.value).toBe(text);
      expect(writes()).toEqual([]);
    });

    it('styles and announces a client error, with a forced error border', async () => {
      await create('memory-upkeep');
      const input = field('memory.retention.processedDays');
      expect(input.classList).not.toContain('input-error');
      await enter('memory.retention.processedDays', '0');
      const error = byTestId(
        'advanced-setting-memory.retention.processedDays-error',
      );
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.classList).toContain('text-error');
      expect(input.classList).toContain('input-error');
      expect(input.classList).toContain(
        '!border-[color:var(--ptah-error-ink,oklch(var(--er)))]',
      );
    });

    it('a decimal setting takes a fraction and has no unit suffix', async () => {
      await create('skill-upkeep');
      const input = field('skillSynthesis.replayValidation.minConfidence');
      expect(input.getAttribute('inputmode')).toBe('decimal');
      expect(
        input.parentElement?.querySelector('[aria-hidden="true"]'),
      ).toBeNull();
      expect(
        field('skillSynthesis.retirement.dormantAfterDays').getAttribute(
          'inputmode',
        ),
      ).toBe('numeric');
      await enter('skillSynthesis.replayValidation.minConfidence', '0.75');
      expect(writes()).toEqual([
        { key: 'skillSynthesis.replayValidation.minConfidence', value: 0.75 },
      ]);
    });

    it('an unchanged value is not written', async () => {
      await create('memory-upkeep');
      await enter('memory.retention.processedDays', '7');
      expect(writes()).toEqual([]);
    });

    it('a 0 = off value is written for a key whose minimum is 0', async () => {
      await create('scheduled-jobs');
      await enter('cron.catchupWindowMs', '0');
      expect(writes()).toEqual([{ key: 'cron.catchupWindowMs', value: 0 }]);
    });
  });

  describe('toggles', () => {
    it('writes a boolean and shows the read-back value', async () => {
      await create('codex-agents');
      const box = field('agentOrchestration.codexWebSearch');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(writes()).toEqual([
        { key: 'agentOrchestration.codexWebSearch', value: false },
      ]);
      expect(box.checked).toBe(false);
      expect(
        byTestId('advanced-group-codex-agents-status')?.textContent,
      ).toContain('Saved Codex web search.');
    });

    it('the text beside the toggle follows the read-back value', async () => {
      await create('codex-agents');
      const state = (): string | undefined =>
        byTestId(
          'advanced-setting-agentOrchestration.codexWebSearch-state',
        )?.textContent?.trim();
      expect(state()).toBe('Enabled');
      const box = field('agentOrchestration.codexWebSearch');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(state()).toBe('Disabled');
    });

    it('the text stays at the saved value when the write fails', async () => {
      writeReply = async () => {
        throw new Error('gone');
      };
      await create('workspace-harness');
      const box = field('harness.manageGitignore');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(
        byTestId(
          'advanced-setting-harness.manageGitignore-state',
        )?.textContent?.trim(),
      ).toBe('Enabled');
    });

    it('a transport failure leaves the box at the saved value', async () => {
      writeReply = async () => {
        throw new Error('gone');
      };
      await create('workspace-harness');
      const box = field('harness.manageGitignore');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await settle();
      expect(box.checked).toBe(true);
      expect(
        byTestId('advanced-group-workspace-harness-status')?.textContent,
      ).toContain(
        'Could not save Manage .gitignore. The saved setting is unchanged.',
      );
    });
  });

  describe('failed write', () => {
    it('never shows host error text: the field and status show the fixed message, the saved value and typed text stay', async () => {
      const SENTINEL =
        'SENTINEL-SECRET-7f3a at /home/someone/.ptah/settings.json';
      writeReply = async () => ({
        success: true,
        data: { success: false, error: SENTINEL },
      });
      await create('scheduled-jobs');
      await enter('cron.maxConcurrentJobs', '8');
      const label = ADVANCED_SETTINGS.find(
        (setting) => setting.key === 'cron.maxConcurrentJobs',
      )?.label;
      const fixed = `Could not save ${label}. The saved setting is unchanged.`;
      expect(host().textContent).not.toContain('SENTINEL-SECRET-7f3a');
      expect(host().innerHTML).not.toContain('SENTINEL-SECRET-7f3a');
      expect(
        byTestId('advanced-setting-cron.maxConcurrentJobs-error')?.textContent,
      ).toContain(fixed);
      expect(
        byTestId('advanced-group-scheduled-jobs-status')?.textContent,
      ).toContain(fixed);
      expect(field('cron.maxConcurrentJobs').value).toBe('8');
      expect(stored['cron.maxConcurrentJobs']).toBe(
        DEFAULTS['cron.maxConcurrentJobs'],
      );
    });

    it('bounds each write with a 5 s timeout', async () => {
      await create('scheduled-jobs');
      await enter('cron.maxConcurrentJobs', '8');
      const timeouts = mockRpcCall.mock.calls
        .filter((call) => call[1] === 'settings:set')
        .map((call) => call[3]);
      expect(timeouts).toEqual([5_000]);
    });

    it('a timed-out write frees the group and says the save is unconfirmed', async () => {
      writeReply = async () => ({
        success: false,
        error: 'RPC timeout: settings:set',
      });
      await create('scheduled-jobs');
      await enter('cron.maxConcurrentJobs', '8');
      const label = ADVANCED_SETTINGS.find(
        (setting) => setting.key === 'cron.maxConcurrentJobs',
      )?.label;
      expect(
        byTestId('advanced-setting-cron.maxConcurrentJobs-error')?.textContent,
      ).toContain(
        `Could not confirm saving ${label}. Reopen settings to see the saved value.`,
      );
      expect(
        field('cron.maxConcurrentJobs').getAttribute('aria-disabled'),
      ).toBeNull();

      // Not busy: the next edit is written.
      writeReply = async () => ({ success: true, data: { success: true } });
      await enter('cron.maxConcurrentJobs', '9');
      expect(writes()).toEqual([
        { key: 'cron.maxConcurrentJobs', value: 8 },
        { key: 'cron.maxConcurrentJobs', value: 9 },
      ]);
      expect(
        byTestId('advanced-setting-cron.maxConcurrentJobs-error'),
      ).toBeNull();
    });

    it('keeps every control busy while a write is in flight', async () => {
      let release: (reply: RpcReply) => void = () => undefined;
      writeReply = () =>
        new Promise<RpcReply>((resolve) => {
          release = resolve;
        });
      await create('memory-upkeep');
      const input = field('memory.retention.processedDays');
      input.value = '30';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      for (const key of keysOf('memory-upkeep')) {
        expect(field(key).getAttribute('aria-disabled')).toBe('true');
      }
      release({ success: true, data: { success: true } });
      await settle();
      expect(
        field('memory.retention.stuckDays').getAttribute('aria-disabled'),
      ).toBeNull();
    });
  });
});
