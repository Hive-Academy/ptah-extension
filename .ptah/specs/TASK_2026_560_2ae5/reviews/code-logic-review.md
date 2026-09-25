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
  issues found in this round.
