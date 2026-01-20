/**
 * Floating Geometry Scene Template
 *
 * Scene Type: Geometric Abstract / Interactive
 * Best For: SaaS landing pages, portfolio sites, creative agencies
 *
 * Key Features:
 * - Multiple polyhedron types with unique colors
 * - Float3d for gentle bobbing animation (staggered delays)
 * - MouseTracking3d for cursor-based interaction
 * - Environment map for realistic PBR reflections
 * - Subtle bloom for soft glow
 *
 * Customization Points:
 * - Colors: Match your brand palette
 * - Polyhedron types: icosahedron, octahedron, dodecahedron, tetrahedron
 * - Float timing: Vary height/speed/delay for wave-like choreography
 * - Mouse sensitivity: Higher = more responsive to cursor
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Scene3dComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PolyhedronComponent,
  BoxComponent,
  EnvironmentComponent,
  Float3dDirective,
  MouseTracking3dDirective,
  OrbitControlsComponent,
  EffectComposerComponent,
  BloomEffectComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-floating-geometry-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    DirectionalLightComponent,
    PolyhedronComponent,
    BoxComponent,
    EnvironmentComponent,
    Float3dDirective,
    MouseTracking3dDirective,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scene-container">
      <a3d-scene-3d
        [cameraPosition]="[0, 0, 20]"
        [cameraFov]="50"
        [enableAntialiasing]="true"
        [backgroundColor]="backgroundColor"
      >
        <!-- ============ LIGHTING ============ -->
        <a3d-ambient-light [intensity]="0.2" />
        <a3d-directional-light
          [position]="[5, 10, 5]"
          [intensity]="1.2"
          [color]="'#ffeedd'"
        />

        <!-- Environment for PBR reflections -->
        <a3d-environment [preset]="'sunset'" [intensity]="0.5" />

        <!-- ============ POLYHEDRONS ============ -->

        <!-- Icosahedron - Top left, indigo -->
        <a3d-polyhedron
          [type]="'icosahedron'"
          [position]="[-6, 3, 0]"
          [args]="[1.5, 0]"
          [color]="'#6366f1'"
          float3d
          [floatConfig]="{ height: 0.4, speed: 2500, ease: 'sine.inOut' }"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.3, damping: 0.08 }"
        />

        <!-- Octahedron - Top right, emerald -->
        <a3d-polyhedron
          [type]="'octahedron'"
          [position]="[5, 4, -2]"
          [args]="[1.3, 0]"
          [color]="'#10b981'"
          float3d
          [floatConfig]="{
            height: 0.5,
            speed: 3000,
            delay: 200,
            ease: 'sine.inOut'
          }"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.4, damping: 0.1 }"
        />

        <!-- Dodecahedron - Center, amber (largest/focal) -->
        <a3d-polyhedron
          [type]="'dodecahedron'"
          [position]="[0, 0, 2]"
          [args]="[2, 0]"
          [color]="'#f59e0b'"
          float3d
          [floatConfig]="{
            height: 0.3,
            speed: 2800,
            delay: 400,
            ease: 'sine.inOut'
          }"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.25, damping: 0.06 }"
        />

        <!-- Tetrahedron - Bottom left, rose -->
        <a3d-polyhedron
          [type]="'tetrahedron'"
          [position]="[-5, -3, 1]"
          [args]="[1.4, 0]"
          [color]="'#f43f5e'"
          float3d
          [floatConfig]="{
            height: 0.45,
            speed: 2600,
            delay: 600,
            ease: 'sine.inOut'
          }"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.35, damping: 0.09 }"
        />

        <!-- Cube - Bottom right, cyan -->
        <a3d-box
          [position]="[6, -2, -1]"
          [args]="[1.2, 1.2, 1.2]"
          [color]="'#06b6d4'"
          float3d
          [floatConfig]="{
            height: 0.35,
            speed: 3200,
            delay: 800,
            ease: 'sine.inOut'
          }"
          mouseTracking3d
          [trackingConfig]="{ sensitivity: 0.3, damping: 0.07 }"
        />

        <!-- ============ POST-PROCESSING ============ -->

        <!-- Subtle bloom for soft glow -->
        <a3d-effect-composer>
          <a3d-bloom-effect [threshold]="0.9" [strength]="0.3" [radius]="0.5" />
        </a3d-effect-composer>

        <!-- Orbit controls with damping -->
        <a3d-orbit-controls
          [enableDamping]="true"
          [dampingFactor]="0.05"
          [enableZoom]="true"
          [minDistance]="10"
          [maxDistance]="40"
        />
      </a3d-scene-3d>

      <!-- Scene info overlay -->
      <div class="scene-info">
        <p class="font-medium">Floating Geometry</p>
        <p class="text-sm opacity-70">
          Move your mouse to interact with the shapes
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

      .scene-info {
        position: absolute;
        bottom: 1rem;
        left: 1rem;
        z-index: 20;
        color: rgba(255, 255, 255, 0.7);
      }
    `,
  ],
})
export class FloatingGeometrySceneComponent {
  protected readonly backgroundColor = 0x0a0a1a;
}
