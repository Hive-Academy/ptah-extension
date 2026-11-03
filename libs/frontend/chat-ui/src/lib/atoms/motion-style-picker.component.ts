import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MOTION_STYLES, ThemeService, type MotionStyleName } from '@ptah-extension/core';

const LABELS: Record<MotionStyleName, string> = {
  fade: 'Fade',
  rise: 'Rise',
  'slide-left': 'Slide left',
  'slide-right': 'Slide right',
  scale: 'Scale',
  directional: 'Direction-aware',
};

@Component({
  selector: 'ptah-motion-style-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .motion-preview-frame {
      display: grid;
      place-items: center;
      width: 48px;
      height: 32px;
      overflow: hidden;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    .motion-preview-chip {
      width: 20px;
      height: 12px;
      border-radius: 3px;
      background: currentColor;
    }
    .motion-option:hover .motion-preview-chip,
    .motion-option input:focus-visible + .motion-preview-frame .motion-preview-chip {
      animation: ptahMotionEnter var(--ptah-motion-in, 320ms) ease-out both;
    }
    .motion-preview-chip.previewing {
      animation: ptahMotionEnter var(--ptah-motion-in, 320ms) ease-out both;
    }
    @media (forced-colors: active) {
      .motion-option input:checked + .motion-preview-frame {
        outline: 2px solid Highlight;
        outline-offset: 2px;
      }
    }
  `,
  template: `
    <fieldset class="mt-3 border-t border-base-content/20 px-2 pt-3">
      <legend class="text-xs font-semibold">Animation style</legend>
      <div class="grid grid-cols-3 gap-2 pt-2">
        @for (option of options; track option.value) {
          <label class="motion-option flex cursor-pointer flex-col items-center gap-1 rounded-lg p-1 text-center text-xs hover:bg-base-300">
            <input type="radio" class="sr-only peer" [attr.name]="group"
              [value]="option.value"
              [checked]="motionStyle() === option.value"
              (change)="selectStyle(option.value, chip)" />
            <span class="motion-preview-frame ptah-motion-stage ring-offset-2 ring-offset-base-200 peer-checked:ring-2 peer-checked:ring-base-content peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--glass-focus)]"
              [attr.data-motion-style]="option.value" [attr.data-motion-dir]="option.value === 'directional' ? previewDirection() : null"
              (mouseenter)="advanceDirection(option.value)" aria-hidden="true">
              <span #chip class="motion-preview-chip"
                (animationend)="finishPreview($event)"
                (animationcancel)="finishPreview($event)"></span>
            </span>
            <span>{{ option.label }}</span>
          </label>
        }
      </div>
      @if (reducedMotion()) {
        <p class="mt-2 text-xs text-base-content-muted">Reduced motion is on. Animation styles do not play. Use Motion above to change this setting.</p>
      }
    </fieldset>
  `,
})
export class MotionStylePickerComponent {
  private static sequence = 0;

  private readonly themeService = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);
  readonly motionStyle = this.themeService.motionStyle;
  protected readonly group = `ptah-motion-style-${++MotionStylePickerComponent.sequence}`;
  protected readonly options = MOTION_STYLES.map((value) => ({ value, label: LABELS[value] }));
  protected readonly previewDirection = signal<'forward' | 'back'>('forward');
  protected readonly reducedMotion = signal(false);

  constructor() {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    this.reducedMotion.set(media.matches);
    const onChange = () => this.reducedMotion.set(media.matches);
    media.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
  }

  protected selectStyle(style: MotionStyleName, chip: HTMLElement): void {
    this.themeService.setMotionStyle(style);
    this.advanceDirection(style);
    chip.classList.remove('previewing');
    chip.style.animation = 'none';
    void chip.offsetWidth;
    chip.style.removeProperty('animation');
    chip.classList.add('previewing');
  }

  protected advanceDirection(style: MotionStyleName): void {
    if (style === 'directional') {
      this.previewDirection.update((direction) => direction === 'forward' ? 'back' : 'forward');
    }
  }

  protected finishPreview(event: Event): void {
    if (event.target === event.currentTarget) {
      (event.currentTarget as HTMLElement).classList.remove('previewing');
    }
  }
}
