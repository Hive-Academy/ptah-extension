import {
  Component,
  signal,
  ChangeDetectionStrategy,
  viewChild,
} from '@angular/core';
import {
  HijackedScrollTimelineComponent,
  HijackedScrollItemDirective,
} from '@hive-academy/angular-gsap';
import { FeatureSlideComponent, Feature } from './feature-slide.component';

/**
 * FeaturesHijackedScrollComponent - Premium fullscreen features showcase
 *
 * Complexity Level: 2 (Medium)
 * Patterns: Composition with library components, signal-based state
 *
 * Features:
 * - Uses HijackedScrollTimelineComponent for fullscreen step-by-step scroll
 * - 6 feature slides with alternating slide directions (left/right)
 * - Fixed step indicator on left side showing current position
 * - Click-to-navigate step indicator buttons
 * - Configuration: scrollHeightPerStep=900, animationDuration=0.8, stepHold=0.9
 *
 * SOLID Principles:
 * - Single Responsibility: Orchestrate hijacked scroll with feature slides
 * - Composition: Uses HijackedScrollTimelineComponent and FeatureSlideComponent
 * - Open/Closed: Add features to array without modifying component logic
 */
@Component({
  selector: 'ptah-features-hijacked-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HijackedScrollTimelineComponent,
    HijackedScrollItemDirective,
    FeatureSlideComponent,
  ],
  template: `
    <!-- Fullscreen Hijacked Scroll Features -->
    <agsp-hijacked-scroll-timeline
      #scrollTimeline
      [scrollHeightPerStep]="900"
      [animationDuration]="0.8"
      [ease]="'power3.inOut'"
      [scrub]="1.5"
      [stepHold]="0.9"
      [showFirstStepImmediately]="true"
      (currentStepChange)="onStepChange($event)"
    >
      @for (feature of features; track feature.title; let i = $index) {
      <div
        hijackedScrollItem
        [slideDirection]="i % 2 === 0 ? 'left' : 'right'"
        [fadeIn]="true"
        [scale]="true"
      >
        <ptah-feature-slide
          [feature]="feature"
          [stepNumber]="i + 1"
          [totalSteps]="features.length"
        />
      </div>
      }
    </agsp-hijacked-scroll-timeline>

    <!-- Fixed Step Indicator (left side) -->
    <div
      class="fixed left-8 top-1/2 -translate-y-1/2 z-50 hidden lg:flex flex-col gap-4"
      role="navigation"
      aria-label="Feature navigation"
    >
      @for (feature of features; track feature.title; let i = $index) {
      <button
        type="button"
        (click)="jumpToStep(i)"
        class="w-3 h-3 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-950"
        [class.bg-purple-500]="currentStep() === i"
        [class.scale-125]="currentStep() === i"
        [class.bg-slate-700]="currentStep() !== i"
        [class.hover:bg-slate-600]="currentStep() !== i"
        [attr.aria-label]="'Go to feature: ' + feature.title"
        [attr.aria-current]="currentStep() === i ? 'step' : null"
      ></button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class FeaturesHijackedScrollComponent {
  /**
   * Reference to the scroll timeline for programmatic control
   */
  private readonly scrollTimeline =
    viewChild<HijackedScrollTimelineComponent>('scrollTimeline');

  /**
   * Current step index (0-based), updated via currentStepChange output
   */
  readonly currentStep = signal(0);

  /**
   * 6 Ptah features for the fullscreen showcase
   * Each feature has: title, headline, description, metric, icon, gradient, bgGlow
   */
  readonly features: Feature[] = [
    {
      title: 'Code Execution MCP Server',
      headline: 'Run Code in Any Language',
      description:
        '8 Ptah API namespaces available to your Claude agent. Query workspace structure, search files semantically, execute VS Code commands, and run code in any language.',
      metric: '300+ tools',
      icon: '\u{1F680}', // Rocket emoji
      gradient: 'from-purple-400 to-violet-500',
      bgGlow: 'bg-purple-500/10',
    },
    {
      title: '10x Faster Performance',
      headline: 'SDK vs CLI',
      description:
        'Direct SDK integration bypasses CLI subprocess overhead. Session creation drops from 500ms to 50ms. Feel the difference on every message.',
      metric: '50ms cold start',
      icon: '\u{26A1}', // Lightning bolt emoji
      gradient: 'from-amber-400 to-orange-500',
      bgGlow: 'bg-amber-500/10',
    },
    {
      title: 'Intelligent Workspace Analysis',
      headline: 'Deep Codebase Understanding',
      description:
        'Auto-detect 13+ project types and 6 monorepo tools. Context-aware AI interactions with intelligent file ranking and token budget optimization.',
      metric: '13+ project types',
      icon: '\u{1F9E0}', // Brain emoji
      gradient: 'from-cyan-400 to-teal-500',
      bgGlow: 'bg-cyan-500/10',
    },
    {
      title: 'Project-Adaptive Agents',
      headline: 'AI That Knows Your Stack',
      description:
        'LLM-powered template expansion generates agents specifically trained on your codebase. Custom rules per project for maximum effectiveness.',
      metric: 'Custom rules per project',
      icon: '\u{1F3AF}', // Target emoji
      gradient: 'from-pink-400 to-rose-500',
      bgGlow: 'bg-pink-500/10',
    },
    {
      title: 'Multi-Provider LLM Support',
      headline: 'Choose Your Model',
      description:
        'Claude, GPT-4, Gemini, OpenRouter, or VS Code LM API. One unified interface, your choice of model. Switch mid-conversation, compare responses.',
      metric: '200+ models via OpenRouter',
      icon: '\u{1F50C}', // Electric plug emoji
      gradient: 'from-green-400 to-emerald-500',
      bgGlow: 'bg-green-500/10',
    },
    {
      title: 'Token-Optimized Context',
      headline: 'Smart Context Management',
      description:
        'Greedy algorithm selects the most relevant files while respecting token budgets. Fit more into every conversation without manual pruning.',
      metric: '80% token reduction',
      icon: '\u{1F4CA}', // Chart emoji
      gradient: 'from-orange-400 to-red-500',
      bgGlow: 'bg-orange-500/10',
    },
  ];

  /**
   * Handle step change from hijacked scroll timeline
   * @param index - Current step index (0-based)
   */
  onStepChange(index: number): void {
    this.currentStep.set(index);
  }

  /**
   * Jump to a specific step programmatically
   * Calculates approximate scroll position based on step index and scrollHeightPerStep
   * @param index - Target step index (0-based)
   */
  jumpToStep(index: number): void {
    // Calculate scroll position based on step index
    // scrollHeightPerStep=900, so each step is ~900px of scroll distance
    const scrollHeight = 900 * index;
    window.scrollTo({ top: scrollHeight, behavior: 'smooth' });
  }
}
