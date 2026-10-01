/**
 * Dispatcher contract sweep (TASK_2026_559, Batch 21, Task 21.1).
 *
 * Regression harness H2: drives EVERY tool served over HTTP (both IDE and
 * non-IDE registration, every caller kind), the stdio MCP server's 8 tools,
 * and `execute_code`, through the real budget layer with an oversized fake
 * `PtahAPI` payload. Asserts (per r1 review, code-logic-review-r1.md):
 *
 * - the call actually SUCCEEDED (not an `isError` response) before any size
 *   assertion — an accidentally-broken fixture must fail loudly, not pass as
 *   a short error string;
 * - returned TOKENS (not just chars) stay within the tool's declared budget;
 * - the trailer names a reducer and a spool path;
 * - the spool file is byte-equal to the exact raw text production itself fed
 *   the budget layer (captured by spying on the real, unmocked
 *   `applyToolResultBudget` export — not a hand-recomputed duplicate, so
 *   there is no way for the oracle and the implementation to drift apart);
 * - a planted marker survives into the returned text.
 *
 * The tool set comes from live `tools/list` calls (both host configurations,
 * every caller kind) — never a hard-coded array — so a tool added later
 * without a driver in {@link TOOL_DRIVERS} fails this suite with a clear
 * message, and a tool whose handler bypasses the budget layer fails the size
 * assertion.
 *
 * r1 revision (batches.md Batch 21, reviews/batch-21-code-logic-review-r1.md):
 * fixed the count_tokens/get_symbol_index/LSP fixtures that previously passed
 * on `isError` responses or the wrong shape; `agent_report` now exercises the
 * attributed-success path; added the host/caller/stdio/execute_code coverage
 * matrix; replaced regex spool-path parsing with directory-diff discovery
 * (portable — no drive-letter assumption); independently pinned the default
 * and per-tool-override budgets and a per-tool description-length map;
 * AST-lite manifest title matching lives in the sibling spec.
 *
 * r3 revision (reviews/batch-21-code-logic-review-r3.md R3-01..R3-03): one
 * shared `budgetContractFailures` grades every budgeted result — all text
 * blocks, advertised vs independently pinned ceiling, parsed trailer with a
 * known reducer, and the file the PRINTED locator names byte-equal to the
 * captured raw text; own-windowing tools get byte-level page/continuation
 * checks; ~20 KB below-outline-cap fixtures sit beside the above-cap ones;
 * every cell of the 2×2×4 HTTP host/caller matrix is executed, listing and
 * calling under the same identity, with named control-tool exceptions.
 */
import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import {
  DEFAULT_TOOL_RESULT_BUDGET_CHARS,
  DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  TOOL_CONTENT_HINTS,
  TOOL_RESULT_BUDGET_OVERRIDES,
  getToolResultBudget,
} from './tool-result-budget';
import * as ToolResultBudgetModule from './tool-result-budget';
import { formatWorkspaceAnalysis } from './mcp-response-formatter';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';
import { AgentToolDispatcher } from '../mcp-stdio/agent-tool.dispatcher';
import { StdioMcpServerService } from '../mcp-stdio/stdio-mcp-server.service';
import { MCP_MVP_TOOL_NAMES } from '../mcp-stdio/tool-builders';
import {
  countTokensPiecewise,
  reduceJson,
} from '@ptah-extension/tool-output-reducers';
import {
  compactCoverage,
  withCoverageVerdict,
  type CoverageFields,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** A long, deterministic filler string of exactly `n` characters. */
function filler(n: number, seed = 'x'): string {
  return seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
}

/** `count` plain-string entries, each long enough to blow any tool's budget. */
function bigStringArray(count: number, prefix: string): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${prefix}/${filler(120, 'p')}/${i}.ts`,
  );
}

/** A JSON-serialisable object whose stringified form is always far over 8,000 chars. */
function bigJsonBlob(marker: string): Record<string, unknown> {
  return {
    marker,
    items: Array.from({ length: 800 }, (_, i) => ({
      id: i,
      name: `symbol_${i}`,
      detail: filler(90, 'd'),
    })),
  };
}

/** One oversized diagnostic payload, with `marker` in the requested file's message. */
function bigDiagnosticsPayload(marker: string) {
  const diagnostics = Array.from({ length: 400 }, (_, i) => ({
    file: `/fixture/src/file_${i}.ts`,
    line: i + 1,
    col: 1,
    severity: i % 5 === 0 ? 'warning' : 'error',
    message: i === 0 ? `${marker} ${filler(200, 'm')}` : filler(200, 'm'),
  }));
  return {
    status: 'available' as const,
    source: 'typescript',
    diagnostics,
    requestedFiles: ['/fixture/src/file_0.ts'],
  };
}

/**
 * A clean coverage, verdict first (Batch 24r), as the graph and AST
 * namespaces return it. The dispatcher writes every coverage block through
 * `compactCoverage` (Batch 22c), which requires the full field set.
 */
const CLEAN_FIELDS: CoverageFields = {
  supportedLanguages: ['typescript', 'javascript'],
  census: 'complete',
  analyzed: 1,
  unchecked: 0,
  failed: 0,
  unsupported: 0,
  unrecognised: 0,
  nonSource: 0,
  excluded: 0,
  omittedByCap: 0,
};
const CLEAN_COVERAGE: LanguageCoverage = withCoverageVerdict(CLEAN_FIELDS);

/** The Batch 23b graph members a get_dependents/get_dependencies stub needs. */
function graphFileStubs(coverage: LanguageCoverage = CLEAN_COVERAGE) {
  return {
    unsupportedGraphLanguage: () => undefined,
    getGraphCoverageForFile: async (file: string) => ({
      coverage,
      nodePath: file,
    }),
  };
}

/**
 * An LSP answer that says how it was produced (Batch 26a
 * `LspLocationReport`): a host lookup whose language support is unreported.
 */
function lspReport(
  locations: Array<{ file: string; line: number; column: number }>,
) {
  return {
    locations,
    mechanism: 'provider-defined' as const,
    language: 'typescript',
    languageSupported: null,
    approximations: [],
  };
}

/** A child snapshot whose label carries the driver's size and marker. */
function sessionChild(label: string): Record<string, unknown> {
  return {
    childSessionId: 'c-1',
    parentSessionId: 'p-1',
    label,
    branch: 'feat/x',
    baseRef: 'a'.repeat(40),
    workspaceRoot: '/fixture',
    worktreePath: '/fixture/.worktrees/feat-x',
    deliverables: [],
    status: 'working',
    subagentPtahTools: 'available',
    startedAt: '2026-10-01T12:00:00.000Z',
    turnsSettled: 0,
    reportsDelivered: 0,
    reportsRefused: 0,
  };
}

/** A session namespace stub with nothing held. */
function sessionStub(
  methods: Record<string, unknown>,
): Record<string, unknown> {
  return { takeHeldCompletions: () => [], ...methods };
}

interface ToolDriver {
  /** Valid `tools/call` arguments; a function form when the marker must sit inside an argument. */
  args: Record<string, unknown> | ((marker: string) => Record<string, unknown>);
  /** Populate `api` (a fresh partial stub) so the call returns an oversized payload. */
  mock: (api: any, marker: string) => void;
  /** Extra `MCPRequest` fields (e.g. `_callerAgentId`) needed to reach the branch under test. */
  requestExtra?: Partial<MCPRequest>;
}

function resolveArgs(
  driver: ToolDriver,
  marker: string,
): Record<string, unknown> {
  return typeof driver.args === 'function' ? driver.args(marker) : driver.args;
}

/**
 * One driver per tool this dispatcher recognises (`protocol-dispatcher.ts`
 * `handleIndividualTool`/`dispatchToolsCall`), 54 entries — matches the r1
 * review's live probe (56 HTTP tools with IDE capabilities minus
 * `execute_code` and `approval_prompt`, which are driven separately below).
 *
 * - Most namespace calls go straight through `JSON.stringify` — any large
 *   object clears the budget, so the payload does not have to mimic the
 *   real shape.
 * - The `mcp-response-formatter.ts` formatters read specific fields; those
 *   drivers supply real field names (verified by reading the formatter).
 * - A few tools (`click`, `type`, `close`, `record_start`) only ever emit a
 *   fixed-size success line; their only variable-length field is `error`,
 *   so the driver forces a huge error string — the sole way the budget layer
 *   is exercised for them at all.
 * - `ptah_get_symbol_index`, `ptah_agent_read` and `ptah_browser_evaluate`
 *   pre-fit their own output to the budget INSIDE the dispatcher, before the
 *   generic budget layer ever sees it; they are driven here for the
 *   coverage-driver check but get their own dedicated correctness tests
 *   below instead of the generic byte-equal-spool assertion.
 */
const TOOL_DRIVERS: Readonly<Record<string, ToolDriver>> = {
  ptah_workspace_analyze: {
    args: {},
    mock: (api, marker) => {
      api.workspace = {
        analyze: async () => ({
          info: { projectType: marker, rootPath: '/fixture' },
          structure: {
            structure: {
              directories: bigStringArray(600, '/fixture/dir'),
              files: bigStringArray(600, '/fixture/file'),
            },
          },
          projectInfo: {
            dependencies: bigStringArray(200, 'dep'),
            devDependencies: bigStringArray(200, 'devdep'),
          },
        }),
        getInfo: async () => ({ path: undefined }),
      };
    },
  },
  ptah_search_files: {
    // A high explicit `limit`: the default (50) truncates the list server-
    // side to a small block the outline reducer omits wholesale (like the
    // single-paragraph tools above) — a bigger surviving list, matching
    // `ptah_lsp_references`'s shape, is the honest way to exercise the list
    // reducer path this tool actually has.
    args: { pattern: '**/*.ts', limit: 2500 },
    mock: (api, marker) => {
      api.search = {
        findFiles: async () => [
          `/fixture/${marker}.ts`,
          ...bigStringArray(2000, '/fixture/search'),
        ],
      };
    },
  },
  ptah_get_diagnostics: {
    args: {},
    mock: (api, marker) => {
      api.diagnostics = { getAll: async () => bigDiagnosticsPayload(marker) };
    },
  },
  ptah_lsp_references: {
    args: { file: '/fixture/a.ts', line: 0, col: 0 },
    mock: (api, marker) => {
      // Object shape, not strings: `formatLspLocationItem` reads
      // `file`/`line`/`column` (mcp-response-formatter.ts). A string-valued
      // fixture (the r1-flagged bug) renders every location as an empty
      // label and is a false green. The dispatcher calls the Batch 26a
      // report API, not the bare `getReferences` array.
      api.ide = {
        lsp: {
          getReferencesReport: async () =>
            lspReport(
              Array.from({ length: 2000 }, (_, i) => ({
                file:
                  i === 0
                    ? `/fixture/${marker}.ts`
                    : `/fixture/ref/${filler(100, 'r')}${i}.ts`,
                line: i + 1,
                column: 1,
              })),
            ),
        },
      };
    },
  },
  ptah_lsp_definitions: {
    args: { file: '/fixture/a.ts', line: 0, col: 0 },
    mock: (api, marker) => {
      // The Batch 26a report API, as for ptah_lsp_references.
      api.ide = {
        lsp: {
          getDefinitionReport: async () =>
            lspReport(
              Array.from({ length: 2000 }, (_, i) => ({
                file:
                  i === 0
                    ? `/fixture/${marker}.ts`
                    : `/fixture/def/${filler(100, 'd')}${i}.ts`,
                line: i + 1,
                column: 1,
              })),
            ),
        },
      };
    },
  },
  ptah_get_dirty_files: {
    args: {},
    mock: (api, marker) => {
      api.ide = {
        editor: {
          getDirtyFiles: async () => [
            `/fixture/${marker}`,
            ...bigStringArray(2000, '/fixture/dirty'),
          ],
        },
      };
    },
  },
  ptah_count_tokens: {
    // `args.file` is echoed verbatim into the formatted text
    // (`formatTokenCount` reads only `file`/`tokens`), so it alone carries
    // the size. `file` is not absolute (no leading `/`), so
    // `toWorkspaceReadPath` returns it unchanged without needing
    // `workspace.getInfo`. `files.read` and `context.countTokens` MUST both
    // be mocked for the call to succeed at all — the r1 review found this
    // driver previously left them unmocked, so the call threw and returned a
    // short `isError` response that the old assertions accepted as coverage.
    args: (marker) => ({ file: `${marker}-${filler(280000, 'f')}` }),
    mock: (api) => {
      api.files = { read: async () => 'file contents' };
      api.context = { countTokens: async () => 5000 };
    },
  },
  ptah_agent_spawn: {
    args: { task: 'do the thing' },
    mock: (api, marker) => {
      api.agent = {
        spawn: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'running',
          startedAt: `${marker}-${filler(280000, 's')}`,
          messagingMode: 'steer',
        }),
      };
    },
  },
  ptah_agent_status: {
    args: {},
    mock: (api, marker) => {
      api.agent = {
        status: async () =>
          Array.from({ length: 400 }, (_, i) => ({
            agentId: i === 0 ? marker : `agent-${i}`,
            cli: 'claude',
            status: 'running',
            task: filler(200, 't'),
            startedAt: new Date(0).toISOString(),
            messagingMode: 'steer',
          })),
      };
    },
  },
  ptah_agent_read: {
    // `offset: 0` forces a forward-page read (keeps the FIRST lines) rather
    // than the default tail (keeps the LAST lines): the marker sits at the
    // start, matching every other driver's convention, and this is the
    // branch every other test in this suite exercises for the shape.
    args: { agentId: 'agent-1', offset: 0 },
    mock: (api, marker) => {
      // A complete `AgentOutput` (r3: the earlier fixture omitted
      // `stdoutTotalLines`/`stderrTotalLines`/`truncated`, which the view reads).
      const { output } = agentReadFixture(marker);
      api.agent = { read: async () => output };
    },
  },
  ptah_agent_message: {
    args: { agentId: 'agent-1', message: 'hi' },
    mock: (api, marker) => {
      api.agent = {
        message: async () => ({
          mode: 'steer',
          detail: `${marker}-${filler(280000, 'e')}`,
        }),
      };
    },
  },
  ptah_agent_report: {
    // Exercises the ATTRIBUTED success path (`agent.report` actually
    // called), not the unattributed-caller refusal: r1 found the refusal
    // (a fixed 79-char string) was the only path this driver ever reached,
    // which never touches the budget/formatter code at all.
    args: { message: 'status' },
    requestExtra: { _callerAgentId: 'agent-caller-1' },
    mock: (api, marker) => {
      api.agent = {
        report: async () => ({
          delivered: true,
          parentSessionId: `${marker}-${filler(280000, 'r')}`,
        }),
      };
    },
  },
  ptah_agent_stop: {
    args: { agentId: 'agent-1' },
    mock: (api, marker) => {
      api.agent = {
        stop: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'stopped',
          cliSessionId: `${marker}-${filler(280000, 'c')}`,
        }),
      };
    },
  },
  ptah_agent_list: {
    // Rendered as a Markdown TABLE (`formatAgentList`). The generic,
    // non-`ptah-cli` branch only ever shows `cli`/`messaging` in a cell, so
    // the marker (and the bulk that forces the table past
    // `MAX_OUTLINE_CHARS`, 262,144 chars in `markdown.reducer.ts`) has to be
    // in every row's `cli` value, not `providerName`, which that branch
    // never reads — a table under that cap is dropped wholesale as one
    // omitted block regardless of row count (verified: 2,000 short rows
    // still collapsed to "(table, 2002 lines, omitted)"). Past the cap the
    // outline reducer takes its own "too large to lex" bypass and the plain
    // prefix cut that follows keeps the marker at position 0.
    args: {},
    mock: (api, marker) => {
      api.agent = {
        list: async () =>
          Array.from({ length: 2000 }, (_, i) => ({
            cli: i === 0 ? marker : filler(200, 'c') + i,
            installed: true,
            messagingMode: 'steer',
            providerName: filler(80, 'p') + i,
          })),
        listRoles: async () => [],
      };
    },
  },
  ptah_web_search: {
    args: { query: 'anything' },
    mock: (api, marker) => {
      api.webSearch = {
        search: async () => ({
          query: marker,
          summary: filler(2000, 's'),
          providers: ['tavily'],
          status: 'ok',
          durationMs: 100,
          results: Array.from({ length: 300 }, (_, i) => ({
            title: filler(80, 't') + i,
            url: `https://example.test/${i}`,
            snippet: filler(200, 'n'),
            sources: ['tavily'],
          })),
          resultCount: 300,
          outcomes: [
            {
              provider: 'tavily',
              status: 'ok',
              durationMs: 100,
              resultCount: 300,
            },
          ],
        }),
      };
    },
  },
  ptah_git_worktree_list: {
    // Sized past `MAX_OUTLINE_CHARS` for the same reason as `agent_list`.
    args: {},
    mock: (api, marker) => {
      api.git = {
        worktreeList: async () => ({
          worktrees: Array.from({ length: 3000 }, (_, i) => ({
            path: i === 0 ? `/fixture/${marker}` : `/fixture/wt/${i}`,
            branch: filler(90, 'b') + i,
            head: filler(40, 'h'),
            isMain: false,
          })),
        }),
      };
    },
  },
  ptah_git_worktree_add: {
    args: { branch: 'feature/x' },
    mock: (api, marker) => {
      api.git = {
        worktreeAdd: async () => ({
          success: true,
          worktreePath: `${marker}-${filler(280000, 'a')}`,
        }),
      };
    },
  },
  ptah_git_worktree_remove: {
    args: { path: '/fixture/wt/0' },
    mock: (api, marker) => {
      api.git = {
        worktreeRemove: async () => ({
          success: false,
          error: `${marker}-${filler(280000, 'e')}`,
        }),
      };
    },
  },
  ptah_json_validate: {
    // Sized past `MAX_OUTLINE_CHARS` for the same reason as `agent_list`.
    args: { file: '/fixture/a.json' },
    mock: (api, marker) => {
      api.json = {
        validate: async () => ({
          success: false,
          file: '/fixture/a.json',
          repairs: [marker, ...bigStringArray(3000, 'repair')],
          errors: bigStringArray(200, 'error'),
          fileOverwritten: false,
        }),
      };
    },
  },
  ptah_browser_navigate: {
    args: { url: 'https://example.test' },
    mock: (api, marker) => {
      api.browser = {
        navigate: async () => ({
          url: 'https://example.test',
          title: `${marker}-${filler(280000, 'n')}`,
        }),
      };
    },
  },
  ptah_browser_screenshot: {
    args: {},
    mock: (api) => {
      // 4 chars base64 ~= 3 bytes; this alone is far over budget. No marker
      // needed — the screenshot text caption is fixed-size and never echoes
      // the data; `formatBrowserScreenshot` is only reached on `saveTo`
      // failure/no-`saveTo` paths this fixture does not take, and the image
      // block itself is not text-budgeted (see `protocol-dispatcher.ts`
      // around the image response). Kept in the sweep for coverage; the
      // token/char check still applies to whatever text block is returned.
      api.browser = {
        screenshot: async () => ({ data: filler(200000, 'A'), format: 'jpeg' }),
      };
    },
  },
  ptah_browser_evaluate: {
    args: { expression: '1+1' },
    mock: (api, marker) => {
      api.browser = {
        evaluate: async () => ({
          type: 'object',
          value: { marker, big: filler(280000, 'v') },
        }),
      };
    },
  },
  ptah_browser_click: {
    args: { selector: '#x' },
    mock: (api, marker) => {
      // Success text is fixed-size; only the error path is variable-length.
      api.browser = {
        click: async () => ({ error: `${marker}-${filler(280000, 'c')}` }),
      };
    },
  },
  ptah_browser_type: {
    args: { selector: '#x', text: 'hi' },
    mock: (api, marker) => {
      api.browser = {
        type: async () => ({ error: `${marker}-${filler(280000, 't')}` }),
      };
    },
  },
  ptah_browser_content: {
    args: {},
    mock: (api, marker) => {
      const html =
        `<html><body><article><h1>${marker}</h1>` +
        `<p>${filler(60000, 'h')}</p></article></body></html>`;
      // `formatBrowserContent` caps `text` and `html` at 32 KiB each before
      // wrapping in Markdown; both fields here exceed that cap, so the
      // FORMATTED page comfortably clears `ptah_browser_content`'s override
      // budget (32 KiB + 1 KiB) regardless of the cap math, guaranteeing the
      // Batch 21p over-budget branch (`createBrowserContentResponse`) runs.
      api.browser = {
        getContent: async () => ({ text: filler(40000, 't'), html }),
      };
    },
  },
  ptah_browser_network: {
    // Sized past `MAX_OUTLINE_CHARS` for the same reason as `agent_list`.
    args: {},
    mock: (api, marker) => {
      api.browser = {
        networkRequests: async () => ({
          requests: Array.from({ length: 3000 }, (_, i) => ({
            method: 'GET',
            status: 200,
            type: 'xhr',
            size: 1024,
            url:
              i === 0
                ? `https://example.test/${marker}`
                : `https://example.test/${filler(90, 'u')}${i}`,
          })),
        }),
      };
    },
  },
  ptah_browser_close: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        close: async () => ({ error: `${marker}-${filler(280000, 'x')}` }),
      };
    },
  },
  ptah_browser_status: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        status: async () => ({
          connected: true,
          url: `${marker}-${filler(280000, 'u')}`,
          title: 'x',
        }),
      };
    },
  },
  ptah_browser_record_start: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        recordStart: async () => ({
          error: `${marker}-${filler(280000, 'r')}`,
        }),
      };
    },
  },
  ptah_browser_record_stop: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        recordStop: async () => ({ error: `${marker}-${filler(280000, 's')}` }),
      };
    },
  },
  ptah_harness_search_skills: {
    args: {},
    mock: (api, marker) => {
      api.harness = {
        searchSkills: async () => ({
          status: 'ok',
          skills: [marker, ...bigStringArray(2000, 'skill')],
        }),
      };
    },
  },
  ptah_harness_create_skill: {
    args: { name: 'n', description: 'd', content: 'c' },
    mock: (api, marker) => {
      api.harness = {
        createSkill: async () => ({
          ok: true,
          path: `${marker}-${filler(280000, 'p')}`,
        }),
      };
    },
  },
  ptah_harness_search_mcp_registry: {
    args: { query: 'x' },
    mock: (api, marker) => {
      api.harness = {
        searchMcpRegistry: async () => ({
          status: 'ok',
          servers: [marker, ...bigStringArray(2000, 'srv')],
        }),
      };
    },
  },
  ptah_harness_list_installed_mcp: {
    args: {},
    mock: (api, marker) => {
      api.harness = {
        listInstalledMcpServers: async () => [
          marker,
          ...bigStringArray(2000, 'installed'),
        ],
      };
    },
  },
  ptah_harness_install_mcp_server: {
    args: { serverName: 'srv', config: { type: 'stdio', command: 'x' } },
    mock: (api, marker) => {
      api.harness = {
        installMcpServer: async () => ({
          ok: true,
          log: [marker, ...bigStringArray(500, 'log')],
        }),
      };
    },
  },
  ptah_harness_propose_config: {
    args: { configUpdates: { a: 1 } },
    mock: (api, marker) => {
      api.harness = {
        proposeConfig: async () => `${marker}-${filler(280000, 'm')}`,
      };
    },
  },
  ptah_ast_analyze: {
    args: { file: '/fixture/a.ts' },
    mock: (api, marker) => {
      api.ast = {
        analyze: async () => ({
          parseStatus: 'ok',
          coverage: CLEAN_COVERAGE,
          functions: Array.from({ length: 800 }, (_, i) => ({
            name: i === 0 ? marker : `fn_${i}`,
            startLine: i,
            endLine: i + 1,
            detail: filler(80, 'a'),
          })),
        }),
      };
    },
  },
  ptah_context_enrich_file: {
    args: { file: '/fixture/a.ts' },
    mock: (api, marker) => {
      api.context = { enrichFile: async () => bigJsonBlob(marker) };
    },
  },
  ptah_get_dependents: {
    args: { file: '/fixture/a.ts' },
    mock: (api, marker) => {
      api.workspace = { getInfo: async () => ({ path: undefined }) };
      api.dependencies = {
        getDependents: async () => [
          `/fixture/${marker}.ts`,
          ...bigStringArray(2000, '/fixture/dependent'),
        ],
        ...graphFileStubs(),
      };
    },
  },
  ptah_get_dependencies: {
    args: { file: '/fixture/a.ts' },
    mock: (api, marker) => {
      api.workspace = { getInfo: async () => ({ path: undefined }) };
      api.dependencies = {
        getDependencies: async () => [
          `/fixture/${marker}.ts`,
          ...bigStringArray(2000, '/fixture/dependency'),
        ],
        ...graphFileStubs(),
      };
    },
  },
  ptah_code_search_symbols: {
    args: { query: 'anything' },
    mock: (api, marker) => {
      api.code = { searchSymbols: async () => bigJsonBlob(marker) };
    },
  },
  ptah_code_reindex: {
    args: {},
    mock: (api, marker) => {
      api.code = { reindex: async () => bigJsonBlob(marker) };
    },
  },
  ptah_memory_search: {
    args: { query: 'anything' },
    mock: (api, marker) => {
      api.memory = { search: async () => bigJsonBlob(marker) };
    },
  },
  ptah_relevance_rank_files: {
    args: { query: 'anything' },
    mock: (api, marker) => {
      api.relevance = { rankFiles: async () => bigJsonBlob(marker) };
    },
  },
  ptah_project_detect_monorepo: {
    args: {},
    mock: (api, marker) => {
      api.project = { detectMonorepo: async () => bigJsonBlob(marker) };
    },
  },
  ptah_get_symbol_index: {
    args: {},
    mock: (api, marker) => {
      api.workspace = { getInfo: async () => ({ path: undefined }) };
      api.dependencies = {
        getSymbolIndex: async () => ({
          files: Array.from({ length: 2000 }, (_, i) => ({
            file:
              i === 0 ? `/fixture/${marker}.ts` : `/fixture/src/file_${i}.ts`,
            symbols: [`sym_${i}`],
          })),
          count: 2000,
          total: 2000,
          offset: 0,
        }),
        getGraphCoverage: async () => ({ coverage: CLEAN_COVERAGE }),
      };
    },
  },
  ptah_task_create: {
    args: { title: 't', description: 'd' },
    mock: (api, marker) => {
      api.tasks = { create: async () => bigJsonBlob(marker) };
    },
  },
  ptah_task_update: {
    args: { id: 'TASK_1', status: 'done' },
    mock: (api, marker) => {
      api.tasks = { update: async () => bigJsonBlob(marker) };
    },
  },
  ptah_task_get: {
    args: { id: 'TASK_1' },
    mock: (api, marker) => {
      api.tasks = { get: async () => bigJsonBlob(marker) };
    },
  },
  ptah_task_list: {
    args: {},
    mock: (api, marker) => {
      // The real `tasks.list` uses the `fits` callback to pre-page; this
      // fake ignores it and returns the whole oversized blob, so the
      // GENERIC budget layer (hint `preformatted`: cut only) is what is
      // actually exercised here — legitimate for this fake, since the
      // paging behaviour itself belongs to `agent-sdk`'s task store, not to
      // this dispatcher.
      api.tasks = { list: async () => bigJsonBlob(marker) };
    },
  },
  ptah_task_check: {
    args: {},
    mock: (api, marker) => {
      api.tasks = { check: async () => bigJsonBlob(marker) };
    },
  },
  ptah_dashboard_propose_spec: {
    args: { spec: { title: 'x' } },
    mock: (api, marker) => {
      api.dashboard = {
        proposeSpec: async () => ({
          status: 'delivered',
          text: `${marker}-${filler(280000, 'd')}`,
        }),
      };
    },
  },
  ptah_surface_update: {
    args: {},
    mock: (api, marker) => {
      api.surface = {
        update: async () => ({
          status: 'accepted',
          surfaceId: 'dash',
          revision: 1,
          delivery: { status: 'delivered', surfaces: 1 },
          text: `${marker}-${filler(280000, 'u')}`,
        }),
      };
    },
  },
  ptah_surface_get_state: {
    args: {},
    mock: (api, marker) => {
      api.surface = {
        getState: async () => ({
          status: 'found',
          text: `${marker}-${filler(600000, 'g')}`,
        }),
      };
    },
  },
  // Child sessions (TASK_2026_584). Each drives the session NAMESPACE (the
  // dispatcher's collaborator), with the oversized text in the one field its
  // reply echoes.
  ptah_session_start: {
    args: { task: 'do the thing', branch: 'feat/x' },
    mock: (api, marker) => {
      api.session = sessionStub({
        start: async () => ({
          ok: true,
          child: sessionChild(`${marker}-${filler(280000, 's')}`),
        }),
      });
    },
  },
  ptah_session_send: {
    args: { sessionId: 'c-1', message: 'go' },
    mock: (api, marker) => {
      api.session = sessionStub({
        send: async () => ({
          delivered: false,
          reason: 'delivery-failed',
          detail: `${marker}-${filler(280000, 'n')}`,
        }),
      });
    },
  },
  ptah_session_status: {
    args: {},
    mock: (api, marker) => {
      api.session = sessionStub({
        status: async () => ({
          ok: true,
          children: [sessionChild(`${marker}-${filler(280000, 't')}`)],
        }),
      });
    },
  },
  ptah_session_read: {
    args: { sessionId: 'c-1' },
    mock: (api, marker) => {
      api.session = sessionStub({
        read: async () => ({
          ok: true,
          result: {
            child: sessionChild(marker),
            transcript: filler(280000, 'r'),
            truncated: false,
            available: true,
          },
        }),
      });
    },
  },
  ptah_session_stop: {
    args: { sessionId: 'c-1' },
    mock: (api, marker) => {
      api.session = sessionStub({
        stop: async () => ({
          ok: true,
          child: sessionChild(`${marker}-${filler(280000, 'o')}`),
        }),
      });
    },
  },
  execute_code: {
    // Executed in every matrix pass under that pass's caller identity (r3
    // R3-03: it was previously only run once, standalone, anonymously). The
    // sandbox needs no API stub for a plain return value; `serializeResult`
    // never cuts (Batch 30 r1 R30-01), so the raw is the value itself.
    args: (marker) => ({
      code: `return '${marker}-' + 'x'.repeat(40000);`,
    }),
    mock: () => undefined,
  },
};

/** `MAX_OUTLINE_CHARS` in tool-output-reducers `markdown.reducer.ts` (256 KiB). */
const MARKDOWN_OUTLINE_CAP_CHARS = 262_144;

/** Size of the below-outline-cap fixtures (r3 R3-01): an ordinary oversized answer. */
const BELOW_CAP_CHARS = 20_000;

const PROSE_SENTENCES = [
  'The migration re-ran the schema check against the staging database before promoting the build.',
  'Three foreign keys still referenced tables that were renamed in the previous release, so the check failed.',
  'The retry used the same connection pool, which is why the second attempt reported the identical error.',
  'Rolling back the rename fixed the reference, and the follow-up run completed without warnings.',
  'The deployment notes now record which services read the renamed tables and in what order they restart.',
  'No data was lost: the failed transaction was rolled back cleanly and the audit log shows every statement.',
];

/**
 * One real prose paragraph (no blank lines — a single Markdown block, the
 * shape of an agent reply, an error message or a page title) of exactly
 * `chars` characters, opening with `marker`.
 */
function proseParagraph(marker: string, chars = BELOW_CAP_CHARS): string {
  let out = `${marker}: `;
  for (let i = 0; out.length < chars; i++) {
    out += `${PROSE_SENTENCES[i % PROSE_SENTENCES.length]} `;
  }
  return out.slice(0, chars);
}

/**
 * r3 R3-01: a second, BELOW-outline-cap oversized fixture (~20 KB of real
 * prose or real table/list rows, marker in the first block) for every shape
 * family whose main driver above is sized past {@link MARKDOWN_OUTLINE_CAP_CHARS}.
 * The main drivers are kept unchanged (above-cap case); these exercise the
 * reducer path the above-cap size bypasses. `ptah_surface_get_state` is not
 * listed: 20 KB is far inside its 548 KiB budget (not oversized), and
 * `ptah_browser_evaluate` pre-fits its own output (dedicated test).
 */
const BELOW_OUTLINE_CAP_DRIVERS: Readonly<Record<string, ToolDriver>> = {
  ptah_count_tokens: {
    args: (marker) => ({ file: proseParagraph(marker) }),
    mock: (api) => {
      api.files = { read: async () => 'file contents' };
      api.context = { countTokens: async () => 5000 };
    },
  },
  ptah_agent_spawn: {
    args: { task: 'do the thing' },
    mock: (api, marker) => {
      api.agent = {
        spawn: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'running',
          startedAt: proseParagraph(marker),
          messagingMode: 'steer',
        }),
      };
    },
  },
  ptah_agent_message: {
    args: { agentId: 'agent-1', message: 'hi' },
    mock: (api, marker) => {
      api.agent = {
        message: async () => ({
          mode: 'steer',
          detail: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_agent_report: {
    args: { message: 'status' },
    requestExtra: { _callerAgentId: 'agent-caller-1' },
    mock: (api, marker) => {
      api.agent = {
        report: async () => ({
          delivered: true,
          parentSessionId: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_agent_stop: {
    args: { agentId: 'agent-1' },
    mock: (api, marker) => {
      api.agent = {
        stop: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'stopped',
          cliSessionId: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_agent_list: {
    // A real ~20 KB Markdown table: 160 agents, marker in the first row.
    args: {},
    mock: (api, marker) => {
      api.agent = {
        list: async () =>
          Array.from({ length: 160 }, (_, i) => ({
            cli:
              i === 0
                ? marker
                : `claude-code-variant-${i}-with-a-descriptive-name`,
            installed: true,
            messagingMode: 'steer',
            providerName: `Provider number ${i}`,
          })),
        listRoles: async () => [],
      };
    },
  },
  ptah_git_worktree_list: {
    // A real ~20 KB worktree table: 150 rows, marker in the first path.
    args: {},
    mock: (api, marker) => {
      api.git = {
        worktreeList: async () => ({
          worktrees: Array.from({ length: 150 }, (_, i) => ({
            path: i === 0 ? `/work/${marker}` : `/work/repo-feature-${i}`,
            branch: `feature/${i}-tighten-the-result-budget-for-long-answers`,
            head: `${(i * 2654435761).toString(16).padStart(8, '0')}${'0'.repeat(32)}`,
            isMain: i === 0,
          })),
        }),
      };
    },
  },
  ptah_git_worktree_add: {
    args: { branch: 'feature/x' },
    mock: (api, marker) => {
      api.git = {
        worktreeAdd: async () => ({
          success: true,
          worktreePath: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_git_worktree_remove: {
    args: { path: '/fixture/wt/0' },
    mock: (api, marker) => {
      api.git = {
        worktreeRemove: async () => ({
          success: false,
          error: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_json_validate: {
    // A real ~20 KB repair list: 300 repairs, marker in the first item.
    args: { file: '/fixture/a.json' },
    mock: (api, marker) => {
      api.json = {
        validate: async () => ({
          success: false,
          file: '/fixture/a.json',
          repairs: Array.from({ length: 300 }, (_, i) =>
            i === 0
              ? `${marker}: removed a trailing comma at line 1, column 17`
              : `Removed a trailing comma at line ${i + 1}, column 17 in "dependencies"`,
          ),
          errors: ['Unexpected token } in JSON at position 4211'],
          fileOverwritten: false,
        }),
      };
    },
  },
  ptah_browser_navigate: {
    args: { url: 'https://example.test' },
    mock: (api, marker) => {
      api.browser = {
        navigate: async () => ({
          url: 'https://example.test',
          title: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_browser_click: {
    args: { selector: '#x' },
    mock: (api, marker) => {
      api.browser = { click: async () => ({ error: proseParagraph(marker) }) };
    },
  },
  ptah_browser_type: {
    args: { selector: '#x', text: 'hi' },
    mock: (api, marker) => {
      api.browser = { type: async () => ({ error: proseParagraph(marker) }) };
    },
  },
  ptah_browser_network: {
    // A real ~20 KB request table: 220 rows, marker in the first URL.
    args: {},
    mock: (api, marker) => {
      api.browser = {
        networkRequests: async () => ({
          requests: Array.from({ length: 220 }, (_, i) => ({
            method: i % 3 === 0 ? 'POST' : 'GET',
            status: 200,
            type: 'xhr',
            size: 1024 * (i + 1),
            url:
              i === 0
                ? `https://example.test/${marker}`
                : `https://api.example.test/v2/projects/${i}/results?page=${i}`,
          })),
        }),
      };
    },
  },
  ptah_browser_close: {
    args: {},
    mock: (api, marker) => {
      api.browser = { close: async () => ({ error: proseParagraph(marker) }) };
    },
  },
  ptah_browser_status: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        status: async () => ({
          connected: true,
          url: proseParagraph(marker),
          title: 'x',
        }),
      };
    },
  },
  ptah_browser_record_start: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        recordStart: async () => ({ error: proseParagraph(marker) }),
      };
    },
  },
  ptah_browser_record_stop: {
    args: {},
    mock: (api, marker) => {
      api.browser = {
        recordStop: async () => ({ error: proseParagraph(marker) }),
      };
    },
  },
  ptah_harness_create_skill: {
    args: { name: 'n', description: 'd', content: 'c' },
    mock: (api, marker) => {
      api.harness = {
        createSkill: async () => ({ ok: true, path: proseParagraph(marker) }),
      };
    },
  },
  ptah_harness_propose_config: {
    args: { configUpdates: { a: 1 } },
    mock: (api, marker) => {
      api.harness = { proposeConfig: async () => proseParagraph(marker) };
    },
  },
  ptah_dashboard_propose_spec: {
    args: { spec: { title: 'x' } },
    mock: (api, marker) => {
      api.dashboard = {
        proposeSpec: async () => ({
          status: 'delivered',
          text: proseParagraph(marker),
        }),
      };
    },
  },
  ptah_surface_update: {
    args: {},
    mock: (api, marker) => {
      api.surface = {
        update: async () => ({
          status: 'accepted',
          surfaceId: 'dash',
          revision: 1,
          delivery: { status: 'delivered', surfaces: 1 },
          text: proseParagraph(marker),
        }),
      };
    },
  },
};

/**
 * Served tools the execution sweep deliberately does not call, each with its
 * reason (r3 R3-03: the executed set must equal the listed set minus exactly
 * these, so a new tool can never be skipped silently).
 */
const CONTROL_TOOL_EXCEPTIONS: Readonly<Record<string, string>> = {
  approval_prompt:
    'control/UI: answers the host permission prompt with an allow/deny decision; it never returns model-facing content to budget',
};

/**
 * Tools whose OWN pre-fit windowing runs INSIDE the dispatcher before the
 * generic budget layer (`applyToolResultBudget`) ever sees the text. When
 * they work correctly they legitimately never reach it (their output already
 * fits), so the generic byte-equal-spool/trailer assertions do not apply —
 * each gets its own dedicated correctness test below instead.
 */
const OWN_WINDOWING_TOOLS = new Set<string>([
  'ptah_get_symbol_index',
  'ptah_agent_read',
  'ptah_browser_evaluate',
]);

/** Every tool this file does not (yet) drive; used only to build a clear failure message. */
function missingDriverMessage(name: string): string {
  return (
    `No oversized-payload driver registered for "${name}" in ` +
    `TOOL_DRIVERS (mcp-contract.sweep.spec.ts). Every tool tools/list ` +
    `returns must have one — see Task 21.1.`
  );
}

function makeRequest(overrides: Partial<MCPRequest> = {}): MCPRequest {
  return { jsonrpc: '2.0', id: 1, method: 'initialize', ...overrides };
}

function getToolNames(res: MCPResponse): string[] {
  const result = res.result as { tools: Array<{ name: string }> } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

function getTools(res: MCPResponse): Array<{
  name: string;
  description: string;
  _meta?: Record<string, unknown>;
}> {
  const result = res.result as
    | {
        tools: Array<{
          name: string;
          description: string;
          _meta?: Record<string, unknown>;
        }>;
      }
    | undefined;
  return result?.tools ?? [];
}

/**
 * Every text block of the result, joined (r3 R3-02: reading only the first
 * block let a second oversized block escape every size check).
 */
function textOf(res: MCPResponse): string {
  return textBlocksOf(res.result).join('\n');
}

function isErrorResult(res: MCPResponse): boolean {
  const result = res.result as { isError?: boolean } | undefined;
  return res.error !== undefined || result?.isError === true;
}

// ---------------------------------------------------------------------------
// Fixture lifecycle — a fresh mkdtemp spool root per test, never os.tmpdir()
// directly and never the repo's own .ptah.
// ---------------------------------------------------------------------------

let spoolRoot: string;

beforeEach(() => {
  spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-mcp-sweep-'));
});

afterEach(() => {
  fs.rmSync(spoolRoot, { recursive: true, force: true });
});

function spoolDirPath(): string {
  return path.join(spoolRoot, '.ptah', 'tmp', 'mcp-out');
}

/** Portable spool discovery (r1 defect 8): a directory snapshot, never a regex over a printed path. */
function snapshotSpoolFiles(): Set<string> {
  const dir = spoolDirPath();
  return new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
}

function newSpoolFiles(before: ReadonlySet<string>): string[] {
  const after = snapshotSpoolFiles();
  return [...after].filter((f) => !before.has(f));
}

// ---------------------------------------------------------------------------
// The one reusable budget contract (r3 R3-02). Every budgeted text result —
// the generic HTTP loop, the below-outline-cap matrix, the dedicated
// execute_code/diagnostics cases and the six stdio agent tools — is graded by
// `budgetContractFailures`, so no surface gets a weaker private variant.
// ---------------------------------------------------------------------------

/**
 * Literal pins of each tool's declared ceiling (User Decision 2 and the two
 * documented overrides), deliberately NOT read back from
 * `getToolResultBudget`: declaring or enforcing a different number must fail
 * here, not silently move the oracle with it.
 */
const PINNED_DEFAULT_BUDGET = { chars: 8000, tokens: 2000 } as const;
const PINNED_BUDGET_OVERRIDES: Readonly<
  Record<string, { chars: number; tokens: number }>
> = {
  // 32 KiB page cap + 1 KiB Markdown wrapper; tokens at 4 chars/token.
  ptah_browser_content: { chars: 33_792, tokens: 8_448 },
  // TASK_2026_584 F2: the default 32 KiB transcript tail + the 8,000-char
  // default for the header and held-completion block; tokens at 4 chars/token.
  ptah_session_read: { chars: 40_768, tokens: 10_192 },
  // The surface catalog's `maxStateReadBytes` (548 KiB); tokens at 4 chars/token.
  ptah_surface_get_state: { chars: 561_152, tokens: 140_288 },
};

function pinnedBudget(budgetName: string): { chars: number; tokens: number } {
  return PINNED_BUDGET_OVERRIDES[budgetName] ?? PINNED_DEFAULT_BUDGET;
}

/**
 * Tools whose formatter owns its reduction: only the cut runs, so the trailer
 * must name `none` (batches.md Task 21.1: "`preformatted` tools: `none`").
 * Pinned by name, independently of `TOOL_CONTENT_HINTS`.
 */
const PINNED_PREFORMATTED_TOOLS: ReadonlySet<string> = new Set([
  'ptah_get_diagnostics',
  'ptah_get_symbol_index',
  'ptah_agent_spawn',
  'ptah_agent_status',
  'ptah_agent_read',
  'ptah_agent_message',
  'ptah_agent_report',
  'ptah_agent_stop',
  'ptah_agent_list',
  'ptah_session_start',
  'ptah_session_send',
  'ptah_session_status',
  'ptah_session_read',
  'ptah_session_stop',
  'ptah_task_list',
]);

/**
 * Every reducer name that can reach a trailer: `reduceOutput` returns `none`
 * for refused/unchanged input, else one of the content reducers' success
 * names (tool-output-reducers `reducers/*.reducer.ts`). The `*-unchanged` /
 * `json-invalid` names never reach a trailer (the pipeline maps an unchanged
 * result to `none`), so they are not accepted here. `markdown-outline+prefix`
 * is the budget layer's own name for an outline followed by a labelled prefix
 * of the raw text (tool-result-budget.ts, review r4 R4-03).
 */
const KNOWN_TRAILER_REDUCERS: ReadonlySet<string> = new Set([
  'none',
  'json-compact',
  'markdown-outline',
  'markdown-outline+prefix',
  'log-reduced',
  'html-extract',
  'code-outline',
  'code-fallback:log-reduced',
]);

/**
 * The trailer `applyToolResultBudget` appends (tool-result-budget.ts
 * `renderTrailer`), anchored at the end of the returned text, exactly as the
 * 21p accepted-page test parses it (protocol-dispatcher.spec.ts).
 */
const BUDGET_TRAILER =
  /\n\n\[reduced: (\S+?)(?: — partial, cut (?:at a line end|mid-line))? — showing (\d+) of (\d+) tokens — (?:full output: ([^\]]+)|full output could not be saved: ([^\]]+))\]$/;

/**
 * The absolute file a printed locator names: an absolute path as printed, or
 * `<relative> under the workspace root|system temp directory` resolved
 * against that root.
 */
function resolvePrintedLocator(where: string): string {
  const relative =
    /^(.+) under the (workspace root|system temp directory)$/.exec(where);
  if (!relative) return where;
  const root = relative[2] === 'workspace root' ? spoolRoot : os.tmpdir();
  return path.resolve(root, relative[1]);
}

/** Every `type: 'text'` block of a tool result, in order. */
function textBlocksOf(result: unknown): string[] {
  const content = (
    result as { content?: Array<{ type: string; text?: string }> } | undefined
  )?.content;
  return (content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '');
}

/** The raw text production fed `applyToolResultBudget` for `budgetName`, from calls at index `from` on. */
function capturedRaw(
  spy: jest.SpyInstance,
  from: number,
  budgetName: string,
): string | undefined {
  const calls = spy.mock.calls.slice(from) as Array<
    [{ text: string; toolName: string }]
  >;
  const matching = calls.filter(([input]) => input.toolName === budgetName);
  return matching.length > 0
    ? matching[matching.length - 1][0].text
    : undefined;
}

interface BudgetContractCall {
  /** The name the budget is declared and enforced under (`ptah_*`). */
  readonly budgetName: string;
  /** `MCPResponse.result` of the call. */
  readonly result: unknown;
  /** The exact raw text production fed the budget layer (spy capture). */
  readonly raw: string | undefined;
  /** `_meta['anthropic/maxResultSizeChars']` from the SAME surface's served catalog. */
  readonly advertisedMaxChars: unknown;
  readonly marker: string;
  /** Spool directory listing taken before the call. */
  readonly spoolBefore: ReadonlySet<string>;
  /** New spool files the call may write (stdio also saves an oversized structuredContent). */
  readonly maxNewSpoolFiles?: number;
}

/**
 * The universal oversized-result contract (r3 R3-02), returned as a failure
 * list so a table-driven caller can report every tool at once:
 *
 * (a) ALL text blocks together stay within the pinned char and token ceiling;
 * (b) the advertised `maxResultSizeChars` equals the independent pin;
 * (c) the text ends with a parsable trailer whose reducer is a known name
 *     (`none` for the pinned preformatted tools) and whose total token count
 *     is the raw text's;
 * (d) the locator the RETURNED text prints resolves under this test's spool
 *     directory and that exact file is byte-equal to the captured raw text
 *     (the directory diff is only a secondary sanity check);
 * (e) the planted marker survives in the returned text.
 */
function budgetContractFailures(call: BudgetContractCall): string[] {
  const name = call.budgetName;
  const failures: string[] = [];
  const pin = pinnedBudget(name);

  const blocks = textBlocksOf(call.result);
  if (blocks.length === 0) {
    return [`${name}: no text content block`];
  }
  const totalChars = blocks.reduce((n, b) => n + b.length, 0);
  const totalTokens = blocks.reduce((n, b) => n + countTokensPiecewise(b), 0);
  if (totalChars > pin.chars) {
    failures.push(
      `${name}: ${blocks.length} text block(s) total ${totalChars} chars, pinned ceiling is ${pin.chars}`,
    );
  }
  if (totalTokens > pin.tokens) {
    failures.push(
      `${name}: ${blocks.length} text block(s) total ${totalTokens} tokens, pinned ceiling is ${pin.tokens}`,
    );
  }

  if (call.advertisedMaxChars !== pin.chars) {
    failures.push(
      `${name}: advertises maxResultSizeChars=${String(call.advertisedMaxChars)}, pinned value is ${pin.chars}`,
    );
  }

  const raw = call.raw;
  if (raw === undefined) {
    failures.push(`${name}: the budget layer never received this result`);
    return failures;
  }
  if (raw.length <= pin.chars && countTokensPiecewise(raw) <= pin.tokens) {
    failures.push(
      `${name}: fixture bug — the raw text (${raw.length} chars) fits the budget, so nothing is exercised`,
    );
    return failures;
  }

  const joined = blocks.join('\n');
  if (!joined.includes(call.marker)) {
    const printedReducer = BUDGET_TRAILER.exec(blocks[blocks.length - 1])?.[1];
    failures.push(
      `${name}: planted marker "${call.marker}" did not survive into the returned text ` +
        `(${totalChars} chars returned from ${raw.length} raw, reducer ${printedReducer ?? 'unparsed'})`,
    );
  }

  const last = blocks[blocks.length - 1];
  const trailer = BUDGET_TRAILER.exec(last);
  if (!trailer) {
    failures.push(
      `${name}: returned text does not end with a parsable "[reduced: …]" trailer`,
    );
    return failures;
  }
  const [, reducer, , printedTotal, where, spoolFailure] = trailer;
  if (!KNOWN_TRAILER_REDUCERS.has(reducer)) {
    failures.push(`${name}: trailer names unknown reducer "${reducer}"`);
  }
  if (PINNED_PREFORMATTED_TOOLS.has(name) && reducer !== 'none') {
    failures.push(
      `${name}: preformatted tool must name reducer "none", trailer says "${reducer}"`,
    );
  }
  const rawTokens = countTokensPiecewise(raw);
  if (Number(printedTotal) !== rawTokens) {
    failures.push(
      `${name}: trailer total ${printedTotal} tokens, the raw text is ${rawTokens}`,
    );
  }
  if (where === undefined) {
    failures.push(
      `${name}: trailer reports the spool failed (${spoolFailure ?? 'no reason'})`,
    );
    return failures;
  }

  const printedFile = resolvePrintedLocator(where);
  const dir = spoolDirPath();
  if (path.dirname(path.resolve(printedFile)) !== path.resolve(dir)) {
    failures.push(
      `${name}: printed locator "${where}" does not resolve into this test's spool directory`,
    );
    return failures;
  }
  if (!fs.existsSync(printedFile)) {
    failures.push(`${name}: printed locator "${where}" names no file`);
    return failures;
  }
  if (!fs.readFileSync(printedFile).equals(Buffer.from(raw, 'utf8'))) {
    failures.push(
      `${name}: the file the printed locator names is not byte-equal to the raw text`,
    );
  }

  const added = newSpoolFiles(call.spoolBefore);
  const maxNew = call.maxNewSpoolFiles ?? 1;
  if (!added.includes(path.basename(printedFile))) {
    failures.push(
      `${name}: the printed spool file was not written by this call`,
    );
  }
  if (added.length < 1 || added.length > maxNew) {
    failures.push(
      `${name}: expected 1..${maxNew} new spool file(s), found ${added.length}`,
    );
  }
  return failures;
}

/** A real `AgentOutput` for a forward-page read: every field the view reads. */
function agentReadFixture(marker: string) {
  const lines = Array.from({ length: 4000 }, (_, i) =>
    i === 0 ? `${marker} ${filler(60, 'o')}` : `line ${i} ${filler(60, 'o')}`,
  );
  return {
    lines,
    output: {
      agentId: 'agent-1',
      stdout: lines.join('\n'),
      stderr: '',
      lineCount: lines.length,
      totalLines: lines.length,
      omittedLines: 0,
      stdoutTotalLines: lines.length,
      stderrTotalLines: 0,
      truncated: false,
    },
  };
}

/**
 * `renderAgentRead`'s forward-page contract (own windowing, so no outer
 * trailer): the shown lines are exactly source lines 1..B, the notice states
 * the range and the omission, and the file its printed locator names holds
 * the WHOLE window byte-for-byte (r3 R3-02).
 */
function expectAgentReadPage(
  text: string,
  lines: readonly string[],
  marker: string,
): void {
  expect(text.length).toBeLessThanOrEqual(PINNED_DEFAULT_BUDGET.chars);
  expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
    PINNED_DEFAULT_BUDGET.tokens,
  );
  expect(BUDGET_TRAILER.test(text)).toBe(false);
  expect(text).toContain(marker);
  const notice =
    /Showing lines (\d+)-(\d+) of (\d+) \((\d+) omitted; pass offset\/tail to page\)\. Lines (\d+)-(\d+) in full: ([^\n]+)/.exec(
      text,
    );
  expect(notice).not.toBeNull();
  if (!notice) return;
  const [, from, to, total, omitted, spoolFrom, spoolTo, where] = notice;
  expect(Number(from)).toBe(1);
  expect(Number(to)).toBeGreaterThan(1);
  expect(Number(to)).toBeLessThan(lines.length);
  expect(Number(total)).toBe(lines.length);
  expect(Number(omitted)).toBe(lines.length - Number(to));
  expect(Number(spoolFrom)).toBe(1);
  expect(Number(spoolTo)).toBe(lines.length);
  expect(text).toContain(lines.slice(0, Number(to)).join('\n'));
  expect(text).not.toContain(lines[Number(to)]);
  const printed = where.trim();
  expect(path.dirname(printed)).toBe(spoolDirPath());
  expect(fs.readFileSync(printed)).toEqual(
    Buffer.from(lines.join('\n'), 'utf8'),
  );
}

function buildDeps(
  apiOverrides: Record<string, any>,
  overrides: Partial<ProtocolHandlerDependencies> = {},
): ProtocolHandlerDependencies {
  return {
    ptahAPI: apiOverrides as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: createMockLogger(),
    hasIDECapabilities: true,
    hasSqliteLayer: true,
    workspaceProvider: { getWorkspaceFolders: () => [spoolRoot] },
    ...overrides,
  };
}

/**
 * `tools/list` under a host configuration AND caller identity — the same
 * `requestExtra` the calls use (r3 R3-03: the sweep previously listed as an
 * anonymous caller and then called as another identity).
 */
async function listAllTools(
  overrides: Partial<ProtocolHandlerDependencies> = {},
  requestExtra: Partial<MCPRequest> = {},
): Promise<
  Array<{ name: string; description: string; _meta?: Record<string, unknown> }>
> {
  const res = await handleMCPRequest(
    makeRequest({ id: 'list', method: 'tools/list', ...requestExtra }),
    buildDeps({}, overrides),
  );
  return getTools(res);
}

/** The `_meta['anthropic/maxResultSizeChars']` the HTTP catalog actually serves for `name`. */
async function advertisedMaxChars(
  name: string,
  overrides: Partial<ProtocolHandlerDependencies> = {},
): Promise<unknown> {
  const tools = await listAllTools(overrides);
  return tools.find((t) => t.name === name)?._meta?.[
    'anthropic/maxResultSizeChars'
  ];
}

// ---------------------------------------------------------------------------
// Independent budget pins (r1 defect 3): literal numbers, not values read
// back out of production and then used to grade production.
// ---------------------------------------------------------------------------

describe('independently pinned budgets (TASK_2026_559 Batch 21 r1, defect 3)', () => {
  it('the default budget is 2,000 tokens / 8,000 chars (User Decision 2)', () => {
    expect(DEFAULT_TOOL_RESULT_BUDGET_TOKENS).toBe(2000);
    expect(DEFAULT_TOOL_RESULT_BUDGET_CHARS).toBe(8000);
  });

  it('documented per-tool overrides match their stated formulas', () => {
    // `ptah_browser_content`: 32 KiB page cap + 1 KiB for the Markdown
    // wrapper (tool-result-budget.ts `BROWSER_CONTENT_CHARS`).
    const browserContentChars = 32 * 1024 + 1024;
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_browser_content'].chars).toBe(
      browserContentChars,
    );
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_browser_content'].tokens).toBe(
      Math.ceil(browserContentChars / 4),
    );
    // `ptah_session_read`: the default 32 KiB transcript tail + the default
    // budget (tool-result-budget.ts `SESSION_READ_CHARS`, TASK_2026_584 F2).
    const sessionReadChars = 32 * 1024 + 8000;
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_session_read'].chars).toBe(
      sessionReadChars,
    );
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_session_read'].tokens).toBe(
      Math.ceil(sessionReadChars / 4),
    );
    // `ptah_surface_get_state`: the surface catalog's `maxStateReadBytes`.
    const surfaceStateChars = 548 * 1024;
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_surface_get_state'].chars).toBe(
      surfaceStateChars,
    );
    expect(TOOL_RESULT_BUDGET_OVERRIDES['ptah_surface_get_state'].tokens).toBe(
      Math.ceil(surfaceStateChars / 4),
    );
  });
});

// ---------------------------------------------------------------------------
// Coverage matrix (r1 Blocking defect 1): every host configuration, every
// caller kind, the stdio catalog, and execute_code.
// ---------------------------------------------------------------------------

describe('coverage matrix — served tools across host, caller and transport (defect 1)', () => {
  it('HTTP with IDE capabilities serves 61 identically-named tools across every caller kind', async () => {
    const deps = buildDeps({}, { hasIDECapabilities: true });
    const callers: Array<Partial<MCPRequest>> = [
      {},
      { _callerAgentId: 'agent-7' },
      { _callerSessionId: 'session-7' },
      { _callerWorkspaceRoot: '/fixture/workspace' },
    ];
    const namesPerCaller = await Promise.all(
      callers.map(async (c) =>
        getToolNames(
          await handleMCPRequest(
            makeRequest({ id: 'l', method: 'tools/list', ...c }),
            deps,
          ),
        ),
      ),
    );
    for (const names of namesPerCaller.slice(1)) {
      expect(names).toEqual(namesPerCaller[0]);
    }
    // Pinned at this HEAD (2026-09-27): update deliberately if the served
    // set legitimately changes. 56 -> 61: the five ptah_session_* tools
    // (TASK_2026_584).
    expect(namesPerCaller[0]).toHaveLength(61);
  });

  it('HTTP without IDE capabilities serves 58 tools, identically across caller kinds, minus exactly the 3 IDE-gated tools', async () => {
    const deps = buildDeps({}, { hasIDECapabilities: false });
    const callers: Array<Partial<MCPRequest>> = [
      {},
      { _callerAgentId: 'agent-7' },
      { _callerSessionId: 'session-7' },
      { _callerWorkspaceRoot: '/fixture/workspace' },
    ];
    const namesPerCaller = await Promise.all(
      callers.map(async (c) =>
        getToolNames(
          await handleMCPRequest(
            makeRequest({ id: 'l', method: 'tools/list', ...c }),
            deps,
          ),
        ),
      ),
    );
    for (const names of namesPerCaller.slice(1)) {
      expect(names).toEqual(namesPerCaller[0]);
    }
    expect(namesPerCaller[0]).toHaveLength(58);
    for (const ideOnly of [
      'ptah_lsp_references',
      'ptah_lsp_definitions',
      'ptah_get_dirty_files',
    ]) {
      expect(namesPerCaller[0]).not.toContain(ideOnly);
    }
  });

  it('every tool served in either HTTP configuration has a registered driver (or is explicitly excluded)', async () => {
    const ideNames = await listAllTools({ hasIDECapabilities: true }).then(
      (t) => t.map((x) => x.name),
    );
    const nonIdeNames = await listAllTools({ hasIDECapabilities: false }).then(
      (t) => t.map((x) => x.name),
    );
    const served = new Set([...ideNames, ...nonIdeNames]);
    const missing = [...served].filter(
      (name) => !(name in CONTROL_TOOL_EXCEPTIONS) && !TOOL_DRIVERS[name],
    );
    expect(missing).toEqual([]);
    // Every named exception is a tool actually served (a stale exception
    // entry would otherwise hide nothing and mislead).
    for (const excepted of Object.keys(CONTROL_TOOL_EXCEPTIONS)) {
      expect(served.has(excepted)).toBe(true);
    }
  });

  it('the stdio MCP server advertises exactly its 8 documented tool names', () => {
    expect([...MCP_MVP_TOOL_NAMES]).toEqual([
      'agent_spawn',
      'agent_status',
      'agent_read',
      'agent_message',
      'agent_report',
      'agent_stop',
      'agent_list',
      'session_submit',
    ]);
    // `AgentToolDispatcher` owns 7 of the 8; `session_submit` is dispatched
    // elsewhere (a composite harness trigger, not this contract's concern —
    // see the stdio describe block below).
    expect(AgentToolDispatcher.TOOL_NAMES).toHaveLength(7);
    expect(AgentToolDispatcher.TOOL_NAMES).not.toContain('session_submit');
  });
});

// ---------------------------------------------------------------------------
// The main sweep — every HTTP-served, text-returning tool.
// ---------------------------------------------------------------------------

describe('MCP dispatcher contract sweep (TASK_2026_559 Batch 21, Task 21.1)', () => {
  let budgetSpy: jest.SpyInstance;

  beforeEach(() => {
    budgetSpy = jest.spyOn(ToolResultBudgetModule, 'applyToolResultBudget');
  });

  afterEach(() => {
    budgetSpy.mockRestore();
  });

  /**
   * Runs the full universal contract against every tool `tools/list` serves
   * under `hostConfig` AND the caller identity `requestExtra` — listed and
   * called under the same identity (r3 R3-03). Every served tool is executed
   * except the named {@link CONTROL_TOOL_EXCEPTIONS}; the executed set is
   * checked against that at the end. Every budgeted result is graded by the
   * one shared {@link budgetContractFailures}. Returns the failure list
   * instead of asserting, so one implementation serves every matrix cell.
   */
  async function sweepAllTools(
    hostConfig: Partial<ProtocolHandlerDependencies>,
    requestExtra: Partial<MCPRequest> = {},
  ): Promise<string[]> {
    const tools = await listAllTools(hostConfig, requestExtra);
    const failures: string[] = [];
    const executed = new Set<string>();

    for (const tool of tools) {
      if (tool.name in CONTROL_TOOL_EXCEPTIONS) {
        continue;
      }
      const driver = TOOL_DRIVERS[tool.name];
      if (!driver) {
        failures.push(missingDriverMessage(tool.name));
        continue;
      }

      const marker = `MARK-${tool.name}`;
      const api: any = {};
      driver.mock(api, marker);
      const deps = buildDeps(api, hostConfig);
      const args = resolveArgs(driver, marker);
      const before = budgetSpy.mock.calls.length;
      const spoolBefore = snapshotSpoolFiles();

      executed.add(tool.name);
      const res = await handleMCPRequest(
        makeRequest({
          id: `sweep-${tool.name}`,
          method: 'tools/call',
          params: { name: tool.name, arguments: args },
          ...requestExtra,
          ...driver.requestExtra,
        }),
        deps,
      );

      // Success FIRST (r1 defect 2): an isError/JSON-RPC-error response is
      // a broken fixture, not coverage, however small its text is.
      if (isErrorResult(res)) {
        failures.push(
          `${tool.name}: call did not succeed (${res.error ? `JSON-RPC error: ${res.error.message}` : 'isError result'})`,
        );
        continue;
      }

      if (tool.name === 'ptah_browser_screenshot') {
        // The oversized `data` goes out as a separate `image` block (never
        // text — `protocol-dispatcher.ts` builds `{ type: 'image', data,
        // mimeType }`), so it is correctly never reduced/spooled/trailed.
        // Its text caption(s) — ALL text blocks, not just the first (r3
        // R3-02) — still get the pinned ceiling (r2 R2-04: a caption that
        // duplicated the base64 must fail).
        const pin = pinnedBudget(tool.name);
        const blocks = textBlocksOf(res.result);
        const chars = blocks.reduce((n, b) => n + b.length, 0);
        const tokens = blocks.reduce((n, b) => n + countTokensPiecewise(b), 0);
        if (blocks.length === 0) {
          failures.push('ptah_browser_screenshot: no text caption block');
        }
        if (chars > pin.chars || tokens > pin.tokens) {
          failures.push(
            `ptah_browser_screenshot: text blocks total ${chars} chars / ${tokens} tokens, pinned ceiling is ${pin.chars} / ${pin.tokens}`,
          );
        }
        if (tool._meta?.['anthropic/maxResultSizeChars'] !== pin.chars) {
          failures.push(
            `ptah_browser_screenshot: advertises maxResultSizeChars=${String(tool._meta?.['anthropic/maxResultSizeChars'])}, pinned value is ${pin.chars}`,
          );
        }
        const result = res.result as
          { content?: Array<{ type: string; data?: string }> } | undefined;
        const image = result?.content?.find((c) => c.type === 'image');
        if (!image) {
          failures.push(
            'ptah_browser_screenshot: expected an image content block',
          );
        } else if (image.data !== filler(200000, 'A')) {
          failures.push(
            'ptah_browser_screenshot: image data does not match the source bytes exactly',
          );
        }
        continue;
      }

      if (OWN_WINDOWING_TOOLS.has(tool.name)) {
        // These pre-fit their own output (dedicated page/continuation/spool
        // tests below). Here: every text block together within the pinned
        // ceiling, the advertised pin, the marker, and NO outer trailer
        // (their own view already fits, so the budget layer must not cut).
        const pin = pinnedBudget(tool.name);
        const blocks = textBlocksOf(res.result);
        const joined = blocks.join('\n');
        const chars = blocks.reduce((n, b) => n + b.length, 0);
        const tokens = blocks.reduce((n, b) => n + countTokensPiecewise(b), 0);
        if (chars > pin.chars || tokens > pin.tokens) {
          failures.push(
            `${tool.name}: text blocks total ${chars} chars / ${tokens} tokens, pinned ceiling is ${pin.chars} / ${pin.tokens}`,
          );
        }
        if (tool._meta?.['anthropic/maxResultSizeChars'] !== pin.chars) {
          failures.push(
            `${tool.name}: advertises maxResultSizeChars=${String(tool._meta?.['anthropic/maxResultSizeChars'])}, pinned value is ${pin.chars}`,
          );
        }
        if (!joined.includes(marker)) {
          failures.push(`${tool.name}: marker missing from its own page`);
        }
        if (BUDGET_TRAILER.test(joined)) {
          failures.push(
            `${tool.name}: own-windowing page was cut again by the budget layer`,
          );
        }
        continue;
      }

      const raw = capturedRaw(budgetSpy, before, tool.name);
      if (raw !== undefined && !raw.includes(marker)) {
        failures.push(
          `${tool.name}: driver bug — marker missing from the raw payload itself`,
        );
      }
      failures.push(
        ...budgetContractFailures({
          budgetName: tool.name,
          result: res.result,
          raw,
          advertisedMaxChars: tool._meta?.['anthropic/maxResultSizeChars'],
          marker,
          spoolBefore,
        }),
      );
    }

    // Executed set == listed set minus exactly the named exceptions.
    const expected = tools
      .map((t) => t.name)
      .filter((n) => !(n in CONTROL_TOOL_EXCEPTIONS))
      .sort();
    const actual = [...executed].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `executed tools differ from listed tools minus control exceptions: ` +
          `not executed [${expected.filter((n) => !executed.has(n)).join(', ')}]`,
      );
    }
    if (tools.length === 0) {
      failures.push('tools/list returned no tools for this configuration');
    }

    return failures;
  }

  it(
    'HTTP, IDE capabilities, anonymous caller: every tool succeeds, stays within its declared ' +
      'TOKEN budget, and — where the generic budget layer runs — names its reducer, spools ' +
      'byte-equal raw text, and keeps its marker',
    async () => {
      const failures = await sweepAllTools({
        hasIDECapabilities: true,
        hasSqliteLayer: true,
      });
      expect(failures).toEqual([]);
    },
    30_000,
  );

  it(
    'HTTP, NO IDE capabilities, anonymous caller: every one of the 52 non-IDE-gated, non-control tools ' +
      'passes the same full contract (r2 Blocking 1 — the host variant was previously only ' +
      'counted, never executed)',
    async () => {
      const failures = await sweepAllTools({
        hasIDECapabilities: false,
        hasSqliteLayer: true,
      });
      expect(failures).toEqual([]);
    },
    30_000,
  );

  it(
    'HTTP, IDE capabilities, WORKSPACE caller: every tool passes the same full contract under ' +
      'a declared caller workspace root (the one caller-kind field the generic dispatch path ' +
      'itself reads — `resolveSpoolRoot`)',
    async () => {
      const failures = await sweepAllTools(
        { hasIDECapabilities: true, hasSqliteLayer: true },
        { _callerWorkspaceRoot: 'not-a-known-workspace-folder' },
      );
      expect(failures).toEqual([]);
    },
    30_000,
  );

  it('HTTP, IDE capabilities, AGENT caller: every tool passes the same full contract', async () => {
    const failures = await sweepAllTools(
      { hasIDECapabilities: true, hasSqliteLayer: true },
      { _callerAgentId: 'matrix-agent-1' },
    );
    expect(failures).toEqual([]);
  }, 30_000);

  it('HTTP, IDE capabilities, SESSION caller: every tool passes the same full contract', async () => {
    const failures = await sweepAllTools(
      { hasIDECapabilities: true, hasSqliteLayer: true },
      { _callerSessionId: 'matrix-session-1' },
    );
    expect(failures).toEqual([]);
  }, 30_000);

  // r3 R3-03: the remaining 11 cells of the 2 (IDE) × 2 (SQLite) × 4 (caller)
  // host/caller matrix, each a FULL execution pass (list and call under the
  // same identity), not a catalog count. The five cells above keep their
  // existing titles (the mandate manifest references the first by name).
  const MATRIX_CALLERS: ReadonlyArray<[string, Partial<MCPRequest>]> = [
    ['anonymous', {}],
    ['agent', { _callerAgentId: 'matrix-agent-1' }],
    ['session', { _callerSessionId: 'matrix-session-1' }],
    ['workspace', { _callerWorkspaceRoot: 'not-a-known-workspace-folder' }],
  ];
  const COVERED_ABOVE = new Set([
    'ide=true sqlite=true anonymous',
    'ide=false sqlite=true anonymous',
    'ide=true sqlite=true workspace',
    'ide=true sqlite=true agent',
    'ide=true sqlite=true session',
  ]);
  const REMAINING_MATRIX_CELLS = [true, false]
    .flatMap((ide) =>
      [true, false].flatMap((sqlite) =>
        MATRIX_CALLERS.map(
          ([caller, extra]) =>
            [`ide=${ide} sqlite=${sqlite} ${caller}`, ide, sqlite, extra] as [
              string,
              boolean,
              boolean,
              Partial<MCPRequest>,
            ],
        ),
      ),
    )
    .filter(([label]) => !COVERED_ABOVE.has(label));

  it('the remaining host/caller matrix is exactly the 11 cells not executed above', () => {
    expect(REMAINING_MATRIX_CELLS.map(([label]) => label)).toEqual([
      'ide=true sqlite=false anonymous',
      'ide=true sqlite=false agent',
      'ide=true sqlite=false session',
      'ide=true sqlite=false workspace',
      'ide=false sqlite=true agent',
      'ide=false sqlite=true session',
      'ide=false sqlite=true workspace',
      'ide=false sqlite=false anonymous',
      'ide=false sqlite=false agent',
      'ide=false sqlite=false session',
      'ide=false sqlite=false workspace',
    ]);
  });

  it.each(REMAINING_MATRIX_CELLS)(
    'HTTP matrix cell %s: every listed tool is executed under that identity and passes the full contract',
    async (_label, ide, sqlite, extra) => {
      const failures = await sweepAllTools(
        { hasIDECapabilities: ide, hasSqliteLayer: sqlite },
        extra,
      );
      expect(failures).toEqual([]);
    },
    30_000,
  );

  it('keeps every tool description within its OWN per-tool budget (defect 9)', async () => {
    // A per-tool regression pin (measured at this HEAD, 2026-09-27,
    // ceil(length * 1.1) + 10), not one shared ceiling: r1 found a single
    // global maximum lets any tool below it grow unnoticed. A brand-new tool
    // with no entry here fails explicitly, rather than inheriting a generous
    // default that would hide its own growth.
    const DESCRIPTION_BUDGETS: Readonly<Record<string, number>> = {
      ptah_surface_update: 4956,
      ptah_harness_search_mcp_registry: 2450,
      ptah_harness_search_skills: 2354,
      ptah_harness_propose_config: 2069,
      ptah_surface_get_state: 1912,
      ptah_agent_spawn: 1568,
      ptah_harness_create_skill: 1507,
      ptah_context_enrich_file: 1175,
      ptah_get_symbol_index: 1048,
      ptah_task_list: 830,
      // TASK_2026_584 F3, measured 2026-10-01: 828 chars (+ the child
      // session sentence); ceil(828 * 1.1) + 10.
      ptah_agent_report: 921,
      ptah_harness_install_mcp_server: 780,
      // +12 (Batch 33): the registry graphEdges list gained ", python, go".
      ptah_get_dependents: 734,
      // Pre-24b budget restored (Batch 24c fix round, review r1 on ruling
      // R2): the shortened text measures 699 chars (2026-09-27) and still
      // carries every required item (coverage legend, both registry lists,
      // the Batch 24d kinds, the code-index / export-index distinction),
      // asserted item by item in tool-description.builder.spec.ts.
      // +12 (Batch 33): the registry publicSymbols list gained ", python, go".
      ptah_code_search_symbols: 714,
      // +12 (Batch 33): the registry graphEdges list gained ", python, go".
      ptah_get_dependencies: 701,
      ptah_dashboard_propose_spec: 671,
      ptah_lsp_definitions: 639,
      ptah_task_update: 635,
      ptah_agent_message: 591,
      execute_code: 567,
      ptah_agent_read: 553,
      // Pre-24b budget restored (Batch 24c fix round, review r1 on ruling
      // R2): measured 524 chars (2026-09-27) with every required item kept
      // (asserted item by item in tool-description.builder.spec.ts).
      ptah_code_reindex: 536,
      ptah_get_diagnostics: 535,
      ptah_lsp_references: 529,
      ptah_web_search: 506,
      // +12 (Batch 33): the registry publicSymbols list gained ", python, go".
      ptah_ast_analyze: 515,
      ptah_task_create: 498,
      ptah_agent_status: 445,
      ptah_memory_search: 438,
      ptah_json_validate: 395,
      ptah_browser_navigate: 384,
      ptah_task_check: 371,
      ptah_browser_screenshot: 354,
      ptah_harness_list_installed_mcp: 354,
      ptah_project_detect_monorepo: 320,
      ptah_browser_status: 272,
      ptah_relevance_rank_files: 267,
      ptah_browser_evaluate: 266,
      ptah_browser_record_start: 244,
      ptah_task_get: 243,
      ptah_count_tokens: 239,
      ptah_browser_network: 238,
      ptah_search_files: 228,
      approval_prompt: 224,
      ptah_browser_content: 222,
      ptah_workspace_analyze: 217,
      ptah_agent_list: 216,
      ptah_browser_click: 194,
      ptah_git_worktree_add: 178,
      ptah_get_dirty_files: 174,
      ptah_browser_record_stop: 174,
      ptah_browser_type: 172,
      ptah_browser_close: 166,
      ptah_agent_stop: 162,
      ptah_git_worktree_list: 156,
      ptah_git_worktree_remove: 144,
      // TASK_2026_584, measured 2026-10-01: 885, 539, 426, 274, 275 chars.
      ptah_session_start: 984,
      ptah_session_send: 603,
      ptah_session_status: 479,
      ptah_session_read: 312,
      ptah_session_stop: 313,
    };
    const tools = await listAllTools();
    const violations: string[] = [];
    for (const tool of tools) {
      const budget = DESCRIPTION_BUDGETS[tool.name];
      if (budget === undefined) {
        violations.push(
          `${tool.name}: no per-tool description budget entry — add one (measured length + 10%)`,
        );
        continue;
      }
      if (tool.description.length > budget) {
        violations.push(
          `${tool.name}: description is ${tool.description.length} chars, budget is ${budget}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('pins the total tools/list JSON size and byte-stability across caller kinds', async () => {
    const deps = buildDeps({});
    const callers: Array<Partial<MCPRequest>> = [
      {},
      { _callerAgentId: 'agent-7' },
      { _callerSessionId: 'session-7' },
      { _callerWorkspaceRoot: '/fixture/workspace' },
    ];
    const payloads = await Promise.all(
      callers.map(async (overrides) => {
        const res = await handleMCPRequest(
          makeRequest({ id: 'list', method: 'tools/list', ...overrides }),
          deps,
        );
        return JSON.stringify(res.result);
      }),
    );
    for (const payload of payloads.slice(1)) {
      expect(payload).toBe(payloads[0]);
    }
    // Pinned at this HEAD (2026-09-27), measured 125,374 bytes, + 5%
    // headroom, per Task 21.1. A tool added or removed, or a description
    // that grows, moves this number — update the pin deliberately, do not
    // silence the assertion. TASK_2026_584 (2026-10-01): the five
    // ptah_session_* tools moved it to 130,357 bytes; follow-ups F2/F3
    // (measured 2026-10-01) to 130,469: +111 for the ptah_agent_report
    // child-session sentence, +1 for ptah_session_read's 40768-char
    // maxResultSizeChars.
    const PINNED_TOOLS_LIST_BYTES_AT_HEAD = 130_469;
    const bytes = Buffer.byteLength(payloads[0], 'utf8');
    expect(bytes).toBeLessThanOrEqual(
      Math.ceil(PINNED_TOOLS_LIST_BYTES_AT_HEAD * 1.05),
    );
  });

  it('declares a maxResultSizeChars budget on every tool except approval_prompt, equal to its independently pinned value', async () => {
    // r3 R3-02: `typeof number` let a declared 1 (or 10^9) pass while the
    // 8,000-char implementation stayed unchanged. Compare to the literal pin.
    const mismatches: string[] = [];
    for (const ide of [true, false]) {
      const tools = await listAllTools({ hasIDECapabilities: ide });
      for (const tool of tools) {
        const declared = tool._meta?.['anthropic/maxResultSizeChars'];
        if (tool.name === 'approval_prompt') {
          if (declared !== undefined) {
            mismatches.push(`approval_prompt declares ${String(declared)}`);
          }
          continue;
        }
        const pinned = pinnedBudget(tool.name).chars;
        if (declared !== pinned) {
          mismatches.push(
            `${tool.name} (ide=${ide}): declares ${String(declared)}, pinned ${pinned}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // -- Dedicated tests for the "own pre-fit windowing" tools and the two
  // preformatted/HTML shapes that need semantic (not just size) checks. Each
  // asserts its OWN recovery route byte-for-byte (r3 R3-02), not merely a
  // bounded prefix holding the first marker.

  it('ptah_get_symbol_index (own windowing): the largest fitting page, exact source entries, and a nextOffset that continues without gap or overlap', async () => {
    const marker = 'MARK-ptah_get_symbol_index-dedicated';
    const all = Array.from({ length: 2000 }, (_, i) => ({
      file: i === 0 ? `/fixture/${marker}.ts` : `/fixture/src/file_${i}.ts`,
      symbols: [`sym_${i}`],
    }));
    const api: any = {
      workspace: { getInfo: async () => ({ path: undefined }) },
      dependencies: {
        // Honors the paging query, like the real index, so the continuation
        // can be followed.
        getSymbolIndex: async (
          _root: unknown,
          q: { offset: number; limit: number },
        ) => {
          const files = all.slice(q.offset, q.offset + q.limit);
          return {
            files,
            count: files.length,
            total: all.length,
            offset: q.offset,
          };
        },
        getGraphCoverage: async () => ({ coverage: CLEAN_COVERAGE }),
      },
    };
    const call = async (offset: number): Promise<string> => {
      const res = await handleMCPRequest(
        makeRequest({
          id: `symbol-index-${offset}`,
          method: 'tools/call',
          params: {
            name: 'ptah_get_symbol_index',
            arguments: { offset, limit: 1000 },
          },
        }),
        buildDeps(api),
      );
      expect(isErrorResult(res)).toBe(false);
      return textOf(res);
    };
    interface Page {
      count: number;
      total: number;
      offset: number;
      nextOffset?: number;
      files: Array<{ file: string; symbols: string[] }>;
    }
    const pin = pinnedBudget('ptah_get_symbol_index');
    expect(await advertisedMaxChars('ptah_get_symbol_index')).toBe(pin.chars);

    const firstText = await call(0);
    expect(firstText.length).toBeLessThanOrEqual(pin.chars);
    expect(countTokensPiecewise(firstText)).toBeLessThanOrEqual(pin.tokens);
    expect(BUDGET_TRAILER.test(firstText)).toBe(false);
    const first = JSON.parse(firstText) as Page;
    expect(first.total).toBe(2000);
    expect(first.offset).toBe(0);
    expect(first.count).toBe(first.files.length);
    expect(first.count).toBeGreaterThan(0);
    expect(first.count).toBeLessThan(1000);
    expect(first.nextOffset).toBe(first.count);
    // Exactly the source entries, in order — nothing altered or dropped.
    expect(first.files).toEqual(all.slice(0, first.count));
    expect(first.files[0].file).toContain(marker);
    // The page is the LARGEST that fits: one more entry is over the pin.
    const oneMore = JSON.stringify({
      ...first,
      count: first.count + 1,
      nextOffset: first.count + 1,
      files: all.slice(0, first.count + 1),
    });
    expect(
      oneMore.length > pin.chars || countTokensPiecewise(oneMore) > pin.tokens,
    ).toBe(true);

    // Following nextOffset continues exactly where the first page stopped.
    const second = JSON.parse(await call(first.nextOffset ?? -1)) as Page;
    expect(second.offset).toBe(first.count);
    expect(second.files[0]).toEqual(all[first.count]);
    expect(second.files).toEqual(
      all.slice(first.count, first.count + second.count),
    );
  });

  it('ptah_agent_read (own windowing): exact first lines, a correct paging notice, and the printed window file byte-equal to the source', async () => {
    const marker = 'MARK-ptah_agent_read-dedicated';
    const { lines, output } = agentReadFixture(marker);
    const api: any = { agent: { read: async () => output } };
    expect(await advertisedMaxChars('ptah_agent_read')).toBe(
      PINNED_DEFAULT_BUDGET.chars,
    );
    const res = await handleMCPRequest(
      makeRequest({
        id: 'agent-read-dedicated',
        method: 'tools/call',
        params: {
          name: 'ptah_agent_read',
          arguments: { agentId: 'agent-1', offset: 0 },
        },
      }),
      buildDeps(api),
    );
    expect(isErrorResult(res)).toBe(false);
    expectAgentReadPage(textOf(res), lines, marker);
  });

  it('ptah_browser_evaluate (own windowing): the kept JSON prefix, an exact dropped count, and the printed full-value file byte-equal to the value', async () => {
    const marker = 'MARK-ptah_browser_evaluate-dedicated';
    const value = { marker, big: filler(280000, 'v') };
    const api: any = {
      browser: { evaluate: async () => ({ type: 'object', value }) },
    };
    const pin = pinnedBudget('ptah_browser_evaluate');
    expect(await advertisedMaxChars('ptah_browser_evaluate')).toBe(pin.chars);
    const res = await handleMCPRequest(
      makeRequest({
        id: 'browser-evaluate-dedicated',
        method: 'tools/call',
        params: {
          name: 'ptah_browser_evaluate',
          arguments: { expression: '1+1' },
        },
      }),
      buildDeps(api),
    );
    expect(isErrorResult(res)).toBe(false);
    const text = textOf(res);
    expect(text.length).toBeLessThanOrEqual(pin.chars);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(pin.tokens);
    expect(BUDGET_TRAILER.test(text)).toBe(false);
    expect(text).toContain(marker);
    // The value exactly as the tool renders it (pretty JSON, 2 spaces).
    const valueStr = JSON.stringify(value, null, 2);
    const trailer =
      /\[\.\.\.truncated: (\d+) more chars; full value: (.+?) — for page content use ptah_browser_content with a selector\]/.exec(
        text,
      );
    expect(trailer).not.toBeNull();
    if (!trailer) return;
    const dropped = Number(trailer[1]);
    const kept = valueStr.length - dropped;
    expect(kept).toBeGreaterThan(0);
    expect(text).toContain(`${valueStr.slice(0, kept)}\n\n[...truncated:`);
    expect(path.dirname(trailer[2])).toBe(spoolDirPath());
    expect(fs.readFileSync(trailer[2])).toEqual(Buffer.from(valueStr, 'utf8'));
  });

  it('ptah_browser_content over budget (Batch 21p): the article title survives through the real dispatcher, html-extract named, spool byte-equal', async () => {
    const marker = 'MARK-browser-content-dispatcher';
    const api: any = {};
    TOOL_DRIVERS['ptah_browser_content'].mock(api, marker);
    const spoolBefore = snapshotSpoolFiles();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'browser-content-dispatcher',
        method: 'tools/call',
        params: { name: 'ptah_browser_content', arguments: {} },
      }),
      buildDeps(api),
    );
    expect(isErrorResult(res)).toBe(false);
    const text = textOf(res);
    expect(text).toMatch(/\[reduced: html-extract\b/);
    const html =
      `<html><body><article><h1>${marker}</h1>` +
      `<p>${filler(60000, 'h')}</p></article></body></html>`;
    const raw = capturedRaw(budgetSpy, 0, 'ptah_browser_content');
    // Byte-equal to the RAW page HTML (Batch 21p: the uncut capture, not the
    // 32 KiB formatter copy), read through the locator the text prints.
    expect(raw).toBe(html);
    expect(
      budgetContractFailures({
        budgetName: 'ptah_browser_content',
        result: res.result,
        raw,
        advertisedMaxChars: await advertisedMaxChars('ptah_browser_content'),
        marker,
        spoolBefore,
      }),
    ).toEqual([]);
  });

  it("ptah_get_diagnostics is NOT reduced (preformatted) — reducer none, and the requested file's FULL diagnostic message survives verbatim up to the cut", async () => {
    expect(TOOL_CONTENT_HINTS['ptah_get_diagnostics']).toBe('preformatted');
    const marker = 'MARK-diagnostics-preformatted';
    const api: any = {};
    TOOL_DRIVERS['ptah_get_diagnostics'].mock(api, marker);
    const spoolBefore = snapshotSpoolFiles();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'diagnostics-preformatted',
        method: 'tools/call',
        params: { name: 'ptah_get_diagnostics', arguments: {} },
      }),
      buildDeps(api),
    );
    expect(isErrorResult(res)).toBe(false);
    const text = textOf(res);
    // The requested file's own diagnostic, its WHOLE message (r3 R3-02 — not
    // just marker/filename/heading), is never dropped by the display cap.
    expect(text).toContain('Requested files');
    expect(text).toContain('file_0.ts:1:1');
    expect(text).toContain(`${marker} ${filler(200, 'm')}`);
    expect(BUDGET_TRAILER.exec(text)?.[1]).toBe('none');
    expect(
      budgetContractFailures({
        budgetName: 'ptah_get_diagnostics',
        result: res.result,
        raw: capturedRaw(budgetSpy, 0, 'ptah_get_diagnostics'),
        advertisedMaxChars: await advertisedMaxChars('ptah_get_diagnostics'),
        marker,
        spoolBefore,
      }),
    ).toEqual([]);
  });

  // -- R3-01: below the Markdown outline cap. The drivers above size their
  // single-block fields past MAX_OUTLINE_CHARS (262,144), where the outline
  // reducer declines to lex and a plain prefix cut keeps the marker. These
  // ~20 KB fixtures — real prose paragraphs and real table/list rows, the
  // size an ordinary oversized answer has — take the reducer path those
  // fixtures bypass. Decision 7 / batches.md Task 21.1 requires the planted
  // marker to survive INLINE; a tool that loses it here is a real product
  // regression and this test stays red until the product is fixed.
  it.each(Object.keys(BELOW_OUTLINE_CAP_DRIVERS))(
    'below the outline cap (~20 KB real prose/table): %s keeps its marker inline and passes the full budget contract',
    async (toolName) => {
      const driver = BELOW_OUTLINE_CAP_DRIVERS[toolName];
      const marker = `MARK-below-cap-${toolName}`;
      const api: any = {};
      driver.mock(api, marker);
      const spoolBefore = snapshotSpoolFiles();
      const res = await handleMCPRequest(
        makeRequest({
          id: `below-cap-${toolName}`,
          method: 'tools/call',
          params: { name: toolName, arguments: resolveArgs(driver, marker) },
          ...driver.requestExtra,
        }),
        buildDeps(api),
      );
      expect(isErrorResult(res)).toBe(false);
      const raw = capturedRaw(budgetSpy, 0, toolName);
      // The fixture really is in the band this test exists for.
      expect(raw).toBeDefined();
      expect(raw?.includes(marker)).toBe(true);
      expect(raw?.length ?? 0).toBeGreaterThan(PINNED_DEFAULT_BUDGET.chars);
      expect(raw?.length ?? Infinity).toBeLessThan(MARKDOWN_OUTLINE_CAP_CHARS);
      expect(
        budgetContractFailures({
          budgetName: toolName,
          result: res.result,
          raw,
          advertisedMaxChars: await advertisedMaxChars(toolName),
          marker,
          spoolBefore,
        }),
      ).toEqual([]);
    },
  );

  // Coverage-preserving reduction for tools that answer with a coverage/
  // status block (Decisions 18, 21, 22; Batch 24r `preserveKeys`, merged with
  // Lane H): the block survives the budget intact and first. The coverage is
  // qualified with `null` (unknown) counts — exactly what the JSON reducer
  // drops from any field it does not preserve. With `coverage` preserved the
  // reducer finds nothing to drop in this answer, so only the cut runs
  // (`none`) and the status block, coverage included, leads the text
  // verbatim. Fails before 24r: the reducer had no `preserveKeys`, dropped
  // the coverage nulls and reported `json-compact` (the control below).
  it('ptah_get_dependents over budget: the status block, compact coverage included (nulls too), survives verbatim and first', async () => {
    const marker = 'MARK-dependents-coverage-first';
    const coverage = withCoverageVerdict({
      ...CLEAN_FIELDS,
      analyzed: 2001,
      unsupported: 3,
      unrecognised: null,
      excluded: null,
      unsupportedByLanguage: { python: 3 },
      resolution: {
        external: 0,
        unresolvedInternal: null,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'partial',
      },
    });
    const compact = compactCoverage(coverage);
    expect(compact).toMatchObject({
      clean: false,
      unrecognised: null,
      excluded: null,
      resolution: { unresolvedInternal: null, context: 'partial' },
    });
    const api: any = {};
    TOOL_DRIVERS['ptah_get_dependents'].mock(api, marker);
    Object.assign(api.dependencies, graphFileStubs(coverage));
    const spoolBefore = snapshotSpoolFiles();
    const res = await handleMCPRequest(
      makeRequest({
        id: 'dependents-coverage-first',
        method: 'tools/call',
        params: {
          name: 'ptah_get_dependents',
          arguments: { file: '/fixture/a.ts' },
        },
      }),
      buildDeps(api),
    );
    expect(isErrorResult(res)).toBe(false);
    const raw = capturedRaw(budgetSpy, 0, 'ptah_get_dependents');
    // Production order: status fields, then coverage, then file and list.
    expect(
      raw?.startsWith(
        `{"count":2001,"fileInGraph":true,"coverage":${JSON.stringify(compact)},"file":"/fixture/a.ts","dependents":["/fixture/${marker}.ts",`,
      ),
    ).toBe(true);
    const text = textOf(res);
    expect(BUDGET_TRAILER.exec(text)?.[1]).toBe('none');
    expect(
      text.startsWith(
        `{"count":2001,"fileInGraph":true,"coverage":${JSON.stringify(compact)},"file":"/fixture/a.ts","dependents":["/fixture/${marker}.ts",`,
      ),
    ).toBe(true);
    // Control: the same reducer WITHOUT `preserveKeys` drops the unknowns.
    const unpreserved = reduceJson(raw ?? '', {
      budgetTokens: PINNED_DEFAULT_BUDGET.tokens,
      budgetChars: PINNED_DEFAULT_BUDGET.chars,
    });
    expect(unpreserved.reducer).toBe('json-compact');
    expect(unpreserved.text).not.toContain('"unrecognised":null');
    expect(
      budgetContractFailures({
        budgetName: 'ptah_get_dependents',
        result: res.result,
        raw,
        advertisedMaxChars: await advertisedMaxChars('ptah_get_dependents'),
        marker,
        spoolBefore,
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// execute_code — it IS budgeted like any other text result (r1 defect 1).
// ---------------------------------------------------------------------------

describe('execute_code result also goes through the budget layer (defect 1)', () => {
  it('an oversized sandboxed return value is cut, trailed, and its WHOLE value — tail included — is in the file the printed locator names', async () => {
    // The raw tail is what the reviewer (r3 R3-02) found unguarded: a bounded
    // prefix holding the head marker passed even with the tail lost.
    // `serializeResult` never cuts (Batch 30 r1 R30-01), so the raw text
    // production budgets is exactly this value.
    const head = 'MARK-execute_code-HEAD';
    const tail = 'MARK-execute_code-TAIL';
    const value = `${head}-${'x'.repeat(40000)}-${tail}`;
    const budgetSpy = jest.spyOn(
      ToolResultBudgetModule,
      'applyToolResultBudget',
    );
    try {
      const spoolBefore = snapshotSpoolFiles();
      const res = await handleMCPRequest(
        makeRequest({
          id: 'execute-code',
          method: 'tools/call',
          params: {
            name: 'execute_code',
            arguments: {
              code: `return '${head}-' + 'x'.repeat(40000) + '-${tail}';`,
            },
          },
        }),
        buildDeps({}),
      );
      expect(isErrorResult(res)).toBe(false);
      const raw = capturedRaw(budgetSpy, 0, 'execute_code');
      expect(raw).toBe(value);
      const text = textOf(res);
      expect(text).toContain(head);
      expect(text).not.toContain(tail);
      expect(
        budgetContractFailures({
          budgetName: 'execute_code',
          result: res.result,
          raw,
          advertisedMaxChars: await advertisedMaxChars('execute_code'),
          marker: head,
          spoolBefore,
        }),
      ).toEqual([]);
      // The tail is recoverable from exactly the file the text names.
      const where = BUDGET_TRAILER.exec(text)?.[4];
      expect(where).toBeDefined();
      const spooled = fs.readFileSync(
        resolvePrintedLocator(where ?? ''),
        'utf8',
      );
      expect(spooled.endsWith(`-${tail}`)).toBe(true);
      expect(spooled).toBe(value);
    } finally {
      budgetSpy.mockRestore();
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// The stdio MCP server (`ptah mcp-serve`) — previously entirely unswept.
// ---------------------------------------------------------------------------

describe('stdio MCP server tools (TASK_2026_559 Batch 21 r2: real served-catalog routing)', () => {
  // Routed through the REAL `StdioMcpServerService` (r2 R2-01: the r1 version
  // called `AgentToolDispatcher` directly and read `MCP_MVP_TOOL_NAMES`
  // rather than the actual served `tools/list` response). `apiBuilder.build()`
  // is synchronous per `stdio-mcp-server.service.ts:304` — a plain object
  // satisfies it, no DI container needed for direct construction.
  // The stdio spool root is the host process's working directory; point it at
  // this test's mkdtemp root so no stdio call spools into the repository's
  // own .ptah (fixture only — no assertion depends on it).
  let cwdSpy: jest.SpyInstance<string, []>;
  // Captures the raw text the stdio dispatcher feeds the shared budget layer,
  // the oracle for the byte-equal printed-locator check (r3 R3-02).
  let stdioBudgetSpy: jest.SpyInstance;
  beforeEach(() => {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(spoolRoot);
    stdioBudgetSpy = jest.spyOn(
      ToolResultBudgetModule,
      'applyToolResultBudget',
    );
  });
  afterEach(() => {
    stdioBudgetSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  /** `_meta['anthropic/maxResultSizeChars']` of `tool` in the REAL stdio catalog. */
  function stdioAdvertisedMaxChars(tool: string): unknown {
    const res = buildService({}).handleToolsList(callRequest('list'));
    const tools = (
      res.result as {
        tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
      }
    ).tools;
    return tools.find((t) => t.name === tool)?._meta?.[
      'anthropic/maxResultSizeChars'
    ];
  }

  /**
   * The same universal contract the HTTP sweep applies (r3 R3-02) — trailer,
   * known reducer (`none`: the agent tools are preformatted), printed
   * locator byte-equal to the raw text, advertised pin, all text blocks —
   * plus the host-consumed `structuredContent` held to the same pinned
   * ceiling as real serialized JSON (21q `bounded-structured-content.ts`).
   * Each test starts from a fresh mkdtemp spool root, so the "before"
   * listing is empty; a bounded structuredContent adds its own JSON spool.
   */
  function expectStdioBudgetContract(
    res: MCPResponse,
    tool: string,
    marker: string,
  ): void {
    const budgetName = `ptah_${tool}`;
    const result = res.result as { structuredContent?: unknown } | undefined;
    expect(result?.structuredContent).toBeDefined();
    const structuredJson = JSON.stringify(result?.structuredContent);
    expect(structuredJson.length).toBeLessThanOrEqual(
      PINNED_DEFAULT_BUDGET.chars,
    );
    expect(countTokensPiecewise(structuredJson)).toBeLessThanOrEqual(
      PINNED_DEFAULT_BUDGET.tokens,
    );
    const structuredSpooled =
      typeof result?.structuredContent === 'object' &&
      result.structuredContent !== null &&
      'ptah_truncation' in result.structuredContent;
    expect(
      budgetContractFailures({
        budgetName,
        result: res.result,
        raw: capturedRaw(stdioBudgetSpy, 0, budgetName),
        advertisedMaxChars: stdioAdvertisedMaxChars(tool),
        marker,
        spoolBefore: new Set(),
        maxNewSpoolFiles: structuredSpooled ? 2 : 1,
      }),
    ).toEqual([]);
  }

  function buildService(api: any): StdioMcpServerService {
    return new StdioMcpServerService(createMockLogger(), {
      build: () => api as PtahAPI,
    } as unknown as ConstructorParameters<typeof StdioMcpServerService>[1]);
  }

  function callRequest(id: string): MCPRequest {
    return { jsonrpc: '2.0', id, method: 'tools/call' };
  }

  function textOfStdio(res: MCPResponse): { text: string; isError: boolean } {
    const result = res.result as
      | { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined;
    return {
      text: result?.content?.find((c) => c.type === 'text')?.text ?? '',
      isError: result?.isError === true,
    };
  }

  it('the real served catalog is exactly the 8 documented tool names', () => {
    const service = buildService({});
    const res = service.handleToolsList(callRequest('list'));
    const names = (res.result as { tools: Array<{ name: string }> }).tools.map(
      (t) => t.name,
    );
    expect(names).toEqual([
      'agent_spawn',
      'agent_status',
      'agent_read',
      'agent_message',
      'agent_report',
      'agent_stop',
      'agent_list',
      'session_submit',
    ]);
  });

  it('agent_read keeps its own budget-fit page and the marker survives', async () => {
    const marker = 'MARK-stdio-agent_read';
    const { lines, output } = agentReadFixture(marker);
    const api: any = { agent: { read: async () => output } };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_read'),
      params: {
        name: 'agent_read',
        arguments: { agentId: 'agent-1', offset: 0 },
      },
    });
    const { text, isError } = textOfStdio(res);
    expect(isError).toBe(false);
    expect(text).toContain(marker);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
    );
    // r3 R3-02: its own page/continuation route, byte-level (all text blocks).
    expectAgentReadPage(textOf(res), lines, marker);
    expect(stdioAdvertisedMaxChars('agent_read')).toBe(
      PINNED_DEFAULT_BUDGET.chars,
    );
  });

  // r3 R3-01 on stdio: the ~20 KB below-outline-cap fixtures, through the
  // real `StdioMcpServerService`. 21q's `preformatted` hint for the agent
  // tools is what keeps these markers; this is its regression guard.
  it.each([
    'agent_spawn',
    'agent_message',
    'agent_report',
    'agent_stop',
    'agent_list',
  ])(
    'below the outline cap (~20 KB real prose/table): stdio %s keeps its marker inline and passes the full budget contract',
    async (tool) => {
      const driver = BELOW_OUTLINE_CAP_DRIVERS[`ptah_${tool}`];
      const marker = `MARK-stdio-below-cap-${tool}`;
      const api: any = {};
      driver.mock(api, marker);
      const previous = process.env['PTAH_MCP_HOST_AGENT_ID'];
      // Attributed caller for agent_report (see the agent_report test below).
      process.env['PTAH_MCP_HOST_AGENT_ID'] = 'agent-caller-1';
      try {
        const res = await buildService(api).handleToolsCall({
          ...callRequest(`below-cap-${tool}`),
          params: { name: tool, arguments: resolveArgs(driver, marker) },
        });
        const raw = capturedRaw(stdioBudgetSpy, 0, `ptah_${tool}`);
        expect(raw?.length ?? 0).toBeGreaterThan(PINNED_DEFAULT_BUDGET.chars);
        expect(raw?.length ?? Infinity).toBeLessThan(
          MARKDOWN_OUTLINE_CAP_CHARS,
        );
        expectStdioTextContract(res, marker);
        expectStdioBudgetContract(res, tool, marker);
      } finally {
        if (previous === undefined)
          delete process.env['PTAH_MCP_HOST_AGENT_ID'];
        else process.env['PTAH_MCP_HOST_AGENT_ID'] = previous;
      }
    },
  );

  /**
   * The real, required contract for the six stdio handlers that are NOT
   * `agent_read` — same shape as the HTTP surface's (r2: reasserted as a real
   * requirement, not "characterised" as an accepted gap; per the coordinator,
   * a production tool that fails this MUST make the sweep fail and be
   * reported, not be waived by asserting the current broken behaviour).
   */
  function expectStdioTextContract(res: MCPResponse, marker: string): void {
    const { text, isError } = textOfStdio(res);
    expect(isError).toBe(false);
    expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
    expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
      DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
    );
    expect(text).toContain(marker);
  }

  it('agent_spawn: real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_spawn';
    const api: any = {
      agent: {
        spawn: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'running',
          startedAt: `${marker}-${filler(280000, 's')}`,
          messagingMode: 'steer',
        }),
      },
    };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_spawn'),
      params: { name: 'agent_spawn', arguments: { task: 'x' } },
    });
    expectStdioTextContract(res, marker);
    expectStdioBudgetContract(res, 'agent_spawn', marker);
  });

  it('agent_status: real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_status';
    const api: any = {
      agent: {
        status: async () =>
          Array.from({ length: 400 }, (_, i) => ({
            agentId: i === 0 ? marker : `agent-${i}`,
            cli: 'claude',
            status: 'running',
            task: filler(200, 't'),
            startedAt: new Date(0).toISOString(),
            messagingMode: 'steer',
          })),
      },
    };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_status'),
      params: { name: 'agent_status', arguments: {} },
    });
    expectStdioTextContract(res, marker);
    expectStdioBudgetContract(res, 'agent_status', marker);
  });

  it('agent_message: real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_message';
    const api: any = {
      agent: {
        message: async () => ({
          mode: 'steer',
          detail: `${marker}-${filler(280000, 'e')}`,
        }),
      },
    };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_message'),
      params: {
        name: 'agent_message',
        arguments: { agentId: 'agent-1', message: 'hi' },
      },
    });
    expectStdioTextContract(res, marker);
    expectStdioBudgetContract(res, 'agent_message', marker);
  });

  it('agent_report (attributed): real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_report';
    const api: any = {
      agent: {
        report: async () => ({
          delivered: true,
          parentSessionId: `${marker}-${filler(280000, 'r')}`,
        }),
      },
    };
    // `callerAgentId` is a constructor-level fact on the real dispatcher
    // (`AgentToolDispatcher`'s 4th arg), not per-request; the service builds
    // its dispatcher lazily and does not expose that constructor arg, so an
    // attributed stdio caller is simulated with `PTAH_MCP_HOST_AGENT_ID`,
    // which `getAgentDispatcher()` reads at build time.
    const previous = process.env['PTAH_MCP_HOST_AGENT_ID'];
    process.env['PTAH_MCP_HOST_AGENT_ID'] = 'agent-caller-1';
    try {
      const res = await buildService(api).handleToolsCall({
        ...callRequest('agent_report'),
        params: { name: 'agent_report', arguments: { message: 'status' } },
      });
      expectStdioTextContract(res, marker);
      expectStdioBudgetContract(res, 'agent_report', marker);
    } finally {
      if (previous === undefined) delete process.env['PTAH_MCP_HOST_AGENT_ID'];
      else process.env['PTAH_MCP_HOST_AGENT_ID'] = previous;
    }
  });

  it('agent_stop: real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_stop';
    const api: any = {
      agent: {
        stop: async () => ({
          agentId: 'agent-1',
          cli: 'claude',
          status: 'stopped',
          cliSessionId: `${marker}-${filler(280000, 'c')}`,
        }),
      },
    };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_stop'),
      params: { name: 'agent_stop', arguments: { agentId: 'agent-1' } },
    });
    expectStdioTextContract(res, marker);
    expectStdioBudgetContract(res, 'agent_stop', marker);
  });

  it('agent_list: real contract (KNOWN PRODUCT DEFECT — see report if failing)', async () => {
    const marker = 'MARK-stdio-agent_list';
    const api: any = {
      agent: {
        list: async () =>
          Array.from({ length: 2000 }, (_, i) => ({
            cli: i === 0 ? marker : filler(200, 'c') + i,
            installed: true,
            messagingMode: 'steer',
            providerName: filler(80, 'p') + i,
          })),
        listRoles: async () => [],
      },
    };
    const res = await buildService(api).handleToolsCall({
      ...callRequest('agent_list'),
      params: { name: 'agent_list', arguments: {} },
    });
    expectStdioTextContract(res, marker);
    expectStdioBudgetContract(res, 'agent_list', marker);
  });

  it('session_submit: real routing to a fake handler succeeds; the aggregation cap itself lives outside this lib', async () => {
    // `session_submit`'s dispatcher (`ISessionSubmitHandler`) is implemented
    // in `apps/ptah-cli/src/services/mcp/session-submit.service.ts`, which
    // this lib cannot import (hexagonal boundary — the port lives in the lib,
    // the implementation in the app). This proves only the REAL stdio routing
    // reaches a registered handler unchanged. The oversized-result contract
    // (the 1 MiB aggregate cap and its `truncated: true` disclosure, driven
    // by a fake event source through the real service) is guarded in the
    // owning app — session-submit.service.spec.ts, mapped by exact title in
    // mcp-mandate-manifest.spec.ts (r3 R3-03).
    const marker = 'MARK-stdio-session_submit';
    const service = buildService({});
    const fakeResponse: MCPResponse = {
      jsonrpc: '2.0',
      id: 'session-submit-call',
      result: {
        content: [{ type: 'text', text: `${marker}-${filler(1000, 's')}` }],
      },
    };
    let receivedArgs: unknown;
    service.setSessionSubmitHandler({
      dispatch: async (_request, args) => {
        receivedArgs = args;
        return fakeResponse;
      },
      cancel: async () => undefined,
    });
    const res = await service.handleToolsCall({
      ...callRequest('session-submit-call'),
      params: { name: 'session_submit', arguments: { task: marker } },
    });
    expect(res).toBe(fakeResponse);
    expect(receivedArgs).toEqual({ task: marker });
  });

  it('session_submit before the handler is registered: a bounded, honest isError envelope, never a throw', async () => {
    const service = buildService({});
    const res = await service.handleToolsCall({
      ...callRequest('session-submit-unregistered'),
      params: { name: 'session_submit', arguments: { task: 'x' } },
    });
    const { isError } = textOfStdio(res);
    expect(isError).toBe(true);
  });
});
