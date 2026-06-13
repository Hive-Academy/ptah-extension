import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationComponent } from '../components/navigation.component';
import { ComparisonSectionComponent } from '../sections/comparison/comparison-section.component';
import { CTASectionComponent } from '../sections/cta/cta-section.component';
import { FooterComponent } from '../components/footer.component';
import { HeroComponent } from '../sections/hero/hero.component';
import { OpenSourceSectionComponent } from '../sections/open-source/open-source-section.component';
import { PremiumShowcaseComponent } from '../sections/premium-showcase/premium-showcase.component';
import { VideoShowcaseComponent } from '../sections/video-showcase/video-showcase.component';
import { RuntimesTriptychComponent } from '../sections/runtimes-triptych/runtimes-triptych.component';
import { ThothSuiteComponent } from '../sections/thoth-suite/thoth-suite.component';
import { CanvasOrchestraComponent } from '../sections/canvas-orchestra/canvas-orchestra.component';
import { WorkspaceIntelligenceComponent } from '../sections/workspace-intelligence/workspace-intelligence.component';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    NavigationComponent,
    HeroComponent,
    VideoShowcaseComponent,
    RuntimesTriptychComponent,
    PremiumShowcaseComponent,
    ThothSuiteComponent,
    CanvasOrchestraComponent,
    WorkspaceIntelligenceComponent,
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

        <section id="video-showcase" aria-label="Video Showcase">
          <ptah-video-showcase />
        </section>

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

        @defer (on viewport) {
          <section id="features" aria-label="Why Ptah">
            <ptah-premium-showcase />
          </section>
        } @placeholder {
          <div class="min-h-screen"></div>
        }

        @defer (on viewport) {
          <ptah-thoth-suite />
        } @placeholder {
          <div class="min-h-screen"></div>
        }

        @defer (on viewport) {
          <ptah-canvas-orchestra />
        } @placeholder {
          <div class="min-h-screen"></div>
        }

        @defer (on viewport) {
          <ptah-workspace-intelligence />
        } @placeholder {
          <div class="min-h-screen"></div>
        }

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
