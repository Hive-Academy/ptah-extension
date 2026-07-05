import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideAngularModule, Package, Terminal } from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

/**
 * AlsoAvailableComponent — S9 "Also Available" (design spec §4 S9, copy deck S9).
 *
 * The one and only place VS Code and the CLI appear above the footer. Kept the
 * quietest block on the page by design: muted (non-amber) eyebrow, a smaller
 * H2, recessed background, and two plain text links with NO button chrome so
 * their visual weight sits below every primary/secondary CTA (Req 1.5 / 2.3).
 */
@Component({
  selector: 'ptah-also-available',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, ViewportAnimationDirective],
  template: `
    <section
      id="also-available"
      aria-label="Also available — VS Code extension and CLI"
      class="py-16 bg-ink-900/60 border-y border-ink-800"
    >
      <div
        viewportAnimation
        [viewportConfig]="config"
        class="max-w-2xl mx-auto text-center px-6"
      >
        <span
          class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-ink-500 mb-4 inline-block"
          >ALSO AVAILABLE</span
        >
        <h2 class="text-2xl sm:text-3xl font-bold text-white">
          Prefer Your Editor or a Terminal?
        </h2>
        <p class="text-ink-400 text-base leading-relaxed mt-4">
          Ptah also ships as a VS Code extension and a headless CLI for CI/CD and
          scripted workflows. Same license, same seven providers — without the
          desktop-only Memory, Skills, Cron, and Gateway suite, which requires
          the desktop app.
        </p>

        <div class="flex flex-col sm:flex-row gap-6 justify-center mt-8">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-ink-300 hover:text-amber-500 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded"
          >
            <lucide-angular
              [img]="packageIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Get the VS Code Extension
          </a>
          <a
            href="https://docs.ptah.live/providers/ptah-cli/"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-ink-300 hover:text-amber-500 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded"
          >
            <lucide-angular
              [img]="terminalIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Read the CLI Docs
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class AlsoAvailableComponent {
  protected readonly packageIcon = Package;
  protected readonly terminalIcon = Terminal;

  protected readonly config: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };
}
