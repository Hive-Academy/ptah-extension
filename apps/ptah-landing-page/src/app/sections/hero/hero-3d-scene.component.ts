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

/**
 * Hero3dSceneComponent - Glass/Cosmic 3D scene using @hive-academy/angular-3d
 *
 * Features:
 * - 4 glowing spheres with cosmic aesthetic
 * - 2-layer star field with counter-rotation for depth
 * - Nebula volumetric background
 * - Three-point lighting setup
 * - Bloom post-processing
 * - Full reduced motion support
 */
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
      [backgroundColor]="backgroundColor()"
      [enableShadows]="false"
    >
      <!-- Star Field Layer 1 (Foreground) -->
      <a3d-star-field
        [starCount]="2000"
        [radius]="50"
        [multiSize]="true"
        [stellarColors]="true"
        [enableRotation]="!reducedMotion()"
        [rotationSpeed]="0.015"
        [rotationAxis]="'z'"
      />

      <!-- Star Field Layer 2 (Background - counter-rotation for depth) -->
      <a3d-star-field
        [starCount]="1000"
        [radius]="60"
        [multiSize]="true"
        [enableRotation]="!reducedMotion()"
        [rotationSpeed]="-0.008"
        [rotationAxis]="'z'"
      />

      <!-- Nebula Volumetric Backdrop -->
      <a3d-nebula-volumetric
        [position]="[8, 4, -80]"
        [width]="250"
        [height]="80"
        [opacity]="0.75"
        [primaryColor]="nebulaColors().primary"
        [secondaryColor]="nebulaColors().secondary"
        [enableFlow]="false"
        [noiseScale]="3.5"
        [density]="1.2"
        [glowIntensity]="0.6"
        [centerFalloff]="1.2"
        [erosionStrength]="0.65"
        [enableEdgePulse]="true"
        [edgePulseSpeed]="0.3"
        [edgePulseAmount]="0.2"
      />

      <!-- Cosmic Sphere 1: Top-Left (Pink glow) -->
      <a3d-sphere
        [args]="[3, 64, 64]"
        [position]="[-15, 10, -15]"
        [color]="'#e879f9'"
        [metalness]="0.9"
        [roughness]="0.1"
        [emissive]="'#e879f9'"
        [emissiveIntensity]="0.5"
        float3d
        [floatConfig]="{
          height: 0.6,
          speed: 3000,
          autoStart: !reducedMotion()
        }"
        mouseTracking3d
        [trackingConfig]="{
          sensitivity: 0.8,
          damping: 0.05,
          invertX: true,
          invertPosX: true
        }"
      />

      <!-- Cosmic Sphere 2: Top-Right (Purple glow) -->
      <a3d-sphere
        [args]="[2.5, 64, 64]"
        [position]="[15, 10, -14]"
        [color]="'#a855f7'"
        [metalness]="0.9"
        [roughness]="0.1"
        [emissive]="'#a855f7'"
        [emissiveIntensity]="0.5"
        float3d
        [floatConfig]="{
          height: 0.5,
          speed: 3500,
          delay: 500,
          autoStart: !reducedMotion()
        }"
        mouseTracking3d
        [trackingConfig]="{
          sensitivity: 0.6,
          damping: 0.06,
          invertX: true,
          invertPosX: true
        }"
      />

      <!-- Cosmic Sphere 3: Bottom-Left (Pink glow) -->
      <a3d-sphere
        [args]="[2.8, 64, 64]"
        [position]="[-12, -8, -13]"
        [color]="'#f472b6'"
        [metalness]="0.9"
        [roughness]="0.1"
        [emissive]="'#f472b6'"
        [emissiveIntensity]="0.5"
        float3d
        [floatConfig]="{
          height: 0.7,
          speed: 2800,
          delay: 200,
          autoStart: !reducedMotion()
        }"
        mouseTracking3d
        [trackingConfig]="{
          sensitivity: 0.7,
          damping: 0.05,
          invertX: true,
          invertPosX: true
        }"
      />

      <!-- Cosmic Sphere 4: Bottom-Right (Amber glow) -->
      <a3d-sphere
        [args]="[3.2, 64, 64]"
        [position]="[15, -10, -16]"
        [color]="'#fbbf24'"
        [metalness]="0.9"
        [roughness]="0.1"
        [emissive]="'#fbbf24'"
        [emissiveIntensity]="0.5"
        float3d
        [floatConfig]="{
          height: 0.5,
          speed: 3200,
          delay: 800,
          autoStart: !reducedMotion()
        }"
        mouseTracking3d
        [trackingConfig]="{
          sensitivity: 0.5,
          damping: 0.07,
          invertX: true,
          invertPosX: true
        }"
      />

      <!-- Three-Point Lighting Setup -->

      <!-- Ambient Light (base illumination) -->
      <a3d-ambient-light [intensity]="0.3" />

      <!-- Key Light (main spotlight from top) -->
      <a3d-spot-light
        [position]="[0, 16, -6]"
        [intensity]="120"
        [angle]="0.5"
      />

      <!-- Fill Light (purple accent from left) -->
      <a3d-point-light
        [position]="[-10, 10, -10]"
        [intensity]="25"
        [color]="'#a855f7'"
      />

      <!-- Rim Light (pink accent from right) -->
      <a3d-point-light
        [position]="[10, 6, -8]"
        [intensity]="15"
        [color]="'#f472b6'"
      />

      <!-- Per-Sphere Spotlights for Corner Emphasis -->
      <a3d-spot-light
        [position]="[-15, 10, -10]"
        [target]="[-15, 10, -15]"
        [intensity]="40"
        [angle]="0.6"
      />
      <a3d-spot-light
        [position]="[15, 10, -9]"
        [target]="[15, 10, -14]"
        [intensity]="35"
        [angle]="0.6"
      />
      <a3d-spot-light
        [position]="[-12, -8, -8]"
        [target]="[-12, -8, -13]"
        [intensity]="38"
        [angle]="0.6"
      />
      <a3d-spot-light
        [position]="[15, -10, -11]"
        [target]="[15, -10, -16]"
        [intensity]="42"
        [angle]="0.6"
      />

      <!-- Environment Map (essential for reflections) -->
      <a3d-environment [preset]="'sunset'" [intensity]="0.8" />

      <!-- Post-Processing: Bloom for glow effect -->
      <a3d-effect-composer>
        <a3d-bloom-effect [threshold]="0.85" [strength]="0.4" [radius]="0.5" />
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
   * When true, disables all animations for accessibility
   * (respects prefers-reduced-motion media query)
   */
  readonly reducedMotion = input<boolean>(false);
  readonly backgroundColor = input<number>(0x0a0515);
  readonly nebulaColors = input<{ primary: number; secondary: number }>({
    primary: 0x8b5cf6, // Purple
    secondary: 0xec4899, // Pink
  });
}
