/**
 * Parallax Hero Section Template
 *
 * Animation Type: Parallax Scrolling / Layered Depth
 * Best For: Landing page heroes, portfolio headers, immersive intros
 *
 * Key Features:
 * - Multiple parallax layers at different speeds
 * - Background image/gradient with depth effect
 * - Foreground content with stagger animations
 * - Ambient floating elements for visual interest
 * - Smooth fade-out as user scrolls
 *
 * Customization Points:
 * - Parallax speeds: Adjust scrub values for different depths
 * - Layer count: Add/remove layers for more/less depth
 * - Content timing: Modify stagger delays
 * - Colors: Update gradients and accent colors
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'app-parallax-hero',
  standalone: true,
  imports: [CommonModule, ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="parallax-hero">
      <!-- ============ PARALLAX LAYERS ============ -->

      <!-- Layer 1: Background (slowest) -->
      <div
        class="parallax-layer layer-bg"
        scrollAnimation
        [animationConfig]="{
          trigger: { start: 'top top', end: 'bottom top', scrub: 1 },
          animation: { y: '30%' }
        }"
      >
        <div class="gradient-orb orb-1"></div>
        <div class="gradient-orb orb-2"></div>
        <div class="gradient-orb orb-3"></div>
      </div>

      <!-- Layer 2: Stars/Particles (slow) -->
      <div
        class="parallax-layer layer-particles"
        scrollAnimation
        [animationConfig]="{
          trigger: { start: 'top top', end: 'bottom top', scrub: 1 },
          animation: { y: '50%' }
        }"
      >
        @for (star of stars; track star.id) {
        <div
          class="star"
          [style.left.%]="star.x"
          [style.top.%]="star.y"
          [style.width.px]="star.size"
          [style.height.px]="star.size"
          [style.animationDelay.s]="star.delay"
        ></div>
        }
      </div>

      <!-- Layer 3: Floating Elements (medium) -->
      <div
        class="parallax-layer layer-float"
        scrollAnimation
        [animationConfig]="{
          trigger: { start: 'top top', end: 'bottom top', scrub: 1 },
          animation: { y: '80%' }
        }"
      >
        @for (element of floatingElements; track element.id) {
        <div
          class="float-element"
          [style.left.%]="element.x"
          [style.top.%]="element.y"
          [style.width.px]="element.size"
          [style.height.px]="element.size"
          [style.background]="element.color"
          [style.animationDuration.s]="element.duration"
        ></div>
        }
      </div>

      <!-- Layer 4: Content (faster - moves with scroll) -->
      <div
        class="parallax-layer layer-content"
        scrollAnimation
        [animationConfig]="{
          trigger: { start: 'top top', end: 'bottom top', scrub: 1 },
          animation: { y: '100%', opacity: 0 }
        }"
      >
        <div class="hero-content">
          <span
            class="hero-tag"
            viewportAnimation
            [animationType]="'fade-down'"
            [duration]="0.6"
            [delay]="0.2"
          >
            Welcome to the Future
          </span>

          <h1
            class="hero-title"
            viewportAnimation
            [animationType]="'fade-up'"
            [duration]="0.8"
            [delay]="0.4"
          >
            Create Stunning
            <span class="highlight">Experiences</span>
          </h1>

          <p
            class="hero-description"
            viewportAnimation
            [animationType]="'fade-up'"
            [duration]="0.8"
            [delay]="0.6"
          >
            Build immersive, scroll-driven animations that captivate your
            audience and bring your vision to life.
          </p>

          <div
            class="hero-cta"
            viewportAnimation
            [animationType]="'fade-up'"
            [duration]="0.8"
            [delay]="0.8"
          >
            <button class="btn-primary">
              Get Started
              <span class="btn-arrow">→</span>
            </button>
            <button class="btn-ghost">Watch Demo</button>
          </div>

          <div
            class="hero-stats"
            viewportAnimation
            [animationType]="'fade-up'"
            [duration]="0.8"
            [delay]="1"
          >
            <div class="stat">
              <span class="stat-value">10K+</span>
              <span class="stat-label">Users</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat">
              <span class="stat-value">99%</span>
              <span class="stat-label">Satisfaction</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat">
              <span class="stat-value">24/7</span>
              <span class="stat-label">Support</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll Indicator -->
      <div class="scroll-indicator">
        <div class="mouse">
          <div class="wheel"></div>
        </div>
        <span>Scroll to explore</span>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .parallax-hero {
        position: relative;
        height: 100vh;
        min-height: 800px;
        overflow: hidden;
        background: linear-gradient(
          135deg,
          #0a0a1a 0%,
          #1a1a2e 50%,
          #0f0f23 100%
        );
      }

      /* Parallax Layers */
      .parallax-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .layer-content {
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* Background Orbs */
      .gradient-orb {
        position: absolute;
        border-radius: 50%;
        filter: blur(80px);
        opacity: 0.5;
      }

      .orb-1 {
        width: 600px;
        height: 600px;
        background: radial-gradient(circle, #6366f1 0%, transparent 70%);
        top: -20%;
        left: -10%;
      }

      .orb-2 {
        width: 500px;
        height: 500px;
        background: radial-gradient(circle, #ec4899 0%, transparent 70%);
        top: 30%;
        right: -10%;
      }

      .orb-3 {
        width: 400px;
        height: 400px;
        background: radial-gradient(circle, #8b5cf6 0%, transparent 70%);
        bottom: -10%;
        left: 30%;
      }

      /* Stars */
      .star {
        position: absolute;
        background: white;
        border-radius: 50%;
        animation: twinkle 3s ease-in-out infinite;
      }

      @keyframes twinkle {
        0%,
        100% {
          opacity: 0.3;
          transform: scale(1);
        }
        50% {
          opacity: 1;
          transform: scale(1.2);
        }
      }

      /* Floating Elements */
      .float-element {
        position: absolute;
        border-radius: 50%;
        opacity: 0.6;
        animation: float 6s ease-in-out infinite;
      }

      @keyframes float {
        0%,
        100% {
          transform: translateY(0) rotate(0deg);
        }
        50% {
          transform: translateY(-20px) rotate(180deg);
        }
      }

      /* Hero Content */
      .hero-content {
        text-align: center;
        max-width: 900px;
        padding: 2rem;
        color: white;
      }

      .hero-tag {
        display: inline-block;
        padding: 0.5rem 1.5rem;
        background: rgba(99, 102, 241, 0.2);
        border: 1px solid rgba(99, 102, 241, 0.4);
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 500;
        letter-spacing: 0.05em;
        color: #a5b4fc;
        margin-bottom: 1.5rem;
      }

      .hero-title {
        font-size: 4.5rem;
        font-weight: 800;
        line-height: 1.1;
        margin-bottom: 1.5rem;
      }

      .highlight {
        background: linear-gradient(135deg, #6366f1, #ec4899);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .hero-description {
        font-size: 1.25rem;
        line-height: 1.7;
        opacity: 0.8;
        max-width: 600px;
        margin: 0 auto 2rem;
      }

      /* CTA Buttons */
      .hero-cta {
        display: flex;
        gap: 1rem;
        justify-content: center;
        margin-bottom: 3rem;
      }

      .btn-primary {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem 2rem;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
        border: none;
        border-radius: 0.75rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
      }

      .btn-arrow {
        transition: transform 0.2s;
      }

      .btn-primary:hover .btn-arrow {
        transform: translateX(4px);
      }

      .btn-ghost {
        padding: 1rem 2rem;
        background: transparent;
        color: white;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 0.75rem;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.2s, background 0.2s;
      }

      .btn-ghost:hover {
        border-color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.05);
      }

      /* Stats */
      .hero-stats {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2rem;
      }

      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
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

      .stat-divider {
        width: 1px;
        height: 40px;
        background: rgba(255, 255, 255, 0.2);
      }

      /* Scroll Indicator */
      .scroll-indicator {
        position: absolute;
        bottom: 2rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.75rem;
      }

      .mouse {
        width: 24px;
        height: 40px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 12px;
        display: flex;
        justify-content: center;
        padding-top: 8px;
      }

      .wheel {
        width: 4px;
        height: 8px;
        background: rgba(255, 255, 255, 0.5);
        border-radius: 2px;
        animation: scroll-wheel 2s ease-in-out infinite;
      }

      @keyframes scroll-wheel {
        0%,
        100% {
          transform: translateY(0);
          opacity: 1;
        }
        50% {
          transform: translateY(10px);
          opacity: 0.3;
        }
      }
    `,
  ],
})
export class ParallaxHeroComponent {
  stars = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    delay: Math.random() * 3,
  }));

  floatingElements = [
    {
      id: 1,
      x: 10,
      y: 20,
      size: 60,
      color: 'rgba(99, 102, 241, 0.3)',
      duration: 8,
    },
    {
      id: 2,
      x: 80,
      y: 15,
      size: 40,
      color: 'rgba(236, 72, 153, 0.3)',
      duration: 6,
    },
    {
      id: 3,
      x: 25,
      y: 70,
      size: 50,
      color: 'rgba(139, 92, 246, 0.3)',
      duration: 7,
    },
    {
      id: 4,
      x: 70,
      y: 60,
      size: 35,
      color: 'rgba(99, 102, 241, 0.2)',
      duration: 9,
    },
    {
      id: 5,
      x: 45,
      y: 40,
      size: 45,
      color: 'rgba(236, 72, 153, 0.2)',
      duration: 5,
    },
  ];
}
