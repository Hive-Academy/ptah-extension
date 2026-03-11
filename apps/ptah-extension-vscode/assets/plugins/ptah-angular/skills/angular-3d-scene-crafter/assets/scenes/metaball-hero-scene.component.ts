import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  AmbientLightComponent,
  MetaballCursorComponent,
  MetaballPreset,
  MetaballSceneComponent,
  MetaballSphereComponent,
  PointLightComponent,
  Scene3dComponent,
} from '@hive-academy/angular-3d';

/**
 * Metaball Hero Scene - Angular-3D Showcase
 *
 * Features:
 * - Ray-marched metaballs as immersive fullscreen background
 * - Clean HTML/CSS overlay with modern typography
 * - Header with logo, brand title, and preset dropdown
 * - Left sidebar with contact info and navigation links
 * - Centered hero headline with technical subtext
 * - Status indicator in bottom-right corner
 * - 6 themed presets accessible via dropdown menu
 */
@Component({
  selector: 'app-metaball-hero-scene',
  imports: [
    Scene3dComponent,
    MetaballSceneComponent,
    MetaballSphereComponent,
    MetaballCursorComponent,
    AmbientLightComponent,
    PointLightComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero-container">
      <!-- Layer 1: 3D Scene (background) -->
      <div class="scene-layer">
        <a3d-scene-3d
          [cameraPosition]="[0, 0, 10]"
          [cameraFov]="60"
          [enableAntialiasing]="true"
          [backgroundColor]="backgroundColor()"
        >
          <!-- Lighting Setup -->
          <a3d-ambient-light [intensity]="0.2" />

          <a3d-point-light
            [position]="[10, 5, 10]"
            [intensity]="1.2"
            [color]="lightColor()"
          />

          <!-- Compositional Metaball Scene -->
          <a3d-metaball-scene
            [preset]="selectedPreset()"
            [smoothness]="0.6"
            [mouseProximityEffect]="true"
            [animationSpeed]="0.4"
            [movementScale]="1"
            [fullscreen]="true"
          >
            <!-- Fixed corner spheres (radii halved for corrected coord system) -->
            <a3d-metaball-sphere positionPreset="top-left" [radius]="0.7" />
            <a3d-metaball-sphere [position]="[0.25, 0.72]" [radius]="0.25" />
            <a3d-metaball-sphere positionPreset="bottom-right" [radius]="0.7" />
            <a3d-metaball-sphere [position]="[0.72, 0.25]" [radius]="0.28" />

            <!-- Animated orbiting spheres -->
            <a3d-metaball-sphere
              [orbit]="{ radius: 0.15, speed: 0.4 }"
              [radius]="0.06"
            />
            <a3d-metaball-sphere
              [orbit]="{ radius: 0.22, speed: 0.52, phase: 3.14 }"
              [radius]="0.09"
            />
            <a3d-metaball-sphere
              [orbit]="{ radius: 0.3, speed: 0.64, phase: 1.1 }"
              [radius]="0.06"
            />
            <a3d-metaball-sphere
              [orbit]="{ radius: 0.22, speed: 0.76, phase: 2.2 }"
              [radius]="0.09"
            />

            <!-- Cursor follower with glow -->
            <a3d-metaball-cursor
              [radiusMin]="0.04"
              [radiusMax]="0.08"
              [glowRadius]="0.25"
              [glowIntensity]="0.35"
              [smoothness]="1.0"
            />
          </a3d-metaball-scene>
        </a3d-scene-3d>
      </div>

      <!-- Layer 2: HTML Overlay (foreground) -->
      <div class="overlay-layer">
        <!-- Header -->
        <header class="header">
          <!-- Logo placeholder -->
          <div class="logo" aria-label="Angular-3D Logo">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle cx="8" cy="16" r="4" fill="currentColor" opacity="0.6" />
              <circle cx="16" cy="8" r="3" fill="currentColor" opacity="0.8" />
              <circle cx="24" cy="16" r="4" fill="currentColor" opacity="0.6" />
              <circle cx="16" cy="24" r="3" fill="currentColor" opacity="0.8" />
              <circle cx="16" cy="16" r="5" fill="currentColor" />
            </svg>
          </div>

          <!-- Brand title -->
          <span class="brand-title">Angular-3D</span>

          <!-- Preset dropdown -->
          <div class="controls-wrapper">
            <button
              type="button"
              class="controls-dropdown"
              (click)="toggleDropdown()"
              [attr.aria-expanded]="dropdownOpen()"
              aria-haspopup="listbox"
              aria-label="Metaball Controls - Select preset"
            >
              <span>Metaball Controls</span>
              <svg
                class="chevron"
                [class.chevron-open]="dropdownOpen()"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M2.5 4.5L6 8L9.5 4.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            @if (dropdownOpen()) {
            <div
              class="dropdown-menu"
              role="listbox"
              aria-label="Preset options"
            >
              @for (preset of presets; track preset) {
              <button
                type="button"
                role="option"
                [attr.aria-selected]="selectedPreset() === preset"
                (click)="selectPreset(preset)"
                [class.dropdown-item-active]="selectedPreset() === preset"
                class="dropdown-item"
              >
                {{ preset }}
              </button>
              }
            </div>
            }
          </div>
        </header>

        <!-- Left Sidebar -->
        <aside class="left-sidebar">
          <!-- Contact info -->
          <div class="contact-section">
            <span class="contact-label">+GET IN TOUCH</span>
            <a
              href="mailto:hi@example.com"
              class="contact-email"
              aria-label="Send email to hi@example.com"
              >HI&#64;EXAMPLE.COM</a
            >
          </div>

          <!-- Navigation -->
          <nav class="nav-links" aria-label="Page navigation">
            <a href="#fluid" class="nav-link">Fluid Dynamics</a>
            <a href="#organic" class="nav-link">Organic Shapes</a>
            <a href="#interactive" class="nav-link">Interactive Forms</a>
            <a href="#motion" class="nav-link">Motion Studies</a>
            <a href="#contact" class="nav-link">Contact</a>
          </nav>
        </aside>

        <!-- Center Content -->
        <main class="center-content">
          <h1 class="headline">
            Where matter becomes<br />
            thought and thought<br />
            becomes form
          </h1>
          <p class="subtext">{{ subtextContent() }}</p>
        </main>

        <!-- Status Indicator -->
        <div class="status-indicator" aria-live="polite">
          <div class="status-title">Scene State - Active</div>
          <div class="status-subtitle">immersive 3D experiences</div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .hero-container {
        position: relative;
        width: 100%;
        height: 100vh;
        min-height: 600px;
        overflow: hidden;
        background: #1a1a1a;
      }

      /* Scene Layer - 3D Background */
      .scene-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
      }

      /* Overlay Layer - HTML Foreground */
      .overlay-layer {
        position: absolute;
        inset: 0;
        z-index: 10;
        pointer-events: none;
        display: grid;
        grid-template-areas:
          'header header header'
          'sidebar center status'
          'sidebar center status';
        grid-template-columns: auto 1fr auto;
        grid-template-rows: auto 1fr auto;
        padding: 2rem;
        gap: 1rem;
      }

      /* Header */
      .header {
        grid-area: header;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 1rem;
        pointer-events: auto;
      }

      .logo {
        color: rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .brand-title {
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 1.25rem;
        font-weight: 400;
        letter-spacing: 0.05em;
        color: #ffffff;
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
      }

      .controls-wrapper {
        position: relative;
      }

      .controls-dropdown {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .controls-dropdown:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      .controls-dropdown:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.5);
        outline-offset: 2px;
      }

      .chevron {
        transition: transform 0.2s ease;
      }

      .chevron-open {
        transform: rotate(180deg);
      }

      .dropdown-menu {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        min-width: 160px;
        background: rgba(26, 26, 26, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        padding: 0.5rem 0;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }

      .dropdown-item {
        display: block;
        width: 100%;
        padding: 0.625rem 1rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.8rem;
        font-weight: 400;
        text-transform: capitalize;
        text-align: left;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .dropdown-item:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }

      .dropdown-item:focus-visible {
        outline: none;
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      .dropdown-item-active {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
      }

      .dropdown-item-active::before {
        content: '';
        display: inline-block;
        width: 4px;
        height: 4px;
        background: #ffffff;
        border-radius: 50%;
        margin-right: 0.5rem;
        vertical-align: middle;
      }

      /* Left Sidebar */
      .left-sidebar {
        grid-area: sidebar;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding-right: 2rem;
        pointer-events: auto;
      }

      .contact-section {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .contact-label {
        font-size: 0.625rem;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
      }

      .contact-email {
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
        text-decoration: none;
        transition: color 0.2s ease;
      }

      .contact-email:hover {
        color: #ffffff;
      }

      .contact-email:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.5);
        outline-offset: 2px;
      }

      .nav-links {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .nav-link {
        font-size: 0.8rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.6);
        text-decoration: none;
        transition: color 0.2s ease;
        letter-spacing: 0.01em;
      }

      .nav-link:hover {
        color: #ffffff;
      }

      .nav-link:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.5);
        outline-offset: 2px;
      }

      /* Center Content */
      .center-content {
        grid-area: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 2rem;
      }

      .headline {
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: clamp(1.75rem, 4vw, 3rem);
        font-weight: 400;
        line-height: 1.3;
        color: #ffffff;
        margin: 0 0 2rem;
        letter-spacing: -0.01em;
      }

      .subtext {
        font-family: 'Courier New', Courier, monospace;
        font-size: 0.7rem;
        font-weight: 400;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
        margin: 0;
        max-width: 500px;
      }

      /* Status Indicator */
      .status-indicator {
        grid-area: status;
        align-self: end;
        text-align: right;
        padding-left: 2rem;
      }

      .status-title {
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 0.25rem;
      }

      .status-subtitle {
        font-size: 0.625rem;
        font-weight: 400;
        font-style: italic;
        letter-spacing: 0.02em;
        color: rgba(255, 255, 255, 0.5);
      }

      /* Responsive adjustments */
      @media (max-width: 1024px) {
        .overlay-layer {
          grid-template-areas:
            'header header'
            'center center'
            'sidebar status';
          grid-template-columns: 1fr 1fr;
          grid-template-rows: auto 1fr auto;
        }

        .left-sidebar {
          flex-direction: row;
          align-items: flex-end;
          justify-content: flex-start;
          gap: 2rem;
          padding-right: 0;
        }

        .nav-links {
          flex-direction: row;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .contact-section {
          display: none;
        }
      }

      @media (max-width: 768px) {
        .hero-container {
          min-height: 100svh;
        }

        .overlay-layer {
          padding: 1.5rem;
          grid-template-areas:
            'header'
            'center'
            'status';
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr auto;
        }

        .brand-title {
          font-size: 1rem;
        }

        .left-sidebar {
          display: none;
        }

        .headline {
          font-size: clamp(1.5rem, 6vw, 2rem);
        }

        .status-indicator {
          text-align: center;
          padding-left: 0;
        }
      }
    `,
  ],
})
export class MetaballHeroSceneComponent {
  /**
   * Currently selected preset
   */
  public readonly selectedPreset = signal<MetaballPreset>('holographic');

  /**
   * Dropdown open state
   */
  public readonly dropdownOpen = signal<boolean>(false);

  /**
   * Available presets for the selector
   */
  public readonly presets: MetaballPreset[] = [
    'moody',
    'cosmic',
    'neon',
    'sunset',
    'holographic',
    'minimal',
  ];

  /**
   * Light color that matches the preset theme
   */
  public readonly lightColor = computed(() => {
    const colors: Record<MetaballPreset, string> = {
      moody: '#ffffff',
      cosmic: '#88aaff',
      neon: '#00ffcc',
      sunset: '#ff6622',
      holographic: '#ccaaff',
      minimal: '#ffffff',
    };
    return colors[this.selectedPreset()];
  });

  /**
   * Background color as hex number for Scene3dComponent
   */
  public readonly backgroundColor = computed(() => {
    const presetColors: Record<MetaballPreset, number> = {
      moody: 0x050505,
      cosmic: 0x000011,
      neon: 0x000505,
      sunset: 0x150505,
      holographic: 0x0a0a15,
      minimal: 0x0a0a0a,
    };
    return presetColors[this.selectedPreset()];
  });

  /**
   * Subtext content showing live metaball stats
   */
  public readonly subtextContent = computed(() => {
    const preset = this.selectedPreset();
    const presetDescriptions: Record<MetaballPreset, string> = {
      moody:
        'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: moody shadows',
      cosmic:
        'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: cosmic blue',
      neon: 'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: neon glow',
      sunset:
        'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: sunset warmth',
      holographic:
        'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: holographic',
      minimal:
        'vessel: (0.00, 0.00) * field: 0.12u * merges: dynamic * theme: minimal',
    };
    return presetDescriptions[preset];
  });

  /**
   * Toggle dropdown visibility
   */
  public toggleDropdown(): void {
    this.dropdownOpen.update((open) => !open);
  }

  /**
   * Select a new preset and close dropdown
   */
  public selectPreset(preset: MetaballPreset): void {
    this.selectedPreset.set(preset);
    this.dropdownOpen.set(false);
  }
}
