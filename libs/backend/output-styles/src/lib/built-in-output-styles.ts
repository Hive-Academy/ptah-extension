/**
 * The output styles the Agent SDK ships inside its own binary.
 *
 * These are NOT file-discovered. The binary seeds its style map from a
 * hardcoded object literal BEFORE merging anything found on disk, which has
 * three consequences this module encodes:
 *
 *  1. A built-in can never be hidden by `settingSources`, so it activates on
 *     every provider — including localhost proxies. That is why the activation
 *     decision has no "inert" branch.
 *  2. `body` is `undefined` on every entry: the prompt text lives in the
 *     binary, Ptah does not have it, and a built-in never needs injecting
 *     because it never needs a fallback.
 *  3. File styles are written into the map AFTER built-ins, so a user file
 *     named `Learning` SHADOWS the built-in `Learning`. Discovery flags that as
 *     a collision rather than rendering two identical rows.
 *
 * Casing is verbatim from the binary — `default` lowercase, the other three
 * capitalised. `outputStyle` binds by exact `name`, so the casing is
 * load-bearing, not cosmetic.
 *
 * `default` is a sentinel rather than a real style: selecting it means "no
 * style", which is the key-removal branch on the parity write (Req 2.4).
 *
 * MARKETPLACE (BLOCKING): this is a `.ts` file deliberately. It compiles into
 * `main.mjs`, and a JS bundle is the only sanctioned home in this feature for
 * text naming an AI product. No `.md` starter or template asset is added
 * anywhere by this lib.
 */
import type { OutputStyleEntry } from '@ptah-extension/shared';

/** Set on every built-in so the list renders a disabled control plus a reason (Req 4.2). */
const BUILT_IN_REASON = 'built-in';

export const BUILT_IN_OUTPUT_STYLES: readonly OutputStyleEntry[] =
  Object.freeze([
    {
      name: 'default',
      tier: 'builtin',
      description:
        'The standard behaviour — concise, task-focused responses with the normal coding instructions in place.',
      keepCodingInstructions: true,
      editable: false,
      deletable: false,
      immutableReason: BUILT_IN_REASON,
      body: undefined,
    },
    {
      name: 'Explanatory',
      tier: 'builtin',
      description:
        'Adds commentary explaining implementation choices and the patterns already used in the codebase.',
      keepCodingInstructions: true,
      editable: false,
      deletable: false,
      immutableReason: BUILT_IN_REASON,
      body: undefined,
    },
    {
      name: 'Learning',
      tier: 'builtin',
      description:
        'Pauses at decision points and asks you to write small pieces of the code yourself, for practice.',
      keepCodingInstructions: true,
      editable: false,
      deletable: false,
      immutableReason: BUILT_IN_REASON,
      body: undefined,
    },
    {
      name: 'Proactive',
      tier: 'builtin',
      description:
        'Leans forward — suggests the follow-up work and the next steps it can see from the current task.',
      keepCodingInstructions: true,
      editable: false,
      deletable: false,
      immutableReason: BUILT_IN_REASON,
      body: undefined,
    },
  ] satisfies OutputStyleEntry[]);

/** Exact `name` of the sentinel that means "no style is chosen" (Req 2.4). */
export const DEFAULT_OUTPUT_STYLE_NAME = 'default';

/** True when `name` is one of the four names the binary owns. Case-sensitive on purpose (E1). */
export function isBuiltInOutputStyleName(name: string): boolean {
  return BUILT_IN_OUTPUT_STYLES.some((style) => style.name === name);
}
