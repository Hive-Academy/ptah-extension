import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Clock,
  LucideAngularModule,
  MessageSquare,
  ShieldCheck,
} from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';
import { GatewayMockComponent } from '../../components/console/gateway-mock.component';

/**
 * PillarAlwaysOnComponent — S6 Pillar 3: Always On, Reachable Anywhere
 * (design spec §4 S6, copy deck S6). Same hybrid layout as S4/S5; the device
 * visual is the coded `GatewayMockComponent` (Telegram / Discord / Slack cards),
 * with a 3-card feature grid closing the wedge on schedulability and
 * reachability. Entrance animations are opacity/transform only.
 */
@Component({
  selector: 'ptah-pillar-always-on',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    ConsoleGridBackgroundComponent,
    DeviceFrameComponent,
    GatewayMockComponent,
  ],
  template: `
    <section
      id="always-on"
      aria-label="Pillar 3 — always on, reachable anywhere"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Header -->
        <div
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="max-w-3xl mx-auto text-center mb-16"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >PILLAR 3 — ALWAYS ON, REACHABLE ANYWHERE</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            It Works While You Sleep. It Answers Where You Already Are.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Schedule agents like cron jobs. Approve their work from your phone.
          </p>
        </div>

        <!-- Device visual: messaging gateway -->
        <div
          viewportAnimation
          [viewportConfig]="deviceConfig"
          class="max-w-4xl mx-auto mb-16"
        >
          <ptah-device-frame
            title="Ptah — Messaging Gateway"
            liveLabel="Discord: connected"
            aspect="16/10"
          >
            <ptah-gateway-mock />
          </ptah-device-frame>
        </div>

        <!-- Feature cards -->
        <div class="grid md:grid-cols-3 gap-6 lg:gap-8">
          @for (card of cards; track card.title; let i = $index) {
            <article
              viewportAnimation
              [viewportConfig]="cardConfigs[i]"
              class="rounded-xl border border-ink-700 bg-ink-850 p-6 sm:p-8 transition-colors duration-200 hover:border-amber-500/30"
            >
              <div
                class="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5"
              >
                <lucide-angular
                  [img]="card.icon"
                  class="w-5 h-5 text-amber-500"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-lg sm:text-xl font-semibold text-white mb-2">
                {{ card.title }}
              </h3>
              <p class="text-base text-ink-400 leading-relaxed">
                {{ card.body }}
              </p>
            </article>
          }
        </div>

        <!-- Citable stat callout -->
        <p
          class="mt-14 max-w-2xl mx-auto text-center font-mono text-sm text-ink-400"
        >
          Trigger and approve agent runs from Telegram, Discord, or Slack —
          including per-thread sessions on Discord.
        </p>
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
export class PillarAlwaysOnComponent {
  protected readonly cards = [
    {
      icon: Clock,
      title: 'Cron Scheduler',
      body: 'SQLite-backed, slot-claimed scheduled runs. Nightly code reviews, Sunday dependency scans, daily standup summaries — no server to babysit.',
    },
    {
      icon: MessageSquare,
      title: 'Messaging Gateways',
      body: 'Trigger and approve agent work from Telegram, Discord, or Slack, including voice input. Discord supports per-thread multi-session conversations, so each thread keeps its own agent context.',
    },
    {
      icon: ShieldCheck,
      title: 'Approval Relay',
      body: "Review and approve tool calls before they execute, from any connected gateway — nothing runs unattended that you haven't authorized.",
    },
  ];

  protected readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly deviceConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly cardConfigs: ViewportAnimationConfig[] = [0, 1, 2].map(
    (i) => ({
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.1 + i * 0.12,
      threshold: 0.2,
      ease: 'power2.out',
    }),
  );
}
