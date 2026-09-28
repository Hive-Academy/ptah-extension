import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Receives the clamped metadata returned by pageSlice. */
export interface DashboardPagination {
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
}

@Component({
  selector: 'ptah-dashboard-pager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-2 text-base-content-muted">
      <span role="status">Page {{ pagination().page + 1 }} of {{ pagination().pageCount }}</span>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost btn-xs" [disabled]="pagination().page === 0"
          [attr.data-apps-focus-key]="focusKey('previous')" (click)="move(-1)">Previous</button>
        <button type="button" class="btn btn-ghost btn-xs" [disabled]="pagination().page + 1 >= pagination().pageCount"
          [attr.data-apps-focus-key]="focusKey('next')" (click)="move(1)">Next</button>
      </div>
    </div>
  `,
})
export class DashboardPagerComponent {
  public readonly pagination = input.required<DashboardPagination>();
  public readonly surfaceId = input('');
  public readonly componentId = input.required<string>();
  public readonly pageChange = output<number>();

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.componentId()}:${control}`; }
  public move(delta: number): void {
    const { page, pageCount } = this.pagination();
    const next = Math.min(pageCount - 1, Math.max(0, page + delta));
    if (next !== page) this.pageChange.emit(next);
  }
}
