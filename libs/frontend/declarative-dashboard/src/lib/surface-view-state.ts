import type {
  SurfaceContent,
  SurfaceDataValue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/** Accepted host content; this renderer does not validate wire messages. */
export type SurfaceRenderable = SurfaceContent;

export const SURFACE_PAGE_SIZE = 25;

export interface SurfaceComponentViewState {
  readonly sort?: {
    readonly columnKey: string;
    readonly direction: 'asc' | 'desc';
  };
  readonly filter?: string;
  /** Zero-based page index. */
  readonly page?: number;
  readonly chartAsTable?: boolean;
  readonly expanded?: boolean;
}

/** Local presentation state, independent of host revisions. */
export interface SurfaceViewState {
  readonly components: Readonly<Record<string, SurfaceComponentViewState>>;
  readonly drafts: Readonly<Record<string, SurfaceDataValue>>;
}
