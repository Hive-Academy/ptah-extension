import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  linkedSignal,
  output,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { SURFACE_LIMITS, type SurfaceAction } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceActionInvoke, SurfaceActionUiState } from '../surface-interaction';
import type { LayoutNode, SurfaceNode } from '../view-model/view-model.types';

/**
 * Children are rendered by the host's template, never by a component imported
 * here: the recursive node component imports this one, not the reverse (R5).
 */
export interface SurfaceLayoutChildContext {
  readonly $implicit: SurfaceNode;
  readonly index: number;
}

/**
 * `viewport`: the Apps page layout (Tailwind `sm:` breakpoints, unchanged).
 * `container`: columns follow the renderer root's own width (D9, R3.5).
 */
export type SurfaceLayoutWidth = 'viewport' | 'container';

/**
 * Container-mode grid rules, shared by the renderer root and nested grids.
 * The renderer root is the `dp` container. Below 360 px every grid is one
 * column; from 360 px columns auto-fit at 128 px or wider, never more than
 * the grid's `dp-cols-N` ceiling; from 700 px a stat grid takes 3 columns
 * (or its ceiling, when lower).
 */
export const SURFACE_CONTAINER_GRID_STYLES = `
  .dp-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--dp-gap); min-width: 0; }
  .dp-gap-none { --dp-gap: 0px; }
  .dp-gap-small { --dp-gap: 0.5rem; }
  .dp-gap-medium { --dp-gap: 1rem; }
  .dp-gap-large { --dp-gap: 1.5rem; }
  .dp-cols-1 { --dp-cols: 1; }
  .dp-cols-2 { --dp-cols: 2; }
  .dp-cols-3 { --dp-cols: 3; }
  .dp-cols-4 { --dp-cols: 4; }
  @container dp (min-width: 360px) {
    .dp-grid {
      grid-template-columns: repeat(auto-fit,
        minmax(min(100%, max(128px, calc((100% - (var(--dp-cols) - 1) * var(--dp-gap)) / var(--dp-cols)))), 1fr));
    }
  }
  @container dp (min-width: 700px) {
    .dp-grid--stats.dp-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .dp-grid--stats.dp-cols-3, .dp-grid--stats.dp-cols-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
`;

/** Container-mode card bodies own their available inline size. Compact items
 * share tracks; every other child deliberately spans the full body width.
 * The query container wraps the grid: a container cannot match its own query. */
export const SURFACE_CONTAINER_BODY_STYLES = `
  .dp-container-query { container-type: inline-size; container-name: dp-body; min-width: min(100%, 16rem); }
  .dp-container-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; min-width: 0; }
  .dp-container-body-child { grid-column: 1 / -1; min-width: 0; }
  @container dp-body (min-width: 16rem) {
    .dp-container-body { grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr)); }
    .dp-container-body-child--compact { grid-column: auto; }
  }
`;

/**
 * One collapse pattern for `accordion` and the container-mode `section`
 * (design section 7): the hidden body is `inert` and `visibility:hidden`.
 * Motion runs only under `prefers-reduced-motion: no-preference`.
 */
const COLLAPSE_STYLES = `
  .dp-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
  .dp-collapse[data-open='false'] { grid-template-rows: 0fr; visibility: hidden; }
  .dp-collapse-inner { min-height: 0; min-width: 0; }
  .dp-collapse[data-open='false'] > .dp-collapse-inner { overflow: hidden; }
  .dp-toggle { min-height: 2rem; }
  .dp-toggle:focus-visible { outline: 2px solid oklch(var(--bc)); outline-offset: 2px; }
  .dp-chevron[data-open='true'] { transform: rotate(180deg); }
  @media (prefers-reduced-motion: no-preference) {
    .dp-collapse { transition: grid-template-rows 220ms ease, visibility 220ms; }
    .dp-chevron { transition: transform 200ms ease; }
  }
`;

let nextLayoutInstance = 0;
const GAP_CLASSES = { none: 'gap-0', small: 'gap-2', medium: 'gap-4', large: 'gap-6' } as const;
const CONTAINER_GAP_CLASSES = {
  none: 'dp-gap-none', small: 'dp-gap-small', medium: 'dp-gap-medium', large: 'dp-gap-large',
} as const;
/** Literal class names so the Tailwind scanner emits them. Index = column count. */
const SM_GRID_COLUMNS = ['sm:grid-cols-1', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4'] as const;
const NO_ACTION_STATES: ReadonlyMap<string, SurfaceActionUiState> = new Map();

function plainText(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string'
    ? (value as { text: string }).text : undefined;
}

/** Submit state text, per the plan's Component 5 state table. */
function submitStatusText(state: SurfaceActionUiState | undefined): string {
  switch (state?.status) {
    case undefined: return '';
    case 'pending': return 'Sending…';
    case 'applied': return 'Sent';
    case 'indeterminate': return 'May have been sent - do not resend.';
    case 'unknown': return 'We could not confirm whether this was sent. Check the conversation before sending again.';
    case 'not-found': return state.detail ?? 'This app is no longer available.';
    case 'unsupported': return state.detail ?? 'This action is not available here.';
    case 'rejected':
      switch (state.reason) {
        case 'stale-revision': return 'This app changed. Check the values and submit again.';
        case 'submit-invalid': return 'Some fields need attention.';
        case 'busy': return 'The agent is busy; try again when it finishes.';
        case 'session-unavailable': return 'This conversation is not running.';
        default: return state.detail ?? 'The request was not accepted.';
      }
  }
}

@Component({
  selector: 'ptah-surface-layout',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [SURFACE_CONTAINER_GRID_STYLES, SURFACE_CONTAINER_BODY_STYLES, COLLAPSE_STYLES],
  template: `
    <ng-template #children>
      <!-- Position plus id: duplicate ids stay distinct, and a swapped id gets a fresh view. -->
      @for (child of node().children; track $index + ':' + child.id) {
        <ng-container [ngTemplateOutlet]="childTemplate()" [ngTemplateOutletContext]="{ $implicit: child, index: $index }" />
      }
    </ng-template>
    <ng-template #responsiveChildren>
      <div class="dp-container-query">
        <div class="dp-container-body">
          @for (child of node().children; track $index + ':' + child.id) {
            <div class="dp-container-body-child" [class.dp-container-body-child--compact]="child.kind === 'stat' || child.kind === 'avatar'">
              <ng-container [ngTemplateOutlet]="childTemplate()" [ngTemplateOutletContext]="{ $implicit: child, index: $index }" />
            </div>
          }
        </div>
      </div>
    </ng-template>
    <ng-template #submit>
      @for (action of submitActions(); track $index + ':' + action.id) {
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-primary btn-sm" [disabled]="isSubmitDisabled(action)"
            [attr.aria-describedby]="statusId($index)" [attr.data-apps-focus-key]="focusKey('action-' + action.id)"
            (click)="invoke(action)">{{ action.label.text }}</button>
          <!-- Only "Sent" carries color (prototype); every other state stays base-content text. -->
          <span [id]="statusId($index)" role="status" class="text-xs"
            [class.text-success]="isSent(action)" [class.text-base-content]="!isSent(action)">{{ statusText(action) }}</span>
        </div>
      }
    </ng-template>
    <ng-template #collapsible>
      <!-- The header button toggles the body; Escape inside collapses it and refocuses the button (R4.6, R9.1). -->
      <section class="card card-bordered bg-base-100 flex min-w-0 flex-col text-base-content" [attr.data-kind]="node().kind"
        (keydown.escape)="collapse($event)">
        <h3 class="m-0">
          <button #collapseToggle type="button" class="dp-toggle flex w-full items-center gap-2 rounded-[inherit] px-3 py-2 text-left"
            [id]="toggleId" [attr.aria-expanded]="open()" [attr.aria-controls]="regionId"
            [attr.data-apps-focus-key]="focusKey('toggle')" (click)="toggle()">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="break-words text-sm font-semibold">{{ title() }}</span>
              @if (description(); as description) {
                <span class="break-words text-xs font-normal text-base-content-muted">{{ description }}</span>
              }
            </span>
            <svg class="dp-chevron shrink-0" [attr.data-open]="open()" width="16" height="16" viewBox="0 0 24 24"
              aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5" /></svg>
          </button>
        </h3>
        <div [id]="regionId" class="dp-collapse" [attr.data-open]="open()" [attr.inert]="open() ? null : ''">
          <div class="dp-collapse-inner">
            <div class="flex flex-col gap-3 px-3 pb-3">
              @if (layoutWidth() === 'container') {
                <ng-container [ngTemplateOutlet]="responsiveChildren" />
              } @else {
                <div [class]="containerClass()"><ng-container [ngTemplateOutlet]="children" /></div>
              }
              <ng-container [ngTemplateOutlet]="submit" />
            </div>
          </div>
        </div>
      </section>
    </ng-template>
    @switch (node().kind) {
      @case ('accordion') { <ng-container [ngTemplateOutlet]="collapsible" /> }
      @case ('section') {
        @if (layoutWidth() === 'container') {
          <ng-container [ngTemplateOutlet]="collapsible" />
        } @else {
          <section class="flex flex-col gap-3 text-base-content">
            <h3 class="text-sm font-semibold">{{ title() }}</h3>
            @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
            <div class="flex flex-col gap-3"><ng-container [ngTemplateOutlet]="children" /></div>
            <ng-container [ngTemplateOutlet]="submit" />
          </section>
        }
      }
      @case ('card') {
        <div class="card card-bordered bg-base-100 flex flex-col gap-3 p-4 text-base-content">
          @if (title(); as title) { <h3 class="text-sm font-semibold">{{ title }}</h3> }
          @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
          @if (layoutWidth() === 'container') {
            <ng-container [ngTemplateOutlet]="responsiveChildren" />
          } @else {
            <div class="flex flex-col gap-3"><ng-container [ngTemplateOutlet]="children" /></div>
          }
          <ng-container [ngTemplateOutlet]="submit" />
        </div>
      }
      @default {
        <div class="flex flex-col gap-3">
          <div [class]="containerClass()"><ng-container [ngTemplateOutlet]="children" /></div>
          <ng-container [ngTemplateOutlet]="submit" />
        </div>
      }
    }
  `,
})
export class SurfaceLayoutComponent {
  private readonly instanceId = `ptah-layout-${nextLayoutInstance++}`;
  public readonly node = input.required<LayoutNode>();
  public readonly childTemplate = input.required<TemplateRef<SurfaceLayoutChildContext>>();
  public readonly surfaceId = input('');
  public readonly actionStates = input<ReadonlyMap<string, SurfaceActionUiState>>(NO_ACTION_STATES);
  public readonly submitDisabled = input(false);
  public readonly layoutWidth = input<SurfaceLayoutWidth>('viewport');
  /** `viewState.components[id].expanded`; absent means the kind's default (accordion closed, section open). */
  public readonly expanded = input<boolean | undefined>(undefined);
  public readonly actionInvoke = output<SurfaceActionInvoke>();
  public readonly expandedChange = output<boolean>();

  public readonly toggleId = `${this.instanceId}-toggle`;
  public readonly regionId = `${this.instanceId}-region`;
  private readonly toggleButton = viewChild<ElementRef<HTMLButtonElement>>('collapseToggle');
  /** Follows the parent's state; a toggle applies at once and is reported, so a parent that stores it keeps it. */
  public readonly open = linkedSignal(() => this.expanded() ?? this.node().kind === 'section');

  /** Only `surface.submit` is a control; every other action id renders nothing (Req 4.6). */
  public readonly submitActions = computed((): readonly SurfaceAction[] => {
    const actions: readonly SurfaceAction[] | undefined = this.node().submitActions;
    return Array.isArray(actions)
      ? actions.filter(action => action?.action === 'surface.submit' && typeof action.id === 'string'
        && plainText(action.label) !== undefined)
      : [];
  });
  public readonly title = computed(() => {
    const node = this.node();
    return node.kind === 'section' || node.kind === 'card' || node.kind === 'accordion' ? plainText(node.title) : undefined;
  });
  public readonly description = computed(() => {
    const node = this.node();
    return node.kind === 'section' || node.kind === 'card' ? plainText(node.description) : undefined;
  });
  /**
   * Stack: flex by direction. Grid, viewport mode: at most maxGridColumns, one
   * column below `sm`. Grid, container mode: the `dp-grid` rules, with the
   * stat variant when every child is a stat.
   */
  public readonly containerClass = computed(() => {
    const node = this.node();
    const gapKey = node.kind === 'stack' || node.kind === 'grid' ? node.gap ?? 'medium' : 'medium';
    const gap = GAP_CLASSES[gapKey] ?? GAP_CLASSES.medium;
    if (node.kind === 'grid' && this.layoutWidth() === 'container') {
      const stats = node.children.length > 0 && node.children.every(child => child.kind === 'stat');
      const containerGap = CONTAINER_GAP_CLASSES[gapKey] ?? CONTAINER_GAP_CLASSES.medium;
      return `dp-grid dp-cols-${this.gridColumns()} ${containerGap}${stats ? ' dp-grid--stats' : ''}`;
    }
    if (node.kind === 'grid') return `grid grid-cols-1 ${SM_GRID_COLUMNS[this.gridColumns()]} ${gap}`;
    if (node.kind === 'stack' && node.direction === 'horizontal') return `flex flex-row flex-wrap ${gap}`;
    return `flex flex-col ${gap}`;
  });
  public readonly gridColumns = computed(() => {
    const node = this.node();
    const columns = node.kind === 'grid' && Number.isFinite(node.columns) ? Math.floor(node.columns) : 1;
    return Math.min(SURFACE_LIMITS.maxGridColumns, Math.max(1, columns));
  });

  public toggle(): void {
    const next = !this.open();
    this.open.set(next);
    this.expandedChange.emit(next);
  }
  /** Escape inside an expanded body collapses it and returns focus to its toggle (R9.1). */
  public collapse(event: Event): void {
    const toggle = this.toggleButton();
    if (!this.open() || toggle === undefined) return;
    event.stopPropagation();
    this.open.set(false);
    this.expandedChange.emit(false);
    toggle.nativeElement.focus();
  }
  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public statusId(index: number): string { return `${this.instanceId}-status-${index}`; }
  public statusText(action: SurfaceAction): string { return submitStatusText(this.actionStates().get(action.id)); }
  public isSent(action: SurfaceAction): boolean { return this.actionStates().get(action.id)?.status === 'applied'; }
  public isSubmitDisabled(action: SurfaceAction): boolean {
    return this.submitDisabled() || this.actionStates().get(action.id)?.status === 'pending';
  }
  public invoke(action: SurfaceAction): void {
    if (action.action === 'surface.submit' && !this.isSubmitDisabled(action)) this.actionInvoke.emit({ actionId: action.id });
  }
}
