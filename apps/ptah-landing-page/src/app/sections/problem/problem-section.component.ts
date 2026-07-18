import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';
import { TerminalMockComponent } from '../../components/console/terminal-mock.component';

/**
 * ProblemSectionComponent — S2 Founder Insight (design spec §4 S2, copy deck S2).
 *
 * Two-column spotlight: left = the onboarding-parallel argument (eyebrow, H2,
 * two body paragraphs, no CTA — a bridge section); right = a coded terminal
 * `DeviceFrameComponent` previewing the memory pillar. All copy lands in static
 * HTML; entrance is slide-in only (final state fully opaque), SSG-safe.
 */
@Component({
  selector: 'ptah-problem-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewportAnimationDirective,
    DeviceFrameComponent,
    TerminalMockComponent,
  ],
  template: `
    <section
      id="the-onboarding-problem"
      aria-label="The onboarding problem"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <div
        class="max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 grid md:grid-cols-2 gap-12 md:gap-16 items-center"
      >
        <!-- Left: narrative -->
        <div
          viewportAnimation
          [viewportConfig]="textConfig"
          class="order-2 md:order-1 max-w-2xl"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >THE GAP</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            Vibe Coding Gets You a Demo. It Does Not Get You a Business.
          </h2>
          <div class="space-y-4 text-lg text-ink-300 leading-relaxed">
            <p>
              A prototype that impresses in a demo and a SaaS you can actually
              charge customers on are different products. Multi-tenant data
              isolation, billing webhooks that reconcile correctly, an auth
              model that survives a pen test, architecture that stays consistent
              past feature five — none of that shows up in a twenty-minute
              vibe-coding session, and most of it does not surface until a
              customer or an auditor finds it first.
            </p>
            <p>
              Ptah is built for the second product. It studies your codebase
              before the first message, keeps every architectural decision it
              makes, and staffs the parts of the job a solo prototype skips —
              security review, billing correctness, tenant isolation — the way a
              founder would staff a real team.
            </p>
          </div>
        </div>

        <!-- Right: terminal device mock -->
        <div
          viewportAnimation
          [viewportConfig]="deviceConfig"
          class="order-1 md:order-2"
        >
          <ptah-device-frame title="ptah — session log" aspect="16/10">
            <ptah-terminal-mock />
          </ptah-device-frame>
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
export class ProblemSectionComponent {
  /** Text column entrance — slide in from the left. */
  public readonly textConfig: ViewportAnimationConfig = {
    animation: 'slideRight',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  /** Device column entrance — slide in from the right. */
  public readonly deviceConfig: ViewportAnimationConfig = {
    animation: 'slideLeft',
    duration: 0.6,
    delay: 0.15,
    threshold: 0.2,
    ease: 'power2.out',
  };
}
