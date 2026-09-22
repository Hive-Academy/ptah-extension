import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit,
  afterRenderEffect, computed, inject, input, signal,
} from '@angular/core';
import {
  ProvidersSettingsStateService, type ProvidersConnection, type ProvidersEditContext,
  type ProvidersExternalAuthAction,
} from '@ptah-extension/core';
import { NativeCardComponent, ProviderModelPickerComponent } from '@ptah-extension/ui';
import type { SettingScope, EffortLevel, AuthVerifyDraftConnectionParams, AuthCancelDraftVerificationParams } from '@ptah-extension/shared';
import { SettingScopeRowComponent } from './setting-scope-row.component';
import { ProviderConnectionCardComponent, type ProviderConnectionCardStatus } from './provider-connection-card.component';
import {
  ProviderSetupWizardComponent, type ProviderWizardCommit, type WizardCommitState,
} from './provider-setup-wizard.component';
import { PtahCliConfigComponent } from '../ptah-ai/ptah-cli-config.component';
import {
  ProviderConsumerAssignmentsComponent, type BackgroundConsumerId,
} from './provider-consumer-assignments.component';

export type ProvidersSettingsFocusTarget =
  | 'main-agent' | 'main-model' | 'main-effort' | 'connections' | 'background-models' | 'cli-agents' | 'more-providers'
  | BackgroundConsumerId;


const CONTROL = 'btn btn-outline btn-sm min-h-9 min-w-6 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FIELD = 'input input-bordered input-sm min-h-9 w-full border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/** Unmounted page composition. All host access and persistence belong to the injected state owner. */
@Component({
  selector: 'ptah-providers-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PtahCliConfigComponent, NativeCardComponent, ProviderModelPickerComponent, SettingScopeRowComponent,
    ProviderConnectionCardComponent, ProviderSetupWizardComponent, ProviderConsumerAssignmentsComponent],
  template: `
    <div class="h-full overflow-y-auto bg-base-100 font-sans text-sm text-base-content">
      <div class="max-w-4xl mx-auto px-3 py-3 md:px-6 lg:px-8 space-y-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <h1 class="text-lg font-semibold">Providers</h1>
            @if (state.connections().status === 'ready') {
              <p>{{ state.connections().data?.length }} providers · {{ connections().length }} configured</p>
            }
            @if (state.scopes().data; as scopes) {
              @if (scopes.activePath) {
                <p class="font-medium">Workspace: {{ workspaceName() }}</p>
                <p class="break-all select-text bg-base-100 text-xs text-base-content-muted">{{ scopes.activePath }}</p>
              } @else { <p>No workspace open. Workspace overrides are unavailable.</p> }
            }
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" [class]="control" (click)="openWizard('')" [disabled]="!canStartSetup()">Connect provider</button>
            <button type="button" [class]="control" (click)="state.refresh()" [disabled]="saving()">Refresh settings</button>
          </div>
        </header>

        @for (section of readStates(); track section.id) {
          @if (section.state.status === 'error') {
            <div role="alert" class="rounded-md border border-base-content-muted bg-base-100 p-3 space-y-2" [attr.data-read-error]="section.id">
              <p>{{ section.label }} could not be loaded. Your saved settings have not changed.</p>
              <button type="button" [class]="control" (click)="section.retry()">Retry {{ section.label }}</button>
            </div>
          } @else if (section.state.status === 'loading' || section.state.status === 'unloaded') {
            <p role="status" aria-live="polite" [attr.data-read-loading]="section.id">Loading {{ section.label }}…</p>
          }
        }

        <section aria-labelledby="providers-main-heading" class="space-y-3" [attr.aria-busy]="state.route().status === 'loading'">
          <h2 id="providers-main-heading" data-focus="main-agent" tabindex="-1" class="text-sm font-semibold scroll-mt-4 outline-offset-2">Main agent</h2>
          <ptah-native-card density="compact" tone="secondary" [spine]="true" [clickable]="false">
            <div class="space-y-3 min-w-0">
              @if (state.route().status === 'ready') {
                @if (state.route().data; as route) {
                  @if (route.driverProviderId && route.route !== 'unresolved') {
                    <p class="font-semibold break-words">Next request uses: {{ providerName(route.driverProviderId) }} · {{ modalityLabel(route.resolvedAuthModality) }}</p>
                    @if (!route.ready) { <p>Main agent · Needs attention</p> }
                    @switch (route.resolvedModel.kind) {
                      @case ('model') { <p class="break-all">Model: {{ route.resolvedModel.id }}</p> }
                      @case ('tier') { <p>Model tier: {{ route.resolvedModel.tier }}</p> }
                      @case ('unresolved') { <p>Model has not been resolved.</p> }
                    }
                  } @else { <p>Choose a provider to start the main agent.</p> }
                }
              } @else if (state.route().status === 'error') {
                <p>Main-agent route unavailable. Check connection to refresh.</p>
              } @else { <p>Loading providers…</p> }
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" [class]="control" (click)="requestFocus('connections')">Change main provider</button>
                <button type="button" [class]="control" (click)="editModel()" [disabled]="state.model().status !== 'ready' || state.mainSources().status !== 'ready' || saving()">Edit model</button>
                <button type="button" [class]="control" (click)="state.checkConnection()" [disabled]="state.route().status === 'loading'">Check connection</button>
              </div>
              @if (state.effort().status === 'ready') {
                <div class="space-y-2" data-focus="main-effort" tabindex="-1">
                  <p>Reasoning effort: {{ state.effort().data?.effort ?? 'Provider default' }}</p>
                  <label for="providers-effort">Reasoning effort for new requests</label>
                  <select id="providers-effort" [class]="field" [value]="effortDraft() ?? state.effort().data?.effort ?? ''" (change)="editEffort($event)" [disabled]="saving()">
                    <option value="">Provider default</option>
                    @for (level of effortLevels; track level) { <option [value]="level">{{ level }}</option> }
                  </select>
                  @if (effortDraft() !== null) {
                    <label for="providers-effort-target">Save reasoning effort to</label>
                    <select id="providers-effort-target" [class]="field" [value]="effortTarget()" (change)="setEffortTarget($event)">
                      @for (target of effortTargets(); track target) { <option [value]="target">{{ scopeLabel(target) }}</option> }
                    </select>
                    <p>Broader saves can clear narrower effort overrides.</p>
                    <button type="button" [class]="control" (click)="saveEffort()" [disabled]="saving() || !effortTargets().includes(effortTarget())">Save reasoning effort</button>
                    <button type="button" [class]="control" (click)="effortDraft.set(null)" [disabled]="saving()">Cancel reasoning effort edit</button>
                  }
                </div>
              }
              @if (state.groupScope(mainGroupKeys()); as scope) {
                <ptah-setting-scope-row fieldName="Main agent configuration" [scope]="scope" [disabled]="true" />
              }
              @for (fieldName of mainValueFields; track fieldName) {
                @if (state.mainSources().data?.[fieldName]; as entry) {
                  <ptah-setting-scope-row [fieldName]="fieldName === 'model' ? 'Main agent model' : 'Reasoning effort'" [scope]="entry.scope"
                    [hasOverride]="entry.hasOverride" [supportedTargets]="state.writeScopes(entry.key)" [workspaceName]="workspaceName()"
                    [fallbackPreview]="entry.fallbackPreview" [disabled]="saving() || state.mainSources().status !== 'ready'"
                    (overrideRequested)="overrideMainValue(fieldName)" (clearRequested)="reviewClear(entry.key)"
                    [hasIntermediateAppLayer]="entry.fallbackPreview?.scope === 'app'" (useGlobalRequested)="reviewClear(entry.key, 'all-above-global')" />
                }
              }
              @for (key of mainKeys; track key) {
                @if (state.scopeEntry(key); as entry) {
                  <ptah-setting-scope-row [fieldName]="key === 'authMethod' ? 'Authentication' : 'Provider'"
                    [scope]="entry.scope" [hasOverride]="entry.hasOverride" [supportedTargets]="state.writeScopes(key)"
                    [workspaceName]="workspaceName()" [fallbackPreview]="entry.fallbackPreview" [credentialSource]="entry.credentialSource"
                    [fallbackValueLabel]="key === 'authMethod' ? authenticationLabel(entry.fallbackPreview?.value) : null"
                    [hasIntermediateAppLayer]="entry.fallbackPreview?.scope === 'app'"
                    [disabled]="saving() || state.scopes().status !== 'ready'"
                    (overrideRequested)="beginActivation(state.route().data?.driverProviderId ?? '', 'workspace')"
                    (clearRequested)="reviewClear(key)" (useGlobalRequested)="reviewClear(key, 'all-above-global')" />
                }
              }
            </div>
          </ptah-native-card>
          @if (modelDraft() !== null) {
            <div class="rounded-md border border-base-content-muted p-3 space-y-3" data-focus="main-model" tabindex="-1">
              <h3 class="font-semibold">Main agent model</h3>
              <ptah-provider-model-picker [fixedProvider]="state.route().data?.driverProviderId ?? ''" [model]="modelDraft() ?? ''"
                label="Main agent model" [disabled]="saving()" (selectionChange)="modelDraft.set($event.model)" />
              <label for="providers-model-target">Save to</label>
              <select id="providers-model-target" [class]="field" [value]="saveTarget()" (change)="setTarget($event)">
                @for (target of modelTargets(); track target) { <option [value]="target">{{ scopeLabel(target) }}</option> }
              </select>
              <p>Broader saves can clear more-specific model overrides. Review the destination before saving.</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" [class]="control" (click)="saveModel()" [disabled]="saving() || !modelDraft() || !modelTargets().includes(saveTarget())">Save main agent model</button>
                <button type="button" [class]="control" (click)="modelDraft.set(null)" [disabled]="saving()">Cancel model edit</button>
              </div>
            </div>
          }
        </section>

        <section aria-labelledby="providers-connections-heading" class="space-y-3" [attr.aria-busy]="state.connections().status === 'loading'">
          <h2 id="providers-connections-heading" data-focus="connections" tabindex="-1" class="text-sm font-semibold scroll-mt-4">Your connections</h2>
          @if (state.connections().status === 'ready' && connections().length === 0) { <p>No connections configured. Connect a provider to get started.</p> }
          @for (connection of connections(); track connection.id) {
            <ptah-provider-connection-card [providerId]="connection.id" [providerName]="connection.name" [authModality]="connection.authMode"
              [sourceLabel]="connection.hasKey ? 'Credential: stored on this machine' : null"
              [status]="connectionStatus(connection)" [isActive]="activeId() === connection.id" [positiveProbeEvidence]="activeId() === connection.id"
              [isBlocked]="isBlocked(connection.id)" [canActivateMain]="!saving() && state.route().status === 'ready'" [canManage]="canStartSetup() && connection.id !== 'anthropic'"
              (changeMainProviderRequested)="requestFocus('connections')" (activateMainRequested)="beginActivation(connection.id)"
              (manageRequested)="openWizard(connection.id)" (setupRequested)="openWizard(connection.id)"
              (addKeyRequested)="openWizard(connection.id)" (replaceKeyRequested)="openWizard(connection.id)"
              (signInRequested)="externalAction(connection.id, 'sign-in')" (retryRequested)="state.checkConnection()"
              (editConnectionRequested)="openWizard(connection.id)" (checkAgainRequested)="externalAction(connection.id, 'cli-check')"
              (installInstructionsRequested)="externalAction(connection.id, 'cli-login')" (checkConnectionRequested)="state.checkConnection()" />
            @if (connection.authMode === 'oauth' || connection.authMode === 'cli') {
              <div class="flex flex-wrap gap-2">
                <button type="button" [class]="control" (click)="externalAction(connection.id, 'sign-in')">Sign in to {{ connection.name }}</button>
                <button type="button" [class]="control" (click)="externalAction(connection.id, 'cli-check')">Check {{ connection.name }} sign-in</button>
              </div>
            }
          }
        </section>

        @if (activationId(); as id) {
          <section class="rounded-md border border-base-content-muted p-3 space-y-3" aria-label="Review main provider change">
            <h3 class="font-semibold">Use {{ providerName(id) }} for new main-agent requests.</h3>
            <p>Background consumers that inherit the main provider will follow this route. Existing requests keep their current route.</p>
            <label for="providers-route-target">Save to</label>
            <select id="providers-route-target" [class]="field" [value]="saveTarget()" (change)="setTarget($event)">
              @for (target of state.writeScopes('authMethod'); track target) { <option [value]="target">{{ scopeLabel(target) }}</option> }
            </select>
            <p>Saving to a broader scope can remove narrower authentication overrides.</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" [class]="control" (click)="activate()" [disabled]="saving() || !state.writeScopes('authMethod').includes(saveTarget())">Use for main agent</button>
              <button type="button" [class]="control" (click)="activationId.set(null)" [disabled]="saving()">Cancel provider change</button>
            </div>
          </section>
        }
        @if (clearKey(); as key) {
          <section class="rounded-md border border-base-content-muted p-3 space-y-3" aria-label="Review clear override">
            @if (clearTarget() === 'all-above-global') {
              <p>Use the global {{ settingLabel(key) }} value. Removes the workspace and App overrides above Global. Removing the App override also affects its other workspaces.</p>
            } @else {
              <p>Clear {{ settingLabel(key) }} override. The host will resolve the next stored source.</p>
              <p>Next source: {{ state.scopeEntry(key)?.fallbackPreview?.scope ?? 'App default' }}.</p>
            }
            <button type="button" [class]="control" (click)="clearOverride()" [disabled]="saving()">Confirm clear override</button>
            <button type="button" [class]="control" (click)="clearKey.set(null)" [disabled]="saving()">Cancel clear</button>
          </section>
        }

        <section data-focus="background-models" tabindex="-1" aria-label="Background models" class="scroll-mt-4">
          <ptah-provider-consumer-assignments [disabled]="saving()" [initialEditingConsumerId]="consumerTarget()"
            (setupProviderRequested)="openWizard($event)" (assignmentSaved)="state.refresh()" (timeoutSaved)="state.refreshJudging()" />
        </section>

        <ptah-cli-config [autoOpenProviderId]="requestedProviderId()" />

        <details #catalogDisclosure class="rounded-xl border border-base-300 bg-base-100" [open]="catalogOpen()">
          <summary data-focus="more-providers" class="min-h-9 min-w-6 p-3 font-semibold cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content">More providers</summary>
          <div class="p-3 space-y-3">
            <label for="providers-catalog-search">Search providers</label>
            <input id="providers-catalog-search" type="search" [class]="field" [value]="search()" (input)="search.set(inputValue($event))" />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              @for (connection of catalog(); track connection.id) {
                <div class="rounded-md border border-base-300 p-3 space-y-2">
                  <h3 class="font-semibold break-words">{{ connection.name }}</h3><p>{{ modalityLabel(connection.authMode) }}</p>
                  @if (connection.defaultsResolvable) { <p>Provider default models available.</p> }
                  <button type="button" [class]="control" (click)="openWizard(connection.id)" [disabled]="!canStartSetup()">Set up {{ connection.name }}</button>
                  @if (connection.authMode === 'oauth' || connection.authMode === 'cli') {
                    <button type="button" [class]="control" (click)="externalAction(connection.id, 'sign-in')">Sign in to {{ connection.name }}</button>
                  }
                </div>
              }
            </div>
            @if (!catalog().length && state.connections().status === 'ready') {
              <p>No matching providers.</p><button type="button" [class]="control" (click)="search.set('')">Clear search</button>
            }
            <button type="button" [class]="control" (click)="openWizard('')" [disabled]="!canStartSetup()">Custom endpoint · choose Custom in setup</button>
          </div>
        </details>

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
    @if (wizardOpen()) {
      <ptah-provider-setup-wizard [open]="true" [deepLinkProviderId]="wizardProviderId()"
        [verifyDraftConnection]="verifyDraftConnection" [cancelDraftVerification]="cancelDraftVerification"
        [supportedSaveTargets]="globalTarget" [workspaceName]="workspaceName()" [mainRouteExists]="mainRouteExists()"
        [defaultsResolvable]="wizardDefaults()" [externalAuth]="wizardExternalAuth()" [externalMessage]="state.externalAuth().data?.message ?? null"
        [initialSetup]="state.connectionSetup().status === 'ready' ? state.connectionSetup().data : null" [contextChanged]="wizardContextChanged()" [commitDetail]="wizardCommitDetail()"
        (providerChanged)="selectWizardProvider($event)" (reviewContextRequested)="reviewWizardContext()" [commitState]="wizardCommitState()"
        (commitRequested)="commitWizard($event)" (closed)="closeWizard()" (externalActionRequested)="externalAction($event.providerId, $event.action)" />
    }
  `,
})
export class ProvidersSettingsComponent implements OnInit, OnDestroy {
  readonly requestedProviderId = input<string>('');
  readonly focusTarget = input<ProvidersSettingsFocusTarget | null>(null);
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly control = CONTROL;
  protected readonly field = FIELD;
  protected readonly globalTarget: readonly SettingScope[] = ['global'];
  protected readonly mainKeys = ['authMethod', 'anthropicProviderId'];
  protected readonly mainValueFields = ['model', 'effort'] as const;
  protected readonly search = signal('');
  protected readonly catalogOpen = signal(false);
  protected readonly wizardOpen = signal(false);
  protected readonly wizardProviderId = signal('');
  protected readonly wizardCommitState = signal<WizardCommitState>('idle');
  protected readonly modelDraft = signal<string | null>(null);
  protected readonly effortDraft = signal<EffortLevel | '' | null>(null);
  protected readonly effortTarget = signal<SettingScope>('global');
  protected readonly effortLevels: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  protected readonly saveTarget = signal<SettingScope>('global');
  protected readonly activationId = signal<string | null>(null);
  protected readonly clearKey = signal<string | null>(null);
  protected readonly clearTarget = signal<'nearest' | 'all-above-global'>('nearest');
  protected readonly feedback = signal<string | null>(null);
  private readonly localFocus = signal<ProvidersSettingsFocusTarget | null>(null);
  private focusedTarget: ProvidersSettingsFocusTarget | null = null;
  private lastInputFocus: ProvidersSettingsFocusTarget | null = null;
  private draftContext: ProvidersEditContext | null = null;
  private modelContext: ProvidersEditContext | null = null;
  private effortContext: ProvidersEditContext | null = null;
  private clearContext: ProvidersEditContext | null = null;
  private readonly wizardContext = signal<ProvidersEditContext | null>(null);
  private readonly selectedWizardProvider = signal('');
  protected readonly wizardDefaults = computed(() => this.state.connections().data?.find((entry) => entry.id === this.selectedWizardProvider())?.defaultsResolvable ?? false);
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
  protected readonly saving = computed(() => this.state.commit().status === 'saving');
  protected readonly workspaceName = computed(() => this.state.scopes().data?.activePath?.split(/[\\/]/).filter(Boolean).pop() ?? null);
  protected readonly mainGroupKeys = computed(() => [...this.mainKeys,
    this.state.mainSources().data?.model?.key ?? 'unloaded-model-source',
    this.state.mainSources().data?.effort?.key ?? 'unloaded-effort-source']);
  protected readonly modelTargets = computed(() => this.state.mainSources().status === 'ready' ? this.state.writeScopes(this.state.mainSources().data?.model?.key ?? '') : []);
  protected readonly effortTargets = computed(() => this.state.mainSources().status === 'ready' ? this.state.writeScopes(this.state.mainSources().data?.effort?.key ?? '') : []);
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
    return (this.state.connections().data ?? []).filter((entry) => !configured.has(entry.id) && entry.name.toLowerCase().includes(this.search().toLowerCase()));
  });
  protected readonly consumerTarget = computed(() => {
    const target = this.focusTarget();
    return target && ['memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement'].includes(target) ? target as BackgroundConsumerId : null;
  });
  protected readonly readStates = computed(() => [
    { id: 'route', label: 'main-agent route', state: this.state.route(), retry: () => this.state.refreshRoute() },
    { id: 'scopes', label: 'setting sources', state: this.state.scopes(), retry: () => this.state.refreshScopes() },
    { id: 'model', label: 'main-agent model', state: this.state.model(), retry: () => this.state.refreshModel() },
    { id: 'main-sources', label: 'model and effort sources', state: this.state.mainSources(), retry: () => this.state.refreshMainSources() },
    { id: 'effort', label: 'main-agent reasoning effort', state: this.state.effort(), retry: () => this.state.refreshEffort() },
    { id: 'connections', label: 'providers', state: this.state.connections(), retry: () => this.state.refreshConnections() },
    { id: 'cli', label: 'CLI agents', state: this.state.cliAgents(), retry: () => this.state.refreshCliAgents() },
    { id: 'cli-models', label: 'CLI instance models', state: this.state.cliModels(), retry: () => this.state.refreshCliModels() },
    { id: 'orchestration', label: 'delegated CLI models', state: this.state.orchestration(), retry: () => this.state.refreshOrchestration() },
  ]);

  constructor() {
    afterRenderEffect(() => {
      if (this.focusTarget() !== this.lastInputFocus) {
        this.lastInputFocus = this.focusTarget(); this.localFocus.set(null); this.focusedTarget = null;
      }
      const target = this.localFocus() ?? this.focusTarget();
      if (!target || target === this.focusedTarget) return;
      if (target === 'main-effort' && this.state.effort().status !== 'ready') return;
      if (target === 'more-providers') this.catalogOpen.set(true);
      const section = this.consumerTarget() === target ? 'background-models' : target;
      if (target === 'main-model' && this.modelDraft() === null) {
        if (this.state.model().status !== 'ready') return;
        this.editModel();
        return;
      }
      const node = this.element.nativeElement.querySelector<HTMLElement>(`[data-focus="${section}"]`);
      if (node) { node.focus(); this.focusedTarget = target; }
    });
  }
  ngOnInit(): void { void this.state.open(); }
  ngOnDestroy(): void { if (this.wizardOpen()) void this.state.cancelVerification().catch(() => undefined); }
  protected inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  protected setTarget(event: Event): void {
    const value = this.inputValue(event);
    if (value === 'global' || value === 'app' || value === 'workspace') this.saveTarget.set(value);
  }
  protected scopeLabel(scope: SettingScope): string { return scope === 'global' ? 'Global · all apps' : scope === 'app' ? 'Desktop app' : 'This workspace'; }
  protected authenticationLabel(value: unknown): string {
    return value === 'apiKey' ? 'API key' : value === 'claudeCli' ? 'CLI subscription' : value === 'thirdParty' ? 'Provider connection' : 'Host-resolved authentication';
  }
  protected settingLabel(key: string): string {
    return key === 'authMethod' ? 'authentication' : key === this.state.mainSources().data?.model?.key ? 'main agent model'
      : key === this.state.mainSources().data?.effort?.key ? 'reasoning effort' : 'provider';
  }
  protected providerName(id: string): string { return this.state.connections().data?.find((entry) => entry.id === id)?.name ?? id; }
  protected modalityLabel(mode: string): string {
    return ({ apiKey: 'API key', 'api-key': 'API key', oauth: 'Provider sign-in', cli: 'CLI subscription', local: 'Local server', 'local-native': 'Local server', 'local-proxy': 'Local server (proxy)', custom: 'Custom endpoint' } as Record<string, string>)[mode] ?? 'Connection not checked';
  }
  protected connectionStatus(entry: ProvidersConnection): ProviderConnectionCardStatus {
    if (this.activeId() === entry.id) return 'active';
    if (this.state.route().status !== 'ready') return this.state.route().status === 'loading' ? 'checking' : 'check-unavailable';
    return this.state.route().data?.providers.find((provider) => provider.id === entry.id)?.status ?? 'not-checked';
  }
  protected isBlocked(id: string): boolean { return this.state.route().status === 'ready' && this.state.route().data?.driverProviderId === id && !this.state.route().data?.ready; }
  protected requestFocus(target: ProvidersSettingsFocusTarget): void {
    this.focusedTarget = null; this.localFocus.set(target);
    this.element.nativeElement.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
  }
  protected openWizard(providerId: string): void {
    if (!this.canStartSetup()) return;
    this.wizardContext.set(this.state.reviewContext());
    this.returnFocus = this.element.nativeElement.ownerDocument.activeElement as HTMLElement | null;
    this.wizardProviderId.set(providerId);
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
    this.feedback.set(confirmed ? 'Connection settings saved and refreshed.' : 'Some connection settings were not confirmed. Review the saved and unsaved fields below.');
  }
  protected selectWizardProvider(providerId: string): void {
    this.selectedWizardProvider.set(providerId);
    if (!providerId) return;
    void this.state.refreshConnectionSetup(providerId);
    const connection = this.state.connections().data?.find((entry) => entry.id === providerId);
    if (connection?.authMode === 'oauth' || connection?.authMode === 'cli') this.externalAction(providerId, 'cli-check');
  }
  protected async reviewWizardContext(): Promise<void> {
    await this.state.refreshScopes();
    this.wizardContext.set(this.state.reviewContext());
    this.wizardCommitState.set('idle');
  }
  protected closeWizard(): void {
    this.wizardOpen.set(false);
    this.wizardContext.set(null);
    this.feedback.set(this.wizardCommitState() === 'saved' ? 'Connection settings saved.' : 'Setup closed. External sign-in, if completed, remains available.');
    void this.state.cancelVerification().catch(() => undefined);
    this.returnFocus?.focus();
  }
  protected externalAction(providerId: string | null, action: ProvidersExternalAuthAction): void { void this.state.performExternalAuth(providerId, action); }
  protected editModel(): void {
    if (this.state.model().status !== 'ready') return;
    this.modelContext = this.state.reviewContext();
    const source = this.state.mainSources().data?.model?.scope;
    this.saveTarget.set(source && this.modelTargets().includes(source) ? source : this.modelTargets()[0] ?? 'global');
    this.modelDraft.set(this.state.model().data?.model ?? '');
    this.requestFocus('main-model');
  }
  protected async saveModel(): Promise<void> {
    const model = this.modelDraft();
    if (!model || !this.modelContext || !this.modelTargets().includes(this.saveTarget())) return;
    await this.state.saveSettings({ model: { model, applyTo: this.saveTarget() } }, this.modelContext);
    if (this.state.commit().status === 'saved') this.modelDraft.set(null);
  }
  protected editEffort(event: Event): void {
    const value = this.inputValue(event);
    if (value !== '' && !this.effortLevels.includes(value as EffortLevel)) return;
    if (this.effortDraft() === null) {
      this.effortContext = this.state.reviewContext();
      const source = this.state.mainSources().data?.effort?.scope;
      this.effortTarget.set(source && this.effortTargets().includes(source) ? source : this.effortTargets()[0] ?? 'global');
    }
    this.effortDraft.set(value as EffortLevel | '');
  }
  protected async saveEffort(): Promise<void> {
    const effort = this.effortDraft(); if (effort === null || !this.effortContext || !this.effortTargets().includes(this.effortTarget())) return;
    await this.state.saveSettings({ effort: { effort: effort || undefined, applyTo: this.effortTarget() } }, this.effortContext);
    if (this.state.commit().status === 'saved') this.effortDraft.set(null);
  }
  protected setEffortTarget(event: Event): void {
    const value = this.inputValue(event);
    if (value === 'global' || value === 'app' || value === 'workspace') this.effortTarget.set(value);
  }
  protected overrideMainValue(field: 'model' | 'effort'): void {
    if (field === 'model') { this.editModel(); this.saveTarget.set('workspace'); }
    else {
      this.effortContext = this.state.reviewContext(); this.effortDraft.set(this.state.effort().data?.effort ?? '');
      this.effortTarget.set('workspace'); this.requestFocus('main-effort');
    }
  }
  protected beginActivation(id: string, scope?: SettingScope): void {
    if (!id) return;
    this.draftContext = this.state.reviewContext(); this.activationId.set(id);
    this.saveTarget.set(scope ?? this.state.writeScopes('authMethod')[0] ?? 'global');
  }
  protected async activate(): Promise<void> {
    const id = this.activationId();
    if (!id || !this.draftContext) return;
    await this.state.activateConnection(id, this.saveTarget(), this.draftContext);
    if (this.state.commit().status === 'saved') this.activationId.set(null);
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
