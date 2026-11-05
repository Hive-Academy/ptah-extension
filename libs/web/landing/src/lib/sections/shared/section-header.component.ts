import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { REVEAL } from './section-scroll';

/**
 * Eyebrow, headline and subline in the decision-loop pilot's treatment.
 * Each line rises in as the section's scroll progress reaches it, top-down.
 * The host section points `aria-labelledby` at `titleId`.
 */
@Component({
  selector: 'ptah-section-header',
  standalone: true,
  template: `
    <header class="section-header" [attr.data-align]="align()">
      <p class="section-eyebrow rise" [class.is-in]="progress() >= reveal.eyebrow">
        <span class="cue-line" aria-hidden="true"></span>
        <span>{{ eyebrow() }}</span>
        @if (align() === 'center') {
          <span class="cue-line" aria-hidden="true"></span>
        }
      </p>
      <h2
        class="section-title rise"
        [class.is-in]="progress() >= reveal.headline"
        [id]="titleId()"
      >
        {{ headline() }}
      </h2>
      <p class="section-subline rise" [class.is-in]="progress() >= reveal.subline">
        {{ subline() }}
      </p>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .section-header {
        width: min(100%, 54rem);
        margin: 0 auto clamp(2rem, 4vw, 3.25rem);
        text-align: center;
      }

      .rise {
        opacity: 0;
        transform: translateY(1.25rem);
        transition:
          opacity 0.45s ease,
          transform 0.45s ease;
      }

      .rise.is-in {
        opacity: 1;
        transform: none;
      }

      .section-eyebrow {
        margin: 0 0 clamp(0.75rem, 1.4vw, 1.15rem);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        color: #ffbb4d;
        font-family: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
        font-size: clamp(0.8rem, 1.05vw, 0.95rem);
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .cue-line {
        display: inline-block;
        width: 2.25rem;
        height: 1px;
        background: #f5a524;
        opacity: 0.85;
      }

      .section-title {
        margin: 0;
        color: #fff;
        font-size: clamp(2rem, 3.8vw, 3.25rem);
        font-weight: 700;
        letter-spacing: -0.025em;
        line-height: 0.98;
        text-transform: uppercase;
        text-wrap: balance;
      }

      .section-subline {
        width: min(100%, 56ch);
        margin: clamp(1.1rem, 2.2vw, 1.6rem) auto 0;
        color: #e9ebef;
        font-size: clamp(0.98rem, 1.15vw, 1.125rem);
        line-height: 1.6;
        text-wrap: balance;
      }

      /* Start-aligned: the header sits in an off-centre text column. */
      .section-header[data-align='start'] {
        width: 100%;
        margin: 0;
        text-align: left;
      }

      .section-header[data-align='start'] .section-eyebrow {
        justify-content: flex-start;
      }

      .section-header[data-align='start'] .section-subline {
        margin-left: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .rise {
          transition: none;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionHeaderComponent {
  public readonly eyebrow = input.required<string>();
  public readonly headline = input.required<string>();
  public readonly subline = input.required<string>();
  public readonly titleId = input.required<string>();
  /** Section scroll progress; 1 (the default) shows every line. */
  public readonly progress = input(1);
  /** `center` (default) above a centred visual; `start` in an off-centre column. */
  public readonly align = input<'center' | 'start'>('center');

  protected readonly reveal = REVEAL;
}
