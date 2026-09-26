import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Info,
  Lock,
  LucideAngularModule,
  RefreshCw,
  SearchX,
  Trash2,
  Unplug,
  type LucideIconData,
} from 'lucide-angular';
import {
  BrandMarkComponent,
  NativeTabGroupComponent,
  type NativeTab,
} from '@ptah-extension/ui';
import type { CapabilityEntry, CapabilityScope } from '@ptah-extension/shared';

import { CapabilityTogglesStore } from '../../data/capability-toggles.store';
import { ConnectorLinksStore } from '../../data/connector-links.store';
import { PTAH_SESSIONS_LABEL } from '../../data/coverage';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import {
  MASKED_VALUE,
  type ProviderRow,
  type ProviderStatusSource,
  type ProviderTarget,
} from '../../data/provider-row';
import { decodeServerRef, encodeServerRef } from '../../data/server-ref';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { CapabilityToggleComponent } from '../../ui/capability-toggle.component';
import { CopyCommandButtonComponent } from '../../ui/copy-command-button.component';
import { DirectRemovalConfirmComponent } from '../../ui/direct-removal-confirm.component';
import { providerRowKindLabel } from '../../ui/provider-table.component';
import { StatusPillComponent } from '../../ui/status-pill.component';
import { TargetMarksComponent } from '../../ui/target-marks.component';
import {
  findGroupByRef,
  injectProviderRows,
} from '../../data/installed-provider-rows';
import {
  capabilityScopeLabels,
  declarationName,
  declarationScopeLabel,
  mcpNotEnforcedNote,
  schemaSizeText,
} from './installed-servers-page.component';

type DetailTab = 'overview' | 'targets' | 'config';

/** What the detail can show for the ref it was given. */
type DetailView = 'loading' | 'error' | 'not-found' | 'ready';

/** Whether a target's CLI is present, as far as the harness knows. */
type TargetDetection = 'detected' | 'not-detected' | 'unknown';

/** One row of the Targets tab. */
export interface ServerTargetView {
  readonly target: ProviderTarget;
  /** How the server reaches this CLI, in words. */
  readonly via: string;
  /** The config files that declare it for this CLI. */
  readonly configPaths: readonly string[];
  readonly detection: TargetDetection;
}

const STATUS_SOURCE_HINTS: Readonly<Record<ProviderStatusSource, string>> = {
  session: 'Reported by the last session in this workspace',
  oauth: 'Live OAuth connection state',
  smithery: 'Live Smithery connection state',
  config: 'Configured — no live source has reported on it',
};

const DETECTION_WORDS: Readonly<Record<TargetDetection, string>> = {
  detected: 'Detected',
  'not-detected': 'Not detected in this workspace',
  unknown: 'Detection not checked yet',
};

const DETECTION_ICONS: Readonly<Record<TargetDetection, LucideIconData>> = {
  detected: CircleCheck,
  'not-detected': CircleSlash,
  unknown: CircleDashed,
};

/**
 * A date the links store reported, in the user's locale. A value that does
 * not parse is shown as sent rather than as "Invalid Date".
 */
export function formatDetailDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/**
 * ServerDetailComponent — one installed server (plan C7 `ServerDetail`),
 * routed as `:serverRef` under the Installed servers and Overview pages.
 *
 * Frame-agnostic: the list view places it in a drawer or a docked inspector;
 * nothing here knows which, and nothing here moves focus.
 *
 * - A malformed ref, or a ref the loaded inventory does not hold, renders
 *   "Not found" with a link back. That includes a server that disappeared on
 *   a reload — e.g. a project-scope server of the previous workspace after a
 *   workspace switch re-read the inventory (TASK_2026_540 item 6c).
 * - Config values never render: `ConfigSummary` carries env and header KEYS
 *   only, and each key is shown beside a fixed mask.
 * - Removal goes through the inventory store. A `direct` row (a config file
 *   Ptah did not write) is removed only after an inline confirmation that
 *   lists its config paths. A blocked row shows a lock banner with the copy
 *   command instead of a button.
 * - Reconnect (OAuth, Smithery) goes through `ConnectorLinksStore.reconnect`,
 *   the installed-row form of `authorize`.
 * - Use in sessions (TASK_2026_560, plan C10): the capability row for the
 *   server's name offers two switches, one per layer — "This workspace only"
 *   writes the workspace, "All workspaces" writes global, and neither ever
 *   writes the other (AC-2.3). The Overview lists the scope labels, every
 *   declaration of the name (a list, whatever its length) and the schema size,
 *   "size unknown" while no figure exists. A failed or missing capability read
 *   leaves the rest of the detail as it was.
 */
@Component({
  selector: 'ptah-server-detail',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    BrandMarkComponent,
    NativeTabGroupComponent,
    CapabilityToggleComponent,
    CopyCommandButtonComponent,
    DirectRemovalConfirmComponent,
    StatusPillComponent,
    TargetMarksComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'server-detail' },
  templateUrl: './server-detail.component.html',
})
export class ServerDetailComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly links = inject(ConnectorLinksStore);
  private readonly harness = inject(HarnessHealthStore);
  protected readonly capabilities = inject(CapabilityTogglesStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** The `:serverRef` route parameter (component input binding). */
  public readonly serverRef = input<string | null | undefined>(undefined);

  protected readonly maskedValue = MASKED_VALUE;
  protected readonly sessionTargetsLabel = PTAH_SESSIONS_LABEL;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly LockIcon = Lock;
  protected readonly InfoIcon = Info;
  protected readonly NotFoundIcon = SearchX;
  protected readonly RemoveIcon = Trash2;
  protected readonly DisconnectIcon = Unplug;
  protected readonly ReconnectIcon = RefreshCw;
  protected readonly detectionWords = DETECTION_WORDS;
  protected readonly detectionIcons = DETECTION_ICONS;

  protected readonly activeTab = signal<DetailTab>('overview');
  protected readonly confirming = signal(false);
  /** The last removal or reconnect failure, shown inline. */
  protected readonly actionError = signal<string | null>(null);
  /** Set while Smithery waits for the user to finish setup in the browser. */
  protected readonly actionInfo = signal<string | null>(null);

  private readonly rows = injectProviderRows();

  /** The decoded ref, re-encoded so it matches `ProviderRow.ref` exactly. */
  private readonly refKey = computed(() => {
    const ref = decodeServerRef(this.serverRef());
    return ref === null ? null : encodeServerRef(ref);
  });

  protected readonly row = computed((): ProviderRow | null => {
    const ref = this.refKey();
    return this.rows().find((candidate) => candidate.ref === ref) ?? null;
  });

  private readonly group = computed(() =>
    findGroupByRef(this.inventory.installed().data, this.refKey()),
  );

  protected readonly view = computed((): DetailView => {
    if (this.refKey() === null) return 'not-found';
    const state = this.inventory.installed().state;
    if (state === 'error') return 'error';
    if (state !== 'ready') return 'loading';
    return this.row() === null ? 'not-found' : 'ready';
  });

  protected readonly loadError = computed(
    () => this.inventory.installed().error ?? null,
  );

  protected readonly tabs = computed((): readonly NativeTab[] => {
    const row = this.row();
    return [
      { id: 'overview', label: 'Overview' },
      {
        id: 'targets',
        label: 'Targets',
        count: row?.kind === 'config' ? row.targets.length : null,
      },
      { id: 'config', label: 'Config' },
    ];
  });

  protected readonly kindLabel = computed(() => {
    const row = this.row();
    return row === null ? '' : providerRowKindLabel(row);
  });

  protected readonly statusHint = computed(() => {
    const row = this.row();
    return row === null ? '' : STATUS_SOURCE_HINTS[row.statusSource];
  });

  protected readonly connectedAt = computed(() => {
    const value = this.row()?.dates?.connectedAt;
    return value === undefined ? null : formatDetailDate(value);
  });

  protected readonly createdAt = computed(() => {
    const value = this.row()?.dates?.createdAt;
    return value === undefined ? null : formatDetailDate(value);
  });

  /** The lock of a blocked row: reason plus the copyable command, if any. */
  protected readonly lock = computed(() => {
    const removal = this.row()?.removal;
    if (removal?.kind !== 'blocked') return null;
    const command = removal.fixCommand?.trim() ?? '';
    return {
      reason: removal.reason,
      command: command.length > 0 ? command : null,
    };
  });

  /**
   * A claude.ai account connector: managed in the account, so the banner
   * explains where. No link: the webview has no verified claude.ai settings
   * URL and no host call to open one (Batch 13 decision).
   */
  protected readonly accountManaged = computed(() => {
    const removal = this.row()?.removal;
    return removal?.kind === 'manage-link' ? removal.reason : null;
  });

  protected readonly removalLabel = computed((): string | null => {
    switch (this.row()?.removal.kind) {
      case 'uninstall':
        return 'Uninstall';
      case 'confirm-direct':
        return 'Remove…';
      case 'disconnect':
        return 'Disconnect';
      default:
        return null;
    }
  });

  /** "Uninstall sentry", "Remove sentry (asks for confirmation)", … */
  protected readonly removalAriaLabel = computed(() => {
    const row = this.row();
    if (row === null) return null;
    switch (row.removal.kind) {
      case 'uninstall':
        return `Uninstall ${row.title}`;
      case 'confirm-direct':
        return `Remove ${row.title} (asks for confirmation)`;
      case 'disconnect':
        return `Disconnect ${row.title}`;
      default:
        return null;
    }
  });

  protected readonly removalIcon = computed(() =>
    this.row()?.removal.kind === 'disconnect'
      ? this.DisconnectIcon
      : this.RemoveIcon,
  );

  protected readonly removing = computed(() => {
    const ref = this.refKey();
    return ref !== null && this.inventory.pendingIds().has(ref);
  });

  protected readonly canReconnect = computed(() => {
    const origin = this.row()?.origin;
    return origin === 'oauth' || origin === 'smithery';
  });

  protected readonly reconnecting = computed(() => {
    const row = this.row();
    return (
      row !== null &&
      this.canReconnect() &&
      this.links.isServerBusy({ origin: row.origin, serverKey: row.serverKey })
    );
  });

  protected readonly targetViews = computed((): readonly ServerTargetView[] => {
    const row = this.row();
    if (row === null || row.kind !== 'config') return [];
    const group = this.group();
    const harnessTargets = this.harness.health()?.targets ?? null;
    return row.targets.map((target) => {
      const paths =
        target.via === 'declared-by-cli'
          ? row.configPaths
          : (group?.servers ?? [])
              .filter((server) => server.target === target.target)
              .map((server) => server.configPath)
              .filter((path) => path.length > 0);
      const health = harnessTargets?.find(
        (candidate) => candidate.target === target.target,
      );
      return {
        target,
        via:
          target.via === 'declared-by-cli'
            ? 'Declared by the CLI in its own config'
            : 'Written to its config file',
        configPaths: [...new Set(paths)],
        detection:
          health === undefined
            ? 'unknown'
            : health.detected
              ? 'detected'
              : 'not-detected',
      };
    });
  });

  // ── Use in sessions ────────────────────────────────────────────────────────

  protected readonly scopeLabels = capabilityScopeLabels;
  protected readonly scopeLabel = declarationScopeLabel;
  protected readonly declarationName = declarationName;
  /** Printed once for both switches (same for every MCP item). */
  protected readonly notEnforcedNote = mcpNotEnforcedNote();

  /**
   * The capability row for this server's name, or `null` while the read has
   * not landed, failed, or knows no such name. Rows of every origin that share
   * a name share it: a session loads one server per name.
   */
  protected readonly capability = computed((): CapabilityEntry | null => {
    const row = this.row();
    if (row === null) return null;
    return (
      this.capabilities.entryOf({ kind: 'mcp', id: row.serverKey }) ?? null
    );
  });

  /** AC-5.1 / AC-5.2: a measured figure, else "size unknown". */
  protected readonly sizeText = computed(() =>
    schemaSizeText(this.capability()),
  );

  /**
   * The layer the last toggle here wrote. The store keeps one error per item,
   * so it is shown under the switch that caused it, not under both.
   */
  private readonly lastWriteScope = signal<CapabilityScope | null>(null);

  protected readonly workspaceError = computed(() =>
    this.errorFor('workspace'),
  );
  protected readonly globalError = computed(() => this.errorFor('global'));

  public constructor() {
    // The reads are part of the hosting page's own RPC set; `ensure` is a
    // no-op once the page asked, and covers a detail opened by a deep link.
    void this.inventory.ensure('installed');
    void this.links.ensure();
    void this.capabilities.ensure();

    // A new server resets the transient action state (the tab is kept, so
    // stepping through rows compares the same facet).
    effect(() => {
      this.refKey();
      untracked(() => {
        this.confirming.set(false);
        this.actionError.set(null);
        this.actionInfo.set(null);
        this.lastWriteScope.set(null);
      });
    });
  }

  /**
   * One switch's write, to exactly the layer that switch names: the
   * workspace switch never writes global, the global one never the
   * workspace (AC-2.3).
   */
  protected setEnabled(
    entry: CapabilityEntry,
    scope: CapabilityScope,
    enabled: boolean,
  ): void {
    this.lastWriteScope.set(scope);
    void this.capabilities.setEnabled(entry, scope, enabled);
  }

  protected reloadCapabilities(): void {
    void this.capabilities.reload();
  }

  private errorFor(scope: CapabilityScope): string | null {
    const entry = this.capability();
    if (entry === null || this.lastWriteScope() !== scope) return null;
    return this.capabilities.errorFor(entry);
  }

  protected selectTab(id: string): void {
    if (id === 'overview' || id === 'targets' || id === 'config') {
      this.activeTab.set(id);
    }
  }

  protected retry(): void {
    void this.inventory.retry('installed');
  }

  /** The footer's remove / disconnect button. */
  protected requestRemoval(): void {
    this.actionError.set(null);
    if (this.row()?.removal.kind === 'confirm-direct') {
      this.confirming.set(true);
      return;
    }
    void this.remove(false);
  }

  protected confirmRemoval(): void {
    this.confirming.set(false);
    void this.remove(true);
  }

  protected cancelRemoval(): void {
    this.confirming.set(false);
  }

  protected async reconnect(): Promise<void> {
    const row = this.row();
    if (row === null || !this.canReconnect()) return;
    this.actionError.set(null);
    this.actionInfo.set(null);
    const outcome = await this.links.reconnect({
      origin: row.origin,
      serverKey: row.serverKey,
    });
    if (outcome.kind === 'failed') {
      this.actionError.set(outcome.error);
    } else if (outcome.kind === 'awaiting-setup') {
      this.actionInfo.set(
        'Finish the setup in your browser. Ptah checks the connection until it is done.',
      );
    }
  }

  private async remove(confirmed: boolean): Promise<void> {
    const group = this.group();
    if (group === null) return;
    const outcome = await this.inventory.removeServer(group, {
      confirmedDirect: confirmed,
    });
    if (outcome.status === 'removed') {
      // The row is gone; back to the list it came from.
      await this.router.navigate(['..'], { relativeTo: this.route });
      return;
    }
    this.actionError.set(outcome.message);
  }
}
