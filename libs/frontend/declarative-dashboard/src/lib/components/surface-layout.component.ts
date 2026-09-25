import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, type TemplateRef } from '@angular/core';
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

let nextLayoutInstance = 0;
const GAP_CLASSES = { none: 'gap-0', small: 'gap-2', medium: 'gap-4', large: 'gap-6' } as const;
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
  template: `
    <ng-template #children>
      @for (child of node().children; track child.id) {
        <ng-container [ngTemplateOutlet]="childTemplate()" [ngTemplateOutletContext]="{ $implicit: child, index: $index }" />
      }
    </ng-template>
    <ng-template #submit>
      @for (action of submitActions(); track action.id) {
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-primary btn-sm" [disabled]="isSubmitDisabled(action)"
            [attr.aria-describedby]="statusId($index)" [attr.data-apps-focus-key]="focusKey('action-' + action.id)"
            (click)="invoke(action)">{{ action.label.text }}</button>
          <span [id]="statusId($index)" role="status" class="text-xs text-base-content">{{ statusText(action) }}</span>
        </div>
      }
    </ng-template>
    @switch (node().kind) {
      @case ('section') {
        <section class="flex flex-col gap-3 text-base-content">
          <h3 class="text-sm font-semibold">{{ title() }}</h3>
          @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
          <div class="flex flex-col gap-3"><ng-container [ngTemplateOutlet]="children" /></div>
          <ng-container [ngTemplateOutlet]="submit" />
        </section>
      }
      @case ('card') {
        <div class="card card-bordered bg-base-100 flex flex-col gap-3 p-4 text-base-content">
          @if (title(); as title) { <h3 class="text-sm font-semibold">{{ title }}</h3> }
          @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
          <div class="flex flex-col gap-3"><ng-container [ngTemplateOutlet]="children" /></div>
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
  public readonly actionInvoke = output<SurfaceActionInvoke>();

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
    return node.kind === 'section' || node.kind === 'card' ? plainText(node.title) : undefined;
  });
  public readonly description = computed(() => {
    const node = this.node();
    return node.kind === 'section' || node.kind === 'card' ? plainText(node.description) : undefined;
  });
  /** Stack: flex by direction. Grid: at most maxGridColumns, one column below `sm`. */
  public readonly containerClass = computed(() => {
    const node = this.node();
    const gap = node.kind === 'stack' || node.kind === 'grid' ? GAP_CLASSES[node.gap ?? 'medium'] ?? GAP_CLASSES.medium : GAP_CLASSES.medium;
    if (node.kind === 'grid') return `grid grid-cols-1 ${SM_GRID_COLUMNS[this.gridColumns()]} ${gap}`;
    if (node.kind === 'stack' && node.direction === 'horizontal') return `flex flex-row flex-wrap ${gap}`;
    return `flex flex-col ${gap}`;
  });
  public readonly gridColumns = computed(() => {
    const node = this.node();
    const columns = node.kind === 'grid' && Number.isFinite(node.columns) ? Math.floor(node.columns) : 1;
    return Math.min(SURFACE_LIMITS.maxGridColumns, Math.max(1, columns));
  });

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public statusId(index: number): string { return `${this.instanceId}-status-${index}`; }
  public statusText(action: SurfaceAction): string { return submitStatusText(this.actionStates().get(action.id)); }
  public isSubmitDisabled(action: SurfaceAction): boolean {
    return this.submitDisabled() || this.actionStates().get(action.id)?.status === 'pending';
  }
  public invoke(action: SurfaceAction): void {
    if (action.action === 'surface.submit' && !this.isSubmitDisabled(action)) this.actionInvoke.emit({ actionId: action.id });
  }
}
