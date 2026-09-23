import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  LucideAngularModule,
  CheckCircle,
  Key,
  LogOut,
  AlertTriangle,
  Terminal,
  Plus,
  Loader2,
  HelpCircle,
  AlertCircle,
} from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import {
  NativeCardComponent,
  ProviderMarkComponent,
  type NativeCardTone,
} from '@ptah-extension/ui';
import type { SettingScope, EffectiveRouteProvider } from '@ptah-extension/shared';
import {
  SettingScopeRowComponent,
  type SettingScopeDisplay,
} from './setting-scope-row.component';

/**
 * Valid connection status inputs for {@link ProviderConnectionCardComponent}.
 *
 * Includes the canonical state table states from `design-spec.md` as well as
 * wire/registry values from `EffectiveRouteProvider['status']` for direct binding.
 */
export type ProviderConnectionCardStatus =
  | 'active'
  | 'connected'
  | 'needs-key'
  | 'unauthenticated'
  | 'unreachable'
  | 'not-installed'
  | 'not-configured'
  | 'checking'
  | 'not-checked'
  | 'check-unavailable'
  | EffectiveRouteProvider['status'];

/** Canonical resolved visual and copy state corresponding to the design spec's state table. */
export type ResolvedConnectionState =
  | 'active'
  | 'connected'
  | 'needs-key'
  | 'unauthenticated'
  | 'unreachable'
  | 'not-installed'
  | 'not-configured'
  | 'checking'
  | 'not-checked'
  | 'check-unavailable';

/**
 * Presentational card showing one provider connection
 * (`design-spec.md` "3. Your connections" and "State table (state → visual → copy)",
 * `implementation-plan.md` Component boundaries).
 *
 * Rules strictly honoured:
 * - A status that is not a confirmed success is NEVER shown as Connected.
 *   `unknown` renders as **Not checked**. `skipped` renders as **Check unavailable**.
 *   Credentials presence or CLI installation alone does NOT establish inference;
 *   only explicit positive probe evidence justifies a Connected state.
 * - Never renders `storedAuthMethodDiagnostic` — that field is diagnostic-only.
 * - Provider identity and auth modality never truncate; model IDs and paths wrap.
 * - Minimum control height is 36 px (`min-h-9`), with a visible 2 px focus outline.
 * - Action buttons carry explicit accessible names including the provider or CLI name.
 * - Presentational only: performs no RPC calls and emits intent through outputs.
 */
@Component({
  selector: 'ptah-provider-connection-card',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeCardComponent,
    ProviderMarkComponent,
    SettingScopeRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-card
      [density]="'compact'"
      [tone]="cardTone()"
      [spine]="cardSpine()"
      [clickable]="false"
      data-testid="provider-connection-card"
    >
      <div class="flex flex-col gap-3">
        <!-- Top section: Provider identity, copy, status badge, and actions -->
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <!-- Left: Vendor mark and textual identity -->
          <div class="flex items-start gap-3 min-w-0">
            <ptah-provider-mark
              [providerId]="providerId()"
              [fallback]="effectiveMarkFallback()"
            />
            <div class="flex flex-col min-w-0">
              <!-- Name and Auth Modality (never truncate) -->
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="text-sm font-semibold text-base-content whitespace-nowrap"
                  data-testid="provider-name"
                >
                  {{ displayName() }}
                </span>
                @if (authModalityLabel(); as modality) {
                  <span
                    class="badge badge-outline text-xs font-medium bg-base-100 text-base-content border-base-content-muted whitespace-nowrap"
                    data-testid="auth-modality"
                  >
                    {{ modality }}
                  </span>
                }
              </div>

              <!-- Status Copy -->
              <p class="text-xs text-base-content mt-1" data-testid="status-copy">
                {{ statusCopy() }}
              </p>

              <!-- Prior success / Last connected timestamp -->
              @if (formattedLastConnected(); as time) {
                <p
                  class="text-xs text-base-content-muted mt-0.5"
                  data-testid="last-connected"
                >
                  Last connected {{ time }}
                </p>
              }
              @if (lastFailedText(); as failedTime) {
                <p
                  class="text-xs text-base-content-muted mt-0.5"
                  data-testid="last-failed"
                >
                  Last check failed {{ failedTime }}
                </p>
              }
            </div>
          </div>

          <!-- Right: Status badge(s) and actions -->
          <div class="flex flex-col sm:items-end gap-2 shrink-0">
            <!-- Badges: Blocked Main indicator and Status Badge -->
            <div class="flex flex-wrap items-center gap-1.5 sm:justify-end">
              @if (isBlockedMain()) {
                <span
                  class="badge badge-outline text-xs font-medium gap-1 bg-base-100 text-base-content border-base-content-muted"
                  data-testid="blocked-main-badge"
                >
                  <lucide-angular
                    [img]="AlertTriangleIcon"
                    class="h-3 w-3"
                    aria-hidden="true"
                  />
                  Main agent · Needs attention
                </span>
              }
              <span
                class="badge badge-outline text-xs font-medium gap-1 bg-base-100 text-base-content border-base-content-muted"
                data-testid="status-badge"
              >
                <lucide-angular
                  [img]="statusIcon()"
                  class="h-3 w-3"
                  [class.animate-spin]="resolvedState() === 'checking'"
                  aria-hidden="true"
                />
                {{ statusBadgeText() }}
              </span>
            </div>

            <!-- Action buttons -->
            <div
              class="flex flex-wrap items-center gap-2 sm:justify-end"
              data-testid="card-actions"
            >
              @switch (resolvedState()) {
                @case ('active') {
                  <button
                    type="button"
                    class="btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="changeMainProviderAriaLabel()"
                    (click)="changeMainProviderRequested.emit()"
                    data-testid="btn-change-main"
                  >
                    Change main provider
                  </button>
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
                @case ('connected') {
                  @if (canActivateMain()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="activateMainAriaLabel()"
                      (click)="activateMainRequested.emit()"
                      data-testid="btn-activate-main"
                    >
                      Use for main agent
                    </button>
                  }
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
                @case ('needs-key') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="addKeyAriaLabel()"
                    (click)="addKeyRequested.emit()"
                    data-testid="btn-add-key"
                  >
                    Add API key
                  </button>
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
                @case ('unauthenticated') {
                  @if (isCredentialRejected()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="replaceKeyAriaLabel()"
                      (click)="replaceKeyRequested.emit()"
                      data-testid="btn-replace-key"
                    >
                      Replace key
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="signInAriaLabel()"
                      (click)="signInRequested.emit()"
                      data-testid="btn-sign-in"
                    >
                      Sign in
                    </button>
                  }
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
                @case ('unreachable') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="retryAriaLabel()"
                    (click)="retryRequested.emit()"
                    data-testid="btn-retry"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="editConnectionAriaLabel()"
                    (click)="editConnectionRequested.emit()"
                    data-testid="btn-edit-connection"
                  >
                    Edit connection
                  </button>
                }
                @case ('not-installed') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="installInstructionsAriaLabel()"
                    (click)="installInstructionsRequested.emit()"
                    data-testid="btn-install-instructions"
                  >
                    Installation instructions
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="checkAgainAriaLabel()"
                    (click)="checkAgainRequested.emit()"
                    data-testid="btn-check-again"
                  >
                    Check again
                  </button>
                }
                @case ('not-configured') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="setupAriaLabel()"
                    (click)="setupRequested.emit()"
                    data-testid="btn-setup"
                  >
                    Set up
                  </button>
                }
                @case ('checking') {
                  <!-- Noninteractive status while check is actively running -->
                }
                @case ('not-checked') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="checkConnectionAriaLabel()"
                    (click)="checkConnectionRequested.emit()"
                    data-testid="btn-check-connection"
                  >
                    Check connection
                  </button>
                  @if (canActivateMain() && uncheckable()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="activateMainAriaLabel()"
                      (click)="activateMainRequested.emit()"
                      data-testid="btn-activate-main"
                    >
                      Use for main agent
                    </button>
                  }
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
                @case ('check-unavailable') {
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="retryAriaLabel()"
                    (click)="retryRequested.emit()"
                    data-testid="btn-retry"
                  >
                    Retry
                  </button>
                  @if (canActivateMain() && uncheckable()) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="activateMainAriaLabel()"
                      (click)="activateMainRequested.emit()"
                      data-testid="btn-activate-main"
                    >
                      Use for main agent
                    </button>
                  }
                  @if (canManage()) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="manageAriaLabel()"
                      (click)="manageRequested.emit()"
                      data-testid="btn-manage"
                    >
                      Manage
                    </button>
                  }
                }
              }
              <ng-content select="[card-actions]" />
            </div>
          </div>
        </div>

        <!-- Scope and provenance line -->
        @if (hasScope()) {
          <div
            class="pt-1 border-t border-base-300/40"
            data-testid="card-scope-wrapper"
          >
            <ptah-setting-scope-row
              [scope]="scope()"
              [hasOverride]="hasOverride()"
              [supportedTargets]="supportedTargets()"
              [workspaceName]="workspaceName()"
              [workspaceCrossApp]="workspaceCrossApp()"
              [fieldName]="displayName()"
              (overrideRequested)="scopeOverrideRequested.emit()"
              (clearRequested)="scopeClearRequested.emit()"
              (useGlobalRequested)="scopeUseGlobalRequested.emit()"
              (copyGlobalRequested)="scopeCopyGlobalRequested.emit()"
            />
          </div>
        } @else if (sourceLabel(); as src) {
          <div
            class="flex flex-wrap items-center gap-2 rounded-md bg-base-100 px-2 py-1 text-xs"
            data-testid="source-strip"
          >
            <span
              class="badge badge-outline text-xs font-medium gap-1 bg-base-100 text-base-content border-base-content-muted"
              data-testid="source-badge"
            >
              {{ src }}
            </span>
          </div>
        }
        <ng-content select="[card-source]" />
      </div>
    </ptah-native-card>
  `,
})
export class ProviderConnectionCardComponent {
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly KeyIcon = Key;
  protected readonly LogOutIcon = LogOut;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly TerminalIcon = Terminal;
  protected readonly PlusIcon = Plus;
  protected readonly Loader2Icon = Loader2;
  protected readonly HelpCircleIcon = HelpCircle;
  protected readonly AlertCircleIcon = AlertCircle;

  /** Provider registry or connection identifier (e.g. 'anthropic', 'openai', 'claude-cli'). */
  readonly providerId = input<string>('');

  /** Human-readable provider name (e.g. 'Anthropic', 'Claude'). Defaults to providerId if empty. */
  readonly providerName = input<string>('');

  /** Auth modality identifier (e.g. 'api-key', 'cli', 'oauth', 'local', 'local-native'). */
  readonly authModality = input<string | null>(null);

  /** Preformatted auth modality label; overrides the default derived label when set. */
  readonly authModalityText = input<string | null>(null);

  /** Reported or candidate status of this connection. */
  readonly status = input<ProviderConnectionCardStatus>('not-configured');

  /**
   * Explicit evidence of a successful probe.
   *
   * Required for a connection to be marked 'connected' or 'active'.
   * When explicitly false, a candidate 'connected' status is downgraded to 'not-checked'.
   */
  readonly positiveProbeEvidence = input<boolean | null>(null);

  /** True when this provider route is selected for the main agent. */
  readonly isActive = input<boolean>(false);

  /** True when the active route is blocked and requires user intervention. */
  readonly isBlocked = input<boolean>(false);

  /**
   * Whether main-agent activation should be offered when connected.
   * Disabled for CLI-only integrations per design-spec.md §3.
   */
  readonly canActivateMain = input<boolean>(true);

  /** Whether the Manage action should be rendered for configured connections. */
  readonly canManage = input<boolean>(true);

  /** Explicit CLI executable / command name used in not-installed copy (e.g. 'Claude CLI'). */
  readonly cliName = input<string | null>(null);

  /**
   * Discriminator between "Sign-in required" and "Credential rejected" for unauthenticated.
   * When null, derived from authModality ('api-key' → credential-rejected, others → sign-in).
   */
  readonly unauthenticatedVariant = input<
    'sign-in' | 'credential-rejected' | null
  >(null);

  /** Timestamp of the last successful probe (ISO 8601 or formatted string). */
  readonly lastConnectedAt = input<string | null>(null);

  /** Direct display string for last connected time (e.g. "2 hours ago"). */
  readonly lastConnectedText = input<string | null>(null);

  /** Direct display string for last failed check time (e.g. "10 minutes ago"). */
  readonly lastFailedText = input<string | null>(null);

  /** Fallback icon for the vendor mark when not in the data table. */
  readonly fallbackMark = input<'Bot' | 'Server' | 'Terminal' | null>(null);

  /** Simple source string displayed when full SettingScopeRowComponent is not used. */
  readonly sourceLabel = input<string | null>(null);

  /** Scope of this connection's configuration for the embedded scope row. */
  readonly scope = input<SettingScopeDisplay | null>(null);

  /** True when the winning scope is an override. */
  readonly hasOverride = input<boolean>(false);

  /** Supported write targets for this connection setting. */
  readonly supportedTargets = input<readonly SettingScope[]>([]);

  /** Active workspace name for scope display. */
  readonly workspaceName = input<string | null>(null);

  /** True when the workspace source is cross-app. */
  readonly workspaceCrossApp = input<boolean>(false);

  // --- Actions ---
  readonly changeMainProviderRequested = output<void>();
  readonly activateMainRequested = output<void>();
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

  // --- Scope row intent forwarding ---
  readonly scopeOverrideRequested = output<void>();
  readonly scopeClearRequested = output<void>();
  readonly scopeUseGlobalRequested = output<void>();
  readonly scopeCopyGlobalRequested = output<void>();

  protected readonly displayName = computed<string>(
    () => this.providerName() || this.providerId() || 'Provider',
  );

  protected readonly hasScope = computed<boolean>(() => this.scope() !== null);

  protected readonly effectiveMarkFallback = computed<
    'Bot' | 'Server' | 'Terminal'
  >(() => {
    const fallback = this.fallbackMark();
    if (fallback) return fallback;
    const modality = this.authModality();
    if (modality === 'cli') return 'Terminal';
    if (
      modality === 'local' ||
      modality === 'local-native' ||
      modality === 'local-proxy'
    ) {
      return 'Server';
    }
    return 'Bot';
  });

  protected readonly authModalityLabel = computed<string | null>(() => {
    if (this.authModalityText()) return this.authModalityText();
    const modality = this.authModality();
    if (!modality) return null;
    switch (modality) {
      case 'api-key':
      case 'apiKey':
        return 'API key';
      case 'cli':
        return 'CLI subscription';
      case 'oauth':
      case 'oauth-proxy':
        return 'OAuth';
      case 'local':
      case 'local-native':
      case 'local-proxy':
        return 'Local endpoint';
      default:
        return modality;
    }
  });

  /**
   * Evaluates the canonical state table state.
   *
   * Crucial rule: Only explicit positive probe evidence justifies a Connected state.
   * 'unknown' maps to 'not-checked', 'skipped' maps to 'check-unavailable'.
   */
  readonly resolvedState = computed<ResolvedConnectionState>(() => {
    const raw = this.status();

    if (raw === 'active') {
      if (this.positiveProbeEvidence() === false) {
        return 'not-checked';
      }
      return 'active';
    }

    if (raw === 'unknown') {
      return 'not-checked';
    }
    if (raw === 'skipped') {
      return 'check-unavailable';
    }
    if (raw === 'missing') {
      return 'not-configured';
    }
    if (raw === 'reachable') {
      return this.positiveProbeEvidence() === true ? 'connected' : 'not-checked';
    }

    if (raw === 'connected') {
      // Must have positive probe evidence if specified; if explicitly false, never connected.
      if (this.positiveProbeEvidence() === false) {
        return 'not-checked';
      }
      // If selected for main and ready, it is active
      if (this.isActive() && !this.isBlocked()) {
        return 'active';
      }
      return 'connected';
    }

    return raw as ResolvedConnectionState;
  });

  /**
   * The host cannot check this connection (`unknown`/`skipped`, e.g. local servers). Still shown as
   * Not checked / Check unavailable, but main-agent activation is offered: not checkable is not failed.
   */
  protected readonly uncheckable = computed<boolean>(
    () => this.status() === 'unknown' || this.status() === 'skipped',
  );

  /** True when this is the selected main route but currently blocked/failing. */
  protected readonly isBlockedMain = computed<boolean>(() => {
    return (
      (this.isActive() || this.isBlocked()) && this.resolvedState() !== 'active'
    );
  });

  protected readonly isCredentialRejected = computed<boolean>(() => {
    const variant = this.unauthenticatedVariant();
    if (variant === 'credential-rejected') return true;
    if (variant === 'sign-in') return false;
    const modality = this.authModality();
    return modality === 'api-key' || modality === 'apiKey';
  });

  protected readonly cliNameDisplay = computed<string>(() => {
    const cli = this.cliName();
    if (cli) return cli;
    const name = this.displayName();
    return `${name} CLI`;
  });

  protected readonly cardTone = computed<NativeCardTone>(() => {
    if (this.isBlockedMain()) {
      return 'warning';
    }
    const state = this.resolvedState();
    switch (state) {
      case 'active':
        return 'secondary';
      case 'needs-key':
      case 'unreachable':
        return 'warning';
      case 'unauthenticated':
        return 'error';
      default:
        return 'neutral';
    }
  });

  protected readonly cardSpine = computed<boolean>(() => {
    if (this.isBlockedMain()) {
      return true;
    }
    const state = this.resolvedState();
    switch (state) {
      case 'active':
      case 'needs-key':
      case 'unreachable':
        return true;
      default:
        return false;
    }
  });

  protected readonly statusBadgeText = computed<string>(() => {
    const state = this.resolvedState();
    switch (state) {
      case 'active':
        return 'Active for main agent';
      case 'connected':
        return 'Connected · Available';
      case 'needs-key':
        return 'Needs API key';
      case 'unauthenticated':
        return this.isCredentialRejected()
          ? 'Credential rejected'
          : 'Sign-in required';
      case 'unreachable':
        return 'Unreachable';
      case 'not-installed':
        return 'Not installed';
      case 'not-configured':
        return 'Not configured';
      case 'checking':
        return 'Checking…';
      case 'not-checked':
        return 'Not checked';
      case 'check-unavailable':
        return 'Check unavailable';
    }
  });

  protected readonly statusIcon = computed<LucideIconData>(() => {
    const state = this.resolvedState();
    switch (state) {
      case 'active':
      case 'connected':
        return CheckCircle;
      case 'needs-key':
        return Key;
      case 'unauthenticated':
        return LogOut;
      case 'unreachable':
        return AlertTriangle;
      case 'not-installed':
        return Terminal;
      case 'not-configured':
        return Plus;
      case 'checking':
        return Loader2;
      case 'not-checked':
        return HelpCircle;
      case 'check-unavailable':
        return AlertCircle;
    }
  });

  /** Exact one-line copy as specified in design-spec.md state table. */
  protected readonly statusCopy = computed<string>(() => {
    const state = this.resolvedState();
    const provider = this.displayName();
    switch (state) {
      case 'active':
        return 'Used for new main-agent requests.';
      case 'connected':
        return 'Connected and available to use.';
      case 'needs-key':
        return `Add an API key to connect ${provider}.`;
      case 'unauthenticated':
        return 'Your credential is missing or expired; authenticate again.';
      case 'unreachable':
        return `Could not reach ${provider}; check the connection and retry.`;
      case 'not-installed':
        return `Install ${this.cliNameDisplay()} to use this connection.`;
      case 'not-configured':
        return `Set up ${provider} when you are ready.`;
      case 'checking':
        return `Checking ${provider}…`;
      case 'not-checked':
        return 'Connection has not been verified.';
      case 'check-unavailable':
        return 'Could not check this connection. Retry.';
    }
  });

  protected readonly formattedLastConnected = computed<string | null>(() => {
    if (this.lastConnectedText()) return this.lastConnectedText();
    const at = this.lastConnectedAt();
    if (!at) return null;
    return at;
  });

  // --- Accessible action labels ---

  protected readonly changeMainProviderAriaLabel = computed<string>(
    () => `Change main provider: currently ${this.displayName()}`,
  );

  protected readonly activateMainAriaLabel = computed<string>(
    () => `Use ${this.displayName()} for main agent`,
  );

  protected readonly manageAriaLabel = computed<string>(
    () => `Manage ${this.displayName()}`,
  );

  protected readonly addKeyAriaLabel = computed<string>(
    () => `Add API key for ${this.displayName()}`,
  );

  protected readonly signInAriaLabel = computed<string>(
    () => `Sign in to ${this.displayName()}`,
  );

  protected readonly replaceKeyAriaLabel = computed<string>(
    () => `Replace key for ${this.displayName()}`,
  );

  protected readonly retryAriaLabel = computed<string>(
    () => `Retry connection to ${this.displayName()}`,
  );

  protected readonly editConnectionAriaLabel = computed<string>(
    () => `Edit connection for ${this.displayName()}`,
  );

  protected readonly installInstructionsAriaLabel = computed<string>(
    () => `Installation instructions for ${this.cliNameDisplay()}`,
  );

  protected readonly checkAgainAriaLabel = computed<string>(
    () => `Check again for ${this.cliNameDisplay()}`,
  );

  protected readonly setupAriaLabel = computed<string>(
    () => `Set up ${this.displayName()}`,
  );

  protected readonly checkConnectionAriaLabel = computed<string>(
    () => `Check connection for ${this.displayName()}`,
  );
}
