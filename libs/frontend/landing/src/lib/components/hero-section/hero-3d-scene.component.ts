/**
 * Hero 3D Scene Component
 *
 * Creates a Glass/Cosmic aesthetic 3D scene using @hive-academy/angular-3d components.
 * Features:
 * - 4 iridescent glass spheres with float and mouse tracking animations
 * - 2-layer star field with counter-rotation for parallax depth
 * - Nebula volumetric backdrop
 * - Three-point lighting setup with per-sphere spotlights
 * - Bloom post-processing for glow effects
 * - Environment map for realistic glass reflections
 *
 * IMPORTANT: Uses ONLY @hive-academy/angular-3d components - NO raw Three.js code
 */
import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import {
  Scene3dComponent,
  SphereComponent,
  StarFieldComponent,
  NebulaVolumetricComponent,
  AmbientLightComponent,
  SpotLightComponent,
  PointLightComponent,
  EnvironmentComponent,
  EffectComposerComponent,
  BloomEffectComponent,
  Float3dDirective,
  MouseTracking3dDirective,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'ptah-hero-3d-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Scene3dComponent,
    SphereComponent,
    StarFieldComponent,
    NebulaVolumetricComponent,
    AmbientLightComponent,
    SpotLightComponent,
    PointLightComponent,
    EnvironmentComponent,
    EffectComposerComponent,
    BloomEffectComponent,
    Float3dDirective,
    MouseTracking3dDirective,
  ],
  template: `
    <a3d-scene-3d
      [cameraPosition]="[0, 0, 35]"
      [backgroundColor]="0x0a0515"
      [enableShadows]="false"
      aria-label="3D cosmic scene with floating glass spheres"
    >
      <!-- Star Field Layer 1 (Foreground) - Larger, closer stars -->
      <a3d-star-field
        [starCount]="2000"
        [radius]="50"
        [position]="[0, 0, -20]"
        [multiSize]="true"
        [stellarColors]="true"
        [enableRotation]="!reducedMotion()"
        [rotationSpeed]="0.015"
        [rotationAxis]="'z'"
      />

      <!-- Star Field Layer 2 (Background) - Counter-rotation for parallax depth -->
      <a3d-star-field
        [starCount]="1000"
        [radius]="60"
        [position]="[0, 0, -40]"
        [multiSize]="true"
        [enableRotation]="!reducedMotion()"
        [rotationSpeed]="-0.008"
        [rotationAxis]="'z'"
      />

      <!-- Nebula Volumetric Backdrop - Purple cosmic atmosphere -->
      <a3d-nebula-volumetric
        [position]="[0, 0, -80]"
        [scale]="50"
        [color]="'#6b21a8'"
        [opacity]="0.3"
      />

      <!-- Glass Sphere 1: Top-Left - Fuchsia iridescent -->
      <a3d-sphere
        [position]="[-15, 10, -15]"
        [args]="[3, 64, 64]"
        [color]="'#e879f9'"
        [transmission]="0.9"
        [thickness]="0.5"
        [ior]="1.4"
        [clearcoat]="1.0"
        [clearcoatRoughness]="0.0"
        [roughness]="0.0"
        [iridescence]="1.0"
        [iridescenceIOR]="1.3"
        [iridescenceThicknessMin]="100"
        [iridescenceThicknessMax]="400"
        float3d
        [floatConfig]="{ height: 0.6, speed: 3000, autoStart: !reducedMotion() }"
        mouseTracking3d
        [trackingConfig]="{ sensitivity: 0.8, damping: 0.05, invertX: true, invertPosX: true }"
      />

      <!-- Glass Sphere 2: Top-Right - Purple iridescent -->
      <a3d-sphere
        [position]="[15, 10, -14]"
        [args]="[2.5, 64, 64]"
        [color]="'#a855f7'"
        [transmission]="0.9"
        [thickness]="0.5"
        [ior]="1.4"
        [clearcoat]="1.0"
        [clearcoatRoughness]="0.0"
        [roughness]="0.0"
        [iridescence]="1.0"
        [iridescenceIOR]="1.3"
        [iridescenceThicknessMin]="100"
        [iridescenceThicknessMax]="400"
        float3d
        [floatConfig]="{ height: 0.5, speed: 3500, delay: 500, autoStart: !reducedMotion() }"
        mouseTracking3d
        [trackingConfig]="{ sensitivity: 0.6, damping: 0.06, invertX: true, invertPosX: true }"
      />

      <!-- Glass Sphere 3: Bottom-Left - Pink iridescent -->
      <a3d-sphere
        [position]="[-12, -8, -13]"
        [args]="[2.8, 64, 64]"
        [color]="'#f472b6'"
        [transmission]="0.9"
        [thickness]="0.5"
        [ior]="1.4"
        [clearcoat]="1.0"
        [clearcoatRoughness]="0.0"
        [roughness]="0.0"
        [iridescence]="1.0"
        [iridescenceIOR]="1.3"
        [iridescenceThicknessMin]="100"
        [iridescenceThicknessMax]="400"
        float3d
        [floatConfig]="{ height: 0.7, speed: 2800, delay: 200, autoStart: !reducedMotion() }"
        mouseTracking3d
        [trackingConfig]="{ sensitivity: 0.7, damping: 0.05, invertX: true, invertPosX: true }"
      />

      <!-- Glass Sphere 4: Bottom-Right - Fuchsia iridescent (largest) -->
      <a3d-sphere
        [position]="[15, -10, -16]"
        [args]="[3.2, 64, 64]"
        [color]="'#e879f9'"
        [transmission]="0.9"
        [thickness]="0.5"
        [ior]="1.4"
        [clearcoat]="1.0"
        [clearcoatRoughness]="0.0"
        [roughness]="0.0"
        [iridescence]="1.0"
        [iridescenceIOR]="1.3"
        [iridescenceThicknessMin]="100"
        [iridescenceThicknessMax]="400"
        float3d
        [floatConfig]="{ height: 0.5, speed: 3200, delay: 800, autoStart: !reducedMotion() }"
        mouseTracking3d
        [trackingConfig]="{ sensitivity: 0.5, damping: 0.07, invertX: true, invertPosX: true }"
      />

      <!-- Three-Point Lighting Setup -->
      <!-- Ambient: Base illumination -->
      <a3d-ambient-light [intensity]="0.3" />

      <!-- Key Light: Top spotlight for main illumination -->
      <a3d-spot-light
        [position]="[0, 16, -6]"
        [intensity]="120"
        [angle]="0.5"
      />

      <!-- Fill Light: Purple accent from left side -->
      <a3d-point-light
        [position]="[-10, 10, -10]"
        [intensity]="25"
        [color]="'#a855f7'"
      />

      <!-- Rim Light: Pink accent from right side -->
      <a3d-point-light
        [position]="[10, 6, -8]"
        [intensity]="15"
        [color]="'#f472b6'"
      />

      <!-- Per-Sphere Spotlights for Corner Emphasis -->
      <!-- Top-Left sphere spotlight -->
      <a3d-spot-light
        [position]="[-15, 10, -10]"
        [target]="[-15, 10, -15]"
        [intensity]="40"
        [angle]="0.6"
      />
      <!-- Top-Right sphere spotlight -->
      <a3d-spot-light
        [position]="[15, 10, -9]"
        [target]="[15, 10, -14]"
        [intensity]="35"
        [angle]="0.6"
      />
      <!-- Bottom-Left sphere spotlight -->
      <a3d-spot-light
        [position]="[-12, -8, -8]"
        [target]="[-12, -8, -13]"
        [intensity]="38"
        [angle]="0.6"
      />
      <!-- Bottom-Right sphere spotlight -->
      <a3d-spot-light
        [position]="[15, -10, -11]"
        [target]="[15, -10, -16]"
        [intensity]="42"
        [angle]="0.6"
      />

      <!-- Environment Map - Essential for glass material reflections -->
      <a3d-environment [preset]="'sunset'" [intensity]="0.8" />

      <!-- Post-Processing: Bloom Effect for glow -->
      <a3d-effect-composer>
        <a3d-bloom-effect
          [threshold]="0.85"
          [strength]="0.4"
          [radius]="0.5"
        />
      </a3d-effect-composer>
    </a3d-scene-3d>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class Hero3dSceneComponent {
  /**
   * When true, disables all animations (float, rotation) for accessibility.
   * Respects prefers-reduced-motion media query.
   */
  readonly reducedMotion = input<boolean>(false);
}
