import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild, type InputSignal } from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceComponentViewState } from '../surface-view-state';
import type { DisplayNode } from '../view-model/view-model.types';
import { DashboardSparklineComponent } from './dashboard-sparkline.component';

export type StatNode = Extract<DisplayNode, { kind: 'stat' }>;
let nextStatInstance = 0;

/**
 * Trend pill (design section 3): `good` reads as success, `bad` as error, no
 * polarity as neutral. Colours are the renderer's display tokens (D17), with
 * theme fallbacks outside a renderer root.
 */
const TREND_STYLES = `
  .dp-trend {
    display: inline-flex; align-items: center; gap: 3px; max-width: 100%;
    border-radius: 999px; padding: 1px 8px; font-size: 12px; font-weight: 600; line-height: 18px;
    font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
    background: var(--dp-trend-tint); color: var(--dp-trend-text);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--dp-trend-text) 22%, transparent);
  }
  .dp-trend--good { --dp-trend-tint: var(--dp-su-tint, oklch(var(--b3))); --dp-trend-text: var(--dp-su-text, oklch(var(--su))); }
  .dp-trend--bad { --dp-trend-tint: var(--dp-er-tint, oklch(var(--b3))); --dp-trend-text: var(--dp-er-text, oklch(var(--er))); }
  .dp-trend--neutral { --dp-trend-tint: var(--dp-n-tint, oklch(var(--b3))); --dp-trend-text: var(--dp-fg, oklch(var(--bc))); }
  .dp-trend-arrow { flex: none; }
`;

/** Literal class strings, never concatenated. */
const TREND_TONE_CLASSES = {
  good: 'dp-trend dp-trend--good',
  bad: 'dp-trend dp-trend--bad',
  neutral: 'dp-trend dp-trend--neutral',
} as const;
const TREND_ARROWS = { up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6' } as const;

@Component({
  selector: 'ptah-dashboard-stat',
  standalone: true,
  imports: [DashboardSparklineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [TREND_STYLES],
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
      @if (trend(); as trend) {
        <!-- Direction is the arrow plus the words "up"/"down", never colour alone (R4.3). -->
        <p class="mt-1 min-w-0"><span [class]="trend.classes" data-testid="stat-trend"><svg class="dp-trend-arrow" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="trend.arrow" /></svg><span class="sr-only">Trend </span><span>{{ trend.text }}</span>@if (trend.polarity) {<span class="sr-only">, {{ trend.polarity }}</span>}</span></p>
      }
      @if (node().spark; as spark) {
        <ptah-dashboard-sparkline class="mt-1" [points]="spark" [subject]="node().title?.text ?? 'Stat'"
          [failing]="node().trend?.polarity === 'bad'" />
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

  /** The `/4` trend pill: visible "up 4.2%" / "down 3", tone from polarity. */
  public readonly trend = computed(() => {
    const trend = this.node().trend;
    if (!trend) return null;
    return {
      classes: TREND_TONE_CLASSES[trend.polarity ?? 'neutral'],
      arrow: TREND_ARROWS[trend.direction],
      text: `${trend.direction} ${trend.amount}${trend.percent ? '%' : ''}`,
      polarity: trend.polarity ?? null,
    };
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
