import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
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
    <section class="rounded border border-base-300 bg-base-200 p-3 text-base-content" (keydown.escape)="collapse($event)">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xs uppercase tracking-wider text-base-content-muted">{{ node().title?.text ?? 'Stat' }}</h3>
        <button #expandButton type="button" class="btn btn-ghost btn-xs"
          [attr.aria-label]="(viewState().expanded ? 'Collapse ' : 'Expand ') + (node().title?.text ?? 'Stat')"
          [attr.aria-expanded]="!!viewState().expanded" [attr.aria-controls]="detailsId"
          [attr.data-apps-focus-key]="focusKey('expand')" (click)="toggleExpanded()">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path [attr.d]="viewState().expanded ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'" />
          </svg>
        </button>
      </div>
      <p class="text-lg font-semibold tabular-nums text-primary">{{ node().value }} {{ node().unit }}</p>
      @if (node().delta !== undefined) {
        <p class="text-sm text-base-content-muted">Change: {{ (node().delta ?? 0) > 0 ? '+' : '' }}{{ node().delta }}</p>
      }
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
  public readonly node = input.required<StatNode>();
  public readonly surfaceId = input('');
  public readonly viewState = input<SurfaceComponentViewState>({});
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly viewStateChange = output<SurfaceComponentViewState>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly detailsId = `ptah-stat-details-${nextStatInstance++}`;
  private readonly expandButton = viewChild.required<ElementRef<HTMLButtonElement>>('expandButton');

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
