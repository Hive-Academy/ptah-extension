import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  MonogramTileComponent,
  ProviderMarkComponent,
  PROVIDER_BRAND_SLUGS,
  PROVIDER_MARKS,
} from '@ptah-extension/ui';
import { LucideAngularModule } from 'lucide-angular';
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
      class="flex min-h-0 flex-col rounded-xl border border-base-300 bg-base-200 p-3"
      aria-label="Delegated work"
    >
      <h2 class="mb-2 font-semibold">
        Delegated work · {{ delegatedNodes().length }}
      </h2>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {{ announcement() }}
      </p>
      <ul class="max-h-full overflow-y-auto" aria-label="Delegated work items">
        @for (node of delegatedNodes(); track node.id; let index = $index) {
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
              (click)="select(node, index)"
              (keydown)="onKeydown($event, index, node)"
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
export class CommandWorkListComponent {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  public readonly projection = input.required<ProjectionResult>();
  public readonly delegatedNodes = computed(() =>
    this.projection().nodes.filter((node) => node.kind !== 'root'),
  );
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
  public readonly activeIndex = signal(0);
  /** Page focus requests use projection indices, including the root. */
  public focusRow(index: number): void {
    const id = this.projection().nodes[index]?.id;
    const rowIndex = this.delegatedNodes().findIndex((node) => node.id === id);
    if (rowIndex < 0) return;
    this.activeIndex.set(rowIndex);
    const rows =
      this.element.nativeElement.querySelectorAll<HTMLButtonElement>(
        'ul button',
      );
    rows[rowIndex]?.focus();
  }
  public readonly clampedActiveIndex = computed(() => {
    const count = this.delegatedNodes().length;
    return count ? Math.min(Math.max(this.activeIndex(), 0), count - 1) : -1;
  });
  private previousStates = new Map<string, string>();

  public constructor() {
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

  public select(node: CommandWorkNode, index: number): void {
    this.activeIndex.set(index);
    this.selection.emit(node.id);
  }

  public onKeydown(
    event: KeyboardEvent,
    index: number,
    node: CommandWorkNode,
  ): void {
    const count = this.delegatedNodes().length;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.select(node, index);
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
    this.activeIndex.set(next);
    const list = (event.currentTarget as HTMLElement).closest('ul');
    list?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
}
