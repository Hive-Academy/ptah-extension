/** Lib-local tokens for host-owned surface state and delivery. */
export const VSCODE_LM_TOOLS_TOKENS = {
  /** Singleton facade for surface reads and mutations. */
  SURFACE_STATE_SERVICE: Symbol.for('SurfaceStateService'),
  /** Lazy provider resolving the current surface host on every push. */
  SURFACE_PUSH_HOST: Symbol.for('SurfacePushHost'),
} as const;
