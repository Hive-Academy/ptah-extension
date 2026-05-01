/**
 * Unit tests for code-execution.engine
 *
 * Covers:
 * - executeCode: sandboxed execution, namespace injection, timeout
 * - wrapCodeForExecution: pattern detection and code wrapping
 * - serializeResult: result coercion and truncation
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  executeCode,
  serializeResult,
  wrapCodeForExecution,
  type CodeExecutionDependencies,
} from './code-execution.engine';
import type { PtahAPI } from '../types';

function createMockLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createMinimalPtahAPI(): PtahAPI {
  // Use a typed partial that satisfies the proxy's introspection loop.
  const api = {
    workspace: {
      getInfo: jest.fn(async () => ({ projectType: 'test' })),
      getProjectType: jest.fn(async () => 'test'),
      getFrameworks: jest.fn(async () => []),
      analyze: jest.fn(async () => ({ info: undefined, structure: null })),
    },
    files: {
      read: jest.fn(async (p: string) => `contents of ${p}`),
      readJson: jest.fn(async () => ({})),
      list: jest.fn(async () => []),
    },
    help: jest.fn(async (_topic?: string) => 'help text'),
  };
  return api as unknown as PtahAPI;
}

describe('wrapCodeForExecution', () => {
  it('adds return to simple expressions', () => {
    expect(wrapCodeForExecution('1 + 1')).toBe('return 1 + 1');
  });

  it('passes through code that already starts with return', () => {
    expect(wrapCodeForExecution('return 42')).toBe('return 42');
  });

  it('adds return to async IIFE (async function form)', () => {
    const code = '(async function() { return 1; })()';
    expect(wrapCodeForExecution(code)).toBe(`return ${code}`);
  });

  it('adds return to async arrow IIFE', () => {
    const code = '(async () => { return 1; })()';
    expect(wrapCodeForExecution(code)).toBe(`return ${code}`);
  });

  it('wraps const declarations with return in async IIFE', () => {
    const code = 'const x = 1; return x;';
    const wrapped = wrapCodeForExecution(code);
    expect(wrapped).toMatch(/^return \(async function\(\) \{/);
    expect(wrapped).toContain(code);
  });

  it('wraps const declarations without return, returning last identifier', () => {
    const code = 'const x = 5; x';
    const wrapped = wrapCodeForExecution(code);
    expect(wrapped).toContain('return x');
    expect(wrapped).toMatch(/async function/);
  });

  it('adds return to await expressions', () => {
    expect(wrapCodeForExecution('await fetch("a")')).toBe(
      'return await fetch("a")',
    );
  });

  it('wraps multi-statement code in async IIFE', () => {
    const code = 'foo(); bar(); baz()';
    const wrapped = wrapCodeForExecution(code);
    expect(wrapped).toMatch(/^return \(async function\(\)/);
  });

  it('does not treat semicolon-free single expressions as multi-statement', () => {
    expect(wrapCodeForExecution('ptah.workspace.getInfo()')).toBe(
      'return ptah.workspace.getInfo()',
    );
  });
});

describe('serializeResult', () => {
  it('serializes undefined as "undefined" literal', () => {
    expect(serializeResult(undefined)).toBe('undefined');
  });

  it('serializes null as "null" literal', () => {
    expect(serializeResult(null)).toBe('null');
  });

  it('passes strings through verbatim', () => {
    expect(serializeResult('hello')).toBe('hello');
  });

  it('JSON-stringifies objects with indentation', () => {
    expect(serializeResult({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('handles circular references without throwing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(() => serializeResult(circular)).not.toThrow();
    const result = serializeResult(circular);
    expect(typeof result).toBe('string');
  });

  it('truncates large results with explicit marker', () => {
    const big = 'x'.repeat(60 * 1024);
    const out = serializeResult(big);
    expect(out.length).toBeLessThan(big.length + 1024);
    expect(out).toContain('[TRUNCATED:');
  });

  it('does not truncate results under the limit', () => {
    const s = 'y'.repeat(100);
    expect(serializeResult(s)).toBe(s);
  });
});

describe('executeCode', () => {
  let deps: CodeExecutionDependencies;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = createMockLogger();
    deps = { ptahAPI: createMinimalPtahAPI(), logger };
  });

  // NOTE: The engine relies on native AsyncFunction support. In the Jest
  // environment (target es2015 + ts-jest), `Object.getPrototypeOf(async fn)`
  // resolves to Function, not AsyncFunction, so sandboxed bodies cannot use
  // top-level `await` or return sync values. All executeCode tests below
  // supply code that produces a real Promise via IIFEs or API calls.

  it('executes a simple async IIFE expression and returns its value', async () => {
    const result = await executeCode(
      '(async function() { return 1 + 2; })()',
      5000,
      deps,
    );
    expect(result).toBe(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Executing code'),
      'CodeExecutionMCP',
      expect.any(Object),
    );
  });

  it('injects validated ptah namespace and resolves async calls', async () => {
    const result = await executeCode(
      'ptah.workspace.getProjectType()',
      5000,
      deps,
    );
    expect(result).toBe('test');
  });

  it('throws TypeError when accessing unknown ptah namespace', async () => {
    await expect(
      executeCode(
        '(async function() { return ptah.doesNotExist; })()',
        5000,
        deps,
      ),
    ).rejects.toThrow(/namespace does not exist/);
    expect(logger.error).toHaveBeenCalled();
  });

  it('throws TypeError when accessing unknown method on valid namespace', async () => {
    await expect(
      executeCode(
        '(async function() { return ptah.workspace.bogusMethod(); })()',
        5000,
        deps,
      ),
    ).rejects.toThrow(/ptah\.workspace\.bogusMethod/);
  });

  it('rejects when require() is called in the sandbox', async () => {
    await expect(
      executeCode(
        '(async function() { return require("fs"); })()',
        5000,
        deps,
      ),
    ).rejects.toThrow(/require\('fs'\) is not available/);
  });

  it('shadows process/global with undefined in the sandbox', async () => {
    await expect(
      executeCode(
        '(async function() { return typeof process; })()',
        5000,
        deps,
      ),
    ).resolves.toBe('undefined');
  });

  it('times out execution exceeding the timeout budget', async () => {
    await expect(
      executeCode(
        '(async function() { await new Promise(r => setTimeout(r, 200)); })()',
        50,
        deps,
      ),
    ).rejects.toThrow(/Execution timeout \(50ms\)/);
  });

  it('handles IIFE pattern that returns a value', async () => {
    const result = await executeCode(
      '(async function() { return 42; })()',
      5000,
      deps,
    );
    expect(result).toBe(42);
  });

  it('logs successful execution with result type', async () => {
    await executeCode(
      '(async function() { return "done"; })()',
      5000,
      deps,
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Code execution successful',
      'CodeExecutionMCP',
      expect.objectContaining({ resultType: 'string' }),
    );
  });
});
