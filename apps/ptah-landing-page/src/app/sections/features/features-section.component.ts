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
 * - Four feature cards with rich marketing copy
 * - Two-column responsive grid layout with 48px gap (gap-12)
 * - Staggered entrance animations (0.15s delay between cards)
 * - Eyebrow label + section headline
 * - Reduced motion support
 * - Proper GSAP cleanup on component destroy
 *
 * SOLID Principles:
 * - Single Responsibility: Display features section with animations only
 * - Composition: Uses FeatureCardComponent atoms
 * - Open/Closed: Extend features array, closed for modification
 *
 * Design Spec Reference: visual-design-specification.md:Feature Card animations
 * Task Reference: TASK_2025_072 Batch 4 Task 4.2
 */
@Component({
  selector: 'ptah-features-section',
  standalone: true,
  imports: [CommonModule, FeatureCardComponent],
  template: `
    <section #sectionRef class="py-32 bg-base-100">
      <div class="container mx-auto px-6">
        <!-- Eyebrow label -->
        <p
          class="text-sm tracking-widest text-secondary uppercase text-center mb-4"
        >
          SUPERPOWERS
        </p>

        <!-- Section headline -->
        <h2
          class="text-5xl md:text-6xl font-display font-bold text-center mb-16"
        >
          Everything You Need to Master Claude Code
        </h2>

        <!-- Features grid with 48px gap -->
        <div class="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto features-grid">
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

  /**
   * Feature card data with marketing copy from landing-page-copy.md
   */
  readonly features: Feature[] = [
    {
      id: 'native-chat',
      iconEmoji: '🖥️',
      title: 'Native Chat, Zero Context Switching',
      description:
        "Stop toggling terminals. Ptah brings Claude Code's full power into a native VS Code sidebar with 48+ hand-crafted components. Chat, view execution trees, and track sessions—all without leaving your editor.",
      capabilities: [
        '48+ Angular components',
        'ExecutionNode tree visualization',
        'Real-time streaming responses',
        'Multi-session management',
      ],
    },
    {
      id: 'sdk-performance',
      iconEmoji: '⚡',
      title: '10x Faster With Official SDK',
      description:
        'Ditch the CLI overhead. Ptah uses the official Claude Agent SDK for native TypeScript integration. Get instant streaming, built-in session management, and permission handling—no subprocess spawning required.',
      capabilities: [
        'Official @anthropic-ai/claude-agent-sdk',
        'Native streaming support',
        'Zero CLI latency',
        'Built-in session persistence',
      ],
    },
    {
      id: 'workspace-intelligence',
      iconEmoji: '🧠',
      title: 'Your Codebase, Understood',
      description:
        "Ptah doesn't just chat—it comprehends. 20+ specialized services analyze your workspace, detect 13+ project types, optimize token budgets, and auto-select relevant files. Claude gets the context it needs, nothing it doesn't.",
      capabilities: [
        '13+ project type detection',
        'Intelligent file ranking',
        'Token budget optimization',
        'Autocomplete discovery',
      ],
    },
    {
      id: 'multi-provider',
      iconEmoji: '🌐',
      title: 'One Interface, Five AI Providers',
      description:
        "Never get locked in. Ptah's multi-provider abstraction supports Anthropic, OpenAI, Google Gemini, OpenRouter, and VS Code LM API. Switch models mid-conversation. Compare responses. Your choice, your control.",
      capabilities: [
        'Anthropic (Claude)',
        'OpenAI (GPT-4)',
        'Google Gemini',
        'OpenRouter gateway',
        'VS Code LM API',
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
        stagger: 0.15, // Changed from 0.2s to 0.15s for faster reveal
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
