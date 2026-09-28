// The builder reads the language registry from the workspace-intelligence
// barrel, whose DI-decorated services need the reflect polyfill at load.
import 'reflect-metadata';
import {
  buildExecuteCodeTool,
  buildAgentMessageTool,
  buildAgentReadTool,
  buildAgentReportTool,
  buildAgentSpawnTool,
  buildAstAnalyzeTool,
  buildCodeReindexTool,
  buildCodeSearchSymbolsTool,
  buildContextEnrichFileTool,
  buildGetDependenciesTool,
  buildGetDependentsTool,
  buildGetDiagnosticsTool,
  buildGetSymbolIndexTool,
  buildLspDefinitionsTool,
  buildLspReferencesTool,
  buildTaskCheckTool,
  buildTaskListTool,
  DESCRIPTION_LANGUAGE_NAMES,
} from './tool-description.builder';
import {
  SYMBOL_INDEX_DEFAULT_LIMIT,
  SYMBOL_INDEX_MAX_LIMIT,
} from '../namespace-builders/symbol-index-query';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import { LANGUAGE_IDS } from '@ptah-extension/platform-core';
import {
  supportedLanguagesFor,
  type LanguageCapability,
} from '@ptah-extension/workspace-intelligence';
import type { MCPToolDefinition } from '../types';

/** The description budget the execute_code guard applies (the only size assertion). */
const DESCRIPTION_CHAR_BUDGET = 1_000;

/**
 * Batch 31: descriptions name languages by their usual extension. Typed here
 * by hand (not read from the builder), so a changed name fails.
 */
const EXPECTED_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: 'ts',
  javascript: 'js',
  tsx: 'tsx',
  python: 'py',
  go: 'go',
  csharp: 'cs',
  java: 'java',
  kotlin: 'kt',
  rust: 'rs',
  php: 'php',
  ruby: 'rb',
  cpp: 'cpp',
};

/** The registry list for `capability`, as a description writes it. */
function describedLanguages(capability: LanguageCapability): string {
  return supportedLanguagesFor(capability)
    .map((id) => EXPECTED_LANGUAGE_NAMES[id])
    .join(',');
}

describe('buildExecuteCodeTool', () => {
  it('guides agents to direct tools and native file editing', () => {
    const description = buildExecuteCodeTool().description;

    expect(description).toContain('Prefer direct `ptah_*` tools');
    expect(description).toContain('ptah.help(topic)');
    expect(description).toContain('`ptah.files` is read-only');
    expect(description).toContain(
      'Never use execute_code to create or edit files',
    );
    expect(description).toContain('native CLI write/edit tools');
  });

  it('stays concise while retaining minimal executable examples', () => {
    const description = buildExecuteCodeTool().description;

    expect(description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(description).toContain('ptah.workspace.getInfo()');
    expect(description).toContain("ptah.search.findFiles('**/*.ts', 20)");
  });

  // TASK_2026_559 Task 6.3: the reindex tool is held to the same budget.
  it('keeps ptah_code_reindex within the same budget, with only an optional filePath', () => {
    const tool = buildCodeReindexTool();

    expect(tool.name).toBe('ptah_code_reindex');
    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual([
      'filePath',
    ]);
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect(tool.description).toContain('background');
    expect(tool.description).toContain('ptah_code_search_symbols');
  });
});

// TASK_2026_559 Batch 9: paging arguments, with the defaults stated.
describe('buildGetSymbolIndexTool', () => {
  const tool = buildGetSymbolIndexTool();

  it('stays within the description budget and states the paging defaults', () => {
    expect(tool.name).toBe('ptah_get_symbol_index');
    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(tool.description).toContain(
      `limit ${SYMBOL_INDEX_DEFAULT_LIMIT} (max ${SYMBOL_INDEX_MAX_LIMIT}), offset 0`,
    );
    expect(tool.description).toContain('nextOffset');
    expect(tool.description).toContain('ends early');
  });

  it('takes only optional pathPrefix, limit and offset, with the limits in the schema', () => {
    const properties = tool.inputSchema.properties as Record<
      string,
      { type?: string; minimum?: number; maximum?: number }
    >;
    expect(Object.keys(properties)).toEqual(['pathPrefix', 'limit', 'offset']);
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect(properties['limit']).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: SYMBOL_INDEX_MAX_LIMIT,
    });
    expect(properties['offset']).toMatchObject({ type: 'integer', minimum: 0 });
  });

  // Batch 9 revision round 1 (review F1): the oversized-file form is documented.
  it('states how a file too large on its own is returned and recovered', () => {
    expect(tool.description).toContain('truncated: true');
    expect(tool.description).toContain('symbolCount');
    expect(tool.description).toContain('symbolsFile');
    expect(tool.description).toContain('symbolsFileError');
  });
});

// Batch 9 revision round 1 (review F3, User Decision 14): the graph file cap is disclosed.
describe.each([
  ['ptah_get_symbol_index', buildGetSymbolIndexTool],
  ['ptah_get_dependents', buildGetDependentsTool],
  ['ptah_get_dependencies', buildGetDependenciesTool],
])('%s graph completeness', (name, buildTool) => {
  const tool = buildTool();

  it('says results can be incomplete and how that is shown, within the budget', () => {
    expect(tool.name).toBe(name);
    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(tool.description).toContain('very large workspaces');
    expect(tool.description).toContain(
      'incomplete: true with graphedFiles and discoveredFiles',
    );
  });
});

// Batch 9b: a cold graph builds in the background; the tools say so.
describe.each([
  ['ptah_get_symbol_index', buildGetSymbolIndexTool],
  ['ptah_get_dependents', buildGetDependentsTool],
  ['ptah_get_dependencies', buildGetDependenciesTool],
])('%s building status', (name, buildTool) => {
  const tool = buildTool();

  it('names the building status and the retry hint, within the budget', () => {
    expect(tool.name).toBe(name);
    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(tool.description).toContain('status: "building", retryAfterMs');
    expect(tool.description).toContain('call again after retryAfterMs');
    expect(tool.description).toContain('background');
  });
});

describe.each([
  ['ptah_get_dependents', buildGetDependentsTool],
  ['ptah_get_dependencies', buildGetDependenciesTool],
])('%s failed build', (_name, buildTool) => {
  it('says a failed build is reported and how to retry it', () => {
    const { description } = buildTool();
    expect(description).toContain('status "failed"');
    expect(description).toContain('calling again rebuilds');
  });
});

/**
 * `ptah_lsp_references` / `ptah_lsp_definitions` — TASK_2026_559 Batch 8.
 *
 * Both tools are served by two hosts: the VS Code extension (the language
 * server, via `vscode.execute*Provider`) and the desktop app (a name-based
 * resolver). Neither description may claim the VS Code language server
 * unconditionally, and each must name the desktop mechanism.
 */
describe.each([
  ['ptah_lsp_references', buildLspReferencesTool],
  ['ptah_lsp_definitions', buildLspDefinitionsTool],
])('%s description', (name, buildTool) => {
  const description = buildTool().description;

  it('keeps its name and stays within the description budget', () => {
    expect(buildTool().name).toBe(name);
    expect(description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
  });

  it('does not claim "VS Code LSP" as the unconditional mechanism', () => {
    expect(description).not.toMatch(/using VS Code LSP/i);
    expect(description).toContain(
      "In the VS Code extension this uses VS Code's language server",
    );
  });

  it('states the desktop app mechanism is name-based', () => {
    expect(description).toMatch(/In the desktop app it is (a )?name-based/);
  });
});

describe('ptah_lsp_definitions description — desktop limits', () => {
  it('names the index, the import fallback and what stays unresolved', () => {
    const description = buildLspDefinitionsTool().description;
    expect(description).toContain('workspace symbol index');
    expect(description).toContain('relative imports');
    expect(description).toContain('path-alias');
  });

  it('discloses that the index-free fallback does not resolve .tsx files', () => {
    const description = buildLspDefinitionsTool().description;
    expect(description).toContain(
      'Without a symbol-index match, lookups from or into .tsx files return no location.',
    );
  });

  it('scopes the node_modules claim to the VS Code extension', () => {
    const description = buildLspDefinitionsTool().description;
    const vscodeClause = description.indexOf('In the VS Code extension');
    const desktopClause = description.indexOf('In the desktop app');
    const nodeModules = description.indexOf('node_modules');
    expect(vscodeClause).toBeGreaterThanOrEqual(0);
    expect(nodeModules).toBeGreaterThan(vscodeClause);
    expect(nodeModules).toBeLessThan(desktopClause);
  });
});

/**
 * `ptah_agent_message` / `ptah_agent_report` — TASK_2026_402 Batch 5.
 *
 * Capability is a runtime fact answered by `ptah_agent_list`, so neither
 * description may name a vendor or promise a mechanism (`vendor-roster-drift`
 * covers the brand spellings; this covers the enum the spawner uses).
 */
describe('buildAgentMessageTool', () => {
  it('names the tool ptah_agent_message and requires agentId + message', () => {
    const tool = buildAgentMessageTool();
    expect(tool.name).toBe('ptah_agent_message');
    expect(tool.inputSchema.required).toEqual(['agentId', 'message']);
  });

  it('enumerates every mode, including the one that discards work', () => {
    const description = buildAgentMessageTool().description;
    for (const mode of [
      'steer',
      'interrupt-resume',
      'queue-next-turn',
      'unsupported',
    ]) {
      expect(description).toContain(mode);
    }
    expect(description).toContain('DISCARDED');
  });

  it('directs the reader to ptah_agent_list instead of naming a CLI', () => {
    const description = buildAgentMessageTool().description;
    expect(description).toContain('ptah_agent_list');
    // Word-boundary, not substring: `pi` is two letters and would match inside
    // ordinary English, which would make this assertion noise rather than a
    // guard.
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).not.toMatch(new RegExp(`\\b${cli}\\b`, 'i'));
    }
  });
});

describe('buildAgentSpawnTool — role', () => {
  it('advertises an optional string role and still requires only task', () => {
    const tool = buildAgentSpawnTool();
    const properties = tool.inputSchema.properties as Record<
      string,
      { type?: string; description?: string }
    >;
    expect(properties['role']?.type).toBe('string');
    expect(tool.inputSchema.required).toEqual(['task']);
  });

  it('points at ptah_agent_list and warns against pasting templates into task', () => {
    const properties = buildAgentSpawnTool().inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    const description = properties['role']?.description ?? '';
    expect(description).toContain('ptah_agent_list');
    expect(description).toContain('delivered');
    expect(description).toMatch(/Do not paste a role template into task/);
  });

  it('names no CLI vendor in the role description', () => {
    const properties = buildAgentSpawnTool().inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    const description = properties['role']?.description ?? '';
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).not.toMatch(new RegExp(`\\b${cli}\\b`, 'i'));
    }
  });
});

describe('buildAgentReportTool', () => {
  it('takes NO agentId — identity comes from the connection', () => {
    const tool = buildAgentReportTool();
    expect(tool.name).toBe('ptah_agent_report');
    expect(tool.inputSchema.required).toEqual(['message']);
    expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain(
      'agentId',
    );
  });

  it('states that a refusal is reported rather than a false success', () => {
    const description = buildAgentReportTool().description;
    expect(description).toContain('"delivered": false');
    expect(description).toContain('reason');
  });

  it('names no CLI vendor', () => {
    const description = buildAgentReportTool().description;
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(description).not.toMatch(new RegExp(`\\b${cli}\\b`, 'i'));
    }
  });
});

// TASK_2026_559 Batch 13: the read default and the paging parameters are stated.
describe('buildAgentReadTool', () => {
  it('states the 200-line default and documents offset', () => {
    const tool = buildAgentReadTool();
    expect(tool.description).toContain('200 lines');
    expect(tool.description).toContain('offset');
    // Review r1 B1: the budget narrowing is disclosed, and which end it keeps.
    expect(tool.description).toContain('the newest lines are kept');
    // Review r2 R2-S1: a narrowed window is saved, and the result names it.
    expect(tool.description).toContain('saved to a file the result names');
    const offset = (tool.inputSchema.properties ?? {})['offset'] as
      { type?: string; description?: string } | undefined;
    expect(offset?.type).toBe('number');
    expect(offset?.description).toMatch(/0-based/);
    expect(tool.inputSchema.required).toEqual(['agentId']);
  });
});

// TASK_2026_559 Batch 15: the task list is paged and summary-first, and the
// check caps its lists. Both descriptions must say so, within the budget.
describe('buildTaskListTool / buildTaskCheckTool', () => {
  it('documents limit, cursor and fields, and how to get a full row', () => {
    const tool = buildTaskListTool();
    const properties = tool.inputSchema.properties as Record<
      string,
      { type?: string; maximum?: number; enum?: string[] }
    >;

    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(Object.keys(properties)).toEqual([
      'status',
      'type',
      'limit',
      'cursor',
      'fields',
    ]);
    expect(properties['limit']).toMatchObject({
      type: 'integer',
      maximum: 200,
    });
    expect(properties['fields'].enum).toEqual(['summary', 'full']);
    expect(tool.description).toContain('limit 25 (max 200)');
    expect(tool.description).toContain('nextCursor');
    expect(tool.description).toContain('ptah_task_get');
    expect(tool.description).toContain("fields:'full'");
  });

  // Batch 15 r1 M3/S1: count vs total, and pages that can hold fewer rows.
  it('states that count is the rows on this page and total is every match', () => {
    const { description } = buildTaskListTool();

    expect(description).toContain('count (rows on this page)');
    expect(description).toContain('total (every match)');
    expect(description).toContain('fewer rows');
    expect(description).toContain('INVALID_CURSOR');
  });

  it('states the check cap and the full-set totals', () => {
    const tool = buildTaskCheckTool();

    expect(tool.description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    expect(tool.description).toContain('at most 50');
    expect(tool.description).toContain('invalidTotal');
    expect(tool.description).toContain('excludedTotal');
    expect(tool.description).not.toContain('every SKIPPED');
  });
});

// TASK_2026_559 Batch 24b r2: the short coverage reason codes are explained
// where an agent reads them, within the description budget.
describe('code index tools — coverage legend', () => {
  it.each([
    ['ptah_code_search_symbols', buildCodeSearchSymbolsTool],
    ['ptah_code_reindex', buildCodeReindexTool],
  ])(
    '%s explains clean, reasons, ?, truncated, stale, updating and saturation',
    (_name, build) => {
      const { description } = build();
      for (const term of [
        '`clean`',
        '`reasons`',
        '`?`',
        '`truncated`',
        '`stale`',
        '`updating`',
        '999999',
      ]) {
        expect(description).toContain(term);
      }
      expect(description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
    },
  );

  // Batch 22c: the compact block leaves zero counts out, so the legend must
  // say how to read an absent count. Fails before 22c.
  it.each([
    ['ptah_code_search_symbols', buildCodeSearchSymbolsTool],
    ['ptah_code_reindex', buildCodeReindexTool],
  ])('%s states the compact reading rule', (_name, build) => {
    const { description } = build();
    expect(description).toContain('clean→`analyzed`+approximations');
    expect(description).toContain('omitted counts=0, null=unknown');
  });

  it('ptah_code_reindex says a single file returns its own coverage', () => {
    expect(buildCodeReindexTool().description).toContain(
      'filePath: own coverage/stats',
    );
  });
});

/**
 * TASK_2026_559 Batch 24c: every language-bound tool states the languages it
 * covers, and that list is the registry's (`supportedLanguagesFor`), never a
 * hand-kept one. Each row names where the list sits in the description; the
 * captured list must EQUAL the registry list for that capability, in order.
 */
describe('Batch 24c — description language list equals registry', () => {
  const ROWS: ReadonlyArray<
    readonly [string, () => MCPToolDefinition, RegExp, LanguageCapability]
  > = [
    [
      'ptah_ast_analyze',
      buildAstAnalyzeTool,
      /Languages: ([a-z/,]+);/,
      'parse',
    ],
    [
      'ptah_ast_analyze',
      buildAstAnalyzeTool,
      /exports only for ([a-z/,]+)\./,
      'publicSymbols',
    ],
    [
      'ptah_context_enrich_file',
      buildContextEnrichFileTool,
      /declaration-only ([a-z/,]+) file/,
      'enrichSummary',
    ],
    [
      'ptah_code_search_symbols',
      buildCodeSearchSymbolsTool,
      /Functions\/classes\/methods: ([a-z/,]+);/,
      'codeIndex',
    ],
    [
      'ptah_code_search_symbols',
      buildCodeSearchSymbolsTool,
      /export-clause names \(`export`\): ([a-z/,]+)\./,
      'publicSymbols',
    ],
    [
      'ptah_code_reindex',
      buildCodeReindexTool,
      /unsupported-language outside ([a-z/,]+)\./,
      'codeIndex',
    ],
    [
      'ptah_get_dependents',
      buildGetDependentsTool,
      /Graph languages: ([a-z/,]+);/,
      'graphEdges',
    ],
    [
      'ptah_get_dependencies',
      buildGetDependenciesTool,
      /Graph languages: ([a-z/,]+);/,
      'graphEdges',
    ],
    [
      'ptah_get_symbol_index',
      buildGetSymbolIndexTool,
      /graph export index \(([a-z/,]+) files/,
      'graphEdges',
    ],
    [
      'ptah_lsp_definitions',
      buildLspDefinitionsTool,
      /relative imports \(([a-z/,]+)\)/,
      'definitionFallback',
    ],
    [
      'ptah_lsp_references',
      buildLspReferencesTool,
      /once the ([a-z/,]+) dependency graph is built/,
      'graphEdges',
    ],
    [
      'ptah_get_diagnostics',
      buildGetDiagnosticsTool,
      /syntax-only check of scoped ([a-z/,]+) files/,
      'syntaxDiagnostics',
    ],
  ];

  it.each(ROWS)(
    '%s: the list at its marker equals the registry list',
    (_name, build, marker, capability) => {
      const match = marker.exec(build().description);
      expect(match?.[1]?.split(',')).toEqual(
        supportedLanguagesFor(capability).map(
          (id) => EXPECTED_LANGUAGE_NAMES[id],
        ),
      );
    },
  );

  it('ptah_context_enrich_file takes exactly the registry languages as its language enum', () => {
    const properties = buildContextEnrichFileTool().inputSchema
      .properties as Record<string, { enum?: string[] }>;
    expect(properties['language'].enum).toEqual([
      ...supportedLanguagesFor('enrichSummary'),
    ]);
  });

  it('ptah_context_enrich_file tells callers .tsx is summarised as tsx (Batch 29b r1 R29b-03)', () => {
    const tool = buildContextEnrichFileTool();
    const language = (
      tool.inputSchema.properties as Record<string, { description?: string }>
    )['language'].description;

    expect(supportedLanguagesFor('enrichSummary')).toContain('tsx');
    expect(tool.description).not.toMatch(/not \.tsx|or \.tsx\)/);
    expect(language).not.toContain('.tsx is not summarised');
    expect(language).toContain('.tsx → tsx');
    // The refusals a TSX file can still get stay described: not
    // declaration-only (load-time JSX, top-level calls) and parse failures.
    expect(tool.description).toContain("'unsupported-declarations'");
    expect(tool.description).toContain("'parse-failed'");
  });

  it('no language-bound description keeps the old hand-written TS/JS-only claims', () => {
    expect(buildAstAnalyzeTool().description).not.toContain(
      'JavaScript/TypeScript file',
    );
    expect(buildGetDiagnosticsTool().description).not.toContain(
      'Get TypeScript/JavaScript errors',
    );
    expect(buildContextEnrichFileTool().description).not.toContain('not TS/JS');
  });

  it('follows the registry: a capability granted to a new language appears without editing the builder', () => {
    jest.isolateModules(() => {
      jest.doMock('@ptah-extension/workspace-intelligence', () => {
        const actual = jest.requireActual<
          typeof import('@ptah-extension/workspace-intelligence')
        >('@ptah-extension/workspace-intelligence');
        return {
          ...actual,
          supportedLanguagesFor: (capability: LanguageCapability) =>
            capability === 'codeIndex'
              ? ['typescript', 'kotlin']
              : actual.supportedLanguagesFor(capability),
        };
      });
      const isolated = jest.requireActual<
        typeof import('./tool-description.builder')
      >('./tool-description.builder');
      expect(isolated.buildCodeSearchSymbolsTool().description).toContain(
        'Functions/classes/methods: ts,kt;',
      );
      expect(isolated.buildCodeReindexTool().description).toContain(
        'unsupported-language outside ts,kt.',
      );
    });
    jest.dontMock('@ptah-extension/workspace-intelligence');
  });
});

// Batch 24c: the two symbol stores are named apart, and so are the hosts.
describe('Batch 24c — index and host mechanisms are named', () => {
  it('the code index tools name the SQLite code index and point exports at the graph export index', () => {
    const search = buildCodeSearchSymbolsTool().description;
    expect(search).toContain('SQLite code index');
    expect(search).toContain(
      'Exports: ptah_get_symbol_index (graph export index)',
    );
    expect(buildCodeReindexTool().description).toContain(
      'Refresh the SQLite code index (ptah_code_search_symbols)',
    );
  });

  // Batch 24d indexes every export kind; the description lists them all.
  it('ptah_code_search_symbols lists every kind the code index holds', () => {
    const description = buildCodeSearchSymbolsTool().description;
    expect(description).toContain('Functions/classes/methods: ');
    expect(description).toContain(
      'exported interfaces/types/enums/variables/namespaces/export-clause names (`export`)',
    );
    expect(description).not.toContain('(functions, classes, methods)');
  });

  it('ptah_get_symbol_index names the graph export index and says it is not the SQLite code index', () => {
    const description = buildGetSymbolIndexTool().description;
    expect(description).toContain('graph export index');
    expect(description).toContain(
      'not the SQLite code index of ptah_code_search_symbols',
    );
  });

  it('ptah_get_diagnostics names the VS Code and the desktop/CLI mechanisms', () => {
    const description = buildGetDiagnosticsTool().description;
    expect(description).toContain(
      "In the VS Code extension they come from the editor's language services",
    );
    expect(description).toContain(
      'in the desktop app and CLI from the TypeScript compiler (TS/JS)',
    );
    expect(description.length).toBeLessThan(DESCRIPTION_CHAR_BUDGET);
  });

  it('the graph tools say what a file outside the graph languages returns', () => {
    for (const build of [buildGetDependentsTool, buildGetDependenciesTool]) {
      expect(build().description).toContain(
        'other files return status "unsupported-language"',
      );
    }
  });
});

/**
 * Batch 24c fix round (review r1, ruling R2): both code index descriptions
 * are back within their pre-24b budgets (702 / 536, pinned in the sweep).
 * The shortened texts must still carry every required content item; each is
 * asserted as a meaning-bearing fragment, so a later trim that drops one
 * fails instead of passing silently.
 */
describe('Batch 24c fix round — shortened code index descriptions keep their required content', () => {
  const LEGEND_ITEMS = [
    '`coverage` first', // coverage leads the result
    '`clean`',
    'clean→`analyzed`+approximations', // compact clean form (22c; Batch 31 r1 R31-01)
    'up to 3 `reasons`',
    'omitted counts=0, null=unknown', // compact reading rule (22c)
    '`?`=unknown',
    '`truncated`=census cut',
    '`stale`=last run partial',
    '`updating`=writing',
    '999999=at least', // saturation
  ];

  it('ptah_code_search_symbols keeps every required item within 702 chars', () => {
    const { description } = buildCodeSearchSymbolsTool();
    const required = [
      'SQLite code index', // which store it searches
      'BM25+vector', // how it ranks
      'beats Grep', // when to prefer it
      `Functions/classes/methods: ${describedLanguages('codeIndex')};`,
      // Batch 24d kinds, with the languages whose exports are extracted.
      'exported interfaces/types/enums/variables/namespaces/export-clause names (`export`): ' +
        `${describedLanguages('publicSymbols')}.`,
      'ptah_get_symbol_index (graph export index)', // the other store
      'Hits: path/kind/name/score',
      'index: symbolCount/indexAgeMs/reindexStarted/reindexInFlight',
      'Empty/>24h index: background reindex',
      'stale 0 hits inconclusive',
      '"index unavailable": ptah_search_files/Grep', // runtimes without SQLite
      ...LEGEND_ITEMS,
    ];
    expect(required.filter((item) => !description.includes(item))).toEqual([]);
    expect(description.length).toBeLessThanOrEqual(702);
  });

  it('ptah_code_reindex keeps every required item within 536 chars', () => {
    const { description } = buildCodeReindexTool();
    const required = [
      'Refresh the SQLite code index (ptah_code_search_symbols)',
      'after empty/old searches', // when to use it
      'Omit filePath: background full run',
      'returns {started,symbolCount,indexAgeMs,reindexInFlight}',
      'search when done',
      'filePath: own coverage/stats', // single-file result
      `unsupported-language outside ${describedLanguages('codeIndex')}.`,
      'No index: error.', // runtimes without SQLite
      ...LEGEND_ITEMS,
    ];
    expect(required.filter((item) => !description.includes(item))).toEqual([]);
    expect(description.length).toBeLessThanOrEqual(536);
  });
});

/**
 * Batch 31: the per-tool pins were full with eight languages listed by full
 * id (search 702/702). Lists are compact now, so every current and planned
 * language fits without raising a pin.
 */
describe('Batch 31 — compact language lists keep every pin', () => {
  it('names every registry language, each by its own distinct name', () => {
    expect({ ...DESCRIPTION_LANGUAGE_NAMES }).toEqual(EXPECTED_LANGUAGE_NAMES);
    expect(Object.keys(DESCRIPTION_LANGUAGE_NAMES).sort()).toEqual(
      [...LANGUAGE_IDS].sort(),
    );
    const names = Object.values(DESCRIPTION_LANGUAGE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists php, ruby and cpp (Batch 31) and kt (Batch 30k) as code-index languages now', () => {
    expect(buildCodeSearchSymbolsTool().description).toContain(
      'Functions/classes/methods: ts,js,tsx,py,go,cs,java,kt,rs,php,rb,cpp;',
    );
  });

  // The planned end state (required keys, Decisions 18/19): every language
  // in the code index, every language but Kotlin with public symbols (no
  // `publicSymbols:kotlin` key).
  it('with every planned language listed, search and reindex stay within 702 and 536', () => {
    jest.isolateModules(() => {
      jest.doMock('@ptah-extension/workspace-intelligence', () => ({
        ...jest.requireActual<
          typeof import('@ptah-extension/workspace-intelligence')
        >('@ptah-extension/workspace-intelligence'),
        supportedLanguagesFor: (capability: LanguageCapability) =>
          capability === 'publicSymbols'
            ? LANGUAGE_IDS.filter((id) => id !== 'kotlin')
            : [...LANGUAGE_IDS],
      }));
      const isolated = jest.requireActual<
        typeof import('./tool-description.builder')
      >('./tool-description.builder');
      const search = isolated.buildCodeSearchSymbolsTool().description;
      const reindex = isolated.buildCodeReindexTool().description;
      const all = 'ts,js,tsx,py,go,cs,java,kt,rs,php,rb,cpp';
      expect(search).toContain(`Functions/classes/methods: ${all};`);
      expect(search).toContain(
        '(`export`): ts,js,tsx,py,go,cs,java,rs,php,rb,cpp.',
      );
      expect(search.length).toBeLessThanOrEqual(702);
      expect(reindex).toContain(`unsupported-language outside ${all}.`);
      expect(reindex.length).toBeLessThanOrEqual(536);
    });
    jest.dontMock('@ptah-extension/workspace-intelligence');
  });
});
