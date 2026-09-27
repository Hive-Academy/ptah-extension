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

// Real grammars for `outline:tsx` (Batch 29b): the lib-wide wasm-bundle-dir
// stub throws on purpose, and web-tree-sitter must load grammars from bytes
// (the shims `code-outliner.adapter.spec.ts` documents).
jest.mock('wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

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
import { TreeSitterParserService } from '@ptah-extension/workspace-intelligence';
import { TreeSitterCodeOutliner } from './code-outliner.adapter';

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

/**
 * `outline:tsx` (Batch 29b): the real outliner over the real TSX grammar
 * outlines a JSX component instead of refusing, and the same text forced onto
 * the TypeScript grammar is still refused (contrast: the outline comes from
 * the TSX grammar, not from a refusal rule that stopped firing).
 */
async function tsxOutlineHonesty(): Promise<void> {
  const parser = new TreeSitterParserService({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger);
  try {
    const outliner = new TreeSitterCodeOutliner(parser);
    const source = [
      'export function Badge(props: { count: number }) {',
      '  const label = `${props.count}`;',
      '  return <span className="badge">{label}</span>;',
      '}',
      '',
    ].join('\n');
    const outline = await outliner.outline(source, '.tsx', 'Badge');
    if (outline === null) {
      throw new Error('the .tsx outline was refused');
    }
    if (
      JSON.stringify(outline.omittable) !==
        JSON.stringify([{ startLine: 1, endLine: 2 }]) ||
      JSON.stringify(outline.focus) !==
        JSON.stringify([{ startLine: 0, endLine: 3 }])
    ) {
      throw new Error(`unexpected .tsx outline: ${JSON.stringify(outline)}`);
    }
    if ((await outliner.outline(source, 'typescript')) !== null) {
      throw new Error(
        'JSX under the TypeScript grammar was outlined (contrast failed)',
      );
    }
    // Batch 29b r1 R29b-02: the served path, not only the adapter. An
    // over-budget TSX string returned by `execute_code` with its declared
    // `resultLanguage` reaches this outliner through the real dispatcher and
    // budget, and keeps every declaration (the middle one included).
    const served = await executeTsxThroughDispatcher(parser, 'tsx');
    if (served.reducer !== 'code-outline') {
      throw new Error(
        `the dispatcher did not outline the .tsx result: reducer ${served.reducer}`,
      );
    }
    for (const name of TSX_COMPONENT_NAMES) {
      if (!served.text.includes(`export function ${name}(`)) {
        throw new Error(`the served outline lost ${name}`);
      }
    }
  } finally {
    parser.dispose();
  }
}

/** One Batch 30 language's outline honesty subject. */
interface GrammarOutlineSubject {
  readonly language: 'java' | 'rust';
  readonly hint: string;
  /** Small file: one method body, focus on its type. */
  readonly source: string;
  readonly focusSymbol: string;
  readonly omittable: readonly { startLine: number; endLine: number }[];
  readonly focus: readonly { startLine: number; endLine: number }[];
  /** Over-budget module for the served path, and the lines it must keep. */
  readonly large: () => string;
  readonly keptSignatures: readonly string[];
}

const LARGE_MODULE_NAMES = ['first', 'middle', 'last'] as const;

const JAVA_OUTLINE: GrammarOutlineSubject = {
  language: 'java',
  hint: '.java',
  source: [
    'public class Counter {',
    '  public int next(int step) {',
    '    int value = step + 1;',
    '    return value;',
    '  }',
    '}',
    '',
  ].join('\n'),
  focusSymbol: 'Counter',
  omittable: [{ startLine: 2, endLine: 3 }],
  focus: [{ startLine: 0, endLine: 5 }],
  large: () => {
    const out = ['public class Report {'];
    for (const name of LARGE_MODULE_NAMES) {
      out.push(`  public String ${name}(String[] rows) {`);
      for (let i = 0; i < 80; i++) {
        out.push(
          `    String row${i} = rows.length > ${i} ? rows[${i}] : ${JSON.stringify(`${name}-${i}`)};`,
        );
      }
      out.push('    return rows[0];', '  }');
    }
    out.push('}', '');
    return out.join('\n');
  },
  keptSignatures: LARGE_MODULE_NAMES.map(
    (name) => `  public String ${name}(String[] rows) {`,
  ),
};

const RUST_OUTLINE: GrammarOutlineSubject = {
  language: 'rust',
  hint: '.rs',
  source: [
    'pub struct Counter;',
    'impl Counter {',
    '    pub fn next(&self, step: u32) -> u32 {',
    '        let value = step + 1;',
    '        value',
    '    }',
    '}',
    '',
  ].join('\n'),
  focusSymbol: 'Counter',
  omittable: [{ startLine: 3, endLine: 4 }],
  focus: [
    { startLine: 0, endLine: 0 },
    { startLine: 1, endLine: 6 },
  ],
  large: () => {
    const out: string[] = [];
    for (const name of LARGE_MODULE_NAMES) {
      out.push(`pub fn ${name}(rows: &[String]) -> usize {`);
      for (let i = 0; i < 80; i++) {
        out.push(
          `    let row${i} = rows.get(${i}).map_or(${JSON.stringify(`${name}-${i}`)}.len(), |r| r.len());`,
        );
      }
      out.push('    rows.len()', '}', '');
    }
    return out.join('\n');
  },
  keptSignatures: LARGE_MODULE_NAMES.map(
    (name) => `pub fn ${name}(rows: &[String]) -> usize {`,
  ),
};

/**
 * `outline:java|rust` (Batch 30): the real outliner over the real grammar
 * outlines the file instead of refusing (exact spans), a syntax error is
 * still refused (contrast), and an over-budget `execute_code` result
 * declared as that language reaches the outliner through the real
 * dispatcher and keeps every signature, the middle one included.
 */
async function grammarOutlineHonesty(
  subject: GrammarOutlineSubject,
): Promise<void> {
  const parser = new TreeSitterParserService({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger);
  try {
    const outliner = new TreeSitterCodeOutliner(parser);
    const outline = await outliner.outline(
      subject.source,
      subject.hint,
      subject.focusSymbol,
    );
    if (outline === null) {
      throw new Error(`the ${subject.hint} outline was refused`);
    }
    const byRow = (a: { startLine: number }, b: { startLine: number }) =>
      a.startLine - b.startLine;
    if (
      JSON.stringify([...outline.omittable].sort(byRow)) !==
        JSON.stringify(subject.omittable) ||
      JSON.stringify([...outline.focus].sort(byRow)) !==
        JSON.stringify(subject.focus)
    ) {
      throw new Error(
        `unexpected ${subject.hint} outline: ${JSON.stringify(outline)}`,
      );
    }
    const broken = subject.source.replace('{', '{ (');
    if ((await outliner.outline(broken, subject.language)) !== null) {
      throw new Error(
        `a ${subject.language} file with a syntax error was outlined (contrast failed)`,
      );
    }
    const served = await executeThroughDispatcher(
      parser,
      subject.large(),
      subject.language,
    );
    if (served.reducer !== 'code-outline') {
      throw new Error(
        `the dispatcher did not outline the ${subject.language} result: reducer ${served.reducer}`,
      );
    }
    for (const signature of subject.keptSignatures) {
      if (!served.text.includes(signature)) {
        throw new Error(`the served outline lost ${JSON.stringify(signature)}`);
      }
    }
    if (served.spooled !== served.raw) {
      throw new Error(`the ${subject.language} spool is not the raw text`);
    }
  } finally {
    parser.dispose();
  }
}

/** Three JSX components whose bodies together are well over the 2,000-token budget. */
const TSX_COMPONENT_NAMES = [
  'FirstDeclaration',
  'MiddleDeclaration',
  'LastDeclaration',
] as const;

function largeTsxModule(): string {
  const out: string[] = [];
  for (const name of TSX_COMPONENT_NAMES) {
    out.push(`export function ${name}(props: { rows: string[] }) {`);
    for (let i = 0; i < 80; i++) {
      out.push(
        `  const row${i} = props.rows[${i}] ?? ${JSON.stringify(`${name}-${i}`)}.padEnd(${i + 20});`,
      );
    }
    out.push(
      '  return <ul>{props.rows.map((r) => <li key={r}>{r}</li>)}</ul>;',
      '}',
      '',
    );
  }
  return out.join('\n');
}

interface ServedResult {
  readonly text: string;
  readonly reducer: string | undefined;
  readonly spooled: string | undefined;
  readonly raw: string;
}

/**
 * `execute_code` returning a large TSX module through the REAL
 * `handleMCPRequest` with a real `TreeSitterCodeOutliner` on the deps (as the
 * HTTP server wires it) and a temporary spool root under the OS temp dir.
 */
async function executeTsxThroughDispatcher(
  parser: TreeSitterParserService,
  resultLanguage: string | undefined,
): Promise<ServedResult> {
  return executeThroughDispatcher(parser, largeTsxModule(), resultLanguage);
}

/**
 * `execute_code` returning `raw` through the REAL `handleMCPRequest` (the
 * TSX helper above; Batch 30 reuses it for Java and Rust).
 */
async function executeThroughDispatcher(
  parser: TreeSitterParserService,
  raw: string,
  resultLanguage: string | undefined,
): Promise<ServedResult> {
  const spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-29b-outline-'));
  try {
    const deps: ProtocolHandlerDependencies = {
      ptahAPI: {} as PtahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger,
      workspaceProvider: {
        getWorkspaceFolders: () => [spoolRoot],
      } as unknown as ProtocolHandlerDependencies['workspaceProvider'],
      codeOutliner: new TreeSitterCodeOutliner(parser),
    };
    const args: Record<string, unknown> = {
      code: `return ${JSON.stringify(raw)};`,
    };
    if (resultLanguage !== undefined) args['resultLanguage'] = resultLanguage;
    const res = await handleMCPRequest(
      {
        jsonrpc: '2.0',
        id: `29b-outline-${resultLanguage ?? 'none'}`,
        method: 'tools/call',
        params: { name: 'execute_code', arguments: args },
      },
      deps,
    );
    const text = (res.result as { content: Array<{ text: string }> }).content[0]
      .text;
    const trailer =
      /\[reduced: (\S+?)(?: — [^\]]*?)? — showing \d+ of \d+ tokens — full output: ([^\]]+)\]$/.exec(
        text,
      );
    const locator = trailer?.[2]?.trim();
    const spooled =
      locator === undefined
        ? undefined
        : fs.readFileSync(
            path.isAbsolute(locator) ? locator : path.join(spoolRoot, locator),
            'utf8',
          );
    return { text, reducer: trailer?.[1], spooled, raw };
  } finally {
    fs.rmSync(spoolRoot, { recursive: true, force: true });
  }
}

describe('outline:tsx through the real dispatcher (Batch 29b r1 R29b-02)', () => {
  let parser: TreeSitterParserService;
  beforeAll(() => {
    parser = new TreeSitterParserService({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger);
  });
  afterAll(() => parser.dispose());

  it('execute_code with resultLanguage "tsx" is outlined, keeps the middle declaration and spools the raw text byte-equal', async () => {
    const served = await executeTsxThroughDispatcher(parser, 'tsx');

    expect(served.reducer).toBe('code-outline');
    for (const name of TSX_COMPONENT_NAMES) {
      expect(served.text).toContain(`export function ${name}(`);
    }
    expect(served.spooled).toBe(served.raw);
  }, 60_000);

  it('a result far above the old 51,200-char serializer cut is outlined whole and spooled byte-equal (Batch 30 r1 R30-01)', async () => {
    const names = Array.from({ length: 36 }, (_, i) => `Component${i}`);
    const out: string[] = [];
    for (const name of names) {
      out.push(`export function ${name}(props: { rows: string[] }) {`);
      for (let i = 0; i < 80; i++) {
        out.push(
          `  const row${i} = props.rows[${i}] ?? ${JSON.stringify(`${name}-${i}`)}.padEnd(${i + 20});`,
        );
      }
      out.push(
        '  return <ul>{props.rows.map((r) => <li key={r}>{r}</li>)}</ul>;',
        '}',
        '',
      );
    }
    const raw = out.join('\n');
    expect(raw.length).toBeGreaterThan(150_000);

    const served = await executeThroughDispatcher(parser, raw, 'tsx');

    expect(served.reducer).toBe('code-outline');
    // The late declarations were past the old cut: they are only here if the
    // outliner saw the whole text.
    for (const name of names) {
      expect(served.text).toContain(`export function ${name}(`);
    }
    expect(served.text).not.toContain('[TRUNCATED:');
    expect(served.spooled).toBe(raw);
  }, 60_000);

  it('without a declared language the same result is not outlined (contrast: the hint is what reaches the outliner)', async () => {
    const served = await executeTsxThroughDispatcher(parser, undefined);

    expect(served.reducer).not.toBe('code-outline');
    expect(served.spooled).toBe(served.raw);
  }, 60_000);

  it('rejects a resultLanguage that is not a short non-empty string', async () => {
    const res = await handleMCPRequest(
      {
        jsonrpc: '2.0',
        id: '29b-bad-language',
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: { code: 'return 1;', resultLanguage: 42 },
        },
      },
      {
        ptahAPI: {} as PtahAPI,
        permissionPromptService:
          {} as ProtocolHandlerDependencies['permissionPromptService'],
        logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as unknown as Logger,
      },
    );
    expect(res.error?.code).toBe(-32602);
  });
});

/** Proved here (not workspace-intelligence): layering, see file header. */
const CHECKED_ELSEWHERE_KEYS = [
  'honesty:ptah_get_diagnostics',
  'honesty:ptah_lsp_definitions',
  'honesty:ptah_lsp_references',
  'outline:tsx',
  'outline:java',
  'outline:rust',
] as const;

const MCP_HONESTY_CHECKS: Readonly<
  Record<(typeof CHECKED_ELSEWHERE_KEYS)[number], HonestyCheck>
> = {
  'honesty:ptah_get_diagnostics': diagnosticsHonesty,
  'honesty:ptah_lsp_definitions': lspHonesty(formatLspDefinitions),
  'honesty:ptah_lsp_references': lspHonesty(formatLspReferences),
  'outline:tsx': tsxOutlineHonesty,
  'outline:java': async () => grammarOutlineHonesty(JAVA_OUTLINE),
  'outline:rust': async () => grammarOutlineHonesty(RUST_OUTLINE),
};

describe("MCP_HONESTY_CHECKS — executable proof (R27-01, this project's keys)", () => {
  it.each(Object.entries(MCP_HONESTY_CHECKS))(
    'executes and proves the honesty property for %s',
    async (_key, check) => {
      await check();
    },
    60_000,
  );

  it("CHECKED_ELSEWHERE_KEYS matches workspace-intelligence's own CHECKED_ELSEWHERE literal (kept in sync by hand; both listed in the executor report)", () => {
    // Deliberately not a cross-project import (see file header): both lists
    // are literal and reviewed together. This test exists so a future editor
    // who renames a key here is pointed at the sibling file to update.
    expect([...CHECKED_ELSEWHERE_KEYS].sort()).toEqual([
      'honesty:ptah_get_diagnostics',
      'honesty:ptah_lsp_definitions',
      'honesty:ptah_lsp_references',
      'outline:java',
      'outline:rust',
      'outline:tsx',
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
