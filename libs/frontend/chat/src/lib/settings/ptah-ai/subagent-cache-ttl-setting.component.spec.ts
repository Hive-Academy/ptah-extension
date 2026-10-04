import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService,
  type ProvidersOrchestration,
  type ProvidersSettingsCommit,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type {
  SubagentPromptCacheTtlEnvOverride,
  SubagentPromptCacheTtlSetting,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SubagentCacheTtlSettingComponent } from './subagent-cache-ttl-setting.component';
import { isDisabledControl } from '../feedback/busy-disabled.testing';

type Orchestration = Pick<
  ProvidersOrchestration,
  'subagentPromptCacheTtl' | 'subagentPromptCacheTtlEnvOverride'
>;
const ready = <T>(data: T): ProvidersSettingsSection<T> => ({
  status: 'ready',
  data,
  error: null,
});
const idle: ProvidersSettingsCommit = {
  status: 'idle',
  saved: [],
  unsaved: [],
  unconfirmed: [],
  refreshFailed: false,
  message: null,
};
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const KEY = 'agentOrchestration.subagentPromptCacheTtl';

/** Stands in for the state service: a written save changes the host value, then the section is re-read (or fails to be). */
class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly orchestration = signal<ProvidersSettingsSection<Orchestration>>(
    ready({ subagentPromptCacheTtl: 'auto' }),
  );
  readonly reviewContext = jest.fn(() => CONTEXT);
  host: SubagentPromptCacheTtlSetting = 'auto';
  env: SubagentPromptCacheTtlEnvOverride | undefined = undefined;
  next: 'saved' | 'rejected' | 'unconfirmed' = 'saved';
  readable = true;
  readonly saveSettings = jest.fn(
    async (patch: { orchestration?: Orchestration }, _context: unknown) => {
      const value = patch.orchestration?.subagentPromptCacheTtl;
      if (this.next !== 'rejected' && value !== undefined) this.host = value;
      this.reread();
      const status =
        this.next === 'saved'
          ? 'saved'
          : this.next === 'rejected'
            ? 'failed'
            : 'unconfirmed';
      this.commit.set({
        ...idle,
        status,
        unsaved: status === 'failed' ? [KEY] : [],
        unconfirmed: status === 'unconfirmed' ? [KEY] : [],
      });
      return true;
    },
  );
  readonly refreshOrchestration = jest.fn(async () => this.reread());
  reread(): void {
    this.orchestration.set(
      this.readable
        ? ready({
            subagentPromptCacheTtl: this.host,
            subagentPromptCacheTtlEnvOverride: this.env,
          })
        : {
            status: 'error',
            data: null,
            error: 'Could not load this section. Retry.',
          },
    );
  }
}

describe('SubagentCacheTtlSettingComponent', () => {
  let fixture: ComponentFixture<SubagentCacheTtlSettingComponent>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const el = () => fixture.nativeElement as HTMLElement;
  const select = () =>
    el().querySelector<HTMLSelectElement>('[data-testid="subagent-cache-ttl"]');
  const envNotice = () =>
    el()
      .querySelector('[data-testid="subagent-cache-ttl-env"]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? null;
  const error = () =>
    el()
      .querySelector('[data-testid="subagent-cache-ttl-error"]')
      ?.textContent?.trim() ?? null;
  const recheck = () =>
    el().querySelector<HTMLButtonElement>(
      '[data-testid="subagent-cache-ttl-recheck"]',
    );
  async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    fixture.detectChanges();
  }
  function choose(value: string) {
    const node = select();
    if (!node) throw new Error('Missing select');
    node.value = value;
    node.dispatchEvent(new Event('change'));
  }

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [SubagentCacheTtlSettingComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(SubagentCacheTtlSettingComponent);
    fixture.detectChanges();
  });
  afterEach(() => {
    feedback.dismiss();
    TestBed.resetTestingModule();
  });

  it('offers the three values with a label, shows the saved one, and has no env notice without an override', () => {
    expect(
      Array.from(select()?.options ?? []).map((option) => [
        option.value,
        option.textContent?.trim(),
      ]),
    ).toEqual([
      ['auto', 'Auto (1 hour for sessions with subagents)'],
      ['5m', '5 minutes'],
      ['1h', '1 hour'],
    ]);
    expect(select()?.value).toBe('auto');
    expect(
      el()
        .querySelector('label[for="subagent-cache-ttl"]')
        ?.textContent?.trim(),
    ).toBe('Subagent prompt-cache TTL');
    expect(envNotice()).toBeNull();
    expect(select()?.getAttribute('aria-describedby')).toBeNull();
  });

  it('writes the chosen value through saveSettings, shows the read-back value, and offers Undo', async () => {
    choose('1h');
    await flush();
    expect(state.saveSettings).toHaveBeenCalledWith(
      { orchestration: { subagentPromptCacheTtl: '1h' } },
      CONTEXT,
    );
    expect(select()?.value).toBe('1h');
    expect(error()).toBeNull();
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved Subagent prompt-cache TTL to All Ptah apps.',
      canUndo: true,
    });
    await feedback.undo();
    await flush();
    expect(state.saveSettings).toHaveBeenLastCalledWith(
      { orchestration: { subagentPromptCacheTtl: 'auto' } },
      CONTEXT,
    );
    expect(select()?.value).toBe('auto');
  });

  it.each([['5m'], ['1h']] as const)(
    'with the env var set to %s: the select stays editable and the notice says it takes precedence',
    async (value) => {
      state.env = value;
      state.reread();
      fixture.detectChanges();
      expect(envNotice()).toBe(
        `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL=${value} is set in your environment and takes precedence.`,
      );
      expect(select()?.getAttribute('aria-describedby')).toBe(
        'subagent-cache-ttl-env',
      );
      expect(isDisabledControl(select())).toBe(false);
      choose('5m');
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { orchestration: { subagentPromptCacheTtl: '5m' } },
        CONTEXT,
      );
      expect(select()?.value).toBe('5m');
    },
  );

  it('with an invalid env var value: says it is ignored by Ptah', () => {
    state.env = 'invalid';
    state.reread();
    fixture.detectChanges();
    expect(envNotice()).toBe(
      'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL has an invalid value and is ignored by Ptah.',
    );
    expect(isDisabledControl(select())).toBe(false);
  });

  it('shows the re-read value and says it is unchanged when nothing was written', async () => {
    state.next = 'rejected';
    choose('5m');
    await flush();
    expect(select()?.value).toBe('auto');
    expect(error()).toBe(
      'Could not save the subagent prompt-cache TTL. The saved setting is unchanged.',
    );
    expect(feedback.toast()?.tone).toBe('alert');
  });

  it('shows no value and takes no writes when the outcome is unknown, until a re-read succeeds', async () => {
    state.next = 'unconfirmed';
    choose('1h');
    await flush();
    expect(select()?.value).toBe('');
    expect(isDisabledControl(select())).toBe(true);
    expect(error()).toContain(
      'Could not confirm whether the subagent prompt-cache TTL was saved',
    );
    state.saveSettings.mockClear();
    await fixture.componentInstance.select({
      target: select(),
    } as unknown as Event);
    expect(state.saveSettings).not.toHaveBeenCalled();
    recheck()?.click();
    await flush();
    expect(select()?.value).toBe('1h');
    expect(isDisabledControl(select())).toBe(false);
    expect(error()).toBeNull();
    expect(recheck()).toBeNull();
  });

  it('does not write when the same value is chosen again', async () => {
    choose('auto');
    await flush();
    expect(state.saveSettings).not.toHaveBeenCalled();
  });

  it('offers a re-read when the saved value has not loaded', async () => {
    state.orchestration.set({
      status: 'error',
      data: null,
      error: 'Could not load this section. Retry.',
    });
    fixture.detectChanges();
    expect(isDisabledControl(select())).toBe(true);
    expect(
      el().querySelector('[data-testid="subagent-cache-ttl-unloaded"]'),
    ).not.toBeNull();
    recheck()?.click();
    await flush();
    expect(state.refreshOrchestration).toHaveBeenCalled();
    expect(isDisabledControl(select())).toBe(false);
    expect(select()?.value).toBe('auto');
  });
});
