import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import {
  checkDraftValue,
  type SurfaceDataValue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import type { InputNode } from '../view-model/view-model.types';

export type TextInputNode = Extract<InputNode, { readonly kind: 'text' }>;

/**
 * One keystroke-level draft write into view state (`SurfaceViewState.drafts`,
 * keyed by component id). `value: undefined` removes the draft, which hands
 * the display back to the pending overlay or the host value (plan:770-771).
 */
export interface SurfaceDraftWrite {
  readonly componentId: string;
  readonly value: SurfaceDataValue | undefined;
}

/** Typed text and the node identity, host value and `drafts` object it was typed against. */
interface TypedText {
  readonly text: string;
  readonly componentId: string;
  readonly path: string;
  readonly hostValue: SurfaceDataValue;
  readonly drafts: Readonly<Record<string, SurfaceDataValue>>;
}

/** Commits this many milliseconds after the last keystroke (plan:768). */
export const SURFACE_TEXT_COMMIT_DEBOUNCE_MS = 600;
const NO_DRAFTS: Readonly<Record<string, SurfaceDataValue>> = {};
const NO_PENDING_VALUES: ReadonlyMap<string, SurfaceDataValue> = new Map();
const NO_ISSUES: ReadonlyMap<string, readonly string[]> = new Map();
let nextTextInputInstance = 0;

function plainText(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && typeof (value as { readonly text?: unknown }).text === 'string'
    ? (value as { readonly text: string }).text : undefined;
}

/**
 * Text input, single-line or `multiline`. Drafts every keystroke into view
 * state (no I/O) and commits on blur, on Enter (single-line) or 600 ms after
 * the last keystroke, never per keystroke. An invalid or unchanged draft is
 * never committed. One debounce timer per instance, cleared on commit and on
 * destroy.
 */
@Component({
  selector: 'ptah-surface-text-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1 text-base-content">
      <label [for]="controlId" class="block text-xs font-medium">{{ node().label }}@if (required()) {
        <span aria-hidden="true"> *</span>
      }</label>
      @if (multiline()) {
        <textarea #multiLineControl [id]="controlId" class="textarea textarea-bordered w-full text-sm" rows="3"
          [value]="displayedText()" [attr.placeholder]="placeholder()"
          [attr.aria-required]="required() ? 'true' : null" [attr.aria-invalid]="hasError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()" [attr.data-apps-focus-key]="focusKey('input')"
          (input)="draftInput(multiLineControl.value)" (blur)="commitNow()"></textarea>
      } @else {
        <input #singleLineControl [id]="controlId" type="text" class="input input-bordered input-sm w-full text-sm"
          [value]="displayedText()" [attr.placeholder]="placeholder()"
          [attr.aria-required]="required() ? 'true' : null" [attr.aria-invalid]="hasError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()" [attr.data-apps-focus-key]="focusKey('input')"
          (input)="draftInput(singleLineControl.value)" (blur)="commitNow()" (keydown.enter)="commitOnEnter($event)" />
      }
      @if (description(); as description) { <p [id]="hintId" class="text-xs text-base-content-muted">{{ description }}</p> }
      @if (errorText(); as error) { <p [id]="errorId" class="text-xs font-medium text-base-content">{{ error }}</p> }
      @for (issue of issueTexts(); track $index) {
        <p [id]="issueId($index)" class="text-xs font-medium text-base-content">{{ issue }}</p>
      }
    </div>
  `,
})
export class SurfaceTextInputComponent {
  public readonly controlId = `ptah-surface-text-${nextTextInputInstance++}`;
  public readonly hintId = `${this.controlId}-hint`;
  public readonly errorId = `${this.controlId}-error`;
  public readonly node = input.required<TextInputNode>();
  public readonly surfaceId = input('');
  public readonly drafts = input<Readonly<Record<string, SurfaceDataValue>>>(NO_DRAFTS);
  public readonly pendingValues = input<ReadonlyMap<string, SurfaceDataValue>>(NO_PENDING_VALUES);
  public readonly issues = input<ReadonlyMap<string, readonly string[]>>(NO_ISSUES);
  public readonly inputCommit = output<SurfaceInputCommit>();
  public readonly draftChange = output<SurfaceDraftWrite>();
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  /**
   * The text typed since the last commit, keyed by what it was typed against.
   * The commit reads this, not the `drafts` input, so it does not depend on
   * the parent's write round trip. It is dropped (see `isStale`) when the node
   * identity or host value changes, or when the parent's draft entry no longer
   * holds it.
   */
  private typed: TypedText | null = null;
  /**
   * The `drafts` object in force at the last successful commit, and the id it
   * was for. Until the parent passes a new `drafts` object, its entry for that
   * id is the draft just consumed and must not commit a second time.
   */
  private consumed: { readonly componentId: string; readonly drafts: Readonly<Record<string, SurfaceDataValue>> } | null = null;

  /**
   * Invariant (B8 contract): only this input removes its own `drafts` entry,
   * through `draftChange`. If anything else removes or replaces it, or the
   * node or host value changes under the typed text, the effect drops the
   * typed text and its timer so neither can commit text the UI no longer shows.
   */
  public constructor() {
    inject(DestroyRef).onDestroy(() => this.clearDebounce());
    effect(() => {
      const node = this.node();
      const drafts = this.drafts();
      if (this.typed !== null && this.isStale(this.typed, node, drafts)) this.dropTyped();
    });
  }

  /** Rule 4 order: the draft over the pending overlay over the host value. */
  public readonly displayedValue = computed<SurfaceDataValue>(() => {
    const node = this.node();
    const draft = this.drafts()[node.id];
    if (draft !== undefined) return draft;
    const pending = this.pendingValues().get(node.path);
    return pending !== undefined ? pending : node.hostValue;
  });
  public readonly displayedText = computed(() => {
    const value = this.displayedValue();
    return typeof value === 'string' ? value : '';
  });
  /** What a commit is compared against: the pending overlay over the host value. */
  private readonly baseline = computed<SurfaceDataValue>(() => {
    const pending = this.pendingValues().get(this.node().path);
    return pending !== undefined ? pending : this.node().hostValue;
  });
  public readonly multiline = computed(() => this.node().multiline === true);
  public readonly required = computed(() => this.node().hints?.required === true);
  public readonly placeholder = computed(() => {
    const placeholder: unknown = this.node().placeholder;
    return typeof placeholder === 'string' ? placeholder : null;
  });
  public readonly description = computed(() => plainText(this.node().description));
  public readonly issueTexts = computed((): readonly string[] => {
    const issues: unknown = this.issues().get(this.node().id);
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: unknown) => typeof issue === 'string' ? [issue] : []);
  });
  /** The current draft's error wins over the node's host-read error. */
  public readonly errorText = computed(() => {
    const node = this.node();
    const draft = this.drafts()[node.id];
    if (draft === undefined && node.draftError !== undefined) return node.draftError;
    const check = checkDraftValue(node, this.displayedValue());
    return check.ok ? undefined : check.reason;
  });
  public readonly hasError = computed(() => this.errorText() !== undefined || this.issueTexts().length > 0);
  public readonly describedBy = computed(() => {
    const ids: string[] = [];
    if (this.description() !== undefined) ids.push(this.hintId);
    if (this.errorText() !== undefined) ids.push(this.errorId);
    this.issueTexts().forEach((_, index) => ids.push(this.issueId(index)));
    return ids.length > 0 ? ids.join(' ') : null;
  });

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public issueId(index: number): string { return `${this.controlId}-issue-${index}`; }

  /** Local only: a draft write and a restarted idle timer, never a commit. */
  public draftInput(text: string): void {
    const node = this.node();
    this.typed = { text, componentId: node.id, path: node.path, hostValue: node.hostValue, drafts: this.drafts() };
    this.draftChange.emit({ componentId: node.id, value: text });
    this.armDebounce();
  }
  public commitNow(): void { this.commitDraft(); }
  /** An Enter that confirms an IME composition is not a commit. */
  public commitOnEnter(event: Event): void {
    if (event instanceof KeyboardEvent && event.isComposing) return;
    this.commitDraft();
  }

  private armDebounce(): void {
    this.clearDebounce();
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.commitDraft();
    }, SURFACE_TEXT_COMMIT_DEBOUNCE_MS);
  }
  private clearDebounce(): void {
    if (this.debounceHandle === null) return;
    clearTimeout(this.debounceHandle);
    this.debounceHandle = null;
  }
  /**
   * The commit gate. An invalid draft is never committed and stays shown with
   * its error. A passing draft leaves view state; it is committed first (so
   * the parent can raise its overlay) only when it differs from the pending
   * or host value.
   */
  private commitDraft(): void {
    this.clearDebounce();
    const draft = this.currentDraft();
    if (draft === undefined) return;
    const node = this.node();
    if (!checkDraftValue(node, draft).ok) return;
    this.typed = null;
    this.consumed = { componentId: node.id, drafts: this.drafts() };
    if (draft !== this.baseline()) this.inputCommit.emit({ componentId: node.id, value: draft });
    this.draftChange.emit({ componentId: node.id, value: undefined });
  }
  /**
   * The draft a commit may send: the typed text while it is still current,
   * otherwise this node's `drafts` entry unless that entry was already consumed.
   */
  private currentDraft(): SurfaceDataValue | undefined {
    const node = this.node();
    const drafts = this.drafts();
    if (this.typed !== null && this.isStale(this.typed, node, drafts)) this.dropTyped();
    if (this.typed !== null) return this.typed.text;
    const consumed = this.consumed;
    if (consumed !== null && consumed.drafts === drafts && consumed.componentId === node.id) return undefined;
    return drafts[node.id];
  }
  /**
   * Typed text is stale once the node identity or host value changes, or once
   * the parent passed a new `drafts` object whose entry is not this text (it
   * was removed or replaced). The same `drafts` object means the parent has not
   * yet round-tripped the write, so the typed text still stands.
   */
  private isStale(typed: TypedText, node: TextInputNode, drafts: Readonly<Record<string, SurfaceDataValue>>): boolean {
    if (typed.componentId !== node.id || typed.path !== node.path) return true;
    if (!Object.is(typed.hostValue, node.hostValue)) return true;
    return drafts !== typed.drafts && drafts[node.id] !== typed.text;
  }
  private dropTyped(): void {
    this.typed = null;
    this.clearDebounce();
  }
}
