import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
import * as discovery from './discovery';

describe('Tribunal discovery entry', () => {
  it('exports only the discovery service at runtime', () => {
    expect(Object.keys(discovery)).toEqual(['TribunalDiscoveryService']);
  });

  it('does not reach page, gridstack, or state service through relative imports', () => {
    const visited = new Set<string>();
    const visit = (file: string): void => {
      const path = resolve(file);
      if (visited.has(path)) return;
      visited.add(path);

      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const follow = (specifier: string): void => {
        expect(specifier).not.toMatch(
          /tribunal-page\.component|gridstack|tribunal-state\.service/,
        );
        if (specifier.startsWith('.')) {
          visit(resolve(dirname(path), `${specifier}.ts`));
        }
      };
      const walk = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          follow(node.moduleSpecifier.text);
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          follow(node.arguments[0].text);
        }
        ts.forEachChild(node, walk);
      };
      walk(source);
    };

    visit(resolve(__dirname, 'discovery.ts'));
  });
});
