import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const SCAN_ROOTS = [
  path.join(WORKSPACE_ROOT, 'libs', 'backend'),
  path.join(WORKSPACE_ROOT, 'apps'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx', 'coverage']);

const INTENTIONAL_CROSS_LIB_MIRRORS = new Set<string>([
  'PtahCuratorLlm',
  'PtahUserLayerMirrorService',
  'SdkCompactionCallbackRegistry',
  'SdkInternalQueryService',
]);

function findTokensFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name === 'tokens.ts') {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  return out;
}

function extractSymbolForDescriptions(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    src,
    ts.ScriptTarget.Latest,
    true,
  );
  const descriptions: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'Symbol' &&
        ts.isIdentifier(callee.name) &&
        callee.name.text === 'for' &&
        node.arguments.length === 1
      ) {
        const arg = node.arguments[0];
        if (
          ts.isStringLiteral(arg) ||
          ts.isNoSubstitutionTemplateLiteral(arg)
        ) {
          descriptions.push(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return descriptions;
}

describe('Symbol.for() description uniqueness across tokens.ts files', () => {
  const tokenFiles = SCAN_ROOTS.flatMap(findTokensFiles);

  it('discovers tokens.ts files under libs/backend and apps', () => {
    expect(tokenFiles.length).toBeGreaterThan(0);
  });

  it('declares no duplicate Symbol.for() descriptions across files (whitelist excepted)', () => {
    const descriptionToFiles = new Map<string, Set<string>>();

    for (const file of tokenFiles) {
      const descriptions = extractSymbolForDescriptions(file);
      const rel = path.relative(WORKSPACE_ROOT, file).replace(/\\/g, '/');
      for (const desc of descriptions) {
        let set = descriptionToFiles.get(desc);
        if (!set) {
          set = new Set();
          descriptionToFiles.set(desc, set);
        }
        set.add(rel);
      }
    }

    const violations: Array<{ description: string; files: string[] }> = [];
    for (const [description, files] of descriptionToFiles) {
      if (files.size > 1 && !INTENTIONAL_CROSS_LIB_MIRRORS.has(description)) {
        violations.push({ description, files: [...files].sort() });
      }
    }

    if (violations.length > 0) {
      const message = violations
        .map(
          (v) =>
            `  - Symbol.for('${v.description}') declared in:\n` +
            v.files.map((f) => `      ${f}`).join('\n'),
        )
        .join('\n');
      throw new Error(
        `Duplicate Symbol.for() descriptions detected across tokens.ts files. ` +
          `Two different DI token files cannot declare the same description ` +
          `unless the description is added to INTENTIONAL_CROSS_LIB_MIRRORS ` +
          `(reserved for port/adapter pairs that intentionally share a global ` +
          `symbol to avoid circular imports).\n${message}`,
      );
    }
  });

  it('keeps every whitelisted description actually present in at least two files', () => {
    const descriptionToFiles = new Map<string, Set<string>>();
    for (const file of tokenFiles) {
      const rel = path.relative(WORKSPACE_ROOT, file).replace(/\\/g, '/');
      for (const desc of extractSymbolForDescriptions(file)) {
        let set = descriptionToFiles.get(desc);
        if (!set) {
          set = new Set();
          descriptionToFiles.set(desc, set);
        }
        set.add(rel);
      }
    }

    const stale: string[] = [];
    for (const description of INTENTIONAL_CROSS_LIB_MIRRORS) {
      const files = descriptionToFiles.get(description);
      if (!files || files.size < 2) {
        stale.push(description);
      }
    }

    expect(stale).toEqual([]);
  });
});
