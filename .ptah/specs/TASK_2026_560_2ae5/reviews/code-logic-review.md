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
