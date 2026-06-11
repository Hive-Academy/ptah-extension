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
          class="flex min-w-36 flex-1 items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 sm:flex-none"
          [class.border-primary/50]="selected() === tile.id"
          [class.bg-base-300/50]="selected() === tile.id"
          [class.border-base-300]="selected() !== tile.id"
          [class.bg-base-200/40]="selected() !== tile.id"
          [class.hover:bg-base-300/30]="selected() !== tile.id"
        >
          <lucide-angular
            [img]="tile.icon"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{{ tile.label }}</span>
            <span
              class="flex items-center gap-1.5 text-xs text-base-content/60"
            >
              <span
                class="inline-block size-1.5 rounded-full"
                [class.bg-success]="stateFor(tile.id) === 'running'"
                [class.bg-warning]="stateFor(tile.id) === 'starting'"
                [class.bg-error]="stateFor(tile.id) === 'error'"
                [class.bg-base-content/30]="stateFor(tile.id) === 'stopped'"
                aria-hidden="true"
              ></span>
              <span [attr.data-testid]="'gateway-tile-status-' + tile.id">{{
                stateFor(tile.id)
              }}</span>
            </span>
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
