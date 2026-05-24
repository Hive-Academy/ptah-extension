/**
 * Code Execution Engine
 *
 * Executes TypeScript/JavaScript code with AsyncFunction and timeout protection.
 * Provides smart code wrapping for various execution patterns.
 * Includes runtime API validation proxy to catch invalid method calls early.
 */

import { Logger } from '@ptah-extension/vscode-core';
import { PtahAPI } from '../types';

/**
 * Dependencies for code execution
 */
export interface CodeExecutionDependencies {
  ptahAPI: PtahAPI;
  logger: Logger;
}

/**
 * Execute TypeScript code with AsyncFunction (no VM2)
 * Timeout protection via Promise.race()
 *
 * Security: Extension Host provides sandbox, we trust our own code
 * Performance: Direct execution (no VM2 overhead)
 */
export async function executeCode(
  code: string,
  timeout: number,
  deps: CodeExecutionDependencies,
): Promise<unknown> {
  const { ptahAPI, logger } = deps;

  logger.info(`Executing code (timeout: ${timeout}ms)`, 'CodeExecutionMCP', {
    codePreview: code.substring(0, 100),
  });

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  const wrappedCode = wrapCodeForExecution(code);

  logger.debug('Wrapped code for execution', 'CodeExecutionMCP', {
    original: code.substring(0, 100),
    wrapped: wrappedCode.substring(0, 150),
  });

  const asyncFunction = new AsyncFunction(
    'ptah',
    'console',
    'require',
    'process',
    'global',
    'globalThis',
    'Buffer',
    '__dirname',
    '__filename',
    `
    'use strict';
    ${wrappedCode}
  `,
  ) as (
    ptah: PtahAPI,
    console: Console,
    require: NodeRequire,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    __dirname: undefined,
    __filename: undefined,
  ) => Promise<unknown>;
  const validatedAPI = createValidatedProxy(ptahAPI);
  const sandboxConsole = console;
  const sandboxRequire = ((moduleName: string) => {
    throw new Error(
      `require('${moduleName}') is not available in the Ptah sandbox. ` +
        `Use ptah.* APIs instead. For example: ptah.files.read(path), ptah.search.findFiles(pattern), ptah.workspace.analyze()`,
    );
  }) as unknown as NodeRequire;
  let executionPromise = asyncFunction(
    validatedAPI,
    sandboxConsole,
    sandboxRequire,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  executionPromise = executionPromise.then(async (result: unknown) => {
    let unwrapped = result;
    for (
      let i = 0;
      i < 3 &&
      unwrapped &&
      typeof (unwrapped as Record<string, unknown>)['then'] === 'function';
      i++
    ) {
      unwrapped = await (unwrapped as Promise<unknown>);
    }
    return unwrapped;
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Execution timeout (${timeout}ms)`)),
      timeout,
    );
  });

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);

    logger.info('Code execution successful', 'CodeExecutionMCP', {
      resultType: typeof result,
    });

    return result;
  } catch (error) {
    logger.error(
      'Code execution failed',
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

/**
 * Smart code wrapping for execution
 *
 * Analyzes the code pattern and wraps it appropriately:
 * - Simple expressions -> add `return`
 * - Already has return -> use as-is
 * - IIFE expressions -> add `return` to capture result
 * - Multi-statement code -> wrap in async IIFE
 * - Variable declarations at top level -> wrap in async IIFE
 */
export function wrapCodeForExecution(code: string): string {
  const trimmed = code.trim();
  if (/^return\s/.test(trimmed)) {
    return code;
  }
  const iifePattern =
    /^\((?:async\s+)?(?:function\s*\(|(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>)/;
  if (iifePattern.test(trimmed)) {
    return `return ${code}`;
  }
  if (/^(const|let|var)\s/.test(trimmed)) {
    if (/\breturn\b/.test(trimmed)) {
      return `return (async function() { ${code} })()`;
    } else {
      const statements = trimmed
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s);
      if (statements.length > 0) {
        const lastStatement = statements[statements.length - 1];
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(lastStatement)) {
          return `return (async function() { ${trimmed}; return ${lastStatement}; })()`;
        }
      }
      return `return (async function() { ${code} })()`;
    }
  }
  if (/^await\s/.test(trimmed)) {
    return `return ${code}`;
  }
  const withoutStrings = trimmed.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''); // Remove string literals
  if (withoutStrings.includes(';') && !withoutStrings.endsWith(';')) {
    return `return (async function() { ${code} })()`;
  }
  if ((withoutStrings.match(/;/g) || []).length > 1) {
    return `return (async function() { ${code} })()`;
  }
  return `return ${code}`;
}

/**
 * Create a validated proxy around the PtahAPI that intercepts property access
 * and throws clear, actionable errors when invalid namespaces or methods are accessed.
 *
 * This prevents "is not a function" and "is not defined" errors by catching them
 * at the point of access with helpful messages listing available alternatives.
 */
function createValidatedProxy(ptahAPI: PtahAPI): PtahAPI {
  const registry = new Map<string, string[]>();
  for (const [ns, value] of Object.entries(ptahAPI)) {
    if (typeof value === 'object' && value !== null) {
      const methods = Object.keys(value).filter(
        (k) => typeof (value as Record<string, unknown>)[k] === 'function',
      );
      const subNamespaces: string[] = [];
      for (const [subNs, subValue] of Object.entries(value)) {
        if (typeof subValue === 'object' && subValue !== null) {
          const subMethods = Object.keys(subValue).filter(
            (k) =>
              typeof (subValue as Record<string, unknown>)[k] === 'function',
          );
          if (subMethods.length > 0) {
            registry.set(`${ns}.${subNs}`, subMethods);
            subNamespaces.push(subNs);
          }
        }
      }

      registry.set(ns, [...methods, ...subNamespaces]);
    }
  }

  return new Proxy(ptahAPI, {
    get(target, prop: string | symbol) {
      if (prop === 'help' || typeof prop === 'symbol') {
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      }

      const propStr = prop as string;
      const value = (target as unknown as Record<string, unknown>)[propStr];
      if (value === undefined) {
        const available = Array.from(registry.keys()).join(', ');
        throw new TypeError(
          `"ptah.${propStr}" namespace does not exist. Available namespaces: ${available}`,
        );
      }

      if (typeof value === 'object' && value !== null) {
        return createNamespaceProxy(
          value as Record<string, unknown>,
          propStr,
          registry,
        );
      }
      return value;
    },
  }) as PtahAPI;
}

/**
 * Create a proxy for a namespace object that validates method access.
 * Recursively wraps sub-namespaces (e.g., ptah.ide.lsp).
 */
function createNamespaceProxy(
  ns: Record<string, unknown>,
  nsName: string,
  registry: Map<string, string[]>,
): unknown {
  return new Proxy(ns, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return target[prop as unknown as string];
      }

      const propStr = prop as string;
      const value = target[propStr];
      if (value === undefined) {
        const methods = registry.get(nsName) || Object.keys(target);
        throw new TypeError(
          `"ptah.${nsName}.${propStr}" is not available. ` +
            `Available on ptah.${nsName}: ${methods.join(', ')}`,
        );
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>)['then'] !== 'function'
      ) {
        return createNamespaceProxy(
          value as Record<string, unknown>,
          `${nsName}.${propStr}`,
          registry,
        );
      }
      return value;
    },
  });
}

/** Maximum result size in characters (50KB) to prevent context window blowup */
const MAX_RESULT_SIZE = 50 * 1024;

/**
 * Serialize execution result for MCP response
 */
export function serializeResult(result: unknown): string {
  let serialized: string;

  if (result === undefined) {
    serialized = 'undefined';
  } else if (result === null) {
    serialized = 'null';
  } else if (typeof result === 'string') {
    serialized = result;
  } else {
    try {
      serialized = JSON.stringify(result, null, 2);
    } catch {
      serialized = String(result);
    }
  }

  if (serialized.length > MAX_RESULT_SIZE) {
    const originalLength = serialized.length;
    serialized =
      serialized.substring(0, MAX_RESULT_SIZE) +
      `\n\n[TRUNCATED: Result was ${originalLength} chars, showing first ${MAX_RESULT_SIZE} chars. Use more specific queries to reduce output size.]`;
  }

  return serialized;
}
