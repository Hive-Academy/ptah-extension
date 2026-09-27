/**
 * Dispatcher-side language-honesty pins (TASK_2026_559 Batch 27, Task 27.3).
 *
 * `WIT/language-honesty.contract.spec.ts` (`workspace-intelligence`) proves
 * `honesty:ptah_ast_analyze`, `honesty:ptah_context_enrich_file`,
 * `honesty:ptah_get_dependents`, `honesty:ptah_get_dependencies`,
 * `honesty:ptah_code_search_symbols`, `honesty:ptah_get_symbol_index` and
 * `honesty:ptah_code_reindex` against the real workspace-intelligence
 * services. The remaining three honesty keys need collaborators that live in
 * THIS project (`vscode-lm-tools`) — `mcp-response-formatter.ts` and the
 * mandate manifest — so `workspace-intelligence` must not import them
 * (layering runs the other way: `vscode-lm-tools` depends on
 * `workspace-intelligence`, never the reverse). They are pinned here instead:
 *
 * - `honesty:ptah_get_diagnostics` — a mixed-language repo's clean-answer
 *   rule (Batch 25b), reusing `mcp-response-formatter.spec.ts`'s own
 *   `coverageWith` fixture style, applied to the ts-python-monorepo polyglot
 *   fixture's shape.
 * - `honesty:ptah_lsp_definitions` / `honesty:ptah_lsp_references` — an LSP
 *   report that is `truncated` or carries an unsupported/unknown language
 *   never renders a bare `Found: 0` (Batch 26a/26b "confident zero").
 *
 * Task 27.3's other requirement — "26b becomes the host guard for
 * `ptah_lsp_references`, its exemption removed" — is pinned in
 * `mcp-mandate-manifest.spec.ts` itself (that file already owns `MANDATE_MAP`
 * and is one of this task's listed files), not duplicated here.
 *
 * r1 review (reviews/batch-27-code-logic-review-r1.md R27-04) found this file
 * proved the honesty properties only at the formatter layer, never through
 * real dispatch/budget/spool, and found the mandate mapping (in
 * `mcp-mandate-manifest.spec.ts`) pointed at unrelated recall tests instead
 * of the actual truncation/confident-zero guards. The mapping is fixed in
 * `mcp-mandate-manifest.spec.ts` itself; this file adds a REAL
 * `handleMCPRequest` dispatch describe block below ("dispatcher/budget/spool
 * — building/failed/partial shapes") driving `ptah_get_dependents` through
 * warm, building and failed graph states and checking raw JSON spool
 * equality (the exact bytes returned, not a reduced/paraphrased body), plus
 * an `MCP_HONESTY_CHECKS` registry that — together with `workspace-
 * intelligence`'s `HONESTY_CHECKS` — closes the "every activated key
 * actually runs" loop (R27-01) across both projects.
 *
 * Batch 27 is a harness batch: it introduces no new MCP tool/capability
 * shape of its own (the grammar/graph batches, 29b onward, do), so
 * `mcp-contract.sweep.spec.ts`'s existing pins are read here (not modified)
 * to confirm this batch extends rather than loosens them (Decomposition note
 * D2). The batches that DO add shapes (29b+) extend this file and the sweep
 * together, each guarded by its own `matrix/activations/<batch>.ts` fragment.
 */

import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import {
  formatDiagnostics,
  formatLspDefinitions,
  formatLspReferences,
} from './mcp-response-formatter';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';
import {
  withCoverageVerdict,
  type CoverageFields,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

const CLEAN_TYPE_CHECK_FIELDS: CoverageFields = {
  supportedLanguages: ['typescript', 'javascript', 'tsx', 'python'],
  census: 'complete',
  analyzed: null,
  unchecked: 0,
  failed: 0,
  unsupported: 0,
  unrecognised: 0,
  nonSource: 0,
  excluded: null,
  omittedByCap: 0,
  checks: 'type-check',
};

function coverageWith(fields: Partial<CoverageFields>): LanguageCoverage {
  return withCoverageVerdict({ ...CLEAN_TYPE_CHECK_FIELDS, ...fields });
}

describe('honesty:ptah_get_diagnostics (Batch 25b, on the ts-python-monorepo polyglot shape)', () => {
  it('never renders a bare "No issues found" for the ts+python monorepo fixture (2 python files unchecked)', () => {
    const out = formatDiagnostics({
      status: 'available',
      source: 'typescript-compiler',
      coverage: coverageWith({ unchecked: 2 }),
      notChecked: [
        {
          language: 'python',
          count: 2,
          reason:
            'The syntax check runs only on requested files: pass `files` to check them.',
        },
      ],
      diagnostics: [],
    });

    expect(out).not.toMatch(/No issues found/);
    expect(out).toContain('not a clean answer');
  });

  it('a TS-only clean answer over the same monorepo (python out of scope) IS bare (contrast case)', () => {
    const out = formatDiagnostics({
      status: 'available',
      source: 'typescript-compiler',
      coverage: coverageWith({}),
      diagnostics: [],
    });

    expect(out).toMatch(/No issues found/);
  });
});

describe('honesty:ptah_lsp_definitions / honesty:ptah_lsp_references (Batch 26a/26b — never a confident zero)', () => {
  it.each([
    ['references', formatLspReferences] as const,
    ['definitions', formatLspDefinitions] as const,
  ])(
    'a truncated %s report with zero locations is qualified, never a bare Found: 0',
    (_label, formatter) => {
      const out = formatter({
        locations: [],
        mechanism: 'text-scan',
        language: 'java',
        languageSupported: true,
        approximations: [],
        truncated: true,
      });

      expect(out).toContain('Truncated');
      expect(out).toMatch(
        /Found: 0 \w+s? \(qualified as above; not proof that none exist\)/,
      );
    },
  );

  it.each([
    ['references', formatLspReferences] as const,
    ['definitions', formatLspDefinitions] as const,
  ])(
    'an unsupported-language %s report with zero locations is qualified, never a bare Found: 0',
    (_label, formatter) => {
      const out = formatter({
        locations: [],
        mechanism: 'declaration-scan',
        language: 'java',
        languageSupported: false,
        approximations: [],
      });

      expect(out).toContain('not supported by this mechanism');
      expect(out).toMatch(/qualified as above; not proof that none exist/);
    },
  );

  it('a "none" mechanism never claims an empty result at all (no lookup ran)', () => {
    const out = formatLspReferences({
      locations: [],
      mechanism: 'none',
      language: null,
      languageSupported: null,
      approximations: [],
    });

    expect(out).toContain('No reference lookup ran');
    expect(out).not.toMatch(/Found: 0/);
  });

  it('a genuinely clean, supported-language, non-truncated zero IS a bare Found: 0 (contrast case)', () => {
    const out = formatLspReferences({
      locations: [],
      mechanism: 'provider-defined',
      language: 'typescript',
      languageSupported: true,
      approximations: [],
    });

    expect(out).toMatch(/^## LSP References/);
    expect(out).toMatch(/Found: 0 reference/);
    expect(out).not.toMatch(/qualified as above/);
  });
});

// ---------------------------------------------------------------------------
// R27-01/R27-04: MCP_HONESTY_CHECKS — executable proof for the three keys
// this project owns (layering: mcp-response-formatter.ts and the mandate
// manifest live here, not in workspace-intelligence). Each function performs
// the real call and throws on failure, same discipline as WIT's
// `HONESTY_CHECKS`.
// ---------------------------------------------------------------------------

type HonestyCheck = () => Promise<void>;

async function diagnosticsHonesty(): Promise<void> {
  const out = formatDiagnostics({
    status: 'available',
    source: 'typescript-compiler',
    coverage: coverageWith({ unchecked: 2 }),
    notChecked: [
      { language: 'python', count: 2, reason: 'pass `files` to check them' },
    ],
    diagnostics: [],
  });
  if (/No issues found/.test(out)) {
    throw new Error('a mixed repo rendered a bare "No issues found"');
  }
  const clean = formatDiagnostics({
    status: 'available',
    source: 'typescript-compiler',
    coverage: coverageWith({}),
    diagnostics: [],
  });
  if (!/No issues found/.test(clean)) {
    throw new Error(
      'a genuinely clean TS-only answer did not render bare (contrast case failed)',
    );
  }
}

function lspHonesty(
  formatter: typeof formatLspReferences,
): () => Promise<void> {
  return async () => {
    const truncated = formatter({
      locations: [],
      mechanism: 'text-scan',
      language: 'java',
      languageSupported: true,
      approximations: [],
      truncated: true,
    });
    if (!/Found: 0 \w+s? \(qualified as above/.test(truncated)) {
      throw new Error(
        `a truncated zero-result report was not qualified: ${truncated}`,
      );
    }
    const clean = formatter({
      locations: [],
      mechanism: 'provider-defined',
      language: 'typescript',
      languageSupported: true,
      approximations: [],
    });
    if (/qualified as above/.test(clean)) {
      throw new Error(
        'a genuinely clean zero was qualified (contrast case failed)',
      );
    }
  };
}

/** Proved here (not workspace-intelligence): layering, see file header. */
const CHECKED_ELSEWHERE_KEYS = [
  'honesty:ptah_get_diagnostics',
  'honesty:ptah_lsp_definitions',
  'honesty:ptah_lsp_references',
] as const;

const MCP_HONESTY_CHECKS: Readonly<
  Record<(typeof CHECKED_ELSEWHERE_KEYS)[number], HonestyCheck>
> = {
  'honesty:ptah_get_diagnostics': diagnosticsHonesty,
  'honesty:ptah_lsp_definitions': lspHonesty(formatLspDefinitions),
  'honesty:ptah_lsp_references': lspHonesty(formatLspReferences),
};

describe("MCP_HONESTY_CHECKS — executable proof (R27-01, this project's three keys)", () => {
  it.each(Object.entries(MCP_HONESTY_CHECKS))(
    'executes and proves the honesty property for %s',
    async (_key, check) => {
      await check();
    },
  );

  it("CHECKED_ELSEWHERE_KEYS matches workspace-intelligence's own CHECKED_ELSEWHERE literal (kept in sync by hand; both listed in the executor report)", () => {
    // Deliberately not a cross-project import (see file header): both lists
    // are literal and reviewed together. This test exists so a future editor
    // who renames a key here is pointed at the sibling file to update.
    expect([...CHECKED_ELSEWHERE_KEYS].sort()).toEqual([
      'honesty:ptah_get_diagnostics',
      'honesty:ptah_lsp_definitions',
      'honesty:ptah_lsp_references',
    ]);
  });
});

// ---------------------------------------------------------------------------
// R27-04: real dispatcher — building/failed/warm shapes stay ordered. Trimmed
// from the full Batch 9b harness (protocol-dispatcher.spec.ts, "dependency
// graph background build") to one representative tool.
//
// r1 R29a1-02: the three tests below check that a SMALL response's text is
// exactly `JSON.stringify(body)` — that is JSON-serialization-form equality,
// not spool-recovery equality (renamed accordingly; the review found the
// previous "raw-JSON-equal" name overclaimed spool recovery for a response
// too small to ever be spooled). The actual raw-spool-byte-equality proof —
// an over-budget response, the dispatcher's real reduce+spool path, the
// RETURNED locator parsed from the tool text, and the spooled file's bytes
// read back and compared to the independently captured raw payload — is the
// separate "real spool recovery" describe block further below.
// ---------------------------------------------------------------------------

describe('real dispatcher/budget/spool — ptah_get_dependents building/failed/warm shapes stay ordered and raw (R27-04)', () => {
  const root = path.resolve('/ws-27-dispatch');

  interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
  }
  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function silentLogger(): Logger {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
  }

  function harness(options: { built?: boolean } = {}) {
    const state = {
      built: options.built === true,
      generation: undefined as number | undefined,
      lastGeneration: 0,
    };
    const builds: Array<Deferred<{ error?: string }>> = [];
    const buildGraph = jest.fn(
      (
        _files: string[],
        _root: string,
        _discovered?: number,
        buildOptions?: { generation?: number },
      ) => {
        const build = deferred<{ error?: string }>();
        builds.push(build);
        return build.promise.then((summary) => {
          if (
            summary.error === undefined &&
            buildOptions?.generation === state.generation
          ) {
            state.built = true;
          }
          return summary;
        });
      },
    );
    const findFiles = jest.fn().mockResolvedValue(['src/a.ts', 'src/b.ts']);
    const ptahAPI = {
      workspace: { getInfo: jest.fn().mockResolvedValue({ path: root }) },
      dependencies: {
        unsupportedGraphLanguage: jest.fn(() => undefined),
        discoverSourceFiles: jest.fn(async (r: string) => ({
          files: (await findFiles()).map((f: string) => path.join(r, f)),
          truncated: false,
          limit: 50_000,
        })),
        getGraphCoverageForFile: jest.fn(async (file: string) => ({
          coverage: coverageWith({}),
          nodePath: file,
        })),
        isBuilt: jest.fn(async () => state.built),
        reserveGraphBuild: jest.fn(() => {
          state.lastGeneration += 1;
          state.generation = state.lastGeneration;
          return state.generation;
        }),
        getGraphBuildState: jest.fn(() => ({
          generation: state.generation,
          building: false,
        })),
        buildGraph,
        getDependents: jest.fn().mockResolvedValue([path.join(root, 'b.ts')]),
      } as unknown as PtahAPI['dependencies'],
    } as unknown as PtahAPI;
    const deps: ProtocolHandlerDependencies = {
      ptahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: silentLogger(),
    };
    return { state, builds, buildGraph, findFiles, deps };
  }

  function makeRequest(id: string): MCPRequest {
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'ptah_get_dependents', arguments: { file: 'src/a.ts' } },
    };
  }

  interface ToolResult {
    body: Record<string, unknown>;
    text: string;
    isError: boolean;
  }
  function toResult(res: MCPResponse): ToolResult {
    const result = res.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const text = result.content[0].text;
    return {
      body: JSON.parse(text) as Record<string, unknown>,
      text,
      isError: result.isError === true,
    };
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'queueMicrotask',
        'performance',
        'Date',
        'hrtime',
      ],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('a warm graph answers at once, with no "status" field; its small text is exactly JSON.stringify(body)', async () => {
    const h = harness({ built: true });
    const res = await handleMCPRequest(makeRequest('warm'), h.deps);
    const { body, text } = toResult(res);

    expect(body).not.toHaveProperty('status');
    expect(body).toHaveProperty('dependents');
    // JSON-serialization-form equality (not spool recovery: this response is
    // far under budget, so nothing is reduced or spooled).
    expect(text).toBe(JSON.stringify(body));
  });

  it('a cold call reports "building" first (status is the first key); its small text is exactly JSON.stringify(body)', async () => {
    const h = harness();
    const pending = handleMCPRequest(makeRequest('cold'), h.deps);
    await flush();
    await jest.advanceTimersByTimeAsync(2_000);
    const { body, text, isError } = toResult(await pending);

    expect(isError).toBe(false);
    expect(Object.keys(body)[0]).toBe('status');
    expect(body['status']).toBe('building');
    expect(text).toBe(JSON.stringify(body));
  });

  it('a failed build reports "failed" first (status is the first key); its small text is exactly JSON.stringify(body)', async () => {
    const h = harness();
    const pending = handleMCPRequest(makeRequest('fails'), h.deps);
    await flush();
    h.builds[0].resolve({ error: `EACCES ${root}/secret.ts` });
    const { body, text, isError } = toResult(await pending);

    expect(isError).toBe(true);
    expect(Object.keys(body)[0]).toBe('status');
    expect(body['status']).toBe('failed');
    // Fixed text: the raw error/path never reaches the spool.
    expect(text).not.toContain('EACCES');
    expect(text).not.toContain('secret');
    expect(text).toBe(JSON.stringify(body));
  });
});

// ---------------------------------------------------------------------------
// r1 R29a1-02: the actual raw-spool-byte-equality proof. Drives an
// over-budget `ptah_context_enrich_file` response — whose success text is
// exactly `JSON.stringify(result)` (`protocol-dispatcher.ts`, the
// `ptah_context_enrich_file` case), so the pre-dispatch raw payload is fully
// known and controlled by this test, not reconstructed from an internal
// formatter — through the REAL dispatcher and REAL `applyToolResultBudget`
// spool path, with a real (TEMP-only) host-owned spool root. Parses the
// RETURNED recovery locator out of the tool's own response text (never reads
// a private outcome/telemetry object), reads that file from disk, and
// compares its bytes to the independently captured raw payload.
// ---------------------------------------------------------------------------

describe('real spool recovery — ptah_context_enrich_file over-budget response is spooled byte-equal (R29a1-02)', () => {
  const SPOOL_LOCATOR = /full output: (.+)\]\s*$/;

  function silentLogger(): Logger {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;
  }

  function makeRequest(id: string): MCPRequest {
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'ptah_context_enrich_file',
        arguments: { file: 'src/big.ts' },
      },
    };
  }

  /** Resolves a spool locator (relative to the spool root, or absolute) to a real path. */
  function resolveLocator(locator: string, spoolRoot: string): string {
    const trimmed = locator.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.join(spoolRoot, trimmed);
  }

  it('spools the over-budget raw JSON byte-for-byte and the returned locator reads back exactly', async () => {
    const spoolRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-spool-honesty-'),
    );
    try {
      // Fully controlled by this test: the dispatcher's `ptah_context_enrich_file`
      // case does nothing but `JSON.stringify(result)` to this object, so the
      // pre-dispatch raw payload IS `expectedRaw` below, captured before dispatch.
      const bigResult = {
        content: 'A'.repeat(20_000),
        reason: 'unsupported-language',
        tokensSaved: 0,
      };
      const expectedRaw = JSON.stringify(bigResult);

      const ptahAPI = {
        context: { enrichFile: jest.fn(async () => bigResult) },
      } as unknown as PtahAPI;
      const deps: ProtocolHandlerDependencies = {
        ptahAPI,
        permissionPromptService:
          {} as ProtocolHandlerDependencies['permissionPromptService'],
        logger: silentLogger(),
        workspaceProvider: {
          getWorkspaceFolders: () => [spoolRoot],
        } as unknown as ProtocolHandlerDependencies['workspaceProvider'],
      };

      const res = await handleMCPRequest(makeRequest('spool-1'), deps);
      const result = res.result as {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
      const text = result.content[0].text;

      // Sanity: the response was actually reduced (never equals the 20k-char raw).
      expect(text).not.toBe(expectedRaw);
      expect(text.length).toBeLessThan(expectedRaw.length);

      const match = SPOOL_LOCATOR.exec(text);
      if (!match) {
        throw new Error(
          `no spool locator found in the over-budget response: ${text.slice(-300)}`,
        );
      }
      const spoolFile = resolveLocator(match[1], spoolRoot);
      const spooledBytes = fs.readFileSync(spoolFile, 'utf8');

      // The actual byte-equality proof: not a JSON round-trip, a real file read.
      expect(spooledBytes).toBe(expectedRaw);
    } finally {
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    }
  });
});
