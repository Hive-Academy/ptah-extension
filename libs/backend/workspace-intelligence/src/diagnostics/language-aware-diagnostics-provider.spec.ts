/**
 * LanguageAwareDiagnosticsProvider — TASK_2026_559 Batch 25a.
 *
 * The syntax check runs on the REAL tree-sitter grammars (the Python, Go and
 * C# WASM files in node_modules), with the two Jest shims the C# grammar
 * integration spec documents: `wasm-bundle-dir` reads `import.meta.url`, and
 * `Language.load(path)` uses a dynamic import Jest's VM rejects. Cases about
 * caps and failures that need no grammar use a scripted parser instead.
 *
 * Every fixture is a `mkdtemp` directory, removed after each case.
 */

import 'reflect-metadata';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import {
  FileType,
  IncompleteFileSearchError,
  PLATFORM_TOKENS,
} from '@ptah-extension/platform-core';
import type {
  DiagnosticsResult,
  DiagnosticsScope,
  IDiagnosticsProvider,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  createMockDiagnosticsProvider,
  createMockFileSystemProvider,
  runDiagnosticsProviderContract,
  syntaxOnlyClaimViolations,
  type DiagnosticsProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { Result } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

// Tier 0 (User Decision 19): the checker spawns nothing. Every way to start a
// process is a spy, asserted untouched.
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
  spawnSync: jest.fn(),
  exec: jest.fn(),
  execFile: jest.fn(),
  execSync: jest.fn(),
  execFileSync: jest.fn(),
  fork: jest.fn(),
}));

jest.mock('../ast/wasm-bundle-dir', () => {
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

import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { registerTypeScriptDiagnosticsProvider } from '../di/register';
import {
  CENSUS_LIMIT,
  LanguageAwareDiagnosticsProvider,
  ROOT_GENERATIONS_MAX,
  SYNTAX_FILE_CAP,
  SYNTAX_MAX_BYTES,
  SYNTAX_MAX_ERRORS,
  type SyntaxParser,
} from './language-aware-diagnostics-provider';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

/** One real parser for the file: loading the grammars is the slow part. */
const realParser = new TreeSitterParserService(logger);

const PY_BROKEN = 'def f(:\n    return 1\n';
const PY_CLEAN = 'def f():\n    return 1\n';
const GO_BROKEN = 'package main\n\nfunc main() {\n\tx := \n}\n';
const CS_BROKEN = 'class A { void M() { int x = 1 } }\n';

const createdDirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-lang-diag-'));
  createdDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return root;
}

function abs(root: string, rel: string): string {
  return path.join(root, rel).replace(/\\/g, '/');
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * An `IFileSystemProvider` over the real disk for `stat`/`readFile`, with a
 * `findFiles` spy (the census discovery) returning `census` when given.
 */
function diskFs(census?: string[] | (() => Promise<string[]>)): {
  fsProvider: IFileSystemProvider;
  findFiles: jest.Mock;
} {
  const findFiles = jest.fn(async () =>
    typeof census === 'function' ? census() : (census ?? []),
  );
  const fsProvider = createMockFileSystemProvider({
    findFiles,
    stat: async (file: string) => {
      const stat = fs.statSync(file);
      return {
        type: stat.isFile() ? FileType.File : FileType.Directory,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    },
    readFile: async (file: string) => fs.readFileSync(file, 'utf-8'),
  });
  return { fsProvider, findFiles };
}

/** An inner TypeScript provider that answers with `answer` and records calls. */
function fakeTypeScript(
  answer: (root?: string, scope?: DiagnosticsScope) => DiagnosticsResult,
): IDiagnosticsProvider & {
  getDiagnostics: jest.Mock;
  invalidate: jest.Mock;
} {
  return {
    getDiagnostics: jest.fn(async (root?: string, scope?: DiagnosticsScope) =>
      answer(root, scope),
    ),
    invalidate: jest.fn(),
  };
}

const TS_CLEAN = (): DiagnosticsResult => ({
  status: 'available',
  source: 'typescript-compiler',
  diagnostics: [],
});

const NO_TSCONFIG = (): DiagnosticsResult => ({
  status: 'unavailable',
  source: 'typescript-compiler',
  reason: 'No tsconfig.json found under workspace root.',
});

/** A parser whose every file parses to `errors` ERROR nodes on rows 0.. */
function scriptedParser(
  errors = 0,
  ready = true,
): SyntaxParser & {
  queryMulti: jest.Mock;
} {
  return {
    initialize: jest.fn(async () =>
      ready ? Result.ok(undefined) : Result.err(new Error('no wasm')),
    ),
    queryMulti: jest.fn(async () => {
      const captures = Array.from({ length: errors }, (_, row) => ({
        name: 'error',
        node: {
          type: 'ERROR',
          text: '',
          startPosition: { row, column: 0 },
          endPosition: { row, column: 1 },
          isNamed: true,
          fieldName: null,
          children: [],
        },
        text: '',
        startPosition: { row, column: 0 },
        endPosition: { row, column: 1 },
      }));
      const map = new Map([
        ['error', captures.length > 0 ? [{ pattern: 0, captures }] : []],
        ['missing', []],
      ]);
      return Result.ok(
        Object.assign(map, {
          parseStatus: errors > 0 ? 'recovered' : 'ok',
          errorNodeCount: Math.min(errors, 20),
          errorNodeCountCapped: errors >= 20,
        }),
      );
    }),
  } as unknown as SyntaxParser & { queryMulti: jest.Mock };
}

// ---------------------------------------------------------------------------
// The shared contract, including "syntax-only is not a type-check claim"
// (Task 25a.1) on the real Python grammar.
// ---------------------------------------------------------------------------

runDiagnosticsProviderContract('LanguageAwareDiagnosticsProvider', () => {
  const inner = createMockDiagnosticsProvider();
  const provider = new LanguageAwareDiagnosticsProvider(
    inner,
    diskFs().fsProvider,
    realParser,
  );
  const setup: DiagnosticsProviderSetup = {
    provider,
    seed(diagnostics): void {
      inner.__state.setDiagnostics(diagnostics);
    },
    makeUnavailable(reason: string): void {
      inner.__state.setUnavailable(reason);
    },
    syntaxOnly: {
      language: 'python',
      extension: '.py',
      broken: PY_BROKEN,
      clean: PY_CLEAN,
    },
  };
  return setup;
});

describe('LanguageAwareDiagnosticsProvider', () => {
  describe('scoped calls', () => {
    it('syntax-checks Python, Go and C# on the real grammars, one error entry per ERROR/MISSING node', async () => {
      const root = fixture({
        'app/bad.py': PY_BROKEN,
        'app/ok.py': PY_CLEAN,
        'cmd/main.go': GO_BROKEN,
        'src/A.cs': CS_BROKEN,
      });
      const inner = fakeTypeScript(TS_CLEAN);
      const provider = new LanguageAwareDiagnosticsProvider(
        inner,
        diskFs().fsProvider,
        realParser,
      );
      const files = ['app/bad.py', 'app/ok.py', 'cmd/main.go', 'src/A.cs'].map(
        (rel) => abs(root, rel),
      );

      const result = await provider.getDiagnostics(root, { files });

      expect(inner.getDiagnostics).not.toHaveBeenCalled();
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.source).toBe('tree-sitter-syntax');
      expect(result.diagnostics.map((entry) => entry.file).sort()).toEqual([
        abs(root, 'app/bad.py'),
        abs(root, 'cmd/main.go'),
        abs(root, 'src/A.cs'),
      ]);
      for (const entry of result.diagnostics) {
        expect(entry.diagnostics.length).toBeGreaterThan(0);
        for (const d of entry.diagnostics) {
          expect(d.severity).toBe('error');
          expect(d.message).toContain('syntax-only check, not type-checked');
        }
      }
      expect(result.coverage).toMatchObject({
        clean: true,
        census: 'complete',
        analyzed: 4,
        checks: 'syntax-only',
        approximations: [
          'csharp:syntax-only',
          'go:syntax-only',
          'python:syntax-only',
        ],
      });
      expect(syntaxOnlyClaimViolations(result, 'python')).toEqual([]);
    });

    // Edge case (batches.md "Plan validation"): 51 files → 1 omittedByCap.
    it('checks at most 50 files; the 51st is omittedByCap and named in notChecked', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < SYNTAX_FILE_CAP + 1; i++) {
        files[`py/m${String(i).padStart(2, '0')}.py`] = PY_CLEAN;
      }
      const root = fixture(files);
      const parser = scriptedParser();
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        parser,
      );

      const result = await provider.getDiagnostics(root, {
        files: Object.keys(files).map((rel) => abs(root, rel)),
      });

      expect(parser.queryMulti).toHaveBeenCalledTimes(SYNTAX_FILE_CAP);
      expect(result.status).toBe('available');
      expect(result.coverage).toMatchObject({
        clean: false,
        reasons: ['omitted-by-cap'],
        analyzed: SYNTAX_FILE_CAP,
        omittedByCap: 1,
        checks: 'syntax-only',
      });
      expect(result.notChecked).toEqual([
        {
          language: 'python',
          count: 1,
          files: [abs(root, 'py/m50.py')],
          reason: expect.stringContaining('at most 50 files per call'),
        },
      ]);
    });

    it('lists at most 20 syntax errors per file and says more were found', async () => {
      const root = fixture({ 'a.py': PY_CLEAN });
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        scriptedParser(25),
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'a.py')],
      });

      if (result.status !== 'available') throw new Error(result.status);
      const entries = result.diagnostics[0].diagnostics;
      expect(entries.filter((d) => d.severity === 'error')).toHaveLength(
        SYNTAX_MAX_ERRORS,
      );
      expect(entries[entries.length - 1]).toMatchObject({
        severity: 'info',
        message: expect.stringContaining('not listed'),
      });
    });

    it('never parses a file over 1 MiB or one it cannot read: both are failed, by reason', async () => {
      const root = fixture({
        'big.py': 'x = 1\n'.repeat(SYNTAX_MAX_BYTES / 6 + 10),
        'ok.py': PY_CLEAN,
      });
      const parser = scriptedParser();
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        parser,
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'big.py'), abs(root, 'gone.py'), abs(root, 'ok.py')],
      });

      expect(parser.queryMulti).toHaveBeenCalledTimes(1);
      expect(result.coverage).toMatchObject({
        clean: false,
        analyzed: 1,
        failed: 2,
        failedByReason: { 'too-large': 1, read: 1 },
      });
      expect(result.notChecked?.map((group) => group.files)).toEqual([
        [abs(root, 'big.py')],
        [abs(root, 'gone.py')],
      ]);
    });

    it('reports every syntax file as grammar-unavailable when the parser cannot start', async () => {
      const root = fixture({ 'a.py': PY_CLEAN });
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        scriptedParser(0, false),
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'a.py')],
      });

      // Nothing was checked: never an empty `available`.
      expect(result.status).toBe('unavailable');
      expect(result.coverage).toMatchObject({
        clean: false,
        failed: 1,
        failedByReason: { 'grammar-unavailable': 1 },
      });
    });

    it('sends only the TS/JS files to the TypeScript provider and answers mixed', async () => {
      const root = fixture({
        'src/a.ts': 'export const a = 1;\n',
        'b.py': PY_BROKEN,
      });
      const inner = fakeTypeScript((_root, scope) => ({
        status: 'available',
        source: 'typescript-compiler',
        diagnostics: (scope?.files ?? []).map((file) => ({
          file,
          diagnostics: [{ message: 'TS2322', line: 0, severity: 'error' }],
        })),
      }));
      const provider = new LanguageAwareDiagnosticsProvider(
        inner,
        diskFs().fsProvider,
        realParser,
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'src/a.ts'), abs(root, 'b.py')],
      });

      expect(inner.getDiagnostics).toHaveBeenCalledTimes(1);
      expect(inner.getDiagnostics).toHaveBeenCalledWith(root, {
        files: [abs(root, 'src/a.ts')],
      });
      if (result.status !== 'available') throw new Error(result.status);
      expect(result.source).toBe('typescript-compiler+tree-sitter-syntax');
      expect(result.diagnostics.map((entry) => entry.file)).toEqual([
        abs(root, 'src/a.ts'),
        abs(root, 'b.py'),
      ]);
      expect(result.coverage).toMatchObject({
        clean: true,
        analyzed: null,
        checks: 'mixed',
        approximations: ['python:syntax-only'],
      });
      expect(syntaxOnlyClaimViolations(result, 'python')).toEqual([]);
    });

    it('answers unavailable, naming the unchecked TS files, when the TypeScript check does not answer', async () => {
      const root = fixture({ 'src/a.ts': 'export {};\n', 'b.py': PY_BROKEN });
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(() => ({
          status: 'unavailable',
          source: 'typescript-compiler',
          reason: 'TypeScript check still running after 45s.',
        })),
        diskFs().fsProvider,
        realParser,
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'src/a.ts'), abs(root, 'b.py')],
      });

      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toMatch(
        /^TypeScript check still running after 45s\./,
      );
      expect(result.reason).toContain('syntax-only check of 1 other file(s)');
      expect(result.coverage).toMatchObject({
        clean: false,
        reasons: ['unchecked'],
        unchecked: 1,
        analyzed: 1,
        checks: 'syntax-only',
      });
      expect(result.notChecked).toEqual([
        {
          language: 'typescript',
          count: 1,
          files: [abs(root, 'src/a.ts')],
          reason:
            'TypeScript check unavailable: TypeScript check still running after 45s.',
        },
      ]);
    });

    // Review B25A-R1-S1: a type check that rejects while the syntax check
    // runs must reach the caller, never Node's unhandled-rejection path.
    // Jest's sandboxed `process` never receives Node's `unhandledRejection`
    // event, so the cases assert its precondition directly: a handler is on
    // the type-check promise before it rejects (Node reports a rejection
    // only when none is). Jest itself fails a case whose rejection is never
    // handled.
    describe('when the type check rejects', () => {
      /** A promise that records whether anything is observing it. */
      class WatchedPromise<T> extends Promise<T> {
        watched = false;
        override then<R1 = T, R2 = never>(
          onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
          onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
        ): Promise<R1 | R2> {
          this.watched = true;
          return super.then(onFulfilled, onRejected);
        }
      }

      /** A type check the case rejects by hand. */
      function heldTypeCheck(): {
        inner: IDiagnosticsProvider;
        typeCheck: WatchedPromise<DiagnosticsResult>;
        reject: (error: Error) => void;
      } {
        let reject: (error: Error) => void = () => undefined;
        const typeCheck = new WatchedPromise<DiagnosticsResult>(
          (_resolve, fail) => {
            reject = fail;
          },
        );
        return {
          inner: { getDiagnostics: () => typeCheck },
          typeCheck,
          reject: (error) => reject(error),
        };
      }

      it('rejects the call with it while the syntax check is still parsing, observed from the start', async () => {
        const root = fixture({
          'src/a.ts': 'export {};\n',
          'b.py': PY_CLEAN,
          'c.py': PY_CLEAN,
        });
        const { inner, typeCheck, reject } = heldTypeCheck();
        // The first parse waits for the case, so the syntax check is mid-run.
        let parseStarted: () => void = () => undefined;
        const parsing = new Promise<void>(
          (resolve) => (parseStarted = resolve),
        );
        let releaseParse: () => void = () => undefined;
        const released = new Promise<void>(
          (resolve) => (releaseParse = resolve),
        );
        const parser = scriptedParser();
        const parse = parser.queryMulti.getMockImplementation();
        parser.queryMulti.mockImplementation(async (...args: unknown[]) => {
          parseStarted();
          await released;
          return parse?.(...args);
        });
        const provider = new LanguageAwareDiagnosticsProvider(
          inner,
          diskFs().fsProvider,
          parser,
        );

        const call = provider.getDiagnostics(root, {
          files: ['src/a.ts', 'b.py', 'c.py'].map((rel) => abs(root, rel)),
        });
        await parsing;
        const watchedWhileParsing = typeCheck.watched;
        const failure = new Error('type-check worker crashed');
        reject(failure);
        releaseParse();

        await expect(call).rejects.toBe(failure);
        expect(watchedWhileParsing).toBe(true);
      });

      it('rejects with a syntax-check failure without orphaning a later type-check rejection', async () => {
        const root = fixture({ 'src/a.ts': 'export {};\n', 'b.py': PY_CLEAN });
        const { inner, typeCheck, reject } = heldTypeCheck();
        const parseFailure = new Error('parser crashed');
        const parser = scriptedParser();
        parser.queryMulti.mockRejectedValueOnce(parseFailure);
        const provider = new LanguageAwareDiagnosticsProvider(
          inner,
          diskFs().fsProvider,
          parser,
        );

        await expect(
          provider.getDiagnostics(root, {
            files: [abs(root, 'src/a.ts'), abs(root, 'b.py')],
          }),
        ).rejects.toBe(parseFailure);
        const watchedAfterParseFailure = typeCheck.watched;
        reject(new Error('type-check worker crashed'));
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(watchedAfterParseFailure).toBe(true);
      });
    });

    it('answers unavailable, never an empty available, when no requested file has a check', async () => {
      const root = fixture({
        'A.php': '<?php class A {}\n',
        'm.rb': 'puts 1\n',
        'run.sh': 'ls\n',
      });
      const inner = fakeTypeScript(TS_CLEAN);
      const provider = new LanguageAwareDiagnosticsProvider(
        inner,
        diskFs().fsProvider,
        scriptedParser(),
      );

      const result = await provider.getDiagnostics(root, {
        files: ['A.php', 'm.rb', 'run.sh'].map((rel) => abs(root, rel)),
      });

      expect(inner.getDiagnostics).not.toHaveBeenCalled();
      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toMatch(/^No requested file could be checked\./);
      expect(result.reason).toContain('No diagnostics for php on this host');
      expect(result.coverage).toMatchObject({
        clean: false,
        unsupported: 2,
        unrecognised: 1,
        unsupportedByLanguage: { php: 1, ruby: 1 },
      });
    });

    it('counts a case-variant spelling of the same file once on win32', async () => {
      const root = fixture({ 'a.py': PY_CLEAN });
      const parser = scriptedParser();
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        parser,
        'win32',
      );

      const result = await provider.getDiagnostics(root, {
        files: [abs(root, 'a.py'), abs(root, 'A.PY')],
      });

      expect(parser.queryMulti).toHaveBeenCalledTimes(1);
      expect(result.coverage?.analyzed).toBe(1);
    });

    it('spawns nothing (Tier 0)', async () => {
      const root = fixture({ 'main.go': GO_BROKEN });
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs().fsProvider,
        realParser,
      );

      await provider.getDiagnostics(root, { files: [abs(root, 'main.go')] });

      for (const start of [
        childProcess.spawn,
        childProcess.spawnSync,
        childProcess.exec,
        childProcess.execFile,
        childProcess.execSync,
        childProcess.execFileSync,
        childProcess.fork,
      ]) {
        expect(start).not.toHaveBeenCalled();
      }
    });
  });

  describe('unscoped calls', () => {
    // Edge case (batches.md "Plan validation"): unscoped Python → unchecked.
    it('reports a Python-only project as unavailable with its files unchecked, and parses nothing', async () => {
      const root = fixture({ 'app/a.py': PY_BROKEN, 'app/b.py': PY_CLEAN });
      const parser = scriptedParser();
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(NO_TSCONFIG),
        diskFs([abs(root, 'app/a.py'), abs(root, 'app/b.py')]).fsProvider,
        parser,
      );

      const result = await provider.getDiagnostics(root);

      expect(parser.queryMulti).not.toHaveBeenCalled();
      expect(result.status).toBe('unavailable');
      if (result.status !== 'unavailable') return;
      expect(result.reason).toBe(
        'No tsconfig.json found under workspace root. Not checked: 2 python files (The syntax check runs only on requested files: pass `files` to check them.).',
      );
      expect(result.coverage).toMatchObject({
        clean: false,
        reasons: ['unchecked'],
        census: 'complete',
        analyzed: 0,
        unchecked: 2,
        excluded: null,
      });
      expect(result.coverage?.checks).toBeUndefined();
      expect(result.notChecked).toEqual([
        {
          language: 'python',
          count: 2,
          reason:
            'The syntax check runs only on requested files: pass `files` to check them.',
        },
      ]);
    });

    it('qualifies a clean type check of a mixed TS/Python repo: the Python files are unchecked', async () => {
      const root = fixture({});
      const inner = fakeTypeScript(TS_CLEAN);
      const provider = new LanguageAwareDiagnosticsProvider(
        inner,
        diskFs([
          abs(root, 'web/a.ts'),
          abs(root, 'api/main.py'),
          abs(root, 'svc/Widget.php'),
        ]).fsProvider,
        scriptedParser(),
      );

      const result = await provider.getDiagnostics(root);

      // The unscoped type check keeps its own lane: no scope is passed.
      expect(inner.getDiagnostics).toHaveBeenCalledWith(root);
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.diagnostics).toEqual([]);
      expect(result.coverage).toMatchObject({
        clean: false,
        reasons: ['unchecked', 'unsupported'],
        analyzed: null,
        unchecked: 1,
        unsupported: 1,
        unsupportedByLanguage: { php: 1 },
        checks: 'type-check',
      });
      expect(result.notChecked?.map((group) => group.language)).toEqual([
        'python',
        'php',
      ]);
    });

    it('keeps a TS-only repo clean', async () => {
      const root = fixture({});
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs([abs(root, 'a.ts'), abs(root, 'b.tsx')]).fsProvider,
        scriptedParser(),
      );

      const result = await provider.getDiagnostics(root);

      expect(result.coverage).toMatchObject({
        clean: true,
        checks: 'type-check',
      });
      expect(result.notChecked).toBeUndefined();
    });

    it('discovers once per root with the vendor excludes and one past the limit; invalidate drops it', async () => {
      const root = fixture({});
      const inner = fakeTypeScript(TS_CLEAN);
      const { fsProvider, findFiles } = diskFs([abs(root, 'a.py')]);
      const provider = new LanguageAwareDiagnosticsProvider(
        inner,
        fsProvider,
        scriptedParser(),
      );

      await provider.getDiagnostics(root);
      await provider.getDiagnostics(root);
      expect(findFiles).toHaveBeenCalledTimes(1);
      const [glob, excludes, limit, cwd] = findFiles.mock
        .calls[0] as unknown as [string, string[], number, string];
      expect(glob).toContain('[pP][yY]');
      expect(excludes).toEqual(
        expect.arrayContaining([
          '**/node_modules/**',
          '**/.venv/**',
          '**/site-packages/**',
        ]),
      );
      expect(limit).toBe(CENSUS_LIMIT + 1);
      expect(cwd).toBe(root);

      provider.invalidate(root);
      expect(inner.invalidate).toHaveBeenCalledWith(root);
      await provider.getDiagnostics(root);
      expect(findFiles).toHaveBeenCalledTimes(2);
    });

    it('reports a census past the limit as truncated', async () => {
      const root = fixture({});
      const many = Array.from(
        { length: CENSUS_LIMIT + 1 },
        (_, i) => `${root}/f${i}.ts`,
      );
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs(many).fsProvider,
        scriptedParser(),
      );

      const result = await provider.getDiagnostics(root);

      expect(result.coverage).toMatchObject({
        clean: false,
        census: 'truncated',
        censusLimit: CENSUS_LIMIT,
      });
    });

    it('turns a failed discovery into an unknown census, never clean, and retries it next call', async () => {
      const root = fixture({});
      let calls = 0;
      const { fsProvider, findFiles } = diskFs(async () => {
        calls++;
        if (calls === 1) {
          throw new IncompleteFileSearchError([], {
            total: 1,
            byCode: { ENOENT: 1 },
          });
        }
        return [abs(root, 'a.ts')];
      });
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        fsProvider,
        scriptedParser(),
      );

      const first = await provider.getDiagnostics(root);
      expect(first.status).toBe('available');
      expect(first.coverage).toMatchObject({
        clean: false,
        reasons: ['census?', 'unchecked?', 'failed?'],
        census: 'unknown',
        unchecked: null,
      });

      const second = await provider.getDiagnostics(root);
      expect(findFiles).toHaveBeenCalledTimes(2);
      expect(second.coverage).toMatchObject({ clean: true });
    });

    it('answers with an unknown census when discovery outlasts its budget', async () => {
      jest.useFakeTimers();
      const root = fixture({});
      const provider = new LanguageAwareDiagnosticsProvider(
        fakeTypeScript(TS_CLEAN),
        diskFs(() => new Promise<string[]>(() => undefined)).fsProvider,
        scriptedParser(),
      );

      const pending = provider.getDiagnostics(root);
      await jest.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.status).toBe('available');
      expect(result.coverage).toMatchObject({
        clean: false,
        census: 'unknown',
      });
    });

    // Review B25A-R1-M1: a discovery still running is shared, never expired
    // or evicted into a second walk; the TTL runs from when it settled.
    describe('a discovery still running', () => {
      /** A `findFiles` whose every walk stays pending until settled by hand. */
      function heldWalks(): {
        fsProvider: IFileSystemProvider;
        findFiles: jest.Mock;
        walks: Array<(files: string[]) => void>;
      } {
        const walks: Array<(files: string[]) => void> = [];
        const { fsProvider, findFiles } = diskFs(
          () => new Promise<string[]>((resolve) => walks.push(resolve)),
        );
        return { fsProvider, findFiles, walks };
      }

      it('is shared by retries past the TTL; after it settles the TTL runs from then and one re-walk follows', async () => {
        jest.useFakeTimers();
        const root = fixture({});
        const { fsProvider, findFiles, walks } = heldWalks();
        const provider = new LanguageAwareDiagnosticsProvider(
          fakeTypeScript(TS_CLEAN),
          fsProvider,
          scriptedParser(),
        );

        const answers: Array<Promise<DiagnosticsResult>> = [];
        for (let retry = 0; retry < 3; retry++) {
          answers.push(provider.getDiagnostics(root));
          await jest.advanceTimersByTimeAsync(60_001);
        }
        expect(findFiles).toHaveBeenCalledTimes(1);
        for (const answer of await Promise.all(answers)) {
          expect(answer.coverage).toMatchObject({ census: 'unknown' });
        }

        walks[0]([abs(root, 'a.py')]);
        await jest.advanceTimersByTimeAsync(0);
        const settled = await provider.getDiagnostics(root);
        expect(settled.coverage).toMatchObject({
          census: 'complete',
          unchecked: 1,
        });
        await jest.advanceTimersByTimeAsync(59_999);
        await provider.getDiagnostics(root);
        expect(findFiles).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        const rewalk = provider.getDiagnostics(root);
        const retry = provider.getDiagnostics(root);
        expect(findFiles).toHaveBeenCalledTimes(2);
        walks[1]([]);
        await Promise.all([rewalk, retry]);
      });

      it('is not evicted by other roots settling past the cache cap', async () => {
        const held = fixture({});
        const others = Array.from({ length: 8 }, () => fixture({}));
        let walks = 0;
        let settleHeld: (files: string[]) => void = () => undefined;
        const { fsProvider, findFiles } = diskFs(() => {
          walks++;
          return walks === 1
            ? new Promise<string[]>((resolve) => (settleHeld = resolve))
            : Promise.resolve([]);
        });
        const provider = new LanguageAwareDiagnosticsProvider(
          fakeTypeScript(TS_CLEAN),
          fsProvider,
          scriptedParser(),
        );

        const first = provider.getDiagnostics(held);
        for (const other of others) await provider.getDiagnostics(other);
        const second = provider.getDiagnostics(held);

        expect(findFiles).toHaveBeenCalledTimes(1 + others.length);
        settleHeld([]);
        await Promise.all([first, second]);
      });

      // Review B25A-R2-B1: a walk an invalidate overtook stays the one walk
      // of its root, but its count is never served: it may predate the change.
      it('stays shared after invalidate, answers census unknown (never clean) and is not cached: the next call walks again', async () => {
        const root = fixture({});
        const { fsProvider, findFiles, walks } = heldWalks();
        const provider = new LanguageAwareDiagnosticsProvider(
          fakeTypeScript(TS_CLEAN),
          fsProvider,
          scriptedParser(),
        );

        const first = provider.getDiagnostics(root);
        provider.invalidate(root);
        const joined = provider.getDiagnostics(root);
        expect(findFiles).toHaveBeenCalledTimes(1);

        walks[0]([abs(root, 'a.py')]);
        for (const answer of await Promise.all([first, joined])) {
          expect(answer.coverage).toMatchObject({
            clean: false,
            census: 'unknown',
          });
        }
        const next = provider.getDiagnostics(root);
        expect(findFiles).toHaveBeenCalledTimes(2);
        walks[1]([]);
        await next;
      });

      it.each([
        ['root', (root: string) => root],
        ['global', () => undefined],
      ] as const)(
        'never answers clean from a walk that started before a %s invalidate and a file added after it',
        async (_scope, invalidated) => {
          const root = fixture({ 'a.ts': 'export {};\n' });
          const { fsProvider, findFiles, walks } = heldWalks();
          const provider = new LanguageAwareDiagnosticsProvider(
            fakeTypeScript(TS_CLEAN),
            fsProvider,
            scriptedParser(),
          );

          const before = provider.getDiagnostics(root);
          provider.invalidate(invalidated(root));
          fs.writeFileSync(path.join(root, 'b.py'), PY_CLEAN, 'utf-8');
          const after = provider.getDiagnostics(root);
          // The held walk read the tree before b.py existed.
          walks[0]([abs(root, 'a.ts')]);

          for (const answer of await Promise.all([before, after])) {
            expect(answer.coverage).toMatchObject({
              clean: false,
              census: 'unknown',
            });
          }
          expect(findFiles).toHaveBeenCalledTimes(1);

          const next = provider.getDiagnostics(root);
          walks[1]([abs(root, 'a.ts'), abs(root, 'b.py')]);
          expect((await next).coverage).toMatchObject({
            clean: false,
            census: 'complete',
            unchecked: 1,
          });
          expect(findFiles).toHaveBeenCalledTimes(2);
        },
      );

      // Review B25A-R3-B1: the census validity fence runs at answer assembly,
      // so an invalidate after the walk settled still retracts its count.
      it.each([
        ['root', (root: string) => root],
        ['global', () => undefined],
      ] as const)(
        'never answers clean to a caller after a %s invalidate that lands while the settled walk is being published, at any microtask turn',
        async (_scope, invalidated) => {
          for (let turns = 0; turns <= 6; turns++) {
            const root = fixture({ 'a.ts': 'export {};\n' });
            const { fsProvider, walks } = heldWalks();
            const provider = new LanguageAwareDiagnosticsProvider(
              fakeTypeScript(TS_CLEAN),
              fsProvider,
              scriptedParser(),
            );

            const before = provider.getDiagnostics(root);
            walks[0]([abs(root, 'a.ts')]);
            for (let turn = 0; turn < turns; turn++) await Promise.resolve();
            fs.writeFileSync(path.join(root, 'new.py'), PY_CLEAN, 'utf-8');
            provider.invalidate(invalidated(root));
            const after = provider.getDiagnostics(root);
            // A walk started after the invalidate sees the new file.
            walks[1]?.([abs(root, 'a.ts'), abs(root, 'new.py')]);
            const answer = await after;
            await before;

            expect({ turns, clean: answer.coverage?.clean }).toEqual({
              turns,
              clean: false,
            });
            if (answer.coverage?.census !== 'unknown') {
              expect(answer.coverage).toMatchObject({ unchecked: 1 });
            }
          }
        },
      );

      it.each([
        ['root', (root: string) => root],
        ['global', () => undefined],
      ] as const)(
        'never publishes a settled census as clean when a %s invalidate lands while the type check is still running',
        async (_scope, invalidated) => {
          const root = fixture({ 'a.ts': 'export {};\n' });
          const { fsProvider, walks } = heldWalks();
          let answerTypeCheck: (result: DiagnosticsResult) => void = () =>
            undefined;
          const inner: IDiagnosticsProvider = {
            getDiagnostics: () =>
              new Promise<DiagnosticsResult>(
                (resolve) => (answerTypeCheck = resolve),
              ),
          };
          const provider = new LanguageAwareDiagnosticsProvider(
            inner,
            fsProvider,
            scriptedParser(),
          );

          const pending = provider.getDiagnostics(root);
          walks[0]([abs(root, 'a.ts')]);
          // The census settles and is accepted; the type check still runs.
          await new Promise<void>((resolve) => setImmediate(resolve));
          fs.writeFileSync(path.join(root, 'new.py'), PY_CLEAN, 'utf-8');
          provider.invalidate(invalidated(root));
          answerTypeCheck(TS_CLEAN());

          expect((await pending).coverage).toMatchObject({
            clean: false,
            census: 'unknown',
          });
        },
      );

      // Review B25A-R4-M1: a generation record per distinct invalidated root
      // is bounded, and the bound never reopens the fence.
      describe('root generation records', () => {
        function rootRecords(
          provider: LanguageAwareDiagnosticsProvider,
        ): number {
          return (
            provider as unknown as {
              readonly rootInvalidatedAt: ReadonlyMap<string, number>;
            }
          ).rootInvalidatedAt.size;
        }

        it('stay bounded across 10,000 distinct root invalidations with nothing pending or cached', () => {
          const provider = new LanguageAwareDiagnosticsProvider(
            fakeTypeScript(TS_CLEAN),
            diskFs().fsProvider,
            scriptedParser(),
          );
          const base = path.join(os.tmpdir(), 'ptah-retired-roots');

          for (let i = 0; i < 10_000; i++) {
            provider.invalidate(path.join(base, `root-${i}`));
            expect(rootRecords(provider)).toBeLessThanOrEqual(
              ROOT_GENERATIONS_MAX,
            );
          }
          expect(rootRecords(provider)).toBeGreaterThan(0);
        });

        it('a rollover past the bound still fences a census read before the root was invalidated', async () => {
          const root = fixture({ 'a.ts': 'export {};\n' });
          const { fsProvider, findFiles, walks } = heldWalks();
          let answerTypeCheck: (result: DiagnosticsResult) => void = () =>
            undefined;
          const inner: IDiagnosticsProvider = {
            getDiagnostics: () =>
              new Promise<DiagnosticsResult>(
                (resolve) => (answerTypeCheck = resolve),
              ),
          };
          const provider = new LanguageAwareDiagnosticsProvider(
            inner,
            fsProvider,
            scriptedParser(),
          );

          const pending = provider.getDiagnostics(root);
          walks[0]([abs(root, 'a.ts')]);
          await new Promise<void>((resolve) => setImmediate(resolve));
          fs.writeFileSync(path.join(root, 'new.py'), PY_CLEAN, 'utf-8');
          provider.invalidate(root);
          // Enough other roots to force the rollover that drops `root`'s record.
          const others = path.join(os.tmpdir(), 'ptah-other-roots');
          for (let i = 0; i <= ROOT_GENERATIONS_MAX; i++) {
            provider.invalidate(path.join(others, `root-${i}`));
          }
          answerTypeCheck(TS_CLEAN());

          expect((await pending).coverage).toMatchObject({
            clean: false,
            census: 'unknown',
          });
          // The next call walks again and counts the new file.
          const next = provider.getDiagnostics(root);
          await new Promise<void>((resolve) => setImmediate(resolve));
          walks[1]([abs(root, 'a.ts'), abs(root, 'new.py')]);
          answerTypeCheck(TS_CLEAN());
          expect((await next).coverage).toMatchObject({
            clean: false,
            census: 'complete',
            unchecked: 1,
          });
          expect(findFiles).toHaveBeenCalledTimes(2);
        });
      });
    });
  });

  it('is what registerTypeScriptDiagnosticsProvider registers, around the TypeScript provider', async () => {
    const container = rootContainer.createChildContainer();
    const { fsProvider } = diskFs();
    container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
      useValue: fsProvider,
    });
    container.register(TOKENS.TREE_SITTER_PARSER_SERVICE, {
      useValue: scriptedParser(),
    });

    registerTypeScriptDiagnosticsProvider(container, logger);

    const provider = container.resolve<IDiagnosticsProvider>(
      PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER,
    );
    expect(provider).toBeInstanceOf(LanguageAwareDiagnosticsProvider);
    // A Python file is syntax-checked, not handed to the compiler.
    const root = fixture({ 'a.py': PY_CLEAN });
    const result = await provider.getDiagnostics(root, {
      files: [abs(root, 'a.py')],
    });
    expect(result.coverage).toMatchObject({ checks: 'syntax-only' });
  });
});
