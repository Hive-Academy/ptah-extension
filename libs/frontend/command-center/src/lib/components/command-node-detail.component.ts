import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  formatCost,
  formatDuration,
  formatTokens,
} from '@ptah-extension/chat-ui';
import {
  MonogramTileComponent,
  ProviderMarkComponent,
  PROVIDER_BRAND_SLUGS,
  PROVIDER_MARKS,
} from '@ptah-extension/ui';
import { LucideAngularModule } from 'lucide-angular';
import type { CommandWorkNode } from '../model/command-center.store';
import { relativeTime } from './command-relative-time';
import { stateColor, stateIcon } from './command-state-icon';

export interface CommandPhaseCount {
  readonly done: number;
  readonly total: number;
}
export function phaseCountOf(
  nodes: readonly CommandWorkNode[],
  nodeId: string,
): CommandPhaseCount | null {
  const phases = nodes.filter(
    (node) =>
      node.parentId === nodeId &&
      node.kind === 'phase' &&
      node.label !== 'No phase tracking' &&
      node.label !== 'Phase unavailable',
  );
  return phases.length
    ? {
        done: phases.filter((phase) => phase.state === 'completed').length,
        total: phases.length,
      }
    : null;
}
export interface CommandChildStats {
  readonly messages?: number;
  readonly tokens?: number;
  readonly active?: number;
  readonly costUsd?: number;
  readonly provisional?: boolean;
}

@Component({
  selector: 'ptah-command-node-detail',
  standalone: true,
  imports: [MonogramTileComponent, ProviderMarkComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-w-0 items-start gap-2">
      @if (knownProvider()) {
        <ptah-provider-mark [providerId]="node().providerId ?? ''" size="sm" />
      } @else {
        <ptah-monogram-tile
          [label]="node().providerId || node().label"
          size="sm"
        />
      }
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{{ node().label }}</p>
        @if (taskPreview(); as task) {
          <p
            class="mt-1 line-clamp-2 break-words text-xs text-base-content-muted"
          >
            {{ task }}
          </p>
        }
        <p
          class="mt-1 inline-flex items-center gap-1 text-xs"
          [class]="stateColor(node().state)"
        >
          <lucide-angular
            [img]="stateIcon(node().state)"
            class="h-3 w-3"
            aria-hidden="true"
            [class.animate-spin]="
              (node().state === 'running' || node().state === 'starting') &&
              !reducedMotion()
            "
          />
          {{ node().state }}
        </p>
        @if (runningDuration(); as duration) {
          <p class="text-xs text-base-content-muted">
            Running for {{ duration }}
          </p>
        }
        @if (phaseCount(); as phase) {
          <p class="text-xs text-base-content-muted">
            Phase {{ phase.done }} / {{ phase.total }}
          </p>
        }
        @if (freshness(); as age) {
          <p class="text-xs text-base-content-muted">Updated {{ age }}</p>
        }
        @if (childStats(); as stats) {
          <p class="text-xs text-base-content-muted">
            @if (stats.messages !== undefined) {
              <span>{{ stats.messages }} messages </span>
            }
            @if (stats.tokens !== undefined) {
              <span>
                @if (stats.provisional) {
                  <span class="sr-only">estimated </span>
                }
                {{
                  (stats.provisional ? '~' : '') + formatTokens(stats.tokens)
                }}
                tokens
              </span>
            }
            @if (stats.active !== undefined) {
              <span>{{ stats.active }} active </span>
            }
            @if (stats.costUsd !== undefined) {
              <span>
                @if (stats.provisional) {
                  <span class="sr-only">estimated </span>
                }
                {{
                  (stats.provisional ? '~' : '') + formatCost(stats.costUsd)
                }}</span
              >
            }
          </p>
        }
      </div>
    </div>
  `,
})
export class CommandNodeDetailComponent {
  public readonly node = input.required<CommandWorkNode>();
  public readonly phaseCount = input<CommandPhaseCount | null>(null);
  public readonly childStats = input<CommandChildStats | null>(null);
  public readonly now = input.required<number>();
  public readonly reducedMotion = input(false);
  public readonly stateIcon = stateIcon;
  public readonly stateColor = stateColor;
  public readonly formatCost = formatCost;
  public readonly formatTokens = formatTokens;
  public readonly runningDuration = computed(() => {
    const node = this.node();
    return node.state === 'running' && node.startedAt !== undefined
      ? formatDuration(Math.max(0, this.now() - node.startedAt))
      : null;
  });
  public readonly knownProvider = computed(() => {
    const id = this.node().providerId;
    return (
      id !== null &&
      (Object.hasOwn(PROVIDER_BRAND_SLUGS, id) ||
        Object.hasOwn(PROVIDER_MARKS, id))
    );
  });
  public readonly taskPreview = computed(() => {
    const firstLine = this.node()
      .task?.split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim();
    return firstLine ? firstLine.slice(0, 160) : null;
  });
  public readonly freshness = computed(() =>
    relativeTime(this.node().updatedAt, this.now()),
  );
}
