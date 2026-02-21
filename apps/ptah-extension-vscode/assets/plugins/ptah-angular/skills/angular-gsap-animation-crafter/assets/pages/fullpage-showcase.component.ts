/**
 * Fullpage Showcase Landing Page Template
 *
 * Animation Type: Fullpage Scroll / Section-by-Section
 * Best For: Product showcases, feature pages, portfolio sites
 *
 * Key Features:
 * - HijackedScrollContainer for smooth fullpage transitions
 * - Each section takes full viewport height
 * - Content reveals timed with section transitions
 * - Progress indicators with scroll position
 * - Mobile-friendly touch gestures
 *
 * Customization Points:
 * - Section duration: Time spent scrolling through each section
 * - Easing: Change transition feel (power2, elastic, etc.)
 * - Content animations: Modify reveal delays and durations
 * - Colors: Update gradient backgrounds for branding
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  HijackedScrollContainerComponent,
  HijackedScrollSectionComponent,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-fullpage-showcase',
  standalone: true,
  imports: [
    CommonModule,
    HijackedScrollContainerComponent,
    HijackedScrollSectionComponent,
    ViewportAnimationDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="showcase-wrapper">
      <!-- Progress Indicator -->
      <div class="progress-indicator">
        @for (section of sections; track section.id; let i = $index) {
        <button
          class="progress-dot"
          [class.active]="currentSection() === i"
          (click)="scrollToSection(i)"
        >
          <span class="sr-only">Section {{ i + 1 }}</span>
        </button>
        }
      </div>

      <!-- Fullpage Scroll Container -->
      <gsap-hijacked-scroll-container
        [duration]="1.5"
        [ease]="'power2.inOut'"
        [snapDelay]="0.3"
        (sectionChange)="onSectionChange($event)"
      >
        <!-- Hero Section -->
        <gsap-hijacked-scroll-section>
          <div class="section section-hero">
            <div class="section-content">
              <h1
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="1"
                [delay]="0.2"
              >
                Your Product Name
              </h1>
              <p
                class="subtitle"
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.8"
                [delay]="0.4"
              >
                The future of [industry] is here
              </p>
              <div
                class="cta-group"
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.8"
                [delay]="0.6"
              >
                <button class="btn-primary">Get Started</button>
                <button class="btn-secondary">Learn More</button>
              </div>
            </div>
            <div class="scroll-hint">
              <span>Scroll to explore</span>
              <div class="scroll-arrow">↓</div>
            </div>
          </div>
        </gsap-hijacked-scroll-section>

        <!-- Feature 1 Section -->
        <gsap-hijacked-scroll-section>
          <div class="section section-feature-1">
            <div class="section-grid">
              <div class="feature-visual">
                <div
                  class="feature-image"
                  viewportAnimation
                  [animationType]="'scale'"
                  [duration]="1.2"
                  [delay]="0.2"
                ></div>
              </div>
              <div class="feature-content">
                <span
                  class="feature-tag"
                  viewportAnimation
                  [animationType]="'fade-right'"
                  [duration]="0.6"
                  [delay]="0.3"
                >
                  Feature One
                </span>
                <h2
                  viewportAnimation
                  [animationType]="'fade-right'"
                  [duration]="0.8"
                  [delay]="0.4"
                >
                  Revolutionary Technology
                </h2>
                <p
                  viewportAnimation
                  [animationType]="'fade-right'"
                  [duration]="0.8"
                  [delay]="0.5"
                >
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
                  do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                </p>
              </div>
            </div>
          </div>
        </gsap-hijacked-scroll-section>

        <!-- Feature 2 Section -->
        <gsap-hijacked-scroll-section>
          <div class="section section-feature-2">
            <div class="section-grid reversed">
              <div class="feature-content">
                <span
                  class="feature-tag"
                  viewportAnimation
                  [animationType]="'fade-left'"
                  [duration]="0.6"
                  [delay]="0.3"
                >
                  Feature Two
                </span>
                <h2
                  viewportAnimation
                  [animationType]="'fade-left'"
                  [duration]="0.8"
                  [delay]="0.4"
                >
                  Seamless Integration
                </h2>
                <p
                  viewportAnimation
                  [animationType]="'fade-left'"
                  [duration]="0.8"
                  [delay]="0.5"
                >
                  Ut enim ad minim veniam, quis nostrud exercitation ullamco
                  laboris nisi ut aliquip ex ea commodo consequat.
                </p>
              </div>
              <div class="feature-visual">
                <div
                  class="feature-image"
                  viewportAnimation
                  [animationType]="'scale'"
                  [duration]="1.2"
                  [delay]="0.2"
                ></div>
              </div>
            </div>
          </div>
        </gsap-hijacked-scroll-section>

        <!-- Stats Section -->
        <gsap-hijacked-scroll-section>
          <div class="section section-stats">
            <h2
              class="stats-title"
              viewportAnimation
              [animationType]="'fade-up'"
              [duration]="0.8"
              [delay]="0.2"
            >
              Trusted by thousands
            </h2>
            <div class="stats-grid">
              @for (stat of stats; track stat.label; let i = $index) {
              <div
                class="stat-item"
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.6"
                [delay]="0.3 + i * 0.1"
              >
                <div class="stat-number">{{ stat.value }}</div>
                <div class="stat-label">{{ stat.label }}</div>
              </div>
              }
            </div>
          </div>
        </gsap-hijacked-scroll-section>

        <!-- CTA Section -->
        <gsap-hijacked-scroll-section>
          <div class="section section-cta">
            <div class="cta-content">
              <h2
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.8"
                [delay]="0.2"
              >
                Ready to get started?
              </h2>
              <p
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.6"
                [delay]="0.4"
              >
                Join thousands of satisfied customers today
              </p>
              <button
                class="btn-primary large"
                viewportAnimation
                [animationType]="'fade-up'"
                [duration]="0.6"
                [delay]="0.6"
              >
                Start Your Free Trial
              </button>
            </div>
          </div>
        </gsap-hijacked-scroll-section>
      </gsap-hijacked-scroll-container>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .showcase-wrapper {
        position: relative;
      }

      /* Progress Indicator */
      .progress-indicator {
        position: fixed;
        right: 2rem;
        top: 50%;
        transform: translateY(-50%);
        z-index: 100;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .progress-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.5);
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .progress-dot.active {
        background: white;
        transform: scale(1.3);
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }

      /* Sections */
      .section {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        padding: 4rem;
      }

      .section-hero {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: white;
        flex-direction: column;
      }

      .section-feature-1 {
        background: linear-gradient(135deg, #0f3460 0%, #1a1a2e 100%);
        color: white;
      }

      .section-feature-2 {
        background: linear-gradient(135deg, #16213e 0%, #0f3460 100%);
        color: white;
      }

      .section-stats {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        color: white;
        flex-direction: column;
      }

      .section-cta {
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: white;
      }

      /* Hero Content */
      .section-content {
        text-align: center;
        max-width: 800px;
      }

      .section-content h1 {
        font-size: 4rem;
        font-weight: bold;
        margin-bottom: 1rem;
      }

      .subtitle {
        font-size: 1.5rem;
        opacity: 0.8;
        margin-bottom: 2rem;
      }

      .cta-group {
        display: flex;
        gap: 1rem;
        justify-content: center;
      }

      .btn-primary {
        padding: 1rem 2rem;
        background: #6366f1;
        color: white;
        border: none;
        border-radius: 0.5rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
      }

      .btn-primary.large {
        padding: 1.25rem 3rem;
        font-size: 1.25rem;
      }

      .btn-secondary {
        padding: 1rem 2rem;
        background: transparent;
        color: white;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 0.5rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
      }

      .btn-secondary:hover {
        border-color: white;
        background: rgba(255, 255, 255, 0.1);
      }

      /* Scroll Hint */
      .scroll-hint {
        position: absolute;
        bottom: 3rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        opacity: 0.6;
      }

      .scroll-arrow {
        animation: bounce 2s infinite;
      }

      @keyframes bounce {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(10px);
        }
      }

      /* Feature Grid */
      .section-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4rem;
        max-width: 1200px;
        width: 100%;
        align-items: center;
      }

      .section-grid.reversed {
        direction: rtl;
      }

      .section-grid.reversed > * {
        direction: ltr;
      }

      .feature-visual {
        display: flex;
        justify-content: center;
      }

      .feature-image {
        width: 400px;
        height: 300px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 1rem;
        backdrop-filter: blur(10px);
      }

      .feature-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .feature-tag {
        font-size: 0.875rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #a78bfa;
      }

      .feature-content h2 {
        font-size: 2.5rem;
        font-weight: bold;
      }

      .feature-content p {
        font-size: 1.125rem;
        opacity: 0.8;
        line-height: 1.7;
      }

      /* Stats */
      .stats-title {
        font-size: 2.5rem;
        font-weight: bold;
        margin-bottom: 3rem;
        text-align: center;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 3rem;
        max-width: 1000px;
      }

      .stat-item {
        text-align: center;
      }

      .stat-number {
        font-size: 3rem;
        font-weight: bold;
        color: #a78bfa;
      }

      .stat-label {
        font-size: 1rem;
        opacity: 0.7;
        margin-top: 0.5rem;
      }

      /* CTA */
      .cta-content {
        text-align: center;
        max-width: 600px;
      }

      .cta-content h2 {
        font-size: 3rem;
        font-weight: bold;
        margin-bottom: 1rem;
      }

      .cta-content p {
        font-size: 1.25rem;
        opacity: 0.9;
        margin-bottom: 2rem;
      }
    `,
  ],
})
export class FullpageShowcaseComponent {
  currentSection = signal(0);

  sections = [
    { id: 'hero' },
    { id: 'feature-1' },
    { id: 'feature-2' },
    { id: 'stats' },
    { id: 'cta' },
  ];

  stats = [
    { value: '10K+', label: 'Active Users' },
    { value: '99.9%', label: 'Uptime' },
    { value: '50+', label: 'Integrations' },
    { value: '24/7', label: 'Support' },
  ];

  onSectionChange(index: number): void {
    this.currentSection.set(index);
  }

  scrollToSection(index: number): void {
    // The HijackedScrollContainer handles this via API
    console.log('Navigate to section:', index);
  }
}
