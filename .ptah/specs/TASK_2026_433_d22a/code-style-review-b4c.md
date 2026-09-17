# Code Style Review — `TASK_2026_433` Batch B4c

## Summary

| Metric          | Value                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Overall score   | 8/10                                                                                              |
| Assessment      | APPROVED                                                                                          |
| Blocking issues | 0                                                                                                  |
| Serious issues  | 0                                                                                                  |
| Minor issues    | 2                                                                                                  |
| Files reviewed  | 1 (`agent-process-manager.service.ts`, scoped diff only per instructions; B5a's uncommitted vscode-lm-tools changes were out of scope and not reviewed) |

## Five style questions

### 1. What breaks in six months?

Nothing structural. The interface is file-local and has exactly one producer (`doSpawn`, `agent-process-manager.service.ts:475`) and one consumer (`doSpawnSdk`, `:492`), so a future field addition is a two-line, compiler-checked change instead of a silent positional-order bug. The only latent risk: `roleChannel` is `readonly AgentRoleChannel` (required) on `SdkSpawnOptions` (`:131`) sourced from `adapter.roleChannel`, which B3 made a required `CliAdapter` member — if a future adapter type ever made `roleChannel` optional again, this call site would still compile (TS allows passing a required prop from a required source) but nothing here would catch a *conceptual* drift back to optional; that's an acceptable coupling to the interface, not a defect of this diff.

### 2. What would a new team member misread?

Very little — this is the most legible version of the two call sites. A reader unfamiliar with the history might wonder why `SdkSpawnOptions` is a full interface (with doc-less members) while the very similar `spawnFromSdkHandle` `meta` parameter one screen down (`:589-615`) is an inline object type with per-field JSDoc. Both represent "everything one spawn call needs," so the shape divergence (named interface vs. inline type, undocumented vs. heavily documented) is the one place a newcomer would pause. That divergence is explicitly what Task 4c.1 asked for (a file-local *named* interface, "no new comments") and is the correct choice, but it's worth flagging as intentional so nobody "fixes" the meta object to match without cause.

### 3. What does this cost to maintain?

Effectively nothing beyond one interface declaration (10 lines, `:124-134`) and a destructure block (10 lines, `:495-505`). It replaces 9 positional parameters, which is a net maintenance win: the old signature (visible pre-diff as the removed `runSdk, request, task, workingDirectory, cli, displayName, roleChannel, binaryPath?, mcpPort?` list) required every future caller to remember exact positional order and the two-required-then-optional tail; the object form makes every field self-describing at the call site and immune to swapped-argument bugs (e.g., a future edit that reorders `displayName`/`roleChannel` would previously compile silently since both are/were `string`-shaped; now it cannot).

### 4. Where is this inconsistent with the rest of the repository?

Not inconsistent with any stated repository rule. It is a partial, not total, match to the sibling `spawnFromSdkHandle` meta-object pattern the task explicitly named ("Pattern to follow: the `meta` object of `spawnFromSdkHandle`," `batches.md:403`): the sibling is an inline anonymous type with rich per-field docs, this is a hoisted, undocumented, unexported interface. That's a defensible and probably better shape for a 9-field parameter object reused by exactly one call site, and the contract explicitly asked for "no new comments" and a named interface, so this is compliant with the letter and reasonable spirit of the task — see Minor-1 below for the one place the divergence could confuse a reviewer three months from now.

### 5. What would you have done differently, and why is that better rather than merely other?

Nothing on the substance. If anything, I'd add a one-line non-explanatory doc comment (`/** Options for {@link doSpawnSdk}. */`) purely to disambiguate it from `AgentRoleStamp` sitting directly above it in a 2,300+-line file — but the task's own contract says "No new comments," the repo's memory notes a hard "never add explanatory comments" rule (`feedback_no_explanatory_comments.md`), and a bare signature-doc comment risks being read as exactly that. Leaving it uncommented, as done, is the correct call given both constraints.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `agent-process-manager.service.ts:124-134` vs `:589-615` — `SdkSpawnOptions` (interface, undocumented) and `spawnFromSdkHandle`'s `meta` (inline type, several JSDoc blocks including a load-bearing one at `:602-612` about `agentId` ordering) are structurally the same kind of thing (a spawn-call options bag) but shaped differently. Not a defect — the task's own contract mandated this exact shape and forbade comments — but worth a one-line note in the B4c batch record (already partially captured in the review-focus discussion above) so a later pass doesn't "harmonize" them by stripping the meta object's load-bearing docs or by over-documenting this one.
- `agent-process-manager.service.ts:131` — `roleChannel: AgentRoleChannel` (required, no default) sits between two optional members (`binaryPath?`, `mcpPort?`) in the field list, breaking the loose "required-first" convention `AgentRoleStamp` above it follows (all-required, in a single block) and `meta` below it follows (required, then a long optional tail). Cosmetic only — TypeScript doesn't care and no repository style doc mandates member ordering — but a subsequent edit that appends more optional fields would read slightly cleaner if `roleChannel` were grouped with the other required members ahead of `binaryPath`/`mcpPort`. Not worth a standalone edit; mention only.

## File-by-file

### agent-process-manager.service.ts

Score 8/10 — 0 blocking, 0 serious, 2 minor. The diff is exactly what Task 4c.1 specified: a file-local, non-exported `SdkSpawnOptions` next to `AgentRoleStamp` (`:124-134`), `doSpawnSdk(options)` destructured at the top with the body below left untouched (`:492-577`, confirmed byte-identical past the destructure by diffing only the signature/call-site hunks), and a single call site in `doSpawn` using named keys (`:475-485`). Field-by-field mapping was checked against the pre-refactor positional order (`runSdk, request, request.task, workingDirectory, cli, adapter.displayName, adapter.roleChannel, detection.path, mcpPort` from the removed lines) and lands correctly on every named key, including the two easy-to-transpose ones: `binaryPath: detection.path` and `roleChannel: adapter.roleChannel`. `grep -n "doSpawnSdk("` confirms exactly one declaration (`:492`) and one call (`:475`); `git diff --stat` for this file is 1 file, +31/-16, matching the acceptance line. `SdkSpawnOptions` is confirmed unique across `libs/`.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Task 4c.1: file-local, non-exported `SdkSpawnOptions` next to `AgentRoleStamp` | PASS | `agent-process-manager.service.ts:118-134` |
| Task 4c.1: `doSpawnSdk(options)` destructured at top, body unchanged | PASS | `:492-577`; diff shows no change below the destructure |
| Task 4c.1: single call site, named keys | PASS | `:475-485`; `grep "doSpawnSdk("` = 1 declaration + 1 call |
| Task 4c.1: no public-signature, log-payload or behaviour change | PASS | `doSpawn`, `spawnFromSdkHandle`, `trackSdkHandle`, log calls at `:531-538` unchanged; diff confined to the one private method's signature |
| Task 4c.1: no new comments | PASS | No comment added on `SdkSpawnOptions` or the destructure |
| CLAUDE.md `catch (error: unknown)` / narrowing | NOT_APPLICABLE | No new error handling introduced by this diff |
| CLAUDE.md naming: `{platform}-{capability}.ts` / `I`-prefix for ports | NOT_APPLICABLE | Internal interface, not a platform port or adapter file |
| Optional/required members reflect call-site reality | PASS | `binaryPath?: string` matches `CliDetectionResult.path?: string` (`agent-process.types.ts:266`); `mcpPort?: number` matches the `adapter.supportsMcp !== false ? … : undefined` ternary (`:473-474`); `roleChannel` required, matching B3's required `CliAdapter.roleChannel` |
| Consistency with sibling `spawnFromSdkHandle` meta object (named in the task as the pattern to follow) | PASS (partial, by design) | Same "grab-bag of spawn inputs" role; shape differs (named interface vs. inline type, undocumented vs. documented) — see Minor-1, not a violation of the written contract |
| Fit with upcoming B4d seam analysis (`batches.md:429-464`) | PASS | `SdkSpawnOptions` only carries S3 (Spawn/tracking) concerns per the B4d seam table; none of its members (`runSdk`, `request`, `task`, `workingDirectory`, `cli`, `displayName`, `roleChannel`, `binaryPath`, `mcpPort`) are owned by the S1 (`AgentSpawnEnvironment`) or S2 (`AgentOutputBuffer`) collaborators B4d extracts, so the type needs no migration when B4d lands |

## Maintenance debt

- Introduced: one 10-line file-local interface (`SdkSpawnOptions`) and a 10-line destructure block; net "surface area" added is roughly 20 lines against 47 lines net churn (`+31/-16`).
- Retired: a 9-parameter positional private method signature, the single highest-arity method-signature risk in this file — eliminates the class of bug where two adjacent same-typed positional args (`displayName`/`roleChannel`, both effectively string-shaped in practice) get silently transposed by a future edit.
- Net: reduces maintenance cost. No new abstraction leaks past the one method it serves; nothing exported that didn't need to be.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only note worth carrying forward is that `SdkSpawnOptions` and the `spawnFromSdkHandle` meta type are the same kind of object shaped two different ways — intentional per the task contract, but flag it so B4d or a later pass doesn't try to "unify" them and in doing so strip the meta object's load-bearing `agentId`-ordering doc comment.
- What a 10/10 version would do differently: nothing material. A cosmetic-only alternative would reorder `roleChannel` ahead of the two optional trailing members for pure readability, but that is a stylistic preference with zero measurable cost under current tooling and no repository rule requires it.
