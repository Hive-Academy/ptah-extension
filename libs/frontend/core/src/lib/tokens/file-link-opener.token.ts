import { InjectionToken } from '@angular/core';

/**
 * A request to open a file the user clicked: a tool-call path chip, a task
 * artifact, or a link in agent markdown.
 */
export interface FileLinkOpenRequest {
  /**
   * The path as written: absolute, workspace-relative, or decoded from a
   * `file://` URL. Not validated here; the backend re-authorizes every path.
   */
  readonly path: string;
  /** 1-based line. */
  readonly line?: number;
  /** 1-based column. */
  readonly column?: number;
  /**
   * The element the click came from. The implementation reads link context
   * (session tab, previewed document, workspace root) from its ancestors.
   */
  readonly origin?: Element | null;
}

/**
 * Contract for opening a clicked file link in the host: Ptah's read-only
 * viewer on desktop, the native editor in VS Code.
 *
 * `open` resolves once the request is routed and rejects when it cannot be
 * opened, so a caller shows an error only on rejection.
 *
 * The chat library implements it. This token breaks the dependency cycle the
 * same way `WORKSPACE_COORDINATOR` does: core defines the port, feature
 * libraries consume it, and the composition root binds the implementation.
 * There is no default provider.
 */
export interface IFileLinkOpener {
  open(request: FileLinkOpenRequest): Promise<void>;
}

export const FILE_LINK_OPENER = new InjectionToken<IFileLinkOpener>(
  'FILE_LINK_OPENER',
);
