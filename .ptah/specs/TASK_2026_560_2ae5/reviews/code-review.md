# Code reviews - TASK_2026_560_2ae5

One rolling review file (budget lever D1, batches.md running count). Append new sections at the end:
`# Code Logic Review — Batch N`, `# Code Style Review — Batch N`, or `# Test report — PR 1`.
The two parts below are the former files, verbatim.

## Part 1: code logic reviews (was reviews/code-logic-review.md)

# Code Logic Review — `TASK_2026_560_2ae5` Batch 1

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 2                                     |
| Failure modes found   | 2 (both already handled correctly)    |

Scope reviewed: full contents of `libs/shared/src/lib/types/capability-toggle.types.ts` (1108 lines) and
`.spec.ts` (739 lines), the diffs to `harness-sync.types.ts`, `rpc-misc.types.ts`, `mcp-directory.types.ts`,
`index.ts`, and both `harness-health-badge.component.ts`/`.spec.ts` changes. Cross-checked against
`isOptOutPluginSource` (`rpc-misc.types.ts:413-417`), `summarizeHarnessHealth`/`harnessHealthLabel`
(`harness-sync.types.ts:240-316`), and `harness-reconciler.service.ts` / `plugin-config-source-resolver.ts`
/ `harness-manifest.builder.ts` for the CAPABILITY_ENFORCEMENT claim. Verified independently (not just by
reading the spec) with node scripts: FNV-1a64 stability under key reordering, and the hand-written SHA-256
against Node's `crypto` module at byte lengths 41, 54-57, 63-65, 119-121, 128, 200 — all matched exactly.
Ran the scoped check: `lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace` — 2/2
projects, all green (4/6 cached, 2 fresh typecheck runs).

## Five logic questions

### 1. How does this fail silently?

No silent-failure path found in this batch. Every pure function either returns a typed result or throws
`TypeError` (only for a lone surrogate, `capability-toggle.types.ts:970`, which is a genuine encoding error,
not a policy decision). `decodeCapabilityId` returning `null` for a non-canonical token is a documented,
intentional signal, not a swallowed error — but note Moderate-1 below on `defaultReason`.

### 2. What user action produces unexpected behaviour?

None observed in this batch's pure functions; there is no UI wiring yet (Batch 13). One latent risk: a
caller of `nextWorkspaceValue` who turns a server ON while an imported OFF for that same server exists gets
`'inherit'` written when the choice equals `global ?? default` (by design, per AC-1.3's own reasoning and a
dedicated test at `capability-toggle.types.spec.ts:316-328`) — this is correct behavior, not a defect, but
callers must not assume "inherit" implies "no imported layer beneath it"; the resolver in a later batch must
apply `resolveEffective` (which does skip the imported layer for `inherit`) rather than reading `workspaceEnabled`
literally as "no override."

### 3. What input data produces a wrong answer?

Checked the filename codec exhaustively (see verification above) and found no case producing a wrong hash,
wrong prefix, or a collision between namespaces. Checked `pluginConfigLayer` deny-beats-enable semantics
(`capability-toggle.types.ts:283-291`, spec:354-365) — correct. Checked `classifyMcpScope` against every
`McpInstallTarget` referenced in the Resolution rules (`codex`, `copilot`, `antigravity` → global; `claude`,
`vscode`, `cursor`, `opencode`, undefined → workspace) — matches the plan's USER_SCOPE_TARGETS table exactly
(`capability-toggle.types.ts:303-331`, spec:376-397).

### 4. What happens when a dependency fails?

Not applicable to this batch — no I/O, no dependency injection. `isCapabilityPolicyUnknownError` is a pure
structural guard (`capability-toggle.types.ts:611-618`) correctly matching by `name` across realms
(spec:679-698), which is the only way harness-sync can detect the agent-sdk error without importing it (R2).

### 5. What is missing that the requirements never mentioned?

None found that belongs in this batch. The CAPABILITY_ENFORCEMENT honesty question (task focus #4) is
addressed below under Failure modes — it is not a gap, but it is worth flagging for a later batch's reviewer
to re-verify once Batches 3-9 land, since the shared constant is asserted now but only becomes true end-to-end
after those batches complete (see Data flow and Requirements fulfilment).

## Failure modes

### CAPABILITY_ENFORCEMENT asserts skill/plugin "enforced" for codex/opencode/antigravity before those
batches land

- Trigger: reading `CAPABILITY_ENFORCEMENT` (`capability-toggle.types.ts:652-719`) in isolation, without the
  rest of PR 1.
- Symptom: at first glance the table looks premature — Batch 1 lands only the shared contract, not the
  resolver (Batch 7) that writes workspace skill/plugin toggles into `PluginConfigState`.
- Evidence checked: `harness-reconciler.service.ts` applies one skill/plugin snapshot to every registered
  target in a single pass (`for (const target of this.targets)` at lines 209, 281, 392 — comment at line 15:
  "snapshot to every target. Two targets must never disagree"). `harness-manifest.builder.ts:276,301,433`
  and `plugin-origin-gate.ts:126,139` filter by `disabledSkillIds`/`disabledPluginIds` with no target-specific
  branching — the filtering is target-agnostic, unlike MCP intents which are per-target/native-config.
  `plugin-config-source-resolver.ts:173-178` already reads `resolveCurrentPluginPaths`/`getDisabledSkillIds`
  from `PluginConfigState` today, pre-dating this task.
- Current handling: the code comment (`capability-toggle.types.ts:643-651`) states the reasoning explicitly:
  "Skills and plugins reach those lanes through the harness sync, which already honours the toggles." This
  is accurate for the *existing* PluginConfigState-driven mechanism, and Batch 7's resolver is planned to
  write new workspace toggles into that same `PluginConfigState` via `saveWorkspacePluginConfig` (plan:291-292,
  516), so the claim becomes true by the time all of PR 1's batches land — consistent with the plan's own
  framing (implementation-plan.md:149-150: PR 1 marks only the MCP rows and the CLI-proxy row "not-enforced").
- Recommendation: not a Batch 1 defect — the table's claim is a true statement about the mechanism, verified
  against the actual reconciler code, and it matches the plan's explicit instruction to Task 1.1. However,
  this claim is a cross-batch promise: the Batch 7, 9 and 17 reviewers must re-verify with an actual
  end-to-end test (e.g. AC-3.4/N-something) that a workspace skill/plugin toggle written by the new resolver
  does propagate to a codex/opencode/antigravity target before PR 1 opens, since nothing in Batch 1 proves it
  — Batch 1 only proves the pre-existing mechanism generalizes across targets, not that the new write path
  feeds it. Flag as a checklist item for Batch 7/17, not a Batch 1 finding.

### `decodeCapabilityId` silently discards a distinguishing signal for hashed tokens

- Trigger: any hashed item (`h_<sha40>`) is read from disk.
- Symptom: `decodeCapabilityId` returns `null` for any `h_`-prefixed token (`capability-toggle.types.ts:915-916`
  — "not reversible... the reader takes the id from the file content"), which is correct and documented. This
  is listed as a failure mode only to record that it is *not* a defect: the design deliberately stores the id
  in the item's JSON content (`CapabilityExplicitItem.id`) precisely so the reader never needs to invert the
  hash, and the reader is specified (C2, plan:182-183) to recompute `canonicalFilename(kind, content.id)` and
  compare it to the actual file name — the mismatch path (`error` → unverified) is the fail-closed backstop.
  Batch 1 does not implement that reader (Batch 6 does), so this cannot be verified end-to-end here; it is
  correctly out of scope for Batch 1.
- Current handling: correct for this batch's scope.
- Recommendation: Batch 6's reviewer must confirm the reader actually performs this recompute-and-compare
  step (D2 acceptance item), since the codec alone cannot enforce it.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **(Minor) `CapabilityDefaultReason` union has no case for an id declared in both scopes with different
   `defaultEnabled` outcomes across two calls in the same session** — not a defect, just worth naming: since
   `defaultEnabled` for `kind: 'mcp'` takes `scopes: readonly CapabilityScope[]` as the full set of
   declaration scopes, a caller that mistakenly passes only one declaration's scope (rather than the union
   across every declaration of that name) would silently produce `'repository-only'` for a server that also
   has a global declaration elsewhere. The function itself is correct (spec:155-166 covers the union
   correctly); this is a caller-discipline risk for Batch 4/7, not a Batch 1 code defect. `file:
   capability-toggle.types.ts:144-166`.

2. **(Minor) `tomlKeySegment('')` produces `""`** (spec:527) — an empty TOML key is syntactically unusual but
   matches TOML's own basic-string grammar (an empty basic string is legal); whether an empty MCP server name
   can ever reach this function is a question for the harness-sync facet, not this batch. No fix needed here;
   flagging only so the codex facet batch does not assume server names are always non-empty.

## Data flow

1. `CapabilityDefaultInput` (kind + id + scope evidence) → `defaultEnabled` → `CapabilityDefault` — OK, pure,
   exhaustively tested including the `switch` covering all three `kind` values with no `default` branch (a
   TypeScript exhaustiveness check, so a missing case would fail to compile).
2. `CapabilityLayerValues` (per-layer values gathered by a future resolver) → `resolveEffective` →
   `ResolvedCapability` — OK. Traced the four-layer precedence and the `inherit`-skips-imported branch and the
   parent-plugin override; all match the plan's Resolution rules verbatim and are pinned by dedicated tests.
3. A UI toggle intent (`desired: boolean`) → `nextWorkspaceValue` → `CapabilityItemValue` written to disk (by
   a later batch's store) — OK for this batch; the write itself (atomicity, concurrency) is Batch 6's
   responsibility and out of scope here.
4. `PluginConfigState` (legacy, on disk) → `pluginConfigLayer` → `PluginConfigLayer` (workspace layer for
   skill/plugin resolution) — OK; legacy field semantics preserved bit-for-bit (AC-3.2), new `enabledSkillIds`
   correctly optional and correctly loses to `disabledSkillIds` on conflict.
5. Global + workspace item content + `PluginConfigState` → `harnessPolicyFingerprint` → a stable hex digest
   consumed by `HarnessPolicySync` (Batch 5, not yet implemented) — OK for the pure function; verified
   independently that it is order-independent and that `lastUpdated` is correctly excluded from the digest
   (a save that changes nothing must not force a pass — spec:548-562, and independently re-verified with a
   standalone node script).
6. `HarnessHealth.sources: 'policy-unknown'` → `summarizeHarnessHealth` → `level: 'degraded'` → the badge
   component's `harnessSourcesNote()` switch → user-facing text — OK, full chain traced and the new switch
   case added at `harness-health-badge.component.ts:265-266` keeps the exhaustive switch compiling (this is
   exactly the P1 fix the batches.md plan documents), with a passing spec case
   (`harness-health-badge.component.spec.ts:469-478`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| AC-1.3 (`nextWorkspaceValue` normalizes to `inherit`) | COMPLETE | None; spec covers both directions and the "past an imported OFF" case |
| AC-2.1 (`classifyMcpScope`) | COMPLETE | None |
| AC-2.5 (`definitionInEffect` pinned) | COMPLETE | None; precedence and input-order-stability both tested |
| AC-3.2 (`pluginConfigLayer` preserves legacy semantics) | COMPLETE | None; deny-beats-enable and missing-list cases covered |
| AC-4.1 (defaults and `resolveEffective`) | COMPLETE | The three-fixture equivalence (`enableAllProjectMcpServers` true/false/absent) is an integration-level AC proved by later batches (C4), not by these pure functions alone; Batch 1's contribution (defaults independent of settings files) is complete |
| D2 codec vectors | COMPLETE | Verbatim fixed vector present (`capability-toggle.types.spec.ts:45-52`) and independently reproduced by a fresh SHA-256 computation outside the spec |
| R2 (`isCapabilityPolicyUnknownError`) | COMPLETE | None |
| Task 1.2 (optional fields keep old configs loading) | COMPLETE | `HarnessHealth.policyFingerprint?`, `InstalledMcpServer.scope?`, `PluginConfigState.enabledSkillIds?` all optional; no required-field addition anywhere in the diff |
| Task 1.3 (exhaustive switch stays exhaustive) | COMPLETE | Compiles with no `default` case added, confirming TypeScript still enforces exhaustiveness |
| "No `crypto` import in shared" (Batch 1 verification bullet) | COMPLETE | Grepped; none found in `capability-toggle.types.ts` |

Implicit requirements not addressed: none found beyond the cross-batch flag on CAPABILITY_ENFORCEMENT above,
which is a verification note for later batches rather than a gap in this one.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| D2 collision pair (`"x".repeat(121)` vs `h_79072a47…`) | YES | Verbatim test at spec:45-52, matches plan text exactly | None |
| Lone surrogate id | YES | `TypeError` thrown, tested at spec:117-120 | None |
| 120 vs 121-char literal boundary | YES | Tested at spec:75-85, independently re-verified at byte-exact boundaries | None |
| Case-insensitive filesystem collision (`Repo` vs `repo`) | YES | `%52epo` vs `repo`, tested spec:67-73 | None |
| SHA-256 at 55/56/64-byte block boundaries | YES | Independently verified against Node `crypto` at 54,55,56,57,63,64,65,119,120,121,128,200 bytes — all exact matches | None |
| FNV-1a64 fingerprint stability under key/entry/list reordering | YES | spec:548-562, independently re-verified with a standalone script | None |
| `inherit` tombstone during/after import | YES (rules only) | `resolveOwnLayers` skips imported when `workspace === 'inherit'`, spec:253-269 | Store-level "during an import race" scenario is Batch 6's to prove |
| Legacy `PluginConfigState` with no `enabledSkillIds` | YES | spec:341-373, missing/undefined/`{}` all produce empty layers | None |
| Parent-plugin-off cascading to skill | YES | spec:271-292, including the case where workspace explicitly says `off` and parent is also off (still `workspace` origin, not double-counted) | None |
| `policy-unknown` reduces to `degraded`, not `error` or `unknown` | YES | spec:670-676 and independently traced through `summarizeHarnessHealth` | None |

## Re-check after style revise

The style-revise round moved the codec, UTF-8 helpers, hand-written SHA-256, `tomlKeySegment`,
`harnessPolicyFingerprint` and `isHarnessPassAcknowledged` into a new `libs/shared/src/lib/types/capability-id-codec.ts`
(+ `.spec.ts`), moved `CapabilityScope` into `mcp-directory.types.ts`, and replaced the literal
`CAPABILITY_ENFORCEMENT` array with a small `enforcementRows(provider, label, byKind)` builder driven by
`EVERY_KIND_ENFORCED` / `MCP_NOT_ENFORCED` per-kind objects. Verified directly against the code (not just the
diff summary):

- **Algorithm unchanged.** `capability-id-codec.ts` is byte-for-byte the same SHA-256, FNV-1a64, UTF-8 and D2
  codec logic previously in `capability-toggle.types.ts`, only renamed (`SHA256_K` → `SHA256_ROUND_CONSTANTS`,
  `SHA256_INITIAL` → `SHA256_INITIAL_HASH`) and given FIPS-180-4 section-reference comments. No behavioural
  change; nothing here needed to be re-derived, since the code is textually identical apart from names.
- **Exports.** `libs/shared/src/index.ts:47-48` now exports both `capability-toggle.types` and
  `capability-id-codec`, and `capability-toggle.types.ts` imports `CapabilityScope` from `mcp-directory.types.ts`
  (`capability-toggle.types.ts:31`) rather than declaring it. Every symbol previously reachable from
  `@ptah-extension/shared` (`encodeCapabilityId`, `decodeCapabilityId`, `canonicalFilename`,
  `parseCapabilityFilename`, `tomlKeySegment`, `harnessPolicyFingerprint`, `isHarnessPassAcknowledged`,
  `CapabilityScope`, `CAPABILITY_LITERAL_MAX_LENGTH`, `CapabilityFingerprintEntry`,
  `HarnessPolicyFingerprintInput`) is still exported, just from a different file — the package's public
  surface (what a consumer imports from `'@ptah-extension/shared'`) is unchanged.
- **`CAPABILITY_ENFORCEMENT` rows/order/values.** Traced `enforcementRows` (`capability-toggle.types.ts:665-674`)
  and its call sites (`:686-693`): output order is `claude` (mcp, skill, plugin all enforced), `ptah-cli` (same),
  `codex` (mcp not-enforced, skill/plugin enforced), `opencode` (same), `antigravity` (same), `ptah-cli-proxy`
  (mcp not-enforced only) — identical rows, order and status values to the array I reviewed pre-move. The
  `ENFORCEMENT_KIND_ORDER` constant (`mcp, skill, plugin`) reproduces the per-provider kind order the original
  literal array used.
- **D2 vectors and Node-crypto comparison.** Both are present, verbatim, in the new
  `capability-id-codec.spec.ts`: the `"x".repeat(121)` → `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` fixed
  vector and its `l_h_...` counterpart, plus a `createHash('sha256')` (`node:crypto`) helper used the same way
  as before.
- **Test count.** `capability-toggle.types.spec.ts` now holds 33 `it()` blocks and the new
  `capability-id-codec.spec.ts` holds 17 — 50 total, matching the coordinator's count.
- **Live verification.** Ran `lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace`
  with `--skip-nx-cache` (no cache reuse) — all 6 tasks passed for both projects.

No behavioural change found; this is a pure relocation plus a data-driven rebuild of one constant table that
reproduces the same rows.

**Verdict: APPROVE**

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none within this batch's scope. The one cross-batch item worth tracking is that
  `CAPABILITY_ENFORCEMENT`'s skill/plugin "enforced" claim for codex/opencode/antigravity is true of the
  *existing* harness-sync mechanism and the *planned* write path, but nothing in Batch 1 proves the new
  resolver (Batch 7) actually connects to it — that connection needs an explicit test before PR 1 opens.
- What a robust implementation would add: nothing further for this batch's pure-function scope; the codec,
  resolution rules, fingerprint and exhaustiveness fix are all correct, tested beyond the plan's own minimum
  (independently reproduced against Node's `crypto` rather than trusting the spec's self-consistency), and
  the check command passes cleanly for both projects.

# Code Logic Review — Batch 4

Worktree reviewed: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-560-b4`
(`feat/task-2026-560-b4-facet-inspect`, base `cac3db9e2`). Files: `mcp-facet.port.ts`, `json-mcp-facet.ts`,
`codex-toml-mcp-facet.ts`, `opencode-mcp-facet.spec.ts`, `codex-toml-mcp-facet.spec.ts`.

## Summary

| Metric              | Value             |
| -------------------- | ----------------- |
| Overall score         | 7/10               |
| Assessment             | NEEDS_REVISION     |
| Blocking issues        | 0                  |
| Serious issues         | 1                  |
| Moderate issues        | 2                  |
| Failure modes found    | 2                  |

Scope reviewed: full diff of the five listed files against base `cac3db9e2`; full read of
`json-mcp-facet.ts` and `codex-toml-mcp-facet.ts` (including `parseMcpServerTables`, `readStatus`,
`readJsonStatus`, `errorCode`/`describeError` in `fs/windows-retry.ts`); `mcp-facet.port.ts`'s new
`McpSourceStatus`/`McpFacetInspection` JSDoc; `harness-sync/src/index.ts` export barrel; `implementation-plan.md`
C4 (lines 273-317) and Batch 4/Task 4.1-4.3 in `batches.md` (lines 363-398). Ran
`NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync --parallel=2`
in the b4 worktree — 1 project, lint/typecheck/test all green (2 cached, typecheck fresh).

## Five logic questions

### 1. How does this fail silently?

Not inside `inspect()` itself — both implementations route every failure through `status`/`error` and never
throw (`codex-toml-mcp-facet.ts:225-245`, `json-mcp-facet.ts:276-300`; `parseMcpServerTables` is a
non-throwing scanner, confirmed by reading it in full — no `throw`, no assertion, degrades unknown syntax to
skipped lines). The silent failure is one layer up, in wiring: `McpFacetInspection`/`McpSourceStatus` are
defined and used in `IHarnessMcpFacet.inspect()`'s return type but are **not** re-exported from
`libs/backend/harness-sync/src/index.ts` (only `IHarnessMcpFacet` itself is, at lines 176-181). A Batch 7
consumer in `@ptah-extension/cli-agent-runtime` that imports `IHarnessMcpFacet` from the package barrel and
calls `.inspect()` gets a value whose type it cannot name through the public API — see Serious-1.

### 2. What user action produces unexpected behaviour?

A user (or another tool: opencode, an editor, a sync client) truncates and rewrites `opencode.json`,
`.mcp.json`, etc. non-atomically. If `inspect()` reads during the truncate-to-first-byte window, it sees a
0-length file and reports `status: 'ok', servers: new Map()` — "this file definitely declares nothing" —
rather than "unknown." See Moderate-1.

### 3. What input data produces a wrong answer?

- A JSON config whose `rootKey` value is present but not an object (array, string, number) → correctly
  `error` (`json-mcp-facet.ts:135-144`, tested at `opencode-mcp-facet.spec.ts:325-329`).
- A 0-byte or whitespace-only JSON file → `ok`, `servers: {}` by explicit design
  (`json-mcp-facet.ts:271-274`, `284`) — see Moderate-1 for why this is a real, not merely theoretical, risk.
- Codex TOML with junk lines outside any `[mcp_servers.*]` table, or an unrecognized table header → silently
  dropped by `parseMcpServerTables`, never surfaced as `error` — this is pre-existing, documented parser
  behaviour (`codex-toml-mcp-facet.ts:24-28`) that `inspect()` inherits unchanged; not a new defect, but worth
  the Batch 7 reviewer's attention since `inspect()` is now a policy input and "a table Ptah couldn't parse"
  and "a table Codex has genuinely none of" are indistinguishable through `inspect()`.

### 4. What happens when a dependency fails?

`readFileSync` throwing EACCES, EPERM, EBUSY, or a `readFileSync` on a directory (EISDIR) are all classified
identically: `errorCode(error) !== 'ENOENT'` → `status: 'error'` with `describeError(error)` as the message
(`codex-toml-mcp-facet.ts:238-241`, `json-mcp-facet.ts:280-282`). Only ENOENT is special-cased to `missing`.
This is the correct fail-closed classification per N9 — verified directly (not just by reading the spec) by
running the b4 test suite, which includes a real EACCES case (via the `readFileSync` pass-through mock,
since Windows `chmod` cannot produce EACCES) and a real EISDIR case (`mkdirSync` over the config path, no
mocking needed — genuine filesystem behaviour on both platforms). Both pass.

### 5. What is missing that the requirements never mentioned?

Task 4.1's own quality requirement anticipates this exact question and answers it wrong: "the result type is
declared in `mcp-facet.port.ts`, which is already exported... No `index.ts` edit is expected; if one is
needed, report it as an unplanned file" (`batches.md:385-387`). `IHarnessMcpFacet` being exported does not
export the `McpFacetInspection`/`McpSourceStatus` types that are new in this batch and that appear in its
return position — see Serious-1. No unplanned-file report exists for Batch 4 (no batch report file yet, and
`index.ts` is untouched in the diff), so this went unflagged rather than deliberately deferred.

## Failure modes

### Barrel export gap blocks Batch 7's stated consumer

- Trigger: `@ptah-extension/cli-agent-runtime` (a different Nx project) imports `IHarnessMcpFacet` from
  `@ptah-extension/harness-sync` and calls `.inspect()`, per `implementation-plan.md:275-279` ("Facets:
  `IHarnessMcpFacet.inspect(root) → {status, error?, servers}`... consumed by C4" in `CapabilityResolverService`,
  planned for Batch 7).
- Symptom: `McpFacetInspection` and `McpSourceStatus` — the exact shape the resolver needs to switch on
  (`status === 'error'` → unverified, per plan:307) — are not importable from the package's public surface.
  Nx's module-boundary lint rule (used throughout this repo) blocks a deep import past the barrel, so the
  Batch 7 executor is left to either violate that boundary, duplicate the union type locally (drift risk the
  next time a status value is added), or avoid ever naming the type (workable but brittle for an exhaustive
  `switch` on `status`).
- Evidence: `libs/backend/harness-sync/src/index.ts:176-181` exports only `isMcpFragmentKey`, `mcpEntryKey`,
  `PTAH_SPAWN_MCP_KEY`, `type IHarnessMcpFacet` from `mcp-facet.port.ts`; `McpFacetInspection`/`McpSourceStatus`
  are defined at `mcp-facet.port.ts:93-107` (new in this diff) and are absent from the export list.
- Current handling: none — the gap is silent; nothing fails today because no consumer exists yet in this
  package, and `harness-sync`'s own typecheck (run above) has no reason to catch a barrel omission that only
  matters to an external importer.
- Recommendation: add `type McpFacetInspection, type McpSourceStatus` to the existing export block at
  `index.ts:176-181` now, while the batch is still open, rather than leaving it for Batch 7 to discover as a
  cross-project typecheck failure.

### Zero-length JSON config read as a definite "declares nothing" rather than "unknown"

- Trigger: a non-atomic writer (an editor, `opencode` itself, a sync client) truncates one of the five JSON
  MCP config files before writing new content; `inspect()` reads in that window.
- Symptom: `status: 'ok', servers: new Map()` — treated identically to a config a user actually emptied on
  purpose — not `error`. `json-mcp-facet.ts:271-274` documents this as intentional ("that is what an editor's
  freshly created file looks like, and it is a definite answer rather than an unknown one"), but the sibling
  component this same task builds — the capability-toggle store's item files — makes the opposite call for the
  identical race: `implementation-plan.md:215` states "Any unparseable file, **a 0-byte file**,... → `status:
  'error'`" for that store, precisely because a 0-byte file is not distinguishable from a torn write.
- Evidence: `json-mcp-facet.ts:284` (`if (text.trim() === '') return { status: 'ok', json: {} };`), tested at
  `opencode-mcp-facet.spec.ts:280-286` ("reports `ok` and no servers for a zero-length file"). No equivalent
  carve-out exists in `codex-toml-mcp-facet.ts`, but an empty TOML document parses to zero tables anyway, so
  it lands on the same `ok`/empty outcome implicitly.
  `implementation-plan.md` never states a 0-byte rule for the MCP facets specifically (only for the store), so
  this is a genuine, unreviewed design choice made at implementation time, not a plan requirement being
  followed.
- Current handling: `ok`, empty. A resolver (not yet built) that treats "declares nothing" as authoritative —
  e.g. to compute which of a target's previously-declared servers are now foreign, or to decide a source
  contributes an empty approval layer — cannot tell this apart from a genuinely empty file.
- Recommendation: either justify the asymmetry explicitly against the store's 0-byte-is-`error` rule (e.g.
  "MCP config files are third-party and edited constantly, so treating transient empty as `ok` is the
  pragmatic choice, unlike Ptah's own item files"), or align the two components by treating a 0-byte MCP
  config as `error` too. Whichever is chosen, the Batch 7 reviewer must confirm the resolver's actual use of
  `status: 'ok'`-with-empty-servers does not let a torn third-party write silently narrow or widen the
  effective server set; nothing in Batch 4 wires that consumer yet, so the risk cannot be closed here.

## Blocking issues

None.

## Serious issues

### 1. `McpFacetInspection`/`McpSourceStatus` not exported from the harness-sync barrel

- File: `libs/backend/harness-sync/src/index.ts:176-181` (unchanged in this diff); types defined at
  `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.port.ts:93-107`.
- Scenario: Batch 7's `CapabilityResolverService` (a different Nx project, per `implementation-plan.md:275-279,
  310-317`) needs to name these types to consume `inspect()` meaningfully.
- Impact: blocks or forces a workaround (module-boundary violation, duplicated union, or untyped consumption)
  in the very next batch this one exists to unblock. Task 4.1 explicitly anticipated and required reporting
  this exact gap (`batches.md:385-387`) and it was not reported.
- Fix: add `type McpFacetInspection, type McpSourceStatus` to the export block at `index.ts:176-181`.

## Moderate and minor issues

1. **(Moderate)** Zero-byte JSON config treated as `ok`/empty rather than `error`, inconsistent with the
   sibling store's explicit 0-byte-is-`error` rule for the identical torn-write race. `json-mcp-facet.ts:271-284`.
   See Failure modes above.
2. **(Moderate)** `parseMcpServerTables` silently drops table headers and lines it cannot interpret
   (pre-existing behaviour, `codex-toml-mcp-facet.ts:24-28,425-462`), and `inspect()` now exposes that same
   leniency as a policy-relevant "this file declares these servers, `ok`" answer. Not a new defect in this
   batch, but the Batch 7 reviewer should confirm a malformed-but-present table is acceptable to treat as `ok`
   (silently fewer servers) rather than `error` (unknown), since N9's whole point is not conflating those two.

## Data flow

1. Caller → `facet.inspect(workspaceRoot)` → `configPath()`/`readStatus()`/`readJsonStatus()` — OK, resolves
   scope (home vs workspace, missing workspace → `missing`) before any I/O.
2. `readFileSync` → ENOENT → `missing`; any other errno → `error` with `describeError` — OK, matches N9's
   fail-closed contract; verified live against real EACCES (via mock pass-through) and real EISDIR.
3. Readable bytes → `parseMcpServerTables` (TOML) or `JSON.parse` + rootKey lookup (JSON) → `Map<string,
   McpServerConfig>` — OK for well-formed content; a 0-byte file short-circuits to `ok`/empty before parsing —
   see Moderate-1, a design choice not explicitly required by the plan.
4. `McpFacetInspection` returned to caller — **gap**: the caller cannot import this type from the package
   barrel (Serious-1). Legacy `readAll()`/`readFile()` paths are untouched and confirmed byte-identical by
   reading both files in full (only `toServerMap`/`readServersObject` extraction changed shape, not
   behaviour).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `IHarnessMcpFacet.inspect(root) → {status, error?, servers}` (plan:275) | COMPLETE | None — implemented identically in both facets |
| Codex `readStatus` separates ENOENT from other errors (N9, plan:277-278) | COMPLETE | None |
| Legacy `readAll` byte-for-byte unchanged (Task 4.2) | COMPLETE | Verified by reading both files; `readAll`/`readFile`/`readJson`/`readServersObject` logic unchanged, only extracted into a shared `toServerMap` helper with identical semantics |
| EACCES → `error`, `readAll` still empty; ENOENT → `missing` (Task 4.3) | COMPLETE | Both specs cover this; EACCES via `fs` mock pass-through (Codex), EISDIR via real directory (both) |
| Type exported from `mcp-facet.port.ts`, "already exported" via `IHarnessMcpFacet` (Task 4.1) | PARTIAL | `IHarnessMcpFacet` is exported; `McpFacetInspection`/`McpSourceStatus` are not — see Serious-1 |
| N9 fail-closed input (AC) | COMPLETE for the read-classification itself | The 0-byte-is-`ok` carve-out is a policy decision this batch made without plan guidance — flagged for the batch that actually consumes it |

Implicit requirements not addressed: whether a 0-byte or unparseable-table MCP config should widen or narrow
an effective server set is a Batch 7 question this batch cannot close on its own, since no consumer exists
yet; flagged above so it is not lost.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| ENOENT (file absent) | YES | `missing`, tested both facets | None |
| EACCES (unreadable, present) | YES | `error` with message, tested both facets (Codex via mock pass-through, real EACCES semantics) | None |
| EISDIR (directory at config path) | YES | `error`, tested both facets on a real filesystem | None |
| Workspace-scoped facet, no workspace root | YES | `missing`, tested both facets | None |
| 0-byte / whitespace-only JSON file | YES | `ok`, empty — by design | Inconsistent with store's 0-byte-is-`error` rule for the same race (Moderate-1) |
| Malformed JSON | YES | `error` | None |
| Top-level JSON not an object (array) | YES | `error` | None |
| `rootKey` value present but not an object | YES | `error` | None |
| Codex TOML unparseable table/lines | Partially | Silently dropped, `ok` with fewer servers | Pre-existing scanner behaviour now exposed as a policy input (Moderate-2) |
| `readAll`/legacy contract unchanged under all the above | YES | Directly asserted in both specs (`readAll().size === 0` alongside `inspect()` `error`) | None |
| `fs` mock leakage across tests/files | NO leak found | `jest.mock('fs')` is file-scoped to `codex-toml-mcp-facet.spec.ts` only (Jest per-file module registry); `afterEach` restores the real `readFileSync` implementation after every test | None |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `McpFacetInspection`/`McpSourceStatus` are not exported from the harness-sync package barrel, which
  will surface as a cross-project blocker (or a module-boundary workaround) the moment Batch 7 tries to
  consume `inspect()`, despite Task 4.1 explicitly requiring this exact gap to be checked and reported.
- What a robust implementation would add: (1) the two missing named exports in `index.ts`; (2) either a
  justification for treating a 0-byte MCP config as `ok` while the sibling store treats a 0-byte item file as
  `error`, or aligning the two; (3) a note for the Batch 7 reviewer that a malformed-but-partially-parsed Codex
  TOML table is currently indistinguishable from "genuinely declares fewer servers" through `inspect()`.

## Re-review round 1 — Batch 4

Re-diffed the b4 worktree against `cac3db9e2` for the same five files, plus `mcp-facet.registry.ts` (to check
production wiring of the new re-read hook). Ran the check command again: 1 project, lint/typecheck/test green.

### Prior defects

1. **Serious-1 (barrel export gap) — RESOLVED.** `index.ts:176-181` now exports `type McpFacetInspection,
   type McpSourceStatus` alongside `IHarnessMcpFacet`. Batch 7 can now import both by name.
2. **Moderate-1 (0-byte JSON treated as definite `ok`) — RESOLVED.** `readJsonStatus` now re-reads once after
   `EMPTY_CONFIG_REREAD_DELAY_MS` (50 ms) when the first read is empty/whitespace-only: still empty → `ok`
   (a persistently empty file really does declare nothing); content on the re-read → parsed normally; the
   re-read itself failing (including ENOENT, i.e. the file vanished under us) → `error`, not `missing` —
   correct, since a file that existed a moment ago and now doesn't is a change mid-inspection, not "never
   configured." The docstring at `json-mcp-facet.ts:268-291` now explicitly contrasts this against the store's
   0-byte-is-`error` rule and states the reasoning (third-party files vs. Ptah's own atomic writes), which is
   exactly the justification the prior round asked for. Tests exercise all three outcomes plus the "no wait
   when content is already present" and "default `blockFor` still resolves `ok` for a truly-empty file" cases
   (`opencode-mcp-facet.spec.ts:263-424`).
3. **Moderate-2 (Codex TOML lenient parsing exposed as `ok`) — RESOLVED (by disclosure).** Both
   `mcp-facet.port.ts:82-97` and `codex-toml-mcp-facet.ts:118-132` now state explicitly that `ok` means
   "readable", not "fully understood", and name the known gap (quoted-key tables, deferred to Batch 18). This
   satisfies the prior recommendation, which only asked that this be surfaced for the Batch 7 reviewer.

### A. Is the empty-file re-read wait blocking the event loop?

Yes, and it is a real production defect, not just a theoretical one.

- `inspect()` is synchronous on the interface (`mcp-facet.port.ts`: `inspect(workspaceRoot: string):
  McpFacetInspection`, no `Promise`) and both implementations keep it synchronous.
- `blockFor` (`json-mcp-facet.ts`, new) is `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)`.
  In Node.js — unlike a browser main thread — `Atomics.wait` is permitted on the main thread and genuinely
  parks it: it is not a spin loop, but it is not yielding to the event loop either. For the duration of the
  wait, no other timer, I/O callback, or IPC message on that thread is serviced.
- This is not test-only: `mcp-facet.registry.ts` (the production factory `createMcpFacet`, all six JSON
  targets) never sets `waitBeforeEmptyReread`, so every production `JsonMcpFacet` instance defaults to
  `blockFor`. The new spec `'uses a real (short) wait by default and still reports \`ok\` for a stable empty
  file'` (`opencode-mcp-facet.spec.ts:414-419`) exercises exactly this default and genuinely blocks the Jest
  worker thread for ~50 ms, confirming the production path is the blocking one, not just documented as such.
- Where this runs matters: harness-sync's facets are read from the Electron main process and/or the VS Code
  extension host (both single-threaded Node hosts whose responsiveness is the whole product's responsiveness).
  A 50 ms stall on a single `inspect()` call is small in isolation, but `inspect()` is designed to be called
  per-facet per-target during reconcile/resolve (plan:281 "one inventory... feeds both `list` and `resolve`");
  multiple empty/freshly-created configs in one pass compound linearly (5 JSON targets × 50 ms = up to 250 ms
  of a fully frozen main/extension-host thread per resolve, worse under contention since `Atomics.wait` does
  not yield to pending I/O either).
- `inspect()` is a brand-new method with no existing synchronous caller outside this batch's own tests —
  Batch 7 (its only planned consumer) has not landed. There is nothing today that requires `inspect()` to stay
  synchronous, unlike `readAll`/`write`/`remove`, which are exercised by the existing reconciler and would be a
  larger, out-of-scope change to convert. The stated reason for choosing a blocking wait ("`inspect` is
  synchronous, like `readAll`") is circular: `inspect` is synchronous only because this batch chose to keep it
  that way, not because anything external requires it.
- Fix: make `inspect()` return `Promise<McpFacetInspection>` on the port and both implementations, and replace
  `blockFor` with `await new Promise(resolve => setTimeout(resolve, ms))`. This is a mechanical, low-risk
  change confined to this batch's own new method and its own new tests (no existing caller to migrate).

### B. Should the Codex facet apply the same once-re-read rule?

Ruling: **acceptable to leave open for this batch, but it is an undocumented asymmetry that should at least be
named** — not the blocking defect A is.

Reasoning:

- The identical race exists in principle: `readStatus` reads `~/.codex/config.toml` once with no re-read, and
  an empty read (e.g. a third-party tool truncating the file) parses to zero tables via `parseMcpServerTables`,
  landing on `status: 'ok', servers: new Map()` — the same "declares nothing" outcome the JSON facet spent this
  round fixing.
- However, per `implementation-plan.md:307`, Codex's read status already has an asymmetric, more consequential
  role than a single JSON facet's: "an unreadable `~/.codex/config.toml` (EACCES) → `unverified`" is called out
  as feeding the *system-wide* verified/unverified gate, not merely Codex's own inventory row. That makes a
  false `ok`-on-a-torn-write for Codex arguably higher-consequence than for one of five JSON targets (a bad read
  there affects only that target's declared set), which argues **for** applying the same mitigation, not against
  it.
- Mitigating factors that make this non-blocking for Batch 4 specifically: (1) `~/.codex/config.toml` is a
  single global file, not five per-workspace/per-tool files re-created on every `npm install`/editor-open the
  way `opencode.json`/`.vscode/mcp.json` can be — the practical torn-write window is narrower; (2) this exact
  ambiguity (empty read = declares nothing) already existed in the pre-batch `readAll`/`readFile` path and is
  not a regression this batch introduced, only a risk this batch's new `inspect()` makes visible as a named
  status for the first time; (3) full TOML robustness for this file (quoted-key tables) is already explicitly
  deferred to PR 2 / Batch 18 per the plan and the code's own new disclosure comment, so a torn-write mitigation
  arriving in the same follow-up pass is a reasonable place to land it, provided it is not forgotten.
- What is missing right now: nothing in `codex-toml-mcp-facet.ts` or `mcp-facet.port.ts` says *why* the JSON
  facet gets a re-read and the TOML facet does not — the new disclosure comment covers lenient parsing (quoted
  keys) but not the torn-write race specifically. A reader comparing the two facets side by side would
  reasonably conclude this was an oversight rather than a decision.
- Recommendation (Moderate, not blocking): either (a) apply the same `waitBeforeEmptyReread`-style once re-read
  to `readStatus`'s empty-text case, or (b) add one sentence to `codex-toml-mcp-facet.ts`'s `inspect`/`readStatus`
  doc explaining why the JSON facets' torn-write mitigation does not apply here (e.g. narrower race window,
  single global file, tracked for Batch 18). Do not leave the asymmetry silent.

### Updated summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 (new: blocking `Atomics.wait` in a synchronous, newly-introduced `inspect()`) |
| Moderate issues | 1 (Codex torn-write asymmetry left undocumented) |
| Failure modes found | 1 new (main-thread stall under `inspect()`); the three from round 0 are resolved |

**Verdict: REVISE** — the barrel-export fix and the empty-file re-read design are both correct and well-tested;
the blocking `Atomics.wait` default is a new, real defect (Concern A) that should be converted to an async wait
before this batch is accepted, since `inspect()` has no existing caller that requires it to stay synchronous.
Concern B (Codex asymmetry) is a documentation/consistency gap, not a blocker.

## Re-review round 2 — Batch 4 (final)

Re-diffed the b4 worktree against `cac3db9e2` for `mcp-facet.port.ts`, `json-mcp-facet.ts`,
`codex-toml-mcp-facet.ts`, and re-read `codex-toml-mcp-facet.spec.ts`/`opencode-mcp-facet.spec.ts` in full. Ran
the check command once: 1 project, lint/typecheck/test all green (2/3 cached, typecheck fresh).

### Round-1 items

1. **Concern A (blocking `Atomics.wait`) — RESOLVED.** `inspect()` is now `Promise<McpFacetInspection>` on the
   port (`mcp-facet.port.ts:150`) and both implementations. `JsonMcpFacet`'s `readJsonStatus` uses `fs/promises`
   `readFile` for both reads and a `delay(ms)` helper (`json-mcp-facet.ts:355-361`:
   `new Promise((resolve) => setTimeout(resolve, ms))`) as the default `waitBeforeEmptyReread`; the
   `Atomics.wait`/`SharedArrayBuffer` helper is gone entirely (grepped — no remaining reference in the file or
   elsewhere in `harness-sync`). `CodexTomlMcpFacet.readStatus` now awaits `readFile` from `fs/promises` instead
   of the sync `readFileSync`. Neither change alters production wiring beyond that — `mcp-facet.registry.ts`
   still does not set `waitBeforeEmptyReread`, so production uses the non-blocking `delay` default. Confirmed no
   remaining synchronous blocking wait anywhere in the diff.
2. **Concern B (Codex torn-write asymmetry) — RESOLVED (by disclosure, as requested).** The round-1
   recommendation asked for either the same mitigation or one sentence explaining why not; the executor chose
   the latter and did it properly: `codex-toml-mcp-facet.ts:141-153` now states, inside the `inspect` JSDoc,
   the three reasons named in the coordinator's message (single global file vs. a per-workspace file rewritten
   on every save; TOML robustness as a whole belongs with Batch 18; PR 1 reports Codex lanes as "not enforced",
   so nothing currently gates a policy decision on an `ok`-and-empty read from this facet). This is no longer a
   silent asymmetry — a reader comparing the two facets now has the reasoning in front of them.

### Does `inspect()` reject? Traced every `await` on both paths

- `JsonMcpFacet.inspect` → `readJsonStatus(path, wait)`:
  - First `await readFile(...)` — wrapped in `try/catch`; ENOENT → `missing`, else `error`. Cannot escape.
  - `await wait(EMPTY_CONFIG_REREAD_DELAY_MS)` — **not** inside a `try/catch`, but the production default
    (`delay`) is `new Promise((resolve) => setTimeout(resolve, ms))`, which has no code path that calls
    `reject` — a `setTimeout` callback cannot itself throw here since it only calls `resolve`. This cannot
    reject in production. The only way it could reject is a caller-supplied `waitBeforeEmptyReread` from a
    test doing so deliberately, which is outside the "must never reject" contract's concern (that contract is
    about `inspect()`'s own I/O, not a test double misusing an injection point) — and no such test exists in
    this diff (checked every use of `waitBeforeEmptyReread` in `opencode-mcp-facet.spec.ts`, all either no-op
    jest mocks or a function that itself resolves).
  - Second `await readFile(...)` (post-wait) — wrapped in its own `try/catch`; any failure, ENOENT included,
    → `error`. Cannot escape.
  - `JSON.parse` — wrapped in `try/catch` → `error` on failure. Cannot escape.
  - Nothing downstream of `readJsonStatus` in `inspect()` does further I/O; `toServerMap`/`jsonToConfig` are
    pure and were already confirmed non-throwing in round 0. **No reject path.**
- `CodexTomlMcpFacet.inspect` → `readStatus(workspaceRoot)`:
  - `configPath()` is pure string-joining (`codexHomeConfigFile`/`join`), no I/O, cannot reject.
  - `await readFile(...)` — wrapped in `try/catch`; ENOENT → `missing`, else `error`. Cannot escape.
  - `parseMcpServerTables(read.text)` — confirmed in round 0 to have no `throw`. Cannot escape.
  - **No reject path.**
- Both port and facet JSDoc now state "Must never reject" (`mcp-facet.port.ts:145`); the trace above confirms
  the implementation matches the contract, not just the comment.

### Test realism

`codex-toml-mcp-facet.spec.ts` now mocks both `fs` (`readFileSync`, for legacy `readAll`) and `fs/promises`
(`readFile`, for `inspect`) as separate pass-through jest mocks, each restored in its own `afterEach`
(`:13-16`, `:20-23`, `:57-61`). `denyReadsOf` fails both the sync and async reader for the same path
(`:42-58`), and the EACCES regression test (`:280-295`) asserts `inspect()` → `error` *and* `readAll()`/
`foreignServerKeys()` still empty in the same test — the exact "legacy stays legacy, new path fails closed"
contract this whole batch exists to prove. No cross-file leakage: both mocks are file-scoped to this spec
(Jest's per-file module registry), matching the pattern already verified safe in round 0. All 13 `.inspect(`
call sites in `opencode-mcp-facet.spec.ts` are awaited (`await facet.inspect(...)`,
`await expect(...).resolves.toEqual(...)`, or `await makeFacetWithWait(wait).inspect(...)` before reading
`.status`) — none left as a bare unawaited promise.

### Consumer check

Grepped `\.inspect\(` across `libs/` and `apps/`: the only hits outside `*.spec.ts` are
`config-scope-rpc.handlers.ts:116,149,184`, which call an unrelated `scopeResolver.inspect(...)` (a different
type entirely, not `IHarnessMcpFacet`). No production caller of the facet's `inspect()` exists yet — confirmed,
matching the coordinator's claim — so there is no legacy call site to break by the port's signature change from
sync to async.

### Verdict

| Metric | Value |
| --- | --- |
| Overall score | 9/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 new (all three from round 0/1 resolved; none introduced by the async conversion) |

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none remaining in this batch's own scope. The one item that stays a live cross-batch question
  (not a defect here, already flagged for the Batch 7 reviewer in round 0) is whether a Codex `ok`-and-empty
  read from a genuine torn write can ever feed a policy decision once Codex lanes move past "not enforced" —
  the current code is explicit that it accepts this for PR 1, which is a reasonable, documented trade-off, not
  an oversight.
- Nothing left for the user to decide on this batch; both prior rounds' items are closed with evidence, not
  just executor assertion.

# Code Logic Review — Batch 5

(Heading restored during the re-review round 1 append — it was missing from a prior concurrent-write merge;
the section content below it, from `## Summary` through `## Cross-batch items`, is the original Batch 5
review, unchanged.)

## Summary

| Metric              | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| Overall score         | 6/10                                                     |
| Assessment             | REVISE                                                   |
| Blocking issues        | 0                                                        |
| Serious issues         | 1                                                        |
| Moderate issues        | 2                                                        |
| Failure modes found    | 3                                                        |

Scope reviewed: full contents of `plugin-loader.service.ts` (1699 lines, diff + surrounding context),
`harness-policy-sync.ts` + `.spec.ts`, `di/tokens.ts`, `di/register.ts`, `src/index.ts`, and
`plugin-loader.service.capabilities.spec.ts`. Cross-checked every caller of `resolveCurrentPluginPaths` and
`getDisabledSkillIds` repo-wide via grep, and every one of the 24 batches in `batches.md` for a file that
would rewire those callers. Ran both new spec files directly (`npx jest -c libs/backend/agent-sdk/jest.config.ts
plugin-loader.service.capabilities.spec.ts harness-policy-sync.spec.ts`): 2 suites, 23 tests, all passed —
the executor's uncertainty about whether they ran is resolved, they do. Ran the scoped check
(`lint,typecheck,test -p @ptah-extension/agent-sdk`): exit 0, 1 project, cache-assisted.

## Five logic questions

### 1. How does this fail silently?

The primary one is the declared deviation itself: `resolveCurrentPluginPaths`/`getDisabledSkillIds` stay
synchronous and read only the workspace layer. A caller of either never learns that a global layer exists —
there is no error, no degraded flag, nothing. A user who sets a plugin or skill OFF at the **global** scope
(the feature this task exists to add) gets silence from every synchronous consumer: the plugin/skill stays
visible and invocable exactly as if the toggle had never been written. See Serious-1.

### 2. What user action produces unexpected behaviour?

A user opens the Marketplace (once Batch 13 lands) and switches a plugin or skill OFF at "all workspaces"
(global) scope with no per-workspace override. In this workspace, the vscode-lm-tools code-execution
`searchSkills` harness namespace (`harness-namespace.builder.ts:429-431`) still lists that skill as
`invocable`, because it calls the synchronous `resolveCurrentPluginPaths()`/`getDisabledSkillIds()` with no
`root` and no knowledge that a global item exists. Same for `plugin-config-source-resolver.ts:173,177` feeding
the harness reconciler for every non-Claude-SDK lane (Codex, OpenCode, Antigravity, and the raw `.claude/skills`
directory a Claude CLI process reads off disk): the skill's file copy is never removed. The user sees the
toggle marked ON in the UI's "global" scope, yet the skill keeps running.

### 3. What input data produces a wrong answer?

None found inside this batch's own arithmetic — `layerGlobalItems`, `getEffectivePluginConfig`, and
`saveWorkspacePluginConfig` were checked against every AC-3.2/N3/#8 case in the spec and by hand; see
Verified items below. The wrong answer this batch produces is architectural (callers reading the wrong layer),
not a computation bug inside the layering function itself.

### 4. What happens when a dependency fails?

`getEffectivePluginConfig` throws `CapabilityPolicyUnknownError` when either layer is unreadable — matches
N3, is instanceof both `CapabilityPolicyUnknownError` and `SdkError`, and `isCapabilityPolicyUnknownError`
matches structurally (spec:319-357, confirmed passing). The two synchronous methods degrade to the documented
restrictive answers (`[] ` / all known skill ids) on a WORKSPACE-layer read failure only — they cannot fail on
the global layer because they never read it. This is internally consistent with the file's own N3 doc comments,
but it means a caller of the sync path is fail-closed against a *workspace* config failure and simply blind to
the *global* layer, failure or not.

### 5. What is missing that the requirements never mentioned?

The plan (C3, batches.md:249, implementation-plan.md:249) states flatly: "`resolveCurrentPluginPaths` and
`getDisabledSkillIds` are effective, and restrictive on unknown." Read literally this means BOTH methods
apply the full effective (global + workspace) policy. What batch 5 actually ships is narrower: the methods
stay workspace-only and restrictive on a *workspace* read failure; "effective" is achieved only by
`getEffectivePluginConfig`. The plan text does not call this out as a scoped exception, and no batch in
`batches.md` schedules the follow-up. See Serious-1 for the caller-by-caller trace and Cross-batch items below.

## Failure modes

### Global plugin/skill OFF is silently ignored by every synchronous consumer, indefinitely

- Trigger: a global-scope plugin or skill toggle (the store from Batch 6/7, injected here as
  `SDK_CAPABILITY_GLOBAL_LAYER`) is set to OFF with no workspace-level override for that id.
- Symptom: the skill/plugin stays exposed to a running session through every code path that does not call
  `getEffectivePluginConfig`.
- Evidence: see Serious-1 (full caller trace).
- Current handling: `resolveCurrentPluginPaths`/`getDisabledSkillIds` deliberately read only
  `readWorkspaceLayer` (`plugin-loader.service.ts:1482-1492`, `:1220-1230`); the class-level doc comment at
  `:1216` says as much ("This method is synchronous, so it reads only the workspace layer; the global layer
  is applied by `getEffectivePluginConfig`").
- Recommendation: named in Cross-batch items — either a batch must switch every session-affecting caller to
  the async path, or the plan must explicitly scope "effective, and restrictive on unknown" to only the two
  callers that are actually converted, and batches.md must carry a follow-up task for the rest.

### `plugin-config-source-resolver.ts` gains an unusable optional method this batch does not wire up

- Trigger: Batch 3 (pending) adds `getEffectivePluginConfig` as an optional member of `HarnessPluginConfigReader`
  per its task description ("`HarnessPluginConfigReader` gains optional `getEffectivePluginConfig`",
  batches.md:348).
- Symptom: even after Batch 3 lands, the electron (`apps/ptah-electron/src/di/phase-2-libraries.ts:200-231`)
  and VS Code (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, same pattern) host wiring construct
  their `HarnessPluginConfigReader` object literal by hand, forwarding only `resolveCurrentPluginPaths`,
  `getDisabledSkillIds`, `getWorkspacePluginConfig`. Neither file is in any batch's file list (checked
  batches 1-24), so the new optional method has no host implementation to call through to, and Batch 3's
  policy-unknown detection on this path can only ever see the workspace layer's own read failures — never a
  global-layer failure, and never a global OFF.
- Evidence: `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231` (this file, unmodified by any of the 24
  batches — confirmed by grep across `batches.md`); `plugin-config-source-resolver.ts:44-51` (current
  interface, no `getEffectivePluginConfig` yet, since Batch 3 has not landed).
- Current handling: not yet addressed; Batch 3 is pending and out of this review's file set, but the gap it
  will create is visible now because Batch 5 is the only batch across all 24 that touches
  `PluginLoaderService`, and it does not update either host wrapper.
- Recommendation: flag to the Batch 3 executor/reviewer and to the team-leader as a required addition (see
  Cross-batch items) — the host wrapper files must be added to a batch's file list, or Batch 3's optional
  method is dead code from day one.

### `saveWorkspacePluginConfig` capture-once and A→B race — verified correct, not a failure mode

- Included for completeness per the review brief. Traced `plugin-loader.service.ts:1017-1071` against the
  spec's `createScopedStorage` fixture (`plugin-loader.service.capabilities.spec.ts:399-455`): `storageFor` is
  called exactly once before any read, and the injected fixture flips the active workspace root *inside* the
  first `storage.get` call to simulate the race — the write still lands in A's store, never B's
  (`storeA.raw.get(CONFIG_KEY)` matches, `storeB.raw.get(CONFIG_KEY)` is untouched). No defect found here.

## Blocking issues

None.

## Serious issues

### 1. Global capability layer is unreachable from 8 session/tool-affecting call sites after all planned PR 1 batches land

- File: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1482` (`resolveCurrentPluginPaths`),
  `:1220` (`getDisabledSkillIds`)
- Scenario: a user sets a plugin or skill OFF at global scope (no workspace override). Every one of the
  following callers — traced by grep across the full worktree — reads only the workspace layer:
  1. `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:173,177` — feeds
     `HarnessReconcilerService`, which writes the actual skill/plugin file copies and junctions every non-SDK
     lane (Codex, OpenCode, Antigravity, and a Claude CLI reading `.claude/skills` off disk) loads from.
     **Session-affecting**, and this is the mechanism Batch 1's own review already relied on for the
     `CAPABILITY_ENFORCEMENT` "skills/plugins are enforced via harness sync" claim — that claim is only true
     for the workspace layer.
  2. `apps/ptah-electron/src/di/phase-2-libraries.ts:211,224-227` and the equivalent VS Code
     `phase-2-libraries.ts` wiring — the host-side lambda that supplies #1 with its `PluginLoaderService`
     reference. Same session-affecting path, doubled per host.
  3. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:429-431`
     (`searchSkills`) — builds the skill list exposed **directly inside a running session** through the
     code-execution/harness namespace tool. A globally-disabled skill is still returned as `invocable`.
     **Session-affecting.**
  4. `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts:350,353`
     (`discoverAvailableSkills`) — feeds the harness wizard UI's skill summary. Display-only as far as this
     review traced, but it will show a globally-disabled skill as available, contradicting the Marketplace.
  5. `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:873-874` (`activeSkillOwners`, used by
     `predictCollisions`) — install-time collision prediction only; lower impact but still stale.
  - Every one of the 24 batches in `batches.md` was checked (grep for each file path above): **none of them
    touch any of these five files.** Batch 3 (harness-sync) is the closest, and it only adds an *optional*
    interface member (`getEffectivePluginConfig`) to `HarnessPluginConfigReader` — it does not, per its own
    task text, change what `PluginConfigSourceResolver.resolve()` actually calls for the overlay/disabled-ids
    fields (`resolveCurrentPluginPaths`/`getDisabledSkillIds` stay the two calls at lines 173/177 today), and
    even if it did, the host wrapper (#2) has no batch to teach it about the new method.
- Impact: after PR 1 merges — the point at which the task description says users can toggle capabilities —
  a global OFF is cosmetically applied (the Marketplace UI and `capabilities:getEffective`/`capabilities:getState`
  RPCs, which do go through `getEffectivePluginConfig` via the C4/C8 resolver, will show it OFF) while the
  skill or plugin keeps running in every session built through the harness path and the code-execution tool.
  This is exactly the "widened silently" failure the plan's fail-closed policy (N3) was designed to prevent,
  except here it is not a read failure being widened — it is a **successfully-read, successfully-written
  global OFF that a policy-blind caller never asks about.**
- Fix: this is a cross-batch gap, not something Batch 5 alone can close (Batch 5's own files are internally
  consistent with the plan's C3 loader spec: "resolveCurrentPluginPaths and getDisabledSkillIds are effective,
  and restrictive on unknown" is satisfied only for the "restrictive on unknown" half). Two options for the
  team-leader:
  (a) add a batch (or extend Batch 3/9) that switches every session-affecting caller above to
      `getEffectivePluginConfig`, threading the async call through `PluginConfigSourceResolver.resolve`
      (already synchronous today, would need to become async or pre-fetch) and through
      `harness-namespace.builder.ts`'s already-async `searchSkills`; or
  (b) explicitly scope the plan's C3 claim to "effective" meaning only `getEffectivePluginConfig`, mark the
      five call sites above as a named PR 2 (or PR 1.5) follow-up in `batches.md`, and add a chat/Marketplace
      notice so a global toggle's real reach is not silently overstated to the user before that follow-up
      lands.
  Either way, `batches.md` currently plans neither, and PR 1's own acceptance criteria (AC-3.1, "skill and
  plugin workspace writes" via C4/C8) do not mention global-scope propagation to harness targets at all —
  this is a gap the plan itself should have surfaced under D1 ("global + workspace scopes... Effective =
  workspace ?? global ?? default"), since D1 makes no scope exception for the harness-sync/code-execution
  paths.

## Moderate and minor issues

- `harness-policy-sync.ts:104` (`if (health !== null) this.lastAck.delete(key)`): a `null` health (no pass ran
  — throttled, no preflight registered for the workspace, or a joined pass that itself returned null) leaves
  `lastAck` untouched rather than clearing it. Traced through: since `lastAck.get(key)` is compared against the
  new `fingerprint` on the next call, and a stale `lastAck` value is (by construction) never equal to a changed
  fingerprint, this cannot cause a false acknowledgement — every subsequent call keeps forcing until a real
  pass runs. Verified safe by trace, not by an explicit test case for "null after a fingerprint change,
  followed by a null again" — recommend adding that as a regression test in `harness-policy-sync.spec.ts` since
  the current null-path tests (`:187-197`) only cover the from-empty case, not the from-stale case.
- `plugin-loader.service.ts:1220-1230` (`getDisabledSkillIds`) and `:1482-1492`
  (`resolveCurrentPluginPaths`): the "restrictive on unknown" JSDoc on both methods reads as if it describes
  the full policy (matching the plan's C3 text word-for-word), when it only describes the workspace-layer
  failure case. Recommend tightening the doc comment to state explicitly that a *global*-layer-only OFF is
  invisible here, pointing at `getEffectivePluginConfig`, so a future caller does not assume "restrictive on
  unknown" already covers global-layer awareness (it does not — it covers workspace-read failure only).

## Data flow

1. `getEffectivePluginConfig(root)` — global layer read (optional, awaited) → workspace layer read (sync,
   local) → `layerGlobalItems` merge → fingerprint over `(global fingerprintEntries, stored workspace config)`
   → `overlayPathsFor(config, root)`. OK: single snapshot, verified by the spec's `globalLayer.reads === 1`
   assertion and by inspecting that no `await` sits between the workspace read and the return.
2. `resolveCurrentPluginPaths(root)` / `getDisabledSkillIds(root)` — workspace layer read only, restrictive on
   a workspace-read failure. OK as documented, but see Serious-1: every downstream consumer that treats this
   as "the policy" is wrong once a global item exists.
3. `saveWorkspacePluginConfig(config, root)` — `storageFor(root)` resolved once, one read of the persisted
   config for preserve-on-omit fields, one `update()`. OK, race-tested.
4. `HarnessPolicySync.apply(root, fingerprint)` — force decision from `lastAck` → up to one extra forced pass
   on mismatch/joined → acknowledge only via `isHarnessPassAcknowledged`. OK, matches N4/C5a exactly; the
   `null`-health branch is safe by trace (see Moderate).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `getEffectivePluginConfig` one-snapshot, throws on unreadable layer (N3) | COMPLETE | none |
| Layering: global on/off applies only where workspace records nothing; inherit adds nothing (AC-3.2) | COMPLETE | none |
| Fingerprint includes stored `PluginConfigState` (N4) | COMPLETE | uses `workspace.config` (stored), not the layered result — matches plan intent (global items already contribute their own fingerprint entries) |
| `CapabilityPolicyUnknownError` name/instanceof, restrictive answers on unknown | COMPLETE | none |
| `saveWorkspacePluginConfig(config, root?)` captures storage once (#8) | COMPLETE | none |
| A→B switch test is real (not just naming) | COMPLETE | race actually exercised inside the storage fixture |
| Omitted `enabledSkillIds` preserved | COMPLETE | none |
| `HarnessPolicySync` force rule, at most one extra pass, `lastAck` set only when acknowledged | COMPLETE | none |
| "`resolveCurrentPluginPaths`/`getDisabledSkillIds` are effective, and restrictive on unknown" (plan C3 text, batches.md:249) | PARTIAL | "restrictive on unknown" holds for a workspace-read failure; "effective" (global+workspace) does not hold at all for these two methods — see Serious-1 |

Implicit requirements not addressed: propagation of a global-scope skill/plugin toggle to the harness
reconciler and the code-execution tool's skill list before PR 1 is considered feature-complete (D1's
"workspace ?? global ?? default" applies to the policy as a whole, and the plan text does not carve out an
exception for these paths).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Pre-task config, no global layer injected | YES | `getEffectivePluginConfig`/`getWorkspacePluginConfig` both read back byte-identical (spec:165-186) | none |
| Global OFF, workspace records nothing | YES (async path only) | `getEffectivePluginConfig` disables it (spec:244-266) | sync callers never see it (Serious-1) |
| Global ON, workspace never mentioned the id | YES | spec:268-292, `inherit` correctly adds nothing | none |
| Workspace storage read throws mid-call | YES | `CapabilityPolicyUnknownError`, both layers (spec:319-357) | none |
| A stored denylist present but not an array | YES | treated as unknown, not empty (spec:359-372) | none |
| `HarnessPolicySync`: fingerprint unchanged across calls | YES | second `apply` does not force (spec:98-110) | none |
| `HarnessPolicySync`: joined/older pass | YES | exactly one extra forced pass (spec:112-134) | none |
| `HarnessPolicySync`: write failure | YES | not acknowledged, forces next time (spec:136-152) | none |
| `HarnessPolicySync`: legacy `plugins:save-config` changes fingerprint | YES | forces next `apply` (spec:220-278, uses real `PluginLoaderService`) | none |
| Global-scope toggle reaching a live Claude session's code-execution skill list | NO | not wired this batch, and not scheduled in any of the 24 batches | Serious-1 |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a global plugin/skill OFF — the feature D1 and this task exist to deliver — is silently ignored by
  the harness reconciler and the code-execution skill list after every planned PR 1 batch lands, because no
  batch converts their (five, two of them duplicated per desktop host) callers off the workspace-only
  synchronous methods, and Batch 3's planned `getEffectivePluginConfig` addition to `HarnessPluginConfigReader`
  has no host wiring that will ever call it.
- What a robust implementation would add: either thread the async effective-config path through
  `PluginConfigSourceResolver`/the two host `phase-2-libraries.ts` wrappers/`harness-namespace.builder.ts`
  before PR 1 closes, or explicitly document in `batches.md`/the PR 1 description (as already done for the
  rival-lane and CLI-proxy "not enforced" rows) that global-scope skill/plugin toggles are not-yet-enforced
  outside the Marketplace UI and the RPC surface, with a named follow-up batch.

## Cross-batch items (for the team-leader)

1. **New batch needed (or extend Batch 3/9):** convert `PluginConfigSourceResolver.resolve()`,
   `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`,
   and `harness-namespace.builder.ts`'s `searchSkills` to call `PluginLoaderService.getEffectivePluginConfig`
   (or an equivalent effective-config read) instead of `resolveCurrentPluginPaths`/`getDisabledSkillIds`, so a
   global-scope OFF actually reaches sessions and the code-execution tool. Without this, PR 1's headline
   feature (global toggles) only affects the Marketplace UI and the `capabilities:*` RPCs.
2. **Batch 3 reviewer:** when Batch 3 lands, verify `getEffectivePluginConfig` on `HarnessPluginConfigReader`
   actually has a caller — as planned today it is added to the interface with no host implementation
   forwarding it (item 1) and no call site in `plugin-config-source-resolver.ts` using it.
3. **Batch 9/17 reviewer:** re-check whether `harness-workspace-context.service.ts` and `plugin-rpc.handlers.ts`
   (lower-impact, UI/collision-prediction only) should also move to the effective-config path for consistency,
   even if not strictly session-affecting.
4. **Documentation:** if item 1 is deferred to PR 2, `implementation-plan.md`'s C3 text ("resolveCurrentPluginPaths
   and getDisabledSkillIds are effective") should be corrected now to avoid a future reviewer assuming Batch 5
   already delivers full effective-policy propagation.

## Re-review round 1 — Batch 5

Re-read the amended `batches.md` P9 section (lines 33-70, the global-layer caller assignment table) and its
downstream effects on B3/B25/B26/R11/R12, and re-read the diff to `plugin-loader.service.ts` (JSDoc only) and
`harness-policy-sync.spec.ts` (two new tests). Batch 5's own production code is unchanged, as expected.

**(a) Caller-table coverage.** Every caller named in my Serious-1 trace has a row:
- `plugin-config-source-resolver.ts:169-177` → **G1** (my #1), assigned to B3, already owned.
- `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231` → **G2** (my #2), assigned to B3.
- `harness-namespace.builder.ts:429-431` (`searchSkills`) → **G3** (my #3), assigned to new B25.
- `harness-workspace-context.service.ts:350,353` (`discoverAvailableSkills`) → **G5** (my #4), assigned to new
  B26 (PR 2) — matches my own classification of this caller as "display-only as far as this review traced."
- `plugin-rpc.handlers.ts:873-874` (`activeSkillOwners`) → **G6** (my #5), assigned to B26 (PR 2) — matches my
  classification as "install-time collision prediction only; lower impact."
- One gap on my side, not the table's: I did not separately name
  `ptah-api-builder.service.ts:242-255,668-683` (`PluginLoaderLike`, `getPluginPaths`) in Serious-1, even
  though it appeared in my own grep evidence as a third `resolveCurrentPluginPaths`/`getDisabledSkillIds`
  implementer in `vscode-lm-tools`. The team's **G4** catches it and correctly ties it to the same B25 as G3
  (it is the interface `searchSkills`'s host flows through, and it also feeds the plugin paths handed to
  spawned agents — session-affecting). This is a completion of my trace, not a hole in the table.
- I additionally verified `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:173-178` and
  `libs/backend/cli-engine/src/lib/container.ts:645-650` directly (read both files): both pass
  `container.resolve<HarnessPluginConfigReader>(SDK_TOKENS.SDK_PLUGIN_LOADER)` — the live `PluginLoaderService`
  instance itself, unwrapped — into `createPluginConfigSourceResolver`. Since `PluginLoaderService` already
  carries `getEffectivePluginConfig` (this batch), G2b's "no change needed" is correct: once G1's `resolve()`
  calls `reader.getEffectivePluginConfig` when present, these two hosts pick it up automatically with no
  wrapper to update. No caller I traced is missing from the table.

**(b) G7 reasoning.** Read `plugin-rpc.handlers.ts:248-276` (`plugins:get-config`) and `:290-342`
(`plugins:save-config`) directly: `get-config` returns the raw `getWorkspacePluginConfig()` (not even the
restrictive layer), and `save-config` reads the existing workspace config only to preserve an omitted
`disabledSkillIds`, then writes exactly the caller's workspace-scoped fields back. Neither reads or writes
anything layered. G7's claim — that having these read-modify-write it through the effective (layered) config
would bake a global item into an explicit workspace entry and break `workspace ?? global ?? default`
inheritance (D1) — is correct: a save is a full workspace-config replace, so any layered field present in what
it read would become a persisted workspace override the moment it was written back, permanently shadowing
future global changes for that id. Keeping G7 workspace-only is the right call, not a missed spot.

**(c) New tests.** Ran both spec files directly again:
`npx jest -c libs/backend/agent-sdk/jest.config.ts plugin-loader.service.capabilities.spec.ts
harness-policy-sync.spec.ts` → 2 suites, **25/25** passed (was 23/25 before this round; the 2 new
`harness-policy-sync.spec.ts` tests are additive). Read both new tests:
- `harness-policy-sync.spec.ts:199-231` ("null after a fingerprint change keeps forcing..."): fp-1 acknowledged,
  then two `null` passes for the new fp-2 while a stale `lastAck=fp-1` sits underneath, both correctly
  unacknowledged and both `{force: true}`, until the fourth call's real pass acknowledges fp-2. This is exactly
  the "forces every call until acknowledged" case I asked for, and the assertion on `preflight.calls` pins
  `force: true` on all four calls, not just the outcome.
- `harness-policy-sync.spec.ts:233-255` ("null on an unchanged, acknowledged policy..."): fp-1 acknowledged
  (`force:true`), a `null` pass for the same fp-1 (`force:false`, correctly unacknowledged since no pass ran),
  then a third call for the same fp-1 is still `force:false` — pinning that `lastAck` was NOT cleared by the
  `null`, matching my traced conclusion that this branch is safe because a stale-but-unchanged `lastAck` cannot
  produce a false acknowledgement.
- Both tests match the two scenarios named in my Moderate note ("null after a policy change followed by null
  again" and "null on an unchanged policy") precisely, and both pass.

Ran the scoped check again: `lint,typecheck,test -p @ptah-extension/agent-sdk` — exit 0, 1 project (2 tasks
cache-hit, typecheck fresh), confirming the JSDoc-only production diff introduced no regression.

**Verdict: APPROVE.** The Serious-1 cross-batch gap is now owned end-to-end (B3 for the two widening,
session-affecting callers already in the reconciler path; new B25 for the two vscode-lm-tools session/tool
callers; new B26 for the two display-only callers; G7 correctly left alone with sound reasoning; G8-G10
documented as non-widening or dead). Nothing in Batch 5's own files needed to change to close this, and
nothing did — the JSDoc clarification and the two `HarnessPolicySync` regression tests are the only diff, both
correct and both verified by direct test run. No new defect found in this round. Batch 5 is accepted.

# Code Logic Review — Batch 6

Scope: `libs/backend/cli-agent-runtime/src/lib/capabilities/{capability-toggle-store.ts,
capability-toggle-store.spec.ts, claude-approval.reader.ts, claude-approval.reader.spec.ts}` in the
`feat-task-2026-560-b6-toggle-store` worktree (base `cac3db9e2`), against implementation-plan.md C2
(:166-241), Resolution rules → Import (:101-110), C4 `ClaudeApprovalReader` (:283-284), the fail-closed
policy (:112-137), and batches.md Batch 6's mandatory reviewer acceptance items (D1, D2).

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment           | APPROVE                              |
| Blocking issues     | 0                                     |
| Serious issues      | 0                                     |
| Moderate issues     | 1                                     |
| Failure modes found | 2 (both documented/intended, not defects) |

## Mandatory D1/D2 ruling (batches.md Batch 6)

| Item | Ruling | Proving test |
| --- | --- | --- |
| D1: `imported.json` is one file per workspace, published once by `atomicWriteWithRetry`, existence is the marker | RESOLVED | `capability-toggle-store.spec.ts:433` `'publishes once; its existence is the marker'` |
| D1: a crash leaving only `.tmp` → re-import | RESOLVED | `capability-toggle-store.spec.ts:448` `'re-imports when a crash left nothing at all, before the first byte (D1 #5)'` and `:463` `'re-imports when a crash left only a .tmp'` |
| D1: a corrupt `imported.json` → `error` → unverified, never absent | RESOLVED | `capability-toggle-store.spec.ts:478-511` `it.each` `'reads a %s imported.json as an error, never absent, and does not overwrite it'` (0-byte, invalid JSON, schema-failing, non-MCP keys) |
| D1: the `inherit` tombstone skips the imported layer, so a clear written before, during or after an import stays cleared | RESOLVED (before/after proven; "during" has no separately observable state — `publishImport` is one atomic rename, so there is no partial-import instant to test) | `capability-toggle-store.spec.ts:611` `'keeps a clear (inherit tombstone) written before an import cleared'`, `:625` `'...written after an import cleared'` |
| D1: an imported OFF over an inherited ON stays OFF | RESOLVED | `capability-toggle-store.spec.ts:600` `'keeps an imported OFF under an inherited global ON as OFF'` |
| D1: two concurrent `publishImport` calls → one complete file, never a mix | RESOLVED | `capability-toggle-store.spec.ts:521` `'resolves two concurrent publishImport calls to exactly one complete, schema-valid file (D1 #8)'` |
| D2: the reader recomputes `canonicalFilename(kind, id)` from the content and rejects a mismatch (→ `error`) | RESOLVED | `capability-toggle-store.spec.ts:304` `'reports a file whose content names a different item as an error'` |
| D2: the collision pair `"x".repeat(121)` vs `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` map to different files | RESOLVED | `capability-toggle-store.spec.ts:268` `'maps the fixed collision pair to two different files'` |
| D2: toggling or clearing one member of the pair leaves the other byte-identical | RESOLVED | `capability-toggle-store.spec.ts:289` `'leaves one member of the pair byte-identical when the other is toggled or cleared'` |

## Five logic questions

### 1. How does this fail silently?

No silent-success-on-failure path was found. Every store write either succeeds or throws
`CapabilityToggleStoreError` (`capability-toggle-store.ts:428-440`), and every store read either returns
`status: 'ok'`/`'absent'` for a legitimately empty state or `status: 'error'` naming the path
(`:348-385`, `:201-221`). `ClaudeApprovalReader.read` never throws but distinguishes `absent` (nothing to
report) from `error` (published nothing, `claude-approval.reader.ts:143-172`), so a caller cannot mistake
"couldn't check" for "nothing there." The one place that intentionally converts a failure into a
non-error is `readItemFile`'s `ENOENT` between `readdir` and the read (`:504-512`, `status: 'deleted'` →
silently skipped in `readItemLayer`, `:372`) — this is documented as "no explicit decision" and is the
correct fail-open-to-default behaviour for a file a user removed by hand; it is not a defect because it
cannot widen a policy (a deleted explicit item just falls through to imported/global/default).

### 2. What user action produces unexpected behaviour?

Two browser tabs (or two RPC calls) toggling the *same* item at nearly the same instant: both writes are
independent `atomicWriteWithRetry` renames, so the file ends up as whichever wrote last, and the loser's
click is silently overwritten with no error surfaced to that caller's UI (`capability-toggle-store.ts:19-21`
documents this as accepted last-writer-wins). This is exactly what the plan specifies ("Same-item
concurrent writes are last-writer-wins", implementation-plan.md:193) and cannot turn an OFF into an ON
that the user never chose, so it is not scored as a defect, only flagged because it is genuinely
observable user-facing behaviour (a toggle you just clicked can silently revert to what someone/something
else set a moment earlier).

### 3. What input data produces a wrong answer?

A hand-edited or synced-tool-duplicated file whose content is well-formed JSON matching the schema but
whose *id* differs from what its file name encodes is caught (`readItemFile:519-529`), so this path is
covered. No input was found that makes the store return a *wrong* (as opposed to correctly-erroring)
answer: percent-encoding in `encodeCapabilityId` escapes `%` itself, so no two distinct ids can produce
the same literal token (verified structurally; the injectivity proof itself is Batch 1 scope, not
re-litigated here).

### 4. What happens when a dependency fails?

`atomicWriteWithRetry` (harness-sync) failing (EACCES, a rename failure) is caught and rethrown as
`CapabilityToggleStoreError` naming the path, with the prior file left byte-identical — proven by
`capability-toggle-store.spec.ts:400-423`. `fsPromises.readdir`/`readFile` failing for a reason other than
`ENOENT` is fail-closed to `status: 'error'` (`:348-359`, `:206-212`). `git` failing (timeout, unexpected
exit code, spawn error, missing binary) is exhaustively handled in `gitRunResult` and
`gitTrustsSettingsLocal` (`claude-approval.reader.ts:106-123`, `:237-268`) with every branch tested.

### 5. What is missing that the requirements never mentioned?

- `recordWorkspaceRoot` (`capability-toggle-store.ts:301-315`) calls `this.atomicWrite`, which throws on
  failure; the method itself has no try/catch, so a failed diagnostics-only write becomes an unhandled
  rejection for whatever calls it. The plan calls `root.json` "diagnostics only", implying its failure
  should never block a toggle — but that contract is not enforced in this file and is not exercised by
  this batch's spec (the one test only proves idempotence on success, `:638-651`). This is a Batch 7
  integration concern (the resolver decides whether to await/swallow it), flagged here so the Batch 7
  reviewer checks the call site actually treats a `recordWorkspaceRoot` failure as non-fatal.
- `reportedIgnoredNames` (`capability-toggle-store.ts:172`) is a `Set` that only grows for the lifetime of
  one `CapabilityToggleStore` instance and is never pruned when a stray file is later removed. Given how
  rare junk file names are expected to be (sync-tool conflict copies, stranded `.tmp`s), this is a
  negligible, not a practical, memory concern — noted for completeness against the "cost that grows with
  the session" hunt-list item, not scored as a defect.

## Failure modes

### Same-item last-writer-wins (documented, not a defect)

- Trigger: two processes/tabs write the same `(kind, id)` toggle concurrently.
- Symptom: one caller's write is silently overwritten by the other's rename.
- Evidence: `capability-toggle-store.ts:19-21` (design note), implementation-plan.md:193.
- Current handling: both writes succeed from the caller's point of view; no conflict is reported.
- Recommendation: none — this is the explicit, user-approved trade-off that replaced the C2a lock design
  (implementation-plan.md:63-69). No action needed in this batch.

### `publishImport` check-then-rename race (documented, not a defect)

- Trigger: two `resolve()` calls in different processes race `ensureImported` for the same workspace before
  either has published.
- Symptom: both `exists(path)` checks can observe "absent," both proceed to `atomicWrite`, and the later
  rename replaces the earlier one — never a byte-mixed file, because each writer renames one complete
  document.
- Evidence: `capability-toggle-store.ts:273-295`; proven safe by
  `capability-toggle-store.spec.ts:521-545`.
- Current handling: this is exactly the plan's stated policy ("both publish complete files by rename, and
  the last rename wins... No order-independence is claimed", implementation-plan.md:207-210). It satisfies
  the D1 mandatory item ("one complete file, never a mix") as ruled above.
- Recommendation: none. (Checked specifically because the task brief asked whether this could produce two
  complete documents with last-wins semantics — it can, and that is the designed and tested behaviour, not
  a defect.)

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### 1. The 200-interleaved-write test is timing-sensitive under system load (Moderate)

- File: `capability-toggle-store.spec.ts:565` (`'lands 200 interleaved writes from two instances on
  different items, all present (D2 #4)'`).
- The test performs 200 real `atomicWriteWithRetry` calls (mkdir + writeFileSync + renameSync, each
  through `withWindowsRetrySync`) across two store instances, with no `jest.setTimeout` override, so it
  runs under Jest's project-default 5000 ms per-test timeout (`libs/backend/cli-agent-runtime/jest.config.ts`
  has no `testTimeout`). Reproduced once during this review: running
  `nx test @ptah-extension/cli-agent-runtime --testPathPattern=capabilities` (all 66 suites, more CPU
  contention than the scoped Batch 6 check command) failed this specific test with a Jest "exceeded timeout
  of 5000 ms... if this is a long-running test" error. Two immediately-following runs of the actual Batch 6
  check command (`nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime`, with and without
  `--skip-nx-cache`) both passed, and the isolated single-file run also passed comfortably. This is a
  reproducible-under-load flake, not a logic defect — the assertions themselves are correct once the
  writes complete — but it is precisely the "no timing flakiness in the 200-write... test" item the task
  brief asked to check, and on a busier CI runner or a Windows box with antivirus scanning renames this
  could intermittently fail the batch's own check command.
- Fix: give this one test (or the whole `describe('concurrent writers, no lock')` block) an explicit longer
  `jest.setTimeout`/third-arg timeout (e.g. 15000–20000 ms) so real disk I/O for 200 writes has headroom
  under load, without weakening what it proves.

### 2. `recordWorkspaceRoot` failure path is unexercised (Minor)

- File: `capability-toggle-store.ts:301-315`.
- See Q5 above. No behavioural defect in this batch; flagged for the Batch 7 reviewer to confirm the
  resolver does not let a `root.json` write failure abort a toggle.

### 3. `reportedIgnoredNames` grows unbounded per store instance (Minor)

- File: `capability-toggle-store.ts:172`, `:481-487`.
- Negligible in practice (junk file names are rare); noted for completeness only.

## Data flow

1. UI/RPC calls `writeWorkspace`/`writeGlobal`/`setExplicit` → OK, validated by `explicitItemSchema.safeParse`
   before any I/O (`:394-408`).
2. `canonicalFilename(kind, id)` computed from validated content → OK; a lone-surrogate id throws before any
   write is attempted (`:410-420`).
3. `atomicWriteWithRetry(path, json)` → OK; single rename, no RMW, failure rethrown with the path
   (`:428-440`).
4. Read path: fresh `readdir` → per-file `readFile` + schema parse + filename/content cross-check → OK; any
   single bad file fails the *whole* layer closed (`:383`), which matches the fail-closed policy (an
   unreadable item must not silently vanish and widen the effective set).
5. `publishImport`: schema-validate the whole document → `exists()` marker check → one `atomicWrite` → OK;
   documented and tested last-rename-wins under concurrency (see Failure modes above).
6. `ClaudeApprovalReader.read`: `~/.claude.json` project-key fold → OK; `.claude/settings.local.json` gated
   by `git rev-parse` → `ls-files` (tracked check) → `check-ignore` (ignored check), each step short-
   circuiting to "not trusted" or "error" per the outcome table → OK; caller (Batch 7, out of scope here)
   receives `{status, approvals}` and never a thrown exception.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| One `atomicWriteWithRetry` per write; no lock; no read-modify-write; no delete | COMPLETE | none |
| `clear` writes the `inherit` tombstone, not a delete | COMPLETE | proven `capability-toggle-store.spec.ts:199-208` |
| `setExplicit` writes a concrete `on` with `source: 'install'` even when it equals the inherited value | COMPLETE | proven `:210-213` |
| Reads fail closed on 0-byte/invalid JSON/schema failure/filename-content mismatch/unreadable dir | COMPLETE | proven `:337-397` |
| `ENOENT` → empty; junk names ignored and logged once | COMPLETE | proven `:162-173`, `:377-396` |
| `publishImport` never overwrites an existing or corrupt `imported.json` | COMPLETE | proven `:433-446`, `:478-511` |
| `capabilityPolicyKey` lowercases on win32 only (N7) | COMPLETE | proven `:144-158` |
| `root.json` written once, diagnostics-only | COMPLETE (write side); failure-handling contract unenforced | see Moderate/Minor #2 |
| `ClaudeApprovalReader` reads only the two trusted sources, never committed `settings.json` | COMPLETE | code has no reference to `settings.json` anywhere; verified by reading the full file |
| git via argument array, no shell, 2 s timeout | COMPLETE | `claude-approval.reader.ts:85-104`, `CLAUDE_APPROVAL_GIT_TIMEOUT_MS` tested `:326-328` |
| Missing git binary → file not trusted, status `ok` | COMPLETE | proven `claude-approval.reader.spec.ts:249-260` |
| Tests deterministic, temp dirs only, never real `~/.ptah`/`~/.claude.json` | PARTIAL | both specs correctly use `mkdtempSync`/`homeDir` overrides throughout (no gap there); the 200-write test is timing-sensitive under load — see Moderate #1 |

Implicit requirements not addressed: none found beyond the two Minor notes above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Root starting with `-`/containing spaces or quotes passed to git | YES | `execFile` with an argument array (`claude-approval.reader.ts:90-103`); `-C` consumes the very next argv entry verbatim regardless of leading `-`, and there is no shell to reinterpret it | none — no injection surface exists structurally; not separately unit-tested but the mechanism makes a test largely redundant |
| Concurrent `publishImport` on the same workspace | YES | last-rename-wins, proven one complete file | none (by design) |
| Concurrent writes to the *same* explicit item | YES (by design) | last-rename-wins | user-visible "my click silently lost" possibility — see failure modes |
| 200 concurrent writes to *distinct* items under system load | YES, but timing-sensitive | real fs I/O within the default 5 s test timeout | see Moderate #1 |
| `.claude.json` present but git missing, `.settings.local.json` also present | YES (by code logic) | `settings.local` source resolves to `absent`, `claude-project` source still contributes | not directly tested with both sources present simultaneously; Minor coverage gap, not a logic gap (traced above) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the 200-interleaved-write spec can time out under CI/system load with no timeout headroom,
  which could make an otherwise-correct batch look like a regression in a busy run.
- What a robust implementation would add: an explicit longer timeout on the concurrency-heavy specs, and a
  `recordWorkspaceRoot` contract note (or an actual swallow-and-log) so a Batch 7 caller cannot accidentally
  let a diagnostics-only write failure fail a toggle.

---

# Code Logic Review — Batch 2

## Summary

| Metric              | Value    |
| -------------------- | ------- |
| Overall score        | 9/10    |
| Assessment            | APPROVE |
| Blocking issues       | 0       |
| Serious issues        | 0       |
| Moderate issues       | 1       |
| Failure modes found   | 1       |

## Scope reviewed

`git diff d003642a9` (base of the b2 worktree) plus the one untracked file, against
`implementation-plan.md` C1 (`rpc.types.ts:156`) and C8 (`:360-366`), and `batches.md` Batch 2:

- C `libs/shared/src/lib/types/rpc/rpc-capability.types.ts`
- M `libs/shared/src/lib/types/rpc.types.ts`
- M `libs/shared/src/lib/types/messages/session-mcp-status.ts` (+ `.spec.ts`, an unplanned but in-scope pair)
- M `libs/backend/vscode-core/src/messaging/rpc-handler.ts`

This batch is pure contract: three new RPC method signatures, a notice-code union member, and one allowlist
prefix. There is no handler implementation to trace a data path through yet (that is B10), so the review is
necessarily about whether the contract is internally consistent, matches what B10/B11/B13 will consume, and
whether the parser/allowlist changes are safe on their own.

## Five logic questions

### 1. How does this fail silently?

Not within this batch's own code — the notice parser (`session-mcp-status.ts:150-152`) intentionally drops an
*unknown* code while keeping the rest of the payload, which is the documented, tested behaviour, not a new
silent failure. The one adjacent silent-failure risk is external to this batch's diff: `schemas.ts:238-258`
(`SessionMcpStatusPayloadSchema`, the backend Zod boundary schema) still has `code: z.literal('claude-ai-connectors-disabled')`
and is `.strict()`. If a future caller feeds a `capability-policy-unverified` notice through that schema (e.g.
`.safeParse` at a backend emit boundary), the array item fails validation, and because Zod validates each array
element and the containing object is `.strict()`, a `.parse()` call would throw and a `.safeParse()` would
return `{success: false}` for the *whole payload* — not just drop the one notice the way the hand-written parser
does. That is worse than "drop the notice": it would drop the server list too. See Moderate #1.

### 2. What user action produces unexpected behaviour?

None from this batch directly — there is no UI or handler wired to these types yet. The batch's job is to make
sure a *future* action (toggling a capability, or a session emitting the new notice) has a contract to land on.
Traced against B10/B11/B13's stated needs (`batches.md:352-358, 363-366`): `CapabilitiesSetEnabledParams` carries
`scope`, `kind`, `id`, `enabled`, `explicit?` exactly as the plan's C8 handoff expects, and the doc comment at
`rpc-capability.types.ts:83-86` states the global-scope rejection rule B10 must implement — this is the only
place that rule is written down pre-B10, and it reads clearly enough for B10 to act on without re-deriving it.

### 3. What input data produces a wrong answer?

Not applicable to this batch — no runtime logic exists here beyond the notice parser, which was already
reviewed for correctness in question 1. The type-level "input" is the RPC registry entry; `RPC_METHOD_ENTRIES`
and `RpcMethodRegistry` are kept in sync by the compile-time `_AssertAllRpcMethodsListed` check
(`rpc.types.ts:3908-3919`), which is exercised by the typecheck that passed.

### 4. What happens when a dependency fails?

N/A — this batch adds no code that calls a dependency. The one relevant "dependency" is the not-yet-existing
`CapabilityRpcHandlers` (B10) reading `CapabilitiesSetEnabledParams.explicit` for `scope: 'global'`; the contract
documents the required rejection but cannot enforce it structurally (nothing here stops a caller from setting
`explicit: true` with `scope: 'global'` at the type level — TypeScript allows the combination since `explicit` is
a plain optional boolean unconstrained by `scope`). This is fine given the plan explicitly assigns the runtime
rejection to the B10 handler, but it means a caller mistake is a runtime error, not a compile error — worth
flagging as a residual gap for B10, not a defect in this batch.

### 5. What is missing that the requirements never mentioned?

- The `capabilities:` allowlist prefix (`rpc-handler.ts:74`) is added with no handlers registered yet, so no
  method under that prefix can currently be dispatched — this is the expected, documented state for a contract
  batch (B10 registers the handlers), not a gap.
  Note the "391 vs 388" `rpc-surface.spec.ts` count mismatch is listed by the requester as a known, expected
  failure until B11; I did not re-verify that count myself since it falls outside this batch's check command
  (shared + vscode-core), but the vscode-core `lint,typecheck,test` all passed cleanly, so the allowlist edit
  itself introduces no regression in this batch's own project.
- No requirement is silently narrowed: `schemaTokens?` (AC-5.1/5.2) is present on `CapabilityEntry` already
  (inherited from B1, not re-declared here) and `CapabilitiesGetStateResult = CapabilityInventory` carries it
  through unchanged.

## Failure modes

### Stale Zod literal on the notice-code union (pre-existing, not from this diff)

- Trigger: any future code path that validates an outgoing `session:mcpStatus` payload containing a
  `capability-policy-unverified` notice through `SessionMcpStatusPayloadSchema`.
- Symptom: the whole payload fails Zod validation (not just the one notice), so a caller using `.parse()` throws
  and one using `.safeParse()` silently produces no emission — the server list is lost along with the notice.
- Evidence: `libs/shared/src/lib/types/messages/schemas.ts:252` (`z.literal('claude-ai-connectors-disabled')`,
  `.strict()` object, `.strict()` root) vs. `session-mcp-status.ts:70-72` (`SessionMcpNoticeCode` now has two
  members).
- Current handling: confirmed by search — no producer or backend boundary currently imports or calls
  `SessionMcpStatusPayloadSchema` (`grep -rn "SessionMcpStatusPayloadSchema"` across `libs`/`apps` returns only
  its own declaration comment and the schemas file itself). So today this is dormant: nothing on any runtime
  path validates a `capability-policy-unverified` notice with this schema, and the batch's own test
  (`session-mcp-status.spec.ts:57-71`) exercises only the hand-written parser, which is correct and unaffected.
- Recommendation: this is out of scope for Batch 2 (it was already flagged as a known, pre-existing gap by the
  requester), and I confirm the "out-of-scope" framing is accurate — no runtime path uses the stale schema yet.
  It should still be tracked so whichever future batch wires a backend emit-side validation for
  `session:mcpStatus` updates the literal to match the union, or the new notice will vanish along with its
  server list at that point.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. (Moderate, informational — not this batch's defect) `libs/shared/src/lib/types/messages/schemas.ts:252` —
   `SessionMcpStatusPayloadSchema`'s `code: z.literal('claude-ai-connectors-disabled')` was not updated for the
   new `capability-policy-unverified` member. Confirmed dormant today (see Failure modes above); tracked so it
   is not forgotten when a backend validation path is added.
2. (Minor) `rpc-capability.types.ts:68-71` — `CapabilitiesSetEnabledParams` cannot structurally prevent
   `explicit: true` with `scope: 'global'`; the rejection is enforced only at runtime by B10's handler per the
   doc comment. A discriminated union (`{scope: 'workspace'; explicit?: boolean} | {scope: 'global'}`) would make
   the illegal combination unrepresentable, but that is a larger contract change than this batch's remit and the
   plan already assigns runtime enforcement to B10 — noting it for B10's awareness, not asking for a redo here.

## Data flow

1. `capabilities:setEnabled` params constructed by the (future) Marketplace UI → `CapabilitiesSetEnabledParams`
   (OK — shape matches `CapabilitySetRequest` minus `cwd`, plus `explicit`).
2. Dispatched over RPC → `rpc-handler.ts` allowlist check on `capabilities:` prefix (OK — added, passes
   `vscode-core` typecheck/lint/test).
3. `RpcMethodRegistry['capabilities:setEnabled']` resolves `params`/`result` types → `RPC_METHOD_ENTRIES` and
   `RPC_METHOD_NAMES` both updated (OK — compile-time `_AssertAllRpcMethodsListed` guard passed).
4. (Not yet wired) handler resolves root via `canonicalPolicyRoot`, rejects `explicit` for `scope: 'global'` —
   documented here, enforced in B10 (gap noted above, expected).
5. `session:mcpStatus` emission with a `capability-policy-unverified` notice → webview
   `parseSessionMcpStatusPayload` (OK — new code accepted, old code still accepted, unknown codes still dropped
   individually) vs. backend `SessionMcpStatusPayloadSchema` (dormant landmine, not exercised today — see
   Failure modes).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `capabilities:getState`/`getEffective`/`setEnabled` added to `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` | COMPLETE | none |
| No `root`/`cwd` in any of the three params (handler derives canonical root) | COMPLETE | `CapabilitiesGetStateParams`/`GetEffectiveParams` are `Record<string, never>`; `SetEnabledParams` omits `cwd` via `Omit<CapabilitySetRequest, 'cwd'>` |
| `setEnabled` params carry `scope`/`kind`/`id`/`enabled`/`explicit` | COMPLETE | matches plan C8 and B10's stated needs |
| `explicit` rejected for `scope: 'global'` documented where B10 will see it | COMPLETE | doc comment at `rpc-capability.types.ts:83-86`, on the field B10 implements against |
| `'capability-policy-unverified'` added to `SessionMcpNoticeCode` and accepted by the parser | COMPLETE | `NOTICE_CODE_SET` is a `Record<SessionMcpNoticeCode, true>`, so a future union member without a key is a compile error — old code still parses |
| `capabilities:` allowlist prefix added, minimal | COMPLETE | one line, correctly scoped, no handlers registered yet (expected) |
| Backend Zod schema (`schemas.ts:252`) kept in sync with the notice union | MISSING (pre-existing, out of scope per requester) | dormant today; see Failure modes |

Implicit requirements not addressed: none found beyond the tracked, dormant Zod-schema drift.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Old `claude-ai-connectors-disabled` notice still parses after the union grew | YES | `session-mcp-status.spec.ts` existing case + `NOTICE_CODE_SET` includes it | none |
| New `capability-policy-unverified` notice parses via the hand-written webview parser | YES | new spec case `:57-71`, asserts round-trip equality | none |
| A third, still-unknown notice code | YES | dropped individually, servers kept — unchanged prior behaviour | none |
| `capability-policy-unverified` validated via the backend Zod schema | NO | schema literal not updated | dormant; see Failure modes/Moderate #1 |
| `capabilities:setEnabled` with `scope: 'global', explicit: true` | NOT YET (by design) | type allows it; rejection deferred to B10's handler | tracked as Minor #2 for B10 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the dormant `schemas.ts:252` literal drift — harmless today because nothing calls that schema, but
  a real "notice silently vanishes with its server list" defect the day a backend emit-path validation is added
  without updating it.
- What a robust implementation would add: update the Zod literal to a union (or generate it from
  `SessionMcpNoticeCode` the way `NOTICE_CODE_SET` does) in whichever future batch first wires backend-side
  validation for `session:mcpStatus`, and consider a discriminated union on `CapabilitiesSetEnabledParams` so
  `explicit`+`global` is unrepresentable rather than runtime-rejected.

# Code Logic Review — Batch 8

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 3 |

## Scope examined

Full-file reads and `git diff` of all 8 uncommitted files under
`libs/backend/agent-sdk/src/lib/helpers/`: `sdk-query-options-builder.ts` (+ new
`.capabilities.spec.ts`), `sdk-query-runner.service.ts` (+ spec), `sdk-model-service.ts` (+ spec),
`session-lifecycle/session-query-executor.service.ts` (+ `.harness-preflight.spec.ts`), and the two
unplanned files `session-lifecycle-manager.ts` and `sdk-query-options-builder.output-style.spec.ts`.
Also read: `batches.md` Batch 8 (incl. P9 reviewer acceptance items), `implementation-plan.md` C5
(~319-346) and Fail-closed policy (~112-130), and traced DI registration order in
`libs/backend/agent-sdk/src/lib/di/register.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`,
`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/container.ts`.
Ran `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p
@ptah-extension/agent-sdk --parallel=2` myself: lint, typecheck and test all pass (1 project, no
failures).

## Five logic questions

### 1. How does this fail silently?

Nothing found that reports success while quietly widening access — the design is deliberately
fail-closed and every unverified/throwing path degrades to strict MCP + `skills: []` (verified by
`sdk-query-options-builder.capabilities.spec.ts:332-420`,
`sdk-query-runner.service.spec.ts:380-495`, `session-query-executor.harness-preflight.spec.ts:232-278`).
The one soft spot: `SessionQueryExecutor.syncHarnessToPolicy`
(`session-query-executor.service.ts:610-625`) logs a swallowed `HarnessPolicySync.apply` throw and an
unacknowledged pass, then lets the session continue exactly as if the harness were in sync — this is
the documented design (`skillOverrides` already denies skills natively), not a bug, but it means a
persistently-broken harness writer produces no user-visible signal beyond an `IOutputChannel` log line
that nobody is required to read. Not scored as a defect because the plan explicitly calls this
non-fatal (C5a).

### 2. What user action produces unexpected behaviour?

A user who explicitly approves a remote MCP server through the chat UI or the Ptah CLI proxy's
`X-Ptah-Mcp-Servers` header (`mcpServersOverride`, e.g. an OAuth or Smithery server) sees that server
silently vanish from the session the moment the capability policy is unverified — not because the
server was ever put through `capabilities:setEnabled`, but because `filterMcpServersByPolicy`
(`sdk-query-options-builder.ts:1178-1198`) drops every non-ptah entry when
`policy.status !== 'verified'`. This matches the plan's stated fail-closed behaviour (§Fail-closed
policy, "strictMcpConfig: true with ptah only") and is proven by the spec at
`sdk-query-options-builder.capabilities.spec.ts:347-360` ("runs strict MCP with ptah only and skills:
[]" using an `other` override). It is "unexpected" only in the sense that the user did nothing wrong —
their own store, not the override, is what became unreadable — and the only user-facing signal is the
`capability-policy-unverified` chat chip notice, which names the unreadable path but not which servers
were dropped.

### 3. What input data produces a wrong answer?

None found in the reviewed files that produces a wrong (rather than a maximally-restrictive) answer.
`capabilityFlagsFor` and `filterMcpServersByPolicy` are pure functions over the resolved
`EffectiveCapabilitySet`; every branch that could misclassify a server (duplicate names, ptah appearing
in a caller's `deniedMcpServers`, back-off overlapping an approval) is deduplicated with `Set`/
`uniqueNames` and covered by a named spec case (`sdk-query-options-builder.capabilities.spec.ts:430-436`,
`:260-268`).

### 4. What happens when a dependency fails?

- `ICapabilityResolver.resolve` throws or is unregistered → `resolveSessionCapabilityPolicy`
  (`sdk-query-options-builder.ts:558-584`) catches and returns `unverifiedCapabilityPolicy`, logging
  through the injected logger. Covered for the executor, the runner and the builder's own fallback path.
- `HarnessPolicySync.apply` throws or returns `acknowledged: false` →
  `session-query-executor.service.ts:596-625` swallows it, logs, and the session continues (see Q1).
- The SDK module itself failing to load is unaffected by this batch (unchanged upstream code path).

### 5. What is missing that the requirements never mentioned?

- No metric/telemetry counts how often sessions run unverified in production, so a systemic problem
  (e.g. a corrupt global store affecting every workspace) would only be visible by reading logs one
  session at a time. The plan does not ask for this, but Batch 8 is exactly where the signal originates.
- Nothing in this batch's specs exercises the real DI container end-to-end (host wiring is asserted only
  by manual trace, see Cross-batch items below) — the mock-resolver unit specs cannot catch a container
  registration-order regression the way a container-level smoke test could.

## Failure modes

### Defense-in-depth gap for ptah when unverified

- Trigger: policy status is `'unverified'` AND the resolver's partial read determined `ptahEnabled:
  false` (a readable store saying ptah is OFF, even though something else made the policy unverified).
- Symptom: none visible under current code — `filterMcpServersByPolicy` still omits ptah from
  `mcpServers`, and `strictMcpConfig: true` means nothing outside that map can load. But the flag-tier
  list itself (`deniedMcpServers`/`disabledMcpjsonServers` in `Options.settings`) does not name ptah in
  this branch, unlike the verified-and-OFF branch which explicitly adds it (`sdk-query-options-builder.ts:481`).
- Evidence: `sdk-query-options-builder.ts:472-477` (`capabilityFlagsFor`'s unverified early return omits
  `PTAH_MCP_SERVER_NAME` from `deniedMcpServers` even when `!policy.ptahEnabled`), contrast with
  `:479-483` (verified branch explicitly adds it). The spec at `:362-369` ("omits ptah only when a
  readable store says it is OFF") only asserts `options.mcpServers` is empty; it never asserts
  `built.settings['deniedMcpServers']` contains `{ serverName: 'ptah' }` the way the verified-off test at
  `:249-258` does.
- Current handling: relies solely on `filterMcpServersByPolicy`'s direct `mcpServers` filtering plus
  `strictMcpConfig: true`.
- Recommendation: for symmetry and defense-in-depth parity with the verified branch, add
  `PTAH_MCP_SERVER_NAME` to the unverified branch's `deniedMcpServers` when `!policy.ptahEnabled`, and add
  a spec assertion on the flag-tier list for that case. Moderate, not Serious, because `strictMcpConfig`
  already makes the `mcpServers` map authoritative — no known path lets ptah load through the flag tier
  alone.

### Local notice-code cast outlives its constant (B2 dependency)

- Trigger: none at runtime — this is a static-typing workaround, not a behavioural bug.
- Symptom: `sdk-query-options-builder.ts:595-596` widens the literal `'capability-policy-unverified'`
  to `SessionMcpNotice['code']` via `as`, because `SessionMcpNoticeCode` in this worktree still only
  contains `'claude-ai-connectors-disabled'` (`libs/shared/src/lib/types/messages/session-mcp-status.ts:64`)
  — B2's union extension has not landed on this branch/worktree yet.
- Evidence: `sdk-query-options-builder.ts:595-596,609`.
- Current handling: the cast is harmless today (the value is still a plain string compared/parsed
  structurally elsewhere), and Batch 8's own spec (`:371-388`) proves the notice round-trips correctly.
- Recommendation: once B2 lands `SessionMcpNoticeCode |= 'capability-policy-unverified'` in this
  worktree/branch, remove the `as SessionMcpNotice['code']` cast and the
  `CAPABILITY_POLICY_UNVERIFIED_CODE` intermediate constant, and let the literal be checked directly
  against the real union — otherwise a future rename of that union member on the B2 side would compile
  silently wrong here.

### Harness preflight is now gated on the capability resolver being registered

- Trigger: any host container where `SDK_CAPABILITY_RESOLVER` is not yet bound (true of every host in
  this worktree today, since B7 Task 7.3 — the DI registration — has not landed: `grep
  SDK_CAPABILITY_RESOLVER libs/backend/cli-agent-runtime/src/lib/di/register.ts` returns nothing).
- Symptom: every session in every host currently runs fail-closed (strict MCP, ptah only, `skills: []`,
  **no harness preflight/sync at all** — `session-query-executor.service.ts:596-604` returns early
  whenever `policy.status !== 'verified'`), which is a behavioural narrowing versus pre-Batch-8, where
  `IHarnessPreflight.ensure` ran unconditionally once a host bound `HARNESS_PREFLIGHT_TOKEN`, independent
  of any capability concept.
- Evidence: `session-query-executor.service.ts:596-604`; confirmed empty grep for
  `SDK_CAPABILITY_RESOLVER` in `libs/backend/cli-agent-runtime/src/lib/di/register.ts` (this worktree,
  2026-09-26).
- Current handling: this is the documented, intended design (Fail-closed policy §Harness: "The reconciler
  freezes" under an unknown policy) and it is *correct* once B7 finishes registering the resolver. It is
  flagged here only because Batch 8 is the point where the regression risk becomes live: until B7 Task
  7.3 lands, this branch's behaviour is a genuine regression from main (harness preflight silently stops
  running everywhere), and nothing in Batch 8's own test suite can catch that — its specs mock the
  resolver directly.
- Recommendation: track as a cross-batch landing-order dependency (below), not a Batch 8 code defect.
  When B7 lands, re-run a host-level smoke check (or a lightweight container-resolution spec) confirming
  `SDK_CAPABILITY_RESOLVER` and `SDK_HARNESS_POLICY_SYNC` are both bound before `SessionLifecycleManager`
  is ever resolved.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: ptah defense-in-depth gap in the unverified branch of `capabilityFlagsFor` —
  `sdk-query-options-builder.ts:472-477` (see Failure modes).
- Minor: the `CAPABILITY_POLICY_UNVERIFIED_CODE` cast at `sdk-query-options-builder.ts:595-596` must be
  removed once B2 lands in this worktree (see Failure modes; tracked below as a cross-batch item, not
  scored against Batch 8).

## Data flow

1. `SessionQueryExecutor.executeQuery` (`session-query-executor.service.ts:343-350`) resolves ONE
   `EffectiveCapabilitySet` snapshot via `resolveCapabilityPolicy` → `resolveSessionCapabilityPolicy`. OK
   — never throws, always returns a value.
2. The SAME snapshot is passed to `syncHarnessToPolicy` (harness sync, verified-only) and then to
   `builder.build({..., capabilityPolicy})` (`:421` / `:610-625`). OK — proven by the harness-preflight
   spec's "hands the builder the SAME policy snapshot the sync used" (`:173-183`), so no second resolve
   can race the first and desync the harness copies from the flags.
3. Inside `build()`, `sessionCapabilityPolicy` (`:1383-1411`) re-validates: a caller-supplied policy is
   used as-is (with a warn log if unverified); a missing one (a caller outside the executor) is replaced
   by a fresh unverified fallback. OK — a caller that forgets to pass a policy can only narrow a session,
   never widen one.
4. `capabilityFlagsFor(policy, backingOffServers)` and `filterMcpServersByPolicy(...)` derive the
   flag-tier settings and the actual `mcpServers` map from that one snapshot. OK for the verified path;
   see the Moderate finding for the unverified+ptah-off asymmetry.
5. `capabilityIsolationOptions(policy)` spreads `strictMcpConfig`/`skills` onto the built `Options` AFTER
   `mcpServers` is set (`:1149-1195`), so an unverified session's isolation flags cannot be shadowed by an
   earlier assignment. OK.
6. `SdkQueryRunner.runOneShot` (`sdk-query-runner.service.ts:283-296`) resolves its OWN policy
   independently (one-shots are not funnelled through the executor) but reuses the same
   `capabilityFlagsFor`/`filterMcpServersByPolicy`/`capabilityIsolationOptions` helpers with an empty
   back-off list. OK — same enforcement, proven by `sdk-query-runner.service.spec.ts:380-495`.
7. `SdkModelService`'s probe bypasses the policy machinery entirely and hardcodes
   `strictMcpConfig: true, mcpServers: {}, skills: []` (`sdk-model-service.ts:837-842`). OK — the probe
   never needs a real MCP server or skill, so hardcoding is stricter than policy-driven and needs no
   resolver dependency.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Verified policy → flag-tier deny/approve (`deniedMcpServers`, `disabledMcpjsonServers`, `enabledMcpjsonServers` explicit-only, `skillOverrides`) | COMPLETE | none |
| ptah filtered only when explicitly OFF; extra flag-tier deny of ptah | COMPLETE | verified branch only (see Moderate finding for the unverified branch) |
| Back-off still suppresses, wins over explicit approval (AC-4.7) | COMPLETE | proven both verified and unverified |
| Direct vs proxied build parity | COMPLETE | `sdk-query-options-builder.capabilities.spec.ts:220-241` asserts identical capability keys |
| Unverified → strict MCP + ptah only + `skills: []` + notice | COMPLETE | none |
| Unverified: caller-supplied extra `mcpServersOverride` dropped | COMPLETE (by design) | confirmed no legitimate caller (chat OAuth/Smithery, Ptah CLI proxy header) is exempted; matches Fail-closed policy §Claude chat |
| `HarnessPolicySync.apply` runs on every session start when verified, with force semantics unchanged | COMPLETE | same `apply(physicalRoot, fingerprint)` contract as B5; order-before-build proven at `session-query-executor.harness-preflight.spec.ts:160-171` |
| One-shots apply the same flags or strict when unverified | COMPLETE | `sdk-query-runner.service.spec.ts:380-495` |
| Model probe: `strictMcpConfig: true`, `mcpServers: {}`, `skills: []` | COMPLETE | `sdk-model-service.spec.ts:527-544` |
| Reviewer acceptance (P9): flags come only from `EffectiveCapabilitySet`, never the loader's workspace-only sync methods | COMPLETE | no import of `resolveCurrentPluginPaths`/`getDisabledSkillIds`/`getWorkspacePluginConfig` anywhere in the 8 reviewed files (grep confirmed) |

Implicit requirements not addressed: telemetry/metrics for how often sessions run unverified (see Q5);
a container-level (not mock-resolver) regression test for DI ordering (see Cross-batch items).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Resolver not registered | YES | `resolveSessionCapabilityPolicy` returns unverified fallback | none |
| Resolver throws | YES | same fallback, logged with real error detail, fixed UI-facing reason | none |
| No workspace path known (`projectPath` undefined) | YES | executor skips policy resolution and harness sync entirely, builder still fails closed | none |
| Unacknowledged harness pass | YES | logged, session continues (documented non-fatal) | none |
| `HarnessPolicySync.apply` throws | YES | caught, logged, session continues | none |
| Back-off server the policy leaves ON | YES | still suppressed, both verified and unverified | none |
| Denied server present in a caller's `mcpServersOverride` | YES | removed by `filterMcpServersByPolicy` | none |
| Global-OFF skill / plugin-child skill (bare + `plugin:skill`) | YES | denied via `skillOverrides`, sourced from `deniedSkillNames` only | none |
| Direct vs proxied (custom base URL) session | YES | identical flag-tier lists proven by spec | none |
| Unverified session with a partially-readable store (`ptahEnabled: false`) | PARTIAL | `mcpServers` correctly omits ptah | flag-tier list does not also deny it (Moderate finding) |
| DI: `SDK_CAPABILITY_RESOLVER` registered after `SessionLifecycleManager` is first resolved | YES (by construction) | `useClass` + `Lifecycle.Singleton` registration is lazy in tsyringe; traced `registerSdkServices` → `registerCliAgentRuntimeServices` ordering in all three hosts (electron, vscode, cli-engine) and found no eager `.resolve()` call between them | no container-level regression test exists to pin this ordering going forward |

## Cross-batch items

1. **B7 Task 7.3 must register `SDK_CAPABILITY_RESOLVER` (and confirm `SDK_CAPABILITY_GLOBAL_LAYER`)
   before this branch reaches a working state.** Until then, every session in every host runs fail-closed
   (no harness preflight at all — see Failure modes #3). This is expected mid-branch behaviour per the
   wave plan (B7 precedes B8 in dependency order but both are "IN_PROGRESS"/being landed close together),
   not a Batch 8 defect, but the team-leader should re-run a live smoke check after B7 lands to confirm
   `syncHarnessToPolicy` actually executes again for a verified workspace.
2. **DI ordering regression guard.** Traced host wiring by hand for `apps/ptah-electron/src/di/phase-2-libraries.ts`,
   `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` and `libs/backend/cli-engine/src/lib/container.ts`:
   all three call `registerSdkServices(container, logger)` before `registerCliAgentRuntimeServices(container,
   logger)`, and `SessionLifecycleManager` is registered with `{ useClass: ... }` + `Lifecycle.Singleton`
   (`libs/backend/agent-sdk/src/lib/di/register.ts:356-360`), which tsyringe resolves lazily — no eager
   `.resolve(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)` call was found between the two registration calls in
   any of the three hosts (grepped all `SDK_SESSION_LIFECYCLE_MANAGER` references; every other consumer is
   itself an `@inject`-based constructor param, resolved even later in phase-3/4 handler wiring). No defect
   found, but recommend B11/B12 (host wiring batches) add one lightweight container-resolution spec per host
   asserting `container.resolve(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)` yields a manager whose
   `capabilityResolver` is non-null, so a future reordering of the two `register*Services` calls fails a test
   instead of silently reintroducing fail-closed-everywhere.
3. **`CAPABILITY_POLICY_UNVERIFIED_CODE` cast** (`sdk-query-options-builder.ts:595-596`) must be removed
   once B2's `SessionMcpNoticeCode` union extension lands in this worktree/branch (see Failure modes #2).
4. Reviewer acceptance item confirmed: the local ptah defense-in-depth asymmetry (Moderate finding #1) is
   independent of B2/B7 landing order and can be fixed within Batch 8 itself without waiting on either.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking Batch 8 itself; the only live risk is the cross-batch landing-order dependency
  on B7 Task 7.3 (capability resolver DI registration), which the team-leader must re-verify live once B7
  merges, since nothing in Batch 8's mock-resolver test suite can detect that regression class.
- What a robust implementation would add: symmetric ptah defense-in-depth in the unverified branch of
  `capabilityFlagsFor`; a container-level DI-ordering regression spec per host; removal of the
  `CAPABILITY_POLICY_UNVERIFIED_CODE` cast once B2 lands; basic telemetry/counter for sessions running
  under an unverified capability policy.

## Re-review round 1 — Batch 8

Verified `b8-backend-developer`'s revise-round-1 changes to
`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+2 spec cases in
`sdk-query-options-builder.capabilities.spec.ts`) against both Moderate findings from the initial review.

- **Moderate #1 (ptah defense-in-depth gap, unverified branch) — RESOLVED.** `capabilityFlagsFor`'s
  unverified early return (`sdk-query-options-builder.ts:479-489`) now includes `PTAH_MCP_SERVER_NAME`
  in `deniedMcpServers` when `!policy.ptahEnabled`, merged with `backingOffServers` and deduplicated via
  the same `uniqueNames` helper the verified branch uses — the two branches are now symmetric. Proven by
  the new spec case "also denies ptah on the flag tier when a readable store says it is OFF"
  (`sdk-query-options-builder.capabilities.spec.ts:371-387`), which exercises the merge-with-back-off path
  directly (`deniedMcpServers` / `disabledMcpjsonServers` both list `ptah` then `flaky`, in that order,
  with no duplicates), and the companion "does not deny ptah on the flag tier while it is ON" case
  (`:389-393`) confirms no regression toward over-denying. No widening path introduced: the merge is still
  a `Set`-backed union, never a second independent write.
- **Moderate #2 (local notice-code cast) — RESOLVED.** The `CAPABILITY_POLICY_UNVERIFIED_CODE` constant
  and its `as SessionMcpNotice['code']` cast are gone; `capabilityPolicyNotice` now assigns
  `code: 'capability-policy-unverified'` directly (`sdk-query-options-builder.ts` `capabilityPolicyNotice`,
  post-change), and `libs/shared/src/lib/types/messages/session-mcp-status.ts:70-72,100` confirms
  `SessionMcpNoticeCode` and `NOTICE_CODE_SET` now include the literal (B2, `e0ba036f0`), so this
  type-checks against the real union with no widening. If the literal is ever renamed on the B2 side, a
  compile error will now surface here — the original risk (a silent mismatch) is eliminated, not just
  hidden by removing the cast.
- **Regression check.** Re-read the full diff of `sdk-query-options-builder.ts`: every other symbol,
  branch and doc comment reviewed in the initial pass is unchanged in substance (only the two targeted
  edits above and their knock-on doc-comment wording). No new caller of `capabilityFlagsFor` or
  `filterMcpServersByPolicy` was introduced, and the verified-policy path, the notice-publish condition,
  and `sessionCapabilityPolicy`'s fallback are byte-identical to the version already reviewed.
- **Check command.** `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p
  @ptah-extension/agent-sdk --parallel=2` — lint, typecheck and test all pass (1 project; 2/3 tasks
  served from local cache, typecheck ran fresh; no failures).
- **Cross-batch items** from the initial review (B7 Task 7.3 DI registration landing order; a
  container-level DI-ordering regression spec) are unaffected by this round and remain open as tracked,
  not as Batch 8 defects.

### Verdict (round 1)

- Recommendation: APPROVE
- Confidence: HIGH
- Both Moderate findings are resolved with matching, targeted spec coverage and no regression. No new

# Code Logic Review — Batch 7

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 2                                     |
| Failure modes found   | 3                                     |

Scope reviewed, worktree `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-560-b7`
(branch `feat/task-2026-560-b7-resolver`, base `1e7aab5bb`): full contents of
`capability-resolver.service.ts` (719 lines), `capability-policy-model.ts` (540 lines, the unplanned
max-lines split), `capability-resolver.service.spec.ts` (headers of every `it`/`describe`, plus the full
bodies of the (a)-(f) acceptance tests and the P9/fail-closed suites), the full diff of
`mcp-install.service.ts` and its spec, `claude-approval.reader.ts` (unchanged this batch, read for the #4
"lenient reader" claim), `di/register.ts` and `src/index.ts`. Cross-checked DI ordering across all three
hosts (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`,
`libs/backend/cli-engine/src/lib/container.ts`) and `libs/backend/agent-sdk/src/lib/di/register.ts:544-548`
for the fail-open DI-order risk. Ran the scoped check:
`lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2` — 1/1 project, all green (2/3 tasks
served from local cache, typecheck ran fresh; no failures).

## (a)-(f) ruling table (mandatory items, batches.md:716-740)

| Item | Requirement | Evidence | Ruling |
| --- | --- | --- | --- |
| (a) `recordWorkspaceRoot` best-effort | A failed diagnostics write never fails `resolve`/`set`/a session | `capability-resolver.service.ts:283-297` wraps the call in try/catch, logs via `IOutputChannel`, and swallows the error. Proving test: `capability-resolver.service.spec.ts:780` "B6 carry: a rejecting recordWorkspaceRoot still yields a verified set and a working toggle" | PASS |
| (b) P9 — skill/plugin inputs ONLY from `getEffectivePluginConfig` | No resolution-path call to `resolveCurrentPluginPaths`/`getDisabledSkillIds`/`getWorkspacePluginConfig`; `deniedSkillNames` includes global-OFF skills and children of global-OFF plugins; unknown → unverified | `readPluginPolicy` (`:435-454`) is the only place `getEffectivePluginConfig` is called, and it is the only source feeding `pluginRead.policy.config` into `pluginAndSkillRows` (`:407-419`). `readPluginCatalog` (`:460-516`) calls `getAvailablePlugins`/`resolvePluginPaths`/`discoverWorkspaceHarnessPluginPaths`/`discoverSkillsShPluginPaths`/`discoverSkillsForPlugins` — existence-only discovery methods, never the banned enabled/disabled ones — to build what plugins/skills exist on disk; the enabled/disabled verdict always comes from `pluginRead.policy.config`. `deniedSkillNames` (`capability-policy-model.ts:396-413`) unions per-skill-off and per-`plugin:skill`-off (parent-off) names. `isCapabilityPolicyUnknownError` → `status: 'error'` → snapshot reasons → `unverified` (`:442-454`). Proving tests: `:929` "takes its inputs only from getEffectivePluginConfig", `:969`, `:984`, `:867` | PASS |
| (c) P9 G7 — workspace writes from the STORED config only | `saveWorkspacePluginConfig(…, physicalRoot)` with a payload built from the stored workspace config, never the layered one | `setPluginOrSkillWorkspace` (`:594-630`) builds `withWorkspaceValue(stored, kind, id, value)` from `stored = getWorkspacePluginConfig(...)` (`:614`), and `value` itself is computed from `global` (the store's own global layer, `:621`) plus `defaultValue` — never from `effective.config`. Proving test: `:1020` "AC-3.1: a workspace plugin toggle writes the workspace PluginConfigState", plus the three-case block at `:1061-1126` ((i) unreadable workspace layer rejects, (ii) global+workspace-off leaves Y toggle from touching X, (iii) a global-only item stays out of the workspace) | PASS |
| (d) R7/N2 — `set` awaits `ensureImported` first | The toggle write happens after the import settles, in every order | `set` (`:206-227`) calls `await this.ensureImported(ctx)` before any `setMcp`/`setPluginOrSkillGlobal`/`setPluginOrSkillWorkspace` call, with an inline comment explaining the ordering guarantee. Proving test: `:551` "N2: the first set() in a fresh workspace imports first, then the toggle wins" | PASS |
| (e) Declared deviation — no `await` between the two reads | `getWorkspacePluginConfig` is read the same tick as the strict `getEffectivePluginConfig` | `setPluginOrSkillWorkspace` (`:605-614`): `const effective = await this.deps.plugins.getEffectivePluginConfig(...)` is immediately followed by `const stored = this.deps.plugins.getWorkspacePluginConfig(...)` with no `await`, no I/O and no other call between the two statements (confirmed by reading the file, not just the comment) | PASS |
| (f) Declared deviation — fail-closed ordering | The strict read rejects the write before the lenient read is ever reached | Because `effective = await getEffectivePluginConfig(...)` is a JS `await` of a rejecting promise, a thrown `CapabilityPolicyUnknownError` unwinds `setPluginOrSkillWorkspace` immediately; `stored = getWorkspacePluginConfig(...)` on the next line is provably unreached in that case (no `try`/`catch` around the `await` swallows it). Proving test: `:1061` "(i) an unreadable workspace layer rejects the toggle and leaves the stored config as it was" | PASS |

All six mandatory items are RESOLVED with named, verified tests. DI registration (Task 7.3) is also
confirmed on disk: `SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER` → `CapabilityToggleStore`
(`di/register.ts:128-135`), `SDK_TOKENS.SDK_CAPABILITY_RESOLVER` → `CapabilityResolverService`
(`:137-158`), both exported from `src/index.ts:6-18`.

## Five logic questions

### 1. How does this fail silently?

No silent-failure path found for the policy-critical paths. `resolve`/`list` never throw (double try/catch
at `:168-184`, `:186-204`) and every unreadable input becomes a `reasons` entry that flips `status` to
`unverified` (`toEffectiveSet`, `capability-policy-model.ts:379`) — a consumer reading only `status` cannot
mistake this for "nothing is denied". One genuine under-reporting path exists, though it cannot widen
policy (see Failure modes, "lenient `~/.claude.json` user-scope reader").

### 2. What user action produces unexpected behaviour?

A user who toggles a bare skill name ON/OFF while it has two providing plugins, one ON and one OFF, sees
the bare row and the `plugin:skill` rows disagree: bare stays enabled (because `parentEnabled` is
`some()`-true, `capability-policy-model.ts:243-246,288`) while the OFF plugin's own `plugin:skill` name is
still denied. This matches the plan's own framing exactly ("plugin-child denial: plugin:skill always; bare
only when no enabled plugin provides that name") — confirmed by tracing `deniedSkillNames`
(`:396-413`): the bare name is added to `denied` only when `own` is false, and `own` already reflects
`parentEnabled` folding via `layeredRow`'s `resolved` computation, so a bare name is denied precisely when
NO enabled plugin still provides it. Ruling: correct, not a defect — this is the documented interpretation
task item 3 asked to be ruled on.

### 3. What input data produces a wrong answer?

Verified the mixed-scope MCP question (task item 3): a global explicit ON on a server that is ALSO declared
in a repository file (`.mcp.json`) is counted in `approvedProjectMcpServers`
(`capability-policy-model.ts:371`: `row.scopes.includes('workspace') && row.resolved.origin !== 'default'`).
This is consistent with Q1 ("repository-declared servers are OFF, with a one-time import of user-authored
approvals") and with D1/#4 trust: a global ON is an explicit user decision made through Ptah's own store, not
something the repository file itself could produce — `resolved.origin` is `'global'` here, never
`'default'`, so a bare repository declaration with no decision anywhere is correctly excluded. Ruling:
correct, no defect.

### 4. What happens when a dependency fails?

- `getEffectivePluginConfig` throwing `CapabilityPolicyUnknownError` is caught in exactly one place
  (`readPluginPolicy`, `:435-454`) and converted to a `reasons` entry; every downstream row builder receives
  an empty `PluginCatalog`/`pluginPolicy: null` rather than partial data (`:404-419`).
- `readPluginCatalog` (a *second*, independent read of `getAvailablePlugins`/`resolvePluginPaths`/etc.,
  called synchronously right after the `Promise.all` that read `getEffectivePluginConfig`, `:407-408`) is not
  drawn from the same snapshot as the effective-config read — see Failure modes, "catalog/policy snapshot
  skew".
- The back-off dependency is optional (`deps.backoff?.getBackingOffServers() ?? []`, `:519-521`); its absence
  degrades to "nothing held back", which is the documented default for a host without the service, not a
  silent failure.
- `ClaudeApprovalReader.read` never throws (verified by reading the full file) and its `error` status is
  distinguished from `absent`, so a hung git or a corrupt `~/.claude.json` blocks the import (`runImport`,
  `:322-336`) rather than silently treating the workspace as unapproved-but-clean.

### 5. What is missing that the requirements never mentioned?

Nothing structural. One observability gap: `readPluginCatalog`'s error reason (`:507-515`) is prefixed
`"plugin catalog: ..."` and pushed into the same `reasons` array as every other unverified cause
(`:417`), so a user or the Marketplace banner sees "plugin catalog: <code>" indistinguishable in shape from
a store or declaration-source failure — acceptable, matches the existing `reasons` contract, not a defect.

## Failure modes

### Catalog/policy snapshot skew (non-atomic composite read)

- Trigger: a plugin is installed, removed, or its files touched on disk in the narrow window between the
  `Promise.all` that resolves `getEffectivePluginConfig` (`readSnapshot`, `:378-385`) and the subsequent,
  separate, synchronous call to `readPluginCatalog(ctx.physicalRoot)` (`:408`).
- Symptom: `pluginAndSkillRows` combines a catalog (what plugins/skills exist right now) with a policy
  (`pluginRead.policy.config`, read microseconds earlier) that may already be stale relative to each other —
  e.g. a plugin that was just uninstalled still appears in `catalog.plugins` but its enabled/disabled verdict
  came from a config snapshot taken before or after the uninstall, producing a row whose `sources`/`path` and
  `resolved` disagree about whether the plugin still exists.
- Evidence: `capability-resolver.service.ts:375-419` — the two reads are not part of the same `Promise.all`
  and there is no re-validation that the catalog and the policy came from one consistent point in time.
- Current handling: none; both reads are best-effort against a live filesystem, and neither is retried nor
  cross-checked.
- Recommendation: acceptable as shipped — the window is a handful of synchronous `fs` calls, this is a
  read-only, always-recomputed-fresh view (no cache to go stale permanently), and the plan explicitly scopes
  atomicity guarantees to the toggle-write path (C2's per-item atomic rename), not to this composite read. No
  fix required for this batch; worth a one-line code comment if a future batch adds caching here.

### Lenient `~/.claude.json` user-scope reader cannot widen the resolved policy, but can under-report a declaration

- Trigger: `~/.claude.json` is corrupt or unreadable, so `readClaudeUserMcpServers` (called from
  `claudeUserRows`, `mcp-install.service.ts:382-384`) silently omits every user-scope row it cannot parse.
- Symptom: `listDeclarations`'s `sourceStatus` (`:337-348` in the resolver's `runImport`, and
  `inventoryReasons` in `capability-policy-model.ts:477-486`) never reports an error for this specific file,
  because `sourceStatus` is populated only from `harnessConfigRows`' facet `inspect` calls
  (`mcp-install.service.ts:329-378`), not from `claudeUserRows`. A user-scope MCP server that would otherwise
  default ON (per the Resolution rules, "Any user-scope declaration: ON") can silently disappear from the
  declaration list and from the Installed tab.
- Evidence: `mcp-install.service.ts:295-311` (`listDeclarations` composes `harness.rows` +
  `this.claudeUserRows(workspaceRoot)` + Smithery + OAuth, but only forwards `harness.sourceStatus`).
- Current handling: the resolver's fail-closed behaviour is NOT affected — `ClaudeApprovalReader` (the
  security-relevant reader for the one-time import) reads the SAME `~/.claude.json` file independently and
  fails closed on any parse/read error (`claude-approval.reader.ts:175-198`, `readJsonObjectFile:298-327`),
  so the import path (which decides what becomes an ON server) correctly blocks and surfaces an error. The
  task's framing — "the lenient reader cannot widen because the approval reader fails closed on the same
  file" — is verified TRUE: the two readers are independent, and only the approval reader's failure gates
  policy. The lenient reader's failure can only narrow the Installed-tab display (a server silently missing
  from the list), never widen what is allowed to run.
- Recommendation: Moderate, not Blocking — this is a pre-existing display-only gap (not introduced by this
  batch; `readClaudeUserMcpServers` is unchanged in this diff) and is explicitly deferred to PR 2's #16
  (`readClaudeUserMcpServers` → `readClaudeUserMcpDeclarations`, C4c). No fix required in B7.

### Fail-open via DI order (HIGHEST RISK item) — traced safe on all three hosts

- Trigger (hypothetical): `PluginLoaderService` (`SDK_TOKENS.SDK_PLUGIN_LOADER`, a tsyringe singleton,
  `useClass` registration at `libs/backend/agent-sdk/src/lib/di/register.ts:544-548`) gets *constructed*
  (its first `.resolve()`) before `registerCliAgentRuntimeServices` registers
  `SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER` (`libs/backend/cli-agent-runtime/src/lib/di/register.ts:128-135`).
  Because the loader's `@inject(SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER, { isOptional: true })`
  (`plugin-loader.service.ts:514`) resolves once at construction and the loader is a singleton, an early
  construction would permanently wire `globalLayer: undefined`, and `getEffectivePluginConfig` would then
  silently ignore every global OFF for the life of the process (widening, not failing closed) — exactly the
  scenario the task asked to rule on.
- Symptom (if triggered): a global-scope OFF toggle would have no effect on session builds, harness copies,
  or the resolver's own `pluginRead.policy` for that process's lifetime, with no error surfaced anywhere.
- Evidence traced per host:
  - `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:149,164-201`: `registerSdkServices` at `:149`
    (registers but does not construct `PluginLoaderService`), then `registerHarnessSyncServices` at `:164`
    with `sourceResolver: createPluginConfigSourceResolver(() => container.isRegistered(...) ? container.resolve(...) : null)` — a **lazy closure**, not called at registration time — then `registerCliAgentRuntimeServices` at `:201`. No eager `.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER)` between `:149` and `:201`. **Safe.**
  - `apps/ptah-electron/src/di/phase-2-libraries.ts:183,198-231,255`: same shape — `registerSdkServices` at
    `:183`, a lazy `sourceResolver` closure at `:200-231` (the P9 G2 wrapper, also lazy), then
    `registerCliAgentRuntimeServices` at `:255`. No eager resolve in between. **Safe.**
  - `libs/backend/cli-engine/src/lib/container.ts:629,643-671,677`: `registerSdkServices` at `:629`, a lazy
    `sourceResolver` closure at `:645-650` inside `registerHarnessSyncServices` (`:643-671`), then
    `registerCliAgentRuntimeServices` at `:677`. No eager resolve in between. **Safe.** (`apps/ptah-cli` has
    no DI registration of its own — grepped for `registerSdkServices`/`registerCliAgentRuntimeServices` under
    `apps/ptah-cli/src` and found nothing, confirming it boots through this same `container.ts`.)
  - Activation-time eager resolvers of `SDK_PLUGIN_LOADER` do exist —
    `apps/ptah-electron/src/activation/plugin-activation.ts:242,290`,
    `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:34,75`,
    `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:63` — but all three run from the host's
    activation entry point, which executes only after the host's full `registerPhaseN...` sequence (and
    therefore `registerCliAgentRuntimeServices`) has already returned. None of these resolve the loader
    inside the phase-2 registration function itself.
- Current handling: every host carries an explicit code comment at the `registerSdkServices` call site
  naming this exact ordering hazard for a related token (the plugin-marketplace consent store) — the same
  discipline (register-before-construct, lazy closures for cross-lib readers) is applied consistently to
  `SDK_CAPABILITY_GLOBAL_LAYER`.
- Recommendation: no code change needed for B7. This is a structurally fragile invariant (a future
  refactor that adds an eager `container.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER)` anywhere between
  `registerSdkServices` and `registerCliAgentRuntimeServices` in any host would silently reintroduce this)
  — **Moderate**, recommend a DI-ordering regression spec (already flagged as a cross-batch item by the B8
  review, see below) rather than relying solely on comment discipline and manual tracing at each future
  review.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: catalog/policy snapshot skew — `capability-resolver.service.ts:375-419` (see Failure modes).
  Acceptable as shipped; no fix required.
- Moderate: no DI-ordering regression spec exists to pin the "no eager `SDK_PLUGIN_LOADER` resolve between
  `registerSdkServices` and `registerCliAgentRuntimeServices`" invariant across all three hosts — currently
  enforced only by code comments and manual review tracing (see Failure modes, "Fail-open via DI order").
  Same item already tracked as a cross-batch open item from the B8 review (`code-logic-review.md:1693-1695`).
- Minor: the lenient `~/.claude.json` reader (`mcp-install.service.ts:382-384`) has no error surfaced through
  `sourceStatus`; pre-existing, unchanged by this batch, deferred to PR 2 #16. See Failure modes.
- Minor: `entryFor` (`capability-resolver.service.ts:665-680`) performs a full second `readSnapshot` after
  every `set`/`setExplicit`, duplicating the read already done inside `setPluginOrSkillWorkspace`/`setMcp`.
  Correct, but re-reads everything (inventory, both layers, imported, plugin policy, catalog) a second time
  per write; a performance note, not a logic defect, and within the plan's stated performance budget
  ("resolve does two `readdir`s plus tens of tiny item reads... under 20 ms warm").

## Data flow

1. `resolve(cwd)` / `list(cwd)` → `contextFor(cwd)` computes `physicalRoot`/`policyKey`/`wsKey` — OK, throws
   only `CapabilityRequestError` for an empty `cwd`, caught by the caller and turned into `unverified`
   (`:168-174`, `:186-193`).
2. `recordRoot` (best-effort, swallows failures) → `ensureImported` (single-flight per `wsKey`, never
   rejects) → `Promise.all` of inventory, global layer, workspace items, imported layer, and
   `readPluginPolicy` (wraps `getEffectivePluginConfig`) — OK, every branch converts a failure into a typed
   `reasons` entry, never a thrown exception that escapes `readSnapshot`.
3. `readPluginCatalog` (a second, unsynchronized read) — OK for the common case; the documented, accepted
   skew window is the one Moderate finding above.
4. `toEffectiveSet`/`toInventory` (pure, `capability-policy-model.ts`) — OK, both built from the identical
   `PolicySnapshot`, so `resolve` and `list` cannot disagree (matches the file's own header claim, verified
   by reading both functions).
5. `set`/`setExplicit` → `ensureImported` (awaited first, R7/N2) → per-kind write (`setMcp`,
   `setPluginOrSkillGlobal`, `setPluginOrSkillWorkspace`) → `entryFor` (a fresh full re-read) — OK; the
   declared deviation's ordering guarantee ((e)/(f) above) is upheld by direct inspection of the statement
   order with no `await` between the strict and lenient reads.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| (a) recordWorkspaceRoot best-effort | COMPLETE | none |
| (b) P9 skill/plugin inputs only from getEffectivePluginConfig | COMPLETE | none |
| (c) P9 G7 workspace writes from stored config only | COMPLETE | none |
| (d) R7/N2 set awaits ensureImported first | COMPLETE | none |
| (e) declared deviation: no await between strict/lenient reads | COMPLETE | none |
| (f) declared deviation: fail-closed ordering | COMPLETE | none |
| Task 7.2 listDeclarations (dedupe by scope, feeds listInstalled) | COMPLETE | none; dedupe-key addition of `scope` is a no-op on existing rows since scope is derived deterministically from `origin`/`target`, which were already implicit in the pre-existing key (verified by tracing `classifyMcpScope`) |
| Task 7.3 DI registration + exports | COMPLETE | none |
| Fail-open via DI order (highest risk) | COMPLETE (safe) | no regression test pins the invariant; see Moderate issues |

Implicit requirements not addressed: none found beyond the Moderate/Minor items above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Bare skill name with one OFF and one ON providing plugin | YES | `parentEnabled` uses `some()`, so bare stays enabled while the OFF plugin's own `plugin:skill` name is still denied | Matches documented interpretation (task item 3); none |
| Global explicit ON on a repo-declared MCP server | YES | Counted in `approvedProjectMcpServers` because `resolved.origin === 'global'`, never `'default'` | Consistent with Q1/D1; none |
| Back-off server, ptah excluded | YES | `backingOff: name !== PTAH_MCP_SERVER_NAME && backingOff.has(name)`, and ptah is `continue`d out of the deny/approve loop entirely | none |
| `recordWorkspaceRoot` rejects | YES | Best-effort catch/log, `resolve`/`set` still succeed | none |
| `getEffectivePluginConfig` throws mid-workspace-toggle | YES | Write rejected before `getWorkspacePluginConfig` is reached | none |
| Corrupt `~/.claude.json` during import | YES | `ClaudeApprovalReader` fails closed, nothing published, retried next resolve | none |
| Corrupt `~/.claude.json` during display-only `listDeclarations` | PARTIAL | `claudeUserRows` silently omits rows; no `sourceStatus` entry | Minor, pre-existing, PR 2 #16 |
| Two concurrent `resolve()` calls in one process | YES | Single-flight `ensureImported` via `this.imports` map | none |
| `PluginLoaderService` constructed before `SDK_CAPABILITY_GLOBAL_LAYER` registration | NO (not applicable) | Traced safe: no eager resolve exists on any of the three hosts' registration paths today | Structurally fragile; no regression spec pins it |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the DI-order invariant that keeps the global capability layer reachable from
  `PluginLoaderService` is currently enforced only by comment discipline and manual review tracing across
  three separate host files, with no automated regression spec; a future edit that adds an eager
  `container.resolve(SDK_TOKENS.SDK_PLUGIN_LOADER)` between `registerSdkServices` and
  `registerCliAgentRuntimeServices` in any host would silently reintroduce fail-open behaviour for every
  global OFF toggle, with no test to catch it.
- What a robust implementation would add: (1) a DI-ordering regression spec (per the B8 cross-batch item
  already on record) that builds a real container, calls `registerSdkServices` then resolves
  `SDK_PLUGIN_LOADER` eagerly, then calls `registerCliAgentRuntimeServices`, and asserts
  `getEffectivePluginConfig` still honours a global OFF — proving the CURRENT safe ordering is load-bearing
  rather than incidental; (2) optionally, `PluginLoaderService.getEffectivePluginConfig` could defensively
  re-resolve `SDK_CAPABILITY_GLOBAL_LAYER` from the container per call instead of capturing it once at
  construction, trading a small resolve cost for removing the ordering hazard entirely — out of scope for
  B7, worth flagging to the architect for B11/B12 (the hosts/RPC batch) or a follow-up task.
  issues found in this round.

---

# Code Logic Review — Batch 13

- Worktree: `.claude-worktrees/feat-task-2026-560-b13` (branch `feat/task-2026-560-b13-toggle-ui`, base `9708db51b`)
- Files reviewed in full: `libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts` (+ `.spec.ts`),
  `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.ts` (+ `.spec.ts`),
  `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts`,
  `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.html` (R4).
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
  — lint, typecheck and test all PASS (2/3 tasks from cache, typecheck ran fresh, 34s).

Score: 6/10 — Verdict: **REVISE**

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 2 |
| Failure modes found | 4 |

## Five logic questions

1. **Silent failure**: none found in the load/write paths themselves — `load()` and `setEnabled()` both
   route every failure (thrown or `!isSuccess()`) to visible state (`error` state / `actionError`). The one
   silent-looking spot, `void this.load()` fired after a successful write while `status === 'unverified'`
   (`capability-toggles.store.ts:237`), is not silent: a failure inside that reload still sets `_loadError`
   and `_state = 'error'`, so the user sees it.
2. **Unexpected user action**: switching the active workspace immediately after clicking a toggle, when the
   *same capability id* exists in both workspaces (a very ordinary case — most MCP servers are named
   identically across workspaces). The pending flag for the new workspace's identically-named row gets
   cleared by the old write's cleanup before the new write has actually finished — see Failure mode 1.
3. **Wrong-answer input**: a `CapabilityEntry` where `inheritedFrom` is `'workspace'` (an active override) and
   the control is rendered with `scope="global"` — the control shows the workspace-effective value, not the
   true global-scope value. See Failure mode 2.
4. **Dependency failure**: `capabilities:getState`/`capabilities:setEnabled` throwing or returning
   `isSuccess() === false` are both handled (console warning + fixed user-facing text, `store.ts:239-247,
   262-265`). A `result.error` string from a successful-transport-but-failed-write RPC response is passed to
   the user verbatim (`withReason`, `store.ts:333-336`) — not sanitized in this layer, though the two spec
   fixtures (`'EACCES writing the item file'`, `'denied'`) suggest the backend already curates it. Flagged as
   a dependency-boundary note, not a defect of this batch.
5. **Missing requirement**: whether a workspace-scope control can ever be wired to a `'global'` write (or vice
   versa) is not yet decidable — no page in this repository consumes `CapabilityToggleComponent` yet (`grep
   -rn "ptah-capability-toggle"` outside the component/spec returns nothing). AC-2.3's "never lets a workspace
   toggle write global" is enforced structurally by the component's fixed `scope` input plus the
   `CapabilitiesSetEnabledParams.scope` field, but the actual wiring is Batch 14's job; record this as an
   explicit acceptance item for that batch's review, not as proven here.

## Failure modes

### 1. Stale write's `finally` clears a live pending flag across a workspace switch

- Trigger: user toggles capability `X` in workspace A (write in flight, `X` added to `_pendingKeys`), then
  switches to workspace B before A's RPC resolves, then toggles the same-named capability `X` in workspace B
  (added to a *new* `_pendingKeys` Set by `workspaceEffect`, `store.ts:148-161`). Workspace A's original
  `capabilities:setEnabled` call then resolves (success or failure).
- Symptom: `setEnabled`'s `finally` block (`store.ts:245-247`) calls `this.removePending(key)`
  unconditionally, with no `isStale()` guard. `removePending` operates on whatever `_pendingKeys` signal is
  current — workspace B's — and un-marks `X` as pending there even though workspace B's own write for `X` is
  still genuinely in flight. The toggle control (`capability-toggle.component.ts:197`,
  `[disabled]="pending()"`) re-enables while a real write is outstanding, so a second click can fire a second
  concurrent `capabilities:setEnabled` for the same item, defeating the "never sends a second write for a row
  already in flight" guard the store's own spec asserts (`capability-toggles.store.spec.ts:340-353`) — that
  spec only covers the single-workspace case.
- Evidence: `capability-toggles.store.ts:239-247` (the `finally` has no `isStale` check, unlike the `try`
  block's success/catch branches at `:227` and `:243`).
- Current handling: `isStale(workspace)` is checked before applying the optimistic-replace-with-result or the
  revert, but not before the pending-flag cleanup that always runs.
- Recommendation: capture the workspace generation the write started under and only call `removePending(key)`
  when `!isStale(workspace)`; when stale, leave the pending flag alone (it belongs to a different logical
  write now) or key `_pendingKeys` by `(workspace, key)` instead of `key` alone.

### 2. A `'global'`-scope control displays the workspace-effective value, not the global value

- Trigger: an entry with an active workspace override — `inheritedFrom: 'workspace'`, `effectiveEnabled` set
  to the override's value, `globalEnabled` set to a *different* value (e.g. globally ON, overridden OFF in
  this workspace) — rendered through `<ptah-capability-toggle [entry]="entry" scope="global" .../>`.
- Symptom: `checked` (`capability-toggle.component.ts:292-294`) is `entry.effectiveEnabled ?? recorded() ??
  false`, which prefers `effectiveEnabled` unconditionally, in every scope. For a `'global'` control this is
  wrong: `effectiveEnabled` reflects the *current workspace's* resolved value (workspace overrides included),
  not the value the `'global'` write actually addresses (`entry.globalEnabled`). The same value flows into
  `accessibleName` (`:314-317`, via `stateText`), so a screen reader announces "servername: off" for an "All
  workspaces" control whose true global record is ON. A user acting on the "All workspaces" control sees state
  that belongs to a different scope than the one they are about to write.
- Evidence: `capability-toggle.component.ts:283-299` (`recorded`/`checked` — `recorded()` is computed
  per-scope but `checked()` ignores it whenever `effectiveEnabled !== null`), `:313-317` (`accessibleName`
  uses the same `checked`-adjacent values).
- Current handling: none — the spec suite never renders a `scope="global"` control against an entry whose
  `inheritedFrom` is `'workspace'` (the closest case, `capability-toggle.component.spec.ts:208-212`, keeps
  `inheritedFrom: 'global'`, so `effectiveEnabled` and `globalEnabled` never actually diverge in any test).
- Recommendation: for a `'global'` control, `checked` should prefer `recorded()` (i.e. `globalEnabled ??
  default`) over the workspace-influenced `effectiveEnabled`, falling back to `effectiveEnabled` only when
  nothing is recorded at the global layer and the policy is otherwise known-default; or, at minimum, add a
  spec that renders a `'global'` control over a workspace-overridden entry and pins the intended behaviour
  before Batch 14 wires a consumer that could inherit this bug silently.

### 3. Non-exhaustive switch silently drops badges for a future `CapabilityValueOrigin`

- Trigger: `CapabilityValueOrigin` (`libs/shared/.../capability-toggle.types.ts:175-176`) gains a new member in
  a later batch (the union already has 5 cases that all look load-bearing, and PR 2 touches this area).
- Symptom: `capabilityBadges`'s `switch (entry.inheritedFrom)` (`capability-toggle.component.ts:80-124`) has no
  `default` branch and nothing asserts exhaustiveness (no `const _: never = …`), so a new origin value falls
  through the switch with zero badges and no compile error — the row silently loses its "why" explanation
  (override / imported / inheriting / etc.) instead of the change failing loudly at build time.
- Evidence: `capability-toggle.component.ts:80-124`.
- Current handling: none.
- Recommendation: add an exhaustiveness assertion (`default: { const _exhaustive: never = entry.inheritedFrom;
  return badges; }` or equivalent) so a new origin value is a compile error here, matching the pattern the
  team already uses for `HarnessSourcesStatus` (Batch 1, P1).

### 4. `connectors-page.component.spec.ts` — flaky, not caused by this batch

- The executor reported 2 failing tests once under load and passing alone. `connectors-page.component.ts`/
  `.spec.ts` has zero references to `CapabilityToggleComponent`, `CapabilityTogglesStore` or `capability` (`grep
  -n "CapabilityToggle\|capability" .../connectors-page.component.*` → no matches), so Batch 13's diff cannot
  be the cause by import graph. Ran standalone twice in this review (`npx jest ... connectors-page.component
  .spec.ts`): 27/27 passed both times, ~32s. The full project run
  (`nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`) also passed clean in this session.
  Assessment: flaky under parallel/load (timer- or resource-contention-sensitive), unrelated to Batch 13.

## Blocking issues

None.

## Serious issues

### 1. Cross-workspace pending-flag race (see Failure mode 1)

- File: `libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts:239-247`
- Scenario: toggle an item, switch workspace, toggle the same-named item in the new workspace before the old
  write resolves.
- Impact: the debounce guard against a second concurrent write for the same row can be defeated across a
  workspace switch; a user can send two overlapping `capabilities:setEnabled` calls for what looks like one
  write, and the control shows "not busy" while a write is still outstanding.
- Fix: guard `removePending` with the same `isStale(workspace)` check used for the optimistic-replace paths,
  or key pending state by `(workspace, key)`.

### 2. Global-scope control shows the wrong scope's value (see Failure mode 2)

- File: `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.ts:283-299,313-317`
- Scenario: an entry with a workspace override, rendered with `scope="global"`.
- Impact: the "All workspaces" toggle (and its accessible name) reports the current workspace's effective
  state instead of the actual global record, misinforming a user deciding whether to change the global value.
- Fix: make `checked`/`accessibleName` prefer the scope-appropriate recorded value (`globalEnabled` for a
  `'global'` control) over the cross-scope `effectiveEnabled`, and add a spec covering the divergent case.

## Moderate and minor issues

- Moderate: `capabilityBadges`'s switch over `CapabilityValueOrigin` has no exhaustiveness guard —
  `capability-toggle.component.ts:80-124` (Failure mode 3).
- Moderate: `withReason` forwards the backend's raw `result.error` string to the UI unsanitized —
  `capability-toggles.store.ts:333-336`. Not a defect introduced by this batch (the backend RPC handler that
  produces `result.error` is out of scope here), but worth the Batch 10/17 reviewer confirming that handler
  never puts a raw exception message or filesystem detail beyond the item path into that field.
- Minor: `nextToggleId` (`capability-toggle.component.ts:156`) is module-level, incrementing forever across the
  page's lifetime; harmless (an id counter, not a leak) but worth a one-line note if a future reviewer wonders
  why ids are non-deterministic across renders.

## Data flow

1. Page calls `store.ensure()` → `load()` calls `capabilities:getState` once → OK, superseded loads
   guarded by `loadGeneration`, workspace-checked before publish (`store.ts:252-283`).
2. User toggles a control → `onChange` reads `desired` from the DOM, resets the DOM to the row's current
   value, emits `desired` → OK, the row (not the DOM) stays the source of truth
   (`capability-toggle.component.ts:334-342`).
3. `store.setEnabled` → guards on `prior === undefined` or already-pending → optimistic replace → RPC call →
   OK for the happy path and the single-workspace race guard; gap at the cross-workspace pending cleanup
   (Failure mode 1).
4. RPC resolves → success replaces the row with the backend-resolved entry, and reloads once more if the
   policy was unverified; failure/throw reverts only if the row still shows this write's optimistic value → OK,
   matches AC-1.4 and the "fresher reload wins" spec case (`store.spec.ts:380-395`).
5. Workspace switch → `workspaceEffect` clears entries/status/reasons/pending/error and reloads → OK for the
   read side; the write side's `finally` is the one path that ignores this reset (Failure mode 1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| AC-1.4 (revert + error naming the item, no partial state) | COMPLETE | — |
| AC-1.5 (accessible name with item + state, keyboard-operable) | COMPLETE | Native checkbox, `aria-label` includes name and state; verified by spec. |
| AC-2.2 (scope-of-write text) | COMPLETE | `CAPABILITY_SCOPE_TEXT` rendered per scope input. |
| AC-2.3 (workspace toggle never writes global) | PARTIAL | Structurally enforced by the component's fixed `scope` input and the RPC param shape; no consumer exists yet in this batch to prove the wiring — defer final check to Batch 14. |
| AC-2.4 (workspace override shown, with source) | PARTIAL | Shown correctly for a `'workspace'`-scope control; a `'global'`-scope control over the same entry shows the wrong value (Serious #2). |
| AC-4.6 (ptah-off warning) | COMPLETE | — |
| AC-4.8 ("not enforced" labels from `CAPABILITY_ENFORCEMENT`, R6) | COMPLETE | Derived from the shared table, not literals; spec asserts derivation. |
| AC-4.9 (next-session note) | COMPLETE | — |
| Fail-closed banner (every unreadable path) | COMPLETE | Shell banner renders `reasons` from the store with no filtering. |

Implicit requirements not addressed: cross-workspace same-id write ordering (Serious #1) is not covered by any
existing acceptance criterion's wording but is squarely inside "toggle cannot be persisted → revert, no
partial state" territory once a second write can start while the first is still nominally "pending".

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Double toggle, same workspace | YES | `_pendingKeys` guard returns `'skipped'` synchronously | none |
| Double toggle across a workspace switch, same id | NO | pending flag cleared by the stale write's `finally` | Serious #1 |
| Revert vs. a newer reload | YES | `revert()` only restores when the row still equals `optimistic` | none |
| Unverified policy, toggle shown as unknown | YES | `effectiveEnabled === null` → `unknown` badge + indeterminate checkbox when nothing recorded | none |
| Successful write while unverified | YES | `void this.load()` triggers a re-read that can clear the banner | none |
| Workspace switch mid-write | PARTIAL | optimistic/revert/success paths are workspace-checked | pending-flag cleanup is not (Serious #1) |
| `'global'`-scope control over a workspace-overridden entry | NO | `checked`/`accessibleName` use the cross-scope effective value | Serious #2 |
| `[innerHTML]` usage | N/A | none present in the reviewed files | — |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Serious #2 — a `'global'` toggle can visibly misstate the actual global value whenever a workspace
  override is active, which is exactly the situation AC-2.4 exists to make legible; shipping this as the base
  for Batch 14's page wiring risks baking the wrong display into every page that offers a global control.
- What a robust implementation would add: (1) the `isStale` guard on the pending-flag cleanup (Serious #1);
  (2) a scope-correct `checked`/`accessibleName` for `'global'` controls plus a spec that renders a divergent
  workspace-override entry at `scope="global"` (Serious #2); (3) an exhaustiveness assertion on the
  `CapabilityValueOrigin` switch (Moderate); (4) a Batch 14 acceptance item to prove no template ever crosses
  `'workspace'`/`'global'` wiring (AC-2.3).

## Re-review round 1 — Batch 13

- Diff since round 0: `capability-toggles.store.ts` (+ spec), `capability-toggle.component.ts` (+ spec).
  `marketplace-shell.component.{ts,html}` unchanged.
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
  — lint, typecheck and test all PASS (2/3 tasks from cache, 9.7s).

### Prior findings

1. **Serious #1 (cross-workspace pending-flag race)** — RESOLVED. `finally` now guards the cleanup with
   `if (!this.isStale(workspace)) this.removePending(key);` (`capability-toggles.store.ts:244-247`), with an
   inline comment stating why. New regression spec
   `"a write from the previous workspace leaves the new workspace's pending flag alone"`
   (`capability-toggles.store.spec.ts:443-470`) drives the exact A→B same-id scenario: workspace A's write
   resolves after the switch, workspace B's write for the same key is still `isPending() === true` afterward,
   a same-key write attempted meanwhile is `'skipped'`, and B's own write still completes to `'saved'` and
   clears pending. Traced by hand against the code: correct.
2. **Serious #2 (global control shows workspace-effective value)** — RESOLVED. `capabilityControlState(entry,
   scope)` (`capability-toggle.component.ts:383-404`) now branches on scope: `workspace` reads
   `effectiveEnabled`, falling back to the recorded `workspaceEnabled` when unverified; `global` reads
   `globalEnabled` first, and only falls back to a derived default when nothing is recorded globally. `checked`,
   `indeterminate` and `accessibleName` all read through this one function
   (`capability-toggle.component.ts:298-302,317-319`), and the accessible name now appends the scope text, so
   "on"/"off" can never be read without the scope it belongs to. New specs cover both override directions on
   both scopes (`capability-toggle.component.spec.ts:162-247`), including the unverified+global case. Traced by
   hand: for `globalOnWorkspaceOff`/`globalOffWorkspaceOn` the workspace and global controls now correctly
   disagree with each other and each matches its own scope's recorded value.
3. **Moderate (non-exhaustive `CapabilityValueOrigin` switch)** — RESOLVED. `default:` branch added with
   `const unhandled: never = entry.inheritedFrom;` (`capability-toggle.component.ts:125-131`), so a new origin
   value is a compile error here, matching the `HarnessSourcesStatus` pattern from Batch 1 (P1).
4. **Moderate (raw backend error text forwarded to the UI)** — RESOLVED, further than asked: the row error is
   now always the fixed sentence `"Couldn't turn <label> <on|off>. The change wasn't saved; try again."`
   (`capability-toggles.store.ts:217`); the backend/transport text goes to `console.warn` only
   (`:231-234,241`). New spec asserts both halves: `errorFor(GITHUB)).not.toContain('EACCES')` and
   `warn).toHaveBeenCalledWith(expect.any(String), 'EACCES writing ...')`
   (`capability-toggles.store.spec.ts:302-324`). This is a stronger fix than the review asked for (which only
   flagged the *risk* of leaking backend detail) — no remaining concern.
5. **Minor (`nextToggleId` module-level counter)** — OPEN, unchanged, still genuinely minor (an id generator,
   not a resource leak); no action needed.
6. Result-type rename (`CapabilityInventory` → `CapabilitiesGetStateResult` in the store spec's import) — cosmetic
   alignment with the public RPC contract type; no behaviour change.

### New risk: `DEFAULT_REASON_ENABLED` duplicates shared `defaultEnabled`

- Location: `capability-toggle.component.ts:349-360`, consumed at `:401-403` (`capabilityControlState`'s
  global-scope fallback when nothing is recorded globally).
- Why it exists: a `'global'` control with nothing recorded at the global layer must show the *default* the
  item would get, but `CapabilityEntry` (`libs/shared/.../capability-toggle.types.ts:510-531`) carries only
  `defaultReason?: CapabilityDefaultReason` — the reason string — never the resolved boolean. The shared pure
  function that owns the real rule, `defaultEnabled` (`capability-toggle.types.ts:146-168`), cannot be called
  from the entry alone: its `mcp` branch needs `scopes: readonly CapabilityScope[]` and its `plugin` branch
  needs `source?: PluginSource`, neither of which the display entry carries. So the component built its own
  `Record<CapabilityDefaultReason, boolean>` restating the sixth-of-a-branch mapping by hand.
- **Correctness check (done by hand against `defaultEnabled`, all 7 `CapabilityDefaultReason` members):**

  | Reason | `defaultEnabled` says | `DEFAULT_REASON_ENABLED` says | Match |
  | --- | --- | --- | --- |
  | `ptah` | `true` (`:151-152`) | `true` | YES |
  | `user-scope` | `true` (`:154-155`) | `true` | YES |
  | `repository-only` | `false` (`:157-159`) | `false` | YES |
  | `undeclared` | `false` (`:157-159`) | `false` | YES |
  | `skill` | `true` (`:161-162`) | `true` | YES |
  | `plugin-opt-out` | `true` (`:163-165`) | `true` | YES |
  | `plugin-opt-in` | `false` (`:163-166`) | `false` | YES |

  The copy is correct today, for every reason the shared type currently defines. `Record<CapabilityDefaultReason,
  boolean>` also guarantees the table stays total (a new reason is a TS2741 compile error until the table is
  extended) — that half of "drift" is already caught by the type system.
- **What the type system does NOT catch**: whether the *value* attached to an existing reason stays correct if
  `defaultEnabled`'s logic for that reason ever changes (the boolean itself is free-standing prose in this
  file, not derived from shared). That is the real drift surface, and nothing today exercises it.
- **Is a drift test sufficient, or must the value come from the backend?** A drift test is sufficient here, and
  is the smaller-blast-radius fix. Reasoning: (a) every `CapabilityDefaultReason` value maps to exactly one
  boolean in `defaultEnabled` regardless of the specific `id`/`scopes`/`source` supplied — the reason itself is
  1:1 with the boolean by construction of that function (each `return` statement pairs a fixed `enabled` with a
  fixed `reason` literal) — so a test can call the *real* `defaultEnabled` with minimal fixture inputs
  engineered to produce each reason, and assert `.enabled === DEFAULT_REASON_ENABLED[reason]`, without needing
  the entry to carry more data; (b) moving the boolean onto `CapabilityEntry` itself (e.g. a
  `defaultEnabled: boolean` field next to `defaultReason`) is the structurally cleaner fix but touches the
  shared type, the resolver that populates entries (`cli-agent-runtime`, a different Nx project, Batch 4/7's
  territory, already merged) and this batch's UI — out of proportion for a round-1 fix and outside this
  batch's file set; (c) a same-file drift spec closes the actual risk (silent semantic drift) without opening
  a new project boundary or adding a file.
- **Status: OPEN.** No drift test exists yet in `capability-toggle.component.spec.ts` — `grep -n
  "DEFAULT_REASON_ENABLED\|defaultEnabled" libs/frontend/marketplace/src/lib/ui/capability-toggle.component
  .spec.ts` has no match. This is the only remaining required change.
- Recommended fix (adds no file): in `capability-toggle.component.spec.ts`, import `defaultEnabled` from
  `@ptah-extension/shared` and add one `it.each` over the 7 `CapabilityDefaultReason` values that builds the
  minimal `CapabilityDefaultInput` known to produce each reason (e.g. `{kind:'mcp', id:'x', scopes:['global']}`
  for `user-scope`, `{kind:'mcp', id: PTAH_MCP_SERVER_NAME, scopes:[]}` for `ptah`,
  `{kind:'plugin', id:'p', source: <opt-out fixture>}` for `plugin-opt-out`, etc.) and asserts
  `defaultEnabled(input).enabled === DEFAULT_REASON_ENABLED[reason]`. `DEFAULT_REASON_ENABLED` itself is not
  exported today (`capability-toggle.component.ts:350-360` has no `export`); export it (or export a small
  accessor) so the spec can address it directly rather than re-deriving it through `capabilityControlState`
  indirection.

### Re-review verdict

- Recommendation: **REVISE** (round 2 needed, but narrowly scoped)
- Confidence: HIGH
- Both round-0 Serious issues and both round-0 Moderate issues are RESOLVED, each with a targeted regression
  spec that fails without the fix (traced by hand, not just re-reading the diff).
- The single remaining item is the missing drift test for `DEFAULT_REASON_ENABLED`. The table itself is
  correct today (verified by hand against every `CapabilityDefaultReason` member above); this is a
  process/regression gap, not a live display bug, so it does not block on its own merits — but since the
  coordinator asked for a ruling and no test exists yet, round 2 should land the `it.each` drift spec described
  above before APPROVE. No other action is required; do not move the boolean onto `CapabilityEntry` or touch
  `libs/shared` for this — that would be disproportionate to the risk and outside this batch's file budget.

## Re-review round 2 — Batch 13 (final)

- Diff since round 1: only `capability-toggle.component.spec.ts` changed. `capability-toggle.component.ts`
  and `capability-toggles.store.ts` (+ its spec) are unchanged from round 1.
- Added: `INPUT_FOR_REASON: Record<CapabilityDefaultReason, CapabilityDefaultInput>`
  (`capability-toggle.component.spec.ts:260-271`) — a `Record` over the full reason union, so a new
  `CapabilityDefaultReason` member is a compile error here until given a fixture, closing the same
  compile-time-total gap noted in round 1. One `it.each` over all 7 reasons (`:274-291`) that (a) calls the
  real shared `defaultEnabled(INPUT_FOR_REASON[reason])` and asserts `shared.reason === reason` (proving each
  fixture actually produces the reason it claims to, so the test can't silently drift from its own input), then
  (b) builds a `'global'`-scope entry with nothing recorded globally
  (`globalEnabled` omitted) and a workspace override deliberately set to `!shared.enabled`, and asserts
  `capabilityControlState(overridden, 'global').value === shared.enabled`. Because nothing is recorded
  globally and `inheritedFrom` is `'workspace'` (not `'default'`), `capabilityControlState`'s global branch is
  forced through the `DEFAULT_REASON_ENABLED[entry.defaultReason]` fallback
  (`capability-toggle.component.ts:401-403`), so the assertion exercises the component's table for real, not a
  re-statement of it, and the opposing workspace override rules out the entry's own `effectiveEnabled`/
  `workspaceEnabled` leaking into the result.
- **Guard verified by live mutation** (not just static reasoning): flipped
  `capability-toggle.component.ts:353` from `ptah: true` to `ptah: false` (backed up the file first), ran
  `npx jest --config libs/frontend/marketplace/jest.config.ts capability-toggle.component.spec.ts`. Result:
  `global default matches the shared defaultEnabled rule › ptah` FAILED —
  `Expected: true, Received: false` at `capability-toggle.component.spec.ts:288`, all 39 other tests in the
  file still passed. Restored the file from the backup immediately after
  (`git status --short` on `capability-toggle.component.ts` shows no diff, confirmed clean). The guard
  demonstrably fails when the component's table and shared `defaultEnabled` disagree, for at least the `ptah`
  reason, and by construction (`it.each` over the full union) the same mechanism covers all 7.
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
  — lint, typecheck and test all PASS (2/3 tasks from cache, 17.6s), run after the mutation was reverted.
- Round-1 open item ("no drift test exists yet") is RESOLVED. No new issues found in this round; the spec-only
  diff introduces no production code.

### Re-review round 2 verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- All Blocking/Serious/Moderate items from round 0 and the drift-test gap from round 1 are resolved, each with
  a regression spec verified (by hand or by live mutation) to actually fail without the fix.
- Nothing left for the user. One pre-existing, non-blocking note carried forward for whoever wires Batch 14:
  AC-2.3 ("a workspace toggle never writes global") is enforced structurally by this component's fixed `scope`
  input plus the RPC param shape, but has no consumer yet in this repository to prove the template wiring
  itself — record it as a Batch 14 acceptance item, not a re-open of Batch 13. The `nextToggleId` module-level
  counter (round 0, Minor) remains open but is cosmetic and needs no action.

# Code Logic Review — Batch 10

Worktree reviewed: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-560-b10`
(`feat/task-2026-560-b10-capability-rpc`, base `9708db51b`). Files: `capability-rpc.handlers.ts` (+ spec, 28
cases), `handlers/index.ts`, `index.ts`, `host-profile/manifest.ts`. B7 (the resolver) is not yet on this
base; read directly from `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-560-b7\...\capability-resolver.service.ts`
to check the handler's calls against the resolver's actual contract.

## Summary

| Metric              | Value  |
| -------------------- | ------ |
| Overall score         | 8/10   |
| Assessment             | APPROVE |
| Blocking issues        | 0      |
| Serious issues         | 0      |
| Moderate issues        | 1      |
| Failure modes found    | 1 (non-blocking, already safe) |

Scope reviewed: full contents of `capability-rpc.handlers.ts` (447 lines) and its spec (509 lines, 28 cases);
`manifest.ts`/`index.ts` diffs; `capability-resolver.service.ts` in the B7 worktree end to end (all four
`ICapabilityResolver` methods, `setRequestSchema`, `setExplicit`'s own validation, `CapabilityRequestError`,
`CapabilityToggleStoreError`, `isCapabilityPolicyUnknownError`); the three hosts' DI wiring
(`apps/ptah-extension-vscode/src/di/{container,phase-2-libraries,phase-3-handlers}.ts` +
`activation/bootstrap.ts`, `apps/ptah-electron/src/di/{container,phase-2-libraries,phase-4-handlers}.ts` +
`activation/wire-runtime.ts`, `libs/backend/cli-engine/src/lib/container.ts`) and
`register-rpc-surface.ts`/`manifest.ts`'s `resolveRpcHandlerPlan`/`registerHandlers`; `rpc-allowlist.spec.ts`.
Ran `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p
@ptah-extension/rpc-handlers --parallel=2` in the b10 worktree — 1 project, lint/typecheck/test all green (Nx
flagged the run as "flaky" only because of its own cloud-cache 401, not a test failure); confirmed
`voice-rpc.handlers.spec.ts` has zero diff against base (untouched, so the once-seen timeout is unrelated to
this batch).

## Five logic questions

### 1. How does this fail silently?

No silent-success path found. Every resolver failure in `handleGetState`/`handleGetEffective`/`handleSetEnabled`
is caught and re-thrown as an `Error` (`capability-rpc.handlers.ts:224-227, 257-259, 302-306`); the RPC layer
therefore always surfaces a failed promise to the caller, never a default/empty value standing in for a real
error. `readSchemaTokens` (`:359-372`) is the one place a failure is swallowed into a degraded-but-successful
result (`null` → every row omits `schemaTokens`), and that is the documented, tested contract (AC-5.2): "size
unknown" is distinguishable from "zero" by the field's absence, and `logger.warn` records the underlying
failure so it is not invisible to the host, only to the caller. This is a deliberate degrade, not a defect.

### 2. What user action produces unexpected behaviour?

Toggling a capability whose id the handler's own `assertKnownItem` approved, but which the resolver's own
write path (`setMcp`/`requireKnownPluginOrSkill`) then finds missing on its own, freshly-read snapshot (a
TOCTOU window between the handler's `list()` call and the resolver's re-read inside `set()`/`setExplicit()`):
the user gets `WRITE_FALLBACK_REASON` ("the change was not applied") rather than `INVALID_PARAMS` ("is not in
this workspace's capability list") — see Moderate-1. The outcome is still a rejected write with no leaked
internal text either way, so this is a message-precision gap, not a correctness or safety gap.

### 3. What input data produces a wrong answer?

None found. `CapabilitiesSetEnabledSchema`'s `superRefine` correctly restricts `explicit: true` to
`scope: 'workspace'` + `kind: 'mcp'` + `enabled: true` (`:106-129`), matching the resolver's own
`setExplicit(cwd, kind: 'mcp', id, enabled: true)` signature and its runtime guard
(`capability-resolver.service.ts:235-242`) exactly — the RPC schema cannot construct a call the resolver would
itself reject for a different reason. The id boundary (`min(1)`, `max(1024)`, no C0/DEL control characters,
`:95-101`) is strictly tighter than the resolver's own `setRequestSchema` (`id: z.string().min(1)`,
`capability-resolver.service.ts:137-143`, no upper bound or character filter) — a defense-in-depth narrowing,
not a mismatch that could reject a value the resolver would accept as meaningful.

### 4. What happens when a dependency fails?

- `resolver.list()` failing in `handleGetState` or in `assertKnownItem` → caught, logged with full detail via
  `logFailure`, re-thrown as a fixed-text error (`safeReason`, `:422-430`) — never the raw message. Verified
  by spec (`:247-262`, `EACCES: /home/user/...` never reaches the caller).
- `resolver.resolve()` failing in `handleGetEffective` → per the resolver's own contract ("resolve... never
  throws"), this is explicitly a "if it ever does" backstop (`:254-260`) and is still caught and translated.
- `resolver.set()`/`setExplicit()` failing → `CapabilityToggleStoreError` → "the setting could not be saved";
  a `isCapabilityPolicyUnknownError` → "the capability policy could not be read"; anything else (including
  `CapabilityRequestError`, e.g. `Unknown MCP server "x"` from a TOCTOU race) → generic
  `WRITE_FALLBACK_REASON`. All three are exercised by spec (`:441-507`) with explicit assertions that `EPERM`,
  `.ptah`, and other path/errno fragments never appear in the thrown message.
- `schemaSize.schemaTokensFor()` failing/timing out → caught, logged, degrades to "unknown" for every row
  (`:359-372`), tested at `:221-236`.

### 5. What is missing that the requirements never mentioned?

Nothing found that belongs to this batch. Two items are genuinely out of this batch's scope but worth
recording as cross-batch: (a) whether the webview actually renders `WORKSPACE_NOT_OPEN` and the fixed
`INVALID_PARAMS`/write-failure text usefully — this handler only guarantees the *server* never leaks
internals, not that the UI shows something coherent; (b) `SDK_MCP_SCHEMA_SIZE` is not registered by any host
yet (PR 2/B20), so `schemaTokens` is unconditionally absent in production today — the docstring already flags
this (`:32-36`) and the manifest comment does not, but this is by design for this batch, not a gap.

## Failure modes

### Double id-existence check: handler's `assertKnownItem` vs. the resolver's own write-time check

- Trigger: `capabilities:setEnabled` with `scope: 'workspace'`/`'global'`, any kind.
- Symptom (none, confirmed): the handler's `assertKnownItem` (`:316-342`) reads the inventory via
  `resolver.list(cwd)` and rejects with `INVALID_PARAMS` before ever calling `resolver.set()`/`setExplicit()`
  — but only when `inventory.status === 'verified'`; when `'unverified'` it is skipped entirely and the call
  proceeds straight to the resolver. Read `capability-resolver.service.ts` end to end to check whether this
  skip could widen what a caller can write: it cannot. `setMcp` (`:538-547`) throws `CapabilityRequestError`
  for an id absent from its own freshly-computed `mcpRows(...)`; `setPluginOrSkillGlobal`/
  `setPluginOrSkillWorkspace` both route through `requireKnownPluginOrSkill` (`:647-663`), which throws for
  any id absent from the plugin/skill catalog or config layer. Every write path the RPC handler can reach
  re-validates the id itself, regardless of whether the handler's own pre-check ran. The `assertKnownItem`
  skip on `'unverified'` therefore costs nothing in enforcement — it is exactly what the docstring at `:24`
  and the spec at `:397-409` claim: a friendlier `INVALID_PARAMS` message when the check *can* run cheaply,
  never a security boundary.
- Evidence: `capability-rpc.handlers.ts:316-342`; `capability-resolver.service.ts:538-547, 647-663`.
- Current handling: correct — no TOCTOU widening risk. The only cost is the message-precision gap recorded as
  Moderate-1 below (a benign race narrows the error, not the enforcement).
- Recommendation: none required. Worth a one-line comment addition noting explicitly that the resolver
  re-validates regardless, so a future edit to `assertKnownItem` is not tempted to treat it as load-bearing
  for safety.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **(Moderate)** A TOCTOU between `assertKnownItem`'s `list()` read and the resolver's own re-read inside
   `set()`/`setExplicit()` — an id present at check time but removed/renamed before the write — surfaces as
   the generic `WRITE_FALLBACK_REASON` ("the change was not applied") rather than the more precise
   `INVALID_PARAMS` ("is not in this workspace's capability list"), because `safeReason` (`:422-430`) does not
   special-case the resolver's `CapabilityRequestError` name. Not a safety issue (established above — the
   write is still correctly rejected, and no internal text leaks), only a message-precision gap under a
   narrow, low-frequency race. `capability-rpc.handlers.ts:301-306, 422-430`;
   `capability-resolver.service.ts:546, 659`. Fix (optional): add an `errorName(error) ===
   'CapabilityRequestError'` branch to `safeReason` returning the same "is not in this workspace's capability
   list" wording `assertKnownItem` already uses.

## Data flow

1. `capabilities:getState`/`getEffective` params → `parseParams(CapabilitiesNoParamsSchema, ...)` → accepts
   `undefined`/`null`/`{}`/extra fields — OK, matches "no method takes a root" contract and the spec's
   "answers with no params at all" case (`:176-181`).
2. `workspaceProvider.getWorkspaceRoot()` → `requireWorkspace` → `cwd` string or `WORKSPACE_NOT_OPEN` before
   any resolver call — OK; spec confirms `resolver.list`/`resolve`/`set` are never invoked when unset
   (`:238-245, 275-282, 411-425, 427-439`).
3. `cwd` → `resolver.list(cwd)` / `resolver.resolve(cwd)` → `CapabilityInventory` /
   `EffectiveCapabilitySet` — OK; the resolver canonicalizes `cwd` to `physicalRoot`/`policyKey` itself
   (`capability-resolver.service.ts:253-276`), so the handler never needs to and cannot address a policy
   outside the passed workspace.
4. `capabilities:setEnabled` params → `CapabilitiesSetEnabledSchema` (zod + `superRefine`) → typed input or
   `INVALID_PARAMS` — OK; every combination the resolver's `setExplicit` cannot express
   (`explicit`+`global`, `explicit`+non-`mcp`, `explicit`+`enabled:false`) is rejected before any I/O, matching
   the resolver's own guard.
5. Typed input → `assertKnownItem` (list + membership check, skipped when unverified) → resolver
   `set`/`setExplicit` → `CapabilityEntry` returned as `{ entry }` — OK; resolver re-validates unconditionally
   (Failure modes above), so the skip cannot widen what gets written.
6. Any thrown error at any step → `logFailure` (full detail to the host log only) + `safeReason` (fixed,
   non-leaking text) → one `Error` naming the item and a safe reason — OK, AC-1.4 satisfied and pinned by
   spec (`:441-471` for the store-error case, `:473-490` for policy-unknown, `:492-507` for generic).
7. `CapabilityInventory.entries` → `readSchemaTokens` (optional, gated on `SDK_MCP_SCHEMA_SIZE` being
   registered) → `withSchemaTokens` (mcp-only, finite/non-negative guard, `:436-446`) → response — OK, AC-5.2
   satisfied; "size unknown" (field absent) is never conflated with `0`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Zod at entry, clear `INVALID_PARAMS` naming failing fields (Boundaries) | COMPLETE | None; `parseParams` caps at 5 reported issues and prefixes each with its path |
| `explicit` restricted to workspace+mcp+enabled:true (N6, plan C8) | COMPLETE | None; matches resolver's `setExplicit` signature exactly |
| Id length/control-char boundary | COMPLETE | Stricter than the resolver's own schema (by design, defense in depth) |
| AC-1.4 (error names the item, fixed safe reason, no leaked path/errno text) | COMPLETE | Verified against real `EACCES`/`EPERM`/`.ptah` path fragments in spec assertions |
| AC-5.2 (`schemaTokens` only when the port is registered; "unknown" never "zero") | COMPLETE | None; gated correctly, `Number.isFinite`/`>= 0` guard present |
| No-workspace behaviour (`WORKSPACE_NOT_OPEN`, resolver never touched) | COMPLETE for this batch | Whether the webview renders this cleanly is UI-batch scope, not reviewable here |
| Manifest ownership (`rpc-allowlist.spec.ts` invariants) | COMPLETE | `capabilities` entry has a `handler`, a unique key, and its three methods are claimed exactly once |
| Resolver required-inject boot ordering across all three hosts | COMPLETE | Traced: `registerCliAgentRuntimeServices` runs during each host's DI *registration* phase, strictly before `registerRpcSurface` *resolves* `CapabilityRpcHandlers` (vscode: `DIContainer.setup()` before `registerRpcSurface` in `bootstrap.ts`; electron: phase 2 before phase 4 in `container.ts`, `registerRpcSurface` later in `wireRuntimePreWindow`; cli-engine: line 677 before line 884 in `container.ts`) — no boot-time defect on any host once B7 lands |

Implicit requirements not addressed: none found beyond the TOCTOU message-precision item (Moderate-1), which is
a polish item, not a missed requirement.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `explicit: true` + `scope: 'global'` | YES | `superRefine` issue on `explicit` path, `INVALID_PARAMS` | None |
| `explicit: true` + non-mcp kind | YES | Same | None |
| `explicit: true` + `enabled: false` | YES | Same | None |
| Empty id / control character in id / id > 1024 chars | YES | `.min(1)`/`.refine(hasNoControlCharacters)`/`.max(1024)` | None |
| No workspace open, any method | YES | `WORKSPACE_NOT_OPEN`, resolver never called | UI handling out of this batch's scope |
| Unknown id, verified inventory | YES | `INVALID_PARAMS` before any write | None |
| Unknown id, unverified inventory | YES (deferred) | Resolver's own write-time check still rejects it | Surfaces as generic write-failure text, not `INVALID_PARAMS` (Moderate-1) |
| `SDK_MCP_SCHEMA_SIZE` unregistered / throws / times out | YES | Every row omits `schemaTokens`, logged as a warning | None |
| Resolver `list`/`resolve`/`set`/`setExplicit` throwing store or policy errors | YES | Fixed safe text per error name, full detail logged | None |
| Old webview sending extra/absent params | YES | `.passthrough().nullish()` on the no-params schema | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The one real (non-blocking) finding is that a narrow TOCTOU between the handler's
  own existence check and the resolver's write-time re-check downgrades an otherwise-correct rejection from a
  precise `INVALID_PARAMS` to a generic "the change was not applied" — the write is still safely rejected
  either way, and no internal detail leaks in either branch.
- What a robust implementation would add: (1) teach `safeReason` to recognize
  `CapabilityRequestError` by name so the TOCTOU-narrowed case reports the same precise text
  `assertKnownItem` uses; (2) once B20 registers `SDK_MCP_SCHEMA_SIZE`, a follow-up spec asserting the real
  service's shape matches `McpSchemaSizeReader` structurally (today it is a locally-declared port, correctly
  flagged in the file's own docstring); (3) a DI-ordering regression spec analogous to the one already
  requested for B7's `PluginLoaderService`/`SDK_CAPABILITY_GLOBAL_LAYER` ordering, covering
  `registerCliAgentRuntimeServices` before `registerRpcSurface` across all three hosts, so this batch's
  "traced safe" finding is pinned by a test rather than by manual review.

## Cross-batch items

- For the B7/B20 reviewers: `McpSchemaSizeReader` (`capability-rpc.handlers.ts:141-143`) is a locally-declared
  structural port, not yet backed by a real `SDK_MCP_SCHEMA_SIZE` registration on any host — confirm the B20
  `McpSchemaSizeService` implementation's `schemaTokensFor(cwd): Promise<ReadonlyMap<string, number>>` matches
  this shape exactly when it lands, since nothing here enforces it beyond structural typing.
- For whichever batch owns the webview capabilities panel: confirm it handles `WORKSPACE_NOT_OPEN` and the
  fixed `INVALID_PARAMS`/write-failure error text from this handler with a coherent UI state — this batch
  guarantees only that the server never leaks internal detail, not that the client renders something useful.
- The `voice-rpc.handlers.spec.ts` timeout mentioned in the task brief is confirmed unrelated: zero diff

---

# Code Logic Review — Batch 3

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVE                              |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2                                    |

Scope read in full: `plugin-config-source-resolver.ts` (+ new `.spec.ts`), `harness-source.port.ts`,
`harness-reconciler.service.ts` (full file), the new `harness-reconciler.capability-policy.spec.ts`,
`agent-workspace-scope.spec.ts` diff, `apps/ptah-electron/src/di/phase-2-libraries.ts` diff,
`harness-skill-selection-rpc.service.ts` (full file) + its spec diff. Also read, for cross-file context:
`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:150-190`, `libs/backend/cli-engine/src/lib/container.ts:620-660`,
`libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.ts` (full), `libs/shared/src/lib/types/capability-id-codec.ts:218-226`,
`libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts` (collision-building slice),
`libs/backend/harness-sync/src/lib/manifest-store/managed-manifest.ts:61` (entry `kind` enum).

## Acceptance-item ruling table

| # | Item | Ruling | Proving evidence |
| --- | --- | --- | --- |
| 1 | One-snapshot read: `getEffectivePluginConfig` called once, no workspace-only sync call mixed in | PASS | `plugin-config-source-resolver.ts:196-198,232-260`; proved by `plugin-config-source-resolver.spec.ts:82-108` (sync members are `jest.fn()` that fail the test if called, and are asserted `not.toHaveBeenCalled()`) |
| 2 | A reader without the method keeps today's synchronous path | PASS | `plugin-config-source-resolver.ts:196` (`typeof ... === 'function'` gate); proved by `plugin-config-source-resolver.spec.ts:150-165` (`resolve()` returns a non-`Promise` value) |
| 3 | Policy-unknown → frozen: zero skill/plugin/agent writes and removals; MCP intents still proceed | PASS | `harness-reconciler.service.ts:1002-1055` (`freezeToMcp` filters `writes`/`removals` to `kind === 'mcp'`); proved by `harness-reconciler.capability-policy.spec.ts:301-329` (`[AC-3.4]`, disk-level: `hasCopy` stays absent, `store.load(...).entries` unchanged) and `:440-459` (`[C3]`, plan-level: only `.mcp.json#github`/`#stale` survive) |
| 4 | Command writes/migrations held under policy-unknown — correct or regression? | PASS (correct, not a regression) | `managed-manifest.ts:61` defines entry `kind` as `'skill' \| 'command' \| 'agent' \| 'mcp'`; `freezeToMcp` keeps only `'mcp'`, so commands are frozen alongside skills/agents. This matches the plan's intent (implementation-plan.md:257-266, "skips skill, plugin and agent planning") read broadly: commands are plugin-owned artifacts exactly like skills, so leaving them out of a policy-blind pass is consistent, not narrower or wider than the skill/agent case. Migrations held (`migrations: []`, `harness-reconciler.service.ts:1050`) is justified in the function's own docstring ("each is a one-time repair a later, readable pass still finds") and proved by `harness-reconciler.capability-policy.spec.ts:456` (`applied[0].migrations` is `[]` when frozen, `:471` shows it survives untouched when known). Ruled correct: freezing strictly more than the letter of the plan text is the safe direction under R8 (never widen on unknown), never the unsafe one. |
| 5 | Health `sources` reads `'policy-unknown'` | PASS | `policyHealth()` at `harness-reconciler.service.ts:1006-1017`, applied at both call sites (`:246` verify, `:448` reconcile); proved by `harness-reconciler.capability-policy.spec.ts:317,328,448` |
| 6 | Fingerprint stamped on reconcile and verify | PASS, with a documented and tested exception | Stamped whenever `source.policyFingerprint` is defined (`policyHealth`, same lines). Proved for the KNOWN-policy case by `harness-reconciler.capability-policy.spec.ts:284-299` (`[AC-3.3]`, both `reconciled.policyFingerprint` and `verified.policyFingerprint` equal the reader's fingerprint). For the FROZEN case, `resolveEffective`'s catch branch returns `{ ...empty, policyUnknown: true }` (`plugin-config-source-resolver.ts:255-256`) and `empty` never carries a fingerprint — so a frozen pass's health has **no** `policyFingerprint`, and the spec asserts this deliberately: `harness-reconciler.capability-policy.spec.ts:318`, `expect(health.policyFingerprint).toBeUndefined()`. See Failure mode 1 below for why this is not itself a defect, and the residual risk it leaves in `HarnessPolicySync` (owned by a different batch, not editable here). |
| 7 | Electron wrapper forwards root and folds dormant slugs | PASS | `phase-2-libraries.ts:246-260`: `getEffectivePluginConfig` forwards `workspaceRoot` to `loader.getEffectivePluginConfig(workspaceRoot)` and spreads `readDormantSkillSlugs(container)` into `config.disabledSkillIds`, mirroring the existing `getDisabledSkillIds` wrapper's pattern one block above |
| 8 | VS Code / CLI pass the loader unwrapped | PASS | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:173-178` and `libs/backend/cli-engine/src/lib/container.ts:645-650` both do `container.resolve<HarnessPluginConfigReader>(SDK_TOKENS.SDK_PLUGIN_LOADER)` and hand that value straight to `createPluginConfigSourceResolver`, with no wrapping object — confirmed no edit to either file on this branch (`git diff --name-only` does not list them). `PluginLoaderService.getEffectivePluginConfig` exists (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`, landed in an earlier batch), so the structural match holds without any Batch 3 change |
| 9 | R2: no `agent-sdk` import in harness-sync | PASS | `grep agent-sdk` over the five touched harness-sync files returns only doc comments (`plugin-config-source-resolver.ts:8,55-56,71,252`, `harness-source.port.ts:6`, `index.ts:10`) — zero `import` statements |
| 10 | R12: existing reconciler specs unchanged | PASS | `git diff --name-only -- 'libs/backend/harness-sync/src/lib/reconciler/*.spec.ts'` is empty; only the new `harness-reconciler.capability-policy.spec.ts` was added |
| 11 | Third caller: `getSelection()` async, every call site awaited | PASS | `harness-skill-selection-rpc.service.ts:80,89` (`async` + `await`); the only other call site, `harness-rpc.handlers.ts:1003`, is inside an `async` handler that already returns the promise. Repo-wide grep for `sourceResolver.resolve(` and `.getSelection()` across `libs/` and `apps/` finds exactly three `resolve()` call sites (the two in the reconciler, already awaited pre-existing, and this one) and one other `getSelection()` caller — no unawaited caller remains |

## Five logic questions

### 1. How does this fail silently?

- The most consequential silent-looking path is the deliberate one: `resolveEffective`'s catch clause for a
  *non*-policy-unknown error (`plugin-config-source-resolver.ts:250,258`, `return empty;`) discards the real
  error and returns an unfiltered `empty` state — no `policyUnknown`, no log, nothing. This is not new
  behaviour (the pre-existing synchronous path at `:216-218` does the same on any `getWorkspacePluginConfig`
  throw), and it is proved intentional by `plugin-config-source-resolver.spec.ts:124-135`
  ("keeps the unfiltered empty state for any other read failure, never frozen"). It is still worth naming: a
  transient, non-policy read failure (e.g. a corrupt cache file that throws `TypeError` rather than
  `CapabilityPolicyUnknownError`) reconciles as if the global layer did not exist at all, silently narrowing to
  workspace-only-shaped defaults with no `policyUnknown` flag and no distinguishing health signal from an
  ordinary healthy pass with nothing global set. There is no logging at this call site (contrast with the
  `frozen` branch's explicit `this.logger.warn` at `harness-reconciler.service.ts:391-395`).
- `resolve()`'s outer `readerFactory()` throw and `reader === null` paths (`:191-194`) also return `empty`
  silently, unchanged from before this batch.

### 2. What user action produces unexpected behaviour?

- A user who globally disables a skill/plugin while their workspace layer briefly throws a non-policy error
  (item 1 above) will see the harness apply as if nothing were globally off, with no `policy-unknown` badge to
  warn them — a narrower silent failure than the fully-unknown case, but real. This requires a specific and
  unusual failure shape (`getEffectivePluginConfig` throwing something that is not the recognised
  `CapabilityPolicyUnknownError`), which is outside this batch's stated contract (R8 protects only against
  "unknown policy", by design), so this is Moderate, not Blocking.
- A user session that starts while the capability policy is genuinely unreadable will have `HarnessPolicySync`
  (agent-sdk, not part of this diff) retry `preflight.ensure(..., { force: true })` on every session start for
  as long as the policy stays unreadable, because a frozen pass never carries a `policyFingerprint`
  (`isHarnessPassAcknowledged` requires both a fingerprint match and `sources === 'ok'`, both of which a frozen
  health fails permanently — see Failure mode 1). This is very likely the intended fail-closed behaviour (retry
  until readable) rather than a defect, but it is a real, unbounded-while-broken cost that a reviewer of this
  batch's acceptance item asked to be traced explicitly.

### 3. What input data produces a wrong answer?

- `desired.collisions` at both health-assembly sites (`:246`, `:448`) is taken from `desired`, which is built
  from the UNFILTERED source state even when frozen (`resolveEffective`'s policy-unknown branch clears
  `disabledSkillIds`/`overlayPluginPaths` back to `[]`, not to "everything disabled" — confirmed by
  `harness-manifest.builder.ts:270-344` reading `sources.disabledSkillIds`/`pluginGate` off that same state).
  So a frozen pass's health can report a naming collision between two skills that will never actually be
  written this pass (writes are filtered to `mcp` only). This is diagnostic-only (no write follows from
  `collisions`) and the whole health object is already tagged `sources: 'policy-unknown'`, so a caller has the
  context to discount it — Moderate, not Serious.

### 4. What happens when a dependency fails?

- `getEffectivePluginConfig` rejecting with `CapabilityPolicyUnknownError` → frozen, `policyUnknown: true`,
  proved end-to-end on disk by the new reconciler spec.
- `getEffectivePluginConfig` rejecting/throwing with any other error → unfiltered `empty`, same as the
  pre-existing synchronous failure mode (see question 1).
- `getEffectivePluginConfig` resolving to `undefined` (a reader that declares the method but hands back nothing)
  → `resolveEffective` returns `empty` at `:239` — not exercised by a spec case, but the code path is a single
  guarded early return and structurally identical to the "reader returns nothing useful" cases already covered.
- The reconciler's own dependencies (`target.plan`, `target.apply`) are unaffected by this batch's changes;
  their existing try/catch-per-target behaviour (`:585-680`, `:222-236` in `verify`) is untouched.

### 5. What is missing that the requirements never mentioned?

- No log line distinguishes "policy unknown, frozen" (logged) from "policy read failed for some other reason,
  unfiltered fallback" (silent) — see question 1. The plan and batch text only ever discuss the
  policy-unknown case; the generic-failure fallback predates this batch and inherits its silence.
- `HarnessPolicySync`'s permanent-unacknowledged-while-unknown loop (question 2) is a natural consequence of
  this batch's contract (no fingerprint when unknown) but is never named as a cost anywhere in the plan or
  batch text; it lives entirely in a different batch's file (`harness-policy-sync.ts`, not part of this diff)
  and so cannot be fixed here, only flagged.

## Failure modes

### 1. Frozen passes are permanently unacknowledgeable by `HarnessPolicySync`

- Trigger: the capability policy stays unreadable (`CapabilityPolicyUnknownError`) across repeated
  `HarnessPolicySync.apply()` calls (e.g. one per session start).
- Symptom: `HarnessPolicySync` forces a harness preflight on every single call while broken (bypasses its own
  throttle), because `isHarnessPassAcknowledged` requires `health.sources === 'ok'` AND a fingerprint match
  (`capability-id-codec.ts:222-225`), and a frozen health has neither (`sources: 'policy-unknown'`, no
  `policyFingerprint`). `harness-policy-sync.ts:104` deletes the `lastAck` entry on every miss, so the next
  `apply()` call also forces.
- Evidence: `harness-reconciler.capability-policy.spec.ts:318` (`expect(health.policyFingerprint).toBeUndefined()`
  when frozen), `harness-policy-sync.ts:87-108`, `capability-id-codec.ts:218-226`.
- Current handling: this is very likely intentional — the class's own docstring
  (`harness-policy-sync.ts:14-17`) already anticipates "one more forced pass runs — at most one" per `apply()`
  call, and forcing again on the *next* `apply()` while the policy is still broken is the correct fail-closed
  posture (never treat an unreadable policy as "already applied"). It is not caused by a code defect in this
  batch — `sources !== 'ok'` alone would already block acknowledgement even if a fingerprint were stamped.
- Recommendation: none required of this batch (the file is out of scope and the behaviour is defensible). Worth
  a one-line callout in the PR description or a follow-up task, since it means a machine with a persistently
  broken capability store pays a forced harness preflight on every session start indefinitely, not just once.

### 2. Generic (non-policy-unknown) read failures on the effective path stay silently unfiltered

- Trigger: `reader.getEffectivePluginConfig` throws/rejects with an error that is not recognised by
  `isCapabilityPolicyUnknownError` (wrong `name`, e.g. a plain `TypeError` from a corrupt cache read).
- Symptom: the resulting `HarnessSourceState` is `empty` (no overlay filtering applied, nothing marked
  `policyUnknown`), and the health this pass reports has `sources` computed from `desired.sources` as if
  nothing were globally disabled — indistinguishable, in the reported health, from "the global layer had
  nothing to say."
- Evidence: `plugin-config-source-resolver.ts:250-259` (catch branch, `return empty` with no log), proved as a
  deliberate contract (not an oversight) by `plugin-config-source-resolver.spec.ts:124-135`.
- Current handling: matches the pre-existing synchronous-path behaviour byte-for-byte
  (`plugin-config-source-resolver.ts:216-218`), so this is not a regression introduced by Batch 3 — it is an
  existing contract this batch's new branch faithfully mirrors.
- Recommendation: out of this batch's stated scope (R8's fail-closed guarantee is specifically about the
  *unknown-policy* signal, which agent-sdk raises via a named error). If a future batch wants failure-mode
  parity with the frozen case, `resolveEffective`'s catch branch would need a `this.logger`/similar sink, which
  the resolver does not currently have injected — a design change, not a one-line fix.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: `desired.collisions` in a frozen pass's health reflects candidates that will never actually be
  written this pass (see Five logic questions, Q3). `harness-reconciler.service.ts:246,448`.
- Moderate: no logging differentiates a generic read failure (silent, unfiltered fallback) from a recognised
  policy-unknown failure (logged, frozen) on the `getEffectivePluginConfig` path. `plugin-config-source-resolver.ts:250-259`.
- Minor: `resolveEffective`'s JSDoc ("It never rejects") is accurate for the method itself, but is easy to
  misread as a guarantee about `resolve()`'s overall contract; the surrounding port doc
  (`harness-source.port.ts:150-158`, "must never reject") already states the stronger guarantee, so this is
  redundant rather than wrong.

## Data flow

1. `HarnessReconcilerService.runReconcile`/`verify` call `this.sourceResolver.resolve(workspaceRoot)` and
   `await` the result unconditionally (`:202`, `:383`) — OK, matches the port's `HarnessSourceState |
   Promise<HarnessSourceState>` contract for both sync and async readers (R12).
2. `PluginConfigSourceResolver.resolve` branches on `typeof reader.getEffectivePluginConfig === 'function'`
   (`:196`) — OK, structural, no instanceof/agent-sdk coupling.
3. `resolveEffective` awaits ONE call to `getEffectivePluginConfig`, and maps its three outcomes (success /
   `CapabilityPolicyUnknownError` / other error) to three distinct `HarnessSourceState` shapes — OK for the
   first two; the third (Failure mode 2) silently degrades rather than distinguishing itself, but that mirrors
   pre-existing behaviour.
4. The reconciler computes `frozen = source.policyUnknown === true` once per pass (`:390`) and threads it through
   `reconcileTarget` to `freezeToMcp` (`:429-434`, `:616`) — OK, applied uniformly to every selected target,
   after `target.plan()` has already computed the full (unfiltered) plan, so freezing is a pure post-filter and
   never short-circuits target detection or hashing.
5. `freezeToMcp` rebuilds `baseEntries` from the on-disk manifest for every non-mcp kind (so an adoption a
   frozen pass would have made is NOT taken) and from the plan for `mcp` entries only (:1043-1049) — OK,
   verified against `harness-reconciler.capability-policy.spec.ts:325` (`store.load(ws, 'claude').entries`
   unchanged after a frozen pass over previously-known state).
6. `policyHealth` stamps `sources`/`policyFingerprint` from the SOURCE state, not from `desired` — OK, this is
   what makes the health object correct even on the no-drift `target.verify()` branch inside `reconcileTarget`
   (`:607`), which never sees `frozen` at all: the outer `policyHealth` call is unconditional and always
   authoritative for the top-level `sources` field regardless of which per-target branch ran.
7. Electron's `getEffectivePluginConfig` wrapper (`phase-2-libraries.ts:246-260`) forwards `workspaceRoot` and
   folds `readDormantSkillSlugs(container)` into `disabledSkillIds` — OK, symmetric with the existing
   `getDisabledSkillIds` wrapper one block above it, same container source.
8. `HarnessSkillSelectionRpcService.getSelection()` awaits `resolve()` before calling `readSkillCandidates` — OK,
   the one other call site (`harness-rpc.handlers.ts:1003`) is already inside an `async` handler.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| G1: layered policy reaches the reconciler in one snapshot | COMPLETE | none |
| G2: Electron wrapper forwards root, folds dormant slugs | COMPLETE | none |
| G2b: VS Code/CLI pass loader unwrapped | COMPLETE | none |
| Policy-unknown → frozen (skill/plugin/agent/command, MCP unaffected) | COMPLETE | none |
| Fingerprint stamped on reconcile/verify | COMPLETE for known policy; BY-DESIGN ABSENT for frozen | Documented and tested absence; downstream `HarnessPolicySync` cost noted (Failure mode 1) |
| Health `sources: 'policy-unknown'` | COMPLETE | none |
| R2: no agent-sdk import | COMPLETE | none |
| R12: existing reconciler specs unchanged | COMPLETE | none |
| Third-caller fix (`getSelection` async) | COMPLETE | none |

Implicit requirements not addressed: distinguishing a generic read failure from a recognised policy-unknown
failure in logs/health (pre-existing gap, not introduced here); none of this batch's own scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Global OFF opt-out plugin, no workspace entry | YES | `[G1]` spec, disk-verified | none |
| Global OFF skill | YES | `[G1]` spec, disk-verified | none |
| Global ON opt-in plugin | YES | `[G1]` spec, disk-verified | none |
| Workspace beats global, both directions | YES | `[G1]` spec, disk-verified | none |
| Policy-unknown mid-session (rejecting reader) | YES | `[AC-3.4]` spec, disk-verified (no reap, no re-add) | none |
| Reader without `getEffectivePluginConfig` | YES | sync-path spec, `resolve()` stays non-Promise | none |
| Reader's method resolves to `undefined` | Code path exists (`:239`) | Falls back to `empty` | Not spec-covered directly, but structurally identical to other `empty` fallbacks |
| Non-policy-unknown throw from the effective path | YES | `empty`, unfiltered | No log distinguishing it from "nothing global set" (Moderate) |
| Reader throws synchronously instead of rejecting | YES | Caught by the `async` wrapper | `plugin-config-source-resolver.spec.ts:137-148` |
| Fingerprint acknowledgement under a permanently-unknown policy | Traced, not fixed here | `HarnessPolicySync` forces every call | Out of this batch's file scope (Failure mode 1) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The most notable residual behaviour is that `HarnessPolicySync` (a different
  batch's file) will force a harness preflight on every session start for as long as the capability policy
  stays unreadable, since a frozen pass can never carry a matching fingerprint — almost certainly intentional
  fail-closed design, but worth naming explicitly since no plan or batch text calls it out as a cost.
- What a robust implementation would add: (1) a log line on the generic (non-policy-unknown) read-failure
  branch of `resolveEffective`, so an operator can tell "global layer said nothing" apart from "the read threw
  and got silently swallowed"; (2) a spec case for `getEffectivePluginConfig` resolving to `undefined`, to pin
  the `:239` fallback the same way every other `empty`-returning branch is already pinned; (3) a one-line note
  in the PR description or a follow-up ticket about the `HarnessPolicySync` forced-retry cost under a
  persistently broken policy store.

## Verification run

`NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync,ptah-electron,@ptah-extension/rpc-handlers --parallel=2` — tailed. Exactly the two documented known-transient failures and nothing else:
- `rpc-handlers` `rpc-allowlist.spec.ts:42` ("RPC manifest is missing an owner for 3 method(s): capabilities:getState, capabilities:getEffective, capabilities:setEnabled") — expected, fixed by B10.
- `ptah-electron` `src/di/rpc-surface.spec.ts:38` (391 vs 388) — expected, fixed by B12.
- harness-sync: lint, typecheck, test all passed (part of the 13 successful tasks in the run summary).
- rpc-handlers: 3273 passed / 1 failed (the expected one) / 4 skipped, out of 3278.
- ptah-electron: 872 passed / 1 failed (the expected one) / 3 skipped, out of 876.
  against base in this worktree.

## Part 2: code style reviews (was reviews/code-style-review.md)

# Code Style Review — `TASK_2026_560_2ae5` (Batch 1)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 6/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 0                                    |
| Serious issues  | 3                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 8                                    |

Scope: the 8 files listed in `batches.md` Batch 1 — `libs/shared/src/lib/types/capability-toggle.types.ts`
(+ `.spec.ts`), `libs/shared/src/index.ts`, `harness-sync.types.ts`, `rpc/rpc-misc.types.ts`,
`mcp-directory.types.ts`, and `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
(+ `.spec.ts`). Read in full. Compared against `libs/shared/src/lib/types/harness-sync.types.ts` (620 lines,
the plan's own named pattern), `libs/shared/src/lib/types/user-layer-agents.ts` (123 lines, the plan's own
named precedent for a dependency-free hash), `CONVENTIONS.md`, and `implementation-plan.md` C1. Verified with
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2`
(passes) and `npx nx run @ptah-extension/shared:typecheck` in isolation (passes — a workspace-diagnostics
BigInt/ES2020 warning against this file did not reproduce under the project's real `tsconfig.lib.json`,
target `ES2022`; treated as a tool artifact, not a finding).

## Five style questions

### 1. What breaks in six months?

`libs/shared/src/lib/types/capability-toggle.types.ts` is 1107 lines and already carries five unrelated
concerns: the domain contract, the resolution rules, the approval-import planner, a TOML key escaper, a
hand-rolled FNV-1a fingerprint, and a hand-rolled FIPS 180-4 SHA-256 implementation (`capability-toggle.types.ts:1031-1107`,
the `SHA256_K`/`SHA256_INITIAL` tables and `sha256Hex`). The next person who needs to touch the id codec (D2)
or add a sixth capability concern has to read past a cryptographic primitive to find the ~40 lines that matter
to them, and a future change to any one concern risks merge conflicts with every other one landing in the same
PR. This is exactly the growth pattern `CONVENTIONS.md:51-52` warns about for barrels ("If you exceed it, the
library is doing too much; split before adding more") — the file has no such guard rail.

### 2. What would a new team member misread?

A newcomer skimming `libs/shared/src/index.ts:47` (`export * from './lib/types/capability-toggle.types'`)
would reasonably assume, from the filename and the sibling barrel entries around it (`harness-sync.types`,
`origin-sidecar.types`, `user-layer-agents`), that this file is types-plus-a-reducer like its stated pattern.
They would not expect to find a full SHA-256 block cipher-style implementation 900 lines in
(`capability-toggle.types.ts:1031-1107`) — nothing in the file name, the module doc comment (`:1-23`), or the
export list signals "this file also implements a hash primitive." The doc comment at `:14-15` even points to
`user-layer-agents.ts` as the reason no Node import is used, but that file never needed SHA-256 — its FNV-1a is
23 lines, not a cryptographic primitive; the analogy undersells what was actually added.

### 3. What does this cost to maintain?

The SHA-256 block adds ~75 lines of un-reused, security-adjacent code that nothing else in `libs/shared`
exercises. It has to be kept correct against the FIPS 180-4 spec by hand, with no shared review anchor (no
other file in the repo implements a NIST hash), and it duplicates a facility every JS runtime already has
(`crypto.subtle.digest`/`node:crypto`) — the constraint that forced it (`libs/shared` ships to the browser
bundle) is real, but the fixed D2 vectors in the spec (`capability-toggle.types.spec.ts:1,40-42`) are verified
against `node:crypto`'s `createHash('sha256')` directly, which is itself only importable because the spec runs
under Node. A synchronous `Uint8Array -> hex` hasher used only by the codec is a natural single-purpose file
(`capability-id-codec.ts` per the plan's own suggested split), not part of the growing types barrel.

### 4. Where is this inconsistent with the rest of the repository?

- `libs/shared/src/lib/types/harness-sync.types.ts` (620 lines, the explicitly named pattern for this task,
  `batches.md:215`) holds types plus ONE pure reducer (`summarizeHarnessHealth`) and stays under 700 lines.
  `capability-toggle.types.ts` holds types plus six functional facets (defaults, resolution, plugin-config
  layering, MCP scope/definition rules, approval-import planning, TOML escaping, a fingerprint hasher, AND a
  codec with its own SHA-256) at 1107 lines — a materially different shape from the file it was told to
  follow, not a proportional extension of it.
- `mcp-directory.types.ts` (diff) now does `import type { CapabilityScope } from './capability-toggle.types'`
  (`mcp-directory.types.ts:10`), while `capability-toggle.types.ts` does
  `import type { McpServerOrigin, McpInstallTarget } from './mcp-directory.types'` (`capability-toggle.types.ts:26`).
  These two files now import from each other. TypeScript erases both at compile time (`import type`), so it
  does not break the build, but it is a real cycle in the dependency graph between two files in the same
  `types/` folder, which no other pair in `libs/shared/src/lib/types/` does (`harness-sync.types.ts` and
  `user-layer-agents.ts` are read by `capability-toggle.types.ts` one-way only). `CapabilityScope` describes an
  MCP-declaration property just as much as a capability-toggle one (`InstalledMcpServer.scope?`,
  `mcp-directory.types.ts:300-306`); it either belongs in whichever file is the lower layer, or in a primitives
  file both can import one-way.
- `CONVENTIONS.md:31` names `src/lib/utils/` as the home for "pure functions only" inside a library, and this
  task's own review instructions explicitly ask whether a facet-named split (not a generic `utils.ts`) fits —
  the file currently does neither: it is not split, and everything lives in a `types/` file named for the
  domain contract alone.

### 5. What would you have done differently, and why is that better rather than merely other?

Split by facet, matching the naming this codebase already uses for adjacent concerns (compare
`libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts`, `task-spec.contract.ts` next to `task-graph.ts`
— related but separately named files, not one megafile):

- `capability-toggle.types.ts` — identity, stored values, resolution types, `EffectiveCapabilitySet`,
  `ICapabilityResolver`/`ICapabilityGlobalLayer`, `CAPABILITY_ENFORCEMENT`, and the resolution-rule functions
  (`defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`, `classifyMcpScope`,
  `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`) — the part that is genuinely "types +
  reducer," matching `harness-sync.types.ts`'s shape and size.
  `harnessPolicyFingerprint`/`isHarnessPassAcknowledged`/`tomlKeySegment` are a defensible stay here too if kept
  small, since they participate directly in the resolution story.
- `capability-id-codec.ts` (+ `.spec.ts` split out of the current spec) — `encodeCapabilityId`,
  `decodeCapabilityId`, `canonicalFilename`, `parseCapabilityFilename`, the UTF-8 helpers, and the SHA-256
  block. This isolates the one piece of genuinely novel, security-adjacent code behind a name that tells a
  reader exactly what they are opening, and it can be reviewed and vector-tested on its own.

This is better than the current shape because it makes the file someone opens match what they came to change:
a reviewer diffing the resolution rules for a future AC never has to scroll past a hash implementation, and a
reviewer double-checking the SHA-256 block against FIPS 180-4 does not have to first read 900 lines of
unrelated domain rules. It also brings the primary file back under the 620-line precedent instead of nearly
doubling it, with no loss of the "types + pure rules only, no runtime deps" boundary — both new files keep
that same constraint.

## Blocking issues

None. The check command passes, no `as any` was introduced, no `catch (error)` without `: unknown` appears in
the reviewed files, and the marketplace component change is a single, exhaustively-typed switch case that
matches its siblings exactly.

## Serious issues

### One `.types.ts` file holds a domain contract, a resolution engine, an import planner, a TOML escaper, and a hand-rolled SHA-256

- File: `libs/shared/src/lib/types/capability-toggle.types.ts:1-1107`
- Problem: the file is 1107 lines against the pattern it was told to follow
  (`harness-sync.types.ts`, 620 lines, `batches.md:215`), and it mixes a cryptographic primitive
  (`:1031-1107`, `SHA256_K`, `SHA256_INITIAL`, `sha256Hex`) into a file whose name and header promise "TYPES
  and the PURE RULES only" (`:5`). Nothing about the filename or the barrel export signals that a FIPS 180-4
  implementation lives inside it.
- Tradeoff: keeping it as one file avoids the ceremony of a second export and a second spec file, but it
  trades that for a file a reviewer cannot safely skim, a higher chance of accidental coupling between
  unrelated changes (e.g., a resolution-rule tweak and a codec tweak landing in the same diff hunk region), and
  a file that no longer matches the size or shape of its own named precedent.
- Recommendation: split into `capability-toggle.types.ts` (contract + resolution rules) and
  `capability-id-codec.ts` (+ `.spec.ts`) for the encode/decode/canonical-filename/UTF-8/SHA-256 code, per the
  Five Style Questions answer above. Re-export the codec's public surface from
  `capability-toggle.types.ts` or directly from `libs/shared/src/index.ts` so `TASK_2026_559` and the store
  (Batch 6) see no import-path change.

### `mcp-directory.types.ts` and `capability-toggle.types.ts` import from each other

- File: `libs/shared/src/lib/types/mcp-directory.types.ts:10` (`import type { CapabilityScope } from
  './capability-toggle.types'`) and `libs/shared/src/lib/types/capability-toggle.types.ts:26`
  (`import type { McpServerOrigin, McpInstallTarget } from './mcp-directory.types'`)
- Problem: this is a cycle between two files in `libs/shared/src/lib/types/`. Both imports are `import type`,
  so it is erased before it can become a runtime cycle, but it is still a structural inconsistency: no other
  pair of files in this `types/` folder imports each other, and the dependency graph the barrel implies
  (leaf types feeding into composed types) does not hold for these two.
- Tradeoff: leaving it as-is works today because both sides stay type-only, but it is one accidental value
  import away (e.g., someone adding a runtime helper that needs `CapabilityScope` as a value, or a `satisfies`
  check) from becoming a real circular dependency that `tsc`/bundlers resolve inconsistently.
- Recommendation: either move `CapabilityScope` to `mcp-directory.types.ts` (it already describes
  `InstalledMcpServer.scope?`, a declaration-scope concept that predates capability toggles) and have
  `capability-toggle.types.ts` import it from there one-way, or lift `CapabilityScope` into a primitives file
  both can import one-way (no existing candidate; only worth it if a third consumer appears).

### File length trending well past the repository's stated "split before adding more" signal

- File: `libs/shared/src/lib/types/capability-toggle.types.ts` (1107 lines), spec at
  `libs/shared/src/lib/types/capability-toggle.types.spec.ts` (738 lines)
- Problem: `CONVENTIONS.md:51-52` states the barrel size ceiling exists because "the library is doing too much;
  split before adding more." The types file under review is not a barrel, but the same signal applies: at
  1107 lines it is the single largest file in `libs/shared/src/lib/types/` by a wide margin (next-largest is
  `rpc.types.ts` at 3903 lines, which is itself an outlier the repo already tolerates as a grab-bag RPC
  registry, not a comparable "types + rules" file; the next comparable file, `harness-sync.types.ts`, is 620).
  Batch 2 (RPC types) and later batches that touch `CAPABILITY_ENFORCEMENT` (PR 2's enforcement flip,
  `implementation-plan.md:516-518`) will both edit this same file, compounding the merge-conflict risk of one
  megafile.
- Tradeoff: the file compiles and tests pass today, so this is not urgent, but every subsequent batch that
  touches capability types adds to a file that is already outside this repo's demonstrated norm for this shape
  of file.
- Recommendation: apply the split from the "Blocking issues" entry above before Batch 2 lands more content in
  the same file.

## Minor issues

- `libs/shared/src/lib/types/capability-toggle.types.ts:14-15` — the doc comment credits `user-layer-agents.ts`
  for the "no Node import" precedent, but that file's hash is a 23-line FNV-1a, not a SHA-256 implementation.
  The comment should say the SHA-256 requirement comes from the D2 fixed test vectors (which are pinned against
  real SHA-256 output), not imply the existing precedent already covered this scope of code.
- `libs/shared/src/lib/types/capability-toggle.types.ts:1043-1048` (`SHA256_INITIAL`) and the `SHA256_K` table
  above it are unavoidably "magic numbers" for a hash implementation, but as written they carry no inline
  citation of the spec section (FIPS 180-4 §5.3.3) a future maintainer would need to re-verify them against;
  a one-line comment would remove the need to search externally to audit the constants.
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts:469-476` — the new test
  only asserts the badge's tone class and the panel note text; every neighbouring case in the same `describe`
  block (e.g., the "names collisions as unreconcilable" case just below it, `harness-health-badge.component.spec.ts:479+`)
  follows the identical two-assertion shape, so this is consistent, not a defect — noted only because it is the
  thinnest of the sibling cases and could also assert the badge's accessible label, as a couple of the other
  cases in the file do. Not required for this batch.

## File-by-file

### `capability-toggle.types.ts`

Score 5/10 — 0 blocking, 2 serious, 2 minor. The resolution rules, defaults and RPC contracts are precise and
well-documented (every non-obvious branch carries a "why," e.g. `nextWorkspaceValue`'s inherit-vs-imported
distinction at `:232-243`), and the pure-functions-only boundary is honestly held (no `as any`, no ambient
`Error` catches). The file's size and the embedded SHA-256 are the two Serious findings above; everything else
in it is sound.

### `capability-toggle.types.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. Covers every named Resolution rule, the D2 fixed vectors verbatim
(`:46-51`), fingerprint stability under reordering, and the acknowledgement predicate's negative cases. It
imports `node:crypto` (`:1`) purely for test oracles, which is correct for a Jest spec and does not violate the
"shared ships to the browser" constraint (specs never ship). Would follow the codec split above 1:1 if that
split happens; no change needed on its own merits.

### `libs/shared/src/index.ts`

Score 10/10 — one explicit `export *` line added in the existing alphabetically-loose grouping next to
`harness-sync.types`, matching the file's established pattern exactly.

### `harness-sync.types.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (folded into the note above only as context, not double-counted).
The `'policy-unknown'` union member, its doc-comment rationale (`:69-73`), the `policyFingerprint?` field and
its reducer branch (`:314-315`) all match this file's existing documentation density and structure precisely.

### `mcp-directory.types.ts`

Score 7/10 — 0 blocking, 1 serious (the cross-import above), 0 minor. The `scope?` field addition and its doc
comment match the file's existing style; the only issue is the new import direction.

### `rpc/rpc-misc.types.ts`

Score 10/10 — `enabledSkillIds?` is documented with the same "optional for backward compatibility" rationale
as its sibling `disabledPluginIds` field it explicitly cross-references (`:512-521`), and its interaction with
`disabledSkillIds` (deny wins) is stated inline.

### `harness-health-badge.component.ts` / `.spec.ts`

Score 9/10 — the new `'policy-unknown'` case is textually and structurally identical to its neighbours in the
exhaustive switch (`:265-266`), keeps the component `OnPush` with no new state, and the spec case matches the
file's established `render` → `openPanel` → assert two-line shape. This resolves the plan's P1 finding
(`batches.md:24`) exactly as scoped — no other component behaviour was touched.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `libs/shared` holds types + pure functions only, no runtime deps | PASS | No `node:crypto`/`node:*` import in `capability-toggle.types.ts`; hand-rolled UTF-8/SHA-256/FNV-1a instead (`:963-1107`) |
| Barrel export style (`export * from` for a type bundle) | PASS | `libs/shared/src/index.ts:47` |
| File shape matches its named pattern (`harness-sync.types.ts`) | FAIL | 1107 lines vs. 620-line pattern; six unrelated facets in one file (see Serious #1) |
| No import cycle within `libs/shared/src/lib/types/` | FAIL | `mcp-directory.types.ts:10` ↔ `capability-toggle.types.ts:26` (see Serious #2) |
| Exhaustive switch stays exhaustive on a new union member | PASS | `harness-health-badge.component.ts:265-266`, no `default` added, compiler-enforced |
| Angular OnPush / signals for the touched component | PASS | Component already `ChangeDetectionStrategy.OnPush`; no state model changed |
| No new `as any` / untyped `catch` | PASS | None found in the reviewed files |
| Spec style matches neighbouring specs | PASS | Both new spec cases follow their file's established `describe`/assertion shape |
| Naming: kebab-case files, UPPER_SNAKE constants | PASS | `capability-toggle.types.ts`, `CAPABILITY_ENFORCEMENT`, `CAPABILITY_POLICY_UNKNOWN_ERROR_NAME`, etc. |

## Maintenance debt

- Introduced: one 1107-line shared types file carrying a domain contract, a resolution engine, an approval
  planner, a TOML escaper, and a hand-rolled SHA-256/UTF-8 codec; one type-only import cycle between
  `mcp-directory.types.ts` and `capability-toggle.types.ts`.
- Retired: nothing — this batch is additive (new file, optional-field extensions, one new switch case).
- Net: negative on file cohesion (one file now does materially more than its named pattern), neutral on
  behaviour and test coverage (both are strong).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `capability-toggle.types.ts` has outgrown the "types + pure rules" shape it was explicitly
  told to follow, most concretely by embedding a full SHA-256 implementation; splitting the codec out before
  Batch 2 adds more content to the same file is the cheapest point to fix it.
- What a 10/10 version would do differently: split into `capability-toggle.types.ts` (contract + resolution
  rules, ~650-750 lines) and `capability-id-codec.ts` + `.spec.ts` (codec + UTF-8 + SHA-256, ~350 lines); give
  `CapabilityScope` a single-direction home so `mcp-directory.types.ts` and the toggle types file are not
  mutually importing; and correct the `user-layer-agents.ts` doc-comment citation to name the actual reason
  (D2's SHA-256-verified vectors) SHA-256 rather than FNV-1a was required.

---

## Re-review round 1

Re-read in full: `capability-toggle.types.ts` (now 694 lines), `capability-id-codec.ts` (new, 435 lines) +
`.spec.ts` (285 lines), `capability-toggle.types.spec.ts` (now 456 lines), `mcp-directory.types.ts` (863 lines,
diffed against the prior read), and the badge spec split. Re-ran
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2 --skip-nx-cache`
(fresh, no cache) — all six tasks pass.

### Prior findings

1. **Serious — one file holds contract, resolution engine, import planner, TOML escaper and SHA-256.**
   RESOLVED. `capability-toggle.types.ts` is now 694 lines and holds only the domain contract and the
   resolution-rule functions (`defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`,
   `classifyMcpScope`, `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`,
   `CAPABILITY_ENFORCEMENT`) — the shape this task named as the pattern (`harness-sync.types.ts`, 620 lines).
   The byte-level code (id codec, TOML key segment, SHA-256, FNV-1a fingerprint) moved to
   `capability-id-codec.ts`. Both files are now under the 700-line reference point raised in the original
   review, and each reads as what its header promises to a first-time reader.
2. **Serious — `mcp-directory.types.ts` and `capability-toggle.types.ts` import each other.**
   RESOLVED. `CapabilityScope` now lives in `mcp-directory.types.ts:18` with no import statement in that file
   at all (verified: `grep -n "^import" mcp-directory.types.ts` returns nothing). `capability-toggle.types.ts:30-34`
   imports `CapabilityScope` from `mcp-directory.types.ts` one-way, and imports `CapabilityKind`/
   `CapabilityFingerprintEntry` from `capability-id-codec.ts` one-way (`:26-29`). `capability-id-codec.ts`
   imports only `HarnessHealth` (type) from `harness-sync.types.ts` and `PluginConfigState` (type) from
   `rpc/rpc-misc.types.ts` — neither of which imports back. The dependency graph among the four files is now a
   DAG with no cycle.
3. **Serious — file length trending past the repository's "split before adding more" signal.**
   RESOLVED as a consequence of #1. `capability-toggle.types.ts` (694) and `capability-id-codec.ts` (435) both
   land comfortably under the `harness-sync.types.ts` (620-line) reference, and Batch 2's RPC additions
   (`rpc-capability.types.ts`, a new file) will not compound either file further.
4. **Minor — `user-layer-agents.ts` doc-comment citation overclaims precedent.**
   RESOLVED. `capability-id-codec.ts:13-18` now states its own reason for SHA-256 directly ("pinned to real
   SHA-256 output by the D2 fixed vectors... a weaker hash cannot stand in for it") instead of leaning on the
   `user-layer-agents.ts` analogy; `capability-toggle.types.ts:11-16`'s header now says only that byte-level
   encodings "live beside this file," with no overclaim.
5. **Minor — SHA-256 constants carry no inline spec citation.**
   RESOLVED. `capability-id-codec.ts:351-354` and `:369-372` cite FIPS 180-4 §4.2.2 and §5.3.3 by name for the
   round-constant and initial-hash tables, and the `sha256Hex` doc comment (`:382`) cites §5.1.1 and §6.2.2 for
   padding and computation.
6. **Minor — thinnest badge spec case vs. its siblings.**
   RESOLVED. The `policy-unknown` badge-tone case moved next to its `sources-missing` sibling
   (`harness-health-badge.component.spec.ts:244-252`) and now asserts tone class AND the badge's own text
   content, matching the two-and-three-assertion shape of the surrounding cases in that `describe` block; the
   separate panel-note case at `:479-489` is unchanged and still correct on its own.

### New: is `capability-id-codec.ts` a coherent single concern?

Mostly, with one soft edge. The file's header (`:1-19`) states its own scope precisely — "this file only turns
values into bytes, names and digests" — and three of its four exported groups fit that exactly: the item-file
codec (`encodeCapabilityId`/`decodeCapabilityId`/`canonicalFilename`/`parseCapabilityFilename`), the TOML key
escaper (`tomlKeySegment`), and the fingerprint hasher (`harnessPolicyFingerprint`, plus the UTF-8 and SHA-256
primitives beneath it). `isHarnessPassAcknowledged` (`:218-226`) is the soft edge: it is a boolean predicate
over a `HarnessHealth` and an expected fingerprint string — comparison and business-rule logic ("was this pass
acknowledged"), not an encoding of a value into bytes. It does not turn anything into bytes, names or digests;
it consumes the digest `harnessPolicyFingerprint` produces. Placing it immediately below the function whose
output it compares is a defensible locality call (a reader who asks "how would I check this fingerprint"
finds the answer one function down), and splitting it into a fourth file for one five-line predicate would
trade a real coherence gain for a file too thin to justify its own existence — the task guidance against
"tiny files just to split" cuts against that. This is a Minor, not a Serious, finding: the file name
"capability-id-codec" undersells the TOML and fingerprint content it already carries (it is not just an "id"
codec), so a name such as `capability-policy-codec.ts` would fit its actual contents more precisely, but this
does not block approval — the header's own explanation is honest about what is inside, even where the name is
not perfectly matched. Not required for this batch; worth doing opportunistically if the file is touched again
for an unrelated reason.

### New: is `enforcementRows` nameable and justified?

Yes. `capability-toggle.types.ts:641-694` replaces what was 15 near-identical `CapabilityEnforcementRow`
object literals with a small named helper (`enforcementRows(provider, label, byKind)`) plus two named,
self-documenting constants (`EVERY_KIND_ENFORCED`, `MCP_NOT_ENFORCED`) that read as domain facts, not
mechanism. This is exactly the kind of table-construction helper this codebase already tolerates locally
(compare `USER_SCOPE_TARGETS`/`CLAUDE_DEFINITION_PRECEDENCE` a few hundred lines above it in the same file) —
a private, single-file, single-purpose function, not a generic `utils.ts` export. `ENFORCEMENT_KIND_ORDER`
correctly pins iteration order so the table's row order stays stable and matches the CAPABILITY_ENFORCEMENT
spec's assumptions (`capability-toggle.types.spec.ts` still asserts one row per provider/kind pair and the
specific not-enforced set — both pass). No issue.

### Any new style issue

None found beyond the Minor naming note on `capability-id-codec.ts` above (which was already weighed and does
not block). No new `as any`, no new untyped catches, no new cycles, no regression in the Angular component
pattern, and the check command passes cold (no cache).

### Verdict

- **Recommendation: APPROVE**
- Confidence: HIGH
- All three Serious findings from the first round are resolved with evidence (line counts re-measured, import
  graph re-traced by hand, checks re-run without cache). The one new observation — `capability-id-codec.ts`'s
  name being slightly narrower than its contents — is Minor and does not gate this batch.

# Code Style Review — Batch 13

Scope: `libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts` (+ `.spec.ts`, untracked),
`libs/frontend/marketplace/src/lib/ui/capability-toggle.component.ts` (+ `.spec.ts`, untracked), and the
additive diff to `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts` +
`marketplace-shell.component.html` (modified). Every file was read in full, not only the diff. Comparison
siblings: `data/connector-links.store.ts` (905 lines, the store-scoping and generation-guard pattern C10
explicitly names), `ui/status-pill.component.ts` (the tone/badge token pattern), and the repo-wide checkbox/
toggle convention (`libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts:66`, plus six chat/
cron-scheduler/tasks-ui consumers).

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 9/10           |
| Assessment      | APPROVE        |
| Blocking issues | 0              |
| Serious issues  | 0              |
| Minor issues    | 2              |
| Files reviewed  | 4 (2 new pairs, 1 modified pair) |

## Five style questions

### 1. What breaks in six months?

Nothing structural. `notEnforcedProviders` (`capability-toggle.component.ts:147-153`) and every badge tone read
from `CAPABILITY_ENFORCEMENT` and the entry's own fields — never a literal kind/provider name — so PR 2's
enforcement flip (A-UI, batches.md:98-100) changes zero lines here. The one thing that will need a real edit is
`capability-toggle.component.ts:193`'s reliance on the daisyUI `toggle` class family staying in the Tailwind
config; that is an existing repo-wide dependency, not one this batch introduces.

### 2. What would a new team member misread?

`capability-toggle.component.ts:334-341`'s `onChange` snaps `input.checked` back to `this.checked()`
synchronously, before the store has answered. Read in isolation it looks like a bug (the click appears to do
nothing), but it is the same controlled-native-input technique every DOM-driven Angular checkbox in this
codebase needs (the browser flips the box on click before Angular's next tick; the row, not the DOM, is the
source of truth per the class doc at `:161-164`). The inline comment at `:337-338` already says this, so the
risk is low, not zero.

### 3. What does this cost to maintain?

Very little beyond what `ConnectorLinksStore` already costs. `CapabilityTogglesStore` is 366 lines against
`ConnectorLinksStore`'s 905 for a materially smaller feature (one read, one write, one derived banner vs. two
merged sources, three action kinds and a polling loop) — proportionate, not inflated. The one real, if small,
tax: `addPending`/`removePending` (`capability-toggles.store.ts:315-326`) reimplement, field-for-field,
`ConnectorLinksStore.addTo`/`removeFrom` (`connector-links.store.ts:857-871`) — add-to-copy, no-op-if-absent
remove-from-copy over a `WritableSignal<ReadonlySet<T>>`. Two stores in the same `lib/data/` directory now carry
byte-identical logic under different names, which is exactly the "duplication with drift risk" the hunt list
flags, even though nothing has drifted yet (see Minor-1).

### 4. Where is this inconsistent with the rest of the repository?

It is not, materially. Every convention checked was already established, and the executor followed it rather
than inventing a new one:

- provider scoping and lifecycle (`@Injectable()` with no `providedIn`, the `use-injectable-provided-in`
  eslint-disable with the same wording, `ensure`/`reload`/`dismissActionError`, the `loadGeneration` +
  `workspace generation` staleness guard, the `workspaceEffect` that no-ops on construction) all mirror
  `ConnectorLinksStore` line-for-line in shape;
- badge tone classes (`BADGE_TONE_CLASSES`, `capability-toggle.component.ts:34-38`) use the identical
  `border-x/40 bg-x/10 text-x` token formula as `status-pill.component.ts:61-67`'s `TONE_CLASSES`;
- the native-checkbox-as-switch (`type="checkbox" class="toggle toggle-sm toggle-primary"`,
  `capability-toggle.component.ts:191-193`) has direct precedent in the shared `ui` lib's own
  `native/form/json-schema-form.component.ts:65-66` (`class="toggle toggle-primary"`) and six other consumers
  (chat settings, cron-scheduler-tab, tasks-ui task-card, chat-ui plugin-catalog-panel, workspace-indexing).
  There is no `Native*Switch` in `libs/frontend/ui/src/lib/native/`, and the library's own form renderer does
  not build one either — it uses the same daisyUI checkbox-as-toggle the executor used. This is the
  established pattern, not an ad hoc substitute;
- the per-instance id counter (`nextToggleId`, `capability-toggle.component.ts:156-157,279`) matches the exact
  `let next...Id = 0` shape used in five other marketplace/skill-synthesis components;
- OnPush, standalone, `inject()`, signals and `@if`/`@for` control flow are used throughout, matching the shell
  and every sibling read.

The one real naming inconsistency: the store imports the RPC-facing alias `CapabilitiesGetStateResult`
(`capability-toggles.store.ts:14`, `rpc/rpc-capability.types.ts:42`, itself `= CapabilityInventory`), while its
own spec imports the domain type name `CapabilityInventory` (`capability-toggles.store.spec.ts:6`) to build the
same fixtures. Both are correct and both compile; it is just two names for one shape across two files that ship
together (Minor-2).

### 5. What would you have done differently, and why is that better rather than merely other?

Pull `addTo`/`removeFrom` (or `addPending`/`removePending`) into a small shared helper — e.g.
`libs/frontend/marketplace/src/lib/data/set-signal.ts` exporting `addToSet`/`removeFromSet` — and have both
`ConnectorLinksStore` and `CapabilityTogglesStore` call it. That is better than leaving both, not merely
different: today the two copies are identical, so extracting them costs nothing in behaviour and removes one of
the two places a future edit (say, adding a debug log on every membership change) would have to be made
twice to stay correct. This is exactly the "a third real use proves the shared shape" bar in the simplicity
rule — two present, byte-identical, same-directory implementations already meet it. Not blocking for this
batch: the duplication is small (12 lines), has not drifted, and forcing an extraction mid-batch would touch a
file `ConnectorLinksStore` owns outside this batch's assigned scope.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

1. **Duplicated set-mutation helpers.** `capability-toggles.store.ts:315-326` (`addPending`/`removePending`)
   duplicate `connector-links.store.ts:857-871` (`addTo`/`removeFrom`) field-for-field. Fix: extract a shared
   `addToSet`/`removeFromSet` pair (see Q5) the next time either file is touched for an unrelated reason; not
   worth a scope-widening edit now.
2. **Two names for one RPC shape.** `capability-toggles.store.ts:14` imports `CapabilitiesGetStateResult`;
   `capability-toggles.store.spec.ts:6` imports the underlying `CapabilityInventory` for the same object shape
   (`rpc/rpc-capability.types.ts:42`: `CapabilitiesGetStateResult = CapabilityInventory`). Fix: pick one name
   and use it in both files, or leave as is — the alias exists precisely so RPC call sites and domain code can
   use their own vocabulary, so this is a preference, not a defect.

## File-by-file

### `data/capability-toggles.store.ts` (+ `.spec.ts`)

Score 9/10 — 0B, 0S, 1M (duplicated set helpers). Matches `ConnectorLinksStore`'s scoping, staleness-guard and
optimistic-revert shape exactly, at proportionate size for its smaller surface. The spec (`.spec.ts`, 495
lines) exercises lazy load, load supersession, the fail-closed banner, optimistic revert (including the
"reload landed meanwhile" race) and the workspace-switch drop — the same case shapes `connector-links.store`'s
sibling specs use.

### `ui/capability-toggle.component.ts` (+ `.spec.ts`)

Score 9/10 — 0B, 0S, 0M beyond the shared naming note above. Presentational as the batch's contract requires
(`entry`/`scope`/`pending`/`error` in, `toggled` out, the store owns every RPC call). The native-checkbox
choice has direct, repo-wide precedent including inside `libs/frontend/ui` itself (see Q4); no `[innerHTML]`
anywhere in either file. The spec (371 lines) derives its "not enforced" expectations from
`CAPABILITY_ENFORCEMENT` rather than hard-coding labels, satisfying the A-UI risk mitigation the plan calls out
by name (batches.md:98-100, implementation-plan.md's C10 enforcement-marks note) for exactly this file.

### `shell/marketplace-shell.component.ts` + `.html` (modified)

Score 10/10 — 0B, 0S, 0M. The diff is minimal and additive: one import, one `providers[]` entry, one `inject()`
field, one `computed`-free signal re-export (`policyBanner = this.capabilities.policyBanner`), and one `@if`
block in the template. The class doc is updated in place to describe the new responsibility (no stale doc left
behind). The shell reads the store and never calls `ensure()`/`load()`, matching its own documented contract
("Neither loads on construction... the nav and status bar only read") and the plan's stated shape (implementation-plan.md C10; batches.md R4, which pre-approved exactly this file as a +1 contingency).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Standalone + OnPush | PASS | `capability-toggle.component.ts:185-186`; shell unchanged at `:115` |
| Signals + `inject()`, no constructor-injected fields via param | PASS | `capability-toggles.store.ts:88-89`; `capability-toggle.component.ts` uses `input`/`output`/`computed` only |
| New control-flow syntax (`@if`/`@for`) | PASS | `capability-toggle.component.ts:218,220,234,240,251`; `marketplace-shell.component.html:71-95` |
| Shell-scoped store via `providers[]`, no `providedIn: 'root'` | PASS | `marketplace-shell.component.ts:119`; `capability-toggles.store.ts:86-87` with the same eslint-disable comment as `connector-links.store.ts:172-173` |
| Smart/dumb split (page owns store, toggle is presentational) | PASS | `capability-toggle.component.ts` has no `inject()` of any store; every write goes through `(toggled)` |
| No cross-layer import (marketplace → backend) | PASS | Both new files import only `@ptah-extension/core` and `@ptah-extension/shared` |
| UI primitive reuse over ad hoc control | PASS (see Q4) | `libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts:65-66` establishes the same `toggle`-class checkbox; no `Native*Switch` exists to bypass |
| Badge/pill token formula consistency | PASS | `capability-toggle.component.ts:34-38` vs `status-pill.component.ts:61-67` |
| No `[innerHTML]` | PASS | absent from all four files |
| File length proportionate to sibling | PASS | 366/352 lines vs. `connector-links.store.ts`'s 905 for a larger feature set |
| Shared set-mutation logic not duplicated | FAIL (Minor) | `capability-toggles.store.ts:315-326` vs `connector-links.store.ts:857-871` |

## Maintenance debt

- Introduced: one shell-scoped store (366 lines) and one presentational component (352 lines), both sized and
  shaped to match the sibling the plan named; one small (12-line) duplicated helper pair.
- Retired: nothing (additive batch).
- Net: negligible increase, proportionate to the feature. The one debt item (Minor-1) is cheap to pay off later
  and does not compound on its own.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only note worth remembering is the small duplicated set-helper pair, to fold
  into a shared utility opportunistically rather than let a third store repeat it again.
- What a 10/10 version would do differently: extract `addToSet`/`removeFromSet` before or alongside this batch
  instead of after a third copy appears, and use one name (`CapabilityInventory` or `CapabilitiesGetStateResult`)
  consistently between the store and its spec.
