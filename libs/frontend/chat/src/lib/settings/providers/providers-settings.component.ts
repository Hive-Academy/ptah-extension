import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit,
  afterNextRender, afterRenderEffect, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import {
  ProvidersSettingsStateService, type ProvidersConnection, type ProvidersConnectionDraft, type ProvidersEditContext,
  type ProvidersExternalAuthAction,
} from '@ptah-extension/core';
import type {
  SettingScope, AuthVerifyDraftConnectionParams, AuthCancelDraftVerificationParams, ConnectionCheckRecord,
} from '@ptah-extension/shared';
import { MainAgentScopeBadgesComponent, type MainAgentScopeField } from './main-agent-scope-badges.component';
import { ProviderConnectionCardComponent } from './provider-connection-card.component';
import type { ProviderConnectionCardStatus } from './provider-connection-card.state';
import {
  ProviderSetupWizardComponent, type ProviderWizardCommit, type WizardCommitState,
} from './provider-setup-wizard.component';
import { ConnectionDetailDrawerComponent } from './connection-detail-drawer.component';
import { RoutingMapComponent } from './routing-map.component';
import { MainAgentReassignPopoverComponent, type MainAgentFocus } from './main-agent-reassign-popover.component';
import { ProviderCatalogModalComponent } from './provider-catalog-modal.component';
import type { OverviewConnectionStatus } from './connection-drawer/overview-tab.component';
// Type-only: the Credentials tab and its helpers stay in the drawer's deferred chunk (the write runner is tiny).
import type { CredentialsCommit, CredentialsExternalAuth } from './connection-drawer/credentials-tab.component';
import { runDrawerWrite } from './connection-drawer/drawer-write';
import { connectionUsage } from './connection-usage';

/** Deep-link sections the Providers tab owns. Background roles and CLI agents are on Orchestration. */
export type ProvidersSettingsFocusTarget =
  | 'main-agent' | 'main-model' | 'main-effort' | 'connections' | 'more-providers';

const CONTROL = 'btn btn-outline btn-sm min-h-9 min-w-6 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Providers tab composition. All host access and persistence belong to the injected state owner;
 * the model-catalogue loader is provided once by `SettingsComponent`.
 */
@Component({
  selector: 'ptah-providers-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MainAgentScopeBadgesComponent, ProviderConnectionCardComponent, ProviderSetupWizardComponent,
    ConnectionDetailDrawerComponent, RoutingMapComponent, MainAgentReassignPopoverComponent, ProviderCatalogModalComponent],
  template: `
    <div class="h-full overflow-y-auto bg-base-100 font-sans text-sm text-base-content">
      <!-- No width or side padding of its own: the Settings shell (settings.component.html) already sets
           max-w-4xl and the page padding, which used to be applied twice (Batch 24, card grid width). -->
      <!-- Prototype order (plan :580-583): routing map, then Connections (header, grid, tile), then the catalog hint.
           No page title, no Refresh: the tab names the page, and every region retries its own read. -->
      <div class="py-3 space-y-4">
        <!-- Main-agent region. Loading shows as the nodes' skeletons (aria-busy here keeps captures waiting). -->
        <div class="space-y-2" [attr.aria-busy]="mainReadsLoading()" data-testid="main-agent-region">
        <!-- The Main Agent node holds the D16 badges and opens the Main Agent popover (provider, model, effort).
             Deferred with the popover (eager route at its bundle budget) behind a same-footprint placeholder. -->
        @defer (on immediate) {
        <ptah-routing-map (nodeActivated)="$event === 'main-agent' && openMainPopover()">
          <ptah-main-agent-reassign-popover main-agent-popover [open]="mainPopover() !== null"
            [initialFocus]="mainPopover()?.focus ?? null" (closed)="mainPopover.set(null)" />
          <div main-agent-badges class="contents" data-testid="main-scope-badges">
            <!-- Batch 52.6: one badge per overridden layer ("Workspace override"), listing its fields (prototype). -->
            <ptah-main-agent-scope-badges [fields]="mainScopeFields()" [workspaceName]="workspaceName()"
              (clearRequested)="reviewClear($event.key, $event.target)" />
          </div>
        </ptah-routing-map>
        } @placeholder {
          <div class="min-h-[178px] rounded-xl border border-base-300 bg-base-200/40 p-3" aria-busy="true" data-testid="routing-map-placeholder"></div>
        }
        <!-- The route's own failure is shown (with Retry) inside the Main Agent node; these are its other reads. -->
        @for (section of mainReadErrors(); track section.id) {
          <div role="alert" [class]="readError" [attr.data-read-error]="section.id">
            <p class="min-w-0">{{ section.title }} could not be loaded. Your saved settings have not changed.</p>
            <button type="button" [class]="retryControl" (click)="section.retry()">Retry {{ section.label }}</button>
          </div>
        }
        @if (clearKey(); as key) {
          <section class="rounded-md border border-base-content-muted p-3 space-y-3" aria-label="Review clear override">
            @if (clearTarget() === 'all-above-global') {
              <p>Use the global {{ settingLabel(key) }} value. Removes the workspace and App overrides above Global. Removing the App override also affects its other workspaces.</p>
            } @else {
              <p>Clear {{ settingLabel(key) }} override. The host will resolve the next stored source.</p>
              <p>Next source: {{ state.scopeEntry(key)?.fallbackPreview?.scope ?? 'App default' }}.</p>
            }
            @if (clearEndsSessions(key)) {
              <p data-testid="clear-ends-sessions">Clearing this override ends running chat sessions. It cannot be undone from here.</p>
            }
            <button type="button" [class]="control" (click)="clearOverride()" [disabled]="saving()">Confirm clear override</button>
            <button type="button" [class]="control" (click)="clearKey.set(null)" [disabled]="saving()">Cancel clear</button>
          </section>
        }
        </div>

        <section aria-labelledby="providers-connections-heading" class="space-y-3" [attr.aria-busy]="state.connections().status === 'loading'">
          <!-- Header (prototype): title + count pill left; filter and the primary "Connect provider" right. -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id="providers-connections-heading" data-focus="connections" tabindex="-1" class="text-sm font-semibold scroll-mt-4">Connections</h2>
              @if (state.connections().status === 'ready') {
                <span class="rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[11px] text-base-content" data-testid="connections-count">
                  {{ connections().length }} configured · {{ catalog().length }} available in catalog</span>
              }
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <input type="search" [class]="'input input-bordered input-sm h-9 min-h-9 w-44 border-base-content-muted bg-base-100 text-xs text-base-content ' + focusRing"
                placeholder="Filter connections…" aria-label="Filter connections" data-testid="connections-filter"
                [value]="filter()" (input)="filter.set(inputValue($event))" />
              <button type="button" [class]="'btn btn-primary btn-sm min-h-9 gap-1 ' + focusRing" (click)="openCatalog()" data-testid="connect-provider">
                <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>Connect provider
              </button>
            </div>
          </div>
          @if (state.connections().status === 'error') {
            <div role="alert" [class]="readError" data-read-error="connections">
              <p class="min-w-0">Providers could not be loaded. Your saved settings have not changed.</p>
              <button type="button" [class]="retryControl" (click)="state.refreshConnections()">Retry providers</button>
            </div>
          }
          @if (state.connections().status === 'ready' && connections().length === 0) { <p>No connections configured. Connect a provider to get started.</p> }
          @if (filter() && connections().length && !shownConnections().length) {
            <p role="status" data-testid="connections-filter-empty">No connections match “{{ filter() }}”.
              <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 text-base-content underline ' + focusRing" (click)="filter.set('')">Clear filter</button></p>
          }
          <!-- Compact cards (≤ 80 px): the whole card opens the drawer, which holds every per-state action but one.
               Columns come from the CONTAINER width (Q-extra-1): 3 in VS Code at 1024 px, 2 in the narrower Electron page. -->
          <div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" data-testid="connections-grid">
            @for (connection of shownConnections(); track connection.id) {
              <ptah-provider-connection-card [attr.data-connection-id]="connection.id" [providerId]="connection.id" [providerName]="connection.name" [authModality]="connection.authMode"
                [sourceLabel]="connection.hasKey ? 'Key stored locally' : null" [authModalityText]="connection.custom ? 'Custom' : null"
                [status]="connectionStatus(connection)" [isActive]="activeId() === connection.id" [positiveProbeEvidence]="hasProbeEvidence(connection.id)"
                [isBlocked]="isBlocked(connection.id)" [lastCheck]="lastCheckOf(connection.id)" [routeProbedAt]="state.route().data?.probedAt ?? null"
                [usedByCount]="usage().complete ? (usage().byProvider[connection.id]?.length ?? 0) : null"
                (detailsRequested)="openDrawer(connection.id)"
                (setupRequested)="openWizard(connection.id)" (addKeyRequested)="openWizard(connection.id)"
                (replaceKeyRequested)="openWizard(connection.id)" (signInRequested)="externalAction(connection.id, 'sign-in')"
                (retryRequested)="checkFromCard(connection.id)" (checkAgainRequested)="externalAction(connection.id, 'cli-check')"
                (checkConnectionRequested)="checkFromCard(connection.id)" />
            }
            <!-- Prototype tile: the catalog modal from inside the grid. -->
            <button type="button" [class]="'flex min-h-[80px] items-center justify-center gap-2 rounded-xl border border-dashed border-base-300 p-3 text-xs font-medium text-base-content hover:border-primary ' + focusRing"
              (click)="openCatalog()" data-testid="connect-another-provider">
              <span class="h-2 w-2 rounded-full bg-primary" aria-hidden="true"></span> + Connect another provider
            </button>
          </div>
          <!-- Catalog hint strip, directly under the grid (prototype): one row, the names truncate (full list in the
               title), "Browse catalog →" right-aligned. -->
          <div class="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content-muted"
            data-testid="catalog-hint">
            <p class="min-w-0 flex-1 truncate" [attr.title]="catalogHint().names || null" data-testid="catalog-hint-text">
              <span class="font-semibold text-base-content">{{ catalogHint().lead }}</span> {{ catalogHint().names }}</p>
            <button type="button" data-focus="more-providers" [class]="'btn btn-ghost btn-xs ml-auto min-h-6 shrink-0 font-semibold text-base-content underline ' + focusRing"
              (click)="openCatalog()">Browse catalog →</button>
          </div>
        </section>
        <!-- Catalog modal: deferred (eager route at its bundle budget); the native <dialog> traps focus and returns it. -->
        @defer (on immediate) {
          <ptah-provider-catalog-modal [open]="catalogOpen()" [providers]="catalog()" [status]="catalogStatus()" [canSetUp]="canStartSetup()"
            (closed)="catalogOpen.set(false)" (providerChosen)="chooseCatalog($event)" (customChosen)="chooseCatalog('')"
            (signInRequested)="catalogSignIn($event)" (retryRequested)="state.refreshConnections()" />
        }

        @if (state.externalAuth().data; as auth) { <p role="status" class="break-words">{{ auth.message }}</p> }
        @if (state.externalAuth().status === 'loading') { <p role="status">Waiting for external sign-in…</p> }
        @if (state.externalAuth().status === 'error') { <p role="alert">Sign-in could not be checked. Retry the named provider action.</p> }
        @if (feedback()) { <p role="status">{{ feedback() }}</p> }
        @if (state.commit().status !== 'idle') {
          <div role="status" class="rounded-md bg-base-100 p-3 space-y-1 break-words" data-testid="providers-commit-feedback">
            @if (saving()) { <p>Saving…</p> }
            @if (state.commit().saved.length) { <p>Saved: {{ state.commit().saved.join(', ') }}.</p> }
            @if (state.commit().unsaved.length) { <p>Not saved: {{ state.commit().unsaved.join(', ') }}.</p> }
            @if (state.commit().unconfirmed.length) { <p>Save not confirmed: {{ state.commit().unconfirmed.join(', ') }}. Check effective values before retrying.</p> }
            <p>{{ state.commit().message }}</p>
          </div>
        }
      </div>
    </div>
    @if (drawerConnection(); as connection) {
      <!-- Mounted only while open: the usage reads run only then, and the drawer restores focus on destroy.
           Deferred into its own chunk: the settings route is eager and at its initial-bundle budget. -->
      @defer (on immediate) {
        <!-- z-[60]: the drawer stacks above the page save toast (fixed, z-50, bottom-right), which would
             otherwise cover the drawer's footer Close. The Models & Tiers tab repeats that feedback inline. -->
        <div class="relative z-[60]">
        <ptah-connection-detail-drawer [connection]="connection" [status]="drawerStatus(connection)" [lastCheck]="lastCheckOf(connection.id)"
          [positiveProbeEvidence]="hasProbeEvidence(connection.id)" [isActive]="activeId() === connection.id"
          [isDriver]="knownDriverId() === connection.id"
          [loading]="state.route().data === null && state.route().status !== 'error'"
          [checking]="state.route().status === 'loading' || drawerCheckRunning(connection.id)" [saving]="saving()" [canEdit]="canStartSetup()"
          [usedBy]="usage().byProvider[connection.id] ?? []" [usageComplete]="usage().complete" [usageError]="usageError()"
          [customProtocol]="state.customEntry(connection.id)?.lane ?? null"
          [credentialsSetup]="credentialsSetup()" [credentialsSetupError]="state.connectionSetup().status === 'error'"
          [credentialsCommit]="drawerCommit()" [externalAuth]="drawerExternalAuth()"
          [verifyDraftConnection]="verifyDraftConnection" [cancelDraftVerification]="cancelDraftVerification"
          (closed)="closeDrawer()" (checkConnectionRequested)="state.checkProviderConnection(connection.id)" (retryUsageRequested)="state.refresh()"
          (setupRequested)="setupFromDrawer($event)" (replaceKeyRequested)="replaceKey($event)"
          (deleteKeyRequested)="deleteKey(connection.id)" (signOutRequested)="signOutCopilot()"
          (externalActionRequested)="drawerExternalAction(connection.id, $event)" />
        </div>
      }
    }
    @if (wizardOpen()) {
      <!-- One wizard instance per setup session: a deep link applied right after a close must start fresh. -->
      @for (session of [wizardSession()]; track session) {
      <ptah-provider-setup-wizard [open]="true" [deepLinkProviderId]="wizardProviderId()" [existingCredentialPresent]="wizardCredentialStored()"
        [verifyDraftConnection]="verifyDraftConnection" [cancelDraftVerification]="cancelDraftVerification"
        [supportedSaveTargets]="globalTarget" [workspaceName]="workspaceName()" [mainRouteExists]="mainRouteExists()"
        [defaultsResolvable]="wizardDefaults()" [externalAuth]="wizardExternalAuth()" [externalMessage]="state.externalAuth().data?.message ?? null"
        [initialSetup]="state.connectionSetup().status === 'ready' ? state.connectionSetup().data : null" [contextChanged]="wizardContextChanged()" [commitDetail]="wizardCommitDetail()"
        (providerChanged)="selectWizardProvider($event)" (reviewContextRequested)="reviewWizardContext()" [commitState]="wizardCommitState()"
        (commitRequested)="commitWizard($event)" (closed)="closeWizard()" (externalActionRequested)="externalAction($event.providerId, $event.action)" />
      }
    }
  `,
})
export class ProvidersSettingsComponent implements OnInit, OnDestroy {
  readonly requestedProviderId = input<string>('');
  /** Emitted once the wizard was opened for {@link requestedProviderId}. */
  readonly requestedProviderConsumed = output<string>();
  readonly focusTarget = input<ProvidersSettingsFocusTarget | null>(null);
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly control = CONTROL;
  protected readonly globalTarget: readonly SettingScope[] = ['global'];
  /** D16 badges of the Main Agent node, in field order: model, effort, authentication, provider (Batch 52.3). */
  protected readonly mainScopeFields = computed<readonly MainAgentScopeField[]>(() => {
    const sources = this.state.mainSources(), saving = this.saving();
    const field = (key: string, fieldName: string, shortFieldName: string, entry: MainAgentScopeField['entry'] | null | undefined,
      disabled: boolean, fallbackValueLabel: string | null = null): MainAgentScopeField[] =>
      entry ? [{ key, fieldName, shortFieldName, entry, supportedTargets: this.state.writeScopes(key), fallbackValueLabel, disabled }] : [];
    const valuesBusy = saving || sources.status !== 'ready', scopesBusy = saving || this.state.scopes().status !== 'ready';
    const model = sources.data?.model, effort = sources.data?.effort, auth = this.state.scopeEntry('authMethod');
    return [
      ...field(model?.key ?? '', 'Main agent model', 'Model', model, valuesBusy),
      ...field(effort?.key ?? '', 'Reasoning effort', 'Effort', effort, valuesBusy),
      ...field('authMethod', 'Main agent authentication', 'Authentication', auth, scopesBusy, auth ? this.authenticationLabel(auth.fallbackPreview?.value) : null),
      ...field('anthropicProviderId', 'Main agent provider', 'Provider', this.state.scopeEntry('anthropicProviderId'), scopesBusy),
    ];
  });
  protected readonly focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
  /** The provider catalog modal is open. */
  protected readonly catalogOpen = signal(false);
  protected readonly wizardOpen = signal(false);
  protected readonly wizardProviderId = signal('');
  /** Incremented per openWizard: keys the wizard instance so every setup session starts from a clean draft. */
  protected readonly wizardSession = signal(0);
  protected readonly wizardCommitState = signal<WizardCommitState>('idle');
  /** The open Main Agent popover: a provider preselected by a card, and a deep-linked control to focus. */
  protected readonly mainPopover = signal<{ focus: MainAgentFocus | null } | null>(null);
  protected readonly clearKey = signal<string | null>(null);
  protected readonly clearTarget = signal<'nearest' | 'all-above-global'>('nearest');
  protected readonly feedback = signal<string | null>(null);
  private focusedTarget: ProvidersSettingsFocusTarget | null = null;
  private lastInputFocus: ProvidersSettingsFocusTarget | null = null;
  private clearContext: ProvidersEditContext | null = null;
  private readonly wizardContext = signal<ProvidersEditContext | null>(null);
  private readonly selectedWizardProvider = signal('');
  protected readonly wizardDefaults = computed(() => this.state.connections().data?.find((entry) => entry.id === this.selectedWizardProvider())?.defaultsResolvable ?? false);
  /** From auth:getApiKeyStatus (third-party) / auth:getAuthStatus.hasApiKey (Claude API), via connections. */
  protected readonly wizardCredentialStored = computed(() => this.state.connections().data?.find((entry) => entry.id === this.selectedWizardProvider())?.hasKey === true);
  protected readonly wizardExternalAuth = computed(() => {
    const auth = this.state.externalAuth();
    if (auth.data?.providerId !== this.selectedWizardProvider()) return { signInState: 'idle' as const, accountLabel: null, cliInstalled: null };
    return { ...auth.data, signInState: auth.status === 'loading' ? 'in-flight' as const : auth.status === 'error' ? 'failed' as const : auth.data.signInState };
  });
  protected readonly wizardContextChanged = computed(() => {
    const before = this.wizardContext(), now = this.state.reviewContext();
    return !!before && (!now || before.scopeKey !== now.scopeKey || before.activePath !== now.activePath);
  });
  protected readonly wizardCommitDetail = computed(() => {
    if (this.wizardCommitState() === 'idle') return '';
    const result = this.state.commit();
    return [result.saved.length ? 'Saved: ' + result.saved.join(', ') : '', result.unsaved.length ? 'Not saved: ' + result.unsaved.join(', ') : '', result.unconfirmed.length ? 'Not confirmed: ' + result.unconfirmed.join(', ') : '', result.message].filter(Boolean).join('. ');
  });
  private returnFocus: HTMLElement | null = null;
  /** What opened the catalog modal ("Connect provider", the tile, "Browse catalog →"). */
  private catalogOpener: HTMLElement | null = null;
  /** Deep-linked provider handed to the open wizard and not yet accepted by it. */
  private deepLinkAwaitingAcceptance: string | null = null;
  protected readonly saving = computed(() => this.state.commit().status === 'saving');
  protected readonly workspaceName = computed(() => this.state.scopes().data?.activePath?.split(/[\\/]/).filter(Boolean).pop() ?? null);
  protected readonly canStartSetup = computed(() => this.state.connections().status === 'ready' && this.state.scopes().status === 'ready' && !this.saving());
  protected readonly mainRouteExists = computed(() => this.state.route().status === 'ready' && !!this.state.route().data?.driverProviderId && this.state.route().data?.route !== 'unresolved');
  protected readonly activeId = computed(() => {
    const route = this.state.route(); const id = this.state.activeProviderId();
    return route.status === 'ready' && route.data?.ready && route.data.driverProviderId === id && !this.saving() ? id : null;
  });
  protected readonly connections = computed(() => {
    const selected = this.state.route().data?.driverProviderId;
    const unique = new Map((this.state.connections().data ?? []).map((entry) => [entry.id, entry]));
    return [...unique.values()].filter((entry) => entry.configured || entry.id === selected)
      .sort((left, right) => Number(right.id === this.activeId()) - Number(left.id === this.activeId()));
  });
  protected readonly catalog = computed(() => {
    const configured = new Set(this.connections().map((entry) => entry.id));
    return (this.state.connections().data ?? []).filter((entry) => !configured.has(entry.id));
  });
  /** A failed connections read (it includes `provider:listCustomEntries`) is shown in the catalog, never as empty. */
  protected readonly catalogStatus = computed(() => {
    const connections = this.state.connections();
    return connections.status === 'error' ? 'error' : connections.data === null ? 'loading' : 'ready';
  });
  /** The hint strip's sentence: never "0 providers" for a failed or pending read. */
  protected readonly catalogHint = computed(() => {
    const count = this.catalog().length;
    switch (this.catalogStatus()) {
      case 'error': return { lead: 'The provider catalog could not be loaded.', names: '' };
      case 'loading': return { lead: 'Loading the provider catalog…', names: '' };
      default: return count
        ? { lead: `${count} catalog provider${count === 1 ? '' : 's'} ready to add:`, names: this.catalog().map((entry) => entry.name).join(', ') }
        : { lead: 'Every catalog provider is connected.', names: '' };
    }
  });
  /** The connection whose detail drawer is open (the clicked card, `detailsRequested`). */
  private readonly drawerId = signal<string | null>(null);
  /** The card button that opened the drawer; setup opened from the drawer returns focus here. */
  private drawerOpener: HTMLElement | null = null;
  protected readonly drawerConnection = computed(() => {
    const id = this.drawerId();
    return id ? this.state.connections().data?.find((entry) => entry.id === id) ?? null : null;
  });
  /** Outcome of the drawer's own last write; never an earlier save's (D15). */
  protected readonly drawerCommit = signal<CredentialsCommit | null>(null);
  /** Bumped on every drawer open and close: a write that resolves later publishes to its own session only. */
  private drawerSession = 0;
  /** The connection whose sign-in the drawer started; only that one's progress shows in the drawer. */
  private readonly drawerExternalFor = signal<string | null>(null);
  /** The last loaded route's driver. Survives a save and a not-ready route (broken key), unlike `activeId`. */
  protected readonly knownDriverId = signal<string | null>(null);
  protected readonly drawerExternalAuth = computed<CredentialsExternalAuth>(() => {
    const id = this.drawerId(), auth = this.state.externalAuth();
    if (!id || this.drawerExternalFor() !== id) return { status: 'idle', message: null };
    if (auth.status === 'loading' || auth.status === 'error') return { status: auth.status, message: null };
    return { status: 'idle', message: auth.data?.providerId === id ? auth.data.message : null };
  });
  /** Stored endpoint and main-agent tiers of the open connection (a Replace keeps the tiers as stored). */
  protected readonly credentialsSetup = computed(() => {
    const setup = this.state.connectionSetup();
    return setup.status === 'ready' && setup.data && setup.data.providerId === this.drawerId()
      ? { baseUrl: setup.data.baseUrl, tiers: setup.data.tiers } : null;
  });
  /** Who uses each connection. `undefined`/`null` sources mean "not loaded" (see connection-usage.ts). */
  protected readonly usage = computed(() => {
    const route = this.state.route(), memory = this.state.memory(), lanes = this.state.lanes();
    const judging = this.state.judging(), agents = this.state.cliAgents(), clis = this.state.orchestration();
    return connectionUsage({
      mainProviderId: route.status !== 'ready' ? undefined
        : route.data?.route !== 'unresolved' ? route.data?.driverProviderId ?? null : null,
      curatorProvider: memory.status === 'ready' ? memory.data?.curatorProvider ?? '' : null,
      lanes: lanes.status === 'ready' ? lanes.data : null,
      judgeProvider: judging.status === 'ready' ? judging.data?.judgeProvider ?? '' : null,
      cliAgents: agents.status === 'ready' ? agents.data : null,
      // The Codex CLI's detection and on/off state (`agent:getConfig`); "Codex CLI" counts under OpenAI Codex.
      systemClis: clis.status === 'ready' ? clis.data : null,
    });
  });
  protected readonly usageError = computed(() =>
    [this.state.route(), this.state.memory(), this.state.lanes(), this.state.judging(), this.state.cliAgents(), this.state.orchestration()]
      .some((section) => section.status === 'error'));
  /** The Main Agent region's reads other than the route (whose error and Retry live in the Main Agent node). */
  private readonly mainReads = computed(() => [
    { id: 'scopes', title: 'Setting sources', label: 'setting sources', state: this.state.scopes(), retry: () => this.state.refreshScopes() },
    { id: 'model', title: 'The main-agent model', label: 'main-agent model', state: this.state.model(), retry: () => this.state.refreshModel() },
    { id: 'main-sources', title: 'Model and effort sources', label: 'model and effort sources', state: this.state.mainSources(), retry: () => this.state.refreshMainSources() },
    { id: 'effort', title: 'The main-agent reasoning effort', label: 'main-agent reasoning effort', state: this.state.effort(), retry: () => this.state.refreshEffort() },
  ]);
  /** Failed reads of the Main Agent region, each with its own "Retry {label}" right under the routing map. */
  protected readonly mainReadErrors = computed(() => this.mainReads().filter((read) => read.state.status === 'error'));
  protected readonly mainReadsLoading = computed(() => [this.state.route(), ...this.mainReads().map((read) => read.state)]
    .some((section) => section.status === 'loading' || section.status === 'unloaded'));
  protected readonly readError = 'flex flex-wrap items-center gap-2 rounded-md border border-base-content-muted bg-base-100 px-3 py-2 text-xs';
  protected readonly retryControl = 'btn btn-outline btn-xs min-h-6 border-base-content-muted text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
  /** The Connections header filter: matches the connection name or id, case-insensitive. */
  protected readonly filter = signal('');
  protected readonly shownConnections = computed(() => {
    const query = this.filter().trim().toLowerCase();
    return query ? this.connections().filter((entry) => `${entry.name} ${entry.id}`.toLowerCase().includes(query)) : this.connections();
  });
  protected inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }

  constructor() {
    effect(() => {
      const route = this.state.route();
      if (route.status === 'ready') untracked(() => this.knownDriverId.set(route.data?.driverProviderId ?? null));
    });
    // A connection removed while its drawer is open closes the drawer for good: only a loaded list that
    // no longer holds the id clears it, so a refresh (data kept while loading) leaves the drawer open.
    effect(() => {
      const id = this.drawerId(), connections = this.state.connections();
      if (!id || connections.status !== 'ready' || connections.data?.some((entry) => entry.id === id)) return;
      untracked(() => {
        this.drawerId.set(null);
        if (this.drawerOpener?.isConnected) this.drawerOpener.focus();
        this.drawerOpener = null;
      });
    });
    // Deep link (e.g. Tribunal "Configure"): open setup for that provider once setup can start.
    // - While the wizard is open (on any provider) a request stays PENDING and is applied when the
    //   wizard closes; an open draft is never switched away from under the user.
    // - The request is reported consumed only once the wizard has accepted the provider
    //   (see selectWizardProvider), or when that wizard session is dismissed.
    // - The guard is per request: when the parent clears the input, a fresh request for the same
    //   provider opens again, while an unrelated re-render with the same request does not.
    let openedFor = '';
    effect(() => {
      const provider = this.requestedProviderId();
      if (!provider) { openedFor = ''; return; }
      if (provider === openedFor || !this.canStartSetup() || this.wizardOpen()) return;
      openedFor = provider;
      untracked(() => {
        this.deepLinkAwaitingAcceptance = provider;
        this.openWizard(provider);
      });
    });
    afterRenderEffect(() => {
      if (this.focusTarget() !== this.lastInputFocus) {
        this.lastInputFocus = this.focusTarget(); this.focusedTarget = null;
      }
      const target = this.focusTarget();
      if (!target || target === this.focusedTarget) return;
      // `main-*` rows land on the Main Agent popover, focused on that control (its own `data-focus`).
      if (target === 'main-agent' || target === 'main-model' || target === 'main-effort') {
        this.focusedTarget = target;
        untracked(() => this.openMainPopover(target));
        return;
      }
      // `more-providers` lands on the catalog modal; focus returns to "Browse catalog →" when it closes.
      if (target === 'more-providers') {
        this.element.nativeElement.querySelector<HTMLElement>('[data-focus="more-providers"]')?.focus();
        this.focusedTarget = target;
        untracked(() => this.openCatalog());
        return;
      }
      const node = this.element.nativeElement.querySelector<HTMLElement>(`[data-focus="${target}"]`);
      if (node) { node.focus(); this.focusedTarget = target; }
    });
  }
  ngOnInit(): void { void this.state.open(); }
  ngOnDestroy(): void {
    if (this.wizardOpen()) {
      void this.state.cancelVerification().catch((error: unknown) => {
        const errorType = error instanceof Error ? error.constructor.name : typeof error;
        console.error('[ProvidersSettingsComponent] Cancel verification on destroy failed:', errorType);
      });
    }
  }
  protected authenticationLabel(value: unknown): string {
    return value === 'apiKey' ? 'API key' : value === 'claudeCli' ? 'CLI subscription' : value === 'thirdParty' ? 'Provider connection' : 'Host-resolved authentication';
  }
  protected settingLabel(key: string): string {
    return key === 'authMethod' ? 'authentication' : key === this.state.mainSources().data?.model?.key ? 'main agent model'
      : key === this.state.mainSources().data?.effort?.key ? 'reasoning effort' : 'provider';
  }
  protected connectionStatus(entry: ProvidersConnection): ProviderConnectionCardStatus {
    // Batch 53.2: this connection's own check is running (from its card or its drawer).
    if (this.drawerCheckRunning(entry.id)) return 'checking';
    if (this.activeId() === entry.id) return 'active';
    if (this.state.route().status !== 'ready') return this.state.route().status === 'loading' ? 'checking' : 'check-unavailable';
    return this.state.route().data?.providers.find((provider) => provider.id === entry.id)?.status ?? 'not-checked';
  }
  /**
   * The drawer names a failed route read, or a failed check request for this connection, "Check failed"
   * (retryable), not "Check unavailable"; its own running check reads "Checking…".
   */
  protected drawerStatus(entry: ProvidersConnection): OverviewConnectionStatus {
    const check = this.state.connectionCheck();
    const own = check?.providerId === entry.id ? check.status : null;
    if (own === 'checking') return 'checking';
    return this.state.route().status === 'error' || own === 'failed' ? 'check-failed' : this.connectionStatus(entry);
  }
  /**
   * Batch 53.2 (B38-2): a card's Check connection / Retry checks only its own connection, as the drawer does
   * (`checkProviderConnection`: `auth:checkConnection` for API-key, custom, CLI and sign-in connections, which records
   * `lastCheck`, then the route re-read; local servers and key-optional routes the host cannot check, such as Ollama,
   * LM Studio and Ollama Cloud, get the route re-read alone). While the route itself failed to load, the card reads
   * "Check unavailable" and Retry keeps the full re-read, which is what can repair it. D3: nothing starts while a check
   * or a save runs. The action leaves the card face while it reads "Checking…", so focus moves to the card itself.
   */
  protected checkFromCard(id: string): void {
    if (this.state.route().status !== 'ready') {
      void this.state.checkConnection();
      return;
    }
    if (this.saving() || this.state.connectionCheck()?.status === 'checking') return;
    void this.state.checkProviderConnection(id);
    afterNextRender(() => this.element.nativeElement
      .querySelector<HTMLElement>(`ptah-provider-connection-card[data-connection-id="${id}"] [role="button"]`)?.focus(),
    { injector: this.injector });
  }
  protected drawerCheckRunning(id: string): boolean {
    const check = this.state.connectionCheck();
    return check?.providerId === id && check.status === 'checking';
  }
  /** The connection's last recorded check, from the route read (`auth:getEffectiveRoute` `providers[].lastCheck`). */
  protected lastCheckOf(id: string): ConnectionCheckRecord | null {
    return this.state.route().data?.providers.find((provider) => provider.id === id)?.lastCheck ?? null;
  }
  /** Per-provider verdict from the effective route; null when the host cannot check it (skipped/unknown). */
  protected hasProbeEvidence(id: string): boolean | null {
    const route = this.state.route();
    if (route.status !== 'ready') return false;
    if (this.isUncheckable(id)) return null;
    const status = route.data?.providers.find((provider) => provider.id === id)?.status;
    return status === 'connected' || status === 'reachable';
  }
  protected isUncheckable(id: string): boolean {
    const status = this.state.route().data?.providers.find((provider) => provider.id === id)?.status;
    return status === 'skipped' || status === 'unknown';
  }
  protected isBlocked(id: string): boolean { return this.state.route().status === 'ready' && this.state.route().data?.driverProviderId === id && !this.state.route().data?.ready; }
  protected openDrawer(providerId: string): void {
    const active = this.element.nativeElement.ownerDocument.activeElement;
    this.drawerOpener = active instanceof HTMLElement ? active : null;
    this.drawerId.set(providerId);
    this.resetDrawerSession();
    void this.state.refreshConnectionSetup(providerId);
  }
  protected closeDrawer(): void { this.drawerId.set(null); this.resetDrawerSession(); }
  private resetDrawerSession(): void {
    this.drawerSession += 1;
    this.drawerCommit.set(null);
    this.drawerExternalFor.set(null);
  }
  protected drawerExternalAction(providerId: string, action: ProvidersExternalAuthAction): void {
    this.drawerExternalFor.set(providerId);
    this.externalAction(providerId, action);
  }
  protected deleteKey(providerId: string): Promise<void> {
    return this.drawerWrite((context) => this.state.deleteStoredKey(providerId, context));
  }
  protected signOutCopilot(): Promise<void> {
    return this.drawerWrite((context) => this.state.disconnectCopilot(context));
  }
  /** The drawer builds the verified Replace draft (`replaceKeyDraft`); this only runs the write. */
  protected replaceKey(draft: ProvidersConnectionDraft): Promise<void> {
    return this.drawerWrite((context) => this.state.connectProvider(draft, context));
  }
  /** Runs one drawer write (`runDrawerWrite`); a result that lands after the drawer closed or reopened is dropped. */
  protected drawerWrite(write: (context: ProvidersEditContext) => Promise<boolean>): Promise<void> {
    const session = this.drawerSession;
    return runDrawerWrite(this.state, write, (outcome) => { if (session === this.drawerSession) this.drawerCommit.set(outcome); });
  }
  /**
   * "Edit in setup" from a drawer tab: close the drawer, put focus back on the card that opened it,
   * then open the wizard, so closing the wizard returns focus to that card too.
   */
  protected setupFromDrawer(providerId: string): void {
    this.closeDrawer();
    if (this.drawerOpener?.isConnected) this.drawerOpener.focus();
    this.openWizard(providerId);
  }
  protected openWizard(providerId: string): void {
    if (!this.canStartSetup()) return;
    this.wizardContext.set(this.state.reviewContext());
    this.returnFocus = this.element.nativeElement.ownerDocument.activeElement as HTMLElement | null;
    this.wizardProviderId.set(providerId);
    this.wizardSession.update((session) => session + 1);
    this.wizardCommitState.set('idle');
    this.feedback.set(null);
    this.wizardOpen.set(true);
  }
  readonly verifyDraftConnection = async (params: AuthVerifyDraftConnectionParams) => {
    await this.state.verifyDraft(params);
    const result = this.state.verification();
    if (result.status !== 'ready' || result.data?.probeId !== params.probeId) throw new Error('Connection check unavailable. Retry.');
    return result.data;
  };
  readonly cancelDraftVerification = (params: AuthCancelDraftVerificationParams) => this.state.cancelVerification(params);
  protected async commitWizard(draft: ProviderWizardCommit): Promise<void> {
    const context = this.wizardContext();
    if (!context || this.saving() || this.wizardContextChanged()) return;
    this.wizardCommitState.set('saving');
    await this.state.connectProvider(draft, context);
    const confirmed = this.state.commit().status === 'saved' &&
      [this.state.route(), this.state.connections(), this.state.scopes()].every((section) => section.status === 'ready');
    this.wizardCommitState.set(confirmed ? 'saved' : 'failed');
    // m2 (Providers 21-28 review): a new or re-set connection must be visible; old filter text could hide it.
    if (confirmed) this.filter.set('');
    this.feedback.set(confirmed ? 'Connection settings saved and refreshed.' : 'Some connection settings were not confirmed. Review the saved and unsaved fields below.');
  }
  protected selectWizardProvider(providerId: string): void {
    this.selectedWizardProvider.set(providerId);
    if (!providerId) return;
    if (providerId === this.deepLinkAwaitingAcceptance) this.consumeDeepLink();
    void this.state.refreshConnectionSetup(providerId);
    const connection = this.state.connections().data?.find((entry) => entry.id === providerId);
    if (connection?.authMode === 'oauth' || connection?.authMode === 'cli') this.externalAction(providerId, 'cli-check');
  }
  protected async reviewWizardContext(): Promise<void> {
    await this.state.refreshScopes();
    this.wizardContext.set(this.state.reviewContext());
    this.wizardCommitState.set('idle');
  }
  /** One-shot: the parent clears the request so a re-mounted page does not reopen it. */
  private consumeDeepLink(): void {
    const provider = this.deepLinkAwaitingAcceptance;
    if (!provider) return;
    this.deepLinkAwaitingAcceptance = null;
    this.requestedProviderConsumed.emit(provider);
  }
  protected closeWizard(): void {
    // A deep link the wizard could not select (e.g. an unknown id) is still handled once dismissed.
    this.consumeDeepLink();
    this.wizardOpen.set(false);
    this.wizardContext.set(null);
    this.feedback.set(this.wizardCommitState() === 'saved' ? 'Connection settings saved.' : 'Setup closed. External sign-in, if completed, remains available.');
    void this.state.cancelVerification().catch((error: unknown) => {
      const errorType = error instanceof Error ? error.constructor.name : typeof error;
      console.error('[ProvidersSettingsComponent] Cancel verification on wizard close failed:', errorType);
    });
    this.returnFocus?.focus();
  }
  protected externalAction(providerId: string | null, action: ProvidersExternalAuthAction): void { void this.state.performExternalAuth(providerId, action); }
  /**
   * Opens the catalog modal; the native dialog returns focus to the opener when it closes. Opening is a read, so the
   * openers stay enabled: a failed connections read is shown inside (with Retry), and setup is gated by `canSetUp`.
   */
  protected openCatalog(): void {
    const active = this.element.nativeElement.ownerDocument.activeElement;
    this.catalogOpener = active instanceof HTMLElement ? active : null;
    this.catalogOpen.set(true);
  }
  /** A catalog choice: the modal closes, then the unchanged wizard opens (`''` = custom endpoint, nothing preselected). */
  protected chooseCatalog(providerId: string): void {
    this.catalogOpen.set(false);
    this.openWizard(providerId);
    // Closing the wizard returns focus to what opened the catalog, not to the (gone) modal button.
    this.returnFocus = this.catalogOpener;
  }
  protected catalogSignIn(providerId: string): void {
    this.catalogOpen.set(false);
    this.externalAction(providerId, 'sign-in');
  }
  /** Opens the Main Agent popover (the node's "Reassign", a `main-*` deep link focused on that control). */
  protected openMainPopover(focus: MainAgentFocus | null = null): void {
    this.mainPopover.set({ focus });
  }
  /** D6: clearing these keys resets the SDK on the host (`config-scope-rpc.handlers.ts:120-145`). */
  protected clearEndsSessions(key: string): boolean {
    return key === 'authMethod' || key === 'anthropicProviderId' || key.startsWith('provider.');
  }
  protected reviewClear(key: string, target: 'nearest' | 'all-above-global' = 'nearest'): void {
    this.clearContext = this.state.reviewContext(); this.clearKey.set(key); this.clearTarget.set(target);
  }
  protected async clearOverride(): Promise<void> {
    const key = this.clearKey(); if (!key || !this.clearContext) return;
    await this.state.clearScopeOverride(key, this.clearTarget(), this.clearContext);
    if (this.state.commit().status === 'saved') this.clearKey.set(null);
  }
}
