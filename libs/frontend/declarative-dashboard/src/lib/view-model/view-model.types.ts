import type {
  DashboardAction,
  DashboardComponent,
  DashboardRichText,
} from '@ptah-extension/shared';
import type {
  SurfaceAction,
  SurfaceAlertComponent,
  SurfaceAvatarComponent,
  SurfaceBadgeComponent,
  SurfaceComponent,
  SurfaceDataValue,
  SurfaceDividerComponent,
  SurfaceInput,
  SurfaceProgressComponent,
  SurfaceRadialProgressComponent,
  SurfaceStatComponent,
  SurfaceTextBlockComponent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/** Distributive mapping preserves narrowing by each component's kind. */
interface DisplayNodeFields {
  readonly selectable: boolean;
  readonly actions?: readonly (DashboardAction | SurfaceAction)[];
  /** Only v1 display components can contain children. */
  readonly children?: readonly DisplayNode[];
}

/** `dashboard-catalog/4` stat extras; a v1 or `/3` stat never carries them. */
type StatExtras = Pick<SurfaceStatComponent, 'trend' | 'spark'>;

type DisplayOf<T> = T extends DashboardComponent
  ? Omit<T, 'children' | 'actions'> & DisplayNodeFields & (T extends { readonly kind: 'stat' } ? StatExtras : unknown)
  : never;

export type DisplayNode = DisplayOf<DashboardComponent>;

interface LayoutNodeFields {
  readonly selectable: boolean;
  readonly children: readonly SurfaceNode[];
  readonly submitActions: readonly SurfaceAction[];
}

type LayoutOf<T> = T extends {
  readonly kind: 'section' | 'stack' | 'grid' | 'card' | 'accordion';
}
  ? Omit<T, 'children'> & LayoutNodeFields
  : never;

export type LayoutNode = LayoutOf<SurfaceComponent>;
export type InputNode = SurfaceInput & {
  readonly selectable: boolean;
  readonly hostValue: SurfaceDataValue;
  readonly draftError?: string;
};
/** Each of the six status kinds carries its own selectable flag. */
type StatusNodeOf<T> = T & { readonly selectable: boolean };
export type StatusNode =
  | StatusNodeOf<SurfaceAlertComponent>
  | StatusNodeOf<SurfaceBadgeComponent>
  | StatusNodeOf<SurfaceProgressComponent>
  | StatusNodeOf<SurfaceRadialProgressComponent>
  | StatusNodeOf<SurfaceDividerComponent>
  | StatusNodeOf<SurfaceTextBlockComponent>;
/** `dashboard-catalog/4`: plain name and subtitle only, never an image or URL. */
export type AvatarNode = SurfaceAvatarComponent & { readonly selectable: boolean };
export type SurfaceNode =
  | LayoutNode
  | InputNode
  | DisplayNode
  | StatusNode
  | AvatarNode;

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
