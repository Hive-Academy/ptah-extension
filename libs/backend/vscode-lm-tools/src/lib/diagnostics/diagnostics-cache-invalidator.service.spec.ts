/**
 * `diagnostics-cache-invalidator.service.spec.ts` — TASK_2026_325 finding 2,
 * second half.
 *
 * `TypeScriptDiagnosticsProvider.invalidate()` existed and was tested, and
 * nothing called it, so the 5 s per-root result cache had no change signal at
 * all: an agent that edited a file and re-checked inside the window was served
 * its own pre-edit answer. Every case below is about the CALLER.
 *
 * The last describe deliberately runs the REAL provider, the REAL SDK registry
 * and the REAL service against an on-disk fixture. A test that mocks the
 * provider proves the service calls a method; only the end-to-end one proves
 * the second read reflects the edit — which is the behaviour that was broken.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type {
  DiagnosticsResult,
  IDiagnosticsProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PostToolUseCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { TypeScriptDiagnosticsProvider } from '@ptah-extension/workspace-intelligence';
import {
  DiagnosticsCacheInvalidator,
  SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
  type DiagnosticsInvalidationPayload,
  type DiagnosticsInvalidationSource,
} from './diagnostics-cache-invalidator.service';

/** A real `ts.createProgram` pass costs seconds; see the provider's own spec. */
jest.setTimeout(60_000);

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** Minimal in-memory stand-in for `PostToolUseCallbackRegistry`. */
function makeSource(): DiagnosticsInvalidationSource & {
  fire: (payload: DiagnosticsInvalidationPayload) => void;
  subscriberCount: () => number;
} {
  const callbacks = new Set<
    (payload: DiagnosticsInvalidationPayload) => void
  >();
  return {
    register(callback) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    fire(payload) {
      for (const callback of callbacks) callback(payload);
    },
    subscriberCount: () => callbacks.size,
  };
}

/** A caching provider — the `TypeScriptDiagnosticsProvider` shape. */
function makeCachingProvider(): IDiagnosticsProvider & {
  invalidate: jest.Mock;
} {
  return {
    getDiagnostics: jest.fn(
      async (): Promise<DiagnosticsResult> => ({
        status: 'available',
        source: 'test',
        diagnostics: [],
      }),
    ),
    invalidate: jest.fn(),
  };
}

/** A provider with no cache — the `VscodeDiagnosticsProvider` shape. */
function makeLiveProvider(): IDiagnosticsProvider {
  return {
    getDiagnostics: jest.fn(
      async (): Promise<DiagnosticsResult> => ({
        status: 'available',
        source: 'vscode',
        diagnostics: [],
      }),
    ),
  };
}

function payload(
  toolName: string,
  workspaceRoot = '/ws/a',
): DiagnosticsInvalidationPayload {
  return { toolName, workspaceRoot };
}

describe('DiagnosticsCacheInvalidator', () => {
  describe('the token it subscribes on', () => {
    /**
     * The token is duplicated as a local `Symbol.for` so this lib does not take
     * a hard dependency on `agent-sdk` for one hook. A drifted string would
     * resolve nothing, the optional injection would hand back `undefined`, and
     * the service would go back to being the no-op it exists to remove — with
     * every other spec in this file still green, because they all inject the
     * source directly. This is the only case that can catch it.
     */
    it('is the same symbol the SDK registers the PostToolUse registry under', () => {
      expect(SDK_POST_TOOL_USE_CALLBACK_REGISTRY).toBe(
        SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
      );
    });
  });

  /**
   * A service nobody resolves is a no-op, which is the defect being fixed —
   * so the construction site is pinned, not assumed. `PtahAPIBuilder` is the
   * only injection site of `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`, so nothing
   * can reach `getDiagnostics` without building it first; asserting on its
   * source is asserting that the subscription exists whenever a stale answer
   * is possible. Source text rather than a resolved container because the
   * builder takes 38 collaborators, and a spec that stubs all of them would
   * pin the stubs rather than the wiring (same technique as
   * `wire-runtime.boot-order.spec.ts`).
   */
  describe('is genuinely constructed at runtime', () => {
    const BUILDER_SOURCE = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        'code-execution',
        'ptah-api-builder.service.ts',
      ),
      'utf-8',
    );
    const REGISTER_SOURCE = fs.readFileSync(
      path.join(__dirname, '..', 'di', 'register.ts'),
      'utf-8',
    );

    it('is registered by registerVsCodeLmToolsServices', () => {
      expect(REGISTER_SOURCE).toContain('DIAGNOSTICS_CACHE_INVALIDATOR');
      expect(REGISTER_SOURCE).toContain('DiagnosticsCacheInvalidator');
    });

    it('is injected into PtahAPIBuilder and started from its constructor', () => {
      expect(BUILDER_SOURCE).toContain(
        '@inject(DIAGNOSTICS_CACHE_INVALIDATOR)',
      );
      expect(BUILDER_SOURCE).toContain('diagnosticsCacheInvalidator.start();');
    });

    it('is injected without isOptional, so a missing registration fails loudly', () => {
      expect(BUILDER_SOURCE).not.toContain(
        'DIAGNOSTICS_CACHE_INVALIDATOR, { isOptional: true }',
      );
    });
  });

  describe('which tool calls invalidate', () => {
    it.each(['Write', 'Edit', 'NotebookEdit'])(
      'a PostToolUse for %s invalidates the cache for that payload root',
      (toolName) => {
        const provider = makeCachingProvider();
        const source = makeSource();
        new DiagnosticsCacheInvalidator(makeLogger(), provider, source).start();

        source.fire(payload(toolName, '/ws/project-a'));

        expect(provider.invalidate).toHaveBeenCalledTimes(1);
        expect(provider.invalidate).toHaveBeenCalledWith('/ws/project-a');
      },
    );

    /**
     * The allowlist is the whole reason the cache still collapses a burst.
     * `PostToolUse` fires once per tool call per session, so invalidating on a
     * read or a shell command would turn one shared compile back into one
     * compile per tool call.
     */
    it.each(['Read', 'Bash', 'Grep', 'Glob', 'WebFetch', 'TodoWrite'])(
      'a PostToolUse for %s does not invalidate',
      (toolName) => {
        const provider = makeCachingProvider();
        const source = makeSource();
        new DiagnosticsCacheInvalidator(makeLogger(), provider, source).start();

        source.fire(payload(toolName));

        expect(provider.invalidate).not.toHaveBeenCalled();
      },
    );

    /**
     * A blank root means "a file was written somewhere the hook could not
     * name". Dropping every root costs one recompile; dropping none serves a
     * stale clean answer with the confidence of a fresh one.
     */
    it('a write with a blank workspace root drops every cached root', () => {
      const provider = makeCachingProvider();
      const source = makeSource();
      new DiagnosticsCacheInvalidator(makeLogger(), provider, source).start();

      source.fire(payload('Write', ''));

      expect(provider.invalidate).toHaveBeenCalledWith(undefined);
    });
  });

  describe('a provider that exposes no invalidate (the VS Code shape)', () => {
    it('is handled without throwing, and is not armed on the hot hook', () => {
      const provider = makeLiveProvider();
      const source = makeSource();

      const service = new DiagnosticsCacheInvalidator(
        makeLogger(),
        provider,
        source,
      );

      expect(() => {
        service.start();
      }).not.toThrow();
      expect(source.subscriberCount()).toBe(0);
      expect(() => {
        source.fire(payload('Write'));
      }).not.toThrow();
    });

    it('does not throw when the method disappears between start and fire', () => {
      const provider = makeCachingProvider();
      const source = makeSource();
      new DiagnosticsCacheInvalidator(makeLogger(), provider, source).start();

      delete (provider as Partial<IDiagnosticsProvider>).invalidate;

      expect(() => {
        source.fire(payload('Write'));
      }).not.toThrow();
    });
  });

  describe('a hook callback never throws into the SDK', () => {
    it('swallows and logs a provider that throws from invalidate', () => {
      const provider = makeCachingProvider();
      provider.invalidate.mockImplementation(() => {
        throw new Error('cache exploded');
      });
      const source = makeSource();
      const logger = makeLogger();
      new DiagnosticsCacheInvalidator(logger, provider, source).start();

      expect(() => {
        source.fire(payload('Write'));
      }).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('invalidate failed'),
        expect.objectContaining({ error: 'cache exploded' }),
      );
    });
  });

  describe('subscription lifecycle', () => {
    it('start() twice registers one subscriber, so a write invalidates once', () => {
      const provider = makeCachingProvider();
      const source = makeSource();
      const service = new DiagnosticsCacheInvalidator(
        makeLogger(),
        provider,
        source,
      );

      service.start();
      service.start();
      source.fire(payload('Write'));

      expect(source.subscriberCount()).toBe(1);
      expect(provider.invalidate).toHaveBeenCalledTimes(1);
    });

    it('stop() releases the subscription', () => {
      const provider = makeCachingProvider();
      const source = makeSource();
      const service = new DiagnosticsCacheInvalidator(
        makeLogger(),
        provider,
        source,
      );

      service.start();
      service.stop();
      source.fire(payload('Write'));

      expect(source.subscriberCount()).toBe(0);
      expect(provider.invalidate).not.toHaveBeenCalled();
    });

    it('warns rather than throwing when no PostToolUse registry is registered', () => {
      const logger = makeLogger();
      const service = new DiagnosticsCacheInvalidator(
        logger,
        makeCachingProvider(),
        undefined,
      );

      expect(() => {
        service.start();
      }).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PostToolUse registry not registered'),
      );
    });
  });

  /**
   * End to end, with nothing stubbed but tsconfig discovery: the real SDK
   * registry, the real service, the real compiler-backed provider, and a real
   * fixture on disk. This is the case that fails if the wiring is removed —
   * the second `getDiagnostics` lands well inside the 5 s TTL, so without the
   * hook it is answered from the cache and still reports the error the agent
   * has already fixed.
   */
  describe('end to end: get -> agent write -> get, inside the TTL', () => {
    const createdDirs: string[] = [];

    afterEach(() => {
      for (const dir of createdDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    function writeFixture(files: Record<string, string>): string {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-diag-inval-'));
      createdDirs.push(root);
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
      }
      return root;
    }

    const TSCONFIG = JSON.stringify({
      compilerOptions: {
        target: 'es2020',
        module: 'commonjs',
        strict: true,
        noEmit: true,
      },
      include: ['src/**/*.ts'],
    });

    it('reports the fix the agent just made instead of the cached pre-edit result', async () => {
      const root = writeFixture({
        'tsconfig.json': TSCONFIG,
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const provider = new TypeScriptDiagnosticsProvider(
        createMockFileSystemProvider({
          findFiles: jest.fn(async () => [path.join(root, 'tsconfig.json')]),
        }),
      );
      const logger = makeLogger();
      const registry = new PostToolUseCallbackRegistry(logger);
      const service = new DiagnosticsCacheInvalidator(
        logger,
        provider,
        registry,
      );
      service.start();

      try {
        const before = await provider.getDiagnostics(root);
        expect(before.status).toBe('available');
        if (before.status === 'available') {
          expect(before.diagnostics).toHaveLength(1);
        }

        // The agent applies the fix and the SDK reports its Write. No test
        // code touches the provider here — the hook is the only channel.
        fs.writeFileSync(
          path.join(root, 'src', 'index.ts'),
          'export const ok: number = 1;\n',
        );
        registry.notifyAll({
          toolName: 'Write',
          toolInput: { file_path: path.join(root, 'src', 'index.ts') },
          toolOutput: 'ok',
          exitCode: 0,
          success: true,
          sessionId: 'session-1',
          workspaceRoot: root,
          timestamp: Date.now(),
        });

        const after = await provider.getDiagnostics(root);

        expect(after.status).toBe('available');
        if (after.status !== 'available') return;
        expect(after.diagnostics).toEqual([]);
      } finally {
        service.stop();
        await provider.dispose();
      }
    });

    it('a Read hook between the two calls leaves the cache in place', async () => {
      const root = writeFixture({
        'tsconfig.json': TSCONFIG,
        'src/index.ts': 'export const bad: number = "nope";\n',
      });
      const findFiles = jest.fn(async () => [path.join(root, 'tsconfig.json')]);
      const provider = new TypeScriptDiagnosticsProvider(
        createMockFileSystemProvider({ findFiles }),
      );
      const logger = makeLogger();
      const registry = new PostToolUseCallbackRegistry(logger);
      const service = new DiagnosticsCacheInvalidator(
        logger,
        provider,
        registry,
      );
      service.start();

      try {
        await provider.getDiagnostics(root);
        registry.notifyAll({
          toolName: 'Read',
          toolInput: { file_path: path.join(root, 'src', 'index.ts') },
          toolOutput: 'contents',
          exitCode: 0,
          success: true,
          sessionId: 'session-1',
          workspaceRoot: root,
          timestamp: Date.now(),
        });
        await provider.getDiagnostics(root);

        // One discovery pass, so the second call was served from the cache —
        // the burst-collapsing the cache exists for is still intact.
        expect(findFiles).toHaveBeenCalledTimes(1);
      } finally {
        service.stop();
        await provider.dispose();
      }
    });
  });
});
