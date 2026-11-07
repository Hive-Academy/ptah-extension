import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConsoleClipComponent } from '../shared/console-clip.component';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const PROVIDERS_POINTS: readonly string[] = [
  'Claude, Codex, Copilot, OpenRouter, Ollama.',
  'Named Claude accounts stay on their own.',
  'First run reads the repo. You pick the team.',
];

/** The providers clip: 1280 x 720 (16 : 9), 8 s, muted. */
export const PROVIDERS_CLIP = {
  video: '/assets/live-demo/providers.mp4',
  videoWebm: '/assets/live-demo/providers.webm',
  poster: '/assets/live-demo/providers.jpg',
  label: 'Bring the accounts you already have: Claude, Codex, Copilot, OpenRouter, Ollama',
} as const;

/**
 * Providers. Composition "account deck": the header runs across the top
 * left; a 16 : 9 clip sits right, raised into the header's row (connections
 * turning ready one by one, then the accounts checked); the three points are
 * cards set out from under the clip's left edge. The clip has no readable
 * text, so the copy stays in the page. Scroll: the header lines, the clip
 * rises, then the pinned steps raise the cards. The clip takes the shared
 * stacked clip width (`section-media.css`) at 16 : 9.
 */
@Component({
  selector: 'ptah-providers-section',
  standalone: true,
  imports: [ConsoleClipComponent, SectionHeaderComponent],
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
              <span class="card-text">{{ point }}</span>
              <span class="card-index" aria-hidden="true">0{{ i + 1 }}</span>
            </li>
          }
        </ul>

        <div class="pv-clip" data-clip>
          <ptah-console-clip
            [video]="clip.video"
            [videoWebm]="clip.videoWebm"
            [poster]="clip.poster"
            [label]="clip.label"
          />
        </div>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
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

  protected readonly clip = PROVIDERS_CLIP;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Cards dealt so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
}
