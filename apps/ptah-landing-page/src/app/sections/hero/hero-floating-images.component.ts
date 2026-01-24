import {
  Component,
  ChangeDetectionStrategy,
  signal,
  afterNextRender,
  OnDestroy,
  inject,
  PLATFORM_ID,
  ElementRef,
} from '@angular/core';
import { isPlatformBrowser, NgOptimizedImage } from '@angular/common';
import {
  GsapCoreService,
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * Configuration for a floating image with parallax depth
 */
interface FloatingImage {
  /** Image source path */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Size in pixels */
  size: number;
  /** Initial position (percentage from edge) */
  position: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
  /** Parallax depth multiplier (0.1-1.0, lower = slower/farther) */
  depth: number;
  /** Base floating animation offset */
  floatOffset: number;
  /** Float animation duration */
  floatDuration: number;
  /** Initial rotation in degrees */
  rotation: number;
  /** Scroll parallax speed (different from mouse depth for layered effect) */
  scrollSpeed: number;
}

/**
 * HeroFloatingImagesComponent - Floating Egyptian symbols with mouse + scroll parallax
 *
 * Features:
 * - 4 floating images positioned around hero
 * - Mouse-following parallax using GSAP quickTo (immediate response)
 * - Scroll parallax using ScrollAnimationDirective (depth effect)
 * - Base floating/bobbing animation
 * - Different depths for 3D parallax effect
 * - Respects prefers-reduced-motion
 * - Circular images with amber glow effect
 */
@Component({
  selector: 'ptah-hero-floating-images',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, ScrollAnimationDirective],
  template: `
    <div
      class="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      @for (image of floatingImages; track image.src; let i = $index) {
      <!-- Outer scroll parallax wrapper -->
      <div
        scrollAnimation
        [scrollConfig]="getScrollConfig(image.scrollSpeed)"
        class="absolute"
        [style.top]="image.position.top || 'auto'"
        [style.bottom]="image.position.bottom || 'auto'"
        [style.left]="image.position.left || 'auto'"
        [style.right]="image.position.right || 'auto'"
      >
        <!-- Inner mouse parallax + float animation target -->
        <div
          class="floating-image transition-opacity duration-500"
          [style.width.px]="image.size"
          [style.height.px]="image.size"
          [style.opacity]="reducedMotion() ? 0.6 : 0.85"
          [attr.data-depth]="image.depth"
          [attr.data-index]="i"
        >
          <div
            class="relative w-full h-full rounded-full overflow-hidden shadow-2xl"
            [style.transform]="'rotate(' + image.rotation + 'deg)'"
          >
            <!-- Glow effect -->
            <div
              class="absolute -inset-2 rounded-full bg-amber-500/20 blur-xl"
            ></div>

            <!-- Image container with border -->
            <div
              class="relative w-full h-full rounded-full overflow-hidden border-2 border-amber-500/30"
            >
              <img
                [ngSrc]="image.src"
                [alt]="image.alt"
                fill
                class="object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </div>
      }
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

      .floating-image {
        will-change: transform;
      }

      /* Reduced motion - disable animations */
      @media (prefers-reduced-motion: reduce) {
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

  /** Mouse position for parallax calculation */
  private readonly mouseX = signal(0);
  private readonly mouseY = signal(0);

  /** GSAP quickTo functions for smooth animation */
  private quickToFunctions: Map<
    number,
    { x: gsap.QuickToFunc; y: gsap.QuickToFunc }
  > = new Map();

  /** Floating animation timelines */
  private floatTimelines: gsap.core.Timeline[] = [];

  /** Mouse move listener cleanup */
  private mouseMoveCleanup: (() => void) | null = null;

  /** Configuration for all floating images with mouse + scroll parallax */
  public readonly floatingImages: FloatingImage[] = [
    {
      src: '/assets/textures/ankh-sphere.png',
      alt: 'Ankh symbol',
      size: 180,
      position: { top: '8%', left: '22%' },
      depth: 0.15, // Mouse parallax: Slowest - appears farthest
      floatOffset: 18,
      floatDuration: 4,
      rotation: -10,
      scrollSpeed: 0.4, // Scroll parallax: Slow
    },
    {
      src: '/assets/textures/scarab.png',
      alt: 'Sacred scarab',
      size: 160,
      position: { top: '12%', right: '20%' },
      depth: 0.25,
      floatOffset: 14,
      floatDuration: 3.5,
      rotation: 5,
      scrollSpeed: 0.55, // Scroll parallax: Medium
    },
    {
      src: '/assets/textures/eye_of_horus.png',
      alt: 'Eye of Horus',
      size: 150,
      position: { bottom: '15%', left: '20%' },
      depth: 0.35,
      floatOffset: 12,
      floatDuration: 4.5,
      rotation: -5,
      scrollSpeed: 0.65, // Scroll parallax: Faster
    },
    {
      src: '/assets/textures/sun_disk_ra.png',
      alt: 'Sun disk of Ra',
      size: 170,
      position: { bottom: '8%', right: '22%' },
      depth: 0.2,
      floatOffset: 16,
      floatDuration: 3.8,
      rotation: 8,
      scrollSpeed: 0.5, // Scroll parallax: Medium-slow
    },
  ];

  /**
   * Generate scroll parallax config for each image based on its speed
   * Different speeds create layered depth effect on scroll
   */
  public getScrollConfig(speed: number): ScrollAnimationConfig {
    return {
      animation: 'parallax',
      speed: speed,
      scrub: 1.5,
    };
  }

  public constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;

      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      this.reducedMotion.set(prefersReducedMotion);

      if (!prefersReducedMotion) {
        this.initializeAnimations();
      }
    });
  }

  public ngOnDestroy(): void {
    this.cleanup();
  }

  /**
   * Initialize all GSAP animations
   */
  private initializeAnimations(): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const container = this.elementRef.nativeElement as HTMLElement;
    const images = container.querySelectorAll('.floating-image');

    // Initialize floating animations and quickTo for each image
    images.forEach((imageEl, index) => {
      const image = this.floatingImages[index];
      const element = imageEl as HTMLElement;

      // Create floating/bobbing animation
      const floatTl = gsap.timeline({ repeat: -1, yoyo: true });
      floatTl.to(element, {
        y: image.floatOffset,
        duration: image.floatDuration,
        ease: 'sine.inOut',
      });
      this.floatTimelines.push(floatTl);

      // Create quickTo functions for smooth mouse tracking
      const xTo = gsap.quickTo(element, 'x', {
        duration: 0.8,
        ease: 'power3.out',
      });
      const yTo = gsap.quickTo(element, 'y', {
        duration: 0.8,
        ease: 'power3.out',
      });

      this.quickToFunctions.set(index, { x: xTo, y: yTo });
    });

    // Set up mouse move listener
    this.setupMouseTracking();
  }

  /**
   * Set up mouse movement tracking for parallax effect
   */
  private setupMouseTracking(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate mouse position relative to viewport center
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Normalized mouse position (-1 to 1)
      const normalizedX = (e.clientX - centerX) / centerX;
      const normalizedY = (e.clientY - centerY) / centerY;

      this.mouseX.set(normalizedX);
      this.mouseY.set(normalizedY);

      // Apply parallax to each image based on depth
      this.quickToFunctions.forEach((quickTo, index) => {
        const image = this.floatingImages[index];
        const maxOffset = 50; // Maximum pixel offset

        // Calculate offset based on depth (deeper = less movement)
        const offsetX = normalizedX * maxOffset * image.depth * -1;
        const offsetY = normalizedY * maxOffset * image.depth * -1;

        quickTo.x(offsetX);
        quickTo.y(offsetY);
      });
    };

    // Add throttled mouse move listener
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
    // Stop and kill all float timelines
    this.floatTimelines.forEach((tl) => {
      tl.kill();
    });
    this.floatTimelines = [];

    // Clear quickTo functions
    this.quickToFunctions.clear();

    // Remove mouse listener
    if (this.mouseMoveCleanup) {
      this.mouseMoveCleanup();
      this.mouseMoveCleanup = null;
    }
  }
}
