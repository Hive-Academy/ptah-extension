/**
 * Unit tests for AtTriggerDirective
 *
 * Tests the @ trigger autocomplete bug fix (TASK_2025_163):
 * - atActivated fires IMMEDIATELY on inactive->active transition (no debounce)
 * - atClosed fires IMMEDIATELY on active->inactive transition
 * - atQueryChanged fires IMMEDIATELY on query change (no debounce)
 * - atTriggered fires after 150ms debounce (for heavier operations)
 * - @ detection: at start, after whitespace, not mid-word
 * - Query extraction after @
 * - Whitespace in query deactivates trigger
 * - enabled input controls emission
 */

import { Component, signal } from '@angular/core';
import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
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
  cursorPosition?: number
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
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    textarea = fixture.nativeElement.querySelector('textarea');
    fixture.detectChanges();
  });

  it('should create the directive on textarea', () => {
    expect(textarea).toBeTruthy();
    expect(textarea.getAttribute('ptahattrigger')).not.toBeNull();
  });

  // ============================================================================
  // ACTIVATION - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('atActivated (immediate, no debounce)', () => {
    it('should emit atActivated immediately when @ is typed at start', fakeAsync(() => {
      simulateInput(textarea, '@');
      tick(0); // Allow RxJS pipeline to process synchronously

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');
      expect(host.activatedEvents[0].triggerPosition).toBe(0);

      flush();
    }));

    it('should emit atActivated immediately when @ is typed after whitespace', fakeAsync(() => {
      simulateInput(textarea, 'hello @');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');
      expect(host.activatedEvents[0].triggerPosition).toBe(6);

      flush();
    }));

    it('should emit atActivated with initial query when @ and text typed together', fakeAsync(() => {
      simulateInput(textarea, '@po');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('po');

      flush();
    }));

    it('should NOT emit atActivated when @ is mid-word (no preceding whitespace)', fakeAsync(() => {
      simulateInput(textarea, 'email@test');
      tick(0);

      expect(host.activatedEvents.length).toBe(0);

      flush();
    }));

    it('should only emit atActivated once for a single activation', fakeAsync(() => {
      // Type @
      simulateInput(textarea, '@');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // Continue typing (query changes, not new activation)
      simulateInput(textarea, '@po');
      tick(0);
      expect(host.activatedEvents.length).toBe(1); // Still just 1

      simulateInput(textarea, '@portal');
      tick(0);
      expect(host.activatedEvents.length).toBe(1); // Still just 1

      flush();
    }));
  });

  // ============================================================================
  // QUERY CHANGED - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('atQueryChanged (immediate, no debounce)', () => {
    it('should emit atQueryChanged immediately when query updates', fakeAsync(() => {
      simulateInput(textarea, '@p');
      tick(0);
      expect(host.queryChangedEvents).toContain('p');

      simulateInput(textarea, '@po');
      tick(0);
      expect(host.queryChangedEvents).toContain('po');

      simulateInput(textarea, '@por');
      tick(0);
      expect(host.queryChangedEvents).toContain('por');

      flush();
    }));

    it('should emit atQueryChanged with empty string on initial @ activation', fakeAsync(() => {
      simulateInput(textarea, '@');
      tick(0);

      // On activation, atQueryChanged is also emitted
      expect(host.queryChangedEvents).toContain('');

      flush();
    }));
  });

  // ============================================================================
  // TRIGGERED - DEBOUNCED (150ms)
  // ============================================================================

  describe('atTriggered (debounced by 150ms)', () => {
    it('should emit atTriggered after 150ms debounce', fakeAsync(() => {
      simulateInput(textarea, '@portal');
      tick(0);

      // Should NOT have emitted yet
      expect(host.triggeredEvents.length).toBe(0);

      // After debounce period
      tick(150);
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('portal');

      flush();
    }));

    it('should only emit atTriggered once for rapid typing within debounce window', fakeAsync(() => {
      simulateInput(textarea, '@p');
      tick(50);
      simulateInput(textarea, '@po');
      tick(50);
      simulateInput(textarea, '@por');
      tick(50);
      simulateInput(textarea, '@port');
      tick(50);
      simulateInput(textarea, '@porta');
      tick(50);
      simulateInput(textarea, '@portal');

      // Wait for debounce
      tick(150);

      // Only the last stable value should be emitted
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('portal');

      flush();
    }));
  });

  // ============================================================================
  // CLOSE - IMMEDIATE
  // ============================================================================

  describe('atClosed (immediate)', () => {
    it('should emit atClosed immediately when whitespace typed in query', fakeAsync(() => {
      // Activate
      simulateInput(textarea, '@portal');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // Type space in query (deactivates)
      simulateInput(textarea, '@portal ');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));

    it('should emit atClosed when @ is removed', fakeAsync(() => {
      // Activate
      simulateInput(textarea, '@test');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // Remove @ (backspace)
      simulateInput(textarea, 'test');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));

    it('should emit atClosed when input is cleared', fakeAsync(() => {
      // Activate
      simulateInput(textarea, '@file');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // Clear input
      simulateInput(textarea, '');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));
  });

  // ============================================================================
  // @ DETECTION RULES
  // ============================================================================

  describe('@ detection rules', () => {
    it('should detect @ at position 0', fakeAsync(() => {
      simulateInput(textarea, '@');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].triggerPosition).toBe(0);

      flush();
    }));

    it('should detect @ after space', fakeAsync(() => {
      simulateInput(textarea, 'message @');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].triggerPosition).toBe(8);

      flush();
    }));

    it('should detect @ after newline', fakeAsync(() => {
      simulateInput(textarea, 'line1\n@');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);

      flush();
    }));

    it('should detect @ after tab', fakeAsync(() => {
      simulateInput(textarea, 'text\t@');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);

      flush();
    }));

    it('should NOT detect @ in middle of word (email pattern)', fakeAsync(() => {
      simulateInput(textarea, 'user@domain');
      tick(0);

      expect(host.activatedEvents.length).toBe(0);

      flush();
    }));

    it('should extract correct query after @', fakeAsync(() => {
      simulateInput(textarea, 'text @filename');
      tick(0);

      expect(host.activatedEvents[0].query).toBe('filename');

      flush();
    }));

    it('should handle cursor in middle of text', fakeAsync(() => {
      // Cursor positioned at index 5 in "@test more"
      simulateInput(textarea, '@test more', 5);
      tick(0);

      // Query should be "test" (text between @ and cursor)
      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('test');

      flush();
    }));
  });

  // ============================================================================
  // ENABLED/DISABLED
  // ============================================================================

  describe('enabled input', () => {
    it('should not emit events when disabled', fakeAsync(() => {
      host.enabled.set(false);
      fixture.detectChanges();
      tick(0);

      simulateInput(textarea, '@test');
      tick(200);

      expect(host.activatedEvents.length).toBe(0);
      expect(host.triggeredEvents.length).toBe(0);

      flush();
    }));
  });

  // ============================================================================
  // RE-ACTIVATION AFTER CLOSE
  // ============================================================================

  describe('re-activation cycle', () => {
    it('should allow re-activation after close', fakeAsync(() => {
      // First activation
      simulateInput(textarea, '@first');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // Close (space in query)
      simulateInput(textarea, '@first ');
      tick(0);
      expect(host.closedCount).toBe(1);

      // Re-activate with new @
      simulateInput(textarea, '@first @second');
      tick(0);
      expect(host.activatedEvents.length).toBe(2);

      flush();
    }));
  });
});
