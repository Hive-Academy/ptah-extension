import {
  afterEveryRender,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import {
  MonogramTileComponent,
  ProviderMarkComponent,
  PROVIDER_BRAND_SLUGS,
  PROVIDER_MARKS,
} from '@ptah-extension/ui';
import { GitBranch, LucideAngularModule } from 'lucide-angular';
import type { CommandWorkNode } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';
import { relativeTime } from './command-relative-time';
import { stateBorder, stateColor, stateIcon } from './command-state-icon';

@Component({
  selector: 'ptah-command-work-list',
  standalone: true,
  imports: [ProviderMarkComponent, MonogramTileComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex min-h-0 flex-1 flex-col rounded-xl border border-base-300 bg-base-200 p-3"
      aria-label="Delegated work"
    >
      <h2 class="mb-2 font-semibold">
        Delegated work · {{ delegatedNodes().length }}
      </h2>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {{ announcement() }}
      </p>
      <div class="relative min-h-0 flex-1">
      <ul class="h-full overflow-y-auto" aria-label="Delegated work items" (scroll)="updateScrollPosition()">
        @for (row of rows(); track row.node.id; let index = $index) {
          @let node = row.node;
          <li>
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg border border-transparent border-l-4 px-2 py-2 text-left hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [class]="stateBorder(node.state)"
              [class.border-warning]="selectedId() === node.id"
              [class.ring-2]="selectedId() === node.id"
              [class.ring-warning]="selectedId() === node.id"
              [class.outline]="selectedId() === node.id"
              [class.outline-2]="selectedId() === node.id"
              [class.outline-warning]="selectedId() === node.id"
              [attr.aria-current]="selectedId() === node.id ? 'true' : null"
              [attr.tabindex]="index === clampedActiveIndex() ? 0 : -1"
              [style.padding-inline-start.px]="8 + row.depth * 16"
              (click)="select(node)"
              (keydown)="onKeydown($event, node)"
            >
              @if (knownProvider(node.providerId)) {
                <ptah-provider-mark
                  [providerId]="node.providerId ?? ''"
                  size="sm"
                />
              } @else {
                <ptah-monogram-tile
                  [label]="node.providerId || node.label"
                  size="sm"
                />
              }
              @if (node.kind === 'child') {
                <lucide-angular [img]="GitBranch" class="h-3.5 w-3.5 shrink-0 text-base-content" aria-hidden="true" data-test="child-kind-icon" />
              }
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{{
                  node.label
                }}</span>
                <span class="block text-xs text-base-content-muted">
                  @if (providerName(node.providerId); as provider) {
                    {{ provider }} ·
                  }
                  <span
                    class="inline-flex items-center gap-1"
                    [class]="stateColor(node.state)"
                  >
                    <lucide-angular
                      [img]="stateIcon(node.state)"
                      class="h-3 w-3"
                      aria-hidden="true"
                      data-test="work-state-icon"
                      [class.animate-spin]="
                        (node.state === 'running' ||
                          node.state === 'starting') &&
                        !reducedMotion()
                      "
                    />
                    {{ node.state }}
                  </span>
                </span>
                @if (freshness(node.updatedAt); as age) {
                  <span class="block text-xs text-base-content-muted"
                    >Updated {{ age }}</span
                  >
                }
              </span>
            </button>
          </li>
        } @empty {
          <li class="p-3 text-sm">
            No delegated work yet. Try “Ptah, review the release plan” or “run a
            Crucible on this change.”
          </li>
        }
      </ul>
      @if (isClipped() && !atEnd()) {
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-base-200 to-transparent" aria-hidden="true" data-test="work-list-fade"></div>
        <span class="pointer-events-none absolute bottom-0 right-2 rounded bg-base-200 px-1 font-mono text-[10px] text-base-content-muted" aria-hidden="true" data-test="work-list-scroll-cue">Scroll list ↓</span>
      }
      </div>
      @if (overflowCompleted() || overflowOther()) {
        <p class="mt-2 text-xs text-base-content-muted">
          Off canvas:
          @if (overflowCompleted()) {
            {{ overflowCompleted() }} completed
          }
          @if (overflowCompleted() && overflowOther()) {
            ·
          }
          @if (overflowOther()) {
            {{ overflowOther() }} other
          }
        </p>
      }
    </section>
  `,
})
export class CommandWorkListComponent implements AfterViewInit, OnDestroy {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  public readonly projection = input.required<ProjectionResult>();
  public readonly GitBranch = GitBranch;
  public readonly rows = computed(() => {
    const nodes = this.projection().nodes.filter((node) => node.kind !== 'root');
    const byParent = new Map<string, CommandWorkNode[]>();
    const ids = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      const parent = node.parentId && ids.has(node.parentId) ? node.parentId : '';
      const siblings = byParent.get(parent) ?? [];
      siblings.push(node);
      byParent.set(parent, siblings);
    }
    const rows: { node: CommandWorkNode; depth: number }[] = [];
    const visited = new Set<string>();
    const visit = (node: CommandWorkNode, depth: number): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      rows.push({ node, depth: Math.min(depth, 3) });
      for (const child of byParent.get(node.id) ?? []) visit(child, depth + 1);
    };
    for (const node of byParent.get('') ?? []) visit(node, 0);
    for (const node of nodes) visit(node, 0);
    return rows;
  });
  public readonly delegatedNodes = computed(() => this.rows().map((row) => row.node));
  public readonly isClipped = signal(false);
  public readonly atEnd = signal(false);
  private scrollObserver: ResizeObserver | null = null;
  private lastClippingRows: ReturnType<CommandWorkListComponent['rows']> | null = null;
  public readonly selectedId = input<string | null>(null);
  public readonly reducedMotion = input(false);
  public readonly now = input.required<number>();
  public readonly overflowCompleted = input(0);
  public readonly overflowOther = input(0);
  public readonly stateIcon = stateIcon;
  public readonly stateColor = stateColor;
  public readonly stateBorder = stateBorder;
  public freshness(timestamp: number | undefined): string | null {
    return relativeTime(timestamp, this.now());
  }
  public readonly selection = output<string>();
  public readonly announcement = signal('');
  public readonly activeId = signal<string | null>(null);
  /** Page focus requests use projection indices, including the root. */
  public focusRow(index: number): void {
    const id = this.projection().nodes[index]?.id;
    const rowIndex = this.delegatedNodes().findIndex((node) => node.id === id);
    if (rowIndex < 0) return;
    this.activeId.set(id ?? null);
    const rows =
      this.element.nativeElement.querySelectorAll<HTMLButtonElement>(
        'ul button',
      );
    rows[rowIndex]?.focus();
  }
  public readonly clampedActiveIndex = computed(() => {
    const rows = this.rows();
    if (!rows.length) return -1;
    const index = rows.findIndex((row) => row.node.id === this.activeId());
    return index < 0 ? 0 : index;
  });
  private previousStates = new Map<string, string>();

  public ngAfterViewInit(): void {
    const list = this.element.nativeElement.querySelector('ul');
    if (!list || typeof ResizeObserver === 'undefined') return;
    this.scrollObserver = new ResizeObserver(() => this.updateClipping());
    this.scrollObserver.observe(list);
  }

  public ngOnDestroy(): void {
    this.scrollObserver?.disconnect();
  }

  public updateClipping(): void {
    const list = this.element.nativeElement.querySelector('ul');
    if (!list) return;
    this.isClipped.set(list.scrollHeight > list.clientHeight);
    this.atEnd.set(list.scrollTop + list.clientHeight >= list.scrollHeight - 1);
  }

  public updateScrollPosition(): void {
    const list = this.element.nativeElement.querySelector('ul');
    if (!list) return;
    this.atEnd.set(list.scrollTop + list.clientHeight >= list.scrollHeight - 1);
  }

  public constructor() {
    afterEveryRender(() => {
      const rows = this.rows();
      if (rows === this.lastClippingRows) return;
      this.lastClippingRows = rows;
      this.updateClipping();
    });
    effect(() => {
      const nodes = this.delegatedNodes();
      const changed = nodes.filter(
        (node) =>
          this.previousStates.has(node.id) &&
          this.previousStates.get(node.id) !== node.state,
      );
      if (changed.length)
        this.announcement.set(
          changed.map((node) => `${node.label}: ${node.state}`).join('; '),
        );
      this.previousStates = new Map(nodes.map((node) => [node.id, node.state]));
    });
  }

  public knownProvider(id: string | null): boolean {
    return (
      id !== null &&
      (Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ||
        Object.hasOwn(PROVIDER_MARKS, id))
    );
  }

  public providerName(id: string | null): string | null {
    if (!id || id.toLowerCase() === 'unknown') return null;
    return id
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  public select(node: CommandWorkNode): void {
    this.activeId.set(node.id);
    this.selection.emit(node.id);
  }

  public onKeydown(
    event: KeyboardEvent,
    node: CommandWorkNode,
  ): void {
    const count = this.delegatedNodes().length;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.select(node);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (!count) return;
    const next =
      (this.clampedActiveIndex() +
        (event.key === 'ArrowDown' ? 1 : -1) +
        count) %
      count;
    this.activeId.set(this.rows()[next].node.id);
    const list = (event.currentTarget as HTMLElement).closest('ul');
    list?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
}
