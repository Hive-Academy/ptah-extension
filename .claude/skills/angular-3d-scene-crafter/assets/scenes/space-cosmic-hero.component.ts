/**
 * Space Cosmic Hero Scene Template
 *
 * Scene Type: Space / Cosmic / Ethereal
 * Best For: Tech startups, astronomy apps, futuristic themes
 *
 * Key Features:
 * - Star field with parallax scrolling layers
 * - Nebula volumetric background with cosmic colors
 * - Central animated marble sphere (planet effect)
 * - Particle field for depth
 * - Orbit controls with auto-rotation
 * - Rich bloom post-processing
 *
 * Customization Points:
 * - Star colors: Change for different galaxy feel
 * - Nebula: Swap primary/secondary colors
 * - Planet texture: Use marble component for organic, or sphere + texture
 * - Particle density: Increase count for denser star field
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Scene3dComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  StarFieldComponent,
  NebulaVolumetricComponent,
  MarbleSphereComponent,
  ParticleFieldComponent,
  Float3dDirective,
  Rotate3dDirective,
  OrbitControlsComponent,
  EffectComposerComponent,
  BloomEffectComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-space-cosmic-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    DirectionalLightComponent,
    PointLightComponent,
    StarFieldComponent,
    NebulaVolumetricComponent,
    MarbleSphereComponent,
    ParticleFieldComponent,
    Float3dDirective,
    Rotate3dDirective,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-container">
      <a3d-scene-3d
        [cameraPosition]="[0, 0, 20]"
        [cameraFov]="55"
        [enableAntialiasing]="true"
        [backgroundColor]="0x020108"
      >
        <!-- ============ LIGHTING ============ -->

        <!-- Low ambient for space darkness -->
        <a3d-ambient-light [intensity]="0.1" />

        <!-- Main sun light from side -->
        <a3d-directional-light
          [position]="[10, 5, 5]"
          [intensity]="1.5"
          [color]="'#ffeedd'"
        />

        <!-- Rim light from behind -->
        <a3d-point-light
          [position]="[-8, -3, -10]"
          [intensity]="2"
          [color]="'#6366f1'"
          [distance]="30"
        />

        <!-- Accent glow from nebula direction -->
        <a3d-point-light
          [position]="[0, 10, -15]"
          [intensity]="1.5"
          [color]="'#ec4899'"
          [distance]="25"
        />

        <!-- ============ STAR FIELD ============ -->

        <!-- Far layer - dim, slow -->
        <a3d-star-field
          [count]="3000"
          [size]="0.04"
          [spread]="150"
          [color]="'#ffffff'"
          [opacity]="0.6"
          [enableParallax]="true"
          [parallaxIntensity]="0.01"
        />

        <!-- Mid layer - medium brightness -->
        <a3d-star-field
          [count]="1500"
          [size]="0.07"
          [spread]="100"
          [color]="'#e0e7ff'"
          [opacity]="0.8"
          [enableParallax]="true"
          [parallaxIntensity]="0.02"
        />

        <!-- Near layer - bright, noticeable parallax -->
        <a3d-star-field
          [count]="500"
          [size]="0.12"
          [spread]="60"
          [color]="'#c4b5fd'"
          [opacity]="1.0"
          [enableParallax]="true"
          [parallaxIntensity]="0.04"
        />

        <!-- ============ NEBULA BACKGROUND ============ -->

        <a3d-nebula-volumetric
          [position]="[0, 5, -40]"
          [width]="80"
          [height]="50"
          [primaryColor]="'#8b5cf6'"
          [secondaryColor]="'#ec4899'"
          [opacity]="0.4"
        />

        <a3d-nebula-volumetric
          [position]="[-30, -10, -50]"
          [width]="50"
          [height]="40"
          [primaryColor]="'#3b82f6'"
          [secondaryColor]="'#6366f1'"
          [opacity]="0.3"
        />

        <!-- ============ CENTRAL PLANET ============ -->

        <a3d-marble-sphere
          [position]="[0, 0, 0]"
          [radius]="4"
          [segments]="64"
          [primaryColor]="'#3b82f6'"
          [secondaryColor]="'#6366f1'"
          [noiseScale]="3"
          [speed]="0.3"
          float3d
          [floatConfig]="{ height: 0.3, speed: 5000 }"
          rotate3d
          [rotateConfig]="{ axis: 'y', speed: 0.2 }"
        />

        <!-- Moon orbiting the planet -->
        <a3d-marble-sphere
          [position]="[7, 2, 0]"
          [radius]="0.8"
          [segments]="32"
          [primaryColor]="'#94a3b8'"
          [secondaryColor]="'#64748b'"
          [noiseScale]="5"
          [speed]="0.1"
          float3d
          [floatConfig]="{ height: 0.2, speed: 3000 }"
        />

        <!-- ============ PARTICLE FIELD ============ -->

        <!-- Cosmic dust particles -->
        <a3d-particle-field
          [count]="200"
          [size]="0.1"
          [spread]="40"
          [color]="'#a78bfa'"
          [opacity]="0.5"
        />

        <!-- ============ POST-PROCESSING ============ -->

        <a3d-effect-composer>
          <a3d-bloom-effect [threshold]="0.6" [strength]="0.8" [radius]="0.5" />
        </a3d-effect-composer>

        <!-- Interactive orbit with auto-rotation -->
        <a3d-orbit-controls
          [autoRotate]="true"
          [autoRotateSpeed]="0.2"
          [enableDamping]="true"
          [dampingFactor]="0.05"
          [minDistance]="12"
          [maxDistance]="50"
        />
      </a3d-scene-3d>

      <!-- Overlay content -->
      <div class="hero-overlay">
        <h1 class="hero-title">Explore the Cosmos</h1>
        <p class="hero-subtitle">
          Journey through the infinite beauty of space
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100vh;
      }

      .scene-container {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .hero-overlay {
        position: absolute;
        bottom: 4rem;
        left: 4rem;
        z-index: 10;
        color: white;
      }

      .hero-title {
        font-size: 3rem;
        font-weight: bold;
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, #8b5cf6, #ec4899);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .hero-subtitle {
        font-size: 1.25rem;
        opacity: 0.8;
      }
    `,
  ],
})
export class SpaceCosmicHeroSceneComponent {}
