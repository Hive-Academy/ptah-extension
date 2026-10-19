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
    <div class="min-w-0">
      <h2
        class="break-words font-display text-2xl font-medium leading-tight text-base-content"
      >
        {{ node().label }}
      </h2>
      @if (subtitle(); as description) {
        <p class="mt-1 text-xs leading-4 text-base-content-muted">
          {{ description }}
        </p>
      }
      <span
        class="mt-3 inline-flex items-center gap-2 rounded-md border border-base-300 bg-base-100 px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-widest text-base-content"
      >
        <lucide-angular
          [img]="stateIcon(node().state)"
          class="h-3 w-3"
          [class]="stateColor(node().state)"
          aria-hidden="true"
          [class.animate-spin]="
            (node().state === 'running' || node().state === 'starting') &&
            !reducedMotion()
          "
        />
        {{ node().state }}
      </span>
      <div
        class="mt-3 space-y-1 break-words font-mono text-[11px] leading-[1.6] text-base-content-muted"
      >
        @if (visibleProvider(); as provider) {
          <p class="flex items-center gap-1.5">
            @if (knownProvider()) {
              <ptah-provider-mark
                [providerId]="provider"
                size="sm"
                aria-hidden="true"
              />
            } @else {
              <ptah-monogram-tile [label]="provider" size="sm" />
            }
            <span
              >Provider:
              <span class="text-base-content">{{ providerName() }}</span></span
            >
          </p>
        }
        @if (taskPreview(); as task) {
          <p class="line-clamp-2">Task: {{ task }}</p>
        }
        @if (runningDuration(); as duration) {
          <p>Running for {{ duration }}</p>
        }
        @if (phaseCount(); as phase) {
          <p>Phase {{ phase.done }} / {{ phase.total }}</p>
        }
        @if (freshness(); as age) {
          <p>Updated {{ age }}</p>
        }
        @if (childStats(); as stats) {
          @if (
            stats.messages !== undefined ||
            stats.tokens !== undefined ||
            stats.active !== undefined ||
            stats.costUsd !== undefined
          ) {
            <p class="flex flex-wrap gap-x-2 gap-y-0.5">
              @if (stats.messages !== undefined) {
                <span>{{ stats.messages }} messages</span>
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
                <span>{{ stats.active }} active</span>
              }
              @if (stats.costUsd !== undefined) {
                <span>
                  @if (stats.provisional) {
                    <span class="sr-only">estimated </span>
                  }
                  {{
                    (stats.provisional ? '~' : '') + formatCost(stats.costUsd)
                  }}
                </span>
              }
            </p>
          }
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
  public readonly visibleProvider = computed(() => {
    const id = this.node().providerId;
    return id && id.toLowerCase() !== 'unknown' ? id : null;
  });
  public readonly providerName = computed(() => {
    const id = this.node().providerId;
    return id && this.knownProvider()
      ? id
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (letter) => letter.toUpperCase())
      : id;
  });
  public readonly subtitle = computed(() => {
    switch (this.node().kind) {
      case 'root':
        return null;
      case 'child':
        return 'Ptah agent child session';
      case 'tribunal':
        return 'Tribunal group';
      case 'phase':
        return 'Work phase';
      default:
        return 'Delegated engineering work';
    }
  });
  public readonly taskPreview = computed(() => {
    const firstLine = this.node()
      .task?.split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim();
    return firstLine && firstLine !== this.subtitle()
      ? firstLine.slice(0, 160)
      : null;
  });
  public readonly freshness = computed(() =>
    relativeTime(this.node().updatedAt, this.now()),
  );
}
