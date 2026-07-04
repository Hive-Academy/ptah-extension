import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import { HeroDeviceShowcaseComponent } from './hero-device-showcase.component';

/**
 * HeroComponent — Operator Console hero orchestrator (design spec §4 S1).
 *
 * Single centered column, no side-by-side split. Layers:
 * 1. `ConsoleGridBackgroundComponent` (z-0) — pure-CSS dot grid + one signature
 *    amber glow behind the device frame. No images, SSG-identical.
 * 2. Content overlay (z-10) — eyebrow / H1 / subhead / CTAs / stats.
 * 3. Device showcase — `DeviceFrameComponent` + `OrchestraGridMockComponent`.
 *
 * The retired Egyptian mood (hieroglyph parallax, cinematic vignette, orbiting
 * Egyptian-symbol images, cinematic scroll-exit fade) is gone entirely.
 */
@Component({
  selector: 'ptah-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ConsoleGridBackgroundComponent,
    HeroContentOverlayComponent,
    HeroDeviceShowcaseComponent,
  ],
  template: `
    <section class="relative overflow-hidden bg-ink-950">
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10">
        <ptah-hero-content-overlay />
        <ptah-hero-device-showcase />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class HeroComponent {}
