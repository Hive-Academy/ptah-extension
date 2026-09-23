/**
 * `@ptah-extension/shared/mcp-apps-contracts/surface` — v2 surface contracts.
 * A zod-bearing subpath of shared, not a separate project or runtime adapter.
 * Import plain contract types from `@ptah-extension/shared`; those modules
 * have no Zod dependency. Reach this entry point for schemas and v2 helpers.
 *
 * Importers must set `strict: true`: Zod's optional-key inference depends on
 * strictNullChecks. The base tsconfig sets strict to false, so an importer
 * needing only the plain shape should use the main barrel's type exports.
 * No Electron, Angular or platform imports; scope:shared, type:util.
 */
export type * from './surface.types';

// Catalog vocabulary and budgets
export {
  SURFACE_SCHEMA_VERSION,
  SURFACE_CATALOG_VERSION,
  SURFACE_SUPPORTED_SCHEMA_VERSIONS,
  SURFACE_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_CONTRACT_VERSION_PAIRS,
  SURFACE_LAYOUT_KINDS,
  SURFACE_INPUT_KINDS,
  SURFACE_DISPLAY_KINDS,
  SURFACE_COMPONENT_KINDS,
  SURFACE_ACTIONS,
  SURFACE_HOST_SUPPORTED_ACTIONS,
  SURFACE_INPUT_EMPTY_VALUES,
  SURFACE_V1_ID_PREFIX,
  SURFACE_OPERATION_ID_PATTERN,
  SURFACE_LIMITS,
  SURFACE_STORE_LIMITS,
} from './surface-catalog';
export type {
  SurfaceActionId,
  SurfaceComponentKind,
  SurfaceLayoutKind,
  SurfaceInputKind,
  SurfaceDisplayKind,
  SurfaceStackDirection,
  SurfaceGap,
} from './surface-catalog';

// Boundary schemas
export {
  SurfaceAnyIdSchema,
  SurfaceOperationIdSchema,
  SurfacePathSchema,
  SurfaceDataValueSchema,
  SurfaceSelectionSchema,
  SurfaceUpdateInputSchema,
  SurfaceGetStateInputSchema,
} from './surface.schemas';

// Bound data reads
export { readSurfacePath } from './surface-data-model';

// Inputs, actions and submit scope
export {
  collectSurfaceInputs,
  isSurfaceInputComponent,
  findSurfaceAction,
  checkDraftValue,
  checkSubmitValues,
  collectSubmitScope,
} from './surface-bindings';
export type {
  SurfaceSubmitValue,
  SurfaceSubmitIssue,
  SurfaceSubmitScope,
} from './surface-bindings';

// State operations and selection validity
export {
  applySurfaceOps,
  revalidateSelection,
  checkSurfaceSelection,
  isSurfaceStructureOp,
} from './surface-patch';
export type { SurfacePatchState, SurfacePatchResult } from './surface-patch';

// Write history and conflict checks
export {
  createSurfaceWriteLog,
  appendWrite,
  checkSurfaceConflict,
  surfaceOpsFootprint,
} from './surface-concurrency';
export type {
  SurfaceWriteLog,
  SurfaceWriteFootprint,
  SurfaceConflictMutation,
  SurfaceConflictResult,
} from './surface-concurrency';

// Update and document validation
export {
  validateSurfaceUpdateInput,
  validateSurfaceDocument,
  validateSurfaceEnvelopeVersions,
  formatSurfaceIssues,
} from './surface.validator';
export type {
  SurfaceValidationRejected,
  SurfaceUpdateInputAccepted,
  SurfaceDocumentAccepted,
} from './surface.validator';

// Plain-text presentation
export {
  renderSurfaceText,
  describeSurfaceLimits,
} from './surface-text-fallback';

// Submit message formatting
export { formatSurfaceSubmitMessage } from './surface-submit.format';

// Selection description
export { describeSurfaceSelection } from './surface-selection';
