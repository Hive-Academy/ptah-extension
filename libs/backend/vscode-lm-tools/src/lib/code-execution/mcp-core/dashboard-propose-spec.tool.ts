/**
 * `ptah_dashboard_propose_spec` — the tool definition.
 *
 * TASK_2026_493_9f58, deliverable 4. Modelled on
 * `buildHarnessProposeConfigTool` (`tool-description.builder.ts`).
 *
 * TASK_2026_559 Task 16.1: the ADVERTISED schema is a minimal, hand-written,
 * `$ref`-free outline — the argument object, the envelope's keys, and each
 * component's `id` and `kind`. The schema generated from the recursive zod
 * contract was 12,567 chars and rode every `tools/list` on every host. The zod
 * schema (`DashboardProposeSpecInputSchema`) stays the ONLY enforcement point:
 * the namespace validates every call against it, all-or-nothing. The full
 * per-kind contract is in `ptah.help('dashboard')`
 * (`system-namespace.builders.ts`), interpolated from the same constants.
 *
 * Drift is guarded in the spec: the envelope's required keys are compared to
 * the generated schema, and every valid fixture must pass both this outline
 * and zod.
 *
 * It lives in its own file rather than in `tool-description.builder.ts`
 * because that file is already well past the 700-line soft ceiling.
 */

import {
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_LIMITS,
  DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
} from '@ptah-extension/shared/mcp-apps-contracts';
import type { MCPToolDefinition } from '../types';

/** The one tool name. Exported so the dispatcher and its spec agree on it. */
export const DASHBOARD_PROPOSE_SPEC_TOOL_NAME = 'ptah_dashboard_propose_spec';

/** `{ text }` — the rich-text shape every title, label and description uses. */
const TEXT = { type: 'object', required: ['text'] };

/**
 * The advertised argument schema. Objects are closed where zod closes them
 * (the arguments and the envelope); a component is left open because its
 * fields depend on its `kind`, which `ptah.help('dashboard')` documents.
 */
function buildInputSchema(): MCPToolDefinition['inputSchema'] {
  const schema: MCPToolDefinition['inputSchema'] & {
    additionalProperties: false;
  } = {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          schemaVersion: {
            type: 'string',
            enum: [...DASHBOARD_SUPPORTED_SCHEMA_VERSIONS],
          },
          catalogVersion: {
            type: 'string',
            enum: [...DASHBOARD_SUPPORTED_CATALOG_VERSIONS],
          },
          specId: { type: 'string' },
          revision: { type: 'integer', minimum: 1 },
          generatedAt: { type: 'string' },
          title: TEXT,
          description: TEXT,
          components: {
            type: 'array',
            minItems: 1,
            maxItems: DASHBOARD_LIMITS.maxComponents,
            items: {
              type: 'object',
              required: ['id', 'kind'],
              properties: {
                id: { type: 'string' },
                kind: { type: 'string', enum: [...DASHBOARD_COMPONENT_KINDS] },
              },
            },
          },
        },
        required: [
          'schemaVersion',
          'catalogVersion',
          'specId',
          'revision',
          'generatedAt',
          'title',
          'components',
        ],
        additionalProperties: false,
      },
    },
    required: ['spec'],
    additionalProperties: false,
  };
  return schema;
}

/**
 * Build the `ptah_dashboard_propose_spec` tool definition.
 *
 * The kinds are interpolated from `@ptah-extension/shared/mcp-apps-contracts`;
 * every per-kind field, the action and URL rules and every budget number live
 * in `ptah.help('dashboard')`, which interpolates them from the same place.
 */
export function buildDashboardProposeSpecTool(): MCPToolDefinition {
  return {
    name: DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
    description:
      'Render a dashboard for the user from a declarative JSON spec built on a FIXED catalog ' +
      `(kinds: ${DASHBOARD_COMPONENT_KINDS.join(', ')}); never HTML, CSS or a template. The ` +
      'schema shows only the envelope. BEFORE the first call, read the per-kind fields, actions, ' +
      "URL rules and limits: execute_code with `return ptah.help('dashboard')`. Text fields " +
      'are { text }, shown as PLAIN TEXT (no markdown, no HTML). Validation is ALL-OR-NOTHING: ' +
      'one bad field rejects the whole spec and the error names its path. Each call replaces ' +
      'the previous spec; bump `revision`. Success returns the dashboard as plain text.',
    inputSchema: buildInputSchema(),
    annotations: { destructiveHint: false, idempotentHint: true },
  };
}
