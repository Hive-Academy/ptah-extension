/**
 * HexagonalHeroDemoComponent - Production Hero Section Example
 *
 * Demonstrates hexagonal background as a hero section backdrop with:
 * - Full-screen 3D background layer (z-0)
 * - Text content overlay (z-10)
 * - Cyberpunk neon aesthetic
 * - Mouse interaction
 * - Bloom post-processing
 * - Responsive design
 *
 * IMPORTANT: When using 3D scenes with Lenis smooth scroll AND content overlays,
 * add `data-lenis-prevent` to the parent container that wraps both the 3D scene
 * and the overlay content. This prevents Lenis from intercepting scroll events
 * and conflicting with OrbitControls.
 *
 * Pattern:
 * ```html
 * <section data-lenis-prevent>        <!-- Add here for overlay patterns -->
 *   <div class="z-0"><a3d-scene-3d>   <!-- 3D background -->
 *   <div class="z-10">content</div>   <!-- Content overlay -->
 * </section>
 * ```
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Scene3dComponent,
  HexagonalBackgroundInstancedComponent,
  AmbientLightComponent,
  DirectionalLightComponent,
  PointLightComponent,
  OrbitControlsComponent,
  EffectComposerComponent,
  BloomEffectComponent,
} from '@hive-academy/angular-3d';
import { SCENE_COLORS } from '../../../shared/colors';

@Component({
  selector: 'app-hexagonal-hero-demo',
  standalone: true,
  imports: [
    Scene3dComponent,
    HexagonalBackgroundInstancedComponent,
    AmbientLightComponent,
    DirectionalLightComponent,
    PointLightComponent,
    OrbitControlsComponent,
    EffectComposerComponent,
    BloomEffectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="hero-container relative w-full"
      style="height: 100vh"
      data-lenis-prevent
    >
      <!-- Layer 1: 3D Background (z-0) -->
      <div
        class="gradient-layer absolute inset-0 z-0 bg-gradient-to-br from-indigo-950 via-purple-950 to-black"
      >
        <a3d-scene-3d [cameraPosition]="[0, -3, 4]" [backgroundColor]="null">
          <!-- WARM HONEY/GOLD LIGHTING SETUP - Multiple colored lights for metallic reflections -->
          <!-- Base ambient illumination -->
          <a3d-ambient-light [color]="colorNums.white" [intensity]="0.3" />

          <!-- Key light - Honey gold from front-top-left -->
          <a3d-point-light
            [color]="colorNums.honeyGold"
            [intensity]="20"
            [distance]="50"
            [decay]="2"
            [position]="[-5, 3, 5]"
          />

          <!-- Fill light - Light honey from front-top-right -->
          <a3d-point-light
            [color]="colorNums.lightHoney"
            [intensity]="20"
            [distance]="50"
            [decay]="2"
            [position]="[5, 3, 5]"
          />

          <!-- Rim light - Amber from back -->
          <a3d-point-light
            [color]="colorNums.amber"
            [intensity]="20"
            [distance]="50"
            [decay]="2"
            [position]="[0, -3, -5]"
          />

          <!-- Side accent - Dark honey from left -->
          <a3d-point-light
            [color]="colorNums.darkHoney"
            [intensity]="20"
            [distance]="40"
            [decay]="2"
            [position]="[-8, 0, 0]"
          />

          <!-- Side accent - Orange from right -->
          <a3d-point-light
            [color]="colorNums.orange"
            [intensity]="20"
            [distance]="50"
            [decay]="2"
            [position]="[8, 0, 0]"
          />

          <!-- Top directional for overall shaping -->
          <a3d-directional-light
            [color]="colorNums.warmWhite"
            [intensity]="0.5"
            [position]="[0, 10, 0]"
          />

          <!-- SHINY HONEY/GOLD HONEYCOMB with varied edge colors -->
          <a3d-hexagonal-background-instanced
            [circleCount]="12"
            [shape]="'hexagon'"
            [baseColor]="colorNums.darkHoney"
            [colorPalette]="honeyPalette"
            [edgePulse]="true"
            [hoverColor]="colorNums.lightHoney"
            [hexRadius]="0.5"
            [hexHeight]="0.2"
            [roughness]="0.1"
            [metalness]="0.9"
            [animationSpeed]="0.5"
            [depthAmplitude]="0.15"
            [rotationAmplitude]="0.08"
            [mouseInfluenceRadius]="3.5"
            [bloomLayer]="2"
          />

          <!-- Bloom Effect - Subtle glow -->
          <a3d-effect-composer>
            <a3d-bloom-effect
              [threshold]="0.8"
              [strength]="0.4"
              [radius]="0.3"
            />
          </a3d-effect-composer>

          <a3d-orbit-controls
            [enableDamping]="true"
            [dampingFactor]="0.05"
            [enableZoom]="false"
          />
        </a3d-scene-3d>
      </div>

      <!-- Layer 2: Hero Content (z-10) -->
      <div
        class="content-layer relative z-10 flex flex-col items-center justify-center min-h-screen text-center px-4 sm:px-6 md:px-8 max-w-5xl mx-auto"
      >
        <!-- Badge -->
        <div class="mb-6">
          <span
            class="inline-flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 bg-purple-500/10 backdrop-blur-md rounded-full text-xs sm:text-sm font-medium border border-purple-500/20 shadow-lg"
          >
            <span class="relative flex h-2 w-2 sm:h-3 sm:w-3">
              <span
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-500 opacity-75"
              ></span>
              <span
                class="relative inline-flex rounded-full h-2 w-2 sm:h-3 sm:w-3 bg-purple-500"
              ></span>
            </span>
            <span class="text-purple-300">WebGPU Powered</span>
          </span>
        </div>

        <!-- Main Headline -->
        <h1
          class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-6 sm:mb-8 leading-none tracking-tight"
        >
          <span class="block text-white drop-shadow-lg"> Build Stunning </span>
          <span
            class="block bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent"
          >
            3D Experiences
          </span>
        </h1>

        <!-- Subtitle -->
        <p
          class="text-base sm:text-lg md:text-xl text-purple-200 max-w-3xl mx-auto mb-4 sm:mb-6 leading-relaxed"
        >
          Create immersive web experiences with declarative Angular components
          and WebGPU-powered graphics. Move your mouse to interact with the
          hexagonal cloud.
        </p>

        <!-- Feature Pills -->
        <div class="flex flex-wrap gap-2 sm:gap-3 justify-center mb-8 sm:mb-12">
          @for (pill of featurePills; track pill) {
          <span
            class="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-500/20 text-purple-200 rounded-full text-xs sm:text-sm font-semibold border border-purple-500/30"
          >
            {{ pill }}
          </span>
          }
        </div>

        <!-- CTA Buttons -->
        <div
          class="flex flex-wrap gap-4 sm:gap-6 justify-center mb-12 sm:mb-16"
        >
          <a
            href="/"
            class="group relative px-6 sm:px-8 md:px-10 py-3 sm:py-4 md:py-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full font-bold text-sm sm:text-base md:text-lg hover:scale-105 transition-all duration-300 shadow-xl shadow-purple-500/30"
          >
            <span class="relative z-10">Get Started</span>
            <div
              class="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 blur-xl opacity-50 group-hover:opacity-75 transition-opacity"
            ></div>
          </a>
          <a
            href="/angular-3d"
            class="px-6 sm:px-8 md:px-10 py-3 sm:py-4 md:py-5 bg-white/5 backdrop-blur-md text-white rounded-full font-bold text-sm sm:text-base md:text-lg border border-white/20 hover:bg-white/10 hover:border-white/40 transition-all duration-300"
          >
            See Examples
          </a>
        </div>

        <!-- Scroll Indicator -->
        <div
          class="flex flex-col items-center gap-2 sm:gap-3 text-purple-200/50"
        >
          <span class="text-xs sm:text-sm font-medium tracking-widest uppercase"
            >Orbit to explore</span
          >
          <div
            class="w-5 h-8 sm:w-6 sm:h-10 border-2 border-purple-200/30 rounded-full flex justify-center pt-1.5 sm:pt-2"
          >
            <div
              class="w-1 h-2.5 sm:w-1.5 sm:h-3 bg-purple-200/50 rounded-full animate-bounce"
            ></div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .gradient-layer ::ng-deep a3d-scene-3d {
        width: 100%;
        height: 100%;
      }

      @keyframes bounce {
        0%,
        100% {
          transform: translateY(-25%);
          animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
        }
        50% {
          transform: translateY(0);
          animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
        }
      }

      .animate-bounce {
        animation: bounce 1s infinite;
      }

      /* Reduce 3D prominence on mobile */
      @media (max-width: 768px) {
        .gradient-layer {
          opacity: 0.7;
        }
      }
    `,
  ],
})
export class HexagonalHeroDemoComponent {
  protected readonly colorNums = SCENE_COLORS;

  protected readonly featurePills = [
    'WebGPU',
    'TSL Shaders',
    'Signals',
    'Standalone',
    'Instanced',
  ];

  // Warm honey/gold color palette for varied edge colors
  protected readonly honeyPalette = [
    SCENE_COLORS.warmWhite, // Cream/white edges
    SCENE_COLORS.lightHoney, // Peachy gold edges
    SCENE_COLORS.honeyGold, // Bright orange-gold edges
    SCENE_COLORS.amber, // Rich orange edges
    SCENE_COLORS.orange, // Vibrant orange edges
  ];
}
