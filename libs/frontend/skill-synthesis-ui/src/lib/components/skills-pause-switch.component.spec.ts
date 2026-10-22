import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { computed, signal } from '@angular/core';

import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';
import { SkillSynthesisRpcService } from '../services/skill-synthesis-rpc.service';

import { SkillsPauseSwitchComponent } from './skills-pause-switch.component';

function makeState() {
  const committed = signal<boolean | null>(true);
  const pending = signal<boolean | null>(null);
  const saving = signal(false);
  const error = signal<string | null>(null);
  const enabled = computed(() => pending() ?? committed());
  return {
    committed,
    pending,
    saving,
    error,
    stub: {
      skillsEnabledCommitted: committed.asReadonly(),
      skillsEnabled: enabled,
      skillsPaused: computed(() => enabled() === false),
      skillsSwitchSaving: saving.asReadonly(),
      skillsSwitchError: error.asReadonly(),
      refreshSkillsEnabled: jest.fn(() => Promise.resolve()),
      setSkillsEnabled: jest.fn(() => Promise.resolve()),
      setTelemetryEnabled: jest.fn(() => Promise.resolve()),
    },
  };
}

describe('SkillsPauseSwitchComponent', () => {
  let state: ReturnType<typeof makeState>;
  let fixture: ComponentFixture<SkillsPauseSwitchComponent>;
  const legacyRpc = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [SkillsPauseSwitchComponent],
      providers: [
        { provide: SkillSynthesisStateService, useValue: state.stub },
        { provide: SkillSynthesisRpcService, useValue: legacyRpc },
      ],
    });
    fixture = TestBed.createComponent(SkillsPauseSwitchComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function toggle(root: HTMLElement): HTMLInputElement {
    return root.querySelector(
      '[data-testid="skills-enabled-toggle"]',
    ) as HTMLInputElement;
  }

  beforeEach(() => {
    state = makeState();
    legacyRpc.getSettings.mockClear();
    legacyRpc.updateSettings.mockClear();
  });

  it('renders an accessible "Skills" switch that is on, with the read-side copy', () => {
    const root = render();
    const input = toggle(root);

    expect(input.getAttribute('role')).toBe('switch');
    expect(input.classList).toContain('toggle-sm');
    expect(input.classList).toContain('toggle-primary');
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(
      root.querySelector('label[for="skills-enabled-toggle"]')?.textContent,
    ).toContain('Skills');
    expect(root.textContent).toContain(
      'Pausing stops capture, background processing and manual runs (Run Curator, Analyze current session and Enhance now). Saved skills are still used in chats.',
    );
    expect(
      root.querySelector('[data-testid="skills-enabled-toggle-target"]')
        ?.classList,
    ).toContain('min-w-6');
  });

  it('shows a clear "Paused" badge and an unchecked switch while paused', () => {
    state.committed.set(false);
    const root = render();

    const badge = root.querySelector('[data-testid="skills-pause-state"]');
    expect(badge?.textContent?.trim()).toBe('Paused');
    expect(badge?.classList).toContain('badge-warning');
    expect(toggle(root).getAttribute('aria-checked')).toBe('false');
  });

  it('applies immediately on change, with no Save step', () => {
    const root = render();
    const input = toggle(root);

    input.checked = false;
    input.dispatchEvent(new Event('change'));

    expect(state.stub.setSkillsEnabled).toHaveBeenCalledTimes(1);
    expect(state.stub.setSkillsEnabled).toHaveBeenCalledWith(false);
    expect(state.stub.setTelemetryEnabled).not.toHaveBeenCalled();
    expect(legacyRpc.getSettings).not.toHaveBeenCalled();
    expect(legacyRpc.updateSettings).not.toHaveBeenCalled();
  });

  it('shows only the committed read-back value while saving and after the write', async () => {
    let finishWrite: (() => void) | undefined;
    state.stub.setSkillsEnabled.mockImplementation(async () => {
      state.saving.set(true);
      state.pending.set(false);
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      // The host read-back can disagree with the requested value.
      state.committed.set(true);
      state.pending.set(null);
      state.saving.set(false);
    });
    const root = render();
    const input = toggle(root);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(state.stub.setSkillsEnabled).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');

    finishWrite?.();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(false);
    expect(state.stub.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('reflects a changed host read-back after one pause write', async () => {
    state.stub.setSkillsEnabled.mockImplementation(async () => {
      state.committed.set(false);
    });
    const root = render();
    const input = toggle(root);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(state.stub.setSkillsEnabled).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(false);
    expect(input.getAttribute('aria-checked')).toBe('false');
    expect(state.stub.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('restores the committed value and shows the error after a failed write', async () => {
    state.stub.setSkillsEnabled.mockImplementation(async () => {
      state.saving.set(true);
      state.pending.set(false);
      await Promise.resolve();
      state.pending.set(null);
      state.error.set('Could not change the Skills switch.');
      state.saving.set(false);
    });
    const root = render();
    const input = toggle(root);

    input.checked = false;
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(state.stub.setSkillsEnabled).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(root.querySelector('[data-testid="skills-pause-error"]')?.textContent)
      .toContain('Could not change the Skills switch.');
    expect(state.stub.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('is disabled while the value is unknown and while a write is in flight', () => {
    state.committed.set(null);
    const root = render();
    expect(toggle(root).disabled).toBe(true);

    state.committed.set(false);
    state.saving.set(true);
    fixture.detectChanges();
    expect(toggle(root).disabled).toBe(true);
    expect(root.textContent).toContain('Saving…');
  });

  it('re-reads the host value on init, window focus and when the page becomes visible', () => {
    render();
    const load = state.stub.refreshSkillsEnabled;
    expect(load).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(2);

    const visibility = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      visibility.mockRestore();
    }

    fixture.destroy();
    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('shows a write failure as an alert under the switch', () => {
    state.error.set('Could not change the Skills switch.');
    const root = render();
    expect(
      root
        .querySelector('[data-testid="skills-pause-error"]')
        ?.getAttribute('role'),
    ).toBe('alert');
  });

  it('emits pausedChange only when the committed value flips', () => {
    render();
    const emitted: boolean[] = [];
    fixture.componentInstance.pausedChange.subscribe((p) => emitted.push(p));

    state.pending.set(false);
    fixture.detectChanges();
    expect(emitted).toEqual([]);

    state.pending.set(null);
    state.committed.set(false);
    fixture.detectChanges();
    expect(emitted).toEqual([true]);
  });

  it('keeps the help text and badge row identical across states, so toggling shifts nothing', () => {
    const root = render();
    const help = (): string =>
      root.querySelector('#skills-pause-help')?.textContent?.trim() ?? '';
    const running = help();
    expect(running).toContain('manual runs');

    state.committed.set(false);
    fixture.detectChanges();

    expect(help()).toBe(running);
    const badge = root.querySelector('[data-testid="skills-pause-state"]');
    // Readable size (visual review round 1): 12 px text, not the 10 px default.
    expect(badge?.classList).toContain('text-xs');
    expect(badge?.parentElement?.classList).toContain('min-h-5');
  });
});
