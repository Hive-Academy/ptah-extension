import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Check, Copy, LucideAngularModule } from 'lucide-angular';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';

/** How long the button reads "Copied". */
export const COMMAND_COPIED_MS = 2000;

/**
 * One terminal command with a Copy button (spec §12.2). The command is
 * selectable text that wraps; Copy keeps focus, reads "Copied" for 2 s and
 * announces "Command copied". A rejected clipboard write shows an inline
 * fallback instead.
 */
@Component({
  selector: 'ptah-command-copy-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-200 p-2 max-[480px]:flex-col max-[480px]:items-stretch"
      data-glass-surface="tile"
    >
      <code
        class="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-1 py-1 font-mono text-[0.8125rem] leading-relaxed"
        data-testid="command-copy-code"
        >{{ command() }}</code
      >
      <button
        type="button"
        class="btn btn-sm min-h-8 flex-none max-[480px]:self-end"
        data-testid="command-copy-button"
        [attr.aria-label]="copyLabel()"
        (click)="copy()"
      >
        <lucide-angular
          [img]="copied() ? icons.check : icons.copy"
          class="size-4"
          aria-hidden="true"
        />
        {{ copied() ? 'Copied' : 'Copy' }}
      </button>
    </div>
    @if (failed()) {
      <p
        class="mt-1 text-xs text-state-err"
        data-testid="command-copy-fallback"
      >
        Select the text and copy it.
      </p>
    }
  `,
})
export class CommandCopyRowComponent {
  private readonly announcer = inject(OnboardingAnnouncerService);

  readonly command = input.required<string>();
  /** The button's accessible name, naming the command. */
  readonly copyLabel = input.required<string>();

  protected readonly icons = { copy: Copy, check: Check } as const;
  protected readonly copied = signal(false);
  protected readonly failed = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  protected async copy(): Promise<void> {
    this.clearTimer();
    try {
      await navigator.clipboard.writeText(this.command());
    } catch {
      // degradation-audit: reported - a refused clipboard write shows the
      // inline "Select the text and copy it." fallback; the text stays selectable.
      this.copied.set(false);
      this.failed.set(true);
      return;
    }
    this.failed.set(false);
    this.copied.set(true);
    this.announcer.announce('Command copied');
    this.timer = setTimeout(() => {
      this.timer = null;
      this.copied.set(false);
    }, COMMAND_COPIED_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
