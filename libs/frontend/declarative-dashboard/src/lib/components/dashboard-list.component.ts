import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild, type InputSignal } from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SURFACE_PAGE_SIZE, type SurfaceComponentViewState } from '../surface-view-state';
import { pageSlice } from '../table/table-rows';
import type { DisplayNode } from '../view-model/view-model.types';
import { DashboardPagerComponent } from './dashboard-pager.component';

export type ListNode = Extract<DisplayNode, { kind: 'list' }>;
interface ListItem {
  readonly originalIndex: number;
  readonly text?: string;
  readonly detail?: string;
  readonly url?: string;
}
let nextListInstance = 0;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function plainText(value: unknown): string | undefined {
  return record(value) && typeof value['text'] === 'string' ? value['text'] : undefined;
}

@Component({
  selector: 'ptah-dashboard-list',
  standalone: true,
  imports: [NgTemplateOutlet, DashboardPagerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-bordered bg-base-100 p-3 text-base-content" (keydown.escape)="collapse($event)">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ title() }}</h3>
        <button #expandButton type="button" class="btn btn-ghost btn-xs"
          [attr.aria-label]="(viewState().expanded ? 'Collapse ' : 'Expand ') + title()"
          [attr.aria-expanded]="!!viewState().expanded" [attr.aria-controls]="contentId"
          [attr.data-apps-focus-key]="focusKey('expand')" (click)="toggleExpanded()">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
            <path [attr.d]="viewState().expanded ? 'M7 14l5-5 5 5' : 'M7 10l5 5 5-5'" />
          </svg>
        </button>
      </div>
      @if (description(); as description) { <p class="text-sm text-base-content-muted">{{ description }}</p> }
      <div [id]="contentId" class="overflow-auto" [class.max-h-64]="!viewState().expanded">
        @if (node().data; as data) {
          <p role="status">Data is not available in this view.@if (data.rowCount !== undefined) { {{ data.rowCount }} rows. }</p>
        } @else {
          <label [for]="filterId" class="text-sm text-base-content-muted">Filter {{ title() }}</label>
          <input #filterInput [id]="filterId" type="search" class="input input-bordered input-sm w-full"
            [value]="viewState().filter ?? ''" [attr.data-apps-focus-key]="focusKey('filter')"
            (input)="setFilter(filterInput.value)" />
          <p role="status" class="text-sm text-base-content-muted">{{ page().total }} results</p>
          <ng-template #rows>
            @for (item of page().items; track item.originalIndex) {
              <li class="rounded-md px-2 py-1.5">
                @if (item.text !== undefined) { <p class="text-sm font-medium">{{ item.text }}</p> }
                @if (item.detail !== undefined) { <p class="text-xs text-base-content-muted">{{ item.detail }}</p> }
                @if (item.url !== undefined) { <p class="break-all text-xs text-base-content-muted">{{ item.url }}</p> }
                @if (node().selectable) {
                  <button type="button" class="btn btn-ghost btn-xs" [attr.aria-label]="'Select ' + (item.text ?? 'item ' + (item.originalIndex + 1))"
                    [attr.aria-pressed]="isSelected(item.originalIndex)"
                    [attr.data-apps-focus-key]="focusKey('item-' + item.originalIndex)"
                    (click)="selectItem(item.originalIndex)">Select</button>
                }
              </li>
            }
          </ng-template>
          @if (node().ordered) {
            <ol class="list-decimal space-y-1 pl-6" [start]="page().page * pageSize + 1"><ng-container [ngTemplateOutlet]="rows" /></ol>
          } @else {
            <ul class="list-disc space-y-1 pl-6"><ng-container [ngTemplateOutlet]="rows" /></ul>
          }
          <ptah-dashboard-pager [pagination]="page()" [surfaceId]="surfaceId()" [componentId]="node().id"
            (pageChange)="setPage($event)" />
        }
        <ng-content />
      </div>
    </section>
  `,
})
export class DashboardListComponent {
  public readonly node: InputSignal<ListNode> = input.required<ListNode>();
  public readonly surfaceId = input('');
  public readonly viewState = input<SurfaceComponentViewState>({});
  public readonly selection = input<SurfaceSelection | null>(null);
  public readonly viewStateChange = output<SurfaceComponentViewState>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly contentId = `ptah-list-content-${nextListInstance++}`;
  public readonly filterId = `${this.contentId}-filter`;
  public readonly title = computed(() => plainText(this.node().title) ?? 'List');
  public readonly description = computed(() => plainText(this.node().description));
  public readonly items = computed((): readonly ListItem[] => {
    const items: unknown = this.node().items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item: unknown, originalIndex): ListItem[] => {
      if (!record(item)) return [];
      const text = plainText(item['text']);
      const detail = plainText(item['detail']);
      const url = typeof item['url'] === 'string' ? item['url'] : undefined;
      return text === undefined && detail === undefined && url === undefined ? [] : [{ originalIndex, text, detail, url }];
    });
  });
  public readonly page = computed(() => {
    const query = (this.viewState().filter ?? '').toLowerCase();
    return pageSlice(this.items().filter(item => [item.text, item.detail, item.url].filter(text => text !== undefined)
      .join(' ').toLowerCase().includes(query)), this.viewState().page);
  });
  public readonly pageSize = SURFACE_PAGE_SIZE;
  private readonly expandButton = viewChild.required<ElementRef<HTMLButtonElement>>('expandButton');

  public focusKey(control: string): string { return `${this.surfaceId()}:${this.node().id}:${control}`; }
  public setFilter(filter: string): void { this.viewStateChange.emit({ ...this.viewState(), filter, page: 0 }); }
  public setPage(page: number): void { this.viewStateChange.emit({ ...this.viewState(), page }); }
  public toggleExpanded(): void { this.viewStateChange.emit({ ...this.viewState(), expanded: !this.viewState().expanded }); }
  public collapse(event: Event): void {
    if (!this.viewState().expanded) return;
    event.stopPropagation();
    this.viewStateChange.emit({ ...this.viewState(), expanded: false });
    this.expandButton().nativeElement.focus();
  }
  public isSelected(itemIndex: number): boolean {
    const selection = this.selection();
    return selection?.componentId === this.node().id && selection.target.kind === 'list-item' && selection.target.itemIndex === itemIndex;
  }
  public selectItem(itemIndex: number): void {
    if (this.node().selectable && this.items().some(item => item.originalIndex === itemIndex)) {
      this.selectionChange.emit({ componentId: this.node().id, target: { kind: 'list-item', itemIndex } });
    }
  }
}
