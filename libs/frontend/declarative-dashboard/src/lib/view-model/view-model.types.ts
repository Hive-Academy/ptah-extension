import type {
  DashboardAction,
  DashboardComponent,
  DashboardRichText,
} from '@ptah-extension/shared';
import type {
  SurfaceAction,
  SurfaceComponent,
  SurfaceDataValue,
  SurfaceInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/** Distributive mapping preserves narrowing by each component's kind. */
interface DisplayNodeFields {
  readonly selectable: boolean;
  readonly actions?: readonly (DashboardAction | SurfaceAction)[];
  /** Only v1 display components can contain children. */
  readonly children?: readonly DisplayNode[];
}

type DisplayOf<T> = T extends DashboardComponent
  ? Omit<T, 'children' | 'actions'> & DisplayNodeFields
  : never;

export type DisplayNode = DisplayOf<DashboardComponent>;

interface LayoutNodeFields {
  readonly selectable: boolean;
  readonly children: readonly SurfaceNode[];
  readonly submitActions: readonly SurfaceAction[];
}

type LayoutOf<T> = T extends {
  readonly kind: 'section' | 'stack' | 'grid' | 'card';
}
  ? Omit<T, 'children'> & LayoutNodeFields
  : never;

export type LayoutNode = LayoutOf<SurfaceComponent>;
export type InputNode = SurfaceInput & {
  readonly selectable: boolean;
  readonly hostValue: SurfaceDataValue;
  readonly draftError?: string;
};
export type SurfaceNode = LayoutNode | InputNode | DisplayNode;

export interface DashboardViewModel {
  readonly title: DashboardRichText;
  readonly description?: DashboardRichText;
  readonly components: readonly DisplayNode[];
}

export interface SurfaceViewModel {
  readonly title: DashboardRichText;
  readonly description?: DashboardRichText;
  readonly components: readonly SurfaceNode[];
}
