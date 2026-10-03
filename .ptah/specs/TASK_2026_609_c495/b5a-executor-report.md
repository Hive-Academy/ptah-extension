# B-5a executor report — shared contract (classifier, resolver)

Executor: backend-developer (sub-agent). No git operations performed. batches.md not edited.

## Task B-5a.1 — done

### Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\agent-models.types.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\agent-models.types.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\index.ts` (one line: `export * from './lib/types/agent-models.types';`)

### Exports

- `AGENT_MODEL_PROVIDERS` (`claude|codex|copilot|cursor|opencode`), `AgentModelProvider`, `AGENT_MODEL_WILDCARD = '*'`
- `AgentModelSettingsValue = Record<string, Partial<Record<AgentModelProvider, string>>>`
- `AgentModelLayers { workspace?, machine? }` (each `AgentModelSettingsValue | null`)
- `AgentModelEntry { id; isFallback? }`, which `CliModelOption` (`rpc-agents.types.ts:141`) satisfies structurally
- `AgentModelClass = 'empty'|'malformed'|'listed'|'unlisted'|'unverifiable'` (no known-invalid class, per plan :125)
- `AgentModelResolution { value; scope: 'workspace'|'machine'; wildcard: boolean }`
- `providerReported(list)`, `classifyAgentModelValue(provider, value, list|null)`, `isAgentModelEmittable(provider, value)`, `resolveAgentModel(layers, slug, provider)`, `matchesAgentModelSyntax(provider, value)`

### Rules as implemented (implementation-plan.md :123-130, review fix 4 :207)

- Classify order: trimmed-blank → `empty`; any `\p{Cc}` or U+2028/U+2029 → `malformed` (even when listed); exact match against `providerReported` ids → `listed` with no syntax check, **except OpenCode**: a listed OpenCode id that fails `^[^\s/]+\/\S+$` → `malformed`; syntax failure → `malformed`; non-empty provider-reported list → `unlisted`; otherwise `unverifiable`.
- `providerReported` drops `isFallback === true`, so a fallback-only id is never `listed` and a fallback-only list counts as no list.
- Syntax: OpenCode `^[^\s/]+\/\S+$`; Codex, Copilot and Cursor `^\S+$`; Claude `^(?:opus|sonnet|haiku|inherit)$`.
- Emittable: not blank, no control character, and OpenCode syntax for OpenCode only.
- Resolve order: ws[slug] → ws['*'] → machine[slug] → machine['*']. Only the requested provider's leaf is read, so a value never crosses providers. Non-object layers or slug entries, non-string or blank leaves, and inherited keys (`__proto__`, `constructor`, `toString`) are skipped through own-property reads and never throw.

### Spec evidence (179 tests in the new file)

- Every class for each of the 5 providers: blank, control character (also when listed), listed, syntax-failing (listed and unlisted), unlisted, unverifiable (null and empty list), mixed fallback/live list → `unlisted`, fallback-only list → `unverifiable`.
- A listed-but-syntax-failing value for Codex, Copilot, Cursor and Claude → `listed`. An OpenCode value that is listed but malformed → `malformed`. Rows for the OpenCode syntax rule.
- Invariant: one table produces all five classes for every provider (asserted). For each row, an accepted class (`listed`, `unlisted` or `unverifiable`) implies `isAgentModelEmittable` is true.
- Precedence rows for Claude and Codex: each of the four steps and nothing-set. Also: wildcard for an agent with no entry of its own; never crosses providers; another provider's workspace value does not shadow the machine value.
- Malformed settings: 9 bad workspace-layer shapes fall through to the machine value; 5 bad `layers` values → `undefined`; inherited keys → `undefined`. A control-character value resolves unchanged and is non-emittable, so emission can warn and skip it.

### Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared` → "Successfully ran targets typecheck, lint for project @ptah-extension/shared"
- `npx nx run-many -t test -p @ptah-extension/shared --maxWorkers=2 --skip-nx-cache --output-style=static` → Test Suites: 84 passed, 84 total; Tests: 2456 passed, 2456 total
- Nx Cloud printed a 401 "organization disabled" notice. It is unrelated and did not affect the local runs.

## Notes for downstream batches

- `resolveAgentModel` returns `AgentModelResolution | undefined`, not a bare string. The UI needs the source ("effective value + source", plan :131), and returning it avoids a second copy of the precedence rules. B-3b and B-5d read `.value`.
- Classification does not trim. A value with surrounding whitespace is `malformed` for every provider, because it fails each syntax and cannot be an exact listed id. Emission can therefore write a stored value verbatim. B-3b (batches.md :279) says "trimmed" for the Claude check. If it trims, it must emit the trimmed value.
- `matchesAgentModelSyntax` is exported because B-3b's Claude path needs the shared Claude syntax on its own (batches.md :279).
- Tooling hazard: the Write tool turned the escape `\u2028` into a literal U+2028 character, which broke the regex. I fixed it with a small Node script that writes the escapes through `String.fromCharCode`. Both files now contain ASCII escapes only.

## Fix round 1 — TS4111 at `agent-models.types.ts:192-195`

- Cause: the first version guarded `layers` with `isRecord(layers)`. That narrows to `Record<string, unknown>`, so `layers.workspace` and `layers.machine` became index-signature accesses and failed `noPropertyAccessFromIndexSignature` with four TS4111 errors.
- Fix, already on disk before this round (the coordinator saw the earlier state): line 191 is now `if (typeof layers !== 'object' || layers === null) return undefined;`, with a comment explaining why. `layers` keeps its declared `AgentModelLayers` type, so dot access on the named properties is valid. Arrays and other garbage still read `undefined` for `workspace` and `machine` and fall through. Behaviour and spec are unchanged.
- `npx nx run-many -t typecheck -p @ptah-extension/shared,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers --skip-nx-cache` → "Successfully ran target typecheck for 3 projects"
- `npx nx run-many -t test -p @ptah-extension/shared --maxWorkers=2 --skip-nx-cache` → Test Suites: 84 passed, 84 total; Tests: 2456 passed, 2456 total
