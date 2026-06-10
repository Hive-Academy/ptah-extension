import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Gamepad2, Hash, Send } from 'lucide-angular';
import type { GatewayPlatformId } from '@ptah-extension/shared';

import type {
  PlatformAdapterState,
  PlatformStatus,
} from '../services/gateway-state.service';

interface PlatformTileSpec {
  readonly id: GatewayPlatformId;
  readonly label: string;
  readonly icon: typeof Gamepad2;
}

const TILES: readonly PlatformTileSpec[] = [
  { id: 'discord', label: 'Discord', icon: Gamepad2 },
  { id: 'slack', label: 'Slack', icon: Hash },
  { id: 'telegram', label: 'Telegram', icon: Send },
];

@Component({
  selector: 'ptah-gateway-platform-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div role="tablist" aria-label="Gateway platforms" class="flex gap-2">
      @for (tile of tiles; track tile.id) {
        <button
          type="button"
          role="tab"
          [id]="'gateway-tab-' + tile.id"
          [attr.aria-selected]="selected() === tile.id"
          [attr.aria-controls]="'gateway-pane-' + tile.id"
          [attr.data-testid]="'gateway-tile-' + tile.id"
          [tabindex]="selected() === tile.id ? 0 : -1"
          (click)="onSelect(tile.id)"
          (keydown)="onKeydown($event, tile.id)"
          class="flex min-w-32 flex-col items-start gap-2 rounded-lg border bg-base-200 p-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
          [class.border-primary]="selected() === tile.id"
          [class.border-base-300]="selected() !== tile.id"
        >
          <span class="flex items-center gap-2">
            <lucide-angular [img]="tile.icon" class="h-4 w-4" />
            <span class="text-sm font-medium">{{ tile.label }}</span>
          </span>
          <span
            class="badge badge-sm"
            [attr.data-testid]="'gateway-tile-status-' + tile.id"
            [class.badge-success]="stateFor(tile.id) === 'running'"
            [class.badge-warning]="stateFor(tile.id) === 'starting'"
            [class.badge-error]="stateFor(tile.id) === 'error'"
            [class.badge-ghost]="stateFor(tile.id) === 'stopped'"
          >
            {{ stateFor(tile.id) }}
          </span>
        </button>
      }
    </div>
  `,
})
export class GatewayPlatformTabsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  public readonly platforms =
    input.required<Readonly<Record<GatewayPlatformId, PlatformStatus>>>();
  public readonly selected = input.required<GatewayPlatformId>();
  public readonly selectedChange = output<GatewayPlatformId>();

  protected readonly tiles = TILES;

  protected stateFor(platform: GatewayPlatformId): PlatformAdapterState {
    return this.platforms()[platform]?.state ?? 'stopped';
  }

  protected onSelect(platform: GatewayPlatformId): void {
    this.selectedChange.emit(platform);
  }

  protected onKeydown(event: KeyboardEvent, current: GatewayPlatformId): void {
    const order = this.tiles.map((tile) => tile.id);
    const index = order.indexOf(current);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % order.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + order.length) % order.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.selectedChange.emit(current);
        return;
      default:
        return;
    }
    event.preventDefault();
    const target = order[next];
    this.selectedChange.emit(target);
    this.focusTab(target);
  }

  private focusTab(platform: GatewayPlatformId): void {
    const button = this.host.nativeElement.querySelector<HTMLButtonElement>(
      `#gateway-tab-${platform}`,
    );
    button?.focus();
  }
}
