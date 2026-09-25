/**
 * Byte-level encodings the capability policy depends on (TASK_2026_560):
 *
 * - the item-file codec (D2) — ids to `<kind>__l_<pct>.json` or
 *   `<kind>__h_<sha40>.json`, and back;
 * - TOML dotted-key segments for server names written into Codex overrides;
 * - the harness policy fingerprint (N4), and the predicate that compares a
 *   pass's stamped fingerprint with the expected one.
 *
 * The rules that decide what is on live in `capability-toggle.types.ts`; this
 * file only turns values into bytes, names and digests.
 *
 * `libs/shared` ships to the webview bundle, so nothing here may import Node.
 * The hashed filename form is pinned to real SHA-256 output by the D2 fixed
 * vectors (the store and any external tool must name the same file), so a
 * weaker hash cannot stand in for it; SHA-256 is implemented here, FIPS 180-4,
 * synchronously so the codec stays a pure function. The fingerprint is only
 * ever compared with itself, so a cheap FNV-1a is enough there.
 */

import type { HarnessHealth } from './harness-sync.types';
import type { PluginConfigState } from './rpc/rpc-misc.types';

/** What a toggle is about; also the prefix of every item file name. */
export type CapabilityKind = 'mcp' | 'skill' | 'plugin';

// ---------------------------------------------------------------------------
// Item-file codec (D2)
// ---------------------------------------------------------------------------

/** Longest literal form before an id is stored under its hash instead. */
export const CAPABILITY_LITERAL_MAX_LENGTH = 120;

const LITERAL_PREFIX = 'l_';
const HASHED_PREFIX = 'h_';
const HASHED_HEX_LENGTH = 40;
const LITERAL_SAFE_BYTE = /^[a-z0-9_-]$/;
const CAPABILITY_KINDS: readonly CapabilityKind[] = ['mcp', 'skill', 'plugin'];
const FILENAME_PATTERN =
  /^(mcp|skill|plugin)__((?:l_[A-Za-z0-9_%-]*)|(?:h_[0-9a-f]{40}))\.json$/;

/**
 * The on-disk token for an id, in one of two disjoint namespaces.
 *
 * - `l_<pct>` — `pct` keeps `[a-z0-9_-]` and writes every other UTF-8 byte
 *   (upper case, `.`, space, `%`, reserved and control characters) as
 *   upper-case `%XX`, so `Repo` and `repo` never share a file on a
 *   case-insensitive volume.
 * - `h_<sha256(id) hex, first 40>` — when `pct` is longer than
 *   {@link CAPABILITY_LITERAL_MAX_LENGTH}.
 *
 * Every literal token starts `l_` and every hashed one `h_`, so an id that
 * happens to look like a hash (`h_79072a…`) encodes to `l_h_79072a…` and can
 * never collide with the hashed form of another id.
 *
 * @throws TypeError when `id` holds a lone surrogate, which has no UTF-8 form
 *   and would otherwise share a file with its replacement character.
 */
export function encodeCapabilityId(id: string): string {
  const bytes = utf8Bytes(id);
  let pct = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    pct += LITERAL_SAFE_BYTE.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  if (pct.length > CAPABILITY_LITERAL_MAX_LENGTH) {
    return HASHED_PREFIX + sha256Hex(bytes).slice(0, HASHED_HEX_LENGTH);
  }
  return LITERAL_PREFIX + pct;
}

/**
 * The id behind a literal token, or `null` when the token is hashed (not
 * reversible — the reader takes the id from the file content) or is not the
 * canonical encoding of any id.
 */
export function decodeCapabilityId(encoded: string): string | null {
  if (!encoded.startsWith(LITERAL_PREFIX)) return null;
  const pct = encoded.slice(LITERAL_PREFIX.length);
  const bytes: number[] = [];
  for (let index = 0; index < pct.length; index += 1) {
    const char = pct[index];
    if (char !== '%') {
      if (!LITERAL_SAFE_BYTE.test(char)) return null;
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const hex = pct.slice(index + 1, index + 3);
    if (!/^[0-9A-F]{2}$/.test(hex)) return null;
    bytes.push(Number.parseInt(hex, 16));
    index += 2;
  }
  const id = utf8Decode(Uint8Array.from(bytes));
  if (id === null) return null;
  // Canonical only: `%61` for `a`, or a token long enough to have been hashed,
  // is not how any id is written, and accepting it would let two names mean
  // one item.
  return encodeCapabilityId(id) === encoded ? id : null;
}

/** `<kind>__<token>.json` — the only name an explicit item file may have. */
export function canonicalFilename(kind: CapabilityKind, id: string): string {
  return `${kind}__${encodeCapabilityId(id)}.json`;
}

/**
 * Split an item file name into its kind and token, or `null` for any name
 * outside the pattern (a sync-tool conflict copy, a `.tmp`), which readers
 * ignore. It does not prove the file is canonical: the reader must still
 * recompute {@link canonicalFilename} from the content and compare.
 */
export function parseCapabilityFilename(
  fileName: string,
): { kind: CapabilityKind; encoded: string } | null {
  const match = FILENAME_PATTERN.exec(fileName);
  if (match === null) return null;
  const kind = CAPABILITY_KINDS.find((candidate) => candidate === match[1]);
  return kind === undefined ? null : { kind, encoded: match[2] };
}

// ---------------------------------------------------------------------------
// TOML keys
// ---------------------------------------------------------------------------

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * One TOML dotted-key segment for `name`: bare when TOML allows it, otherwise
 * a basic string with `"`, `\` and control characters escaped. A server name
 * with a `.` must be quoted, or `mcp_servers.my.server` names a different
 * table.
 */
export function tomlKeySegment(name: string): string {
  if (TOML_BARE_KEY.test(name)) return name;
  let quoted = '"';
  for (const char of name) {
    quoted += tomlEscape(char);
  }
  return `${quoted}"`;
}

const TOML_SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
};

function tomlEscape(char: string): string {
  const short = TOML_SHORT_ESCAPES[char];
  if (short !== undefined) return short;
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return char;
}

// ---------------------------------------------------------------------------
// Harness policy fingerprint (N4)
// ---------------------------------------------------------------------------

/** One input to the harness fingerprint: an item file name and its raw content. */
export interface CapabilityFingerprintEntry {
  name: string;
  content: string;
}

/** What the harness planned against: global skill/plugin items and the workspace config. */
export interface HarnessPolicyFingerprintInput {
  entries: readonly CapabilityFingerprintEntry[];
  pluginConfig: Partial<PluginConfigState> | null | undefined;
}

/**
 * A stable digest of the capability inputs a harness pass plans against.
 *
 * Canonical JSON (object keys sorted, entries sorted by name, each id list
 * treated as a set: de-duplicated and sorted) hashed with FNV-1a 64. Order and
 * key order never change it; any change to a value does. `lastUpdated` is left
 * out on purpose: a save that changes nothing must not force a pass.
 */
export function harnessPolicyFingerprint(
  input: HarnessPolicyFingerprintInput,
): string {
  const config = input.pluginConfig ?? {};
  const canonical = canonicalJson({
    v: 1,
    entries: [...input.entries]
      .map(({ name, content }) => ({ name, content }))
      .sort(
        (a, b) =>
          compareStrings(a.name, b.name) ||
          compareStrings(a.content, b.content),
      ),
    pluginConfig: {
      enabledPluginIds: idSet(config.enabledPluginIds),
      disabledPluginIds: idSet(config.disabledPluginIds),
      enabledSkillIds: idSet(config.enabledSkillIds),
      disabledSkillIds: idSet(config.disabledSkillIds),
      disabledAgentIds: idSet(config.disabledAgentIds),
    },
  });
  return fnv1a64Hex(utf8Bytes(canonical));
}

/**
 * Whether a harness pass applied the policy the caller asked for: the pass
 * stamped the same {@link harnessPolicyFingerprint}, its sources were
 * readable, and nothing failed to write. `null` (no pass) is never an
 * acknowledgement.
 */
export function isHarnessPassAcknowledged(
  health: HarnessHealth | null | undefined,
  fingerprint: string,
): boolean {
  if (health === null || health === undefined) return false;
  if (health.policyFingerprint !== fingerprint) return false;
  if (health.sources !== 'ok') return false;
  return health.targets.every((target) => target.writeFailed.length === 0);
}

/** An id list as a set: strings only, de-duplicated, code-unit sorted. */
function idSet(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === 'string');
  return [...new Set(ids)].sort(compareStrings);
}

/** Code-unit order, independent of locale. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalJson(value: CanonicalValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: CanonicalValue) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as { readonly [key: string]: CanonicalValue };
    const keys = Object.keys(record).sort(compareStrings);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;

/** FNV-1a, 64-bit, over bytes. BigInt keeps the multiply exact. */
function fnv1a64Hex(bytes: Uint8Array): string {
  let hash = FNV64_OFFSET;
  for (const byte of bytes) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV64_PRIME);
  }
  return hash.toString(16).padStart(16, '0');
}

// ---------------------------------------------------------------------------
// UTF-8, dependency-free
// ---------------------------------------------------------------------------

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('Capability id is not well-formed UTF-16');
      }
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Strict UTF-8 decode; `null` on any malformed sequence. */
function utf8Decode(bytes: Uint8Array): string | null {
  let result = '';
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index];
    const sequence = utf8Sequence(lead);
    if (sequence === null || index + sequence.length > bytes.length)
      return null;
    const { length, min } = sequence;
    let code = length === 1 ? lead : lead & (0xff >> (length + 1));
    for (let offset = 1; offset < length; offset += 1) {
      const continuation = bytes[index + offset];
      if ((continuation & 0xc0) !== 0x80) return null;
      code = (code << 6) | (continuation & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return null;
    }
    result += String.fromCodePoint(code);
    index += length;
  }
  return result;
}

/** Sequence length and smallest legal code point for a UTF-8 lead byte. */
function utf8Sequence(lead: number): { length: number; min: number } | null {
  if (lead < 0x80) return { length: 1, min: 0 };
  if (lead >= 0xc2 && lead <= 0xdf) return { length: 2, min: 0x80 };
  if (lead >= 0xe0 && lead <= 0xef) return { length: 3, min: 0x800 };
  if (lead >= 0xf0 && lead <= 0xf4) return { length: 4, min: 0x10000 };
  return null;
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), dependency-free
// ---------------------------------------------------------------------------

/**
 * Round constants K[0..63], FIPS 180-4 §4.2.2: the first 32 bits of the
 * fractional parts of the cube roots of the first 64 primes.
 */
const SHA256_ROUND_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Initial hash value H(0), FIPS 180-4 §5.3.3: the first 32 bits of the
 * fractional parts of the square roots of the first 8 primes.
 */
const SHA256_INITIAL_HASH = Uint32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** FIPS 180-4 SHA-256 (§5.1.1 padding, §6.2.2 computation), lower-case hex. */
function sha256Hex(message: Uint8Array): string {
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = Uint32Array.from(SHA256_INITIAL_HASH);
  const words = new Uint32Array(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const w15 = words[i - 15];
      const w2 = words[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + SHA256_ROUND_CONSTANTS[i] + words[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join(
    '',
  );
}
