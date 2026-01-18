import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import {
  Scene3dComponent,
  // Primitives
  BoxComponent,
  SphereComponent,
  CylinderComponent,
  TorusComponent,
  PolyhedronComponent,
  // Space & Cosmic
  PlanetComponent,
  StarFieldComponent,
  NebulaVolumetricComponent,
  // Lights
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  SpotLightComponent,
  // Effects
  EffectComposerComponent,
  BloomEffectComponent,
  SelectiveBloomEffectComponent,
  EnvironmentComponent,
  // Text
  TroikaTextComponent,
  GlowTroikaTextComponent,
  // Directives (imported as directives, not components)
  Float3dDirective,
  Rotate3dDirective,
  MouseTracking3dDirective,
  // Controls
  OrbitControlsComponent,
  // Organization
  FogComponent,
} from '@hive-academy/angular-3d';

/**
 * Scene Component Template
 *
 * This template provides a starting point for creating stunning 3D scenes
 * using the @hive-academy/angular-3d library.
 *
 * CUSTOMIZATION CHECKLIST:
 * 1. Update selector and class name
 * 2. Import only components used in template
 * 3. Configure camera position and background color
 * 4. Add primitives and organize with comments
 * 5. Set up lighting appropriate for scene type
 * 6. Add animations (float, rotate, mouse tracking)
 * 7. Configure post-processing effects
 * 8. Optionally add orbit controls
 * 9. Update host styles if needed
 */
@Component({
  selector: 'app-my-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    // Import components used below
    SphereComponent,
    TorusComponent,
    StarFieldComponent,
    AmbientLightComponent,
    PointLightComponent,
    EffectComposerComponent,
    BloomEffectComponent,
    Float3dDirective,
    Rotate3dDirective,
    OrbitControlsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a3d-scene-3d
      [cameraPosition]="[0, 0, 20]"
      [cameraFov]="75"
      [backgroundColor]="0x0a0a0f"
      [enableShadows]="false">

      <!-- ============================================
           PRIMITIVES & OBJECTS
           ============================================ -->

      <!-- Example: Floating sphere -->
      <a3d-sphere
        [args]="[2, 64, 64]"
        [position]="[0, 0, 0]"
        [color]="'#00ffff'"
        float3d
        [floatConfig]="{
          height: 0.5,
          speed: 2500,
          ease: 'sine.inOut'
        }"
      />

      <!-- Example: Rotating torus -->
      <a3d-torus
        [args]="[3, 0.5, 16, 100]"
        [position]="[0, 0, -5]"
        [rotation]="[Math.PI / 4, 0, 0]"
        [color]="'#ff00ff'"
        [wireframe]="true"
        [emissive]="'#ff00ff'"
        [emissiveIntensity]="2"
        rotate3d
        [rotateConfig]="{
          axis: 'y',
          speed: 60
        }"
      />

      <!-- Example: Star field background -->
      <a3d-star-field
        [starCount]="2000"
        [radius]="40"
        [position]="[0, 0, -30]"
        [multiSize]="true"
        [stellarColors]="true"
        [enableRotation]="true"
        [rotationSpeed]="0.012"
      />


      <!-- ============================================
           LIGHTING
           ============================================ -->

      <!-- Ambient (base illumination) -->
      <a3d-ambient-light [intensity]="0.2" />

      <!-- Colored point lights (neon effect) -->
      <a3d-point-light
        [position]="[0, 0, 10]"
        [color]="'#00ffff'"
        [intensity]="2"
      />
      <a3d-point-light
        [position]="[-10, 5, 5]"
        [color]="'#ff00ff'"
        [intensity]="1.5"
      />


      <!-- ============================================
           POST-PROCESSING EFFECTS
           ============================================ -->

      <a3d-effect-composer>
        <!-- Bloom effect (glow) -->
        <a3d-bloom-effect
          [threshold]="0.7"
          [strength]="0.8"
          [radius]="0.5"
        />
      </a3d-effect-composer>


      <!-- ============================================
           CONTROLS (Optional)
           ============================================ -->

      <!-- Orbit controls for user interaction -->
      <a3d-orbit-controls
        [enableDamping]="true"
        [dampingFactor]="0.05"
        [minDistance]="10"
        [maxDistance]="50"
      />

    </a3d-scene-3d>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100vh;
    }
  `
})
export class MySceneComponent {
  // Optional: Reactive state for dynamic themes
  isDarkMode = signal(true);

  backgroundColor = computed(() =>
    this.isDarkMode() ? 0x050510 : 0x326696
  );

  // Optional: Math constants for template
  Math = Math;
}
