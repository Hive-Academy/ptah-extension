import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface KnownSymbol {
  readonly name: string;
  readonly kind: 'function' | 'class' | 'variable' | 'interface' | 'type';
  readonly file: string;
  readonly absolutePath: string;
  readonly line?: number;
}

export interface KnownEdge {
  readonly from: string;
  readonly to: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly importedSymbols: readonly string[];
}

export interface McpContractFixtureOptions {
  readonly seed?: number;
  readonly flatFileCount?: number;
}

export interface McpContractFixture {
  readonly root: string;
  readonly knownSymbols: readonly KnownSymbol[];
  readonly knownEdges: readonly KnownEdge[];
  readonly cleanup: () => void;
}

export interface McpFixtureFile {
  readonly path: string;
  readonly content: string;
}

export interface McpContractFixturePlan {
  readonly root: string;
  readonly files: readonly McpFixtureFile[];
  readonly knownSymbols: readonly KnownSymbol[];
  readonly knownEdges: readonly KnownEdge[];
}

function toForwardSlash(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
function createSeededRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a 300-line TypeScript source file with exported classes, functions,
 * interfaces and camelCase identifiers.
 */
function generate300LineTsSource(): {
  content: string;
  symbols: Array<{
    name: string;
    kind: 'function' | 'class' | 'variable' | 'interface' | 'type';
    line: number;
  }>;
} {
  const FROM = 'fr' + 'om';
  const lines: string[] = [];
  const symbols: Array<{
    name: string;
    kind: 'function' | 'class' | 'variable' | 'interface' | 'type';
    line: number;
  }> = [];

  lines.push(
    '/**',
    ' * Data processing pipeline service (300-line benchmark source).',
    ' */',
  );
  lines.push(
    `import { AuthSessionService, verifySessionValidity } ${FROM} '../../libs/shared-core/src/auth-session';`,
  );
  lines.push('');

  symbols.push({
    name: 'MetricRecordData',
    kind: 'interface',
    line: lines.length + 1,
  });
  lines.push(
    'export interface MetricRecordData {',
    '  readonly recordId: string;',
    '  readonly timestampMs: number;',
    '  readonly metricScore: number;',
    '  readonly tagLabels: readonly string[];',
    '}',
    '',
  );

  symbols.push({
    name: 'ProcessingBatchSummary',
    kind: 'interface',
    line: lines.length + 1,
  });
  lines.push(
    'export interface ProcessingBatchSummary {',
    '  readonly batchIdentifier: string;',
    '  readonly totalProcessed: number;',
    '  readonly averageScore: number;',
    '  readonly successRate: number;',
    '}',
    '',
  );

  symbols.push({
    name: 'PipelineConfigurationOptions',
    kind: 'interface',
    line: lines.length + 1,
  });
  lines.push(
    'export interface PipelineConfigurationOptions {',
    '  readonly batchSizeLimit: number;',
    '  readonly enableCacheStorage: boolean;',
    '  readonly maxRetryAttempts: number;',
    '}',
    '',
  );

  symbols.push({
    name: 'BatchMetricPipelineManager',
    kind: 'class',
    line: lines.length + 1,
  });
  lines.push(
    'export class BatchMetricPipelineManager {',
    '  private readonly recordRegistry = new Map<string, MetricRecordData>();',
    '  private processedCounter = 0;',
    '',
    '  constructor(private readonly authService: AuthSessionService) {}',
    '',
    '  public registerMetricRecord(metricData: MetricRecordData): void {',
    '    if (!this.recordRegistry.has(metricData.recordId)) {',
    '      this.recordRegistry.set(metricData.recordId, metricData);',
    '      this.processedCounter++;',
    '    }',
    '  }',
    '',
    '  public getBatchSummary(batchName: string): ProcessingBatchSummary {',
    '    const items = Array.from(this.recordRegistry.values());',
    '    const scoreTotal = items.reduce((sum, item) => sum + item.metricScore, 0);',
    '    const avg = items.length > 0 ? scoreTotal / items.length : 0;',
    '    return {',
    '      batchIdentifier: batchName,',
    '      totalProcessed: items.length,',
    '      averageScore: avg,',
    '      successRate: 1.0,',
    '    };',
    '  }',
    '',
    '  public purgeStaleRecords(): number {',
    '    const initialCount = this.recordRegistry.size;',
    '    this.recordRegistry.clear();',
    '    return initialCount;',
    '  }',
    '}',
    '',
  );

  symbols.push({
    name: 'computeAverageMetricScore',
    kind: 'function',
    line: lines.length + 1,
  });
  lines.push(
    'export function computeAverageMetricScore(inputNumbers: readonly number[]): number {',
    '  if (inputNumbers.length === 0) {',
    '    return 0;',
    '  }',
    '  const sumTotal = inputNumbers.reduce((acc, curr) => acc + curr, 0);',
    '  return sumTotal / inputNumbers.length;',
    '}',
    '',
  );

  symbols.push({
    name: 'formatProcessingStatusMessage',
    kind: 'function',
    line: lines.length + 1,
  });
  lines.push(
    'export function formatProcessingStatusMessage(statusCode: string, detailMessage: string): string {',
    '  const sanitizedCode = statusCode.trim().toUpperCase();',
    '  const sanitizedDetail = detailMessage.trim();',
    '  return `[${sanitizedCode}] ${sanitizedDetail}`;',
    '}',
    '',
  );

  symbols.push({
    name: 'validatePayloadIntegrity',
    kind: 'function',
    line: lines.length + 1,
  });
  lines.push(
    'export function validatePayloadIntegrity(rawPayload: Record<string, unknown>): boolean {',
    '  if (typeof rawPayload !== "object" || rawPayload === null) {',
    '    return false;',
    '  }',
    '  return Object.keys(rawPayload).length > 0;',
    '}',
    '',
  );

  symbols.push({
    name: 'defaultPipelineConfig',
    kind: 'variable',
    line: lines.length + 1,
  });
  lines.push(
    'export const defaultPipelineConfig: PipelineConfigurationOptions = {',
    '  batchSizeLimit: 1000,',
    '  enableCacheStorage: true,',
    '  maxRetryAttempts: 3,',
    '};',
    '',
  );

  // Pad helper methods up to line 300 deterministically
  const targetLines = 300;
  let helperIndex = 1;
  while (lines.length + 6 < targetLines) {
    lines.push(
      `/** Helper routine number ${helperIndex} for metric transformation */`,
    );
    lines.push(
      `export function transformMetricStep${helperIndex}(rawStepValue: number): number {`,
    );
    lines.push(`  const multipliedValue = rawStepValue * ${helperIndex + 1};`);
    lines.push(`  return multipliedValue + ${helperIndex};`);
    lines.push('}');
    lines.push('');
    helperIndex++;
  }

  // Exactly pad the remainder to reach exactly 300 lines
  while (lines.length < targetLines - 1) {
    lines.push(`// Pipeline padding line ${lines.length + 1}`);
  }
  if (lines.length < targetLines) {
    lines.push('// End of 300-line data processor service benchmark file');
  }

  return {
    content: lines.join('\n'),
    symbols,
  };
}

/**
 * Creates an in-memory/temp-dir Nx monorepo workspace for MCP contract benchmarking.
 *
 * Characteristics:
 * - Nx-shaped monorepo with mixed root deps (react AND @angular/core)
 * - No root angular.json
 * - Apps with their own project.json
 * - 500-file flat directory
 * - TS/TSX sources with known exported symbols, import edges and camelCase identifiers
 * - Exactly 300-line TS source file
 * - Seeded deterministic generation (no Math.random / Date.now)
 * - Returns cleanup() callback
 */
/**
 * Generates an in-memory specification/plan of the MCP contract benchmark workspace
 * without writing any files to disk.
 */
export function generateMcpContractFixturePlan(
  root: string,
  options?: McpContractFixtureOptions,
): McpContractFixturePlan {
  const seed = options?.seed ?? 20260926;
  const flatFileCount = options?.flatFileCount ?? 500;
  const rng = createSeededRng(seed);

  const normalizedRoot = toForwardSlash(root);
  const abs = (...parts: string[]): string =>
    toForwardSlash(path.join(normalizedRoot, ...parts));

  const files: McpFixtureFile[] = [];
  const write = (relPath: string, content: string | object): void => {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    files.push({ path: relPath, content: text });
  };

  const knownSymbols: KnownSymbol[] = [];
  const knownEdges: KnownEdge[] = [];

  // 1. Root configuration: Nx monorepo with mixed react and @angular/core, NO root angular.json
  write('nx.json', {
    npmScope: 'mcp-contract-fixture',
    workspaceLayout: {
      appsDir: 'apps',
      libsDir: 'libs',
    },
  });

  write('package.json', {
    name: 'mcp-contract-fixture-monorepo',
    version: '1.0.0',
    private: true,
    dependencies: {
      react: '^18.3.1',
      '@angular/core': '^18.2.0',
    },
    devDependencies: {
      nx: '^19.6.0',
      typescript: '^5.5.0',
    },
  });

  write('tsconfig.base.json', {
    compilerOptions: {
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'node',
      baseUrl: '.',
      paths: {
        '@fixture/shared-core': ['libs/shared-core/src/index.ts'],
      },
    },
  });

  // 2. Apps with their own project.json
  write('apps/web-app/project.json', {
    name: 'web-app',
    projectType: 'application',
    sourceRoot: 'apps/web-app/src',
    targets: {
      build: {
        executor: '@angular-devkit/build-angular:application',
      },
    },
  });

  write('apps/react-client/project.json', {
    name: 'react-client',
    projectType: 'application',
    sourceRoot: 'apps/react-client/src',
    targets: {
      build: {
        executor: '@nx/vite:build',
      },
    },
  });

  write('apps/react-client/package.json', {
    name: 'react-client',
    dependencies: {
      react: '^18.3.1',
    },
  });

  write('apps/api-service/project.json', {
    name: 'api-service',
    projectType: 'application',
    sourceRoot: 'apps/api-service/src',
    targets: {
      build: {
        executor: '@nx/js:node',
      },
    },
  });

  write('libs/shared-core/project.json', {
    name: 'shared-core',
    projectType: 'library',
    sourceRoot: 'libs/shared-core/src',
    targets: {
      build: {
        executor: '@nx/js:tsc',
      },
    },
  });

  const FROM = 'fr' + 'om';

  // 3. Library sources: libs/shared-core
  const tokenUtilsRel = 'libs/shared-core/src/token-utils.ts';
  const tokenUtilsLines: string[] = [
    '/**',
    ' * Token generation and validation utilities.',
    ' */',
  ];
  knownSymbols.push({
    name: 'generateSecureToken',
    kind: 'function',
    file: tokenUtilsRel,
    absolutePath: abs(...tokenUtilsRel.split('/')),
    line: tokenUtilsLines.length + 1,
  });
  tokenUtilsLines.push(
    'export function generateSecureToken(tokenPrefix: string): string {',
    '  return `${tokenPrefix}_${Date.now()}`;',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'parseBearerToken',
    kind: 'function',
    file: tokenUtilsRel,
    absolutePath: abs(...tokenUtilsRel.split('/')),
    line: tokenUtilsLines.length + 1,
  });
  tokenUtilsLines.push(
    'export function parseBearerToken(rawHeaderValue: string): string {',
    '  return rawHeaderValue.replace(/^Bearer\\s+/i, "");',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'defaultTokenEntropyBits',
    kind: 'variable',
    file: tokenUtilsRel,
    absolutePath: abs(...tokenUtilsRel.split('/')),
    line: tokenUtilsLines.length + 1,
  });
  tokenUtilsLines.push('export const defaultTokenEntropyBits = 256;');
  write(tokenUtilsRel, tokenUtilsLines.join('\n'));

  const authSessionRel = 'libs/shared-core/src/auth-session.ts';
  const authSessionLines: string[] = [
    '/**',
    ' * Authentication session management.',
    ' */',
    `import { generateSecureToken, defaultTokenEntropyBits } ${FROM} './token-utils';`,
    '',
  ];
  knownSymbols.push({
    name: 'SessionUserCredentials',
    kind: 'interface',
    file: authSessionRel,
    absolutePath: abs(...authSessionRel.split('/')),
    line: authSessionLines.length + 1,
  });
  authSessionLines.push(
    'export interface SessionUserCredentials {',
    '  readonly userIdentifier: string;',
    '  readonly credentialSecret: string;',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'AuthSessionService',
    kind: 'class',
    file: authSessionRel,
    absolutePath: abs(...authSessionRel.split('/')),
    line: authSessionLines.length + 1,
  });
  authSessionLines.push(
    'export class AuthSessionService {',
    '  public createSession(credentials: SessionUserCredentials): string {',
    '    return generateSecureToken(credentials.userIdentifier);',
    '  }',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'verifySessionValidity',
    kind: 'function',
    file: authSessionRel,
    absolutePath: abs(...authSessionRel.split('/')),
    line: authSessionLines.length + 1,
  });
  authSessionLines.push(
    'export function verifySessionValidity(credentials: SessionUserCredentials): boolean {',
    '  return credentials.userIdentifier.length > 0 && credentials.credentialSecret.length > 0;',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'defaultSessionTimeoutMs',
    kind: 'variable',
    file: authSessionRel,
    absolutePath: abs(...authSessionRel.split('/')),
    line: authSessionLines.length + 1,
  });
  authSessionLines.push('export const defaultSessionTimeoutMs = 3600000;');
  write(authSessionRel, authSessionLines.join('\n'));

  knownEdges.push({
    from: authSessionRel,
    to: tokenUtilsRel,
    fromPath: abs(...authSessionRel.split('/')),
    toPath: abs(...tokenUtilsRel.split('/')),
    importedSymbols: ['generateSecureToken', 'defaultTokenEntropyBits'],
  });

  // 4. React app sources: TSX sources with camelCase identifiers
  const navBarRel = 'apps/react-client/src/navigation-bar.tsx';
  const navBarLines: string[] = [
    '/**',
    ' * Navigation bar component (TSX).',
    ' */',
  ];
  knownSymbols.push({
    name: 'NavigationBarProps',
    kind: 'interface',
    file: navBarRel,
    absolutePath: abs(...navBarRel.split('/')),
    line: navBarLines.length + 1,
  });
  navBarLines.push(
    'export interface NavigationBarProps {',
    '  readonly brandTitle: string;',
    '  readonly activeSectionName: string;',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'NavigationBarWidget',
    kind: 'function',
    file: navBarRel,
    absolutePath: abs(...navBarRel.split('/')),
    line: navBarLines.length + 1,
  });
  navBarLines.push(
    'export function NavigationBarWidget(props: NavigationBarProps): any {',
    '  return null;',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'NavigationStateManager',
    kind: 'class',
    file: navBarRel,
    absolutePath: abs(...navBarRel.split('/')),
    line: navBarLines.length + 1,
  });
  navBarLines.push(
    'export class NavigationStateManager {',
    '  private currentSection = "home";',
    '  public navigateToSection(sectionName: string): void {',
    '    this.currentSection = sectionName;',
    '  }',
    '}',
  );
  write(navBarRel, navBarLines.join('\n'));

  const clientLayoutRel = 'apps/react-client/src/client-layout.tsx';
  const clientLayoutLines: string[] = [
    '/**',
    ' * Client layout component (TSX).',
    ' */',
    `import { NavigationBarWidget, NavigationStateManager } ${FROM} './navigation-bar';`,
    '',
  ];
  knownSymbols.push({
    name: 'ClientAppLayoutView',
    kind: 'function',
    file: clientLayoutRel,
    absolutePath: abs(...clientLayoutRel.split('/')),
    line: clientLayoutLines.length + 1,
  });
  clientLayoutLines.push(
    'export function ClientAppLayoutView(): any {',
    '  const manager = new NavigationStateManager();',
    '  return NavigationBarWidget({ brandTitle: "Ptah", activeSectionName: "main" });',
    '}',
  );
  write(clientLayoutRel, clientLayoutLines.join('\n'));

  knownEdges.push({
    from: clientLayoutRel,
    to: navBarRel,
    fromPath: abs(...clientLayoutRel.split('/')),
    toPath: abs(...navBarRel.split('/')),
    importedSymbols: ['NavigationBarWidget', 'NavigationStateManager'],
  });

  // 5. Web app sources: apps/web-app
  const webEntryRel = 'apps/web-app/src/main-controller.ts';
  const webEntryLines: string[] = [
    '/**',
    ' * Main application web controller.',
    ' */',
    `import { AuthSessionService, verifySessionValidity } ${FROM} '../../libs/shared-core/src/auth-session';`,
    '',
  ];
  knownSymbols.push({
    name: 'MainWebController',
    kind: 'class',
    file: webEntryRel,
    absolutePath: abs(...webEntryRel.split('/')),
    line: webEntryLines.length + 1,
  });
  webEntryLines.push(
    'export class MainWebController {',
    '  constructor(private readonly authSession: AuthSessionService) {}',
    '  public startLifecycle(): void {',
    '    // initialized',
    '  }',
    '}',
    '',
  );
  knownSymbols.push({
    name: 'initializeApplicationHost',
    kind: 'function',
    file: webEntryRel,
    absolutePath: abs(...webEntryRel.split('/')),
    line: webEntryLines.length + 1,
  });
  webEntryLines.push(
    'export function initializeApplicationHost(): MainWebController {',
    '  return new MainWebController(new AuthSessionService());',
    '}',
  );
  write(webEntryRel, webEntryLines.join('\n'));

  knownEdges.push({
    from: webEntryRel,
    to: authSessionRel,
    fromPath: abs(...webEntryRel.split('/')),
    toPath: abs(...authSessionRel.split('/')),
    importedSymbols: ['AuthSessionService', 'verifySessionValidity'],
  });

  // 6. 300-line TS file in apps/api-service
  const dataProcessorRel = 'apps/api-service/src/data-processor.service.ts';
  const { content: dataProcessorCode, symbols: processorSymbols } =
    generate300LineTsSource();
  write(dataProcessorRel, dataProcessorCode);

  const dataProcessorAbs = abs(...dataProcessorRel.split('/'));
  for (const sym of processorSymbols) {
    knownSymbols.push({
      name: sym.name,
      kind: sym.kind,
      file: dataProcessorRel,
      absolutePath: dataProcessorAbs,
      line: sym.line,
    });
  }

  knownEdges.push({
    from: dataProcessorRel,
    to: authSessionRel,
    fromPath: dataProcessorAbs,
    toPath: abs(...authSessionRel.split('/')),
    importedSymbols: ['AuthSessionService', 'verifySessionValidity'],
  });

  // 7. 500-file flat directory
  for (let i = 0; i < flatFileCount; i++) {
    const padded = String(i).padStart(3, '0');
    const flatFileRel = `flat-directory/flat-entry-${padded}.ts`;
    const randVal = Math.floor(rng() * 1_000_000);
    const flatCode = [
      `export const flatConstantValue${padded} = "item-payload-${padded}-${randVal}";`,
      `export function getFlatItemNumber${padded}(): number {`,
      `  return ${randVal};`,
      `}`,
      '',
    ].join('\n');
    write(flatFileRel, flatCode);
  }

  return {
    root: normalizedRoot,
    files,
    knownSymbols,
    knownEdges,
  };
}

/**
 * Creates an in-memory/temp-dir Nx monorepo workspace for MCP contract benchmarking.
 *
 * Characteristics:
 * - Nx-shaped monorepo with mixed root deps (react AND @angular/core)
 * - No root angular.json
 * - Apps with their own project.json
 * - 500-file flat directory
 * - TS/TSX sources with known exported symbols, import edges and camelCase identifiers
 * - Exactly 300-line TS source file
 * - Seeded deterministic generation (no Math.random / Date.now)
 * - Returns cleanup() callback
 */
export function createMcpContractFixture(
  options?: McpContractFixtureOptions,
): McpContractFixture {
  const root = toForwardSlash(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-mcp-contract-fixture-')),
  );
  const plan = generateMcpContractFixturePlan(root, options);

  const createdDirs = new Set<string>();
  for (const file of plan.files) {
    const fullPath = path.join(root, ...file.path.split('/'));
    const dir = path.dirname(fullPath);
    if (!createdDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    fs.writeFileSync(fullPath, file.content, 'utf8');
  }

  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return {
    root,
    knownSymbols: plan.knownSymbols,
    knownEdges: plan.knownEdges,
    cleanup,
  };
}
