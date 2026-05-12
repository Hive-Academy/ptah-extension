/**
 * Dual-Registration Guard Test (test-strategy-plan.md §4.1)
 *
 * Ensures every method registered by a SHARED_HANDLERS class has its prefix
 * present in ALLOWED_METHOD_PREFIXES (the runtime security allowlist in
 * vscode-core). Without this guard, a new handler class whose prefix is
 * missing from the allowlist silently fails at runtime — the RpcHandler
 * rejects the registration — rather than breaking CI.
 *
 * Failure message example:
 *   Missing prefixes detected:
 *     - NewFeatureRpcHandlers: newFeature:doSomething  (prefix: "newFeature:")
 */

// ---------------------------------------------------------------------------
// Heavy transitive dependencies must be mocked before the SUT is imported.
//
// Importing `register-all` brings in every handler class; some of them
// (SetupRpcHandlers via agent-generation, WorkspaceRpcHandlers via
// workspace-intelligence) reach `TreeSitterParserService` whose module top-
// level evaluates `import.meta.url` — a construct Jest's CJS transform cannot
// parse. We mock both packages here so the module graph never reaches those
// native/ESM-only files.
// ---------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Python: 'python',
    Java: 'java',
    Rust: 'rust',
    Go: 'go',
    DotNet: 'dotnet',
    PHP: 'php',
    Ruby: 'ruby',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Nuxt: 'nuxt',
    Express: 'express',
    Django: 'django',
    Laravel: 'laravel',
    Rails: 'rails',
    Svelte: 'svelte',
    Astro: 'astro',
    NestJS: 'nestjs',
    Fastify: 'fastify',
    Flask: 'flask',
    FastAPI: 'fastapi',
    Spring: 'spring',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
    Rush: 'rush',
    Turborepo: 'turborepo',
    PnpmWorkspaces: 'pnpm-workspaces',
    YarnWorkspaces: 'yarn-workspaces',
  },
  FileType: {
    Source: 'source',
    Test: 'test',
    Config: 'config',
    Documentation: 'docs',
    Asset: 'asset',
  },
  TreeSitterParserService: class {},
  AstAnalysisService: class {},
  DependencyGraphService: class {},
  WorkspaceAnalyzerService: class {},
  ContextService: class {},
  ContextOrchestrationService: class {},
  WorkspaceService: class {},
  TokenCounterService: class {},
  FileSystemService: class {},
  FileSystemError: class extends Error {},
  ProjectDetectorService: class {},
  FrameworkDetectorService: class {},
  DependencyAnalyzerService: class {},
  MonorepoDetectorService: class {},
  PatternMatcherService: class {},
  IgnorePatternResolverService: class {},
  WorkspaceIndexerService: class {},
  FileTypeClassifierService: class {},
  FileRelevanceScorerService: class {},
  ContextSizeOptimizerService: class {},
  ContextEnrichmentService: class {},
}));

jest.mock('@ptah-extension/memory-curator', () => ({
  // Pass through the real module so MEMORY_TOKENS and other DI symbols are
  // intact (memory-curator has no native bindings). Only stub the heavy
  // async helper that makes network/FS calls.
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';
import { SHARED_HANDLERS } from './register-all';

describe('RPC allowlist dual-registration guard', () => {
  it('every SHARED_HANDLERS method has its prefix in ALLOWED_METHOD_PREFIXES', () => {
    const missing: string[] = [];

    for (const HandlerCtor of SHARED_HANDLERS) {
      for (const method of HandlerCtor.METHODS) {
        const colonIndex = method.indexOf(':');
        // Methods without a colon have no valid prefix — flag them too.
        const prefix =
          colonIndex === -1 ? method : method.slice(0, colonIndex + 1);

        if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
          missing.push(
            `  - ${HandlerCtor.name}: ${method}  (prefix: "${prefix}")`,
          );
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing prefixes detected — add them to ALLOWED_METHOD_PREFIXES in ` +
          `libs/backend/vscode-core/src/messaging/rpc-handler.ts:\n` +
          missing.join('\n'),
      );
    }
  });
});
