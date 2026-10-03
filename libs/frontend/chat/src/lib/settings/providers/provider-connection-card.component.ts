import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  type OutputEmitterRef,
} from '@angular/core';
import { LucideAngularModule, AlertTriangle } from 'lucide-angular';
import { NativeCardComponent } from '@ptah-extension/ui';
import type { ConnectionCheckRecord, SettingScope } from '@ptah-extension/shared';
import {
  SettingScopeRowComponent,
  type SettingScopeDisplay,
} from './setting-scope-row.component';
import {
  applyRecordedCheck,
  authModalityBadge,
  authModalityLabel,
  connectionAvatarTone,
  connectionCardSpine,
  connectionCardTone,
  connectionInitials,
  connectionStateCopy,
  connectionStateDot,
  connectionStateLabel,
  KEY_UNREADABLE_TEXT,
  primaryConnectionAction,
  resolveConnectionState,
  type ConnectionCardAction,
  type ProviderConnectionCardStatus,
  type ResolvedConnectionState,
} from './provider-connection-card.state';

interface InlineAction {
  readonly label: string;
  readonly testId: string;
  readonly ariaLabel: string;
  readonly emit: OutputEmitterRef<void>;
}

/**
 * Compact connection card (≤ 80 px; plan :627-636, design-spec §3.3, prototype `.conn-card`).
 *
 * - The whole card is the trigger: a click, Enter or Space on it emits `detailsRequested` (the parent
 *   opens the connection drawer), via `NativeCardComponent`'s `activated`, which ignores clicks that
 *   land on the inline action.
 * - Two rows: avatar, name, provenance and the auth-modality badge; then the status dot and label, at
 *   most ONE inline repair action (the state's primary, `primaryConnectionAction`) and "Used by N". There is no
 *   "Use for main agent" on the face (prototype, Gate V 28): the Main Agent popover changes the main agent.
 * - Every other per-state action lives in the drawer. The state table's one-line copy is the card's
 *   accessible name (with its status) and its tooltip; the drawer's Overview repeats it.
 * - A status that is not a confirmed success is never Connected; colour sits on the dot, avatar,
 *   spine and badges only, text stays `text-base-content` (D13, deviation 6).
 *
 * Every input and output of the pre-compact card is kept. `changeMainProviderRequested`,
 * `manageRequested`, `editConnectionRequested`, `installInstructionsRequested` and
 * `scopeOverrideRequested` are no longer emitted: their actions are in the drawer or on the page
 * (see `batch-24-report.md`, "old card action → new place").
 */
@Component({
  selector: 'ptah-provider-connection-card',
  standalone: true,
  imports: [LucideAngularModule, NativeCardComponent, SettingScopeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-card density="compact" [tone]="cardTone()" [spine]="cardSpine()" [clickable]="true"
      [ariaLabel]="cardAriaLabel()" (activated)="detailsRequested.emit()" [attr.title]="keyUnreadable() ? keyUnreadableText : statusCopy()"
      [attr.data-state]="resolvedState()" data-testid="provider-connection-card">
      <div class="flex flex-col gap-0.5">
        <div class="flex min-h-7 items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <span [class]="avatarClass()" aria-hidden="true" data-testid="card-avatar">{{ initials() }}</span>
            <div class="min-w-0">
              <p class="break-words text-xs font-semibold leading-tight text-base-content" data-testid="provider-name">
                {{ displayName() }}
              </p>
              @if (subtitle(); as text) {
                <p class="break-words text-[10px] leading-tight text-base-content-muted" data-testid="card-subtitle">{{ text }}</p>
              }
            </div>
          </div>
          @if (modalityLabel(); as modality) {
            <span class="badge badge-sm badge-outline shrink-0 whitespace-nowrap border-base-content-muted bg-base-100 text-[10px] font-medium text-base-content"
              data-testid="auth-modality">{{ modality }}</span>
          }
        </div>
        <div class="flex min-h-6 items-center justify-between gap-1.5 text-[11px]">
          <div class="flex min-w-0 flex-wrap items-center gap-x-1">
            <span class="flex items-center gap-1.5 font-medium text-base-content" data-testid="status-badge">
              @if (isBlockedMain()) {
                <lucide-angular [img]="AlertTriangleIcon" class="h-3 w-3" aria-hidden="true" />
                <span data-testid="blocked-main-badge">Main agent · Needs attention ·</span>
              } @else if (keyUnreadable()) {
                <lucide-angular [img]="AlertTriangleIcon" class="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              } @else {
                <span [class]="'h-1.5 w-1.5 shrink-0 rounded-full ' + dotClass()" aria-hidden="true"></span>
              }
              @if (keyUnreadable()) {
                <span data-testid="card-key-unreadable">{{ keyUnreadableText }}</span>
              } @else {
                <span data-testid="status-copy">{{ statusLabel() }}</span>
              }
            </span>
            @if (keyUnreadable()) {
              <!-- M-6: the key's state is unknown, so the repair is a re-read, never "Add API key". -->
              <button type="button" [class]="inlineActionClass" [attr.aria-label]="'Retry reading the stored key for ' + displayName()"
                (click)="keyRetryRequested.emit()" data-testid="card-key-unreadable-retry">Retry</button>
            } @else if (inlineAction(); as action) {
              <button type="button" [class]="inlineActionClass"
                [attr.aria-label]="action.ariaLabel" (click)="action.emit.emit()" [attr.data-testid]="action.testId">
                {{ action.label }}
              </button>
            }
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            @if (hasScope()) {
              <ptah-setting-scope-row [scope]="scope()" [hasOverride]="hasOverride()" [supportedTargets]="supportedTargets()"
                [workspaceName]="workspaceName()" [workspaceCrossApp]="workspaceCrossApp()" [fieldName]="displayName()"
                (clearRequested)="scopeClearRequested.emit()" (useGlobalRequested)="scopeUseGlobalRequested.emit()"
                (copyGlobalRequested)="scopeCopyGlobalRequested.emit()" data-testid="card-scope-wrapper" />
            }
            @if (usedByCount() !== null) {
              <span class="font-mono text-[10px] text-base-content-muted" data-testid="used-by-count">Used by {{ usedByCount() }}</span>
            }
          </div>
        </div>
      </div>
    </ptah-native-card>
  `,
})
export class ProviderConnectionCardComponent {
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly keyUnreadableText = KEY_UNREADABLE_TEXT;
  protected readonly inlineActionClass =
    'btn btn-link btn-xs h-6 min-h-6 !px-0 text-[11px] text-base-content underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

  /** Provider registry or connection identifier (e.g. 'anthropic', 'moonshot', 'claude-cli'). */
  readonly providerId = input<string>('');
  /** Human-readable provider name. Defaults to providerId if empty. */
  readonly providerName = input<string>('');
  /** Auth modality identifier (e.g. 'api-key', 'cli', 'oauth', 'local-native'). */
  readonly authModality = input<string | null>(null);
  /** Preformatted auth modality label; overrides the derived label when set. */
  readonly authModalityText = input<string | null>(null);
  /** Reported or candidate status of this connection. */
  readonly status = input<ProviderConnectionCardStatus>('not-configured');
  /** Explicit probe evidence: required for Connected / Active; `false` downgrades to Not checked. */
  readonly positiveProbeEvidence = input<boolean | null>(null);
  /** This provider route is selected for the main agent. */
  readonly isActive = input<boolean>(false);
  /** The active route is blocked and needs the user. */
  readonly isBlocked = input<boolean>(false);
  /** This connection's last recorded check (`route.providers[].lastCheck`); a newer failed one wins (Batch 53.1). */
  readonly lastCheck = input<ConnectionCheckRecord | null>(null);
  /** When the route's own statuses were probed (`route.probedAt`): a failed check older than that does not win. */
  readonly routeProbedAt = input<string | null>(null);
  /** Kept for API stability: the card always opens the drawer; the drawer gates its own edits. */
  readonly canManage = input<boolean>(true);
  /** CLI name used in the not-installed copy (e.g. 'Claude CLI'). */
  readonly cliName = input<string | null>(null);
  /** "Sign-in required" vs "Credential rejected"; derived from `authModality` when null. */
  readonly unauthenticatedVariant = input<'sign-in' | 'credential-rejected' | null>(null);
  /** Timestamp of the last successful probe (ISO 8601 or formatted string). */
  readonly lastConnectedAt = input<string | null>(null);
  /** Display string for the last connected time (e.g. "2 hours ago"). */
  readonly lastConnectedText = input<string | null>(null);
  /** Display string for the last failed check (e.g. "10 minutes ago"). */
  readonly lastFailedText = input<string | null>(null);
  /** Kept for API stability: the card shows an initials avatar (prototype), not the vendor mark. */
  readonly fallbackMark = input<'Bot' | 'Server' | 'Terminal' | null>(null);
  /** Provenance line under the name (e.g. "Key stored on this machine"). */
  readonly sourceLabel = input<string | null>(null);
  /** Scope of this connection's configuration: a D16 badge when overridden. */
  readonly scope = input<SettingScopeDisplay | null>(null);
  readonly hasOverride = input<boolean>(false);
  readonly supportedTargets = input<readonly SettingScope[]>([]);
  readonly workspaceName = input<string | null>(null);
  readonly workspaceCrossApp = input<boolean>(false);
  /** Consumers using this connection ("Used by N"); null while unknown (hidden, never a guessed 0). */
  readonly usedByCount = input<number | null>(null);
  /**
   * The host could not read this connection's stored key (M-6): the card shows "Could not read the stored key."
   * with Retry (`keyRetryRequested`) instead of its state label and action, so it never asks to add a key.
   */
  readonly keyUnreadable = input<boolean>(false);

  // --- Actions ---
  /** The card itself was activated: open this connection's details (the drawer). */
  readonly detailsRequested = output<void>();
  readonly changeMainProviderRequested = output<void>();
  readonly manageRequested = output<void>();
  readonly addKeyRequested = output<void>();
  readonly signInRequested = output<void>();
  readonly replaceKeyRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly editConnectionRequested = output<void>();
  readonly installInstructionsRequested = output<void>();
  readonly checkAgainRequested = output<void>();
  readonly setupRequested = output<void>();
  readonly checkConnectionRequested = output<void>();
  /** Retry on an unreadable stored key: the parent re-reads the connections. */
  readonly keyRetryRequested = output<void>();

  // --- Scope badge intent forwarding ---
  readonly scopeOverrideRequested = output<void>();
  readonly scopeClearRequested = output<void>();
  readonly scopeUseGlobalRequested = output<void>();
  readonly scopeCopyGlobalRequested = output<void>();

  protected readonly displayName = computed(() => this.providerName() || this.providerId() || 'Provider');
  protected readonly hasScope = computed(() => this.scope() !== null);
  protected readonly modalityLabel = computed(() => this.authModalityText() || authModalityBadge(this.authModality()));
  protected readonly initials = computed(() => connectionInitials(this.displayName()));
  protected readonly avatarClass = computed(() =>
    `flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[11px] font-bold text-base-content ${connectionAvatarTone(this.providerId() || this.displayName())}`);

  readonly resolvedState = computed<ResolvedConnectionState>(() => applyRecordedCheck(
    resolveConnectionState(this.status(), this.positiveProbeEvidence(), this.isActive(), this.isBlocked()),
    this.lastCheck(), this.routeProbedAt()));

  /** The host cannot check this connection (`unknown`/`skipped`): not checkable is not failed. */
  private readonly uncheckable = computed(() => this.status() === 'unknown' || this.status() === 'skipped');

  /** The selected main route, currently blocked or failing. */
  protected readonly isBlockedMain = computed(() => (this.isActive() || this.isBlocked()) && this.resolvedState() !== 'active');

  private readonly credentialRejected = computed(() => {
    const variant = this.unauthenticatedVariant();
    if (variant) return variant === 'credential-rejected';
    const modality = this.authModality();
    return modality === 'api-key' || modality === 'apiKey';
  });

  protected readonly cardTone = computed(() => connectionCardTone(this.resolvedState(), this.isBlockedMain()));
  protected readonly cardSpine = computed(() => connectionCardSpine(this.resolvedState(), this.isBlockedMain()));
  protected readonly dotClass = computed(() => connectionStateDot(this.resolvedState()));
  protected readonly statusLabel = computed(() => connectionStateLabel(this.resolvedState(), this.credentialRejected()));
  protected readonly statusCopy = computed(() =>
    connectionStateCopy(this.resolvedState(), this.displayName(), this.cliName() || `${this.displayName()} CLI`));
  protected readonly cardAriaLabel = computed(() => this.keyUnreadable()
    ? `${this.displayName()}: ${this.isBlockedMain() ? 'main agent needs attention, ' : ''}${KEY_UNREADABLE_TEXT} Open connection details.`
    : `${this.displayName()}: ${this.isBlockedMain() ? 'main agent needs attention, ' : ''}${this.statusLabel()}. ${this.statusCopy()} Open connection details.`);

  /** Provenance line: the stored credential, else the last connected / failed time, else the full modality. */
  protected readonly subtitle = computed(() => {
    const connected = this.lastConnectedText() || this.lastConnectedAt();
    const failed = this.lastFailedText();
    return this.sourceLabel() || (connected ? `Last connected ${connected}` : failed ? `Last check failed ${failed}` : null)
      || authModalityLabel(this.authModality());
  });

  protected readonly inlineAction = computed<InlineAction | null>(() => {
    const action = primaryConnectionAction(this.resolvedState(), {
      uncheckable: this.uncheckable(), credentialRejected: this.credentialRejected(),
    });
    return action ? this.describe(action) : null;
  });

  private describe(action: ConnectionCardAction): InlineAction {
    const name = this.displayName();
    switch (action) {
      case 'add-key': return { label: 'Add API key', testId: 'btn-add-key', ariaLabel: `Add API key for ${name}`, emit: this.addKeyRequested };
      case 'replace-key': return { label: 'Replace key', testId: 'btn-replace-key', ariaLabel: `Replace key for ${name}`, emit: this.replaceKeyRequested };
      case 'sign-in': return { label: 'Sign in', testId: 'btn-sign-in', ariaLabel: `Sign in to ${name}`, emit: this.signInRequested };
      case 'retry': return { label: 'Retry', testId: 'btn-retry', ariaLabel: `Retry connection to ${name}`, emit: this.retryRequested };
      case 'check-again': return { label: 'Check again', testId: 'btn-check-again', ariaLabel: `Check again for ${this.cliName() || `${name} CLI`}`, emit: this.checkAgainRequested };
      case 'set-up': return { label: 'Set up', testId: 'btn-setup', ariaLabel: `Set up ${name}`, emit: this.setupRequested };
      case 'check-connection': return { label: 'Check connection', testId: 'btn-check-connection', ariaLabel: `Check connection for ${name}`, emit: this.checkConnectionRequested };
    }
  }
}
