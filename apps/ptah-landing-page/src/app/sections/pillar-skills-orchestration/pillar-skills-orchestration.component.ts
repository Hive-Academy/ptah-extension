import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Bot,
  LayoutGrid,
  LucideAngularModule,
  Sparkles,
  Workflow,
} from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';
import { OrchestraGridMockComponent } from '../../components/console/orchestra-grid-mock.component';

/**
 * PillarSkillsOrchestrationComponent — S5 Pillar 2: Skills, Sub-Agents &
 * Orchestra Canvas (design spec §4 S5, copy deck S5). Same hybrid layout as S4,
 * but the device visual is the reused `OrchestraGridMockComponent` (the 9-tile
 * canvas), and the feature grid carries four cards. Entrance animations are
 * opacity/transform only; the tile "stream" sweep inside the mock is a pure-CSS
 * resting loop guarded by reduced-motion.
 */
@Component({
  selector: 'ptah-pillar-skills-orchestration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    ConsoleGridBackgroundComponent,
    DeviceFrameComponent,
    OrchestraGridMockComponent,
  ],
  template: `
    <section
      id="skills-orchestration"
      aria-label="Pillar 2 — skills, sub-agents and Orchestra Canvas"
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
            >PILLAR 2 — LEARNS AND SCALES</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            It Gets Better Every Session. Then It Multiplies Itself.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Repeat a workflow and Ptah turns it into a reusable skill. Then it
            can run that skill nine times over, in parallel.
          </p>
        </div>

        <!-- Device visual: the 9-tile Orchestra Canvas -->
        <div
          viewportAnimation
          [viewportConfig]="deviceConfig"
          class="max-w-4xl mx-auto mb-16"
        >
          <ptah-device-frame
            title="Ptah — Orchestra Canvas"
            liveLabel="9 agents active"
            aspect="16/10"
          >
            <ptah-orchestra-grid-mock />
          </ptah-device-frame>
        </div>

        <!-- Feature cards -->
        <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
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
          Up to 9 concurrent agent tiles in one gridstack view, each with an
          independent provider and model.
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
export class PillarSkillsOrchestrationComponent {
  protected readonly cards = [
    {
      icon: Sparkles,
      title: 'Auto-Learning Skills Curator',
      body: 'When a workflow repeats successfully, Ptah extracts the trajectory, judges its quality, and promotes it to a permanent, shareable SKILL.md file — no manual authoring required.',
    },
    {
      icon: Bot,
      title: 'Sub-Agent Orchestration',
      body: 'A main agent fans work out to parallel sub-agents across a three-tier hierarchy, each with its own provider, model, and context window.',
    },
    {
      icon: LayoutGrid,
      title: 'Orchestra Canvas',
      body: 'Run up to nine concurrent agent sessions in one drag-and-resize grid. Background agents keep working while you focus on a single tile.',
    },
    {
      icon: Workflow,
      title: 'Built-in Workflows & Skills Library',
      body: 'Ship with pre-built skills for common stacks and browse more from the skills registry — install with one click.',
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

  protected readonly cardConfigs: ViewportAnimationConfig[] = [0, 1, 2, 3].map(
    (i) => ({
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.1 + i * 0.12,
      threshold: 0.2,
      ease: 'power2.out',
    }),
  );
}
