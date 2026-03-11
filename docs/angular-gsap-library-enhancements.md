# Angular GSAP Library Enhancement Specification

**Document Version**: 1.0  
**Target Library**: `@hive-academy/angular-gsap`  
**Current Version**: `^1.1.0`  
**Author**: Extracted from Ptah Extension Project  
**Date**: January 2026

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Custom Implementation Extracts](#custom-implementation-extracts)
   - [Orbital Animation with Mouse Tracking](#1-orbital-animation-with-mouse-tracking)
   - [Centralized Animation Presets](#2-centralized-animation-presets)
   - [Index-Based Staggered Configs](#3-index-based-staggered-configs)
   - [Scroll Exit Animations](#4-scroll-exit-animations)
3. [Proposed New Directives](#proposed-new-directives)
   - [OrbitAnimationDirective](#1-orbitanimationdirective)
   - [MouseParallaxDirective](#2-mouseparallaxdirective)
   - [ScrollExitDirective](#3-scrollexitdirective)
4. [Proposed Utility Functions](#proposed-utility-functions)
5. [Proposed Animation Presets System](#proposed-animation-presets-system)
6. [Implementation Priority](#implementation-priority)

---

## Executive Summary

This document extracts custom GSAP animation implementations from the Ptah Extension project that extend beyond the current `@hive-academy/angular-gsap` library capabilities. These implementations represent real-world patterns that should be incorporated into the library for broader reuse.

### Key Enhancements Identified

| Enhancement              | Type                | Complexity | Impact    |
| ------------------------ | ------------------- | ---------- | --------- |
| Orbital Animation        | New Directive       | High       | Medium    |
| Mouse Parallax           | New Directive       | Medium     | High      |
| Scroll Exit              | Directive Extension | Low        | High      |
| Animation Presets        | Provider/Utility    | Medium     | Very High |
| Staggered Config Factory | Utility Function    | Low        | High      |

---

## Custom Implementation Extracts

### 1. Orbital Animation with Mouse Tracking

**Source File**: `apps/ptah-landing-page/src/app/sections/hero/hero-floating-images.component.ts`

**Full Implementation**:

```typescript
import { Component, ChangeDetectionStrategy, signal, afterNextRender, OnDestroy, inject, PLATFORM_ID, ElementRef } from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import { GsapCoreService } from '@hive-academy/angular-gsap';

/**
 * Configuration for a floating image in the orbital animation
 */
interface FloatingImage {
  /** Image source path */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Size in pixels */
  size: number;
  /** Starting angle offset in degrees (0, 90, 180, 270 for 4 images) */
  angleOffset: number;
  /** Image rotation for visual interest */
  rotation: number;
  /** Slide direction for entrance animation */
  slideDirection: 'slideLeft' | 'slideRight';
}

/**
 * HeroFloatingImagesComponent - Orbital Egyptian symbols around hero
 *
 * Features:
 * - 4 floating images orbiting around hero center (race track style)
 * - Continuous clockwise rotation (20 seconds per full orbit)
 * - Mouse-controlled orbit radius (center = smaller, edges = larger)
 * - Viewport entrance animation using ViewportAnimationDirective
 * - Circular images with amber glow effect
 * - Respects prefers-reduced-motion
 */
@Component({
  selector: 'ptah-hero-floating-images',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <div class="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <!-- Orbit container centered on hero -->
      <div class="orbit-container absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        @for (image of floatingImages; track image.src; let i = $index) {
        <!-- Orbit item - positioned and animated via GSAP -->
        <div class="orbit-item absolute" [attr.data-index]="i" [attr.data-direction]="image.slideDirection">
          <!-- Floating image -->
          <div class="floating-image" [style.width.px]="image.size" [style.height.px]="image.size" [style.opacity]="reducedMotion() ? 0.6 : 0.85" [style.marginLeft.px]="-image.size / 2" [style.marginTop.px]="-image.size / 2">
            <div class="relative w-full h-full rounded-full overflow-hidden shadow-2xl" [style.transform]="'rotate(' + image.rotation + 'deg)'">
              <!-- Glow effect -->
              <div class="absolute -inset-2 rounded-full bg-amber-500/20 blur-xl"></div>

              <!-- Image container with border -->
              <div class="relative w-full h-full rounded-full overflow-hidden border-2 border-amber-500/30">
                <img [ngSrc]="image.src" [alt]="image.alt" fill class="object-cover" priority />
              </div>
            </div>
          </div>
        </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
        z-index: 4;
      }

      .orbit-container {
        width: 0;
        height: 0;
      }

      .orbit-item {
        top: 0;
        left: 0;
        will-change: transform;
      }

      .floating-image {
        will-change: transform;
      }

      /* Reduced motion - disable animations */
      @media (prefers-reduced-motion: reduce) {
        .orbit-item,
        .floating-image {
          animation: none !important;
          transform: none !important;
        }
      }
    `,
  ],
})
export class HeroFloatingImagesComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);
  private readonly gsapCore = inject(GsapCoreService);

  /** Whether user prefers reduced motion */
  public readonly reducedMotion = signal(false);

  /** Current orbit radius (controlled by mouse) */
  private readonly currentRadius = signal(280);

  /** Orbit configuration */
  private readonly MIN_RADIUS = 430;
  private readonly MAX_RADIUS = 260;
  private readonly ROTATION_DURATION = 25; // seconds for full orbit

  /** GSAP animation timeline */
  private orbitTimeline: gsap.core.Timeline | null = null;

  /** GSAP quickTo for smooth radius transitions */
  private radiusQuickTo: gsap.QuickToFunc | null = null;

  /** Mouse move listener cleanup */
  private mouseMoveCleanup: (() => void) | null = null;

  /** Current angle offset for the orbit (0-360) */
  private currentAngle = 0;

  /** Configuration for all floating images in orbital animation */
  public readonly floatingImages: FloatingImage[] = [
    {
      src: '/assets/textures/ankh-sphere.png',
      alt: 'Ankh symbol',
      size: 180,
      angleOffset: 0, // 12 o'clock position
      rotation: -10,
      slideDirection: 'slideRight',
    },
    {
      src: '/assets/textures/scarab.png',
      alt: 'Sacred scarab',
      size: 160,
      angleOffset: 90, // 3 o'clock position
      rotation: 5,
      slideDirection: 'slideLeft',
    },
    {
      src: '/assets/textures/eye_of_horus.png',
      alt: 'Eye of Horus',
      size: 150,
      angleOffset: 180, // 6 o'clock position
      rotation: -5,
      slideDirection: 'slideRight',
    },
    {
      src: '/assets/textures/sun_disk_ra.png',
      alt: 'Sun disk of Ra',
      size: 170,
      angleOffset: 270, // 9 o'clock position
      rotation: 8,
      slideDirection: 'slideLeft',
    },
  ];

  public constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.reducedMotion.set(prefersReducedMotion);

      if (!prefersReducedMotion) {
        this.initializeMouseTracking();
        // Start entrance animation which leads to orbit
        this.playEntranceAnimation();
      } else {
        // For reduced motion, just set final positions
        this.setInitialOrbitPositions();
      }
    });
  }

  public ngOnDestroy(): void {
    this.cleanup();
  }

  /**
   * Set initial positions on the orbit circle
   * Called immediately so images are positioned before entrance animation
   */
  private setInitialOrbitPositions(): void {
    const container = this.elementRef.nativeElement as HTMLElement;
    const orbitItems = container.querySelectorAll('.orbit-item');
    this.updateOrbitPositions(orbitItems, 0);
  }

  /**
   * Calculate the orbital position for an image at a given angle
   */
  private getOrbitPosition(index: number, baseAngle: number): { x: number; y: number } {
    const radius = this.currentRadius();
    const image = this.floatingImages[index];
    const angle = baseAngle + image.angleOffset;
    const radians = (angle * Math.PI) / 180;

    return {
      x: Math.sin(radians) * radius,
      y: -Math.cos(radians) * radius,
    };
  }

  /**
   * Play entrance animation - images slide from off-screen to their orbital positions
   * Then starts the continuous orbit rotation
   */
  private playEntranceAnimation(): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const container = this.elementRef.nativeElement as HTMLElement;
    const orbitItems = container.querySelectorAll('.orbit-item');
    const entranceDistance = 400;

    // Set initial state: hidden and offset based on slide direction
    orbitItems.forEach((item, index) => {
      const element = item as HTMLElement;
      const image = this.floatingImages[index];
      const targetPos = this.getOrbitPosition(index, 0);

      // Calculate start position (off-screen based on direction)
      const offsetX = image.slideDirection === 'slideRight' ? -entranceDistance : entranceDistance;

      gsap.set(element, {
        x: targetPos.x + offsetX,
        y: targetPos.y,
        opacity: 0,
      });
    });

    // Animate each image to its orbital position with stagger
    orbitItems.forEach((item, index) => {
      const element = item as HTMLElement;
      const targetPos = this.getOrbitPosition(index, 0);

      gsap.to(element, {
        x: targetPos.x,
        y: targetPos.y,
        opacity: 1,
        duration: 1.2,
        delay: 0.1 + index * 0.15,
        ease: 'power3.out',
        onComplete: index === orbitItems.length - 1 ? () => this.startOrbitAnimation() : undefined,
      });
    });
  }

  /**
   * Start the continuous orbital animation
   */
  private startOrbitAnimation(): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap || this.reducedMotion()) return;

    const container = this.elementRef.nativeElement as HTMLElement;
    const orbitItems = container.querySelectorAll('.orbit-item');

    // Set initial positions
    this.updateOrbitPositions(orbitItems, 0);

    // Create continuous rotation animation
    this.orbitTimeline = gsap.timeline({ repeat: -1 });

    this.orbitTimeline.to(
      {},
      {
        duration: this.ROTATION_DURATION,
        ease: 'none',
        onUpdate: () => {
          // Calculate current angle based on timeline progress
          const progress = this.orbitTimeline?.progress() || 0;
          this.currentAngle = progress * 360;
          this.updateOrbitPositions(orbitItems, this.currentAngle);
        },
      }
    );

    // Create quickTo for smooth radius changes
    const radiusProxy = { value: this.currentRadius() };
    this.radiusQuickTo = gsap.quickTo(radiusProxy, 'value', {
      duration: 0.8,
      ease: 'power2.out',
      onUpdate: () => {
        this.currentRadius.set(radiusProxy.value);
      },
    });
  }

  /**
   * Update positions of all orbit items based on current angle and radius
   */
  private updateOrbitPositions(items: NodeListOf<Element>, baseAngle: number): void {
    const radius = this.currentRadius();

    items.forEach((item, index) => {
      const element = item as HTMLElement;
      const image = this.floatingImages[index];

      // Calculate position: base angle + individual offset
      // Clockwise: we add angles (in standard math, this would be counter-clockwise,
      // but since Y-axis is inverted in screen coordinates, it becomes clockwise)
      const angle = baseAngle + image.angleOffset;
      const radians = (angle * Math.PI) / 180;

      // Calculate x, y position on the circle
      const x = Math.sin(radians) * radius;
      const y = -Math.cos(radians) * radius; // Negative because Y is inverted

      element.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  /**
   * Set up mouse movement tracking for dynamic radius
   */
  private initializeMouseTracking(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate mouse distance from viewport center
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;

      // Normalized distance from center (0 at center, 1 at corners)
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const normalizedDistance = Math.min(distance / maxDistance, 1);

      // Interpolate radius based on mouse distance from center
      const targetRadius = this.MIN_RADIUS + normalizedDistance * (this.MAX_RADIUS - this.MIN_RADIUS);

      // Use quickTo for smooth transition
      if (this.radiusQuickTo) {
        this.radiusQuickTo(targetRadius);
      } else {
        this.currentRadius.set(targetRadius);
      }
    };

    // Throttled mouse move listener
    let ticking = false;
    const throttledHandler = (e: MouseEvent) => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleMouseMove(e);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('mousemove', throttledHandler, { passive: true });

    this.mouseMoveCleanup = () => {
      window.removeEventListener('mousemove', throttledHandler);
    };
  }

  /**
   * Clean up all animations and listeners
   */
  private cleanup(): void {
    // Kill orbit timeline
    if (this.orbitTimeline) {
      this.orbitTimeline.kill();
      this.orbitTimeline = null;
    }

    // Remove mouse listener
    if (this.mouseMoveCleanup) {
      this.mouseMoveCleanup();
      this.mouseMoveCleanup = null;
    }

    this.radiusQuickTo = null;
  }
}
```

**Key Patterns to Extract**:

1. `gsap.quickTo()` for smooth interpolated transitions
2. Continuous timeline with `onUpdate` for position calculation
3. Mouse tracking with throttled RAF
4. Staggered entrance before continuous animation
5. Reduced motion support

---

### 2. Centralized Animation Presets

**Source File**: `apps/ptah-landing-page/src/app/pages/auth/config/auth-animation.configs.ts`

**Full Implementation**:

```typescript
import { ViewportAnimationConfig, ScrollAnimationConfig } from '@hive-academy/angular-gsap';

/**
 * Auth Animation Configurations
 *
 * Shared GSAP animation configurations for auth components.
 * Provides consistent, staggered entrance animations.
 */

// ============================================
// LEFT SIDE (Form) ANIMATIONS
// ============================================

/** Logo - First to appear with fade */
export const LOGO_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.6,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

/** Title - Slide up after logo */
export const TITLE_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.7,
  delay: 0.1,
  threshold: 0.1,
  ease: 'power3.out',
  distance: 30,
  once: true,
};

/** Tab switcher - Slide up with delay */
export const TABS_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.2,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Alert messages */
export const ALERT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.4,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

/** Email input - Slide up with delay */
export const EMAIL_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.3,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Password input - Slide up with delay */
export const PASSWORD_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.35,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Continue button - Slide up with bounce */
export const BUTTON_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.4,
  threshold: 0.1,
  ease: 'back.out(1.4)',
  distance: 25,
  once: true,
};

/** Divider - Fade in */
export const DIVIDER_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.5,
  delay: 0.5,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

// ============================================
// SOCIAL BUTTON ANIMATIONS (Staggered)
// ============================================

/** GitHub button - First social button */
export const SOCIAL_BTN_1_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.5,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Google button - Second social button */
export const SOCIAL_BTN_2_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.6,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Magic Link button - Third social button */
export const SOCIAL_BTN_3_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.5,
  delay: 0.7,
  threshold: 0.1,
  ease: 'back.out(1.7)',
  scale: 0.8,
  once: true,
};

/** Footer text - Fade in last */
export const FOOTER_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.6,
  delay: 0.7,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};

// ============================================
// RIGHT SIDE (Hero) ANIMATIONS
// ============================================

/** Parallax background effect */
export const PARALLAX_ANIMATION: ScrollAnimationConfig = {
  animation: 'parallax',
  speed: 0.3,
  scrub: 1.5,
};

/** Main floating card - Bounce in from bottom */
export const HERO_CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.8,
  delay: 0.4,
  threshold: 0.1,
  ease: 'back.out(1.2)',
  distance: 40,
  once: true,
};

/** Secondary card - Slide from right */
export const SECONDARY_CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideLeft',
  duration: 0.7,
  delay: 0.6,
  threshold: 0.1,
  ease: 'power3.out',
  distance: 50,
  once: true,
};

// ============================================
// CARD ANIMATION (For simpler pages)
// ============================================

/** Card scale in animation */
export const CARD_ANIMATION: ViewportAnimationConfig = {
  animation: 'scaleIn',
  duration: 0.6,
  threshold: 0.1,
  ease: 'power2.out',
};

// ============================================
// VERIFICATION CODE ANIMATIONS
// ============================================

/** Verification code input */
export const CODE_INPUT_ANIMATION: ViewportAnimationConfig = {
  animation: 'slideUp',
  duration: 0.6,
  delay: 0.2,
  threshold: 0.1,
  ease: 'power2.out',
  distance: 25,
  once: true,
};

/** Verification message */
export const VERIFICATION_MESSAGE_ANIMATION: ViewportAnimationConfig = {
  animation: 'fadeIn',
  duration: 0.5,
  delay: 0.1,
  threshold: 0.1,
  ease: 'power2.out',
  once: true,
};
```

---

### 3. Index-Based Staggered Configs

**Source File**: `apps/ptah-landing-page/src/app/sections/comparison/comparison-split-scroll.component.ts`

**Pattern Implementation**:

```typescript
import { ViewportAnimationConfig, ViewportAnimationDirective } from '@hive-academy/angular-gsap';

@Component({
  // ... component metadata
})
export class ComparisonSplitScrollComponent {
  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  public readonly subheaderConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  /**
   * Generate animation config for pain point items
   * Each item has progressively longer delay for stagger effect
   */
  public getPainConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideRight',
      duration: 0.5,
      delay: 0.1 + index * 0.1,
      threshold: 0.2,
    };
  }

  /**
   * Generate animation config for benefit items
   * Slide from opposite direction with bounce easing
   */
  public getBenefitConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideLeft',
      duration: 0.5,
      delay: 0.1 + index * 0.1,
      ease: 'back.out(1.4)',
      threshold: 0.2,
    };
  }

  /**
   * Generate animation config for metric cards
   * Scale in with elastic bounce
   */
  public getMetricConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: index * 0.15,
      ease: 'back.out(1.7)',
      threshold: 0.2,
    };
  }
}
```

**Template Usage**:

```html
@for (pain of painPoints; track pain.text; let i = $index) {
<li viewportAnimation [viewportConfig]="getPainConfig(i)" class="flex items-start gap-4">
  <!-- content -->
</li>
}
```

---

### 4. Scroll Exit Animations

**Source File**: `apps/ptah-landing-page/src/app/sections/hero/hero-content-overlay.component.ts`

**Pattern Implementation**:

```typescript
import { ViewportAnimationDirective, ViewportAnimationConfig, ScrollAnimationDirective, ScrollAnimationConfig } from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, ScrollAnimationDirective],
  template: `
    <!-- Scroll-linked fade-out container for cinematic exit -->
    <div scrollAnimation [scrollConfig]="contentScrollExitConfig" class="flex flex-col items-center justify-center min-h-screen">
      <!-- Badge - Viewport entrance -->
      <div viewportAnimation [viewportConfig]="badgeConfig" class="...">Badge content</div>

      <!-- Main Headline - Viewport entrance -->
      <h1 viewportAnimation [viewportConfig]="headlineConfig" class="...">Ptah</h1>

      <!-- More content... -->
    </div>
  `,
})
export class HeroContentOverlayComponent {
  /**
   * Cinematic scroll exit - content fades out and rises as user scrolls
   * Creates "ascending from the temple" effect
   */
  public readonly contentScrollExitConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top top',
    end: 'bottom 50%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -120 },
  };

  /**
   * Badge entrance - quick scale in
   */
  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
  };

  /**
   * Headline entrance - dramatic slide up
   */
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.15,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Subheadline - fade in after headline
   */
  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.3,
    threshold: 0.1,
  };

  /**
   * CTAs - slide up together
   */
  public readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.45,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Stats - fade in last
   */
  public readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.6,
    threshold: 0.1,
  };
}
```

---

## Proposed New Directives

### 1. OrbitAnimationDirective

**Purpose**: Declarative orbital animation for multiple elements around a center point.

**Proposed API**:

```typescript
// orbit-animation.directive.ts

import { Directive, Input, Output, EventEmitter, ElementRef, inject, afterNextRender, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GsapCoreService } from '../services/gsap-core.service';

export interface OrbitAnimationConfig {
  /** Minimum orbit radius in pixels */
  minRadius?: number;
  /** Maximum orbit radius in pixels */
  maxRadius?: number;
  /** Duration for one complete orbit in seconds */
  duration?: number;
  /** Rotation direction */
  direction?: 'clockwise' | 'counterclockwise';
  /** Easing for the orbit (default: 'none' for constant speed) */
  ease?: string;
  /** Enable mouse tracking to dynamically change radius */
  mouseTracking?: boolean;
  /** Duration for radius transitions when mouse tracking */
  radiusTransitionDuration?: number;
  /** Easing for radius transitions */
  radiusTransitionEase?: string;
  /** Stagger delay between items entering orbit */
  entranceStagger?: number;
  /** Entrance animation duration */
  entranceDuration?: number;
  /** Entrance animation easing */
  entranceEase?: string;
  /** Pause on hover */
  pauseOnHover?: boolean;
  /** Respect prefers-reduced-motion */
  respectReducedMotion?: boolean;
}

export interface OrbitItem {
  /** Angle offset in degrees (0-360) */
  angleOffset: number;
  /** Entrance slide direction */
  slideDirection?: 'left' | 'right' | 'up' | 'down';
}

@Directive({
  selector: '[orbitAnimation]',
  standalone: true,
  exportAs: 'orbitAnimation',
})
export class OrbitAnimationDirective implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);
  private readonly gsapCore = inject(GsapCoreService);

  /** Configuration for the orbit animation */
  @Input() orbitConfig: OrbitAnimationConfig = {};

  /** Selector for orbit items within the container */
  @Input() orbitItemSelector: string = '.orbit-item';

  /** Item configurations (angle offsets, etc.) */
  @Input() orbitItems: OrbitItem[] = [];

  /** Emits current angle (0-360) */
  @Output() angleChange = new EventEmitter<number>();

  /** Emits current radius */
  @Output() radiusChange = new EventEmitter<number>();

  /** Emits when orbit completes one full rotation */
  @Output() orbitComplete = new EventEmitter<void>();

  private orbitTimeline: gsap.core.Timeline | null = null;
  private radiusQuickTo: gsap.QuickToFunc | null = null;
  private currentRadius = 0;
  private currentAngle = 0;
  private mouseMoveCleanup: (() => void) | null = null;

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.initialize();
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  /** Public API: Pause the orbit */
  public pause(): void {
    this.orbitTimeline?.pause();
  }

  /** Public API: Resume the orbit */
  public resume(): void {
    this.orbitTimeline?.resume();
  }

  /** Public API: Set specific angle */
  public setAngle(angle: number): void {
    if (this.orbitTimeline) {
      this.orbitTimeline.progress(angle / 360);
    }
  }

  /** Public API: Set radius directly */
  public setRadius(radius: number): void {
    if (this.radiusQuickTo) {
      this.radiusQuickTo(radius);
    } else {
      this.currentRadius = radius;
      this.updatePositions();
    }
  }

  private initialize(): void {
    const config = this.getResolvedConfig();

    // Check reduced motion
    if (config.respectReducedMotion) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        this.setStaticPositions();
        return;
      }
    }

    this.currentRadius = config.minRadius!;

    if (config.mouseTracking) {
      this.initializeMouseTracking(config);
    }

    this.playEntranceAnimation(config);
  }

  private getResolvedConfig(): Required<OrbitAnimationConfig> {
    return {
      minRadius: this.orbitConfig.minRadius ?? 200,
      maxRadius: this.orbitConfig.maxRadius ?? 350,
      duration: this.orbitConfig.duration ?? 20,
      direction: this.orbitConfig.direction ?? 'clockwise',
      ease: this.orbitConfig.ease ?? 'none',
      mouseTracking: this.orbitConfig.mouseTracking ?? false,
      radiusTransitionDuration: this.orbitConfig.radiusTransitionDuration ?? 0.8,
      radiusTransitionEase: this.orbitConfig.radiusTransitionEase ?? 'power2.out',
      entranceStagger: this.orbitConfig.entranceStagger ?? 0.15,
      entranceDuration: this.orbitConfig.entranceDuration ?? 1.2,
      entranceEase: this.orbitConfig.entranceEase ?? 'power3.out',
      pauseOnHover: this.orbitConfig.pauseOnHover ?? false,
      respectReducedMotion: this.orbitConfig.respectReducedMotion ?? true,
    };
  }

  private playEntranceAnimation(config: Required<OrbitAnimationConfig>): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const items = this.getOrbitItems();
    const entranceDistance = 400;

    // Set initial hidden state
    items.forEach((item, index) => {
      const orbitItem = this.orbitItems[index] || { angleOffset: (360 / items.length) * index };
      const targetPos = this.calculatePosition(orbitItem.angleOffset, config.minRadius!);
      const direction = orbitItem.slideDirection || (index % 2 === 0 ? 'left' : 'right');

      const offset = this.getEntranceOffset(direction, entranceDistance);

      gsap.set(item, {
        x: targetPos.x + offset.x,
        y: targetPos.y + offset.y,
        opacity: 0,
      });
    });

    // Animate to orbital positions
    items.forEach((item, index) => {
      const orbitItem = this.orbitItems[index] || { angleOffset: (360 / items.length) * index };
      const targetPos = this.calculatePosition(orbitItem.angleOffset, config.minRadius!);

      gsap.to(item, {
        x: targetPos.x,
        y: targetPos.y,
        opacity: 1,
        duration: config.entranceDuration,
        delay: index * config.entranceStagger,
        ease: config.entranceEase,
        onComplete: index === items.length - 1 ? () => this.startOrbit(config) : undefined,
      });
    });
  }

  private startOrbit(config: Required<OrbitAnimationConfig>): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const items = this.getOrbitItems();
    const directionMultiplier = config.direction === 'clockwise' ? 1 : -1;

    this.orbitTimeline = gsap.timeline({
      repeat: -1,
      onRepeat: () => this.orbitComplete.emit(),
    });

    this.orbitTimeline.to(
      {},
      {
        duration: config.duration,
        ease: config.ease,
        onUpdate: () => {
          const progress = this.orbitTimeline?.progress() || 0;
          this.currentAngle = progress * 360 * directionMultiplier;
          this.angleChange.emit(this.currentAngle);
          this.updatePositions();
        },
      }
    );

    // Setup radius quickTo if mouse tracking
    if (config.mouseTracking) {
      const radiusProxy = { value: this.currentRadius };
      this.radiusQuickTo = gsap.quickTo(radiusProxy, 'value', {
        duration: config.radiusTransitionDuration,
        ease: config.radiusTransitionEase,
        onUpdate: () => {
          this.currentRadius = radiusProxy.value;
          this.radiusChange.emit(this.currentRadius);
        },
      });
    }

    // Pause on hover if configured
    if (config.pauseOnHover) {
      const el = this.elementRef.nativeElement;
      el.addEventListener('mouseenter', () => this.orbitTimeline?.pause());
      el.addEventListener('mouseleave', () => this.orbitTimeline?.resume());
    }
  }

  private updatePositions(): void {
    const items = this.getOrbitItems();

    items.forEach((item, index) => {
      const orbitItem = this.orbitItems[index] || { angleOffset: (360 / items.length) * index };
      const angle = this.currentAngle + orbitItem.angleOffset;
      const pos = this.calculatePosition(angle, this.currentRadius);

      (item as HTMLElement).style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    });
  }

  private calculatePosition(angle: number, radius: number): { x: number; y: number } {
    const radians = (angle * Math.PI) / 180;
    return {
      x: Math.sin(radians) * radius,
      y: -Math.cos(radians) * radius,
    };
  }

  private getEntranceOffset(direction: string, distance: number): { x: number; y: number } {
    switch (direction) {
      case 'left':
        return { x: -distance, y: 0 };
      case 'right':
        return { x: distance, y: 0 };
      case 'up':
        return { x: 0, y: -distance };
      case 'down':
        return { x: 0, y: distance };
      default:
        return { x: 0, y: 0 };
    }
  }

  private initializeMouseTracking(config: Required<OrbitAnimationConfig>): void {
    const handleMouseMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

      const deltaX = e.clientX - centerX;
      const deltaY = e.clientY - centerY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const normalized = Math.min(distance / maxDistance, 1);

      const targetRadius = config.minRadius + normalized * (config.maxRadius - config.minRadius);

      if (this.radiusQuickTo) {
        this.radiusQuickTo(targetRadius);
      }
    };

    let ticking = false;
    const throttled = (e: MouseEvent) => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleMouseMove(e);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('mousemove', throttled, { passive: true });
    this.mouseMoveCleanup = () => window.removeEventListener('mousemove', throttled);
  }

  private getOrbitItems(): Element[] {
    return Array.from(this.elementRef.nativeElement.querySelectorAll(this.orbitItemSelector));
  }

  private setStaticPositions(): void {
    const config = this.getResolvedConfig();
    const items = this.getOrbitItems();

    items.forEach((item, index) => {
      const orbitItem = this.orbitItems[index] || { angleOffset: (360 / items.length) * index };
      const pos = this.calculatePosition(orbitItem.angleOffset, config.minRadius);
      (item as HTMLElement).style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    });
  }

  private cleanup(): void {
    this.orbitTimeline?.kill();
    this.orbitTimeline = null;
    this.radiusQuickTo = null;
    this.mouseMoveCleanup?.();
    this.mouseMoveCleanup = null;
  }
}
```

**Usage Example**:

```html
<div
  orbitAnimation
  [orbitConfig]="{
    minRadius: 200,
    maxRadius: 400,
    duration: 25,
    direction: 'clockwise',
    mouseTracking: true,
    pauseOnHover: true
  }"
  [orbitItems]="[
    { angleOffset: 0, slideDirection: 'right' },
    { angleOffset: 90, slideDirection: 'left' },
    { angleOffset: 180, slideDirection: 'right' },
    { angleOffset: 270, slideDirection: 'left' }
  ]"
  (angleChange)="onAngleChange($event)"
>
  <div class="orbit-item">Item 1</div>
  <div class="orbit-item">Item 2</div>
  <div class="orbit-item">Item 3</div>
  <div class="orbit-item">Item 4</div>
</div>
```

---

### 2. MouseParallaxDirective

**Purpose**: Move elements based on mouse position for interactive depth effects.

**Proposed API**:

```typescript
// mouse-parallax.directive.ts

import { Directive, Input, ElementRef, inject, afterNextRender, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { GsapCoreService } from '../services/gsap-core.service';

export interface MouseParallaxConfig {
  /** Maximum X movement in pixels */
  maxX?: number;
  /** Maximum Y movement in pixels */
  maxY?: number;
  /** Sensitivity multiplier (1 = normal, 0.5 = half, 2 = double) */
  sensitivity?: number;
  /** Invert X movement */
  invertX?: boolean;
  /** Invert Y movement */
  invertY?: boolean;
  /** Transition duration in seconds */
  duration?: number;
  /** Transition easing */
  ease?: string;
  /** Only track within parent element */
  trackWithinParent?: boolean;
  /** Reset position when mouse leaves */
  resetOnLeave?: boolean;
  /** Reset duration */
  resetDuration?: number;
  /** Respect prefers-reduced-motion */
  respectReducedMotion?: boolean;
}

@Directive({
  selector: '[mouseParallax]',
  standalone: true,
  exportAs: 'mouseParallax',
})
export class MouseParallaxDirective implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly elementRef = inject(ElementRef);
  private readonly gsapCore = inject(GsapCoreService);

  @Input() mouseParallaxConfig: MouseParallaxConfig = {};

  private quickToX: gsap.QuickToFunc | null = null;
  private quickToY: gsap.QuickToFunc | null = null;
  private cleanupFn: (() => void) | null = null;

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.initialize();
    });
  }

  ngOnDestroy(): void {
    this.cleanupFn?.();
  }

  private initialize(): void {
    const config = this.getResolvedConfig();

    if (config.respectReducedMotion) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;
    }

    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const el = this.elementRef.nativeElement;

    // Create quickTo for smooth transitions
    this.quickToX = gsap.quickTo(el, 'x', {
      duration: config.duration,
      ease: config.ease,
    });

    this.quickToY = gsap.quickTo(el, 'y', {
      duration: config.duration,
      ease: config.ease,
    });

    const trackingElement = config.trackWithinParent ? el.parentElement : window;

    const handleMouseMove = (e: MouseEvent) => {
      let normalizedX: number;
      let normalizedY: number;

      if (config.trackWithinParent && el.parentElement) {
        const rect = el.parentElement.getBoundingClientRect();
        normalizedX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        normalizedY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      } else {
        normalizedX = (e.clientX / window.innerWidth - 0.5) * 2;
        normalizedY = (e.clientY / window.innerHeight - 0.5) * 2;
      }

      const moveX = normalizedX * config.maxX! * config.sensitivity! * (config.invertX ? -1 : 1);
      const moveY = normalizedY * config.maxY! * config.sensitivity! * (config.invertY ? -1 : 1);

      this.quickToX!(moveX);
      this.quickToY!(moveY);
    };

    const handleMouseLeave = () => {
      if (config.resetOnLeave) {
        gsap.to(el, {
          x: 0,
          y: 0,
          duration: config.resetDuration,
          ease: config.ease,
        });
      }
    };

    let ticking = false;
    const throttledMove = (e: MouseEvent) => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleMouseMove(e);
          ticking = false;
        });
        ticking = true;
      }
    };

    trackingElement.addEventListener('mousemove', throttledMove as EventListener, { passive: true });

    if (config.resetOnLeave) {
      trackingElement.addEventListener('mouseleave', handleMouseLeave as EventListener);
    }

    this.cleanupFn = () => {
      trackingElement.removeEventListener('mousemove', throttledMove as EventListener);
      trackingElement.removeEventListener('mouseleave', handleMouseLeave as EventListener);
    };
  }

  private getResolvedConfig(): Required<MouseParallaxConfig> {
    return {
      maxX: this.mouseParallaxConfig.maxX ?? 30,
      maxY: this.mouseParallaxConfig.maxY ?? 30,
      sensitivity: this.mouseParallaxConfig.sensitivity ?? 1,
      invertX: this.mouseParallaxConfig.invertX ?? false,
      invertY: this.mouseParallaxConfig.invertY ?? false,
      duration: this.mouseParallaxConfig.duration ?? 0.6,
      ease: this.mouseParallaxConfig.ease ?? 'power2.out',
      trackWithinParent: this.mouseParallaxConfig.trackWithinParent ?? false,
      resetOnLeave: this.mouseParallaxConfig.resetOnLeave ?? true,
      resetDuration: this.mouseParallaxConfig.resetDuration ?? 0.8,
      respectReducedMotion: this.mouseParallaxConfig.respectReducedMotion ?? true,
    };
  }
}
```

**Usage Example**:

```html
<!-- Background layer (slowest) -->
<div
  mouseParallax
  [mouseParallaxConfig]="{
    maxX: 10,
    maxY: 10,
    sensitivity: 0.5,
    invertX: true,
    invertY: true
  }"
>
  Background
</div>

<!-- Foreground layer (fastest) -->
<div
  mouseParallax
  [mouseParallaxConfig]="{
    maxX: 40,
    maxY: 40,
    sensitivity: 1.5
  }"
>
  Foreground
</div>
```

---

### 3. ScrollExitDirective

**Purpose**: Scroll-linked exit animations (extend existing ScrollAnimationDirective or create new).

**Option A: Add to existing ScrollAnimationConfig**:

```typescript
// Extend existing AnimationType
type AnimationType =
  | 'fadeIn'
  | 'fadeOut'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'scaleIn'
  | 'scaleOut'
  | 'parallax'
  | 'custom'
  // NEW EXIT ANIMATIONS
  | 'exitUp' // opacity: 1→0, y: 0→-100
  | 'exitDown' // opacity: 1→0, y: 0→100
  | 'exitLeft' // opacity: 1→0, x: 0→-100
  | 'exitRight' // opacity: 1→0, x: 0→100
  | 'exitScale' // opacity: 1→0, scale: 1→0.8
  | 'exitFade'; // opacity: 1→0 only

// Default from/to for exit animations
const EXIT_ANIMATION_DEFAULTS: Record<string, { from: gsap.TweenVars; to: gsap.TweenVars }> = {
  exitUp: {
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -100 },
  },
  exitDown: {
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: 100 },
  },
  exitLeft: {
    from: { opacity: 1, x: 0 },
    to: { opacity: 0, x: -100 },
  },
  exitRight: {
    from: { opacity: 1, x: 0 },
    to: { opacity: 0, x: 100 },
  },
  exitScale: {
    from: { opacity: 1, scale: 1 },
    to: { opacity: 0, scale: 0.8 },
  },
  exitFade: {
    from: { opacity: 1 },
    to: { opacity: 0 },
  },
};
```

**Option B: New combined directive**:

```typescript
// entrance-exit-animation.directive.ts

export interface EntranceExitConfig {
  entrance?: ViewportAnimationConfig;
  exit?: ScrollAnimationConfig;
}

@Directive({
  selector: '[entranceExitAnimation]',
  standalone: true,
})
export class EntranceExitAnimationDirective {
  @Input() entranceExitConfig: EntranceExitConfig = {};

  // Combines ViewportAnimationDirective for entrance
  // with ScrollAnimationDirective for exit
}
```

**Usage Examples**:

```html
<!-- Using extended ScrollAnimationDirective -->
<div
  scrollAnimation
  [scrollConfig]="{
    animation: 'exitUp',
    start: 'top top',
    end: 'bottom 50%',
    scrub: 1.2
  }"
>
  Content that fades up and out on scroll
</div>

<!-- Using new combined directive -->
<div
  entranceExitAnimation
  [entranceExitConfig]="{
    entrance: {
      animation: 'slideUp',
      duration: 0.8,
      delay: 0.15,
      threshold: 0.1
    },
    exit: {
      animation: 'exitUp',
      start: 'top 20%',
      end: 'bottom 60%',
      scrub: 1.2
    }
  }"
>
  Content with both entrance and exit
</div>
```

---

## Proposed Utility Functions

### 1. createStaggeredConfigs

```typescript
// utils/staggered-configs.ts

import { ViewportAnimationConfig } from '../interfaces';

export interface StaggeredConfigOptions {
  /** Base configuration to apply to all items */
  baseConfig: Partial<ViewportAnimationConfig>;
  /** Number of items */
  count: number;
  /** Delay increment between items (default: 0.1) */
  staggerDelay?: number;
  /** Initial delay before first item (default: 0) */
  initialDelay?: number;
}

/**
 * Generate an array of ViewportAnimationConfig with staggered delays
 *
 * @example
 * const configs = createStaggeredConfigs({
 *   baseConfig: { animation: 'slideUp', duration: 0.5, ease: 'power2.out' },
 *   count: 4,
 *   staggerDelay: 0.1,
 *   initialDelay: 0.2
 * });
 * // Returns 4 configs with delays: 0.2, 0.3, 0.4, 0.5
 */
export function createStaggeredConfigs(options: StaggeredConfigOptions): ViewportAnimationConfig[] {
  const { baseConfig, count, staggerDelay = 0.1, initialDelay = 0 } = options;

  return Array.from(
    { length: count },
    (_, index) =>
      ({
        animation: 'fadeIn',
        duration: 0.6,
        threshold: 0.1,
        ...baseConfig,
        delay: initialDelay + index * staggerDelay,
      } as ViewportAnimationConfig)
  );
}
```

### 2. createDirectionalConfig

```typescript
// utils/directional-configs.ts

import { ViewportAnimationConfig, ScrollAnimationConfig } from '../interfaces';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface DirectionalConfigOptions {
  /** Direction of animation */
  direction: Direction;
  /** Distance to travel (default: 60) */
  distance?: number;
  /** Duration (default: 0.6) */
  duration?: number;
  /** Delay (default: 0) */
  delay?: number;
  /** Easing (default: 'power2.out') */
  ease?: string;
  /** Include opacity animation (default: true) */
  withOpacity?: boolean;
  /** Include scale animation (default: false) */
  withScale?: boolean;
  /** Scale start value if withScale (default: 0.8) */
  scaleStart?: number;
}

/**
 * Create a ViewportAnimationConfig for a directional slide animation
 *
 * @example
 * const config = createDirectionalConfig({
 *   direction: 'left',
 *   distance: 80,
 *   duration: 0.5,
 *   ease: 'back.out(1.4)'
 * });
 */
export function createDirectionalConfig(options: DirectionalConfigOptions): ViewportAnimationConfig {
  const { direction, distance = 60, duration = 0.6, delay = 0, ease = 'power2.out', withOpacity = true, withScale = false, scaleStart = 0.8 } = options;

  const animationMap: Record<Direction, ViewportAnimationType> = {
    left: 'slideRight', // Slides FROM left, so animation is slideRight
    right: 'slideLeft',
    up: 'slideDown',
    down: 'slideUp',
  };

  const config: ViewportAnimationConfig = {
    animation: animationMap[direction],
    duration,
    delay,
    ease,
    distance,
    threshold: 0.1,
  };

  // For custom from/to when combining with scale
  if (withScale) {
    const offsetMap: Record<Direction, { x?: number; y?: number }> = {
      left: { x: -distance },
      right: { x: distance },
      up: { y: -distance },
      down: { y: distance },
    };

    config.animation = 'custom';
    config.from = {
      ...offsetMap[direction],
      ...(withOpacity && { opacity: 0 }),
      ...(withScale && { scale: scaleStart }),
    };
    config.to = {
      x: 0,
      y: 0,
      ...(withOpacity && { opacity: 1 }),
      ...(withScale && { scale: 1 }),
    };
  }

  return config;
}

/**
 * Create alternating direction configs for list items
 * Odd items slide from one direction, even from opposite
 *
 * @example
 * const configs = createAlternatingConfigs({
 *   count: 4,
 *   directions: ['left', 'right'],
 *   distance: 60,
 *   staggerDelay: 0.1
 * });
 */
export function createAlternatingConfigs(options: { count: number; directions: [Direction, Direction]; distance?: number; duration?: number; ease?: string; staggerDelay?: number; initialDelay?: number }): ViewportAnimationConfig[] {
  const { count, directions, distance = 60, duration = 0.5, ease = 'power2.out', staggerDelay = 0.1, initialDelay = 0 } = options;

  return Array.from({ length: count }, (_, index) => ({
    ...createDirectionalConfig({
      direction: directions[index % 2],
      distance,
      duration,
      ease,
    }),
    delay: initialDelay + index * staggerDelay,
  }));
}
```

### 3. mergeAnimationConfigs

```typescript
// utils/merge-configs.ts

import { ViewportAnimationConfig, ScrollAnimationConfig } from '../interfaces';

/**
 * Deep merge animation configs with later configs overriding earlier ones
 *
 * @example
 * const merged = mergeAnimationConfigs(
 *   PRESETS.heroTitle,
 *   { delay: 0.5, ease: 'elastic.out' }
 * );
 */
export function mergeAnimationConfigs<T extends ViewportAnimationConfig | ScrollAnimationConfig>(...configs: Partial<T>[]): T {
  return configs.reduce((merged, config) => {
    return {
      ...merged,
      ...config,
      // Deep merge from/to if both exist
      ...(merged.from &&
        config.from && {
          from: { ...merged.from, ...config.from },
        }),
      ...(merged.to &&
        config.to && {
          to: { ...merged.to, ...config.to },
        }),
    };
  }, {} as T);
}
```

---

## Proposed Animation Presets System

### Provider Function

```typescript
// providers/animation-presets.provider.ts

import { InjectionToken, Provider } from '@angular/core';
import { ViewportAnimationConfig, ScrollAnimationConfig } from '../interfaces';

export interface AnimationPresets {
  // Hero Section
  heroTitle: ViewportAnimationConfig;
  heroSubtitle: ViewportAnimationConfig;
  heroBadge: ViewportAnimationConfig;
  heroCta: ViewportAnimationConfig;
  heroStats: ViewportAnimationConfig;
  heroExit: ScrollAnimationConfig;

  // Form Elements
  formInput: ViewportAnimationConfig;
  formButton: ViewportAnimationConfig;
  formDivider: ViewportAnimationConfig;

  // Cards
  cardEntrance: ViewportAnimationConfig;
  cardHover: ViewportAnimationConfig;

  // Lists
  listItem: ViewportAnimationConfig;
  listItemStagger: (index: number) => ViewportAnimationConfig;

  // Sections
  sectionHeader: ViewportAnimationConfig;
  sectionContent: ViewportAnimationConfig;

  // Parallax
  parallaxSlow: ScrollAnimationConfig;
  parallaxMedium: ScrollAnimationConfig;
  parallaxFast: ScrollAnimationConfig;

  // Social/Buttons
  socialButton: (index: number) => ViewportAnimationConfig;

  // Custom presets from user
  [key: string]: ViewportAnimationConfig | ScrollAnimationConfig | ((index: number) => ViewportAnimationConfig);
}

export const ANIMATION_PRESETS = new InjectionToken<AnimationPresets>('ANIMATION_PRESETS');

const DEFAULT_PRESETS: AnimationPresets = {
  // Hero Section
  heroTitle: {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.15,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  },
  heroSubtitle: {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.3,
    threshold: 0.1,
    once: true,
  },
  heroBadge: {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
    once: true,
  },
  heroCta: {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.45,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  },
  heroStats: {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.6,
    threshold: 0.1,
    once: true,
  },
  heroExit: {
    animation: 'custom',
    start: 'top top',
    end: 'bottom 50%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -120 },
  },

  // Form Elements
  formInput: {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
    distance: 25,
    once: true,
  },
  formButton: {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.1,
    ease: 'back.out(1.4)',
    distance: 25,
    once: true,
  },
  formDivider: {
    animation: 'fadeIn',
    duration: 0.5,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  },

  // Cards
  cardEntrance: {
    animation: 'scaleIn',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
    scale: 0.9,
  },
  cardHover: {
    animation: 'custom',
    duration: 0.3,
    from: { scale: 1, y: 0 },
    to: { scale: 1.02, y: -4 },
  },

  // Lists
  listItem: {
    animation: 'slideUp',
    duration: 0.5,
    threshold: 0.2,
    ease: 'power2.out',
  },
  listItemStagger: (index: number) => ({
    animation: 'slideUp',
    duration: 0.5,
    delay: 0.1 + index * 0.1,
    threshold: 0.2,
    ease: 'power2.out',
  }),

  // Sections
  sectionHeader: {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
    ease: 'power2.out',
  },
  sectionContent: {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  },

  // Parallax
  parallaxSlow: {
    animation: 'parallax',
    speed: 0.3,
    scrub: 1.5,
  },
  parallaxMedium: {
    animation: 'parallax',
    speed: 0.5,
    scrub: 1,
  },
  parallaxFast: {
    animation: 'parallax',
    speed: 0.8,
    scrub: 0.5,
  },

  // Social/Buttons
  socialButton: (index: number) => ({
    animation: 'scaleIn',
    duration: 0.5,
    delay: 0.5 + index * 0.1,
    threshold: 0.1,
    ease: 'back.out(1.7)',
    scale: 0.8,
    once: true,
  }),
};

export interface ProvideAnimationPresetsOptions {
  /** Override default presets */
  presets?: Partial<AnimationPresets>;
  /** Extend with custom presets */
  custom?: Record<string, ViewportAnimationConfig | ScrollAnimationConfig | ((index: number) => ViewportAnimationConfig)>;
}

/**
 * Provide animation presets for the application
 *
 * @example
 * // app.config.ts
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideAnimationPresets({
 *       presets: {
 *         heroTitle: { ...customHeroTitle }
 *       },
 *       custom: {
 *         myCustomAnimation: { animation: 'bounceIn', duration: 1 }
 *       }
 *     })
 *   ]
 * };
 */
export function provideAnimationPresets(options?: ProvideAnimationPresetsOptions): Provider {
  const mergedPresets: AnimationPresets = {
    ...DEFAULT_PRESETS,
    ...options?.presets,
    ...options?.custom,
  };

  return {
    provide: ANIMATION_PRESETS,
    useValue: mergedPresets,
  };
}
```

### Usage in Components

```typescript
// Usage in component
import { Component, inject } from '@angular/core';
import { ANIMATION_PRESETS, AnimationPresets } from '@hive-academy/angular-gsap';

@Component({
  // ...
})
export class MyComponent {
  private readonly presets = inject(ANIMATION_PRESETS);

  // Use directly
  public readonly titleConfig = this.presets.heroTitle;

  // Use factory function
  public getButtonConfig(index: number) {
    return this.presets.socialButton(index);
  }

  // Override specific properties
  public readonly customTitle = {
    ...this.presets.heroTitle,
    delay: 0.5,
    duration: 1.2,
  };
}
```

```html
<h1 viewportAnimation [viewportConfig]="presets.heroTitle">Title</h1>

<p viewportAnimation [viewportConfig]="presets.heroSubtitle">Subtitle</p>

@for (btn of buttons; track btn; let i = $index) {
<button viewportAnimation [viewportConfig]="presets.socialButton(i)">{{ btn }}</button>
}
```

---

## Implementation Priority

### Phase 1: Quick Wins (Low Effort, High Impact)

1. **Exit Animation Types** - Add to existing `AnimationType`
2. **Utility Functions** - `createStaggeredConfigs`, `createDirectionalConfig`
3. **Animation Presets Provider** - `provideAnimationPresets()`

### Phase 2: New Directives (Medium Effort, High Impact)

1. **MouseParallaxDirective** - Simpler to implement
2. **EntranceExitAnimationDirective** - Combines existing functionality

### Phase 3: Complex Features (High Effort, Medium Impact)

1. **OrbitAnimationDirective** - Most complex, requires thorough testing

---

## Export Updates

```typescript
// public-api.ts additions

// New Directives
export { OrbitAnimationDirective, OrbitAnimationConfig, OrbitItem } from './lib/directives/orbit-animation.directive';
export { MouseParallaxDirective, MouseParallaxConfig } from './lib/directives/mouse-parallax.directive';

// New Providers
export { provideAnimationPresets, ANIMATION_PRESETS, AnimationPresets, ProvideAnimationPresetsOptions } from './lib/providers/animation-presets.provider';

// Utility Functions
export { createStaggeredConfigs, StaggeredConfigOptions } from './lib/utils/staggered-configs';

export { createDirectionalConfig, createAlternatingConfigs, DirectionalConfigOptions, Direction } from './lib/utils/directional-configs';

export { mergeAnimationConfigs } from './lib/utils/merge-configs';
```

---

## Testing Recommendations

Each new feature should include:

1. **Unit Tests**

   - Configuration merging
   - Position calculations (orbit)
   - Mouse tracking normalization

2. **Integration Tests**

   - SSR compatibility
   - Reduced motion support
   - Cleanup on destroy

3. **Visual Tests**

   - Storybook stories for each directive
   - Interactive demos

4. **E2E Tests**
   - Scroll behavior
   - Mouse interaction
   - Animation timing

---

## Changelog Entry (Template)

```markdown
## [1.2.0] - YYYY-MM-DD

### Added

- `OrbitAnimationDirective` for circular orbital animations with mouse tracking
- `MouseParallaxDirective` for mouse-based parallax effects
- Exit animation types: `exitUp`, `exitDown`, `exitLeft`, `exitRight`, `exitScale`, `exitFade`
- `provideAnimationPresets()` for centralized animation configuration
- Utility functions: `createStaggeredConfigs()`, `createDirectionalConfig()`, `mergeAnimationConfigs()`

### Changed

- Extended `AnimationType` with new exit animations
- Improved reduced motion support across all directives

### Fixed

- N/A
```
