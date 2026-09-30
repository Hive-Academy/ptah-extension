import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import type { ProvidersConnection, ProvidersConnectionDraft } from '@ptah-extension/core';
import { NativeDrawerComponent, NativeTabGroupComponent } from '@ptah-extension/ui';
import type { UsedBy } from './connection-usage';
import {
  connectionDrawerTabs, connectionKind, type ConnectionDrawerTabId, type ConnectionKind,
} from './connection-drawer/connection-kind';
import { OverviewTabComponent, type OverviewConnectionStatus } from './connection-drawer/overview-tab.component';
import {
  CredentialsTabComponent, replaceKeyDraft, type CancelDraftFn, type CredentialsCommit, type CredentialsExternalAction,
  type CredentialsExternalAuth, type CredentialsSetup, type ReplaceKeyRequest, type VerifyDraftFn,
} from './connection-drawer/credentials-tab.component';
import { ModelsTiersTabComponent } from './connection-drawer/models-tiers-tab.component';
import { AdvancedTabComponent } from './connection-drawer/advanced-tab.component';
// The card uses the same avatar, so a connection looks the same on the card and in its drawer.
import { connectionAvatarTone, connectionInitials } from './provider-connection-card.state';

const AUTH_MODE_LABELS: Readonly<Record<ConnectionKind, string>> = {
  'claude-cli': 'CLI subscription',
  'api-key': 'API key',
  oauth: 'Provider sign-in',
  local: 'Local server',
  custom: 'Custom endpoint',
};

/** The custom entry's wire protocol (`ProvidersCustomEntry.lane`), shown in the header subtitle. */
export type CustomProtocol = 'openai' | 'anthropic';
const PROTOCOL_LABELS: Readonly<Record<CustomProtocol, string>> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic-compatible',
};

/**
 * "Edit in setup" (D14) stays on a tab only for the edits its body does not hold yet, which the setup
 * wizard still offers:
 * - Credentials: a local server's address and optional key; a custom endpoint's address is on Advanced;
 * - Models & Tiers: a custom gateway's own default models (the entry's `defaultTiers`);
 * - Advanced: a custom gateway's name and protocol.
 */
const SETUP_COPY: Readonly<Record<Exclude<ConnectionDrawerTabId, 'overview'>, string>> = {
  credentials: 'Change this connection\'s endpoint address in setup.',
  models: 'Change this gateway\'s own default models in setup.',
  advanced: 'Change this gateway\'s name or protocol in setup.',
};

/** Kinds whose Credentials tab holds every credential path (no setup fallback in its footer). */
const CREDENTIALS_COMPLETE: ReadonlySet<ConnectionKind> = new Set(['api-key', 'oauth', 'claude-cli']);

/**
 * Per-connection detail drawer (implementation-plan.md :637-667, design-spec §2.3/§3.4). The tabs come
 * from `connectionKind`, so a tab that does not apply to this connection is not rendered. The footer
 * holds Close plus the active tab's own primary action, never a blanket Save (deviation 3).
 *
 * The parent owns visibility: the drawer is open while `connection` is set and only requests closure.
 * `NativeDrawerComponent` returns focus to the opener on close (Esc, backdrop, Close).
 */
@Component({
  selector: 'ptah-connection-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeDrawerComponent, NativeTabGroupComponent, OverviewTabComponent, CredentialsTabComponent,
    ModelsTiersTabComponent, AdvancedTabComponent],
  template: `
    <ptah-native-drawer [isOpen]="connection() !== null" widthClass="w-full max-w-lg"
      [ariaLabel]="(connection()?.name ?? 'Connection') + ' connection details'" (closed)="closed.emit()">
      <!-- One projectable node per @if: a multi-node @if cannot project into the drawer's slots (NG8011). -->
      @if (connection(); as current) {
        <div drawer-header class="flex items-center gap-2.5" data-testid="connection-detail-drawer">
          <span [class]="avatarClass()" aria-hidden="true" data-testid="connection-drawer-avatar">{{ initials() }}</span>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-base-content break-words" data-testid="connection-drawer-title">{{ current.name }}</h2>
            <p class="text-xs text-base-content-muted" data-testid="connection-drawer-subtitle">{{ subtitle() }}</p>
          </div>
        </div>
      }
      @if (connection(); as current) {
        <!-- Four tabs stay on one line (prototype): the labels inherit nowrap and the strip takes 8px of the
             body padding on each side; the tab body resets both. -->
        <ptah-native-tab-group class="-mx-2 block whitespace-nowrap" [tabs]="tabs()" [(activeId)]="activeTab"
          ariaLabel="Connection details sections">
          <div class="whitespace-normal px-2 pt-4" [attr.data-tab-body]="activeTabId()">
            @switch (activeTabId()) {
              @case ('overview') {
                <ptah-connection-overview-tab [status]="status()" [positiveProbeEvidence]="positiveProbeEvidence()"
                  [isActive]="isActive()" [kind]="kind()" [authModeLabel]="authModeRowLabel()" [credentialLabel]="credentialLabel()"
                  [loading]="loading()" [checking]="checking()" [saving]="saving()" [usedBy]="usedBy()" [usageComplete]="usageComplete()"
                  [usageError]="usageError()" (checkConnectionRequested)="checkConnectionRequested.emit()"
                  (retryUsageRequested)="retryUsageRequested.emit()" />
              }
              @case ('credentials') {
                <ptah-connection-credentials-tab [connection]="current" [kind]="kind()" [isActiveDriver]="isDriver()"
                  [saving]="saving()" [setup]="credentialsSetup()" [setupError]="credentialsSetupError()" [commit]="credentialsCommit()"
                  [externalAuth]="externalAuth()" [verifyDraftConnection]="verifyDraftConnection()"
                  [cancelDraftVerification]="cancelDraftVerification()" (replaceKeyRequested)="emitReplace(current, $event)"
                  (deleteKeyRequested)="deleteKeyRequested.emit()" (signOutRequested)="signOutRequested.emit()"
                  (externalActionRequested)="externalActionRequested.emit($event)" />
                @if (setupFallback()) {
                  <p class="mt-4 text-xs text-base-content-muted" data-testid="connection-setup-copy">{{ setupCopy() }}</p>
                }
              }
              @case ('models') {
                <ptah-connection-models-tab [connection]="current" />
                @if (setupFallback()) {
                  <p class="mt-4 text-xs text-base-content-muted" data-testid="connection-setup-copy">{{ setupCopy() }}</p>
                }
              }
              @case ('advanced') {
                <ptah-connection-advanced-tab [connection]="current" [isDriver]="isDriver()"
                  [verifyDraftConnection]="verifyDraftConnection()" [cancelDraftVerification]="cancelDraftVerification()" />
                <p class="mt-4 text-xs text-base-content-muted" data-testid="connection-setup-copy">{{ setupCopy() }}</p>
              }
            }
          </div>
        </ptah-native-tab-group>
      }
      @if (connection(); as current) {
        <div drawer-footer class="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3">
          <span class="text-xs text-base-content-muted">Esc to close</span>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-ghost btn-sm" (click)="closed.emit()" data-testid="connection-drawer-close">Close</button>
            @if (setupFallback()) {
              <button type="button" class="btn btn-primary btn-sm" [disabled]="loading() || !canEdit()"
                (click)="setupRequested.emit(current.id)" data-testid="connection-edit-in-setup">Edit in setup</button>
            }
          </div>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class ConnectionDetailDrawerComponent {
  /** The connection shown; `null` closes the drawer. */
  readonly connection = input<ProvidersConnection | null>(null);
  readonly status = input<OverviewConnectionStatus>('not-checked');
  readonly positiveProbeEvidence = input<boolean | null>(null);
  readonly isActive = input(false);
  /**
   * This connection is the main agent's driver (the last loaded route's `driverProviderId`). Unlike
   * `isActive` it stays put while a save runs or the route re-reads, and it holds for a driver whose
   * key is broken (route not ready): exactly when Replace and the delete warnings matter.
   */
  readonly isDriver = input(false);
  readonly loading = input(false);
  readonly checking = input(false);
  /** A settings save is in flight (Check connection waits for it). */
  readonly saving = input(false);
  /** Setup can start (sections ready, nothing saving). */
  readonly canEdit = input(false);
  readonly usedBy = input<readonly UsedBy[]>([]);
  readonly usageComplete = input(false);
  readonly usageError = input(false);
  /** Wire protocol of a custom entry; `null` for a catalog connection or while it is unknown. */
  readonly customProtocol = input<CustomProtocol | null>(null);
  /** Credentials tab: stored endpoint and tiers, its own last write, the host's sign-in message. */
  readonly credentialsSetup = input<CredentialsSetup | null>(null);
  readonly credentialsSetupError = input(false);
  readonly credentialsCommit = input<CredentialsCommit | null>(null);
  readonly externalAuth = input<CredentialsExternalAuth>({ status: 'idle', message: null });
  readonly verifyDraftConnection = input.required<VerifyDraftFn>();
  readonly cancelDraftVerification = input.required<CancelDraftFn>();
  readonly closed = output<void>();
  /** A verified Replace, as the `connectProvider` draft (`replaceKeyDraft`: credential only, connect-only). */
  readonly replaceKeyRequested = output<ProvidersConnectionDraft>();
  readonly deleteKeyRequested = output<void>();
  readonly signOutRequested = output<void>();
  readonly externalActionRequested = output<CredentialsExternalAction>();
  readonly checkConnectionRequested = output<void>();
  readonly retryUsageRequested = output<void>();
  /** Open the setup wizard for this provider (the parent closes the drawer first). */
  readonly setupRequested = output<string>();

  protected readonly activeTab = signal<string | null>('overview');
  protected readonly kind = computed<ConnectionKind>(() => {
    const current = this.connection();
    return current ? connectionKind(current) : 'api-key';
  });
  protected readonly tabs = computed(() => connectionDrawerTabs(this.kind()));
  /** The bound id when it is one of this connection's tabs, otherwise Overview. */
  protected readonly activeTabId = computed<ConnectionDrawerTabId>(() =>
    this.tabs().find((tab) => tab.id === this.activeTab())?.id ?? 'overview');
  protected readonly authModeLabel = computed(() => AUTH_MODE_LABELS[this.kind()]);
  /** Overview "Authentication mode" value: a custom endpoint names its key when it stores one. */
  protected readonly authModeRowLabel = computed(() =>
    this.kind() === 'custom' && this.connection()?.hasKey ? 'API key (custom endpoint)' : this.authModeLabel());
  protected readonly initials = computed(() => connectionInitials(this.connection()?.name ?? ''));
  protected readonly avatarClass = computed(() =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded border text-xs font-bold text-base-content ${connectionAvatarTone(this.connection()?.id ?? '')}`);
  /**
   * Header subtitle (prototype "API key · Stored locally", "Custom gateway · OpenAI-compatible").
   * Built only from non-secret connection metadata; a part the state does not know is left out.
   */
  protected readonly subtitle = computed(() => {
    const current = this.connection();
    switch (this.kind()) {
      case 'custom': {
        const protocol = this.customProtocol();
        // Host data is not trusted to stay inside the type: an unknown protocol is left out.
        const label = protocol && Object.hasOwn(PROTOCOL_LABELS, protocol) ? PROTOCOL_LABELS[protocol] : null;
        return label ? `Custom gateway · ${label}` : 'Custom gateway';
      }
      case 'api-key': return current?.hasKey ? 'API key · Stored locally' : 'API key · No key stored';
      case 'oauth': return current?.accountLabel ? `Provider sign-in · ${current.accountLabel}` : 'Provider sign-in';
      case 'local': return current?.hasKey ? 'Local server · Key stored locally' : 'Local server';
      default: return 'CLI subscription · Claude CLI login';
    }
  });
  protected readonly credentialLabel = computed(() => {
    const current = this.connection();
    switch (this.kind()) {
      case 'claude-cli': return 'Claude CLI login session';
      case 'oauth': return current?.accountLabel ? `Signed in as ${current.accountLabel}` : 'Provider sign-in session';
      case 'local': return current?.hasKey ? 'Optional key stored on this machine' : 'No key needed';
      default: return current?.hasKey ? 'Stored on this machine' : 'No key stored';
    }
  });
  /** "Edit in setup" (D14) stays on a tab whose body does not yet hold every edit it replaces. */
  protected readonly setupFallback = computed(() => {
    switch (this.activeTabId()) {
      case 'credentials': return !CREDENTIALS_COMPLETE.has(this.kind());
      case 'models': return this.kind() === 'custom';
      case 'advanced': return true;
      default: return false;
    }
  });
  protected readonly setupCopy = computed(() => {
    const tab = this.activeTabId();
    return tab === 'overview' ? '' : SETUP_COPY[tab];
  });

  private readonly connectionId = computed(() => this.connection()?.id ?? null);

  protected emitReplace(connection: ProvidersConnection, request: ReplaceKeyRequest): void {
    this.replaceKeyRequested.emit(replaceKeyDraft(connection, request, this.credentialsSetup()));
  }

  constructor() {
    // Every connection opens on Overview.
    effect(() => {
      this.connectionId();
      untracked(() => this.activeTab.set('overview'));
    });
  }
}
