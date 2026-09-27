#!/usr/bin/env npx ts-node
/**
 * i18n-check — per-project translation checks (plan Component 2, F2a rules).
 *
 *   main.ts --project-root <p> --scope <s> [--allow-scope ui,core]
 *           --glossary <file> [--workspace-root <dir>]
 *
 * Rules: parity (7.1), key references and computed keys (7.2), placeholder and
 * markup parity, glossary (6.2), real Arabic (8.1), and `sole-default-key`
 * (a translation file whose only top-level key is `default` cannot be told
 * apart from a JSON module wrapper by `I18nService`).
 *
 * Every violation is printed as `file:line: [kind] key - detail`, sorted, and
 * the run exits 1. A file that fails to parse is a violation, never skipped.
 * Exit 0 only when clean; exit 2 on a usage error.
 *
 * `--workspace-root` (default: the current directory) is where the scope map
 * and `--project-root` resolve; the self-test points it at the fixture tree.
 *
 * Key targets: `translate`, `translateSignal` and the `transloco` pipe need a
 * single key (`leaf`); `translateObjectSignal` needs a non-empty group
 * (`object`). A computed argument is checked with its own call's target,
 * through the `i18n-keys:` marker that covers it or the key constant it reads.
 */
import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import * as ts from 'typescript';
import { checkGlossaryAndArabic, loadGlossary } from './lib/glossary';
import { coversOffset, type Marker } from './lib/markers';
import {
  formatViolation,
  normaliseViolations,
  type Violation,
} from './lib/report';
import {
  SCOPE_MAP,
  defaultAllowedScopes,
  isKnownScope,
  literalKeyPattern,
  owningScope,
  scopeI18nDir,
} from './lib/scope-map';
import {
  extractTemplateKeys,
  type KeyUse,
  type ScannedString,
  type TemplateSource,
} from './lib/template-keys';
import {
  checkParity,
  checkPlaceholdersAndMarkup,
  loadTranslationFile,
  type TranslationFile,
} from './lib/translation-files';
import {
  extractTsKeys,
  parseTypeScriptFiles,
  type KeyAlias,
  type KeyConst,
  type ParsedTsFile,
} from './lib/ts-keys';

export interface Options {
  workspaceRoot: string;
  projectRoot: string;
  scope: string;
  allowScopes: string[];
  glossary: string;
}

class UsageError extends Error {
  override readonly name = 'UsageError';
}

const USAGE =
  'usage: main.ts --project-root <p> --scope <s> [--allow-scope ui,core] --glossary <file> [--workspace-root <dir>]';

function parseArgs(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      ![
        '--project-root',
        '--scope',
        '--allow-scope',
        '--glossary',
        '--workspace-root',
      ].includes(flag)
    ) {
      throw new UsageError(`unknown argument "${flag}"`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} needs a value`);
    }
    values.set(flag, value);
  }

  const projectRoot = values.get('--project-root');
  const scope = values.get('--scope');
  const glossary = values.get('--glossary');
  if (!projectRoot || !scope || !glossary) {
    throw new UsageError('--project-root, --scope and --glossary are required');
  }
  if (!isKnownScope(scope)) {
    throw new UsageError(`unknown scope "${scope}"`);
  }
  const normalisedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalisedRoot !== SCOPE_MAP[scope].projectRoot) {
    throw new UsageError(
      `--project-root ${normalisedRoot} does not match scope "${scope}" (${SCOPE_MAP[scope].projectRoot})`,
    );
  }

  const allowFlag = values.get('--allow-scope');
  const allowScopes =
    allowFlag === undefined
      ? defaultAllowedScopes(scope)
      : allowFlag
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
  for (const allowed of allowScopes) {
    if (!isKnownScope(allowed) || allowed === scope) {
      throw new UsageError(`invalid --allow-scope entry "${allowed}"`);
    }
  }

  return {
    workspaceRoot: path.resolve(
      values.get('--workspace-root') ?? process.cwd(),
    ),
    projectRoot: normalisedRoot,
    scope,
    allowScopes: [...new Set(allowScopes)].sort(),
    glossary,
  };
}

function toRel(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).split(path.sep).join('/');
}

type Target = 'leaf' | 'object' | 'any';

interface ProjectScan {
  uses: KeyUse[];
  strings: ScannedString[];
  keyConsts: KeyConst[];
  aliases: KeyAlias[];
  markers: Marker[];
  violations: Violation[];
}

async function scanProject(options: Options): Promise<ProjectScan> {
  const srcRel = `${options.projectRoot}/src`;
  const srcRoot = path.join(options.workspaceRoot, srcRel);
  const files = (
    await fg(['**/*.ts', '**/*.html'], {
      cwd: srcRoot,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.d.ts',
      ],
    })
  ).sort();

  const scan: ProjectScan = {
    uses: [],
    strings: [],
    keyConsts: [],
    aliases: [],
    markers: [],
    violations: [],
  };
  if (files.length === 0) {
    // Nothing checked is not the same as clean (a wrong or emptied root).
    scan.violations.push({
      file: srcRel,
      line: 0,
      kind: 'no-source-files',
      key: '',
      detail: 'no .ts or .html source file found under the project src',
    });
    return scan;
  }

  const addTemplate = (template: TemplateSource): void => {
    const result = extractTemplateKeys(template);
    scan.uses.push(...result.uses);
    scan.strings.push(...result.strings);
    scan.markers.push(...result.markers);
    scan.violations.push(...result.violations);
  };

  const parsedTs = parseTypeScriptFiles(files.filter((f) => f.endsWith('.ts')));
  for (const absPath of files) {
    const file = toRel(options.workspaceRoot, absPath);
    try {
      scanFile(absPath, file, parsedTs.get(absPath), scan, addTemplate);
    } catch (error: unknown) {
      // One file that cannot be processed is that file's failure; the scan
      // goes on so every other file's rules still run.
      scan.violations.push({
        file,
        line: 0,
        kind: 'parse-error',
        key: '',
        detail: `could not be processed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return scan;
}

function scanFile(
  absPath: string,
  file: string,
  parsed: ParsedTsFile | undefined,
  scan: ProjectScan,
  addTemplate: (template: TemplateSource) => void,
): void {
  if (absPath.endsWith('.html')) {
    const text = fs.readFileSync(absPath, 'utf8');
    addTemplate({ text, file, firstLine: 1, firstOffset: 0 });
    return;
  }

  if (!parsed) {
    scan.violations.push({
      file,
      line: 0,
      kind: 'parse-error',
      key: '',
      detail: 'file could not be loaded',
    });
    return;
  }
  if (parsed.diagnostics.length > 0) {
    const first = parsed.diagnostics[0];
    const line =
      first.start === undefined
        ? 0
        : parsed.source.getLineAndCharacterOfPosition(first.start).line + 1;
    scan.violations.push({
      file,
      line,
      kind: 'parse-error',
      key: '',
      detail: ts.flattenDiagnosticMessageText(first.messageText, ' '),
    });
    return;
  }

  const tsScan = extractTsKeys(parsed.source, file);
  scan.uses.push(...tsScan.uses);
  scan.strings.push(...tsScan.strings);
  scan.keyConsts.push(...tsScan.keyConsts);
  scan.aliases.push(...tsScan.aliases);
  scan.markers.push(...tsScan.markers);
  scan.violations.push(...tsScan.violations);
  for (const inline of tsScan.templates) {
    addTemplate({ ...inline, file });
  }
}

/** Resolves keys against the owning scope's `en.json`, enforcing allowed scopes. */
class KeyResolver {
  constructor(
    private readonly scopes: ReadonlyMap<string, TranslationFile>,
    private readonly ownScope: string,
  ) {}

  /** Null when the key is fine for `target`, otherwise the violation to report. */
  check(
    key: string,
    target: Target,
    file: string,
    line: number,
  ): Violation | null {
    const scope = owningScope(key);
    const translations = this.scopes.get(scope);
    if (!translations) {
      return {
        file,
        line,
        kind: 'foreign-scope',
        key,
        detail: `scope "${scope}" is neither the project scope "${this.ownScope}" nor an allowed scope`,
      };
    }
    // An unreadable file is already a violation; its keys cannot be judged.
    if (!translations.loaded) return null;
    const isLeaf = translations.entries.has(key);
    const isGroup = (translations.namespaces.get(key) ?? 0) > 0;
    if (target === 'leaf' && isLeaf) return null;
    if (target === 'object' && isGroup) return null;
    if (target === 'any' && (isLeaf || isGroup)) return null;
    if (target === 'object' && isLeaf) {
      return {
        file,
        line,
        kind: 'not-a-group',
        key,
        detail: `translateObjectSignal needs a non-empty group, but this is a single key in ${translations.file}`,
      };
    }
    return {
      file,
      line,
      kind: 'unknown-key',
      key,
      detail: `not ${target === 'object' ? 'a non-empty group' : 'a key'} in ${translations.file}`,
    };
  }

  /** `prefix.*` must name a non-empty group in its owning scope. */
  checkPrefix(prefix: string, file: string, line: number): Violation | null {
    const problem = this.check(prefix, 'object', file, line);
    if (problem && problem.kind !== 'foreign-scope') {
      return {
        ...problem,
        kind: 'unknown-key',
        key: `${prefix}.*`,
        detail: `${prefix} is not a non-empty group`,
      };
    }
    return problem;
  }
}

/** Collects, per marker or key constant, the targets of the uses that read it. */
class TargetMap<T> {
  private readonly map = new Map<T, Set<Target>>();

  add(item: T, target: Target): void {
    const set = this.map.get(item) ?? new Set<Target>();
    set.add(target);
    this.map.set(item, set);
  }

  /** The recorded targets, or `any` when nothing reads the item. */
  of(item: T): Target[] {
    const set = this.map.get(item);
    return set ? [...set].sort() : ['any'];
  }
}

export async function run(options: Options): Promise<Violation[]> {
  const violations: Violation[] = [];
  const push = (v: Violation | null): void => {
    if (v) violations.push(v);
  };
  const glossaryAbs = path.resolve(options.workspaceRoot, options.glossary);
  const glossary = loadGlossary(
    glossaryAbs,
    toRel(options.workspaceRoot, glossaryAbs),
  );
  violations.push(...glossary.violations);

  const loadScope = (scope: string, lang: 'en' | 'ar'): TranslationFile => {
    const rel = `${scopeI18nDir(scope)}/${lang}.json`;
    return loadTranslationFile(
      path.join(options.workspaceRoot, rel),
      rel,
      scope,
    );
  };

  // Own scope: every file-level rule.
  const en = loadScope(options.scope, 'en');
  const ar = loadScope(options.scope, 'ar');
  violations.push(...en.violations, ...ar.violations);
  violations.push(...checkParity(en, ar));
  violations.push(...checkPlaceholdersAndMarkup(en, ar));
  violations.push(...checkGlossaryAndArabic(en, ar, glossary));

  // Allowed scopes: only whether their `en.json` can be read. Their content is
  // checked by their own project's run.
  const scopes = new Map<string, TranslationFile>([[options.scope, en]]);
  for (const allowed of options.allowScopes) {
    const allowedEn = loadScope(allowed, 'en');
    violations.push(
      ...allowedEn.violations.filter(
        (v) => v.kind === 'missing-file' || v.kind === 'parse-error',
      ),
    );
    scopes.set(allowed, allowedEn);
  }
  const resolver = new KeyResolver(scopes, options.scope);

  const scan = await scanProject(options);
  violations.push(...scan.violations);

  // Key constants, by name. A name declared twice is ambiguous for every
  // receiver that reads it.
  const keyConsts = new Map<string, KeyConst[]>();
  for (const keyConst of scan.keyConsts) {
    keyConsts.set(keyConst.name, [
      ...(keyConsts.get(keyConst.name) ?? []),
      keyConst,
    ]);
  }
  for (const [name, declarations] of keyConsts) {
    if (declarations.length < 2) continue;
    const where = declarations.map((d) => `${d.file}:${d.line}`).join(', ');
    for (const d of declarations) {
      push({
        file: d.file,
        line: d.line,
        kind: 'duplicate-key-constant',
        key: name,
        detail: `declared more than once in the project: ${where}`,
      });
    }
  }
  const aliases = new Map(scan.aliases.map((a) => [a.name, a.target]));
  const keyConstOf = (receiver: string | null): string | null => {
    if (receiver === null) return null;
    if (keyConsts.has(receiver)) return receiver;
    const target = aliases.get(receiver);
    return target !== undefined && keyConsts.has(target) ? target : null;
  };

  // Pipe and translate() arguments. Literal keys are checked here; computed
  // ones record their target on the marker or constant that vouches for them.
  const markerTargets = new TargetMap<Marker>();
  const constTargets = new TargetMap<string>();
  const keysMarkers = scan.markers.filter(
    (m) => m.kind === 'keys' && m.tokens.length > 0,
  );
  for (const use of scan.uses) {
    if (use.form === 'literal') {
      push(resolver.check(use.key, use.target, use.file, use.line));
      continue;
    }
    const covering = keysMarkers.filter(
      (m) => m.file === use.file && coversOffset(m, use.offset),
    );
    covering.forEach((m) => markerTargets.add(m, use.target));
    const constName = keyConstOf(use.receiver);
    if (constName !== null) constTargets.add(constName, use.target);
    if (covering.length === 0 && constName === null) {
      push({
        file: use.file,
        line: use.line,
        kind: 'unannotated-computed-key',
        key: use.key,
        detail: `cover it with an \`i18n-keys:\` marker or read it from a \`*I18N_KEYS\` constant (needs ${use.target === 'object' ? 'a non-empty group' : 'a key'})`,
      });
    }
  }

  // Markers: every `i18n-keys:` token is checked with the target of each use
  // the marker covers (`any` when it covers none).
  for (const marker of scan.markers) {
    if (marker.kind === 'ignore') {
      if (marker.reason === '') {
        push({
          file: marker.file,
          line: marker.line,
          kind: 'bare-marker',
          key: '',
          detail: 'i18n-ignore: needs a reason',
        });
      }
      continue;
    }
    if (marker.tokens.length === 0) {
      push({
        file: marker.file,
        line: marker.line,
        kind: 'bare-marker',
        key: '',
        detail: 'i18n-keys: lists no key',
      });
      continue;
    }
    for (const target of markerTargets.of(marker)) {
      for (const token of marker.tokens) {
        push(
          token.endsWith('.*')
            ? resolver.checkPrefix(token.slice(0, -2), marker.file, marker.line)
            : resolver.check(token, target, marker.file, marker.line),
        );
      }
    }
  }

  // Key constants: every value is checked with the target of each use that
  // reads the constant (`any` when none does).
  for (const keyConst of scan.keyConsts) {
    if (keyConst.problem) {
      push({
        file: keyConst.file,
        line: keyConst.line,
        kind: 'invalid-key-const',
        key: keyConst.name,
        detail: keyConst.problem,
      });
    }
    for (const target of constTargets.of(keyConst.name)) {
      for (const key of keyConst.keys) {
        push(resolver.check(key.value, target, key.file, key.line));
      }
    }
  }

  // Literal scan, anchored on the project's own scope.
  const pattern = literalKeyPattern(options.scope);
  const ignoreMarkers = scan.markers.filter(
    (m) => m.kind === 'ignore' && m.reason !== '',
  );
  for (const s of scan.strings) {
    if (!pattern.test(s.value)) continue;
    const ignored = ignoreMarkers.some(
      (m) => m.file === s.file && coversOffset(m, s.offset),
    );
    if (!ignored) push(resolver.check(s.value, 'any', s.file, s.line));
  }

  return normaliseViolations(violations);
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      console.error(`i18n-check: ${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }

  const violations = await run(options);
  const label = `i18n-check [${options.scope}]`;
  if (violations.length === 0) {
    console.log(`${label}: OK`);
    return 0;
  }
  for (const v of violations) console.log(formatViolation(v));
  console.log(`${label}: ${violations.length} violation(s)`);
  return 1;
}

// Imported by the spec for `run`; executed as the CLI entry point.
if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error('i18n-check: internal error', error);
      process.exit(2);
    });
}
