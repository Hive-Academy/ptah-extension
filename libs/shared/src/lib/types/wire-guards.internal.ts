/**
 * Zod-free primitives for hand-written wire parsers.
 *
 * These mirror the runtime behaviour of the Zod combinators used by the
 * schemas in `*.schemas.ts`, one helper per combinator, so that a parser
 * written against them can be proven equivalent to its schema by test
 * (see `*.parsers.spec.ts`).
 *
 * Why this exists: the webview's initial bundle carried 304 kB of `zod`
 * purely because six streaming-path payloads were validated with it at the
 * frontend receive point. The schemas remain the source of truth and are
 * still used by the backend; these helpers let the frontend enforce the
 * *identical* contract without shipping the Zod runtime. See TASK_2026_187
 * Unit 10.
 *
 * **Every helper here is behaviour-locked to a Zod combinator.** Changing one
 * without changing its schema counterpart breaks the equivalence tests, which
 * is exactly the intended failure mode. Do not "improve" these in isolation.
 *
 * @internal Not part of the public `@ptah-extension/shared` surface.
 */

/**
 * Mirrors Zod's object-input check (`z.object(...)`).
 *
 * Zod accepts any non-null `typeof === 'object'` that is not an array, then
 * reads own properties. Arrays are rejected outright.
 */
export function isWireObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Mirrors `z.string()`. */
export function isWireString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Mirrors `z.string().min(1)`. */
export function isNonEmptyWireString(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1;
}

/** Mirrors `z.boolean()`. */
export function isWireBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Mirrors `z.number()`.
 *
 * Zod 4 rejects `NaN`, `Infinity` and `-Infinity` for a plain `z.number()`,
 * so this is a finiteness check, not a `typeof` check.
 */
export function isWireNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Mirrors `z.number().int().nonnegative()`.
 *
 * Zod 4's `.int()` enforces the *safe* integer range, so `2 ** 53` is
 * rejected even though `Number.isInteger` accepts it.
 */
export function isWireTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Mirrors Zod 4's `z.string().uuid()`.
 *
 * Deliberately **not** the same as `UUID_REGEX` in `branded.types.ts`: Zod's
 * `.uuid()` accepts any RFC 9562 version (`1`-`8`) plus the nil and max
 * UUIDs, whereas `UUID_REGEX` accepts v4 only. Both appear in
 * `PermissionRequestSchema` — `id` uses this one, `sessionId`/`tabId` use the
 * v4-only one — so the distinction is load-bearing.
 */
const ZOD_UUID_REGEX =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** Mirrors `z.string().uuid()` (any UUID version, plus nil/max). */
export function isWireUuid(value: unknown): value is string {
  return typeof value === 'string' && ZOD_UUID_REGEX.test(value);
}

/**
 * Mirrors the *plain object* test that `z.record(...)` applies to its input.
 *
 * This is strictly narrower than {@link isWireObject}. Zod's `z.object(...)`
 * accepts any non-null, non-array object and lets the per-field checks do the
 * rejecting; `z.record(...)` additionally refuses anything that is not a
 * plain data bag. Verified against zod 4.3.6 over 26 inputs — plain objects,
 * null-prototype objects and arbitrarily deep plain prototype chains are
 * accepted; `Date`, `Map`, `Set`, `WeakMap`, `Promise`, `Error`, `RegExp`,
 * typed arrays, arrays, class instances and subclass instances are rejected,
 * as is any object carrying `Symbol.toStringTag` or `Symbol.iterator`.
 *
 * The distinction is load-bearing: structured-clone transports (Electron IPC)
 * can deliver a `Date` or `Map` where a plain record is expected, and Zod
 * drops such a payload. A parser that accepted them would widen the trust
 * boundary.
 */
function isPlainWireRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  if (Symbol.toStringTag in value) return false;
  if (Symbol.iterator in value) return false;
  let proto: object | null = Object.getPrototypeOf(value) as object | null;
  while (proto !== null) {
    if (Object.prototype.hasOwnProperty.call(proto, 'constructor')) {
      if ((proto as { constructor?: unknown }).constructor !== Object) {
        return false;
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return true;
}

/**
 * Mirrors `z.record(z.string(), z.unknown())`.
 *
 * Accepts any own key with any value, including an explicitly `undefined`
 * value (Zod preserves that key). Returns a shallow copy, as Zod does.
 */
export function parseWireRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!isPlainWireRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = value[key];
  return out;
}

/**
 * Mirrors `<schema>.optional()` on an object property.
 *
 * Zod's contract, verified against zod 4.3.6:
 * - key absent from input  → valid, key absent from output
 * - key present, value `undefined` → valid, key present with `undefined`
 * - key present, any other value  → must satisfy `check`
 *
 * `assign` is invoked only when the key should appear on the output, which
 * keeps `Object.keys(parsed)` identical to Zod's.
 *
 * @returns `false` when the property is present but invalid.
 */
export function readOptional<T>(
  source: Record<string, unknown>,
  key: string,
  check: (value: unknown) => value is T,
  assign: (value: T | undefined) => void,
): boolean {
  if (!(key in source)) return true;
  const raw = source[key];
  if (raw === undefined) {
    assign(undefined);
    return true;
  }
  if (!check(raw)) return false;
  assign(raw);
  return true;
}

/**
 * Builds a `oneOf` check from a literal tuple — mirrors
 * `z.union([z.literal(a), z.literal(b), ...])`.
 */
export function wireLiteralUnion<const T extends readonly string[]>(
  literals: T,
): (value: unknown) => value is T[number] {
  const allowed = new Set<unknown>(literals);
  return (value: unknown): value is T[number] => allowed.has(value);
}

/**
 * Mirrors `z.array(inner)` followed by `.readonly()`.
 *
 * Zod maps every element through `inner` (so element objects are fresh,
 * key-stripped copies) and freezes the resulting array — but not its
 * elements. This does the same.
 */
export function parseWireReadonlyArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return Object.freeze(out);
}
