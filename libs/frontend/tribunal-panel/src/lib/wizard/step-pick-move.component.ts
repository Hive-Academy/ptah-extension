import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Users,
  GitBranch,
  Trophy,
  Workflow,
  FlaskConical,
  Settings,
  TriangleAlert,
} from 'lucide-angular';
import {
  ClaudeRpcService,
  WebviewNavigationService,
} from '@ptah-extension/core';
import { TribunalDiscoveryService } from '../services/tribunal-discovery.service';
import type { TribunalMove } from '../types/tribunal-ui.types';

interface MoveCard {
  readonly move: TribunalMove;
  readonly title: string;
  readonly description: string;
  /**
   * Whether the move ships at all. Every move ships, so every card is `true`.
   *
   * Availability that depends on the MACHINE (Crucible's two-family
   * requirement) is deliberately NOT expressed here — see
   * {@link StepPickMoveComponent.blockedReasonFor}, which stays null until
   * discovery resolves so no card ever paints disabled and then enables.
   */
  readonly enabled: boolean;
}

/** The plugin whose skills back the Tribunal moves. */
const TRIBUNAL_PLUGIN_ID = 'ptah-core';
/** Skill directory name inside that plugin. */
const TRIBUNAL_SKILL_ID = 'tribunal';

/** Moves whose protocol lives in the skill and cannot be inferred from framing alone. */
const SKILL_DEPENDENT_MOVES: ReadonlySet<TribunalMove> = new Set<TribunalMove>([
  'relay',
  'crucible',
]);

@Component({
  selector: 'ptah-step-pick-move',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-pick-move">
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">Pick a move</h3>
        <p class="text-sm text-base-content-muted">
          Choose how the panel of vendors should work together.
        </p>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        @for (card of cards; track card.move) {
          <button
            type="button"
            class="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors"
            [class.border-primary]="selected() === card.move && isEnabled(card)"
            [class.bg-primary/5]="selected() === card.move && isEnabled(card)"
            [class.border-base-300]="
              selected() !== card.move || !isEnabled(card)
            "
            [class.cursor-pointer]="isEnabled(card)"
            [class.cursor-not-allowed]="!isEnabled(card)"
            [class.opacity-50]="!isEnabled(card)"
            [disabled]="!isEnabled(card)"
            [attr.data-move]="card.move"
            [attr.aria-pressed]="selected() === card.move"
            [attr.aria-label]="card.title"
            [attr.aria-describedby]="
              blockedReasonFor(card.move) ? card.move + '-reason' : null
            "
            (click)="pick(card)"
          >
            <span
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <lucide-angular [img]="iconFor(card.move)" class="h-5 w-5" />
            </span>
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-base-content">{{
                card.title
              }}</span>
              @if (!card.enabled) {
                <span
                  class="rounded-full bg-base-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-base-content-muted"
                  >Coming soon</span
                >
              }
              @if (blockedReasonFor(card.move)) {
                <span
                  class="rounded-full bg-base-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-base-content-muted"
                  data-testid="tribunal-move-blocked-badge"
                  >Unavailable</span
                >
              }
              @if (showsSkillAdvisory(card.move)) {
                <span
                  class="flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning"
                  data-testid="tribunal-skill-advisory"
                >
                  <lucide-angular
                    [img]="WarningIcon"
                    class="h-3 w-3"
                    aria-hidden="true"
                  />
                  Needs the tribunal skill
                </span>
              }
            </span>
            <span class="text-xs text-base-content-muted">{{
              card.description
            }}</span>
            @if (blockedReasonFor(card.move); as reason) {
              <span
                class="text-[11px] text-base-content-muted"
                [id]="card.move + '-reason'"
                >{{ reason }}</span
              >
            }
          </button>
        }
      </div>

      @if (blockedReasonFor('crucible')) {
        <div
          class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2 text-xs text-base-content-muted"
          role="note"
        >
          <span class="flex-1">
            Crucible needs two independent vendor families — one to write the
            code and a different one to judge it.
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            aria-label="Configure another provider"
            (click)="openProviderSettings()"
          >
            <lucide-angular
              [img]="SettingsIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Configure a provider
          </button>
        </div>
      }

      @if (skillMissing()) {
        <p class="text-xs text-base-content-muted" role="note">
          The tribunal skill is not installed for {{ pluginId }}. Relay and
          Crucible still launch — the conductor will ask for the protocol it
          needs — but they run best with the skill present.
        </p>
      }
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
export class StepPickMoveComponent {
  readonly selected = input<TribunalMove>('council');
  readonly moveSelected = output<TribunalMove>();

  private readonly discovery = inject(TribunalDiscoveryService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly rpc = inject(ClaudeRpcService);

  protected readonly pluginId = TRIBUNAL_PLUGIN_ID;

  /**
   * Every shipped move, every card enabled.
   *
   * Relay and Crucible are not "coming soon" — the skill has shipped both, and
   * a card that is present but permanently greyed teaches the user the feature
   * does not exist.
   */
  protected readonly cards: readonly MoveCard[] = [
    {
      move: 'council',
      title: 'Council',
      description:
        'Each vendor weighs in; the conductor synthesizes a single cited verdict.',
      enabled: true,
    },
    {
      move: 'forge',
      title: 'Forge',
      description:
        'Each vendor implements in its own worktree; diffs are cross-reviewed.',
      enabled: true,
    },
    {
      move: 'race',
      title: 'Race',
      description: 'Vendors compete; results are scored against a rubric.',
      enabled: true,
    },
    {
      move: 'relay',
      title: 'Relay',
      description:
        'One task down a plan → architect → implement → review pipeline, one lane per phase.',
      enabled: true,
    },
    {
      move: 'crucible',
      title: 'Crucible',
      description:
        'A cheap executor writes; a stronger judge from another family scores it against a frozen rubric.',
      enabled: true,
    },
  ];

  protected readonly UsersIcon = Users;
  protected readonly ForgeIcon = GitBranch;
  protected readonly RaceIcon = Trophy;
  protected readonly RelayIcon = Workflow;
  protected readonly CrucibleIcon = FlaskConical;
  protected readonly SettingsIcon = Settings;
  protected readonly WarningIcon = TriangleAlert;

  /**
   * `null` = present or undetermined; `true` = the probe answered and the skill
   * is not there. Only a definite absence shows anything: an unreliable check
   * must never produce a scary banner.
   */
  private readonly _skillMissing = signal<boolean | null>(null);

  protected readonly skillMissing = computed(
    () => this._skillMissing() === true,
  );

  /**
   * Why a move cannot run on THIS machine, or null.
   *
   * Returns null for every move until discovery resolves (R7): the cards must
   * paint enabled first and gain a restriction afterwards, never the reverse.
   * A discovery that fails leaves `discovered()` false, so a probe we could not
   * trust can never disable a move.
   */
  protected readonly blockedReason = computed<
    Partial<Record<TribunalMove, string>>
  >(() => {
    if (!this.discovery.discovered()) return {};
    if (this.discovery.availableFamilyCount() >= 2) return {};
    return {
      crucible:
        'Crucible cannot run with fewer than two vendor families — there is no independent judge to be had.',
    };
  });

  constructor() {
    void this.discovery.ensureDiscovered();
    void this.probeSkill();
  }

  protected blockedReasonFor(move: TribunalMove): string | null {
    return this.blockedReason()[move] ?? null;
  }

  protected isEnabled(card: MoveCard): boolean {
    return card.enabled && this.blockedReasonFor(card.move) === null;
  }

  protected showsSkillAdvisory(move: TribunalMove): boolean {
    return this.skillMissing() && SKILL_DEPENDENT_MOVES.has(move);
  }

  protected openProviderSettings(): void {
    void this.navigation.navigateToSettingsTab('orchestration');
  }

  /**
   * Exhaustive — NO `default:` arm.
   *
   * The arm that used to be here is why widening `TribunalMove` compiled
   * silently: two new moves fell through to the Council icon instead of
   * breaking the build. Every move now names its own icon, so a sixth one
   * cannot inherit a wrong picture.
   */
  protected iconFor(move: TribunalMove) {
    switch (move) {
      case 'council':
        return this.UsersIcon;
      case 'forge':
        return this.ForgeIcon;
      case 'race':
        return this.RaceIcon;
      case 'relay':
        return this.RelayIcon;
      case 'crucible':
        return this.CrucibleIcon;
    }
  }

  protected pick(card: MoveCard): void {
    if (!this.isEnabled(card)) return;
    this.moveSelected.emit(card.move);
  }

  /**
   * Non-blocking installed-skill probe. Three outcomes, one of which renders:
   * present → nothing, definitely absent → an advisory badge, probe failed →
   * nothing.
   */
  private async probeSkill(): Promise<void> {
    try {
      const result = await this.rpc.call('plugins:list-skills', {
        pluginIds: [TRIBUNAL_PLUGIN_ID],
      });
      if (!result.isSuccess() || !result.data) return;
      const present = result.data.skills.some(
        (skill) => skill.skillId === TRIBUNAL_SKILL_ID,
      );
      this._skillMissing.set(!present);
    } catch (error: unknown) {
      console.warn(
        '[StepPickMoveComponent] plugins:list-skills failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
