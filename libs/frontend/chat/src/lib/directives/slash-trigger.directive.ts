import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  OnDestroy,
} from '@angular/core';

/**
 * Event emitted when slash trigger is detected
 */
export interface SlashTriggerEvent {
  query: string;
  cursorPosition: number;
}

/**
 * SlashTriggerDirective - Detects / command trigger in textarea
 *
 * Complexity Level: 1 (Simple directive with single responsibility)
 * Patterns: Signal-based inputs/outputs, Host listener
 *
 * Purpose:
 * - Attaches to textarea element
 * - Detects / trigger at position 0 (start of input)
 * - Emits events for parent to handle dropdown display
 * - Includes 150ms debounced fetch capability
 *
 * Usage:
 * ```html
 * <textarea
 *   [ptahSlashTrigger]
 *   [enabled]="true"
 *   (triggered)="handleSlashTrigger($event)"
 *   (closed)="closeSuggestions()"
 *   (queryChanged)="updateQuery($event)"
 * ></textarea>
 * ```
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles / trigger detection logic
 * - Dependency Inversion: No service dependencies, pure event emission
 * - Interface Segregation: Minimal, focused API
 */
@Directive({
  selector: '[ptahSlashTrigger]',
  standalone: true,
})
export class SlashTriggerDirective implements OnDestroy {
  private readonly elementRef = inject(ElementRef<HTMLTextAreaElement>);

  // Inputs
  enabled = input(true);

  // Outputs (prefixed with 'slash' to avoid conflicts with other trigger directives)
  slashTriggered = output<SlashTriggerEvent>();
  slashClosed = output<void>();
  slashQueryChanged = output<string>();

  // Debounce timer
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_DELAY_MS = 150;

  // Track previous state to detect changes
  private previousQuery: string | null = null;
  private wasTriggered = false;

  /**
   * Listen to input events on host textarea
   */
  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    if (!this.enabled()) {
      return;
    }

    const target = event.target as HTMLTextAreaElement;
    const value = target.value;
    const cursorPosition = target.selectionStart;

    this.detectSlashTrigger(value, cursorPosition);
  }

  /**
   * Detect / trigger at start of input
   */
  private detectSlashTrigger(value: string, cursorPosition: number): void {
    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // / trigger MUST be at position 0 (start of input)
    if (value.startsWith('/')) {
      const query = value.substring(1); // Everything after /

      // Emit slashQueryChanged immediately (no debounce)
      if (query !== this.previousQuery) {
        this.slashQueryChanged.emit(query);
        this.previousQuery = query;
      }

      // Debounce the triggered event (for fetch operations)
      this.debounceTimer = setTimeout(() => {
        this.slashTriggered.emit({
          query,
          cursorPosition,
        });
        this.wasTriggered = true;
      }, this.DEBOUNCE_DELAY_MS);
    } else {
      // / removed or not at start - close trigger immediately (no debounce)
      if (this.wasTriggered) {
        this.slashClosed.emit();
        this.wasTriggered = false;
      }
      this.previousQuery = null;
    }
  }

  /**
   * Cleanup on destroy
   */
  ngOnDestroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
