/**
 * Dashboard provider account card (TASK_2026_596, Component 16; design §4).
 *
 * One `<section>` per quota owner in the shared `PlanLimitsStore` snapshot,
 * the selected provider's owner first. Each section names every plan window
 * with its used value (never a fabricated 0), its reset as absolute + relative
 * time, its state as a word and its per-field sources; owner-level limit
 * evidence and an active cooldown are separate notices. The Codex activity
 * block is kept as it was.
 *
 * Selection: `AuthStateService.persistedProviderId()` drives `load({providerId})`.
 * The store merges only the fields a call names, so the card passes exactly
 * `providerId` and never touches the chat view's `sessionIds` / `ownerKeys`.
 * The store owns the generation guard and the single 30 s clock; this card
 * starts no timer of its own.
 */
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { AuthStateService, PlanLimitsStore } from '@ptah-extension/core';
import {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  classifyWindow,
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  formatUsed,
  FRESHNESS_MS,
  isActiveLimitEvidence,
  NEAR_LIMIT_PERCENT,
  ownerDisplayLabel,
  PLAN_LIMIT_SOURCE_LABELS,
  resetPassage,
  usedPercent,
  windowFieldSources,
  windowObservedAt,
  type LocalTimeOptions,
  type OwnerLimitEvidence,
  type PlanLimitOwnerSnapshot,
  type PlanLimitSource,
  type PlanLimitWindow,
  type PlanLimitsSnapshot,
  type PlanWindowState,
  type ProviderAccountUsageStatus,
} from '@ptah-extension/shared';

type Tone = 'error' | 'warning' | 'info' | 'neutral';

export interface SourceChipView {
  readonly text: string;
  /** `provider-unofficial` and `estimated` render dashed + italic (design §1). */
  readonly unofficial: boolean;
}

export interface StateChipView {
  readonly glyph: string;
  readonly text: string;
  readonly tone: Tone;
}

export interface WindowRowView {
  readonly key: string;
  readonly name: string;
  readonly chip: StateChipView | null;
  /** Bar fill percent; `null` draws no bar (unknown is never an empty bar). */
  readonly percent: number | null;
  readonly barTone: Tone;
  readonly valueText: string;
  /** "Limit reached — …" headline; bold. */
  readonly limitLine: string | null;
  readonly resetLines: readonly string[];
  readonly note: string | null;
  /** Informational only: an active `estimated` limit hit is never a warning. */
  readonly estimateNote: string | null;
  readonly sources: readonly SourceChipView[];
}

export interface NoticeView {
  readonly text: string;
  readonly tone: Tone;
  readonly sources: readonly SourceChipView[];
}

export interface OwnerSectionView {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
  readonly statusChip: ProviderAccountUsageStatus | null;
  readonly noUsageSource: boolean;
  readonly statusNotice: NoticeView | null;
  readonly windows: readonly WindowRowView[];
  readonly evidence: readonly NoticeView[];
  readonly cooldown: string | null;
  readonly activity: PlanLimitOwnerSnapshot['activity'] | null;
}

const STATE_CHIPS: Readonly<Record<PlanWindowState, StateChipView | null>> = {
  'limit-reached': { glyph: '■', text: 'Limit reached', tone: 'error' },
  'near-limit': { glyph: '▲', text: 'Near limit', tone: 'warning' },
  aged: { glyph: '◷', text: 'Aged', tone: 'neutral' },
  'usage-unknown': { glyph: '?', text: 'Usage unknown', tone: 'neutral' },
  'not-confirmed': { glyph: '?', text: 'Not confirmed', tone: 'neutral' },
  'reset-usage-unknown': {
    glyph: '↻',
    text: 'Reset · usage unknown',
    tone: 'neutral',
  },
  'estimate-only': { glyph: '~', text: 'Estimate only', tone: 'neutral' },
  ok: null,
};

/** One sentence per failure status (design §4); `stale` has its own notice. */
const STATUS_SENTENCES: Partial<Record<ProviderAccountUsageStatus, string>> = {
  'unsupported-auth':
    'No plan windows: this account signs in with an API key, which has no subscription limits.',
  'unsupported-config':
    'Usage cannot be read: the provider is not configured for a usage read.',
  'provider-unsupported':
    'Usage cannot be read: this provider has no usage source.',
  'cli-unavailable': 'Usage cannot be read: the provider CLI was not found.',
  'cli-version-unsupported':
    'Usage cannot be read: the installed provider CLI version does not report usage.',
  'service-unavailable':
    'Usage unavailable: the provider’s usage service did not return a readable response. No values are shown.',
};

@Component({
  selector: 'ptah-provider-account-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sections(); as list) {
      @if (refreshNotice(); as notice) {
        <p
          role="status"
          class="mb-2 border-l-2 border-info pl-2 text-xs text-base-content-muted"
          data-testid="refresh-failed"
        >
          {{ notice }}
        </p>
      }
      @for (section of list; track section.key) {
        <section
          class="rounded-lg border border-base-content/10 bg-base-100/40 p-3"
          [attr.aria-label]="section.label + ' usage'"
          data-testid="provider-account-section"
        >
          <div
            class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"
            data-testid="section-header"
          >
            <!-- A 5rem basis, not the subtitle's full width, decides when the
                 chip group wraps below: only when the title would get less. -->
            <div class="min-w-0 flex-1 basis-20">
              <h4 class="font-medium text-sm">{{ section.label }}</h4>
              <p class="text-[10px] text-base-content-muted">
                {{ section.subtitle }}
              </p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              @if (section.statusChip; as status) {
                <span
                  class="text-[11px] px-1.5 rounded border border-dashed border-base-content/20 whitespace-nowrap"
                  data-testid="status-chip"
                  >{{ status }}</span
                >
              }
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                [disabled]="loading()"
                [attr.aria-label]="'Refresh ' + section.label + ' usage'"
                (click)="refresh()"
              >
                Refresh
              </button>
            </div>
          </div>

          @if (section.noUsageSource) {
            <p class="text-xs mt-2.5">
              <strong>No usage source</strong>
              <span class="text-base-content-muted">
                · This provider does not report plan usage, so nothing is shown
                as a percentage.</span
              >
            </p>
          }
          @if (section.statusNotice; as notice) {
            <p
              role="status"
              class="text-xs mt-2.5 border-l-2 pl-2"
              [class]="noticeBorder(notice.tone)"
            >
              {{ notice.text }}
            </p>
          }

          @if (section.windows.length > 0) {
            <div class="mt-2 flex flex-col gap-2.5">
              @for (row of section.windows; track row.key) {
                <div role="group" [attr.aria-label]="row.name" data-testid="window-row">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[13px] font-semibold">{{ row.name }}</span>
                    @if (row.chip; as chip) {
                      <span
                        class="text-[11px] px-1.5 rounded border whitespace-nowrap"
                        [class]="chipClass(chip.tone)"
                        data-testid="state-chip"
                        ><span aria-hidden="true">{{ chip.glyph }} </span
                        >{{ chip.text }}</span
                      >
                    }
                  </div>
                  <div class="flex items-center gap-2 mt-1">
                    @if (row.percent !== null) {
                      <div
                        class="relative flex-1 h-1.5 rounded bg-base-content/10"
                        role="meter"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        [attr.aria-valuenow]="roundPercent(row.percent)"
                        [attr.aria-valuetext]="row.valueText"
                        [attr.aria-label]="row.name + ' used'"
                      >
                        <span
                          class="block h-full rounded bg-base-content/70"
                          [style.width.%]="clampPercent(row.percent)"
                          [style.background-image]="barStripes(row.barTone)"
                        ></span>
                        <span
                          class="absolute -top-0.5 h-2.5 w-px bg-base-content/60"
                          [style.left.%]="nearLimitPercent"
                          aria-hidden="true"
                          [attr.title]="'Near-limit threshold ' + nearLimitPercent + '%'"
                        ></span>
                      </div>
                    } @else {
                      <div class="flex-1"></div>
                    }
                    <span class="text-xs font-semibold tabular-nums text-right" data-testid="window-value">{{
                      row.valueText
                    }}</span>
                  </div>
                  <div
                    class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-base-content-muted"
                  >
                    @if (row.limitLine) {
                      <strong class="text-base-content">{{ row.limitLine }}</strong>
                    }
                    @for (line of row.resetLines; track $index) {
                      <span>{{ line }}</span>
                    }
                    @if (row.note) {
                      <span>{{ row.note }}</span>
                    }
                    @for (source of row.sources; track source.text) {
                      <span
                        class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted"
                        [class.border-dashed]="source.unofficial"
                        [class.italic]="source.unofficial"
                        data-testid="source-chip"
                        >{{ source.text }}</span
                      >
                    }
                  </div>
                  @if (row.estimateNote) {
                    <p class="text-[11px] text-base-content-muted mt-1" data-testid="estimate-note">
                      {{ row.estimateNote }}
                    </p>
                  }
                </div>
              }
            </div>
          }

          @for (notice of section.evidence; track $index) {
            <p
              role="status"
              class="text-xs mt-2.5 border-l-2 pl-2 flex flex-wrap items-center gap-x-1.5"
              [class]="noticeBorder(notice.tone)"
              data-testid="owner-evidence"
            >
              <span>{{ notice.text }}</span>
              @for (source of notice.sources; track source.text) {
                <span
                  class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted"
                  [class.border-dashed]="source.unofficial"
                  [class.italic]="source.unofficial"
                  >{{ source.text }}</span
                >
              }
            </p>
          }

          @if (section.cooldown; as cooldown) {
            <p
              role="status"
              class="text-xs mt-2.5 border-l-2 border-info pl-2 flex flex-wrap items-center gap-x-1.5"
              data-testid="cooldown"
            >
              <span class="text-[11px] px-1.5 rounded border border-info bg-info/15">Cooldown</span>
              <span>{{ cooldown }}</span>
            </p>
          }

          @if (section.activity; as activity) {
            <div class="mt-3" aria-label="Account activity">
              <p class="text-xs font-medium">Activity</p>
              <p class="text-xs">Lifetime tokens: {{ activity.lifetimeTokens ?? 'Unavailable' }}</p>
              <p class="text-[10px] text-base-content-muted">Activity is not remaining messages, credits, or billing.</p>
            </div>
          }
        </section>
      } @empty {
        <section
          class="rounded-lg border border-base-content/10 bg-base-100/40 p-3"
          aria-label="Account usage"
        >
          <div class="flex items-center justify-between gap-3">
            <h4 class="font-medium text-sm">Account usage</h4>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              [disabled]="loading()"
              (click)="refresh()"
            >
              Refresh
            </button>
          </div>
          @if (loading()) {
            <span class="loading loading-spinner loading-xs mt-3" aria-label="Loading account usage"></span>
          } @else {
            <p class="text-xs text-base-content-muted mt-3" data-testid="usage-unavailable">
              Account usage unavailable
            </p>
          }
        </section>
      }
    } @else if (loading()) {
      <span class="loading loading-spinner loading-xs" aria-label="Loading account usage"></span>
    }
  `,
})
export class ProviderAccountCardComponent {
  private readonly planLimits = inject(PlanLimitsStore);
  private readonly auth = inject(AuthStateService);

  /** Explicit zone and zone-name locale (carry-forward from Batch 3). */
  private readonly timeOptions: LocalTimeOptions = {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneNameLocale: inject(LOCALE_ID),
  };

  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;
  protected readonly loading = this.planLimits.loading;

  /** `null` until the first snapshot; `[]` for an empty (failed) snapshot. */
  protected readonly sections = computed<readonly OwnerSectionView[] | null>(
    () => {
      const snapshot = this.planLimits.snapshot();
      if (snapshot === null) return null;
      return buildOwnerSections(
        snapshot,
        this.auth.persistedProviderId(),
        this.planLimits.now(),
        this.timeOptions,
      );
    },
  );

  /**
   * Neutral notice while a failed pull leaves the last snapshot in place;
   * `null` after a good pull or push, and when no owner is held (the empty
   * placeholder renders "Account usage unavailable" instead).
   */
  protected readonly refreshNotice = computed<string | null>(() => {
    if (!this.planLimits.loadError()) return null;
    const snapshot = this.planLimits.snapshot();
    if (snapshot === null) return null;
    return refreshFailedNotice(
      snapshot,
      this.planLimits.now(),
      this.timeOptions,
    );
  });

  private readonly providerWatcher = effect(() => {
    const providerId = this.auth.persistedProviderId();
    untracked(() => void this.planLimits.load({ providerId }));
  });

  refresh(): void {
    void this.planLimits.load({
      providerId: this.auth.persistedProviderId(),
      refresh: true,
    });
  }

  protected roundPercent(percent: number): number {
    return Math.round(percent);
  }

  protected clampPercent(percent: number): number {
    return Math.max(0, Math.min(100, percent));
  }

  /** Stripes are decoration only; the fill stays neutral (design §4, §8). */
  protected barStripes(tone: Tone): string | null {
    if (tone === 'error') {
      return 'repeating-linear-gradient(45deg, oklch(var(--er)) 0 4px, transparent 4px 8px)';
    }
    if (tone === 'warning') {
      return 'repeating-linear-gradient(90deg, oklch(var(--wa)) 0 6px, transparent 6px 8px)';
    }
    return null;
  }

  /** Semantic colour only as border and tint, never as text (design §8). */
  protected chipClass(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'border-error bg-error/15 font-semibold';
      case 'warning':
        return 'border-warning bg-warning/15 font-semibold';
      case 'info':
        return 'border-info bg-info/15';
      default:
        return 'border-dashed border-base-content/20';
    }
  }

  protected noticeBorder(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'border-error';
      case 'warning':
        return 'border-warning';
      case 'info':
        return 'border-info';
      default:
        return 'border-base-content/40';
    }
  }
}

// ---------------------------------------------------------------------------
// View model (pure; `now` and the time options are parameters)
// ---------------------------------------------------------------------------

/** Owners in snapshot order, the selected provider's owners first. */
export function buildOwnerSections(
  snapshot: PlanLimitsSnapshot,
  selectedProviderId: string,
  now: number,
  time: LocalTimeOptions,
): OwnerSectionView[] {
  const selected = snapshot.owners.filter(
    (o) => o.owner.providerId === selectedProviderId,
  );
  const others = snapshot.owners.filter(
    (o) => o.owner.providerId !== selectedProviderId,
  );
  return [...selected, ...others].map((owner) =>
    buildOwnerSection(owner, now, time),
  );
}

/**
 * "Refresh failed — showing last observed data", with the newest host
 * observation among the held owners. `null` when no owner is held. Window
 * states keep their own age-based classification.
 */
export function refreshFailedNotice(
  snapshot: PlanLimitsSnapshot,
  now: number,
  time: LocalTimeOptions,
): string | null {
  if (snapshot.owners.length === 0) return null;
  let newest: number | undefined;
  for (const owner of snapshot.owners) {
    const instants = [
      ...owner.windows.map(windowObservedAt),
      ...owner.ownerEvidence.map((evidence) => evidence.observedAt),
    ];
    for (const instant of instants) {
      if (Number.isFinite(instant) && (newest === undefined || instant > newest)) {
        newest = instant;
      }
    }
  }
  return newest === undefined
    ? 'Refresh failed — showing last observed data'
    : `Refresh failed — showing last observed data (observed ${formatLocalAbsolute(newest, now, time)})`;
}

function buildOwnerSection(
  owner: PlanLimitOwnerSnapshot,
  now: number,
  time: LocalTimeOptions,
): OwnerSectionView {
  const hasData = owner.windows.length > 0 || owner.ownerEvidence.length > 0;
  return {
    key: owner.owner.key,
    // The generic label plus the key suffix ("Claude account · a1b2") so two
    // owners of one provider are told apart; never the full key.
    label: ownerDisplayLabel(owner.owner),
    subtitle: subtitleFor(owner),
    statusChip:
      owner.status === 'available' || owner.status === 'no-usage-source'
        ? null
        : owner.status,
    noUsageSource: owner.status === 'no-usage-source',
    statusNotice: statusNotice(owner, hasData, now, time),
    windows: owner.windows.map((w) => buildWindowRow(w, owner, now, time)),
    evidence: owner.ownerEvidence.map((e) => evidenceNotice(e, now, time)),
    cooldown:
      owner.cooldown !== undefined && owner.cooldown.until > now
        ? `Retrying after ${formatLocalAbsolute(owner.cooldown.until, now, time)} (${formatRelative(owner.cooldown.until, now)}) · a retry delay, not a plan reset`
        : null,
    activity: owner.activity ?? null,
  };
}

function subtitleFor(owner: PlanLimitOwnerSnapshot): string {
  const base =
    owner.activity !== undefined
      ? 'Subscription quota and account activity'
      : 'Subscription quota';
  const plan = owner.account?.planType;
  return plan ? `${base} · Plan: ${plan}` : base;
}

function statusNotice(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
  now: number,
  time: LocalTimeOptions,
): NoticeView | null {
  if (owner.status === 'stale') {
    const when =
      owner.staleSince !== undefined
        ? ` at ${formatLocalAbsolute(owner.staleSince, now, time)}`
        : '';
    return {
      text: `Showing cached account data; refresh failed${when}.`,
      tone: 'warning',
      sources: [],
    };
  }
  if (owner.status === 'service-unavailable') {
    // A ledger-only owner arrives as `service-unavailable` (no live read was
    // made): its recorded evidence is past evidence, not a read failure.
    if (owner.unavailableReason === 'no-open-session') {
      return {
        text: hasData
          ? 'No open session to read this account’s usage from; showing the last recorded limit evidence.'
          : 'No open session to read this account’s usage from.',
        tone: 'neutral',
        sources: [],
      };
    }
    if (hasData) {
      return {
        text: 'No live usage read; showing the last recorded limit evidence.',
        tone: 'neutral',
        sources: [],
      };
    }
  }
  const sentence = STATUS_SENTENCES[owner.status];
  if (sentence === undefined || hasData) return null;
  return { text: `${owner.status} · ${sentence}`, tone: 'neutral', sources: [] };
}

function buildWindowRow(
  window: PlanLimitWindow,
  owner: PlanLimitOwnerSnapshot,
  now: number,
  time: LocalTimeOptions,
): WindowRowView {
  const state = classifyWindow(window, {
    now,
    nearLimitPercent: NEAR_LIMIT_PERCENT,
    freshnessMs: FRESHNESS_MS,
    status: owner.status,
  });
  const percent = usedPercent(window.used);
  const showValue = percent !== undefined && state !== 'reset-usage-unknown';
  const at = (instant: number) => formatLocalWithRelative(instant, now, time);

  let limitLine: string | null = null;
  let resetLines: string[] = [];
  let note: string | null = null;
  if (state === 'limit-reached') {
    const resetsAt = activeWindowExhaustion(window, now)?.resetsAt;
    limitLine =
      resetsAt !== undefined
        ? `Limit reached — resets ${at(resetsAt)}`
        : 'Limit reached — reset unknown';
  } else if (state === 'reset-usage-unknown') {
    const passage = resetPassage(window, now);
    if (passage !== undefined) {
      resetLines = [
        `Reset ${formatLocalAbsolute(passage.passedAt, now, time)} (${formatRelative(passage.passedAt, now)}) came after the last observation (${formatLocalAbsolute(passage.lastObservedAt, now, time)}): current usage unknown.`,
        passage.nextResetAt !== undefined
          ? `Next reset ${at(passage.nextResetAt)}`
          : 'Next reset unknown',
      ];
    }
  } else {
    resetLines = [resetText(window.resetsAt, now, time)];
    if (state === 'aged') {
      note = `${owner.status === 'stale' ? 'cached, ' : ''}observed ${formatRelative(windowObservedAt(window), now)}`;
    } else if (state === 'not-confirmed') {
      note = 'last reset unknown: freshness cannot be confirmed';
    }
  }

  const estimated = activeEstimatedExhaustion(window, now);
  return {
    key: window.key,
    name: window.label,
    chip: STATE_CHIPS[state],
    percent: showValue && percent !== undefined ? percent : null,
    barTone:
      state === 'limit-reached'
        ? 'error'
        : state === 'near-limit'
          ? 'warning'
          : 'neutral',
    valueText: showValue ? `${formatUsed(window.used)} used` : 'Used: unknown',
    limitLine,
    resetLines,
    note,
    estimateNote:
      state !== 'limit-reached' && estimated !== undefined
        ? `Estimated limit hit (unconfirmed, informational) · ${resetPhrase(estimated.resetsAt, now, time)}`
        : null,
    sources: sourceChips(window),
  };
}

/** "resets <time> · in …", "reset passed <time> · … ago" or "reset unknown". */
function resetPhrase(
  resetsAt: number | undefined,
  now: number,
  time: LocalTimeOptions,
): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) {
    return 'reset unknown';
  }
  const when = formatLocalWithRelative(resetsAt, now, time);
  return resetsAt <= now ? `reset passed ${when}` : `resets ${when}`;
}

/** `resetPhrase` as the leading words of a line. */
function resetText(
  resetsAt: number | undefined,
  now: number,
  time: LocalTimeOptions,
): string {
  const phrase = resetPhrase(resetsAt, now, time);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function sourceChip(source: PlanLimitSource, prefix = ''): SourceChipView {
  return {
    text: `${prefix}${PLAN_LIMIT_SOURCE_LABELS[source]}`,
    unofficial: source === 'provider-unofficial' || source === 'estimated',
  };
}

/** One chip when every claim shares a source, else field-prefixed chips (§1). */
function sourceChips(window: PlanLimitWindow): SourceChipView[] {
  const groups = windowFieldSources(window);
  if (groups.length === 1) return [sourceChip(groups[0].source)];
  return groups.map(({ source, fields }) =>
    sourceChip(source, `${fields.join(' · ')} `),
  );
}

function evidenceNotice(
  evidence: OwnerLimitEvidence,
  now: number,
  time: LocalTimeOptions,
): NoticeView {
  const scope = evidence.modelScope ? ` (${evidence.modelScope})` : '';
  const hit = formatLocalAbsolute(evidence.observedAt, now, time);
  const sources = [sourceChip(evidence.source)];
  if (evidence.source === 'estimated') {
    return {
      text: `Estimated limit hit${scope} ${hit} (unconfirmed, informational) · window unknown · ${resetPhrase(evidence.resetsAt, now, time)}`,
      tone: 'neutral',
      sources,
    };
  }
  if (isActiveLimitEvidence(evidence, now)) {
    return {
      text: `Limit hit${scope} ${hit} · window unknown · ${resetPhrase(evidence.resetsAt, now, time)}`,
      tone: 'warning',
      sources,
    };
  }
  // Expired: only evidence with a known, passed reset reaches here.
  return {
    text: `Limit hit${scope} ${hit} · window unknown · ${resetPhrase(evidence.resetsAt, now, time)} · expired`,
    tone: 'neutral',
    sources,
  };
}
