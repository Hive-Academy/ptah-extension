/**
 * `ptah_dashboard_propose_spec` — the tool definition.
 *
 * TASK_2026_493_9f58, deliverable 4. Modelled on
 * `buildHarnessProposeConfigTool` (`tool-description.builder.ts`) with one
 * deliberate departure: the input schema is GENERATED from zod with
 * `z.toJSONSchema`, never hand-written. `critique-engineering.md` section 4
 * makes the case — every hand-authored MCP schema in this repository is a
 * second copy of a contract that already exists in zod, and the two drift.
 *
 * It lives in its own file rather than in `tool-description.builder.ts` because
 * that file is already 1,841 lines (well past the 700-line soft ceiling) and
 * because this is the only tool whose schema is generated, so it carries an
 * import — `@ptah-extension/shared/mcp-apps-contracts` — that the hand-written
 * builders have no use for. The existing `agent-spawn-args.schema.ts` is the
 * precedent for a per-tool schema module beside the shared builder.
 */

import { z } from 'zod';
import {
  DASHBOARD_ACTIONS,
  DASHBOARD_CATALOG_VERSION,
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_SCHEMA_VERSION,
  DASHBOARD_URL_SCHEME_ALLOWLIST,
  DashboardProposeSpecInputSchema,
  describeDashboardLimits,
} from '@ptah-extension/shared/mcp-apps-contracts';
import type { MCPToolDefinition } from '../types';

/** The one tool name. Exported so the dispatcher and its spec agree on it. */
export const DASHBOARD_PROPOSE_SPEC_TOOL_NAME = 'ptah_dashboard_propose_spec';

/**
 * The generated JSON Schema for the tool's arguments.
 *
 * `target: 'draft-7'` because the component tree is recursive: zod emits it as
 * a named entry under `definitions` plus a `$ref`, and `definitions` is the
 * draft-07 keyword that the widest set of MCP clients understands. `$schema` is
 * stripped — an MCP `inputSchema` is a schema fragment, not a document, and
 * some clients reject the extra key.
 */
function buildInputSchema(): MCPToolDefinition['inputSchema'] {
  const generated = z.toJSONSchema(DashboardProposeSpecInputSchema, {
    io: 'input',
    target: 'draft-7',
  });
  const { $schema: _ignoredSchemaKeyword, ...fragment } = generated;
  return {
    ...fragment,
    type: 'object',
    properties: fragment.properties ?? {},
    required: fragment.required ?? ['spec'],
  };
}

/**
 * Build the `ptah_dashboard_propose_spec` tool definition.
 *
 * The description teaches the contract from the contract itself — the version
 * strings, the five kinds, the action allowlist, the scheme allowlist and every
 * budget number are interpolated from
 * `@ptah-extension/shared/mcp-apps-contracts`, so a limit cannot change in the
 * schema and stay stale in the prose an agent reads.
 */
export function buildDashboardProposeSpecTool(): MCPToolDefinition {
  return {
    name: DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
    description:
      'Render a dashboard for the user from a declarative JSON spec. You emit JSON from a FIXED ' +
      'catalog; you never write HTML, CSS or a template, and there is no escape hatch that would ' +
      `let you. Envelope: { schemaVersion: "${DASHBOARD_SCHEMA_VERSION}", catalogVersion: ` +
      `"${DASHBOARD_CATALOG_VERSION}", specId, revision (integer >= 1), generatedAt (ISO 8601 with ` +
      'an offset or Z), title: {text}, description?: {text}, components: [...] }. Component kinds ' +
      `(exactly these ${DASHBOARD_COMPONENT_KINDS.length}, anything else is rejected): ` +
      `${DASHBOARD_COMPONENT_KINDS.join(', ')}. Every component takes { id, kind, title?: {text}, ` +
      'description?: {text}, actions?: [...], children?: [...] } — `children` is layout nesting, and ' +
      'ids must be unique across the WHOLE spec. A "stat" takes { value (string or number), unit?, ' +
      'delta? }. A "line-chart" or "bar-chart" takes EITHER { series: [{ name, points: [{x, y}] }] } ' +
      'OR { data: { resultId } } — exactly one, never both. A "table" takes { columns: [{ key, ' +
      'label: {text}, align? }] } plus EITHER { rows: [[cell, ...]] } (one cell per column, cells ' +
      'are string/number/boolean/null) OR { data: { resultId } }. A "list" takes { ordered? } plus ' +
      'EITHER { items: [{ text: {text}, detail?, url? }] } OR { data: { resultId } }. Text fields ' +
      'are { text } and are rendered as PLAIN TEXT — there is no markdown and no HTML anywhere ' +
      'in this contract, so markup in a text field will be shown to the user literally. Put a ' +
      'link in a dashboard.open-url action instead. An action is ' +
      `{ action, label: {text}, url?, params? } where action is one of ${DASHBOARD_ACTIONS.join(', ')} ` +
      '— an unknown action name is rejected, and you cannot name a tool or an RPC method in a spec: ' +
      'the host owns that mapping. Any url must be absolute, carry no credentials and use scheme ' +
      `${DASHBOARD_URL_SCHEME_ALLOWLIST.join(' or ')} — javascript:, data:, file: and http: are ` +
      `rejected. Limits: ${describeDashboardLimits()}. Use { data: { resultId } } rather than ` +
      'embedding a large dataset. Validation is ALL-OR-NOTHING: one bad field rejects the whole ' +
      'spec, nothing reaches the UI, and the error names the offending path so you can fix and ' +
      're-send. Every call replaces the previous spec in full; send a complete spec each time and ' +
      'bump `revision`. On success you get the dashboard back as plain text, which is also what a ' +
      'host without a UI (the CLI, VS Code) shows the user.',
    inputSchema: buildInputSchema(),
    annotations: { destructiveHint: false, idempotentHint: true },
  };
}
