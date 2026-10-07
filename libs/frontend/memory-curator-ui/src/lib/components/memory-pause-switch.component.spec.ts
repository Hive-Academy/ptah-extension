import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { computed, signal } from '@angular/core';

import { MemoryDiagnosticsStateService } from '../services/memory-diagnostics-state.service';

import { MemoryPauseSwitchComponent } from './memory-pause-switch.component';

function makeState() {
  const committed = signal<boolean | null>(true);
  const pending = signal<boolean | null>(null);
  const enabled = computed(() => pending() ?? committed());
  return {
    committed,
    pending,
    saving: signal(false),
    error: signal<string | null>(null),
    stub: {
      memoryEnabledCommitted: committed.asReadonly(),
      memoryEnabled: enabled,
      memoryPaused: computed(() => enabled() === false),
      loadMemoryEnabled: jest.fn(() => Promise.resolve()),
      setMemoryEnabled: jest.fn(() => Promise.resolve()),
    } as Record<string, unknown>,
  };
}

describe('MemoryPauseSwitchComponent', () => {
  let state: ReturnType<typeof makeState>;
  let fixture: ComponentFixture<MemoryPauseSwitchComponent>;

  function render(): HTMLElement {
    state.stub['memorySwitchSaving'] = state.saving.asReadonly();
    state.stub['memorySwitchError'] = state.error.asReadonly();
    TestBed.configureTestingModule({
      imports: [MemoryPauseSwitchComponent],
      providers: [
        { provide: MemoryDiagnosticsStateService, useValue: state.stub },
      ],
    });
    fixture = TestBed.createComponent(MemoryPauseSwitchComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function toggle(root: HTMLElement): HTMLInputElement {
    return root.querySelector(
      '[data-testid="memory-enabled-toggle"]',
    ) as HTMLInputElement;
  }

  beforeEach(() => {
    state = makeState();
  });

  it('renders an accessible "Memory" switch that is on, with the read-side copy', () => {
    const root = render();
    const input = toggle(root);

    expect(input.getAttribute('role')).toBe('switch');
    expect(input.classList).toContain('toggle-sm');
    expect(input.classList).toContain('toggle-primary');
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(input.disabled).toBe(false);
    const label = root.querySelector('label[for="memory-enabled-toggle"]');
    expect(label?.textContent?.trim()).toBe('Memory');
    expect(
      root.querySelector('[data-testid="memory-pause-state"]')?.textContent,
    ).toContain('On');
    expect(root.textContent).toContain(
      'Pausing stops capture and background processing. Saved memories are still used in chats.',
    );
    // 24px hit target around the switch.
    expect(
      root.querySelector('[data-testid="memory-enabled-toggle-target"]')
        ?.classList,
    ).toContain('min-h-6');
  });

  it('shows a clear "Paused" badge and an unchecked switch while paused', () => {
    state.committed.set(false);
    const root = render();

    const badge = root.querySelector('[data-testid="memory-pause-state"]');
    expect(badge?.textContent?.trim()).toBe('Paused');
    expect(badge?.classList).toContain('badge-warning');
    expect(toggle(root).checked).toBe(false);
    expect(toggle(root).getAttribute('aria-checked')).toBe('false');
  });

  it('applies immediately on change, with no Save step', () => {
    const root = render();
    const input = toggle(root);

    input.checked = false;
    input.dispatchEvent(new Event('change'));

    expect(state.stub['setMemoryEnabled']).toHaveBeenCalledWith(false);
  });

  it('is disabled while the value is unknown and while a write is in flight', () => {
    state.committed.set(null);
    const root = render();
    expect(toggle(root).disabled).toBe(true);
    expect(root.textContent).toContain('Checking…');

    state.committed.set(true);
    state.saving.set(true);
    fixture.detectChanges();
    expect(toggle(root).disabled).toBe(true);
    expect(root.textContent).toContain('Saving…');
  });

  it('shows a write or read failure as an alert under the switch', () => {
    state.error.set('Could not change the Memory switch.');
    const root = render();
    const alert = root.querySelector('[data-testid="memory-pause-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Could not change the Memory switch.');
  });

  it('re-reads the host value on init, window focus and when the page becomes visible', () => {
    render();
    const load = state.stub['loadMemoryEnabled'] as jest.Mock;
    expect(load).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(2);

    const visibility = jest
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('visible');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(load).toHaveBeenCalledTimes(3);

      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      visibility.mockRestore();
    }
  });

  it('removes its focus and visibility listeners on destroy', () => {
    render();
    const load = state.stub['loadMemoryEnabled'] as jest.Mock;
    fixture.destroy();
    load.mockClear();

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(load).not.toHaveBeenCalled();
  });

  it('emits pausedChange only when the committed value flips, not on the first read or the optimistic move', () => {
    render();
    const emitted: boolean[] = [];
    fixture.componentInstance.pausedChange.subscribe((p) => emitted.push(p));

    state.pending.set(false); // optimistic only
    fixture.detectChanges();
    expect(emitted).toEqual([]);

    state.pending.set(null);
    state.committed.set(false);
    fixture.detectChanges();
    expect(emitted).toEqual([true]);

    state.committed.set(true);
    fixture.detectChanges();
    expect(emitted).toEqual([true, false]);
  });
});
