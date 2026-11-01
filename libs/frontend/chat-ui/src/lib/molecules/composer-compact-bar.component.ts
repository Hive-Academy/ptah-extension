import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ChevronUp, LucideAngularModule, Square } from 'lucide-angular';
import {
  COMPOSER_CARD_BORDER_CLASS,
  COMPOSER_CARD_CLASS,
} from './composer-card';

/**
 * One-row stand-in for the chat composer while the agent streams: a status
 * line, the model name and Stop, on the composer card's surface so the bar
 * reads as the same object, folded.
 *
 * The status + model region is one button (`aria-expanded="false"`,
 * `aria-controls` = the full composer) that asks the owner to expand. Only the
 * inner row fades; the glass card itself never animates opacity, because an
 * opacity < 1 ancestor breaks its backdrop blur.
 */
@Component({
  selector: 'ptah-composer-compact-bar',
  imports: [LucideAngularModule],
  template: `
    <div
      [class]="cardClass"
      data-glass-surface="tile"
      data-testid="composer-compact-bar"
    >
      <div
        class="ptah-compact-row flex items-center gap-1 h-10 pl-1 pr-1.5 min-w-0"
        [class.is-collapsed]="collapsed()"
      >
        <button
          type="button"
          class="group flex flex-1 items-center gap-2 h-8 min-w-0 px-2.5 rounded-lg text-left text-xs text-base-content hover:bg-surface-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
          aria-expanded="false"
          [attr.aria-controls]="controlsId()"
          title="Expand the composer"
          data-testid="composer-compact-expand"
          (click)="expandRequested.emit()"
        >
          <span class="sr-only">Expand composer.</span>
          <span
            class="ptah-compact-pulse h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 truncate" data-testid="composer-compact-status">{{
            statusLabel()
          }}</span>
          @if (modelLabel()) {
            <span
              class="min-w-0 max-w-[45%] flex-shrink truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 text-base-content-muted"
              data-testid="composer-compact-model"
              >{{ modelLabel() }}</span
            >
          }
          <lucide-angular
            [img]="ChevronUpIcon"
            class="ml-auto w-4 h-4 flex-shrink-0 text-base-content-muted group-hover:text-base-content"
            aria-hidden="true"
          />
        </button>

        @if (showStop()) {
          <button
            type="button"
            class="inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-error/15 text-error hover:bg-error/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
            title="Stop generating"
            aria-label="Stop generating"
            data-testid="chat-stop-btn"
            (click)="stopRequested.emit()"
          >
            <lucide-angular
              [img]="SquareIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .ptah-compact-card {
        max-width: var(--chat-content-max-width, 758px);
      }

      .ptah-compact-row {
        transition:
          opacity var(--ptah-motion-in) var(--ptah-ease-soft),
          translate var(--ptah-motion-in) var(--ptah-ease-soft);
      }

      .ptah-compact-row.is-collapsed {
        opacity: 0;
        translate: 0 6px;
        transition-duration: var(--ptah-motion-out);
      }

      .ptah-compact-pulse {
        animation: ptah-compact-pulse 1.6s ease-in-out infinite;
      }

      @keyframes ptah-compact-pulse {
        50% {
          opacity: 0.35;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ptah-compact-row {
          transition: none;
        }
        .ptah-compact-pulse {
          animation: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComposerCompactBarComponent {
  /** One-line status, e.g. "Ptah is working…". Truncates with an ellipsis. */
  readonly statusLabel = input.required<string>();
  /** Display name of the session's model; the chip hides when empty. */
  readonly modelLabel = input<string>('');
  /** Id of the full composer region this bar expands. */
  readonly controlsId = input.required<string>();
  /**
   * Show the Stop button (the tab is generating and the bar is the visible
   * state). It carries the composer's `chat-stop-btn` id: the owner renders
   * exactly one Stop, here while folded and on the full card otherwise.
   */
  readonly showStop = input<boolean>(true);
  /** The bar is folded away; its row fades out. */
  readonly collapsed = input<boolean>(false);

  /** The user asked for the full composer. */
  readonly expandRequested = output<void>();
  /** The user asked to stop generating. */
  readonly stopRequested = output<void>();

  protected readonly cardClass = `ptah-compact-card ${COMPOSER_CARD_CLASS} ${COMPOSER_CARD_BORDER_CLASS}`;
  protected readonly ChevronUpIcon = ChevronUp;
  protected readonly SquareIcon = Square;
}
