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
    <div
      class="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <!-- Orbit container centered on hero -->
      <div
        class="orbit-container absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        @for (image of floatingImages; track image.src; let i = $index) {
        <!-- Orbit item - positioned and animated via GSAP -->
        <div
          class="orbit-item absolute"
          [attr.data-index]="i"
          [attr.data-direction]="image.slideDirection"
        >
          <!-- Floating image -->
          <div
            class="floating-image"
            [style.width.px]="image.size"
            [style.height.px]="image.size"
            [style.opacity]="reducedMotion() ? 0.6 : 0.85"
            [style.marginLeft.px]="-image.size / 2"
            [style.marginTop.px]="-image.size / 2"
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
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
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
  private getOrbitPosition(
    index: number,
    baseAngle: number
  ): { x: number; y: number } {
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
      const offsetX =
        image.slideDirection === 'slideRight'
          ? -entranceDistance
          : entranceDistance;

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
        onComplete:
          index === orbitItems.length - 1
            ? () => this.startOrbitAnimation()
            : undefined,
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
  private updateOrbitPositions(
    items: NodeListOf<Element>,
    baseAngle: number
  ): void {
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
      const targetRadius =
        this.MIN_RADIUS +
        normalizedDistance * (this.MAX_RADIUS - this.MIN_RADIUS);

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
