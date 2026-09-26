import {
  buildExecuteCodeTool,
  buildAgentMessageTool,
  buildAgentReadTool,
  buildAgentReportTool,
  buildAgentSpawnTool,
  buildCodeReindexTool,
  buildGetDependenciesTool,
  buildGetDependentsTool,
  buildGetSymbolIndexTool,
  buildLspDefinitionsTool,
  buildLspReferencesTool,
  buildTaskCheckTool,
  buildTaskListTool,
} from './tool-description.builder';
import {
  SYMBOL_INDEX_DEFAULT_LIMIT,
  SYMBOL_INDEX_MAX_LIMIT,
} from '../namespace-builders/symbol-index-query';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';

/** The description budget the execute_code guard applies (the only size assertion). */
const DESCRIPTION_CHAR_BUDGET = 1_000;

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
