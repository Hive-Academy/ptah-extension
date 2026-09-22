import { TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup } from '@angular/forms';
import { AppStateManager } from '@ptah-extension/core';
import { SkillSettingsPanelComponent } from './skill-settings-panel.component';
function settingsForm(): FormGroup {
  const fb = new FormBuilder();
  return fb.group({
    enabled: [true],
    successesToPromote: [3],
    dedupCosineThreshold: [0.85],
    maxActiveSkills: [50],
    candidatesDir: [''],
    evictionDecayRate: [0.95],
    generalizationContextThreshold: [3],
    dedupClusterThreshold: [0.78],
    prefilterMinEdits: [1],
    prefilterMinToolUses: [2],
    judgeEnabled: [true],
    minJudgeScore: [6.0],
    maxPinnedSkills: [10],
    curatorEnabled: [true],
    curatorIntervalHours: [24],
    suggestionMinClusterSize: [2],
    suggestionMaxCandidates: [200],
    // Nested, mirroring the dotted wire keys: form path `drain.cronExpr`
    // ⇔ wire key `'drain.cronExpr'`. Angular forbids `.` in a FormGroup key.
    drain: fb.group({
      cronExpr: ['*/15 * * * *'],
      nightlyCronExpr: [''],
      weeklyCronExpr: [''],
      maxItemsPerRun: [4],
      nightlyMaxItemsPerRun: [40],
      weeklyMaxItemsPerRun: [400],
      perWorkspaceBatch: [1],
      foregroundBackoffMs: [300_000],
      pauseOnBattery: [true],
      maxAttempts: [3],
      staleClaimTtlMs: [900_000],
    }),
    budget: fb.group({ maxTokensPerDay: [2_000_000] }),
    trayKeepalive: [false],
  });
}

describe('SkillSettingsPanelComponent', () => {
  const navigation = { requestSettingsTab: jest.fn(), setCurrentView: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({ imports: [SkillSettingsPanelComponent], providers: [{ provide: AppStateManager, useValue: navigation }] });
  });
  function render(inputs: { form?: FormGroup; loaded?: boolean; saving?: boolean; isElectron?: boolean } = {}) {
    const fixture = TestBed.createComponent(SkillSettingsPanelComponent);
    fixture.componentRef.setInput('form', inputs.form ?? settingsForm());
    fixture.componentRef.setInput('loaded', inputs.loaded ?? true);
    fixture.componentRef.setInput('saving', inputs.saving ?? false);
    fixture.componentRef.setInput('isElectron', inputs.isElectron ?? false);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  it('replaces every lane and judge model editor with a targeted Providers link', () => {
    const { el } = render();
    expect(el.querySelector('ptah-provider-model-picker')).toBeNull();
    expect(el.querySelector('[formControlName="judgeModel"]')).toBeNull();
    for (const target of ['archaeologist', 'synthesis', 'judge', 'replay']) {
      const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent?.includes(`Manage ${target} in Providers`));
      button?.click();
      expect(navigation.requestSettingsTab).toHaveBeenLastCalledWith({ tab: 'providers', section: target });
    }
  });
  describe('Phase-0 background knobs', () => {
    /**
     * Every knob, with the FORM PATH it must resolve to. That path is
     * character-for-character the dotted settings key the wire DTO uses
     * (`skillSynthesis.drain.cronExpr`), which is the whole point of nesting
     * the groups this way — an unrouted key fails in the write direction only,
     * silently.
     */
    const KNOBS: ReadonlyArray<[string, string]> = [
      ['skills-budget-max-tokens-per-day', 'budget.maxTokensPerDay'],
      ['skills-drain-foreground-backoff-ms', 'drain.foregroundBackoffMs'],
      ['skills-drain-pause-on-battery', 'drain.pauseOnBattery'],
      ['skills-drain-cron-expr', 'drain.cronExpr'],
      ['skills-drain-nightly-cron-expr', 'drain.nightlyCronExpr'],
      ['skills-drain-weekly-cron-expr', 'drain.weeklyCronExpr'],
      ['skills-drain-max-items-per-run', 'drain.maxItemsPerRun'],
      ['skills-drain-nightly-max-items-per-run', 'drain.nightlyMaxItemsPerRun'],
      ['skills-drain-weekly-max-items-per-run', 'drain.weeklyMaxItemsPerRun'],
      ['skills-drain-per-workspace-batch', 'drain.perWorkspaceBatch'],
      ['skills-drain-max-attempts', 'drain.maxAttempts'],
      ['skills-drain-stale-claim-ttl-ms', 'drain.staleClaimTtlMs'],
    ];

    it.each(KNOBS)(
      'renders %s wired to the form path %s',
      (testId, formPath) => {
        const form = settingsForm();
        const { el } = render({ form });

        const input = el.querySelector<HTMLInputElement>(
          `[data-testid="${testId}"]`,
        );
        expect(input).not.toBeNull();

        const control = form.get(formPath);
        expect(control).not.toBeNull();
        // Bound, not merely present: a control Angular never attached would
        // leave the input blank / unchecked regardless of the control's value.
        if (input?.type === 'checkbox') {
          expect(input.checked).toBe(control?.value);
        } else {
          expect(input?.value).toBe(String(control?.value));
        }
      },
    );

    it('renders the daily token budget from the form', () => {
      const form = settingsForm();
      form.patchValue({ budget: { maxTokensPerDay: 1_500_000 } });

      const { el } = render({ form });

      const input = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-budget-max-tokens-per-day"]',
      );
      expect(input?.value).toBe('1500000');
    });

    it('writes an edited drain schedule back to the drain.cronExpr control', () => {
      const form = settingsForm();
      const { el } = render({ form });

      const input = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-drain-cron-expr"]',
      );
      if (!input) throw new Error('drain cron input not found');
      input.value = '0 * * * *';
      input.dispatchEvent(new Event('input'));

      expect(form.get('drain.cronExpr')?.value).toBe('0 * * * *');
    });

    it('writes the battery gate back to the drain.pauseOnBattery control', () => {
      const form = settingsForm();
      const { el } = render({ form });

      const checkbox = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-drain-pause-on-battery"]',
      );
      if (!checkbox) throw new Error('battery checkbox not found');
      expect(checkbox.checked).toBe(true);
      checkbox.click();

      expect(form.get('drain.pauseOnBattery')?.value).toBe(false);
    });

    it('writes the foreground backoff back to its control', () => {
      const form = settingsForm();
      const { el } = render({ form });

      const input = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-drain-foreground-backoff-ms"]',
      );
      if (!input) throw new Error('foreground backoff input not found');
      input.value = '60000';
      input.dispatchEvent(new Event('input'));

      expect(form.get('drain.foregroundBackoffMs')?.value).toBe(60000);
    });

    it('writes the daily token budget back to its control', () => {
      const form = settingsForm();
      const { el } = render({ form });

      const input = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-budget-max-tokens-per-day"]',
      );
      if (!input) throw new Error('token budget input not found');
      input.value = '500000';
      input.dispatchEvent(new Event('input'));

      expect(form.get('budget.maxTokensPerDay')?.value).toBe(500000);
    });

    it('writes the weekly item cap back to its own control, not the frequent one', () => {
      const form = settingsForm();
      const { el } = render({ form });

      const input = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-drain-weekly-max-items-per-run"]',
      );
      if (!input) throw new Error('weekly item cap input not found');
      input.value = '250';
      input.dispatchEvent(new Event('input'));

      expect(form.get('drain.weeklyMaxItemsPerRun')?.value).toBe(250);
      // The frequent tier is a DIFFERENT setting since TASK_2026_180 B0.10 —
      // editing one must not move the other.
      expect(form.get('drain.maxItemsPerRun')?.value).toBe(4);
    });

    it('names the tier in every item-cap label — one number never governed all three', () => {
      const { el } = render();

      /** The `<span>` caption of the `<label>` wrapping a knob's input. */
      const captionOf = (testId: string): string => {
        const input = el.querySelector<HTMLInputElement>(
          `[data-testid="${testId}"]`,
        );
        if (!input) throw new Error(`${testId} not found`);
        return (
          input.closest('label')?.querySelector('span')?.textContent?.trim() ??
          ''
        );
      };

      // The literal defect from TASK_2026_242: a bare "Max items per run" read
      // as authoritative for all three tiers while the nightly tier ignored it.
      expect(captionOf('skills-drain-max-items-per-run')).toBe(
        'Max items per run (frequent tier)',
      );
      expect(captionOf('skills-drain-nightly-max-items-per-run')).toBe(
        'Max items per run (nightly tier)',
      );
      expect(captionOf('skills-drain-weekly-max-items-per-run')).toBe(
        'Max items per run (weekly tier)',
      );
    });
  });

  describe('tray keepalive is Electron-only', () => {
    it('renders the toggle on Electron', () => {
      const { el } = render({ isElectron: true });

      expect(
        el.querySelector('[data-testid="skills-tray-keepalive"]'),
      ).not.toBeNull();
    });

    it('omits the toggle in the VS Code webview, which has no tray', () => {
      const { el } = render({ isElectron: false });

      expect(
        el.querySelector('[data-testid="skills-tray-keepalive"]'),
      ).toBeNull();
    });

    it('writes the toggle back into the form control on Electron', () => {
      const form = settingsForm();
      const { el } = render({ form, isElectron: true });

      const checkbox = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-tray-keepalive"]',
      );
      if (!checkbox) throw new Error('tray keepalive checkbox not found');
      checkbox.click();

      expect(form.value.trayKeepalive).toBe(true);
    });
  });

  describe('skeleton', () => {
    it('renders neither lanes nor knobs before settings have loaded', () => {
      const { el } = render({ loaded: false });

      expect(
        el.querySelector('[data-testid="skills-lanes-section"]'),
      ).toBeNull();
      expect(
        el.querySelector('[data-testid="skills-background-section"]'),
      ).toBeNull();
      expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    });
  });

  describe('save', () => {
    it('emits save when the button is clicked', () => {
      const { fixture, el } = render();
      const saved = jest.fn();
      fixture.componentInstance.save.subscribe(saved);

      const button = Array.from(el.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Save settings'),
      );
      button?.click();

      expect(saved).toHaveBeenCalledTimes(1);
    });
  });
});
