import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { NavigationComponent } from '../../components/navigation.component';
import {
  TempleHeroComponent,
  TempleDecryptFinish,
} from './variants/temple-hero.component';

interface FinishMeta {
  id: TempleDecryptFinish;
  name: string;
  blurb: string;
}

/**
 * HeroLabPageComponent — internal selection gallery (TASK_2026_153).
 *
 * Round 3: Decrypt won. The lab now switches the post-decrypt Egyptian
 * finish on the Temple stage. The decrypt itself is in-place (width-locked
 * chars, zero layout shift) and shared by all three finishes. Switching
 * remounts the hero so each treatment replays. Not linked, not prerendered.
 */
@Component({
  selector: 'ptah-hero-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavigationComponent, TempleHeroComponent],
  template: `
    <ptah-navigation />

    <main class="bg-ink-950 min-h-screen">
      @switch (active()) {
        @case ('cartouche') {
          <ptah-temple-hero finish="cartouche" />
        }
        @case ('seal') {
          <ptah-temple-hero finish="seal" />
        }
        @case ('engraving') {
          <ptah-temple-hero finish="engraving" />
        }
      }
    </main>

    <!-- Finish switcher -->
    <div
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2"
    >
      <span class="font-mono text-[11px] tracking-wide text-ink-400">
        {{ activeMeta().blurb }}
      </span>
      <nav
        aria-label="Decrypt finish selector"
        class="flex items-center gap-1 p-1 rounded-full bg-ink-900/95 border border-ink-700 shadow-device"
      >
        @for (f of finishes; track f.id) {
          <button
            type="button"
            (click)="active.set(f.id)"
            [attr.aria-pressed]="active() === f.id"
            class="px-4 py-2 rounded-full font-mono text-xs sm:text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
            [class]="
              active() === f.id
                ? 'bg-amber-500 text-ink-950 font-semibold'
                : 'text-ink-300 hover:text-white hover:bg-ink-800'
            "
          >
            {{ f.name }}
          </button>
        }
      </nav>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class HeroLabPageComponent {
  public readonly finishes: FinishMeta[] = [
    {
      id: 'cartouche',
      name: 'Cartouche',
      blurb: 'After decode, the headline turns to engraved gold — the decree',
    },
    {
      id: 'seal',
      name: 'Seal of Horus',
      blurb: 'After decode, the Eye of Horus presses in behind the decree',
    },
    {
      id: 'engraving',
      name: 'Engraving',
      blurb: 'Light sweeps through a hieroglyph stencil, amber glow settles',
    },
  ];

  public readonly active = signal<TempleDecryptFinish>('cartouche');

  public activeMeta(): FinishMeta {
    const id = this.active();
    return this.finishes.find((f) => f.id === id) ?? this.finishes[0];
  }
}
