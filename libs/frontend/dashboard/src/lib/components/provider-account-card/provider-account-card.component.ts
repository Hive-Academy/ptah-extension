/**
 * Dashboard provider account card (TASK_2026_596, Component 16; design §4;
 * relaid out as a provider list in TASK_2026_631).
 *
 * One full-width row per quota owner in the shared `PlanLimitsStore`
 * snapshot, the selected provider's owner first. Each row names every plan
 * window with its used value (never a fabricated 0), its reset as absolute +
 * relative time, its state as a word and its per-field sources; owner-level
 * limit evidence and an active cooldown are separate notices below the row.
 * The Codex activity block is kept as it was.
 *
 * The card is its own Dashboard section (heading + list), placed by
 * `DashboardGridComponent` above Session Analytics; it does not depend on
 * the analytics date range. `ProviderAccountRowComponent` (same folder)
 * presents each row on one grid shared by every provider — identity |
 * windows area | refresh — adapting to the width each row itself has (a
 * container query on its `li`, never the viewport). A row without windows
 * shows one status line in the windows area, which may end with an inline
 * action wired only to navigation that already exists (`AppStateManager`).
 * Every row carries a decorative per-provider accent (left border + mark
 * tint, `provider-accent.ts`); the provider name always stays in text.
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
import {
  AppStateManager,
  AuthStateService,
  PlanLimitsStore,
} from '@ptah-extension/core';
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
  type PlanLocalUsage,
  type PlanLimitsSnapshot,
  type PlanWindowState,
  type ProviderAccountUsageStatus,
} from '@ptah-extension/shared';
import { ProviderAccountRowComponent } from './provider-account-row.component';

export type Tone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

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
  /**
   * Bar fill tone. `neutral` (the pre-redesign fill, now the muted 45% tier
   * from revise-2 M1) marks readings whose freshness or provenance is not
   * confirmed — aged, estimate-only, not-confirmed — so a stale high percent
   * never reads as healthy; only a fresh, confirmed window is `success`
   * (revise-1 S1).
   */
  readonly barTone: Tone;
  readonly valueText: string;
  readonly isPercent: boolean;
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

export interface LocalUsageView {
  readonly label: string;
  readonly value: string;
  /** The CLI's exact aggregation range, shown in the stat's tooltip. */
  readonly range: string | null;
  /**
   * "last 30 days" derived from the range; the raw string when the range
   * does not parse (revise-2 minor 6).
   */
  readonly rangeLabel: string | null;
  /** States what the figure is, and that it is not a plan percentage. */
  readonly note: string;
}

/**
 * One inline action on a compact row (revise-2 item 7), wired only to
 * navigation that already exists in the webview: `open-session` goes to the
 * chat surface (where a session with the provider is opened, so its usage
 * can be read), `add-key` opens Settings on the Providers tab focused on
 * this provider.
 */
export interface RowActionView {
  readonly kind: 'open-session' | 'add-key';
  readonly label: string;
  readonly providerId: string;
}

export interface OwnerSectionView {
  readonly key: string;
  readonly providerId: string;
  readonly label: string;
  readonly subtitle: string;
  readonly statusChip: StateChipView | null;
  readonly noUsageSource: boolean;
  readonly statusNotice: NoticeView | null;
  /** Inline action for a compact row, when one exists (revise-2 item 7). */
  readonly action: RowActionView | null;
  readonly windows: readonly WindowRowView[];
  readonly localUsage: LocalUsageView | null;
  readonly evidence: readonly NoticeView[];
  readonly cooldown: string | null;
  readonly activity: PlanLimitOwnerSnapshot['activity'] | null;
}

/** Bar fill tone per window state; every state not listed is neutral. */
const BAR_TONES: Readonly<Partial<Record<PlanWindowState, Tone>>> = {
  'limit-reached': 'error',
  'near-limit': 'warning',
  ok: 'success',
};

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
  imports: [ProviderAccountRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    // TASK_2026_631: the auto-fit card grid became a vertical list of rows.
    // Each `li` is its own inline-size container, so the row component (not
    // the viewport) adapts to the width it itself has; the row-local layout
    // lives in `ProviderAccountRowComponent`.
    `
      :host {
        display: block;
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .row {
        container-type: inline-size;
        container-name: row;
      }
    `,
  ],
  template: `
    <section
      class="surface-1 flex flex-col gap-3 rounded-xl p-5"
      aria-labelledby="provider-accounts-heading"
      data-testid="dashboard-section-provider-accounts"
    >
      <div>
        <h3 id="provider-accounts-heading" class="text-base font-semibold">
          Provider accounts &amp; plan limits
        </h3>
        <p class="mt-0.5 text-xs text-base-content-muted">
          One row per quota owner. The tick on each bar marks
          {{ nearLimitPercent }}% (near limit); bars highlight a reached limit.
        </p>
      </div>
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
        @if (list.length === 0) {
          <section class="surface-2 rounded-lg p-3" aria-label="Account usage">
            <div class="flex items-center justify-between gap-3">
              <h5 class="font-medium text-sm">Account usage</h5>
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
              <span
                class="loading loading-spinner loading-xs mt-3"
                aria-label="Loading account usage"
              ></span>
            } @else {
              <p
                class="text-xs text-base-content-muted mt-3"
                data-testid="usage-unavailable"
              >
                Account usage unavailable
              </p>
            }
          </section>
        } @else {
          <ul class="rows">
            @for (section of list; track section.key) {
              <li class="row">
                <ptah-provider-account-row
                  [section]="section"
                  [refreshing]="loading()"
                  (refresh)="refresh()"
                  (actionClick)="onRowAction($event)"
                />
              </li>
            }
          </ul>
        }
      } @else if (loading()) {
        <span
          class="loading loading-spinner loading-xs"
          aria-label="Loading account usage"
        ></span>
      }
    </section>
  `,
})
export class ProviderAccountCardComponent {
  private readonly planLimits = inject(PlanLimitsStore);
  private readonly auth = inject(AuthStateService);
  /** Compact-row inline actions navigate through existing app-state routes. */
  private readonly appState = inject(AppStateManager);

  /** Explicit zone and zone-name locale (carry-forward from Batch 3). */
  private readonly timeOptions: LocalTimeOptions = {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneNameLocale: inject(LOCALE_ID),
  };

  protected readonly loading = this.planLimits.loading;
  /** The near-limit threshold each row's bar tick marks. */
  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;

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

  /**
   * Compact-row inline actions (revise-2 item 7) — existing navigation
   * only: "Go to chat" goes to chat, where a session with the provider
   * opens and its usage can be read; "Add key" opens Settings on the
   * Providers tab focused on this provider.
   */
  onRowAction(action: RowActionView): void {
    if (action.kind === 'open-session') {
      this.appState.setCurrentView('chat');
    } else {
      this.appState.openSettingsTab('providers', action.providerId);
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
      if (
        Number.isFinite(instant) &&
        (newest === undefined || instant > newest)
      ) {
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
  const hasData =
    owner.windows.length > 0 ||
    owner.ownerEvidence.length > 0 ||
    owner.localUsage !== undefined;
  const windows = owner.windows.map((w) => buildWindowRow(w, owner, now, time));
  return {
    key: owner.owner.key,
    providerId: owner.owner.providerId,
    // The generic label plus the key suffix ("Claude account · a1b2") so two
    // owners of one provider are told apart; never the full key.
    label: ownerDisplayLabel(owner.owner),
    subtitle: subtitleFor(owner),
    statusChip: statusChip(owner.status, owner.owner.providerId),
    noUsageSource: owner.status === 'no-usage-source',
    statusNotice: statusNotice(owner, hasData, now, time),
    action: compactRowAction(owner, hasData),
    windows,
    localUsage: owner.localUsage ? localUsageView(owner.localUsage) : null,
    evidence: owner.ownerEvidence.map((e) => evidenceNotice(e, now, time)),
    cooldown:
      owner.cooldown !== undefined && owner.cooldown.until > now
        ? `Retrying after ${formatLocalAbsolute(owner.cooldown.until, now, time)} (${formatRelative(owner.cooldown.until, now)}) · a retry delay, not a plan reset`
        : null,
    activity: owner.activity ?? null,
  };
}

/**
 * The prototype's inline actions on compact rows (revise-2 item 7), wired
 * only to navigation that already exists in the webview: "Go to chat"
 * (the no-open-session reason) goes to the chat surface, "Add key" (Ollama
 * Cloud's missing key) opens Settings on the Providers tab. "How to
 * refresh" (the Antigravity reason) has no existing handler anywhere in
 * the webview code, so it is deliberately absent — see the revise-2
 * report's Clarifications Needed.
 */
function compactRowAction(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
): RowActionView | null {
  if (owner.windows.length > 0) return null;
  if (
    owner.status === 'service-unavailable' &&
    owner.unavailableReason === 'no-open-session'
  ) {
    return {
      kind: 'open-session',
      label: 'Go to chat',
      providerId: owner.owner.providerId,
    };
  }
  if (
    !hasData &&
    owner.status === 'unsupported-config' &&
    owner.owner.providerId === 'ollama-cloud'
  ) {
    return {
      kind: 'add-key',
      label: 'Add key',
      providerId: owner.owner.providerId,
    };
  }
  return null;
}

function localUsageView(usage: PlanLocalUsage): LocalUsageView {
  // A request-metered source (Ollama Cloud) has no token or cost figure.
  const requests = usage.requests;
  return {
    label: usage.label,
    value:
      requests !== undefined
        ? `${requests.toLocaleString()} ${requests === 1 ? 'request' : 'requests'}`
        : `${usage.tokens.toLocaleString()} tokens · $${usage.estimatedCostUsd.toFixed(2)}`,
    range: usage.range ?? null,
    rangeLabel: localRangeLabel(usage.range),
    // The provenance decides the note: a provider API counts the whole
    // account, a local CLI only what it recorded on this machine.
    note:
      usage.source === 'provider-api'
        ? requests !== undefined
          ? 'Account request count from the provider · no plan percentage or reset'
          : 'Account usage from the provider · not a plan percentage or reset'
        : 'Local CLI accounting · not a plan percentage or reset',
  };
}

/**
 * "last 30 days" derived from the CLI's own "start – end" ISO range (the
 * reader joins with an en dash; a hyphen or em dash is accepted too); the
 * exact range string stays available in the stat's tooltip (revise-2
 * minor 6). A range that does not parse, or runs backwards, falls back to
 * the raw string, as does a free-form range string the CLI sends verbatim.
 */
function localRangeLabel(range: string | undefined): string | null {
  if (range === undefined) return null;
  const parts = range.split(/\s[-–—]\s/);
  if (parts.length !== 2) return range;
  const start = Date.parse((parts[0] ?? '').trim());
  const end = Date.parse((parts[1] ?? '').trim());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return range;
  }
  const days = Math.round((end - start) / 86_400_000);
  if (days < 1) return range;
  return days === 1 ? 'last 1 day' : `last ${days} days`;
}

function subtitleFor(owner: PlanLimitOwnerSnapshot): string {
  if (owner.owner.identityKind === 'unknown') {
    const reasons: Record<string, string> = {
      'missing-account-email': 'Signed in · account email not shared',
      'codex-not-read': 'Account not read yet',
      'unrouted-daemon': 'Local Ollama daemon',
      'missing-api-key': 'No API key configured',
      'unresolved-route': 'Account identity unavailable',
    };
    return reasons[owner.unknownReason ?? ''] ?? 'Account identity unavailable';
  }
  const base =
    owner.activity !== undefined
      ? 'Subscription quota and account activity'
      : 'Subscription quota';
  const plan = owner.account?.planType;
  return plan ? `${base} · Plan: ${plan}` : base;
}

/**
 * Short, human-readable status labels; diagnostic codes stay out of the UI.
 * Every chip leads with a glyph (revise-2 M3) — ○ not configured/unread,
 * ◷ cached, – no plan limits (API key), ! CLI trouble.
 */
function statusChip(
  status: ProviderAccountUsageStatus,
  providerId: string,
): StateChipView | null {
  switch (status) {
    case 'available':
      return null;
    case 'no-usage-source':
      return { glyph: '○', text: 'No usage source', tone: 'neutral' };
    case 'stale':
      return { glyph: '◷', text: 'Cached data', tone: 'warning' };
    case 'unsupported-auth':
      return {
        glyph: '–',
        text:
          providerId === 'ollama-cloud'
            ? 'API key rejected'
            : providerId === 'antigravity'
              ? 'Sign-in rejected'
              : providerId === 'opencode'
                ? 'Sign-in expired'
                : 'API key — no plan limits',
        tone: 'neutral',
      };
    case 'unsupported-config':
      return {
        glyph: '○',
        text:
          providerId === 'ollama-cloud'
            ? 'No API key configured'
            : 'No usage source',
        tone: 'neutral',
      };
    case 'provider-unsupported':
      return { glyph: '○', text: 'No usage source', tone: 'neutral' };
    case 'cli-unavailable':
      return { glyph: '!', text: 'CLI unavailable', tone: 'warning' };
    case 'cli-version-unsupported':
      return { glyph: '!', text: 'CLI update needed', tone: 'warning' };
    case 'service-unavailable':
      return { glyph: '○', text: 'Usage unavailable', tone: 'neutral' };
  }
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
  const text =
    owner.status === 'service-unavailable'
      ? serviceUnavailableText(owner, hasData)
      : null;
  if (text !== null) return neutralNotice(text);
  if (
    owner.status === 'no-usage-source' &&
    owner.localUsage &&
    owner.windows.length === 0 &&
    owner.ownerEvidence.length === 0
  ) {
    return neutralNotice('Local usage only');
  }
  if (hasData) return null;
  const noDataText = noDataStatusText(owner);
  return noDataText === undefined ? null : neutralNotice(noDataText);
}

function neutralNotice(text: string): NoticeView {
  return { text, tone: 'neutral', sources: [] };
}

/**
 * A ledger-only owner arrives as `service-unavailable` (no live read was
 * made): its recorded evidence is past evidence, not a read failure.
 */
function serviceUnavailableText(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
): string | null {
  if (owner.unavailableReason === 'no-open-session') {
    return hasData
      ? 'No open session to read this account’s usage from; showing the last recorded limit evidence.'
      : 'No open session to read this account’s usage from.';
  }
  if (hasData) {
    return 'No live usage read; showing the last recorded limit evidence.';
  }
  if (owner.owner.providerId === 'antigravity') {
    return 'Open Antigravity to read local quota';
  }
  return null;
}

/** The compact-row sentence for an owner with no windows, evidence or local usage. */
function noDataStatusText(owner: PlanLimitOwnerSnapshot): string | undefined {
  const providerId = owner.owner.providerId;
  switch (owner.status) {
    case 'available':
      return 'No plan limits reported';
    case 'unsupported-auth':
      if (providerId === 'ollama-cloud') {
        return 'API key rejected — check the key';
      }
      // The Antigravity keyring login was refused by Google (revoked or
      // expired): an authentication problem, not a missing local app.
      if (providerId === 'antigravity') {
        return 'Antigravity sign-in rejected — sign in to Antigravity again';
      }
      // OpenCode's stored login was rejected (401) or has expired.
      if (providerId === 'opencode') {
        return 'OpenCode sign-in expired — sign in to OpenCode again';
      }
      return 'No plan limits (API key)';
    case 'unsupported-config':
      if (providerId === 'ollama-cloud') return 'No API key configured';
      break;
    case 'no-usage-source':
      return providerId === 'opencode'
        ? 'Sign in to OpenCode Go'
        : 'No usage source available';
  }
  return STATUS_SENTENCES[owner.status];
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
    // Aged, estimate-only and not-confirmed readings are not room: they keep
    // the neutral fill so a stale 97% never reads as healthy (revise-1 S1;
    // the fill itself is the muted tier since revise-2 M1). Only a fresh,
    // confirmed window is green.
    barTone: BAR_TONES[state] ?? 'neutral',
    valueText: showValue ? `${formatUsed(window.used)} used` : 'Used: unknown',
    isPercent: window.used?.kind === 'percent',
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
  if (resetsAt !== undefined && Number.isFinite(resetsAt) && resetsAt > now) {
    return `Resets ${formatRelative(resetsAt, now)} (${formatLocalAbsolute(resetsAt, now, time)})`;
  }
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
