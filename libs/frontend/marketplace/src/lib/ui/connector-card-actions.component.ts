import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { KeyRound, LucideAngularModule, Plug, Unplug } from 'lucide-angular';

import type {
  ConnectorCardAction,
  ConnectorCardState,
} from './connector-card-state';

/**
 * The `[card-actions]` content of a connector: Disconnect, Authorize and
 * Connect ("Set up" for an `oauth-app` connector, whose Connect opens the
 * setup form). Every button is disabled while an action runs, and a locked
 * card never emits. Render it only when `card.hasActions`.
 */
@Component({
  selector: 'ptah-connector-card-actions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-wrap items-center gap-2',
    '[class.justify-end]': "align() === 'end'",
    'data-testid': 'connector-card-actions',
  },
  template: `
    @if (card().canDisconnect) {
      <button
        type="button"
        [class]="buttonClass('btn-ghost text-error')"
        [disabled]="card().locked"
        [attr.aria-label]="'Disconnect ' + card().connector.label"
        data-action="disconnect"
        (click)="emit('disconnect')"
      >
        <span class="inline-flex" [class]="iconClass()" aria-hidden="true">
          <lucide-angular [img]="DisconnectIcon" class="h-full w-full" />
        </span>

        Disconnect
      </button>
    }
    @if (card().canAuthorize) {
      <button
        type="button"
        [class]="buttonClass('btn-primary')"
        [disabled]="card().locked"
        [attr.aria-label]="'Authorize ' + card().connector.label"
        data-action="authorize"
        (click)="emit('authorize')"
      >
        <span class="inline-flex" [class]="iconClass()" aria-hidden="true">
          <lucide-angular [img]="AuthorizeIcon" class="h-full w-full" />
        </span>

        Authorize
      </button>
    }
    @if (card().canConnect) {
      <button
        type="button"
        [class]="buttonClass('btn-primary')"
        [disabled]="card().locked"
        [attr.aria-label]="connectLabel() + ' ' + card().connector.label"
        data-action="connect"
        (click)="emit('connect')"
      >
        <span class="inline-flex" [class]="iconClass()" aria-hidden="true">
          <lucide-angular [img]="ConnectIcon" class="h-full w-full" />
        </span>

        {{ connectLabel() }}
      </button>
    }
  `,
})
export class ConnectorCardActionsComponent {
  protected readonly ConnectIcon = Plug;
  protected readonly AuthorizeIcon = KeyRound;
  protected readonly DisconnectIcon = Unplug;

  public readonly card = input.required<ConnectorCardState>();

  /** `xs` on cards, `sm` in the detail. @default 'xs' */
  public readonly size = input<'xs' | 'sm'>('xs');

  /** `end` in a card footer, `start` in the detail. @default 'end' */
  public readonly align = input<'start' | 'end'>('end');

  /** An action button was pressed on an unlocked card. */
  public readonly action = output<ConnectorCardAction>();

  protected buttonClass(tone: string): string {
    return `btn ${this.size() === 'sm' ? 'btn-sm' : 'btn-xs'} gap-1 ${tone}`;
  }

  protected iconClass(): string {
    return this.size() === 'sm' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  }

  protected connectLabel(): string {
    return this.card().connector.kind === 'oauth-app' ? 'Set up' : 'Connect';
  }

  protected emit(action: ConnectorCardAction): void {
    if (this.card().locked) return;
    this.action.emit(action);
  }
}
