import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationComponent } from '../components/navigation.component';
import { ComparisonSectionComponent } from '../sections/comparison/comparison-section.component';
import { CTASectionComponent } from '../sections/cta/cta-section.component';
import { FooterComponent } from '../components/footer.component';
import { HeroComponent } from '../sections/hero/hero.component';
import { ProblemSectionComponent } from '../sections/problem/problem-section.component';
import { OpenSourceSectionComponent } from '../sections/open-source/open-source-section.component';
import { VideoShowcaseComponent } from '../sections/video-showcase/video-showcase.component';
import { RuntimesTriptychComponent } from '../sections/runtimes-triptych/runtimes-triptych.component';
import { PillarMemoryComponent } from '../sections/pillar-memory/pillar-memory.component';
import { PillarSkillsOrchestrationComponent } from '../sections/pillar-skills-orchestration/pillar-skills-orchestration.component';
import { PillarAlwaysOnComponent } from '../sections/pillar-always-on/pillar-always-on.component';
import { ProviderStripComponent } from '../sections/provider-strip/provider-strip.component';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    NavigationComponent,
    HeroComponent,
    ProblemSectionComponent,
    VideoShowcaseComponent,
    RuntimesTriptychComponent,
    PillarMemoryComponent,
    PillarSkillsOrchestrationComponent,
    PillarAlwaysOnComponent,
    ProviderStripComponent,
    OpenSourceSectionComponent,
    ComparisonSectionComponent,
    CTASectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <ptah-navigation />

      <main>
        <ptah-hero />

        <ptah-problem-section />

        <ptah-video-showcase />

        <div class="relative overflow-hidden bg-slate-950" aria-hidden="true">
          <img
            src="/assets/backgrounds/circuit-divider.jpg"
            alt=""
            loading="lazy"
            decoding="async"
            class="w-full h-14 sm:h-20 object-cover opacity-50"
          />
          <div
            class="absolute inset-0 bg-gradient-to-r from-slate-950 via-transparent to-slate-950"
          ></div>
        </div>

        <ptah-runtimes-triptych />

        <!--
          Pillars render eagerly (not @defer) so their SEO/GEO-bearing copy and
          citable claims ship in the prerendered static HTML. They are lightweight
          coded DOM (no images), and their entrance animations are SSG-safe
          (final DOM state fully opaque; the from-state is applied post-hydration).
        -->
        <div id="features">
          <ptah-pillar-memory />
        </div>

        <ptah-pillar-skills-orchestration />

        <ptah-pillar-always-on />

        <ptah-provider-strip />

        @defer (on viewport) {
          <section id="open-source" aria-label="Open Source">
            <ptah-open-source-section />
          </section>
        } @placeholder {
          <div class="min-h-screen"></div>
        }

        @defer (on viewport) {
          <ptah-comparison-section />
        } @placeholder {
          <div class="min-h-screen"></div>
        }

        <div class="relative overflow-hidden bg-slate-950" aria-hidden="true">
          <img
            src="/assets/backgrounds/circuit-divider.jpg"
            alt=""
            loading="lazy"
            decoding="async"
            class="w-full h-14 sm:h-20 object-cover opacity-50"
          />
          <div
            class="absolute inset-0 bg-gradient-to-r from-slate-950 via-transparent to-slate-950"
          ></div>
        </div>

        <ptah-cta-section />
      </main>

      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        overflow-x: hidden;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent {}
