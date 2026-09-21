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

interface MissingInject {
  className: string;
  param: string;
  index: number;
  file: string;
  line: number;
}

interface Result {
  registered: Set<string>;
  injected: InjectionSite[];
  missing: MissingInject[];
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_PATH = path
  .join(__dirname, '__fixtures__', 'unregistered-inject.ts')
  .replace(/\\/g, '/');
const MISSING_FIXTURE_PATH = path
  .join(__dirname, '__fixtures__', 'missing-inject.ts')
  .replace(/\\/g, '/');

/** tsyringe class decorators that make the container construct the class. */
const CLASS_DECORATORS = new Set([
  'injectable',
  'singleton',
  'scoped',
  'autoInjectable',
]);

/** tsyringe parameter decorators that name a token explicitly. */
const PARAM_DECORATORS = new Set([
  'inject',
  'injectAll',
  'injectWithTransform',
  'injectAllWithTransform',
]);

const TOKEN_FILE_GLOBS = ['libs/**/src/**/*.ts', 'apps/**/src/**/*.ts'];

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

const INJECTION_GLOBS = ['libs/**/src/**/*.ts', 'apps/**/src/**/*.ts'];

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

function extractSymbolForDescription(
  initializer: ts.Expression,
): string | null {
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
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
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

/** Name of a decorator, whether or not it is called: `@inject(X)` / `@injectable`. */
function decoratorName(dec: ts.Decorator): string {
  let expr: ts.Expression = dec.expression;
  if (ts.isCallExpression(expr)) expr = expr.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return '';
}

/**
 * Finds REQUIRED constructor parameters that carry no tsyringe parameter
 * decorator on a container-constructed class.
 *
 * Why this is a defect and not a style nit: `emitDecoratorMetadata` is false
 * in `tsconfig.base.json`, and esbuild does not implement it in any case, so
 * the shipped bundles contain no `design:paramtypes`. tsyringe cannot infer a
 * parameter from its TYPE, so an undecorated position becomes `undefined`.
 * The class still constructs and still resolves — it fails much later, at the
 * first dereference, far from the cause.
 *
 * A parameter with a default or a `?` is skipped: omitting it is the declared
 * intent, so `undefined` there is not a surprise.
 *
 * The unit tests cannot catch this class of bug. `tsconfig.spec.json` sets
 * `emitDecoratorMetadata: true`, so ts-jest supplies metadata the production
 * bundler never will, and the spec resolves a real collaborator where the
 * packaged app gets `undefined`.
 */
function findMissingInjects(
  sourceFile: ts.SourceFile,
  filePath: string,
  out: MissingInject[],
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name) {
      const classDecorators = ts.getDecorators?.(node) ?? [];
      const containerBuilt = classDecorators.some((d) =>
        CLASS_DECORATORS.has(decoratorName(d)),
      );
      if (containerBuilt) {
        const ctor = node.members.find(ts.isConstructorDeclaration);
        if (ctor) {
          ctor.parameters.forEach((param, index) => {
            if (param.initializer || param.questionToken) return;
            const paramDecorators = ts.getDecorators?.(param) ?? [];
            const decorated = paramDecorators.some((d) =>
              PARAM_DECORATORS.has(decoratorName(d)),
            );
            if (decorated) return;
            const pos = sourceFile.getLineAndCharacterOfPosition(
              param.getStart(),
            );
            out.push({
              className: node.name?.text ?? '(anonymous)',
              param: ts.isIdentifier(param.name)
                ? param.name.text
                : `#${index}`,
              index,
              file: filePath,
              line: pos.line + 1,
            });
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
  const missing: MissingInject[] = [];

  if (options.selfTest) {
    const aliases = new Map<string, string>();
    const src = fs.readFileSync(FIXTURE_PATH, 'utf8');
    const sf = ts.createSourceFile(
      FIXTURE_PATH,
      src,
      ts.ScriptTarget.ES2022,
      true,
    );
    const localAliases = buildTokenAliasMap([FIXTURE_PATH]);
    for (const [k, v] of localAliases) aliases.set(k, v);
    findInjectionSites(sf, FIXTURE_PATH, injected, aliases);

    const missingSrc = fs.readFileSync(MISSING_FIXTURE_PATH, 'utf8');
    const missingSf = ts.createSourceFile(
      MISSING_FIXTURE_PATH,
      missingSrc,
      ts.ScriptTarget.ES2022,
      true,
    );
    findMissingInjects(missingSf, MISSING_FIXTURE_PATH, missing);
    return { registered, injected, missing };
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

  // Second invariant: a container-constructed class must name EVERY required
  // constructor dependency. Scanned over the same files, but keyed off the
  // tsyringe import rather than `@inject(`, because the whole point is to
  // catch a class that injects nothing at all.
  for (const filePath of injectionFiles) {
    const src = fs.readFileSync(filePath, 'utf8');
    if (!/from ['"]tsyringe['"]/.test(src)) continue;
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.ES2022, true);
    findMissingInjects(sf, filePath, missing);
  }

  return { registered, injected, missing };
}

function relPath(p: string): string {
  return path.relative(REPO_ROOT, p).replace(/\\/g, '/');
}

async function main(): Promise<number> {
  const selfTest = process.argv.includes('--self-test');
  const verbose = process.argv.includes('--verbose');

  const { registered, injected, missing } = await analyze({ selfTest });

  if (selfTest) {
    const violations = injected.filter(
      (site) => !registered.has(site.resolved),
    );
    // BOTH detectors must fire. Asserting only the exit code would let one
    // rot silently while the other kept the self-test green.
    if (violations.length === 0) {
      console.error(
        'di-lint self-test BROKEN: unregistered-token fixture not detected (linter false-negative)',
      );
      return 2;
    }
    if (missing.length === 0) {
      console.error(
        'di-lint self-test BROKEN: missing-@inject fixture not detected (linter false-negative)',
      );
      return 2;
    }
    // The fixture's optional and defaulted parameters must NOT be reported.
    const overReported = missing.filter(
      (m) => m.param === 'optionalOne' || m.param === 'withDefault',
    );
    if (overReported.length > 0) {
      console.error(
        'di-lint self-test BROKEN: missing-@inject detector reported an optional/defaulted parameter (false-positive)',
      );
      for (const m of overReported) {
        console.error(`  ${relPath(m.file)}:${m.line} ${m.param}`);
      }
      return 2;
    }
    console.error(
      `di-lint self-test: ${violations.length} unregistered @inject token(s) and ${missing.length} missing @inject(s) in fixtures (expected)`,
    );
    for (const v of violations) {
      console.error(
        `ERROR: ${relPath(v.file)}:${v.line} injects ${v.token} but no register*.ts registers it`,
      );
    }
    for (const m of missing) {
      console.error(
        `ERROR: ${relPath(m.file)}:${m.line} ${m.className} parameter #${m.index} '${m.param}' has no @inject`,
      );
    }
    return 1;
  }

  const violations = injected.filter((site) => !registered.has(site.resolved));

  if (verbose) {
    console.log(
      `di-lint: scanned ${registered.size} registered tokens, ${injected.length} injection sites`,
    );
  }

  if (violations.length === 0 && missing.length === 0) {
    console.log(
      `di-lint OK: ${injected.length} @inject sites all resolve to a registered token (${registered.size} tokens); every container-constructed class names all required dependencies`,
    );
    return 0;
  }

  if (violations.length > 0) {
    console.error(
      `di-lint FAIL: ${violations.length} unregistered @inject token(s)`,
    );
    for (const v of violations) {
      console.error(
        `ERROR: ${relPath(v.file)}:${v.line} injects ${v.token} but no register*.ts registers it`,
      );
    }
  }

  if (missing.length > 0) {
    console.error(
      `di-lint FAIL: ${missing.length} required constructor parameter(s) with no @inject`,
    );
    console.error(
      '  Production bundles carry no design:paramtypes (emitDecoratorMetadata is off,',
    );
    console.error(
      '  and esbuild ignores it regardless), so tsyringe passes undefined for these',
    );
    console.error(
      '  positions. The class still resolves; it fails later at first use. Specs do',
    );
    console.error(
      '  NOT catch it — tsconfig.spec.json enables emitDecoratorMetadata.',
    );
    console.error(
      '  Fix: add @inject(TOKEN) / @inject(Class), or give the parameter a default',
    );
    console.error('  or `?` if omitting it is genuinely intended.');
    for (const m of missing) {
      console.error(
        `ERROR: ${relPath(m.file)}:${m.line} ${m.className} parameter #${m.index} '${m.param}' has no @inject`,
      );
    }
  }

  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('di-lint crashed:', err);
    process.exit(2);
  });
