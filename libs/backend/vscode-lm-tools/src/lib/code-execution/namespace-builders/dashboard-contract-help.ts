/**
 * The dashboard contract as `ptah.help('dashboard')` teaches it.
 *
 * TASK_2026_559 Batch 16 r1 (finding S1). The `ptah_dashboard_propose_spec`
 * tool advertises only the envelope and points here for the rest, so this text
 * must state EVERY rule zod enforces. Two sources, neither hand-copied:
 *
 * 1. Every structural rule — field names, required vs optional, primitive
 *    types, enum values, the id pattern, numeric and array bounds — is RENDERED
 *    at runtime from `z.toJSONSchema(DashboardProposeSpecInputSchema)`. A field
 *    or enum value added to the contract appears here with no edit.
 * 2. The rules JSON Schema cannot express (zod `.refine` / `.superRefine` and
 *    the validator's byte budget) are `DASHBOARD_CONTRACT_RULES`, interpolated
 *    at the contract constants. The spec counts the refinements in the contract
 *    source, so a new one fails a test until it is documented here.
 *
 * The renderer records every JSON-schema keyword it does not understand in
 * `unhandledKeywords`; the spec requires that list to be empty, so a new kind
 * of constraint cannot be silently dropped from the help.
 */

import { z } from 'zod';
import {
  DASHBOARD_LIMITS,
  DASHBOARD_URL_SCHEME_ALLOWLIST,
  DashboardActionSchema,
  DashboardDataRefSchema,
  DashboardListItemSchema,
  DashboardProposeSpecInputSchema,
  DashboardRichTextSchema,
  DashboardSeriesSchema,
  DashboardTableColumnSchema,
} from '@ptah-extension/shared/mcp-apps-contracts';

type JsonSchema = { readonly [keyword: string]: unknown };

/** The rendered contract, plus what the renderer could not express. */
export interface DashboardContractDescription {
  readonly text: string;
  readonly unhandledKeywords: readonly string[];
}

/**
 * The zod refinements, one entry each, in words. Kept beside the renderer so
 * the spec can pin the count against the contract source.
 */
export const DASHBOARD_CONTRACT_RULES: readonly string[] = [
  'Exactly one data source: a line-chart or bar-chart takes series OR data, a table takes ' +
    'rows OR data, a list takes items OR data - never both, never neither.',
  `A chart carries at most ${DASHBOARD_LIMITS.maxSeriesPoints} points summed across all of its series.`,
  'Every table row has exactly one cell per column.',
  'An action url is REQUIRED when action is dashboard.open-url and REJECTED on every other action.',
  'Every url (on an action or a list item) must be absolute, carry no credentials and use scheme ' +
    `${DASHBOARD_URL_SCHEME_ALLOWLIST.join(' or ')} - javascript:, data:, file: and http: are rejected.`,
  `Across the WHOLE spec: at most ${DASHBOARD_LIMITS.maxComponents} components counting children, ` +
    `a tree at most ${DASHBOARD_LIMITS.maxTreeDepth} levels deep, and every component id unique.`,
  `The spec's JSON encoding is at most ${DASHBOARD_LIMITS.maxSpecBytes} UTF-8 bytes.`,
];

/** Keywords the renderer turns into text. Anything else is reported. */
const HANDLED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  '$ref',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'minItems',
  'maxItems',
  'propertyNames',
  'description',
  // The component union; rendered through `oneOf` by `describeDashboardContract`.
  'definitions',
]);

function toJson(schema: z.ZodType): JsonSchema {
  const { $schema: _dropped, ...fragment } = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
  });
  return fragment;
}

class ContractRenderer {
  readonly unhandled = new Set<string>();

  constructor(private readonly named: ReadonlyMap<string, string>) {}

  render(schema: JsonSchema, allowName = true): string {
    const name = allowName ? this.named.get(JSON.stringify(schema)) : undefined;
    if (name) return name;
    for (const keyword of Object.keys(schema)) {
      if (!HANDLED_KEYWORDS.has(keyword)) this.unhandled.add(keyword);
    }

    if (typeof schema['$ref'] === 'string') {
      return schema['$ref'].slice(schema['$ref'].lastIndexOf('/') + 1);
    }
    if ('const' in schema) return JSON.stringify(schema['const']);
    if (Array.isArray(schema['enum'])) {
      return schema['enum'].map((value) => JSON.stringify(value)).join(' | ');
    }
    const union = schema['anyOf'] ?? schema['oneOf'];
    if (Array.isArray(union)) {
      return union.map((member: JsonSchema) => this.render(member)).join(' | ');
    }

    switch (schema['type']) {
      case 'object':
        return this.renderObject(schema);
      case 'array':
        return this.renderArray(schema);
      case 'string':
        return this.renderString(schema);
      case 'integer':
      case 'number':
        return this.renderNumber(schema);
      default:
        return String(schema['type']);
    }
  }

  /** `{ a: T, b?: T }`; a record renders as `{ [key]: T }`. */
  renderObject(schema: JsonSchema): string {
    const properties = schema['properties'] as
      Record<string, JsonSchema> | undefined;
    const additional = schema['additionalProperties'];
    if (!properties && typeof additional === 'object' && additional !== null) {
      const key = schema['propertyNames'] as JsonSchema | undefined;
      return `{ [${key ? this.render(key) : 'string'}]: ${this.render(additional as JsonSchema)} }`;
    }
    const open = additional === false ? '' : ' (open: extra keys allowed)';
    return `${this.renderFields(schema, () => true)}${open}`;
  }

  renderFields(schema: JsonSchema, include: (key: string) => boolean): string {
    return `{ ${this.fieldList(schema, include).join(', ')} }`;
  }

  fieldList(schema: JsonSchema, include: (key: string) => boolean): string[] {
    const properties = (schema['properties'] ?? {}) as Record<
      string,
      JsonSchema
    >;
    const required = new Set((schema['required'] ?? []) as string[]);
    return Object.entries(properties)
      .filter(([key]) => include(key))
      .map(
        ([key, child]) =>
          `${key}${required.has(key) ? '' : '?'}: ${this.render(child)}`,
      );
  }

  renderArray(schema: JsonSchema): string {
    const items = this.render((schema['items'] ?? {}) as JsonSchema);
    // Parenthesise only a top-level union; an object or a nested array is
    // already delimited.
    const delimited = items.startsWith('{') || items.startsWith('(');
    const element = !delimited && items.includes(' | ') ? `(${items})` : items;
    const min = schema['minItems'];
    const max = schema['maxItems'];
    let bounds = '';
    if (typeof min === 'number' && min > 0 && typeof max === 'number')
      bounds = ` (${min}-${max} items)`;
    else if (typeof max === 'number') bounds = ` (max ${max} items)`;
    else if (typeof min === 'number' && min > 0) bounds = ` (min ${min})`;
    return `${element}[]${bounds}`;
  }

  renderString(schema: JsonSchema): string {
    const notes: string[] = [];
    if (typeof schema['format'] === 'string') {
      // A format's generated pattern (ISO date-time) is noise to an author.
      notes.push(`${schema['format']}, ISO 8601 with Z or an offset`);
    } else if (typeof schema['pattern'] === 'string') {
      notes.push(`matching /${schema['pattern']}/`);
    }
    if (typeof schema['minLength'] === 'number' && schema['minLength'] > 0)
      notes.push(`at least ${schema['minLength']} char`);
    if (
      typeof schema['maxLength'] === 'number' &&
      schema['maxLength'] !== DASHBOARD_LIMITS.maxStringLength
    )
      notes.push(`at most ${schema['maxLength']} chars`);
    return notes.length > 0 ? `string (${notes.join(', ')})` : 'string';
  }

  renderNumber(schema: JsonSchema): string {
    const notes: string[] = [];
    if (typeof schema['exclusiveMinimum'] === 'number')
      notes.push(`> ${schema['exclusiveMinimum']}`);
    if (typeof schema['minimum'] === 'number')
      notes.push(`>= ${schema['minimum']}`);
    if (
      typeof schema['maximum'] === 'number' &&
      schema['maximum'] !== Number.MAX_SAFE_INTEGER
    )
      notes.push(`<= ${schema['maximum']}`);
    const type = String(schema['type']);
    return notes.length > 0 ? `${type} ${notes.join(' ')}` : type;
  }
}

/**
 * Render the contract as TypeScript-like lines, one named shape per line.
 * Deterministic: the same contract always yields the same text.
 */
export function describeDashboardContract(): DashboardContractDescription {
  const input = toJson(DashboardProposeSpecInputSchema);
  const spec = (input['properties'] as Record<string, JsonSchema>)['spec'];
  const definitions = (input['definitions'] ?? {}) as Record<
    string,
    JsonSchema
  >;
  const component = definitions['DashboardComponent'] ?? {};
  const kinds = (component['oneOf'] ?? []) as JsonSchema[];

  const shapes: ReadonlyArray<[string, JsonSchema]> = [
    ['Action', toJson(DashboardActionSchema)],
    ['Text', toJson(DashboardRichTextSchema)],
    ['DataRef', toJson(DashboardDataRefSchema)],
    ['Series', toJson(DashboardSeriesSchema)],
    ['Column', toJson(DashboardTableColumnSchema)],
    ['ListItem', toJson(DashboardListItemSchema)],
  ];
  const renderer = new ContractRenderer(
    new Map<string, string>([
      [JSON.stringify(spec), 'Spec'],
      ...shapes.map(([name, shape]): [string, string] => [
        JSON.stringify(shape),
        name,
      ]),
    ]),
  );

  // Fields every kind declares identically are listed once.
  const first = kinds[0] ?? {};
  const propertiesOf = (schema: JsonSchema) =>
    (schema['properties'] ?? {}) as Record<string, JsonSchema>;
  const isRequired = (schema: JsonSchema, key: string) =>
    ((schema['required'] ?? []) as string[]).includes(key);
  const sharedSet = new Set(
    Object.keys(propertiesOf(first)).filter(
      (key) =>
        key !== 'kind' &&
        kinds.every(
          (kind) =>
            Object.prototype.hasOwnProperty.call(propertiesOf(kind), key) &&
            JSON.stringify(propertiesOf(kind)[key]) ===
              JSON.stringify(propertiesOf(first)[key]) &&
            isRequired(kind, key) === isRequired(first, key),
        ),
    ),
  );

  const kindLines = kinds.map((kind) => {
    if (kind['additionalProperties'] !== false)
      renderer.unhandled.add('additionalProperties (open component)');
    const kindName = renderer.render(propertiesOf(kind)['kind'] ?? {});
    const own = renderer.fieldList(
      kind,
      (key) => key !== 'kind' && !sharedSet.has(key),
    );
    return `- kind ${kindName} adds { ${own.join(', ')} }`;
  });

  const lines = [
    `Arguments = ${renderer.render(input, false)}`,
    `Spec = ${renderer.render(spec, false)}`,
    // Named as the `$ref` the renderer prints for `components` and `children`.
    `DashboardComponent = one of ${kinds.length} kinds. Every kind takes { ${[
      `kind: ${kinds
        .map((kind) => renderer.render(propertiesOf(kind)['kind'] ?? {}))
        .join(' | ')}`,
      ...renderer.fieldList(first, (key) => sharedSet.has(key)),
    ].join(', ')} }, and:`,
    ...kindLines,
    ...shapes.map(
      ([name, shape]) => `${name} = ${renderer.render(shape, false)}`,
    ),
  ];

  return {
    text: lines.join('\n'),
    unhandledKeywords: [...renderer.unhandled].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  };
}
