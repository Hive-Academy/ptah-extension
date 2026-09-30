/**
 * Key resolution for the reference rules (7.2): a key is checked against
 * its owning scope's `en.json`, which must be the project's own scope or an
 * allowed one.
 */
import { compareText, type Violation } from './report';
import { owningScope } from './scope-map';
import type { TranslationFile } from './translation-files';

/**
 * What a key must name: `translate`, `translateSignal` and the `transloco`
 * pipe need a single key (`leaf`); `translateObjectSignal` needs a non-empty
 * group (`object`); `any` accepts either (nothing reads the key).
 */
export type Target = 'leaf' | 'object' | 'any';

/** Resolves keys against the owning scope's `en.json`, enforcing allowed scopes. */
export class KeyResolver {
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
export class TargetMap<T> {
  private readonly map = new Map<T, Set<Target>>();

  add(item: T, target: Target): void {
    const set = this.map.get(item) ?? new Set<Target>();
    set.add(target);
    this.map.set(item, set);
  }

  /** The recorded targets, or `any` when nothing reads the item. */
  of(item: T): Target[] {
    const set = this.map.get(item);
    return set ? [...set].sort(compareText) : ['any'];
  }
}
