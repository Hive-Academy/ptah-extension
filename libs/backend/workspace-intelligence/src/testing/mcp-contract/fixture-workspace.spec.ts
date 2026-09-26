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

  it('removes the root directory completely upon cleanup', () => {
    const minimalFixture = createMcpContractFixture({ flatFileCount: 0 });
    expect(fs.existsSync(minimalFixture.root)).toBe(true);
    minimalFixture.cleanup();
    expect(fs.existsSync(minimalFixture.root)).toBe(false);
  });
});
