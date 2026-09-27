/**
 * Fixed scope-to-path map (plan Component 3 scope table).
 *
 * A key's owning scope is its first segment. The checker reads that scope's
 * `en.json` from the owning project's i18n directory listed here, relative to
 * the workspace root. The map is data, not an import of project code.
 */

export interface ScopeLocation {
  /** Project root, workspace-relative. */
  projectRoot: string;
  /** Directory holding `en.json` / `ar.json`, relative to `projectRoot`. */
  i18nDir: string;
}

export const SCOPE_MAP: Readonly<Record<string, ScopeLocation>> = {
  app: { projectRoot: 'apps/ptah-landing-page', i18nDir: 'src/app/i18n' },
  ui: { projectRoot: 'libs/web/ui', i18nDir: 'src/lib/i18n' },
  panelUi: { projectRoot: 'libs/web/panel-ui', i18nDir: 'src/lib/i18n' },
  core: { projectRoot: 'libs/web/core', i18nDir: 'src/lib/i18n' },
  landing: { projectRoot: 'libs/web/landing', i18nDir: 'src/lib/i18n' },
  legal: { projectRoot: 'libs/web/legal', i18nDir: 'src/lib/i18n' },
  pricing: { projectRoot: 'libs/web/pricing', i18nDir: 'src/lib/i18n' },
  auth: { projectRoot: 'libs/web/auth', i18nDir: 'src/lib/i18n' },
  account: { projectRoot: 'libs/web/account', i18nDir: 'src/lib/i18n' },
  members: { projectRoot: 'libs/web/members', i18nDir: 'src/lib/i18n' },
  admin: { projectRoot: 'libs/web/admin', i18nDir: 'src/lib/i18n' },
};

export const KNOWN_SCOPES: readonly string[] = Object.keys(SCOPE_MAP).sort();

export function isKnownScope(scope: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCOPE_MAP, scope);
}

/**
 * `--allow-scope` default: `ui` and `core` are global scopes, loaded at init,
 * so every project may consume them. `ui` itself allows nothing and `core`
 * allows only `ui` (plan:289, rev 1 B1).
 */
export function defaultAllowedScopes(scope: string): string[] {
  if (scope === 'ui') return [];
  if (scope === 'core') return ['ui'];
  return ['ui', 'core'];
}

/** Workspace-relative directory holding the scope's translation files. */
export function scopeI18nDir(scope: string): string {
  const location = SCOPE_MAP[scope];
  if (!location) {
    throw new Error(`i18n-check: unknown scope "${scope}"`);
  }
  return `${location.projectRoot}/${location.i18nDir}`;
}

/** First dot-separated segment of a key or key prefix. */
export function owningScope(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

/**
 * The literal-scan pattern for one scope (plan:287). It is anchored on the
 * project's own scope name, so real copy such as `ptah.live` never matches.
 */
export function literalKeyPattern(scope: string): RegExp {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\.[A-Za-z0-9_]+(\\.[A-Za-z0-9_-]+)+$`);
}
