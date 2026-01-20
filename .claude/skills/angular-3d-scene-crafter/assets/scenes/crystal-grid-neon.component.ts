/**
 * Crystal Grid Neon Scene Template
 *
 * Scene Type: Cyberpunk / Neon
 * Best For: Tech products, gaming, futuristic branding
 *
 * Key Features:
 * - Wireframe geometry with emissive materials
 * - Multi-axis rotation animations
 * - Strong bloom post-processing
 * - Colored point lights matching object colors
 * - Auto-rotating orbit controls
 *
 * Customization Points:
 * - Colors: Change emissive colors for different mood (cyan, magenta, yellow are classic)
 * - Geometry: Swap toruses for boxes, polyhedrons, or mix
 * - Rotation speeds: Vary for different energy levels
 * - Bloom strength: Lower threshold = more glow
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  AmbientLightComponent,
  BloomEffectComponent,
  EffectComposerComponent,
  Glow3dDirective,
  OrbitControlsComponent,
  PointLightComponent,
  Rotate3dDirective,
  Scene3dComponent,
  TorusComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-crystal-grid-neon-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    PointLightComponent,
    TorusComponent,
    Rotate3dDirective,
    Glow3dDirective,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-container">
      <a3d-scene-3d
        [cameraPosition]="[0, 0, 25]"
        [cameraFov]="50"
        [backgroundColor]="0x0a0a0f"
      >
        <!-- Minimal ambient - let emissive materials shine -->
        <a3d-ambient-light [intensity]="0.15" />

        <!-- Colored point lights matching torus colors -->
        <a3d-point-light
          [position]="[0, 0, 10]"
          [intensity]="2"
          [color]="'#00ffff'"
          [distance]="50"
        />
        <a3d-point-light
          [position]="[-10, 5, 5]"
          [intensity]="1.5"
          [color]="'#ff00ff'"
          [distance]="40"
        />

        <!-- ============ NEON TORUSES ============ -->

        <!-- Crystal Torus 1 - Cyan (Top Left) -->
        <a3d-torus
          [position]="[-8, 4, 0]"
          [args]="[2, 0.5, 16, 50]"
          [color]="'#00ffff'"
          [wireframe]="true"
          [emissive]="'#00ffff'"
          [emissiveIntensity]="2"
          rotate3d
          [rotateConfig]="{ axis: 'y', speed: 1 }"
          a3dGlow3d
          [glowColor]="'#00ffff'"
          [glowIntensity]="0.3"
          [glowScale]="1.3"
        />

        <!-- Crystal Torus 2 - Magenta (Bottom Right) -->
        <a3d-torus
          [position]="[8, -4, 0]"
          [args]="[2.5, 0.6, 16, 50]"
          [color]="'#ff00ff'"
          [wireframe]="true"
          [emissive]="'#ff00ff'"
          [emissiveIntensity]="2"
          rotate3d
          [rotateConfig]="{ axis: 'x', speed: 0.8 }"
          a3dGlow3d
          [glowColor]="'#ff00ff'"
          [glowIntensity]="0.3"
          [glowScale]="1.3"
        />

        <!-- Crystal Torus 3 - Yellow (Center Back) -->
        <a3d-torus
          [position]="[0, 0, -5]"
          [args]="[3, 0.7, 16, 50]"
          [color]="'#ffff00'"
          [wireframe]="true"
          [emissive]="'#ffff00'"
          [emissiveIntensity]="2"
          rotate3d
          [rotateConfig]="{ axis: 'z', speed: 0.6 }"
          a3dGlow3d
          [glowColor]="'#ffff00'"
          [glowIntensity]="0.3"
          [glowScale]="1.3"
        />

        <!-- Crystal Torus 4 - Cyan variant (Top Right) -->
        <a3d-torus
          [position]="[6, 6, -3]"
          [args]="[1.5, 0.4, 16, 50]"
          [color]="'#00ffcc'"
          [wireframe]="true"
          [emissive]="'#00ffcc'"
          [emissiveIntensity]="2"
          rotate3d
          [rotateConfig]="{ axis: 'y', speed: 1.2 }"
          a3dGlow3d
          [glowColor]="'#00ffcc'"
          [glowIntensity]="0.25"
          [glowScale]="1.25"
        />

        <!-- Crystal Torus 5 - Magenta variant (Bottom Left) -->
        <a3d-torus
          [position]="[-6, -6, -3]"
          [args]="[1.5, 0.4, 16, 50]"
          [color]="'#ff00cc'"
          [wireframe]="true"
          [emissive]="'#ff00cc'"
          [emissiveIntensity]="2"
          rotate3d
          [rotateConfig]="{ axis: 'x', speed: 1.4 }"
          a3dGlow3d
          [glowColor]="'#ff00cc'"
          [glowIntensity]="0.25"
          [glowScale]="1.25"
        />

        <!-- ============ POST-PROCESSING ============ -->

        <!-- Strong Bloom for Neon Effect -->
        <a3d-effect-composer>
          <a3d-bloom-effect [threshold]="0.5" [strength]="1.2" [radius]="0.4" />
        </a3d-effect-composer>

        <!-- Interactive Controls with Auto-Rotation -->
        <a3d-orbit-controls
          [autoRotate]="true"
          [autoRotateSpeed]="0.5"
          [enableDamping]="true"
          [dampingFactor]="0.05"
          [minDistance]="12"
          [maxDistance]="45"
        />
      </a3d-scene-3d>
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
    `,
  ],
})
export class CrystalGridNeonSceneComponent {}
