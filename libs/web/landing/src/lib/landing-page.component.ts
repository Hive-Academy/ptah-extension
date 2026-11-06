import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SeoService } from '@ptah-web/core';
import { FooterComponent, NavigationComponent } from '@ptah-web/ui';
import { AlwaysOnSectionComponent } from './sections/always-on/always-on-section.component';
import { CommandCenterSectionComponent } from './sections/command-center/command-center-section.component';
import { DecisionLoopSectionComponent } from './sections/decision-loop/decision-loop-section.component';
import { FinalCtaSectionComponent } from './sections/final-cta/final-cta-section.component';
import { HeroComponent } from './sections/hero/hero.component';
import { MemorySkillsSectionComponent } from './sections/memory-skills/memory-skills-section.component';
import { MultiVendorSectionComponent } from './sections/multi-vendor/multi-vendor-section.component';
import { ProvidersSectionComponent } from './sections/providers/providers-section.component';
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
    MultiVendorSectionComponent,
    MemorySkillsSectionComponent,
    AlwaysOnSectionComponent,
    ProvidersSectionComponent,
    FinalCtaSectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-ink-950 text-ink-100">
      <ptah-navigation />

      <!--
        Every section renders eagerly so its copy ships in the prerendered
        static HTML; scroll reveals apply their from-state only after hydration.
      -->
      <main>
        <ptah-hero />
        <!-- The navigation's "Features" link lands on the first section. -->
        <ptah-command-center-section id="features" />
        <ptah-voice-and-apps-section />
        <ptah-decision-loop-section />
        <ptah-tribunal-section />
        <ptah-multi-vendor-section />
        <ptah-memory-skills-section />
        <ptah-always-on-section />
        <ptah-providers-section />
        <ptah-final-cta-section />
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
