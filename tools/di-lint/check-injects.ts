#!/usr/bin/env npx ts-node
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import fg from 'fast-glob';

interface InjectionSite {
  token: string;
  resolved: string;
  file: string;
  line: number;
}

interface Result {
  registered: Set<string>;
  injected: InjectionSite[];
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_PATH = path
  .join(__dirname, '__fixtures__', 'unregistered-inject.ts')
  .replace(/\\/g, '/');

const TOKEN_FILE_GLOBS = [
  'libs/**/src/**/*.ts',
  'apps/**/src/**/*.ts',
];

const REGISTRATION_GLOBS = [
  'libs/**/{register,registration}*.ts',
  'libs/**/*-registration.ts',
  'libs/**/phase-*.ts',
  'libs/**/di.ts',
  'libs/**/di/*.ts',
  'apps/**/{register,registration}*.ts',
  'apps/**/*-registration.ts',
  'apps/**/phase-*.ts',
  'apps/**/di.ts',
  'apps/**/di/*.ts',
];

const INJECTION_GLOBS = [
  'libs/**/src/**/*.ts',
  'apps/**/src/**/*.ts',
];

const SCAN_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.nx/**',
  '**/__fixtures__/**',
  '**/*.spec.ts',
  '**/*.test.ts',
  '**/*.d.ts',
];

function expressionText(node: ts.Expression): string {
  return node.getText().replace(/\s+/g, '');
}

function lastSegment(raw: string): string {
  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx >= 0) return raw.slice(dotIdx + 1);
  return raw;
}

function extractSymbolForDescription(initializer: ts.Expression): string | null {
  if (!ts.isCallExpression(initializer)) return null;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return null;
  const obj = initializer.expression.expression;
  const prop = initializer.expression.name;
  if (!ts.isIdentifier(obj) || obj.text !== 'Symbol') return null;
  if (!ts.isIdentifier(prop) || prop.text !== 'for') return null;
  const arg = initializer.arguments[0];
  if (!arg || !ts.isStringLiteral(arg)) return null;
  return arg.text;
}

function buildTokenAliasMap(sourceFiles: string[]): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const filePath of sourceFiles) {
    const src = fs.readFileSync(filePath, 'utf8');
    if (!src.includes('Symbol.for')) continue;
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2022, true);

    const unwrap = (e: ts.Expression): ts.Expression =>
      ts.isAsExpression(e) || ts.isParenthesizedExpression(e)
        ? unwrap(e.expression)
        : e;

    const visit = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
          const init = unwrap(decl.initializer);
          const desc = extractSymbolForDescription(init);
          if (desc) {
            aliases.set(decl.name.text, desc);
            continue;
          }
          if (ts.isObjectLiteralExpression(init)) {
            for (const prop of init.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name)
              ) {
                const propInit = unwrap(prop.initializer);
                const desc2 = extractSymbolForDescription(propInit);
                if (desc2) {
                  aliases.set(`${decl.name.text}.${prop.name.text}`, desc2);
                  aliases.set(prop.name.text, desc2);
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return aliases;
}

function resolveToken(raw: string, aliases: Map<string, string>): string {
  const direct = aliases.get(raw);
  if (direct) return direct;
  const tail = lastSegment(raw);
  const tailHit = aliases.get(tail);
  if (tailHit) return tailHit;
  return raw;
}

function findRegistrationCalls(
  sourceFile: ts.SourceFile,
  registered: Set<string>,
  aliases: Map<string, string>,
): void {
  const recordToken = (raw: string): void => {
    registered.add(resolveToken(raw, aliases));
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      const isContainerMethod =
        method === 'register' ||
        method === 'registerSingleton' ||
        method === 'registerInstance' ||
        method === 'registerType';
      if (isContainerMethod && node.arguments.length >= 1) {
        const tokenArg = node.arguments[0];
        if (tokenArg) recordToken(expressionText(tokenArg));
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'provide'
        ) {
          recordToken(expressionText(prop.initializer));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function findInjectionSites(
  sourceFile: ts.SourceFile,
  filePath: string,
  out: InjectionSite[],
  aliases: Map<string, string>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      const isInject = ts.isIdentifier(callee) && callee.text === 'inject';
      if (isInject && node.expression.arguments.length >= 1) {
        const tokenArg = node.expression.arguments[0];
        if (tokenArg) {
          const raw = expressionText(tokenArg);
          const pos = sourceFile.getLineAndCharacterOfPosition(
            tokenArg.getStart(),
          );
          out.push({
            token: raw,
            resolved: resolveToken(raw, aliases),
            file: filePath,
            line: pos.line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

async function analyze(options: { selfTest: boolean }): Promise<Result> {
  const registered = new Set<string>();
  const injected: InjectionSite[] = [];

  if (options.selfTest) {
    const aliases = new Map<string, string>();
    const src = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const sf = ts.createSourceFile(FIXTURE_PATH, src, ts.ScriptTarget.ES2022, true);
    const localAliases = buildTokenAliasMap([FIXTURE_PATH]);
    for (const [k, v] of localAliases) aliases.set(k, v);
    findInjectionSites(sf, FIXTURE_PATH, injected, aliases);
    return { registered, injected };
  }

  const tokenFiles = await fg(TOKEN_FILE_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  const aliases = buildTokenAliasMap(tokenFiles);

  const injectableClasses = await fg(INJECTION_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  for (const filePath of injectableClasses) {
    const src = fs.readFileSync(filePath, 'utf8');
    if (!src.includes('@injectable')) continue;
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        const decorators = ts.getDecorators?.(node) ?? [];
        for (const dec of decorators) {
          if (
            ts.isCallExpression(dec.expression) &&
            ts.isIdentifier(dec.expression.expression) &&
            dec.expression.expression.text === 'injectable'
          ) {
            registered.add(node.name.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const registrationFiles = await fg(REGISTRATION_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  for (const filePath of registrationFiles) {
    const src = fs.readFileSync(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2022, true);
    findRegistrationCalls(sf, registered, aliases);
  }

  const injectionFiles = await fg(INJECTION_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  for (const filePath of injectionFiles) {
    const src = fs.readFileSync(filePath, 'utf8');
    if (!src.includes('@inject(')) continue;
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2022, true);
    findInjectionSites(sf, filePath, injected, aliases);
  }

  return { registered, injected };
}

function relPath(p: string): string {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

async function main(): Promise<number> {
  const selfTest = process.argv.includes('--self-test');
  const verbose = process.argv.includes('--verbose');

  const { registered, injected } = await analyze({ selfTest });

  if (selfTest) {
    const violations = injected.filter((site) => !registered.has(site.resolved));
    if (violations.length === 0) {
      console.error(
        'di-lint self-test FAILED: expected at least one violation from fixture, got 0',
      );
      return 1;
    }
    console.log(
      `di-lint self-test PASS: detected ${violations.length} violation(s) in fixture`,
    );
    for (const v of violations) {
      console.log(`  ${relPath(v.file)}:${v.line} injects ${v.token}`);
    }
    return 0;
  }

  const violations = injected.filter((site) => !registered.has(site.resolved));

  if (verbose) {
    console.log(
      `di-lint: scanned ${registered.size} registered tokens, ${injected.length} injection sites`,
    );
  }

  if (violations.length === 0) {
    console.log(
      `di-lint OK: ${injected.length} @inject sites all resolve to a registered token (${registered.size} tokens)`,
    );
    return 0;
  }

  console.error(`di-lint FAIL: ${violations.length} unregistered @inject token(s)`);
  for (const v of violations) {
    console.error(
      `ERROR: ${relPath(v.file)}:${v.line} injects ${v.token} but no register*.ts registers it`,
    );
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('di-lint crashed:', err);
    process.exit(2);
  });
