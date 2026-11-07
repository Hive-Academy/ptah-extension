import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { REVEAL } from '../shared/section-scroll';
import { SectionHeaderComponent } from '../shared/section-header.component';
import { stageScrollProgress, stepsReached } from '../shared/stage-scroll';

export const MEMORY_SKILLS_POINTS: readonly string[] = [
  'Keywords and vectors, keywords if vectors fail.',
  'Named corpora can prime a session.',
  'Symbol hits can include a coverage receipt.',
];

/** Where the pinned steps apply the diff: after the last point has landed. */
export const APPLY_AT = 0.9;

/**
 * The local index in the memory pane, one row each: `keyword` rows are solid
 * bars, `vector` rows are dotted. Widths are shares of the pane.
 */
const MEMORY_ROWS: readonly { readonly kind: 'keyword' | 'vector'; readonly width: number }[] = [
  { kind: 'keyword', width: 0.72 },
  { kind: 'vector', width: 0.9 },
  { kind: 'keyword', width: 0.48 },
  { kind: 'vector', width: 0.64 },
  { kind: 'keyword', width: 0.82 },
  { kind: 'vector', width: 0.56 },
  { kind: 'keyword', width: 0.38 },
  { kind: 'vector', width: 0.76 },
];

/** Unchanged context line above each added line, as a share of the line. */
const CONTEXT_WIDTHS = [0.62, 0.44, 0.7] as const;

/**
 * Memory and skills. A diagram section, no clip. Composition "split sheet":
 * one wide console window set right of centre, split into a memory pane (the
 * local index, keyword and vector rows) and a skill-diff pane whose three
 * added lines are the points. The header breaks the window's top edge from
 * the upper left, over the memory pane on an ink scrim, so the headline stays
 * on screen while the stage is pinned; the two halves of the headline sit over
 * their two panes. Scroll: the header lines, the window rises while the
 * index rows light, then the pinned steps add the lines top-down, and the
 * diff is applied last (dashed pending lines turn solid). Settled state:
 * applied. The window takes the shared clip width (`section-media.css`).
 */
@Component({
  selector: 'ptah-memory-skills-section',
  standalone: true,
  imports: [SectionHeaderComponent],
  template: `
    <section id="memory-intelligence" class="section-frame" aria-labelledby="memory-skills-title">
      <span id="the-onboarding-problem" class="ms-anchor" aria-hidden="true"></span>
      <span id="skills-orchestration" class="ms-anchor" aria-hidden="true"></span>
      <div class="frame-atmosphere ms-atmosphere" aria-hidden="true"></div>
      <div class="frame-grain" aria-hidden="true"></div>

      <div class="ms-stage" data-stage data-layout="split-sheet" [style.--enter]="scroll.enter()">
        <div class="ms-head" data-overlap>
          <ptah-section-header
            titleId="memory-skills-title"
            align="start"
            [eyebrow]="eyebrow()"
            [headline]="headline()"
            [subline]="subline()"
            [progress]="headerProgress()"
          />
        </div>

        <div class="ms-sheet-wrap">
          <div class="ms-sheet" data-sheet [class.is-applied]="applied()">
            <div class="ms-memory" data-memory aria-hidden="true">
              <span class="pane-bar"><i></i><i></i><i></i></span>
              <span class="memory-rows">
                @for (row of rows; track $index; let i = $index) {
                  <span
                    class="memory-row"
                    [attr.data-kind]="row.kind"
                    [class.is-lit]="rowsLit() > i"
                    [style.--w]="row.width"
                  ></span>
                }
              </span>
            </div>

            <div class="ms-diff">
              <span class="pane-bar" aria-hidden="true">
                <span class="diff-tab"></span>
                <span class="diff-apply" data-apply [class.is-on]="applied()"></span>
              </span>
              <ul class="ms-hunks">
                @for (point of points(); track point; let i = $index) {
                  <li class="ms-hunk" [class.is-in]="reached() > i">
                    <span
                      class="hunk-context"
                      aria-hidden="true"
                      [style.--w]="contextWidths[i % contextWidths.length]"
                    ></span>
                    <span class="hunk-line">
                      <span class="hunk-sign" aria-hidden="true">+</span>
                      <span class="hunk-text">{{ point }}</span>
                    </span>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrls: [
    '../shared/section-frame.css',
    '../shared/section-media.css',
    './memory-skills-section.component.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemorySkillsSectionComponent {
  public readonly eyebrow = input<string>('On this machine');
  public readonly headline = input<string>('It remembers. You apply the diff.');
  public readonly subline = input<string>(
    'Memory stays local. A skill file changes only when you apply it.',
  );
  public readonly points = input<readonly string[]>(MEMORY_SKILLS_POINTS);

  protected readonly rows = MEMORY_ROWS;
  protected readonly contextWidths = CONTEXT_WIDTHS;

  /** Vertical-scroll phases; settled at 1 for SSR and reduced motion. */
  public readonly scroll = stageScrollProgress();
  /** Maps the header phase onto the shared header thresholds. */
  public readonly headerProgress = computed(() =>
    this.scroll.reveal() >= 1 ? 1 : this.scroll.reveal() * REVEAL.visual,
  );
  /** Index rows lit so far: all of them once the window has risen. */
  public readonly rowsLit = computed(() => Math.round(MEMORY_ROWS.length * this.scroll.enter()));
  /** Added lines in so far (0 to 3). */
  public readonly reached = computed(() => stepsReached(this.scroll.steps()));
  /** The diff is applied last, after every line is in. */
  public readonly applied = computed(() => this.scroll.steps() >= APPLY_AT);
}
