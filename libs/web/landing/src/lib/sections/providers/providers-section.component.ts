import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';
import { ProvidersConnectionCardComponent } from './providers-connection-card.component';
import { ProvidersPointMockComponent } from './providers-point-mock.component';

export const PROVIDERS_POINTS: readonly string[] = [
  'Claude, Codex, Copilot, OpenRouter, Ollama.',
  'Named Claude accounts stay on their own.',
  'First run reads the repo. You pick the team.',
];

/** The setup hub still, served from the landing app's public assets. */
export const SETUP_HUB_STILL = '/assets/images/showcase/setup-hub.png';

/**
 * Providers. Composition "account deck": the header runs across the top
 * left; the real Setup Hub still sits right, raised into the header's row;
 * the three points are app cards set out from under the still's left edge,
 * each with the app fragment it stands for (provider avatars, Accounts-tab
 * rows; see providers-point-mock). The Claude connection card from Settings
 * -> Providers lands on the still's lower corner with the second point
 * (certified before launch, live subscription checked). Scroll: the header
 * lines, the still rises, then the pinned steps raise the cards and land the
 * connection card. The still takes the shared stacked clip width
 * (`section-media.css`).
 */
@Component({
  selector: 'ptah-providers-section',
  standalone: true,
  imports: [SectionHeaderComponent, ProvidersConnectionCardComponent, ProvidersPointMockComponent],
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
            <li class="pv-card app-card" [class.is-in]="reached() > i" [style.--at]="i">
              <span class="card-head">
                <span class="card-text">{{ point }}</span>
                <span class="card-index app-badge" aria-hidden="true">0{{ i + 1 }}</span>
              </span>
              <ptah-providers-point-mock [index]="i" />
            </li>
          }
        </ul>

        <figure class="pv-still">
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
          <ptah-providers-connection-card class="pv-conn" data-conn [class.is-in]="reached() >= 2" />
        </figure>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    '../shared/app-mock.css',
    './providers-section.component.css',
  ],
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
  /** Cards dealt so far (0 to 3); the connection card lands with the second. */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
}
