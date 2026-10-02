import {
  ChangeDetectionStrategy, Component, NgZone, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { CheckCircle, LucideAngularModule } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import type { ConnectionCheckFailureReason, ConnectionCheckRecord } from '@ptah-extension/shared';
import type { ProviderConnectionCardStatus } from '../provider-connection-card.state';
import type { UsedBy } from '../connection-usage';
import type { ConnectionKind } from './connection-kind';
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';

type StatusTone = 'success' | 'warning' | 'error' | 'neutral';

/**
 * The card's status plus `check-failed`: the route read behind "Check connection" failed. The card
 * shows that as "Check unavailable"; the drawer, where the user just asked for a check, says it failed.
 */
export type OverviewConnectionStatus = ProviderConnectionCardStatus | 'check-failed';

export interface OverviewStatus {
  readonly label: string;
  readonly tone: StatusTone;
}

/**
 * The connection's status line. Same rules as the card's state table
 * (`provider-connection-card.component.ts` `resolvedState`): never "Connected" without positive probe
 * evidence; `unknown` → Not checked, `skipped` → Check unavailable. "verified" is added only when the
 * route's probe positively confirmed this connection. The latency of an explicit check is added by
 * `overviewCheckedStatus`, from the recorded check, never from this route verdict.
 */
export function overviewStatus(
  status: OverviewConnectionStatus,
  positiveProbeEvidence: boolean | null,
  isActive: boolean,
  kind: ConnectionKind,
): OverviewStatus {
  const confirmed = positiveProbeEvidence !== false;
  switch (status) {
    case 'active':
      return confirmed ? { label: 'Active for main agent', tone: 'success' } : { label: 'Not checked', tone: 'neutral' };
    case 'connected':
      if (!confirmed) return { label: 'Not checked', tone: 'neutral' };
      if (isActive) return { label: 'Active for main agent', tone: 'success' };
      return { label: positiveProbeEvidence === true ? 'Connected & verified' : 'Connected', tone: 'success' };
    case 'reachable':
      return positiveProbeEvidence === true ? { label: 'Connected', tone: 'success' } : { label: 'Not checked', tone: 'neutral' };
    case 'needs-key': return { label: 'Needs API key', tone: 'warning' };
    case 'unreachable': return { label: 'Unreachable', tone: 'warning' };
    case 'unauthenticated':
      return { label: kind === 'api-key' || kind === 'custom' ? 'Credential rejected' : 'Sign-in required', tone: 'error' };
    case 'not-installed': return { label: 'Not installed', tone: 'neutral' };
    case 'missing':
    case 'not-configured': return { label: 'Not configured', tone: 'neutral' };
    case 'checking': return { label: 'Checking…', tone: 'neutral' };
    // Fixed copy only: the host's error text never reaches the view (plan §5).
    case 'check-failed': return { label: 'Check failed', tone: 'error' };
    case 'skipped':
    case 'check-unavailable': return { label: 'Check unavailable', tone: 'neutral' };
    default: return { label: 'Not checked', tone: 'neutral' };
  }
}

/**
 * Route statuses a recorded verified check may confirm: a success line, or one that only says the route
 * has no verdict. A warning or error the current route reports is never overridden by an earlier check.
 */
const CHECK_CONFIRMABLE: ReadonlySet<OverviewConnectionStatus> = new Set([
  'active', 'connected', 'reachable', 'not-checked', 'unknown', 'skipped', 'check-unavailable',
]);

/** Fixed copy per recorded failure reason (`ConnectionCheckRecord.reason`). No host text is ever shown. */
const CHECK_FAILURE_COPY: Readonly<Record<ConnectionCheckFailureReason, string>> = {
  'credential-rejected': 'The provider rejected the stored key.',
  'permission-denied': 'This account cannot use the requested service or model.',
  unreachable: 'Could not reach the provider.',
  timeout: 'The provider did not answer in time.',
  'rate-limited': 'The provider is rate-limiting requests.',
  'quota-exhausted': 'This account has no available quota for the check.',
  'model-unavailable': 'The model used for the check is not available on this connection.',
  cancelled: 'The check was cancelled.',
  unclassified: 'The check failed.',
  'no-stored-credential': 'No key is stored for this connection.',
  'stored-credential-mismatch': 'The stored key does not match this endpoint.',
  'signed-out': 'Not signed in. Sign in again from the Credentials tab.',
  'not-installed': 'The CLI was not found on this machine.',
};

/** The record is shown only while the line it describes is not a live state or a route warning. */
export function overviewCheckApplies(status: OverviewConnectionStatus, check: ConnectionCheckRecord | null): boolean {
  if (!check) return false;
  return check.status === 'verified' ? CHECK_CONFIRMABLE.has(status) : status !== 'checking' && status !== 'check-failed';
}

/**
 * The status line with the last recorded check (`route.providers[].lastCheck`) applied, when
 * `overviewCheckApplies`. A failed record reads "Check failed" (D15: never verified after a failure). A
 * verified one reads "Connected & verified" (or keeps "Active for main agent") with its latency, as in the
 * prototype ("Connected & verified (92ms)"). No latency is shown when none was timed: never "0ms".
 */
export function overviewCheckedStatus(base: OverviewStatus, status: OverviewConnectionStatus,
  check: ConnectionCheckRecord | null): OverviewStatus {
  if (!check || !overviewCheckApplies(status, check)) return base;
  if (check.status !== 'verified') return { label: 'Check failed', tone: 'error' };
  const label = status === 'active' || base.label === 'Active for main agent' ? 'Active for main agent' : 'Connected & verified';
  const latency = check.latencyMs;
  return { label: typeof latency === 'number' && Number.isFinite(latency) && latency >= 1 ? `${label} (${Math.round(latency)}ms)` : label, tone: 'success' };
}

/** The check's age for the line under the status; null for an unreadable time. */
export function checkedAgo(checkedAt: string, now: number): string | null {
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Checked just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `Checked ${hours} h ago` : `Checked on ${new Date(at).toLocaleDateString()}`;
}

/** The relative time is refreshed this often while a record is shown (one timer, only while the tab shows one). */
const AGE_REFRESH_MS = 30000;

const DOT: Readonly<Record<StatusTone, string>> = {
  success: 'bg-success', warning: 'bg-warning', error: 'bg-error', neutral: 'bg-base-content-muted',
};

const KIND_DETAIL: Readonly<Record<UsedBy['kind'], string>> = {
  'main-agent': 'New main-agent requests',
  'background-role': 'Background role',
  'ptah-cli': 'Runs with this connection',
  'system-cli': 'Uses this sign-in',
};

/** Right-hand badge of an own-provider row ("Active (Judge)" in the prototype). */
export function usedByBadge(entry: UsedBy): string {
  switch (entry.kind) {
    case 'main-agent': return 'Active (Main agent)';
    case 'ptah-cli': return 'Active (Ptah CLI)';
    default: return `Active (${entry.label.replace(/ lane$/, '')})`;
  }
}

/**
 * Drawer tab "Overview & Used By" (design-spec §2.3, prototype drawer Tab 1): status with Check
 * connection, authentication details, and where this connection is used. Status colour is carried by
 * the dot and badge surfaces only; the text stays `text-base-content` (deviation 6).
 */
@Component({
  selector: 'ptah-connection-overview-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsBusyDisabledDirective, LucideAngularModule],
  template: `
    <div class="space-y-4 text-sm" data-testid="connection-overview">
      <div class="rounded border border-base-300 bg-base-200 p-3" [attr.aria-busy]="loading()">
        <div class="flex items-center justify-between gap-3">
          <!-- Polite live region: a finished check (its result and latency) is announced. -->
          <div class="min-w-0" aria-live="polite">
            <span class="block text-xs font-medium text-base-content-muted">Connection status</span>
            @if (loading()) {
              <span class="skeleton mt-1 block h-4 w-40" data-testid="connection-status-skeleton"></span>
            } @else {
              <span class="mt-0.5 flex items-center gap-1.5 font-medium text-base-content" data-testid="connection-status">
                <span [class]="dotClass()" aria-hidden="true"></span>
                {{ statusView().label }}
              </span>
              @if (checkDetail(); as detail) {
                <span class="mt-0.5 block text-xs text-base-content-muted" [attr.title]="checkedAtTitle()"
                  data-testid="connection-last-checked">{{ detail }}</span>
              }
            }
          </div>
          <button type="button" class="btn btn-outline btn-sm shrink-0 gap-1.5" (click)="checkConnectionRequested.emit()"
            [ptahBusyDisabled]="loading() || checking() || saving()" data-testid="connection-check">
            <lucide-angular [img]="CheckIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ checking() ? 'Checking…' : status() === 'check-failed' ? 'Retry check' : 'Check connection' }}
          </button>
        </div>
      </div>

      <dl class="space-y-1.5 rounded border border-base-300 bg-base-200/50 p-3 text-xs">
        <div class="flex items-center justify-between gap-3">
          <dt class="shrink-0 text-base-content-muted">Authentication mode</dt>
          <dd class="text-right font-medium text-base-content" data-testid="connection-auth-mode">{{ authModeLabel() }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="shrink-0 text-base-content-muted">Credential storage</dt>
          <dd class="text-right text-base-content" data-testid="connection-credential-storage">
            <!-- The masked hint is display only: not selectable, never offered to a copy action. -->
            @if (keyHint(); as hint) {
              <span class="select-none font-mono" data-testid="connection-key-hint">{{ hint }}</span> (stored on this machine)
            } @else {
              {{ credentialLabel() }}
            }
          </dd>
        </div>
      </dl>

      <section class="space-y-2" aria-labelledby="connection-used-by-heading">
        <div class="flex items-center justify-between gap-3">
          <h3 id="connection-used-by-heading" class="text-sm font-semibold text-base-content">Used by in workspace</h3>
          @if (usageComplete() && !usageError()) {
            <span class="text-xs text-base-content-muted" data-testid="connection-used-by-count">{{ countLabel() }}</span>
          }
        </div>
        @if (usageError()) {
          <div role="alert" class="space-y-2 rounded border border-base-300 p-3 text-xs" data-testid="connection-used-by-error">
            <p class="text-base-content">Could not load where this connection is used.</p>
            <button type="button" class="btn btn-outline btn-xs" (click)="retryUsageRequested.emit()">Retry</button>
          </div>
        } @else if (!usageComplete()) {
          <p class="rounded border border-base-300 p-3 text-xs text-base-content-muted" aria-busy="true"
            role="status" data-testid="connection-used-by-loading">Loading…</p>
        } @else if (usedBy().length === 0) {
          <div class="rounded border border-dashed border-base-300 bg-base-200/50 p-4 text-center" data-testid="connection-used-by-empty">
            <p class="text-xs font-semibold text-base-content">Not used yet</p>
            <p class="mt-0.5 text-xs text-base-content-muted">No active agents or lanes are currently routed through this provider.</p>
          </div>
        } @else {
          <ul class="space-y-1.5" data-testid="connection-used-by">
            @for (entry of usedBy(); track entry.id) {
              <li class="flex items-center justify-between gap-3 rounded border border-base-300 bg-base-200 px-3 py-2.5"
                [attr.data-used-by]="entry.id">
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-base-content">{{ entry.label }}</p>
                  <p class="text-xs text-base-content-muted">{{ detail(entry) }}</p>
                </div>
                @if (entry.followsMain) {
                  <button type="button"
                    class="link link-hover inline-flex shrink-0 items-center gap-1 text-xs text-base-content"
                    [attr.aria-label]="entry.label + ' follows the main agent. Open it in Agent Orchestration'"
                    (click)="openRole(entry)" data-testid="connection-follows-main">
                    Follows main agent <span class="text-base-content-muted" aria-hidden="true">→</span>
                  </button>
                } @else {
                  <span class="badge badge-sm shrink-0 border-success/40 bg-success/10 font-medium text-base-content"
                    data-testid="connection-used-by-badge">{{ badge(entry) }}</span>
                }
              </li>
            }
          </ul>
        }
      </section>
    </div>
  `,
})
export class OverviewTabComponent {
  private readonly appState = inject(AppStateManager);
  protected readonly CheckIcon = CheckCircle;
  readonly status = input<OverviewConnectionStatus>('not-checked');
  readonly positiveProbeEvidence = input<boolean | null>(null);
  readonly isActive = input(false);
  readonly kind = input.required<ConnectionKind>();
  readonly authModeLabel = input.required<string>();
  readonly credentialLabel = input.required<string>();
  /** The stored key's masked hint; when set, the Credential storage row shows it instead of `credentialLabel`. */
  readonly keyHint = input<string | null>(null);
  /** This connection's last recorded check (`route.providers[].lastCheck`); null when none ran this session. */
  readonly lastCheck = input<ConnectionCheckRecord | null>(null);
  /** No route has been read yet: the status block shows a skeleton. A re-check is `checking`, not this. */
  readonly loading = input(false);
  /** A connection check is running; the status line reads "Checking…". */
  readonly checking = input(false);
  /** A settings save is in flight: no check starts under it. */
  readonly saving = input(false);
  readonly usedBy = input<readonly UsedBy[]>([]);
  /** `connectionUsage().complete`: only then may an empty list read "Not used yet". */
  readonly usageComplete = input(false);
  /** A usage source failed to load. */
  readonly usageError = input(false);
  readonly checkConnectionRequested = output<void>();
  readonly retryUsageRequested = output<void>();

  /** "Now" for the check's age; ticks only while a record is shown (see the constructor). */
  private readonly now = signal(Date.now());
  /** The record, when it describes the status line shown (`overviewCheckApplies`). */
  private readonly shownCheck = computed(() => {
    const check = this.lastCheck();
    return check && overviewCheckApplies(this.status(), check) ? check : null;
  });
  protected readonly statusView = computed(() => overviewCheckedStatus(
    overviewStatus(this.status(), this.positiveProbeEvidence(), this.isActive(), this.kind()), this.status(), this.shownCheck()));
  /** Under the status: a failed check's fixed reason, then when the check ran. */
  protected readonly checkDetail = computed(() => {
    const check = this.shownCheck();
    if (!check) return null;
    const reason = check.status === 'verified' ? null
      : CHECK_FAILURE_COPY[check.reason && Object.hasOwn(CHECK_FAILURE_COPY, check.reason) ? check.reason : 'unclassified'];
    return [reason, checkedAgo(check.checkedAt, this.now())].filter(Boolean).join(' ') || null;
  });
  protected readonly checkedAtTitle = computed(() => {
    const at = Date.parse(this.shownCheck()?.checkedAt ?? '');
    return Number.isNaN(at) ? null : `Last checked ${new Date(at).toLocaleString()}`;
  });
  protected readonly dotClass = computed(() => `h-2 w-2 shrink-0 rounded-full ${DOT[this.statusView().tone]}`);
  protected readonly countLabel = computed(() => {
    const count = this.usedBy().length;
    return `${count} active ${count === 1 ? 'route' : 'routes'}`;
  });

  constructor() {
    // One timer for the check's age, only while a record is shown; released when it goes or the tab is destroyed.
    // Outside the zone (as `streaming-quotes.component.ts`), so it never keeps the app unstable; the signal write
    // still schedules the render.
    const zone = inject(NgZone);
    effect((onCleanup) => {
      if (!this.shownCheck()) return;
      untracked(() => this.now.set(Date.now()));
      const timer = zone.runOutsideAngular(() => setInterval(() => this.now.set(Date.now()), AGE_REFRESH_MS));
      onCleanup(() => clearInterval(timer));
    });
  }

  protected detail(entry: UsedBy): string {
    return entry.followsMain ? 'Uses the main agent\'s provider' : KIND_DETAIL[entry.kind];
  }

  protected badge(entry: UsedBy): string {
    return usedByBadge(entry);
  }

  /** "Follows main agent →" opens that role on Agent Orchestration (plan Component 10 routing). */
  protected openRole(entry: UsedBy): void {
    if (entry.kind !== 'background-role' || entry.id === 'main-agent' || entry.id.startsWith('ptah-cli:')) return;
    this.appState.requestSettingsTab({
      tab: 'orchestration',
      section: entry.id as Exclude<UsedBy['id'], 'main-agent' | 'codex-cli' | `ptah-cli:${string}`>,
    });
  }
}
