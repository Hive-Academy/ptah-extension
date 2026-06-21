import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import type { TribunalTile } from './types/tribunal-ui.types';

export type TribunalTileStatus = 'idle' | 'running' | 'completed' | 'failed';

@Component({
  selector: 'ptah-tribunal-tile-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="tribunal-tile flex h-full flex-col overflow-hidden rounded-lg border bg-base-100 transition-shadow"
      [class.border-primary]="focused()"
      [class.ring-2]="focused()"
      [class.ring-primary]="focused()"
      [class.border-base-300]="!focused()"
    >
      <header
        class="tile-header flex cursor-pointer items-center gap-2 border-b border-base-300 bg-base-300 px-3 py-2"
        (click)="focusRequested.emit()"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          [class.bg-base-content]="status() === 'idle'"
          [class.opacity-40]="status() === 'idle'"
          [class.bg-info]="status() === 'running'"
          [class.animate-pulse]="status() === 'running'"
          [class.bg-success]="status() === 'completed'"
          [class.bg-error]="status() === 'failed'"
          [attr.aria-hidden]="true"
        ></span>
        <span class="flex min-w-0 flex-col leading-tight">
          <span class="truncate text-xs font-semibold text-base-content">
            {{ label() }}
          </span>
          @if (model()) {
            <span
              class="truncate font-mono text-[10px] text-base-content/50"
              data-testid="tribunal-tile-model"
            >
              {{ model() }}
            </span>
          }
        </span>
        <span
          class="ml-auto text-[10px] uppercase tracking-wide text-base-content/50"
        >
          {{ statusLabel() }}
        </span>
        @if (closable()) {
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            [attr.aria-label]="'Close ' + label()"
            (click)="closeRequested.emit()"
          >
            <lucide-angular [img]="CloseIcon" class="h-3 w-3" />
          </button>
        }
      </header>
      <div class="min-h-0 flex-1 overflow-auto">
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class TribunalTileHostComponent {
  readonly tile = input.required<TribunalTile>();
  readonly focused = input<boolean>(false);
  readonly label = input<string>('');
  readonly model = input<string>('');
  readonly status = input<TribunalTileStatus>('idle');
  readonly closable = input<boolean>(false);

  readonly focusRequested = output<void>();
  readonly closeRequested = output<void>();

  protected readonly CloseIcon = X;

  protected readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'running':
        return 'Running';
      case 'completed':
        return 'Done';
      case 'failed':
        return 'Failed';
      default:
        return 'Idle';
    }
  });
}
