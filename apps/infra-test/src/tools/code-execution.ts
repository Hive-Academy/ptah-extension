/**
 * Code Execution Engine for standalone MCP server
 *
 * Executes TypeScript/JavaScript code with AsyncFunction and timeout protection.
 * Based on the production implementation in vscode-lm-tools.
 */

import type { PtahAPI } from '../types';

/**
 * Execute TypeScript code with AsyncFunction
 * Timeout protection via Promise.race()
 */
export async function executeCode(
  code: string,
  timeout: number,
  ptahAPI: PtahAPI
): Promise<unknown> {
  // Create async function with ptah API in scope
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  const wrappedCode = wrapCodeForExecution(code);

  const asyncFunction = new AsyncFunction(
    'ptah',
    `
    'use strict';
    ${wrappedCode}
  `
  ) as (ptah: PtahAPI) => Promise<unknown>;

  // Execute with timeout protection
  let executionPromise = asyncFunction(ptahAPI);

  // Handle nested Promises (from IIFEs that return Promises)
  executionPromise = executionPromise.then(async (result: unknown) => {
    let unwrapped = result;
    for (
      let i = 0;
      i < 3 &&
      unwrapped &&
      typeof (unwrapped as Promise<unknown>).then === 'function';
      i++
    ) {
      unwrapped = await unwrapped;
    }
    return unwrapped;
  });

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Execution timeout (${timeout}ms)`)),
      timeout
    );
  });

  return Promise.race([executionPromise, timeoutPromise]);
}

/**
 * Smart code wrapping for execution
 */
export function wrapCodeForExecution(code: string): string {
  const trimmed = code.trim();

  // Pattern 1: Already starts with 'return' - use as-is
  if (/^return\s/.test(trimmed)) {
    return code;
  }

  // Pattern 2: IIFE pattern
  const iifePattern =
    /^\((?:async\s+)?(?:function\s*\(|(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>)/;
  if (iifePattern.test(trimmed)) {
    return `return ${code}`;
  }

  // Pattern 3: Starts with variable declaration
  if (/^(const|let|var)\s/.test(trimmed)) {
    if (/\breturn\b/.test(trimmed)) {
      return `return (async function() { ${code} })()`;
    } else {
      const statements = trimmed
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (statements.length > 0) {
        const lastStatement = statements[statements.length - 1];
        if (
          !/^(const|let|var|if|for|while|switch|try|function|class)\s/.test(
            lastStatement
          )
        ) {
          statements[statements.length - 1] = `return ${lastStatement}`;
        }
        return `return (async function() { ${statements.join('; ')}; })()`;
      }
    }
  }

  // Pattern 4: Simple expression - add return
  return `return ${code}`;
}

/**
 * Serialize result to string for MCP response
 */
export function serializeResult(result: unknown): string {
  if (result === undefined) {
    return 'undefined';
  }

  if (result === null) {
    return 'null';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
