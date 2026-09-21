# Independent review — harness proposeConfig record coercion

## Verdict
APPROVE WITH CHANGES — The change effectively resolves the repeated authoring agent rejections on array container shapes while preserving backward compatibility for existing presets and record payloads. Inferred TypeScript types and Zod 4 `.partial()` optionality remain sound, and error hints give actionable guidance for retries. A few minor edge-case defects (string `"false"` enabling agents, silent acceptance of whitespace-only string arrays, and object prototype assignment safety) and missing test cases should be addressed before merging.

## Defects
### D1 — String `"false"`, `0`, or `null` unexpectedly enables agent in `coerceEnabledAgents`
- **Severity**: minor
- **Location**: [`libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:141`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts#L141)
- **Failure**: Input `agents: { enabledAgents: [{ agentId: 'retired', enabled: "false" }] }` produces `{ retired: { enabled: true } }` (the same occurs for `enabled: 0` or `enabled: null`). Strict inequality `override['enabled'] !== false` evaluates `"false" !== false` to `true`, causing an agent explicitly disabled via a stringified boolean to be enabled.
- **Fix**: Handle string `"false"`, `0`, and `null` explicitly when normalizing the boolean status:
```typescript
enabled:
  override['enabled'] === undefined
    ? true
    : override['enabled'] !== false &&
      override['enabled'] !== 'false' &&
      override['enabled'] !== 0 &&
      override['enabled'] !== null,
```

### D2 — Whitespace-only or empty strings in bare string array silently pass as `{}` instead of failing validation
- **Severity**: minor
- **Location**: [`libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:131-133`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts#L131-L133)
- **Failure**: Input `agents: { enabledAgents: ['   '] }` or `enabledAgents: ['']` produces `{ agents: { enabledAgents: {} } }` and passes validation with 0 enabled agents, whereas object entries with empty keys (`[{ agentId: '   ' }]`) return `input` and trigger a schema rejection. An agent sending invalid empty strings in a list is silently accepted with no agents enabled.
- **Fix**: Verify that non-empty input arrays contain at least one valid non-whitespace identifier, or refuse arrays containing empty string identifiers:
```typescript
  if (input.every((entry) => typeof entry === 'string')) {
    const trimmed = (input as string[]).map((id) => id.trim());
    if (trimmed.some((id) => id.length === 0)) return input;
    return Object.fromEntries(
      trimmed.map((agentId) => [agentId, { enabled: true }]),
    );
  }
```

### D3 — Prototype pollution vulnerability via `__proto__` key in `foldListIntoRecord`
- **Severity**: minor
- **Location**: [`libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:103`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts#L103)
- **Failure**: Input `agents: { enabledAgents: [{ agentId: '__proto__', modelTier: 'opus' }] }` assigns `record['__proto__'] = value`, modifying the prototype of the plain object literal `{}` rather than setting a clean dictionary entry.
- **Fix**: Initialize `record` with a null prototype (`Object.create(null)`) or reject prototype poison keys:
```typescript
  const record: Record<string, unknown> = Object.create(null);
```

## Missing test cases
- Empty array input for `agents.enabledAgents: []` (verifying it normalizes to `{}`).
- Empty array input for `mcp.enabledTools: []` (verifying it normalizes to `{}`).
- Empty array input for `prompt.enhancedSections: []` and `claudeMd.customSections: []` (verifying they normalize to `{}`).
- Whitespace trimming on keys: `['  catalog-reviewer  ']` and `[{ agentId: '  catalog-reviewer  ' }]` (verifying keys are trimmed to `'catalog-reviewer'`).
- Duplicate keys in list: `[{ agentId: 'a', modelTier: 'opus' }, { agentId: 'a', modelTier: 'sonnet' }]` (verifying last-write-wins semantics).
- Candidate key priority in `coerceEnabledAgents`: `{ agentId: 'a', name: 'b' }` (verifying `agentId` wins and `name` is stripped).
- Alternate key fields in `coerceEnabledAgents`: `{ id: 'agent-1' }`, `{ key: 'agent-1' }`, `{ name: 'agent-1' }`.
- Alternate server key fields in `coerceEnabledTools`: `{ serverName: 'srv', tools: [] }`, `{ serverKey: 'srv', tools: [] }`.
- Alternate content fields in `coerceSections`: `{ title: 'T', text: 'body' }`, `{ title: 'T', value: 'body' }`, `{ heading: 'T', body: 'body' }`.
- Malformed element handling: `null` entry in list (`enabledAgents: [null]` and `enabledTools: [{ name: 'srv', tools: [] }, null]`).
- Mixed list elements: `enabledAgents: ['agent-1', { agentId: 'agent-2' }]` (verifying refusal).
- Invalid value types: `enabledTools: [{ name: 'srv', tools: 'not-an-array' }]` and `enhancedSections: [{ title: 'T', content: 123 }]` (verifying refusal).
- Missing tools property: `enabledTools: [{ name: 'srv' }]` without `tools`/`toolNames` (verifying refusal).
- String boolean handling in overrides: `{ agentId: 'a', enabled: 'false' }` vs `{ agentId: 'a', enabled: false }`.
- Preserving existing record shapes for `agents.enabledAgents`, `prompt.enhancedSections`, and `claudeMd.customSections` (currently only `mcp.enabledTools` has a record test).
- Shape hint output for `agents.enabledAgents`, `prompt.enhancedSections`, and `claudeMd.customSections` (currently only `mcp.enabledTools` has a hint test).
- Partial payload handling: verifying `{ agents: {} }` and `{}` pass without `coerce*` running on `undefined`.

## Checked and correct
- `foldListIntoRecord` returns untouched `input` upon encountering invalid entries or missing keys, avoiding partial mutation and preventing half-built records from leaking.
- `coerceEnabledAgents` bare-string array branch safely treats string elements as agent IDs, aligning with existing usage where `enabledAgents` is represented as `string[]` across other RPC interfaces (`HarnessGeneratePromptParams`, `HarnessPromptBuilderService`).
- `[].every()` vacuous truth on empty array `[]` cleanly routes to `{}` across both bare-string and object-list branches.
- Zod 4 `.partial()` wraps fields in `ZodOptional`, which intercepts `undefined` before `z.preprocess` executes, keeping optional fields optional without calling coercion functions on `undefined`.
- Inferred TypeScript types of `HarnessConfigUpdatesSchema` are unchanged for all callers (`Record<string, unknown> | undefined`, `Record<string, string[]> | undefined`, `Record<string, string> | undefined`).
- Backward compatibility is preserved: non-array records pass through `if (!Array.isArray(input)) return input;` without alteration, verified against `BUILTIN_HARNESS_PRESETS` and `tribunal-conductor.json`.
- When an array is refused, `formatHarnessConfigIssue` attaches the exact target record shape and acceptable list alternative to the rejection message.
- Tool documentation descriptions in `harness-workflow-prompt.service.ts`, `tool-description.builder.ts`, and `system-namespace.builders.ts` accurately state the four record shapes defined in `rpc-harness.types.ts`.
- `coerceEnabledAgents` destructuring explicitly strips `agentId`, `id`, `key`, and `name` so identifier fields do not leak as override properties on the resulting record value.
- The resulting coerced agent override object always provides a boolean `enabled` property, satisfying the `AgentOverride` contract.
- Existing consumers (`HarnessConfigStore.updatePtahSettings`) explicitly whitelist supported override fields (`modelTier`, `autoApprove`, `customInstructions`), preventing arbitrary object properties from persisting to `settings.json`.
