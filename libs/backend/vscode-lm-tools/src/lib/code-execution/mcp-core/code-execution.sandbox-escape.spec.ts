/**
 * SECURITY REGRESSION GUARD — TASK_2026_193
 *
 * `execute_code` runs model-influenced (AI-generated) code. Historically it ran
 * in the host realm via `new AsyncFunction(...)`, and `({}).constructor.constructor`
 * reached the real Node `process`, giving a live RCE + `process.env` exfiltration
 * escape (`process.getBuiltinModule('child_process')`, `process.binding('spawn_sync')`).
 *
 * The engine now runs code inside an isolated `node:vm` realm behind a JSON
 * marshaling membrane. These tests FAIL the day that isolation regresses — i.e.
 * the day the host `process`, a real `require`/module loader, a spawn capability,
 * or any host-realm object reference becomes reachable from sandbox scope.
 *
 * Do NOT weaken or delete these assertions to make a change compile. If the
 * sandbox boundary must change, the security review in
 * `.ptah/specs/TASK_2026_193/findings.md` must be revisited first.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  executeCode,
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

function createPtahAPI(): PtahAPI {
  const api = {
    workspace: {
      getInfo: jest.fn(async () => ({ projectType: 'test' })),
      getProjectType: jest.fn(async () => 'test'),
    },
    files: {
      read: jest.fn(async (p: string) => `contents of ${p}`),
      // A method that throws, to exercise the error-marshaling path.
      explode: jest.fn(async () => {
        throw new Error('host-side failure detail');
      }),
    },
    help: jest.fn(async () => 'help text'),
  };
  return api as unknown as PtahAPI;
}

/** Run a sandbox expression and return the resolved value. */
function run(expr: string): Promise<unknown> {
  const deps: CodeExecutionDependencies = {
    ptahAPI: createPtahAPI(),
    logger: createMockLogger(),
  };
  return executeCode(`(async function () { ${expr} })()`, 5000, deps);
}

describe('code-execution sandbox escape guard (TASK_2026_193)', () => {
  it('the host process global is NOT visible in the sandbox', async () => {
    await expect(run('return typeof process;')).resolves.toBe('undefined');
    await expect(run('return typeof globalThis.process;')).resolves.toBe(
      'undefined',
    );
  });

  it('({}).constructor.constructor cannot reach the host process', async () => {
    // If this ever resolves to 'object', the realm boundary is broken.
    await expect(
      run(
        'try { return typeof ({}).constructor.constructor("return process")(); }' +
          ' catch (e) { return "BLOCKED"; }',
      ),
    ).resolves.toBe('BLOCKED');
  });

  it('the Function constructor cannot reach a WORKING module loader (require)', async () => {
    // The exact mechanism differs by runtime (bare `require` throws in plain
    // Node, resolves to `undefined` under jest-environment-node) — either way it
    // must NOT be a usable module loader that can pull in child_process.
    const probe =
      'try {' +
      '  const req = ({}).constructor.constructor("return require")();' +
      '  if (typeof req !== "function") return "NO-LOADER";' +
      '  const cp = req("child_process");' +
      '  return (cp && typeof cp.execSync === "function") ? "LOADER-REACHABLE" : "NO-LOADER";' +
      '} catch (e) { return "BLOCKED"; }';
    const result = await run(probe);
    expect(result).not.toBe('LOADER-REACHABLE');
    expect(['NO-LOADER', 'BLOCKED']).toContain(result);
  });

  it('require() inside the sandbox never returns a real module', async () => {
    // The in-realm require stub yields the actionable Ptah message.
    await expect(
      run(
        'try { return require("fs"); } catch (e) { return "REQ:" + e.message; }',
      ),
    ).resolves.toMatch(/require\('fs'\) is not available in the Ptah sandbox/);
  });

  it('no spawn capability (child_process / process.binding) is reachable', async () => {
    // process is undefined in-realm, so any attempt to read a builtin loader or
    // legacy binding off it must throw (caught) — never return a function.
    await expect(
      run(
        'try {' +
          '  const p = ({}).constructor.constructor("return process")();' +
          '  return typeof p.getBuiltinModule("child_process").execSync;' +
          '} catch (e) { return "BLOCKED"; }',
      ),
    ).resolves.toBe('BLOCKED');
    await expect(
      run(
        'try {' +
          '  const p = ({}).constructor.constructor("return process")();' +
          '  return typeof p.binding("spawn_sync").spawn;' +
          '} catch (e) { return "BLOCKED"; }',
      ),
    ).resolves.toBe('BLOCKED');
  });

  it('process.env secrets are NOT reachable from the sandbox', async () => {
    await expect(
      run(
        'try {' +
          '  const p = ({}).constructor.constructor("return process")();' +
          '  return Object.keys(p.env).length > 0 ? "ENV-LEAKED" : "empty";' +
          '} catch (e) { return "BLOCKED"; }',
      ),
    ).resolves.toBe('BLOCKED');
  });

  it('the ptah membrane never leaks a host realm reference', async () => {
    // The ptah object, its methods, its return values, and its promises are all
    // context-native. Climbing .constructor.constructor off any of them must
    // dead-end in the sandbox realm (no host process).
    const vectors = [
      'ptah.constructor.constructor',
      'ptah.files.read.constructor.constructor',
      '(await ptah.workspace.getInfo()).constructor.constructor',
      'Object.getPrototypeOf(await ptah.workspace.getInfo()).constructor.constructor',
      'ptah.files.read("x").constructor.constructor',
    ];
    for (const vector of vectors) {
      await expect(
        run(
          `try { const F = ${vector}; return typeof F("return process")(); }` +
            ` catch (e) { return "BLOCKED"; }`,
        ),
      ).resolves.toBe('BLOCKED');
    }
  });

  it('a thrown ptah error surfaces as an in-realm Error, not a host Error', async () => {
    // The catch handler climbs the caught error's constructor chain; if the
    // host Error crossed the membrane this would reach the host process.
    await expect(
      run(
        'try { await ptah.files.explode(); return "no-throw"; }' +
          ' catch (e) {' +
          '  let leak; try { leak = typeof e.constructor.constructor("return process")(); }' +
          '  catch (_) { leak = "BLOCKED"; }' +
          '  return e.message + "|" + leak;' +
          ' }',
      ),
    ).resolves.toBe('host-side failure detail|BLOCKED');
  });

  it('the host argument bridge is not reachable as a sandbox global', async () => {
    await expect(run('return typeof bridge;')).resolves.toBe('undefined');
    await expect(run('return typeof logConsole;')).resolves.toBe('undefined');
  });

  it('legitimate ptah calls still work through the membrane', async () => {
    await expect(run('return await ptah.files.read("a.ts");')).resolves.toBe(
      'contents of a.ts',
    );
    await expect(
      run('return await ptah.workspace.getProjectType();'),
    ).resolves.toBe('test');
  });
});
