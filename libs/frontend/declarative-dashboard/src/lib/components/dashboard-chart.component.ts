import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild } from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { chartGeometry, type ChartPoint } from '../charts/chart-geometry';
import type { SurfaceComponentViewState } from '../surface-view-state';
import { pageSlice } from '../table/table-rows';
import type { DisplayNode } from '../view-model/view-model.types';

export type ChartNode = Extract<DisplayNode, { kind: 'line-chart' | 'bar-chart' }>;

let nextChartInstance = 0;
const SERIES_STROKES = ['stroke-primary', 'stroke-secondary', 'stroke-accent', 'stroke-info'] as const;
const SERIES_FILLS = ['fill-primary', 'fill-secondary', 'fill-accent', 'fill-info'] as const;

@Component({
  selector: 'ptah-dashboard-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-bordered bg-base-100 p-4 text-base-content" (keydown.escape)="collapse($event)">
      <h3 class="font-semibold">{{ node().title?.text ?? 'Chart' }}</h3>
      @if (node().description; as description) { <p>{{ description.text }}</p> }
      @if (node().data; as data) {
        <p role="status">Data is not available in this view.@if (data.rowCount !== undefined) { {{ data.rowCount }} rows. }</p>
      } @else {
        <div class="flex flex-wrap items-center gap-1">
          <button type="button" class="btn btn-ghost btn-sm" [attr.aria-pressed]="!!viewState().chartAsTable"
            [attr.data-apps-focus-key]="focusKey('table')" (click)="toggleTable()">
            {{ viewState().chartAsTable ? 'Show as chart' : 'Show as table' }}
          </button>
          <!-- Client-only presentation toggle: it writes view state and never reaches the host. -->
          <button #expandButton type="button" class="btn btn-ghost btn-sm"
            [attr.aria-label]="(viewState().expanded ? 'Collapse ' : 'Expand ') + (node().title?.text ?? 'Chart')"
            [attr.aria-expanded]="!!viewState().expanded" [attr.aria-controls]="contentId"
            [attr.data-apps-focus-key]="focusKey('expand')" (click)="toggleExpanded()">
            {{ viewState().expanded ? 'Collapse' : 'Expand' }}
          </button>
        </div>
        <div [id]="contentId" class="flex flex-col gap-2">
        @if (viewState().chartAsTable) {
          <div class="overflow-auto" [class.max-h-96]="!viewState().expanded">
            <table class="table table-sm">
              <caption>{{ node().title?.text ?? 'Chart data' }}</caption>
              <thead><tr><th scope="col">Series</th><th scope="col">{{ node().xLabel?.text ?? 'X' }}</th>
                <th scope="col">{{ node().yLabel?.text ?? 'Y' }}</th>
                @if (node().selectable) { <th scope="col">Selection</th> }
              </tr></thead>
              <tbody>
                @for (point of page().items; track point.seriesIndex + ':' + point.pointIndex) {
                  <tr><th scope="row">{{ point.name }}</th><td>{{ point.x }}</td><td>{{ point.y }}</td>
                    @if (node().selectable) {
                      <td><button type="button" class="btn btn-ghost btn-xs"
                        [attr.aria-label]="'Select ' + point.name + ', ' + point.x + ', ' + point.y"
                        [attr.aria-pressed]="isSelected(point)"
                        [attr.data-apps-focus-key]="focusKey('point-' + point.seriesIndex + '-' + point.pointIndex)"
                        (click)="selectPoint(point)">Select</button></td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p role="status">{{ page().total }} points. Page {{ page().page + 1 }} of {{ page().pageCount }}</p>
          @if (page().pageCount > 1) {
            <div class="flex gap-2">
              <button type="button" class="btn btn-sm" [disabled]="page().page === 0"
                [attr.data-apps-focus-key]="focusKey('previous')" (click)="setPage(page().page - 1)">Previous</button>
              <button type="button" class="btn btn-sm" [disabled]="page().page + 1 === page().pageCount"
                [attr.data-apps-focus-key]="focusKey('next')" (click)="setPage(page().page + 1)">Next</button>
            </div>
          }
        } @else {
          <svg viewBox="0 0 600 280" role="img" [attr.aria-label]="node().title?.text ?? 'Chart'" class="w-full"
            [class.max-h-64]="!viewState().expanded">
            <svg:title>{{ node().title?.text ?? 'Chart' }}</svg:title>
            <svg:desc>Use Show as table to read every point{{ node().selectable ? ' and select a point' : '' }}.</svg:desc>
            @if (node().kind === 'bar-chart') {
              <defs>
                @for (series of geometry().series; track $index) {
                  @if ($index > 0) {
                    <pattern [attr.id]="patternId($index)" width="6" height="6"
                      patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <line x1="0" y1="0" x2="0" y2="6" stroke-width="2" [attr.class]="seriesStroke($index)" />
                    </pattern>
                  }
                }
              </defs>
            }
            <line x1="60" y1="40" x2="60" y2="220" stroke="currentColor" />
            <line x1="60" x2="540" [attr.y1]="geometry().baseline" [attr.y2]="geometry().baseline" stroke="currentColor" />
            <text x="4" y="40" fill="currentColor" class="text-base-content-muted">{{ geometry().maxY }}</text>
            <text x="4" y="220" fill="currentColor" class="text-base-content-muted">{{ geometry().minY }}</text>
            <text x="60" y="240" fill="currentColor" class="text-base-content-muted">{{ geometry().firstX }}</text>
            <text x="540" y="240" text-anchor="end" fill="currentColor" class="text-base-content-muted">{{ geometry().lastX }}</text>
            <text x="300" y="270" text-anchor="middle" fill="currentColor" class="text-base-content-muted">{{ node().xLabel?.text }}</text>
            <text x="60" y="20" fill="currentColor" class="text-base-content-muted">{{ node().yLabel?.text }}</text>
            @for (series of geometry().series; track $index) {
              @if (node().kind === 'line-chart') {
                <polyline [attr.points]="series.polyline" fill="none" [attr.class]="seriesStroke($index)" stroke-width="2"
                  [attr.stroke-dasharray]="series.dash"><svg:title>{{ series.name }}</svg:title></polyline>
              } @else {
                @let seriesIndex = $index;
                @for (point of series.points; track point.pointIndex) {
                  <rect [attr.x]="point.barX" [attr.y]="point.barY" [attr.width]="point.barWidth"
                    [attr.height]="point.barHeight" [attr.class]="barClass(seriesIndex)"
                    [attr.fill]="barFill(seriesIndex)" stroke-width="2"
                    [attr.stroke-dasharray]="series.dash"><svg:title>{{ series.name }}: {{ point.x }}, {{ point.y }}</svg:title></rect>
                }
              }
            }
          </svg>
          <ul class="flex flex-wrap gap-4" aria-label="Series">
            @for (series of geometry().series; track $index) {
              <li class="flex items-center gap-2">
                <svg width="36" height="12" aria-hidden="true">
                  @if (node().kind === 'line-chart') {
                    <line x1="0" y1="6" x2="36" y2="6" [attr.class]="seriesStroke($index)"
                      stroke-width="2" [attr.stroke-dasharray]="series.dash" />
                  } @else {
                    <rect x="1" y="1" width="34" height="10" [attr.class]="barClass($index)"
                      [attr.fill]="barFill($index)" stroke-width="2" [attr.stroke-dasharray]="series.dash" />
                  }
                </svg>
                {{ series.name }}
              </li>
            }
          </ul>
        }
        </div>
      }
    </section>
  `,
})
export class DashboardChartComponent {
  private readonly instanceId = nextChartInstance++;
  public readonly node = input.required<ChartNode>();
  public readonly surfaceId = input('');
  public readonly viewState = input<SurfaceComponentViewState>({});
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly viewStateChange = output<SurfaceComponentViewState>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly geometry = computed(() => chartGeometry(this.node().series ?? [], this.node().kind));
  public readonly page = computed(() => pageSlice(this.geometry().rows, this.viewState().page));
  public readonly contentId = `ptah-chart-${this.instanceId}-content`;
  private readonly expandButton = viewChild<ElementRef<HTMLButtonElement>>('expandButton');

  public seriesStroke(index: number): string { return SERIES_STROKES[index % SERIES_STROKES.length]; }
  public patternId(index: number): string { return `ptah-chart-${this.instanceId}-hatch-${index}`; }
  public barClass(index: number): string {
    return this.seriesStroke(index) + (index === 0 ? ` ${SERIES_FILLS[index % SERIES_FILLS.length]}` : '');
  }
  public barFill(index: number): string | null { return index === 0 ? null : `url(#${this.patternId(index)})`; }

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public toggleTable(): void {
    this.viewStateChange.emit({ ...this.viewState(), chartAsTable: !this.viewState().chartAsTable });
  }
  public setPage(page: number): void { this.viewStateChange.emit({ ...this.viewState(), page }); }
  public toggleExpanded(): void { this.viewStateChange.emit({ ...this.viewState(), expanded: !this.viewState().expanded }); }
  /** Escape closes an expanded chart and returns focus to the control that opened it. */
  public collapse(event: Event): void {
    if (!this.viewState().expanded) return;
    event.stopPropagation();
    this.viewStateChange.emit({ ...this.viewState(), expanded: false });
    this.expandButton()?.nativeElement.focus();
  }
  public isSelected(point: ChartPoint): boolean {
    const selection = this.selection();
    return selection?.componentId === this.node().id && selection.target.kind === 'chart-point'
      && selection.target.seriesIndex === point.seriesIndex && selection.target.pointIndex === point.pointIndex;
  }
  public selectPoint(point: ChartPoint): void {
    if (this.node().selectable) this.selectionChange.emit({ componentId: this.node().id,
      target: { kind: 'chart-point', seriesIndex: point.seriesIndex, pointIndex: point.pointIndex } });
  }
}
