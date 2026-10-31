# Review 10b.0c — lane profile bridge

Verdict: APPROVE
Score: 9/10
Review family: grok (implementer: codex)

## Defects

None.

## Checked

Static review only. Lane rules prohibited tests, lint, typecheck, diagnostics, Nx, and build. Line numbers are the worktree files as read. Ptah MCP tools were not in the connected tool list (`search_tool` returned no `ptah_*` tools; the connected server is `tasks`), so this file is the deliverable.

### 1. Profile passes both builders; suppression shape

`buildCodexLaneProfileSettings` builds one `settings.lane` for every accepted input (`codex-lane-profile.ts:140-181`). `disabledUserMcpServers` is the legacy set: distinct, empty dropped, `ptah` dropped, then sorted (`codex-lane-profile.ts:111-113`), matching `userServerNames` at `codex-lane-config.builder.ts:210-217` (default `Array.sort` and `compareCodeUnits` are the same UTF-16 ordering). `suppressedTools` is only `agents`, `plugins`, `apps`, `skills`, then `mcp:` plus each of those names (`codex-lane-profile.ts:164-170`). `('mcp:' + name).slice(4) === name`, so each `mcp:` entry is in `disabledUserMcpServers`. `mcp:ptah` cannot appear, because the name `ptah` is removed before the prefix. That is the allowlist at `codex-mcp-config.ts:189-196`.

The same object is what `buildCodexExecutionProfile` parses (`codex-execution-profile.ts:87-103`). Dotted names such as `a.b` pass `text` and the lane server-name schema. The Ptah entry is one `http` server, name `ptah`, empty `headerReferences`, no auth or URL reference (`codex-lane-profile.ts:148-160`), which `buildCodexLaneThreadConfig` accepts (`codex-lane-thread-config.ts:78-116`). `ptahMcpServerUrl` (`ptah-mcp-url.ts:48-59`) puts the agent id and working directory in the path via `encodeURIComponent`, so the URL has no userinfo, query, or hash and passes the profile URL refine (`codex-execution-profile.ts:57-66`). Token limits are omitted unless they are positive safe integers (`codex-lane-profile.ts:237-248`), which both the profile schema and the thread builder accept. `explicitFullAccess` is `false` (`codex-lane-profile.ts:180`); the profile builder and runtime still reject `true` (`codex-execution-profile.ts:278-279`, `codex-runtime.ts:72-80`).

Legacy inputs at `codex-lane-config.builder.ts:99-152` (four suppressions, zero-omitted token limits, `web_search` live/disabled, effort trim, user-server table excluding `ptah`, Ptah URL plus timeout only for a valid nonzero port) all have a typed field on this object. `approval_policy=never` stays in the core thread builder (`codex-lane-thread-config.ts:128`), not on the bridge.

The contract spec calls `buildCodexExecutionProfile` then public `buildCodexLaneThreadConfig` (`codex-lane-profile.spec.ts:130-152`). `buildCodexThreadConfig` is not exported (`codex-runtime/src/index.ts:76-89` exports `buildCodexLaneThreadConfig` and `buildCodexMcpConfigOverrides` only). `buildCodexLaneThreadConfig` never reads `suppressedTools` (`codex-lane-thread-config.ts:118-131`), so that call does not execute the unmapped-name / `mcp:ptah` refusal. That is not a real gap for this batch. The bridge list is built in lockstep with the disabled-server array, and the spec pins the exact list for the legacy-shaped fixture (duplicate `github`, `''`, `ptah`, dotted `a.b`) at `codex-lane-profile.spec.ts:158-170`, with no `mcp:ptah`. A bad extra suppression fails that assertion even though the thread-config equality would not. Re-invoking the refusal would require a deep import of an unexported function. The refusal itself remains the 10b.0b guard.

A quoted server name that is only whitespace, or that contains NUL, fails `text` and `buildCodexExecutionProfile` rejects the whole profile. Bare names from `BARE_NAME_RE` (`codex-user-mcp-servers.ts:124`) and dotted names cannot hit that. Not a normal-lane failure.

### 2. Resume resend and empty role

`expectedRole` is `config.developerInstructions` only when resend is due and the string is non-empty (`codex-lane-profile.ts:132-139`). Resend is first-turn, or `resendRoleOnResume ?? CODEX_RESUME_RESENDS_ROLE` (`codex-lane-profile.ts:132-134`). That is the same condition as `codex-lane-config.builder.ts:160-164`: role on the first turn even when `resendRoleOnResume` is false; on resume only when the override or the default `true` says so. The profile field is one fresh scalar (`codex-lane-profile.ts:146-147`), and `instructionSources` is empty, so `codex-context.ts:224-241` sends that scalar alone. `''` and `undefined` are omitted. The role handler compares `settings.developerPrompt` to that same `expectedRole` (`codex-lane-profile.ts:91-93`), including the omitted/`undefined` case. Spec: resume replacement `codex-lane-profile.spec.ts:329-345`; empty role and `resendRoleOnResume: false` `codex-lane-profile.spec.ts:359-371`.

### 3. Requirement gate, limits, budgets, approval

`requirementHandlers` is a `satisfies Record<keyof CodexLaneRequirements, RequirementHandler>` (`codex-lane-profile.ts:62-94`). Each handler reads a typed core field: the four `false` flags, disabled-server names and order, both token limits, `webSearch`, `ptahToolTimeoutSeconds`, and `developerPrompt`. `assertAllRequirementsHandled` clears the gate, rejects any present requirement missing from the caller, then rejects a handler that returns false, and only then opens `settings` (`codex-lane-profile.ts:208-232`). A failed call leaves settings unreadable. There is no hardcoded handled-key fixture; the spec derives keys from `Object.keys(result.requirements)` (`codex-lane-profile.spec.ts:47-56`) and drops one key at a time (`codex-lane-profile.spec.ts:80-89`). A changed `webSearch` is refused (`codex-lane-profile.spec.ts:92-101`). Absent optional keys are not required (`codex-lane-profile.spec.ts:104-127`).

Positive `maxTurns` / `maxBudgetUsd` throw before settings exist (`codex-lane-profile.ts:103-108`, spec `codex-lane-profile.spec.ts:295-301`). Zero is not copied onto `lane` (spec `codex-lane-profile.spec.ts:230-249`). Zero token limits are omitted with no warning; invalid limits are omitted with warnings (`codex-lane-profile.ts:237-248`, spec `codex-lane-profile.spec.ts:265-282`). The bridge sets no `maxTurns`, `maxBudgetUsd`, or approval policy on the profile. D26 `never` / workspace-write / `networkAccess: false` still comes from `resolveCodexLevelPolicy` (`codex-execution-profile.ts:184-191`), asserted at `codex-lane-profile.spec.ts:204-226`.

### 4. Ptah MCP

A port that is an integer in `1..65535` attaches `ptah` with `ptahMcpServerUrl` and sets `ptahToolTimeoutSeconds` to `CODEX_PTAH_TOOL_TIMEOUT_SEC` (960) on both the lane and the requirements (`codex-lane-profile.ts:124-131`, `148-161`, `179`, `192`). Any other port, including `0` and `undefined`, attaches nothing and omits the timeout (`codex-lane-profile.spec.ts:304-326`). `0` and `undefined` do not warn; other invalid ports warn once, matching `codex-lane-config.builder.ts:139-157`. The thread table keeps disabled user servers when Ptah is absent, and keeps the Ptah URL plus timeout when it is present (`codex-lane-profile.spec.ts:144-151`, `319-321`). MCP is not removed.

### 5. Repo rules

No `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable` in the two files. The only assertions are `as keyof CodexLaneRequirements` on `Object.keys` results (`codex-lane-profile.ts:221`, `codex-lane-profile.spec.ts:50`), which is outside that ban. The mismatch test uses `Object.defineProperty` (`codex-lane-profile.spec.ts:94-97`), not a readonly assignment. No private bracket access, no new timer, and the settings literal stays inside `CodexProfileSettings`. `reflect-metadata` is the first spec import (`codex-lane-profile.spec.ts:1`). Imports are `@ptah-extension/codex-runtime` plus same-package relatives. The diff is limited to the two named source files.

### Amendments and prior defect

R1: `explicitFullAccess` stays false; lane policy is the core D26 policy, not a bridge approval setting. R2 and R3 do not apply to these files. R4: this review is grok on a codex implementation. Review 10b.0b defect 2 is fixed: `disabledUserMcpServers`, both token limits, `webSearch`, and `ptahToolTimeoutSeconds` are on `settings.lane`, and `mcp:<name>` matches that list.
