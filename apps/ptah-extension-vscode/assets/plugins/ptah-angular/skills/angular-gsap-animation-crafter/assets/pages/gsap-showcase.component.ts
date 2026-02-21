import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { Angular3dSectionComponent } from './sections/angular-3d-section.component';
import { AngularGsapSectionComponent } from './sections/angular-gsap-section.component';
import { GsapShowcaseHeroSectionComponent } from './sections/gsap-showcase-hero-section.component';
import { ProblemSolutionSectionComponent } from './sections/problem-solution-section.component';
import { ValuePropositionsSectionComponent } from './sections/value-propositions-section.component';

@Component({
  selector: 'app-gsap-showcase',
  imports: [
    ViewportAnimationDirective,
    Angular3dSectionComponent,
    AngularGsapSectionComponent,
    GsapShowcaseHeroSectionComponent,
    ProblemSolutionSectionComponent,
    ValuePropositionsSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- GSAP Hero Section -->
    <app-gsap-showcase-hero-section />

    <!-- Problem/Solution Section -->
    <app-problem-solution-section />

    <!-- Angular 3D Section (Dark Theme + Feature Steps) -->
    <app-angular-3d-section />

    <!-- Angular GSAP Section (Split-Panel Parallax) -->
    <app-angular-gsap-section />

    <!-- CTA Section -->
    <section class="bg-background-dark text-white py-24 text-center">
      <h2
        class="text-5xl md:text-6xl font-bold mb-8"
        viewportAnimation
        [viewportConfig]="{
          animation: 'slideUp',
          duration: 0.8,
          threshold: 0.3
        }"
      >
        Ready to Animate?
      </h2>
      <code
        class="inline-block bg-background-dark/80 border border-neon-green/30 px-6 py-3 rounded-lg text-neon-green font-mono mb-8"
        viewportAnimation
        [viewportConfig]="{
          animation: 'scaleIn',
          duration: 0.6,
          delay: 0.2,
          threshold: 0.3
        }"
      >
        npm install &#64;hive-academy/angular-gsap
      </code>

      <div
        class="mt-8 flex gap-4 justify-center"
        viewportAnimation
        [viewportConfig]="{
          animation: 'fadeIn',
          duration: 0.6,
          delay: 0.4,
          threshold: 0.3
        }"
      >
        <button
          class="px-8 py-4 bg-neon-green text-background-dark rounded-full font-semibold hover:scale-105 transition-transform"
        >
          View Docs
        </button>
        <a
          href="https://github.com/hive-academy/angular-gsap"
          target="_blank"
          rel="noopener noreferrer"
          class="px-8 py-4 border-2 border-white text-white rounded-full font-semibold hover:bg-white hover:text-background-dark transition-all"
        >
          GitHub
        </a>
      </div>
    </section>

    <!-- Value Propositions Section -->
    <app-value-propositions-section />
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class GsapShowcaseComponent {}
