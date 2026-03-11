import {
  Directive,
  ElementRef,
  inject,
  output,
  input,
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
 * Event emitted when slash trigger is detected
 */
export interface SlashTriggerEvent {
  query: string;
  cursorPosition: number;
}

/**
 * Internal state for trigger detection
 */
interface TriggerState {
  isActive: boolean;
  query: string;
  cursorPosition: number;
}

/**
 * SlashTriggerDirective - Detects / command trigger in textarea
 *
 * Complexity Level: 2 (RxJS pipeline with debouncing)
 * Patterns: Signal-based inputs/outputs, RxJS reactive streams
 *
 * Purpose:
 * - Attaches to textarea element
 * - Detects / trigger at position 0 (start of input)
 * - Emits events for parent to handle dropdown display
 * - Debounces triggered events (150ms) to prevent excessive fetches
 * - Emits close immediately when trigger is removed
 *
 * Usage:
 * ```html
 * <textarea
 *   ptahSlashTrigger
 *   (slashTriggered)="handleSlashTrigger($event)"
 *   (slashClosed)="closeSuggestions()"
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
})
export class SlashTriggerDirective implements OnInit {
  private readonly elementRef = inject(ElementRef<HTMLTextAreaElement>);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  readonly enabled = input(true);

  // CRITICAL: Field initializer pattern for toObservable() call
  // Why: toObservable() uses inject() internally, which requires injection context
  // Injection context: Only available during class construction (field initializers, constructor)
  // Violation: Calling toObservable() in ngOnInit causes NG0203 "inject() must be called from injection context"
  // Reference: https://angular.dev/guide/signals/inputs#reading-input-values-in-ngOnInit
  private readonly enabled$ = toObservable(this.enabled);

  // Outputs (prefixed with 'slash' to avoid conflicts with other trigger directives)
  /**
   * Emitted IMMEDIATELY when / trigger becomes active (inactive→active transition).
   * Use this to open the dropdown without waiting for debounce.
   */
  readonly slashActivated = output<SlashTriggerEvent>();
  readonly slashTriggered = output<SlashTriggerEvent>();
  readonly slashClosed = output<void>();
  readonly slashQueryChanged = output<string>();

  private readonly DEBOUNCE_DELAY_MS = 150;

  ngOnInit(): void {
    this.setupInputPipeline();
  }

  /**
   * Setup RxJS pipeline for input event handling
   *
   * Flow:
   * 1. Listen to input events on textarea
   * 2. Map to trigger state (isActive, query, cursorPosition)
   * 3. Combine with enabled signal
   * 4. Filter when disabled
   * 5. Track state transitions for close detection
   * 6. Debounce triggered events, emit close immediately
   */
  private setupInputPipeline(): void {
    const textarea = this.elementRef.nativeElement;

    // Stream of input events mapped to trigger state
    const inputState$ = fromEvent<InputEvent>(textarea, 'input').pipe(
      map((): TriggerState => {
        const value = textarea.value;
        const cursorPosition = textarea.selectionStart;

        // Slash trigger detection rules:
        // 1. Value must start with / (slash commands are always at position 0)
        // 2. The command portion (text between / and first space) must have no space
        //    (space indicates command was completed/selected)
        //    This prevents re-triggering after user selects a command like "/orchestrate "
        //
        // NOTE: Removed the `value.includes('@')` guard — it was overly aggressive
        // and disabled slash commands if ANY @ existed in the text (e.g., email addresses,
        // leftover @ from file selection). The @ and / triggers now operate independently.
        if (!value.startsWith('/')) {
          return { isActive: false, query: '', cursorPosition };
        }

        // Extract potential command (text after / up to cursor position)
        // Only consider text up to cursor — user may have moved cursor back
        const textAfterSlash = value.substring(1, cursorPosition);
        const spaceIndex = textAfterSlash.indexOf(' ');

        // If there's a space before the cursor, command is complete
        if (spaceIndex !== -1) {
          return { isActive: false, query: '', cursorPosition };
        }

        // Active: no space yet, still typing command name
        return { isActive: true, query: textAfterSlash, cursorPosition };
      }),
      startWith({
        isActive: false,
        query: '',
        cursorPosition: 0,
      } as TriggerState)
    );

    // Combined stream that respects enabled state AND dropdown open state
    const triggerState$ = combineLatest([inputState$, this.enabled$]).pipe(
      filter(([, enabled]) => enabled),
      map(([state]) => state),
      takeUntilDestroyed(this.destroyRef)
    );

    // Track state transitions to detect open/close
    triggerState$
      .pipe(pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([prev, curr]) => {
        // Emit activated immediately on inactive→active transition
        if (!prev.isActive && curr.isActive) {
          this.slashActivated.emit({
            query: curr.query,
            cursorPosition: curr.cursorPosition,
          });
        }

        // Emit close immediately when transitioning from active to inactive
        if (prev.isActive && !curr.isActive) {
          this.slashClosed.emit();
        }

        // Emit query change immediately (including on activation)
        if (curr.isActive && (!prev.isActive || curr.query !== prev.query)) {
          this.slashQueryChanged.emit(curr.query);
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
        this.slashTriggered.emit({
          query: state.query,
          cursorPosition: state.cursorPosition,
        });
      });
  }
}
