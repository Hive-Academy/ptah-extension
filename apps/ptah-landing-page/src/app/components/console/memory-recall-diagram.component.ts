import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import gsap from 'gsap';

interface SessionTick {
  readonly n: number;
  readonly x: number;
}

/**
 * MemoryRecallDiagramComponent — mechanism diagram proving Pillar 1: "It knows
 * your architecture, and never re-learns it."
 *
 * A horizontal session track (S1…S10). Tagged memory chips sit on early
 * sessions (Decision=amber, Bugfix=rose, Discovery=emerald). A playhead sweeps
 * S1→S10 lighting each node; at S10 a query fires and a RECALL ARC (the hero
 * motion) draws back to the S1 Decision chip — "recalled, not re-derived".
 *
 * SSG / reduced-motion safe: the static DOM is the resolved still — nodes lit,
 * chips opaque, arc fully drawn, query + recall label shown, playhead hidden.
 * The looping timeline only runs under `(prefers-reduced-motion: no-preference)`
 * inside a `gsap.matchMedia()` context reverted on destroy.
 */
@Component({
  selector: 'ptah-memory-recall-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      data-root
      viewBox="0 0 640 340"
      class="w-full h-auto"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <!-- baseline + session nodes -->
      <line
        x1="50"
        y1="250"
        x2="590"
        y2="250"
        stroke="#262a33"
        stroke-width="2"
      />
      @for (s of sessions; track s.n) {
        <circle data-node [attr.cx]="s.x" cy="250" r="4" fill="#f5a524" />
        <text
          [attr.x]="s.x"
          y="272"
          fill="#5b616f"
          font-size="10"
          font-family="monospace"
          text-anchor="middle"
        >
          S{{ s.n }}
        </text>
      }

      <!-- recall arc: S10 → S1 Decision chip (the hero motion) -->
      <path
        data-arc
        d="M 588 244 C 540 70, 250 56, 132 148"
        fill="none"
        stroke="#f5a524"
        stroke-width="2.5"
        stroke-linecap="round"
        pathLength="1"
      />
      <text
        data-recall-label
        x="336"
        y="50"
        fill="#f5a524"
        font-size="11"
        font-family="monospace"
        text-anchor="middle"
      >
        recalled — not re-derived
      </text>

      <!-- memory chips -->
      <g data-chip-decision>
        <line
          x1="54"
          y1="176"
          x2="50"
          y2="246"
          stroke="#f5a524"
          stroke-width="1"
          stroke-opacity="0.5"
        />
        <rect
          x="40"
          y="150"
          width="176"
          height="26"
          rx="6"
          fill="#0a0c10"
          stroke="#f5a524"
          stroke-opacity="0.5"
        />
        <text
          x="52"
          y="167"
          fill="#f5a524"
          font-size="11"
          font-family="monospace"
        >
          Decision · auth pattern
        </text>
      </g>
      <g data-chip-bugfix>
        <line
          x1="175"
          y1="214"
          x2="170"
          y2="246"
          stroke="#fb7185"
          stroke-width="1"
          stroke-opacity="0.5"
        />
        <rect
          x="150"
          y="188"
          width="150"
          height="26"
          rx="6"
          fill="#0a0c10"
          stroke="#fb7185"
          stroke-opacity="0.5"
        />
        <text
          x="162"
          y="205"
          fill="#fb7185"
          font-size="11"
          font-family="monospace"
        >
          Bugfix · token race
        </text>
      </g>
      <g data-chip-discovery>
        <line
          x1="355"
          y1="192"
          x2="350"
          y2="246"
          stroke="#34d399"
          stroke-width="1"
          stroke-opacity="0.5"
        />
        <rect
          x="326"
          y="164"
          width="170"
          height="26"
          rx="6"
          fill="#0a0c10"
          stroke="#34d399"
          stroke-opacity="0.5"
        />
        <text
          x="338"
          y="181"
          fill="#34d399"
          font-size="11"
          font-family="monospace"
        >
          Discovery · 12k symbols
        </text>
      </g>

      <!-- query bubble at S10 -->
      <g data-query>
        <line
          x1="543"
          y1="228"
          x2="588"
          y2="246"
          stroke="#3a3f4b"
          stroke-width="1"
        />
        <rect
          x="466"
          y="184"
          width="154"
          height="44"
          rx="8"
          fill="#12151b"
          stroke="#2b303a"
        />
        <text
          x="478"
          y="201"
          fill="#8b92a1"
          font-size="11"
          font-family="monospace"
        >
          ⌕ where do we validate
        </text>
        <text
          x="478"
          y="217"
          fill="#e6e9ef"
          font-size="11"
          font-family="monospace"
        >
          auth tokens?
        </text>
      </g>

      <!-- playhead (transient particle — hidden in the resolved still) -->
      <g data-playhead opacity="0">
        <line
          x1="50"
          y1="120"
          x2="50"
          y2="254"
          stroke="#f5a524"
          stroke-width="1.5"
          stroke-opacity="0.6"
        />
        <circle cx="50" cy="250" r="5" fill="#f5a524" />
      </g>

      <!-- capability micro-labels (old card content, demoted) -->
      <text x="50" y="322" fill="#5b616f" font-size="9" font-family="monospace">
        persistent memory · RRF
      </text>
      <text
        x="320"
        y="322"
        fill="#5b616f"
        font-size="9"
        font-family="monospace"
        text-anchor="middle"
      >
        tree-sitter index
      </text>
      <text
        x="590"
        y="322"
        fill="#5b616f"
        font-size="9"
        font-family="monospace"
        text-anchor="end"
      >
        hybrid symbol search
      </text>
    </svg>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class MemoryRecallDiagramComponent {
  public readonly ariaLabel = input<string>(
    'Diagram: across ten sessions Ptah stores tagged memories — an amber ' +
      'architecture decision, a rose bugfix, an emerald discovery. At session ' +
      'ten a query for where auth tokens are validated recalls the original ' +
      'decision instead of re-deriving it.',
  );

  protected readonly sessions: readonly SessionTick[] = Array.from(
    { length: 10 },
    (_, i) => ({ n: i + 1, x: 50 + i * 60 }),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.buildDemo(this.host.nativeElement);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  private buildDemo(host: HTMLElement): void {
    const root = host.querySelector<SVGElement>('[data-root]');
    if (!root) return;

    const nodes = gsap.utils.toArray<SVGElement>('[data-node]', root);
    const playhead = root.querySelector<SVGElement>('[data-playhead]');
    const arc = root.querySelector<SVGElement>('[data-arc]');
    const recallLabel = root.querySelector<SVGElement>('[data-recall-label]');
    const query = root.querySelector<SVGElement>('[data-query]');
    const decision = root.querySelector<SVGElement>('[data-chip-decision]');
    const bugfix = root.querySelector<SVGElement>('[data-chip-bugfix]');
    const discovery = root.querySelector<SVGElement>('[data-chip-discovery]');
    const chips = [decision, bugfix, discovery].filter(
      (c): c is SVGElement => c !== null,
    );

    const SWEEP = 2.4;
    const START = 0.2;

    const reset = (): void => {
      gsap.set(nodes, { fill: '#3a3f4b' });
      gsap.set(chips, { autoAlpha: 0.25 });
      if (playhead) gsap.set(playhead, { x: 0, autoAlpha: 1 });
      if (arc) gsap.set(arc, { strokeDasharray: 1, strokeDashoffset: 1 });
      if (recallLabel) gsap.set(recallLabel, { autoAlpha: 0 });
      if (query) gsap.set(query, { autoAlpha: 0.3 });
    };

    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.2, onRepeat: reset });

    if (playhead)
      tl.to(playhead, { x: 540, duration: SWEEP, ease: 'none' }, START);
    tl.to(
      nodes,
      { fill: '#f5a524', duration: 0.15, stagger: SWEEP / (nodes.length - 1) },
      START,
    );

    if (decision) tl.to(decision, { autoAlpha: 1, duration: 0.3 }, START + 0.1);
    if (bugfix)
      tl.to(bugfix, { autoAlpha: 1, duration: 0.3 }, START + SWEEP * (2 / 9));
    if (discovery)
      tl.to(
        discovery,
        { autoAlpha: 1, duration: 0.3 },
        START + SWEEP * (5 / 9),
      );

    const qAt = START + SWEEP;
    if (query) {
      tl.to(query, { autoAlpha: 1, duration: 0.3 }, qAt);
      tl.fromTo(
        query,
        { scale: 0.9, transformOrigin: 'center' },
        { scale: 1, duration: 0.4, ease: 'back.out(2)' },
        qAt,
      );
    }
    if (playhead) tl.to(playhead, { autoAlpha: 0, duration: 0.3 }, qAt + 0.1);

    // hero: recall arc draws back to the Decision chip, then everything pulses.
    if (arc)
      tl.to(
        arc,
        { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' },
        qAt + 0.35,
      );

    const rAt = qAt + 0.35 + 1.1;
    if (recallLabel) tl.to(recallLabel, { autoAlpha: 1, duration: 0.4 }, rAt);
    if (decision)
      tl.to(
        decision,
        {
          scale: 1.06,
          transformOrigin: 'center',
          duration: 0.25,
          yoyo: true,
          repeat: 1,
        },
        rAt,
      );
    if (arc)
      tl.fromTo(
        arc,
        { strokeWidth: 2.5 },
        { strokeWidth: 4, duration: 0.3, yoyo: true, repeat: 1 },
        rAt,
      );
  }
}
