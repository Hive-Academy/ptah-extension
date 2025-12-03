import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  OnDestroy,
} from '@angular/core';

/**
 * Event emitted when @ trigger is detected
 */
export interface AtTriggerEvent {
  query: string;
  cursorPosition: number;
  triggerPosition: number;
}

/**
 * Directive that detects @ trigger in textarea for file/agent autocomplete
 *
 * Responsibilities:
 * - Listen for input events on host textarea
 * - Detect @ trigger at start or after whitespace
 * - Extract query text after @
 * - Emit events for parent component to handle dropdown
 * - Debounce triggered events by 150ms
 *
 * Usage:
 * ```html
 * <textarea
 *   [ptahAtTrigger]="true"
 *   (triggered)="handleAtTrigger($event)"
 *   (closed)="closeDropdown()"
 *   (queryChanged)="updateQuery($event)"
 * ></textarea>
 * ```
 *
 * @example
 * // User types: "hello @fi"
 * // Emits: triggered({ query: "fi", cursorPosition: 9, triggerPosition: 6 })
 *
 * // User types: "hello @f i"
 * // Emits: closed() - whitespace in query
 */
@Directive({
  selector: '[ptahAtTrigger]',
  standalone: true,
})
export class AtTriggerDirective implements OnDestroy {
  private readonly elementRef =
    inject<ElementRef<HTMLTextAreaElement>>(ElementRef);

  /**
   * Enable/disable the directive
   */
  readonly enabled = input(true);

  /**
   * Emitted when @ trigger is detected with valid query
   * Debounced by 150ms
   */
  readonly atTriggered = output<AtTriggerEvent>();

  /**
   * Emitted when trigger should close (whitespace in query, etc.)
   * NOT debounced - immediate
   */
  readonly atClosed = output<void>();

  /**
   * Emitted when query text changes
   * NOT debounced - immediate
   */
  readonly atQueryChanged = output<string>();

  /**
   * Debounce timer for triggered events
   */
  private debounceTimer = signal<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Last detected trigger position
   */
  private lastTriggerPosition = signal<number>(-1);

  /**
   * Listen for input events on the host textarea
   */
  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    if (!this.enabled()) {
      return;
    }

    const textarea = event.target as HTMLTextAreaElement;
    const text = textarea.value;
    const cursorPosition = textarea.selectionStart;

    this.detectAtTrigger(text, cursorPosition);
  }

  /**
   * Detect @ trigger and emit appropriate events
   *
   * Logic:
   * 1. Find @ symbol before cursor position
   * 2. Check if @ is at start OR preceded by whitespace
   * 3. Extract query after @ (until cursor or next whitespace)
   * 4. If query contains whitespace → emit closed()
   * 5. Otherwise → debounce and emit triggered()
   */
  private detectAtTrigger(text: string, cursorPosition: number): void {
    // Clear any pending debounce timer
    this.clearDebounceTimer();

    // Find the last @ before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    // No @ found
    if (lastAtIndex === -1) {
      this.lastTriggerPosition.set(-1);
      this.atClosed.emit();
      return;
    }

    // Check if @ is at start OR preceded by whitespace
    const isValidTriggerPosition =
      lastAtIndex === 0 || /\s/.test(text[lastAtIndex - 1]);

    if (!isValidTriggerPosition) {
      this.lastTriggerPosition.set(-1);
      this.atClosed.emit();
      return;
    }

    // Extract query after @
    const queryStart = lastAtIndex + 1;
    const queryText = text.substring(queryStart, cursorPosition);

    // If query contains whitespace, close the trigger
    if (/\s/.test(queryText)) {
      this.lastTriggerPosition.set(-1);
      this.atClosed.emit();
      return;
    }

    // Valid trigger detected
    this.lastTriggerPosition.set(lastAtIndex);

    // Emit query change immediately
    this.atQueryChanged.emit(queryText);

    // Debounce the triggered event
    const timerId = setTimeout(() => {
      this.atTriggered.emit({
        query: queryText,
        cursorPosition,
        triggerPosition: lastAtIndex,
      });
    }, 150);

    this.debounceTimer.set(timerId);
  }

  /**
   * Clear debounce timer if exists
   */
  private clearDebounceTimer(): void {
    const timerId = this.debounceTimer();
    if (timerId !== null) {
      clearTimeout(timerId);
      this.debounceTimer.set(null);
    }
  }

  /**
   * Cleanup on directive destroy
   */
  ngOnDestroy(): void {
    this.clearDebounceTimer();
  }
}
