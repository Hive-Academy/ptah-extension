/**
 * `ptah_route_decide` tool definition (TASK_2026_646, part A §8).
 *
 * The input schema is generated from `RouteDecideArgsSchema`, the same
 * contract the handler validates with. `readOnlyHint` is false because a
 * gate call records a rotation pick.
 */
import { z } from 'zod';
import { RouteDecideArgsSchema } from '@ptah-extension/lane-routing';
import type { MCPToolDefinition } from '../types';
import { ROUTING_UNAVAILABLE_MESSAGE } from '../namespace-builders/route-namespace.builder';

export const ROUTE_DECIDE_TOOL_NAME = 'ptah_route_decide';

type InputSchema = MCPToolDefinition['inputSchema'];
type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stageConst(properties: JsonObject): string | undefined {
  const tag = properties['stage'];
  if (!isJsonObject(tag)) return undefined;
  const value = tag['const'];
  return typeof value === 'string' ? value : undefined;
}

function withStageNote(schema: unknown, stages: readonly string[]): unknown {
  if (!isJsonObject(schema)) return schema;
  const note = `Required when stage is ${stages.join(' or ')}.`;
  const existing = schema['description'];
  const description =
    typeof existing === 'string' ? `${existing} ${note}` : note;
  return { ...schema, description };
}

/**
 * One closed object. Zod emits `oneOf` for the stage union; MCP tool
 * definitions require `type: object` and `properties`. A field required by
 * only one stage stays optional here and says which stage needs it. Zod
 * remains the enforcement point.
 */
function flattenStageUnion(branches: readonly unknown[]): InputSchema {
  const stages: string[] = [];
  const properties: JsonObject = {};
  const requiredBy = new Map<string, string[]>();

  for (const branch of branches) {
    if (!isJsonObject(branch) || !isJsonObject(branch['properties'])) continue;
    const branchProperties = branch['properties'];
    const stage = stageConst(branchProperties);
    if (stage === undefined || stages.includes(stage)) continue;
    stages.push(stage);
    const required = stringArray(branch['required']);
    for (const [key, schema] of Object.entries(branchProperties)) {
      if (!(key in properties)) properties[key] = schema;
      if (required.includes(key)) {
        requiredBy.set(key, [...(requiredBy.get(key) ?? []), stage]);
      }
    }
  }

  for (const [key, schema] of Object.entries(properties)) {
    if (key === 'stage') continue;
    const owners = requiredBy.get(key) ?? [];
    if (owners.length === stages.length) continue;
    properties[key] = withStageNote(schema, owners);
  }

  properties['stage'] = { type: 'string', enum: stages };
  const required: string[] = stages.length > 0 ? ['stage'] : [];
  for (const key of Object.keys(properties)) {
    if (key === 'stage') continue;
    if ((requiredBy.get(key)?.length ?? 0) === stages.length)
      required.push(key);
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function inputSchemaOf(schema: z.ZodType): InputSchema {
  const generated: JsonObject = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
  });
  const oneOf = generated['oneOf'];
  if (Array.isArray(oneOf)) return flattenStageUnion(oneOf);
  const properties = isJsonObject(generated['properties'])
    ? generated['properties']
    : {};
  return {
    type: 'object',
    properties,
    required: stringArray(generated['required']),
    additionalProperties: false,
  };
}

/** Build the always-on `ptah_route_decide` tool definition. */
export function buildRouteDecideTool(): MCPToolDefinition {
  return {
    name: ROUTE_DECIDE_TOOL_NAME,
    description:
      'Choose how to staff one engineering request. stage "pre-flight" takes ' +
      '"request" and returns task type and depth. stage "gate-0.1" also takes ' +
      '"taskType", "depth", "phases" and optional "pins", "preferenceSource" ' +
      'and "preferences", and returns one roster entry per phase. Invalid ' +
      'arguments are an error that names the field. The call updates rotation ' +
      `state. Results are capped at 24,000 characters. When routing is not registered in this host, the error is: ${ROUTING_UNAVAILABLE_MESSAGE}.`,
    inputSchema: inputSchemaOf(RouteDecideArgsSchema),
    annotations: { readOnlyHint: false },
  };
}
