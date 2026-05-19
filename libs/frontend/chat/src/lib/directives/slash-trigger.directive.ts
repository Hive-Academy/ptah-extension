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
  readonly enabled = input(true);
  private readonly enabled$ = toObservable(this.enabled);
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
    const inputState$ = fromEvent<InputEvent>(textarea, 'input').pipe(
      map((): TriggerState => {
        const value = textarea.value;
        const cursorPosition = textarea.selectionStart;
        if (!value.startsWith('/')) {
          return { isActive: false, query: '', cursorPosition };
        }
        const textAfterSlash = value.substring(1, cursorPosition);
        const spaceIndex = textAfterSlash.indexOf(' ');
        if (spaceIndex !== -1) {
          return { isActive: false, query: '', cursorPosition };
        }
        return { isActive: true, query: textAfterSlash, cursorPosition };
      }),
      startWith({
        isActive: false,
        query: '',
        cursorPosition: 0,
      } as TriggerState)
    );
    const triggerState$ = combineLatest([inputState$, this.enabled$]).pipe(
      filter(([, enabled]) => enabled),
      map(([state]) => state),
      takeUntilDestroyed(this.destroyRef)
    );
    triggerState$
      .pipe(pairwise(), takeUntilDestroyed(this.destroyRef))
      .subscribe(([prev, curr]) => {
        if (!prev.isActive && curr.isActive) {
          this.slashActivated.emit({
            query: curr.query,
            cursorPosition: curr.cursorPosition,
          });
        }
        if (prev.isActive && !curr.isActive) {
          this.slashClosed.emit();
        }
        if (curr.isActive && (!prev.isActive || curr.query !== prev.query)) {
          this.slashQueryChanged.emit(curr.query);
        }
      });
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
