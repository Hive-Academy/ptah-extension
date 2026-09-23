/** Plain contracts: schemas depend on these types, never the reverse. */
import type {
  SurfaceActionId,
  SurfaceGap,
  SurfaceStackDirection,
} from './surface-catalog';
import type {
  DashboardAction,
  DashboardBarChartComponent,
  DashboardLineChartComponent,
  DashboardListComponent,
  DashboardRichText,
  DashboardSpecEnvelope,
  DashboardStatComponent,
  DashboardTableComponent,
} from './dashboard-spec.types';

export type SurfaceRichText = DashboardRichText;
export interface SurfaceAction extends Omit<DashboardAction, 'action'> {
  readonly id: string;
  readonly action: SurfaceActionId;
}

interface SurfaceLayoutBase {
  readonly id: string;
  readonly children: readonly SurfaceComponent[];
  readonly actions?: readonly SurfaceAction[];
}
export interface SurfaceSectionComponent extends SurfaceLayoutBase {
  readonly kind: 'section';
  readonly title: SurfaceRichText;
  readonly description?: SurfaceRichText;
}
export interface SurfaceStackComponent extends SurfaceLayoutBase {
  readonly kind: 'stack';
  readonly direction?: SurfaceStackDirection;
  readonly gap?: SurfaceGap;
}
export interface SurfaceGridComponent extends SurfaceLayoutBase {
  readonly kind: 'grid';
  readonly columns: number;
  readonly gap?: SurfaceGap;
}
export interface SurfaceCardComponent extends SurfaceLayoutBase {
  readonly kind: 'card';
  readonly title?: SurfaceRichText;
  readonly description?: SurfaceRichText;
}
export interface SurfaceRequiredHints {
  readonly required?: boolean;
}
export interface SurfaceTextHints extends SurfaceRequiredHints {
  readonly minLength?: number;
  readonly maxLength?: number;
}
export interface SurfaceInputOption {
  readonly value: string;
  readonly label: string;
}
interface SurfaceInputBase {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}
export interface SurfaceTextInput extends SurfaceInputBase {
  readonly kind: 'text';
  readonly description?: SurfaceRichText;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly hints?: SurfaceTextHints;
}
export interface SurfaceSelectInput extends SurfaceInputBase {
  readonly kind: 'select';
  readonly options: readonly SurfaceInputOption[];
  readonly hints?: SurfaceRequiredHints;
}
export interface SurfaceRadioGroupInput extends SurfaceInputBase {
  readonly kind: 'radio-group';
  readonly options: readonly SurfaceInputOption[];
  readonly hints?: SurfaceRequiredHints;
}
export interface SurfaceCheckboxInput extends SurfaceInputBase {
  readonly kind: 'checkbox';
  readonly hints?: SurfaceRequiredHints;
}
export type SurfaceInput =
  | SurfaceTextInput
  | SurfaceSelectInput
  | SurfaceRadioGroupInput
  | SurfaceCheckboxInput;
type SurfaceDisplay<T> = Omit<T, 'children' | 'actions'> & {
  readonly actions?: readonly SurfaceAction[];
};
export type SurfaceStatComponent = SurfaceDisplay<DashboardStatComponent>;
export type SurfaceLineChartComponent =
  SurfaceDisplay<DashboardLineChartComponent>;
export type SurfaceBarChartComponent =
  SurfaceDisplay<DashboardBarChartComponent>;
export type SurfaceTableComponent = SurfaceDisplay<DashboardTableComponent>;
export type SurfaceListComponent = SurfaceDisplay<DashboardListComponent>;
export type SurfaceComponent =
  | SurfaceSectionComponent
  | SurfaceStackComponent
  | SurfaceGridComponent
  | SurfaceCardComponent
  | SurfaceInput
  | SurfaceStatComponent
  | SurfaceLineChartComponent
  | SurfaceBarChartComponent
  | SurfaceTableComponent
  | SurfaceListComponent;

/** JSON only. The schema enforces finite numbers and bounded nesting/width. */
export type SurfaceDataValue =
  | string
  | number
  | boolean
  | null
  | readonly SurfaceDataValue[]
  | { readonly [key: string]: SurfaceDataValue };
export type SurfaceDataModel = Readonly<Record<string, SurfaceDataValue>>;
export interface SurfaceEnvelope {
  readonly schemaVersion: 'dashboard-spec/2';
  readonly catalogVersion: 'dashboard-catalog/2';
  readonly surfaceId: string;
  readonly title: SurfaceRichText;
  readonly description?: SurfaceRichText;
  readonly components: readonly SurfaceComponent[];
  readonly dataModel?: SurfaceDataModel;
}
export type SurfacePatchOp =
  | {
      readonly op: 'set-data';
      readonly path: string;
      readonly value: SurfaceDataValue;
    }
  | { readonly op: 'remove-data'; readonly path: string }
  | {
      readonly op: 'add-component';
      readonly parentId: string | null;
      readonly index?: number;
      readonly component: SurfaceComponent;
    }
  | { readonly op: 'replace-component'; readonly component: SurfaceComponent }
  | { readonly op: 'remove-component'; readonly componentId: string }
  | {
      readonly op: 'set-title';
      readonly title: SurfaceRichText;
      readonly description?: SurfaceRichText;
    };
export type SurfaceUpdateInput =
  | { readonly operation: 'create'; readonly surface: SurfaceEnvelope }
  | {
      readonly operation: 'replace';
      readonly baseRevision: number;
      readonly surface: SurfaceEnvelope;
    }
  | {
      readonly operation: 'patch';
      readonly surfaceId: string;
      readonly baseRevision: number;
      readonly ops: readonly SurfacePatchOp[];
    }
  | {
      readonly operation: 'delete';
      readonly surfaceId: string;
      readonly baseRevision: number;
    };
export interface SurfaceGetStateInput {
  readonly surfaceId?: string;
  /** Omitted means state. Structure requires a surfaceId. */
  readonly view?: 'state' | 'structure';
}
export type SurfaceSelectionTarget =
  | { readonly kind: 'stat' }
  | { readonly kind: 'table-row'; readonly rowIndex: number }
  | { readonly kind: 'list-item'; readonly itemIndex: number }
  | {
      readonly kind: 'chart-point';
      readonly seriesIndex: number;
      readonly pointIndex: number;
    };
export interface SurfaceSelection {
  readonly componentId: string;
  readonly target: SurfaceSelectionTarget;
}
export type SurfaceContent =
  | {
      readonly contract: 'dashboard-spec/2';
      readonly surface: Omit<SurfaceEnvelope, 'dataModel'>;
      readonly dataModel: SurfaceDataModel;
    }
  | {
      readonly contract: 'dashboard-spec/1';
      readonly spec: DashboardSpecEnvelope;
    };
export interface SurfaceSubmitRecord {
  readonly operationId: string;
  readonly actionId: string;
  readonly scopeComponentId: string;
  readonly baseRevision: number;
  readonly status: 'applied' | 'indeterminate';
  /** Epoch milliseconds, using the host clock. */
  readonly submittedAt: number;
  readonly values: readonly {
    readonly componentId: string;
    readonly path: string;
    readonly value: SurfaceDataValue;
  }[];
}
export interface SurfaceStateView {
  readonly surfaceId: string;
  readonly revision: number;
  readonly content: SurfaceContent;
  readonly selection: SurfaceSelection | null;
  readonly lastSubmit: SurfaceSubmitRecord | null;
}
/** One canonical value per unique bound path, even when several inputs share it. */
export type SurfaceFormValues = Readonly<
  Record<
    string,
    {
      readonly value: SurfaceDataValue;
      readonly inputs: readonly string[];
      readonly submitIssues: readonly string[];
    }
  >
>;
export type SurfaceStateOp =
  | SurfacePatchOp
  | {
      readonly op: 'set-selection';
      readonly selection: SurfaceSelection | null;
    }
  | { readonly op: 'set-last-submit'; readonly record: SurfaceSubmitRecord };
export type SurfaceChange =
  | { readonly kind: 'snapshot'; readonly state: SurfaceStateView }
  | {
      readonly kind: 'ops';
      readonly fromRevision: number;
      readonly ops: readonly SurfaceStateOp[];
    }
  | { readonly kind: 'deleted'; readonly reason: 'agent-deleted' | 'evicted' };
export type SurfaceOperationStatus =
  'pending' | 'applied' | 'rejected' | 'indeterminate' | 'unknown';
export type SurfaceRejectReason =
  | 'stale-revision'
  | 'invalid-value'
  | 'undeclared'
  | 'submit-invalid'
  | 'busy'
  | 'session-unavailable'
  | 'operation-conflict'
  | 'operation-expired'
  | 'too-many-operations'
  | 'budget';
