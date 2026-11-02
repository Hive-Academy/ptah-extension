import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  Check,
  CircleAlert,
  CirclePause,
  Hand,
  LucideAngularModule,
  Workflow,
} from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import {
  monogramGlyph,
  monogramTintClass,
  ProviderMarkComponent,
} from '@ptah-extension/ui';
import type {
  AgentAvatarSize,
  AgentKind,
  AgentStatusWord,
} from './agent-avatar.types';
import { cliMarkFor, roleIconFor } from './agent-marks';

/** How the status ring is drawn; `null` draws none. */
type RingKind = 'waiting' | 'solid';

interface StatusBadge {
  readonly icon: LucideIconData;
  readonly inkClass: string;
}

interface SizeClasses {
  /** Tile box. */
  readonly tile: string;
  /** Lucide glyph, 58% of the tile. */
  readonly glyph: string;
  /** Monogram text. */
  readonly monogram: string;
  /** Corner badge, 46% of the tile, min 10 px. */
  readonly badge: string;
  /** Glyph inside the corner badge. */
  readonly badgeGlyph: string;
}

const SIZE_CLASSES: Readonly<Record<AgentAvatarSize, SizeClasses>> = {
  24: {
    tile: 'h-6 w-6',
    glyph: 'h-3.5 w-3.5',
    monogram: 'text-[11px]',
    badge: 'h-[11px] w-[11px]',
    badgeGlyph: 'h-[7px] w-[7px]',
  },
  28: {
    tile: 'h-7 w-7',
    glyph: 'h-4 w-4',
    monogram: 'text-xs',
    badge: 'h-[13px] w-[13px]',
    badgeGlyph: 'h-[9px] w-[9px]',
  },
  32: {
    tile: 'h-8 w-8',
    glyph: 'h-[18px] w-[18px]',
    monogram: 'text-sm',
    badge: 'h-[15px] w-[15px]',
    badgeGlyph: 'h-[11px] w-[11px]',
  },
};

/** The ring sits 4 px outside the tile on every side. */
const RING_OUTSET_PX = 4;
const RING_STROKE_PX = 2;

const RING_BY_STATUS: Readonly<Record<AgentStatusWord, RingKind | null>> = {
  running: 'solid',
  waiting: 'waiting',
  failed: 'solid',
  done: null,
  stopped: null,
  queued: null,
};

const RING_INK_BY_STATUS: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  failed: 'text-state-err',
  done: 'text-state-done',
  stopped: 'text-state-idle',
  queued: 'text-state-idle',
};

const BADGE_BY_STATUS: Readonly<Record<AgentStatusWord, StatusBadge | null>> = {
  running: null,
  done: { icon: Check, inkClass: 'border-state-done text-state-done' },
  failed: { icon: CircleAlert, inkClass: 'border-state-err text-state-err' },
  waiting: { icon: Hand, inkClass: 'border-state-need text-state-need' },
  stopped: {
    icon: CirclePause,
    inkClass: 'border-state-idle text-state-idle',
  },
  queued: null,
};

/**
 * The one visual identity of an agent: a circular tile with the agent's
 * glyph, a status ring and a corner status badge.
 *
 * - Glyph: the Orchestrator is always lucide `Workflow`; a sub-agent or
 *   background agent gets its role icon (`Bot` when the type is unknown); a
 *   CLI lane gets its provider mark, or a monogram of its id when the id has
 *   no mark.
 * - Ring: `running` and `failed` draw a solid ring in their state ink,
 *   `waiting` is that ring with a pulsing halo; other states draw none.
 *   `running` also draws an 8 px pulse core and ring at the badge corner
 *   (the TASK_2026_860 pulse language; the old rotating arc is gone). All
 *   loops animate `transform` / `opacity` only and stop under
 *   `prefers-reduced-motion`, which keeps a still dot.
 * - Badge: one lucide glyph per status in its state ink; `queued`,
 *   `running` (the pulse replaces it) and no status draw none.
 *
 * Decorative: the host is `aria-hidden`, and the surrounding row or chip
 * carries the accessible name (`agentAccessibleLabel`). No outputs.
 */
@Component({
  selector: 'ptah-agent-avatar',
  standalone: true,
  imports: [LucideAngularModule, ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'relative inline-flex shrink-0',
    '[attr.data-kind]': 'kind()',
    '[attr.data-status]': 'status()',
  },
  template: `
    <span [class]="tileClass()" data-testid="agent-avatar-tile">
      @if (providerId(); as id) {
        <ptah-provider-mark [providerId]="id" [size]="providerMarkSize()" />
      } @else if (monogramLabel() !== null) {
        <span [class]="monogramClass()" data-testid="agent-avatar-monogram">{{
          monogramText()
        }}</span>
      } @else if (glyphIcon(); as icon) {
        <lucide-angular
          [img]="icon"
          [class]="sizes().glyph"
          data-testid="agent-avatar-glyph"
        />
      }
    </span>

    @if (ring(); as ringKind) {
      @if (ringKind === 'waiting') {
        <span [class]="haloClass()" data-testid="agent-avatar-halo"></span>
      }
      <svg
        [class]="ringClass()"
        [attr.width]="ringBox()"
        [attr.height]="ringBox()"
        [attr.viewBox]="ringViewBox()"
        fill="none"
        data-testid="agent-avatar-ring"
      >
        <circle
          [attr.cx]="ringCenter()"
          [attr.cy]="ringCenter()"
          [attr.r]="ringRadius()"
          stroke="currentColor"
          [attr.stroke-width]="ringStroke"
        />
      </svg>
    }

    @if (status() === 'running') {
      <span
        [class]="pulseClass()"
        data-testid="agent-avatar-pulse"
      ></span>
    }

    @if (badge(); as statusBadge) {
      <span [class]="badgeClass()" data-testid="agent-avatar-badge">
        <lucide-angular [img]="statusBadge.icon" [class]="sizes().badgeGlyph" />
      </span>
    }
  `,
  styles: [
    `
      .agent-avatar-halo {
        opacity: 0;
        animation: agent-avatar-halo 1.8s ease-out infinite;
      }

      /* The TASK_2026_860 pulse: an 8 px core breathing inside a 14 px ring
         that fades out from it. Both use the shared global keyframes, so they
         stay in step with every other loader; only transform and opacity
         animate. The span itself is placed by the Tailwind absolute classes
         in pulseClass, which also makes it the pseudos' containing block. */
      .agent-avatar-pulse {
        width: 8px;
        height: 8px;
      }

      .agent-avatar-pulse::before {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 9999px;
        background: currentColor;
        animation: ptah-pulse-core 1.4s ease-in-out infinite;
      }

      .agent-avatar-pulse::after {
        content: '';
        position: absolute;
        inset: -3px;
        border: 1.5px solid currentColor;
        border-radius: 9999px;
        animation: ptah-pulse-ring 1.4s ease-out infinite;
      }

      @keyframes agent-avatar-halo {
        0% {
          opacity: 0.55;
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(1.35);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .agent-avatar-halo {
          animation: none;
        }

        .agent-avatar-pulse::after {
          display: none;
        }

        .agent-avatar-pulse::before {
          opacity: 0.8;
        }

        :host,
        :host * {
          transition-duration: 0ms !important;
        }
      }
    `,
  ],
})
export class AgentAvatarComponent {
  /** Which kind of agent the avatar stands for. */
  readonly kind = input.required<AgentKind>();

  /** The agent's status word; `null` draws the tile only. */
  readonly status = input<AgentStatusWord | null>(null);

  /** Tile size in px. @default 28 */
  readonly size = input<AgentAvatarSize>(28);

  /** CLI id of a `cli` lane; ignored for other kinds. */
  readonly cliId = input<string | null>(null);

  /** Agent type of a `subagent` / `background` agent; ignored otherwise. */
  readonly agentType = input<string | null>(null);

  protected readonly ringStroke = RING_STROKE_PX;

  protected readonly sizes = computed(() => SIZE_CLASSES[this.size()]);

  private readonly cliMark = computed(() =>
    this.kind() === 'cli' ? cliMarkFor(this.cliId()) : null,
  );

  protected readonly providerId = computed(() => {
    const mark = this.cliMark();
    return mark?.kind === 'provider' ? mark.providerId : null;
  });

  protected readonly monogramLabel = computed(() => {
    const mark = this.cliMark();
    return mark?.kind === 'monogram' ? mark.label : null;
  });

  protected readonly monogramText = computed(() => {
    const label = this.monogramLabel();
    return label === null ? '' : monogramGlyph(label);
  });

  protected readonly glyphIcon = computed<LucideIconData | null>(() => {
    const kind = this.kind();
    switch (kind) {
      case 'orchestrator':
        return Workflow;
      case 'subagent':
      case 'background':
        return roleIconFor(this.agentType());
      case 'cli':
        return null;
      default: {
        const _unhandled: never = kind;
        return roleIconFor(null);
      }
    }
  });

  /** Provider marks have two sizes: `sm` (16 px box) and `md` (32 px box). */
  protected readonly providerMarkSize = computed<'sm' | 'md'>(() =>
    this.size() === 32 ? 'md' : 'sm',
  );

  protected readonly tileClass = computed(() =>
    [
      'flex items-center justify-center overflow-hidden rounded-full border bg-surface-2 text-base-content',
      this.kind() === 'orchestrator'
        ? 'border-secondary'
        : 'border-[var(--surface-border-strong)]',
      this.sizes().tile,
    ].join(' '),
  );

  protected readonly monogramClass = computed(() => {
    const label = this.monogramLabel() ?? '';
    return [
      'flex h-full w-full select-none items-center justify-center rounded-full font-semibold leading-none text-base-content',
      monogramTintClass(label),
      this.sizes().monogram,
    ].join(' ');
  });

  protected readonly ring = computed<RingKind | null>(() => {
    const status = this.status();
    return status === null ? null : RING_BY_STATUS[status];
  });

  private readonly ringInkClass = computed(() => {
    const status = this.status();
    return status === null ? '' : RING_INK_BY_STATUS[status];
  });

  protected readonly ringClass = computed(() =>
    [
      'pointer-events-none absolute -left-1 -top-1 overflow-visible',
      this.ringInkClass(),
    ].join(' '),
  );

  /** The pulse draws its core and ring in the ring's ink through
   * `currentColor`, so it reads as the running state. */
  protected readonly pulseClass = computed(() =>
    [
      'agent-avatar-pulse pointer-events-none absolute -bottom-0.5 -right-0.5',
      this.ringInkClass(),
    ].join(' '),
  );

  /** The halo is drawn in the ring's ink through `border-current`. */
  protected readonly haloClass = computed(() =>
    [
      'agent-avatar-halo pointer-events-none absolute -inset-1 rounded-full border-2 border-current',
      this.ringInkClass(),
    ].join(' '),
  );

  protected readonly ringBox = computed(() => this.size() + RING_OUTSET_PX * 2);

  protected readonly ringViewBox = computed(
    () => `0 0 ${this.ringBox()} ${this.ringBox()}`,
  );

  protected readonly ringCenter = computed(() => this.ringBox() / 2);

  /** The stroke's outer edge touches the svg edge: 4 px outside the tile. */
  protected readonly ringRadius = computed(
    () => this.ringBox() / 2 - RING_STROKE_PX / 2,
  );

  protected readonly badge = computed<StatusBadge | null>(() => {
    const status = this.status();
    return status === null ? null : BADGE_BY_STATUS[status];
  });

  protected readonly badgeClass = computed(() => {
    const badge = this.badge();
    return badge === null
      ? ''
      : [
          'absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-[1.5px] bg-surface-0',
          badge.inkClass,
          this.sizes().badge,
        ].join(' ');
  });
}
