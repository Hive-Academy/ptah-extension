import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Compass, LucideAngularModule } from 'lucide-angular';
import {
  AppStateManager, ProvidersSettingsStateService, type ProvidersEffectiveRoute, type ProvidersOrchestration,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { SkillLaneIdDto } from '@ptah-extension/shared';
import { RoutingMapNodeComponent, type RoutingNodeState, type RoutingNodeTone } from './routing-map-node.component';

export type RoutingNodeId = 'main-agent' | 'background-roles' | 'cli-agents';

/** Background roles in the order the Orchestration tab lists them (as `connection-usage.ts`). */
const LANES: readonly { readonly id: SkillLaneIdDto; readonly label: string }[] = [
  { id: 'archaeologist', label: 'Archaeologist lane' },
  { id: 'synthesis', label: 'Synthesis lane' },
  { id: 'judge', label: 'Judge lane' },
  { id: 'replay', label: 'Replay lane' },
];

export interface BackgroundRolesPreview {
  /** Roles with a provider of their own, in list order: `{ label, provider }` (provider = connection name). */
  readonly explicit: readonly { readonly label: string; readonly provider: string }[];
  /** Roles with no provider of their own: they follow the main agent. */
  readonly following: number;
  readonly total: number;
}

/** The six background roles, split into explicitly assigned ones and those following the main agent. */
export function backgroundRolesPreview(
  curatorProvider: string,
  lanes: Readonly<Partial<Record<SkillLaneIdDto, { readonly provider?: string }>>>,
  judgeProvider: string,
  nameOf: (providerId: string) => string,
): BackgroundRolesPreview {
  const roles = [
    { label: 'Memory curator', provider: curatorProvider },
    ...LANES.map((lane) => ({ label: lane.label, provider: lanes[lane.id]?.provider ?? '' })),
    { label: 'Judging & enhancement', provider: judgeProvider },
  ];
  const explicit = roles.filter((role) => role.provider.trim())
    .map((role) => ({ label: role.label, provider: nameOf(role.provider.trim()) }));
  return { explicit, following: roles.length - explicit.length, total: roles.length };
}

export interface CliAgentsPreview {
  /** Installed agents in the preferred order (the Orchestration tab's rule); disabled ones are flagged. */
  readonly order: readonly { readonly id: string; readonly name: string; readonly disabled: boolean }[];
  readonly enabledSystem: number;
  readonly ptahInstances: number;
}

/** Preferred execution order of the installed agents, and the enabled system CLI / Ptah instance counts. */
export function cliAgentsPreview(
  config: Pick<ProvidersOrchestration, 'detectedClis' | 'disabledClis' | 'preferredAgentOrder'>,
): CliAgentsPreview {
  const disabled = new Set(config.disabledClis ?? []);
  // Host data: a payload without the detection list reads as "none detected", never as a crash.
  const agents = (config.detectedClis ?? []).filter((cli) => cli.installed).map((cli) => ({
    id: cli.ptahCliId ?? cli.cli,
    name: cli.ptahCliName ?? cli.cli.charAt(0).toUpperCase() + cli.cli.slice(1),
    disabled: !cli.ptahCliId && disabled.has(cli.cli),
    system: !cli.ptahCliId,
  }));
  const preferred = config.preferredAgentOrder ?? [];
  const rank = (id: string) => { const index = preferred.indexOf(id); return index === -1 ? preferred.length : index; };
  const ordered = [...agents].sort((a, b) => rank(a.id) - rank(b.id));
  return {
    order: ordered.map(({ id, name, disabled: off }) => ({ id, name, disabled: off })),
    enabledSystem: agents.filter((agent) => agent.system && !agent.disabled).length,
    ptahInstances: agents.filter((agent) => !agent.system).length,
  };
}

/** Header status pill: "Operational" exactly when the main route is loaded and `ready`. */
export function routeStatus(route: ProvidersSettingsSection<ProvidersEffectiveRoute>): { readonly tone: RoutingNodeTone; readonly text: string } {
  if (route.status === 'error') return { tone: 'warning', text: 'Route unavailable' };
  if (route.status !== 'ready' || !route.data) return { tone: 'neutral', text: 'Checking…' };
  return route.data.ready ? { tone: 'success', text: 'Operational' } : { tone: 'warning', text: 'Needs attention' };
}

const PILL: Readonly<Record<RoutingNodeTone, string>> = {
  success: 'border-success/30 bg-success/10',
  info: 'border-info/30 bg-info/10',
  warning: 'border-warning/30 bg-warning/10',
  neutral: 'border-base-300 bg-base-100',
};
const DOT: Readonly<Record<RoutingNodeTone, string>> = {
  success: 'bg-success', info: 'bg-info', warning: 'bg-warning', neutral: 'bg-base-content-muted',
};

function sectionState(...sections: readonly ProvidersSettingsSection<unknown>[]): RoutingNodeState {
  if (sections.some((section) => section.status === 'error')) return 'error';
  return sections.every((section) => section.status === 'ready' && section.data !== null) ? 'ready' : 'loading';
}

/**
 * Routing map (plan :585-595, design-spec §2.1/§3.1, prototype "Routing Map"): which model does what, in
 * three work nodes. Reads `ProvidersSettingsStateService` directly.
 * - Main Agent: provider, model and effort of the next request; its D16 scope badges (`[main-agent-badges]`)
 *   and the Main Agent popover (`[main-agent-popover]`, anchored at the node) are projected in by the page,
 *   which owns them. "Reassign" emits `nodeActivated('main-agent')`; the page opens the popover.
 * - Background Roles and CLI Agents go to Agent Orchestration (`requestSettingsTab`, routed as in Batch 18).
 * Colour sits on dots and pills; all text stays base-content (deviation 6).
 */
@Component({
  selector: 'ptah-routing-map',
  standalone: true,
  imports: [LucideAngularModule, RoutingMapNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-base-300 bg-base-200/40 p-3" aria-labelledby="routing-map-heading" data-testid="routing-map">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h2 id="routing-map-heading" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-base-content-muted">
            <lucide-angular [img]="CompassIcon" class="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Routing map
          </h2>
          <span class="text-[11px] text-base-content-muted">Select a work node to see or change what it runs on</span>
        </div>
        <span role="status" [class]="'flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium text-base-content ' + pill()"
          data-testid="routing-map-status">
          <span [class]="'h-1.5 w-1.5 rounded-full ' + statusDot()" aria-hidden="true"></span>{{ status().text }}
        </span>
      </div>

      <!-- Columns from the container width, not the viewport (the Q-extra-1 rule): three nodes of at least
           15rem side by side where they fit (VS Code at 1024 px), two in the narrower Electron page. -->
      <div class="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3" data-testid="routing-map-nodes">
        <ptah-routing-map-node nodeId="main-agent" title="Main agent" [tone]="main().tone" [statusText]="main().status"
          [state]="main().state" errorText="Main-agent route unavailable." [footer]="main().footer" actionLabel="Reassign"
          actionAriaLabel="Reassign the main agent: its provider, model and effort" (activated)="nodeActivated.emit('main-agent')"
          (retryRequested)="state.refreshRoute()">
          <ng-container ngProjectAs="[node-badges]"><ng-content select="[main-agent-badges]" /></ng-container>
          <ng-container ngProjectAs="[node-popover]"><ng-content select="[main-agent-popover]" /></ng-container>
          @if (main().provider; as provider) {
            <p class="flex flex-wrap items-baseline gap-x-1.5">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-base-content-muted">Provider:</span>
              <span class="break-words text-sm font-semibold text-base-content" data-testid="routing-main-provider">{{ provider }}</span>
            </p>
            <p class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-base-content-muted">Model:</span>
              <span class="break-all font-mono text-xs font-medium text-base-content" data-testid="routing-main-model">{{ main().model }}</span>
            </p>
          } @else {
            <p class="text-base-content">Choose a provider to start the main agent.</p>
          }
        </ptah-routing-map-node>

        <ptah-routing-map-node nodeId="background-roles" title="Background roles" [tone]="background().tone"
          [statusText]="background().status" [state]="background().state" errorText="Background roles could not be loaded."
          [footer]="background().footer" actionLabel="Inspect" actionIcon="right"
          actionAriaLabel="Inspect background roles on Agent Orchestration" (activated)="open('background-roles')"
          (retryRequested)="retryBackground()">
          @if (background().preview; as preview) {
            <ul class="space-y-1">
              @for (role of preview.explicit.slice(0, 2); track role.label) {
                <li class="flex items-baseline justify-between gap-2">
                  <span>{{ role.label }}</span>
                  <span class="min-w-0 break-words text-right font-mono text-[11px] text-base-content-muted">{{ role.provider }}</span>
                </li>
              }
              @if (preview.explicit.length > 2) {
                <li class="text-base-content-muted" data-testid="routing-background-more">{{ preview.explicit.length - 2 }} more set</li>
              }
              @if (preview.following) {
                <li class="flex items-baseline justify-between gap-2" data-testid="routing-background-following">
                  <span>{{ preview.following }} {{ preview.following === 1 ? 'role' : 'roles' }}</span>
                  <span class="text-[11px] text-base-content-muted">{{ preview.following === 1 ? 'Follows' : 'Follow' }} main agent</span>
                </li>
              }
            </ul>
          }
        </ptah-routing-map-node>

        <ptah-routing-map-node nodeId="cli-agents" title="CLI agents & matrix" [tone]="cli().tone" [statusText]="cli().status"
          [state]="cli().state" errorText="CLI agents could not be loaded." [footer]="cli().footer" actionLabel="Manage matrix"
          actionIcon="right" actionAriaLabel="Manage the CLI agent matrix on Agent Orchestration" (activated)="open('cli-agents')"
          (retryRequested)="state.refreshOrchestration()">
          @if (cli().preview; as preview) {
            @if (preview.order.length) {
              <span class="mb-1 block text-base-content-muted">Execution priority:</span>
              <p class="flex flex-wrap items-center gap-x-1 text-[11px]" data-testid="routing-cli-order">
                @for (agent of preview.order.slice(0, 4); track agent.id; let first = $first) {
                  @if (!first) { <span class="text-base-content-muted" aria-hidden="true">→</span> }
                  <span [class]="agent.disabled ? 'text-base-content-muted' : 'font-semibold text-base-content'">
                    {{ agent.name }}@if (agent.disabled) {<span class="sr-only"> (off)</span>}
                  </span>
                }
              </p>
            } @else {
              <p class="text-base-content">No CLI agents detected.</p>
            }
          }
        </ptah-routing-map-node>
      </div>
    </section>
  `,
})
export class RoutingMapComponent {
  protected readonly CompassIcon = Compass;
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly appState = inject(AppStateManager);

  /** A node was activated. Background Roles and CLI Agents have already requested their tab. */
  readonly nodeActivated = output<RoutingNodeId>();

  protected readonly status = computed(() => routeStatus(this.state.route()));
  protected readonly pill = computed(() => PILL[this.status().tone]);
  protected readonly statusDot = computed(() => DOT[this.status().tone]);

  private nameOf(providerId: string): string {
    return this.state.connections().data?.find((entry) => entry.id === providerId)?.name ?? providerId;
  }

  protected readonly main = computed(() => {
    const route = this.state.route(), effort = this.state.effort();
    const state: RoutingNodeState = route.status === 'error' ? 'error' : route.status === 'ready' && route.data ? 'ready' : 'loading';
    const data = route.data;
    const driver = data && data.driverProviderId && data.route !== 'unresolved' ? data.driverProviderId : null;
    const model = !data ? '' : data.resolvedModel.kind === 'model' ? data.resolvedModel.id
      : data.resolvedModel.kind === 'tier' ? `${data.resolvedModel.tier} tier` : 'Default (chosen by Claude)';
    const effortText = effort.status === 'ready' ? effort.data?.effort ?? 'Provider default' : '…';
    const tone: RoutingNodeTone = !driver ? 'neutral' : data?.ready ? 'success' : 'warning';
    return {
      state, tone, model,
      provider: driver ? this.nameOf(driver) : null,
      status: !driver ? 'Not set' : data?.ready ? 'Active' : 'Needs attention',
      footer: `Effort: ${effortText}`,
    };
  });

  protected readonly background = computed(() => {
    const memory = this.state.memory(), lanes = this.state.lanes(), judging = this.state.judging();
    const state = sectionState(memory, lanes, judging);
    const preview = state === 'ready'
      ? backgroundRolesPreview(memory.data?.curatorProvider ?? '', lanes.data ?? {}, judging.data?.judgeProvider ?? '',
        (id) => this.nameOf(id))
      : null;
    return {
      state, preview,
      tone: (preview?.explicit.length ? 'info' : 'neutral') as RoutingNodeTone,
      status: preview ? `${preview.total} roles` : 'Loading',
      footer: preview ? `${preview.explicit.length} set · ${preview.following} following` : '',
    };
  });

  protected readonly cli = computed(() => {
    const orchestration = this.state.orchestration();
    const state = sectionState(orchestration);
    const preview = state === 'ready' && orchestration.data ? cliAgentsPreview(orchestration.data) : null;
    const enabled = preview ? preview.enabledSystem + preview.ptahInstances : 0;
    return {
      state, preview,
      tone: (enabled ? 'info' : 'neutral') as RoutingNodeTone,
      status: preview ? `${enabled} enabled` : 'Loading',
      footer: preview
        ? `${preview.enabledSystem} ${preview.enabledSystem === 1 ? 'CLI' : 'CLIs'} · ${preview.ptahInstances} Ptah ${preview.ptahInstances === 1 ? 'instance' : 'instances'}`
        : '',
    };
  });

  protected open(node: 'background-roles' | 'cli-agents'): void {
    this.appState.requestSettingsTab({ tab: 'orchestration', section: node === 'cli-agents' ? 'cli-agents' : 'background-models' });
    this.nodeActivated.emit(node);
  }

  /** Re-reads only the background sections that failed. */
  protected retryBackground(): void {
    if (this.state.memory().status === 'error') void this.state.refreshMemory();
    if (this.state.lanes().status === 'error') void this.state.refreshLanes();
    if (this.state.judging().status === 'error') void this.state.refreshJudging();
  }
}
