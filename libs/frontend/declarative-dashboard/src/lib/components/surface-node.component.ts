import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  untracked,
  type InputSignal,
  type Signal,
} from '@angular/core';
import type { SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceActionInvoke,
  SurfaceInputCommit,
  SurfaceInteractionState,
} from '../surface-interaction';
import type { SurfaceComponentViewState } from '../surface-view-state';
import type {
  DisplayNode,
  InputNode,
  LayoutNode,
  SurfaceNode,
} from '../view-model/view-model.types';
import { DashboardChartComponent, type ChartNode } from './dashboard-chart.component';
import { DashboardListComponent, type ListNode } from './dashboard-list.component';
import { DashboardStatComponent, type StatNode } from './dashboard-stat.component';
import { DashboardTableComponent } from './dashboard-table.component';
import { SurfaceCheckboxInputComponent, type CheckboxInputNode } from './surface-checkbox-input.component';
import { SurfaceChoiceInputComponent, type ChoiceInputNode } from './surface-choice-input.component';
import { NO_DRAFTS, type SurfaceDrafts } from './surface-input-messages';
import { SurfaceLayoutComponent } from './surface-layout.component';
import {
  SurfaceTextInputComponent,
  type SurfaceDraftWrite,
  type TextInputNode,
} from './surface-text-input.component';
import type { TableNode } from '../table/table-rows';

/** One display component's presentation state change, keyed by its id. */
export interface SurfaceComponentViewStateWrite {
  readonly componentId: string;
  readonly state: SurfaceComponentViewState;
}

type ComponentStates = Readonly<Record<string, SurfaceComponentViewState>>;

const NO_COMPONENT_STATES: ComponentStates = {};
const NO_COMPONENT_STATE: SurfaceComponentViewState = {};
const NO_INTERACTION: SurfaceInteractionState = {
  selection: null,
  selectionUnsynced: false,
  pendingValues: new Map(),
  issues: new Map(),
  actions: new Map(),
  submitDisabled: false,
};

/** The 13 catalog kinds this node renders; anything else is `@default`. */
export const SURFACE_NODE_KINDS: ReadonlySet<string> = new Set([
  'section', 'stack', 'grid', 'card',
  'text', 'select', 'radio-group', 'checkbox',
  'stat', 'table', 'list', 'line-chart', 'bar-chart',
]);

function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/**
 * Recursive node: `@switch` over the 13 kinds. Layouts get their children
 * through this component's `child` template, so the layout never imports this
 * component (R5). v1 display children are rendered the same way. An unknown
 * kind renders nothing and emits `renderFailed`. Every output is forwarded
 * unchanged by parent nodes up to the renderer, which owns all state.
 */
@Component({
  selector: 'ptah-surface-node',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    SurfaceLayoutComponent,
    SurfaceTextInputComponent,
    SurfaceChoiceInputComponent,
    SurfaceCheckboxInputComponent,
    DashboardStatComponent,
    DashboardTableComponent,
    DashboardListComponent,
    DashboardChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #child let-child>
      <ptah-surface-node [node]="child" [surfaceId]="surfaceId()" [componentStates]="componentStates()"
        [drafts]="drafts()" [interaction]="interaction()"
        (componentViewStateChange)="componentViewStateChange.emit($event)"
        (selectionChange)="selectionChange.emit($event)" (inputCommit)="inputCommit.emit($event)"
        (draftChange)="draftChange.emit($event)" (actionInvoke)="actionInvoke.emit($event)"
        (renderFailed)="renderFailed.emit()" />
    </ng-template>
    <ng-template #layoutView>
      @if (layoutNode(); as layout) {
        <ptah-surface-layout [node]="layout" [childTemplate]="child" [surfaceId]="surfaceId()"
          [actionStates]="interaction().actions" [submitDisabled]="interaction().submitDisabled"
          (actionInvoke)="actionInvoke.emit($event)" />
      }
    </ng-template>
    <ng-template #choiceView>
      @if (choiceNode(); as choice) {
        <ptah-surface-choice-input [node]="choice" [surfaceId]="surfaceId()" [drafts]="drafts()"
          [pendingValues]="interaction().pendingValues" [issues]="interaction().issues"
          (inputCommit)="inputCommit.emit($event)" />
      }
    </ng-template>
    <ng-template #chartView>
      @if (chartNode(); as chart) {
        <ptah-dashboard-chart [node]="chart" [surfaceId]="surfaceId()" [viewState]="componentState()"
          [selection]="interaction().selection" (viewStateChange)="writeComponentState($event)"
          (selectionChange)="selectionChange.emit($event)" />
        <ng-container [ngTemplateOutlet]="displayChildrenBelow" />
      }
    </ng-template>
    <ng-template #displayChildren>
      <!-- Position plus id: duplicate ids stay distinct, and a swapped id gets a fresh view. -->
      @for (displayChild of displayChildNodes(); track $index + ':' + displayChild.id) {
        <ng-container [ngTemplateOutlet]="child" [ngTemplateOutletContext]="{ $implicit: displayChild }" />
      }
    </ng-template>
    <ng-template #displayChildrenBelow>
      @if (displayChildNodes().length > 0) {
        <div class="mt-3 flex flex-col gap-3"><ng-container [ngTemplateOutlet]="displayChildren" /></div>
      }
    </ng-template>
    @switch (node().kind) {
      @case ('section') { <ng-container [ngTemplateOutlet]="layoutView" /> }
      @case ('stack') { <ng-container [ngTemplateOutlet]="layoutView" /> }
      @case ('grid') { <ng-container [ngTemplateOutlet]="layoutView" /> }
      @case ('card') { <ng-container [ngTemplateOutlet]="layoutView" /> }
      @case ('text') {
        @if (textNode(); as text) {
          <ptah-surface-text-input [node]="text" [surfaceId]="surfaceId()" [drafts]="drafts()"
            [pendingValues]="interaction().pendingValues" [issues]="interaction().issues"
            (inputCommit)="inputCommit.emit($event)" (draftChange)="draftChange.emit($event)" />
        }
      }
      @case ('select') { <ng-container [ngTemplateOutlet]="choiceView" /> }
      @case ('radio-group') { <ng-container [ngTemplateOutlet]="choiceView" /> }
      @case ('checkbox') {
        @if (checkboxNode(); as checkbox) {
          <ptah-surface-checkbox-input [node]="checkbox" [surfaceId]="surfaceId()" [drafts]="drafts()"
            [pendingValues]="interaction().pendingValues" [issues]="interaction().issues"
            (inputCommit)="inputCommit.emit($event)" />
        }
      }
      @case ('stat') {
        @if (statNode(); as stat) {
          <ptah-dashboard-stat [node]="stat" [surfaceId]="surfaceId()" [viewState]="componentState()"
            [selection]="interaction().selection" (viewStateChange)="writeComponentState($event)"
            (selectionChange)="selectionChange.emit($event)">
            <ng-container [ngTemplateOutlet]="displayChildren" />
          </ptah-dashboard-stat>
        }
      }
      @case ('table') {
        @if (tableNode(); as table) {
          <ptah-dashboard-table [node]="table" [surfaceId]="surfaceId()" [viewState]="componentState()"
            [selection]="interaction().selection" (viewStateChange)="writeComponentState($event)"
            (selectionChange)="selectionChange.emit($event)" />
          <ng-container [ngTemplateOutlet]="displayChildrenBelow" />
        }
      }
      @case ('list') {
        @if (listNode(); as list) {
          <ptah-dashboard-list [node]="list" [surfaceId]="surfaceId()" [viewState]="componentState()"
            [selection]="interaction().selection" (viewStateChange)="writeComponentState($event)"
            (selectionChange)="selectionChange.emit($event)">
            <ng-container [ngTemplateOutlet]="displayChildren" />
          </ptah-dashboard-list>
        }
      }
      @case ('line-chart') { <ng-container [ngTemplateOutlet]="chartView" /> }
      @case ('bar-chart') { <ng-container [ngTemplateOutlet]="chartView" /> }
      @default {}
    }
  `,
})
export class SurfaceNodeComponent {
  public readonly node: InputSignal<SurfaceNode> = input.required<SurfaceNode>();
  public readonly surfaceId = input('');
  /** `SurfaceViewState.components` of the whole surface. */
  public readonly componentStates = input<ComponentStates>(NO_COMPONENT_STATES);
  /** `SurfaceViewState.drafts` of the whole surface. */
  public readonly drafts = input<SurfaceDrafts>(NO_DRAFTS);
  public readonly interaction = input<SurfaceInteractionState>(NO_INTERACTION);
  public readonly componentViewStateChange = output<SurfaceComponentViewStateWrite>();
  public readonly selectionChange = output<SurfaceSelection>();
  public readonly inputCommit = output<SurfaceInputCommit>();
  public readonly draftChange = output<SurfaceDraftWrite>();
  public readonly actionInvoke = output<SurfaceActionInvoke>();
  public readonly renderFailed = output<void>();

  public readonly layoutNode = computed((): LayoutNode | null => {
    const node = this.node();
    return node.kind === 'section' || node.kind === 'stack' || node.kind === 'grid' || node.kind === 'card' ? node : null;
  });
  public readonly textNode = computed((): TextInputNode | null => {
    const node = this.node();
    return node.kind === 'text' ? node : null;
  });
  public readonly choiceNode = computed((): ChoiceInputNode | null => {
    const node = this.node();
    return node.kind === 'select' || node.kind === 'radio-group' ? node : null;
  });
  public readonly checkboxNode = computed((): CheckboxInputNode | null => {
    const node = this.node();
    return node.kind === 'checkbox' ? node : null;
  });
  public readonly statNode: Signal<StatNode | null> = computed((): StatNode | null => {
    const node = this.node();
    return node.kind === 'stat' ? node : null;
  });
  public readonly tableNode: Signal<TableNode | null> = computed((): TableNode | null => {
    const node = this.node();
    return node.kind === 'table' ? node : null;
  });
  public readonly listNode: Signal<ListNode | null> = computed((): ListNode | null => {
    const node = this.node();
    return node.kind === 'list' ? node : null;
  });
  public readonly chartNode = computed((): ChartNode | null => {
    const node = this.node();
    return node.kind === 'line-chart' || node.kind === 'bar-chart' ? node : null;
  });
  /** v1 display children only; layouts render theirs through the layout component. */
  public readonly displayChildNodes = computed((): readonly DisplayNode[] => {
    const node = this.node();
    if (this.layoutNode() !== null || isInputNode(node)) return [];
    const children: unknown = (node as DisplayNode).children;
    return Array.isArray(children) ? children : [];
  });
  public readonly componentState = computed(
    () => ownEntry(this.componentStates(), this.node().id) ?? NO_COMPONENT_STATE,
  );
  private readonly unknownKind = computed(() => !SURFACE_NODE_KINDS.has(this.node().kind));

  public constructor() {
    // `@default` renders nothing; the failure is reported, never swallowed.
    effect(() => {
      if (this.unknownKind()) untracked(() => this.renderFailed.emit());
    });
  }

  public writeComponentState(state: SurfaceComponentViewState): void {
    this.componentViewStateChange.emit({ componentId: this.node().id, state });
  }
}

function isInputNode(node: SurfaceNode): node is InputNode {
  return node.kind === 'text' || node.kind === 'select' || node.kind === 'radio-group' || node.kind === 'checkbox';
}
