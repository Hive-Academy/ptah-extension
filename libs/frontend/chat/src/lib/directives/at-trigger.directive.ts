import {
  Directive,
  ElementRef,
  inject,
  input,
  output,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { fromEvent, combineLatest } from 'rxjs';
import {
  map,
  filter,
  debounceTime,
  distinctUntilChanged,
  startWith,
  pairwise,
} from 'rxjs/operators';

/**
 * Event emitted when @ trigger is detected
 */
export interface AtTriggerEvent {
  query: string;
  cursorPosition: number;
  triggerPosition: number;
}

/**
 * Internal state for @ trigger detection
 */
interface AtTriggerState {
  isActive: boolean;
  query: string;
  cursorPosition: number;
  triggerPosition: number;
}

/**
 * Directive that detects @ trigger in textarea for file/agent autocomplete
 *
 * Complexity Level: 2 (RxJS pipeline with debouncing)
 * Patterns: Signal-based inputs/outputs, RxJS reactive streams
 *
 * Responsibilities:
 * - Listen for input events on host textarea
 * - Detect @ trigger at start or after whitespace
 * - Extract query text after @
 * - Emit events for parent component to handle dropdown
 * - Debounce triggered events by 150ms
 * - Emit close immediately when trigger is removed
 *
 * Usage:
 * ```html
 * <textarea
 *   ptahAtTrigger
 *   (atTriggered)="handleAtTrigger($event)"
 *   (atClosed)="closeDropdown()"
 * ></textarea>
 * ```
 *
 * @example
 * // User types: "hello @fi"
 * // Emits: atTriggered({ query: "fi", cursorPosition: 9, triggerPosition: 6 })
 *
 * // User types: "hello @f i"
 * // Emits: atClosed() - whitespace in query
 */
@Directive({
  selector: '[ptahAtTrigger]',
})
export class AtTriggerDirective implements OnInit {
  private readonly elementRef = inject(ElementRef<HTMLTextAreaElement>);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  /**
   * Enable/disable the directive
   */
  readonly enabled = input(true);
  readonly dropdownOpen = input(false); // NEW: Signal to pause directive when dropdown is open

  // CRITICAL: Field initializer pattern for toObservable() call
  // Why: toObservable() uses inject() internally, which requires injection context
  // Injection context: Only available during class construction (field initializers, constructor)
  // Violation: Calling toObservable() in ngOnInit causes NG0203 "inject() must be called from injection context"
  // Reference: https://angular.dev/guide/signals/inputs#reading-input-values-in-ngOnInit
  private readonly enabled$ = toObservable(this.enabled);
  private readonly dropdownOpen$ = toObservable(this.dropdownOpen);

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

  private readonly DEBOUNCE_DELAY_MS = 150;

  ngOnInit(): void {
    this.setupInputPipeline();
  }

  /**
   * Setup RxJS pipeline for input event handling
   *
   * Flow:
   * 1. Listen to input events on textarea
   * 2. Detect @ trigger at start or after whitespace
   * 3. Map to trigger state (isActive, query, cursorPosition, triggerPosition)
   * 4. Combine with enabled signal
   * 5. Filter when disabled
   * 6. Track state transitions for close detection
   * 7. Debounce triggered events, emit close immediately
   */
  private setupInputPipeline(): void {
    const textarea = this.elementRef.nativeElement;

    // Stream of input events mapped to trigger state
    const inputState$ = fromEvent<InputEvent>(textarea, 'input').pipe(
      map((): AtTriggerState => this.detectAtTrigger(textarea)),
      startWith({
        isActive: false,
        query: '',
        cursorPosition: 0,
        triggerPosition: -1,
      } as AtTriggerState)
    );

    // Combined stream that respects enabled state AND dropdown open state
    const triggerState$ = combineLatest([
      inputState$,
      this.enabled$,
      this.dropdownOpen$, // NEW: Listen to dropdown state
    ]).pipe(
      filter(([, enabled, dropdownOpen]) => enabled && !dropdownOpen), // PAUSE when dropdown is open
      map(([state]) => state),
      takeUntilDestroyed(this.destroyRef)
    );

    // Track state transitions to detect open/close
    triggerState$
      .pipe(pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([prev, curr]) => {
        // Emit close immediately when transitioning from active to inactive
        if (prev.isActive && !curr.isActive) {
          this.atClosed.emit();
        }
      });

    // Debounced stream for triggered events (only when active)
    triggerState$
      .pipe(
        filter((state) => state.isActive),
        debounceTime(this.DEBOUNCE_DELAY_MS),
        distinctUntilChanged((a, b) => a.query === b.query),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => {
        this.atTriggered.emit({
          query: state.query,
          cursorPosition: state.cursorPosition,
          triggerPosition: state.triggerPosition,
        });
      });
  }

  /**
   * Detect @ trigger and return state
   *
   * Logic:
   * 1. Find @ symbol before cursor position
   * 2. Check if @ is at start OR preceded by whitespace
   * 3. Extract query after @ (until cursor or next whitespace)
   * 4. If query contains whitespace → inactive
   * 5. Otherwise → active with query
   */
  private detectAtTrigger(textarea: HTMLTextAreaElement): AtTriggerState {
    const text = textarea.value;
    const cursorPosition = textarea.selectionStart;

    // Find the last @ before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    // No @ found
    if (lastAtIndex === -1) {
      return {
        isActive: false,
        query: '',
        cursorPosition,
        triggerPosition: -1,
      };
    }

    // Check if @ is at start OR preceded by whitespace
    const isValidTriggerPosition =
      lastAtIndex === 0 || /\s/.test(text[lastAtIndex - 1]);

    if (!isValidTriggerPosition) {
      return {
        isActive: false,
        query: '',
        cursorPosition,
        triggerPosition: -1,
      };
    }

    // Extract query after @
    const queryStart = lastAtIndex + 1;
    const queryText = text.substring(queryStart, cursorPosition);

    // If query contains whitespace, not active
    if (/\s/.test(queryText)) {
      return {
        isActive: false,
        query: '',
        cursorPosition,
        triggerPosition: -1,
      };
    }

    // Valid trigger detected
    return {
      isActive: true,
      query: queryText,
      cursorPosition,
      triggerPosition: lastAtIndex,
    };
  }
}
