/**
 * Unit tests for AtTriggerDirective
 *
 * Tests the @ trigger autocomplete bug fix:
 * - atActivated fires IMMEDIATELY on inactive->active transition (no debounce)
 * - atClosed fires IMMEDIATELY on active->inactive transition
 * - atQueryChanged fires IMMEDIATELY on query change (no debounce)
 * - atTriggered fires after 150ms debounce (for heavier operations)
 * - @ detection: at start, after whitespace, not mid-word
 * - Query extraction after @
 * - Whitespace in query deactivates trigger
 * - enabled input controls emission
 */

import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AtTriggerDirective, AtTriggerEvent } from './at-trigger.directive';

@Component({
  template: `<textarea
    ptahAtTrigger
    [enabled]="enabled()"
    (atActivated)="onActivated($event)"
    (atTriggered)="onTriggered($event)"
    (atClosed)="onClosed()"
    (atQueryChanged)="onQueryChanged($event)"
  ></textarea>`,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [AtTriggerDirective],
})
class TestHostComponent {
  readonly enabled = signal(true);

  activatedEvents: AtTriggerEvent[] = [];
  triggeredEvents: AtTriggerEvent[] = [];
  closedCount = 0;
  queryChangedEvents: string[] = [];

  onActivated(event: AtTriggerEvent): void {
    this.activatedEvents.push(event);
  }

  onTriggered(event: AtTriggerEvent): void {
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
 * Helper to simulate typing in a textarea by setting value and dispatching input event
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

describe('AtTriggerDirective', () => {
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
    expect(textarea.getAttribute('ptahattrigger')).not.toBeNull();
  });

  // ============================================================================
  // ACTIVATION - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('atActivated (immediate, no debounce)', () => {
    it('should emit atActivated immediately when @ is typed at start', () => {
      simulateInput(textarea, '@');
      jest.advanceTimersByTime(0); // Allow RxJS pipeline to process synchronously

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');
      expect(host.activatedEvents[0].triggerPosition).toBe(0);

      jest.runOnlyPendingTimers();
    });

    it('should emit atActivated immediately when @ is typed after whitespace', () => {
      simulateInput(textarea, 'hello @');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');
      expect(host.activatedEvents[0].triggerPosition).toBe(6);

      jest.runOnlyPendingTimers();
    });

    it('should emit atActivated with initial query when @ and text typed together', () => {
      simulateInput(textarea, '@po');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('po');

      jest.runOnlyPendingTimers();
    });

    it('should NOT emit atActivated when @ is mid-word (no preceding whitespace)', () => {
      simulateInput(textarea, 'email@test');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(0);

      jest.runOnlyPendingTimers();
    });

    it('should only emit atActivated once for a single activation', () => {
      // Type @
      simulateInput(textarea, '@');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // Continue typing (query changes, not new activation)
      simulateInput(textarea, '@po');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1); // Still just 1

      simulateInput(textarea, '@portal');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1); // Still just 1

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // QUERY CHANGED - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('atQueryChanged (immediate, no debounce)', () => {
    it('should emit atQueryChanged immediately when query updates', () => {
      simulateInput(textarea, '@p');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('p');

      simulateInput(textarea, '@po');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('po');

      simulateInput(textarea, '@por');
      jest.advanceTimersByTime(0);
      expect(host.queryChangedEvents).toContain('por');

      jest.runOnlyPendingTimers();
    });

    it('should emit atQueryChanged with empty string on initial @ activation', () => {
      simulateInput(textarea, '@');
      jest.advanceTimersByTime(0);

      // On activation, atQueryChanged is also emitted
      expect(host.queryChangedEvents).toContain('');

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // TRIGGERED - DEBOUNCED (150ms)
  // ============================================================================

  describe('atTriggered (debounced by 150ms)', () => {
    it('should emit atTriggered after 150ms debounce', () => {
      simulateInput(textarea, '@portal');
      jest.advanceTimersByTime(0);

      // Should NOT have emitted yet
      expect(host.triggeredEvents.length).toBe(0);

      // After debounce period
      jest.advanceTimersByTime(150);
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('portal');

      jest.runOnlyPendingTimers();
    });

    it('should only emit atTriggered once for rapid typing within debounce window', () => {
      simulateInput(textarea, '@p');
      jest.advanceTimersByTime(50);
      simulateInput(textarea, '@po');
      jest.advanceTimersByTime(50);
      simulateInput(textarea, '@por');
      jest.advanceTimersByTime(50);
      simulateInput(textarea, '@port');
      jest.advanceTimersByTime(50);
      simulateInput(textarea, '@porta');
      jest.advanceTimersByTime(50);
      simulateInput(textarea, '@portal');

      // Wait for debounce
      jest.advanceTimersByTime(150);

      // Only the last stable value should be emitted
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('portal');

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // CLOSE - IMMEDIATE
  // ============================================================================

  describe('atClosed (immediate)', () => {
    it('should emit atClosed immediately when whitespace typed in query', () => {
      // Activate
      simulateInput(textarea, '@portal');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // Type space in query (deactivates)
      simulateInput(textarea, '@portal ');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should emit atClosed when @ is removed', () => {
      // Activate
      simulateInput(textarea, '@test');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // Remove @ (backspace)
      simulateInput(textarea, 'test');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should emit atClosed when input is cleared', () => {
      // Activate
      simulateInput(textarea, '@file');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // Clear input
      simulateInput(textarea, '');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // @ DETECTION RULES
  // ============================================================================

  describe('@ detection rules', () => {
    it('should detect @ at position 0', () => {
      simulateInput(textarea, '@');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].triggerPosition).toBe(0);

      jest.runOnlyPendingTimers();
    });

    it('should detect @ after space', () => {
      simulateInput(textarea, 'message @');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].triggerPosition).toBe(8);

      jest.runOnlyPendingTimers();
    });

    it('should detect @ after newline', () => {
      simulateInput(textarea, 'line1\n@');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should detect @ after tab', () => {
      simulateInput(textarea, 'text\t@');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(1);

      jest.runOnlyPendingTimers();
    });

    it('should NOT detect @ in middle of word (email pattern)', () => {
      simulateInput(textarea, 'user@domain');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents.length).toBe(0);

      jest.runOnlyPendingTimers();
    });

    it('should extract correct query after @', () => {
      simulateInput(textarea, 'text @filename');
      jest.advanceTimersByTime(0);

      expect(host.activatedEvents[0].query).toBe('filename');

      jest.runOnlyPendingTimers();
    });

    it('should handle cursor in middle of text', () => {
      // Cursor positioned at index 5 in "@test more"
      simulateInput(textarea, '@test more', 5);
      jest.advanceTimersByTime(0);

      // Query should be "test" (text between @ and cursor)
      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('test');

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

      simulateInput(textarea, '@test');
      jest.advanceTimersByTime(200);

      expect(host.activatedEvents.length).toBe(0);
      expect(host.triggeredEvents.length).toBe(0);

      jest.runOnlyPendingTimers();
    });
  });

  // ============================================================================
  // RE-ACTIVATION AFTER CLOSE
  // ============================================================================

  describe('re-activation cycle', () => {
    it('should allow re-activation after close', () => {
      // First activation
      simulateInput(textarea, '@first');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(1);

      // Close (space in query)
      simulateInput(textarea, '@first ');
      jest.advanceTimersByTime(0);
      expect(host.closedCount).toBe(1);

      // Re-activate with new @
      simulateInput(textarea, '@first @second');
      jest.advanceTimersByTime(0);
      expect(host.activatedEvents.length).toBe(2);

      jest.runOnlyPendingTimers();
    });
  });
});
