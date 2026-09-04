/**
 * Feature Showcase Cards Section Template
 *
 * Animation Type: Staggered Cards / Scroll Reveal
 * Best For: Feature sections, services pages, product benefits
 *
 * Key Features:
 * - Grid of feature cards with staggered entrance
 * - Hover interactions with scale and glow effects
 * - Icon animations on viewport entry
 * - Responsive grid layout
 * - Subtle parallax on scroll
 *
 * Customization Points:
 * - Grid columns: Adjust for 2, 3, or 4 column layouts
 * - Card styling: Update colors, borders, backgrounds
 * - Animation timing: Modify stagger delays
 * - Icons: Replace with custom icon components
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-feature-showcase-cards',
  standalone: true,
  imports: [CommonModule, ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="feature-showcase">
      <!-- Section Header -->
      <div class="section-header">
        <span
          class="section-tag"
          viewportAnimation
          [animationType]="'fade-up'"
          [duration]="0.6"
          [delay]="0.1"
        >
          Features
        </span>
        <h2
          class="section-title"
          viewportAnimation
          [animationType]="'fade-up'"
          [duration]="0.8"
          [delay]="0.2"
        >
          Everything you need to
          <span class="highlight">succeed</span>
        </h2>
        <p
          class="section-description"
          viewportAnimation
          [animationType]="'fade-up'"
          [duration]="0.8"
          [delay]="0.3"
        >
          Powerful features designed to help you build faster, scale easier, and
          deliver exceptional experiences.
        </p>
      </div>

      <!-- Feature Cards Grid -->
      <div class="cards-grid">
        @for (feature of features; track feature.title; let i = $index) {
        <div
          class="feature-card"
          viewportAnimation
          [animationType]="'fade-up'"
          [duration]="0.6"
          [delay]="0.1 + i * 0.1"
          scrollAnimation
          [animationConfig]="{
            trigger: { start: 'top 90%', end: 'bottom 10%', scrub: false },
            animation: {}
          }"
        >
          <!-- Icon Container -->
          <div class="card-icon" [style.background]="feature.iconBg">
            <span class="icon">{{ feature.icon }}</span>
          </div>

          <!-- Card Content -->
          <h3 class="card-title">{{ feature.title }}</h3>
          <p class="card-description">{{ feature.description }}</p>

          <!-- Card Footer -->
          <div class="card-footer">
            <a href="#" class="card-link">
              Learn more
              <span class="link-arrow">→</span>
            </a>
          </div>

          <!-- Hover Glow Effect -->
          <div class="card-glow" [style.background]="feature.glowColor"></div>
        </div>
        }
      </div>

      <!-- Bottom CTA -->
      <div
        class="section-cta"
        viewportAnimation
        [animationType]="'fade-up'"
        [duration]="0.8"
        [delay]="0.5"
      >
        <p>Want to see all features?</p>
        <button class="btn-outline">View All Features</button>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .feature-showcase {
        padding: 6rem 2rem;
        background: linear-gradient(180deg, #0a0a1a 0%, #1a1a2e 100%);
        color: white;
      }

      /* Section Header */
      .section-header {
        text-align: center;
        max-width: 700px;
        margin: 0 auto 4rem;
      }

      .section-tag {
        display: inline-block;
        padding: 0.5rem 1.25rem;
        background: rgba(99, 102, 241, 0.15);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 600;
        color: #a5b4fc;
        margin-bottom: 1.5rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .section-title {
        font-size: 3rem;
        font-weight: 800;
        line-height: 1.2;
        margin-bottom: 1rem;
      }

      .highlight {
        background: linear-gradient(135deg, #6366f1, #ec4899);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .section-description {
        font-size: 1.125rem;
        line-height: 1.7;
        opacity: 0.7;
      }

      /* Cards Grid */
      .cards-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 2rem;
        max-width: 1200px;
        margin: 0 auto;
      }

      @media (max-width: 1024px) {
        .cards-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .cards-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Feature Card */
      .feature-card {
        position: relative;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 1.5rem;
        padding: 2rem;
        overflow: hidden;
        transition: transform 0.3s ease, border-color 0.3s ease;
      }

      .feature-card:hover {
        transform: translateY(-8px);
        border-color: rgba(99, 102, 241, 0.3);
      }

      .feature-card:hover .card-glow {
        opacity: 0.15;
      }

      .feature-card:hover .link-arrow {
        transform: translateX(4px);
      }

      /* Card Glow */
      .card-glow {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 200px;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
        filter: blur(60px);
      }

      /* Icon */
      .card-icon {
        width: 56px;
        height: 56px;
        border-radius: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 1.5rem;
      }

      .icon {
        font-size: 1.5rem;
      }

      /* Card Content */
      .card-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin-bottom: 0.75rem;
      }

      .card-description {
        font-size: 0.9375rem;
        line-height: 1.6;
        opacity: 0.7;
        margin-bottom: 1.5rem;
      }

      /* Card Footer */
      .card-footer {
        margin-top: auto;
      }

      .card-link {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: #a5b4fc;
        font-size: 0.875rem;
        font-weight: 600;
        text-decoration: none;
        transition: color 0.2s;
      }

      .card-link:hover {
        color: #c7d2fe;
      }

      .link-arrow {
        transition: transform 0.2s;
      }

      /* Section CTA */
      .section-cta {
        text-align: center;
        margin-top: 4rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
      }

      .section-cta p {
        opacity: 0.6;
        font-size: 0.9375rem;
      }

      .btn-outline {
        padding: 0.875rem 2rem;
        background: transparent;
        color: white;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 0.75rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-outline:hover {
        border-color: #6366f1;
        background: rgba(99, 102, 241, 0.1);
      }
    `,
  ],
})
export class FeatureShowcaseCardsComponent {
  features = [
    {
      icon: '⚡',
      title: 'Lightning Fast',
      description:
        'Built for speed with optimized performance. Load times under 100ms guaranteed.',
      iconBg:
        'linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(234, 179, 8, 0.2))',
      glowColor: 'rgba(250, 204, 21, 0.5)',
    },
    {
      icon: '🔒',
      title: 'Enterprise Security',
      description:
        'Bank-level encryption and security protocols to keep your data safe.',
      iconBg:
        'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(22, 163, 74, 0.2))',
      glowColor: 'rgba(34, 197, 94, 0.5)',
    },
    {
      icon: '🎨',
      title: 'Beautiful Design',
      description:
        'Stunning interfaces crafted by world-class designers. Fully customizable.',
      iconBg:
        'linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(219, 39, 119, 0.2))',
      glowColor: 'rgba(236, 72, 153, 0.5)',
    },
    {
      icon: '📊',
      title: 'Advanced Analytics',
      description:
        'Deep insights into your data with real-time dashboards and reports.',
      iconBg:
        'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(79, 70, 229, 0.2))',
      glowColor: 'rgba(99, 102, 241, 0.5)',
    },
    {
      icon: '🔄',
      title: 'Seamless Sync',
      description:
        'Real-time synchronization across all your devices and platforms.',
      iconBg:
        'linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(2, 132, 199, 0.2))',
      glowColor: 'rgba(14, 165, 233, 0.5)',
    },
    {
      icon: '🚀',
      title: 'Scale Infinitely',
      description:
        'From startup to enterprise, our platform grows with your needs.',
      iconBg:
        'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(147, 51, 234, 0.2))',
      glowColor: 'rgba(168, 85, 247, 0.5)',
    },
  ];
}
