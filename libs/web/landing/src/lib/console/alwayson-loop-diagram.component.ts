import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
} from '@angular/core';
import {
  Bot,
  Check,
  GitMerge,
  LucideAngularModule,
  Moon,
  Smartphone,
  type LucideIconData,
} from 'lucide-angular';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(MotionPathPlugin);

interface LoopStage {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly icon: LucideIconData;
  readonly left: number;
  readonly top: number;
  readonly isApprove: boolean;
}

/**
 * AlwaysOnLoopDiagramComponent — mechanism diagram proving Pillar 3: "It ships
 * overnight. You approve from your phone."
 *
 * A closed loop with four stages: cron fires (moon) → agent runs overnight →
 * diff ready → approve from Telegram / Discord / Slack (phone), then back to
 * start. A pulse travels the loop; each stage ignites as it arrives; the
 * approval stage flips from phone to a check.
 *
 * SSG / reduced-motion safe: static DOM is the resolved still — loop drawn, all
 * stages lit, approval showing the check, pulse hidden. The looping timeline
 * only runs under `no-preference`.
 */
@Component({
  selector: 'ptah-alwayson-loop-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="relative w-full"
      style="aspect-ratio: 520 / 380"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <svg
        viewBox="0 0 520 380"
        class="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <path
          [attr.d]="loopPath"
          fill="none"
          stroke="#1f232b"
          stroke-width="3"
        />
        <path
          data-loop
          [attr.d]="loopPath"
          fill="none"
          stroke="#f5a524"
          stroke-width="2.5"
          stroke-linecap="round"
          pathLength="1"
        />
        <text
          x="260"
          y="186"
          fill="#8b92a1"
          font-size="12"
          font-family="monospace"
          text-anchor="middle"
        >
          always on
        </text>
        <text
          x="260"
          y="204"
          fill="#5b616f"
          font-size="10"
          font-family="monospace"
          text-anchor="middle"
        >
          24 / 7 loop
        </text>
        <circle data-pulse cx="180" cy="70" r="6" fill="#f5a524" opacity="0" />
      </svg>

      <!-- stage overlay (HTML for lucide icons) -->
      @for (stage of stages; track stage.id) {
        <div
          data-stage
          class="stage is-lit absolute flex flex-col items-center gap-1 w-28 text-center"
          [style.left.%]="stage.left"
          [style.top.%]="stage.top"
          style="transform: translate(-50%, -50%)"
        >
          <span
            class="stage-ring w-9 h-9 rounded-full border bg-ink-950 flex items-center justify-center"
          >
            @if (stage.isApprove) {
              <span data-approve-phone class="flex">
                <lucide-angular [img]="phoneIcon" class="w-4 h-4" />
              </span>
              <span data-approve-check class="absolute flex opacity-0">
                <lucide-angular [img]="checkIcon" class="w-4 h-4" />
              </span>
            } @else {
              <lucide-angular [img]="stage.icon" class="w-4 h-4" />
            }
          </span>
          <span class="stage-title font-mono text-[11px] leading-tight">{{
            stage.title
          }}</span>
          <span class="font-mono text-[9px] text-ink-500 leading-tight">{{
            stage.sub
          }}</span>
        </div>
      }
    </div>

    <p class="mt-2 text-center font-mono text-[10px] text-ink-500">
      cron scheduler · messaging gateways +voice · approval relay
    </p>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .stage-ring {
        border-color: #2b303a;
        color: #5b616f;
        transition:
          border-color 0.3s ease,
          color 0.3s ease,
          box-shadow 0.3s ease;
      }
      .stage.is-lit .stage-ring {
        border-color: #f5a524;
        color: #f5a524;
        box-shadow: 0 0 0 4px rgba(245, 165, 36, 0.12);
      }
      .stage-title {
        color: #8b92a1;
        transition: color 0.3s ease;
      }
      .stage.is-lit .stage-title {
        color: #ffffff;
      }
    `,
  ],
})
export class AlwaysOnLoopDiagramComponent {
  public readonly ariaLabel = input<string>(
    'Diagram: a continuous overnight loop — a cron job fires, an agent runs, a ' +
      'diff becomes ready, and you approve it from Telegram, Discord, or Slack — ' +
      'then the loop repeats.',
  );

  public readonly phoneIcon = Smartphone;
  public readonly checkIcon = Check;

  protected readonly loopPath =
    'M 180 70 H 340 A 60 60 0 0 1 400 130 V 250 ' +
    'A 60 60 0 0 1 340 310 H 180 A 60 60 0 0 1 120 250 ' +
    'V 130 A 60 60 0 0 1 180 70 Z';

  protected readonly stages: readonly LoopStage[] = [
    {
      id: 'cron',
      title: 'Cron fires',
      sub: 'SQLite slot-claim',
      icon: Moon,
      left: 50,
      top: 18.4,
      isApprove: false,
    },
    {
      id: 'run',
      title: 'Agent runs',
      sub: 'overnight',
      icon: Bot,
      left: 76.9,
      top: 50,
      isApprove: false,
    },
    {
      id: 'diff',
      title: 'Diff ready',
      sub: 'review-ready',
      icon: GitMerge,
      left: 50,
      top: 81.6,
      isApprove: false,
    },
    {
      id: 'approve',
      title: 'Approve',
      sub: 'Telegram · Discord · Slack',
      icon: Smartphone,
      left: 23.1,
      top: 50,
      isApprove: true,
    },
  ];

  /** Loop-progress fractions where each stage sits along the path. */
  private readonly stageAt = [0.085, 0.335, 0.585, 0.835];

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
    const loop = host.querySelector<SVGPathElement>('[data-loop]');
    const pulse = host.querySelector<SVGElement>('[data-pulse]');
    const stageEls = gsap.utils.toArray<HTMLElement>('[data-stage]', host);
    const phone = host.querySelector<HTMLElement>('[data-approve-phone]');
    const check = host.querySelector<HTMLElement>('[data-approve-check]');
    if (!loop) return;

    const DRAW = 1;
    const TRAVEL = 4;

    const reset = (): void => {
      gsap.set(loop, { strokeDasharray: 1, strokeDashoffset: 1 });
      if (pulse) gsap.set(pulse, { autoAlpha: 0 });
      stageEls.forEach((s) => s.classList.remove('is-lit'));
      if (phone) gsap.set(phone, { autoAlpha: 1 });
      if (check) gsap.set(check, { autoAlpha: 0 });
    };

    reset();
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, onRepeat: reset });

    tl.to(
      loop,
      { strokeDashoffset: 0, duration: DRAW, ease: 'power2.inOut' },
      0,
    );

    const travelStart = DRAW;
    if (pulse) {
      tl.set(pulse, { autoAlpha: 1 }, travelStart - 0.1);
      tl.to(
        pulse,
        {
          motionPath: {
            path: loop,
            align: loop,
            alignOrigin: [0.5, 0.5],
            start: 0,
            end: 1,
          },
          duration: TRAVEL,
          ease: 'none',
        },
        travelStart,
      );
      tl.to(pulse, { autoAlpha: 0, duration: 0.3 }, travelStart + TRAVEL);
    }

    this.stageAt.forEach((frac, i) => {
      const at = travelStart + frac * TRAVEL;
      tl.call(() => stageEls[i]?.classList.add('is-lit'), undefined, at);
      if (this.stages[i].isApprove) {
        if (phone) tl.to(phone, { autoAlpha: 0, duration: 0.2 }, at);
        if (check) tl.to(check, { autoAlpha: 1, duration: 0.3 }, at + 0.1);
      }
    });
  }
}
