/**
 * The one boundary validator for surface contract v2: MCP update input and
 * post-patch documents (plan Component 5). Same shape and guarantees as the v1
 * validator (`dashboard-spec.validator.ts`): the byte counter is injected, and
 * nothing here throws; every failure is `{ ok: false, reason, bytes? }`.
 *
 * Check order, for every public entry point:
 *
 * 1. Raw op count, before anything walks the ops.
 * 2. An ITERATIVE structural walk over the raw value: component tree depth,
 *    total components and children per node, and data-value nesting depth,
 *    array length and object width. `SurfaceComponentSchema` recurses through
 *    `children` with no depth bound of its own, so this walk is what keeps a
 *    hostile tree away from the recursive parser. It MUST precede every
 *    `SurfaceEnvelopeSchema` / `SurfaceUpdateInputSchema` parse. A generic
 *    iterative preflight then bounds nesting under EVERY other raw key
 *    (`SURFACE_MAX_RAW_JSON_DEPTH`), so no hostile value reaches the recursive
 *    byte counter.
 * 3. Bytes, measured on the value as it ARRIVED (request or document budget).
 * 4. Version pair (a named field for unknown or mixed pairs, Req 1.3).
 * 5. The zod parse: the authority on shape.
 * 6. Semantic checks on the parsed document: unique ids, input count, binding
 *    compatibility, stored values valid as drafts, and the submit scope rule.
 *
 * Why the walk precedes the byte count (unlike v1): the injected counter is
 * `JSON.stringify`, which recurses. A 10,000-level component tree overflows it
 * inside a jest worker, so a bytes-first order could only answer "could not be
 * validated", never name the depth budget. The walk is iterative, stops one
 * level past each budget, and is capped at one visit per budget byte, so it is
 * linear in the input like the byte count it precedes. That is not a strict
 * resource bound: `Object.keys` on a huge shallow object and the counter's full
 * serialization are still linear pre-rejection work, bounded only if the
 * transport caps raw request bytes. A rejection from steps 1-2 carries no
 * `bytes`, because nothing was measured.
 */
import {
  DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
} from './dashboard-catalog';
import { formatDashboardSpecIssues } from './dashboard-spec.validator';
import type {
  DashboardJsonByteCounter,
  DashboardSpecRejected,
} from './dashboard-spec.validator';
import {
  checkBindingCompatibility,
  checkDraftValue,
  collectSubmitScope,
  isSurfaceInputComponent,
  surfaceActionsOf,
  visitSurfaceComponents,
} from './surface-bindings';
import {
  DASHBOARD_CONTRACT_VERSION_PAIRS,
  SURFACE_LIMITS,
  SURFACE_SUPPORTED_CATALOG_VERSIONS,
  SURFACE_SUPPORTED_SCHEMA_VERSIONS,
} from './surface-catalog';
import { parseSurfacePath, readSurfacePath } from './surface-data-model';
import {
  SurfaceEnvelopeSchema,
  SurfaceUpdateInputSchema,
} from './surface.schemas';
import type {
  SurfaceDataModel,
  SurfaceEnvelope,
  SurfaceInput,
  SurfaceUpdateInput,
} from './surface.types';

/** The v1 formatter, re-used so both contracts word zod issues the same way. */
export const formatSurfaceIssues = formatDashboardSpecIssues;

export type SurfaceValidationRejected = DashboardSpecRejected;
export interface SurfaceUpdateInputAccepted {
  readonly ok: true;
  readonly input: SurfaceUpdateInput;
  /** UTF-8 JSON bytes of the request as received. */
  readonly bytes: number;
}
export type SurfaceUpdateInputValidation =
  SurfaceUpdateInputAccepted | SurfaceValidationRejected;
export interface SurfaceDocumentAccepted {
  readonly ok: true;
  readonly surface: SurfaceEnvelope;
  /** Structure plus data model, measured against `maxSurfaceBytes`. */
  readonly bytes: number;
  readonly dataModelBytes: number;
}
export type SurfaceDocumentValidation =
  SurfaceDocumentAccepted | SurfaceValidationRejected;

export type SurfaceContractVersion = 'dashboard-spec/1' | 'dashboard-spec/2';
export type SurfaceVersionCheck =
  | { readonly ok: true; readonly contract: SurfaceContractVersion }
  | {
      readonly ok: false;
      readonly field: 'schemaVersion' | 'catalogVersion';
      readonly reason: string;
    };

type Breach = string | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Untrusted text in a reason is quoted and capped so it stays one short line. */
function quote(value: unknown): string {
  return JSON.stringify(String(value).slice(0, 64));
}

const KNOWN_SCHEMA_VERSIONS: readonly string[] = [
  ...DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
  ...SURFACE_SUPPORTED_SCHEMA_VERSIONS,
];
const KNOWN_CATALOG_VERSIONS: readonly string[] = [
  ...DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  ...SURFACE_SUPPORTED_CATALOG_VERSIONS,
];

/**
 * Read the raw version pair and check it against the one statement of legal
 * pairs, `DASHBOARD_CONTRACT_VERSION_PAIRS`. The reason names the field: the
 * schema version when it is missing or unknown, otherwise the catalog version
 * (unknown, or not the partner of the schema version). Never throws.
 */
export function validateSurfaceEnvelopeVersions(
  input: unknown,
): SurfaceVersionCheck {
  try {
    const schemaVersion = isRecord(input) ? input['schemaVersion'] : undefined;
    const catalogVersion = isRecord(input)
      ? input['catalogVersion']
      : undefined;
    if (
      typeof schemaVersion !== 'string' ||
      !KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)
    )
      return {
        ok: false,
        field: 'schemaVersion',
        reason: `schemaVersion ${schemaVersion === undefined ? 'is missing' : `${quote(schemaVersion)} is unknown`}; supported: ${KNOWN_SCHEMA_VERSIONS.join(', ')}.`,
      };
    if (
      typeof catalogVersion !== 'string' ||
      !KNOWN_CATALOG_VERSIONS.includes(catalogVersion)
    )
      return {
        ok: false,
        field: 'catalogVersion',
        reason: `catalogVersion ${catalogVersion === undefined ? 'is missing' : `${quote(catalogVersion)} is unknown`}; supported: ${KNOWN_CATALOG_VERSIONS.join(', ')}.`,
      };
    const pair = DASHBOARD_CONTRACT_VERSION_PAIRS.find(
      ([schema]) => schema === schemaVersion,
    );
    if (pair === undefined || pair[1] !== catalogVersion)
      return {
        ok: false,
        field: 'catalogVersion',
        reason: `catalogVersion ${quote(catalogVersion)} does not pair with schemaVersion ${quote(schemaVersion)}; expected ${pair?.[1] ?? 'a defined pair'}.`,
      };
    return { ok: true, contract: pair[0] };
  } catch {
    return {
      ok: false,
      field: 'schemaVersion',
      reason: 'schemaVersion could not be read.',
    };
  }
}

/**
 * Shared across all roots of one request or document, so totals are bounded
 * too. `values` caps how many data values the walk may visit: every JSON value
 * costs at least one byte, so a value with more nodes than the byte budget
 * can never be accepted, and the cap keeps the walk linear even for an
 * in-process object graph that shares subtrees.
 */
interface WalkBudget {
  nodes: number;
  values: number;
  readonly maxValues: number;
  readonly byteBudget: string;
}

function walkBudget(
  byteBudget: 'maxUpdateRequestBytes' | 'maxSurfaceBytes',
): WalkBudget {
  return {
    nodes: 0,
    values: 0,
    maxValues: SURFACE_LIMITS[byteBudget],
    byteBudget,
  };
}

/**
 * Iterative walk over raw component roots. Reads only `children`; zod is the
 * authority on everything else. Stops at the first breach, one level past the
 * budget, never at the bottom of a hostile tree.
 */
function findTreeBreach(
  roots: readonly { readonly node: unknown; readonly path: string }[],
  budget: WalkBudget,
): Breach {
  const stack = roots.map(({ node, path }) => ({ node, depth: 1, path }));
  stack.reverse();
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (entry.depth > SURFACE_LIMITS.maxTreeDepth)
      return `${entry.path}: component tree is more than ${SURFACE_LIMITS.maxTreeDepth} levels deep, over the maxTreeDepth limit of ${SURFACE_LIMITS.maxTreeDepth}.`;
    budget.nodes += 1;
    if (budget.nodes > SURFACE_LIMITS.maxComponents)
      return `${entry.path}: request carries more than ${SURFACE_LIMITS.maxComponents} components, over the maxComponents limit of ${SURFACE_LIMITS.maxComponents}.`;
    const children = isRecord(entry.node) ? entry.node['children'] : undefined;
    if (!Array.isArray(children)) continue;
    if (children.length > SURFACE_LIMITS.maxChildrenPerNode)
      return `${entry.path}.children: ${children.length} children, over the maxChildrenPerNode limit of ${SURFACE_LIMITS.maxChildrenPerNode}.`;
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({
        node: children[index],
        depth: entry.depth + 1,
        path: `${entry.path}.children.${index}`,
      });
  }
  return null;
}

/**
 * Iterative walk over a raw data value. `rootDepth` is the container depth of
 * `value` itself: 1 for both a data-model root and a standalone set-data value,
 * matching `SurfaceDataModelSchema` and `SurfaceDataValueSchema`.
 */
function findDataBreach(
  value: unknown,
  label: string,
  budget: WalkBudget,
): Breach {
  const stack: { value: unknown; depth: number; path: string }[] = [
    { value, depth: 1, path: label },
  ];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    budget.values += 1;
    if (budget.values > budget.maxValues)
      return `${entry.path}: more than ${budget.maxValues} data values cannot fit the ${budget.byteBudget} limit of ${budget.maxValues}.`;
    const isArray = Array.isArray(entry.value);
    if (!isArray && !isRecord(entry.value)) continue;
    if (entry.depth > SURFACE_LIMITS.maxDataModelDepth)
      return `${entry.path}: data is nested more than ${SURFACE_LIMITS.maxDataModelDepth} levels deep, over the maxDataModelDepth limit of ${SURFACE_LIMITS.maxDataModelDepth}.`;
    if (Array.isArray(entry.value)) {
      if (entry.value.length > SURFACE_LIMITS.maxDataModelArrayLength)
        return `${entry.path}: array has ${entry.value.length} items, over the maxDataModelArrayLength limit of ${SURFACE_LIMITS.maxDataModelArrayLength}.`;
      entry.value.forEach((item, index) =>
        stack.push({
          value: item,
          depth: entry.depth + 1,
          path: `${entry.path}.${index}`,
        }),
      );
    } else if (isRecord(entry.value)) {
      const record = entry.value;
      const keys = Object.keys(record);
      if (keys.length > SURFACE_LIMITS.maxDataModelObjectKeys)
        return `${entry.path}: object has ${keys.length} keys, over the maxDataModelObjectKeys limit of ${SURFACE_LIMITS.maxDataModelObjectKeys}.`;
      for (const key of keys)
        stack.push({
          value: record[key],
          depth: entry.depth + 1,
          path: `${entry.path}.${String(key).slice(0, 64)}`,
        });
    }
  }
  return null;
}

/** Structural walk of a raw envelope-shaped value (`components`, `dataModel`). */
function findEnvelopeBreach(
  surface: unknown,
  label: string,
  budget: WalkBudget,
): Breach {
  if (!isRecord(surface)) return null;
  const components = surface['components'];
  if (Array.isArray(components)) {
    if (components.length > SURFACE_LIMITS.maxComponents)
      return `${label}components: ${components.length} root components, over the maxComponents limit of ${SURFACE_LIMITS.maxComponents}.`;
    const breach = findTreeBreach(
      components.map((node: unknown, index) => ({
        node,
        path: `${label}components.${index}`,
      })),
      budget,
    );
    if (breach !== null) return breach;
  }
  return surface['dataModel'] === undefined
    ? null
    : findDataBreach(surface['dataModel'], `${label}dataModel`, budget);
}

/** Walk every component root and data value an update request carries. */
function findUpdateBreach(input: Record<string, unknown>): Breach {
  const budget = walkBudget('maxUpdateRequestBytes');
  const envelopeBreach = findEnvelopeBreach(
    input['surface'],
    'surface.',
    budget,
  );
  if (envelopeBreach !== null) return envelopeBreach;
  const ops = input['ops'];
  if (!Array.isArray(ops)) return null;
  for (let index = 0; index < ops.length; index++) {
    const op: unknown = ops[index];
    if (!isRecord(op)) continue;
    if (op['component'] !== undefined) {
      const breach = findTreeBreach(
        [{ node: op['component'], path: `ops.${index}.component` }],
        budget,
      );
      if (breach !== null) return breach;
    }
    if ('value' in op) {
      const breach = findDataBreach(op['value'], `ops.${index}.value`, budget);
      if (breach !== null) return breach;
    }
  }
  return null;
}

/**
 * Deepest container nesting any legal request or document can reach: request
 * object, `surface` or `ops`/op, the components array, two levels (object and
 * `children` array) per tree level, then at most four fixed levels inside a
 * leaf component (for example `series` > series > `points` > point). Legal
 * input peaks at 22 with the current budgets; the bound keeps a small margin.
 * It exists only so that a hostile nesting under a key the dedicated walks do
 * not follow is rejected with a named budget, before the recursive byte
 * counter can overflow.
 */
export const SURFACE_MAX_RAW_JSON_DEPTH = 2 * SURFACE_LIMITS.maxTreeDepth + 8;

/**
 * Generic iterative preflight over EVERY raw key. Runs after the dedicated
 * walks (which name the specific budget) and before the byte count.
 *
 * The budget (one value per budget byte, since every JSON value costs at
 * least one byte) is charged when a child is SCHEDULED, before it is read or
 * queued: an array's `length` is checked against what remains before any
 * element is touched, and object keys are charged one by one while they are
 * enumerated. So at most `maxValues` values are ever read or queued, however
 * wide the collection. Enumerating an object's keys is still done by the
 * engine; see the resource-bound note in the module header.
 */
function findRawDepthBreach(
  value: unknown,
  label: string,
  byteBudget: 'maxUpdateRequestBytes' | 'maxSurfaceBytes',
): Breach {
  const maxValues = SURFACE_LIMITS[byteBudget];
  const overBudget = (path: string) =>
    `${path}: more than ${maxValues} JSON values cannot fit the ${byteBudget} limit of ${maxValues}.`;
  const stack: { value: unknown; depth: number; path: string }[] = [
    { value, depth: 1, path: label },
  ];
  let scheduled = 1;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const container = entry.value;
    if (typeof container !== 'object' || container === null) continue;
    if (entry.depth > SURFACE_MAX_RAW_JSON_DEPTH)
      return `${entry.path}: JSON is nested more than ${SURFACE_MAX_RAW_JSON_DEPTH} levels deep, over the raw nesting limit SURFACE_MAX_RAW_JSON_DEPTH of ${SURFACE_MAX_RAW_JSON_DEPTH}.`;
    if (Array.isArray(container)) {
      const length = container.length;
      if (length > maxValues - scheduled) return overBudget(entry.path);
      scheduled += length;
      for (let index = 0; index < length; index++)
        stack.push({
          value: container[index],
          depth: entry.depth + 1,
          path: `${entry.path}.${index}`,
        });
    } else {
      const record = container as Record<string, unknown>;
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        if (scheduled >= maxValues) return overBudget(entry.path);
        scheduled += 1;
        stack.push({
          value: record[key],
          depth: entry.depth + 1,
          path: `${entry.path}.${key.slice(0, 64)}`,
        });
      }
    }
  }
  return null;
}

/**
 * A bound path must be able to hold a value: the model root counts as one
 * container, so a value at N segments sits in N nested objects, and N may not
 * exceed `maxDataModelDepth`. A stored value must be reachable through
 * objects only and be a valid draft; a missing, representable path is fine.
 */
function boundPathBreach(model: SurfaceDataModel, input: SurfaceInput): Breach {
  const parsed = parseSurfacePath(input.path);
  if (!parsed.ok) return `Input "${input.id}": ${parsed.reason}`;
  if (parsed.segments.length > SURFACE_LIMITS.maxDataModelDepth)
    return `Input "${input.id}" binds "${input.path}" (${parsed.segments.length} segments), which can never hold a value within the maxDataModelDepth limit of ${SURFACE_LIMITS.maxDataModelDepth}; use at most ${SURFACE_LIMITS.maxDataModelDepth} segments.`;
  let node: unknown = model;
  for (let index = 0; index < parsed.segments.length - 1; index++) {
    const segment = parsed.segments[index];
    if (!isRecord(node) || !Object.prototype.hasOwnProperty.call(node, segment))
      return null;
    node = node[segment];
    if (!isRecord(node))
      return `Input "${input.id}" binds "${input.path}", but "${parsed.segments.slice(0, index + 1).join('.')}" holds a non-object value.`;
  }
  const read = readSurfacePath(model, input.path);
  if (!read.ok) return read.reason;
  const draft = checkDraftValue(input, read.value);
  return draft.ok ? null : draft.reason;
}

/** Step 6: rules zod cannot express, on an already-parsed document. */
function findSemanticBreach(surface: SurfaceEnvelope): Breach {
  const componentIds = new Set<string>();
  const actionIds = new Set<string>();
  const inputs: SurfaceInput[] = [];
  const submitActions: string[] = [];
  // A holder, because assignments inside the visitor are invisible to narrowing.
  const walk: { count: number; breach: Breach } = { count: 0, breach: null };
  visitSurfaceComponents(surface.components, (component, depth) => {
    walk.count += 1;
    if (walk.count > SURFACE_LIMITS.maxComponents)
      walk.breach = `surface carries more than ${SURFACE_LIMITS.maxComponents} components, over the maxComponents limit of ${SURFACE_LIMITS.maxComponents}.`;
    else if (depth > SURFACE_LIMITS.maxTreeDepth)
      walk.breach = `component "${component.id}" is at depth ${depth}, over the maxTreeDepth limit of ${SURFACE_LIMITS.maxTreeDepth}.`;
    else if (componentIds.has(component.id))
      walk.breach = `Duplicate component id "${component.id}".`;
    if (walk.breach !== null) return false;
    componentIds.add(component.id);
    for (const action of surfaceActionsOf(component)) {
      if (actionIds.has(action.id)) {
        walk.breach = `Duplicate action id "${action.id}".`;
        return false;
      }
      actionIds.add(action.id);
      if (action.action === 'surface.submit') submitActions.push(action.id);
    }
    if (isSurfaceInputComponent(component)) inputs.push(component);
    return true;
  });
  if (walk.breach !== null) return walk.breach;
  if (inputs.length > SURFACE_LIMITS.maxInputs)
    return `surface declares ${inputs.length} inputs, over the maxInputs limit of ${SURFACE_LIMITS.maxInputs}.`;
  const bindings = checkBindingCompatibility(inputs);
  if (!bindings.ok) return bindings.reason;
  const model = surface.dataModel ?? {};
  for (const input of inputs) {
    const pathBreach = boundPathBreach(model, input);
    if (pathBreach !== null) return pathBreach;
  }
  for (const actionId of submitActions) {
    const scope = collectSubmitScope(surface.components, actionId);
    if (!scope.ok) return scope.reason;
  }
  return null;
}

function unvalidatable(
  subject: string,
  error: unknown,
  bytes: number | undefined,
): SurfaceValidationRejected {
  return {
    ...(bytes === undefined ? {} : { bytes }),
    ok: false,
    reason:
      `${subject} could not be validated: ${safeErrorDetail(error)}. This usually means the JSON is ` +
      'nested far more deeply than the contract allows. Send a flat value.',
  };
}

/**
 * Keep only a short message: an exception object never crosses the boundary.
 * Starts from a constant, and every inspection is guarded, because the thrown
 * value may itself be hostile (`Object.create(null)`, a throwing `message`
 * accessor, a Proxy); formatting a failure must never throw.
 */
function safeErrorDetail(error: unknown): string {
  let detail = 'unexpected error';
  try {
    if (typeof error === 'string') detail = error;
    else if (error instanceof Error) {
      const message: unknown = error.message;
      if (typeof message === 'string') detail = message;
    }
  } catch {
    // Keep the constant detail.
  }
  return detail.slice(0, 200);
}

/**
 * Validate an untrusted `ptah_surface_update` argument object. For create and
 * replace, the carried surface also passes the document checks (Step 6 and
 * the surface byte budgets), so the tool can reject before touching the store;
 * the store still re-validates the resulting document after every patch.
 */
export function validateSurfaceUpdateInput(
  input: unknown,
  countBytes: DashboardJsonByteCounter,
): SurfaceUpdateInputValidation {
  let bytes: number | undefined;
  try {
    if (isRecord(input)) {
      const ops = input['ops'];
      if (Array.isArray(ops) && ops.length > SURFACE_LIMITS.maxPatchOps)
        return {
          ok: false,
          reason: `ops: ${ops.length} operations, over the maxPatchOps limit of ${SURFACE_LIMITS.maxPatchOps}.`,
        };
      const breach = findUpdateBreach(input);
      if (breach !== null) return { ok: false, reason: breach };
    }
    const rawBreach = findRawDepthBreach(
      input,
      'request',
      'maxUpdateRequestBytes',
    );
    if (rawBreach !== null) return { ok: false, reason: rawBreach };
    bytes = countBytes(input);
    if (bytes > SURFACE_LIMITS.maxUpdateRequestBytes)
      return {
        ok: false,
        bytes,
        reason: `request is ${bytes} UTF-8 bytes, over the maxUpdateRequestBytes limit of ${SURFACE_LIMITS.maxUpdateRequestBytes}.`,
      };
    if (!isRecord(input))
      return { ok: false, bytes, reason: 'request must be a JSON object.' };
    const surface = input['surface'];
    if (surface !== undefined) {
      const versions = validateSurfaceEnvelopeVersions(surface);
      if (!versions.ok)
        return { ok: false, bytes, reason: `surface.${versions.reason}` };
      if (versions.contract !== 'dashboard-spec/2')
        return {
          ok: false,
          bytes,
          reason:
            'surface.schemaVersion: dashboard-spec/1 envelopes are proposed with ptah_dashboard_propose_spec; ptah_surface_update accepts dashboard-spec/2 only.',
        };
    }
    const parsed = SurfaceUpdateInputSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        bytes,
        reason: formatSurfaceIssues(parsed.error.issues),
      };
    const value = parsed.data;
    if (value.operation === 'create' || value.operation === 'replace') {
      const document = checkDocumentBudgetsAndSemantics(
        value.surface,
        countBytes,
      );
      if (document !== null)
        return { ok: false, bytes, reason: `surface: ${document}` };
    }
    return { ok: true, bytes, input: value };
  } catch (error: unknown) {
    return unvalidatable('surface request', error, bytes);
  }
}

function documentBytes(
  doc: unknown,
  countBytes: DashboardJsonByteCounter,
): { bytes: number; dataModelBytes: number; breach: Breach } {
  const bytes = countBytes(doc);
  const model = isRecord(doc) ? doc['dataModel'] : undefined;
  const dataModelBytes = countBytes(model === undefined ? {} : model);
  if (dataModelBytes > SURFACE_LIMITS.maxDataModelBytes)
    return {
      bytes,
      dataModelBytes,
      breach: `data model is ${dataModelBytes} UTF-8 bytes, over the maxDataModelBytes limit of ${SURFACE_LIMITS.maxDataModelBytes}.`,
    };
  if (bytes > SURFACE_LIMITS.maxSurfaceBytes)
    return {
      bytes,
      dataModelBytes,
      breach: `surface is ${bytes} UTF-8 bytes (structure plus data model), over the maxSurfaceBytes limit of ${SURFACE_LIMITS.maxSurfaceBytes}.`,
    };
  return { bytes, dataModelBytes, breach: null };
}

function checkDocumentBudgetsAndSemantics(
  surface: SurfaceEnvelope,
  countBytes: DashboardJsonByteCounter,
): Breach {
  const measured = documentBytes(surface, countBytes);
  return measured.breach ?? findSemanticBreach(surface);
}

/**
 * Validate a whole surface document (structure plus data model): after create
 * and after every patch, before the host commits (Req 5.2). The rejection of an
 * oversized document names the budget (Req 4.3).
 */
export function validateSurfaceDocument(
  doc: unknown,
  countBytes: DashboardJsonByteCounter,
): SurfaceDocumentValidation {
  let bytes: number | undefined;
  try {
    const breach =
      findEnvelopeBreach(doc, '', walkBudget('maxSurfaceBytes')) ??
      findRawDepthBreach(doc, 'surface', 'maxSurfaceBytes');
    if (breach !== null) return { ok: false, reason: breach };
    const measured = documentBytes(doc, countBytes);
    bytes = measured.bytes;
    if (measured.breach !== null)
      return { ok: false, bytes, reason: measured.breach };
    const versions = validateSurfaceEnvelopeVersions(doc);
    if (!versions.ok) return { ok: false, bytes, reason: versions.reason };
    if (versions.contract !== 'dashboard-spec/2')
      return {
        ok: false,
        bytes,
        reason:
          'schemaVersion: a surface document must be dashboard-spec/2; v1 specs are validated with validateDashboardSpec.',
      };
    const parsed = SurfaceEnvelopeSchema.safeParse(doc);
    if (!parsed.success)
      return {
        ok: false,
        bytes,
        reason: formatSurfaceIssues(parsed.error.issues),
      };
    const semantic = findSemanticBreach(parsed.data);
    if (semantic !== null) return { ok: false, bytes, reason: semantic };
    return {
      ok: true,
      bytes,
      dataModelBytes: measured.dataModelBytes,
      surface: parsed.data,
    };
  } catch (error: unknown) {
    return unvalidatable('surface', error, bytes);
  }
}
