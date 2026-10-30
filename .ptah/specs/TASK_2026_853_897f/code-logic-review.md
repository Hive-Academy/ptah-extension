# Code Logic Review — `TASK_2026_853_897f`, Phase A

**Score:** 6/10  
**Verdict:** REVISE  
**Review family:** reviewer: codex; implementer: claude

## Logic defects

1. **Major — Bare skill denials also hide user and workspace skills.** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:510-515` emits each catalog skill as an unqualified `skillOverrides` key. When a workspace or synced skill shares a name such as `code-review` or `init`, turning the Claude built-in off also removes the unrelated skill from the first-turn listing. This is demonstrated for the same-name `docs` control in `reports/a0-account-spike.md` (case c); `decisions.md:35` acknowledges the behavior and defers its guard to Phase B. The Phase A diff already applies the bare denials on every verified main session and lane. **Fix:** Before emitting a bare denial, discover collisions across loaded workspace, user and plugin skills and skip that denial where the SDK cannot target only the built-in; cover `init` and `code-review` in first-turn listing tests. Keep qualified keys for synced skills.

2. **Major — A stale settings card can overwrite another writer's opt-ins.** `libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:325-365` builds a replacement array from its last load and writes the whole array without rereading or checking a version. Open the card, enable `Workflow` in another window or through `ptah agent config-set`, then toggle `ReportFindings` in the first card: its save replaces the stored list with only `ReportFindings`, silently disabling `Workflow`. A lost RPC response after a successful write can create the same stale snapshot because lines 348-350 revert locally without readback. **Fix:** Use an atomic per-item update or a revision-checked write; on failed or uncertain saves, reload before allowing another replacement write.

3. **Minor — Savings ignore dependency-blocked skills.** `libs/frontend/chat/src/lib/settings/pro-features/claude-builtins-config.component.ts:269-276` counts a skill as visible whenever its own checkbox is on. Turning on `code-review` while `ReportFindings` stays off reduces the displayed hidden-token total, although `claude-builtin-catalog.ts:208-212` still denies the skill. The fixture at `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced.entries.ts:402-411` asserts this inconsistent result. **Fix:** Count a skill as hidden whenever its checkbox is off **or** its required tool is off; update the fixture and component spec.

## Style defects

No separate style defect found in the changed catalog, options assembly, RPC contracts and handler, CLI parser, or Angular component. Imports use library entry points, the UI imports shared DTOs rather than backend types, and the added public contracts avoid `any`. The long catalog and component comments are descriptive, but do not warrant a style finding.

## Five logic questions

1. **How does it fail silently?** A stale whole-array save drops a concurrent opt-in (`claude-builtins-config.component.ts:334-365`); a bare skill override hides an unrelated same-name skill (`sdk-query-options-builder.ts:510-515`).
2. **What user action produces unexpected behavior?** Enable a dependency-blocked skill: the savings figure falls even though the skill remains hidden (`claude-builtins-config.component.ts:269-276`).
3. **What input data produces a wrong answer?** A same-name workspace skill collides with an unqualified catalog skill; the A0 account spike observed both entries disappear under a bare override (`reports/a0-account-spike.md`, case c).
4. **What happens when a dependency fails?** The settings read error hides controls (`claude-builtins-config.component.ts:284-305`); a failed or lost save response reverts the control without reconciling persisted state (`:348-369`).
5. **What is missing that the requirements never mentioned?** Cross-window and CLI edits need a conflict-safe settings contract. The current replacement-array RPC does not provide one (`agent-rpc.handlers.ts:1052-1070`).

## Verification and remaining uncertainty

The catalog keeps Agent/Task, permission, plan, MCP discovery and scheduling tools outside the six default-off entries (`claude-builtin-catalog.ts:31-82,123-147`). The main builder reads global opt-ins on each build and applies `disallowedTools` (`sdk-query-options-builder.ts:1310-1333,1454-1459`); lanes carry the same policy (`ptah-cli-spawn-options.service.ts:237-247`, `claude-sdk-lane-options.ts:203-209`). The UI writes through `agent:setConfig`, whose handler uses `agentOrchestration.*` file settings (`agent-rpc.handlers.ts:1052-1070,1922-1930`); the registered keys and runtime reader use the same names (`file-settings-keys.ts:151-155`, `claude-builtin-catalog.ts:244-268`). Unknown persisted tool IDs are filtered, malformed lists default to empty, and non-string-array RPC values are refused (`claude-builtin-catalog.ts:182-187,225-228`, `agent-rpc.handlers.ts:114-132,906-909`).

The retained A0 runtime spike observed Workflow and ReportFindings absent from parent and child first-turn schemas, but it did not prove that every generated agent's existing `disallowedTools` survives the top-level SDK policy; its generated probe had no agent-specific deny list (`evidence/a0-runtime/spike.mjs:16`). A controlled child with an existing deny entry is still needed for Phase A acceptance criterion 2. The Phase A token evidence has no subagent measurements (`evidence/phase-a-tokens/phase-a.json`). `ptah_get_diagnostics` was requested for seven changed source files and retried for two; both requests timed out with files unchecked. No build, test, serve, e2e or workspace-wide check was run in this review.

The score reflects two likely user-visible behavior gaps and one incorrect estimate. It is above the 3–4 band because the key, RPC and runtime wiring are present and the catalog protects critical tools; it is below 7–8 because the same-name collision is observed and whole-array saves can lose another change.

## Decisions

- **Treat the bare-key collision as a Phase A finding.** Options: defer it because decision #31 assigns a guard to B, or review the current Phase A behavior. Evidence: the current builder emits bare keys and the A0 runtime spike observed collateral hiding. Reversible: yes; Phase B may implement the guard before the task PR ships.

## Re-review R1

**Score:** 5/10  
**Verdict:** REVISE  
**Review family:** reviewer: codex; implementer: claude

### Prior findings

1. **F1 — OPEN.** The new guard drops a catalog denial for discovered workspace, user and plugin collisions, and drops all catalog denials when discovery is unknown (`claude-skill-name-discovery.ts:192-244,253-282`; `claude-builtin-catalog.ts:264-285`). Thus an unreadable skills directory or plugin registry does not hide a same-name skill (`claude-skill-name-discovery.ts:115-121,141-158,229-236`; spec `:156-184,263-283`). However, the frontmatter parser misses a valid same-name skill in the scenario below (N1), so the original collateral hiding remains possible.
2. **F2 — OPEN (Major).** The card now rereads before each save and Undo, serializes its own saves, and rereads after a failed write (`claude-builtins-config.component.ts:319-365`; `settings-save-feedback.service.ts:157-183`). There is still an await between `agent:getClaudeBuiltins` and the replacement `agent:setConfig` write (`claude-builtins-config.component.ts:350-355`); the handler persists that replacement array without a revision check (`agent-rpc.handlers.ts:1052-1070`). If window A reads `[Workflow]`, window B enables `DesignSync`, then A toggles `ReportFindings`, A writes `[Workflow, ReportFindings]` and silently removes B's opt-in. Use an atomic per-item RPC or compare-and-swap revision in the handler; rereading alone does not close this race. The new tests move the other write *before* A's fresh read (`claude-builtins-config.component.spec.ts:358-400`), so they do not exercise this ordering.
3. **F3 — RESOLVED.** The hidden total now counts a skill whose required tool is off (`claude-builtins-config.component.ts:276-288`). The component spec and ADV-25 fixture assert that enabling `code-review` while `ReportFindings` is off leaves the total unchanged (`claude-builtins-config.component.spec.ts:341-355`; `settings-advanced.entries.ts:407-419`). The reachability table count includes the new entry (`settings-reachability.table.ts:1720,1740`).

### New logic defects in the fixes

1. **Major — Valid frontmatter can evade collision discovery.** `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts:82-90,192-200`: `name: "code-review" # reviewer note` is valid YAML, but the parser returns the literal `"code-review" # reviewer note` because it strips quotes only when they enclose the entire captured string. If that file is under `.claude/skills/my-reviewer/SKILL.md`, neither its directory name nor parsed name matches `code-review`; `withoutCollidingBuiltinSkillDenials` retains the bare denial (`claude-builtin-catalog.ts:271-282`), hiding the unrelated skill. Parse frontmatter as YAML, or handle quoted/plain scalars and comments correctly; add a collision test with a directory name different from the frontmatter name.
2. **Major — Proxy sessions can show a default-off built-in skill because the guard scans a source the SDK excludes.** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1382-1399,1495-1506`: a localhost proxy sets `settingSources` to `['project', 'local']`, but `discoverClaudeSkillNames` still scans `<claudeConfigDir>/skills` as `user` (`claude-skill-name-discovery.ts:216-228`). If the user directory contains an `init` skill and the project does not, the guard drops the `init` denial although that user skill is not loaded; the built-in `init` remains in the first-turn listing. Pass the effective setting sources into discovery and scan only loaded tiers; cover the proxy route with a user-only same-name fixture.
3. **Minor — Every verified session performs a fresh serial file scan on its launch path.** `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1382-1394`; `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts:192-201,216-228`: each build awaits directory enumeration and opens up to 4 KiB of every skill file whose directory name is not one of the seven catalog names. It repeats this across each parent and installed plugin, with no cache; a large plugin collection can delay every new main session and lane spawn (`ptah-cli-spawn-options.service.ts:261-272`). This also exceeds the plan's hot-path budget (`implementation-plan.md:384-387`). Cache a source-scoped name index with invalidation on relevant directory or registry changes, or otherwise bound the scan. No startup latency measurement was available in this review.

### Verification and score basis

Reviewed the R1 discovery implementation and specs, catalog collision rule, both runtime call sites, the settings card and specs, ADV-25 fixture, reachability count, and the RPC replacement write. The implementers' scoped verify results are recorded in `batches.md:172,215`; this review ran no verify, build, serve or e2e command. A scoped `ptah_get_diagnostics` request for the new discovery module and settings component returned **unavailable** after 45 seconds with both files unchecked. The host exposed no skill-loading tool, so `angular-frontend-patterns` could not be loaded; the Angular review used the component, feedback service and tests directly. The score is below 7–8 because F2 can still lose another writer's setting and F1 remains possible for valid frontmatter; it is above 3–4 because the standard collision path, unreadable-source fallback and F3 dependency count are implemented and covered.

## Re-review R2

**Score:** 6/10  
**Verdict:** REVISE  
**Review family:** reviewer: codex; implementer: claude

### Finding status

1. **F1 — RESOLVED.** The guard drops bare denials for discovered collisions and drops catalog denials when discovery is unknown (`claude-skill-name-discovery.ts:436-466`; `claude-builtin-catalog.ts:264-285`). The R2 parser recognizes the quoted frontmatter that defeated R1 (`claude-skill-name-discovery.ts:161-175`; spec `:160-170`). The separate disabled-plugin false positive is N4 below.
2. **F2 — RESOLVED.** The card sends one `{ kind, id, enabled }` change and refreshes stored lists after a failed or uncertain response (`claude-builtins-config.component.ts:319-364`). The handler validates the ID, reads the stored list inside the queue shared with `agent:setConfig`, changes only that ID, and returns both lists (`agent-rpc.handlers.ts:420-425,447-451,697-748,895-909`). Concurrent distinct-ID calls and an in-flight `setConfig` are covered in `agent-rpc.handlers.spec.ts:1215-1268`. The accepted separate-process CLI whole-array command is outside this finding.
3. **N1 — RESOLVED.** `gray-matter` parses valid YAML names; the fallback handles quoted and plain scalars with trailing comments if other frontmatter is malformed (`claude-skill-name-discovery.ts:126-175`). The exact quoted-name collision has a regression test (`claude-skill-name-discovery.spec.ts:160-170`).
4. **N2 — RESOLVED for setting-source tiers.** The builder passes the same `settingSources` to the SDK and guard (`sdk-query-options-builder.ts:1387-1409,1513-1515`); discovery gates user and project scans on those sources (`claude-skill-name-discovery.ts:395-411`). The proxy user-only `init` case keeps its denial (`sdk-query-options-builder.spec.ts:2498-2505`), and named lanes pass certified sources (`claude-cli.adapter.ts:173-181`). Plugin enablement remains a separate gap, N4.
5. **N3 — OPEN (Minor).** Cached directory names and frontmatter avoid repeated `readdir` and `open` calls (`claude-skill-name-discovery.ts:273-320`; spec `:217-240`), but every launch still awaits `stat` for each non-catalog skill's `SKILL.md`, one at a time inside the loop (`:307-318,374-382`). With many installed skills or a slow filesystem, launch latency still scales with the number of skill files. The plan requires no extra await on the hot path besides the synced reader (`implementation-plan.md:384-387`). Cache a directory-level name index with invalidation, or bound/parallelize the stat pass. No latency measurement was supplied.

### New logic defects

1. **N4 — Major — An installed but disabled plugin can re-enable a default-off built-in skill.** `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts:323-340,409-410` scans every install path in `installed_plugins.json`, without checking whether the plugin is enabled for this session. A disabled installed plugin containing `skills/init/SKILL.md` is recorded as a collision; `claude-builtin-catalog.ts:277-281` then drops the `init` denial, making that built-in visible despite its off setting. Claude Code supports disabling a plugin without uninstalling it ([plugins overview](https://code.claude.com/docs/en/plugins)). **Fix:** filter plugin roots by effective enabled-plugin settings for the loaded tiers, or omit plugin roots from the bare-name collision rule if their skills are always namespaced; test that a disabled installed plugin leaves `init` denied.

### Verification and score basis

Reviewed the R2 parser/cache, runtime callers, RPC contracts and queued handler, UI save/recovery, specs and ADV-25 fixture. No verify, build, serve or e2e command was run, as requested. Scoped `ptah_get_diagnostics` for discovery, handler and component returned unavailable after 45 seconds with all three unchecked. The host exposed no skill-loading tool; `angular-frontend-patterns` was unavailable, so the Angular review used source and specs directly. The score is above 5 because the quoted-name collision and UI lost-update race are addressed end to end; it remains below 7 because disabled plugin installs can expose a default-off built-in and launch scanning is still serial per file.

## Final review R2b

**Score:** 6/10  
**Verdict:** REVISE  
**Review family:** reviewer: codex; implementer: claude

### Finding status

1. **N3 — RESOLVED.** `claude-skill-name-discovery.ts:457-469` starts every non-catalog skill's `indexedSkillName` operation in one `Promise.all`, so file stats are no longer awaited serially. The directory and skill-name caches remain at `:353-400`. No launch-latency measurement was supplied.
2. **N4 — RESOLVED.** `claude-skill-name-discovery.ts:247-277` applies loaded-tier precedence to plugin enablement, and `:497-504` scans only enabled plugin roots. The disabled and never-enabled fixtures assert no collision (`claude-skill-name-discovery.spec.ts:267-278`); the guard fixture asserts that a disabled plugin leaves `init` denied (`:485-505`). Both runtime fixture groups enable their plugin explicitly (`sdk-query-options-builder.spec.ts:2436-2449`; `ptah-cli-spawn-options.builtins.spec.ts:214-228`).

### New logic defects

1. **N5 — Major — Malformed `enabledPlugins` values are silently treated as absent.** `libs/backend/agent-sdk/src/lib/helpers/claude-skill-name-discovery.ts:231-239` checks that `enabledPlugins` is an object, then filters out entries whose values are not booleans. For example, with user settings `{ "enabledPlugins": { "p@m": true } }` and project settings `{ "enabledPlugins": { "p@m": "false" } }`, discovery inherits the user `true` at `:265-269` and scans that plugin, potentially dropping the `init` denial. The correction requires a malformed loaded settings file to produce `unknown`, since the child's plugin state cannot be established from it. **Fix:** reject any non-boolean entry with `ESETTINGSFORMAT` before constructing the map; add a fixture for an invalid higher-precedence value over a valid lower-precedence value.

### Verification and score basis

Reviewed only the R2b discovery module and spec plus the two updated plugin fixture groups. The implementer's targeted TypeScript check is recorded in `batches.md:174`; this review ran no verify, test, build, serve or e2e command. The score remains in the 5–6 band because a malformed loaded settings value can make the guard act on a false plugin state. It is above 3–4 because the two requested R2 fixes are present and covered, and below 7–8 because the documented unknown-on-malformed-settings behavior is incomplete.
