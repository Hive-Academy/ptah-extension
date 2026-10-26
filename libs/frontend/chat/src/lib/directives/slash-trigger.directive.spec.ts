/**
 * Unit tests for SlashTriggerDirective
 *
 * Tests the / trigger autocomplete:
 * - slashActivated fires IMMEDIATELY on inactive->active transition (no debounce)
 * - slashClosed fires IMMEDIATELY on active->inactive transition
 * - slashQueryChanged fires IMMEDIATELY on query change (no debounce)
 * - slashTriggered fires after 150ms debounce
 * - / detection: only at position 0 (start of input)
 * - Space in query deactivates (command completed)
 * - @ in input no longer disables slash trigger (they operate independently)
 */

import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SlashTriggerDirective,
  SlashTriggerEvent,
} from './slash-trigger.directive';

@Component({
  template: `<textarea
    ptahSlashTrigger
    [enabled]="enabled()"
    (slashActivated)="onActivated($event)"
    (slashTriggered)="onTriggered($event)"
    (slashClosed)="onClosed()"
    (slashQueryChanged)="onQueryChanged($event)"
  ></textarea>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [SlashTriggerDirective],
})
class TestHostComponent {
  readonly enabled = signal(true);

  activatedEvents: SlashTriggerEvent[] = [];
  triggeredEvents: SlashTriggerEvent[] = [];
  closedCount = 0;
  queryChangedEvents: string[] = [];

  onActivated(event: SlashTriggerEvent): void {
    this.activatedEvents.push(event);
  }

  onTriggered(event: SlashTriggerEvent): void {
    this.triggeredEvents.push(event);
  }

  onClosed(): void {
    this.closedCount++;
  }

  onQueryChanged(query: string): void {
    this.queryChangedEvents.push(query);
  }
}

/**
 * Helper to simulate typing in a textarea
 */
function simulateInput(
  textarea: HTMLTextAreaElement,
  value: string,
  cursorPosition?: number,
): void {
  textarea.value = value;
  textarea.selectionStart = cursorPosition ?? value.length;
  textarea.selectionEnd = cursorPosition ?? value.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SlashTriggerDirective', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<TestHostComponent>>;
  let host: TestHostComponent;
  let textarea: HTMLTextAreaElement;

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    textarea = fixture.nativeElement.querySelector('textarea');
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should create the directive on textarea', () => {
    expect(textarea).toBeTruthy();
  });

  // ============================================================================
  // ACTIVATION - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('slashActivated (immediate, no debounce)', () => {
    it('should emit slashActivated immediately when / is typed at start', () => {
      simulateInput(textarea, '/');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');

      jest.runOnlyPendingTimers();
    });

    it('should emit slashActivated with query when / and text typed together', () => {
      simulateInput(textarea, '/orch');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('orch');

      jest.runOnlyPendingTimers();
    });

    it('should only emit slashActivated once per activation cycle', () => {
      simulateInput(textarea, '/');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '/or');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1); // Still 1

      simulateInput(textarea, '/orch');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1); // Still 1

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // QUERY CHANGED - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('slashQueryChanged (immediate, no debounce)', () => {
    it('should emit slashQueryChanged immediately as user types', () => {
      simulateInput(textarea, '/o');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('o');

      simulateInput(textarea, '/or');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('or');

      simulateInput(textarea, '/orc');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('orc');

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // TRIGGERED - DEBOUNCED (150ms)
  // ============================================================================

  describe('slashTriggered (debounced by 150ms)', () => {
    it('should emit slashTriggered after 150ms debounce', () => {
      simulateInput(textarea, '/orchestrate');
      jest.advanceTimersByTime(0);

      // Not yet
      expect(host.triggeredEvents.length).toBe(0);

      // After debounce
      jest.advanceTimersByTime(150);
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('orchestrate');

      jest.runOnlyPendingTimers();
    });

    it('should only emit last value when typing rapidly', () => {
      simulateInput(textarea, '/o');
      jest.advanceTimersByTime(30);
      simulateInput(textarea, '/or');
      jest.advanceTimersByTime(30);
      simulateInput(textarea, '/orc');
      jest.advanceTimersByTime(30);
      simulateInput(textarea, '/orch');

      jest.advanceTimersByTime(150);

      // Only last stable value
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('orch');

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // CLOSE - IMMEDIATE
  // ============================================================================

  describe('slashClosed (immediate)', () => {
    it('should emit slashClosed when space typed (command completed)', () => {
      simulateInput(textarea, '/orchestrate');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '/orchestrate ');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should emit slashClosed when input cleared', () => {
      simulateInput(textarea, '/test');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should emit slashClosed when @ is typed (switch to @ mode)', () => {
      simulateInput(textarea, '/test');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // User changes to @ trigger
      simulateInput(textarea, '@file');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // / DETECTION RULES
  // ============================================================================

  describe('/ detection rules', () => {
    it('should only detect / at position 0', () => {
      // / at position 0
      simulateInput(textarea, '/');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should NOT detect / in middle of text', () => {
      simulateInput(textarea, 'path/to/file');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(0);

      jest.runOnlyPendingTimers();
    });

    it('should still detect / even when @ is present in input', () => {
      // The @ guard was removed — / and @ triggers now operate independently.
      // The slash trigger only cares about position 0 and no space in command name.
      // Value "/@test" starts with /, no space in command portion → activates.
      simulateInput(textarea, '/@test');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('@test');

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // ENABLED/DISABLED
  // ============================================================================

  describe('enabled input', () => {
    it('should not emit events when disabled', () => {
      host.enabled.set(false);
      fixture.detectChanges();
      jest.advanceTimersByTime(0);

      simulateInput(textarea, '/test');
      jest.advanceTimersByTime(200);

      expect(host.activatedEvents.length).toBe(0);
      expect(host.triggeredEvents.length).toBe(0);

      jest.runOnlyPendingTimers();
    });
  });
});
