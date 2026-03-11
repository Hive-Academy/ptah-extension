/**
 * Unit tests for SlashTriggerDirective
 *
 * Tests the / trigger autocomplete (same pattern as TASK_2025_163 fix):
 * - slashActivated fires IMMEDIATELY on inactive->active transition (no debounce)
 * - slashClosed fires IMMEDIATELY on active->inactive transition
 * - slashQueryChanged fires IMMEDIATELY on query change (no debounce)
 * - slashTriggered fires after 150ms debounce
 * - / detection: only at position 0 (start of input)
 * - Space in query deactivates (command completed)
 * - @ in input no longer disables slash trigger (they operate independently)
 */

import { Component, signal } from '@angular/core';
import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
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
  cursorPosition?: number
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
  });

  // ============================================================================
  // ACTIVATION - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('slashActivated (immediate, no debounce)', () => {
    it('should emit slashActivated immediately when / is typed at start', fakeAsync(() => {
      simulateInput(textarea, '/');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('');

      flush();
    }));

    it('should emit slashActivated with query when / and text typed together', fakeAsync(() => {
      simulateInput(textarea, '/orch');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('orch');

      flush();
    }));

    it('should only emit slashActivated once per activation cycle', fakeAsync(() => {
      simulateInput(textarea, '/');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '/or');
      tick(0);
      expect(host.activatedEvents.length).toBe(1); // Still 1

      simulateInput(textarea, '/orch');
      tick(0);
      expect(host.activatedEvents.length).toBe(1); // Still 1

      flush();
    }));
  });

  // ============================================================================
  // QUERY CHANGED - IMMEDIATE (NO DEBOUNCE)
  // ============================================================================

  describe('slashQueryChanged (immediate, no debounce)', () => {
    it('should emit slashQueryChanged immediately as user types', fakeAsync(() => {
      simulateInput(textarea, '/o');
      tick(0);
      expect(host.queryChangedEvents).toContain('o');

      simulateInput(textarea, '/or');
      tick(0);
      expect(host.queryChangedEvents).toContain('or');

      simulateInput(textarea, '/orc');
      tick(0);
      expect(host.queryChangedEvents).toContain('orc');

      flush();
    }));
  });

  // ============================================================================
  // TRIGGERED - DEBOUNCED (150ms)
  // ============================================================================

  describe('slashTriggered (debounced by 150ms)', () => {
    it('should emit slashTriggered after 150ms debounce', fakeAsync(() => {
      simulateInput(textarea, '/orchestrate');
      tick(0);

      // Not yet
      expect(host.triggeredEvents.length).toBe(0);

      // After debounce
      tick(150);
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('orchestrate');

      flush();
    }));

    it('should only emit last value when typing rapidly', fakeAsync(() => {
      simulateInput(textarea, '/o');
      tick(30);
      simulateInput(textarea, '/or');
      tick(30);
      simulateInput(textarea, '/orc');
      tick(30);
      simulateInput(textarea, '/orch');

      tick(150);

      // Only last stable value
      expect(host.triggeredEvents.length).toBe(1);
      expect(host.triggeredEvents[0].query).toBe('orch');

      flush();
    }));
  });

  // ============================================================================
  // CLOSE - IMMEDIATE
  // ============================================================================

  describe('slashClosed (immediate)', () => {
    it('should emit slashClosed when space typed (command completed)', fakeAsync(() => {
      simulateInput(textarea, '/orchestrate');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '/orchestrate ');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));

    it('should emit slashClosed when input cleared', fakeAsync(() => {
      simulateInput(textarea, '/test');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      simulateInput(textarea, '');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));

    it('should emit slashClosed when @ is typed (switch to @ mode)', fakeAsync(() => {
      simulateInput(textarea, '/test');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      // User changes to @ trigger
      simulateInput(textarea, '@file');
      tick(0);
      expect(host.closedCount).toBe(1);

      flush();
    }));
  });

  // ============================================================================
  // / DETECTION RULES
  // ============================================================================

  describe('/ detection rules', () => {
    it('should only detect / at position 0', fakeAsync(() => {
      // / at position 0
      simulateInput(textarea, '/');
      tick(0);
      expect(host.activatedEvents.length).toBe(1);

      flush();
    }));

    it('should NOT detect / in middle of text', fakeAsync(() => {
      simulateInput(textarea, 'path/to/file');
      tick(0);

      expect(host.activatedEvents.length).toBe(0);

      flush();
    }));

    it('should still detect / even when @ is present in input', fakeAsync(() => {
      // The @ guard was removed — / and @ triggers now operate independently.
      // The slash trigger only cares about position 0 and no space in command name.
      // Value "/@test" starts with /, no space in command portion → activates.
      simulateInput(textarea, '/@test');
      tick(0);

      expect(host.activatedEvents.length).toBe(1);
      expect(host.activatedEvents[0].query).toBe('@test');

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

      simulateInput(textarea, '/test');
      tick(200);

      expect(host.activatedEvents.length).toBe(0);
      expect(host.triggeredEvents.length).toBe(0);

      flush();
    }));
  });
});
