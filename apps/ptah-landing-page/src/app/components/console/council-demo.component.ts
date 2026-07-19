import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, Gavel, Check, Sparkles } from 'lucide-angular';
import gsap from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(ScrambleTextPlugin);

/** Decrypt glyphs — shared with the hero headline decode motif. */
const GLYPHS = '☥ΔΛΞΦϟ01▮▚';

interface CouncilAgent {
  readonly name: string;
  readonly stance: string;
  readonly note: string;
  readonly dot: string;
  readonly noteClass: string;
}

/**
 * CouncilDemoComponent — the hero's proof-of-life visual: a live Tribunal
 * Council deliberation (design spec §4 S5, ported from the hero-lab winner).
 *
 * Loops a staged sequence: vendors "deliberate" (shimmer), each stance DECODES
 * in through amber glyph noise, cross-critique notes slide up, then the verdict
 * resolves and the status flips to "Verdict ready". Designed to sit inside
 * `DeviceFrameComponent` (fills the projected body).
 *
 * SSG / reduced-motion safe: the static DOM is already the resolved verdict —
 * the timeline only runs under `prefers-reduced-motion: no-preference`, and is
 * reverted on destroy.
 */
@Component({
  selector: 'ptah-council-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      data-council
      class="absolute inset-0 p-3.5 flex flex-col gap-3"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <!-- prompt bar -->
      <div
        class="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-950/70 px-3 py-2 shrink-0"
        aria-hidden="true"
      >
        <lucide-angular
          [img]="SparklesIcon"
          class="w-3.5 h-3.5 text-amber-400 shrink-0"
        />
        <span class="text-[11px] font-mono text-ink-300 truncate flex-1">
          Council · &ldquo;Prevent double-charging under concurrent
          webhooks?&rdquo;
        </span>
        <span
          class="w-1.5 h-1.5 rounded-full bg-sky-400 motion-safe:animate-pulse shrink-0"
        ></span>
        <span
          data-council-status
          class="text-[10px] font-mono text-sky-400 shrink-0"
          >Verdict ready</span
        >
      </div>

      <!-- deliberation grid -->
      <div
        class="flex-1 grid grid-cols-3 grid-rows-1 gap-3 min-h-0"
        aria-hidden="true"
      >
        <div class="col-span-2 grid grid-cols-2 grid-rows-2 gap-3 min-h-0">
          @for (a of agents; track a.name) {
            <div
              data-vendor-card
              class="relative overflow-hidden rounded-lg border border-ink-700 bg-ink-950/70 p-3 flex flex-col transition-colors hover:border-amber-500/40"
            >
              <div class="flex items-center gap-1.5">
                <span
                  data-vendor-dot
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  [class]="a.dot"
                ></span>
                <span
                  class="text-[11px] font-mono text-amber-500/80 truncate"
                  >{{ a.name }}</span
                >
              </div>
              <p
                data-stance
                class="mt-2 text-[11px] leading-snug text-ink-200 line-clamp-3"
              >
                &ldquo;{{ a.stance }}&rdquo;
              </p>
              <span
                data-note
                class="mt-auto pt-2 text-[10px] font-mono"
                [class]="a.noteClass"
                >{{ a.note }}</span
              >
              <!-- deliberating shimmer (shown only while the demo runs) -->
              <div
                data-thinking
                class="absolute inset-x-3 top-8 bottom-3 flex flex-col justify-center gap-1.5 opacity-0 pointer-events-none"
              >
                <div
                  class="h-1.5 rounded-full bg-white/10 w-full motion-safe:animate-pulse"
                ></div>
                <div
                  class="h-1.5 rounded-full bg-white/10 w-4/5 motion-safe:animate-pulse"
                ></div>
              </div>
            </div>
          }
        </div>

        <!-- verdict -->
        <div
          data-verdict
          class="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 flex flex-col min-h-0"
        >
          <div class="flex items-center gap-1.5 text-amber-400">
            <lucide-angular [img]="GavelIcon" class="w-3.5 h-3.5" />
            <span class="text-[11px] font-mono uppercase tracking-wider"
              >Verdict</span
            >
          </div>
          <p
            data-verdict-text
            class="mt-2 text-[11px] leading-snug text-ink-100"
          >
            Optimistic lock on the version column, DB unique constraint as
            backstop, cap retries at 3.
          </p>
          <div
            data-verdict-reveal
            class="mt-auto pt-2 flex items-center gap-1.5 text-[10px] font-mono text-emerald-400"
          >
            <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
            3 of 4 vendors concur
          </div>
          <div
            data-verdict-reveal
            class="text-[10px] font-mono text-ink-400 mt-1"
          >
            winner · Claude Opus 4.8
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 260px;
      }
    `,
  ],
})
export class CouncilDemoComponent {
  public readonly ariaLabel = input<string>(
    'Illustration of a Ptah Tribunal Council: four AI vendors deliberate a ' +
      'question, cross-review each other, and resolve to a single cited verdict.',
  );

  public readonly SparklesIcon = Sparkles;
  public readonly GavelIcon = Gavel;
  public readonly CheckIcon = Check;

  public readonly agents: readonly CouncilAgent[] = [
    {
      name: 'Claude · Opus 4.8',
      stance: 'Optimistic lock on the version column, retry on conflict.',
      note: 'cites 3 sources',
      dot: 'bg-emerald-400',
      noteClass: 'text-emerald-400/80',
    },
    {
      name: 'Copilot · GPT-5',
      stance: 'DB unique constraint plus a bounded retry loop.',
      note: 'concurs with Claude',
      dot: 'bg-emerald-400',
      noteClass: 'text-emerald-400/80',
    },
    {
      name: 'Codex',
      stance: 'Serialize writes through a single queue worker.',
      note: 'flagged · adds latency',
      dot: 'bg-amber-400',
      noteClass: 'text-amber-400/80',
    },
    {
      name: 'Kimi K2',
      stance: 'Optimistic lock, cap retries at 3 to avoid livelock.',
      note: 'refutes Codex',
      dot: 'bg-sky-400',
      noteClass: 'text-sky-400/80',
    },
  ];

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

  /**
   * Staged deliberation timeline: vendors think, each stance decodes in,
   * cross-critique notes slide up, then the verdict resolves. Loops endlessly.
   */
  private buildDemo(host: HTMLElement): void {
    const root = host.querySelector<HTMLElement>('[data-council]');
    if (!root) return;

    const cards = gsap.utils.toArray<HTMLElement>('[data-vendor-card]', root);
    const stances = cards.map((c) =>
      c.querySelector<HTMLElement>('[data-stance]'),
    );
    const notes = cards.map((c) => c.querySelector<HTMLElement>('[data-note]'));
    const thinks = cards.map((c) =>
      c.querySelector<HTMLElement>('[data-thinking]'),
    );
    const dots = cards.map((c) =>
      c.querySelector<HTMLElement>('[data-vendor-dot]'),
    );
    const status = root.querySelector<HTMLElement>('[data-council-status]');
    const verdict = root.querySelector<HTMLElement>('[data-verdict]');
    const verdictText = root.querySelector<HTMLElement>('[data-verdict-text]');
    const reveals = gsap.utils.toArray<HTMLElement>(
      '[data-verdict-reveal]',
      root,
    );

    const finalStances = stances.map((s) => s?.textContent ?? '');
    const finalVerdict = verdictText?.textContent ?? '';

    const reset = (): void => {
      thinks.forEach((t) => t && gsap.set(t, { autoAlpha: 1 }));
      stances.forEach((s) => s && (s.textContent = ''));
      dots.forEach((d) => d && gsap.set(d, { opacity: 0.35 }));
      gsap.set(notes.filter(Boolean), { autoAlpha: 0, y: 4 });
      if (verdict) gsap.set(verdict, { autoAlpha: 0.35 });
      gsap.set(reveals, { autoAlpha: 0 });
      if (verdictText) verdictText.textContent = '';
      if (status) {
        status.textContent = 'Deliberating…';
        status.style.color = '#38bdf8';
      }
    };

    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 2.6, onRepeat: reset });

    stances.forEach((s, i) => {
      const at = 0.5 + i * 0.95;
      const dot = dots[i];
      const think = thinks[i];
      const note = notes[i];
      if (dot) tl.to(dot, { opacity: 1, duration: 0.2 }, at);
      if (think) tl.to(think, { autoAlpha: 0, duration: 0.3 }, at + 0.05);
      if (s)
        tl.to(
          s,
          {
            duration: 0.85,
            scrambleText: { text: finalStances[i], chars: GLYPHS, speed: 0.3 },
            ease: 'none',
          },
          at + 0.1,
        );
      if (note)
        tl.to(
          note,
          { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' },
          at + 0.75,
        );
    });

    const vAt = 0.5 + stances.length * 0.95 + 0.35;
    tl.call(
      () => {
        if (status) {
          status.textContent = 'Verdict ready';
          status.style.color = '#34d399';
        }
      },
      undefined,
      vAt,
    );
    if (verdict) tl.to(verdict, { autoAlpha: 1, duration: 0.45 }, vAt);
    if (verdictText)
      tl.to(
        verdictText,
        {
          duration: 1.0,
          scrambleText: { text: finalVerdict, chars: GLYPHS, speed: 0.3 },
          ease: 'none',
        },
        vAt + 0.15,
      );
    tl.to(
      reveals,
      { autoAlpha: 1, duration: 0.4, stagger: 0.15, ease: 'power2.out' },
      vAt + 1.05,
    );
  }
}
