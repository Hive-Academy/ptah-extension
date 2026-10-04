# B-5g executor report: `skillSynthesis:getAgentModels` / `skillSynthesis:setAgentModel`

Executor: backend-developer (sub-agent), 2026-10-04. Task B-5g.1 is implemented. Git was not run (the tree is left dirty).

## Files (the 6 in B-5g, no others)

- MODIFIED `W\libs\shared\src\lib\types\rpc\rpc-skill-clone.types.ts`: adds the contract types (below). Imports `AgentModelClass|Entry|Provider|SettingsValue` from `../agent-models.types` as types only.
- MODIFIED `W\libs\shared\src\lib\types\rpc.types.ts`: adds the import, two `RpcMethodRegistry` entries and two `RPC_METHOD_ENTRIES` lines.
- MODIFIED `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts`: adds `SkillGetAgentModelsParamsSchema` and `SkillSetAgentModelParamsSchema`.
- MODIFIED `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`: adds the two handlers, the `METHODS` and `register()` entries, one optional constructor parameter, private helpers and module-level helpers.
- MODIFIED `...\skills-synthesis-rpc.handlers.spec.ts`: adds one new describe block, "agent models get / set (C6)".
- MODIFIED `...\skills-synthesis-rpc.schema.spec.ts`: adds two new describe blocks.

## Contract shapes (`rpc-skill-clone.types.ts`)

```ts
type AgentModelSettingsScope = 'machine' | 'workspace';
type AgentModelLayerClassification = Record<string, Partial<Record<AgentModelProvider, AgentModelClass>>>;

interface SkillSynthesisGetAgentModelsParams { workspaceRoot?: string }
interface SkillSynthesisGetAgentModelsResult {
  workspaceRoot: string | null;               // harness-resolved active root; null = no folder
  machine: AgentModelSettingsValue | null;    // stored layer, string leaves of known providers only
  workspace: AgentModelSettingsValue | null;
  lists: Record<AgentModelProvider, AgentModelEntry[]> | null; // listForClassification(); null = unreadable/timeout
  classification: { machine: AgentModelLayerClassification; workspace: AgentModelLayerClassification };
  unsupportedProviders: AgentModelProvider[]; // [] today (B-5e)
}
interface SkillSynthesisSetAgentModelParams {
  workspaceRoot: string; slug: string /* agent slug | '*' */; provider: AgentModelProvider;
  scope: AgentModelSettingsScope; value: string | null; confirmUnlisted?: boolean;
}
interface SkillSynthesisSetAgentModelResult {
  classification: AgentModelClass;            // 'empty' for a clear
  machine: AgentModelSettingsValue | null;    // both layers re-read after the save
  workspace: AgentModelSettingsValue | null;
}
```

Zod schemas:
- Shared rule for `workspaceRoot`: a string of at most 4096 characters, refined to be non-blank.
- get: `{ workspaceRoot? }`, `.strict().optional()`.
- set: `.strict()`, with these fields:
  - `slug`: `z.union([z.literal('*'), SlugSchema])`, so `__proto__`, traversal and separators are rejected.
  - `provider`: `z.enum(AGENT_MODEL_PROVIDERS)`.
  - `scope`: `z.enum(['machine','workspace'])`.
  - `value`: `z.string().max(256).nullable()`, left untrimmed so the classifier decides.
  - `confirmUnlisted`: `z.boolean().optional()`.

## Behaviour

- **Resolution.** `AgentModelSettings` is looked up at call time via `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS`, and `CliModelListService` the same way. The lookup goes through the optional `PLATFORM_TOKENS.DI_CONTAINER` with `isRegistered(token, true)` and then `resolve`. When the settings are missing, unregistered or fail to resolve, both methods refuse with `RpcUserError('Per-agent model settings are not available in this host.', 'PERSISTENCE_UNAVAILABLE')`. The handler never crashes and never constructs a settings instance itself.
- **Workspace identity.**
  - `requireActiveWorkspace(requested)` throws `WORKSPACE_NOT_OPEN` when no folder is open.
  - It throws `UNAUTHORIZED_WORKSPACE` ("The workspace changed; reload the agent models and try again.") unless `resolveHarnessWorkspaceRoot(requested)` exactly equals the harness-resolved active root. The comparison is exact on purpose: the settings key hashes the path, so a case-folded match could address another workspace's key.
  - `setAgentModel` checks the workspace on entry and again after the list read. A folder switch during the possibly slow list query is therefore refused before any write.
  - `workspaceRoot` is required for machine scope too (B-5b binding).
- **Write.** `settings.update(workspaceRoot, slug, provider, value, scope)`, in exactly that order. Spec-asserted with `toHaveBeenCalledWith`.
- **Classification (B-5c rule).**
  - Values are classified only with `CliModelListService.listForClassification()`, never with `listAll()` or `agent:listCliModels`.
  - The list read has a 15 s timeout, and its timer is cleared in `finally`. A throw or a timeout gives `lists = null`: values classify `unverifiable` (the safe default), and a warning is logged with a degradation-audit comment.
  - A `null` or blank value is a clear (`'empty'`) and reads no list.
- **Never reconciles.** The handler has no reconcile dependency and calls nothing in harness-sync except `resolveHarnessWorkspaceRoot`.
- **Stored-layer filtering.**
  - A non-object layer becomes `null`. Non-object slug entries, unknown providers and non-string leaves are dropped.
  - Output objects are built with own-property `defineProperty`, so a hand-edited `__proto__` slug cannot replace a prototype.

## Refusal reasons (all `RpcUserError`, nothing written)

| Condition | Code | Message (abridged) |
| --- | --- | --- |
| Missing, empty or blank `workspaceRoot`, bad slug/provider/scope/value type, unknown key | `INVALID_PARAMS` | `Invalid parameters for skillSynthesis:setAgentModel` |
| No folder open | `WORKSPACE_NOT_OPEN` | Open a workspace folder to change agent models. |
| `workspaceRoot` is not the active root (on entry or after the list read) | `UNAUTHORIZED_WORKSPACE` | The workspace changed; reload the agent models and try again. |
| Provider in `UNSUPPORTED_AGENT_MODEL_PROVIDERS` (empty today) | `INVALID_PARAMS` | Per-agent models are not supported for `<provider>`. |
| Classified `malformed` | `INVALID_PARAMS` | That model id cannot be written for `<provider>`, plus a format hint (OpenCode `provider/model`; Claude opus/sonnet/haiku/inherit; others no spaces or control characters). The raw value is not echoed. |
| `unlisted` without `confirmUnlisted: true` | `MODEL_NOT_AVAILABLE` | ...not in `<provider>`'s model list; it needs confirmation before it is saved. |
| No `AgentModelSettings` on the host | `PERSISTENCE_UNAVAILABLE` | Per-agent model settings are not available in this host. |
| Write or read failure | `PERSISTENCE_UNAVAILABLE` | `skillSynthesis:setAgentModel failed; please try again.` (reported to Sentry; stored bytes unchanged) |

`getAgentModels` with a foreign `workspaceRoot` is also `UNAUTHORIZED_WORKSPACE`. With no folder open and no `workspaceRoot`, it returns `{ workspaceRoot: null, machine: null, workspace: null, lists: null, classification: {machine:{}, workspace:{}}, unsupportedProviders: [] }`.

## Spec cases

The handler spec builds a real `AgentModelSettings` and a real `WorkspaceScopeResolver` over an in-memory JSON-copying store. `CliModelListService` is a double. `.ptah`-marked temp workspaces are used.

1. get: layers, lists and classification. Covers listed, unlisted (live Codex), unverifiable (fallback cursor, Claude `[]`), and OpenCode no-slash → malformed. Junk layer entries, unknown providers and non-string leaves are filtered. `unsupportedProviders: []`.
2. get: no folder gives a null result, and the list is not read.
3. get: a foreign `workspaceRoot` gives `UNAUTHORIZED_WORKSPACE`.
4. get: a list read that throws gives `lists: null` and `unverifiable`.
5. Host with no settings registration, and host with no container at all (2 rows): both methods return `PERSISTENCE_UNAVAILABLE` and no write happens.
6. `workspaceRoot` missing, empty or blank on a machine-scope save (3 rows): `INVALID_PARAMS`, `update` is not called, and the global key bytes are unchanged.
7. No folder on set gives `WORKSPACE_NOT_OPEN`.
8. Workspace switched between load and save, for workspace and machine scope (2 rows): `UNAUTHORIZED_WORKSPACE`. Neither workspace's key nor the global key changes (full-store snapshot equality).
9. Workspace switched during the list read: refused, with no write.
10. A listed value is saved via `update(ws,'backend-developer','codex','gpt-5-codex','workspace')`. Unrelated slugs and providers are preserved, and the global key is untouched.
11. Machine scope with slug `'*'` writes only the global key.
12. Unlisted without confirmation gives `MODEL_NOT_AVAILABLE`, the message contains "needs confirmation", and nothing is written.
13. Unlisted with confirmation is saved, with `classification: 'unlisted'`.
14. A listed Codex value that fails syntax (`gpt 5 preview`) is accepted and saved.
15. OpenCode listed but malformed (a provider-reported `no-slash`) gives `INVALID_PARAMS`, with no write.
16. A control-character value is refused as malformed even with `confirmUnlisted`.
17. A fallback-only list (Cursor) gives `unverifiable`, saved without confirmation.
18. A `null` value clears one provider and keeps the others. Classification is `empty` and no list is read.
19. Save failure (the store rejects writes) gives `PERSISTENCE_UNAVAILABLE`. The prior bytes are byte-identical and Sentry is called once.

Schema spec:
- get: 3 accepted inputs and 3 rejected ones (blank, non-string, unknown key).
- set:
  - the valid form, `'*'` with `null` and `confirmUnlisted`, and all 5 providers;
  - the value is not trimmed;
  - 13 rejections: workspaceRoot missing, empty or blank; traversal, separator, `**` and `__proto__` slugs; unknown provider `antigravity`; unknown scope; missing value; a 257-character value; non-boolean confirm; unknown key `reconcile`.

Home paths: these specs read and write nothing under the home directory. The store is in memory, the list service is a double (so `CODEX_HOME` is never read), and each `.ptah` marker stops `resolveHarnessWorkspaceRoot` at the temp workspace. `os.homedir` is therefore not mocked: `jest.spyOn(os,'homedir')` cannot redefine it (see `file-link-root-policy.spec.ts:8-9`), and a file-level `jest.mock('os')` in a 4300-line spec was not justified.

## Checks (tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers`: "Successfully ran targets typecheck, lint for 2 projects".
  - Direct `eslint` on the 6 files: 0 errors and 4 warnings, all pre-existing in kind: `SkillStatus` unused (`:45`), `historyCount` useless assignment, and `max-lines` on `skills-synthesis-rpc.handlers.ts` and `rpc.types.ts`.
  - `skills-synthesis-rpc.handlers.ts` grew from 2762 to 3137 lines, so its pre-existing `max-lines` warning grew too.
  - `prettier --write` was run on the 6 files.
- `npx nx run-many -t test -p @ptah-extension/shared,@ptah-extension/rpc-handlers --maxWorkers=2 --skip-nx-cache --output-style=static`:
  - shared: `Test Suites: 84 passed, 84 total`, `Tests: 2456 passed, 2456 total`.
  - rpc-handlers: `Test Suites: 138 passed, 138 total`, `Tests: 7 skipped, 4067 passed, 4074 total` (B-5c2 baseline 4018 + 49 new).

## Deviations

1. **`getAgentModels` params.** batches.md says `{workspaceRoot}` and plan :120 says `{}`. I made it optional: absent means the active workspace, present must be the active workspace. The result always carries `workspaceRoot`, which the editor sends back to `setAgentModel`.
2. **Injection through optional `PLATFORM_TOKENS.DI_CONTAINER` and call-time lookup**, rather than direct constructor injection. tsyringe constructs a class token (`CliModelListService`) even under `isOptional`. A direct injection would therefore break the existing container construction sites in `skills-synthesis-rpc.queue.spec.ts`, `.digest.spec.ts` and `.activity-feed.integration.spec.ts`, which are outside this batch. A call-time lookup also makes "host has no settings" a per-method refusal and removes any ordering dependency on B-5f2/3/4 registration. A TASK_2026_560 review flagged optional `DI_CONTAINER` as unusual where direct optional tokens were possible. Here a direct token is not possible for the class token. The constructor comment records why.
3. **"Refusal, never throws"** is read as "refuses with `RpcUserError` (a structured, user-facing RPC error), never an unhandled failure". That is how every refusal in this handler file works (for example restore with no folder).
4. **Unlisted refusal code is `MODEL_NOT_AVAILABLE`**, so B-6 can tell "needs confirmation" apart from malformed (`INVALID_PARAMS`) without parsing the message. `RpcUserErrorCode` (`rpc-error-codes.types.ts`) is not in this batch, so no new code was added.
5. **Added a 15 s timeout on the list read**, which the plan does not specify. On timeout, values are `unverifiable` (the B-5c safe default), so the save is not blocked.
6. **Not covered by a spec:** the timeout path (fake timers were not worth the complexity here) and the "resolve throws" branch of `lookupRuntime`.

## Out-of-scope observations

- The working tree also holds parallel B-5f2/3/4 host-wiring edits (`apps/ptah-electron`, `apps/ptah-extension-vscode`, `cli-engine`, `platform-*` settings registration). They were not touched or verified by me.
- Earlier status also showed harness-sync and agent-generation edits from other agents; those are not mine either.
- B-6 note:
  - Use `result.workspaceRoot` from `getAgentModels` verbatim in `setAgentModel`.
  - `MODEL_NOT_AVAILABLE` means "ask for confirmation, then resend with `confirmUnlisted: true`".
  - `lists` carries `isFallback`, so labels should go through the shared `classifyAgentModelValue`. `providerReported` already ignores fallback entries.
