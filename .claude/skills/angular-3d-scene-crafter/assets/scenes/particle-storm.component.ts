/**
 * Particle Storm Hero Scene Template
 *
 * Scene Type: Dynamic Particles / Storm / Energy
 * Best For: Gaming, action products, high-energy brands
 *
 * Key Features:
 * - Particle field with vortex animation
 * - Multiple particle layers at different speeds
 * - Strong bloom for energy effect
 * - Mouse tracking for interactive particles
 * - Dramatic lighting with colored point lights
 *
 * Customization Points:
 * - Particle count: More = denser storm (balance with performance)
 * - Colors: Match brand colors for cohesive look
 * - Vortex speed/strength: Control storm intensity
 * - Spread: Larger = wider particle field
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Scene3dComponent,
  AmbientLightComponent,
  PointLightComponent,
  ParticleFieldComponent,
  SphereComponent,
  MouseTracking3dDirective,
  OrbitControlsComponent,
  EffectComposerComponent,
  BloomEffectComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-particle-storm-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    PointLightComponent,
    ParticleFieldComponent,
    SphereComponent,
    MouseTracking3dDirective,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-container">
      <a3d-scene-3d
        [cameraPosition]="[0, 0, 30]"
        [cameraFov]="60"
        [enableAntialiasing]="true"
        [backgroundColor]="0x050508"
      >
        <!-- ============ LIGHTING ============ -->

        <a3d-ambient-light [intensity]="0.1" />

        <!-- Core energy light -->
        <a3d-point-light
          [position]="[0, 0, 0]"
          [intensity]="5"
          [color]="'#6366f1'"
          [distance]="50"
        />

        <!-- Accent lights -->
        <a3d-point-light
          [position]="[10, 10, 10]"
          [intensity]="3"
          [color]="'#ec4899'"
          [distance]="40"
        />
        <a3d-point-light
          [position]="[-10, -10, 10]"
          [intensity]="3"
          [color]="'#8b5cf6'"
          [distance]="40"
        />

        <!-- ============ PARTICLE LAYERS ============ -->

        <!-- Outer layer - slow, sparse -->
        <a3d-particle-field
          [count]="2000"
          [size]="0.08"
          [spread]="60"
          [color]="'#6366f1'"
          [opacity]="0.6"
          [enableVortex]="true"
          [vortexSpeed]="0.3"
          [vortexStrength]="2"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.1, damping: 0.02 }"
        />

        <!-- Middle layer - medium speed -->
        <a3d-particle-field
          [count]="1500"
          [size]="0.1"
          [spread]="40"
          [color]="'#a855f7'"
          [opacity]="0.7"
          [enableVortex]="true"
          [vortexSpeed]="0.5"
          [vortexStrength]="3"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.15, damping: 0.03 }"
        />

        <!-- Inner layer - fast, dense -->
        <a3d-particle-field
          [count]="1000"
          [size]="0.12"
          [spread]="25"
          [color]="'#ec4899'"
          [opacity]="0.8"
          [enableVortex]="true"
          [vortexSpeed]="0.8"
          [vortexStrength]="4"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.2, damping: 0.04 }"
        />

        <!-- Core particles - fastest -->
        <a3d-particle-field
          [count]="300"
          [size]="0.15"
          [spread]="10"
          [color]="'#ffffff'"
          [opacity]="1"
          [enableVortex]="true"
          [vortexSpeed]="1.2"
          [vortexStrength]="5"
        />

        <!-- ============ CENTRAL CORE ============ -->

        <!-- Energy core sphere -->
        <a3d-sphere
          [position]="[0, 0, 0]"
          [args]="[2, 32, 32]"
          [color]="'#6366f1'"
          [emissive]="'#6366f1'"
          [emissiveIntensity]="2"
          [opacity]="0.3"
          [transparent]="true"
        />

        <!-- Inner bright core -->
        <a3d-sphere
          [position]="[0, 0, 0]"
          [args]="[0.8, 32, 32]"
          [color]="'#ffffff'"
          [emissive]="'#ffffff'"
          [emissiveIntensity]="3"
        />

        <!-- ============ POST-PROCESSING ============ -->

        <a3d-effect-composer>
          <a3d-bloom-effect [threshold]="0.4" [strength]="1.5" [radius]="0.5" />
        </a3d-effect-composer>

        <!-- Orbit controls with auto-rotation -->
        <a3d-orbit-controls
          [autoRotate]="true"
          [autoRotateSpeed]="0.3"
          [enableDamping]="true"
          [dampingFactor]="0.05"
          [minDistance]="15"
          [maxDistance]="60"
        />
      </a3d-scene-3d>

      <!-- Hero overlay -->
      <div class="hero-overlay">
        <h1 class="hero-title">Unleash the Storm</h1>
        <p class="hero-subtitle">Power. Energy. Motion.</p>
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
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        text-align: center;
        color: white;
      }

      .hero-title {
        font-size: 4rem;
        font-weight: bold;
        margin-bottom: 0.5rem;
        text-shadow: 0 0 20px rgba(99, 102, 241, 0.8);
      }

      .hero-subtitle {
        font-size: 1.5rem;
        opacity: 0.8;
        letter-spacing: 0.5em;
        text-transform: uppercase;
      }
    `,
  ],
})
export class ParticleStormSceneComponent {}
