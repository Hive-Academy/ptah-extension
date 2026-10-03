/**
 * Specs for the `ptah_dashboard_propose_spec` MCP tool — TASK_2026_493_9f58.
 *
 * Two things under test:
 *
 * 1. The advertised definition (TASK_2026_559 Task 16.1): a minimal, `$ref`-
 *    free schema under a fixed char budget, with the detail in
 *    `ptah.help('dashboard')`. Zod stays the enforcement point; the drift
 *    guard proves every valid fixture passes BOTH the advertised schema and
 *    zod, and every invalid one is still rejected by zod.
 * 2. The dispatcher contract: the tool is listed on every host, a valid spec
 *    comes back as plain text with no `isError`, and a rejection comes back as
 *    `isError: true` carrying the reason.
 */

import 'reflect-metadata';

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  DASHBOARD_ACTIONS,
  DASHBOARD_CATALOG_VERSION,
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_SCHEMA_VERSION,
  DashboardProposeSpecInputSchema,
  describeDashboardLimits,
} from '@ptah-extension/shared/mcp-apps-contracts';
import {
  makeChart,
  makeDashboardSpec,
  makeList,
  makeNestedStats,
  makeStat,
  makeStatPairs,
  makeTable,
} from '@ptah-extension/shared/testing';
import {
  DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
  buildDashboardProposeSpecTool,
} from './dashboard-propose-spec.tool';
import { buildHelpMethod } from '../namespace-builders/system-namespace.builders';
import {
  DASHBOARD_CONTRACT_RULES,
  describeDashboardContract,
} from '../namespace-builders/dashboard-contract-help';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

function asLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function buildDeps(
  proposeSpec?: jest.Mock,
): ProtocolHandlerDependencies & { proposeSpec: jest.Mock } {
  const spy = proposeSpec ?? jest.fn();
  return {
    proposeSpec: spy,
    ptahAPI: { dashboard: { proposeSpec: spy } } as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: asLogger(),
  };
}

/** The plain-text dashboard the namespace renders, as the dispatcher sees it. */
const DASHBOARD_TEXT = ['Build health', '', 'Passing: 9'].join('\n');

/** The namespace's accepted outcome, as the dispatcher sees it. */
const ACCEPTED = {
  status: 'accepted' as const,
  specId: 'build-health',
  revision: 1,
  bytes: 120,
  text: DASHBOARD_TEXT,
  delivery: { status: 'delivered' as const, surfaces: 1 },
};

function request(overrides: Partial<MCPRequest>): MCPRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/list', ...overrides };
}

function toolResult(res: MCPResponse): { isError?: boolean; text: string } {
  const result = res.result as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: result.isError, text: result.content[0].text };
}

/**
 * TASK_2026_559 Task 16.1: the whole definition — name, description, schema
 * and annotations — as `tools/list` sends it on every request. Measured at
 * 15,183 chars on 2026-09-26 (HEAD 4cd9a91da) with the generated schema.
 */
const TOOL_DEFINITION_CHAR_BUDGET = 3_000;

type JsonSchema = Record<string, unknown>;

/**
 * The JSON-schema keywords `conformsTo` understands. The repository carries no
 * JSON-schema validator of its own (no `ajv` or equivalent in any manifest), so
 * the drift guard checks fixtures with this small one — and a separate spec
 * proves the advertised schema uses NO keyword outside this set, so the checker
 * can never pass a fixture by silently ignoring a constraint.
 */
const CHECKED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minItems',
  'maxItems',
  'minimum',
  'description',
]);

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(expected: unknown, actual: string): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some(
    (type) => type === actual || (type === 'number' && actual === 'integer'),
  );
}

/** Every violation of `schema` by `value`, as `path: reason` strings. */
function conformsTo(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  const actual = jsonType(value);
  if (schema['type'] !== undefined && !typeMatches(schema['type'], actual)) {
    return [`${path}: expected ${String(schema['type'])}, got ${actual}`];
  }
  const allowedValues = schema['enum'];
  if (Array.isArray(allowedValues) && !allowedValues.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not in the enum`);
  }
  if (typeof schema['minimum'] === 'number' && typeof value === 'number') {
    if (value < schema['minimum']) errors.push(`${path}: below minimum`);
  }
  if (Array.isArray(value)) {
    if (
      typeof schema['minItems'] === 'number' &&
      value.length < schema['minItems']
    )
      errors.push(`${path}: fewer than minItems`);
    if (
      typeof schema['maxItems'] === 'number' &&
      value.length > schema['maxItems']
    )
      errors.push(`${path}: more than maxItems`);
    const items = schema['items'] as JsonSchema | undefined;
    if (items)
      value.forEach((item, index) =>
        errors.push(...conformsTo(items, item, `${path}[${index}]`)),
      );
  }
  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema['properties'] ?? {}) as Record<
      string,
      JsonSchema
    >;
    // Own-property checks only (Batch 16 r1, M1): `properties[key]` and `in`
    // also see Object.prototype, so `toString` or `constructor` would pass as
    // declared keys.
    const own = (object: object, key: string): boolean =>
      Object.prototype.hasOwnProperty.call(object, key);
    for (const key of (schema['required'] ?? []) as string[]) {
      if (!own(record, key)) errors.push(`${path}: missing required ${key}`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (own(properties, key)) {
        errors.push(...conformsTo(properties[key], child, `${path}.${key}`));
      } else if (schema['additionalProperties'] === false) {
        errors.push(`${path}: unexpected key ${key}`);
      }
    }
  }
  return errors;
}

/** Every keyword the schema uses, at any depth, excluding property names. */
function keywordsIn(schema: JsonSchema): string[] {
  const found: string[] = [];
  for (const [keyword, value] of Object.entries(schema)) {
    found.push(keyword);
    if (keyword === 'properties') {
      for (const child of Object.values(value as Record<string, JsonSchema>))
        found.push(...keywordsIn(child));
    } else if (keyword === 'items') {
      found.push(...keywordsIn(value as JsonSchema));
    }
  }
  return found;
}

/**
 * Every spec the zod contract ACCEPTS that these specs send — the fixtures the
 * routing specs below use, plus one per component kind and a nested tree, so
 * every branch of the loosely-typed component entry is exercised.
 */
const VALID_SPECS: ReadonlyArray<[string, unknown]> = [
  ['makeDashboardSpec()', makeDashboardSpec()],
  ['one stat', makeDashboardSpec({ components: [makeStat()] })],
  [
    'every kind, a description and actions',
    makeDashboardSpec({
      description: { text: 'Nightly run' },
      components: [
        makeStat({
          actions: [
            {
              action: 'dashboard.open-url',
              label: { text: 'Open' },
              url: 'https://example.com/run',
            },
          ],
        }),
        makeChart([3, 2]),
        makeTable(2, 2),
        makeList(['flaky', 'slow']),
      ],
    }),
  ],
  [
    'a bar-chart and data references, as help teaches them (r1)',
    makeDashboardSpec({
      components: [
        {
          id: 'build-times',
          kind: 'bar-chart',
          xLabel: { text: 'Day' },
          series: [{ name: 'ms', points: [{ x: 'mon', y: 3 }] }],
        },
        {
          id: 'trend',
          kind: 'line-chart',
          data: { resultId: 'run:42', rowCount: 10, truncated: false },
        },
        {
          id: 'slow',
          kind: 'table',
          columns: [{ key: 'name', label: { text: 'Name' }, align: 'right' }],
          data: { resultId: 'slow.tests' },
        },
        {
          id: 'fails',
          kind: 'list',
          ordered: true,
          data: { resultId: 'fails-1' },
        },
        makeStat({
          id: 'delta',
          unit: '%',
          delta: -2.5,
          actions: [
            {
              action: 'dashboard.refresh',
              label: { text: 'Refresh' },
              params: { scope: 'all', limit: 5, force: true },
            },
          ],
        }),
      ],
    }),
  ],
  ['a nested tree', makeDashboardSpec({ components: makeNestedStats(3) })],
  ['pairs with children', makeDashboardSpec({ components: makeStatPairs(5) })],
];

/**
 * Arguments the zod contract REJECTS. The first two are the routing specs'
 * own invalid inputs; the rest are contract rules the minimal schema does not
 * restate, which is exactly why zod stays the enforcement point.
 */
const INVALID_ARGUMENTS: ReadonlyArray<[string, unknown]> = [
  ['an empty spec', { spec: {} }],
  ['no spec at all', {}],
  [
    'a javascript: URL',
    {
      spec: makeDashboardSpec({
        components: [
          makeStat({
            actions: [
              {
                action: 'dashboard.open-url',
                label: { text: 'x' },
                url: 'javascript:alert(1)',
              },
            ],
          }),
        ],
      }),
    },
  ],
  [
    'duplicate component ids',
    { spec: makeDashboardSpec({ components: [makeStat(), makeStat()] }) },
  ],
  [
    'a stat with no value',
    {
      spec: makeDashboardSpec({
        components: [{ id: 'bare', kind: 'stat' } as never],
      }),
    },
  ],
  ['an unknown top-level key', { spec: makeDashboardSpec(), extra: true }],
];

describe('the tool definition', () => {
  it('is named after the harness precedent it follows', () => {
    expect(DASHBOARD_PROPOSE_SPEC_TOOL_NAME).toBe(
      'ptah_dashboard_propose_spec',
    );
    expect(buildDashboardProposeSpecTool().name).toBe(
      DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
    );
  });

  it(`fits the always-on budget of ${TOOL_DEFINITION_CHAR_BUDGET} chars as JSON`, () => {
    // TASK_2026_559 Task 16.1. It rides every `tools/list` on every host and
    // every CLI lane; at 15,183 chars it was 24% of the whole payload.
    expect(
      JSON.stringify(buildDashboardProposeSpecTool()).length,
    ).toBeLessThanOrEqual(TOOL_DEFINITION_CHAR_BUDGET);
  });

  it('takes one argument — `spec` — so there is no way to send half a spec', () => {
    const { inputSchema } = buildDashboardProposeSpecTool();

    expect(Object.keys(inputSchema.properties)).toEqual(['spec']);
    expect(inputSchema.required).toEqual(['spec']);
    expect(inputSchema.type).toBe('object');
  });

  it('advertises a $ref-free schema with no definitions', () => {
    const serialized = JSON.stringify(
      buildDashboardProposeSpecTool().inputSchema,
    );

    expect(serialized).not.toContain('$ref');
    expect(serialized).not.toContain('definitions');
    expect(serialized).not.toContain('$defs');
  });

  it('requires every envelope key the zod contract requires', () => {
    const spec = buildDashboardProposeSpecTool().inputSchema.properties[
      'spec'
    ] as JsonSchema;
    const envelope = z.toJSONSchema(DashboardProposeSpecInputSchema, {
      io: 'input',
      target: 'draft-7',
    }).properties?.['spec'] as JsonSchema;

    expect([...(spec['required'] as string[])].sort()).toEqual(
      [...(envelope['required'] as string[])].sort(),
    );
    expect(Object.keys(spec['properties'] as JsonSchema).sort()).toEqual(
      Object.keys(envelope['properties'] as JsonSchema).sort(),
    );
  });

  it('uses only keywords the drift check below understands', () => {
    const used = keywordsIn(buildDashboardProposeSpecTool().inputSchema);

    expect(used.filter((keyword) => !CHECKED_KEYWORDS.has(keyword))).toEqual(
      [],
    );
  });

  it.each(VALID_SPECS)(
    'accepts %s in the advertised schema AND in zod (no schema drift)',
    (_label, spec) => {
      const args = { spec };
      const schema = buildDashboardProposeSpecTool()
        .inputSchema as unknown as JsonSchema;

      expect(DashboardProposeSpecInputSchema.safeParse(args).success).toBe(
        true,
      );
      expect(conformsTo(schema, args)).toEqual([]);
    },
  );

  it.each(INVALID_ARGUMENTS)('still rejects %s in zod', (_label, args) => {
    expect(DashboardProposeSpecInputSchema.safeParse(args).success).toBe(false);
  });

  it('carries no $schema keyword — an MCP inputSchema is a fragment', () => {
    expect('$schema' in buildDashboardProposeSpecTool().inputSchema).toBe(
      false,
    );
  });

  it('closes the arguments and the envelope, so an unknown key is described as invalid too', () => {
    const schema = buildDashboardProposeSpecTool()
      .inputSchema as unknown as JsonSchema;
    const spec = (schema['properties'] as Record<string, JsonSchema>)['spec'];

    expect(schema['additionalProperties']).toBe(false);
    expect(spec['additionalProperties']).toBe(false);
  });

  it('points to ptah.help("dashboard") and does not offer markdown', () => {
    // Revision 1, finding 1 (TASK_2026_493): `format: "markdown"` was a URL
    // channel that bypassed the scheme allowlist, so nothing may OFFER it.
    const { description } = buildDashboardProposeSpecTool();

    expect(description).toContain("ptah.help('dashboard')");
    expect(description).toContain('execute_code');
    expect(description).toContain('stat, line-chart, bar-chart, table, list');
    expect(description).toContain('PLAIN TEXT');
    expect(description).toContain('ALL-OR-NOTHING');
    expect(description).not.toContain('"plain" | "markdown"');
    expect(description).not.toMatch(/format\??\s*:/);
  });
});

/**
 * The description points to `ptah.help('dashboard')` for the detail the schema
 * no longer carries. A pointer to help that lacks it would be a false claim, so
 * the detail is asserted on what `ptah.help` really returns.
 */
describe("ptah.help('dashboard')", () => {
  const help = buildHelpMethod({ getCallerToolProfile: () => 'apps' });

  it('teaches each kind, the actions and the text rule', async () => {
    const doc = await help('dashboard');

    for (const kind of DASHBOARD_COMPONENT_KINDS)
      expect(doc).toContain(`- kind "${kind}" adds {`);
    expect(doc).toContain('every component id unique');
    expect(doc).toContain('PLAIN TEXT');
    expect(doc).toContain('no markdown and no HTML anywhere');
    expect(doc).toContain('dashboard.open-url action instead');
    // Nothing may OFFER markdown (TASK_2026_493 r1 finding 1).
    expect(doc).not.toContain('markdown"');
  });

  it('teaches the limits and the allowlists from the contract, not from prose', async () => {
    const doc = await help('dashboard');

    expect(doc).toContain(DASHBOARD_SCHEMA_VERSION);
    expect(doc).toContain(DASHBOARD_CATALOG_VERSION);
    for (const action of DASHBOARD_ACTIONS) expect(doc).toContain(action);
    expect(doc).toContain(describeDashboardLimits());
    expect(doc).toContain('262144 UTF-8 bytes');
    expect(doc).toContain('javascript:, data:, file: and http: are');
  });

  it('no longer claims the tool schema teaches the exact shape', async () => {
    expect(await help('dashboard')).not.toContain('generated from the zod');
  });
});

/**
 * Batch 16 r1, finding S1: help must state EVERY rule zod enforces, because
 * the advertised schema delegates to it. The structural rules are rendered
 * FROM the zod-generated JSON Schema (`describeDashboardContract`), and these
 * specs walk that schema independently of the renderer.
 */
describe("ptah.help('dashboard') states every rule zod enforces", () => {
  const help = buildHelpMethod({ getCallerToolProfile: () => 'apps' });
  const generated = z.toJSONSchema(DashboardProposeSpecInputSchema, {
    io: 'input',
    target: 'draft-7',
  }) as unknown as JsonSchema;

  /** Every property name, enum value, const and pattern in the schema. */
  function walk(
    node: unknown,
    found: { names: Set<string>; values: Set<string>; patterns: Set<string> },
  ): void {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, found));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const schema = node as JsonSchema;
    if (Array.isArray(schema['enum']))
      schema['enum'].forEach((value) => found.values.add(String(value)));
    if ('const' in schema) found.values.add(String(schema['const']));
    if (typeof schema['pattern'] === 'string' && !('format' in schema))
      found.patterns.add(schema['pattern']);
    const properties = schema['properties'];
    if (properties && typeof properties === 'object')
      Object.keys(properties).forEach((name) => found.names.add(name));
    Object.values(schema).forEach((child) => walk(child, found));
  }

  it('renders the contract with no JSON-schema keyword left unexpressed', () => {
    expect(describeDashboardContract().unhandledKeywords).toEqual([]);
  });

  it('is what ptah.help returns', async () => {
    const doc = await help('dashboard');

    expect(doc).toContain(describeDashboardContract().text);
    for (const rule of DASHBOARD_CONTRACT_RULES) expect(doc).toContain(rule);
  });

  it('names every field, enum value, literal and id pattern in the zod schema', async () => {
    const doc = await help('dashboard');
    const found = {
      names: new Set<string>(),
      values: new Set<string>(),
      patterns: new Set<string>(),
    };
    walk(generated, found);

    expect(found.names.size).toBeGreaterThan(20);
    for (const name of found.names)
      expect(doc).toMatch(new RegExp(`\\b${name}\\??: `));
    for (const value of found.values) expect(doc).toContain(`"${value}"`);
    for (const pattern of found.patterns) expect(doc).toContain(`/${pattern}/`);
    // Every `$ref` target is defined in the help, not left dangling.
    expect(doc).toContain('\nDashboardComponent = one of 5 kinds.');
    for (const name of [
      'Action',
      'Text',
      'DataRef',
      'Series',
      'Column',
      'ListItem',
    ])
      expect(doc).toContain(`\n${name} = {`);
  });

  it('documents every zod refinement in the contract source', () => {
    // JSON Schema cannot carry a `.refine` / `.superRefine`, so each one is a
    // DASHBOARD_CONTRACT_RULES entry. Pinned 2026-09-26: the URL scheme refine,
    // the action url superRefine, line-chart and bar-chart (checkChart), table,
    // list and the envelope — 7 sites. A new site fails here until documented.
    const source = readFileSync(
      resolve(
        __dirname,
        '../../../../../../shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts',
      ),
      'utf8',
    );
    expect(source.match(/\.(?:super)?[rR]efine\(/g)).toHaveLength(7);
    expect(DASHBOARD_CONTRACT_RULES).toHaveLength(7);
  });

  function withComponent(component: unknown): unknown {
    return { spec: { ...makeDashboardSpec(), components: [component] } };
  }

  /** The review's reproductions plus one per refinement: zod rejects each. */
  const HELP_GUIDED_REJECTIONS: ReadonlyArray<[string, string, unknown]> = [
    [
      'an id with a space',
      'id: string (matching /^[A-Za-z0-9][A-Za-z0-9._:-]*$/',
      withComponent({ ...makeStat(), id: 'Total users' }),
    ],
    [
      'a string delta',
      'delta?: number',
      withComponent({ ...makeStat(), delta: '+5%' }),
    ],
    [
      'a string y',
      'y: number',
      withComponent({
        id: 'c',
        kind: 'line-chart',
        series: [{ name: 's', points: [{ x: 1, y: '3' }] }],
      }),
    ],
    [
      'align start',
      'align?: "left" | "center" | "right"',
      withComponent({
        id: 't',
        kind: 'table',
        columns: [{ key: 'a', label: { text: 'A' }, align: 'start' }],
        rows: [[1]],
      }),
    ],
    [
      'a string list detail',
      'detail?: Text',
      withComponent({
        id: 'l',
        kind: 'list',
        items: [{ text: { text: 'a' }, detail: 'detail' }],
      }),
    ],
    [
      'open-url with no url',
      'REQUIRED when action is dashboard.open-url',
      withComponent({
        ...makeStat(),
        actions: [{ action: 'dashboard.open-url', label: { text: 'Go' } }],
      }),
    ],
    [
      'a url on refresh',
      'REJECTED on every other action',
      withComponent({
        ...makeStat(),
        actions: [
          {
            action: 'dashboard.refresh',
            label: { text: 'Go' },
            url: 'https://example.com',
          },
        ],
      }),
    ],
    [
      'an object param value',
      'params?: { [string (at least 1 char)]: string | number | boolean }',
      withComponent({
        ...makeStat(),
        actions: [
          {
            action: 'dashboard.refresh',
            label: { text: 'Go' },
            params: { a: { nested: true } },
          },
        ],
      }),
    ],
    [
      'a chart with series AND data',
      'never both, never neither',
      withComponent({
        id: 'c',
        kind: 'bar-chart',
        series: [],
        data: { resultId: 'r1' },
      }),
    ],
    [
      'a short table row',
      'exactly one cell per column',
      withComponent({ ...makeTable(1, 2), rows: [[1]] }),
    ],
    [
      'a table with no columns',
      'columns: Column[] (1-',
      withComponent({ ...makeTable(0, 0), columns: [], rows: [] }),
    ],
    [
      'revision 0',
      'revision: integer > 0',
      { spec: { ...makeDashboardSpec(), revision: 0 } },
    ],
    [
      'a date with no offset',
      'generatedAt: string (date-time, ISO 8601 with Z or an offset',
      { spec: { ...makeDashboardSpec(), generatedAt: '2026-09-26T10:00:00' } },
    ],
    [
      'a markdown format',
      'format?: "plain"',
      {
        spec: {
          ...makeDashboardSpec(),
          title: { text: 'x', format: 'markdown' },
        },
      },
    ],
  ];

  it.each(HELP_GUIDED_REJECTIONS)(
    '%s: help states %j and zod rejects it',
    async (_label, fragment, args) => {
      expect(await help('dashboard')).toContain(fragment);
      expect(DashboardProposeSpecInputSchema.safeParse(args).success).toBe(
        false,
      );
    },
  );
});

/** Batch 16 r1, finding M1: the drift checker's own negative controls. */
describe('the structural drift checker', () => {
  const schema = (): JsonSchema =>
    buildDashboardProposeSpecTool().inputSchema as unknown as JsonSchema;
  const validJson = JSON.stringify(makeDashboardSpec());

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ])('rejects a prototype-named unknown key %s, as zod does', (key) => {
    const args: unknown = JSON.parse(
      `{"spec":${validJson},${JSON.stringify(key)}:1}`,
    );

    expect(conformsTo(schema(), args)).toEqual([`$: unexpected key ${key}`]);
    expect(DashboardProposeSpecInputSchema.safeParse(args).success).toBe(false);
  });

  it('rejects a prototype-named unknown key inside the envelope', () => {
    const args: unknown = JSON.parse(
      `{"spec":${validJson.replace(/}$/, ',"toString":1}')}}`,
    );

    expect(conformsTo(schema(), args)).toEqual([
      '$.spec: unexpected key toString',
    ]);
  });

  it.each([
    ['a missing key', {}, '$: missing required spec'],
    ['a wrong type', { spec: 4 }, '$.spec: expected object, got integer'],
    [
      'an unknown version',
      { spec: { ...makeDashboardSpec(), schemaVersion: 'dashboard-spec/9' } },
      '$.spec.schemaVersion: "dashboard-spec/9" is not in the enum',
    ],
    [
      'revision below 1',
      { spec: { ...makeDashboardSpec(), revision: 0 } },
      '$.spec.revision: below minimum',
    ],
    [
      'no components',
      { spec: { ...makeDashboardSpec(), components: [] } },
      '$.spec.components: fewer than minItems',
    ],
    [
      'an ordinary extra key',
      { spec: makeDashboardSpec(), extra: 1 },
      '$: unexpected key extra',
    ],
  ])('reports %s', (_label, args, expected) => {
    expect(conformsTo(schema(), args)).toContain(expected);
  });
});

describe('tools/list', () => {
  it('omits the dashboard tool under coding', async () => {
    const res = await handleMCPRequest(
      request({ method: 'tools/list' }),
      buildDeps(),
    );
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).not.toContain(
      DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
    );
  });
  it('lists the tool with no namespace toggle and no IDE capability', async () => {
    const res = await handleMCPRequest(
      request({ id: 'list', method: 'tools/list', _callerToolProfile: 'apps' }),
      buildDeps(),
    );
    const names = (res.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name,
    );

    expect(names).toContain(DASHBOARD_PROPOSE_SPEC_TOOL_NAME);
  });

  it('stays listed even when every namespace toggle is off', async () => {
    const deps = buildDeps();
    const res = await handleMCPRequest(
      request({ id: 'list', method: 'tools/list', _callerToolProfile: 'apps' }),
      {
        ...deps,
        disabledMcpNamespaces: [
          'ide',
          'agent',
          'git',
          'json',
          'browser',
          'harness',
          'code',
          'dashboard',
        ],
      },
    );
    const names = (res.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name,
    );

    expect(names).toContain(DASHBOARD_PROPOSE_SPEC_TOOL_NAME);
  });
});

describe('tools/call routing', () => {
  function call(
    args: Record<string, unknown>,
    deps: ProtocolHandlerDependencies,
  ) {
    return handleMCPRequest(
      request({
        id: 'call-99',
        _callerToolProfile: 'apps',
        method: 'tools/call',
        params: { name: DASHBOARD_PROPOSE_SPEC_TOOL_NAME, arguments: args },
      }),
      deps,
    );
  }

  it('forwards the spec untouched, with the request id as the tool call id', async () => {
    const proposeSpec = jest.fn(async () => ACCEPTED);
    const deps = buildDeps(proposeSpec);
    const spec = makeDashboardSpec({ components: [makeStat()] });

    await call({ spec }, deps);

    expect(proposeSpec).toHaveBeenCalledTimes(1);
    expect(proposeSpec).toHaveBeenCalledWith(spec, {
      sessionId: undefined,
      toolCallId: 'call-99',
    });
  });

  it('returns the plain-text dashboard as a success result', async () => {
    const deps = buildDeps(jest.fn(async () => ACCEPTED));

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBeUndefined();
    expect(text).toBe(DASHBOARD_TEXT);
  });

  it('returns isError — not success — when delivery to the UI failed', async () => {
    // Revision 1, finding 2. Before the fix the namespace could not tell the
    // dispatcher that delivery had failed, so this case was reported as a
    // successful emission.
    const deps = buildDeps(
      jest.fn(async () => ({
        status: 'delivery-failed' as const,
        specId: 'build-health',
        revision: 1,
        bytes: 120,
        text: DASHBOARD_TEXT,
        reason:
          'Dashboard spec build-health revision 1 is valid but was NOT fully delivered to the UI.',
        delivery: {
          status: 'failed' as const,
          delivered: 0,
          surfaces: 1,
          reason: '1 of 1 attached surface(s) did not accept the spec',
        },
      })),
    );

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBe(true);
    expect(text).toContain('NOT fully delivered');
    // Still carries the dashboard: a transport problem must not lose content.
    expect(text).toContain('Passing: 9');
  });

  it('keeps a host with NO surface a success, because that path is deliberate', async () => {
    const deps = buildDeps(
      jest.fn(async () => ({
        ...ACCEPTED,
        delivery: { status: 'no-surface' as const },
      })),
    );

    const { isError, text } = toolResult(
      await call({ spec: makeDashboardSpec() }, deps),
    );

    expect(isError).toBeUndefined();
    expect(text).toBe(DASHBOARD_TEXT);
  });

  it('returns isError with the reason when the namespace rejects', async () => {
    const deps = buildDeps(
      jest.fn(async () => ({
        status: 'rejected' as const,
        reason:
          'Dashboard spec rejected: schemaVersion: bad. Nothing was sent to the UI.',
      })),
    );

    const { isError, text } = toolResult(await call({ spec: {} }, deps));

    expect(isError).toBe(true);
    expect(text).toContain('Nothing was sent to the UI.');
  });

  it('forwards a missing `spec` to the validator rather than pre-judging it', async () => {
    // The dispatcher must NOT grow its own shape check: a second, weaker copy
    // of the contract would report a worse reason than the validator's.
    const proposeSpec = jest.fn(async () => ({
      status: 'rejected' as const,
      reason: 'Dashboard spec rejected: invalid input.',
    }));
    const deps = buildDeps(proposeSpec);

    const { isError } = toolResult(await call({}, deps));

    expect(proposeSpec).toHaveBeenCalledWith(undefined, expect.any(Object));
    expect(isError).toBe(true);
  });
});
