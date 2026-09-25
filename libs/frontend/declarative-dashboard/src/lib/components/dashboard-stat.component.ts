import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild, type InputSignal } from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceComponentViewState } from '../surface-view-state';
import type { DisplayNode } from '../view-model/view-model.types';

export type StatNode = Extract<DisplayNode, { kind: 'stat' }>;
let nextStatInstance = 0;

@Component({
  selector: 'ptah-dashboard-stat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Compact tile (prototype stats row): label, inline delta and the expand toggle share one header line. -->
    <section class="rounded border border-base-300 bg-base-200 px-2 py-1.5 text-base-content" (keydown.escape)="collapse($event)">
      <div class="flex items-center gap-1">
        <h3 class="min-w-0 flex-1 break-words text-[10px] uppercase leading-tight tracking-wider text-base-content-muted">{{ node().title?.text ?? 'Stat' }}</h3>
        @if (node().delta !== undefined) {
          <span class="shrink-0 text-[10px] leading-tight tabular-nums text-base-content-muted" data-testid="stat-delta"><span aria-hidden="true">&Delta; </span><span class="sr-only">Change </span>{{ signedDelta() }}</span>
        }
        <button #expandButton type="button" class="btn btn-ghost btn-xs btn-square shrink-0"
          [attr.aria-label]="(viewState().expanded ? 'Collapse ' : 'Expand ') + (node().title?.text ?? 'Stat')"
          [attr.aria-expanded]="!!viewState().expanded" [attr.aria-controls]="detailsId"
          [attr.data-apps-focus-key]="focusKey('expand')" (click)="toggleExpanded()">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path [attr.d]="viewState().expanded ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'" />
          </svg>
        </button>
      </div>
      <p class="text-sm font-semibold leading-tight tabular-nums text-base-content" data-testid="stat-value">{{ node().value }} {{ node().unit }}</p>
      @if (node().selectable) {
        <button type="button" class="btn btn-ghost btn-xs" [attr.aria-label]="'Select ' + (node().title?.text ?? 'Stat')"
          [attr.aria-pressed]="selection()?.componentId === node().id && selection()?.target?.kind === 'stat'"
          [attr.data-apps-focus-key]="focusKey('select')" (click)="selectStat()">Select</button>
      }
      <div [id]="detailsId" [hidden]="!viewState().expanded" class="mt-2 text-sm text-base-content-muted">
        @if (node().description; as description) { <p>{{ description.text }}</p> }
        <ng-content />
      </div>
    </section>
  `,
})
export class DashboardStatComponent {
  public readonly node: InputSignal<StatNode> = input.required<StatNode>();
  public readonly surfaceId = input('');
  public readonly viewState = input<SurfaceComponentViewState>({});
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly viewStateChange = output<SurfaceComponentViewState>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly detailsId = `ptah-stat-details-${nextStatInstance++}`;
  private readonly expandButton = viewChild.required<ElementRef<HTMLButtonElement>>('expandButton');

  /** The contract delta with an explicit sign for gains ("+2", "0", "-2"). */
  public readonly signedDelta = computed(() => {
    const delta = this.node().delta;
    return `${(delta ?? 0) > 0 ? '+' : ''}${delta ?? ''}`;
  });

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public toggleExpanded(): void { this.viewStateChange.emit({ ...this.viewState(), expanded: !this.viewState().expanded }); }
  public collapse(event: Event): void {
    if (!this.viewState().expanded) return;
    event.stopPropagation();
    this.viewStateChange.emit({ ...this.viewState(), expanded: false });
    this.expandButton().nativeElement.focus();
  }
  public selectStat(): void {
    if (this.node().selectable) this.selectionChange.emit({ componentId: this.node().id, target: { kind: 'stat' } });
  }
}
