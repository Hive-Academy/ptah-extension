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
  ViewportAnimationDirective,
  ViewportAnimationConfig,
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
  /** Initial rotation in degrees */
  rotation: number;
  /** Scroll parallax speed (different from mouse depth for layered effect) */
  scrollSpeed: number;
  /** Slide direction for entrance animation */
  slideDirection: 'slideLeft' | 'slideRight';
}

/**
 * HeroFloatingImagesComponent - Floating Egyptian symbols with mouse + scroll parallax
 *
 * Features:
 * - 4 floating images positioned around hero
 * - Viewport entrance animation using ViewportAnimationDirective (slide from left/right)
 * - Mouse-following parallax using GSAP quickTo (faster than mouse movement)
 * - Scroll parallax using ScrollAnimationDirective (depth effect)
 * - Different depths for 3D parallax effect
 * - Respects prefers-reduced-motion
 * - Circular images with amber glow effect
 */
@Component({
  selector: 'ptah-hero-floating-images',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgOptimizedImage,
    ScrollAnimationDirective,
    ViewportAnimationDirective,
  ],
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
        <!-- Viewport entrance animation wrapper -->
        <div
          viewportAnimation
          [viewportConfig]="getViewportConfig(image.slideDirection, i)"
          (viewportEnter)="onViewportEnter(i)"
        >
          <!-- Inner mouse parallax target -->
          <div
            class="floating-image"
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

  /** Mouse move listener cleanup */
  private mouseMoveCleanup: (() => void) | null = null;

  /** Track which images have entered viewport (for mouse parallax activation) */
  private viewportEnteredImages = new Set<number>();

  /** Configuration for all floating images with mouse + scroll parallax */
  public readonly floatingImages: FloatingImage[] = [
    {
      src: '/assets/textures/ankh-sphere.png',
      alt: 'Ankh symbol',
      size: 180,
      position: { top: '8%', left: '22%' },
      depth: 0.15, // Mouse parallax: Slowest - appears farthest
      rotation: -10,
      scrollSpeed: 0.7, // Scroll parallax: Slow
      slideDirection: 'slideRight', // Slides in from left
    },
    {
      src: '/assets/textures/scarab.png',
      alt: 'Sacred scarab',
      size: 160,
      position: { top: '12%', right: '20%' },
      depth: 0.25,
      rotation: 5,
      scrollSpeed: 1.55, // Scroll parallax: Medium
      slideDirection: 'slideLeft', // Slides in from right
    },
    {
      src: '/assets/textures/eye_of_horus.png',
      alt: 'Eye of Horus',
      size: 150,
      position: { bottom: '15%', left: '20%' },
      depth: 0.35,
      rotation: -5,
      scrollSpeed: 1.95, // Scroll parallax: Faster
      slideDirection: 'slideRight', // Slides in from left
    },
    {
      src: '/assets/textures/sun_disk_ra.png',
      alt: 'Sun disk of Ra',
      size: 170,
      position: { bottom: '8%', right: '22%' },
      depth: 0.2,
      rotation: 8,
      scrollSpeed: 0.7, // Scroll parallax: Medium-slow
      slideDirection: 'slideLeft', // Slides in from right
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

  /**
   * Generate viewport entrance animation config
   * Images slide in from left or right with staggered delays
   */
  public getViewportConfig(
    direction: 'slideLeft' | 'slideRight',
    index: number
  ): ViewportAnimationConfig {
    return {
      animation: direction,
      duration: 1.2,
      delay: 0.1 + index * 0.15, // Stagger effect
      ease: 'power3.out',
      distance: 300,
      once: true, // Only animate once
    };
  }

  /**
   * Called when an image enters the viewport
   * Enables mouse parallax for that image
   */
  public onViewportEnter(index: number): void {
    this.viewportEnteredImages.add(index);
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
   * Initialize mouse parallax animations
   * Entrance animations are handled by ViewportAnimationDirective
   */
  private initializeAnimations(): void {
    const gsap = this.gsapCore.gsap;
    if (!gsap) return;

    const container = this.elementRef.nativeElement as HTMLElement;
    const images = container.querySelectorAll('.floating-image');

    // Create quickTo functions for smooth mouse tracking
    images.forEach((imageEl, index) => {
      const element = imageEl as HTMLElement;

      const xTo = gsap.quickTo(element, 'x', {
        duration: 0.6,
        ease: 'power2.out',
      });
      const yTo = gsap.quickTo(element, 'y', {
        duration: 0.6,
        ease: 'power2.out',
      });

      this.quickToFunctions.set(index, { x: xTo, y: yTo });
    });

    // Set up mouse move listener
    this.setupMouseTracking();
  }

  /**
   * Set up mouse movement tracking for parallax effect
   * Images move faster than the mouse cursor for dramatic effect
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
      // Images move FASTER than mouse (multiplier > 1) for dramatic effect
      this.quickToFunctions.forEach((quickTo, index) => {
        // Only apply parallax to images that have entered viewport
        if (!this.viewportEnteredImages.has(index)) return;

        const image = this.floatingImages[index];
        const baseOffset = 120; // Base pixel offset (increased for faster movement)
        const speedMultiplier = 2.5; // Images move 2.5x faster than mouse

        // Calculate offset: negative = opposite direction (follows mouse)
        // depth creates layered parallax (farther objects move less)
        const depthFactor = 0.5 + image.depth * 1.5; // Range: 0.65 to 1.025
        const offsetX =
          normalizedX * baseOffset * depthFactor * speedMultiplier * -1;
        const offsetY =
          normalizedY * baseOffset * depthFactor * speedMultiplier * -1;

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
    // Clear quickTo functions
    this.quickToFunctions.clear();

    // Clear viewport tracking
    this.viewportEnteredImages.clear();

    // Remove mouse listener
    if (this.mouseMoveCleanup) {
      this.mouseMoveCleanup();
      this.mouseMoveCleanup = null;
    }
  }
}
