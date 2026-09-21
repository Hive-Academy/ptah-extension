/**
 * Zod schemas for the Harness Setup Builder RPC contracts.
 *
 * Split out of `rpc-harness.types.ts` so the harness data model and its plain
 * constants can be imported without pulling `zod` in. Dependency direction is
 * one-way: schemas → types.
 */

import { z } from 'zod';

import type { HarnessSkillRef, NewSkillDefinition } from './rpc-harness.types';

/**
 * Boundary shape for a skill ref as the designing agent writes it: `source` may
 * be omitted, in which case it is inferred from the presence of `installSource`.
 *
 * `scope` is not accepted. The object is non-strict, so an agent that still
 * emits one has the key stripped rather than the whole config rejected — which
 * is the right failure mode for a knob that no longer selects anything.
 */
export const HarnessSkillRefInputSchema = z.object({
  skillId: z.string().min(1),
  source: z.enum(['local', 'skills.sh']).optional(),
  installSource: z.string().optional(),
});

/** Loose ref accepted at the agent boundary; normalized to `HarnessSkillRef`. */
export type HarnessSkillRefInput = z.infer<typeof HarnessSkillRefInputSchema>;

/**
 * Reconcile the two shapes a skill selection can arrive in into the canonical
 * `{ selectedSkills, selectedSkillRefs }` pair.
 *
 * Accepts both the legacy `string[]` (every preset on disk) and refs, whether
 * the agent put them in `selectedSkills` directly or in `selectedSkillRefs`.
 * IDs keep first-seen order and are deduped; a ref-only ID is still treated as
 * a selection. Refs are deduped by `skillId`, with an explicit
 * `selectedSkillRefs` entry winning over one inlined into `selectedSkills`.
 */
export function normalizeHarnessSkillSelection(
  selectedSkills: ReadonlyArray<string | HarnessSkillRefInput> | undefined,
  selectedSkillRefs: ReadonlyArray<HarnessSkillRefInput> | undefined,
): { selectedSkills: string[]; selectedSkillRefs: HarnessSkillRef[] } {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const refsById = new Map<string, HarnessSkillRef>();

  const toRef = (input: HarnessSkillRefInput): HarnessSkillRef => ({
    skillId: input.skillId,
    source: input.source ?? (input.installSource ? 'skills.sh' : 'local'),
    ...(input.installSource ? { installSource: input.installSource } : {}),
  });

  const addId = (skillId: string): void => {
    if (skillId.length === 0 || seenIds.has(skillId)) return;
    seenIds.add(skillId);
    ids.push(skillId);
  };

  for (const entry of selectedSkills ?? []) {
    if (typeof entry === 'string') {
      addId(entry);
      continue;
    }
    addId(entry.skillId);
    refsById.set(entry.skillId, toRef(entry));
  }

  for (const entry of selectedSkillRefs ?? []) {
    addId(entry.skillId);
    refsById.set(entry.skillId, toRef(entry));
  }

  return { selectedSkills: ids, selectedSkillRefs: [...refsById.values()] };
}

/**
 * Fold the list shape an authoring agent reaches for into the record a harness
 * config actually stores.
 *
 * Four `proposeConfig` fields are records keyed by name — `agents.enabledAgents`,
 * `mcp.enabledTools`, `prompt.enhancedSections` and `claudeMd.customSections`.
 * Every surface that described the tool named those keys without a shape, so a
 * model holding only the key guessed a list. Measured 2026-09-21 on one harness
 * build: four rejections on exactly those four keys, and the attempt that
 * finally parsed had dropped its agents — the panel read `0 agent(s) enabled`
 * for a persona the user had just approved. A list whose entries carry their
 * own key is not an ambiguous payload. Only the container is wrong, so it is
 * normalized instead of refused.
 *
 * A list of BARE strings is refused for every field but `enabledAgents`, where
 * the string IS the key. `['scrape', 'crawl']` under `enabledTools` names no
 * server and `['Safety rules']` under `customSections` carries no body, so
 * keying either one would store a guess as the user's configuration.
 */
function foldListIntoRecord(
  input: unknown,
  keyFields: readonly string[],
  valueOf: (entry: Record<string, unknown>) => unknown,
): unknown {
  if (!Array.isArray(input)) return input;

  const record: Record<string, unknown> = {};
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return input;
    }
    const fields = entry as Record<string, unknown>;
    const key = keyFields
      .map((field) => fields[field])
      .find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0,
      );
    if (key === undefined || isPoisonKey(key)) return input;

    const value = valueOf(fields);
    if (value === undefined) return input;
    const normalizedKey = key.trim();
    // Two entries whose keys differ only by whitespace (`"srv"` vs `" srv "`)
    // normalize to the same key. Silently keeping the second would drop the
    // first entry's configuration with no error to reveal it.
    if (Object.hasOwn(record, normalizedKey)) return input;
    record[normalizedKey] = value;
  }
  return record;
}

/**
 * Keys that cannot survive a round trip through a plain object.
 *
 * `record['__proto__'] = value` sets the prototype rather than an own
 * property, and Zod's own record parse rebuilds the object the same way, so
 * the entry silently disappears however this function builds it. Refusing is
 * the honest answer: no real agent id, server name or section title is
 * `__proto__`, and pretending to store one would be the silent loss this
 * whole boundary exists to end.
 */
function isPoisonKey(key: string): boolean {
  const trimmed = key.trim();
  return (
    trimmed === '__proto__' ||
    trimmed === 'constructor' ||
    trimmed === 'prototype'
  );
}

/**
 * Read an `enabled` flag an authoring agent may have written as a string or a
 * number. Presence in the list already means "enabled", so only an explicit
 * falsy value turns the entry off — but `"false"` and `0` are explicit, and a
 * bare `!== false` test read both as enabled and silently re-enabled an agent
 * the design had disabled.
 *
 * Only a recognized token is coerced. Anything else (`"no"`, `{}`, `[]`) is
 * passed through unchanged so the downstream `z.boolean()` rejects it, rather
 * than being read as truthy and silently enabling the entry.
 */
function readEnabledFlag(value: unknown): unknown {
  if (value === undefined) return true;
  if (value === false || value === null || value === 0) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return value;
}

const SECTION_KEY_FIELDS = ['title', 'heading', 'name', 'key', 'id'] as const;

/** `['backend-developer']` and `[{ agentId, enabled }]` both key by agent id. */
function coerceEnabledAgents(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  if (input.every((entry) => typeof entry === 'string')) {
    const ids = (input as string[]).map((agentId) => agentId.trim());
    // A blank id is refused rather than dropped. Dropping it would turn
    // `['']` into "no agents enabled" and report success, which is the same
    // silent loss this coercion exists to end — and an object entry with a
    // blank key is already refused, so dropping here would be inconsistent.
    if (ids.some((agentId) => agentId.length === 0 || isPoisonKey(agentId))) {
      return input;
    }
    return Object.fromEntries(
      ids.map((agentId) => [agentId, { enabled: true }]),
    );
  }
  return foldListIntoRecord(
    input,
    ['agentId', 'id', 'key', 'name'],
    ({ agentId: _agentId, id: _id, key: _key, name: _name, ...override }) => ({
      ...override,
      enabled: readEnabledFlag(override['enabled']),
    }),
  );
}

/** `[{ name: 'firecrawl', tools: ['scrape'] }]` keys by server name. */
function coerceEnabledTools(input: unknown): unknown {
  return foldListIntoRecord(
    input,
    ['server', 'serverName', 'serverKey', 'name', 'key', 'id'],
    (entry) => {
      const tools =
        entry['tools'] ?? entry['enabledTools'] ?? entry['toolNames'];
      return Array.isArray(tools) ? tools : undefined;
    },
  );
}

/** `[{ title: 'Safety rules', content: '...' }]` keys by section title. */
function coerceSections(input: unknown): unknown {
  return foldListIntoRecord(input, SECTION_KEY_FIELDS, (entry) => {
    const content =
      entry['content'] ?? entry['body'] ?? entry['text'] ?? entry['value'];
    return typeof content === 'string' ? content : undefined;
  });
}

/**
 * The shape a rejected record field wants, appended to its Zod message.
 *
 * `expected record, received array` says what is wrong and not what to send, so
 * the retry guessed a second time. Each hint names the record form first and
 * the accepted list form second.
 */
export const HARNESS_RECORD_FIELD_HINTS: Readonly<Record<string, string>> = {
  'agents.enabledAgents':
    'want {"<agent-id>": {"enabled": true}}; ["<agent-id>"] is also accepted',
  'mcp.enabledTools':
    'want {"<server-name>": ["<tool-name>"]}; [{"name": "<server-name>", "tools": ["<tool-name>"]}] is also accepted',
  'prompt.enhancedSections':
    'want {"<section-title>": "<markdown body>"}; [{"title": "<section-title>", "content": "<markdown body>"}] is also accepted',
  'claudeMd.customSections':
    'want {"<section-title>": "<markdown body>"}; [{"title": "<section-title>", "content": "<markdown body>"}] is also accepted',
  'agents.harnessSubagents[].tools':
    'want an array of tool names, not a comma-joined string',
  'agents.harnessSubagents[].executionMode':
    'want one of "background", "on-demand", "scheduled"',
  'skills.createdSkills[].content':
    'the skill body key is "content"; "instructions" is not read',
  'mcp.servers[].config':
    'want {"type":"stdio","command":"…","args":[],"env":{"K":"V"}} or {"type":"http"|"sse","url":"https://…","headers":{"K":"V"}}; env and headers are string-to-STRING maps',
};

/**
 * Render one `HarnessConfigUpdatesSchema` issue, with its shape hint if any.
 *
 * Array indices are collapsed to `[]` before the lookup, so one hint covers
 * every element of a list — the agent's mistake is in the element SHAPE, not
 * in which element it landed on.
 */
export function formatHarnessConfigIssue(
  path: string,
  message: string,
): string {
  const hint =
    HARNESS_RECORD_FIELD_HINTS[path] ??
    HARNESS_RECORD_FIELD_HINTS[path.replace(/\.\d+(?=\.|$)/g, '[]')];
  // A strict top-level error (an unrecognized key at the schema root) has an
  // empty path. `${path}: ${message}` would print a leading `: ` with
  // nothing before it.
  const located = path.length === 0 ? message : `${path}: ${message}`;
  return hint === undefined ? located : `${located} — ${hint}`;
}

/**
 * The four list fields whose ELEMENT shape used to be `z.unknown()`.
 *
 * Validating the container and not the element is the same defect as naming a
 * field and not its shape: the call is accepted, the surface counts the entry
 * as configured, and the cost lands at Apply. Measured against the working
 * tree: a subagent with `tools: 'Read,Glob'` throws
 * `(sub.tools ?? []).join is not a function` in
 * `harness-prompt-builder.service.ts`; a created skill carrying `instructions`
 * instead of `content` writes a skill file with an empty body; an MCP entry
 * with no `enabled` is filtered out of the preview and skipped by the
 * installer without a warning; and `enabledAgents: { reviewer: true }` counts
 * as DISABLED everywhere, because every consumer reads `override.enabled`.
 *
 * These stay non-strict, matching `HarnessSkillRefInputSchema`: an unknown key
 * inside an element is stripped, while a missing or mistyped REQUIRED field is
 * refused. The element contract is what Apply dereferences; extra keys are not.
 */
const AgentOverrideInputSchema = z.object({
  enabled: z.boolean(),
  modelTier: z.enum(['opus', 'sonnet', 'haiku']).optional(),
  autoApprove: z.boolean().optional(),
  customInstructions: z.string().optional(),
});

const HarnessSubagentInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  role: z.string(),
  tools: z.array(z.string()),
  executionMode: z.enum(['background', 'on-demand', 'scheduled']),
  triggers: z.array(z.string()).optional(),
  instructions: z.string(),
});

const NewSkillInputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  content: z.string().min(1),
  allowedTools: z.array(z.string()).optional(),
});

const McpServerConfigInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
]);

const McpServerEntryInputSchema = z.object({
  name: z.string().min(1),
  url: z.string(),
  description: z.string().optional(),
  // Defaulted, not required. An agent that proposes a server means to use it,
  // and the preview and the installer both drop an entry whose flag is absent.
  enabled: z.boolean().default(true),
  config: McpServerConfigInputSchema.optional(),
  serverKey: z.string().optional(),
  installTargets: z
    .array(
      z.enum(['vscode', 'claude', 'cursor', 'copilot', 'codex', 'antigravity']),
    )
    .optional(),
});

/**
 * Zod schema validating a `Partial<HarnessConfig>` at the `proposeConfig` MCP
 * tool boundary. Every field is optional so the agent can stream incremental
 * config decisions.
 *
 * The section objects are STRICT. The MCP tool description has always promised
 * "unknown keys are rejected: the error names the offending path", and the
 * schema stripped them instead — so `prompt: { instructions: '…' }` parsed to
 * `prompt: {}`, broadcast an empty update and returned success. A misspelled
 * key is the same silent loss as a mis-shaped one. `HarnessSkillRefInputSchema`
 * and the element schemas above stay non-strict on purpose; see their notes.
 */
export const HarnessConfigUpdatesSchema = z
  .object({
    name: z.string(),
    persona: z
      .strictObject({
        label: z.string(),
        description: z.string(),
        goals: z.array(z.string()),
        templateId: z.string().optional(),
      })
      .partial(),
    agents: z
      .strictObject({
        enabledAgents: z.preprocess(
          coerceEnabledAgents,
          z.record(z.string(), AgentOverrideInputSchema),
        ),
        harnessSubagents: z.array(HarnessSubagentInputSchema),
      })
      .partial(),
    // `selectedSkills` accepts bare IDs (the legacy/local case) or full refs —
    // agents routinely inline the search result they picked. Both shapes are
    // reconciled here so the surface always receives IDs plus refs.
    skills: z
      .strictObject({
        selectedSkills: z.array(
          z.union([z.string(), HarnessSkillRefInputSchema]),
        ),
        selectedSkillRefs: z.array(HarnessSkillRefInputSchema),
        createdSkills: z.array(NewSkillInputSchema),
      })
      .partial()
      .transform(
        (
          skills,
        ): {
          selectedSkills?: string[];
          selectedSkillRefs?: HarnessSkillRef[];
          createdSkills?: NewSkillDefinition[];
        } => {
          const touched =
            skills.selectedSkills !== undefined ||
            skills.selectedSkillRefs !== undefined;
          if (!touched) return { createdSkills: skills.createdSkills };
          return {
            ...normalizeHarnessSkillSelection(
              skills.selectedSkills,
              skills.selectedSkillRefs,
            ),
            createdSkills: skills.createdSkills,
          };
        },
      ),
    prompt: z
      .strictObject({
        systemPrompt: z.string(),
        enhancedSections: z.preprocess(
          coerceSections,
          z.record(z.string(), z.string()),
        ),
      })
      .partial(),
    mcp: z
      .strictObject({
        servers: z.array(McpServerEntryInputSchema),
        enabledTools: z.preprocess(
          coerceEnabledTools,
          z.record(z.string(), z.array(z.string())),
        ),
      })
      .partial(),
    claudeMd: z
      .strictObject({
        generateProjectClaudeMd: z.boolean(),
        customSections: z.preprocess(
          coerceSections,
          z.record(z.string(), z.string()),
        ),
        previewContent: z.string(),
      })
      .partial(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .partial()
  .strict();
