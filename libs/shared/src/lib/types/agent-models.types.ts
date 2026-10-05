/**
 * Agent model control — the one shared, pure contract (TASK_2026_609 C6).
 *
 * The model editor (UI), the `setAgentModel` save handler and harness emission
 * all classify and resolve stored model values through these functions, so the
 * three can never disagree about what a value means.
 *
 * Settings shape (`agentGeneration.models`, machine and workspace layers):
 * `{ [slug | '*']: { [provider]: modelId } }`. Values reach these functions from
 * a settings file a user can hand-edit, so every reader here tolerates any
 * shape: a non-object layer, a non-object slug entry or a non-string leaf is
 * ignored, never thrown on.
 */

/** Providers whose agent copies can carry a per-agent model. */
export const AGENT_MODEL_PROVIDERS = [
  'claude',
  'codex',
  'copilot',
  'cursor',
  'opencode',
] as const;

export type AgentModelProvider = (typeof AGENT_MODEL_PROVIDERS)[number];

/** Settings key that applies to every agent without its own entry. */
export const AGENT_MODEL_WILDCARD = '*';

/** Stored settings value: `slug | '*'` → provider → model id. */
export type AgentModelSettingsValue = Record<
  string,
  Partial<Record<AgentModelProvider, string>>
>;

/**
 * The two settings layers for one workspace. Typed as the intended shape, but
 * read defensively: either layer may be missing or hand-edited into garbage.
 */
export interface AgentModelLayers {
  readonly workspace?: AgentModelSettingsValue | null;
  readonly machine?: AgentModelSettingsValue | null;
}

/**
 * One entry of a provider's model list. Structurally satisfied by
 * `CliModelOption` (`agent:listCliModels`).
 */
export interface AgentModelEntry {
  readonly id: string;
  /** True when the entry came from a hardcoded fallback, not the provider. */
  readonly isFallback?: boolean;
}

/**
 * - `empty`: nothing set (blank after trimming); saving it clears the entry.
 * - `malformed`: can never be written (control character, or fails the
 *   provider's syntax and is not a provider-reported id).
 * - `listed`: exact match of a provider-reported id.
 * - `unlisted`: provider reported a list and the value is not on it; saving
 *   requires explicit confirmation.
 * - `unverifiable`: no provider-reported list to check against.
 *
 * A "known-invalid" class is deliberately absent: no provider publishes one.
 */
export type AgentModelClass =
  'empty' | 'malformed' | 'listed' | 'unlisted' | 'unverifiable';

/** Where a resolved model value came from. */
export interface AgentModelResolution {
  readonly value: string;
  readonly scope: 'workspace' | 'machine';
  /** True when the value came from the `'*'` entry, not the agent's own. */
  readonly wildcard: boolean;
}

/** Newline, C0/C1 control characters and the Unicode line/paragraph separators. */
const CONTROL_CHARACTER = /[\p{Cc}\u2028\u2029]/u;

/** OpenCode documented `provider/model` id; the model part may contain `/`. */
const OPENCODE_SYNTAX = /^[^\s/]+\/\S+$/;
const NO_WHITESPACE_SYNTAX = /^\S+$/;
const CLAUDE_SYNTAX = /^(?:opus|sonnet|haiku|inherit)$/;

const SYNTAX: Readonly<Record<AgentModelProvider, RegExp>> = {
  claude: CLAUDE_SYNTAX,
  codex: NO_WHITESPACE_SYNTAX,
  copilot: NO_WHITESPACE_SYNTAX,
  cursor: NO_WHITESPACE_SYNTAX,
  opencode: OPENCODE_SYNTAX,
};

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** True when `value` satisfies the provider's documented id syntax. */
export function matchesAgentModelSyntax(
  provider: AgentModelProvider,
  value: string,
): boolean {
  return SYNTAX[provider].test(value);
}

/**
 * Entries the provider itself reported. Fallback entries are dropped, so a
 * fallback-only id can never make a value `listed`. An empty result means the
 * provider's list is unavailable.
 */
export function providerReported(
  list: readonly AgentModelEntry[] | null | undefined,
): AgentModelEntry[] {
  return (list ?? []).filter((entry) => entry.isFallback !== true);
}

/**
 * Classify a candidate model value for one provider.
 *
 * Order: blank → `empty`; control character → `malformed` (always); exact
 * provider-reported id → `listed` with no syntax check — except OpenCode,
 * whose `provider/model` format emission depends on, so a listed OpenCode
 * value that fails syntax is `malformed`; fails syntax → `malformed`;
 * provider reported a non-empty list → `unlisted`; otherwise `unverifiable`.
 */
export function classifyAgentModelValue(
  provider: AgentModelProvider,
  value: string,
  list: readonly AgentModelEntry[] | null,
): AgentModelClass {
  if (isBlank(value)) return 'empty';
  if (CONTROL_CHARACTER.test(value)) return 'malformed';

  const reported = providerReported(list);
  const syntaxOk = matchesAgentModelSyntax(provider, value);
  if (reported.some((entry) => entry.id === value)) {
    return provider === 'opencode' && !syntaxOk ? 'malformed' : 'listed';
  }
  if (!syntaxOk) return 'malformed';
  return reported.length > 0 ? 'unlisted' : 'unverifiable';
}

/**
 * Whether emission may write `value` into a provider copy. Deliberately looser
 * than classification for every provider but OpenCode (a listed id is written
 * as-is), so anything `classifyAgentModelValue` accepts is emittable.
 */
export function isAgentModelEmittable(
  provider: AgentModelProvider,
  value: string,
): boolean {
  if (typeof value !== 'string' || isBlank(value)) return false;
  if (CONTROL_CHARACTER.test(value)) return false;
  return provider !== 'opencode' || OPENCODE_SYNTAX.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property lookup only, so `__proto__`/`constructor` slugs never resolve. */
function readOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function readLeaf(
  layer: unknown,
  key: string,
  provider: AgentModelProvider,
): string | undefined {
  if (!isRecord(layer)) return undefined;
  const entry = readOwn(layer, key);
  if (!isRecord(entry)) return undefined;
  const leaf = readOwn(entry, provider);
  return typeof leaf === 'string' && !isBlank(leaf) ? leaf : undefined;
}

/**
 * Effective model for one agent and one provider. Precedence:
 * workspace[slug] → workspace['*'] → machine[slug] → machine['*']. Only the
 * requested provider's leaf is read at each step; a value set for another
 * provider never applies. Malformed layers, entries and non-string or blank
 * leaves are skipped. Returns `undefined` when nothing applies.
 */
export function resolveAgentModel(
  layers: AgentModelLayers | null | undefined,
  slug: string,
  provider: AgentModelProvider,
): AgentModelResolution | undefined {
  // Not `isRecord`: that guard would widen `layers` to an index signature.
  if (typeof layers !== 'object' || layers === null) return undefined;
  const steps = [
    ['workspace', layers.workspace, slug],
    ['workspace', layers.workspace, AGENT_MODEL_WILDCARD],
    ['machine', layers.machine, slug],
    ['machine', layers.machine, AGENT_MODEL_WILDCARD],
  ] as const;
  for (const [scope, layer, key] of steps) {
    const value = readLeaf(layer, key, provider);
    if (value !== undefined) {
      return { value, scope, wildcard: key === AGENT_MODEL_WILDCARD };
    }
  }
  return undefined;
}
