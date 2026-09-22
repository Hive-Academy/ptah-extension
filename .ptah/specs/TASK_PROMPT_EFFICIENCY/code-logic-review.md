# Code Logic Review — `TASK_PROMPT_EFFICIENCY`

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score       | 4/10                                  |
| Assessment           | NEEDS_REVISION                        |
| Blocking issues     | 1                                     |
| Serious issues      | 2                                     |
| Moderate issues     | 2                                     |
| Failure modes found | 3                                     |

Scope reviewed: `libs/backend/harness-sync/**` OpenCode target (transformer, MCP
dialect, registry, `rival-targets.ts` wiring, manifest builder), the
`HarnessTargetId`/`McpInstallTarget`/`CliTarget` union widenings and their
exhaustive consumers, `NATIVE_AGENT_TOOL_POLICY` growth against the Windows argv
limit, `capProjectGuidance` in `enhanced-prompts.service.ts`, the
`ptah-core-prompt.ts` refactor, `task-spec.contract.ts` compression, and
`scripts/agent-usage-report.mjs`. All prose/skill-file edits were skipped per
scope. Tests run: `agent-sdk` (`ptah-core-prompt.spec.ts`, 7/7 pass), `shared`
(`task-spec.contract.spec.ts`, 95/95 pass), `harness-sync` (48 suites / 414
tests, all pass, cache hit), `node scripts/agent-usage-report.mjs 1 3` (exit 0,
also verified with `HOME`/`USERPROFILE` pointed at a nonexistent directory —
exit 0, "no sessions in window").

## Five logic questions

### 1. How does this fail silently?

- `libs/backend/harness-sync/src/lib/di/register.ts:114-121` — the OpenCode
  target this diff builds is never added to `ALL_HARNESS_TARGET_FACTORIES`,
  which is the list this file's own comment (`register.ts:17-21`) says "all
  three hosts registered, the identical list, one line each." Every host
  (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:165`, the Electron
  and CLI containers via the default) calls `registerHarnessSyncServices` with
  this list. Every other part of the feature — the transformer, the MCP
  dialect, `rival-targets.ts`'s `createOpencodeTarget`, the manifest builder's
  `HARNESS_TARGET_IDS` — is wired and tested in isolation, so `harness-sync`'s
  own 48 suites pass and give the false impression the target is live. At
  runtime the reconciler simply never constructs an OpenCode target: no
  `.opencode/agent/*.md` is ever written, `opencode.json`'s `mcp` key is never
  populated, and nothing errors — the sync just quietly does one fewer target
  than it was built to do.
- `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:115-119`
  — `DETECTED_TARGETS` (the sweep that installs a marketplace plugin's
  declared MCP servers into every CLI the user has) still lists
  `['codex', 'copilot', 'cursor', 'antigravity']`. A user with OpenCode
  installed and a plugin declaring an MCP server gets it installed into every
  other detected CLI and silently not into OpenCode — no warning is emitted
  because the target is simply absent from the loop, not attempted-and-failed.

### 2. What user action produces unexpected behaviour?

A user who installs OpenCode, opens a Ptah workspace and expects the same 15
subagents that reach Claude/Codex/Cursor to reach OpenCode too (the stated
motivation for this whole target, per
`opencode-agent-transformer.ts:1-7`) sees nothing appear under
`.opencode/agent/`. The health surface (`harness-health.model.ts`, already
updated to know about `opencode` per the task's stated prior fix) will report
whatever state the manifest holds — but the manifest never gets an OpenCode
entry either, because the target that would populate it is never registered.
There is no error dialog; the workspace simply looks like OpenCode was never
detected.

### 3. What input data produces a wrong answer?

`configToJson` / `jsonToConfig` in `mcp-json-format.ts` handle the `local`/
`remote` and array-command dialect correctly for the cases exercised by
`opencode-mcp-facet.spec.ts` (not independently re-verified line-by-line here
beyond the read above, but the round-trip logic — `normalizeDeclaredType`
falling through to `inferTransportType` for `remote`, `readCommand` splitting
the packed array — is internally consistent and mirrors the existing
Antigravity `serverUrl` precedent). No wrong-answer case found in this file.

### 4. What happens when a dependency fails?

Not applicable to the reviewed files beyond what is already covered under
"silent failure" above — `JsonMcpFacet.readJson` already degrades a malformed
`opencode.json` to `{}` (pre-existing, generic), and the atomic-write-with-.bak
path is unchanged and reused as-is for the OpenCode facet.

### 5. What is missing that the requirements never mentioned?

- A regression test — anywhere in `harness-sync`, `cli-engine`, or the app DI
  wiring specs — that asserts every `HarnessTargetId` (or at minimum
  `opencode`) is present in `ALL_HARNESS_TARGET_FACTORIES`. The manifest
  builder's `HARNESS_TARGET_IDS` set (`harness-manifest.builder.ts:76`) was
  updated and would have been the natural place to derive this list from, or
  to assert against it.
- A cross-check between `McpInstallTarget` and `external-plugin-mcp.service.ts`'s
  `DETECTED_TARGETS` — nothing fails a build when a new install target is
  added to the union but a hand-maintained list elsewhere silently excludes
  it, which is exactly what happened here (and, per the task's own framing,
  is the class of bug batch-fixed in `harness-health.model.ts`,
  `mcp-directory-browser.component.ts`, `harness-rpc.schema.ts`,
  `mcp-directory-rpc.schema.ts`, `harness-namespace.builder.ts` and
  `tool-description.builder.ts` — this one instance was missed).

## Failure modes

### OpenCode harness target built but never registered

- Trigger: any host boots `registerHarnessSyncServices` with its default (or
  explicit `ALL_HARNESS_TARGET_FACTORIES`) target list — i.e. every normal
  startup of the VS Code extension, Electron app, or `ptah tui`/CLI.
- Symptom: OpenCode is fully "supported" per `rival-targets.ts`'s own
  capability table, yet no agent files, MCP config or manifest entries are
  ever written for it. No log line, no error — `register.ts:219` logs
  `targets: targets.map((target) => target.id)`, which would simply never
  contain `'opencode'`, but nothing surfaces that omission as a problem.
- Evidence: `libs/backend/harness-sync/src/lib/di/register.ts:114-121` (list),
  cross-referenced against `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:189-208`
  (`createOpencodeTarget` exists and is exported), and
  `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:164-166` (consumes
  the incomplete list).
- Current handling: none — the target is simply absent from every real
  invocation path.
- Recommendation: add `createOpencodeTarget` to `ALL_HARNESS_TARGET_FACTORIES`
  in `register.ts`, and add a test (in `register.spec.ts` if one exists, or a
  new one) asserting the factory list's resulting target ids matches
  `HARNESS_TARGET_IDS` minus any deliberately-excluded ids, so this class of
  gap fails CI instead of shipping silently again.

### Marketplace-plugin MCP sweep skips OpenCode

- Trigger: a marketplace plugin declares an MCP server and the user has
  OpenCode installed/detected.
- Symptom: the server is installed into Codex/Copilot/Cursor/Antigravity but
  never into OpenCode's `opencode.json`, with no warning recorded in
  `ExternalMcpOutcome.warnings`.
- Evidence: `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:115-119`
  (`DETECTED_TARGETS` array), used at `:272`.
- Current handling: `opencode` is simply not in the loop; no skip is logged
  because the loop never considers it a candidate.
- Recommendation: add `'opencode'` to `DETECTED_TARGETS`, gated the same way
  the other rival CLIs are (only installed when the CLI is actually detected).

### `NATIVE_AGENT_TOOL_POLICY` growth against the Windows argv ceiling has no combined-budget test

- Trigger: any task-prompt adapter spawn (opencode, cursor, antigravity,
  copilot) that also carries a large `role` block, on Windows, where the
  `.cmd` shim path is limited to 8,191 bytes
  (`cli-adapter.utils.ts:596`, `assertCommandLineWithinLimit`).
- Symptom: `NATIVE_AGENT_TOOL_POLICY` grew from 196 bytes to 756 bytes (a
  ~3.9x increase, confirmed by direct byte count) and is unconditionally
  concatenated into every `buildTaskPrompt()` output
  (`cli-adapter.utils.ts:508`), stacking on top of `renderRoleBlock`'s output
  when `options.role` is set. Role bodies observed in this repo run up to
  ~20.6 KB (`.claude/agents/team-leader.md`, `wc -c` = 20,635) even after this
  task's own compression batches. The only spec added
  (`cli-adapter.utils.spec.ts:107-111`) pins the constant alone at
  `<1000` bytes; nothing pins the sum of role block + tool policy + task text
  + two-way messaging guidance + lane completion contract against the 8,191
  ceiling that `assertCommandLineWithinLimit` enforces elsewhere in this same
  file for other argv paths.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:409-415`
  (new constant body), `:508` (unconditional concatenation), `:453-458`
  (`ROLE_TRANSFORM_TARGETS` — note `opencode` is NOT in this set, so its role
  body is not even shortened by the harness transform the other four CLIs
  get); `cli-adapter.utils.spec.ts:107-111` (the only budget assertion, and it
  covers only the fixed constant, not a realistic worst-case prompt).
- Current handling: `assertCommandLineWithinLimit` exists and is called at
  each adapter's actual spawn site (`codex-cli.adapter.ts:632`,
  `antigravity-cli.adapter.ts:620`), so an over-limit command line does throw
  before executing rather than truncating silently — this is not a silent
  data-loss bug. But the throw is discovered at spawn time in production, not
  at review or test time, and this batch made the fixed overhead closer to
  that ceiling without adding a test that would catch a regression for a
  large-role spawn before it reaches a user's machine.
- Recommendation: add a spec that builds `buildTaskPrompt` with a
  representative large role body (e.g. the actual `team-leader.md` byte size)
  plus `mcpPort`/`agentId` set and asserts the total stays under 8,191 bytes,
  or explicitly documents/handles the case where it does not (e.g. capping
  role body length the way `capProjectGuidance` now caps project guidance).

## Blocking issues

### OpenCode target is unreachable at runtime

- File: `libs/backend/harness-sync/src/lib/di/register.ts:114-121`
- Scenario: every real Ptah host process, on every startup, in every
  workspace.
- Impact: the entire OpenCode harness-sync feature this batch built (agent
  transformer, MCP JSON dialect, registry entry, manifest support) never
  executes. A user relying on it gets no subagents and no persisted MCP
  config for OpenCode, with no diagnostic indicating why.
- Fix: add `createOpencodeTarget` to `ALL_HARNESS_TARGET_FACTORIES`.

## Serious issues

### Plugin-declared MCP servers never reach OpenCode

- File: `libs/backend/rpc-handlers/src/lib/handlers/external-plugin-mcp.service.ts:115-119`
- Scenario: any marketplace plugin install/uninstall sweep on a machine with
  OpenCode detected.
- Impact: MCP servers a plugin declares silently never appear in
  `opencode.json`, while they do appear for every other detected CLI —
  inconsistent behavior a user has no way to discover short of checking the
  file themselves.
- Fix: add `'opencode'` to `DETECTED_TARGETS`.

### No regression test enforces the growth budget for `buildTaskPrompt` against the Windows argv limit

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:409-415`,
  `cli-adapter.utils.spec.ts:107-111`
- Scenario: a future edit adds a few hundred more bytes to
  `NATIVE_AGENT_TOOL_POLICY`, `TWO_WAY_MESSAGING_GUIDANCE`, or
  `renderLaneCompletionContract`, combined with a large role file, on Windows.
- Impact: `assertCommandLineWithinLimit` throws at spawn time in production
  rather than being caught by a test during review — exactly the scenario
  this task's own audit (§0, driver 4) exists to prevent.
- Fix: add a spec combining a realistic large role body with the fixed
  overhead and asserting the total against 8,191 bytes.

## Moderate and minor issues

- `libs/backend/harness-sync/src/lib/targets/transformers/transform-rules.ts:453-458` —
  `ROLE_TRANSFORM_TARGETS` excludes `opencode`, so a spawned OpenCode task-prompt
  role body keeps Claude-specific tool references (`AskUserQuestion`, `Task
  tool`, `/orchestrate`) untranslated, unlike codex/copilot/cursor/antigravity.
  This may be intentional (OpenCode's harness-sync agent transformer handles
  static files separately), but the task-prompt spawn path
  (`buildTaskPrompt`/`renderRoleBlock`) is a different code path and was not
  addressed; confirm this is deliberate or extend the set.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:16-17` —
  the header comment's measured byte/token figures are a point-in-time
  snapshot with no automated check that they stay accurate (the pinned test
  only checks the ceiling, not that the comment's numbers match); low-risk
  documentation drift.

## Data flow

1. `rival-targets.ts:createOpencodeTarget` builds a fully-configured
   `WorkspaceHarnessTarget` with the OpenCode agent transformer and MCP
   facet — OK, correctly assembled.
2. `harness-manifest.builder.ts` recognises `'opencode'` as a valid target id
   for manifest entries — OK.
3. `register.ts:registerHarnessSyncServices` is the sole place that turns a
   list of target factories into registered `IHarnessTarget` instances the
   reconciler acts on — GAP: `createOpencodeTarget` is absent from the
   factory list every host actually passes, so step 1's target is built in
   source but never instantiated in any running process.
4. `HarnessReconcilerService` never sees an OpenCode target, so it never
   calls the transformer, never writes `.opencode/agent/*.md`, and never
   touches `opencode.json`'s `mcp` key — the whole downstream pipeline (write,
   idempotent re-sync, uninstall cleanup) is unexercised at runtime despite
   being individually correct and tested.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| OpenCode `.opencode/agent/<id>.md` transformer | COMPLETE | Transformer itself is correct and tested. |
| `opencode.json` `mcp` facet + dialect | COMPLETE | Dialect logic verified correct for stdio/remote round-trip. |
| Registry + `rival-targets.ts` wiring | PARTIAL | Present in `rival-targets.ts` and `mcp-facet.registry.ts`, but not in the DI factory list every host actually uses (`register.ts`) — see Blocking. |
| No `model:` emitted for OpenCode agents | COMPLETE | `opencode-agent-transformer.ts:65-83` never emits `model`. |
| Frontmatter escaping (colons/quotes) | COMPLETE | Reuses `yamlDoubleQuoted`, already tested for these cases. |
| Removing the target cleans up files like codex/copilot | UNVERIFIABLE AT RUNTIME | Mechanism (`isPtahOutput` + directory scan) is generic and correct, but is moot until the target is actually registered. |
| `HarnessTargetId`/`McpInstallTarget`/`CliTarget` union widenings, exhaustive consumers | PARTIAL | Six named files were fixed per the task description; `external-plugin-mcp.service.ts`'s `DETECTED_TARGETS` was missed. |
| `capProjectGuidance` boundary correctness | COMPLETE | No off-by-one; notice always inside cap; short-guidance path unchanged; test covers multi-section truncation. |
| `ptah-core-prompt.ts` refactor keeps all audit §4 rules, budget guarded | COMPLETE | Pinned by `ptah-core-prompt.spec.ts`, passing. |
| `task-spec.contract.ts` specialist < 60% of coordinator, pinned phrases present | COMPLETE | Pinned by `task-spec.contract.spec.ts`, passing. |
| `agent-usage-report.mjs` exits 0, handles missing dirs | COMPLETE | Verified directly: normal run and forced-missing-`HOME` run both exit 0. |

Implicit requirements not addressed: a test that would have caught the
`register.ts` omission (deriving the factory list's coverage from
`HARNESS_TARGET_IDS`, or a "every target id is reachable end-to-end" smoke
test at the `cli-engine`/app DI layer).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Re-sync when OpenCode already has ptah-owned agent files | N/A | Mechanism exists (`isPtahOutput`) | Moot — target never runs |
| `opencode.json` already has unrelated keys | YES | `JsonMcpFacet.mutate` only touches `rootKey` | None found |
| Remote MCP entry round-trips through `local`/`remote` without becoming `http` when it was `sse` | YES | `normalizeDeclaredType` falls through to `inferTransportType` for `remote` | None found |
| Large role block + tool-policy growth vs. 8,191-byte Windows argv limit | PARTIALLY | `assertCommandLineWithinLimit` throws at spawn time | No test catches this before production; see Serious issue |
| Plugin declares MCP server, OpenCode installed | NO | `DETECTED_TARGETS` omits `opencode` | Silent gap, see Serious issue |
| `agent-usage-report.mjs` with no `~/.claude/projects` or `~/.codex/sessions` | YES | Verified directly, exits 0 with "no sessions in window" | None found |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the OpenCode harness-sync feature this batch was built around is
  unreachable in every real process because `register.ts`'s
  `ALL_HARNESS_TARGET_FACTORIES` — the one list every host actually consumes —
  was never updated, even though every other layer (transformer, MCP dialect,
  registry, manifest, union types) was.
- What a robust implementation would add: (1) the one-line fix to
  `register.ts`; (2) `'opencode'` added to `external-plugin-mcp.service.ts`'s
  `DETECTED_TARGETS`; (3) a test that derives target-factory coverage from
  `HARNESS_TARGET_IDS` so a future sixth/seventh target can't repeat this
  gap; (4) a combined-budget spec for `buildTaskPrompt` against the Windows
  8,191-byte argv ceiling using a realistic large role body.
