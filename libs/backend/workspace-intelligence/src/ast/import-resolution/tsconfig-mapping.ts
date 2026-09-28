/**
 * The module mapping the workspace's root `tsconfig*.json` files define,
 * with TypeScript's `extends` semantics (Batch 32b review r1 R32B-01).
 *
 * Each root config's effective options are its own `compilerOptions` over
 * those it extends: an `extends` list applies in order, each later entry
 * overriding the earlier ones, and the config itself overrides them all.
 * `paths` and `baseUrl` are replaced whole, never merged. A config another
 * root config extends is superseded by that config and is not applied on
 * its own. The remaining (top) configs are independent projects, and which
 * one governs a file is not known here. So `paths` are used only when every
 * top config that has `paths` got them from the same declaring config (one
 * config, or one shared base its extends chains reach): the resolver never
 * picks a target across configs. When two or more independent configs
 * declare `paths` (User Decision 28, review r1 R33-10), no `paths` rule is
 * used and `conflicting-configs` is disclosed, so an alias-matched import is
 * external only as far as the context knows, never a guessed edge. Different
 * `baseUrl`s are disclosed the same way. A top config that maps nothing (an
 * Nx root `tsconfig.json` holding only project `references`, for example)
 * conflicts with nothing.
 *
 * Each config's effective options are evaluated once and memoised, so a
 * shared or repeated parent in the extends graph costs one evaluation, not
 * one per path to it (review r1 R33-08).
 *
 * Every config here lies in the root directory, so a relative `baseUrl` and
 * the targets of `paths` without a `baseUrl` are relative to the root.
 */
import * as path from 'path';
import type { ResolverContextGap, TsconfigPathRule } from './resolver-context';

/** One root config as read. */
export interface RootTsconfig {
  /** File name as listed (`tsconfig.base.json`). */
  readonly name: string;
  readonly config: Record<string, unknown>;
}

export interface TsconfigMapping {
  readonly paths: readonly TsconfigPathRule[];
  readonly baseUrls: readonly string[];
  readonly gaps: readonly ResolverContextGap[];
}

/** The options of one config that module mapping reads. */
interface MappingOptions {
  /** Absolute directory (forward slashes). */
  readonly baseUrl?: string;
  readonly paths?: ReadonlyArray<readonly [string, readonly string[]]>;
  /** The (lower-cased) config whose own `paths` these are. */
  readonly pathsFrom?: string;
}

const TSCONFIG_NAME = /^tsconfig.*\.json$/i;

/** See the module comment. `root` uses forward slashes, no trailing slash. */
export function mapRootTsconfigs(
  configs: readonly RootTsconfig[],
  root: string,
): TsconfigMapping {
  const gaps = new Set<ResolverContextGap>();
  const byName = new Map(configs.map((cfg) => [cfg.name.toLowerCase(), cfg]));
  const parents = new Map<string, string[]>();
  const extended = new Set<string>();
  for (const cfg of configs) {
    const names = extendsOf(cfg.config['extends']);
    if (names === undefined) gaps.add('manifest-unparseable');
    const resolved: string[] = [];
    for (const entry of names ?? []) {
      const name = rootLevelConfigName(entry, root);
      if (name === undefined || !byName.has(name)) {
        gaps.add('extends-not-read');
        continue;
      }
      resolved.push(name);
      extended.add(name);
    }
    parents.set(cfg.name.toLowerCase(), resolved);
  }

  const memo = new Map<string, MappingOptions>();
  const visiting = new Set<string>();
  const effective = (name: string): MappingOptions => {
    const known = memo.get(name);
    if (known !== undefined) return known;
    if (visiting.has(name)) {
      gaps.add('manifest-unparseable'); // an extends cycle
      return {};
    }
    visiting.add(name);
    let options: MappingOptions = {};
    for (const parent of parents.get(name) ?? []) {
      options = override(options, effective(parent));
    }
    visiting.delete(name);
    const own = byName.get(name);
    const result = own
      ? override(options, ownOptions(own.config, name, root, gaps))
      : options;
    memo.set(name, result);
    return result;
  };

  // Every config is evaluated, so an extends cycle (whose members all
  // extend each other and so are never top configs) is still disclosed.
  const allOptions = new Map(
    configs.map((cfg) => {
      const name = cfg.name.toLowerCase();
      return [name, effective(name)] as const;
    }),
  );
  const tops = [...allOptions.keys()].filter((name) => !extended.has(name));
  const baseUrls = new Set<string>();
  /** Effective `paths` (with their base directory) by declaring config. */
  const pathSources = new Map<string, TsconfigPathRule[]>();
  for (const name of tops) {
    const options = allOptions.get(name) ?? {};
    if (options.baseUrl !== undefined) baseUrls.add(options.baseUrl);
    if (options.paths === undefined || options.pathsFrom === undefined) {
      continue;
    }
    const baseDir = options.baseUrl ?? root;
    const rules = options.paths.map(([pattern, targets]) => ({
      pattern,
      targets,
      baseDir,
    }));
    const key = `${options.pathsFrom}\u0000${baseDir}`;
    if (!pathSources.has(key)) pathSources.set(key, rules);
  }
  const conflicting = pathSources.size > 1;
  if (conflicting || baseUrls.size > 1) gaps.add('conflicting-configs');
  return {
    paths: conflicting ? [] : [...pathSources.values()].flat(),
    baseUrls: baseUrls.size === 1 ? [...baseUrls] : [],
    gaps: [...gaps],
  };
}

/** `parent` with every option `child` sets replaced by the child's. */
function override(
  parent: MappingOptions,
  child: MappingOptions,
): MappingOptions {
  return {
    ...parent,
    ...(child.baseUrl === undefined ? {} : { baseUrl: child.baseUrl }),
    ...(child.paths === undefined
      ? {}
      : { paths: child.paths, pathsFrom: child.pathsFrom }),
  };
}

/** The `baseUrl` and `paths` a config sets itself (malformed ones: a gap). */
function ownOptions(
  config: Record<string, unknown>,
  name: string,
  root: string,
  gaps: Set<ResolverContextGap>,
): MappingOptions {
  const compilerOptions = config['compilerOptions'];
  if (compilerOptions === undefined) return {};
  if (!isRecord(compilerOptions)) {
    gaps.add('manifest-unparseable');
    return {};
  }
  const baseUrl = compilerOptions['baseUrl'];
  const paths = compilerOptions['paths'];
  let options: MappingOptions = {};
  if (typeof baseUrl === 'string') {
    options = { baseUrl: directoryUnder(root, baseUrl) };
  } else if (baseUrl !== undefined) {
    gaps.add('manifest-unparseable');
  }
  if (paths === undefined) return options;
  if (!isRecord(paths)) {
    gaps.add('manifest-unparseable');
    return options;
  }
  const entries: Array<readonly [string, readonly string[]]> = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (
      Array.isArray(targets) &&
      targets.every((target): target is string => typeof target === 'string')
    ) {
      entries.push([pattern, targets]);
    } else {
      gaps.add('manifest-unparseable');
    }
  }
  return { ...options, paths: entries, pathsFrom: name };
}

/** The configs an `extends` names; `undefined` when it is malformed. */
function extendsOf(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

/**
 * The lower-cased file name an `extends` names when it is a root-level
 * config (`./tsconfig.base.json`, `./tsconfig.base`), else `undefined` (a
 * package, a nested or outside path).
 */
function rootLevelConfigName(
  extended: string,
  root: string,
): string | undefined {
  if (!extended.startsWith('.')) return undefined;
  const target = path.posix.join(root, extended.replace(/\\/g, '/'));
  if (path.posix.dirname(target) !== root) return undefined;
  const name = path.posix.basename(target).toLowerCase();
  const withJson = name.endsWith('.json') ? name : `${name}.json`;
  return TSCONFIG_NAME.test(withJson) ? withJson : undefined;
}

/** `dir` resolved against `root` (an absolute `dir` stays), forward slashes. */
function directoryUnder(root: string, dir: string): string {
  const normalized = dir.replace(/\\/g, '/');
  const absolute =
    normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
      ? path.posix.normalize(normalized)
      : path.posix.join(root, normalized);
  const trimmed = absolute.replace(/\/+$/, '');
  return trimmed === '' || /^[A-Za-z]:$/.test(trimmed)
    ? `${trimmed}/`
    : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
