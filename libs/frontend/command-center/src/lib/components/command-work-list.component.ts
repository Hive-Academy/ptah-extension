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
} from '@ptah-extension/ui';
import type { CommandWorkNode } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';

@Component({
  selector: 'ptah-command-work-list',
  standalone: true,
  imports: [ProviderMarkComponent, MonogramTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex min-h-0 flex-col rounded-xl border border-base-300 bg-base-200 p-3"
      aria-label="Delegated work"
    >
      <h2 class="mb-2 font-semibold">
        Delegated work · {{ projection().nodes.length }}
      </h2>
      <p class="sr-only" aria-live="polite" aria-atomic="true">
        {{ announcement() }}
      </p>
      <ul class="max-h-full overflow-y-auto" aria-label="All session work">
        @for (node of projection().nodes; track node.id; let index = $index) {
          <li>
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning"
              [class.border-warning]="selectedId() === node.id"
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
                <span class="block text-xs text-base-content-muted"
                  >Provider: {{ node.providerId || 'Unknown' }} · Parent:
                  {{ parentLabel(node) }} · State: {{ node.state }}</span
                >
              </span>
            </button>
          </li>
        } @empty {
          <li class="p-3 text-sm">No work in this session yet.</li>
        }
      </ul>
    </section>
  `,
})
export class CommandWorkListComponent {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  public readonly projection = input.required<ProjectionResult>();
  public readonly selectedId = input<string | null>(null);
  public readonly selection = output<string>();
  public readonly announcement = signal('');
  public readonly activeIndex = signal(0);
  public focusRow(index: number): void {
    if (index < 0 || index >= this.projection().nodes.length) return;
    this.activeIndex.set(index);
    const rows =
      this.element.nativeElement.querySelectorAll<HTMLButtonElement>(
        'ul button',
      );
    rows[index]?.focus();
  }
  public readonly clampedActiveIndex = computed(() => {
    const count = this.projection().nodes.length;
    return count ? Math.min(Math.max(this.activeIndex(), 0), count - 1) : -1;
  });
  private readonly byId = computed(
    () => new Map(this.projection().nodes.map((node) => [node.id, node])),
  );
  private previousStates = new Map<string, string>();

  public constructor() {
    effect(() => {
      const nodes = this.projection().nodes;
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
    return id !== null && Object.hasOwn(PROVIDER_BRAND_SLUGS, id);
  }

  public parentLabel(node: CommandWorkNode): string {
    if (!node.parentId) return 'Root';
    return this.byId().get(node.parentId)?.label ?? node.parentId;
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
    const count = this.projection().nodes.length;
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
