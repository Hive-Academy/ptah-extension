import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FlankBoltComponent } from '../shared/flank-bolt.component';
import { REVEAL, revealedLines } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const PROVIDERS_POINTS: readonly string[] = [
  'Claude, Codex, Copilot, OpenRouter, Ollama.',
  'Named Claude accounts stay on their own.',
  'First run reads the repo. You pick the team.',
];

/** The setup hub still, served from the landing app's public assets. */
export const SETUP_HUB_STILL = '/assets/images/showcase/setup-hub.png';

/**
 * Providers. Composition "account deck": the header runs across the top
 * left; the setup-hub still sits right, raised into the header's row; the
 * three points are a deck of account cards set out from under the
 * still's left edge, each card further right. A seal stamps the still's
 * lower corner once the named accounts are in (certified before launch). Scroll:
 * the header lines, the still rises, then the pinned steps raise the cards
 * and drop the seal in. Two canvas bolts flank the still: a lintel above it
 * and one along its right edge.
 */
@Component({
  selector: 'ptah-providers-section',
  standalone: true,
  imports: [FlankBoltComponent, SectionHeaderComponent],
  template: `
    <section id="providers" class="section-frame" aria-labelledby="providers-title">
      <div class="frame-atmosphere pv-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="pv-stage" data-stage data-layout="account-deck" [style.--enter]="scroll.enter()">
        <div class="pv-head">
          <ptah-section-header
            titleId="providers-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
        </div>

        <ul class="pv-deck">
          @for (point of points(); track point; let i = $index) {
            <li class="pv-card" [class.is-in]="reached() > i" [style.--at]="i">
              <span class="card-index" aria-hidden="true">0{{ i + 1 }}</span>
              <span class="card-text">{{ point }}</span>
            </li>
          }
        </ul>

        <figure class="pv-still">
          <ptah-flank-bolt class="pv-bolt pv-bolt-lintel" axis="horizontal" [seed]="127" [strike]="strike()" />
          <ptah-flank-bolt class="pv-bolt pv-bolt-edge" axis="vertical" [seed]="139" [strike]="strike()" />
          <div class="still-window">
            <img
              class="still-image"
              [src]="still"
              width="1909"
              height="974"
              loading="lazy"
              decoding="async"
              alt="PtahCode Setup Hub: workspace analysis and the AI team builder"
            />
          </div>
          <svg
            class="pv-seal"
            data-seal
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
            [class.is-in]="reached() >= 2"
          >
            <circle cx="24" cy="24" r="21" stroke="currentColor" stroke-width="1.5" />
            <circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3" />
            <path d="M16.5 24.5l5 5 10-11" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </figure>
      </div>
    </section>
  `,
  styleUrls: ['../shared/section-frame.css', './providers-section.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersSectionComponent {
  public readonly eyebrow = input<string>('Your accounts');
  public readonly headline = input<string>('Bring the accounts you already have.');
  public readonly subline = input<string>(
    'A named Claude account is certified before launch, and the live subscription is checked.',
  );
  public readonly points = input<readonly string[]>(PROVIDERS_POINTS);

  protected readonly still = SETUP_HUB_STILL;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Cards dealt so far (0 to 3); the seal stamps with the second. */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** The flanking bolts flash once per header line and once per card. */
  public readonly strike = computed(() => revealedLines(this.headerProgress()) + this.reached());
}
