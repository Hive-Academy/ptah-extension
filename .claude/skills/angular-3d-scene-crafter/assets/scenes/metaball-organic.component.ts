/**
 * Metaball Organic Scene Template
 *
 * Scene Type: Organic / Fluid / Morphing
 * Best For: Creative agencies, experimental sites, biotech
 *
 * Key Features:
 * - MetaballSystem with multiple globs that merge organically
 * - Each metaball follows its own orbit path
 * - Subtle bloom for soft organic glow
 * - Environment mapping for realistic reflections
 * - Optional transmission for liquid/glass effect
 *
 * Customization Points:
 * - Material: metalness=1 + roughness=0 for chrome, or transmission for glass
 * - Colors: Change per-glob colors for rainbow/gradient effects
 * - Orbit paths: Modify radius/period for different motion patterns
 * - Resolution: Higher = smoother but more expensive
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Scene3dComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  MetaballSystemComponent,
  MetaballGlobComponent,
  EnvironmentComponent,
  OrbitControlsComponent,
  EffectComposerComponent,
  BloomEffectComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-metaball-organic-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    DirectionalLightComponent,
    PointLightComponent,
    MetaballSystemComponent,
    MetaballGlobComponent,
    EnvironmentComponent,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-container">
      <a3d-scene-3d
        [cameraPosition]="[0, 0, 12]"
        [cameraFov]="50"
        [enableAntialiasing]="true"
        [backgroundColor]="0x050510"
      >
        <!-- ============ LIGHTING ============ -->

        <a3d-ambient-light [intensity]="0.3" />

        <a3d-directional-light
          [position]="[5, 10, 5]"
          [intensity]="1.5"
          [color]="'#ffffff'"
        />

        <!-- Colored accent lights -->
        <a3d-point-light
          [position]="[-5, 3, 5]"
          [intensity]="3"
          [color]="'#ec4899'"
          [distance]="20"
        />
        <a3d-point-light
          [position]="[5, -3, 5]"
          [intensity]="3"
          [color]="'#8b5cf6'"
          [distance]="20"
        />

        <!-- Environment for reflections -->
        <a3d-environment [preset]="'sunset'" [intensity]="0.4" />

        <!-- ============ METABALL SYSTEM ============ -->

        <a3d-metaball-system
          [resolution]="80"
          [isolation]="80"
          [metalness]="0.9"
          [roughness]="0.1"
          [color]="'#a855f7'"
        >
          <!-- Central large glob -->
          <a3d-metaball-glob
            [position]="[0, 0, 0]"
            [strength]="1.2"
            [subtract]="12"
          />

          <!-- Orbiting globs with different phases -->
          <a3d-metaball-glob
            [strength]="0.8"
            [subtract]="12"
            [orbitRadius]="3"
            [orbitSpeed]="1"
            [orbitAxis]="'y'"
          />

          <a3d-metaball-glob
            [strength]="0.7"
            [subtract]="12"
            [orbitRadius]="2.5"
            [orbitSpeed]="1.3"
            [orbitAxis]="'x'"
            [orbitPhase]="90"
          />

          <a3d-metaball-glob
            [strength]="0.6"
            [subtract]="12"
            [orbitRadius]="3.5"
            [orbitSpeed]="0.8"
            [orbitAxis]="'z'"
            [orbitPhase]="180"
          />

          <a3d-metaball-glob
            [strength]="0.5"
            [subtract]="12"
            [orbitRadius]="2"
            [orbitSpeed]="1.5"
            [orbitAxis]="'y'"
            [orbitPhase]="270"
          />
        </a3d-metaball-system>

        <!-- ============ POST-PROCESSING ============ -->

        <a3d-effect-composer>
          <a3d-bloom-effect [threshold]="0.7" [strength]="0.5" [radius]="0.4" />
        </a3d-effect-composer>

        <!-- Orbit controls -->
        <a3d-orbit-controls
          [enableDamping]="true"
          [dampingFactor]="0.05"
          [minDistance]="6"
          [maxDistance]="25"
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
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class MetaballOrganicSceneComponent {}
