import type { IDisposable } from '../types/platform.types';

export interface PtahViewVisibility {
  readonly visible: boolean;
  readonly focused: boolean;
}

/** Visibility of any registered Ptah sidebar or panel, with disposable updates. */
export interface IPtahViewVisibility {
  anyPtahViewVisible(): boolean;
  isPtahViewFocused(): boolean;
  onDidChange(listener: (visibility: PtahViewVisibility) => void): IDisposable;
}
