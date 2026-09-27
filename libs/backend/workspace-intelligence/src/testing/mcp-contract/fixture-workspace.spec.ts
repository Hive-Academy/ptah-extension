import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createMcpContractFixture,
  generateMcpContractFixturePlan,
  type McpContractFixture,
} from './fixture-workspace';

function collectFilesRecursively(dir: string, baseDir = dir): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath, baseDir));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
      results.push(rel);
    }
  }
  return results.sort();
}

describe('createMcpContractFixture', () => {
  let fixture: McpContractFixture;

  beforeAll(() => {
    fixture = createMcpContractFixture();
  });

  afterAll(() => {
    fixture?.cleanup();
  });

  it('creates an Nx-shaped monorepo with mixed root deps, no angular.json, 500-file directory, and 300-line TS file', () => {
    expect(fs.existsSync(fixture.root)).toBe(true);

    // Check root nx.json
    expect(fs.existsSync(path.join(fixture.root, 'nx.json'))).toBe(true);
    const nxJson = JSON.parse(
      fs.readFileSync(path.join(fixture.root, 'nx.json'), 'utf8'),
    );
    expect(nxJson.npmScope).toBe('mcp-contract-fixture');

    // Check package.json has mixed react and @angular/core
    expect(fs.existsSync(path.join(fixture.root, 'package.json'))).toBe(true);
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(fixture.root, 'package.json'), 'utf8'),
    );
    expect(pkgJson.dependencies['react']).toBeDefined();
    expect(pkgJson.dependencies['@angular/core']).toBeDefined();

    // Check NO root angular.json
    expect(fs.existsSync(path.join(fixture.root, 'angular.json'))).toBe(false);

    // Check apps have their own project.json
    expect(
      fs.existsSync(path.join(fixture.root, 'apps/web-app/project.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.root, 'apps/react-client/project.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.root, 'apps/api-service/project.json')),
    ).toBe(true);

    // Check 500-file flat directory
    const flatFiles = fs.readdirSync(path.join(fixture.root, 'flat-directory'));
    expect(flatFiles.length).toBe(500);

    // Check 300-line TS source file
    const processorPath = path.join(
      fixture.root,
      'apps/api-service/src/data-processor.service.ts',
    );
    expect(fs.existsSync(processorPath)).toBe(true);
    const processorContent = fs.readFileSync(processorPath, 'utf8');
    const lines = processorContent.split('\n');
    expect(lines.length).toBe(300);

    // Verify all planned files are written to disk
    const diskFiles = collectFilesRecursively(fixture.root);
    const expectedFiles = generateMcpContractFixturePlan(fixture.root)
      .files.map((f) => f.path)
      .sort();
    expect(diskFiles).toEqual(expectedFiles);
  });

  it('proves determinism via in-memory plan: two independent builds produce identical file lists and identical contents', () => {
    const planA = generateMcpContractFixturePlan('/test-root', { seed: 12345 });
    const planB = generateMcpContractFixturePlan('/test-root', { seed: 12345 });

    expect(planA.files).toEqual(planB.files);
    expect(planA.files.length).toBeGreaterThan(500);

    // Symbol names and edges match exactly across builds
    const symbolsA = planA.knownSymbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.file,
      line: s.line,
    }));
    const symbolsB = planB.knownSymbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.file,
      line: s.line,
    }));
    expect(symbolsA).toEqual(symbolsB);

    const edgesA = planA.knownEdges.map((e) => ({
      from: e.from,
      to: e.to,
      syms: e.importedSymbols,
    }));
    const edgesB = planB.knownEdges.map((e) => ({
      from: e.from,
      to: e.to,
      syms: e.importedSymbols,
    }));
    expect(edgesA).toEqual(edgesB);
  });

  it('proves seed sensitivity via in-memory plan: different seeds produce different contents in flat directory files', () => {
    const planA = generateMcpContractFixturePlan('/test-root', { seed: 12345 });
    const planB = generateMcpContractFixturePlan('/test-root', { seed: 67890 });

    const fileA = planA.files.find(
      (f) => f.path === 'flat-directory/flat-entry-000.ts',
    );
    const fileB = planB.files.find(
      (f) => f.path === 'flat-directory/flat-entry-000.ts',
    );
    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();
    expect(fileA?.content).not.toEqual(fileB?.content);
  });

  it('matches knownSymbols and knownEdges with the files written to disk', () => {
    expect(fixture.knownSymbols.length).toBeGreaterThan(10);
    for (const sym of fixture.knownSymbols) {
      expect(sym.absolutePath.startsWith(fixture.root)).toBe(true);
      expect(fs.existsSync(sym.absolutePath)).toBe(true);
      const fileContent = fs.readFileSync(sym.absolutePath, 'utf8');
      expect(fileContent).toContain(sym.name);

      // Exact line number verification: line at sym.line (1-indexed) must contain the symbol declaration
      expect(sym.line).toBeDefined();
      const lines = fileContent.split('\n');
      const declarationLine = lines[(sym.line as number) - 1];
      expect(declarationLine).toBeDefined();
      expect(declarationLine).toContain(sym.name);
    }

    expect(fixture.knownEdges.length).toBeGreaterThanOrEqual(4);
    for (const edge of fixture.knownEdges) {
      expect(edge.fromPath.startsWith(fixture.root)).toBe(true);
      expect(edge.toPath.startsWith(fixture.root)).toBe(true);
      expect(fs.existsSync(edge.fromPath)).toBe(true);
      expect(fs.existsSync(edge.toPath)).toBe(true);
      const fromContent = fs.readFileSync(edge.fromPath, 'utf8');
      for (const importedSym of edge.importedSymbols) {
        expect(fromContent).toContain(importedSym);
      }
      // Verify importing file actually imports from the target module
      const targetBaseName = path.basename(edge.toPath).replace(/\.tsx?$/, '');
      expect(fromContent).toContain(targetBaseName);
    }
  });

  /**
   * r1 defect 3: the previous check only confirmed the target's basename
   * occurred as a substring of the importing file — a specifier that is one
   * `..` short of the real depth (resolving to a sibling directory that
   * happens to share the target's tail) would still pass that check. This
   * independently resolves the ACTUAL specifier text with POSIX relative-path
   * arithmetic (no dependency on `DependencyGraphService`) and requires it to
   * land exactly on `edge.toPath`, on disk.
   */
  it('every knownEdge specifier independently resolves on disk to its declared toPath', () => {
    const FROM_SPECIFIER_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
    expect(fixture.knownEdges.length).toBeGreaterThanOrEqual(4);

    for (const edge of fixture.knownEdges) {
      const fromContent = fs.readFileSync(edge.fromPath, 'utf8');
      const fromDir = path.posix.dirname(
        edge.fromPath.split(path.sep).join('/'),
      );
      const toPathPosix = edge.toPath.split(path.sep).join('/');

      const specifiers = [...fromContent.matchAll(FROM_SPECIFIER_RE)].map(
        (m) => m[1],
      );
      expect(specifiers.length).toBeGreaterThan(0);

      const resolved = specifiers
        .filter((s) => s.startsWith('.'))
        .map((s) => {
          const joined = path.posix.normalize(path.posix.join(fromDir, s));
          for (const ext of ['', '.ts', '.tsx']) {
            const candidate = `${joined}${ext}`;
            if (fs.existsSync(candidate)) {
              return candidate;
            }
          }
          return joined;
        });

      expect(resolved).toContain(toPathPosix);
    }
  });

  /**
   * r2 defect R2-01: 35 of the 300-line file's generated
   * `transformMetricStepN` helpers were real exported declarations the
   * fixture never recorded in `knownSymbols` — a downstream recall check
   * built from `knownSymbols` could not catch their loss. This independently
   * censuses every top-level `export` declaration in each source file the
   * fixture tracks symbols for, with its own regex (not
   * `DependencyGraphService`/`AstAnalysisService`), and requires
   * `knownSymbols` to name exactly that set, per file.
   *
   * Scoped to the 6 named source files (`token-utils.ts`, `auth-session.ts`,
   * `navigation-bar.tsx`, `client-layout.tsx`, `main-controller.ts`,
   * `data-processor.service.ts`) — the fixture's declared symbol-census
   * surface. The 500-file `flat-directory` is bulk graph-size padding, not
   * part of the known-symbol contract: Task 20.1's own spec above already
   * censuses it separately (file count, seed determinism), and the r2
   * evidence itself only concerns the 300-line file's declarations.
   */
  it('knownSymbols exactly matches an independent regex census of every top-level export, per tracked source file', () => {
    const EXPORT_DECL_RE =
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type)\s+(\w+)|^export\s+const\s+(\w+)/gm;
    const trackedFiles = [
      ...new Set(fixture.knownSymbols.map((s) => s.absolutePath)),
    ];
    expect(trackedFiles.length).toBeGreaterThanOrEqual(6);

    for (const absolutePath of trackedFiles) {
      const content = fs.readFileSync(absolutePath, 'utf8');
      const census = new Set<string>();
      let match: RegExpExecArray | null;
      EXPORT_DECL_RE.lastIndex = 0;
      while ((match = EXPORT_DECL_RE.exec(content))) {
        census.add(match[1] ?? match[2]);
      }
      const known = new Set(
        fixture.knownSymbols
          .filter((s) => s.absolutePath === absolutePath)
          .map((s) => s.name),
      );
      expect(known).toEqual(census);
    }
  });

  it('removes the root directory completely upon cleanup', () => {
    const minimalFixture = createMcpContractFixture({ flatFileCount: 0 });
    expect(fs.existsSync(minimalFixture.root)).toBe(true);
    minimalFixture.cleanup();
    expect(fs.existsSync(minimalFixture.root)).toBe(false);
  });
});
