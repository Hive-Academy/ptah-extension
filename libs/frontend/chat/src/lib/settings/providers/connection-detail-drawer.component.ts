import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import type { ProvidersConnection } from '@ptah-extension/core';
import { NativeDrawerComponent, NativeTabGroupComponent } from '@ptah-extension/ui';
import type { UsedBy } from './connection-usage';
import {
  connectionDrawerTabs, connectionKind, type ConnectionDrawerTabId, type ConnectionKind,
} from './connection-drawer/connection-kind';
import { OverviewTabComponent, type OverviewConnectionStatus } from './connection-drawer/overview-tab.component';

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
 * Avatar surfaces (prototype `iconClass`). Colour sits on the avatar only; its initials stay
 * `text-base-content` (deviation 6). Picked from the connection id so a connection keeps its tone.
 */
const AVATAR_TONES: readonly string[] = [
  'border-primary/30 bg-primary/10',
  'border-secondary/30 bg-secondary/10',
  'border-info/40 bg-info/10',
];

/** Two-letter avatar text: the first letters of the first two words, else the first two letters. */
export function connectionInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Code points, not UTF-16 units, so an astral first letter is never split in half.
  const [first = ['?'], second = ['']] = words.map((word) => Array.from(word));
  const initials = words.length > 1 ? first[0] + second[0] : first.slice(0, 2).join('');
  return initials.toUpperCase();
}

function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/**
 * Until the Credentials (Batch 21), Models & Tiers and Advanced (Batch 22) tab bodies land, these tabs
 * keep today's editing path: the setup wizard the card's Manage opened (D14 — no capability lost).
 */
const SETUP_COPY: Readonly<Record<Exclude<ConnectionDrawerTabId, 'overview'>, string>> = {
  credentials: 'Replace, check or remove the credential for this connection in setup.',
  models: 'Choose the model used for each tier in setup.',
  advanced: 'Edit this endpoint\'s name, base URL and protocol in setup.',
};

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
  imports: [NativeDrawerComponent, NativeTabGroupComponent, OverviewTabComponent],
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
      @if (connection()) {
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
              @default {
                @if (loading()) {
                  <div class="space-y-2" aria-busy="true" data-testid="connection-tab-skeleton">
                    <span class="skeleton block h-4 w-3/4"></span>
                    <span class="skeleton block h-4 w-1/2"></span>
                  </div>
                } @else {
                  <p class="text-sm text-base-content" data-testid="connection-setup-copy">{{ setupCopy() }}</p>
                }
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
            @if (activeTabId() !== 'overview') {
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
  readonly closed = output<void>();
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
    `flex h-8 w-8 shrink-0 items-center justify-center rounded border text-xs font-bold text-base-content ${avatarTone(this.connection()?.id ?? '')}`);
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
  protected readonly setupCopy = computed(() => {
    const tab = this.activeTabId();
    return tab === 'overview' ? '' : SETUP_COPY[tab];
  });

  private readonly connectionId = computed(() => this.connection()?.id ?? null);

  constructor() {
    // Every connection opens on Overview.
    effect(() => {
      this.connectionId();
      untracked(() => this.activeTab.set('overview'));
    });
  }
}
