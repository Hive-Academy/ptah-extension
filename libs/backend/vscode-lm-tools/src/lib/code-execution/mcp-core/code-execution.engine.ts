/**
 * Code Execution Engine
 *
 * Executes AI-generated TypeScript/JavaScript inside a genuinely isolated V8
 * realm (`node:vm` context) with timeout protection and smart code wrapping.
 *
 * SECURITY (TASK_2026_193)
 * ------------------------
 * `execute_code` runs model-influenced code. The previous implementation ran it
 * with `new AsyncFunction(...)` in the host realm and merely shadowed
 * `process`/`global`/`globalThis` as `undefined` parameters. That shadowing was
 * defeated by `({}).constructor.constructor` (the host `Function` constructor),
 * which recompiles code in the *host global scope* where `process` is a real
 * global. From there `process.getBuiltinModule('child_process').execSync(...)`,
 * `process.binding('spawn_sync').spawn(...)` and `process.env` were all
 * reachable — a live RCE + secret-exfiltration escape.
 *
 * The fix runs the code in a fresh `vm` context whose global scope has NO
 * `process`/`require`/`global`. In that realm `({}).constructor.constructor`
 * resolves to the *context's* `Function`, which compiles in the context global
 * scope — where `process` does not exist, so the escape dead-ends.
 *
 * The `ptah` API stays fully usable through a marshaling membrane: only ONE
 * host reference (an argument bridge) ever crosses the boundary, and it is held
 * in a closure that is unreachable from the sandbox's global graph. Every value
 * that crosses the membrane is marshaled as a JSON string, so no host object,
 * host function, host promise, or host Error reference is ever handed to
 * sandbox code (each of those would re-open the realm via `.constructor`).
 *
 * NOTE: `node:vm` is a strong barrier against the known copy-paste gadgets but
 * is not a provable security boundary (V8 contextify bugs have existed). For
 * fully-untrusted input a worker/child-process isolate is the recommended
 * next step; see `.ptah/specs/TASK_2026_193/findings.md`.
 */

import * as vm from 'node:vm';

import { Logger } from '@ptah-extension/vscode-core';
import { PtahAPI } from '../types';

/**
 * Dependencies for code execution
 */
export interface CodeExecutionDependencies {
  ptahAPI: PtahAPI;
  logger: Logger;
}

/** Max depth walked when describing the ptah API surface for the sandbox mirror. */
const MAX_API_SHAPE_DEPTH = 6;

/**
 * In-context bootstrap. Runs ENTIRELY inside the vm realm and returns a `run`
 * function. Receives, as arguments held in closure (never assigned onto the
 * context global object, so sandbox code cannot name them):
 *   - `bridge`      host async fn: (dottedPath, argsJson) => Promise<envelopeJson>
 *   - `logConsole`  host fn: (level, message) => void
 *   - `shapeJson`   JSON description of the ptah namespace/method tree
 *
 * Everything the sandbox can touch (the `ptah` mirror, `console`, `require`,
 * return values, thrown errors) is constructed with the context's own
 * intrinsics, so `.constructor.constructor` only ever reaches the context
 * `Function` — which cannot see the host `process`.
 */
const SANDBOX_BOOTSTRAP = `(function (bridge, logConsole, hostTimers, shapeJson) {
  'use strict';
  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  var shape = JSON.parse(shapeJson);

  // Context-native timer wrappers. They forward to the closure-held host timer
  // bridge (unreachable from the sandbox global graph) and only ever return a
  // numeric id, so no host object (Timeout, Function, etc.) crosses the membrane.
  function setTimeoutCtx(cb, ms) { return hostTimers.setTimeout(cb, ms); }
  function clearTimeoutCtx(id) { hostTimers.clearTimeout(id); }
  function setIntervalCtx(cb, ms) { return hostTimers.setInterval(cb, ms); }
  function clearIntervalCtx(id) { hostTimers.clearInterval(id); }
  function queueMicrotaskCtx(cb) { hostTimers.queueMicrotask(cb); }

  var console = {
    log: function () { logConsole('log', argsToText(arguments)); },
    info: function () { logConsole('info', argsToText(arguments)); },
    warn: function () { logConsole('warn', argsToText(arguments)); },
    error: function () { logConsole('error', argsToText(arguments)); },
    debug: function () { logConsole('debug', argsToText(arguments)); },
  };
  function argsToText(args) {
    try { return Array.prototype.join.call(args, ' '); } catch (e) { return ''; }
  }

  function requireStub(moduleName) {
    throw new Error(
      "require('" + String(moduleName) + "') is not available in the Ptah sandbox. " +
      'Use ptah.* APIs instead. For example: ptah.files.read(path), ' +
      'ptah.search.findFiles(pattern), ptah.workspace.analyze()'
    );
  }

  function build(node, prefix) {
    var base = {};
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var path = prefix ? prefix + '.' + key : key;
      if (node[key] === 1) {
        base[key] = makeMethod(path);
      } else {
        base[key] = build(node[key], path);
      }
    }
    return new Proxy(base, {
      get: function (target, prop) {
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'help' || prop in target) {
          return target[prop];
        }
        var available = Object.keys(target).join(', ');
        if (!prefix) {
          throw new TypeError(
            '"ptah.' + String(prop) + '" namespace does not exist. Available namespaces: ' + available
          );
        }
        throw new TypeError(
          '"ptah.' + prefix + '.' + String(prop) + '" is not available. ' +
          'Available on ptah.' + prefix + ': ' + available
        );
      },
    });
  }

  function makeMethod(path) {
    return async function () {
      var argsJson;
      try { argsJson = JSON.stringify(Array.prototype.slice.call(arguments)); }
      catch (e) { argsJson = '[]'; }
      var envelope = JSON.parse(await bridge(path, argsJson));
      if (!envelope.ok) {
        throw new Error(envelope.error);
      }
      return envelope.value;
    };
  }

  var ptah = build(shape, '');
  var STRICT_PREFIX = "'use strict';" + String.fromCharCode(10);

  return function run(src) {
    var fn = new AsyncFunction(
      'ptah', 'console', 'require',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
      STRICT_PREFIX + src
    );
    return fn(
      ptah, console, requireStub,
      setTimeoutCtx, clearTimeoutCtx, setIntervalCtx, clearIntervalCtx, queueMicrotaskCtx
    );
  };
})`;

/**
 * Describe the ptah API surface as a JSON-serialisable tree: `1` marks a
 * callable method, a nested object marks a sub-namespace. Only primitives
 * (this description) cross the membrane at build time — never the API itself.
 */
function describeApiShape(
  api: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  if (api === null || typeof api !== 'object' || depth >= MAX_API_SHAPE_DEPTH) {
    return shape;
  }
  if (seen.has(api as object)) {
    return shape;
  }
  seen.add(api as object);
  for (const [key, value] of Object.entries(api as Record<string, unknown>)) {
    if (typeof value === 'function') {
      shape[key] = 1;
    } else if (value !== null && typeof value === 'object') {
      shape[key] = describeApiShape(value, depth + 1, seen);
    }
  }
  return shape;
}

/**
 * Resolve a dotted path against the real ptah API and return [receiver, method].
 * Returns null when the path does not resolve to a callable.
 */
function resolvePtahMethod(
  api: PtahAPI,
  dottedPath: string,
): [unknown, ((...args: unknown[]) => unknown) | null] {
  const parts = dottedPath.split('.');
  let receiver: unknown = null;
  let current: unknown = api;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return [null, null];
    }
    receiver = current;
    current = (current as Record<string, unknown>)[part];
  }
  return [
    receiver,
    typeof current === 'function'
      ? (current as (...args: unknown[]) => unknown)
      : null,
  ];
}

/**
 * Host-side bridge invoked by the sandbox mirror. NEVER throws or rejects across
 * the membrane: every outcome is marshaled into a JSON envelope string so that
 * no host object/Error reference is handed to sandbox code.
 */
function createBridge(
  ptahAPI: PtahAPI,
): (dottedPath: string, argsJson: string) => Promise<string> {
  const bridge = async (
    dottedPath: string,
    argsJson: string,
  ): Promise<string> => {
    try {
      const [receiver, method] = resolvePtahMethod(ptahAPI, dottedPath);
      if (method === null) {
        return JSON.stringify({
          ok: false,
          error: `ptah.${dottedPath} is not a function`,
        });
      }
      let args: unknown[];
      try {
        const parsed = JSON.parse(argsJson);
        args = Array.isArray(parsed) ? parsed : [];
      } catch {
        args = [];
      }
      const value = await method.apply(receiver, args);
      try {
        return JSON.stringify({
          ok: true,
          value: value === undefined ? null : value,
        });
      } catch {
        // Non-serialisable (e.g. circular) result: fall back to a string form.
        return JSON.stringify({ ok: true, value: String(value) });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ ok: false, error: message });
    }
  };
  // Sever the prototype chain so `bridge.constructor` / `bridge.__proto__`
  // cannot be used to climb back to the host `Function` even if the reference
  // were somehow reached. The bridge stays fully callable (call is an internal
  // slot, independent of the prototype chain).
  Object.setPrototypeOf(bridge, null);
  return bridge;
}

/**
 * Execute code inside an isolated vm realm with the ptah membrane.
 * Timeout protection via Promise.race().
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

  const wrappedCode = wrapCodeForExecution(code);

  logger.debug('Wrapped code for execution', 'CodeExecutionMCP', {
    original: code.substring(0, 100),
    wrapped: wrappedCode.substring(0, 150),
  });

  const bridge = createBridge(ptahAPI);
  const logConsole = (level: string, message: string): void => {
    try {
      logger.debug(`[sandbox console.${level}] ${message}`, 'CodeExecutionMCP');
    } catch {
      /* logging must never break the sandbox */
    }
  };
  Object.setPrototypeOf(logConsole, null);

  const shapeJson = JSON.stringify(describeApiShape(ptahAPI));

  // Host-side timer bridge: the sandbox gets context-native wrappers that only
  // ever receive/return numbers, so no host Timeout/Function object crosses the
  // membrane. All handles are tracked and force-cleared when execution settles,
  // so a sandbox `setInterval`/long `setTimeout` cannot outlive the call.
  const pendingTimers = new Set<NodeJS.Timeout>();
  const timerById = new Map<number, NodeJS.Timeout>();
  let timerSeq = 1;
  const clampDelay = (ms: unknown): number => {
    const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : 0;
    return Math.max(0, Math.min(n, 30000));
  };
  const hostTimers = {
    setTimeout: (cb: () => void, ms: number): number => {
      const id = timerSeq++;
      const handle = setTimeout(() => {
        timerById.delete(id);
        pendingTimers.delete(handle);
        try {
          cb();
        } catch {
          /* a throwing sandbox callback must not crash the host */
        }
      }, clampDelay(ms));
      timerById.set(id, handle);
      pendingTimers.add(handle);
      return id;
    },
    clearTimeout: (id: number): void => {
      const handle = timerById.get(id);
      if (handle) {
        clearTimeout(handle);
        timerById.delete(id);
        pendingTimers.delete(handle);
      }
    },
    setInterval: (cb: () => void, ms: number): number => {
      const id = timerSeq++;
      const handle = setInterval(
        () => {
          try {
            cb();
          } catch {
            /* swallow */
          }
        },
        Math.max(1, clampDelay(ms)),
      );
      timerById.set(id, handle);
      pendingTimers.add(handle);
      return id;
    },
    clearInterval: (id: number): void => {
      const handle = timerById.get(id);
      if (handle) {
        clearInterval(handle);
        timerById.delete(id);
        pendingTimers.delete(handle);
      }
    },
    queueMicrotask: (cb: () => void): void => {
      queueMicrotask(() => {
        try {
          cb();
        } catch {
          /* swallow */
        }
      });
    },
  };

  // Fresh realm per call: no cross-call state, no host globals in scope.
  const context = vm.createContext(Object.create(null));
  const makeRunner = vm.runInContext(SANDBOX_BOOTSTRAP, context, {
    filename: 'ptah-sandbox-bootstrap.js',
  }) as (
    bridge: (path: string, argsJson: string) => Promise<string>,
    logConsole: (level: string, message: string) => void,
    hostTimers: unknown,
    shapeJson: string,
  ) => (src: string) => Promise<unknown>;

  const run = makeRunner(bridge, logConsole, hostTimers, shapeJson);

  let executionPromise = Promise.resolve(run(wrappedCode));
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
  } catch (error: unknown) {
    logger.error(
      'Code execution failed',
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    // Force-clear any timers the sandbox left pending so they cannot fire (and
    // run sandbox code) after the call has settled or timed out.
    for (const handle of pendingTimers) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    pendingTimers.clear();
    timerById.clear();
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
