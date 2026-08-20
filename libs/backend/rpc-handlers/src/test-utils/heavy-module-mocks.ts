/**
 * Stubs for the transitive dependencies that make the handler barrel
 * unloadable under Jest's CJS transform.
 *
 * Importing anything that reaches `handlers/index.ts` (the manifest, the
 * allowlist guard, the handler-plan guards) pulls in `SetupRpcHandlers` via
 * agent-generation and `WorkspaceRpcHandlers` via workspace-intelligence,
 * which reach `TreeSitterParserService` — whose module top level evaluates
 * `import.meta.url`. Mocking the package keeps the module graph short of it.
 *
 * Consumed from a `jest.mock` factory, which may not close over out-of-scope
 * variables but may `require`:
 *
 *   jest.mock('@ptah-extension/workspace-intelligence', () =>
 *     require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
 *   );
 */

export function workspaceIntelligenceMock(): Record<string, unknown> {
  return {
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
  };
}
