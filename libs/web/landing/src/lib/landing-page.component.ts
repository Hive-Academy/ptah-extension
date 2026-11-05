import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SeoService } from '@ptah-web/core';
import { NavigationComponent } from '@ptah-web/ui';
import { ComparisonSectionComponent } from './sections/comparison/comparison-section.component';
import { CommandCenterSectionComponent } from './sections/command-center/command-center-section.component';
import { CTASectionComponent } from './sections/cta/cta-section.component';
import { DecisionLoopSectionComponent } from './sections/decision-loop/decision-loop-section.component';
import { FooterComponent } from '@ptah-web/ui';
import { HeroComponent } from './sections/hero/hero.component';
import { ProblemSectionComponent } from './sections/problem/problem-section.component';
import { PillarsSpineComponent } from './sections/pillars/pillars-spine.component';
import { ProviderStripComponent } from './sections/provider-strip/provider-strip.component';
import { TribunalSectionComponent } from './sections/tribunal/tribunal-section.component';
import { VoiceAndAppsSectionComponent } from './sections/voice-and-apps/voice-and-apps-section.component';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    NavigationComponent,
    HeroComponent,
    CommandCenterSectionComponent,
    VoiceAndAppsSectionComponent,
    DecisionLoopSectionComponent,
    TribunalSectionComponent,
    ProblemSectionComponent,
    PillarsSpineComponent,
    ProviderStripComponent,
    ComparisonSectionComponent,
    CTASectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-ink-950 text-ink-100">
      <ptah-navigation />

      <main>
        <ptah-hero />
        <ptah-command-center-section />
        <ptah-voice-and-apps-section />
        <ptah-decision-loop-section />
        <ptah-tribunal-section />
        <ptah-problem-section />

        <!--
          Render eagerly so SEO copy ships in the prerendered static HTML.
          Entrance animations apply their from-state only after hydration.
        -->
        <ptah-pillars-spine />
        <ptah-provider-strip />
        <ptah-comparison-section />
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
export class LandingPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'PtahCode — Your AI dev team. Free and open source.',
      description:
        'PtahCode is a free, MIT-licensed desktop app that runs a team of AI agents on your own machine. Bring any model — open-weight or frontier — and keep your code and keys with you.',
      url: 'https://ptah.live',
      ogTitle: 'PtahCode — Your AI dev team. Free and open source.',
      ogDescription:
        'PtahCode is a free, MIT-licensed desktop app that runs a team of AI agents on your own machine. Bring any model — open-weight or frontier — and keep your code and keys with you.',
    });
  }
}
