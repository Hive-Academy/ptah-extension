import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  signal,
  TemplateRef,
  untracked,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { SplitHandleComponent } from '@ptah-extension/chat-ui';
import { AgentLaneScrollDirective } from './agent-lane-scroll.directive';
import {
  reconcileLanes,
  LANE_HANDLE_WIDTH,
  MIN_LANE_WIDTH,
  normaliseLaneFractions,
  pickLane,
  resizeLanePair,
} from './agent-lane-layout';

@Component({
  selector: 'ptah-agent-lane-grid',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    SplitHandleComponent,
    AgentLaneScrollDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 min-h-0 h-full overflow-hidden' },
  template: `
    @for (
      agent of lanes();
      track agent.agentId;
      let index = $index;
      let last = $last
    ) {
      <section
        #lane
        tabindex="-1"
        class="flex flex-col min-w-0 min-h-0"
        [style.flex]="fractions()[index] + ' 1 0px'"
        [attr.data-lane-id]="agent.agentId"
        [attr.aria-label]="agent.displayName || agent.cli"
      >
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 border-b border-base-content/10 shrink-0"
        >
          <span
            class="w-2 h-2 rounded-full shrink-0"
            [class.bg-info]="agent.status === 'running'"
            [class.bg-success]="agent.status === 'completed'"
            [class.bg-error]="
              agent.status === 'failed' || agent.status === 'timeout'
            "
            [class.bg-warning]="agent.status === 'stopped'"
            [class.animate-pulse]="agent.status === 'running'"
            [title]="agent.status"
          ></span>
          <span class="text-xs font-medium truncate flex-1">{{
            agent.displayName || agent.cli
          }}</span>
          @if (agent.permissionQueue.length) {
            <span
              class="badge badge-xs badge-warning"
              title="Pending permissions"
              >{{ agent.permissionQueue.length }}</span
            >
          }
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            [attr.aria-label]="
              'Remove ' + (agent.displayName || agent.cli) + ' column'
            "
            title="Remove column"
            (click)="remove(agent.agentId)"
          >
            <lucide-angular
              [img]="XIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
        <div ptahAgentLaneScroll class="flex-1 min-h-0 min-w-0 overflow-y-auto">
          <div>
            <ng-container
              [ngTemplateOutlet]="detailTemplate()"
              [ngTemplateOutletContext]="{ $implicit: agent }"
            />
          </div>
        </div>
      </section>
      @if (!last) {
        <ptah-split-handle
          [size]="fractions()[index] * availableWidth()"
          [min]="minimumWidth"
          [max]="
            (fractions()[index] + fractions()[index + 1]) * availableWidth() -
            minimumWidth
          "
          [label]="'Resize ' + (agent.displayName || agent.cli) + ' column'"
          (sizeChange)="resize(index, $event)"
          (sizeReset)="resetSizes()"
        />
      }
    } @empty {
      <div class="text-sm text-base-content-muted p-1.5">
        Choose an agent above to add a column.
      </div>
    }
  `,
})
export class AgentLaneGridComponent {
  readonly agents = input.required<readonly MonitoredAgent[]>();
  readonly capacity = input.required<number>();
  readonly width = input.required<number>();
  readonly detailTemplate =
    input.required<TemplateRef<{ $implicit: MonitoredAgent }>>();
  readonly expandAgent = output<string>();
  readonly XIcon = X;
  readonly minimumWidth = MIN_LANE_WIDTH;
  readonly shownIds = signal<readonly string[]>([]);
  readonly fractions = signal<number[]>([]);
  readonly lanes = computed(() =>
    this.shownIds().flatMap((id) => {
      const agent = this.agents().find((candidate) => candidate.agentId === id);
      return agent ? [agent] : [];
    }),
  );
  readonly availableWidth = computed(() =>
    Math.max(
      1,
      this.width() -
        Math.max(0, this.shownIds().length - 1) * LANE_HANDLE_WIDTH,
    ),
  );
  private readonly sections = viewChildren<ElementRef<HTMLElement>>('lane');
  private readonly focusId = signal<string | null>(null);
  private previousCapacity = 0;
  private userPicked = false;
  private previousRunningIds = new Set<string>();
  private recent: string[] = [];
  private dismissed = new Set<string>();

  constructor() {
    effect(() => {
      const agents = this.agents();
      const capacity = this.capacity();
      const width = this.width();
      untracked(() => {
        const previous = this.shownIds();
        const valid = new Set(agents.map((agent) => agent.agentId));
        this.dismissed = new Set(
          [...this.dismissed].filter((id) => valid.has(id)),
        );
        const runningIds = new Set(
          agents
            .filter((agent) => agent.status === 'running')
            .map((agent) => agent.agentId),
        );
        const selection = reconcileLanes(
          { ids: previous, recent: this.recent },
          agents,
          {
            capacity,
            fillCount: this.userPicked
              ? previous.length + Math.max(0, capacity - this.previousCapacity)
              : capacity,
            autoPick: !this.userPicked,
            newRunningIds: new Set(
              [...runningIds].filter((id) => !this.previousRunningIds.has(id)),
            ),
            dismissed: this.dismissed,
          },
        );
        this.previousRunningIds = runningIds;
        this.previousCapacity = capacity;
        const ids = selection.ids;
        const weights = ids.map(
          (id) =>
            this.fractions()[previous.indexOf(id)] ??
            1 / Math.max(1, ids.length),
        );
        this.shownIds.set(ids);
        this.recent = [...selection.recent];
        this.fractions.set(
          normaliseLaneFractions(
            weights,
            width - Math.max(0, ids.length - 1) * LANE_HANDLE_WIDTH,
          ),
        );
        for (const id of ids) {
          if (!previous.includes(id)) this.expandAgent.emit(id);
        }
      });
    });
    afterRenderEffect(() => {
      const id = this.focusId();
      const section = this.sections().find(
        (item) => item.nativeElement.dataset['laneId'] === id,
      );
      if (section) {
        section.nativeElement.focus({ preventScroll: true });
        this.focusId.set(null);
      }
    });
  }

  pick(id: string): void {
    if (!this.agents().some((agent) => agent.agentId === id)) return;
    this.userPicked = true;
    this.dismissed.delete(id);
    const picked = pickLane(this.shownIds(), this.recent, id, this.capacity());
    this.shownIds.set(picked.ids);
    this.recent = picked.recent;
    this.fractions.set(
      normaliseLaneFractions(
        picked.ids.map(
          (_, index) => this.fractions()[index] ?? 1 / picked.ids.length,
        ),
        this.availableWidth(),
      ),
    );
    this.expandAgent.emit(id);
    this.focusId.set(id);
  }

  remove(id: string): void {
    this.userPicked = true;
    this.dismissed.add(id);
    const index = this.shownIds().indexOf(id);
    this.shownIds.update((ids) => ids.filter((key) => key !== id));
    this.recent = this.recent.filter((key) => key !== id);
    this.fractions.update((weights) =>
      normaliseLaneFractions(
        weights.filter((_, i) => i !== index),
        this.availableWidth(),
      ),
    );
    this.focusId.set(
      this.shownIds()[Math.min(index, this.shownIds().length - 1)] ?? null,
    );
  }

  resize(index: number, size: number): void {
    this.fractions.update((weights) =>
      resizeLanePair(weights, index, size, this.availableWidth()),
    );
  }

  resetSizes(): void {
    this.fractions.set(
      normaliseLaneFractions(
        this.shownIds().map(() => 1),
        this.availableWidth(),
      ),
    );
  }
}
