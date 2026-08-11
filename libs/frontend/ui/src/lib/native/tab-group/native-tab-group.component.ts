/**
 * NativeTabGroupComponent - Signal-driven tablist with count badges.
 *
 * A domain-free tab strip plus the matching `tabpanel` wrapper. The consumer
 * owns the panel CONTENT (typically an `@switch` on the active id) — this
 * component owns the roles, ids, roving tabindex and keyboard model so every
 * Thoth surface gets the same, correct ARIA wiring.
 *
 * ARIA. Renders `role="tablist"` → `role="tab"` buttons → a single
 * `role="tabpanel"` whose `aria-labelledby` points at the active tab. Ids are
 * namespaced per instance so several tab groups can coexist on one page.
 *
 * KEYBOARD (WAI-ARIA "tabs with automatic activation"). ArrowLeft/ArrowRight
 * move to the previous/next enabled tab (wrapping), Home/End jump to the
 * first/last enabled tab. Selection follows focus. Disabled tabs are skipped.
 * Only the active tab is in the tab sequence (roving tabindex), so Tab moves
 * out of the strip into the panel rather than through every tab.
 *
 * STATE. `activeId` is a `model()`, so it works both uncontrolled
 * (`<ptah-native-tab-group [tabs]="tabs" />` — first enabled tab wins) and
 * two-way bound (`[(activeId)]="tab"`). {@link activeTabId} always resolves to
 * a real, enabled tab even when the bound id is stale or null.
 *
 * @example
 * ```html
 * <ptah-native-tab-group
 *   [tabs]="[
 *     { id: 'skill', label: 'Skills', count: 12 },
 *     { id: 'agent', label: 'Agents', count: 4 },
 *     { id: 'command', label: 'Commands', count: 0 },
 *   ]"
 *   [(activeId)]="kind"
 *   ariaLabel="Library sections"
 * >
 *   @switch (kind()) { … }
 * </ptah-native-tab-group>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  model,
  output,
  viewChildren,
} from '@angular/core';

/** One entry in a {@link NativeTabGroupComponent} strip. */
export interface NativeTab {
  /** Stable identifier; also the value emitted by `activeIdChange`. */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /**
   * Optional live count rendered as a badge. `0` renders as a badge showing
   * zero (an explicitly empty section), `null`/omitted renders no badge at all
   * (count not applicable / not yet known).
   */
  readonly count?: number | null;
  /** Tab cannot be focused or selected. */
  readonly disabled?: boolean;
  /** Accessible name override when `label` alone is ambiguous. */
  readonly ariaLabel?: string;
}

let instanceCounter = 0;

@Component({
  selector: 'ptah-native-tab-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="tablist"
      class="flex items-center gap-1 border-b border-base-300"
      [attr.aria-label]="ariaLabel()"
      data-testid="native-tablist"
    >
      @for (tab of tabs(); track tab.id) {
        <button
          #tabButton
          type="button"
          role="tab"
          class="relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          [class]="tabClasses(tab)"
          [id]="tabDomId(tab.id)"
          [attr.aria-controls]="panelDomId()"
          [attr.aria-selected]="tab.id === activeTabId()"
          [attr.aria-label]="tab.ariaLabel ?? null"
          [attr.tabindex]="tab.id === activeTabId() ? 0 : -1"
          [attr.data-tab-id]="tab.id"
          [disabled]="tab.disabled === true"
          data-testid="native-tab"
          (click)="select(tab)"
          (keydown)="onKeydown($event)"
        >
          <span>{{ tab.label }}</span>
          @if (tab.count !== null && tab.count !== undefined) {
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums"
              [class]="badgeClasses(tab)"
              data-testid="native-tab-count"
              aria-hidden="true"
              >{{ tab.count }}</span
            >
          }
        </button>
      }
    </div>

    <div
      role="tabpanel"
      class="outline-none"
      [id]="panelDomId()"
      [attr.aria-labelledby]="activeTabDomId()"
      tabindex="0"
      data-testid="native-tabpanel"
    >
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class NativeTabGroupComponent {
  private readonly instanceId = `ntg-${(instanceCounter++).toString(36)}`;

  /** The tabs to render, in visual order. */
  readonly tabs = input.required<readonly NativeTab[]>();

  /**
   * Selected tab id. Two-way bindable. When null or pointing at a missing or
   * disabled tab, the first enabled tab is used instead.
   */
  readonly activeId = model<string | null>(null);

  /** Accessible name for the tablist itself. */
  readonly ariaLabel = input<string | null>(null);

  /**
   * Emitted whenever the user picks a different tab. `activeId` is updated
   * first, so a two-way binding and this output stay consistent.
   */
  readonly tabSelected = output<string>();

  private readonly tabButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /**
   * The id that is actually rendered as selected. Falls back to the first
   * enabled tab so the strip is never left with nothing selected.
   */
  readonly activeTabId = computed<string | null>(() => {
    const list = this.tabs();
    const requested = this.activeId();
    const match = list.find((t) => t.id === requested && t.disabled !== true);
    if (match) return match.id;
    return list.find((t) => t.disabled !== true)?.id ?? null;
  });

  protected readonly activeTabDomId = computed(() => {
    const id = this.activeTabId();
    return id === null ? null : this.tabDomId(id);
  });

  protected tabDomId(tabId: string): string {
    return `${this.instanceId}-tab-${tabId}`;
  }

  protected panelDomId(): string {
    return `${this.instanceId}-panel`;
  }

  protected tabClasses(tab: NativeTab): string {
    return tab.id === this.activeTabId()
      ? 'border-primary text-base-content font-medium'
      : 'border-transparent text-base-content-muted hover:text-base-content';
  }

  protected badgeClasses(tab: NativeTab): string {
    return tab.id === this.activeTabId()
      ? 'bg-primary/20 text-primary'
      : 'bg-base-300/60 text-base-content-muted';
  }

  protected select(tab: NativeTab): void {
    if (tab.disabled === true) return;
    if (tab.id === this.activeTabId()) return;
    this.activeId.set(tab.id);
    this.tabSelected.emit(tab.id);
  }

  /**
   * Arrow/Home/End navigation with automatic activation: moving focus also
   * moves selection, which is the correct model for tab strips whose panels
   * are cheap to render.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const enabled = this.tabs().filter((t) => t.disabled !== true);
    if (enabled.length === 0) return;

    const current = enabled.findIndex((t) => t.id === this.activeTabId());
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (Math.max(current, 0) + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (Math.max(current, 0) - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const target = enabled[next];
    this.select(target);
    this.focusTab(target.id);
  }

  private focusTab(tabId: string): void {
    const button = this.tabButtons().find(
      (ref) => ref.nativeElement.dataset['tabId'] === tabId,
    );
    button?.nativeElement.focus();
  }
}
