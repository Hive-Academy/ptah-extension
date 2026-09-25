/**
 * The `:skillRef` route segment — `${kind}:${id}` (implementation plan D1).
 *
 * Three kinds of installed skill share one detail route, and their ids come
 * from three unrelated namespaces: a Ptah plugin id, a community skill name and
 * an external marketplace plugin id. The kind prefix keeps them apart.
 *
 * Decoding splits at the FIRST `:`. No {@link MarketplaceSkillKind} contains a
 * colon, so the tail keeps whatever the id holds — marketplace plugin ids are
 * `external:<owner>/<repo>/<plugin>` (`rpc-plugin-marketplace.types.ts:69`),
 * with both a colon and slashes. The router percent-encodes the slashes, so
 * the whole ref stays ONE path segment (R6, pinned in `skill-ref.spec.ts`).
 * Pure and total: a malformed ref decodes to `null` and the page renders
 * "Not found".
 */

/**
 * The three installed-skill kinds. The names are the row kinds the Connected
 * view already uses for the same three lists (`connected-surface.component.ts`
 * `ConnectedRowKind`, minus `mcp`).
 */
export type MarketplaceSkillKind =
  'ptah-plugin' | 'community-skill' | 'marketplace-plugin';

/** A decoded `:skillRef`. */
export interface SkillRef {
  readonly kind: MarketplaceSkillKind;
  readonly id: string;
}

/**
 * Every kind, as a lookup table. A `Record` over the union, so a new kind
 * without an entry here is a compile error.
 */
const KNOWN_KINDS: Readonly<Record<MarketplaceSkillKind, true>> = {
  'ptah-plugin': true,
  'community-skill': true,
  'marketplace-plugin': true,
};

const SEPARATOR = ':';

/**
 * `{ kind: 'marketplace-plugin', id: 'external:o/r/p' }` →
 * `'marketplace-plugin:external:o/r/p'`.
 */
export function encodeSkillRef(ref: SkillRef): string {
  return `${ref.kind}${SEPARATOR}${ref.id}`;
}

/**
 * Decode a route parameter. Returns `null` for a missing value, a value with no
 * separator, an unknown kind, or an empty id.
 */
export function decodeSkillRef(
  raw: string | null | undefined,
): SkillRef | null {
  if (!raw) return null;

  const separatorAt = raw.indexOf(SEPARATOR);
  if (separatorAt === -1) return null;

  const kind = raw.slice(0, separatorAt);
  const id = raw.slice(separatorAt + SEPARATOR.length);
  if (!isMarketplaceSkillKind(kind) || id.length === 0) return null;

  return { kind, id };
}

function isMarketplaceSkillKind(value: string): value is MarketplaceSkillKind {
  return Object.prototype.hasOwnProperty.call(KNOWN_KINDS, value);
}
