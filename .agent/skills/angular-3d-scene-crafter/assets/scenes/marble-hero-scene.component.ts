/**
 * Glass Bubble Hero Scene - Example Hero Section with 3D Background
 *
 * Demonstrates how to combine <a3d-marble-sphere> with HTML overlays
 * for a hero section with 3D background.
 *
 * Key patterns demonstrated:
 * 1. Using MarbleSphereComponent for pure transparent glass bubbles
 * 2. Layering HTML content above 3D canvas with image background
 * 3. Environment-based reflections on glossy glass (metalness=1.0)
 * 4. Static bubble positioning with ultra-smooth surfaces (roughness=0.01)
 * 5. Dramatic spotlight for shadows and surface highlights
 * 6. Fill lighting for balanced illumination
 * 7. Realistic glass bubble effect reflecting background environment
 * 8. Immediate entrance animations (not scroll-triggered) for hero text
 */
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
} from '@angular/core';
import {
  AmbientLightComponent,
  MarbleSphereComponent,
  OrbitControlsComponent,
  PointLightComponent,
  Scene3dComponent,
  SceneService,
  SpotLightComponent,
} from '@hive-academy/angular-3d';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { GsapCoreService } from '@hive-academy/angular-gsap';
import * as THREE from 'three/webgpu';

/**
 * Content Component - Contains 3D elements with environment reflections
 */
@Component({
  selector: 'app-marble-hero-content',
  standalone: true,
  imports: [
    AmbientLightComponent,
    OrbitControlsComponent,
    MarbleSphereComponent,
    PointLightComponent,
    SpotLightComponent,
  ],
  template: `
    <!-- Environment reflections loaded from JPG background -->

    <!-- Main glass bubble (transparent) - center right -->
    <a3d-marble-sphere
      [radius]="0.35"
      [position]="[0.2, 0.15, 0]"
      [edgeColor]="'#ffffff'"
      [edgeIntensity]="0.2"
      [iterations]="16"
      [roughness]="0.01"
      [metalness]="1.0"
    />

    <!-- Second glass bubble (transparent) - top left -->
    <a3d-marble-sphere
      [radius]="0.18"
      [position]="[-0.35, 0.5, -0.1]"
      [edgeColor]="'#ffffff'"
      [edgeIntensity]="0.2"
      [iterations]="12"
      [roughness]="0.01"
      [metalness]="1.0"
    />

    <!-- Third glass bubble (transparent) - bottom left -->
    <a3d-marble-sphere
      [radius]="0.08"
      [position]="[-0.5, -0.1, 0.15]"
      [edgeColor]="'#ffffff'"
      [edgeIntensity]="0.2"
      [iterations]="10"
      [roughness]="0.01"
      [metalness]="1.0"
    />

    <!-- Dramatic spotlight from top-right for shadows and highlights -->
    <a3d-spot-light
      [position]="[3, 5, 3]"
      [intensity]="15"
      [angle]="Math.PI / 4"
      [penumbra]="0.5"
      [decay]="2"
      [distance]="20"
      [castShadow]="true"
      [color]="whiteLight"
    />

    <!-- Soft ambient light for overall scene -->
    <a3d-ambient-light [color]="whiteLight" [intensity]="0.3" />

    <!-- Fill light from opposite side (no shadows) -->
    <a3d-point-light
      [position]="[-3, 2, -2]"
      [intensity]="5"
      [distance]="10"
      [color]="whiteLight"
    />

    <!-- Static orbit controls (no auto-rotation) -->
    <a3d-orbit-controls
      [target]="[0, 0.25, 0]"
      [maxDistance]="1.5"
      [minDistance]="0.4"
      [autoRotate]="false"
      [enableDamping]="true"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarbleHeroContentComponent implements AfterViewInit {
  private readonly sceneService = inject(SceneService);
  private readonly destroyRef = inject(DestroyRef);
  private envTexture: THREE.Texture | null = null;

  // Light color for simple white lighting
  protected readonly whiteLight = 0xffffff;
  // Math for template expressions
  protected readonly Math = Math;

  public ngAfterViewInit(): void {
    // Load environment map after scene is initialized
    this.loadEnvironmentMap();

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      if (this.envTexture) {
        this.envTexture.dispose();
        this.envTexture = null;
      }
    });
  }

  /**
   * Load the JPG background as an environment map for reflections
   */
  private loadEnvironmentMap(): void {
    const scene = this.sceneService.scene();
    if (!scene) {
      // Scene not ready yet, retry after a short delay
      setTimeout(() => this.loadEnvironmentMap(), 50);
      return;
    }

    // Load the same background image used in CSS
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      'background-marble.png',
      (texture) => {
        // Configure texture for environment mapping
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        // Apply to scene environment for reflections
        scene.environment = texture;
        scene.environmentIntensity = 0.8;

        // Store reference for cleanup
        this.envTexture = texture;
      },
      undefined,
      (error) => {
        console.error('Error loading environment texture:', error);
      }
    );
  }
}

/**
 * Parent Container with Image Background and 3D Overlay with Scroll Animations
 */
@Component({
  selector: 'app-marble-hero-scene',
  standalone: true,
  imports: [Scene3dComponent, MarbleHeroContentComponent],
  template: `
    <div class="hero-container">
      <!-- Background Image Layer -->
      <div class="background-image"></div>

      <!-- 3D Scene Layer (transparent background) -->
      <a3d-scene-3d
        [cameraPosition]="[0, 0.3, 0.8]"
        [cameraNear]="0.025"
        [cameraFar]="5"
        [frameloop]="'always'"
        [enableShadows]="true"
      >
        <app-marble-hero-content />
      </a3d-scene-3d>

      <!-- HTML Overlay Content -->
      <div class="hero-overlay">
        <h1 class="hero-title">Glass Bubbles</h1>
        <p class="hero-subtitle">
          Realistic glass bubbles with environment reflections
        </p>
        <div class="hero-cta">
          <button class="cta-button">Get Started</button>
          <button class="cta-button secondary">Learn More</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 85vh;
        min-height: 500px;
        position: relative;
      }

      .hero-container {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .background-image {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image: url('/background-marble.png');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }

      a3d-scene-3d {
        position: absolute;
        inset: 0;
        z-index: 1;
      }

      .hero-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        pointer-events: none;
        text-align: center;
      }

      .hero-title {
        font-size: clamp(2.5rem, 8vw, 5rem);
        font-weight: 700;
        color: white;
        margin: 0 0 1rem;
        text-shadow: 0 4px 20px rgba(0, 0, 0, 0.8),
          0 0 40px rgba(0, 180, 255, 0.3);
      }

      .hero-subtitle {
        font-size: clamp(1rem, 3vw, 1.5rem);
        color: rgba(255, 255, 255, 0.85);
        margin: 0 0 2rem;
        max-width: 600px;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
      }

      .hero-cta {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
        justify-content: center;
        pointer-events: auto;
      }

      .cta-button {
        padding: 0.875rem 2rem;
        font-size: 1rem;
        font-weight: 600;
        border: none;
        border-radius: 9999px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        background: linear-gradient(135deg, #00b8ff, #0088cc);
        color: white;
      }

      .cta-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(0, 184, 255, 0.5);
      }

      .cta-button.secondary {
        background: rgba(0, 0, 0, 0.3);
        border: 2px solid rgba(0, 184, 255, 0.6);
        color: white;
        backdrop-filter: blur(4px);
      }

      .cta-button.secondary:hover {
        background: rgba(0, 184, 255, 0.15);
        border-color: #00b8ff;
        box-shadow: 0 8px 30px rgba(0, 184, 255, 0.3);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarbleHeroSceneComponent implements AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly gsapCore = inject(GsapCoreService);
  private readonly elementRef = inject(ElementRef);

  public ngAfterViewInit(): void {
    // Setup entrance animations after view is initialized
    this.setupScrollAnimations();
  }

  /**
   * Setup GSAP entrance animations for text (plays immediately on load)
   */
  private setupScrollAnimations(): void {
    const gsap = this.gsapCore.gsap;

    if (!gsap) {
      console.warn('[MarbleHeroScene] GSAP not available');
      return;
    }

    const container =
      this.elementRef.nativeElement.querySelector('.hero-container');
    const title = container?.querySelector('.hero-title');
    const subtitle = container?.querySelector('.hero-subtitle');
    const cta = container?.querySelector('.hero-cta');

    if (!container || !title || !subtitle || !cta) {
      console.warn('[MarbleHeroScene] Required elements not found');
      return;
    }

    // Set initial state (hidden, slightly below)
    gsap.set([title, subtitle, cta], { opacity: 0, y: 30 });

    // Create entrance timeline that plays immediately
    const timeline = gsap.timeline({ delay: 0.3 }); // Small delay after page load

    timeline
      .to(title, {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power2.out',
      })
      .to(
        subtitle,
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power2.out',
        },
        '-=0.4'
      ) // Overlap by 0.4s
      .to(
        cta,
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: 'power2.out',
        },
        '-=0.4'
      ); // Overlap by 0.4s
  }
}
