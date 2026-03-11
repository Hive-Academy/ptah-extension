/**
 * Bubble Dream Hero Scene Template
 *
 * Scene Type: Glass / Bubble / Dreamy
 * Best For: Luxury brands, beauty products, ethereal/magical themes
 *
 * Key Features:
 * - Corner-positioned glass bubbles with transmission materials
 * - Per-bubble spotlight for dramatic lighting
 * - Inverted mouse tracking for depth parallax effect
 * - Float animation for organic motion
 * - Volumetric nebula background with dreamy colors
 * - HTML overlay support for marketing content
 *
 * Customization Points:
 * - Colors: Pink/purple palette can be changed to match branding
 * - Bubble positions: Adjust corner positions for different layouts
 * - Iridescence: Add [iridescence]="1.0" for soap bubble effect
 * - Nebula colors: primaryColor and secondaryColor for background mood
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  AmbientLightComponent,
  BloomEffectComponent,
  BubbleTextComponent,
  EffectComposerComponent,
  Float3dDirective,
  FloatingSphereComponent,
  MouseTracking3dDirective,
  NebulaVolumetricComponent,
  PointLightComponent,
  Scene3dComponent,
  SpotLightComponent,
} from '@hive-academy/angular-3d';

@Component({
  selector: 'app-bubble-dream-hero-scene',
  standalone: true,
  imports: [
    Scene3dComponent,
    AmbientLightComponent,
    PointLightComponent,
    SpotLightComponent,
    NebulaVolumetricComponent,
    BubbleTextComponent,
    FloatingSphereComponent,
    Float3dDirective,
    EffectComposerComponent,
    BloomEffectComponent,
    MouseTracking3dDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero-container">
      <!-- Layer 1: 3D Scene (background) -->
      <div class="scene-layer">
        <a3d-scene-3d
          [cameraPosition]="[0, 0, 15]"
          [cameraFov]="50"
          [enableAntialiasing]="true"
          [alpha]="false"
          [backgroundColor]="backgroundColor"
        >
          <!-- ============ LIGHTING ============ -->

          <!-- Very dim ambient for deep shadows -->
          <a3d-ambient-light [intensity]="0.15" />

          <!-- Main spotlight on center - dramatic top-down illumination -->
          <a3d-spot-light
            [position]="[0, 16, -6]"
            [target]="[0, 8, -12]"
            [intensity]="120"
            [color]="'#ffffff'"
            [angle]="0.5"
            [penumbra]="0.6"
            [distance]="40"
            [decay]="1.2"
          />

          <!-- Accent rim light from left side - purple glow -->
          <a3d-point-light
            [position]="[-10, 10, -10]"
            [intensity]="25"
            [color]="'#a855f7'"
            [distance]="30"
            [decay]="2"
          />

          <!-- Subtle warm fill from right side - pink accent -->
          <a3d-point-light
            [position]="[10, 6, -8]"
            [intensity]="15"
            [color]="'#f472b6'"
            [distance]="25"
            [decay]="2"
          />

          <!-- ============ CORNER BUBBLE SPHERES ============ -->

          <!-- Top-Left Corner Bubble -->
          <a3d-floating-sphere
            float3d
            [floatConfig]="{ height: 0.6, speed: 4000 }"
            [position]="[-15, 10, -15]"
            [args]="[2, 32, 32]"
            [color]="'#e879f9'"
            [metalness]="0.0"
            [roughness]="0.0"
            [transmission]="0.9"
            [thickness]="0.5"
            [ior]="1.4"
            [clearcoat]="1.0"
            [clearcoatRoughness]="0.0"
            mouseTracking3d
            [trackingConfig]="{
              sensitivity: 0.8,
              limit: 0.5,
              damping: 0.05,
              invertX: true,
              translationRange: [10, 5],
              invertPosX: true
            }"
          />
          <!-- Spotlight for Top-Left Bubble -->
          <a3d-spot-light
            [position]="[-12, 14, -8]"
            [target]="[-15, 10, -15]"
            [intensity]="40"
            [color]="'#e879f9'"
            [angle]="0.4"
            [penumbra]="0.8"
            [distance]="25"
            [decay]="1.5"
          />

          <!-- Top-Right Corner Bubble -->
          <a3d-floating-sphere
            float3d
            [floatConfig]="{ height: 0.8, speed: 5000 }"
            [position]="[15, 10, -14]"
            [args]="[2.5, 32, 32]"
            [color]="'#a855f7'"
            [metalness]="0.0"
            [roughness]="0.0"
            [transmission]="0.9"
            [thickness]="0.5"
            [ior]="1.4"
            [clearcoat]="1.0"
            [clearcoatRoughness]="0.0"
            mouseTracking3d
            [trackingConfig]="{
              sensitivity: 0.8,
              limit: 0.5,
              damping: 0.05,
              invertX: true,
              translationRange: [10, 5],
              invertPosX: true
            }"
          />
          <!-- Spotlight for Top-Right Bubble -->
          <a3d-spot-light
            [position]="[12, 14, -7]"
            [target]="[15, 10, -14]"
            [intensity]="40"
            [color]="'#a855f7'"
            [angle]="0.4"
            [penumbra]="0.8"
            [distance]="25"
            [decay]="1.5"
          />

          <!-- Bottom-Left Corner Bubble -->
          <a3d-floating-sphere
            float3d
            [floatConfig]="{ height: 0.5, speed: 3500 }"
            [position]="[-12, -8, -13]"
            [args]="[1.8, 32, 32]"
            [color]="'#f472b6'"
            [metalness]="0.0"
            [roughness]="0.0"
            [transmission]="0.9"
            [thickness]="0.5"
            [ior]="1.4"
            [clearcoat]="1.0"
            [clearcoatRoughness]="0.0"
            mouseTracking3d
            [trackingConfig]="{
              sensitivity: 0.8,
              limit: 0.5,
              damping: 0.05,
              invertY: true,
              translationRange: [10, 5],
              invertPosY: true
            }"
          />
          <!-- Spotlight for Bottom-Left Bubble -->
          <a3d-spot-light
            [position]="[-9, -4, -6]"
            [target]="[-12, -8, -13]"
            [intensity]="35"
            [color]="'#f472b6'"
            [angle]="0.4"
            [penumbra]="0.8"
            [distance]="20"
            [decay]="1.5"
          />

          <!-- Bottom-Right Corner Bubble -->
          <a3d-floating-sphere
            float3d
            [floatConfig]="{ height: 0.7, speed: 4500 }"
            [position]="[15, -10, -16]"
            [args]="[2.2, 32, 32]"
            [color]="'#d946ef'"
            [metalness]="0.0"
            [roughness]="0.0"
            [transmission]="0.9"
            [thickness]="0.5"
            [ior]="1.4"
            [clearcoat]="1.0"
            [clearcoatRoughness]="0.0"
            mouseTracking3d
            [trackingConfig]="{
              sensitivity: 0.8,
              limit: 0.5,
              damping: 0.05,
              invertY: true,
              translationRange: [10, 5],
              invertPosY: true
            }"
          />
          <!-- Spotlight for Bottom-Right Bubble -->
          <a3d-spot-light
            [position]="[12, -6, -9]"
            [target]="[15, -10, -16]"
            [intensity]="35"
            [color]="'#d946ef'"
            [angle]="0.4"
            [penumbra]="0.8"
            [distance]="40"
            [decay]="1.5"
          />

          <!-- ============ BACKGROUND ============ -->

          <!-- Dreamy nebula background with pink/purple gradients -->
          <a3d-nebula-volumetric
            [position]="[0, 0, -20]"
            [width]="50"
            [height]="35"
            [primaryColor]="nebulaColors.primary"
            [secondaryColor]="nebulaColors.secondary"
            [opacity]="0.5"
          />

          <!-- ============ POST-PROCESSING ============ -->

          <!-- Subtle bloom for ethereal atmosphere -->
          <a3d-effect-composer>
            <a3d-bloom-effect
              [threshold]="0.85"
              [strength]="0.4"
              [radius]="0.5"
            />
          </a3d-effect-composer>
        </a3d-scene-3d>
      </div>

      <!-- Layer 2: HTML Overlay (foreground) -->
      <div class="overlay-layer">
        <div class="hero-content">
          <h1 class="hero-title">Your Brand</h1>
          <p class="hero-subtitle">Stunning 3D experiences for your audience</p>
          <div class="hero-cta">
            <button class="cta-primary">Get Started</button>
            <button class="cta-secondary">Learn More</button>
          </div>
        </div>
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

      .hero-container {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .scene-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
      }

      .overlay-layer {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }

      .hero-content {
        text-align: center;
        color: white;
        pointer-events: auto;
      }

      .hero-title {
        font-size: 4rem;
        font-weight: bold;
        margin-bottom: 1rem;
        background: linear-gradient(135deg, #e879f9, #a855f7, #f472b6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .hero-subtitle {
        font-size: 1.25rem;
        opacity: 0.8;
        margin-bottom: 2rem;
      }

      .hero-cta {
        display: flex;
        gap: 1rem;
        justify-content: center;
      }

      .cta-primary {
        padding: 0.75rem 2rem;
        background: linear-gradient(135deg, #a855f7, #ec4899);
        color: white;
        border: none;
        border-radius: 9999px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .cta-primary:hover {
        transform: scale(1.05);
        box-shadow: 0 10px 40px rgba(168, 85, 247, 0.4);
      }

      .cta-secondary {
        padding: 0.75rem 2rem;
        background: rgba(255, 255, 255, 0.1);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 9999px;
        font-weight: 600;
        cursor: pointer;
        backdrop-filter: blur(8px);
        transition: background 0.2s;
      }

      .cta-secondary:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    `,
  ],
})
export class BubbleDreamHeroSceneComponent {
  protected readonly backgroundColor = 0x0a0515;

  protected readonly nebulaColors = {
    primary: '#ec4899', // Pink
    secondary: '#8b5cf6', // Purple
  };
}
