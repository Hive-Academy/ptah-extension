/**
 * Split Panel Timeline Section Template
 *
 * Animation Type: Split Panel / Timeline / Scroll Story
 * Best For: About pages, history/timeline, feature comparisons
 *
 * Key Features:
 * - Pinned left panel with changing content
 * - Right panel scrolls through timeline items
 * - Progress indicator synced to scroll position
 * - Smooth transitions between timeline points
 * - Content reveals on each step
 *
 * Customization Points:
 * - Panel ratio: Adjust grid-template-columns
 * - Pin duration: Change pinSpacing and scroll length
 * - Content animations: Modify reveal types and timing
 * - Timeline styling: Update colors, indicators, connectors
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-split-panel-timeline',
  standalone: true,
  imports: [CommonModule, ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="split-timeline">
      <!-- ============ FIXED LEFT PANEL ============ -->
      <div
        class="left-panel"
        scrollAnimation
        [animationConfig]="{
          trigger: {
            start: 'top top',
            end: 'bottom bottom',
            scrub: true,
            pin: true,
            pinSpacing: false
          },
          animation: {}
        }"
      >
        <div class="panel-content">
          <h2
            viewportAnimation
            [animationType]="'fade-right'"
            [duration]="0.8"
            [delay]="0.2"
          >
            Our Journey
          </h2>

          <p
            class="panel-description"
            viewportAnimation
            [animationType]="'fade-right'"
            [duration]="0.8"
            [delay]="0.4"
          >
            Discover the milestones that shaped our vision and defined our path
            forward.
          </p>

          <!-- Progress Indicator -->
          <div class="progress-track">
            @for (item of timelineItems; track item.year; let i = $index) {
            <div class="progress-step" [class.active]="activeStep() >= i">
              <div class="step-dot"></div>
              <span class="step-year">{{ item.year }}</span>
            </div>
            }
            <div
              class="progress-line"
              [style.height.%]="progressHeight()"
            ></div>
          </div>

          <!-- Active Item Preview -->
          <div class="active-preview">
            <div class="preview-image">
              <img [src]="timelineItems[activeStep()].image" alt="" />
            </div>
          </div>
        </div>
      </div>

      <!-- ============ SCROLLING RIGHT PANEL ============ -->
      <div class="right-panel">
        @for (item of timelineItems; track item.year; let i = $index) {
        <div
          class="timeline-item"
          scrollAnimation
          [animationConfig]="{
            trigger: {
              start: 'top center',
              end: 'bottom center',
              toggleActions: 'play none none reverse',
              onEnter: 'updateStep(' + i + ')'
            },
            animation: {}
          }"
        >
          <div
            class="item-content"
            viewportAnimation
            [animationType]="'fade-up'"
            [duration]="0.8"
            [delay]="0.1"
          >
            <div class="item-header">
              <span class="item-year">{{ item.year }}</span>
              <h3 class="item-title">{{ item.title }}</h3>
            </div>

            <p class="item-description">{{ item.description }}</p>

            <div class="item-stats">
              @for (stat of item.stats; track stat.label) {
              <div class="stat">
                <span class="stat-value">{{ stat.value }}</span>
                <span class="stat-label">{{ stat.label }}</span>
              </div>
              }
            </div>

            @if (item.features) {
            <ul class="item-features">
              @for (feature of item.features; track feature) {
              <li>
                <span class="feature-icon">✓</span>
                {{ feature }}
              </li>
              }
            </ul>
            }
          </div>
        </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .split-timeline {
        display: grid;
        grid-template-columns: 1fr 1fr;
        min-height: 300vh;
        background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
      }

      /* Left Panel */
      .left-panel {
        height: 100vh;
        background: linear-gradient(180deg, #0f0f23 0%, #1a1a2e 100%);
        border-right: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .panel-content {
        padding: 4rem;
        max-width: 500px;
        color: white;
      }

      .panel-content h2 {
        font-size: 3rem;
        font-weight: 800;
        margin-bottom: 1rem;
        background: linear-gradient(135deg, #6366f1, #ec4899);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .panel-description {
        font-size: 1.125rem;
        line-height: 1.7;
        opacity: 0.7;
        margin-bottom: 3rem;
      }

      /* Progress Track */
      .progress-track {
        position: relative;
        padding-left: 2rem;
        margin-bottom: 3rem;
      }

      .progress-step {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
        position: relative;
      }

      .step-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        transition: all 0.3s ease;
        position: relative;
        z-index: 2;
      }

      .progress-step.active .step-dot {
        background: #6366f1;
        border-color: #6366f1;
        box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
      }

      .step-year {
        font-size: 0.875rem;
        font-weight: 600;
        opacity: 0.5;
        transition: opacity 0.3s;
      }

      .progress-step.active .step-year {
        opacity: 1;
        color: #a5b4fc;
      }

      .progress-line {
        position: absolute;
        left: 5px;
        top: 0;
        width: 2px;
        background: linear-gradient(180deg, #6366f1, #8b5cf6);
        transition: height 0.5s ease;
      }

      /* Active Preview */
      .active-preview {
        margin-top: 2rem;
      }

      .preview-image {
        width: 100%;
        aspect-ratio: 16/9;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 1rem;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .preview-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      /* Right Panel */
      .right-panel {
        padding: 0 4rem;
      }

      .timeline-item {
        min-height: 100vh;
        display: flex;
        align-items: center;
        padding: 4rem 0;
      }

      .item-content {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 1.5rem;
        padding: 3rem;
        color: white;
        backdrop-filter: blur(10px);
      }

      .item-header {
        margin-bottom: 1.5rem;
      }

      .item-year {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: rgba(99, 102, 241, 0.2);
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 600;
        color: #a5b4fc;
        margin-bottom: 0.75rem;
      }

      .item-title {
        font-size: 2rem;
        font-weight: 700;
      }

      .item-description {
        font-size: 1.125rem;
        line-height: 1.7;
        opacity: 0.8;
        margin-bottom: 2rem;
      }

      .item-stats {
        display: flex;
        gap: 2rem;
        margin-bottom: 2rem;
        padding: 1.5rem;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 1rem;
      }

      .stat {
        display: flex;
        flex-direction: column;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #a5b4fc;
      }

      .stat-label {
        font-size: 0.875rem;
        opacity: 0.6;
      }

      .item-features {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
      }

      .item-features li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9375rem;
        opacity: 0.8;
      }

      .feature-icon {
        color: #10b981;
        font-weight: bold;
      }

      /* Responsive */
      @media (max-width: 1024px) {
        .split-timeline {
          grid-template-columns: 1fr;
        }

        .left-panel {
          display: none;
        }

        .right-panel {
          padding: 2rem;
        }

        .timeline-item {
          min-height: auto;
          padding: 2rem 0;
        }
      }
    `,
  ],
})
export class SplitPanelTimelineComponent {
  activeStep = signal(0);

  timelineItems = [
    {
      year: '2020',
      title: 'The Beginning',
      description:
        'Started with a vision to revolutionize the industry. Our small team of passionate developers began building the foundation.',
      image: '/assets/timeline/2020.jpg',
      stats: [
        { value: '3', label: 'Team Members' },
        { value: '1', label: 'Product' },
      ],
      features: ['Initial concept', 'First prototype', 'Seed funding'],
    },
    {
      year: '2021',
      title: 'First Milestone',
      description:
        'Launched our beta version to select partners. Received invaluable feedback that shaped our product roadmap.',
      image: '/assets/timeline/2021.jpg',
      stats: [
        { value: '500+', label: 'Beta Users' },
        { value: '12', label: 'Partners' },
      ],
      features: ['Beta launch', 'Partner program', 'Core features'],
    },
    {
      year: '2022',
      title: 'Rapid Growth',
      description:
        'Expanded our team and product offerings. Reached our first 10,000 users and established key enterprise partnerships.',
      image: '/assets/timeline/2022.jpg',
      stats: [
        { value: '10K', label: 'Users' },
        { value: '25', label: 'Team Size' },
      ],
      features: ['Enterprise tier', 'API launch', 'Global expansion'],
    },
    {
      year: '2023',
      title: 'Industry Leader',
      description:
        'Recognized as a leader in our space. Launched innovative features that set new industry standards.',
      image: '/assets/timeline/2023.jpg',
      stats: [
        { value: '50K+', label: 'Users' },
        { value: '#1', label: 'Rating' },
      ],
      features: ['AI integration', 'Mobile apps', 'Award winning'],
    },
    {
      year: '2024',
      title: 'The Future',
      description:
        'Continuing to push boundaries with cutting-edge technology. Our vision for the next decade is just beginning.',
      image: '/assets/timeline/2024.jpg',
      stats: [
        { value: '100K+', label: 'Users' },
        { value: '∞', label: 'Possibilities' },
      ],
      features: ['Next-gen platform', 'Global team', 'Innovation labs'],
    },
  ];

  progressHeight(): number {
    const totalSteps = this.timelineItems.length;
    const step = this.activeStep();
    return ((step + 1) / totalSteps) * 100;
  }

  updateStep(index: number): void {
    this.activeStep.set(index);
  }
}
