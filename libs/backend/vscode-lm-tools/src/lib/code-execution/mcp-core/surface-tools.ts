/**
 * `ptah_surface_update` and `ptah_surface_get_state` — the tool definitions
 * (TASK_2026_538, plan Component 13).
 *
 * Follows `dashboard-propose-spec.tool.ts`: every input schema is GENERATED
 * from the zod contract with `z.toJSONSchema`, and every kind, action id and
 * budget in the prose is interpolated from the catalog, so a limit cannot
 * change in the schema and stay stale in the text an agent reads.
 *
 * One addition over the v1 tool: `SurfaceUpdateInputSchema` is a discriminated
 * union, which zod emits as a top-level `oneOf`. An MCP `inputSchema` must be
 * `type: "object"`, and several clients reject a top-level `oneOf`, so the
 * generated branches are merged into one closed object (see
 * `flattenOperationUnion`). The branch field schemas are kept verbatim; the
 * per-operation requirements move into field descriptions, and the validator
 * behind the tool remains the authority.
 */

import { z } from 'zod';
import {
  SURFACE_ACTIONS,
  SURFACE_CATALOG_VERSION,
  SURFACE_DISPLAY_KINDS,
  SURFACE_HOST_SUPPORTED_ACTIONS,
  SURFACE_INPUT_EMPTY_VALUES,
  SURFACE_INPUT_KINDS,
  SURFACE_LAYOUT_KINDS,
  SURFACE_LIMITS,
  SURFACE_SCHEMA_VERSION,
  SURFACE_STORE_LIMITS,
  SURFACE_V1_ID_PREFIX,
  SurfaceGetStateInputSchema,
  SurfaceUpdateInputSchema,
  describeSurfaceLimits,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SURFACE_READER_MIN_STATE_READ_BYTES } from '../../surface/surface-state-reader';
import type { MCPToolDefinition } from '../types';

export const SURFACE_UPDATE_TOOL_NAME = 'ptah_surface_update';
export const SURFACE_GET_STATE_TOOL_NAME = 'ptah_surface_get_state';

type InputSchema = MCPToolDefinition['inputSchema'];
type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bytes to a whole-or-fractional KiB label, e.g. 561152 -> "548 KiB". */
export function formatKiB(bytes: number): string {
  return `${Number((bytes / 1024).toFixed(2))} KiB`;
}

function generate(schema: z.ZodType): JsonObject {
  const generated: JsonObject = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
  });
  // An MCP inputSchema is a fragment, not a document.
  const { $schema: _ignoredSchemaKeyword, ...fragment } = generated;
  return fragment;
}

/**
 * Merge a top-level `oneOf` of closed object branches, each discriminated by a
 * `const` on `discriminator`, into ONE closed object schema. Shared fields
 * keep the first branch's generated schema (the branches reuse the same zod
 * schema for them), and each field's description names the operations that
 * require it. `definitions` (the recursive component tree) is preserved, so
 * every `$ref` still resolves.
 */
export function flattenOperationUnion(
  fragment: JsonObject,
  discriminator: string,
): InputSchema {
  const { oneOf, ...rest } = fragment;
  const values: string[] = [];
  const properties: JsonObject = {};
  const requiredBy = new Map<string, string[]>();

  for (const branch of Array.isArray(oneOf) ? oneOf : []) {
    if (!isJsonObject(branch) || !isJsonObject(branch['properties'])) continue;
    const branchProperties = branch['properties'];
    const tag = branchProperties[discriminator];
    const value = isJsonObject(tag) ? tag['const'] : undefined;
    if (typeof value !== 'string') continue;
    values.push(value);
    const required = Array.isArray(branch['required'])
      ? branch['required'].filter(
          (key): key is string => typeof key === 'string',
        )
      : [];
    for (const [key, schema] of Object.entries(branchProperties)) {
      if (key === discriminator) continue;
      if (!(key in properties)) properties[key] = schema;
      if (required.includes(key))
        requiredBy.set(key, [...(requiredBy.get(key) ?? []), value]);
    }
  }

  for (const [key, schema] of Object.entries(properties)) {
    const operations = requiredBy.get(key) ?? [];
    const note =
      `Required for ${discriminator} ${operations.join(', ')}; ` +
      `not allowed for any other ${discriminator}.`;
    properties[key] = isJsonObject(schema)
      ? {
          ...schema,
          description:
            typeof schema['description'] === 'string'
              ? `${schema['description']} ${note}`
              : note,
        }
      : schema;
  }

  return {
    ...rest,
    type: 'object',
    properties: {
      [discriminator]: { type: 'string', enum: values },
      ...properties,
    },
    required: [discriminator],
    additionalProperties: false,
  } as InputSchema;
}

function buildUpdateInputSchema(): InputSchema {
  return flattenOperationUnion(generate(SurfaceUpdateInputSchema), 'operation');
}

function buildGetStateInputSchema(): InputSchema {
  const fragment = generate(SurfaceGetStateInputSchema);
  return {
    ...fragment,
    type: 'object',
    properties: isJsonObject(fragment['properties'])
      ? fragment['properties']
      : {},
  } as InputSchema;
}

function describeEmptyInputValues(): string {
  return Object.entries(SURFACE_INPUT_EMPTY_VALUES)
    .map(([kind, value]) => `${kind} ${JSON.stringify(value)}`)
    .join(', ');
}

const ANONYMOUS_RULES =
  'Without an attached chat session (an anonymous caller): create and replace are ' +
  'validated and returned as plain text marked "no interactive surface is attached", ' +
  'and NOTHING is stored or pushed; patch and delete fail with "surface state unavailable ' +
  'for this caller"; ptah_surface_get_state answers "no surface state for this caller". ' +
  'Surfaces are scoped to the calling chat session by the host. You never pass a session, ' +
  "tab or routing id; an extra key such as that is rejected, and another session's " +
  'surface id is reported as not found.';

/** Build the `ptah_surface_update` tool definition. */
export function buildSurfaceUpdateTool(): MCPToolDefinition {
  const maxRead = SURFACE_LIMITS.maxStateReadBytes;
  return {
    name: SURFACE_UPDATE_TOOL_NAME,
    description:
      'Create, replace, patch or delete an interactive surface (a declarative dashboard ' +
      'with inputs) shown to the user. You emit JSON from a FIXED catalog; you never write ' +
      'HTML, CSS or a template. Operations: { operation: "create", surface } | { operation: ' +
      '"replace", baseRevision, surface } | { operation: "patch", surfaceId, baseRevision, ' +
      'ops: [...] } | { operation: "delete", surfaceId, baseRevision }. A surface is ' +
      `{ schemaVersion: "${SURFACE_SCHEMA_VERSION}", catalogVersion: "${SURFACE_CATALOG_VERSION}", ` +
      'surfaceId, title: {text}, description?: {text}, components: [...], dataModel?: {...} }. ' +
      `Component kinds (exactly these, anything else is rejected): layout ${SURFACE_LAYOUT_KINDS.join(', ')}; ` +
      `input ${SURFACE_INPUT_KINDS.join(', ')}; display ${SURFACE_DISPLAY_KINDS.join(', ')}. ` +
      'Layout kinds nest `children`; component ids are unique across the whole surface. An ' +
      'input binds a dataModel `path` (dot-separated segments); a missing binding reads its ' +
      `empty value (${describeEmptyInputValues()}). Select and radio-group are empty only at ` +
      'null (an empty string is a value); required text is checked after trimming; a required ' +
      'checkbox must be checked. Action ids (exactly these): ' +
      `${SURFACE_ACTIONS.join(', ')}; the host handles ${SURFACE_HOST_SUPPORTED_ACTIONS.join(' and ')} ` +
      'itself. An action is { id, action, label: {text}, url?, params? }; url only on ' +
      'dashboard.open-url; surface.submit takes no params and sends the form values to you as ' +
      'the next user message. Patch ops: set-data { path, value }, remove-data { path }, ' +
      'add-component { parentId (null for top level), index?, component }, replace-component ' +
      '{ component }, remove-component { componentId }, set-title { title, description? }. ' +
      'set-title replaces the WHOLE header: an omitted description removes the existing one. ' +
      'An add-component index past the end of the target list is rejected, not clamped. Data ' +
      'reference components ({ data: { resultId } }) cannot be selected by row, item or point ' +
      'index. Text is plain text: no markdown and no HTML. Staleness: every write returns the ' +
      'committed host revision; replace, patch and delete must carry baseRevision equal to the ' +
      'CURRENT revision, otherwise they are rejected stale and nothing changes. Revisions move ' +
      'when the user edits inputs or selects too, so on a stale rejection read the surface with ' +
      'ptah_surface_get_state and resend against the new revision. create on an existing ' +
      `surfaceId is rejected. Ids starting "${SURFACE_V1_ID_PREFIX}" are v1 surfaces managed by ` +
      'ptah_dashboard_propose_spec and cannot be written here. Validation is ALL-OR-NOTHING: one ' +
      'bad field rejects the whole request, nothing is stored or pushed, and the error names the ' +
      `offending path. Limits: ${describeSurfaceLimits()}. Store: at most ` +
      `${SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId} surfaces per chat session and ` +
      `${SURFACE_STORE_LIMITS.maxRoutingIds} sessions per host (least recently used released first; ` +
      `the total store budget is ${SURFACE_STORE_LIMITS.maxStoreBytes} UTF-8 bytes). Reads are ` +
      `bounded by ${formatKiB(maxRead)} (${maxRead} UTF-8 bytes). On success you get the surface ` +
      'back as plain text with its committed revision. If the change was committed but NOT ' +
      'delivered to the UI, the result is an error that states the committed revision: do not ' +
      'resend, because the same request would be stale; read the state instead. ' +
      ANONYMOUS_RULES,
    inputSchema: buildUpdateInputSchema(),
    annotations: { destructiveHint: false },
  };
}

/** Build the `ptah_surface_get_state` tool definition. */
export function buildSurfaceGetStateTool(): MCPToolDefinition {
  const maxRead = SURFACE_LIMITS.maxStateReadBytes;
  return {
    name: SURFACE_GET_STATE_TOOL_NAME,
    description:
      'Read the current state of the interactive surfaces in this chat session: data model, ' +
      "input values, validation issues, the user's current selection and the last submit, " +
      'each with its host revision. Call it when the user refers to "this", "the selected ' +
      'row" or the form, and before resending after a stale rejection. Arguments: ' +
      '{ surfaceId?, view?: "state" | "structure" }. view "state" (the default) without ' +
      'surfaceId lists every surface id and revision first, then as many COMPLETE states as ' +
      'fit, followed by a truncation marker naming any omitted ids (read those one at a time). ' +
      'With surfaceId it returns that surface\'s complete state. view "structure" requires ' +
      'surfaceId and returns its component tree. maxSurfaceBytes ' +
      `${SURFACE_LIMITS.maxSurfaceBytes} UTF-8 bytes bounds the surface you SEND, not this ` +
      'answer: the returned text is escaped JSON and can be larger than the stored surface. ' +
      'A read never returns a partial state: ' +
      `the whole answer is bounded by maxStateReadBytes ${formatKiB(maxRead)} (${maxRead} UTF-8 ` +
      `bytes); a host may configure a lower bound, never below ` +
      `${formatKiB(SURFACE_READER_MIN_STATE_READ_BYTES)} (${SURFACE_READER_MIN_STATE_READ_BYTES} ` +
      `UTF-8 bytes). v1 dashboards proposed with ptah_dashboard_propose_spec read as ` +
      `"${SURFACE_V1_ID_PREFIX}<specId>". An unknown id, or one from another session, is not ` +
      'found. ' +
      ANONYMOUS_RULES,
    inputSchema: buildGetStateInputSchema(),
    annotations: { readOnlyHint: true, destructiveHint: false },
  };
}
