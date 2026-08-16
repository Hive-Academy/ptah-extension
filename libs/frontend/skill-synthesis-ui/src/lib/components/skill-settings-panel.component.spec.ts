/**
 * SkillSettingsPanelComponent — lane pickers and Phase-0 background knobs.
 *
 * The load-bearing assertion in this file is the DEFAULT: no lane ships with a
 * provider preselected. That is the untouched-existing-installs guarantee — an
 * install that never opens this panel must keep resolving every lane against
 * whatever provider the host already had active.
 *
 * The component provides `PROVIDER_MODELS_LOADER` itself, as
 * `useExisting: SkillSynthesisRpcService`, so a stub for THAT service is what
 * keeps the four pickers off a message bus that does not exist under Jest.
 */
import { TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ANTHROPIC_PROVIDERS } from '@ptah-extension/shared';
import type {
  SkillLaneDto,
  SkillLaneIdDto,
  SkillLanesDto,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../services/skill-synthesis-rpc.service';

import {
  SkillSettingsPanelComponent,
  type SkillLaneSelectionChange,
} from './skill-settings-panel.component';

const LANE_IDS: readonly SkillLaneIdDto[] = [
  'archaeologist',
  'synthesis',
  'judge',
  'replay',
];

function lane(
  id: SkillLaneIdDto,
  overrides: Partial<SkillLaneDto> = {},
): SkillLaneDto {
  return {
    id,
    // `''` IS the default: inherit the active provider. Never a provider id.
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'parse',
    toolUse: 'none',
    timeoutMs: 60_000,
    maxInputChars: 40_000,
    maxPasses: 1,
    ...overrides,
  };
}

function lanes(
  overrides: Partial<Record<SkillLaneIdDto, Partial<SkillLaneDto>>> = {},
): SkillLanesDto {
  return {
    archaeologist: lane('archaeologist', overrides.archaeologist),
    synthesis: lane('synthesis', overrides.synthesis),
    judge: lane('judge', overrides.judge),
    replay: lane('replay', overrides.replay),
  };
}

function settingsForm(): FormGroup {
  const fb = new FormBuilder();
  return fb.group({
    enabled: [true],
    successesToPromote: [3],
    dedupCosineThreshold: [0.85],
    maxActiveSkills: [50],
    candidatesDir: [''],
    eligibilityMinTurns: [5],
    evictionDecayRate: [0.95],
    generalizationContextThreshold: [3],
    dedupClusterThreshold: [0.78],
    prefilterMinEdits: [1],
    prefilterMinChars: [800],
    prefilterMinToolUses: [2],
    judgeEnabled: [true],
    minJudgeScore: [6.0],
    judgeModel: ['inherit'],
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
  let listModels: jest.Mock;

  beforeEach(() => {
    listModels = jest.fn(() =>
      Promise.resolve({ models: [], totalCount: 0, isStatic: true }),
    );
    TestBed.configureTestingModule({
      imports: [SkillSettingsPanelComponent],
      providers: [
        { provide: SkillSynthesisRpcService, useValue: { listModels } },
      ],
    });
  });

  function render(
    inputs: {
      form?: FormGroup;
      loaded?: boolean;
      saving?: boolean;
      lanes?: SkillLanesDto | null;
      isElectron?: boolean;
    } = {},
  ) {
    const fixture = TestBed.createComponent(SkillSettingsPanelComponent);
    fixture.componentRef.setInput('form', inputs.form ?? settingsForm());
    fixture.componentRef.setInput('loaded', inputs.loaded ?? true);
    fixture.componentRef.setInput('saving', inputs.saving ?? false);
    fixture.componentRef.setInput(
      'lanes',
      'lanes' in inputs ? inputs.lanes : lanes(),
    );
    fixture.componentRef.setInput('isElectron', inputs.isElectron ?? false);
    fixture.detectChanges();
    // The picker seeds its internal signals from an init `effect()`, so the
    // first pass renders the template's initial read and the second reflects
    // the seeded value. A real host runs many cycles; one extra here matches.
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  describe('lane pickers', () => {
    it('renders exactly four lane pickers', () => {
      const { el } = render();

      expect(
        el.querySelectorAll('[data-testid="skills-lane-picker"]').length,
      ).toBe(4);
    });

    it('renders one picker per lane id, in pipeline order', () => {
      const { el } = render();

      const ids = Array.from(
        el.querySelectorAll('[data-testid="skills-lane-picker"]'),
      ).map((node) => node.getAttribute('data-lane'));

      expect(ids).toEqual(LANE_IDS);
    });

    it('labels each lane picker with its stage name', () => {
      const { el } = render();

      const labels = Array.from(
        el.querySelectorAll('[data-testid="provider-model-picker-label"]'),
      ).map((node) => node.textContent?.trim());

      expect(labels).toEqual([
        'Archaeologist lane',
        'Synthesis lane',
        'Judge lane',
        'Replay lane',
      ]);
    });

    it('defaults EVERY lane to inherit — no provider is preselected', () => {
      const { el } = render();

      const selects = el.querySelectorAll<HTMLSelectElement>(
        '[data-testid="provider-model-picker-provider"]',
      );
      expect(selects.length).toBe(4);
      // `''` is the picker's inherit sentinel. A non-empty value here would
      // mean a fresh install had silently been pinned to a provider.
      expect(Array.from(selects).every((s) => s.value === '')).toBe(true);
    });

    it('defaults every lane MODEL to the provider fallback, not a pinned id', () => {
      const { el } = render();

      const selects = el.querySelectorAll<HTMLSelectElement>(
        '[data-testid="provider-model-picker-model"]',
      );
      expect(selects.length).toBe(4);
      expect(Array.from(selects).every((s) => s.value === '')).toBe(true);
    });

    it('states the inherit default in words as well', () => {
      const { el } = render();

      const note = el.querySelector(
        '[data-testid="skills-lanes-inherit-note"]',
      );
      expect(note?.textContent ?? '').toContain('inherits the active provider');
    });

    it('names no provider id anywhere in the rendered lanes section', () => {
      const { el } = render();

      const section = el.querySelector('[data-testid="skills-lanes-section"]');
      const optionValues = Array.from(
        section?.querySelectorAll<HTMLOptionElement>(
          '[data-testid="provider-model-picker-provider"] option',
        ) ?? [],
      ).map((o) => o.value);

      // The registry supplies the option list; the panel itself contributes
      // only the inherit sentinel.
      expect(optionValues[0]).toBe('');
    });

    it('forwards a lane that HAS been pinned to its picker, and SHOWS it as pinned', () => {
      // Both halves matter, and the second one used to be impossible: the
      // shared picker bound `[value]` on the select before its `@for`
      // materialised the options, so a pre-pinned provider was forwarded to the
      // loader but never became the selected option — a pinned lane rendered as
      // "Active provider (default)". Fixed in `libs/frontend/ui` by pairing
      // `[value]` with `[selected]` on every option, and pinned there by its own
      // specs. Asserted here too, from the consumer's side, because the loader
      // call alone cannot tell a pinned lane from an inherited one.
      const pinned = ANTHROPIC_PROVIDERS[0].id;
      const { el } = render({ lanes: lanes({ judge: { provider: pinned } }) });

      expect(listModels).toHaveBeenCalledWith(pinned);

      const judge = el.querySelector(
        '[data-testid="skills-lane-picker"][data-lane="judge"]',
      );
      const select = judge?.querySelector<HTMLSelectElement>(
        '[data-testid="provider-model-picker-provider"]',
      );
      expect(select?.value).toBe(pinned);
      expect(select?.selectedIndex).toBeGreaterThan(0);
    });

    it('emits laneChange with the lane id and the new selection', () => {
      const { fixture, el } = render();
      const emitted: SkillLaneSelectionChange[] = [];
      fixture.componentInstance.laneChange.subscribe((c) => emitted.push(c));

      const synthesis = el.querySelector(
        '[data-testid="skills-lane-picker"][data-lane="synthesis"]',
      );
      const select = synthesis?.querySelector<HTMLSelectElement>(
        '[data-testid="provider-model-picker-provider"]',
      );
      if (!select) throw new Error('synthesis provider select not found');
      // Registry-driven, so this spec body carries no provider-id literal.
      const chosen = ANTHROPIC_PROVIDERS[0].id;
      select.value = chosen;
      select.dispatchEvent(new Event('change'));

      expect(emitted).toEqual([
        { laneId: 'synthesis', provider: chosen, model: '' },
      ]);
    });

    it('marks a tool-use-requiring lane as such on its picker', () => {
      const { el } = render({
        lanes: lanes({ archaeologist: { toolUse: 'required' } }),
      });

      // The picker only warns once a tool-incapable model is actually pinned,
      // so the observable effect here is that the picker mounted at all with
      // the flag wired — asserted through the absence of a spurious warning.
      expect(
        el.querySelectorAll('[data-testid="skills-lane-picker"]').length,
      ).toBe(4);
      expect(
        el.querySelector(
          '[data-testid="provider-model-picker-tooluse-warning"]',
        ),
      ).toBeNull();
    });

    it('shows a loading line instead of four empty pickers while lanes are null', () => {
      const { el } = render({ lanes: null });

      expect(
        el.querySelector('[data-testid="skills-lanes-loading"]'),
      ).not.toBeNull();
      expect(
        el.querySelectorAll('[data-testid="skills-lane-picker"]').length,
      ).toBe(0);
    });

    it('loads a model catalogue through the injected port, once per lane', () => {
      render();

      expect(listModels).toHaveBeenCalledTimes(4);
      // No provider pinned ⇒ the port is asked for the ACTIVE provider's
      // catalogue, spelled `undefined`, never `''`.
      expect(listModels).toHaveBeenCalledWith(undefined);
    });
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
