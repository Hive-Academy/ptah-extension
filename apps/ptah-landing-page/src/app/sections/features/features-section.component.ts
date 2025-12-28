import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  inject,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FeatureCardComponent } from './feature-card.component';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface Feature {
  id: string;
  iconEmoji: string;
  title: string;
  description: string;
  capabilities: string[];
}

/**
 * FeaturesSectionComponent - Showcase key Ptah capabilities
 *
 * Complexity Level: 2 (Medium)
 * Patterns: Composition (uses FeatureCardComponent), GSAP ScrollTrigger animations
 *
 * Features:
 * - Two-column responsive grid layout
 * - Staggered entrance animations (0.2s delay between cards)
 * - Workspace Intelligence & VS Code LM Tools feature cards
 * - Reduced motion support
 * - Proper GSAP cleanup on component destroy
 *
 * SOLID Principles:
 * - Single Responsibility: Display features section with animations only
 * - Composition: Uses FeatureCardComponent atoms
 * - Open/Closed: Extend features array, closed for modification
 *
 * Design Spec Reference: visual-design-specification.md:Feature Card animations
 */
@Component({
  selector: 'ptah-features-section',
  standalone: true,
  imports: [CommonModule, FeatureCardComponent],
  template: `
    <section #sectionRef class="py-32 bg-base-100">
      <div class="container mx-auto px-6">
        <h2
          class="text-3xl md:text-4xl font-display font-bold text-base-content text-center mb-16"
        >
          Power-Ups for Your Development
        </h2>

        <div class="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto features-grid">
          @for (feature of features; track feature.id) {
          <ptah-feature-card
            [iconEmoji]="feature.iconEmoji"
            [title]="feature.title"
            [description]="feature.description"
            [capabilities]="feature.capabilities"
          />
          }
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturesSectionComponent {
  private readonly sectionRef = viewChild.required<ElementRef>('sectionRef');
  private readonly destroyRef = inject(DestroyRef);
  private gsapContext?: gsap.Context;

  readonly features: Feature[] = [
    {
      id: 'workspace-intelligence',
      iconEmoji: '🧠',
      title: 'Workspace Intelligence',
      description:
        'Understands your project structure, prioritizes files, and provides contextual awareness for smarter AI assistance.',
      capabilities: [
        'Project type detection (NX, Angular, React, Node)',
        'Smart file prioritization based on relevance',
        'Token budget optimization for context',
        'gitignore-aware file filtering',
      ],
    },
    {
      id: 'vscode-lm-tools',
      iconEmoji: '🪄',
      title: 'VS Code LM Tools',
      description:
        'Native Language Model API integration with secure code execution and granular permission handling.',
      capabilities: [
        'Copilot/GPT-4 integration via VS Code API',
        'Secure sandboxed code execution',
        'Granular permission controls',
        'Real-time tool visualization',
      ],
    },
  ];

  constructor() {
    afterNextRender(() => this.initAnimations());
  }

  private initAnimations(): void {
    // Respect user's motion preferences
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // Create scoped GSAP context for animations
    this.gsapContext = gsap.context(() => {
      gsap.from('.features-grid > *', {
        y: 40,
        opacity: 0,
        duration: 0.6,
        stagger: 0.2,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: '.features-grid',
          start: 'top 80%',
        },
      });
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => this.gsapContext?.revert());
  }
}
